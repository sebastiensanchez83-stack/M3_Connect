import { supabase } from '@/lib/supabase';

/**
 * What the inbox counts as "waiting for you" (Oct 2026). One rule, so the inbox's
 * own filters and anything else that shows an inbox badge can agree:
 *
 *   - connection requests RECEIVED (sent by someone else) that are still pending,
 *     addressed to me (marina_user_id) or to any organisation I belong to
 *     (marina_organization_id): since 8 Oct 2026 a request goes to the whole
 *     company and any member answers it;
 *   - join requests waiting in the organisation I own (owners decide them).
 *
 * Requests I SENT are never counted: there is nothing for me to do on them. The
 * account menu used to count every pending row, sent ones included (3 against the
 * inbox's 2 in Victor's audit). There is no "unread" state on these rows: once a
 * request is answered it leaves the count.
 */
export interface InboxCountable {
  kind: 'partner_request' | 'reference_request' | 'join_request' | 'team_invitation';
  direction?: 'received' | 'sent';
  status?: string;
}

/** True for an item that waits for my answer. */
export function needsAction(item: InboxCountable): boolean {
  if (item.kind === 'join_request') return true;
  return item.kind === 'partner_request' && item.direction === 'received' && item.status === 'pending';
}

/** The organisations a user belongs to (any role). */
export async function myOrganizationIds(userId: string): Promise<string[]> {
  const { data } = await supabase.from('organization_members').select('organization_id').eq('user_id', userId);
  return [...new Set(((data ?? []) as { organization_id: string }[]).map((r) => r.organization_id).filter(Boolean))];
}

/**
 * The same count straight from the database, for a badge outside the inbox.
 * `joinRequestOrgId`: the organisation whose join requests this user decides (the
 * one they own), or null.
 */
export async function fetchInboxActionCount(userId: string, joinRequestOrgId: string | null): Promise<number> {
  const orgIds = await myOrganizationIds(userId);
  const audience = [`marina_user_id.eq.${userId}`, ...(orgIds.length ? [`marina_organization_id.in.(${orgIds.join(',')})`] : [])].join(',');
  const [requests, joins] = await Promise.all([
    supabase
      .from('partner_requests')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
      .neq('partner_user_id', userId)
      .or(audience),
    joinRequestOrgId
      ? supabase
        .from('organization_invitations')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', joinRequestOrgId)
        .eq('status', 'join_requested')
      : Promise.resolve({ count: 0 }),
  ]);
  return (requests.count ?? 0) + (joins.count ?? 0);
}
