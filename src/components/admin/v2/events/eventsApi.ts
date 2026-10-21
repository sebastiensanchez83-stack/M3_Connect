import { supabase } from '@/lib/supabase';
import { eventPath } from '@/lib/seoMeta';
import {
  countFair, countGuestList, loadEventRegistrationCounts, type EventRegistrationCount,
} from '@/components/admin/events/registrationCounts';

/**
 * Admin > Events, wave 2 (Victor, 21 Oct 2026): "one event = one page", whatever system holds it.
 *
 * Events live in three systems today:
 *   public.events   the catalogue row (public page). Alone it is an OLD-system event
 *                   (event_registrations); linked from gl_event or sm_event it is the public
 *                   page of that system's event.
 *   public.gl_event guest lists. engine core_v2 = made with the new event editor; engine
 *                   guest_list_v1 = a guest list run from its own console (/admin/guest-list/<slug>).
 *                   hidden = a test event (the canaries of the set-up scripts).
 *   public.sm_event fairs run from their own console (Smart Marina, /admin/sm26/*).
 *
 * Every read here is a staff SELECT (RLS: is_moderator / sm_is_staff); nothing writes. No token,
 * no personal column (names, e-mails) is read for the lists and the figures.
 */

export type EventSystem = 'core' | 'legacy' | 'guest_list' | 'fair';
export type EventKind = 'webinar' | 'onsite';
export type EventPhase = 'upcoming' | 'current' | 'past' | 'undated';

export interface EventSummary {
  /** Unique and stable: `${system}:${id}`. */
  key: string;
  system: EventSystem;
  title: string;
  kind: EventKind;
  /** ISO timestamps (a fair's dates become the start and the end of its days, UTC). */
  start: string | null;
  end: string | null;
  allDay: boolean;
  place: string | null;
  /** The public page is published (catalogue row); null when there is none. */
  published: boolean | null;
  /** A test event (gl_event.hidden): listed only with "Show test events", never in the menu. */
  test: boolean;
  invitationOnly: boolean;
  capacity: number | null;
  catalogueId: string | null;
  catalogueSlug: string | null;
  gl: { id: string; slug: string; engine: string } | null;
  fair: { id: string; slug: string } | null;
  /** This event's admin page. */
  href: string;
  /** Its public page, when it has one. */
  publicHref: string | null;
}

interface CatalogueLite {
  id: string; title: string | null; event_type: string | null; date_time: string | null; end_date_time: string | null;
  is_full_day: boolean | null; location: string | null; published: boolean | null; slug?: string | null;
  max_attendance: number | null; invitation_only: boolean | null;
}
interface GlLite {
  id: string; slug: string; title: string | null; engine: string | null; kind: string | null; hidden: boolean | null;
  legacy_event_id: string | null; capacity: number | null; registration_mode: string | null; settings: Record<string, unknown> | null;
}
interface FairLite {
  id: string; slug: string; name: string | null; start_date: string | null; end_date: string | null; venue: string | null;
  status: string | null; legacy_event_id: string | null;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** A fair's day "2026-09-21" as an instant inside that day in Europe (08:00 or 20:00 UTC), so it reads as the same day in Monaco. */
const dayIso = (d: string | null, end: boolean): string | null => (d ? `${d.slice(0, 10)}T${end ? '20:00:00' : '08:00:00'}Z` : null);

/** The admin page of an event, by system. */
export function eventAdminHref(e: Pick<EventSummary, 'system' | 'catalogueId' | 'gl' | 'fair'>): string {
  if (e.system === 'guest_list' && e.gl) return `/admin/events/guest-list/${encodeURIComponent(e.gl.slug)}`;
  if (e.system === 'fair' && e.fair) return `/admin/events/fair/${encodeURIComponent(e.fair.slug)}`;
  return `/admin/events/${e.catalogueId ?? e.gl?.id ?? ''}`;
}

/** Every event of the three systems, tests included (the caller filters). Throws when a read fails. */
export async function loadEventDirectory(): Promise<EventSummary[]> {
  const [cat, gl, fair] = await Promise.all([
    supabase.from('events').select('*').order('date_time', { ascending: false, nullsFirst: true }),
    supabase.from('gl_event').select('id, slug, title, engine, kind, hidden, legacy_event_id, capacity, registration_mode, settings'),
    supabase.from('sm_event').select('id, slug, name, start_date, end_date, venue, status, legacy_event_id'),
  ]);
  if (cat.error) throw new Error(cat.error.message);
  if (gl.error) throw new Error(gl.error.message);
  if (fair.error) throw new Error(fair.error.message);
  const cats = (cat.data ?? []) as CatalogueLite[];
  const gls = (gl.data ?? []) as GlLite[];
  const fairs = (fair.data ?? []) as FairLite[];
  const out: EventSummary[] = [];

  for (const c of cats) {
    const g = gls.find(x => x.legacy_event_id === c.id) ?? null;
    const f = fairs.find(x => x.legacy_event_id === c.id) ?? null;
    const system: EventSystem = f ? 'fair' : g ? (g.engine === 'core_v2' ? 'core' : 'guest_list') : 'legacy';
    const e: EventSummary = {
      key: `${system}:${f?.id ?? g?.id ?? c.id}`,
      system,
      title: str(c.title) ?? str(g?.title) ?? str(f?.name) ?? 'Untitled event',
      kind: c.event_type === 'on_site' || g?.kind === 'onsite' || f ? 'onsite' : 'webinar',
      start: c.date_time ?? dayIso(f?.start_date ?? null, false),
      end: c.end_date_time ?? dayIso(f?.end_date ?? null, true),
      allDay: !!c.is_full_day,
      place: str(c.location) ?? str(f?.venue) ?? str(g?.settings?.venue),
      published: c.published === null || c.published === undefined ? true : !!c.published,
      test: g?.hidden === true,
      invitationOnly: !!c.invitation_only || g?.registration_mode === 'invitation',
      capacity: (g?.capacity && g.capacity > 0 ? g.capacity : null) ?? (c.max_attendance && c.max_attendance > 0 ? c.max_attendance : null),
      catalogueId: c.id,
      catalogueSlug: c.slug ?? null,
      gl: g ? { id: g.id, slug: g.slug, engine: g.engine ?? 'guest_list_v1' } : null,
      fair: f ? { id: f.id, slug: f.slug } : null,
      href: '',
      publicHref: eventPath({ id: c.id, slug: c.slug ?? null }),
    };
    e.href = eventAdminHref(e);
    out.push(e);
  }
  // Guest lists without a public page (the hidden canaries, a list set up by hand).
  for (const g of gls.filter(x => !x.legacy_event_id)) {
    const system: EventSystem = g.engine === 'core_v2' ? 'core' : 'guest_list';
    const s = g.settings || {};
    const e: EventSummary = {
      key: `${system}:${g.id}`,
      system,
      title: str(g.title) ?? g.slug,
      kind: g.kind === 'webinar' ? 'webinar' : 'onsite',
      start: str(s.starts_at),
      end: str(s.ends_at),
      allDay: false,
      place: str(s.venue),
      published: null,
      test: g.hidden === true,
      invitationOnly: g.registration_mode === 'invitation',
      capacity: g.capacity && g.capacity > 0 ? g.capacity : null,
      catalogueId: null,
      catalogueSlug: null,
      gl: { id: g.id, slug: g.slug, engine: g.engine ?? 'guest_list_v1' },
      fair: null,
      href: '',
      publicHref: null,
    };
    e.href = eventAdminHref(e);
    out.push(e);
  }
  // Fairs without a public page.
  for (const f of fairs.filter(x => !x.legacy_event_id)) {
    const e: EventSummary = {
      key: `fair:${f.id}`,
      system: 'fair',
      title: str(f.name) ?? f.slug,
      kind: 'onsite',
      start: dayIso(f.start_date, false),
      end: dayIso(f.end_date ?? f.start_date, true),
      allDay: true,
      place: str(f.venue),
      published: f.status ? f.status !== 'draft' : null,
      test: false,
      invitationOnly: false,
      capacity: null,
      catalogueId: null,
      catalogueSlug: null,
      gl: null,
      fair: { id: f.id, slug: f.slug },
      href: '',
      publicHref: null,
    };
    e.href = eventAdminHref(e);
    out.push(e);
  }
  return out;
}

/* ------------------------------------------------------------------ dates and states */

export function eventPhase(e: Pick<EventSummary, 'start' | 'end'>, now = Date.now()): EventPhase {
  const s = e.start ? Date.parse(e.start) : NaN;
  const en = e.end ? Date.parse(e.end) : NaN;
  if (Number.isNaN(s) && Number.isNaN(en)) return 'undated';
  // No end: the event lasts until the end of its start day (UTC), so it is not "past" at 10:01.
  const last = !Number.isNaN(en) ? en : s + 24 * 3600 * 1000;
  if (last < now) return 'past';
  if (!Number.isNaN(s) && s <= now) return 'current';
  return 'upcoming';
}

/** Upcoming first (soonest first, undated last), then past (most recent first). */
export function sortEvents(list: EventSummary[], now = Date.now()): { upcoming: EventSummary[]; past: EventSummary[] } {
  const startOf = (e: EventSummary) => (e.start ? Date.parse(e.start) : Number.POSITIVE_INFINITY);
  const endOf = (e: EventSummary) => (e.end ? Date.parse(e.end) : e.start ? Date.parse(e.start) : 0);
  const upcoming = list.filter(e => eventPhase(e, now) !== 'past').sort((a, b) => startOf(a) - startOf(b));
  const past = list.filter(e => eventPhase(e, now) === 'past').sort((a, b) => endOf(b) - endOf(a));
  return { upcoming, past };
}

/** "27 Nov 2026", "20 – 21 Sep 2026", or null. */
export function shortDate(e: Pick<EventSummary, 'start' | 'end'>): string | null {
  if (!e.start) return null;
  const s = new Date(e.start);
  if (Number.isNaN(s.getTime())) return null;
  const fmt = (d: Date, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Monaco', ...opts }).format(d);
  const en = e.end ? new Date(e.end) : null;
  const sameDay = !en || Number.isNaN(en.getTime()) || fmt(s, { year: 'numeric', month: '2-digit', day: '2-digit' }) === fmt(en, { year: 'numeric', month: '2-digit', day: '2-digit' });
  if (sameDay) return fmt(s, { day: 'numeric', month: 'short', year: 'numeric' });
  const sameMonth = fmt(s, { month: '2-digit', year: 'numeric' }) === fmt(en!, { month: '2-digit', year: 'numeric' });
  return sameMonth
    ? `${fmt(s, { day: 'numeric' })} – ${fmt(en!, { day: 'numeric', month: 'short', year: 'numeric' })}`
    : `${fmt(s, { day: 'numeric', month: 'short' })} – ${fmt(en!, { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

/** The time of day, in Monaco time, for a dated event that is not all day. */
export function shortTime(e: Pick<EventSummary, 'start' | 'allDay' | 'system'>): string | null {
  if (!e.start || e.allDay || e.system === 'fair') return null;
  const d = new Date(e.start);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Monaco', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
}

export const SYSTEM_LABEL: Record<EventSystem, string> = {
  core: 'New event editor',
  legacy: 'Old event editor',
  guest_list: 'Guest list',
  fair: 'Fair console',
};

export const SYSTEM_HINT: Record<EventSystem, string> = {
  core: 'Made with the new event editor: everything is handled on this page.',
  legacy: 'An event of the old system: it is changed in the old event editor.',
  guest_list: 'A guest list: registrations, invitations and the door are handled in its own screens.',
  fair: 'A fair: registrations, the door and the programme are handled in its own console.',
};

/* ------------------------------------------------------------------ counts */

/** Real registration counts of every listed event (head counts only, read-only). */
export async function loadSummaryCounts(list: EventSummary[]): Promise<Record<string, EventRegistrationCount>> {
  const withCatalogue = list.filter(e => e.catalogueId);
  const out: Record<string, EventRegistrationCount> = {};
  const byCatalogue = await loadEventRegistrationCounts(
    withCatalogue.map(e => ({ id: e.catalogueId as string, max_attendance: e.capacity })),
  ).catch(() => ({} as Record<string, EventRegistrationCount>));
  for (const e of withCatalogue) if (byCatalogue[e.catalogueId as string]) out[e.key] = byCatalogue[e.catalogueId as string];
  await Promise.all(list.filter(e => !e.catalogueId).map(async e => {
    try {
      if (e.gl) {
        const c = await countGuestList(e.gl.id);
        out[e.key] = {
          ...c, capacity: e.capacity,
          systems: [e.gl.engine === 'core_v2' ? 'core_v2' : 'guest_list_v1'],
          manageUrl: e.system === 'core' ? e.href : `/admin/guest-list/${e.gl.slug}`,
        };
      } else if (e.fair) {
        const c = await countFair(e.fair.id);
        out[e.key] = { ...c, invited: 0, capacity: null, systems: ['sm26'], manageUrl: e.href };
      }
    } catch { /* unknown figure: the row shows a dash */ }
  }));
  return out;
}

/** "14 registered · 3 waiting · 25 invited · 150 places" in plain words. */
export function countWords(c: EventRegistrationCount | undefined): string {
  if (!c || c.registered === null) return '—';
  const parts = [`${c.registered} registered`];
  if (c.waiting) parts.push(`${c.waiting} waiting`);
  if (c.invited) parts.push(`${c.invited} invited`);
  if (c.capacity) parts.push(`${c.capacity} places`);
  return parts.join(' · ');
}

/* ------------------------------------------------------------------ facts behind the tabs */

type Page<T> = { data: T[] | null; error: { message: string } | null };

/** Reads every row of a query, 1,000 at a time (the API caps one read at 1,000). */
async function readAll<T>(make: (from: number, to: number) => PromiseLike<Page<T>>, max = 20000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < max; from += 1000) {
    const { data, error } = await make(from, from + 999);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

/** One guest-list row as the figures need it: no name, no e-mail, no token. */
export interface GuestFact {
  status: string;
  source: string | null;
  source_detail: Record<string, unknown> | null;
  checked_in_at: string | null;
  payment_status: string | null;
  ticket_key: string | null;
  country: string | null;
  created_at: string;
  responded_at: string | null;
  conference: boolean | null;
  gala: boolean | null;
}

export function loadGuestFacts(glEventId: string): Promise<GuestFact[]> {
  return readAll<GuestFact>((from, to) => supabase
    .from('gl_guest')
    .select('status, source, source_detail, checked_in_at, payment_status, ticket_key, country, created_at, responded_at, conference, gala')
    .eq('event_id', glEventId)
    .order('created_at', { ascending: true })
    .range(from, to) as unknown as PromiseLike<Page<GuestFact>>);
}

export interface MailFact { kind: string; sent_at: string }

/** The e-mails logged for a guest list (gl_email_log.event_id). */
export function loadGuestListMails(glEventId: string): Promise<MailFact[]> {
  return readAll<MailFact>((from, to) => supabase
    .from('gl_email_log').select('kind, sent_at').eq('event_id', glEventId).order('sent_at', { ascending: false })
    .range(from, to) as unknown as PromiseLike<Page<MailFact>>);
}

export interface CampaignFact { id: string; name: string; archived: boolean; recipients: Record<string, number>; total: number }

/** The invitation campaigns of a guest list and their recipients by status. */
export async function loadCampaigns(glEventId: string): Promise<CampaignFact[]> {
  const { data, error } = await supabase.from('invitation_campaign').select('id, name, archived_at').eq('gl_event_id', glEventId).order('created_at');
  if (error) throw new Error(error.message);
  const camps = (data ?? []) as { id: string; name: string; archived_at: string | null }[];
  if (camps.length === 0) return [];
  const recs = await readAll<{ campaign_id: string; status: string }>((from, to) => supabase
    .from('invitation_recipient').select('campaign_id, status').in('campaign_id', camps.map(c => c.id)).order('id')
    .range(from, to) as unknown as PromiseLike<Page<{ campaign_id: string; status: string }>>);
  return camps.map(c => {
    const mine = recs.filter(r => r.campaign_id === c.id);
    return { id: c.id, name: c.name, archived: !!c.archived_at, recipients: tally(mine.map(r => r.status)), total: mine.length };
  });
}

/* ------------------------------------------------------------------ helpers for the figures */

export function tally(values: (string | null | undefined)[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) {
    const k = v ?? '';
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

/** Monday of the week of an ISO date, "2026-10-19". */
export function weekOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const day = (d.getUTCDay() + 6) % 7;
  const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
  return m.toISOString().slice(0, 10);
}

/** Registrations per week, oldest first, the last `max` weeks that have any. */
export function perWeek(dates: string[], max = 12): { week: string; n: number }[] {
  const t = tally(dates.map(weekOf).filter(Boolean));
  return Object.keys(t).sort().slice(-max).map(week => ({ week, n: t[week] }));
}

export function weekLabel(week: string): string {
  const d = new Date(`${week}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? week : `Week of ${new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(d)}`;
}

export function fmtDay(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(d);
}

/** "1,140 €" from cents. */
export function money(cents: number, currency = 'EUR'): string {
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency, maximumFractionDigits: 0 }).format(cents / 100);
  } catch {
    return `${Math.round(cents / 100)} ${currency}`;
  }
}

/** A key as words: "feedback_reminder" -> "Feedback reminder". */
export function words(key: string | null | undefined): string {
  if (!key) return '—';
  const s = key.replace(/[_-]+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Guest-list states in plain words (the same words as the guest list and the new editor). */
export const GUEST_STATUS_WORD: Record<string, string> = {
  requested: 'To review',
  needs_info: 'Information needed',
  waitlisted: 'Waiting list',
  invited: 'Invited, no answer yet',
  approved: 'Approved',
  confirmed: 'Confirmed',
  declined: 'They declined',
  rejected: 'Not accepted',
  cancelled: 'Cancelled',
};

/** Where a guest-list row came from (gl_guest.source, or source_detail.entry when the page logged it). */
const SOURCE_WORD: Record<string, string> = {
  request: 'Asked on the site',
  invitation: 'Invited by M3',
  plus_one: 'Plus-one of a guest',
  registration: 'Registered on the site',
  signup: 'Sign-up page',
  event_page: 'Event page',
  deep_link: 'Direct link',
  campaign: 'E-mail campaign',
  unknown: 'Not recorded',
};
export const sourceWord = (k: string) => SOURCE_WORD[k] ?? words(k);

export const GL_IN = ['approved', 'confirmed'];
export const GL_WAITING = ['requested', 'needs_info', 'waitlisted'];

/** The guest-list figures every tab uses. */
export function guestFigures(facts: GuestFact[]) {
  const by = tally(facts.map(f => f.status));
  const sum = (keys: string[]) => keys.reduce((n, k) => n + (by[k] ?? 0), 0);
  const inList = facts.filter(f => GL_IN.includes(f.status));
  return {
    total: facts.length,
    byStatus: by,
    registered: sum(GL_IN),
    waiting: sum(GL_WAITING),
    invited: by.invited ?? 0,
    declined: by.declined ?? 0,
    checkedIn: facts.filter(f => !!f.checked_in_at).length,
    checkedInOfIn: inList.filter(f => !!f.checked_in_at).length,
    byPayment: tally(facts.filter(f => f.payment_status && f.payment_status !== 'none').map(f => f.payment_status)),
    byTicket: tally(inList.map(f => f.ticket_key ?? '')),
    byCountry: tally(facts.map(f => (f.country ?? '').trim() || 'Not given')),
    bySource: tally(facts.map(f => {
      const entry = f.source_detail && typeof f.source_detail.entry === 'string' ? f.source_detail.entry : null;
      return entry ?? f.source ?? 'unknown';
    })),
    conference: inList.filter(f => f.conference === true).length,
    gala: inList.filter(f => f.gala === true).length,
    weeks: perWeek(facts.map(f => f.created_at)),
  };
}

/** The biggest entries of a tally, the rest summed as "Other". */
export function topEntries(t: Record<string, number>, max = 8, label = (k: string) => k): { label: string; n: number }[] {
  const entries = Object.entries(t).sort((a, b) => b[1] - a[1]);
  const head = entries.slice(0, max).map(([k, n]) => ({ label: label(k), n }));
  const rest = entries.slice(max).reduce((s, [, n]) => s + n, 0);
  return rest ? [...head, { label: 'Other', n: rest }] : head;
}
