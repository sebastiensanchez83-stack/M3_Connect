import { useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Pause, Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMotion } from '@/components/motion/MotionProvider';

/**
 * The news ticker: a slim navy strip (36 px, 40 px from md) whose items slide
 * continuously from right to left (48 px/s). Each item is a link with a small
 * gold kind label in front ("Article", "New member", "Event", "Webinar"),
 * separated from the next by a small dot. SiteTicker feeds it on every page.
 *
 *  - Seamless loop: the list is repeated until it fills the strip, and the track
 *    slides by exactly one copy (CSS transform, smc-motion.css .news-track). The
 *    extra copies are aria-hidden and their links out of the tab order:
 *    assistive technology reads the list once.
 *  - It pauses while the pointer rests on it. Keyboard focus inside turns it
 *    into the static row (below), so the focused link never slides away.
 *  - Under reduced motion, under the site's animation pause, and while keyboard
 *    focus is inside, it is a static row of the same height that scrolls
 *    sideways (swipe, trackpad, Tab).
 *  - A small pause / play button at its right end drives the site-wide motion
 *    switch (useMotion): when the strip stands still, a visitor sees why and can
 *    start it again. Hidden under reduced motion, where nothing ever moves.
 *
 * While `loading`, the strip keeps its height with quiet placeholders, so the
 * page never jumps when the items arrive. Once loaded, no items means no strip.
 *
 *   <NewsBand items={[{ id: 'wys', kind: 'Event', text: 'World Yachting Summit · Dubai · 27 Nov 2026', href: '/wys26' }]} />
 */
export interface NewsItem {
  id: string;
  /** The small gold label in front: "Article", "New member", "Event", "Webinar". */
  kind?: string;
  text: string;
  /** A page of this site. */
  href: string;
}

const SPEED = 48; // px per second

/** True when the element got focus from the keyboard (not a click or a tap). */
function keyboardFocus(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  try {
    return el.matches(':focus-visible');
  } catch {
    return true;
  }
}

function NewsLink({ item, hidden }: { item: NewsItem; hidden?: boolean }) {
  return (
    <Link
      to={item.href}
      tabIndex={hidden ? -1 : undefined}
      className="news-link group inline-flex items-center gap-2 whitespace-nowrap rounded-[4px] py-1 text-[13px] leading-5 text-white/90 outline-none transition-colors hover:text-white focus-visible:shadow-[0_0_0_2px_rgb(var(--navy-deep)),0_0_0_4px_#fff] md:text-[14px]"
    >
      {item.kind && (
        <span className="text-[11px] font-semibold uppercase leading-4 tracking-[0.06em] text-gold">
          {item.kind}
          <span className="sr-only">:</span>
        </span>
      )}
      <span className="underline decoration-transparent decoration-1 underline-offset-[5px] transition-[text-decoration-color] duration-300 group-hover:decoration-gold group-focus-visible:decoration-gold">
        {item.text}
      </span>
    </Link>
  );
}

function Items({ items, hidden }: { items: NewsItem[]; hidden?: boolean }) {
  return (
    <>
      {items.map((item) => (
        <li key={item.id} className="flex h-full items-center">
          <NewsLink item={item} hidden={hidden} />
          <span aria-hidden="true" className="mx-4 h-1 w-1 shrink-0 rounded-full bg-white/35 md:mx-5" />
        </li>
      ))}
    </>
  );
}

export function NewsBand({
  items,
  loading = false,
  label,
  className,
}: {
  items: NewsItem[];
  /** The items are on their way: the strip shows, with placeholders. */
  loading?: boolean;
  /** Accessible name of the region (default "Latest news"). */
  label?: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const { still, reduced, paused, togglePaused } = useMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const unitRef = useRef<HTMLUListElement>(null);
  const [unit, setUnit] = useState(0);
  const [copies, setCopies] = useState(2);
  /** Keyboard focus is inside: the strip stands still as a scrollable row. */
  const [held, setHeld] = useState(false);
  const ready = !loading && items.length > 0;
  const moving = ready && !still && !held;

  // How wide one copy is, and how many copies fill the strip: measured again when the strip, the items or the fonts change.
  useLayoutEffect(() => {
    if (!moving) return;
    const root = rootRef.current;
    const first = unitRef.current;
    if (!root || !first) return;
    // Back to the start of the loop (the static row may have been scrolled sideways).
    root.scrollLeft = 0;
    const measure = () => {
      const w = first.getBoundingClientRect().width;
      if (w <= 0) return;
      setUnit((u) => (Math.abs(u - w) < 0.5 ? u : w));
      const need = Math.max(2, Math.ceil(root.clientWidth / w) + 1);
      setCopies((c) => (c === need ? c : need));
    };
    measure();
    document.fonts?.ready.then(measure).catch(() => {});
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    ro.observe(first);
    return () => ro.disconnect();
  }, [moving, items]);

  // Keyboard focus came in: once the row is static, the focused link is brought into view.
  useLayoutEffect(() => {
    if (!held) return;
    const root = rootRef.current;
    const active = document.activeElement;
    if (root && active instanceof HTMLElement && root.contains(active)) {
      active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }, [held]);

  if (!loading && items.length === 0) return null;
  const regionLabel = label ?? t('brand.news.label', 'Latest news');
  const pauseLabel = paused ? t('brand.motion.play', 'Play animations') : t('brand.motion.pause', 'Pause animations');

  return (
    <section
      aria-label={regionLabel}
      aria-busy={loading || undefined}
      className={cn('news relative bg-navy-deep text-white', className)}
      onFocus={(e) => {
        if (keyboardFocus(e.target) && (e.target as HTMLElement).closest('.news-viewport')) setHeld(true);
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHeld(false);
      }}
    >
      <div className="mx-auto flex h-9 max-w-7xl items-center gap-3 pl-4 pr-2 sm:pl-6 sm:pr-4 md:h-10">
        {/* What the strip is, on screens wide enough to say it (the region carries the same name). */}
        <span aria-hidden="true" className="hidden shrink-0 items-center gap-2 text-[11px] font-semibold uppercase leading-4 tracking-[0.08em] text-white/60 sm:flex">
          <span className="h-1.5 w-1.5 rounded-full bg-gold" />
          {regionLabel}
        </span>

        <div ref={rootRef} className={cn('news-viewport h-full min-w-0 flex-1', moving ? 'is-moving' : 'is-static')}>
          {!ready ? (
            <div aria-hidden="true" className="flex h-full items-center gap-6 overflow-hidden">
              {[132, 220, 176, 240].map((w, i) => (
                <span key={i} className="h-2.5 shrink-0 rounded-full bg-white/10" style={{ width: w }} />
              ))}
            </div>
          ) : (
            <div
              className="news-track flex h-full w-max items-center"
              style={
                moving && unit > 0
                  ? ({ '--news-unit': `${unit}px`, '--news-duration': `${Math.max(12, unit / SPEED).toFixed(1)}s` } as React.CSSProperties)
                  : { animation: 'none' }
              }
            >
              {Array.from({ length: moving ? copies : 1 }, (_, k) => (
                <ul
                  key={k}
                  ref={k === 0 ? unitRef : undefined}
                  aria-hidden={k > 0 ? true : undefined}
                  className="flex h-full shrink-0 items-center"
                >
                  <Items items={items} hidden={k > 0} />
                </ul>
              ))}
            </div>
          )}
        </div>

        {!reduced && (
          <button
            type="button"
            onClick={togglePaused}
            aria-pressed={paused}
            aria-label={pauseLabel}
            title={pauseLabel}
            // 28 px to look at, 40 px to touch.
            className="relative grid h-7 w-7 shrink-0 place-items-center rounded-full text-white/70 transition-colors before:absolute before:-inset-1.5 before:content-[''] hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_rgb(var(--navy-deep)),0_0_0_4px_#fff]"
          >
            {paused ? <Play className="h-3.5 w-3.5" aria-hidden="true" /> : <Pause className="h-3.5 w-3.5" aria-hidden="true" />}
          </button>
        )}
      </div>
    </section>
  );
}
