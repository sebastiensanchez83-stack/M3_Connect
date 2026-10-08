import { useEffect, useRef, useState, type CSSProperties, type ElementType, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { useMotion } from './MotionProvider';
import { useEntrance } from './useInView';

/**
 * Fade-up entrance: 12 px, 300 ms, cubic-bezier(.215,.61,.355,1), once, for a
 * block that arrives from below the fold.
 *
 *   <Reveal>…</Reveal>                     one block
 *   <Reveal delay={160}>…</Reveal>         a little after its neighbours
 *   <RevealGroup className="grid …">       each direct child in turn, 40 ms apart
 *     <Card/> <Card/> <Card/>
 *   </RevealGroup>
 *
 * Since the design audit of 8 Oct 2026 (blocks sat half transparent while the
 * page scrolled, titles were cut mid-animation):
 *  - a block already on screen when it mounts renders in its final state, with
 *    no hidden-then-reveal (useEntrance); so does everything under reduced
 *    motion;
 *  - a block below the fold starts to arrive 15 % of a screen before it shows,
 *    and takes 300 ms;
 *  - `delay` is halved and capped at 120 ms: the call sites were written for
 *    the old 80 ms rhythm (`(i % 3) * 80`), which now gives 40 ms between cards;
 *  - a group's step is 40 ms by default, never more than 60 ms, and the stagger
 *    stops growing after the sixth child (smc-motion.css).
 *
 * A 2 s safety net shows the content even if the observer never runs. Once the
 * entrance has played, the reveal styles are dropped (`is-done`), so a child's
 * own hover transition (card lift) is not slowed by the stagger delay.
 */

type RevealOwnProps = {
  as?: ElementType;
  /** Delay before this block starts, in ms (halved, at most 120 ms: see above). */
  delay?: number;
  /** Travel distance in px (default 12). */
  y?: number;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
};

type RevealProps = RevealOwnProps & Omit<HTMLAttributes<HTMLElement>, keyof RevealOwnProps>;

/** Entrance length, in ms (smc-motion.css uses the same). */
const DURATION = 300;
/** The longest a block waits after its neighbours, in ms. */
const MAX_DELAY = 120;
/** A group's children are never more than this apart, in ms. */
const MAX_STEP = 60;
/** The stagger stops growing after this many steps (the sixth child; smc-motion.css). */
const MAX_STEPS = 5;

/** A call site's delay, on the 300 ms scale. */
const scaledDelay = (delay: number) => Math.min(MAX_DELAY, Math.max(0, Math.round(delay / 2)));

function useRevealState(delay: number, extra: number) {
  const ref = useRef<HTMLElement>(null);
  const { reduced } = useMotion();
  const phase = useEntrance(ref, reduced);
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (phase !== 'in' || done) return;
    const timer = window.setTimeout(() => setDone(true), delay + extra + DURATION + 50);
    return () => window.clearTimeout(timer);
  }, [phase, done, delay, extra]);
  const entering = phase === 'in' && !done;
  return {
    ref,
    classes: cn(
      phase === 'armed' ? 'is-armed' : 'is-in',
      entering ? 'is-entering' : phase !== 'armed' && 'is-done',
    ),
  };
}

export function Reveal({ as: Tag = 'div', delay = 0, y, className, style, children, ...rest }: RevealProps) {
  const wait = scaledDelay(delay);
  const { ref, classes } = useRevealState(wait, 0);
  return (
    <Tag
      ref={ref}
      className={cn('reveal', classes, className)}
      style={{ '--reveal-delay': `${wait}ms`, ...(y !== undefined ? { '--reveal-y': `${y}px` } : null), ...style } as CSSProperties}
      {...rest}
    >
      {children}
    </Tag>
  );
}

type RevealGroupProps = RevealProps & {
  /** Time between two children, in ms (default 40, at most 60). */
  step?: number;
};

export function RevealGroup({ as: Tag = 'div', delay = 0, step = 40, y, className, style, children, ...rest }: RevealGroupProps) {
  const wait = scaledDelay(delay);
  const gap = Math.min(MAX_STEP, Math.max(0, step));
  const { ref, classes } = useRevealState(wait, gap * MAX_STEPS);
  return (
    <Tag
      ref={ref}
      className={cn('reveal-group', classes, className)}
      style={{
        '--reveal-delay': `${wait}ms`,
        '--reveal-step': `${gap}ms`,
        ...(y !== undefined ? { '--reveal-y': `${y}px` } : null),
        ...style,
      } as CSSProperties}
      {...rest}
    >
      {children}
    </Tag>
  );
}
