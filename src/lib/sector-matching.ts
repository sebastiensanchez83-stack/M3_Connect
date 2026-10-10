/**
 * Do two companies' activities match? (Oct 2026, Victor's messaging decisions of
 * 9 Oct.)
 *
 * This no longer GATES anything: any verified member of a validated company can
 * send a short first message to any other company. A match only decides how the
 * connection is made: when the sectors match, the two companies are connected at
 * once; otherwise the receiving company decides. The database applies the rule
 * itself when the message is saved (public.msg_orgs_sectors_match, migration
 * 20261009190000_company_messaging.sql); the page only asks it beforehand, to tell
 * the sender what will happen.
 *
 * The rule (unchanged from the old gate): one company on the interest side
 * (marina, developer, investor) and the other on the service side (partner,
 * media_partner), with at least one sector of the first's interests
 * (organization_interest_sectors) among the second's services
 * (organization_service_sectors). Two companies on the same side never "match":
 * the receiving company decides.
 */
import { supabase } from '@/lib/supabase';

/**
 * True when the two companies' sectors match (the connection will be made at once),
 * false when not, null when it could not be found out (then the page says nothing
 * about it: the database still decides when the message is saved).
 */
export async function sectorsMatch(fromOrgId: string | null | undefined, toOrgId: string | null | undefined): Promise<boolean | null> {
  if (!fromOrgId || !toOrgId || fromOrgId === toOrgId) return false;
  const { data, error } = await supabase.rpc('msg_orgs_sectors_match', { p_a: fromOrgId, p_b: toOrgId });
  return !error && typeof data === 'boolean' ? data : null;
}

const INTEREST_SIDE = new Set(['marina', 'developer', 'investor']);
const SERVICE_SIDE = new Set(['partner', 'media_partner']);

/**
 * True when my company has ticked no sector on its side of the rule while the
 * company I write to is on the other side: the two can then never match, and the
 * page suggests ticking them. Only for a marina (its interests) and a service
 * provider or media (its services): the company editor stores a developer's or an
 * investor's sectors with the services, where the rule does not read them (as the
 * old gate did not), so telling them to tick sectors would not help. False when it
 * cannot be found out.
 */
export async function mySectorsMissing(
  myOrgId: string | null | undefined,
  myType: string | null | undefined,
  targetType: string | null | undefined,
): Promise<boolean> {
  if (!myOrgId || !myType || !targetType) return false;
  const mineInterest = myType === 'marina';
  const mineService = SERVICE_SIDE.has(myType);
  if (!((mineInterest && SERVICE_SIDE.has(targetType)) || (mineService && INTEREST_SIDE.has(targetType)))) return false;
  const table = mineInterest ? 'organization_interest_sectors' : 'organization_service_sectors';
  const { count, error } = await supabase.from(table).select('sector_id', { count: 'exact', head: true }).eq('organization_id', myOrgId);
  return !error && count === 0;
}
