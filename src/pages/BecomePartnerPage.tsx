import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Seo } from '@/components/seo/Seo';
import { Button } from '@/components/ui/button';
import { AuthDialog } from '@/components/auth/AuthDialog';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { SignupForm } from '@/components/auth/SignupForm';
import { useAuth } from '@/contexts/AuthContext';
import { PersonaType } from '@/types/database';
import { useNetworkFigures, formatFigure } from '@/lib/networkStats';
import { withSiteSuffix } from '@/lib/seoText';
import { PageHero } from '@/components/ui/PageHero';
import { SITE_IMAGES, PERSONA_IMAGES } from '@/lib/siteMedia';
import { CardShell } from '@/components/brand/CardShell';
import { BgRevealPanel } from '@/components/brand/BgRevealPanel';
import { Eyebrow } from '@/components/brand/Eyebrow';
import { ChannelSteps } from '@/components/motion/ChannelSteps';
import { Counter } from '@/components/motion/Counter';
import { LineReveal } from '@/components/motion/LineReveal';
import { useMotion } from '@/components/motion/MotionProvider';
import { Reveal, RevealGroup } from '@/components/motion/Reveal';
import { CheckList, PhotoFrame, SectionHead, useScrollToHash } from '@/components/content/ContentParts';
import { BookOpen, Globe, CalendarDays, UserPlus, Users } from 'lucide-react';
import { registerCopyStrings } from '@/i18n/refonte-copy';
import { cn } from '@/lib/utils';

registerCopyStrings();

/**
 * Join the network, on the v2 kit. The sign-up itself is unchanged: the same
 * dialog, the same SignupForm with the profile pre-selected, the same redirects
 * for someone who is already signed in.
 *
 *   hero: the four profiles as links to their chapter (a /join#media link
 *         from another page lands on the chapter; served at /join since the
 *         design audit of 8 Oct 2026, /become-partner redirects here)
 *   one chapter per profile: marina, service provider, investor & developer
 *         (two sign-up buttons), media: a photo, what the profile can do (the
 *         rights grid validated on 6–7 Oct 2026, as on the home page), "Sign up as…"
 *   how it works: ChannelSteps (sign up, describe your company, M3 checks, use the network)
 *   why Smart Marina Connect: four reasons and the live figures
 *   questions, then a last panel to sign up
 *
 * The footer's own "Join" band is hidden on this page (Footer.tsx), so the last
 * panel is the closing call to action.
 */

interface Chapter {
  id: string;
  /** Eyebrow word ("Marinas"). */
  label: string;
  title: string;
  intro: string[];
  image: string | null;
  focusY: number;
  can: string[];
  ctas: { persona: PersonaType; label: string }[];
}

export function BecomePartnerPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { hash } = useLocation();
  const { reduced } = useMotion();
  const { user, profile } = useAuth();
  const [signupOpen, setSignupOpen] = useState(false);
  const [selectedPersonaType, setSelectedPersonaType] = useState<PersonaType | undefined>(undefined);

  useScrollToHash(hash, reduced);

  // Same figures as the homepage: live counts, unless an admin has set
  // display_stats.override. The copy quotes them too, so no sentence promises
  // "500+ marinas" while the band below says 180.
  const { figures } = useNetworkFigures();
  const figureItems: [string, number | null, string][] = [
    ['marinas', figures.marinas, t('homeSections.stats.marinas', 'Marinas listed')],
    ['providers', figures.partners, t('homeSections.stats.suppliers', 'Service providers')],
    ['countries', figures.countries, t('becomePartner.stats.countries', 'Countries')],
  ];

  // What each profile can do: the home page's rights grid (homePage.profiles.*).
  const connect = t('homePage.profiles.connect', 'Request introductions and propose a webinar');
  const chapters: Chapter[] = [
    {
      id: 'marina',
      label: t('contentPages.join.marinaPill', 'Marinas'),
      title: t('staticPages.join.marina.title'),
      intro: [t('staticPages.join.marina.intro')],
      image: PERSONA_IMAGES.marinas,
      focusY: 0.5,
      can: [
        t('homePage.profiles.marinas.can1', 'Publish your tenders, expert questions and projects'),
        t('homePage.profiles.marinas.can2', 'Find service providers by theme and country'),
        t('homePage.profiles.marinas.can3', 'Browse the opportunities published on the platform'),
        connect,
      ],
      ctas: [{ persona: 'marina', label: t('join.marina.cta') }],
    },
    {
      id: 'service-provider',
      label: t('contentPages.join.providerPill', 'Service providers'),
      title: t('staticPages.join.provider.title'),
      // No audience figure here: few of the listed marinas have an account yet,
      // so "visibility to N marinas" would promise more than the network gives.
      intro: [t('staticPages.join.provider.intro')],
      image: PERSONA_IMAGES.suppliers,
      focusY: 0.5,
      can: [
        t('homePage.profiles.providers.can1', 'Read the needs marinas publish and answer them'),
        t('homePage.profiles.providers.can2', 'Present your company in the directory'),
        connect,
        t('homePage.profiles.providers.can3', 'Sponsor an event for more visibility'),
      ],
      ctas: [{ persona: 'partner', label: t('join.partner.cta') }],
    },
    {
      id: 'investor-developer',
      label: t('contentPages.join.investorPill', 'Investors & developers'),
      title: t('staticPages.join.investorDeveloper.title'),
      intro: [
        t('staticPages.join.investorDeveloper.investors'),
        t('staticPages.join.investorDeveloper.developers'),
      ],
      image: SITE_IMAGES.opportunitiesHero.src,
      focusY: SITE_IMAGES.opportunitiesHero.focusY,
      can: [
        t('homePage.profiles.investors.can1', 'Follow the projects and tenders marinas publish'),
        t('homePage.profiles.investors.can2', 'Investors: publish your investment thesis'),
        t('homePage.profiles.investors.can3', 'Developers: publish the needs of your own projects'),
        connect,
      ],
      ctas: [
        { persona: 'investor', label: t('join.investor.cta', 'Sign up as an investor') },
        { persona: 'developer', label: t('join.developer.cta', 'Sign up as a developer') },
      ],
    },
    {
      id: 'media',
      label: t('contentPages.join.mediaPill', 'Media'),
      title: t('staticPages.join.media.title'),
      intro: [t('staticPages.join.media.intro')],
      image: PERSONA_IMAGES.media,
      focusY: 0.5,
      can: [
        t('homePage.profiles.media.can1', 'Write to the M3 team about press accreditation for our events'),
        t('homePage.profiles.media.can2', "Follow the sector's articles, opportunities and replays"),
        connect,
      ],
      ctas: [{ persona: 'media_partner', label: t('join.mediaPartner.cta') }],
    },
  ];

  const platformBenefits = [
    {
      icon: Globe,
      title: t('staticPages.join.why.b1Title'),
      desc: figures.countries !== null
        ? t('staticPages.join.why.b1DescLive', { countries: formatFigure(figures.countries, figures.manual, i18n.language) })
        : t('staticPages.join.why.b1Desc'),
    },
    { icon: CalendarDays, title: t('staticPages.join.why.b2Title'), desc: t('staticPages.join.why.b2Desc') },
    { icon: BookOpen, title: t('staticPages.join.why.b3Title'), desc: t('staticPages.join.why.b3Desc') },
    { icon: Users, title: t('staticPages.join.why.b4Title'), desc: t('staticPages.join.why.b4Desc') },
  ];

  const processSteps = [
    { title: t('staticPages.join.steps.step1Title'), body: t('staticPages.join.steps.step1Body') },
    { title: t('staticPages.join.steps.step2Title'), body: t('staticPages.join.steps.step2Body') },
    { title: t('staticPages.join.steps.step3Title'), body: t('staticPages.join.steps.step3Body') },
    { title: t('staticPages.join.steps.step4Title'), body: t('staticPages.join.steps.step4Body') },
  ];

  const faqItems = [1, 2, 3, 4, 5, 6, 7].map((n) => ({
    q: t(`staticPages.join.faq.q${n}`),
    a: t(`staticPages.join.faq.a${n}`),
  }));

  const seoTitle = withSiteSuffix(t('seo.join.title', 'Join the marina industry network'));
  const seoDescription = t('seo.join.description', 'Marina, service provider, investor, developer or media: sign up for free. The M3 team reviews your company, then opens the features of your profile.');

  // A member who is already signed in has nothing to sign up for: a draft finishes the sign-up, everyone else goes to their space.
  const mySpacePath = !profile || profile.onboarding_status === 'draft' ? '/onboarding' : '/dashboard';

  const handleJoin = (persona?: PersonaType) => {
    if (user) {
      navigate(mySpacePath);
    } else {
      setSelectedPersonaType(persona);
      setSignupOpen(true);
    }
  };

  return (
    <div>
      <Seo title={seoTitle} description={seoDescription} path="/join" />

      {/* Hero — a conversation at an SM26 stand: the network, in person */}
      <PageHero
        image={SITE_IMAGES.joinHero}
        seed="join-hero"
        icon={UserPlus}
        eyebrow={t('contentPages.join.eyebrow', 'Free for every member')}
        title={t('join.heroTitle')}
        subtitle={t('staticPages.join.heroSubtitle')}
      >
        <nav aria-label={t('contentPages.join.jumpLabel', 'Go to a profile')}>
          <ul className="flex flex-wrap gap-2">
            {chapters.map((c) => (
              <li key={c.id}>
                <a
                  href={`#${c.id}`}
                  className="inline-flex h-10 items-center rounded-pill bg-white/15 px-4 text-sm font-medium text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,.3)] backdrop-blur-md transition-colors duration-300 hover:bg-white hover:text-navy focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_rgb(8,29,64),0_0_0_4px_#fff]"
                >
                  {c.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </PageHero>

      {/* One chapter per profile */}
      {chapters.map((c, i) => {
        const flip = i % 2 === 1;
        const number = String(i + 1).padStart(2, '0');
        return (
          <section
            key={c.id}
            id={c.id}
            aria-labelledby={`${c.id}-title`}
            className={cn('py-16 md:py-[104px]', flip ? 'bg-page' : 'bg-white')}
          >
            <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 sm:px-6 lg:grid-cols-12 lg:gap-16">
              <Reveal className={cn('lg:col-span-5', flip ? 'lg:order-2 lg:col-start-8' : 'lg:order-1')}>
                <PhotoFrame src={c.image} focusY={c.focusY} aspect="aspect-[4/3]" />
              </Reveal>
              <div className={cn('min-w-0 lg:col-span-6', flip ? 'lg:order-1' : 'lg:order-2 lg:col-start-7')}>
                <Reveal>
                  <Eyebrow number={number}>{c.label}</Eyebrow>
                </Reveal>
                <LineReveal
                  as="h2"
                  id={`${c.id}-title`}
                  className="mt-4 text-balance text-[26px] font-semibold leading-8 tracking-[-0.02em] text-navy md:text-[40px] md:leading-[48px]"
                >
                  {c.title}
                </LineReveal>
                <Reveal delay={120}>
                  <div className="mt-4 grid max-w-xl gap-3 text-body md:text-body-lg text-ink">
                    {c.intro.map((p) => <p key={p}>{p}</p>)}
                  </div>
                  <h3 className="text-meta-caps mt-8">{t('homePage.profiles.canTitle', 'What you can do')}</h3>
                  <CheckList items={c.can} className="mt-4 max-w-xl" />
                  <div className="mt-8 flex flex-wrap gap-3">
                    {user ? (
                      <Button variant="cta" onClick={() => handleJoin()}>{t('join.accessMySpace')}</Button>
                    ) : c.ctas.map((cta, k) => (
                      <Button key={cta.persona} variant={k === 0 ? 'cta' : 'ctaOutline'} onClick={() => handleJoin(cta.persona)}>
                        {cta.label}
                      </Button>
                    ))}
                  </div>
                </Reveal>
              </div>
            </div>
          </section>
        );
      })}

      {/* How it works */}
      <section aria-labelledby="join-steps" className="bg-foam py-16 md:py-[104px]">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <SectionHead
            id="join-steps"
            number="05"
            eyebrow={t('contentPages.join.stepsEyebrow', 'Getting started')}
            title={t('staticPages.join.steps.title')}
            intro={t('staticPages.join.steps.intro')}
          />
          <ChannelSteps className="mt-10 md:mt-12" steps={processSteps} />
        </div>
      </section>

      {/* Why Smart Marina Connect, and the network in figures */}
      <section aria-labelledby="join-why" className="bg-white py-16 md:py-[104px]">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <SectionHead
            id="join-why"
            number="06"
            eyebrow={t('contentPages.join.whyEyebrow', 'The network')}
            title={t('staticPages.join.why.title')}
          />
          <RevealGroup as="ul" className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4 md:mt-12">
            {platformBenefits.map((b) => (
              <li key={b.title} className="flex min-w-0">
                <CardShell className="w-full p-6">
                  <span aria-hidden="true" className="grid h-12 w-12 place-items-center rounded-field bg-chip text-navy">
                    <b.icon className="h-6 w-6" />
                  </span>
                  <h3 className="mt-5 text-card-title text-navy">{b.title}</h3>
                  <p className="mt-2 text-body text-meta">{b.desc}</p>
                </CardShell>
              </li>
            ))}
          </RevealGroup>
        </div>

        <BgRevealPanel bathy bathySeed={6} className="mt-14 py-12 md:mt-20 md:py-16" aria-label={t('contentPages.about.figuresLabel', 'The network in figures')}>
          <dl className="mx-auto flex max-w-7xl flex-wrap justify-center gap-y-8 px-4 sm:px-6">
            {figureItems.map(([key, value, label], i) => (
              <div key={key} className={cn('flex min-w-0 flex-col-reverse items-center px-6 text-center md:px-14', i > 0 && 'md:border-l md:border-white/20')}>
                <dt className="mt-1 text-[13px] leading-[18px] text-white/80">{label}</dt>
                <dd className="text-[40px] font-light leading-[44px] tracking-[-0.02em] text-white md:text-[56px] md:leading-[60px]">
                  <Counter value={value} suffix={figures.manual ? '+' : ''} />
                </dd>
              </div>
            ))}
          </dl>
        </BgRevealPanel>
      </section>

      {/* Questions */}
      <section aria-labelledby="join-faq" className="bg-page py-16 md:py-[104px]">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-12 lg:gap-16">
          <SectionHead
            id="join-faq"
            number="07"
            eyebrow={t('contentPages.join.faqEyebrow', 'Questions')}
            title={t('staticPages.join.faq.title')}
            intro={t('staticPages.join.faq.subtitle')}
            className="lg:col-span-5"
          />
          <Reveal delay={120} className="lg:col-span-7">
            <Accordion type="single" collapsible className="space-y-3">
              {faqItems.map((item, i) => (
                <AccordionItem key={i} value={`faq-${i}`} className="rounded-card border border-rule bg-white px-5 data-[state=open]:shadow-hover">
                  <AccordionTrigger className="py-5 text-left text-[17px] font-semibold leading-6 text-navy hover:no-underline">
                    {item.q}
                  </AccordionTrigger>
                  <AccordionContent className="text-body text-ink">
                    {item.a}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </Reveal>
        </div>
      </section>

      {/* Closing call to action: the footer's join band is not shown on this page. */}
      <section aria-labelledby="join-ready" className="bg-white pb-16 pt-16 md:pb-24 md:pt-[104px]">
        <BgRevealPanel bathy bathySeed={4} className="py-14 md:py-20">
          <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
            <Eyebrow tone="onDark" className="justify-center">{t('contentPages.join.readyEyebrow', 'Ready?')}</Eyebrow>
            <h2 id="join-ready" className="mt-4 text-balance text-[26px] font-semibold leading-8 tracking-[-0.02em] text-white md:text-[40px] md:leading-[48px]">
              {t('staticPages.join.ready.title')}
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-body md:text-body-lg text-white/80">{t('staticPages.join.ready.subtitle')}</p>
            <div className="mt-8 flex justify-center">
              {user ? (
                <Button variant="ctaOnDark" onClick={() => navigate(mySpacePath)}>
                  {t('join.accessMySpace')}
                </Button>
              ) : (
                <Button variant="ctaOnDark" onClick={() => setSignupOpen(true)}>
                  {t('join.createAccount')}
                </Button>
              )}
            </div>
          </div>
        </BgRevealPanel>
      </section>

      {/* Signup Dialog */}
      <AuthDialog mode="signup" open={signupOpen} onOpenChange={setSignupOpen} title={t('join.signupTitle')} description={t('join.signupDesc')}>
        <SignupForm defaultPersona={selectedPersonaType} onSuccess={() => { setSignupOpen(false); navigate('/onboarding'); }} />
      </AuthDialog>
    </div>
  );
}
