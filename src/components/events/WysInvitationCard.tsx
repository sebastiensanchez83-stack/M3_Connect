import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight, CalendarDays, MapPin } from 'lucide-react';
import { CardMedia, CardShell, StretchedLink } from '@/components/brand/CardShell';
import { Button } from '@/components/ui/button';
import { BathyPattern } from '@/components/motion/BathyPattern';
import { Reveal } from '@/components/motion/Reveal';
import { CoverImage } from '@/components/ui/CoverImage';
import { SITE_IMAGES } from '@/lib/siteMedia';

/**
 * The World Yachting Summit 2026 (Dubai, 27 November 2026, by invitation).
 *
 * It runs on the guest-list module (gl_*), not in the events table, so the
 * events page and the home page never list it on their own: without this card
 * they said "no upcoming event announced" right under a hero that names it.
 * Shown until the summit is over, and never next to an events row that
 * already carries it (an admin may add one later).
 *
 * Two looks, one content: `variant="panel"` is the marine panel the events page
 * opens its programme with (when no other event is ahead of it); `variant="card"`
 * (default) is the same event as a white horizontal card, for when it follows
 * another one. The photo is provisional (the Rendezvous hall) until the Summit
 * has its own.
 *
 * /wys26 is printed and e-mailed: the card links to it, it never changes it.
 */
export const WYS26_PATH = '/wys26';
/** End of the summit day in Dubai (UTC+4): the card disappears after that. */
const WYS26_ENDS_AT = Date.parse('2026-11-28T00:00:00+04:00');

/** Whether the card should still show at `now` (ms). */
export function wys26Upcoming(now: number): boolean {
  return now < WYS26_ENDS_AT;
}

/** An events row that is the summit itself: the card then steps aside so it is not listed twice. */
export function isWys26Event(title: string | null | undefined): boolean {
  return !!title && /world yachting summit/i.test(title);
}

const GLASS_CHIP =
  'inline-flex h-8 items-center gap-2 rounded-pill border border-white/[.28] bg-white/[.14] px-3.5 text-[13px] font-semibold text-white backdrop-blur-[14px]';

export function WysInvitationCard({
  className,
  headingLevel = 'h3',
  variant = 'card',
}: {
  className?: string;
  headingLevel?: 'h2' | 'h3';
  variant?: 'card' | 'panel';
}) {
  const { t } = useTranslation();
  const Heading = headingLevel;
  const title = t('eventsPage.wys.title', 'World Yachting Summit');
  const cta = t('eventsPage.wys.cta', 'Request an invitation');
  const body = t('eventsPage.wys.body', 'A conference and a gala dinner organised by M3 Monaco, by invitation only.');
  const date = t('eventsPage.wys.date', '27 November 2026');
  const place = t('eventsPage.wys.place', 'Dubai');
  const badge = t('eventsPage.wys.badge', 'By invitation');

  if (variant === 'panel') {
    return (
      <Reveal className={className}>
        <CardShell as="article" interactive tone="navy" className="rounded-[24px]">
          <BathyPattern seed={5} drift className="absolute inset-0" />
          <div className="relative grid lg:grid-cols-12">
            <div className="order-2 flex min-w-0 flex-col p-6 sm:p-8 lg:order-1 lg:col-span-7 lg:p-10">
              <div className="flex flex-wrap items-center gap-2">
                <span className={GLASS_CHIP}>
                  <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-gold" />
                  {t('brand.notch.wysKicker', 'Next event')}
                </span>
                <span className={GLASS_CHIP}>{badge}</span>
              </div>
              <Heading className="mt-5 text-[28px] font-semibold leading-[34px] tracking-[-0.02em] md:text-[34px] md:leading-[40px]">
                <StretchedLink to={WYS26_PATH} tone="light">{title}</StretchedLink>
              </Heading>
              <ul className="mt-5 space-y-2.5 text-[15px] leading-6 text-white/90">
                <li className="flex items-start gap-2.5">
                  <CalendarDays className="mt-1 h-4 w-4 shrink-0 text-gold" aria-hidden="true" />
                  <span>{date}</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <MapPin className="mt-1 h-4 w-4 shrink-0 text-gold" aria-hidden="true" />
                  <span>{place}</span>
                </li>
              </ul>
              <p className="mt-5 max-w-[560px] text-[15px] leading-6 text-white/80">{body}</p>
              <div className="relative z-10 mt-7">
                <Button asChild variant="ctaOnDark">
                  <Link to={WYS26_PATH}>{cta}</Link>
                </Button>
              </div>
            </div>
            <CardMedia className="order-1 h-60 sm:h-72 lg:order-2 lg:col-span-5 lg:h-auto lg:min-h-[360px]">
              <CoverImage
                src={SITE_IMAGES.eventsHero.src}
                focusY={SITE_IMAGES.eventsHero.focusY}
                alt=""
                seed="wys26-dubai"
                icon={CalendarDays}
                aspect="fill"
                tone="sea"
                eager
                className="absolute inset-0"
              />
              <span aria-hidden="true" className="absolute inset-0 bg-[linear-gradient(180deg,rgba(11,38,83,.2),rgba(11,38,83,0)_40%)] lg:bg-[linear-gradient(90deg,rgba(11,38,83,.55),rgba(11,38,83,0)_45%)]" />
              <div className="absolute left-4 top-4 min-w-[5rem] rounded-field bg-white px-4 py-2.5 text-center">
                <span className="block text-[12px] font-semibold uppercase leading-4 tracking-[0.08em] text-teal-text">{t('eventsPage.wys.monthShort', 'Nov')}</span>
                <span className="tabular mt-0.5 block text-[34px] font-semibold leading-none tracking-[-0.02em] text-navy">27</span>
                <span className="tabular mt-1 block text-[11px] font-medium leading-none text-meta">2026</span>
              </div>
            </CardMedia>
          </div>
        </CardShell>
      </Reveal>
    );
  }

  return (
    <Reveal className={className}>
      <CardShell as="article" interactive>
        <div className="grid sm:grid-cols-5">
          <CardMedia className="h-40 sm:col-span-2 sm:h-auto sm:min-h-[12rem]">
            <CoverImage
              src={SITE_IMAGES.eventsHero.src}
              focusY={SITE_IMAGES.eventsHero.focusY}
              alt=""
              seed="wys26-dubai"
              icon={CalendarDays}
              aspect="fill"
              tone="sea"
              className="absolute inset-0"
            />
            <span className="absolute left-4 top-4 inline-flex items-center gap-1.5 rounded-pill bg-white px-3 py-1 text-[12px] font-semibold text-navy">
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-teal" />
              {badge}
            </span>
          </CardMedia>
          <div className="flex flex-col p-5 sm:col-span-3 sm:p-6 lg:p-8">
            <Heading className="text-card-title text-navy lg:text-h3">
              <StretchedLink to={WYS26_PATH}>{title}</StretchedLink>
            </Heading>
            <ul className="mt-3 space-y-1.5 text-sm leading-5 text-meta">
              <li className="flex items-start gap-2">
                <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-teal" aria-hidden="true" />
                <span>{date}</span>
              </li>
              <li className="flex items-start gap-2">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-teal" aria-hidden="true" />
                <span>{place}</span>
              </li>
            </ul>
            <p className="mt-3 text-sm leading-[22px] text-ink/80">{body}</p>
            <span className="mt-4 inline-flex items-center text-sm font-semibold text-navy">
              {cta}
              <ArrowRight className="card-arrow" strokeWidth={2.25} aria-hidden="true" />
            </span>
          </div>
        </div>
      </CardShell>
    </Reveal>
  );
}
