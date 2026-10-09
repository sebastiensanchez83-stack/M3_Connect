import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
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
 *    into the still row (below), so the focused link never slides away.
 *  - Still row: under reduced motion, under the site's animation pause, after
 *    its own Pause button, and while keyboard focus is inside, it is a row of
 *    the same height that scrolls sideways (swipe, trackpad, Tab, and two arrow
 *    buttons when there is more to see); its edges fade only where more is
 *    hidden.
 *  - Its own Pause / Play button at its right end, always there. Pause holds
 *    the strip for this tab only and never touches the rest of the site. Play
 *    starts it again; when the strip stood still because the computer asks for
 *    less motion or the site's animations were paused, Play is the visitor's
 *    explicit choice for this strip and is remembered in this browser
 *    (Victor, 9 Oct 2026: "the banner does not scroll").
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
/** localStorage: '1' = this strip moves although the computer or the site asks for stillness (the visitor pressed Play). */
const PLAY_KEY = 'smc-ticker-play';
/** sessionStorage: '1' = paused with its own button, for this tab. */
const PAUSE_KEY = 'smc-ticker-paused';

function readFlag(kind: 'local' | 'session', key: string): boolean {
  try {
    return (kind === 'local' ? window.localStorage : window.sessionStorage).getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeFlag(kind: 'local' | 'session', key: string, on: boolean) {
  try {
    const store = kind === 'local' ? window.localStorage : window.sessionStorage;
    if (on) store.setItem(key, '1');
    else store.removeItem(key);
  } catch {
    /* storage blocked: the choice lasts while the page is open */
  }
}

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
      // The whole strip's height to tap (36 / 40 px); the focus ring is drawn inside it.
      className="news-link group inline-flex h-full items-center gap-2 whitespace-nowrap rounded-[4px] px-1 text-[13px] leading-5 text-white/90 outline-none transition-colors hover:text-white focus-visible:shadow-[inset_0_0_0_2px_#fff] md:text-[14px]"
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
          <span aria-hidden="true" className="mx-3 h-1 w-1 shrink-0 rounded-full bg-white/35 md:mx-4" />
        </li>
      ))}
    </>
  );
}

/** A round control of the strip: 32 px to look at, 44 px to touch. */
const CONTROL =
  "relative grid h-8 w-8 shrink-0 place-items-center rounded-full text-white/75 transition-colors before:absolute before:-inset-1.5 before:content-[''] hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_rgb(var(--navy-deep)),0_0_0_4px_#fff] disabled:pointer-events-none disabled:opacity-35";

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
  const { still, reduced } = useMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const unitRef = useRef<HTMLUListElement>(null);
  const [unit, setUnit] = useState(0);
  const [copies, setCopies] = useState(2);
  /** Keyboard focus is inside: the strip stands still as a scrollable row. */
  const [held, setHeld] = useState(false);
  /** Paused with its own button (this tab). */
  const [ownPause, setOwnPause] = useState(() => readFlag('session', PAUSE_KEY));
  /** Play pressed although the computer or the site asks for stillness (this browser). */
  const [playAnyway, setPlayAnyway] = useState(() => readFlag('local', PLAY_KEY));
  /** Where the strip was (px into one copy) when it stopped or started: it carries on from there. */
  const offset = useRef(0);
  /** In the still row: more items hidden before / after what shows. */
  const [more, setMore] = useState({ start: false, end: false });

  const ready = !loading && items.length > 0;
  /** The strip should be moving (unless the pointer or the keyboard holds it). */
  const running = !ownPause && (!still || playAnyway);
  const moving = ready && running && !held;
  const duration = unit > 0 ? Math.max(12, unit / SPEED) : 0;

  /** Notes how far into one copy the strip shows now, before it switches between moving and still. */
  const noteOffset = () => {
    const root = rootRef.current;
    const track = trackRef.current;
    if (!root || !track || unit <= 0) return;
    if (moving) {
      const m = getComputedStyle(track).transform;
      const tx = m && m !== 'none' ? new DOMMatrixReadOnly(m).m41 : 0;
      offset.current = ((-tx % unit) + unit) % unit;
    } else {
      offset.current = Math.min(root.scrollLeft, unit);
    }
  };

  // How wide one copy is, and how many copies fill the strip: measured again when the strip, the items or the fonts change.
  useLayoutEffect(() => {
    if (!moving) return;
    const root = rootRef.current;
    const first = unitRef.current;
    if (!root || !first) return;
    // The moving track starts from the row's own start (the still row may have been scrolled sideways).
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

  // The still row: shows where the strip stopped, and knows whether there is more on either side.
  useLayoutEffect(() => {
    if (moving || !ready) {
      setMore((m) => (m.start || m.end ? { start: false, end: false } : m));
      return;
    }
    const root = rootRef.current;
    if (!root) return;
    root.scrollLeft = offset.current;
    const measure = () => {
      const start = root.scrollLeft > 1;
      const end = root.scrollLeft + root.clientWidth < root.scrollWidth - 1;
      setMore((m) => (m.start === start && m.end === end ? m : { start, end }));
    };
    measure();
    root.addEventListener('scroll', measure, { passive: true });
    if (typeof ResizeObserver === 'undefined') return () => root.removeEventListener('scroll', measure);
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    if (root.firstElementChild) ro.observe(root.firstElementChild);
    return () => {
      root.removeEventListener('scroll', measure);
      ro.disconnect();
    };
  }, [moving, ready, items]);

  // Keyboard focus came in: once the row is still, the focused link is brought into view (clear of the faded edges).
  useLayoutEffect(() => {
    if (!held) return;
    const root = rootRef.current;
    const active = document.activeElement;
    if (root && active instanceof HTMLElement && root.contains(active)) {
      active.scrollIntoView({ block: 'nearest', inline: 'center' });
    }
  }, [held]);

  // A new pause / play choice from another tab or page of this site: followed here.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === PLAY_KEY) setPlayAnyway(e.newValue === '1');
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  if (!loading && items.length === 0) return null;
  const regionLabel = label ?? t('brand.news.label', 'Latest news');
  const toggleLabel = running ? t('brand.news.pause', 'Pause news') : t('brand.news.play', 'Play news');
  const showArrows = ready && !moving && (more.start || more.end);

  const toggle = () => {
    noteOffset();
    if (running) {
      setOwnPause(true);
      writeFlag('session', PAUSE_KEY, true);
      // A visitor who asked for motion once and now stops it: back to what the computer or the site asks.
      setPlayAnyway(false);
      writeFlag('local', PLAY_KEY, false);
    } else {
      setOwnPause(false);
      writeFlag('session', PAUSE_KEY, false);
      if (still) {
        setPlayAnyway(true);
        writeFlag('local', PLAY_KEY, true);
      }
    }
  };

  const scrollBy = (dir: 1 | -1) => {
    const root = rootRef.current;
    if (!root) return;
    root.scrollBy({ left: dir * Math.max(120, root.clientWidth * 0.7), behavior: reduced ? 'auto' : 'smooth' });
  };

  return (
    <section
      aria-label={regionLabel}
      aria-busy={loading || undefined}
      className={cn('news relative bg-navy-deep text-white', className)}
      onFocus={(e) => {
        if (!held && keyboardFocus(e.target) && (e.target as HTMLElement).closest('.news-viewport')) {
          noteOffset();
          setHeld(true);
        }
      }}
      onBlur={(e) => {
        if (held && !e.currentTarget.contains(e.relatedTarget as Node | null)) {
          noteOffset();
          setHeld(false);
        }
      }}
    >
      <div className="mx-auto flex h-9 max-w-7xl items-center gap-2 pl-4 pr-2 sm:gap-3 sm:pl-6 sm:pr-4 md:h-10">
        {/* What the strip is, on screens wide enough to say it (the region carries the same name). */}
        <span aria-hidden="true" className="hidden shrink-0 items-center gap-2 text-[11px] font-semibold uppercase leading-4 tracking-[0.08em] text-white/60 sm:flex">
          <span className="h-1.5 w-1.5 rounded-full bg-gold" />
          {regionLabel}
        </span>

        <div
          ref={rootRef}
          className={cn(
            'news-viewport h-full min-w-0 flex-1',
            moving ? 'is-moving' : 'is-static',
            !moving && more.start && 'more-start',
            !moving && more.end && 'more-end',
          )}
        >
          {!ready ? (
            <div aria-hidden="true" className="flex h-full items-center gap-6 overflow-hidden">
              {[132, 220, 176, 240].map((w, i) => (
                <span key={i} className="h-2.5 shrink-0 rounded-full bg-white/10" style={{ width: w }} />
              ))}
            </div>
          ) : (
            <div
              ref={trackRef}
              className={cn('news-track flex h-full w-max items-center', moving && playAnyway && still && 'news-chosen')}
              style={
                moving && unit > 0
                  ? ({
                      '--news-unit': `${unit}px`,
                      '--news-duration': `${duration.toFixed(1)}s`,
                      // Carries on from where it stood still.
                      animationDelay: `${(-(offset.current / unit) * duration).toFixed(2)}s`,
                    } as React.CSSProperties)
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

        {showArrows && (
          <span className="flex shrink-0 items-center gap-1">
            <button type="button" onClick={() => scrollBy(-1)} disabled={!more.start} aria-label={t('brand.news.previous', 'Previous news')} title={t('brand.news.previous', 'Previous news')} className={CONTROL}>
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </button>
            <button type="button" onClick={() => scrollBy(1)} disabled={!more.end} aria-label={t('brand.news.next', 'Next news')} title={t('brand.news.next', 'Next news')} className={CONTROL}>
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </span>
        )}

        {ready && (
          <button type="button" onClick={toggle} aria-label={toggleLabel} title={toggleLabel} className={CONTROL}>
            {running ? <Pause className="h-3.5 w-3.5" aria-hidden="true" /> : <Play className="h-3.5 w-3.5" aria-hidden="true" />}
          </button>
        )}
      </div>
    </section>
  );
}
