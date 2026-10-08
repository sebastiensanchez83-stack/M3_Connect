import { useTranslation } from 'react-i18next';
import type { ThemeKey } from '@/lib/themes';
import { ChannelSteps } from '@/components/motion/ChannelSteps';
import { LineReveal } from '@/components/motion/LineReveal';
import { Reveal } from '@/components/motion/Reveal';
import { Eyebrow } from '@/components/brand/Eyebrow';
import { ProfileCards } from './ProfileCards';
import { NeedPanel, type ProviderCardData } from './NeedPanel';
import { ResourcesAgenda, type HomeResource } from './ResourcesAgenda';
import { EventsCarousel } from './EventsCarousel';
import { SponsorsBand, type SponsorLogo } from './SponsorsBand';
import { EndSection } from './EndSection';

/**
 * Everything on the home page below the figures band, in its own chunk
 * (HomePage loads it lazily, so the entry bundle that every route downloads
 * stays small). The order follows the v2 design:
 *
 *   who it is for: photo cards in an accordion   (visitors)
 *   "Run a marina?": need form preview + members (visitors)
 *   latest articles + agenda                     (visitors)
 *   our events: a carousel of three photo cards
 *   how it works, channel steps                  (visitors)
 *   event sponsors, logo tiles by tier
 *   directory and resources tiles + contact panel
 *
 * A signed-in member has just had the dashboard (its own agenda, resources and
 * publishing forms): they get the lighter version, with tighter spacing between
 * the sections.
 */
export interface HomeBelowFoldProps {
  signedIn: boolean;
  /** Visitors see the need panel. */
  showNeedPanel: boolean;
  canSubmitNeed: boolean;
  providers: ProviderCardData[];
  resources: HomeResource[];
  themeCounts: Record<ThemeKey, number> | null;
  sponsors: SponsorLogo[];
  loading: boolean;
  lang: string;
  directoryLine: string;
  resourcesLine: string;
}

export default function HomeBelowFold(props: HomeBelowFoldProps) {
  const { signedIn, showNeedPanel } = props;
  // Small gold section numbers (01, 02…) follow the sections this visitor actually sees.
  let count = 0;
  const next = () => String(++count).padStart(2, '0');
  const sections = (
    <>
      {!signedIn && <ProfileCards sectionNo={next()} />}

      {showNeedPanel && (
        <NeedPanel canSubmit={props.canSubmitNeed} signedIn={signedIn} providers={props.providers} providersLoading={props.loading} sectionNo={next()} />
      )}

      {!signedIn && <ResourcesAgenda resources={props.resources} themeCounts={props.themeCounts} loading={props.loading} lang={props.lang} sectionNo={next()} />}

      <EventsCarousel sectionNo={next()} />

      {!signedIn && <HowItWorks sectionNo={next()} />}

      <SponsorsBand sponsors={props.sponsors} loading={props.loading} sectionNo={next()} />

      <EndSection directoryLine={props.directoryLine} resourcesLine={props.resourcesLine} signedIn={signedIn} />
    </>
  );
  // Signed in: each section 48 px top and bottom (64 px from md) instead of up to 104 px.
  return signedIn ? <div className="[&>section]:py-12 md:[&>section]:py-16">{sections}</div> : sections;
}

/* ─── Signed out: how it works ───────────────────────────────────── */

function HowItWorks({ sectionNo }: { sectionNo?: string }) {
  const { t } = useTranslation();
  const steps = [
    {
      title: t('homeSections.steps.account.title', 'Sign up'),
      body: t('homeSections.steps.account.desc', 'Tell us whether you run a marina, serve marinas, invest in them or cover the sector.'),
    },
    {
      title: t('homeSections.steps.organization.title', 'Set up your company'),
      body: t('homeSections.steps.organization.desc', 'Join your company if it is already listed, or create its page.'),
    },
    {
      title: t('homeSections.steps.verify.title', 'M3 reviews your company'),
      body: t('homeSections.steps.verify.desc', 'The M3 team reviews your company and marks it as verified. You get an email when it is done.'),
    },
    {
      title: t('homeSections.steps.platform.title', 'Use the whole platform'),
      body: t('homeSections.steps.platform.desc', 'Directory, opportunities, events and the full resource library.'),
    },
  ];
  return (
    <section aria-labelledby="home-how-heading" className="relative overflow-hidden bg-foam py-16 md:py-[104px]">
      <div className="relative mx-auto max-w-7xl px-4 sm:px-6">
        <div className="max-w-[720px]">
          {/* The section number with its label, as on every other section ("05 · Getting started"). */}
          <Reveal className="mb-4">
            <Eyebrow number={sectionNo}>{t('homeSections.howEyebrow', 'Getting started')}</Eyebrow>
          </Reveal>
          <LineReveal
            as="h2"
            id="home-how-heading"
            className="text-balance text-[26px] font-semibold leading-8 tracking-[-0.02em] text-navy md:text-[40px] md:leading-[48px]"
          >
            {t('homeSections.howTitle', 'How it works')}
          </LineReveal>
          <Reveal as="p" delay={120} className="mt-3 text-body text-ink">
            {t('homeSections.howSubtitle', 'Four steps, all free.')}
          </Reveal>
        </div>
        <ChannelSteps className="mt-10 md:mt-12" steps={steps} />
      </div>
    </section>
  );
}
