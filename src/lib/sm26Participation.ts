import { supabase } from '@/lib/supabase';
import { displayCase } from '@/lib/displayCase';

/**
 * Who took part in the Monaco Smart & Sustainable Marina Rendezvous 2026
 * (sm_event slug 'sm26'), as the member dashboard shows it, read-only.
 *
 * Until 9 Oct 2026 the dashboard only asked "does this account OWN a confirmed
 * registration?". Most participants do not: a company registers once and lists
 * its people as attendees (sm_attendee, linked to their account by user_id).
 * Victor is one of seven attendees on M3 Monaco's registration, owned by a
 * colleague, and his dashboard said nothing. Now:
 *
 *  - I attended = I am an attendee with `attending` true (NOT NULL, default
 *    true; false marks someone replaced or who did not come) on a CONFIRMED
 *    registration, or I own a confirmed registration;
 *  - my team took part = the attendees (attending) of the confirmed
 *    registrations of my organisation, with their names; their accounts mark
 *    them in My team.
 *
 * Reads go through RLS (sm_can_access_registration: the owner, a member of the
 * registration's organisation, staff). An attendee registered by a company
 * they are not a member of cannot read their own row that way: when the plain
 * reads find nothing, the answer comes from sm_my_sm26_participation(), a
 * yes / no for the caller only (migration 20261009120000; until it is applied
 * that call fails and the answer stays "no").
 *
 * One request per account (and per company for the team), shared by the
 * dashboard, the welcome badge and the navbar's menu.
 */

export interface Sm26Teammate {
  /** The attendee's account, when they have one. */
  userId: string | null;
  name: string;
}

export interface Sm26Team {
  /** The attendees of my company's confirmed registrations, me excluded. */
  people: Sm26Teammate[];
  /** Every attendee account of those registrations, me included (the "Attended SM26" chips). */
  userIds: string[];
}

let eventPromise: Promise<string | null> | null = null;

/** The SM26 event's id, asked once. */
function sm26EventId(): Promise<string | null> {
  if (!eventPromise) {
    eventPromise = (async () => {
      try {
        const { data } = await supabase.from('sm_event').select('id').eq('slug', 'sm26').maybeSingle();
        return (data as { id: string } | null)?.id ?? null;
      } catch {
        return null;
      }
    })();
    // A failed lookup is asked again next time.
    eventPromise.then((id) => { if (!id) eventPromise = null; });
  }
  return eventPromise;
}

const claimed = new Map<string, Promise<void>>();

/**
 * A registration imported under this member's e-mail and never claimed is
 * linked to the account first (best effort, once per account), as the old
 * participation card did.
 */
function autoclaim(uid: string): Promise<void> {
  let p = claimed.get(uid);
  if (!p) {
    p = (async () => {
      try { await supabase.rpc('sm_autoclaim_by_email'); } catch { /* best effort */ }
    })();
    claimed.set(uid, p);
  }
  return p;
}

async function attended(uid: string): Promise<boolean> {
  const eventId = await sm26EventId();
  if (!eventId) return false;
  await autoclaim(uid);

  // 1. I own a confirmed registration.
  const own = await supabase.from('sm_registration').select('id')
    .eq('event_id', eventId).eq('user_id', uid).eq('status', 'confirmed').limit(1);
  if (own.data && own.data.length > 0) return true;

  // 2. I am an attendee (attending) of a registration that is confirmed.
  const mine = await supabase.from('sm_attendee').select('registration_id')
    .eq('event_id', eventId).eq('user_id', uid).eq('attending', true);
  const regIds = [...new Set(((mine.data ?? []) as { registration_id: string }[]).map((a) => a.registration_id))];
  if (regIds.length > 0) {
    const regs = await supabase.from('sm_registration').select('id')
      .in('id', regIds).eq('status', 'confirmed').limit(1);
    if (regs.data && regs.data.length > 0) return true;
  }

  // 3. Rows RLS does not show me (a company I am not a member of registered me).
  const rpc = await supabase.rpc('sm_my_sm26_participation');
  return !rpc.error && rpc.data === true;
}

const attendedCache = new Map<string, Promise<boolean>>();

/** Did this account attend SM26? Asked once per account; any failure reads "no". */
export function fetchSm26Attended(uid: string): Promise<boolean> {
  let p = attendedCache.get(uid);
  if (!p) {
    p = attended(uid).catch(() => false);
    attendedCache.set(uid, p);
  }
  return p;
}

async function team(uid: string, orgId: string): Promise<Sm26Team> {
  const eventId = await sm26EventId();
  if (!eventId) return { people: [], userIds: [] };
  await autoclaim(uid);
  const regs = await supabase.from('sm_registration').select('id')
    .eq('event_id', eventId).eq('organization_id', orgId).eq('status', 'confirmed');
  const regIds = ((regs.data ?? []) as { id: string }[]).map((r) => r.id);
  if (regIds.length === 0) return { people: [], userIds: [] };
  const { data } = await supabase.from('sm_attendee')
    .select('user_id, first_name, last_name, is_primary, created_at')
    .in('registration_id', regIds).eq('attending', true)
    .order('is_primary', { ascending: false }).order('created_at', { ascending: true });
  type Row = { user_id: string | null; first_name: string | null; last_name: string | null };
  const rows = (data ?? []) as Row[];
  const userIds = [...new Set(rows.map((r) => r.user_id).filter((x): x is string => !!x))];
  // One line per person (a colleague listed twice across registrations shows once).
  const seen = new Set<string>();
  const people: Sm26Teammate[] = [];
  for (const r of rows) {
    if (r.user_id === uid) continue;
    const name = displayCase([r.first_name, r.last_name].filter(Boolean).join(' ').trim());
    if (!name) continue;
    const key = r.user_id ?? `name:${name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    people.push({ userId: r.user_id, name });
  }
  return { people, userIds };
}

const teamCache = new Map<string, Promise<Sm26Team>>();

/** Who of my company took part (me excluded), for one company. Asked once per account and company. */
export function fetchSm26Team(uid: string, orgId: string): Promise<Sm26Team> {
  const key = `${uid}|${orgId}`;
  let p = teamCache.get(key);
  if (!p) {
    p = team(uid, orgId).catch(() => ({ people: [], userIds: [] }));
    teamCache.set(key, p);
  }
  return p;
}
