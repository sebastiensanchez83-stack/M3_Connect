import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

/**
 * People have no page of their own (Victor, Oct 2026: "no personal page at all").
 * Wherever a person is shown (a speaker, an author, an attendee, a team member) the
 * link goes to their COMPANY's page. This resolves that company.
 *
 * organization_members and organizations are readable by visitors and members alike
 * (org_members_select_public / org_select_public), so this works signed out too.
 * A person in several organisations speaks for one, picked the same way as the
 * database does for connection requests (partner_request_user_org): the one they
 * own, then the one where their role is owner, then the oldest membership.
 */
export interface PersonOrg {
  id: string;
  slug: string;
  name: string;
  logo_url: string | null;
}

interface MembershipRow {
  user_id: string;
  role: string | null;
  joined_at: string | null;
  organization: (PersonOrg & { owner_user_id: string | null }) | (PersonOrg & { owner_user_id: string | null })[] | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** userId → the company they speak for. People without one are simply absent. */
export async function fetchPeopleOrgs(userIds: (string | null | undefined)[]): Promise<Record<string, PersonOrg>> {
  const ids = [...new Set(userIds.filter((id): id is string => !!id && UUID_RE.test(id)))];
  if (ids.length === 0) return {};
  const { data, error } = await supabase
    .from('organization_members')
    .select('user_id, role, joined_at, organization:organizations(id, slug, name, logo_url, owner_user_id)')
    .in('user_id', ids);
  if (error || !data) return {};

  const best: Record<string, { org: PersonOrg; rank: [number, number, number] }> = {};
  for (const row of data as unknown as MembershipRow[]) {
    const org = Array.isArray(row.organization) ? row.organization[0] : row.organization;
    if (!org?.slug) continue;
    const joined = row.joined_at ? Date.parse(row.joined_at) : Number.MAX_SAFE_INTEGER;
    // Lower is better: owns it, then role owner, then the oldest membership.
    const rank: [number, number, number] = [
      org.owner_user_id === row.user_id ? 0 : 1,
      row.role === 'owner' ? 0 : 1,
      Number.isFinite(joined) ? joined : Number.MAX_SAFE_INTEGER,
    ];
    const current = best[row.user_id];
    const better = !current
      || rank[0] < current.rank[0]
      || (rank[0] === current.rank[0] && (rank[1] < current.rank[1] || (rank[1] === current.rank[1] && rank[2] < current.rank[2])));
    if (better) best[row.user_id] = { org: { id: org.id, slug: org.slug, name: org.name, logo_url: org.logo_url }, rank };
  }
  const out: Record<string, PersonOrg> = {};
  for (const [id, v] of Object.entries(best)) out[id] = v.org;
  return out;
}

/** The company of each person in `userIds` (best effort: {} while loading or on failure). */
export function usePeopleOrgs(userIds: (string | null | undefined)[]): Record<string, PersonOrg> {
  const key = [...new Set(userIds.filter((id): id is string => !!id))].sort().join(',');
  const [orgs, setOrgs] = useState<Record<string, PersonOrg>>({});
  useEffect(() => {
    if (!key) {
      setOrgs((cur) => (Object.keys(cur).length ? {} : cur));
      return;
    }
    let alive = true;
    fetchPeopleOrgs(key.split(','))
      .then((map) => { if (alive) setOrgs(map); })
      .catch(() => { if (alive) setOrgs({}); });
    return () => { alive = false; };
  }, [key]);
  return orgs;
}

/** The company page of a person, or null when they have no company. */
export function companyHref(org: PersonOrg | null | undefined): string | null {
  return org?.slug ? `/organizations/${org.slug}` : null;
}
