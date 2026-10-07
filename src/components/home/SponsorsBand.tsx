import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LogoMarquee, type MarqueeGroup } from '@/components/motion/LogoMarquee';
import { Reveal } from '@/components/motion/Reveal';
import { useMotion } from '@/components/motion/MotionProvider';
import { WaveEdge } from '@/components/motion/WaveEdge';
import { TIER_LABELS, type OrgTier } from '@/types/database';
import { HomeHeading, TextLink } from './HomeHeading';

/**
 * Event sponsors — "partners" in our vocabulary, and only them — as a slow
 * logo band grouped by tier, highest first (tier names stay in English). Only
 * tiers that have at least one logo are shown (a sponsor of such a tier with no
 * logo yet is written out by name). Pauses on hover and focus; static under
 * reduced motion, and when there are too few logos to drift (LogoMarquee).
 */
export interface SponsorLogo {
  id: string;
  slug: string;
  name: string;
  logo_url: string | null;
  tier: OrgTier;
}

const TIER_ORDER: OrgTier[] = ['main_sponsor', 'premium_sponsor', 'premium_partner', 'associate_partner', 'innovation_partner'];

export function SponsorsBand({
  sponsors,
  loading,
  waveTop = false,
}: {
  sponsors: SponsorLogo[];
  loading: boolean;
  /** Start with a waterline rising out of the navy section above. */
  waveTop?: boolean;
}) {
  const { t } = useTranslation();
  const { reduced } = useMotion();
  // A tier shows once it has at least one logo; a sponsor of that tier without a
  // logo yet is written out by name, so nobody who paid for visibility is left out.
  const groups: MarqueeGroup[] = TIER_ORDER.map((tier) => {
    const ofTier = sponsors.filter((s) => s.tier === tier);
    return {
      tier: TIER_LABELS[tier],
      logos: ofTier.some((s) => s.logo_url)
        ? [...ofTier]
            .sort((a, b) => Number(!!b.logo_url) - Number(!!a.logo_url))
            .map((s) => ({ name: s.name, src: s.logo_url, href: `/organizations/${s.slug}` }))
        : [],
    };
  }).filter((g) => g.logos.length > 0);
  // A handful of logos drifting across an empty band looks lost: below five they simply stand still.
  const still = reduced || groups.reduce((n, g) => n + g.logos.length, 0) < 5;

  return (
    <section aria-labelledby="home-sponsors-heading" className="relative bg-white">
      {waveTop && <WaveEdge color="#ffffff" className="relative z-10 -mt-10 h-10 md:-mt-14 md:h-14" />}
      <div className={waveTop ? 'pb-16 pt-8 md:pb-24 md:pt-10' : 'py-16 md:py-24'}>
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="grid gap-6 lg:grid-cols-12 lg:items-end">
            <HomeHeading
              id="home-sponsors-heading"
              className="lg:col-span-8"
              eyebrow={t('homeSections.partnersEyebrow', 'Event sponsors')}
              title={t('homePage.sponsors.title', 'They sponsor our events')}
              intro={t('homePage.sponsors.intro', 'The companies that sponsor M3 events, from Main Sponsor to Innovation Partner. Each one is presented on the Partners page.')}
            />
            <Reveal delay={200} className="flex flex-wrap items-center gap-x-6 gap-y-3 lg:col-span-4 lg:justify-end">
              <Button asChild variant="tideOutline">
                <Link to="/partners">
                  {t('homePage.sponsors.link', 'See the partners')}
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </Button>
              {/* Sponsoring is sold by the M3 team: the contact form, opened on sponsorship. */}
              <TextLink to="/contact?subject=partnership">{t('homeSections.becomePartner', 'Sponsor an event')}</TextLink>
            </Reveal>
          </div>
        </div>

        {loading ? (
          <div aria-hidden="true" className="mx-auto mt-12 flex max-w-7xl gap-10 overflow-hidden px-4 sm:px-6">
            {[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-12 w-32 shrink-0 animate-pulse rounded-field bg-chip" />)}
          </div>
        ) : groups.length > 0 ? (
          <LogoMarquee
            // Moving: full bleed with faded edges. Still: a wall inside the page width.
            still={still}
            className={still ? 'mx-auto mt-12 max-w-7xl px-4 sm:px-6' : 'mt-12'}
            label={t('homePage.sponsors.marqueeLabel', 'Event sponsors, by tier')}
            groups={groups}
          />
        ) : (
          <p className="mx-auto mt-10 max-w-7xl px-4 text-meta sm:px-6">
            {t('homeSections.partnersEmpty', 'Partner profiles are coming soon.')}
          </p>
        )}
      </div>
    </section>
  );
}
