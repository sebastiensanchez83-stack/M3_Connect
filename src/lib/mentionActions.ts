import { supabase } from '@/lib/supabase';
import type { MentionOrg } from '@/lib/companyMentions';

/**
 * M3 staff's writes on company mentions (supabase/migrations/20261020141000_resource_organization_mention.sql),
 * shared by the article editor's "Companies mentioned" panel and the admin list "Company tags to
 * review". The database lets M3 staff only (is_moderator) do any of this.
 * - resource_organization_mention: a confirmed mention (linked in the article, listed under it,
 *   and the article shows under "In the news" on the company page).
 * - resource_organization_mention_skip: a suggestion answered "Not this one", never proposed again
 *   for that article.
 */

/** The companies that may be tagged: verified, not archived, not merged into another. */
export async function fetchMentionCandidates(): Promise<MentionOrg[]> {
  const { data, error } = await supabase
    .from('organizations')
    .select('id, name, slug, logo_url, organization_type')
    .eq('access_status', 'verified')
    .is('archived_at', null)
    .is('duplicate_of', null)
    .order('name')
    .limit(2000);
  if (error) throw error;
  return ((data ?? []) as MentionOrg[]).filter((o) => o.slug);
}

/** Confirm a mention. Already there counts as done. */
export async function confirmMention(resourceId: string, orgId: string): Promise<void> {
  const { error } = await supabase.from('resource_organization_mention').insert({ resource_id: resourceId, organization_id: orgId });
  if (error && error.code !== '23505') throw error;
}

/** Remove a confirmed mention. */
export async function removeMention(resourceId: string, orgId: string): Promise<void> {
  const { error } = await supabase.from('resource_organization_mention').delete().eq('resource_id', resourceId).eq('organization_id', orgId);
  if (error) throw error;
}

/** "Not this one": the suggestion is not proposed again for this article. */
export async function skipSuggestion(resourceId: string, orgId: string): Promise<void> {
  const { error } = await supabase.from('resource_organization_mention_skip').insert({ resource_id: resourceId, organization_id: orgId });
  if (error && error.code !== '23505') throw error;
}

/** Undo a "Not this one". */
export async function unskipSuggestion(resourceId: string, orgId: string): Promise<void> {
  const { error } = await supabase.from('resource_organization_mention_skip').delete().eq('resource_id', resourceId).eq('organization_id', orgId);
  if (error) throw error;
}

/** The turned-down suggestions of one article, or of every article (resourceId null). */
export async function fetchSkips(resourceId: string | null): Promise<{ resource_id: string; organization_id: string }[]> {
  let q = supabase.from('resource_organization_mention_skip').select('resource_id, organization_id');
  if (resourceId) q = q.eq('resource_id', resourceId);
  const { data, error } = await q.limit(5000);
  if (error) throw error;
  return (data ?? []) as { resource_id: string; organization_id: string }[];
}
