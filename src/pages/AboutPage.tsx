import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Seo } from '@/components/seo/Seo';
import { Anchor, Building2, Calendar, Compass, Globe, Link2, Newspaper, BookOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHero } from '@/components/ui/PageHero';
import { CardShell, CardMedia, StretchedLink } from '@/components/brand/CardShell';
import { ContactCard } from '@/components/brand/ContactCard';
import { Eyebrow } from '@/components/brand/Eyebrow';
import { UnderlineLink } from '@/components/brand/UnderlineLink';
import { featuredEventItems } from '@/components/brand/m3Events';
import { BathyPattern } from '@/components/motion/BathyPattern';
import { Counter } from '@/components/motion/Counter';
import { LineReveal } from '@/components/motion/LineReveal';
import { Reveal, RevealGroup } from '@/components/motion/Reveal';
import { SectionHead } from '@/components/content/ContentParts';
import { useAuth } from '@/contexts/AuthContext';
import { useNetworkFigures } from '@/lib/networkStats';
import { SITE_IMAGES, PERSONA_IMAGES, SM26_MOMENTS } from '@/lib/siteMedia';
import { withSiteSuffix } from '@/lib/seoText';
import { cn } from '@/lib/utils';

/**
 * About, on the v2 kit: the compact banner (two actions), the mission with the
 * network's live figures, what the platform does (three cards that lead to it),
 * who it is for (four photo cards that lead to the matching chapter of the join
 * page), M3 Monaco with its three meeting points and the contact panel, and the
 * moments of the 6th edition of the Rendezvous.
 *
 * The footer's "Join the marina network" band closes the page for visitors, so
 * there is no second sign-up block here.
 */
export function AboutPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { figures } = useNetworkFigures();
  const seoTitle = withSiteSuffix(t('seo.about.title', 'About Smart Marina Connect, by M3 Monaco'));
  const seoDescription = t('seo.about.description', 'Smart Marina Connect is the marina industry network run by M3 Monaco, organiser of industry events in Monaco, Dubai and online.');

  const figureItems: [string, number | null, string][] = [
    ['marinas', figures.marinas, t('homeSections.stats.marinas', 'Marinas listed')],
    ['providers', figures.partners, t('homeSections.stats.suppliers', 'Service providers')],
    ['countries', figures.countries, t('becomePartner.stats.countries', 'Countries')],
  ];

  const doing = [
    {
      key: 'resources',
      icon: BookOpen,
      to: '/resources',
      title: t('about.feature1Title', 'Resources'),
      desc: t('about.feature1Desc', 'Articles on marina infrastructure, design, digital, energy, operations and business, sorted by theme.'),
    },
    {
      key: 'intro',
      icon: Link2,
      to: '/opportunities',
      title: t('about.feature2Title', 'Introductions'),
      desc: t('about.feature2Desc', 'Marinas publish tenders, projects and expert questions. Service providers answer them and request introductions.'),
    },
    {
      key: 'events',
      icon: Calendar,
      to: '/events',
      title: t('about.feature3Title', 'Events & webinars'),
      desc: t('about.feature3Desc', 'The Monaco Smart & Sustainable Marina Rendezvous, the World Yachting Summit in Dubai and webinars online.'),
    },
  ];

  const audiences = [
    {
      key: 'marinas',
      icon: Anchor,
      image: PERSONA_IMAGES.marinas,
      focusY: 0.5,
      to: '/become-partner#marina',
      title: t('about.audience1Title', 'Marinas'),
      desc: t('about.audience1Desc', 'Marina operators and managers looking for service providers, industry knowledge and proven solutions.'),
    },
    {
      key: 'providers',
      icon: Building2,
      image: PERSONA_IMAGES.suppliers,
      focusY: 0.5,
      to: '/become-partner#service-provider',
      title: t('about.audience2Title', 'Service providers'),
      desc: t('about.audience2Desc', 'Technology providers, consultants and service companies working for marinas: a company page in the directory, the needs marinas publish, and introductions.'),
    },
    {
      key: 'investors',
      icon: Compass,
      image: SITE_IMAGES.opportunitiesHero.src,
      focusY: SITE_IMAGES.opportunitiesHero.focusY,
      to: '/become-partner#investor-developer',
      title: t('homePage.profiles.investors.tab', 'Investors & developers'),
      desc: t('homePage.profiles.investors.desc', 'Follow the projects marinas publish and meet the teams behind them.'),
    },
    {
      key: 'media',
      icon: Newspaper,
      image: PERSONA_IMAGES.media,
      focusY: 0.5,
      to: '/become-partner#media',
      title: t('about.audience3Title', 'Media'),
      desc: t('about.audience3Desc', 'Journalists and publications covering marinas and the nautical sector: press accreditation for our events, news and replays.'),
    },
  ];

  // The three M3 meeting points, together (the World Yachting Summit while it is upcoming).
  const meetingPoints = featuredEventItems(t);

  return (
    <div className="min-h-screen bg-white">
      <Seo title={seoTitle} description={seoDescription} path="/about" />

      {/* Hero — the SM26 community under the event's own screen */}
      <PageHero
        image={SITE_IMAGES.aboutHero}
        seed="about-hero"
        icon={Anchor}
        eyebrow={t('about.eyebrow', 'By M3 Monaco')}
        title={t('about.title', 'About Smart Marina Connect')}
        subtitle={t(
          'about.hero',
          'The network of marinas and the companies that serve them. Smart Marina Connect is run by M3 Monaco, organiser of industry events in Monaco, Dubai and online.',
        )}
      >
        <div className="flex flex-wrap gap-3">
          {!user && (
            <Button asChild variant="ctaOnDark">
              <Link to="/become-partner">{t('about.ctaSignup', 'Sign up')}</Link>
            </Button>
          )}
          <Button asChild variant="ctaLight">
            <Link to="/contact">{t('about.ctaContact', 'Contact us')}</Link>
          </Button>
        </div>
      </PageHero>

      {/* 01 · Mission, with the network's live figures */}
      <section aria-labelledby="about-mission" className="bg-white py-16 md:py-[104px]">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="grid gap-8 lg:grid-cols-12 lg:gap-14">
            <SectionHead
              id="about-mission"
              number="01"
              eyebrow={t('contentPages.about.missionEyebrow', 'Our mission')}
              title={t('about.mission', 'Help marinas find the right service providers, and help those providers understand what marinas need.')}
              className="lg:col-span-7"
            />
            <Reveal delay={160} className="lg:col-span-5 lg:pt-[34px]">
              <p className="text-body md:text-body-lg text-ink">
                {t('about.missionDetail', "Marinas publish their needs, service providers answer them, and both meet at M3's events in Monaco, Dubai and online. The M3 team checks every member, so you know who you are talking to.")}
              </p>
            </Reveal>
          </div>
          <Reveal delay={80}>
            <dl
              aria-label={t('contentPages.about.figuresLabel', 'The network in figures')}
              className="mt-12 flex flex-wrap gap-y-6 border-t border-rule pt-8 md:mt-16"
            >
              {figureItems.map(([key, value, label], i) => (
                <div key={key} className={cn('flex min-w-0 flex-col-reverse pr-6 md:pr-12', i > 0 && 'border-l border-rule pl-6 md:pl-12')}>
                  <dt className="mt-1 text-[13px] leading-[18px] text-meta">{label}</dt>
                  <dd className="text-[34px] font-light leading-[38px] tracking-[-0.02em] text-navy md:text-[48px] md:leading-[52px]">
                    <Counter value={value} suffix={figures.manual ? '+' : ''} />
                  </dd>
                </div>
              ))}
            </dl>
          </Reveal>
        </div>
      </section>

      {/* 02 · What we do */}
      <section aria-labelledby="about-do" className="bg-page py-16 md:py-[104px]">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <SectionHead
            id="about-do"
            number="02"
            eyebrow={t('contentPages.about.platformEyebrow', 'The platform')}
            title={t('about.whatWeDoTitle', 'What we do')}
          />
          <RevealGroup as="ul" className="mt-10 grid gap-6 md:grid-cols-3 md:mt-12">
            {doing.map((item) => (
              <li key={item.key} className="flex min-w-0">
                <CardShell interactive className="w-full p-6 md:p-8">
                  <span aria-hidden="true" className="grid h-12 w-12 place-items-center rounded-field bg-chip text-navy">
                    <item.icon className="h-6 w-6" />
                  </span>
                  <h3 className="mt-5 text-card-title text-navy">
                    <StretchedLink to={item.to}>{item.title}</StretchedLink>
                  </h3>
                  <p className="mt-2 text-body text-meta">{item.desc}</p>
                </CardShell>
              </li>
            ))}
          </RevealGroup>
        </div>
      </section>

      {/* 03 · Who it is for */}
      <section aria-labelledby="about-who" className="bg-white py-16 md:py-[104px]">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <SectionHead
            id="about-who"
            number="03"
            eyebrow={t('contentPages.about.networkEyebrow', 'The network')}
            title={t('about.whoWeServeTitle', 'Who it is for')}
          />
          {/* Photo cards: who the platform is for, shown with the people and work it serves. */}
          <RevealGroup as="ul" className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4 md:mt-12">
            {audiences.map((a) => (
              <li key={a.key} className="flex min-w-0">
                <CardShell interactive className="w-full">
                  <CardMedia className="aspect-[3/2] bg-navy">
                    {a.image && (
                      <img
                        src={a.image}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="h-full w-full object-cover"
                        style={{ objectPosition: `50% ${Math.round(a.focusY * 100)}%` }}
                      />
                    )}
                    <span aria-hidden="true" className="absolute left-3 top-3 grid h-10 w-10 place-items-center rounded-field bg-white/95 text-navy">
                      <a.icon className="h-5 w-5" />
                    </span>
                  </CardMedia>
                  <div className="flex flex-1 flex-col p-5">
                    <h3 className="text-card-title text-navy">
                      <StretchedLink to={a.to}>{a.title}</StretchedLink>
                    </h3>
                    <p className="mt-2 text-sm leading-[22px] text-meta">{a.desc}</p>
                  </div>
                </CardShell>
              </li>
            ))}
          </RevealGroup>
        </div>
      </section>

      {/* 04 · M3 Monaco, its meeting points, and who to write to */}
      <section aria-labelledby="about-m3" className="bg-page py-16 md:py-[104px]">
        <div className="mx-auto grid max-w-7xl gap-6 px-4 sm:px-6 lg:grid-cols-12">
          <Reveal className="lg:col-span-8">
            <div className="relative h-full overflow-hidden rounded-card bg-navy p-6 text-white sm:p-10">
              <BathyPattern seed={7} drift className="absolute inset-0" />
              <div className="relative">
                <Eyebrow tone="onDark" number="04">{t('contentPages.about.teamEyebrow', 'The team')}</Eyebrow>
                <LineReveal as="h2" id="about-m3" className="mt-4 text-[26px] font-semibold leading-8 tracking-[-0.02em] text-white md:text-[40px] md:leading-[48px]">
                  {t('about.companyTitle', 'M3 Monaco')}
                </LineReveal>
                <div className="mt-4 grid max-w-2xl gap-4 text-body text-white/85 md:text-body-lg">
                  <p>
                    {t('about.companyDesc', 'Smart Marina Connect is run by M3 Monaco, based in the Principality of Monaco. M3 organises the Monaco Smart & Sustainable Marina Rendezvous, the World Yachting Summit in Dubai and webinars for the marina industry.')}
                  </p>
                  <p>
                    {t('about.companyDesc2', "The team brings together marina management professionals and event organisers who know the sector's challenges first-hand.")}
                  </p>
                </div>
                <ul className="mt-8 grid gap-x-6 gap-y-5 border-t border-white/15 pt-6 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1.5fr]">
                  {meetingPoints.map((item) => (
                    <li key={item.id} className="min-w-0">
                      <p className="text-[12px] font-semibold leading-4 tracking-[0.02em] text-gold">{item.kicker}</p>
                      <UnderlineLink to={item.href} tone="light" className="mt-1 text-[15px] font-semibold leading-[22px]">
                        {item.title}
                      </UnderlineLink>
                      <p className="mt-1 text-[13px] leading-[18px] text-white/75">{item.meta}</p>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </Reveal>
          <Reveal delay={160} className="lg:col-span-4">
            <ContactCard
              variant="panel"
              className="h-full"
              title={t('homePage.end.contactTitleMember', 'A question about the platform or our events?')}
              line={t('homePage.end.contactBodyMember', 'The M3 team answers every request.')}
              cta={{ label: t('homePage.end.contactCta', 'Write to the team'), to: '/contact' }}
            />
          </Reveal>
        </div>
      </section>

      {/* Relive the 6th edition of the Rendezvous — the network in person */}
      <section aria-labelledby="sm26-moments-heading" className="bg-white py-16 md:py-[104px]">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
            <SectionHead
              id="sm26-moments-heading"
              number="05"
              eyebrow={t('sm26Moments.eyebrow', '20–21 September 2026 · Yacht Club de Monaco')}
              title={t('sm26Moments.title', 'Relive the Monaco Smart & Sustainable Marina Rendezvous')}
            />
            <UnderlineLink to="/events">{t('sm26Moments.cta', 'See upcoming events')}</UnderlineLink>
          </div>
          {/* Phones: a sideways scroller. md+: a mosaic, first picture 2×2. */}
          <ul className="no-scrollbar -mx-4 mt-10 flex snap-x scroll-px-4 gap-3 overflow-x-auto px-4 md:mx-0 md:mt-12 md:grid md:grid-cols-4 md:grid-rows-2 md:gap-4 md:overflow-visible md:px-0">
            {SM26_MOMENTS.map((m, i) => (
              <li
                key={m.key}
                className={cn(
                  'card-media relative w-64 shrink-0 snap-start overflow-hidden rounded-card bg-navy md:w-auto',
                  i === 0 ? 'aspect-[3/2] md:col-span-2 md:row-span-2 md:aspect-auto' : 'aspect-[3/2]',
                  // The mosaic holds one 2×2 + four singles; the sixth stays in the phone scroller.
                  i > 4 && 'md:hidden',
                )}
              >
                <img
                  src={m.src}
                  alt={t(`sm26Moments.alt.${m.key}`, m.altFallback)}
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover transition-transform duration-[800ms] ease-out-smc hover:scale-105"
                />
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
