import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { myOrganizationIds } from '@/components/inbox/inboxCounts';

/**
 * What is waiting in Messages, counted ONE way everywhere (the navbar's dot, the
 * dashboard's Messages tile and its to-do list):
 *
 *   - unread messages: messages from the other company in my conversations that I
 *     have not opened yet (the database's rule, msg_unread_count(), migration
 *     20261009190000_company_messaging.sql; 0 until it is applied);
 *   - requests: first messages sent to me or my company and still waiting for an
 *     answer (requests I or my company sent are not waiting for me), plus, for an
 *     organisation's owner, the people asking to join it.
 *
 * One shared store, so the navbar and the dashboard never show two numbers and
 * never run the queries twice; `refresh()` asks again (Messages calls it after a
 * conversation was read or a request answered). It also asks again when the window
 * gets the focus back (at most every 20 seconds).
 */
export interface InboxCount {
  /** Unread messages in my conversations. */
  messages: number;
  /** Received first messages still pending. */
  connections: number;
  /** Join requests waiting for the owner. */
  joins: number;
  /** connections + joins: everything waiting for an answer. */
  requests: number;
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

/** Unread messages in all my conversations (msg_unread_count); 0 when it cannot be read. */
async function unreadMessages(): Promise<number> {
  const { data, error } = await supabase.rpc('msg_unread_count');
  return error ? 0 : Number(data) || 0;
}

/** Recent enough to reuse when another screen mounts. */
const FRESH_MS = 20_000;

async function load(key: string, uid: string, orgId: string | null, isOwner: boolean, force: boolean) {
  if (!force && snapshot.key === key && snapshot.value && Date.now() - fetchedAt < FRESH_MS) return;
  if (inflight && inflight.key === key) return inflight.promise;
  const promise = (async () => {
    try {
      // Since 8 Oct 2026 a request goes to the whole receiving company: count the
      // ones addressed to me and to any organisation I belong to.
      const orgIds = await myOrganizationIds(uid);
      const audience = [`marina_user_id.eq.${uid}`, ...(orgIds.length ? [`marina_organization_id.in.(${orgIds.join(',')})`] : [])].join(',');
      let pending = supabase.from('partner_requests').select('id', { count: 'exact', head: true })
        .eq('status', 'pending').neq('partner_user_id', uid).or(audience);
      // Not the ones a colleague sent (the sending company reads its requests too).
      if (orgIds.length) pending = pending.or(`partner_organization_id.is.null,partner_organization_id.not.in.(${orgIds.join(',')})`);
      const [conn, join, unread] = await Promise.all([
        pending,
        isOwner && orgId
          ? supabase.from('organization_invitations').select('id', { count: 'exact', head: true })
            .eq('organization_id', orgId).eq('status', 'join_requested')
          : Promise.resolve({ count: 0 }),
        unreadMessages(),
      ]);
      const connections = conn.count ?? 0;
      const joins = join.count ?? 0;
      const messages = unread;
      fetchedAt = Date.now();
      // A different account (or company) may have taken over meanwhile: only the current key is kept.
      if (snapshot.key === key) {
        emit({ key, value: { messages, connections, joins, requests: connections + joins, total: messages + connections + joins } });
      }
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

  // Back on the tab: new messages may have arrived (the shared store keeps it to one read per 20 s).
  useEffect(() => {
    if (!key || !uid) return;
    const onFocus = () => { void load(key, uid, orgId, isOwner, false); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [key, uid, orgId, isOwner]);

  const refresh = useCallback(() => {
    if (key && uid) void load(key, uid, orgId, isOwner, true);
  }, [key, uid, orgId, isOwner]);

  const value = snap.key === key ? snap.value : null;
  return {
    messages: value?.messages ?? 0,
    connections: value?.connections ?? 0,
    joins: value?.joins ?? 0,
    requests: value?.requests ?? 0,
    total: value?.total ?? 0,
    loaded: !!value,
    refresh,
  };
}
