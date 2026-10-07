import { Children, useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useMotion } from '@/components/motion/MotionProvider';

/**
 * A horizontal carousel of large cards: a CSS scroll-snap row, so touch keeps its
 * native swipe, with
 *
 *  - mouse drag (the row follows the pointer, keeps a little momentum on release,
 *    then settles on the nearest card; a drag never counts as a click);
 *  - previous / next buttons and one dot per stop (the dot of the current stop
 *    stretches into a gold pill); buttons and dots disappear when every card
 *    already fits;
 *  - the keyboard: the row takes focus (arrow keys, Home and End move between
 *    stops) and tabbing into a card brings it into view;
 *  - screen readers: a labelled carousel region, each card a "slide n of N".
 *
 * Give the cards their width through `slideClassName` (e.g. `w-[86%] lg:w-[46%]`);
 * the row has no padding, so the first card sits on the container's left edge.
 * Smooth scrolling gives way to an instant jump under reduced motion.
 *
 *   <Carousel label="M3 events" slideClassName="w-[86%] sm:w-[62%] lg:w-[46%]">
 *     <EventCardA /> <EventCardB /> <EventCardC />
 *   </Carousel>
 */
export function Carousel({
  label,
  children,
  slideClassName,
  className,
}: {
  /** Name of the carousel for screen readers. */
  label: string;
  children: ReactNode;
  slideClassName?: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const { reduced } = useMotion();
  const slides = Children.toArray(children);
  const count = slides.length;
  const rowRef = useRef<HTMLDivElement>(null);
  const snapsRef = useRef<number[]>([0]);
  const [snaps, setSnaps] = useState<number[]>([0]);
  const [active, setActive] = useState(0);
  const behavior: ScrollBehavior = reduced ? 'auto' : 'smooth';

  const goTo = useCallback(
    (i: number) => {
      const row = rowRef.current;
      if (!row) return;
      const pts = snapsRef.current;
      row.scrollTo({ left: pts[Math.min(pts.length - 1, Math.max(0, i))] ?? 0, behavior });
    },
    [behavior],
  );

  // The stops (distinct scroll positions) and the current one, kept in step with scroll and size.
  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    let frame = 0;
    const measure = () => {
      const max = Math.max(0, row.scrollWidth - row.clientWidth);
      const pts = [...row.children]
        .map((el) => Math.min(max, Math.max(0, Math.round((el as HTMLElement).offsetLeft))))
        .filter((v, i, a) => a.indexOf(v) === i)
        .sort((a, b) => a - b);
      const next = pts.length ? pts : [0];
      snapsRef.current = next;
      setSnaps((prev) => (prev.length === next.length && prev.every((v, i) => v === next[i]) ? prev : next));
    };
    const update = () => {
      frame = 0;
      const pts = snapsRef.current;
      const x = row.scrollLeft;
      let best = 0;
      pts.forEach((p, i) => {
        if (Math.abs(p - x) < Math.abs(pts[best] - x)) best = i;
      });
      setActive((prev) => (prev === best ? prev : best));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const onResize = () => {
      measure();
      schedule();
    };
    measure();
    update();
    row.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', onResize, { passive: true });
    document.fonts?.ready.then(onResize).catch(() => {});
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(onResize);
      ro.observe(row);
    }
    return () => {
      if (frame) cancelAnimationFrame(frame);
      row.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', onResize);
      ro?.disconnect();
    };
  }, [count]);

  // Dragging with a mouse. Touch keeps its native swipe.
  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    type Drag = { x: number; scroll: number; moved: boolean; id: number; lastX: number; lastT: number; v: number };
    let drag: Drag | null = null;
    let suppressClick = false;
    const nearest = (x: number) => {
      const pts = snapsRef.current;
      return pts.reduce((best, p) => (Math.abs(p - x) < Math.abs(best - x) ? p : best), pts[0] ?? 0);
    };
    const down = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      drag = { x: e.clientX, scroll: row.scrollLeft, moved: false, id: e.pointerId, lastX: e.clientX, lastT: performance.now(), v: 0 };
    };
    const move = (e: PointerEvent) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      if (!drag.moved) {
        if (Math.abs(dx) < 6) return;
        drag.moved = true;
        row.classList.add('is-dragging');
        try {
          row.setPointerCapture(drag.id);
        } catch {
          /* nothing to capture */
        }
      }
      const now = performance.now();
      const dt = Math.max(1, now - drag.lastT);
      drag.v = drag.v * 0.6 + ((e.clientX - drag.lastX) / dt) * 0.4;
      drag.lastX = e.clientX;
      drag.lastT = now;
      row.scrollLeft = drag.scroll - dx;
    };
    const end = () => {
      if (!drag) return;
      const d = drag;
      drag = null;
      if (!d.moved) return;
      suppressClick = true;
      window.setTimeout(() => {
        suppressClick = false;
      }, 60);
      const target = nearest(row.scrollLeft - (reduced ? 0 : d.v * 260));
      row.classList.remove('is-dragging');
      row.scrollTo({ left: target, behavior });
    };
    const noDrag = (e: Event) => e.preventDefault();
    const swallow = (e: MouseEvent) => {
      if (suppressClick) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    row.addEventListener('pointerdown', down);
    row.addEventListener('pointermove', move);
    row.addEventListener('pointerup', end);
    row.addEventListener('pointercancel', end);
    row.addEventListener('lostpointercapture', end);
    row.addEventListener('dragstart', noDrag);
    row.addEventListener('click', swallow, true);
    return () => {
      row.removeEventListener('pointerdown', down);
      row.removeEventListener('pointermove', move);
      row.removeEventListener('pointerup', end);
      row.removeEventListener('pointercancel', end);
      row.removeEventListener('lostpointercapture', end);
      row.removeEventListener('dragstart', noDrag);
      row.removeEventListener('click', swallow, true);
      row.classList.remove('is-dragging');
    };
  }, [reduced, behavior]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const last = snapsRef.current.length - 1;
    let to: number | null = null;
    if (e.key === 'ArrowRight') to = Math.min(last, active + 1);
    else if (e.key === 'ArrowLeft') to = Math.max(0, active - 1);
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = last;
    if (to === null) return;
    e.preventDefault();
    goTo(to);
  };

  const overflow = snaps.length > 1;
  return (
    <div role="region" aria-roledescription="carousel" aria-label={label} className={className}>
      <div
        ref={rowRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="car-row no-scrollbar focus-ring relative flex gap-4 overflow-x-auto rounded-card py-2 md:gap-6"
      >
        {slides.map((slide, i) => (
          <div
            key={i}
            role="group"
            aria-roledescription="slide"
            aria-label={t('brand.carousel.slide', { n: i + 1, total: count, defaultValue: '{{n}} of {{total}}' })}
            className={cn('flex min-w-0 shrink-0', slideClassName)}
          >
            {slide}
          </div>
        ))}
      </div>

      {overflow && (
        <div className="mt-5 flex items-center justify-between gap-4">
          <div className="-ml-1 flex items-center">
            {snaps.map((_, i) => (
              <button
                key={i}
                type="button"
                className="car-dot"
                aria-current={i === active ? 'true' : undefined}
                aria-label={t('brand.carousel.goTo', { n: i + 1, defaultValue: 'Go to position {{n}}' })}
                onClick={() => goTo(i)}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ctaOutline"
              size="icon"
              className="h-11 w-11 md:h-11 md:w-11"
              disabled={active <= 0}
              onClick={() => goTo(active - 1)}
              aria-label={t('brand.carousel.prev', 'Previous')}
            >
              <ArrowLeft className="h-[18px] w-[18px]" aria-hidden="true" />
            </Button>
            <Button
              variant="ctaOutline"
              size="icon"
              className="h-11 w-11 md:h-11 md:w-11"
              disabled={active >= snaps.length - 1}
              onClick={() => goTo(active + 1)}
              aria-label={t('brand.carousel.next', 'Next')}
            >
              <ArrowRight className="h-[18px] w-[18px]" aria-hidden="true" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
