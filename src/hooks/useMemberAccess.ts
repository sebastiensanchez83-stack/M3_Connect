import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { fetchSm26Attended } from '@/lib/sm26Participation';

/**
 * The parts of the member area whose visibility the server decides, asked once
 * per account and shared (the home dashboard and the navbar's mobile menu):
 *
 *  - sm26: this member took part in the Monaco Smart & Sustainable Marina
 *    Rendezvous 2026: an attendee (attending) of a confirmed registration, most
 *    often their company's, or the owner of one (src/lib/sm26Participation.ts;
 *    before 9 Oct 2026 only owners counted, and most participants are not). The
 *    event is over: the dashboard only marks it, read-only;
 *  - media: the press room is open to them (is_media_user(), the rule the data uses);
 *  - sponsorIds: the sponsors this account is linked to (sp_sponsor_user), for the sponsor portal;
 *  - manager: M3 staff or Yacht Club de Monaco, who run the sponsorship hub (/sponsorship).
 *
 * Each query fails on its own into "no".
 */
export interface MemberAccess {
  sm26: boolean;
  media: boolean;
  sponsorIds: string[];
  manager: boolean;
}

const cache = new Map<string, Promise<MemberAccess>>();

function fetchAccess(uid: string): Promise<MemberAccess> {
  const known = cache.get(uid);
  if (known) return known;
  const media = (async () => {
    try {
      const { data } = await supabase.rpc('is_media_user');
      return data === true;
    } catch {
      return false;
    }
  })();
  const sponsorIds = (async () => {
    try {
      const { data } = await supabase.from('sp_sponsor_user').select('sponsor_id').eq('user_id', uid);
      return ((data ?? []) as { sponsor_id: string }[]).map((r) => r.sponsor_id);
    } catch {
      return [] as string[];
    }
  })();
  const manager = (async () => {
    try {
      const { data } = await supabase.rpc('is_sponsorship_manager');
      return data === true;
    } catch {
      return false;
    }
  })();
  const promise = Promise.all([fetchSm26Attended(uid), media, sponsorIds, manager])
    .then(([sm26, m, s, g]) => ({ sm26, media: m, sponsorIds: s, manager: g }));
  cache.set(uid, promise);
  return promise;
}

/** Null until the server has answered (or while `enabled` is false). */
export function useMemberAccess(enabled = true): MemberAccess | null {
  const { user } = useAuth();
  const uid = user?.id;
  const [state, setState] = useState<{ uid: string; access: MemberAccess } | null>(null);

  useEffect(() => {
    if (!uid || !enabled) return;
    let alive = true;
    fetchAccess(uid).then((access) => {
      if (alive) setState((prev) => (prev && prev.uid === uid && prev.access === access ? prev : { uid, access }));
    });
    return () => { alive = false; };
  }, [uid, enabled]);

  return state && state.uid === uid ? state.access : null;
}
