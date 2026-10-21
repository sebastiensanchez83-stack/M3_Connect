import { supabase } from '@/lib/supabase';

/**
 * Read-only figures of the events whose actions live elsewhere: a FAIR (sm_event, its frozen
 * console) and an OLD-system event (event_registrations, the old editor). Staff SELECTs only;
 * nothing writes, no name or e-mail is read except the old-system registrations list (the
 * same columns the old editor already shows). One table that cannot be read does not stop the
 * page: its figure shows a dash and `failed` names it.
 */

type Res<T> = { data: T[] | null; error: { message: string } | null };

async function readAll<T>(make: (from: number, to: number) => PromiseLike<Res<T>>, max = 20000): Promise<T[]> {
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

async function settle<T>(name: string, p: Promise<T>, failed: string[]): Promise<T | null> {
  try { return await p; } catch { failed.push(name); return null; }
}

export interface CatalogueLite {
  id: string; title: string | null; description: string | null; event_type: string | null; date_time: string | null;
  end_date_time: string | null; is_full_day: boolean | null; location: string | null; published: boolean | null;
  slug?: string | null; max_attendance: number | null; invitation_only: boolean | null; fees: string | null;
  access_level: string | null; language: string | null; meeting_url?: string | null; replay_url?: string | null;
}

/* ------------------------------------------------------------------ fair */

export interface FairEvent {
  id: string; slug: string; name: string | null; start_date: string | null; end_date: string | null; venue: string | null;
  timezone: string | null; status: string | null; legacy_event_id: string | null; settings: Record<string, unknown> | null;
}

export interface FairReg { status: string; created_at: string; country: string | null; source: string | null }

export interface FairFacts {
  event: FairEvent;
  catalogue: CatalogueLite | null;
  regs: FairReg[] | null;
  attendees: { attending: boolean | null }[] | null;
  checkins: { registration_id: string | null; attendee_id: string | null; window_key: string | null }[] | null;
  windows: { key: string; label: string | null; sort: number | null }[] | null;
  payments: { status: string; amount_cents: number | null; currency: string | null }[] | null;
  mails: { kind: string; sent_at: string }[] | null;
  roles: { role: string; status: string | null }[] | null;
  invitations: { status: string | null; rsvp_status: string | null }[] | null;
  failed: string[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The fair by its slug (or its id); null when there is none. Throws when the fair itself cannot be read. */
export async function loadFairFacts(slugOrId: string): Promise<FairFacts | null> {
  const q = supabase.from('sm_event').select('id, slug, name, start_date, end_date, venue, timezone, status, legacy_event_id, settings');
  const { data, error } = await (UUID.test(slugOrId) ? q.eq('id', slugOrId) : q.eq('slug', slugOrId)).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const event = data as FairEvent;
  const id = event.id;
  const failed: string[] = [];
  const [catalogue, regs, attendees, checkins, windows, payments, mails, roles, invitations] = await Promise.all([
    event.legacy_event_id
      ? settle('the public event page', (async () => {
        const r = await supabase.from('events').select('*').eq('id', event.legacy_event_id as string).maybeSingle();
        if (r.error) throw new Error(r.error.message);
        return (r.data as CatalogueLite | null) ?? null;
      })(), failed)
      : Promise.resolve(null),
    settle('registrations', readAll((f, t) => supabase.from('sm_registration').select('status, created_at, country, source').eq('event_id', id).order('created_at').range(f, t) as unknown as PromiseLike<Res<FairReg>>), failed),
    settle('attendees', readAll((f, t) => supabase.from('sm_attendee').select('attending').eq('event_id', id).order('id').range(f, t) as unknown as PromiseLike<Res<{ attending: boolean | null }>>), failed),
    settle('check-ins', readAll((f, t) => supabase.from('sm_checkin').select('registration_id, attendee_id, window_key').eq('event_id', id).order('id').range(f, t) as unknown as PromiseLike<Res<{ registration_id: string | null; attendee_id: string | null; window_key: string | null }>>), failed),
    settle('check-in times', readAll((f, t) => supabase.from('sm_attendance_window').select('key, label, sort').eq('event_id', id).order('sort').range(f, t) as unknown as PromiseLike<Res<{ key: string; label: string | null; sort: number | null }>>), failed),
    settle('payments', readAll((f, t) => supabase.from('sm_payment').select('status, amount_cents, currency').eq('event_id', id).order('id').range(f, t) as unknown as PromiseLike<Res<{ status: string; amount_cents: number | null; currency: string | null }>>), failed),
    settle('e-mails', readAll((f, t) => supabase.from('sm_email_log').select('kind, sent_at').eq('event_id', id).order('sent_at', { ascending: false }).range(f, t) as unknown as PromiseLike<Res<{ kind: string; sent_at: string }>>), failed),
    settle('roles', readAll((f, t) => supabase.from('sm_role_assignment').select('role, status').eq('event_id', id).order('id').range(f, t) as unknown as PromiseLike<Res<{ role: string; status: string | null }>>), failed),
    settle('invitations', readAll((f, t) => supabase.from('sm_invitation').select('status, rsvp_status').eq('event_id', id).order('id').range(f, t) as unknown as PromiseLike<Res<{ status: string | null; rsvp_status: string | null }>>), failed),
  ]);
  return { event, catalogue: catalogue ?? null, regs, attendees, checkins, windows, payments, mails, roles, invitations, failed };
}

export const FAIR_STATUS_WORD: Record<string, string> = {
  submitted: 'Submitted, to review',
  under_review: 'Under review',
  confirmed: 'Confirmed',
  waitlist: 'Waiting list',
  declined: 'Not accepted',
  cancelled: 'Cancelled',
};
export const FAIR_WAITING = ['submitted', 'under_review'];

export const FAIR_PAYMENT_WORD: Record<string, string> = {
  pending: 'Payment pending',
  due: 'Payment due',
  invoiced: 'Invoiced, not paid yet',
  paid: 'Paid',
  waived: 'Free of charge',
  refunded: 'Refunded',
  cancelled: 'Cancelled',
};

export const RSVP_WORD: Record<string, string> = {
  awaiting: 'Awaiting a reply',
  accepted: 'Accepted',
  declined: 'Declined',
  tentative: 'Tentative',
  no_reply: 'No reply',
};

/* ------------------------------------------------------------------ old system */

export interface LegacyRegistration {
  id: string;
  user_id: string | null;
  registration_type: string | null;
  payment_status: string | null;
  amount_due_cents: number | null;
  created_at: string;
  reminder_sent_at: string | null;
  guest_email: string | null;
  guest_first_name: string | null;
  guest_last_name: string | null;
  guest_company: string | null;
  /** Filled from profiles / organization_members, as the old editor does. */
  name: string;
  email: string;
  company: string | null;
}

export interface LegacyFacts {
  catalogue: CatalogueLite;
  regs: LegacyRegistration[] | null;
  failed: string[];
}

/** An old-system event (events row without gl_event / sm_event) and its registrations. Null when the id is unknown. */
export async function loadLegacyFacts(id: string): Promise<LegacyFacts | null> {
  const { data, error } = await supabase.from('events').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const failed: string[] = [];
  const regs = await settle('registrations', (async () => {
    const { data: rows, error: e } = await supabase
      .from('event_registrations')
      .select('id, user_id, registration_type, payment_status, amount_due_cents, created_at, reminder_sent_at, guest_email, guest_first_name, guest_last_name, guest_company')
      .eq('event_id', id)
      .order('created_at', { ascending: false });
    if (e) throw new Error(e.message);
    const list = (rows ?? []) as Omit<LegacyRegistration, 'name' | 'email' | 'company'>[];
    const userIds = [...new Set(list.map(r => r.user_id).filter((x): x is string => !!x))];
    const [profiles, members] = userIds.length
      ? await Promise.all([
        supabase.from('profiles').select('user_id, first_name, last_name, email').in('user_id', userIds),
        supabase.from('organization_members').select('user_id, organizations(name)').in('user_id', userIds),
      ])
      : [{ data: [] }, { data: [] }];
    const pMap = new Map(((profiles.data ?? []) as { user_id: string; first_name: string | null; last_name: string | null; email: string | null }[]).map(p => [p.user_id, p]));
    const oMap = new Map(((members.data ?? []) as unknown as { user_id: string; organizations: { name: string | null } | null }[]).map(m => [m.user_id, m.organizations?.name ?? null]));
    return list.map(r => {
      const p = r.user_id ? pMap.get(r.user_id) : undefined;
      const guestName = `${r.guest_first_name ?? ''} ${r.guest_last_name ?? ''}`.trim();
      return {
        ...r,
        name: (p ? `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() : '') || guestName || p?.email || r.guest_email || 'Unknown person',
        email: p?.email ?? r.guest_email ?? '',
        company: (r.user_id ? oMap.get(r.user_id) : null) ?? r.guest_company ?? null,
      };
    });
  })(), failed);
  return { catalogue: data as CatalogueLite, regs, failed };
}

export const LEGACY_PAYMENT_WORD: Record<string, string> = {
  pending_approval: 'Waiting for M3',
  pending_payment: 'Payment due',
  paid: 'Paid',
  free: 'Free',
  rejected: 'Refused',
};
