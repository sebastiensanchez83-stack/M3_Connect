import { useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { SiteImage } from '@/lib/siteMedia';
import { cn } from '@/lib/utils';
import { useMotion } from '@/components/motion/MotionProvider';
import { ArrowDisc } from './ArrowDisc';

/**
 * The notch: a card cut into the bottom left corner of an InsetHero (the hero's
 * corner is cut out around it, in the page colour, with two inverse radii).
 *
 *  - HeroNotch     the cut-out wrapper (position, page-coloured corner). Goes in
 *                  InsetHero's / PageHero's `notch` prop. Bottom left by default
 *                  (`side="right"` for PageHero's compact heroes, whose text runs
 *                  along the bottom left).
 *  - NotchCard     one photo card: kicker, title, meta, a round arrow, one link.
 *                  An upcoming event (`startsOn`) carries its countdown in gold
 *                  before the title: "D-51 · World Yachting Summit" ("Today" on the
 *                  day itself, nothing for a past event or one without a date).
 *  - EventNotch    HeroNotch + the M3 events turning every 6 s: photo fades
 *                  (.6 s) and zooms slowly (6.6 s), a progress bar per event
 *                  (clickable), pause on hover and focus, on the global pause,
 *                  and never rotating under reduced motion. Items come from
 *                  notchEventItems(t) in m3Events.ts (World Yachting Summit →
 *                  /wys26, webinars → /events, the Rendezvous → its event page).
 *
 *   <InsetHero notch={<EventNotch items={notchEventItems(t)} />}> … </InsetHero>
 */

export interface NotchItem {
  id: string;
  /** Small gold line above the title ("Next event", "Online"…). */
  kicker: string;
  title: string;
  /** One line under the title (place, date, status). */
  meta?: string;
  href: string;
  image: SiteImage | null;
  /** Calendar day of the event in ITS local time, for the countdown (webinars without a date and past events: leave out). */
  startsOn?: { date: string; timeZone: string };
}

/**
 * Whole calendar days from today to the event, both read in the event's own time
 * zone (so "D-0" is the day itself wherever the visitor is). Null for a past event.
 */
export function daysUntilEvent(startsOn: { date: string; timeZone: string }, now = Date.now()): number | null {
  try {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: startsOn.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
    const toUtc = (ymd: string) => {
      const [y, m, d] = ymd.split('-').map(Number);
      return Date.UTC(y, m - 1, d);
    };
    const days = Math.round((toUtc(startsOn.date) - toUtc(today)) / 86_400_000);
    return Number.isFinite(days) && days >= 0 ? days : null;
  } catch {
    return null;
  }
}

/** The cut-out wrapper. `className` can hide it on small screens (e.g. `hidden xl:block`). */
export function HeroNotch({
  children,
  label,
  className,
  side = 'left',
}: {
  children: ReactNode;
  /** Name of the region for screen readers. */
  label: string;
  className?: string;
  /** Which bottom corner is cut out: left (default), or right for PageHero's compact heroes. */
  side?: 'left' | 'right';
}) {
  return (
    <div role="region" aria-label={label} className={cn('hero-notch', side === 'right' && 'hero-notch--right', className)}>
      {children}
    </div>
  );
}

function SlideLink({ href, className, tabIndex, children }: { href: string; className?: string; tabIndex?: number; children: ReactNode }) {
  if (/^https?:\/\//.test(href)) {
    return (
      <a href={href} className={className} tabIndex={tabIndex}>
        {children}
      </a>
    );
  }
  return (
    <Link to={href} className={className} tabIndex={tabIndex}>
      {children}
    </Link>
  );
}

function NotchBody({ item, eager }: { item: NotchItem; eager?: boolean }) {
  const { t } = useTranslation();
  const days = item.startsOn ? daysUntilEvent(item.startsOn) : null;
  return (
    <>
      {item.image?.src && (
        <img
          src={item.image.src}
          alt=""
          className="notch-img"
          style={{ objectPosition: `50% ${Math.round((item.image.focusY ?? 0.5) * 100)}%` }}
          loading={eager ? 'eager' : 'lazy'}
        />
      )}
      <span className="notch-shade" aria-hidden="true" />
      <span className="notch-txt">
        <span className="notch-k">{item.kicker}</span>
        <span className="notch-t">
          {days !== null && (
            <>
              <span className="notch-cd" aria-hidden="true">
                {days === 0 ? t('brand.notch.today', 'Today') : t('brand.notch.countdown', { days, defaultValue: 'D-{{days}}' })}
              </span>
              <span className="sr-only">{days === 0 ? t('brand.notch.todaySr', 'Today: ') : t('brand.notch.countdownSr', { days, defaultValue: '{{days}} days to go: ' })}</span>
              <span aria-hidden="true" className="notch-cd-sep"> · </span>
            </>
          )}
          {item.title}
        </span>
        {item.meta && <span className="notch-m">{item.meta}</span>}
      </span>
      <ArrowDisc tone="photo" size="sm" className="notch-ra" />
    </>
  );
}

/** One photo card with a single link (no rotation): inside a HeroNotch. */
export function NotchCard({ item, className }: { item: NotchItem; className?: string }) {
  return (
    <SlideLink href={item.href} className={cn('notch-card notch-card--single has-ra', className)}>
      <NotchBody item={item} eager />
    </SlideLink>
  );
}

export function EventNotch({
  items,
  interval = 6000,
  label,
  className,
}: {
  items: NotchItem[];
  /** ms per event (default 6000). */
  interval?: number;
  /** Region name; default "Featured M3 events". */
  label?: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const { reduced } = useMotion();
  const [index, setIndex] = useState(0);
  if (!items.length) return null;
  const rotating = items.length > 1 && !reduced;
  const current = Math.min(index, items.length - 1);

  return (
    <HeroNotch label={label ?? t('brand.notch.label', 'Featured M3 events')} className={className}>
      <div className="notch-card" style={{ '--notch-interval': `${interval}ms` } as CSSProperties}>
        {items.length > 1 && (
          <div className="notch-segs">
            {items.map((item, k) => (
              <button
                key={item.id}
                type="button"
                aria-current={k === current ? 'true' : 'false'}
                aria-label={t('brand.notch.show', { title: item.title, defaultValue: 'Show: {{title}}' })}
                className={cn('notch-seg', k === current && 'is-active', k < current && 'is-done', rotating && 'is-running')}
                onClick={() => k !== current && setIndex(k)}
              >
                <i
                  onAnimationEnd={() => {
                    if (rotating && k === current) setIndex((current + 1) % items.length);
                  }}
                />
              </button>
            ))}
          </div>
        )}
        {items.map((item, k) => (
          <SlideLink
            key={item.id}
            href={item.href}
            tabIndex={k === current ? undefined : -1}
            className={cn('notch-slide has-ra', k === current && 'is-active')}
          >
            <NotchBody item={item} eager={k === 0} />
          </SlideLink>
        ))}
      </div>
    </HeroNotch>
  );
}
