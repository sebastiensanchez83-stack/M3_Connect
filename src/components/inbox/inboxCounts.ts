import { supabase } from '@/lib/supabase';

/**
 * Shared by Messages (src/components/messages) and the count of what waits in it
 * (src/hooks/useInboxCount.ts, the one rule for the navbar dot and the dashboard
 * tile: unread messages + requests waiting for an answer).
 */

/** The organisations a user belongs to (any role). */
export async function myOrganizationIds(userId: string): Promise<string[]> {
  const { data } = await supabase.from('organization_members').select('organization_id').eq('user_id', userId);
  return [...new Set(((data ?? []) as { organization_id: string }[]).map((r) => r.organization_id).filter(Boolean))];
}
