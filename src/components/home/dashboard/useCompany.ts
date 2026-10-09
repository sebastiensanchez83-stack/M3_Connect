import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
  fetchOrgInvitations, fetchOrgMembers, orgSectorTable, type TeamMember,
} from '@/components/organization/orgActions';
import type { Organization, OrganizationInvitation } from '@/types/database';

/**
 * What the My company and My team panels show, read fresh when they open and
 * again after each change (`reloadKey`). Keyed on ids, never on the auth
 * objects (a tab refocus hands new ones); only the first load shows a
 * skeleton, later ones swap in place.
 */

// Explicit columns, never '*': claim_code is not readable by signed-in users
// (audit S2), and select=* on organizations then fails as a whole.
const ORG_COLUMNS = 'id, name, slug, primary_domain, organization_type, tier, max_seats, created_by_user_id, owner_user_id, logo_url, description, website, country, city, created_at, updated_at, access_status, onboarding_status, rejection_reason, audience_description, headquarters_country, social_media_links, marina_subtype, auto_approve_domain_joins, banner_url, investment_geographies, investment_size_min, investment_size_max, investment_hold_period, investment_thesis, featured_partner, gallery, is_event_media_partner';

export interface CompanyDetails {
  org: Organization;
  /** The company's sectors, by name (interests for a marina, services otherwise). */
  sectors: string[];
  documents: number;
}

export function useCompanyDetails(orgId: string | null, orgType: string | null, reloadKey: number | string): {
  data: CompanyDetails | null;
  loading: boolean;
  /** Updates the shown copy at once (the reload that follows confirms it). */
  patch: (fields: Partial<Organization>) => void;
} {
  const [data, setData] = useState<CompanyDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const loadedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!orgId) { setData(null); setLoading(false); return; }
    let alive = true;
    if (loadedFor.current !== orgId) setLoading(true);
    (async () => {
      const table = orgSectorTable(orgType);
      const [orgRes, mine, docs] = await Promise.all([
        supabase.from('organizations').select(ORG_COLUMNS).eq('id', orgId).maybeSingle(),
        supabase.from(table).select('sector_id').eq('organization_id', orgId),
        supabase.from('organization_documents').select('id', { count: 'exact', head: true }).eq('organization_id', orgId),
      ]);
      const ids = ((mine.data ?? []) as { sector_id: string }[]).map((r) => r.sector_id);
      const labels = ids.length
        ? (((await supabase.from('sectors').select('id, label').in('id', ids)).data ?? []) as { id: string; label: string }[])
          .map((s) => s.label).sort((a, b) => a.localeCompare(b))
        : [];
      if (!alive) return;
      if (orgRes.data) {
        setData({ org: orgRes.data as unknown as Organization, sectors: labels, documents: docs.count ?? 0 });
        loadedFor.current = orgId;
      }
      setLoading(false);
    })().catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [orgId, orgType, reloadKey]);

  const patch = (fields: Partial<Organization>) => setData((d) => (d ? { ...d, org: { ...d.org, ...fields } } : d));
  return { data: data && data.org.id === orgId ? data : null, loading, patch };
}

export interface TeamData {
  members: TeamMember[];
  /** Open invitations, join requests and accepted invitations (the full editor's list). */
  invitations: OrganizationInvitation[];
}

export function useTeam(orgId: string | null, reloadKey: number | string): { data: TeamData | null; loading: boolean } {
  const [data, setData] = useState<{ orgId: string; value: TeamData } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orgId) { setData(null); setLoading(false); return; }
    let alive = true;
    (async () => {
      const [members, invitations] = await Promise.all([fetchOrgMembers(orgId), fetchOrgInvitations(orgId)]);
      if (!alive) return;
      setData({ orgId, value: { members, invitations } });
      setLoading(false);
    })().catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [orgId, reloadKey]);

  return { data: data && data.orgId === orgId ? data.value : null, loading };
}
