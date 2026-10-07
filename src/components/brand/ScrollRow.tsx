import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { useMotion } from '@/components/motion/MotionProvider';
import { useMediaQuery } from '@/components/motion/useReducedMotion';
import { subscribeScroll } from '@/components/motion/scrollLoop';

/**
 * A row of cards (300 px each) that follows the page's scroll.
 *
 * From 1024 px, with motion on, the row advances sideways as the reader scrolls
 * past it (it starts to move once the row is 12 % up the screen and has reached
 * its last card at 82 %; the cards run on beyond the container until the panel
 * around them clips them). Below 1024 px, and under reduced motion, it is a row
 * swiped by hand with snapping. A keyboard user tabbing into a card that is
 * still off screen switches the row to the swiped flavour for as long as focus
 * stays inside it, and the card is brought into view.
 *
 * Give it an `aria-label` for the list; children are the cards (they are
 * wrapped in list items).
 *
 *   <ScrollRow label="Service provider members">
 *     <OrgCard … /> <OrgCard … />
 *   </ScrollRow>
 */
export function ScrollRow({ label, children, className }: { label: string; children: ReactNode[]; className?: string }) {
  const { reduced } = useMotion();
  const wide = useMediaQuery('(min-width: 1024px)');
  const [kbd, setKbd] = useState(false);
  const linked = wide && !reduced && !kbd;
  const items = Array.isArray(children) ? children : [children];
  const count = items.length;
  const rowRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const row = rowRef.current;
    const track = trackRef.current;
    if (!row || !track) return;
    if (!linked) {
      track.style.transform = '';
      return;
    }
    const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
    return subscribeScroll(() => {
      const vh = window.innerHeight;
      const r = row.getBoundingClientRect();
      if (r.bottom < -100 || r.top > vh + 100) return;
      const last = track.lastElementChild as HTMLElement | null;
      if (!last) return;
      const max = last.getBoundingClientRect().right - track.getBoundingClientRect().left - row.clientWidth;
      if (max <= 0) {
        track.style.transform = '';
        return;
      }
      const p = clamp(clamp((vh - r.top) / (vh + r.height), 0, 1) / 0.7 - 0.12 / 0.7, 0, 1);
      track.style.transform = `translate3d(${(-p * max).toFixed(1)}px, 0, 0)`;
    });
  }, [linked, count]);

  // A focused card that the scroll-linked track has pushed off screen: hand the row to the keyboard.
  // Keyboard focus only (:focus-visible): a mouse press on a card must not move the row under the pointer.
  const onFocusCapture = (e: React.FocusEvent) => {
    if (!wide || reduced || kbd) return;
    let visible = true;
    try {
      visible = (e.target as HTMLElement).matches(':focus-visible');
    } catch {
      /* an old browser without :focus-visible: treat as keyboard */
    }
    if (visible) setKbd(true);
  };
  useEffect(() => {
    if (!kbd) return;
    const active = document.activeElement as HTMLElement | null;
    if (active && trackRef.current?.contains(active)) active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [kbd]);

  return (
    <div
      ref={rowRef}
      role={linked ? undefined : 'region'}
      aria-label={linked ? undefined : label}
      tabIndex={linked ? undefined : 0}
      onFocusCapture={onFocusCapture}
      onBlurCapture={(e) => {
        if (kbd && !rowRef.current?.contains(e.relatedTarget as Node | null)) setKbd(false);
      }}
      className={cn(
        'no-scrollbar',
        linked
          ? 'pb-3 pt-2'
          : '-mx-4 snap-x snap-mandatory overflow-x-auto overscroll-x-contain scroll-px-4 px-4 pb-3 pt-2 focus-ring sm:-mx-6 sm:scroll-px-6 sm:px-6',
        className,
      )}
    >
      <ul
        ref={trackRef}
        aria-label={linked ? label : undefined}
        className={cn('flex gap-4 lg:gap-5', linked && 'will-change-transform')}
      >
        {items.map((child, i) => (
          <li key={i} className="w-[78%] shrink-0 snap-start sm:w-[300px] lg:w-[300px]">
            {child}
          </li>
        ))}
      </ul>
    </div>
  );
}
