import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Anchor, ArrowRight, Building2, Newspaper, TrendingUp, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CoverImage } from '@/components/ui/CoverImage';
import { BuoyTabs, BuoyTabsContent, BuoyTabsList, BuoyTabsTrigger } from '@/components/brand/BuoyTabs';
import { CardShell } from '@/components/brand/CardShell';
import { TypeFlagLabel, TypePennant } from '@/components/brand/OrgCard';
import { WaveMark } from '@/components/brand/Eyebrow';
import { Reveal } from '@/components/motion/Reveal';
import { WaveEdge } from '@/components/motion/WaveEdge';
import { PERSONA_IMAGES } from '@/lib/siteMedia';
import { HomeHeading, TextLink } from './HomeHeading';

/**
 * "What you can do": one buoy tab per profile (marinas, service providers,
 * investors & developers, media). Each panel says what that company type can
 * do on the platform — the rights grid Victor validated on 6–7 Oct 2026 — and
 * offers the sign-up for that profile.
 *
 * Rights, for reference: marinas publish needs and read other marinas' needs
 * (read-only); service providers read and answer needs; investors publish a
 * thesis, developers publish needs; media get press accreditation. Everyone
 * with a validated company requests introductions and proposes webinars.
 */
interface Profile {
  key: string;
  /** organizations.organization_type whose burgee this profile flies. */
  orgType: string;
  icon: LucideIcon;
  image: string;
  tab: string;
  title: string;
  desc: string;
  can: string[];
  cta: string;
  browse: { to: string; label: string };
}

export function ProfileTabs({ waveTop = false }: { waveTop?: boolean }) {
  const { t } = useTranslation();
  const connect = t('homePage.profiles.connect', 'Request introductions and propose a webinar');

  const profiles: Profile[] = [
    {
      key: 'marinas',
      orgType: 'marina',
      icon: Anchor,
      image: PERSONA_IMAGES.marinas,
      tab: t('homePage.profiles.marinas.tab', 'Marinas'),
      title: t('homeSections.persona.marinas.title', 'For marinas'),
      desc: t('homeSections.persona.marinas.desc', 'Find service providers, put your projects and tenders in front of the right experts, and learn from other marinas.'),
      can: [
        t('homePage.profiles.marinas.can1', 'Publish your tenders, expert questions and projects'),
        t('homePage.profiles.marinas.can2', 'Find service providers by theme and country, checked by M3'),
        t('homePage.profiles.marinas.can3', 'See what other marinas are looking for'),
        connect,
      ],
      cta: t('homeSections.persona.marinas.cta', 'Sign up as a marina'),
      browse: { to: '/directory?type=partner', label: t('homeSections.persona.marinas.browse', 'Browse service providers') },
    },
    {
      key: 'providers',
      orgType: 'partner',
      icon: Building2,
      image: PERSONA_IMAGES.suppliers,
      tab: t('homePage.profiles.providers.tab', 'Service providers'),
      title: t('homeSections.persona.suppliers.title', 'For service providers'),
      desc: t('homeSections.persona.suppliers.desc', 'Read the needs marinas publish, answer them and meet the people who run marinas.'),
      can: [
        t('homePage.profiles.providers.can1', 'Read the needs marinas publish and answer them'),
        t('homePage.profiles.providers.can2', 'Present your company in the directory, checked by M3'),
        connect,
        t('homePage.profiles.providers.can3', 'Sponsor an event for more visibility'),
      ],
      cta: t('homeSections.persona.suppliers.cta', 'Sign up as a service provider'),
      browse: { to: '/directory?type=marina', label: t('homeSections.persona.suppliers.browse', 'See the marinas') },
    },
    {
      key: 'investors',
      orgType: 'investor',
      icon: TrendingUp,
      // An architect's model of a marina project: the closest honest picture of development.
      image: '/images/site/moment-seabed-model.jpg',
      tab: t('homePage.profiles.investors.tab', 'Investors & developers'),
      title: t('homePage.profiles.investors.title', 'For investors and developers'),
      desc: t('homePage.profiles.investors.desc', 'Follow the projects marinas publish and meet the teams behind them.'),
      can: [
        t('homePage.profiles.investors.can1', 'Follow the projects and tenders marinas publish'),
        t('homePage.profiles.investors.can2', 'Investors: publish your investment thesis'),
        t('homePage.profiles.investors.can3', 'Developers: publish the needs of your own projects'),
        connect,
      ],
      cta: t('homePage.profiles.investors.cta', 'Sign up as an investor or developer'),
      browse: { to: '/directory?type=marina', label: t('homePage.profiles.investors.browse', 'See the marinas') },
    },
    {
      key: 'media',
      orgType: 'media_partner',
      icon: Newspaper,
      image: PERSONA_IMAGES.media,
      tab: t('homePage.profiles.media.tab', 'Media'),
      title: t('homePage.profiles.media.title', 'For media'),
      desc: t('homePage.profiles.media.desc', 'Follow the projects shaping the sector and reach a specialised audience.'),
      can: [
        t('homePage.profiles.media.can1', 'Request press accreditation for our events in Monaco and Dubai'),
        t('homePage.profiles.media.can2', "Follow the sector's articles, opportunities and replays"),
        connect,
      ],
      cta: t('homePage.profiles.media.cta', 'Sign up as media'),
      browse: { to: '/directory', label: t('homePage.profiles.media.browse', 'Explore the directory') },
    },
  ];

  return (
    <section aria-labelledby="home-profiles-heading" className="relative bg-white">
      {/* A waterline rising out of the navy route above. */}
      {waveTop && <WaveEdge color="#ffffff" className="relative z-10 -mt-10 h-10 md:-mt-14 md:h-14" />}
      <div className={waveTop ? 'mx-auto max-w-7xl px-4 pb-16 pt-8 sm:px-6 md:pb-24 md:pt-10' : 'mx-auto max-w-7xl px-4 py-16 sm:px-6 md:py-24'}>
        <HomeHeading
          id="home-profiles-heading"
          eyebrow={t('homePage.profiles.eyebrow', 'Who it is for')}
          title={t('homePage.profiles.title', 'What you can do on Smart Marina Connect, for your line of work')}
          intro={t('homePage.profiles.intro', 'Every account is free. The M3 team checks each company and each person before opening access.')}
        />

        <Reveal delay={160} className="mt-10">
          <BuoyTabs defaultValue="marinas">
            <BuoyTabsList aria-label={t('homePage.profiles.tabsLabel', 'Profiles')} wrapperClassName="-mx-4 max-w-none px-4 sm:mx-0 sm:max-w-full sm:px-0">
              {profiles.map((p) => (
                <BuoyTabsTrigger key={p.key} value={p.key}>
                  <TypePennant type={p.orgType} className="h-3 w-5" />
                  {p.tab}
                </BuoyTabsTrigger>
              ))}
            </BuoyTabsList>

            {profiles.map((p) => (
              <BuoyTabsContent key={p.key} value={p.key}>
                <CardShell className="md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
                  <CoverImage
                    src={p.image}
                    alt=""
                    seed={`profile-${p.key}`}
                    icon={p.icon}
                    aspect="fill"
                    tone="sea"
                    className="h-52 sm:h-64 md:h-full md:min-h-[400px]"
                  />
                  <div className="flex flex-col p-6 md:p-10">
                    {/* The profile's burgee, flown from the panel's edge. */}
                    <TypeFlagLabel type={p.orgType} bleed="-ml-6 md:-ml-10" className="mb-3" />
                    <h3 className="text-h3 text-navy">{p.title}</h3>
                    <p className="mt-2 text-body text-meta">{p.desc}</p>
                    <p className="mt-6 font-signage text-[13px] font-semibold uppercase tracking-[0.1em] text-meta">{t('homePage.profiles.canTitle', 'What you can do')}</p>
                    <ul className="mt-3 space-y-3">
                      {p.can.map((line) => (
                        <li key={line} className="flex gap-3 text-body text-ink">
                          <WaveMark className="mt-[9px]" />
                          {line}
                        </li>
                      ))}
                    </ul>
                    <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3 md:mt-auto md:pt-8">
                      <Button asChild variant="tide" className="h-auto min-h-12 whitespace-normal py-3 text-left md:h-auto">
                        <Link to="/become-partner">
                          {p.cta}
                          <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
                        </Link>
                      </Button>
                      <TextLink to={p.browse.to}>{p.browse.label}</TextLink>
                    </div>
                  </div>
                </CardShell>
              </BuoyTabsContent>
            ))}
          </BuoyTabs>
        </Reveal>
      </div>
    </section>
  );
}
