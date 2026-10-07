import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ThemeKey } from '@/lib/themes';
import { EventRoute } from '@/components/brand/EventRoute';
import { eventRouteStops } from '@/components/brand/m3Events';
import {
  BerthNumberPictogram,
  HarbourStampPictogram,
  MooringLinePictogram,
  OpenBoomPictogram,
} from '@/components/brand/HarbourPictograms';
import { ChannelSteps } from '@/components/motion/ChannelSteps';
import { WaveEdge } from '@/components/motion/WaveEdge';
import { Reveal } from '@/components/motion/Reveal';
import { ProfileTabs } from './ProfileTabs';
import { NeedPanel, type ProviderCardData } from './NeedPanel';
import { ResourcesLogbook, type HomeResource } from './ResourcesLogbook';
import { SponsorsBand, type SponsorLogo } from './SponsorsBand';
import { EndSection } from './EndSection';
import { HomeHeading } from './HomeHeading';

/**
 * Everything on the home page below the quay, in its own chunk (HomePage loads
 * it lazily, so the entry bundle that every route downloads stays small).
 *
 * The order follows what only SMC has, not a generic landing page:
 *
 *   route Monaco → Dubai → online   (M3's events, right after the quay)
 *   profiles, buoy tabs             (visitors)
 *   "Run a marina?": notice + berths (visitors and marinas)
 *   resources logbook, full width
 *   how it works, channel buoys     (visitors)
 *   event sponsors by tier
 *   signpost + harbour office strip
 */
const PAGE_BG = 'rgb(246 247 249)';
const FOAM_BG = 'rgb(234 243 244)';

export interface HomeBelowFoldProps {
  signedIn: boolean;
  /** Visitors and signed-in marinas see the need panel. */
  showNeedPanel: boolean;
  canSubmitNeed: boolean;
  providers: ProviderCardData[];
  resources: HomeResource[];
  themeCounts: Record<ThemeKey, number> | null;
  sponsors: SponsorLogo[];
  loading: boolean;
  lang: string;
  directoryLine: string;
  directorySign: string | null;
  resourcesSign: string | null;
}

export default function HomeBelowFold(props: HomeBelowFoldProps) {
  const { t } = useTranslation();
  const { signedIn, showNeedPanel } = props;
  return (
    <>
      <EventRoute
        headingId="home-route-heading"
        above={PAGE_BG}
        stops={eventRouteStops(t)}
        eyebrow={t('brand.route.eyebrow', 'M3 events')}
        title={t('brand.route.title', 'From Monaco to Dubai, and online')}
        intro={t('brand.route.intro', 'Three ways to meet the network: the Rendezvous in Monaco, the World Yachting Summit in Dubai and our webinars.')}
      />

      {!signedIn && <ProfileTabs waveTop />}

      {showNeedPanel && (
        <NeedPanel canSubmit={props.canSubmitNeed} providers={props.providers} providersLoading={props.loading} />
      )}

      {/* Always after a navy band (the need panel, or the route). */}
      <ResourcesLogbook
        resources={props.resources}
        themeCounts={props.themeCounts}
        loading={props.loading}
        lang={props.lang}
        waveTop
      />

      {!signedIn && <HowItWorks />}

      <SponsorsBand sponsors={props.sponsors} loading={props.loading} />

      <EndSection
        directoryLine={props.directoryLine}
        directorySign={props.directorySign}
        resourcesSign={props.resourcesSign}
        signedIn={signedIn}
      />
    </>
  );
}

/* ─── Signed out: how it works ───────────────────────────────────── */

function HowItWorks() {
  const { t } = useTranslation();
  const steps = [
    {
      icon: MooringLinePictogram,
      title: t('homeSections.steps.account.title', 'Sign up'),
      body: t('homeSections.steps.account.desc', 'Tell us whether you run a marina, serve marinas, invest in them or cover the sector.'),
    },
    {
      icon: BerthNumberPictogram,
      title: t('homeSections.steps.organization.title', 'Set up your company'),
      body: t('homeSections.steps.organization.desc', 'Join your company if it is already listed, or create its page.'),
    },
    {
      icon: HarbourStampPictogram,
      title: t('homeSections.steps.verify.title', 'Get checked by M3'),
      body: t('homeSections.steps.verify.desc', 'The M3 team checks every company and every person before opening access.'),
    },
    {
      icon: OpenBoomPictogram,
      title: t('homeSections.steps.platform.title', 'Use the whole platform'),
      body: t('homeSections.steps.platform.desc', 'Directory, opportunities, events and the full resource library.'),
    },
  ];
  return (
    <section aria-labelledby="home-how-heading" className="relative bg-foam">
      {/* A waterline rising out of the section above. */}
      <WaveEdge color={FOAM_BG} className="relative z-10 -mt-10 h-10 md:-mt-14 md:h-14" />
      <div className="mx-auto max-w-7xl px-4 pb-16 pt-8 sm:px-6 md:pb-24 md:pt-10">
        <HomeHeading
          id="home-how-heading"
          eyebrow={t('homeSections.howEyebrow', 'Getting started')}
          title={t('homeSections.howTitle', 'How it works')}
          intro={t('homeSections.howSubtitle', 'Every member is checked by the M3 team, so you always know who you are talking to.')}
        />
        <ChannelSteps className="mt-12" steps={steps} />
        <Reveal delay={200} className="mt-12">
          <Button asChild variant="tide" size="lg">
            <Link to="/become-partner">
              {t('homeSections.createAccount', 'Sign up')}
              <ArrowRight className="h-5 w-5" aria-hidden="true" />
            </Link>
          </Button>
        </Reveal>
      </div>
    </section>
  );
}
