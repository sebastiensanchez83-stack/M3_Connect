import { useEffect, useState } from 'react';
import type { TFunction } from 'i18next';
import { supabase } from '@/lib/supabase';

/**
 * The event editor's data layer (registration core, Phase 1 ADMIN lane).
 *
 * Contract: docs/registration-contract.md of the DB lane.
 *   - Reads: events, gl_event, gl_question, gl_guest directly (staff RLS).
 *   - Writes: ONE call, admin_save_event(p) (events + gl_event + gl_question in one
 *     transaction; a key left out keeps its stored value), admin_clone_event(src, overrides).
 *   - Staff decisions go through the `registration` edge function (gl_decide_v2 is
 *     service-role only); "attended" through gl_checkin_v2 (staff RPC).
 * Nothing here writes a gl_guest row directly, and nothing reads or shows a token.
 */

/* ------------------------------------------------------------------ types */

export type EventKind = 'webinar' | 'onsite';
export type RegistrationMode = 'instant' | 'review' | 'invitation';
export type FieldRule = 'required' | 'optional' | 'hidden';
export type StandardField = 'company' | 'job_title' | 'phone' | 'country';
export const STANDARD_FIELDS: StandardField[] = ['company', 'job_title', 'phone', 'country'];

export interface CatalogueRow {
  id: string;
  title: string;
  description: string | null;
  date_time: string | null;
  end_date_time: string | null;
  is_full_day: boolean | null;
  location: string | null;
  language: string | null;
  speakers: { name?: string; title?: string }[] | null;
  event_website_url: string | null;
  image_url: string | null;
  replay_url: string | null;
  published: boolean | null;
  /** The event page's address, /events/<slug> (supabase/migrations/20261020160000_readable_slugs.sql); absent before it. */
  slug?: string | null;
  /** {venue, address, city, country, map_url, lat, lng}: read by the event page (main and the redesign). */
  location_details?: Record<string, unknown> | null;
}

export interface GlEventRow {
  id: string;
  slug: string;
  title: string;
  legacy_event_id: string | null;
  capacity: number | null;
  notify_email: string | null;
  settings: Record<string, unknown> | null;
  engine?: 'guest_list_v1' | 'core_v2';
  kind?: EventKind;
  registration_mode?: RegistrationMode;
  public_requests?: boolean;
  access?: 'public' | 'members';
  opens_at?: string | null;
  closes_at?: string | null;
  edit_locks_at?: string | null;
  waitlist?: boolean;
  plus_ones?: number;
  standard_fields?: Partial<Record<StandardField, FieldRule>> | null;
  meeting_url?: string | null;
  replay_url?: string | null;
  reminders?: string[] | null;
  staff_alert_mode?: 'each' | 'digest';
  account_email_timing?: 'with_confirmation' | 'after_event';
  account_email_send_at?: string | null;
  door_token?: 'shared' | 'separate';
  hidden?: boolean;
  /** Stamped by admin_save_event on every save: tells the editor someone saved since it loaded. */
  updated_at?: string | null;
}

export type QuestionKind =
  | 'text' | 'textarea' | 'select' | 'multiselect' | 'checkbox' | 'url' | 'phone'
  | 'country' | 'sectors' | 'parts' | 'consent';

export type ProfileField = 'job_title' | 'country' | 'phone' | 'linkedin_url';

export interface QuestionOption { value: string; label: string }

export interface QuestionRow {
  key: string;
  label: string;
  help: string | null;
  kind: QuestionKind;
  options: QuestionOption[] | null;
  max_length: number | null;
  required: boolean;
  ticket_keys: string[] | null;
  profile_field: ProfileField | null;
  editable_after_submit: boolean;
  display_order: number;
}

/** A participation type (gl_ticket) as stored. Prices are display only until December. */
export interface TicketRow {
  key: string;
  label: string;
  description: string | null;
  price_cents: number | null;
  currency: string | null;
  price_note: string | null;
  invite_only: boolean;
  capacity: number | null;
  allowed_company_types: string[] | null;
  parts: string[] | null;
  display_order: number;
  active: boolean;
}

/** One part of an on-site event (gl_event.settings.parts, the shape wys26 uses): conference, gala dinner. */
export interface EventPart { key: string; label: string; when: string }

/** The company types a participation type can be kept for (organizations.organization_type). */
export const COMPANY_TYPES = ['marina', 'partner', 'investor', 'developer', 'media_partner'] as const;

export type GuestStatus =
  | 'requested' | 'needs_info' | 'waitlisted' | 'invited' | 'approved'
  | 'confirmed' | 'declined' | 'rejected' | 'cancelled';

/** A registration as the staff list reads it. Never the personal or door token. */
export interface GuestRow {
  id: string;
  status: GuestStatus;
  source: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  company: string | null;
  job_title: string | null;
  country: string | null;
  ticket_key: string | null;
  answers: Record<string, unknown> | null;
  consents: Record<string, unknown> | null;
  source_detail: Record<string, unknown> | null;
  user_id: string | null;
  info_request: string | null;
  info_requested_at: string | null;
  link_opened_at: string | null;
  checked_in_at: string | null;
  created_at: string;
  decided_at: string | null;
  /** When they answered an invitation (accepted or declined). */
  responded_at: string | null;
  account_action: string | null;
  payment_status: string | null;
}

export const GUEST_COLUMNS =
  'id, status, source, first_name, last_name, email, phone, company, job_title, country, ticket_key, answers, consents, '
  + 'source_detail, user_id, info_request, info_requested_at, link_opened_at, checked_in_at, created_at, decided_at, '
  + 'responded_at, account_action, payment_status';

/**
 * The account set-up of a confirmed on-site registration (account_provision_job, staff
 * SELECT): queued by the database when the row is confirmed, run by provision-person.
 */
export interface ProvisionJob {
  id: string;
  source_id: string;
  status: 'queued' | 'done' | 'skipped' | 'failed';
  attempts: number;
  last_error: string | null;
  email_due_at: string | null;
  email_sent_at: string | null;
  created_at: string;
  done_at: string | null;
}

/* ------------------------------------------------------------------ errors */

/** A database or function failure, with the code the editor turns into words. */
export class EditorError extends Error {
  code: string;
  detail?: string;
  extra?: Record<string, unknown>;
  constructor(code: string, message: string, detail?: string, extra?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.detail = detail;
    this.extra = extra;
  }
}

/** admin_save_event / admin_clone_event codes (contract §4.1), and the read errors, in plain English. */
function saveErrorText(code: string, t: TFunction): string | null {
  switch (code) {
    case 'forbidden': return t('adminEvents.err.forbidden', 'You need an M3 admin account to change events.');
    case 'bad_input': return t('adminEvents.err.badInput', 'Something in the form could not be read. Check the fields and try again.');
    case 'event_not_found': return t('adminEvents.err.notFound', 'This event no longer exists. Go back to the list and open it again.');
    case 'guest_list_event': return t('adminEvents.err.guestList', 'This event runs on the guest list. Change it from its guest-list page.');
    case 'title_required': return t('adminEvents.err.title', 'Give the event a title.');
    case 'slug_required': return t('adminEvents.err.slug', 'Give the event a web address.');
    case 'slug_invalid': return t('adminEvents.err.slugInvalid', 'The web address can only use lower-case letters, numbers and single dashes (60 characters at most).');
    case 'slug_reserved': return t('adminEvents.err.slugReserved', 'This web address is reserved for another page. Choose another one.');
    case 'slug_taken': return t('adminEvents.err.slugTaken', 'Another event already uses this web address. Choose another one.');
    case 'slug_locked': return t('adminEvents.err.slugLocked', 'The web address cannot change once the event is published or someone has registered.');
    case 'bad_kind': return t('adminEvents.err.kind', 'Choose webinar or on-site event.');
    case 'bad_mode': return t('adminEvents.err.mode', 'Choose how people register.');
    case 'instant_needs_webinar': return t('adminEvents.err.instant', 'Open registration works for webinars only. On-site events are checked by M3.');
    case 'bad_access': return t('adminEvents.err.access', 'Choose who can register.');
    case 'bad_capacity': return t('adminEvents.err.capacity', 'The number of places must be a whole number.');
    case 'bad_standard_fields': return t('adminEvents.err.fields', 'One of the form fields has a setting the system does not accept.');
    case 'bad_reminders': return t('adminEvents.err.reminders', 'One of the reminder times is not valid.');
    case 'publish_needs_flag': return t('adminEvents.err.publishFlag', 'Publishing opens once the new event pages are live. Keep the event as a draft, or as a hidden test, until then.');
    case 'bad_tickets': return t('adminEvents.err.tickets', 'The participation types could not be read.');
    case 'bad_ticket_key': return t('adminEvents.err.ticketKey', 'A participation type has an internal name the system does not accept.');
    case 'duplicate_ticket_key': return t('adminEvents.err.ticketDup', 'Two participation types have the same internal name.');
    case 'bad_questions': return t('adminEvents.err.questions', 'The questions could not be read.');
    case 'bad_question_key': return t('adminEvents.err.questionKey', 'A question has an internal name the system does not accept.');
    case 'duplicate_question_key': return t('adminEvents.err.questionDup', 'Two questions have the same internal name. Rename one of them.');
    case 'check': return t('adminEvents.err.check', 'A question or a setting has a value the system does not accept. Check the question types.');
    case 'not_installed': return t('adminEvents.err.notInstalled', 'The new registration system is not installed on the database yet. Ask the developer to finish the set-up.');
    case 'network': return t('adminEvents.err.network', 'The connection failed. Check your internet connection and try again.');
    case 'catalogue_missing': return t('adminEvents.err.catalogue', 'The event page of this event could not be found. Reload the page; if it keeps happening, ask the developer.');
    default: return null;
  }
}

export function editorErrorText(err: unknown, t: TFunction): string {
  const fallback = t('adminEvents.err.generic', 'Something went wrong. Try again in a moment.');
  if (err instanceof EditorError) return saveErrorText(err.code, t) ?? fallback;
  return fallback;
}

type PgError = { code?: string; message?: string; details?: string; hint?: string } | null;

function fromPg(error: PgError): EditorError {
  const code = error?.code ?? '';
  const msg = error?.message ?? '';
  // The RPC does not exist yet (migration not applied) or its signature is unknown.
  if (code === 'PGRST202' || code === '42883' || code === 'PGRST205' || code === '42P01') {
    return new EditorError('not_installed', msg);
  }
  if (code === '42501') return new EditorError('forbidden', msg);
  if (code === '23514') return new EditorError('check', msg, error?.details);
  if (code === '22023' && msg) return new EditorError(msg, msg, error?.details);
  // No database code: the request never reached Postgres (offline, gateway, timeout).
  if (!code) return new EditorError('network', msg);
  return new EditorError(msg || 'unknown', msg, error?.details);
}

/* ------------------------------------------------------------------ reads */

export interface LoadedEvent {
  catalogue: CatalogueRow | null;
  gl: GlEventRow;
  questions: QuestionRow[];
  /** Participation types (gl_ticket), active or not, in their order. */
  tickets: TicketRow[];
  sectorIds: string[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The gl_event behind a catalogue id. Falls back to a gl_event id (the hidden canaries
 * have no catalogue row). Null ONLY when the read succeeded and found no row (the event
 * has no registration of its own, or the id is not an id at all).
 * A failed read THROWS: the caller must never guess "old editor" for a core_v2 event
 * (the old editor writes the join link into the public catalogue row and can delete it).
 */
export async function findGlEvent(id: string): Promise<GlEventRow | null> {
  if (!UUID_RE.test(id)) return null;
  const byCatalogue = await supabase.from('gl_event').select('*').eq('legacy_event_id', id).maybeSingle();
  if (byCatalogue.error) throw fromPg(byCatalogue.error);
  if (byCatalogue.data) return byCatalogue.data as GlEventRow;
  const byId = await supabase.from('gl_event').select('*').eq('id', id).maybeSingle();
  if (byId.error) throw fromPg(byId.error);
  return (byId.data as GlEventRow | null) ?? null;
}

export async function loadEvent(gl: GlEventRow): Promise<LoadedEvent> {
  const [cat, qs, tks, secs] = await Promise.all([
    gl.legacy_event_id
      ? supabase.from('events').select('*').eq('id', gl.legacy_event_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase.from('gl_question').select('*').eq('event_id', gl.id).order('display_order').order('key'),
    supabase.from('gl_ticket').select('*').eq('event_id', gl.id).order('display_order').order('key'),
    gl.legacy_event_id
      ? supabase.from('event_sectors').select('sector_id').eq('event_id', gl.legacy_event_id)
      : Promise.resolve({ data: [], error: null }),
  ]);
  // Any failed read stops here: an editable form built from a missing catalogue row
  // would save an empty description, no date and "unpublished" over the real event
  // (and a list of participation types read as empty would delete them all on save).
  if (cat.error) throw fromPg(cat.error);
  if (qs.error) throw fromPg(qs.error);
  if (tks.error) throw fromPg(tks.error);
  if (secs.error) throw fromPg(secs.error);
  if (gl.legacy_event_id && !cat.data) throw new EditorError('catalogue_missing', 'catalogue row missing');
  return {
    catalogue: (cat.data as CatalogueRow | null) ?? null,
    gl,
    questions: ((qs.data || []) as QuestionRow[]).map(normaliseQuestion),
    tickets: ((tks.data || []) as TicketRow[]).map(normaliseTicket),
    sectorIds: ((secs.data || []) as { sector_id: string }[]).map((r) => r.sector_id),
  };
}

function normaliseTicket(tk: TicketRow): TicketRow {
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : null);
  return {
    key: tk.key,
    label: tk.label || tk.key,
    description: tk.description ?? null,
    price_cents: typeof tk.price_cents === 'number' ? tk.price_cents : null,
    currency: tk.currency || 'EUR',
    price_note: tk.price_note ?? null,
    invite_only: !!tk.invite_only,
    capacity: typeof tk.capacity === 'number' ? tk.capacity : null,
    allowed_company_types: list(tk.allowed_company_types),
    parts: list(tk.parts),
    display_order: Number(tk.display_order) || 0,
    active: tk.active !== false,
  };
}

function normaliseQuestion(q: QuestionRow): QuestionRow {
  const options = Array.isArray(q.options)
    ? (q.options as unknown[]).map((o) => (typeof o === 'string' ? { value: o, label: o } : (o as QuestionOption)))
    : null;
  return { ...q, options };
}

/** Every registration of the event, read 1,000 at a time (the API caps one read at 1,000 rows). */
export async function loadGuests(glEventId: string): Promise<GuestRow[]> {
  const PAGE = 1000;
  const out: GuestRow[] = [];
  for (let from = 0; from < 100000; from += PAGE) {
    const { data, error } = await supabase
      .from('gl_guest')
      .select(GUEST_COLUMNS)
      .eq('event_id', glEventId)
      .order('created_at', { ascending: false })
      .order('id')
      .range(from, from + PAGE - 1);
    if (error) throw fromPg(error);
    const rows = (data || []) as unknown as GuestRow[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/**
 * Every answer key ever stored for the event (gl_guest.answers), so a NEW question never
 * takes the internal name of a removed one: its old answers would come back under it.
 */
export async function loadAnswerKeys(glEventId: string): Promise<string[]> {
  const PAGE = 1000;
  const keys = new Set<string>();
  for (let from = 0; from < 100000; from += PAGE) {
    const { data, error } = await supabase
      .from('gl_guest')
      .select('answers')
      .eq('event_id', glEventId)
      .order('id')
      .range(from, from + PAGE - 1);
    if (error) throw fromPg(error);
    const rows = (data || []) as { answers: Record<string, unknown> | null }[];
    for (const r of rows) for (const k of Object.keys(r.answers || {})) keys.add(k);
    if (rows.length < PAGE) break;
  }
  return [...keys];
}

/**
 * How many registrations use each participation type (gl_guest.ticket_key): a type
 * someone registered with is only switched off when removed, never deleted.
 */
export async function loadTicketUsage(glEventId: string): Promise<Record<string, number>> {
  const PAGE = 1000;
  const out: Record<string, number> = {};
  for (let from = 0; from < 100000; from += PAGE) {
    const { data, error } = await supabase
      .from('gl_guest')
      .select('ticket_key')
      .eq('event_id', glEventId)
      .not('ticket_key', 'is', null)
      .order('id')
      .range(from, from + PAGE - 1);
    if (error) throw fromPg(error);
    const rows = (data || []) as { ticket_key: string | null }[];
    for (const r of rows) if (r.ticket_key) out[r.ticket_key] = (out[r.ticket_key] || 0) + 1;
    if (rows.length < PAGE) break;
  }
  return out;
}

/** The account set-up jobs of these registrations (account_provision_job, staff SELECT), by registration id. */
export async function loadProvisionJobs(guestIds: string[]): Promise<Map<string, ProvisionJob>> {
  const out = new Map<string, ProvisionJob>();
  const CHUNK = 100;
  for (let i = 0; i < guestIds.length; i += CHUNK) {
    const { data, error } = await supabase
      .from('account_provision_job')
      .select('id, source_id, status, attempts, last_error, email_due_at, email_sent_at, created_at, done_at')
      .eq('source_kind', 'gl_guest')
      .in('source_id', guestIds.slice(i, i + CHUNK));
    if (error) throw fromPg(error);
    for (const j of (data || []) as ProvisionJob[]) out.set(j.source_id, j);
  }
  return out;
}

/**
 * The confirmation e-mail with the QR code (gl_email_log kind 'reg_confirmed', logged by
 * the registration function once Resend accepted it; staff SELECT): the latest one per
 * registration. The account e-mail never goes before it (Victor, 15 Oct 2026).
 */
export async function loadConfirmationMails(guestIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const CHUNK = 100;
  for (let i = 0; i < guestIds.length; i += CHUNK) {
    const { data, error } = await supabase
      .from('gl_email_log')
      .select('guest_id, sent_at')
      .eq('kind', 'reg_confirmed')
      .in('guest_id', guestIds.slice(i, i + CHUNK));
    if (error) throw fromPg(error);
    for (const r of (data || []) as { guest_id: string | null; sent_at: string }[]) {
      if (!r.guest_id) continue;
      const prev = out.get(r.guest_id);
      if (!prev || Date.parse(r.sent_at) > Date.parse(prev)) out.set(r.guest_id, r.sent_at);
    }
  }
  return out;
}

/** Clock slack between the decision and the e-mail log (the same 5 minutes as provision-person). */
const CONFIRMATION_SLACK_MS = 5 * 60_000;

/**
 * A confirmed registration whose confirmation e-mail with the QR code is logged for its
 * latest confirmation (staff approval or invitation accepted). False: not sent (failed,
 * or a bulk confirmation cut short) or still sending.
 */
export function confirmationMailSent(g: Pick<GuestRow, 'decided_at' | 'responded_at'>, sentAt: string | undefined): boolean {
  if (!sentAt) return false;
  const times = [g.decided_at, g.responded_at].map((x) => (x ? Date.parse(x) : Number.NaN)).filter((x) => Number.isFinite(x));
  if (!times.length) return true;
  return Date.parse(sentAt) >= Math.max(...times) - CONFIRMATION_SLACK_MS;
}

/* ------------------------------------------------------------ server actions */

/**
 * What the deployed `registration` function can do beyond Phase 2, from its
 * {action: 'capabilities'} answer: {ok: true, actions: ['invite', 'status_link',
 * 'send_test'], email_intros: true, decide_from_invited: true}. The function in
 * production today answers "unknown_action" (before any sign-in check): everything off,
 * and the screens hide what has no server behind it. Asked once per page load.
 */
export interface RegistrationCaps {
  /** The answer came back (from either version): the screens can say "comes later". */
  checked: boolean;
  invite: boolean;
  statusLink: boolean;
  sendTest: boolean;
  /** The e-mails print settings.email_intros (registration and registration-cron). */
  intros: boolean;
  /** gl_decide_v2 takes 'invited' rows: confirm for them, or withdraw the invitation. */
  decideInvited: boolean;
}

export const NO_CAPS: RegistrationCaps = { checked: false, invite: false, statusLink: false, sendTest: false, intros: false, decideInvited: false };

let capsPromise: Promise<RegistrationCaps> | null = null;

export function loadRegistrationCaps(): Promise<RegistrationCaps> {
  if (!capsPromise) {
    capsPromise = registrationStaff<{ ok?: boolean; actions?: unknown; email_intros?: unknown; decide_from_invited?: unknown }>({ action: 'capabilities' })
      .then((res) => {
        if (res.error || res.ok !== true) {
          // An older function says so for good; anything else (offline) is asked again next time.
          if (res.error !== 'unknown_action') capsPromise = null;
          return { ...NO_CAPS, checked: res.error === 'unknown_action' };
        }
        const actions = Array.isArray(res.actions) ? res.actions.filter((x): x is string => typeof x === 'string') : [];
        return {
          checked: true,
          invite: actions.includes('invite'),
          statusLink: actions.includes('status_link'),
          sendTest: actions.includes('send_test'),
          intros: res.email_intros === true,
          decideInvited: res.decide_from_invited === true,
        };
      })
      .catch(() => {
        capsPromise = null;
        return NO_CAPS;
      });
  }
  return capsPromise;
}

/** The capabilities of the registration function (NO_CAPS until known, or when `enabled` is false). */
export function useRegistrationCaps(enabled: boolean): RegistrationCaps {
  const [caps, setCaps] = useState<RegistrationCaps>(NO_CAPS);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void loadRegistrationCaps().then((c) => { if (alive) setCaps(c); });
    return () => { alive = false; };
  }, [enabled]);
  return enabled ? caps : NO_CAPS;
}

/**
 * Invitations from a hidden test event go only to M3's own addresses (and the signed-in
 * staff member's, with or without a +tag): a test never e-mails real people.
 */
export const TEST_INVITE_DOMAINS = ['m3monaco.com', 'smartmarinaconnect.com'];
export const MAX_TEST_INVITES = 10;

export function isTestAddress(email: string, ownEmail: string | null | undefined): boolean {
  const e = email.trim().toLowerCase();
  const at = e.lastIndexOf('@');
  if (at < 1) return false;
  const domain = e.slice(at + 1);
  if (TEST_INVITE_DOMAINS.includes(domain)) return true;
  const own = (ownEmail || '').trim().toLowerCase();
  const ownAt = own.lastIndexOf('@');
  if (ownAt < 1) return false;
  // jane+test1@example.com is jane@example.com's own address.
  const local = e.slice(0, at).replace(/\+.*$/, '');
  return domain === own.slice(ownAt + 1) && local === own.slice(0, ownAt).replace(/\+.*$/, '');
}

/** One line of a registration's history (review_log, staff RLS): decisions and the person's answers. */
export interface HistoryRow {
  action: string;
  note: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

/** The latest 20 history lines of one registration, newest first. */
export async function loadHistory(guestId: string): Promise<HistoryRow[]> {
  const { data, error } = await supabase
    .from('review_log')
    .select('action, note, details, created_at')
    .eq('subject_type', 'registration')
    .eq('subject_id', guestId)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) throw fromPg(error);
  return (data || []) as HistoryRow[];
}

/**
 * What another save would have changed since the editor loaded: gl_event.updated_at
 * (stamped by admin_save_event) and the catalogue's published flag (the old events list
 * writes it directly). Null when it cannot be read: the caller then saves as usual.
 */
export async function readEventStamp(glEventId: string, eventId: string | null): Promise<{ updatedAt: string | null; published: boolean | null } | null> {
  const [gl, cat] = await Promise.all([
    supabase.from('gl_event').select('updated_at').eq('id', glEventId).maybeSingle(),
    eventId ? supabase.from('events').select('published').eq('id', eventId).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  if (gl.error || cat.error || !gl.data) return null;
  return {
    updatedAt: (gl.data as { updated_at?: string | null }).updated_at ?? null,
    published: cat.data ? !!(cat.data as { published?: boolean | null }).published : null,
  };
}

/* ------------------------------------------------------------------ writes */

export interface SaveResult { gl_event_id: string; event_id: string; slug: string }

export async function saveEvent(p: Record<string, unknown>): Promise<SaveResult> {
  const { data, error } = await supabase.rpc('admin_save_event', { p });
  if (error) throw fromPg(error);
  return data as SaveResult;
}

export async function cloneEvent(src: string, overrides: Record<string, unknown>): Promise<SaveResult> {
  const { data, error } = await supabase.rpc('admin_clone_event', { p_src: src, p_overrides: overrides });
  if (error) throw fromPg(error);
  return data as SaveResult;
}

/** Sectors stay in event_sectors (staff RLS), as in the old editor: replaced as a whole. */
export async function saveSectors(eventId: string, sectorIds: string[]): Promise<void> {
  const del = await supabase.from('event_sectors').delete().eq('event_id', eventId);
  if (del.error) throw fromPg(del.error);
  if (sectorIds.length) {
    const ins = await supabase.from('event_sectors').insert(sectorIds.map((sector_id) => ({ event_id: eventId, sector_id })));
    if (ins.error) throw fromPg(ins.error);
  }
}

/** Marks one confirmed registration as attended (or undoes it). */
export async function setAttended(glEventId: string, guestId: string, undo = false): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase.rpc('gl_checkin_v2', {
    p_event_id: glEventId, p_token: null, p_guest_id: guestId, p_undo: undo,
  });
  if (error) throw fromPg(error);
  return (data || { ok: false }) as { ok: boolean; error?: string };
}

/**
 * Staff actions of the `registration` edge function. Returns its JSON body whether it
 * answered 2xx or not, so callers switch on `{ error }` codes (same as lib/guestList.ts).
 */
export async function registrationStaff<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<T & { error?: string }> {
  const { data, error } = await supabase.functions.invoke('registration', { body });
  if (!error) return (data ?? {}) as T & { error?: string };
  try {
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      const answer = (await ctx.json()) as Record<string, unknown> | null;
      // A non-2xx answer always counts as an error, even without our own { error } code
      // (the gateway's 404 when the function is not deployed yet says { code, message }).
      const code = typeof answer?.error === 'string' ? answer.error : typeof answer?.code === 'string' ? answer.code : 'unavailable';
      return { ...(answer || {}), error: code } as T & { error?: string };
    }
  } catch { /* fall through */ }
  return { error: (error as { message?: string }).message || 'network' } as T & { error?: string };
}

/**
 * Staff actions of the `provision-person` function: {action: 'run' | 'send_emails', job_ids}
 * (100 ids at most per call). Same error handling as registrationStaff.
 */
export async function provisionStaff<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<T & { error?: string }> {
  const { data, error } = await supabase.functions.invoke('provision-person', { body });
  if (!error) return (data ?? {}) as T & { error?: string };
  try {
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      const answer = (await ctx.json()) as Record<string, unknown> | null;
      const code = typeof answer?.error === 'string' ? answer.error : typeof answer?.code === 'string' ? answer.code : 'unavailable';
      return { ...(answer || {}), error: code } as T & { error?: string };
    }
  } catch { /* fall through */ }
  return { error: (error as { message?: string }).message || 'network' } as T & { error?: string };
}

/** registration function codes a staff screen can meet, in plain English. */
export function staffErrorText(code: string | undefined, t: TFunction): string {
  switch (code) {
    case 'forbidden':
    case 'session_expired':
    case 'sign_in_required':
      return t('adminEvents.staffErr.session', 'Your session has ended or your account cannot do this. Sign in again as M3 staff.');
    case 'not_found':
      return t('adminEvents.staffErr.notFound', 'This event or registration no longer exists. Reload the page.');
    case 'wrong_engine':
      return t('adminEvents.staffErr.engine', 'This event runs on the guest list. Use its guest-list page.');
    case 'onsite_not_live':
      return t('adminEvents.staffErr.onsiteNotLive', 'On-site registrations can be confirmed once the new event pages are live on the main site. Until then, use a hidden test event.');
    case 'info_request_required':
      return t('adminEvents.staffErr.info', 'Write what you need to know before sending.');
    case 'bad_decision':
    case 'bad_input':
      return t('adminEvents.staffErr.input', 'The request could not be read. Reload the page and try again.');
    case 'rate_limited':
    case 'busy':
      return t('adminEvents.staffErr.busy', 'Too many actions at once. Wait a minute and try again.');
    case 'NOT_FOUND':
    case 'unavailable':
      return t('adminEvents.staffErr.notInstalled', 'The registration service is not installed yet. Ask the developer to deploy it.');
    case 'unknown_action':
      return t('adminEvents.staffErr.actionMissing', 'This action is not installed on the server yet. Ask the developer to deploy the latest registration service.');
    case 'provisioning_off':
      return t('adminEvents.staffErr.provisioningOff', 'Accounts are set up once M3 switches account creation on. Until then this works only for hidden test events.');
    case 'job_ids required':
      return t('adminEvents.staffErr.noJobs', 'Nobody in the selection has an account to set up.');
    case 'too_many':
      return t('adminEvents.staffErr.tooMany', 'Too many people at once: 500 at most.');
    case 'too_large':
      return t('adminEvents.staffErr.tooLarge', 'Too much at once. Send a shorter list (100 people at a time).');
    case 'test_addresses_only':
      return t('adminEvents.staffErr.testOnly', 'A hidden test event invites only M3 addresses (@m3monaco.com, @smartmarinaconnect.com) or your own, 10 at most.');
    case 'nothing_to_resend':
      return t('adminEvents.staffErr.nothingToResend', 'There is no e-mail to send again at this stage. Send their personal link instead.');
    case 'use_guest_list':
      return t('adminEvents.staffErr.engine', 'This event runs on the guest list. Use its guest-list page.');
    case 'capacity':
    case 'ticket_capacity':
      return t('adminEvents.staffErr.full', 'There are not enough places left for all of them.');
    case 'network':
    case 'Failed to send a request to the Edge Function':
      return t('adminEvents.staffErr.network', 'The registration service could not be reached. Check your connection; if it keeps failing, it is not installed yet.');
    default:
      return t('adminEvents.err.generic', 'Something went wrong. Try again in a moment.');
  }
}

/* ------------------------------------------------------------------ words */

/** Status words for M3 staff, in the spec's vocabulary (§2.3) seen from M3's side. */
export function statusWord(status: GuestStatus | string, t: TFunction): string {
  switch (status) {
    case 'requested': return t('adminEvents.status.requested', 'To review');
    case 'needs_info': return t('adminEvents.status.needsInfo', 'Information needed');
    case 'waitlisted': return t('adminEvents.status.waitlisted', 'Waiting list');
    case 'invited': return t('adminEvents.status.invited', 'Invited');
    case 'approved': return t('adminEvents.status.approved', 'Approved, payment due');
    case 'confirmed': return t('adminEvents.status.confirmed', 'Confirmed');
    case 'declined': return t('adminEvents.status.declined', 'They declined');
    case 'rejected': return t('adminEvents.status.rejected', 'Not accepted');
    case 'cancelled': return t('adminEvents.status.cancelled', 'Cancelled');
    default: return String(status);
  }
}

/** A history line (review_log.action) in words. */
export function historyWord(action: string, t: TFunction): string {
  switch (action) {
    case 'approve': return t('adminEvents.hist.approve', 'Confirmed by M3');
    case 'reject': return t('adminEvents.hist.reject', 'Turned down by M3');
    case 'waitlist': return t('adminEvents.hist.waitlist', 'Put on the waiting list');
    case 'request_info': return t('adminEvents.hist.requestInfo', 'M3 asked for more information');
    case 'info_provided': return t('adminEvents.hist.infoProvided', 'They answered');
    case 'attach': return t('adminEvents.hist.attach', 'Added to their account');
    case 'provisioned': return t('adminEvents.hist.provisioned', 'Account set up');
    case 'invite':
    case 'invited': return t('adminEvents.hist.invited', 'Invited by M3');
    case 'invitation_accepted': return t('adminEvents.hist.accepted', 'Accepted the invitation');
    case 'invitation_declined': return t('adminEvents.hist.declined', 'Declined the invitation');
    case 'invitation_withdrawn': return t('adminEvents.hist.withdrawn', 'Invitation withdrawn by M3');
    case 'accepted_for_them': return t('adminEvents.hist.acceptedForThem', 'Marked as accepted by M3');
    case 'status_link': return t('adminEvents.hist.statusLink', 'Personal link copied by M3');
    case 'cancelled_by_guest': return t('adminEvents.hist.cancelledByGuest', 'Cancelled by them');
    default: return action;
  }
}

export const STATUS_TONE: Record<GuestStatus,'success' | 'warning' | 'danger' | 'neutral' | 'info'> = {
  requested: 'warning',
  needs_info: 'warning',
  waitlisted: 'info',
  invited: 'info',
  approved: 'info',
  confirmed: 'success',
  declined: 'neutral',
  rejected: 'danger',
  cancelled: 'neutral',
};

export function questionKindWord(kind: QuestionKind, t: TFunction): string {
  switch (kind) {
    case 'text': return t('adminEvents.qkind.text', 'Short answer');
    case 'textarea': return t('adminEvents.qkind.textarea', 'Long answer');
    case 'select': return t('adminEvents.qkind.select', 'One choice from a list');
    case 'multiselect': return t('adminEvents.qkind.multiselect', 'Several choices from a list');
    case 'checkbox': return t('adminEvents.qkind.checkbox', 'Yes / no tick box');
    case 'url': return t('adminEvents.qkind.url', 'Web link');
    case 'phone': return t('adminEvents.qkind.phone', 'Phone number');
    case 'country': return t('adminEvents.qkind.country', 'Country');
    case 'sectors': return t('adminEvents.qkind.sectors', 'Sectors of interest');
    case 'parts': return t('adminEvents.qkind.parts', 'Parts of the event');
    case 'consent': return t('adminEvents.qkind.consent', 'Agreement to a statement');
    default: return String(kind);
  }
}

export function profileFieldWord(field: ProfileField, t: TFunction): string {
  switch (field) {
    case 'job_title': return t('adminEvents.pfield.jobTitle', 'Job title');
    case 'country': return t('adminEvents.pfield.country', 'Country');
    case 'phone': return t('adminEvents.pfield.phone', 'Phone');
    case 'linkedin_url': return t('adminEvents.pfield.linkedin', 'LinkedIn profile');
    default: return String(field);
  }
}

export function companyTypeWord(type: string, t: TFunction): string {
  switch (type) {
    case 'marina': return t('adminEvents.orgType.marina', 'Marina');
    case 'partner': return t('adminEvents.orgType.partner', 'Service provider');
    case 'investor': return t('adminEvents.orgType.investor', 'Investor');
    case 'developer': return t('adminEvents.orgType.developer', 'Developer');
    case 'media_partner': return t('adminEvents.orgType.media', 'Media');
    default: return type;
  }
}

/** gl_guest.payment_status in words (display only until December: nothing is paid on the platform yet). */
export function paymentWord(status: string | null | undefined, t: TFunction): string {
  switch (status) {
    case 'due': return t('adminEvents.pay.due', 'Payment due');
    case 'pending': return t('adminEvents.pay.pending', 'Payment pending');
    case 'invoiced': return t('adminEvents.pay.invoiced', 'Invoiced');
    case 'paid': return t('adminEvents.pay.paid', 'Paid');
    case 'waived': return t('adminEvents.pay.waived', 'Free of charge');
    case 'refunded': return t('adminEvents.pay.refunded', 'Refunded');
    default: return t('adminEvents.pay.none', 'Nothing to pay');
  }
}

/**
 * Where a confirmed on-site registration's account stands, from its job and the row's
 * account_action (provision-person writes both).
 */
export type AccountState =
  | 'none' | 'waiting' | 'failed' | 'skipped' | 'email_due' | 'email_sent' | 'created' | 'linked' | 'pending_link' | 'gave_up';

export function accountState(g: Pick<GuestRow, 'account_action'>, job: ProvisionJob | undefined): AccountState {
  if (!job) return 'none';
  if (job.status === 'queued') return 'waiting';
  if (job.status === 'failed') return 'failed';
  if (job.status === 'skipped') return 'skipped';
  if (g.account_action === 'pending_link') return 'pending_link';
  if (g.account_action === 'linked') return 'linked';
  if (job.email_sent_at) return 'email_sent';
  if (job.email_due_at) return 'email_due';
  if ((job.last_error || '').startsWith('e-mail: gave up')) return 'gave_up';
  return 'created';
}

/**
 * An account e-mail that has not left yet: "Send account e-mails now" applies (provision-person
 * send_emails). Callers also need the confirmation e-mail with the QR code to be sent
 * (confirmationMailSent): the account e-mail never goes first.
 */
export const accountSendable = (s: AccountState) => s === 'email_due' || s === 'gave_up';
/** A job waiting for its run: "Set up the accounts now" applies (provision-person run). */
export const accountRunnable = (s: AccountState) => s === 'waiting' || s === 'failed';

export function accountWord(s: AccountState, job: ProvisionJob | undefined, tz: string, t: TFunction): string {
  const day = (iso: string | null | undefined) => (iso ? formatInZone(iso, tz, false) : '');
  switch (s) {
    case 'waiting': return t('adminEvents.acct.waiting', 'Account: being set up');
    case 'failed': return t('adminEvents.acct.failed', 'Account: set-up failed');
    case 'skipped': return t('adminEvents.acct.skipped', 'Account: not needed');
    case 'pending_link': return t('adminEvents.acct.pendingLink', 'Account: waiting for them to confirm their e-mail');
    case 'linked': return t('adminEvents.acct.linked', 'Added to their existing account');
    case 'email_sent': return t('adminEvents.acct.sent', 'Account e-mail sent {{day}}', { day: day(job?.email_sent_at) });
    case 'email_due':
      return job?.email_due_at && Date.parse(job.email_due_at) > Date.now()
        ? t('adminEvents.acct.due', 'Account e-mail due {{day}}', { day: day(job.email_due_at) })
        : t('adminEvents.acct.dueNow', 'Account e-mail about to go');
    case 'gave_up': return t('adminEvents.acct.gaveUp', 'Account e-mail could not be sent');
    case 'created': return t('adminEvents.acct.created', 'Account created');
    default: return '';
  }
}

export const ACCOUNT_TONE: Record<AccountState, 'success' | 'warning' | 'danger' | 'neutral' | 'info'> = {
  none: 'neutral',
  waiting: 'info',
  failed: 'danger',
  skipped: 'neutral',
  pending_link: 'warning',
  linked: 'success',
  email_sent: 'success',
  email_due: 'info',
  gave_up: 'danger',
  created: 'success',
};

/* ------------------------------------------------------------------ helpers */

export const RESERVED_SLUGS = ['sm26', 'wys26', 'admin', 'register', 'registration', 'signup', 'events', 'join', 'welcome'];
export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** "Data standards: Part 2!" -> "data-standards-part-2" (60 characters at most). */
export function slugify(text: string, max = 60): string {
  const s = text
    .normalize('NFD').replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s.slice(0, max).replace(/-+$/g, '');
}

/** An internal key for a question: letters, digits and underscores, unique in the list. */
export function questionKey(label: string, taken: string[], fallback = 'question'): string {
  const base = slugify(label, 32).replace(/-/g, '_') || fallback;
  let key = base;
  let n = 2;
  while (taken.includes(key)) key = `${base}_${n++}`;
  return key;
}

export function isEmail(v: string): boolean {
  return /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(v.trim());
}

/** A list of addresses typed with commas, semicolons or spaces. */
export function emailList(v: string): string[] {
  return v.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
}

export function isHttpsUrl(v: string): boolean {
  return /^https:\/\/[^\s]+\.[^\s]+/i.test(v.trim());
}

/* ------------------------------------------------------------- time zones */

export const DEFAULT_TIMEZONE = 'Europe/Monaco';

export const TIMEZONE_VALUES = [
  'Europe/Monaco', 'Europe/London', 'Europe/Lisbon', 'Europe/Athens', 'Asia/Dubai', 'Asia/Singapore',
  'Australia/Sydney', 'America/New_York', 'America/Los_Angeles', 'UTC',
];

/** The time zones offered in the editor, with their city names. Any other zone shows as itself. */
export function timezoneLabel(tz: string, t: TFunction): string {
  switch (tz) {
    case 'Europe/Monaco': return t('adminEvents.tz.monaco', 'Monaco, Paris, Rome');
    case 'Europe/London': return t('adminEvents.tz.london', 'London');
    case 'Europe/Lisbon': return t('adminEvents.tz.lisbon', 'Lisbon');
    case 'Europe/Athens': return t('adminEvents.tz.athens', 'Athens');
    case 'Asia/Dubai': return t('adminEvents.tz.dubai', 'Dubai');
    case 'Asia/Singapore': return t('adminEvents.tz.singapore', 'Singapore');
    case 'Australia/Sydney': return t('adminEvents.tz.sydney', 'Sydney');
    case 'America/New_York': return t('adminEvents.tz.newYork', 'New York, Miami');
    case 'America/Los_Angeles': return t('adminEvents.tz.losAngeles', 'Los Angeles');
    case 'UTC': return t('adminEvents.tz.utc', 'UTC');
    default: return tz;
  }
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The zone's offset from UTC at a given instant, in milliseconds. */
function offsetMs(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - (at.getTime() - at.getMilliseconds());
}

/** "2026-10-23T15:00" read in `tz` -> ISO instant. Empty -> null. */
export function wallToIso(local: string, tz: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(local.trim());
  if (!m) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0);
  const zone = isValidTimeZone(tz) ? tz : DEFAULT_TIMEZONE;
  let ts = guess - offsetMs(new Date(guess), zone);
  const second = guess - offsetMs(new Date(ts), zone);
  if (second !== ts) ts = second;
  return new Date(ts).toISOString();
}

/** ISO instant -> "2026-10-23T15:00" as a clock in `tz` shows it. */
export function isoToWall(iso: string | null | undefined, tz: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const zone = isValidTimeZone(tz) ? tz : DEFAULT_TIMEZONE;
  return new Date(d.getTime() + offsetMs(d, zone)).toISOString().slice(0, 16);
}

/** "Thursday 23 October 2026, 15:00 (CEST)" in the event's zone. */
export function formatInZone(iso: string | null | undefined, tz: string, withTime = true): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const zone = isValidTimeZone(tz) ? tz : DEFAULT_TIMEZONE;
  const date = new Intl.DateTimeFormat('en-GB', { timeZone: zone, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(d);
  if (!withTime) return date;
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short' }).format(d);
  return `${date}, ${time}`;
}

/** Adds minutes to a wall-clock "YYYY-MM-DDTHH:mm" (no zone involved). */
export function addMinutesToWall(local: string, minutes: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return '';
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) + minutes * 60000);
  return d.toISOString().slice(0, 16);
}

/* ------------------------------------------------------------------ CSV */

export function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  // A cell starting with = + - @ (or a tab / carriage return, or spaces before one of
  // them) would run as a formula in Excel or LibreOffice (OWASP CSV injection).
  const safe = /^[=+\-@\t\r]/.test(s) || /^\s+[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n\r;\t]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function downloadCsv(filename: string, rows: unknown[][]): void {
  const text = String.fromCharCode(0xfeff) + rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Where a registration came from (gl_guest.source_detail), in words. */
function entryWord(entry: string, t: TFunction): string {
  switch (entry) {
    case 'signup': return t('adminEvents.entry.signup', 'Sign-up page');
    case 'event_page': return t('adminEvents.entry.eventPage', 'Event page');
    case 'deep_link': return t('adminEvents.entry.deepLink', 'Direct link');
    case 'campaign': return t('adminEvents.entry.campaign', 'E-mail campaign');
    default: return entry;
  }
}
export function sourceText(d: Record<string, unknown> | null | undefined, t: TFunction): string {
  if (!d) return '';
  const entry = typeof d.entry === 'string' ? entryWord(d.entry, t) : '';
  return [entry, d.utm_source, d.utm_campaign].filter((x) => typeof x === 'string' && x).join(' / ');
}
