import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, type LucideIcon } from 'lucide-react';
import { CoverImage } from '@/components/ui/CoverImage';
import { CardMedia, CardShell, StretchedLink } from '@/components/brand/CardShell';
import { Eyebrow } from '@/components/brand/Eyebrow';
import { UnderlineLink } from '@/components/brand/UnderlineLink';
import type { EventCardItem } from '@/components/brand/EventCard';
import { BathyPattern } from '@/components/motion/BathyPattern';
import { Counter } from '@/components/motion/Counter';
import { LineReveal } from '@/components/motion/LineReveal';
import { MotionPauseToggle } from '@/components/motion/MotionPauseToggle';
import { Reveal } from '@/components/motion/Reveal';
import { useParallax } from '@/components/motion/useParallax';
import { prefersReducedMotion } from '@/components/motion/useReducedMotion';
import { subscribeScroll } from '@/components/motion/scrollLoop';
import { useRegisterHeaderHero } from '@/components/layout/headerOverlay';
import { DateBlock } from '@/components/events/EventListParts';
import { supabase } from '@/lib/supabase';
import type { SiteImage } from '@/lib/siteMedia';
import { SPONSOR_TIERS, isSponsorTier, type OrgTier } from '@/types/database';
import type { SponsorLogo } from '@/components/home/SponsorsBand';
import { cn } from '@/lib/utils';

/**
 * Pieces of the refonte event page (/events/:id): the header in the spirit of
 * the home split hero (text on marine, rounded photo frame, status pill), the
 * sticky section nav with its scroll spy, the section card, the "in figures"
 * panel and the "other events" cards. The page (EventDetailPage.tsx) owns the
 * data and every registration rule; these only draw.
 */

/* ─── Header ─────────────────────────────────────────────────────── */

export function EventHeader({
  title,
  image,
  seed,
  icon,
  iso,
  endIso,
  locale,
  chips,
  facts,
  topics,
}: {
  title: string;
  image: SiteImage | null;
  seed: string;
  icon: LucideIcon;
  iso: string | null;
  endIso: string | null;
  locale: string;
  /** Status pill and flags above the title. */
  chips: ReactNode;
  /** The <dt>/<dd> pairs: when, where, language, fees. */
  facts: ReactNode;
  /** Theme links under the facts. */
  topics?: ReactNode;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLElement>(null);
  const mediaRef = useRef<HTMLDivElement>(null);
  const overlaid = useRegisterHeaderHero(ref);
  useParallax(mediaRef, { mode: 'page', max: 32 });

  return (
    <section ref={ref} aria-labelledby="event-title" className="relative isolate overflow-hidden bg-navy text-white">
      <BathyPattern seed={7} drift className="absolute inset-0 -z-10" />
      <div
        className={cn(
          'mx-auto grid w-full max-w-7xl gap-8 px-4 pb-10 sm:px-6 md:pb-14 lg:grid-cols-12 lg:items-center lg:gap-12 lg:pb-16',
          overlaid ? 'pt-[88px] md:pt-[104px]' : 'pt-10 sm:pt-14',
        )}
      >
        <div className="min-w-0 lg:col-span-7">
          <nav aria-label={t('brand.breadcrumb', 'Breadcrumb')} className="text-[14px] leading-5 text-white/80">
            <UnderlineLink to="/events" tone="light" plain arrow={false} className="!text-[14px] !font-normal">
              <span className="inline-flex items-center gap-1">
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                {t('eventsPage.backToEvents', 'Back to events')}
              </span>
            </UnderlineLink>
          </nav>

          <div className="mt-5 flex flex-wrap items-center gap-2">{chips}</div>

          <LineReveal
            as="h1"
            id="event-title"
            trigger="mount"
            delay={120}
            className="mt-5 text-balance text-[30px] font-semibold leading-[36px] tracking-[-0.02em] sm:text-[36px] sm:leading-[42px] xl:text-[44px] xl:leading-[50px]"
          >
            {title}
          </LineReveal>

          <dl className="mt-6 grid gap-x-8 gap-y-4 text-[15px] leading-6 text-white/90 sm:grid-cols-2">{facts}</dl>
          {topics}
        </div>

        <div className="relative min-w-0 lg:col-span-5">
          <div className="relative h-[240px] overflow-hidden rounded-[24px] bg-navy-deep sm:h-[320px] lg:h-[400px]">
            <div ref={mediaRef} aria-hidden="true" className="hero-media-layer absolute inset-x-0 -top-8 bottom-0">
              <CoverImage
                src={image?.src ?? null}
                focusY={image?.focusY ?? 0.5}
                alt=""
                seed={seed}
                icon={icon}
                aspect="fill"
                tone="sea"
                eager
                className="absolute inset-0"
                imageClassName="hero-settle"
              />
            </div>
            <div
              aria-hidden="true"
              className="absolute inset-0 bg-[linear-gradient(180deg,rgba(11,38,83,.12)_0%,rgba(11,38,83,0)_40%,rgba(11,38,83,.4)_100%)]"
            />
            <div className="absolute bottom-4 left-4">
              <DateBlock iso={iso} endIso={endIso} locale={locale} large showYear />
            </div>
            <MotionPauseToggle className="absolute right-4 top-4 z-[4]" />
          </div>
        </div>
      </div>
    </section>
  );
}

/** One fact of the header: a gold icon, a small caps label and the value. */
export function HeaderFact({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <Icon className="mt-1 h-4 w-4 shrink-0 text-gold" aria-hidden="true" />
      <div className="min-w-0">
        <dt className="text-[12px] font-medium uppercase leading-4 tracking-[0.06em] text-white/70">{label}</dt>
        <dd className="mt-0.5">{children}</dd>
      </div>
    </div>
  );
}

/** A glass chip on the marine header. */
export function HeaderChip({ children, dot, className }: { children: ReactNode; dot?: 'gold' | 'red' | 'white'; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-8 items-center gap-2 rounded-pill border border-white/[.28] bg-white/[.14] px-3.5 text-[13px] font-semibold text-white backdrop-blur-[14px]',
        className,
      )}
    >
      {dot && <span aria-hidden="true" className={cn('h-1.5 w-1.5 rounded-full', dot === 'gold' ? 'bg-gold' : dot === 'red' ? 'bg-red-400' : 'bg-white')} />}
      {children}
    </span>
  );
}

/* ─── Sticky section nav ─────────────────────────────────────────── */

export interface NavItem {
  id: string;
  label: string;
}

/**
 * The bar under the header: one link per section on the page, the current one
 * filled in navy. It sticks under the site header (and rises with it when it
 * tucks away), and feeds its height to the page's scroll padding while it is
 * mounted so keyboard focus and anchor jumps never land under it.
 */
export function SectionNav({ items, label }: { items: NavItem[]; label: string }) {
  const barRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(items[0]?.id ?? '');
  const ids = items.map((i) => i.id).join('|');

  useEffect(() => {
    const bar = barRef.current;
    const root = document.documentElement;
    if (!bar) return;
    const set = () => root.style.setProperty('--sticky-offset', `${bar.offsetHeight}px`);
    set();
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(set);
      ro.observe(bar);
    }
    return () => {
      ro?.disconnect();
      root.style.removeProperty('--sticky-offset');
    };
  }, []);

  // Scroll spy: the current section is the last one whose top has passed under the bars.
  useEffect(() => {
    const list = ids.split('|').filter(Boolean);
    return subscribeScroll(() => {
      const bar = barRef.current;
      const line = (bar ? bar.getBoundingClientRect().bottom : 120) + 24;
      let current = list[0] ?? '';
      for (const id of list) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= line) current = id;
      }
      setActive((prev) => (prev === current ? prev : current));
    });
  }, [ids]);

  const go = (e: React.MouseEvent, id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    e.preventDefault();
    el.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
    setActive(id);
  };

  return (
    <div ref={barRef} className="sticky top-16 z-30 border-b border-rule bg-page/95 backdrop-blur-md">
      <nav aria-label={label} className="mx-auto w-full max-w-7xl px-4 sm:px-6">
        <ul className="no-scrollbar -mx-1 flex items-center gap-1 overflow-x-auto py-2">
          {items.map((item) => (
            <li key={item.id} className="shrink-0">
              <a
                href={`#${item.id}`}
                onClick={(e) => go(e, item.id)}
                aria-current={active === item.id ? 'location' : undefined}
                className={cn(
                  'inline-flex h-10 items-center whitespace-nowrap rounded-pill px-4 text-sm font-medium transition-colors duration-300 focus-visible:shadow-focus focus-visible:outline-none',
                  active === item.id ? 'bg-navy text-white' : 'text-ink hover:bg-chip hover:text-navy',
                )}
              >
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

/* ─── Section card ───────────────────────────────────────────────── */

export function DetailSection({ id, no, eyebrow, title, aside, children, className }: {
  id: string;
  no?: string;
  eyebrow?: string;
  title: string;
  aside?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Reveal as="section" id={id} aria-labelledby={`${id}-h`} className={cn('rounded-card border border-rule bg-white p-6 sm:p-8', className)}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          {eyebrow && <Eyebrow number={no}>{eyebrow}</Eyebrow>}
          <h2 id={`${id}-h`} className={cn('text-h3 text-navy md:text-[26px] md:leading-8', eyebrow && 'mt-3')}>{title}</h2>
        </div>
        {aside && <span className="tabular shrink-0 pt-1 text-sm text-meta">{aside}</span>}
      </div>
      <div className="mt-5">{children}</div>
    </Reveal>
  );
}

/* ─── In figures (the Rendezvous) ────────────────────────────────── */

function Fig({ label, n, l, children }: { label: string; n?: string; l: string; children?: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="sr-only">{label}</dt>
      <dd>
        <span className="tabular block text-[36px] font-light leading-[40px] tracking-[-0.02em] md:text-[44px] md:leading-[48px]">{n ?? children}</span>
        <span className="mt-1 block text-[13px] leading-[17px] text-white/80">{l}</span>
      </dd>
    </div>
  );
}

/**
 * "The Rendezvous in figures": only what is published: the 6th edition (20–21
 * Sept 2026), more than 250 participants, the 7th edition in 2027. Same
 * figures, same words as the home page's events carousel.
 */
export function RendezvousFigures({ id, no }: { id: string; no: string }) {
  const { t } = useTranslation();
  return (
    <Reveal
      as="section"
      id={id}
      aria-labelledby={`${id}-h`}
      className="relative isolate overflow-hidden rounded-[24px] bg-navy p-6 text-white sm:p-8 lg:p-10"
    >
      <BathyPattern seed={9} drift className="absolute inset-0 -z-10" />
      <Eyebrow tone="onDark" number={no}>{t('eventDetail.figures.eyebrow', 'In figures')}</Eyebrow>
      <h2 id={`${id}-h`} className="mt-3 text-h3 md:text-[26px] md:leading-8">
        {t('eventDetail.figures.title', 'The Rendezvous in figures')}
      </h2>
      <dl className="mt-8 grid gap-8 sm:grid-cols-3">
        <Fig label={t('homePage.events.figEdition', 'Latest edition')} n="6th" l={t('homePage.events.figEditionSub', 'edition, 20–21 Sept 2026')} />
        <Fig label={t('homePage.events.figParticipants', 'Participants')} l={t('homePage.events.figParticipantsSub', 'participants')}>
          <span aria-hidden="true">
            <span className="mr-1 align-middle text-[.45em]">{t('homePage.events.moreThan', 'more than')}</span>
            <Counter value={250} />
          </span>
          <span className="sr-only">{t('homePage.events.moreThan250', 'more than 250')}</span>
        </Fig>
        <Fig label={t('homePage.events.figNext', 'Next edition')} n="2027" l={t('homePage.events.figNextSub', '7th edition')} />
      </dl>
    </Reveal>
  );
}

/* ─── Other events ───────────────────────────────────────────────── */

/** One photo card of the M3 events (World Yachting Summit, webinars, the Rendezvous). */
export function OtherEventCard({ item }: { item: EventCardItem }) {
  return (
    <CardShell as="article" interactive tone="navy" className="min-h-[260px] w-full min-w-0 rounded-[20px]">
      <CardMedia className="absolute inset-0">
        {item.image?.src && (
          <img
            src={item.image.src}
            alt=""
            loading="lazy"
            draggable={false}
            className="h-full w-full max-w-none object-cover"
            style={{ objectPosition: `50% ${Math.round((item.image.focusY ?? 0.5) * 100)}%` }}
          />
        )}
      </CardMedia>
      <span
        aria-hidden="true"
        className="absolute inset-0 bg-[linear-gradient(180deg,rgba(8,29,64,.55)_0%,rgba(8,29,64,.45)_30%,rgba(8,29,64,.92)_100%)]"
      />
      <div className="relative flex flex-1 flex-col justify-between gap-8 p-5 sm:p-6">
        <p className="inline-flex h-8 w-fit items-center gap-2 rounded-pill border border-white/[.28] bg-white/[.14] px-3.5 text-[13px] font-semibold text-white backdrop-blur-[14px]">
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-gold" />
          {item.kicker}
        </p>
        <div>
          <h3 className="text-[20px] font-semibold leading-[26px] tracking-[-0.01em]">
            <StretchedLink to={item.href} tone="light">{item.title}</StretchedLink>
          </h3>
          {item.meta && <p className="mt-1.5 text-sm leading-5 text-white/80">{item.meta}</p>}
        </div>
      </div>
    </CardShell>
  );
}

/* ─── Sponsors ───────────────────────────────────────────────────── */

type SponsorRow = { id: string; slug: string; name: string; logo_url: string | null; tier: OrgTier | null };

/**
 * The paying event sponsors ("partners" in our vocabulary), the same read as the
 * home page's band: verified organisations in a sponsor tier. Anonymous, public
 * data; a failed read simply shows nothing.
 */
export function useEventSponsors(enabled: boolean): { sponsors: SponsorLogo[]; loading: boolean } {
  const [sponsors, setSponsors] = useState<SponsorLogo[]>([]);
  const [loading, setLoading] = useState(enabled);
  useEffect(() => {
    if (!enabled) { setLoading(false); return; }
    let alive = true;
    supabase
      .from('organizations')
      .select('id, slug, name, logo_url, tier')
      .eq('access_status', 'verified')
      .in('tier', SPONSOR_TIERS)
      .then(({ data, error }) => {
        if (!alive) return;
        if (!error && data) {
          const list: SponsorLogo[] = [];
          for (const o of data as SponsorRow[]) {
            const tier = (o.tier || 'member') as OrgTier;
            if (isSponsorTier(tier)) list.push({ id: o.id, slug: o.slug, name: o.name, logo_url: o.logo_url, tier });
          }
          setSponsors(list.sort((a, b) => a.name.localeCompare(b.name)));
        }
        setLoading(false);
      });
    return () => { alive = false; };
  }, [enabled]);
  return { sponsors, loading };
}
