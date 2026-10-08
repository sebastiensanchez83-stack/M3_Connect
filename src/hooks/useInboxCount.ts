import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';

/**
 * What is waiting in the inbox, counted ONE way everywhere (the navbar's dot,
 * the dashboard's inbox card and its to-do list): connection requests received
 * and still pending, plus, for an organisation's owner, the people asking to
 * join it. It is the rule of the inbox's own "All" badge (InboxTab): requests I
 * sent are not waiting for me. There is no read / unread state in the data, so
 * "unread" is this "waiting for an answer".
 *
 * Before, the account menu counted every pending request, sent ones included,
 * and disagreed with the dashboard (3 against 2).
 *
 * One shared store, so the navbar and the dashboard never show two numbers and
 * never run the queries twice; `refresh()` asks again (the dashboard calls it
 * when the inbox block closes, after answers were given in it).
 */
export interface InboxCount {
  /** Received connection requests still pending. */
  connections: number;
  /** Join requests waiting for the owner. */
  joins: number;
  total: number;
}

interface Snapshot {
  key: string | null;
  value: InboxCount | null;
}

let snapshot: Snapshot = { key: null, value: null };
let inflight: { key: string; promise: Promise<void> } | null = null;
let fetchedAt = 0;
const listeners = new Set<() => void>();

function emit(next: Snapshot) {
  snapshot = next;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Recent enough to reuse when another screen mounts. */
const FRESH_MS = 20_000;

async function load(key: string, uid: string, orgId: string | null, isOwner: boolean, force: boolean) {
  if (!force && snapshot.key === key && snapshot.value && Date.now() - fetchedAt < FRESH_MS) return;
  if (inflight && inflight.key === key) return inflight.promise;
  const promise = (async () => {
    try {
      const [conn, join] = await Promise.all([
        supabase.from('partner_requests').select('id', { count: 'exact', head: true })
          .eq('marina_user_id', uid).neq('partner_user_id', uid).eq('status', 'pending'),
        isOwner && orgId
          ? supabase.from('organization_invitations').select('id', { count: 'exact', head: true })
            .eq('organization_id', orgId).eq('status', 'join_requested')
          : Promise.resolve({ count: 0 }),
      ]);
      const connections = conn.count ?? 0;
      const joins = join.count ?? 0;
      fetchedAt = Date.now();
      // A different account (or company) may have taken over meanwhile: only the current key is kept.
      if (snapshot.key === key) emit({ key, value: { connections, joins, total: connections + joins } });
    } catch {
      /* the count is a hint: it stays as it was */
    } finally {
      if (inflight?.key === key) inflight = null;
    }
  })();
  inflight = { key, promise };
  return promise;
}

export function useInboxCount(enabled = true): InboxCount & { loaded: boolean; refresh: () => void } {
  const { user, organization, orgRole } = useAuth();
  const uid = enabled ? user?.id ?? null : null;
  const orgId = organization?.id ?? null;
  const isOwner = orgRole === 'owner';
  const key = uid ? `${uid}|${orgId ?? ''}|${isOwner ? 1 : 0}` : null;

  const snap = useSyncExternalStore(subscribe, () => snapshot, () => snapshot);

  useEffect(() => {
    if (!key || !uid) return;
    if (snapshot.key !== key) emit({ key, value: null });
    void load(key, uid, orgId, isOwner, false);
  }, [key, uid, orgId, isOwner]);

  const refresh = useCallback(() => {
    if (key && uid) void load(key, uid, orgId, isOwner, true);
  }, [key, uid, orgId, isOwner]);

  const value = snap.key === key ? snap.value : null;
  return {
    connections: value?.connections ?? 0,
    joins: value?.joins ?? 0,
    total: value?.total ?? 0,
    loaded: !!value,
    refresh,
  };
}
