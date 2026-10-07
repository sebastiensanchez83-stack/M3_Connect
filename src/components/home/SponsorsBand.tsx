import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Eyebrow } from '@/components/brand/Eyebrow';
import { UnderlineLink } from '@/components/brand/UnderlineLink';
import { LineReveal } from '@/components/motion/LineReveal';
import { LogoMarquee, type MarqueeGroup } from '@/components/motion/LogoMarquee';
import { MotionPauseToggle } from '@/components/motion/MotionPauseToggle';
import { Reveal } from '@/components/motion/Reveal';
import { useMotion } from '@/components/motion/MotionProvider';
import { TIER_LABELS, type OrgTier } from '@/types/database';

/**
 * Event sponsors — "partners" in our vocabulary, and only them — as a slow
 * band of logo tiles grouped by tier, highest first (tier names stay in
 * English). Every logo sits on a tile of the same size: a sponsor tier buys
 * visibility, not a certification. Only tiers that have at least one logo are
 * shown (a sponsor of such a tier with no logo yet is written out by name).
 * Pauses on hover and focus, and with the pause control under the band; static
 * under reduced motion, and when there are too few logos to drift
 * (LogoMarquee).
 */
export interface SponsorLogo {
  id: string;
  slug: string;
  name: string;
  logo_url: string | null;
  tier: OrgTier;
}

const TIER_ORDER: OrgTier[] = ['main_sponsor', 'premium_sponsor', 'premium_partner', 'associate_partner', 'innovation_partner'];

export function SponsorsBand({ sponsors, loading, sectionNo }: { sponsors: SponsorLogo[]; loading: boolean; sectionNo?: string }) {
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
    <section aria-labelledby="home-sponsors-heading" className="bg-white py-16 md:py-[104px]">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="grid gap-6 lg:grid-cols-12 lg:items-end">
          <div className="lg:col-span-7">
            <Reveal>
              <Eyebrow number={sectionNo}>{t('homeSections.partnersEyebrow', 'Our partners')}</Eyebrow>
            </Reveal>
            <LineReveal
              as="h2"
              id="home-sponsors-heading"
              className="mt-3 text-[22px] font-semibold leading-7 tracking-[-0.01em] text-navy"
            >
              {t('homePage.sponsors.title', 'They sponsor our events')}
            </LineReveal>
            <Reveal as="p" delay={120} className="mt-3 max-w-[640px] text-body text-ink">
              {t('homePage.sponsors.intro', 'The companies that sponsor M3 events, from Main Sponsor to Innovation Partner. Each one is presented on the Partners page.')}
            </Reveal>
          </div>
          <Reveal delay={160} className="flex flex-wrap items-center gap-x-6 gap-y-3 lg:col-span-5 lg:justify-end">
            <Button asChild variant="ctaOutline">
              <Link to="/partners">{t('homePage.sponsors.link', 'See the partners')}</Link>
            </Button>
            {/* Sponsoring is sold by the M3 team: the sponsorship page explains it and takes the deck request. */}
            <UnderlineLink to="/sponsor">{t('homeSections.becomePartner', 'Sponsor an event')}</UnderlineLink>
          </Reveal>
        </div>
      </div>

      {loading ? (
        <div aria-hidden="true" className="mx-auto mt-10 flex max-w-7xl gap-3 overflow-hidden px-4 sm:px-6 md:mt-12">
          {[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-[100px] w-[168px] shrink-0 animate-pulse rounded-[12px] bg-chip md:h-28 md:w-[200px]" />)}
        </div>
      ) : groups.length > 0 ? (
        <>
          <Reveal className="mt-10 md:mt-12">
            <LogoMarquee
              // Moving: full bleed with faded edges. Still: a wall inside the page width.
              look="tiles"
              still={still}
              className={still ? 'mx-auto max-w-7xl px-4 sm:px-6' : undefined}
              label={t('homePage.sponsors.marqueeLabel', 'Event sponsors, by tier')}
              groups={groups}
            />
          </Reveal>
          {!still && (
            <div className="mx-auto mt-5 flex max-w-7xl justify-end px-4 sm:px-6">
              <MotionPauseToggle tone="light" withLabel />
            </div>
          )}
        </>
      ) : (
        <p className="mx-auto mt-10 max-w-7xl px-4 text-meta sm:px-6">
          {t('homeSections.partnersEmpty', 'Partner profiles are coming soon.')}
        </p>
      )}
    </section>
  );
}
