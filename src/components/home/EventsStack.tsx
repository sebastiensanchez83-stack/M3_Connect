import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CalendarDays } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ArrowDisc } from '@/components/brand/ArrowDisc';
import { Eyebrow } from '@/components/brand/Eyebrow';
import { UnderlineLink } from '@/components/brand/UnderlineLink';
import { StickyStack, StickyStackBody, StickyStackMedia } from '@/components/brand/StickyStack';
import { RENDEZVOUS_2026_PATH, WEBINARS_PATH } from '@/components/brand/m3Events';
import { Counter } from '@/components/motion/Counter';
import { LineReveal } from '@/components/motion/LineReveal';
import { Reveal } from '@/components/motion/Reveal';
import { WYS26_PATH, wys26Upcoming } from '@/components/events/WysInvitationCard';
import { SITE_IMAGES } from '@/lib/siteMedia';
import { THEMES } from '@/lib/themes';
import { TeaserButton } from './TeaserDialog';

/**
 * "Our events": the three M3 meeting points as large photo cards that pile up
 * as the page scrolls (StickyStack). The platform is not the Rendezvous' own
 * site, so all three stand side by side:
 *
 *  1. the Monaco Smart & Sustainable Marina Rendezvous: the first and largest
 *     card, with its validated figures only (6th edition, 20–21 Sept 2026, more
 *     than 250 participants, 2 days, 7th edition in 2027), the teaser (click
 *     only) and the official site;
 *  2. the World Yachting Summit, Dubai, 27 Nov 2026, conference and gala by
 *     invitation (→ /wys26), while it is upcoming;
 *  3. webinars and replays, online all year.
 *
 * No patronage line (its wording is not checked yet).
 */
const OFFICIAL_SITE = 'https://sustainablesmartmarina.com';

const TITLE = 'mt-4 max-w-[760px] text-[28px] font-semibold leading-8 tracking-[-0.02em] md:text-[48px] md:leading-[52px]';
const TEXT = 'max-w-[600px] text-base leading-[25px] text-white/85 md:text-[17px] md:leading-[27px]';
const CHIP =
  'inline-flex h-8 items-center gap-2 rounded-full border border-white/[.28] bg-white/[.14] px-3.5 text-[13px] font-semibold text-white backdrop-blur-[14px]';

/** The small pill over a photo: gold dot, white words. */
function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <p className={CHIP}>
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-gold" />
      {children}
    </p>
  );
}

/** The card's round arrow: the page of the event (the card is the hover trigger). */
function CardArrow({ to, label }: { to: string; label: string }) {
  return (
    <Link to={to} aria-label={label} className="focus-ring shrink-0 rounded-full">
      <ArrowDisc tone="photo" />
    </Link>
  );
}

export function EventsStack({ sectionNo }: { sectionNo?: string }) {
  const { t } = useTranslation();
  const wys = wys26Upcoming(Date.now());
  const rendezvousTitle = t('brand.events.rendezvous.title', 'Monaco Smart & Sustainable Marina Rendezvous');
  const wysTitle = t('brand.events.wys.title', 'World Yachting Summit');
  const digital = THEMES.find((th) => th.key === 'digital');

  return (
    <section aria-labelledby="home-events-heading" className="bg-page pb-16 pt-10 md:pb-[104px] md:pt-16">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="grid gap-6 lg:grid-cols-12 lg:items-end">
          <div className="lg:col-span-8">
            <Reveal>
              <Eyebrow number={sectionNo}>{t('homePage.events.eyebrow', 'Our events')}</Eyebrow>
            </Reveal>
            <LineReveal
              as="h2"
              id="home-events-heading"
              className="mt-4 text-balance text-[26px] font-semibold leading-8 tracking-[-0.02em] text-navy md:text-[40px] md:leading-[48px]"
            >
              {t('homePage.events.title', 'In Monaco, in Dubai and online: the M3 events for the industry')}
            </LineReveal>
          </div>
          <Reveal delay={120} className="lg:col-span-4">
            <p className="text-base leading-[26px] text-ink">
              {t('homePage.events.intro', 'Registering for one of our events also creates your Smart Marina Connect account.')}
            </p>
            <UnderlineLink to="/events" className="mt-3">
              {t('homePage.events.all', 'All events')}
            </UnderlineLink>
          </Reveal>
        </div>

        <StickyStack className="mt-10 md:mt-14">
          {/* 1 · The Rendezvous, Monaco */}
          <article aria-labelledby="home-event-rendezvous" className="has-ra relative flex flex-1 flex-col">
            <StickyStackMedia image={SITE_IMAGES.aboutHero.src} focusY={0.55} />
            <StickyStackBody>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <Kicker>{t('homePage.events.rendezvousKicker', 'Monaco · Yacht Club de Monaco')}</Kicker>
                  <h3 id="home-event-rendezvous" className={TITLE}>
                    {rendezvousTitle}
                  </h3>
                </div>
                <CardArrow to={RENDEZVOUS_2026_PATH} label={t('homePage.events.pageOf', { title: rendezvousTitle, defaultValue: 'Event page: {{title}}' })} />
              </div>
              <div>
                <p className={TEXT}>
                  {t(
                    'homePage.events.rendezvousBody',
                    'Our biggest meeting point, every year in Monaco: conferences, workshops, an exhibition, Innovation pitches, architect presentations and the Monaco Smart & Sustainable Marina Awards ceremony.',
                  )}
                </p>
                <dl className="mt-6 grid grid-cols-2 gap-x-5 gap-y-3 md:grid-cols-[repeat(4,minmax(0,auto))] md:justify-start md:gap-x-10">
                  <Fig label={t('homePage.events.figEdition', 'Latest edition')} n="6th" l={t('homePage.events.figEditionSub', 'edition, 20–21 Sept 2026')} />
                  <Fig label={t('homePage.events.figParticipants', 'Participants')} l={t('homePage.events.figParticipantsSub', 'participants')}>
                    <span aria-hidden="true">
                      <span className="mr-1 align-middle text-[.55em]">{t('homePage.events.moreThan', 'more than')}</span>
                      <Counter value={250} />
                    </span>
                    <span className="sr-only">{t('homePage.events.moreThan250', 'more than 250')}</span>
                  </Fig>
                  <Fig label={t('homePage.events.figDuration', 'Duration')} l={t('homePage.events.figDurationSub', 'days at the Yacht Club de Monaco')}>
                    <span aria-hidden="true">
                      <Counter value={2} />
                    </span>
                    <span className="sr-only">2</span>
                  </Fig>
                  <Fig label={t('homePage.events.figNext', 'Next edition')} n="2027" l={t('homePage.events.figNextSub', '7th edition')} />
                </dl>
                <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
                  <Button asChild variant="ctaLight">
                    <Link to={RENDEZVOUS_2026_PATH}>{t('brand.events.rendezvous.cta', 'Relive the 6th edition')}</Link>
                  </Button>
                  <TeaserButton />
                  <UnderlineLink href={OFFICIAL_SITE} external tone="light">
                    {t('homePage.events.officialSite', 'Official site')}
                  </UnderlineLink>
                </div>
              </div>
            </StickyStackBody>
          </article>

          {/* 2 · The World Yachting Summit, Dubai (while it is upcoming) */}
          {wys && (
            <article aria-labelledby="home-event-wys" className="has-ra relative flex flex-1 flex-col">
              <StickyStackMedia image={SITE_IMAGES.resourcesHero.src} focusY={SITE_IMAGES.resourcesHero.focusY} />
              <StickyStackBody>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <Kicker>{t('homePage.events.wysKicker', 'Dubai · Next event')}</Kicker>
                    <h3 id="home-event-wys" className={TITLE}>
                      {wysTitle}
                    </h3>
                  </div>
                  <CardArrow to={WYS26_PATH} label={t('homePage.events.pageOf', { title: wysTitle, defaultValue: 'Event page: {{title}}' })} />
                </div>
                <div>
                  <p className={TEXT}>
                    {t(
                      'homePage.events.wysBody',
                      'On 27 November 2026 in Dubai: a conference followed by a gala dinner, by invitation. M3 Monaco brings together the people of yachting and marinas.',
                    )}
                  </p>
                  <ul className="mt-6 flex flex-wrap gap-2">
                    <li className={CHIP}>
                      <CalendarDays className="h-[15px] w-[15px]" aria-hidden="true" />
                      {t('homePage.events.wysDate', '27 Nov 2026')}
                    </li>
                    <li className={CHIP}>{t('homePage.agenda.wysFormat', 'Conference and gala')}</li>
                    <li className={CHIP}>{t('brand.board.statusInvitation', 'By invitation')}</li>
                  </ul>
                  <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
                    <Button asChild variant="ctaLight">
                      <Link to={WYS26_PATH}>{t('homePage.events.wysCta', 'Discover the Summit')}</Link>
                    </Button>
                  </div>
                </div>
              </StickyStackBody>
            </article>
          )}

          {/* 3 · Webinars and replays, online */}
          <article aria-labelledby="home-event-webinars" className="has-ra relative flex flex-1 flex-col">
            <StickyStackMedia image={digital?.image ?? null} focusY={digital?.imageFocusY ?? 0.5} />
            <StickyStackBody>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <Kicker>{t('homePage.events.webinarsKicker', 'Online · All year round')}</Kicker>
                  <h3 id="home-event-webinars" className={TITLE}>
                    {t('brand.events.webinars.title', 'Webinars & replays')}
                  </h3>
                </div>
                <CardArrow to={WEBINARS_PATH} label={t('homePage.events.webinarsPage', 'See the webinars')} />
              </div>
              <div>
                <p className={TEXT}>
                  {t(
                    'homePage.events.webinarsBody',
                    'Marinas and service providers present their projects online. Once you are signed in, registering takes one click, and the replays stay available.',
                  )}
                </p>
                <ul className="mt-6 flex flex-wrap gap-2">
                  <li className={CHIP}>{t('brand.board.online', 'Online')}</li>
                  <li className={CHIP}>{t('homePage.events.webinarsChip', 'One-click registration once signed in')}</li>
                  <li className={CHIP}>{t('homePage.events.replays', 'Replays')}</li>
                </ul>
                <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
                  <Button asChild variant="ctaLight">
                    <Link to={WEBINARS_PATH}>{t('brand.events.webinars.cta', 'See the webinars')}</Link>
                  </Button>
                  <UnderlineLink href="#newsletter" tone="light">
                    {t('homePage.events.newsletter', 'Get the dates by newsletter')}
                  </UnderlineLink>
                </div>
              </div>
            </StickyStackBody>
          </article>
        </StickyStack>
      </div>
    </section>
  );
}

/** One figure of the Rendezvous card: a large light number (or its own children) and a small line. */
function Fig({ label, n, l, children }: { label: string; n?: string; l: string; children?: React.ReactNode }) {
  return (
    <div>
      <dt className="sr-only">{label}</dt>
      <dd>
        <span className="tabular block text-[30px] font-light leading-[34px] tracking-[-0.02em] md:text-[44px] md:leading-[48px]">{n ?? children}</span>
        <span className="block text-[13px] leading-[17px] text-white/80">{l}</span>
      </dd>
    </div>
  );
}
