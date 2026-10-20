import { supabase } from '@/lib/supabase';
import { SPONSOR_TIERS, isSponsorTier, type OrgTier } from '@/types/database';

/**
 * The event sponsors, "partners" in our vocabulary and nobody else (Victor, 6 Oct
 * 2026: partner = a company paying an event sponsorship).
 *
 * ONE rule and ONE list: a verified organisation whose tier is a paying tier
 * (organizations.tier, set in Admin > Organisations; the sponsorship hub's
 * agreements carry the same tier). The full list is /partners (PARTNERS_PATH),
 * grouped by tier; the home page's band, the Rendezvous page, the sponsorship
 * page, the directory's "Event partners" row and the tier badge on a company
 * page all read this same rule and send people there.
 */

export const PARTNERS_PATH = '/partners';

/** Biggest packages first: Main Sponsor down to Innovation Partner. */
export const SPONSOR_TIER_ORDER: OrgTier[] = ['main_sponsor', 'premium_sponsor', 'premium_partner', 'associate_partner', 'innovation_partner'];

export interface SponsorLogo {
  id: string;
  slug: string;
  name: string;
  logo_url: string | null;
  tier: OrgTier;
}

type Row = { id: string; slug: string; name: string; logo_url: string | null; tier: OrgTier | null };

/** Every sponsor (name order), for the logo bands. A failed read gives an empty list. */
export async function fetchSponsorLogos(): Promise<SponsorLogo[]> {
  const { data, error } = await supabase
    .from('organizations')
    .select('id, slug, name, logo_url, tier')
    .eq('access_status', 'verified')
    .in('tier', SPONSOR_TIERS);
  if (error || !data) return [];
  const list: SponsorLogo[] = [];
  for (const o of data as Row[]) {
    const tier = (o.tier || 'member') as OrgTier;
    if (isSponsorTier(tier)) list.push({ id: o.id, slug: o.slug, name: o.name, logo_url: o.logo_url, tier });
  }
  return list.sort((a, b) => a.name.localeCompare(b.name));
}
