import { useTranslation } from 'react-i18next';
import { Anchor, Compass, LifeBuoy, Radio } from 'lucide-react';
import { AccordionCards, CaptionList, type AccordionItem } from '@/components/brand/AccordionCards';
import { Eyebrow } from '@/components/brand/Eyebrow';
import { LineReveal } from '@/components/motion/LineReveal';
import { Reveal } from '@/components/motion/Reveal';
import { PERSONA_IMAGES, SITE_IMAGES } from '@/lib/siteMedia';

/**
 * "Who it is for" (visitors): four photo cards in an accordion, one per
 * profile (marinas, service providers, investors & developers, media). The
 * hovered or focused card opens to show what that company type can do on the
 * platform (the rights grid Victor validated on 6–7 Oct 2026) and a link to
 * sign up; on phones and tablets all four are stacked with their text shown.
 *
 * Rights, for reference: marinas publish needs and read other marinas' needs
 * (read-only); service providers read and answer needs; investors publish a
 * thesis, developers publish needs; media get press accreditation. Everyone
 * with a validated company requests introductions and proposes webinars.
 */
export function ProfileCards({ sectionNo }: { sectionNo?: string }) {
  const { t } = useTranslation();
  const connect = t('homePage.profiles.connect', 'Request introductions and propose a webinar');
  // One chapter per profile on the join page (ids marina, service-provider, investor-developer, media).
  const signupTo = (chapter: string) => `/become-partner#${chapter}`;

  const items: AccordionItem[] = [
    {
      id: 'marinas',
      title: t('homePage.profiles.marinas.tab', 'Marinas'),
      icon: Anchor,
      image: PERSONA_IMAGES.marinas,
      dotColor: 'rgb(var(--type-marina))',
      caption: (
        <CaptionList
          items={[
            t('homePage.profiles.marinas.can1', 'Publish your tenders, expert questions and projects'),
            t('homePage.profiles.marinas.can2', 'Find service providers by theme and country, checked by M3'),
            t('homePage.profiles.marinas.can3', 'See what other marinas are looking for'),
            connect,
          ]}
        />
      ),
      cta: { label: t('homeSections.persona.marinas.cta', 'Sign up as a marina'), to: signupTo('marina') },
    },
    {
      id: 'providers',
      title: t('homePage.profiles.providers.tab', 'Service providers'),
      icon: LifeBuoy,
      image: PERSONA_IMAGES.suppliers,
      dotColor: 'rgb(var(--type-provider))',
      caption: (
        <CaptionList
          items={[
            t('homePage.profiles.providers.can1', 'Read the needs marinas publish and answer them'),
            t('homePage.profiles.providers.can2', 'Present your company in the directory, checked by M3'),
            connect,
            t('homePage.profiles.providers.can3', 'Sponsor an event for more visibility'),
          ]}
        />
      ),
      cta: { label: t('homeSections.persona.suppliers.cta', 'Sign up as a service provider'), to: signupTo('service-provider') },
    },
    {
      id: 'investors',
      title: t('homePage.profiles.investors.tab', 'Investors & developers'),
      icon: Compass,
      image: SITE_IMAGES.opportunitiesHero.src,
      imageFocusY: SITE_IMAGES.opportunitiesHero.focusY,
      dotColor: 'rgb(var(--type-investor))',
      caption: (
        <CaptionList
          items={[
            t('homePage.profiles.investors.can1', 'Follow the projects and tenders marinas publish'),
            t('homePage.profiles.investors.can2', 'Investors: publish your investment thesis'),
            t('homePage.profiles.investors.can3', 'Developers: publish the needs of your own projects'),
            connect,
          ]}
        />
      ),
      cta: { label: t('homePage.profiles.investors.cta', 'Sign up as an investor or developer'), to: signupTo('investor-developer') },
    },
    {
      id: 'media',
      title: t('homePage.profiles.media.tab', 'Media'),
      icon: Radio,
      image: PERSONA_IMAGES.media,
      dotColor: 'rgb(var(--type-media))',
      caption: (
        <CaptionList
          items={[
            t('homePage.profiles.media.can1', 'Request press accreditation for our events in Monaco and Dubai'),
            t('homePage.profiles.media.can2', "Follow the sector's articles, opportunities and replays"),
            connect,
          ]}
        />
      ),
      cta: { label: t('homePage.profiles.media.cta', 'Sign up as media'), to: signupTo('media') },
    },
  ];

  return (
    <section aria-labelledby="home-profiles-heading" className="bg-page py-16 md:py-[104px]">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="grid gap-4 lg:grid-cols-12 lg:items-end">
          <Reveal className="lg:col-span-4 lg:pb-3">
            <Eyebrow number={sectionNo}>{t('homePage.profiles.eyebrow', 'Who it is for')}</Eyebrow>
          </Reveal>
          <LineReveal
            as="h2"
            id="home-profiles-heading"
            className="text-balance text-[26px] font-semibold leading-8 tracking-[-0.02em] text-navy md:text-[40px] md:leading-[48px] lg:col-span-8"
          >
            {t('homePage.profiles.title', 'What you can do on Smart Marina Connect, for your line of work')}
          </LineReveal>
        </div>
        <AccordionCards items={items} className="mt-10 md:mt-12" ariaLabel={t('homePage.profiles.tabsLabel', 'Profiles')} />
      </div>
    </section>
  );
}
