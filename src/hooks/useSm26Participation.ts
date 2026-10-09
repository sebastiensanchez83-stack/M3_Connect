import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { fetchSm26Self, fetchSm26Team, type Sm26Team } from '@/lib/sm26Participation';

/**
 * Smart Marina 2026, for the signed-in member and the company they act for:
 * did I attend, did I register my company, and who of my team took part
 * (src/lib/sm26Participation.ts). Null until the server has answered (or
 * while `enabled` is false). Keyed on the ids, never on the auth objects (a
 * tab refocus hands new ones).
 */
export interface Sm26Participation {
  /** I am listed as attending on a confirmed registration. */
  attended: boolean;
  /** I own a confirmed registration, whoever came. */
  registered: boolean;
  team: Sm26Team;
}

/**
 * What to say: 'you' (I attended), 'team' (colleagues of my company
 * attended), 'company' (I registered my company and nobody of my team is
 * listed as attending), or null (nothing to show).
 */
export function sm26Kind(p: Sm26Participation | null): 'you' | 'team' | 'company' | null {
  if (!p) return null;
  if (p.attended) return 'you';
  if (p.team.people.length > 0) return 'team';
  if (p.registered) return 'company';
  return null;
}

/**
 * How many people of my team attended: the accounts listed as attending on my
 * company's confirmed registrations, me included (the people My team marks
 * "Attended"). Guests without an account are named in My events only.
 */
export function sm26TeamWent(p: Sm26Participation | null): number {
  return p ? p.team.userIds.length : 0;
}

const NO_TEAM: Sm26Team = { people: [], userIds: [] };

export function useSm26Participation(enabled = true): Sm26Participation | null {
  const { user, organization } = useAuth();
  const uid = user?.id;
  const orgId = organization?.id ?? null;
  const key = uid ? `${uid}|${orgId ?? ''}` : null;
  const [state, setState] = useState<{ key: string; value: Sm26Participation } | null>(null);

  useEffect(() => {
    if (!enabled || !uid || !key) return;
    let alive = true;
    Promise.all([fetchSm26Self(uid), orgId ? fetchSm26Team(uid, orgId) : Promise.resolve(NO_TEAM)])
      .then(([me, team]) => {
        if (alive) setState({ key, value: { attended: me.attended, registered: me.registered, team } });
      });
    return () => { alive = false; };
  }, [enabled, uid, orgId, key]);

  return state && state.key === key ? state.value : null;
}
