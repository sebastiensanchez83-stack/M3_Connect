import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { useMotion } from '@/components/motion/MotionProvider';
import { useOnScreen } from '@/components/motion/useInView';
import { subscribeTicker } from '@/components/motion/scrollLoop';

/**
 * Giant continuous text, running sideways behind or between sections: 120 px
 * (60 px on phones), words joined by gold separators, clipped by its container.
 *
 *  - Speed in px/s; the page's own scroll speed pushes it (up to x5, easing back
 *    down), a pointer resting on it stops it, and it starts and stops smoothly.
 *  - It only runs while on screen, and stops under reduced motion (a single
 *    still line) and while the global pause is on (MotionPauseToggle).
 *  - It is decoration: aria-hidden, never carries information. Give it a `label`
 *    only when the words matter (rendered as sr-only text).
 *
 * Variants: 'hero' (white 20 % on a photo, gold separators), 'solid' (navy, an
 * editorial separator between sections) and 'tone' (navy 14 %, teal separators,
 * the second line under a 'solid' one). Size and colour can be overridden with
 * `className`.
 *
 *   <GiantMarquee items={['Smart', 'Sustainable', 'Connected']} variant="hero" speed={55} />
 *   <GiantMarqueeBand lines={[['Connecting marinas'], ['Monaco', 'Dubai', 'Online']]} />
 */

const VARIANT: Record<'hero' | 'solid' | 'tone', string> = {
  hero: 'font-wordmark text-[60px] font-medium leading-[1.12] tracking-[-0.03em] text-white/20 [--gmq-sep:rgba(215,166,71,.55)] md:text-[120px]',
  solid: 'font-wordmark text-[60px] font-medium leading-[1.12] tracking-[-0.035em] text-navy md:text-[124px]',
  tone: 'font-wordmark text-[60px] font-semibold leading-[1.12] tracking-[-0.035em] text-navy/[.14] [--gmq-sep:rgb(31_122_140)] md:text-[124px]',
};

export function GiantMarquee({
  items,
  speed = 55,
  direction = 'left',
  variant = 'solid',
  label,
  className,
}: {
  /** The words, in order; a gold separator follows each one. */
  items: string[];
  /** px per second (default 55). */
  speed?: number;
  /** 'left': the text moves to the left (default). */
  direction?: 'left' | 'right';
  variant?: 'hero' | 'solid' | 'tone';
  /** Accessible text, only if the words carry meaning. */
  label?: string;
  className?: string;
}) {
  const { still, reduced } = useMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const unitRef = useRef<HTMLSpanElement>(null);
  const onScreen = useOnScreen(rootRef, reduced);
  const [copies, setCopies] = useState(2);
  const state = useRef({ x: 0, unit: 0, cur: 1, hover: false });
  const live = useRef({ still, onScreen });
  live.current = { still, onScreen };
  const dir = direction === 'right' ? 1 : -1;

  // How many copies fill the band: measured again whenever its width or the fonts change.
  useLayoutEffect(() => {
    const root = rootRef.current;
    const unitEl = unitRef.current;
    if (!root || !unitEl) return;
    const measure = () => {
      const unit = unitEl.getBoundingClientRect().width;
      if (unit <= 0) return;
      const st = state.current;
      const firstTime = st.unit === 0;
      st.unit = unit;
      if (firstTime) st.x = dir < 0 ? 0 : -unit;
      st.x = Math.min(0, Math.max(-unit, st.x));
      const need = Math.ceil((root.clientWidth + unit) / unit) + 1;
      setCopies((c) => (c === need ? c : need));
    };
    measure();
    document.fonts?.ready.then(measure).catch(() => {});
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    return () => ro.disconnect();
  }, [dir, items]);

  // The motion: one shared frame loop.
  useEffect(() => {
    if (reduced) return;
    const track = trackRef.current;
    if (!track) return;
    return subscribeTicker((dt, boost) => {
      const st = state.current;
      if (!st.unit) return;
      const { still: halted, onScreen: visible } = live.current;
      if (!visible) return;
      const goal = halted || st.hover ? 0 : 1 + boost;
      // Starts and stops in a gentle ramp, never abruptly.
      st.cur += (goal - st.cur) * 0.08;
      if (goal === 0 && st.cur < 0.003) {
        st.cur = 0;
        return;
      }
      st.x += dir * speed * st.cur * dt;
      if (dir < 0 && st.x <= -st.unit) st.x += st.unit;
      if (dir > 0 && st.x >= 0) st.x -= st.unit;
      track.style.transform = `translate3d(${st.x.toFixed(2)}px, 0, 0)`;
    });
  }, [reduced, dir, speed]);

  const total = reduced ? 1 : copies;
  return (
    <div
      ref={rootRef}
      className={cn('gmq', VARIANT[variant], className)}
      aria-hidden={label ? undefined : true}
      onMouseEnter={() => {
        state.current.hover = true;
      }}
      onMouseLeave={() => {
        state.current.hover = false;
      }}
    >
      {label && <span className="sr-only">{label}</span>}
      <div ref={trackRef} className="gmq-track" aria-hidden={label ? true : undefined}>
        {Array.from({ length: total }, (_, k) => (
          <span key={k} ref={k === 0 ? unitRef : undefined} className="gmq-item">
            {items.map((word, i) => (
              <Fragment key={`${word}-${i}`}>
                {word} <span className="gmq-sep">·</span>{' '}
              </Fragment>
            ))}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * The editorial separator between two sections: two giant lines running in
 * opposite directions (70 and 50 px/s), the second one tone on tone.
 */
export function GiantMarqueeBand({
  lines,
  speeds = [70, 50],
  className,
}: {
  lines: [string[], string[]];
  speeds?: [number, number];
  className?: string;
}) {
  return (
    <div aria-hidden="true" className={cn('relative overflow-hidden py-6 md:py-10', className)}>
      <GiantMarquee items={lines[0]} variant="solid" speed={speeds[0]} direction="left" />
      <GiantMarquee items={lines[1]} variant="tone" speed={speeds[1]} direction="right" className="mt-1 md:mt-2" />
    </div>
  );
}
