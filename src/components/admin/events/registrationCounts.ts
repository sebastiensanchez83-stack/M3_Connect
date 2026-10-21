import { supabase } from '@/lib/supabase';

/**
 * Registrations of an event, counted in EVERY system that can hold them (admin inventory,
 * 21 Oct 2026: the old counts read event_registrations only, so WYS, SM26 and the events made
 * with the new editor showed 0):
 *
 *   event_registrations   the old webinar / on-site registration (payment_status pending_approval = waiting,
 *                         rejected = refused, neither is counted as registered)
 *   gl_guest              guest-list events: guest_list_v1 (WYS) and core_v2 (the new editor),
 *                         joined through gl_event.legacy_event_id
 *   sm_registration       Smart 26, joined through sm_event.legacy_event_id
 *
 * Read-only head counts (count: 'exact', head: true): no row ever reaches the browser. A count
 * that cannot be read makes the whole figure unknown (null) rather than a smaller number.
 * No default capacity: capacity is gl_event.capacity, else events.max_attendance, else none.
 */

export type RegSystem = 'event_registrations' | 'guest_list_v1' | 'core_v2' | 'sm26';

export interface EventCountInput {
  id: string;
  max_attendance?: number | null;
}

export interface EventRegistrationCount {
  /** Confirmed or approved (people for a guest list, registrations for SM26); null = could not be read. */
  registered: number | null;
  /** Requests waiting for an M3 decision. */
  waiting: number | null;
  /** Guest lists: invited, no answer yet. */
  invited: number | null;
  capacity: number | null;
  /** The systems that hold this event's registrations (for the "where it comes from" line). */
  systems: RegSystem[];
  /** Where the event's registrations are managed (the one place to act). */
  manageUrl: string;
}

export const REG_SYSTEM_LABEL: Record<RegSystem, string> = {
  event_registrations: 'event registrations (event_registrations)',
  guest_list_v1: 'guest list (gl_guest)',
  core_v2: 'registrations of the new editor (gl_guest)',
  sm26: 'SM26 registrations (sm_registration)',
};

type HeadQuery = PromiseLike<{ count: number | null; error: unknown }>;
const head = async (q: HeadQuery): Promise<number | null> => {
  const { count, error } = await q;
  return error ? null : count ?? 0;
};
const add = (a: number | null, b: number | null) => (a === null || b === null ? null : a + b);

const GL_IN = ['approved', 'confirmed'];
const GL_WAITING = ['requested', 'needs_info', 'waitlisted'];
const SM_WAITING = ['submitted', 'under_review'];

interface GlLink { id: string; slug: string; engine: string | null; capacity: number | null; legacy_event_id: string }
interface SmLink { id: string; slug: string; legacy_event_id: string }

/** One guest list (gl_event, either engine): people in, waiting for a decision, invited without an answer. */
export async function countGuestList(glEventId: string): Promise<{ registered: number | null; waiting: number | null; invited: number | null }> {
  const [registered, waiting, invited] = await Promise.all([
    head(supabase.from('gl_guest').select('id', { count: 'exact', head: true }).eq('event_id', glEventId).in('status', GL_IN)),
    head(supabase.from('gl_guest').select('id', { count: 'exact', head: true }).eq('event_id', glEventId).in('status', GL_WAITING)),
    head(supabase.from('gl_guest').select('id', { count: 'exact', head: true }).eq('event_id', glEventId).eq('status', 'invited')),
  ]);
  return { registered, waiting, invited };
}

/** One fair (sm_event): confirmed registrations and the ones waiting for a decision. */
export async function countFair(smEventId: string): Promise<{ registered: number | null; waiting: number | null }> {
  const [registered, waiting] = await Promise.all([
    head(supabase.from('sm_registration').select('id', { count: 'exact', head: true }).eq('event_id', smEventId).eq('status', 'confirmed')),
    head(supabase.from('sm_registration').select('id', { count: 'exact', head: true }).eq('event_id', smEventId).in('status', SM_WAITING)),
  ]);
  return { registered, waiting };
}

export async function loadEventRegistrationCounts(events: EventCountInput[]): Promise<Record<string, EventRegistrationCount>> {
  if (events.length === 0) return {};
  const ids = events.map(e => e.id);
  const [glRes, smRes] = await Promise.all([
    supabase.from('gl_event').select('id, slug, engine, capacity, legacy_event_id').in('legacy_event_id', ids),
    supabase.from('sm_event').select('id, slug, legacy_event_id').in('legacy_event_id', ids),
  ]);
  const gl = ((glRes.data ?? []) as GlLink[]);
  const sm = ((smRes.data ?? []) as SmLink[]);
  const linksFailed = !!glRes.error || !!smRes.error;

  const entries = await Promise.all(events.map(async (e): Promise<[string, EventRegistrationCount]> => {
    const glFor = gl.filter(g => g.legacy_event_id === e.id);
    const smFor = sm.filter(s => s.legacy_event_id === e.id);

    // Old system: registered = every registration except the ones waiting for M3 and the refused ones
    // (the same figure as the event's own page).
    const [erAll, erWaiting, erRefused] = await Promise.all([
      head(supabase.from('event_registrations').select('id', { count: 'exact', head: true }).eq('event_id', e.id)),
      head(supabase.from('event_registrations').select('id', { count: 'exact', head: true }).eq('event_id', e.id).eq('payment_status', 'pending_approval')),
      head(supabase.from('event_registrations').select('id', { count: 'exact', head: true }).eq('event_id', e.id).eq('payment_status', 'rejected')),
    ]);
    let registered = linksFailed ? null : erAll === null || erWaiting === null || erRefused === null ? null : erAll - erWaiting - erRefused;
    let waiting = linksFailed ? null : erWaiting;
    let invited: number | null = linksFailed ? null : 0;
    const systems: RegSystem[] = erAll ? ['event_registrations'] : [];

    for (const g of glFor) {
      const c = await countGuestList(g.id);
      registered = add(registered, c.registered);
      waiting = add(waiting, c.waiting);
      invited = add(invited, c.invited);
      systems.push(g.engine === 'core_v2' ? 'core_v2' : 'guest_list_v1');
    }
    for (const s of smFor) {
      const c = await countFair(s.id);
      registered = add(registered, c.registered);
      waiting = add(waiting, c.waiting);
      systems.push('sm26');
    }
    if (systems.length === 0) systems.push('event_registrations');

    const glCap = glFor.find(g => typeof g.capacity === 'number' && g.capacity > 0)?.capacity ?? null;
    const capacity = glCap ?? (typeof e.max_attendance === 'number' && e.max_attendance > 0 ? e.max_attendance : null);

    // The one place where these registrations are handled.
    const smConsole = smFor.find(s => s.slug === 'sm26');
    const guestList = glFor.find(g => g.engine !== 'core_v2');
    const manageUrl = smConsole ? '/admin/sm26' : guestList ? `/admin/guest-list/${guestList.slug}` : `/admin/events/${e.id}`;

    return [e.id, { registered, waiting, invited, capacity, systems, manageUrl }];
  }));
  return Object.fromEntries(entries);
}

/** "Counted from: SM26 registrations (sm_registration)." for a hover title. */
export function regSourceText(c: EventRegistrationCount): string {
  const parts = c.systems.map(s => REG_SYSTEM_LABEL[s]);
  return `Counted from: ${parts.join(' + ')}. Registered = confirmed or approved; waiting = requests not decided yet.${c.capacity ? ` Capacity ${c.capacity}.` : ' No capacity set.'}`;
}
