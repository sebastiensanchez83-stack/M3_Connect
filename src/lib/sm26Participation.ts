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
 *    registration. Owning the registration is not enough: 11 owners are
 *    marked attending = false on their own registration;
 *  - my company took part = I own a confirmed registration (whoever came);
 *  - my team took part = the attendees (attending) of the confirmed
 *    registrations of my organisation, with their names; their accounts mark
 *    them in My team.
 *
 * Reads go through RLS (sm_can_access_registration: the owner, a member of the
 * registration's organisation, staff). An attendee registered by a company
 * they are not a member of cannot read their own row that way: when the plain
 * reads find nothing, the answer comes from sm_my_sm26_participation(), a
 * yes / no for the caller only (migration 20261009120000). Until it is applied
 * that call fails (404) and the answer stays "no"; the failure is remembered
 * for the browser tab so it is not asked again on every page.
 *
 * One request per account (and per company for the team), shared by the
 * dashboard and the welcome badge. A failed read is not remembered: the next
 * screen asks again.
 */

export interface Sm26Teammate {
  /** The attendee's account, when they have one. */
  userId: string | null;
  name: string;
}

export interface Sm26Team {
  /** The attendees of my company's confirmed registrations, me excluded. */
  people: Sm26Teammate[];
  /** Every attendee account of those registrations, me included (the "Attended" chips). */
  userIds: string[];
}

export interface Sm26Self {
  /** I am listed as attending on a confirmed registration. */
  attended: boolean;
  /** I own a confirmed registration (my company took part, whoever came). */
  registered: boolean;
}

const NO: Sm26Self = { attended: false, registered: false };

let eventPromise: Promise<string | null> | null = null;

/** The SM26 event's id, asked once; null when there is no such event. Throws on a failed read. */
function sm26EventId(): Promise<string | null> {
  if (!eventPromise) {
    const p = (async () => {
      const { data, error } = await supabase.from('sm_event').select('id').eq('slug', 'sm26').maybeSingle();
      if (error) throw error;
      return (data as { id: string } | null)?.id ?? null;
    })();
    eventPromise = p;
    // A failed lookup is asked again next time.
    p.catch(() => { if (eventPromise === p) eventPromise = null; });
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

/** Remembered for the tab: the yes / no function is not on the server yet (migration not applied). */
const RPC_MISSING_KEY = 'smc.sm26rpc.missing';

function rpcKnownMissing(): boolean {
  try { return sessionStorage.getItem(RPC_MISSING_KEY) === '1'; } catch { return false; }
}

function rememberRpcMissing() {
  try { sessionStorage.setItem(RPC_MISSING_KEY, '1'); } catch { /* private mode: asked again next time */ }
}

async function self(uid: string): Promise<Sm26Self> {
  const eventId = await sm26EventId();
  if (!eventId) return NO;
  await autoclaim(uid);

  // My company's registrations I own, and my own attendee rows.
  const [own, mine] = await Promise.all([
    supabase.from('sm_registration').select('id')
      .eq('event_id', eventId).eq('user_id', uid).eq('status', 'confirmed').limit(1),
    supabase.from('sm_attendee').select('registration_id')
      .eq('event_id', eventId).eq('user_id', uid).eq('attending', true),
  ]);
  if (own.error) throw own.error;
  if (mine.error) throw mine.error;
  const registered = (own.data ?? []).length > 0;

  // 1. I am an attendee (attending) of a registration that is confirmed.
  const regIds = [...new Set(((mine.data ?? []) as { registration_id: string }[]).map((a) => a.registration_id))];
  if (regIds.length > 0) {
    const regs = await supabase.from('sm_registration').select('id')
      .in('id', regIds).eq('status', 'confirmed').limit(1);
    if (regs.error) throw regs.error;
    if ((regs.data ?? []).length > 0) return { attended: true, registered };
  }

  // 2. Rows RLS does not show me (a company I am not a member of registered me).
  if (rpcKnownMissing()) return { attended: false, registered };
  const rpc = await supabase.rpc('sm_my_sm26_participation');
  if (rpc.error) {
    // PGRST202: the function does not exist (yet). Anything else is a passing failure.
    if (rpc.error.code === 'PGRST202' || rpc.status === 404) {
      rememberRpcMissing();
      return { attended: false, registered };
    }
    throw rpc.error;
  }
  return { attended: rpc.data === true, registered };
}

const selfCache = new Map<string, Promise<Sm26Self>>();

/** Did this account attend SM26, or register its company? Asked once per account; a failure reads "no" and is asked again later. */
export function fetchSm26Self(uid: string): Promise<Sm26Self> {
  let p = selfCache.get(uid);
  if (!p) {
    p = self(uid).catch(() => {
      selfCache.delete(uid);
      return NO;
    });
    selfCache.set(uid, p);
  }
  return p;
}

const NO_TEAM: Sm26Team = { people: [], userIds: [] };

async function team(uid: string, orgId: string): Promise<Sm26Team> {
  const eventId = await sm26EventId();
  if (!eventId) return NO_TEAM;
  await autoclaim(uid);
  const regs = await supabase.from('sm_registration').select('id')
    .eq('event_id', eventId).eq('organization_id', orgId).eq('status', 'confirmed');
  if (regs.error) throw regs.error;
  const regIds = ((regs.data ?? []) as { id: string }[]).map((r) => r.id);
  if (regIds.length === 0) return NO_TEAM;
  const { data, error } = await supabase.from('sm_attendee')
    .select('user_id, first_name, last_name, is_primary, created_at')
    .in('registration_id', regIds).eq('attending', true)
    .order('is_primary', { ascending: false }).order('created_at', { ascending: true });
  if (error) throw error;
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

/** Who of my company took part (me excluded), for one company. Asked once per account and company; a failure is asked again later. */
export function fetchSm26Team(uid: string, orgId: string): Promise<Sm26Team> {
  const key = `${uid}|${orgId}`;
  let p = teamCache.get(key);
  if (!p) {
    p = team(uid, orgId).catch(() => {
      teamCache.delete(key);
      return NO_TEAM;
    });
    teamCache.set(key, p);
  }
  return p;
}
