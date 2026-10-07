import { useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight } from 'lucide-react';
import type { SiteImage } from '@/lib/siteMedia';
import { cn } from '@/lib/utils';
import { useMotion } from '@/components/motion/MotionProvider';

/**
 * The "next event" card: a photo card that floats over the bottom left edge of
 * the home hero's photo frame (no cut-out corner), turning the M3 events.
 *
 *  - Each event: kicker, title, meta. An upcoming event (`startsOn`) carries its
 *    countdown in gold before the title: "D-51 · World Yachting Summit" ("Today"
 *    on the day itself, nothing for a past event or one without a date).
 *  - The card turns every 6 s: the photo fades (.6 s) and zooms slowly (6.6 s), a
 *    progress bar per event (clickable). It pauses on hover and focus, with the
 *    global pause, and never rotates under reduced motion.
 *  - On hover the card lifts 4 px, the gold line under the title grows and the
 *    small arrow after it slides 4 px.
 *  - Items come from featuredEventItems(t) in m3Events.ts (World Yachting Summit
 *    → /wys26, webinars → /events, the Rendezvous → its event page).
 *
 *   <SplitHero card={<EventCard items={featuredEventItems(t)} />}> … </SplitHero>
 */

export interface EventCardItem {
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

function EventBody({ item, eager }: { item: EventCardItem; eager?: boolean }) {
  const { t } = useTranslation();
  const days = item.startsOn ? daysUntilEvent(item.startsOn) : null;
  return (
    <>
      {item.image?.src && (
        <img
          src={item.image.src}
          alt=""
          className="evc-img"
          style={{ objectPosition: `50% ${Math.round((item.image.focusY ?? 0.5) * 100)}%` }}
          loading={eager ? 'eager' : 'lazy'}
        />
      )}
      <span className="evc-shade" aria-hidden="true" />
      <span className="evc-txt">
        <span className="evc-k">{item.kicker}</span>
        <span className="evc-t">
          {days !== null && (
            <>
              <span className="evc-cd" aria-hidden="true">
                {days === 0 ? t('brand.notch.today', 'Today') : t('brand.notch.countdown', { days, defaultValue: 'D-{{days}}' })}
              </span>
              <span className="sr-only">{days === 0 ? t('brand.notch.todaySr', 'Today: ') : t('brand.notch.countdownSr', { days, defaultValue: '{{days}} days to go: ' })}</span>
              <span aria-hidden="true" className="evc-cd-sep"> · </span>
            </>
          )}
          <span className="card-ul">{item.title}</span>
          <ArrowRight className="card-arrow card-arrow--light" strokeWidth={2.25} aria-hidden="true" />
        </span>
        {item.meta && <span className="evc-m">{item.meta}</span>}
      </span>
    </>
  );
}

export function EventCard({
  items,
  interval = 6000,
  label,
  className,
}: {
  items: EventCardItem[];
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
    <div role="region" aria-label={label ?? t('brand.notch.label', 'Featured M3 events')} className={cn('evc-wrap', className)}>
      <div className="evc" style={{ '--evc-interval': `${interval}ms` } as CSSProperties}>
        {items.length > 1 && (
          <div className="evc-segs">
            {items.map((item, k) => (
              <button
                key={item.id}
                type="button"
                aria-current={k === current ? 'true' : 'false'}
                aria-label={t('brand.notch.show', { title: item.title, defaultValue: 'Show: {{title}}' })}
                className={cn('evc-seg', k === current && 'is-active', k < current && 'is-done', rotating && 'is-running')}
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
            className={cn('evc-slide has-ra', k === current && 'is-active')}
          >
            <EventBody item={item} eager={k === 0} />
          </SlideLink>
        ))}
      </div>
    </div>
  );
}
