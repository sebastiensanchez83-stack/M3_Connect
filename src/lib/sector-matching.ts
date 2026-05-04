/**
 * Sector matching helpers — used to gate B2B connection requests.
 *
 * Rule:
 *   A marina's "interest sectors" must overlap with a partner's "service
 *   sectors" (or vice-versa) for a connection request to make sense.
 *   If there is zero overlap, the request is blocked client-side with a
 *   helpful error message.
 *
 *   Marina ↔ Marina and Partner ↔ Partner connections are allowed unconditionally
 *   (no sector check) since both sides use the same kind of sector list.
 */
import { supabase } from '@/lib/supabase';

export type OrgType = 'marina' | 'partner' | 'media_partner' | string | null;

interface OrgSectorInfo {
  organizationType: OrgType;
  sectorIds: Set<string>;
}

/** Fetch an organization's type + sector ids (interest for marina, service for partner/media). */
async function getOrgSectorInfo(orgId: string): Promise<OrgSectorInfo | null> {
  const { data: org, error: orgErr } = await supabase
    .from('organizations')
    .select('id, organization_type')
    .eq('id', orgId)
    .maybeSingle();
  if (orgErr || !org) return null;

  const orgType = (org as { organization_type: OrgType }).organization_type;
  const sectorTable = orgType === 'marina'
    ? 'organization_interest_sectors'
    : (orgType === 'partner' || orgType === 'media_partner')
    ? 'organization_service_sectors'
    : null;

  if (!sectorTable) {
    return { organizationType: orgType, sectorIds: new Set() };
  }

  const { data: links } = await supabase
    .from(sectorTable)
    .select('sector_id')
    .eq('organization_id', orgId);

  const sectorIds = new Set<string>(
    (links as { sector_id: string }[] | null || []).map((l) => l.sector_id)
  );
  return { organizationType: orgType, sectorIds };
}

export interface SectorMatchResult {
  /** True if the connection should be allowed. */
  allowed: boolean;
  /** Why the connection was blocked (only populated if allowed === false). */
  reason?: string;
  /** Number of sectors that overlap (0 means no overlap). */
  overlapCount: number;
}

/**
 * Checks whether two organizations have overlapping sectors of relevance.
 *
 * Marina ↔ Partner / Media: requires at least one overlap between marina
 * interest sectors and partner service sectors.
 * Same-type connections (marina↔marina, partner↔partner): always allowed.
 *
 * If either org has no sectors configured, the connection is allowed (we
 * cannot fairly enforce matching against an empty list — that would punish
 * users who haven't filled out their sectors yet). Admins can still filter.
 */
export async function checkSectorMatch(
  fromOrgId: string,
  toOrgId: string
): Promise<SectorMatchResult> {
  if (!fromOrgId || !toOrgId) {
    return { allowed: true, overlapCount: 0 };
  }

  const [from, to] = await Promise.all([
    getOrgSectorInfo(fromOrgId),
    getOrgSectorInfo(toOrgId),
  ]);
  if (!from || !to) {
    // If we can't load info, fail open rather than blocking legitimate users.
    return { allowed: true, overlapCount: 0 };
  }

  const isCrossType =
    (from.organizationType === 'marina' && (to.organizationType === 'partner' || to.organizationType === 'media_partner')) ||
    ((from.organizationType === 'partner' || from.organizationType === 'media_partner') && to.organizationType === 'marina');

  // Same-type connections aren't gated by sector matching
  if (!isCrossType) {
    return { allowed: true, overlapCount: 0 };
  }

  // Empty sector lists on either side: allow (don't punish unconfigured profiles)
  if (from.sectorIds.size === 0 || to.sectorIds.size === 0) {
    return { allowed: true, overlapCount: 0 };
  }

  let overlap = 0;
  for (const id of from.sectorIds) {
    if (to.sectorIds.has(id)) overlap += 1;
  }

  if (overlap === 0) {
    return {
      allowed: false,
      overlapCount: 0,
      reason:
        'Connection blocked: your sectors do not match. A marina\u2019s sectors of interest must overlap with the partner\u2019s service sectors for a connection to be relevant.',
    };
  }

  return { allowed: true, overlapCount: overlap };
}
