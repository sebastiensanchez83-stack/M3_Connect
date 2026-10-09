import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { fetchSm26Attended, fetchSm26Team, type Sm26Team } from '@/lib/sm26Participation';

/**
 * Smart Marina 2026, for the signed-in member and the company they act for:
 * did I attend, and who of my team took part (src/lib/sm26Participation.ts).
 * Null until the server has answered (or while `enabled` is false). Keyed on
 * the ids, never on the auth objects (a tab refocus hands new ones).
 */
export interface Sm26Participation {
  attended: boolean;
  team: Sm26Team;
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
    Promise.all([fetchSm26Attended(uid), orgId ? fetchSm26Team(uid, orgId) : Promise.resolve(NO_TEAM)])
      .then(([attended, team]) => {
        if (alive) setState({ key, value: { attended, team } });
      });
    return () => { alive = false; };
  }, [enabled, uid, orgId, key]);

  return state && state.key === key ? state.value : null;
}
