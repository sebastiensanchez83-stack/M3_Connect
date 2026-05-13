/**
 * Sector matching helpers — used to gate B2B connection requests.
 *
 * Rules (strict, applied in order):
 *   1. The target organization must have at least one team member.
 *      A pre-seeded marina with no claimed owner can't actually receive
 *      a connection request, so we block at the source and ask the
 *      sender to find an active org instead.
 *   2. For cross-type connections (marina ↔ partner / media_partner):
 *      a. Both organizations must have sectors configured.
 *         The sender is asked to add their sectors of interest before
 *         sending. The target is reported as not yet configured.
 *      b. Sectors must overlap by at least one entry.
 *   3. Same-type connections (marina↔marina, partner↔partner) skip the
 *      sector check (no meaningful overlap to compute), but still
 *      require the target to have members.
 */
import { supabase } from '@/lib/supabase';

export type OrgType = 'marina' | 'partner' | 'media_partner' | string | null;

interface OrgInfo {
  organizationType: OrgType;
  name: string;
  sectorIds: Set<string>;
  memberCount: number;
}

/** Fetch an organization's type, name, sector ids, and team member count. */
async function getOrgInfo(orgId: string): Promise<OrgInfo | null> {
  const { data: org, error: orgErr } = await supabase
    .from('organizations')
    .select('id, organization_type, name')
    .eq('id', orgId)
    .maybeSingle();
  if (orgErr || !org) return null;

  const orgType = (org as { organization_type: OrgType }).organization_type;
  const orgName = (org as { name: string | null }).name || 'this organization';

  const sectorTable = orgType === 'marina'
    ? 'organization_interest_sectors'
    : (orgType === 'partner' || orgType === 'media_partner')
    ? 'organization_service_sectors'
    : null;

  const [sectorsResult, membersResult] = await Promise.all([
    sectorTable
      ? supabase.from(sectorTable).select('sector_id').eq('organization_id', orgId)
      : Promise.resolve({ data: [] as { sector_id: string }[] }),
    supabase
      .from('organization_members')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId),
  ]);

  const sectorIds = new Set<string>(
    ((sectorsResult.data as { sector_id: string }[] | null) || []).map((l) => l.sector_id)
  );
  const memberCount = membersResult.count || 0;

  return { organizationType: orgType, name: orgName, sectorIds, memberCount };
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
 * Checks whether a connection request from one organization to another
 * should be allowed. See file-level docstring for the rules.
 */
export async function checkSectorMatch(
  fromOrgId: string,
  toOrgId: string
): Promise<SectorMatchResult> {
  if (!fromOrgId || !toOrgId) {
    return { allowed: true, overlapCount: 0 };
  }

  const [from, to] = await Promise.all([
    getOrgInfo(fromOrgId),
    getOrgInfo(toOrgId),
  ]);
  if (!from || !to) {
    // Can't load org info — fail open rather than block on infra issues.
    return { allowed: true, overlapCount: 0 };
  }

  // Rule 1: target must have at least one team member.
  if (to.memberCount === 0) {
    return {
      allowed: false,
      overlapCount: 0,
      reason: `${to.name} doesn’t have any team members yet, so they can’t receive your request. Try another organization, or reach out via the contact page.`,
    };
  }

  const isCrossType =
    (from.organizationType === 'marina' && (to.organizationType === 'partner' || to.organizationType === 'media_partner')) ||
    ((from.organizationType === 'partner' || from.organizationType === 'media_partner') && to.organizationType === 'marina');

  // Same-type connections aren't sector-gated (overlap isn't meaningful between
  // two marinas' interest lists, or between two partners' service lists).
  if (!isCrossType) {
    return { allowed: true, overlapCount: 0 };
  }

  // Rule 2a: sender must have sectors configured.
  if (from.sectorIds.size === 0) {
    return {
      allowed: false,
      overlapCount: 0,
      reason: 'Please add your sectors of interest on your organization profile before sending connection requests.',
    };
  }

  // Rule 2a: target must have sectors configured.
  if (to.sectorIds.size === 0) {
    return {
      allowed: false,
      overlapCount: 0,
      reason: `${to.name} hasn’t added their sectors yet, so we can’t tell whether your activities are a fit.`,
    };
  }

  // Rule 2b: at least one shared sector.
  let overlap = 0;
  for (const id of from.sectorIds) {
    if (to.sectorIds.has(id)) overlap += 1;
  }

  if (overlap === 0) {
    return {
      allowed: false,
      overlapCount: 0,
      reason: `Your sectors don’t overlap with ${to.name}’s. A marina’s sectors of interest must match the partner’s service sectors for a connection to be relevant.`,
    };
  }

  return { allowed: true, overlapCount: overlap };
}
