import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CalendarDays } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Carousel } from '@/components/brand/Carousel';
import { CardMedia, CardShell, StretchedLink } from '@/components/brand/CardShell';
import { Eyebrow } from '@/components/brand/Eyebrow';
import { UnderlineLink } from '@/components/brand/UnderlineLink';
import { RENDEZVOUS_2026_PATH, WEBINARS_PATH } from '@/components/brand/m3Events';
import { Counter } from '@/components/motion/Counter';
import { LineReveal } from '@/components/motion/LineReveal';
import { Reveal } from '@/components/motion/Reveal';
import { WYS26_PATH, wys26Upcoming } from '@/components/events/WysInvitationCard';
import { SITE_IMAGES } from '@/lib/siteMedia';
import { THEMES } from '@/lib/themes';
import { TeaserButton } from './TeaserDialog';

/**
 * "Our events": the three M3 meeting points as large photo cards in a horizontal
 * carousel (CSS scroll-snap, mouse drag, previous / next buttons, dots, keyboard,
 * touch swipe: see Carousel). The platform is not the Rendezvous' own site, so all
 * three stand side by side:
 *
 *  1. the Monaco Smart & Sustainable Marina Rendezvous: the 6th edition (20–21
 *     Sept 2026, more than 250 participants), the 7th in 2027, the teaser (click
 *     only) and the official site;
 *  2. the World Yachting Summit, Dubai, 27 Nov 2026, conference and gala by
 *     invitation (→ /wys26, "Request an invitation"), while it is upcoming;
 *  3. webinars and replays, online all year.
 *
 * The cards reveal as they scroll into view and lift on hover (CardShell). No
 * patronage line (its wording is not checked yet).
 */
const OFFICIAL_SITE = 'https://sustainablesmartmarina.com';

const TITLE = 'mt-4 text-[28px] font-semibold leading-[34px] tracking-[-0.02em] md:text-[34px] md:leading-[40px]';
const TEXT = 'text-[15px] leading-[24px] text-white/85 md:text-base md:leading-[25px]';
const CHIP =
  'inline-flex h-8 items-center gap-2 rounded-full border border-white/[.28] bg-white/[.14] px-3.5 text-[13px] font-semibold text-white backdrop-blur-[14px]';

/** The small pill over a photo: gold dot, white words. */
function Kicker({ children }: { children: ReactNode }) {
  return (
    <p className={CHIP}>
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-gold" />
      {children}
    </p>
  );
}

/** One large photo card: a photo with a navy veil, the title as the card's link, the rest below. */
function EventCardLarge({
  image,
  focusY = 0.5,
  kicker,
  title,
  titleId,
  to,
  children,
}: {
  image: string | null;
  focusY?: number;
  kicker: string;
  title: string;
  titleId: string;
  to: string;
  children: ReactNode;
}) {
  return (
    <Reveal className="flex w-full min-w-0">
      <CardShell as="article" interactive tone="navy" className="min-h-[560px] flex-1 rounded-[24px] md:min-h-[620px]">
        <CardMedia className="absolute inset-0">
          {image && (
            <img
              src={image}
              alt=""
              loading="lazy"
              draggable={false}
              className="h-full w-full max-w-none object-cover"
              style={{ objectPosition: `50% ${Math.round(focusY * 100)}%` }}
            />
          )}
        </CardMedia>
        <span
          aria-hidden="true"
          className="absolute inset-0 bg-[linear-gradient(180deg,rgba(8,29,64,.74)_0%,rgba(8,29,64,.5)_32%,rgba(8,29,64,.9)_78%,rgba(8,29,64,.96)_100%)]"
        />
        <div className="relative flex flex-1 flex-col justify-between gap-8 p-6 md:p-8">
          <div>
            <Kicker>{kicker}</Kicker>
            <h3 id={titleId} className={TITLE}>
              <StretchedLink to={to} tone="light">
                {title}
              </StretchedLink>
            </h3>
          </div>
          <div>{children}</div>
        </div>
      </CardShell>
    </Reveal>
  );
}

export function EventsCarousel({ sectionNo }: { sectionNo?: string }) {
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
              {t('homePage.events.intro', 'Conferences in Monaco and Dubai, webinars online, and replays in the library.')}
            </p>
            <UnderlineLink to="/events" className="mt-3">
              {t('homePage.events.all', 'All events')}
            </UnderlineLink>
          </Reveal>
        </div>

        <Carousel
          className="mt-10 md:mt-12"
          label={t('homePage.events.carouselLabel', 'M3 events')}
          slideClassName="w-[88%] sm:w-[62%] lg:w-[46%]"
        >
          {/* 1 · The Rendezvous, Monaco */}
          <EventCardLarge
            image={SITE_IMAGES.aboutHero.src}
            focusY={0.55}
            kicker={t('homePage.events.rendezvousKicker', 'Monaco · Yacht Club de Monaco')}
            title={rendezvousTitle}
            titleId="home-event-rendezvous"
            to={RENDEZVOUS_2026_PATH}
          >
            <p className={TEXT}>
              {t(
                'homePage.events.rendezvousBody',
                'Our biggest meeting point, every year in Monaco: conferences, workshops, an exhibition, Innovation pitches, architect presentations and the Monaco Smart & Sustainable Marina Awards ceremony.',
              )}
            </p>
            <dl className="mt-6 grid grid-cols-3 gap-x-4">
              <Fig label={t('homePage.events.figEdition', 'Latest edition')} n="6th" l={t('homePage.events.figEditionSub', 'edition, 20–21 Sept 2026')} />
              <Fig label={t('homePage.events.figParticipants', 'Participants')} l={t('homePage.events.figParticipantsSub', 'participants')}>
                <span aria-hidden="true">
                  <span className="mr-1 align-middle text-[.5em]">{t('homePage.events.moreThan', 'more than')}</span>
                  <Counter value={250} />
                </span>
                <span className="sr-only">{t('homePage.events.moreThan250', 'more than 250')}</span>
              </Fig>
              <Fig label={t('homePage.events.figNext', 'Next edition')} n="2027" l={t('homePage.events.figNextSub', '7th edition')} />
            </dl>
            <div className="relative z-10 mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
              <Button asChild variant="ctaLight">
                <Link to={RENDEZVOUS_2026_PATH}>{t('brand.events.rendezvous.cta', 'Relive the 6th edition')}</Link>
              </Button>
              <TeaserButton />
              <UnderlineLink href={OFFICIAL_SITE} external tone="light">
                {t('homePage.events.officialSite', 'Official site')}
              </UnderlineLink>
            </div>
          </EventCardLarge>

          {/* 2 · The World Yachting Summit, Dubai (while it is upcoming) */}
          {wys && (
            <EventCardLarge
              image={SITE_IMAGES.resourcesHero.src}
              focusY={SITE_IMAGES.resourcesHero.focusY}
              kicker={t('homePage.events.wysKicker', 'Dubai · Next event')}
              title={wysTitle}
              titleId="home-event-wys"
              to={WYS26_PATH}
            >
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
              <div className="relative z-10 mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
                <Button asChild variant="ctaLight">
                  <Link to={WYS26_PATH}>{t('homePage.events.wysRequest', 'Request an invitation')}</Link>
                </Button>
              </div>
            </EventCardLarge>
          )}

          {/* 3 · Webinars and replays, online */}
          <EventCardLarge
            image={digital?.image ?? null}
            focusY={digital?.imageFocusY ?? 0.5}
            kicker={t('homePage.events.webinarsKicker', 'Online · All year round')}
            title={t('brand.events.webinars.title', 'Webinars & replays')}
            titleId="home-event-webinars"
            to={WEBINARS_PATH}
          >
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
            <div className="relative z-10 mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
              <Button asChild variant="ctaLight">
                <Link to={WEBINARS_PATH}>{t('brand.events.webinars.cta', 'See the webinars')}</Link>
              </Button>
              <UnderlineLink href="#newsletter" tone="light">
                {t('homePage.events.newsletter', 'Subscribe to the newsletter')}
              </UnderlineLink>
            </div>
          </EventCardLarge>
        </Carousel>
      </div>
    </section>
  );
}

/** One figure of the Rendezvous card: a large light number (or its own children) and a small line. */
function Fig({ label, n, l, children }: { label: string; n?: string; l: string; children?: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="sr-only">{label}</dt>
      <dd>
        <span className="tabular block text-[28px] font-light leading-[32px] tracking-[-0.02em] md:text-[36px] md:leading-[40px]">{n ?? children}</span>
        <span className="block text-[12px] leading-4 text-white/80 md:text-[13px] md:leading-[17px]">{l}</span>
      </dd>
    </div>
  );
}
