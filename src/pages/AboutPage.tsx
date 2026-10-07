import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Seo } from '@/components/seo/Seo';
import { Anchor, Building2, BookOpen, Compass, Link2, Newspaper, ShieldCheck, UserCheck, MailCheck } from 'lucide-react';
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
import { CheckList, SectionHead } from '@/components/content/ContentParts';
import { useAuth } from '@/contexts/AuthContext';
import { useNetworkFigures } from '@/lib/networkStats';
import { SITE_IMAGES, PERSONA_IMAGES, SM26_MOMENTS } from '@/lib/siteMedia';
import { withSiteSuffix } from '@/lib/seoText';
import { registerCopyStrings } from '@/i18n/refonte-copy';
import { cn } from '@/lib/utils';

registerCopyStrings();

/**
 * About, on the v2 kit, as a short story in seven numbered chapters:
 *
 *   01 why the network exists, with its live figures
 *   02 what the platform holds (directory, opportunities, resources)
 *   03 what members can do, by profile (the validated rights lists, as on the
 *      home page and the join page), each card leading to its join chapter
 *   04 how the M3 team checks every member
 *   05 where M3 meets its members: the Rendezvous, the World Yachting Summit
 *      and the webinars, side by side
 *   06 the moments of the 6th edition of the Rendezvous
 *   07 M3 Monaco, the team, and the contact panel
 *
 * The footer's "Join the marina network" band closes the page for visitors, so
 * there is no second sign-up block here: the banner and the profile cards are
 * the way in.
 *
 * Copy: src/i18n/refonte-copy.ts (staticPages.about.*). Facts only.
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

  const platform = [
    {
      key: 'directory',
      icon: Building2,
      to: '/directory',
      title: t('staticPages.about.platform.directory.title'),
      desc: t('staticPages.about.platform.directory.desc'),
    },
    {
      key: 'opportunities',
      icon: Link2,
      to: '/opportunities',
      title: t('staticPages.about.platform.opportunities.title'),
      desc: t('staticPages.about.platform.opportunities.desc'),
    },
    {
      key: 'resources',
      icon: BookOpen,
      to: '/resources',
      title: t('staticPages.about.platform.resources.title'),
      desc: t('staticPages.about.platform.resources.desc'),
    },
  ];

  // The rights lists are the home page's (homePage.profiles.*): one wording everywhere.
  const profiles = [
    {
      key: 'marinas',
      icon: Anchor,
      image: PERSONA_IMAGES.marinas,
      focusY: 0.5,
      to: '/become-partner#marina',
      title: t('staticPages.about.profiles.marinas.title'),
      who: t('staticPages.about.profiles.marinas.who'),
      can: [
        t('homePage.profiles.marinas.can1', 'Publish your tenders, expert questions and projects'),
        t('homePage.profiles.marinas.can2', 'Find service providers by theme and country, checked by M3'),
        t('homePage.profiles.marinas.can3', 'See what other marinas are looking for'),
      ],
    },
    {
      key: 'providers',
      icon: Building2,
      image: PERSONA_IMAGES.suppliers,
      focusY: 0.5,
      to: '/become-partner#service-provider',
      title: t('staticPages.about.profiles.providers.title'),
      who: t('staticPages.about.profiles.providers.who'),
      can: [
        t('homePage.profiles.providers.can1', 'Read the needs marinas publish and answer them'),
        t('homePage.profiles.providers.can2', 'Present your company in the directory, checked by M3'),
        t('homePage.profiles.providers.can3', 'Sponsor an event for more visibility'),
      ],
    },
    {
      key: 'investors',
      icon: Compass,
      image: SITE_IMAGES.opportunitiesHero.src,
      focusY: SITE_IMAGES.opportunitiesHero.focusY,
      to: '/become-partner#investor-developer',
      title: t('staticPages.about.profiles.investors.title'),
      who: t('staticPages.about.profiles.investors.who'),
      can: [
        t('homePage.profiles.investors.can1', 'Follow the projects and tenders marinas publish'),
        t('homePage.profiles.investors.can2', 'Investors: publish your investment thesis'),
        t('homePage.profiles.investors.can3', 'Developers: publish the needs of your own projects'),
      ],
    },
    {
      key: 'media',
      icon: Newspaper,
      image: PERSONA_IMAGES.media,
      focusY: 0.5,
      to: '/become-partner#media',
      title: t('staticPages.about.profiles.media.title'),
      who: t('staticPages.about.profiles.media.who'),
      can: [
        t('homePage.profiles.media.can1', 'Request press accreditation for our events in Monaco and Dubai'),
        t('homePage.profiles.media.can2', "Follow the sector's articles, opportunities and replays"),
      ],
    },
  ];

  const checks = [
    {
      key: 'company',
      icon: ShieldCheck,
      title: t('staticPages.about.check.company.title'),
      desc: t('staticPages.about.check.company.desc'),
    },
    {
      key: 'person',
      icon: UserCheck,
      title: t('staticPages.about.check.person.title'),
      desc: t('staticPages.about.check.person.desc'),
    },
    {
      key: 'access',
      icon: MailCheck,
      title: t('staticPages.about.check.access.title'),
      desc: t('staticPages.about.check.access.desc'),
    },
  ];

  // M3's meeting points, side by side (the World Yachting Summit while it is upcoming).
  const meetingPoints = featuredEventItems(t);
  const meetingDesc: Record<string, string> = {
    wys26: t('staticPages.about.events.wys'),
    webinars: t('staticPages.about.events.webinars'),
    rendezvous: t('staticPages.about.events.rendezvous'),
  };

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
        subtitle={t('staticPages.about.hero.subtitle')}
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

      {/* 01 · Why it exists, with the network's live figures */}
      <section aria-labelledby="about-mission" className="bg-white py-16 md:py-[104px]">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="grid gap-8 lg:grid-cols-12 lg:gap-14">
            <SectionHead
              id="about-mission"
              number="01"
              eyebrow={t('staticPages.about.why.eyebrow')}
              title={t('staticPages.about.why.title')}
              className="lg:col-span-7"
            />
            <Reveal delay={160} className="lg:col-span-5 lg:pt-[34px]">
              <div className="grid gap-4 text-body md:text-body-lg text-ink">
                <p>{t('staticPages.about.why.body1')}</p>
                <p>{t('staticPages.about.why.body2')}</p>
              </div>
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

      {/* 02 · The platform */}
      <section aria-labelledby="about-do" className="bg-page py-16 md:py-[104px]">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <SectionHead
            id="about-do"
            number="02"
            eyebrow={t('staticPages.about.platform.eyebrow')}
            title={t('staticPages.about.platform.title')}
          />
          <RevealGroup as="ul" className="mt-10 grid gap-6 md:grid-cols-3 md:mt-12">
            {platform.map((item) => (
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

      {/* 03 · What members can do, by profile */}
      <section aria-labelledby="about-who" className="bg-white py-16 md:py-[104px]">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <SectionHead
            id="about-who"
            number="03"
            eyebrow={t('staticPages.about.profiles.eyebrow')}
            title={t('staticPages.about.profiles.title')}
            intro={t('staticPages.about.profiles.intro')}
          />
          {/* Photo cards: who each profile is, and what it can do. Side by side from sm, the photo on the left. */}
          <RevealGroup as="ul" className="mt-10 grid gap-6 md:grid-cols-2 md:mt-12">
            {profiles.map((p) => (
              <li key={p.key} className="flex min-w-0">
                <CardShell interactive className="w-full sm:flex-row">
                  <CardMedia className="aspect-[3/2] bg-navy sm:aspect-auto sm:w-[38%] sm:shrink-0">
                    {p.image && (
                      <img
                        src={p.image}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="absolute inset-0 h-full w-full object-cover"
                        style={{ objectPosition: `50% ${Math.round(p.focusY * 100)}%` }}
                      />
                    )}
                    <span aria-hidden="true" className="absolute left-3 top-3 grid h-10 w-10 place-items-center rounded-field bg-white/95 text-navy">
                      <p.icon className="h-5 w-5" />
                    </span>
                  </CardMedia>
                  <div className="flex min-w-0 flex-1 flex-col p-5 sm:p-6">
                    <h3 className="text-card-title text-navy">
                      <StretchedLink to={p.to}>{p.title}</StretchedLink>
                    </h3>
                    <p className="mt-2 text-sm leading-[22px] text-meta">{p.who}</p>
                    <CheckList items={p.can} className="mt-4 gap-2.5" />
                  </div>
                </CardShell>
              </li>
            ))}
          </RevealGroup>
        </div>
      </section>

      {/* 04 · How the M3 team checks every member */}
      <section aria-labelledby="about-check" className="bg-foam py-16 md:py-[104px]">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <SectionHead
            id="about-check"
            number="04"
            eyebrow={t('staticPages.about.check.eyebrow')}
            title={t('staticPages.about.check.title')}
            intro={t('staticPages.about.check.intro')}
          />
          <RevealGroup as="ul" className="mt-10 grid gap-6 md:grid-cols-3 md:mt-12">
            {checks.map((c) => (
              <li key={c.key} className="flex min-w-0">
                <CardShell className="w-full p-6 md:p-8">
                  <span aria-hidden="true" className="grid h-12 w-12 place-items-center rounded-field bg-chip text-navy">
                    <c.icon className="h-6 w-6" />
                  </span>
                  <h3 className="mt-5 text-card-title text-navy">{c.title}</h3>
                  <p className="mt-2 text-body text-meta">{c.desc}</p>
                </CardShell>
              </li>
            ))}
          </RevealGroup>
        </div>
      </section>

      {/* 05 · Where M3 meets its members */}
      <section aria-labelledby="about-events" className="bg-white py-16 md:py-[104px]">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
            <SectionHead
              id="about-events"
              number="05"
              eyebrow={t('staticPages.about.events.eyebrow')}
              title={t('staticPages.about.events.title')}
              intro={t('staticPages.about.events.intro')}
            />
            <UnderlineLink to="/events">{t('sm26Moments.cta', 'See upcoming events')}</UnderlineLink>
          </div>
          <RevealGroup
            as="ul"
            className={cn('mt-10 grid gap-6 md:mt-12', meetingPoints.length > 2 ? 'md:grid-cols-3' : 'md:grid-cols-2')}
          >
            {meetingPoints.map((item) => (
              <li key={item.id} className="flex min-w-0">
                <CardShell interactive className="w-full">
                  <CardMedia className="aspect-[3/2] bg-navy">
                    {item.image?.src && (
                      <img
                        src={item.image.src}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="h-full w-full object-cover"
                        style={{ objectPosition: `50% ${Math.round(item.image.focusY * 100)}%` }}
                      />
                    )}
                  </CardMedia>
                  <div className="flex flex-1 flex-col p-5 md:p-6">
                    <p className="text-[12px] font-semibold leading-4 tracking-[0.02em] text-teal-text">{item.kicker}</p>
                    <h3 className="mt-1 text-card-title text-navy">
                      <StretchedLink to={item.href}>{item.title}</StretchedLink>
                    </h3>
                    <p className="mt-2 text-sm leading-[22px] text-meta">{meetingDesc[item.id]}</p>
                  </div>
                </CardShell>
              </li>
            ))}
          </RevealGroup>
        </div>
      </section>

      {/* 06 · Relive the 6th edition of the Rendezvous: the network in person */}
      <section aria-labelledby="sm26-moments-heading" className="bg-page py-16 md:py-[104px]">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <SectionHead
            id="sm26-moments-heading"
            number="06"
            eyebrow={t('sm26Moments.eyebrow', '20–21 September 2026 · Yacht Club de Monaco')}
            title={t('sm26Moments.title', 'Relive the Monaco Smart & Sustainable Marina Rendezvous')}
          />
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
                  className="h-full w-full object-cover transition-transform [transition-duration:800ms] ease-out-smc hover:scale-105"
                />
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* 07 · M3 Monaco, the team, and who to write to */}
      <section aria-labelledby="about-m3" className="bg-white py-16 md:py-[104px]">
        <div className="mx-auto grid max-w-7xl gap-6 px-4 sm:px-6 lg:grid-cols-12">
          <Reveal className="lg:col-span-8">
            <div className="relative h-full overflow-hidden rounded-card bg-navy p-6 text-white sm:p-10">
              <BathyPattern seed={7} drift className="absolute inset-0" />
              <div className="relative">
                <Eyebrow tone="onDark" number="07">{t('staticPages.about.team.eyebrow')}</Eyebrow>
                <LineReveal as="h2" id="about-m3" className="mt-4 text-[26px] font-semibold leading-8 tracking-[-0.02em] text-white md:text-[40px] md:leading-[48px]">
                  {t('staticPages.about.team.title')}
                </LineReveal>
                <div className="mt-4 grid max-w-2xl gap-4 text-body text-white/85 md:text-body-lg">
                  <p>{t('staticPages.about.team.p1')}</p>
                  <p>{t('staticPages.about.team.p2')}</p>
                </div>
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
    </div>
  );
}
