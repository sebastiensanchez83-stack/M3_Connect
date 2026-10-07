import { useEffect, useRef, useState, type CSSProperties, type ElementType, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { useMotion } from './MotionProvider';
import { useInView } from './useInView';

/**
 * Fade-up entrance: 24 px, 0.8 s, cubic-bezier(.215,.61,.355,1), once, when
 * the block scrolls into view.
 *
 *   <Reveal>…</Reveal>                     one block
 *   <Reveal delay={160}>…</Reveal>         later than its neighbours
 *   <RevealGroup className="grid …">       each direct child in turn, 80 ms apart
 *     <Card/> <Card/> <Card/>
 *   </RevealGroup>
 *
 * Under reduced motion it renders the final state at once. A 2 s safety net
 * (useInView) shows the content even if the observer never runs. Once the
 * entrance has played, the reveal styles are dropped (`is-done`) so a child's
 * own hover transition (card lift) is not slowed by the stagger delay.
 */

type RevealOwnProps = {
  as?: ElementType;
  /** Delay before this block starts, in ms. */
  delay?: number;
  /** Travel distance in px (default 24). */
  y?: number;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
};

type RevealProps = RevealOwnProps & Omit<HTMLAttributes<HTMLElement>, keyof RevealOwnProps>;

const DURATION = 800;

function useRevealState(delay: number, extra: number) {
  const ref = useRef<HTMLElement>(null);
  const { reduced } = useMotion();
  const inView = useInView(ref, { disabled: reduced });
  const [done, setDone] = useState(reduced);
  useEffect(() => {
    if (!inView || done) return;
    const timer = window.setTimeout(() => setDone(true), delay + extra + DURATION + 100);
    return () => window.clearTimeout(timer);
  }, [inView, done, delay, extra]);
  return { ref, inView, done };
}

export function Reveal({ as: Tag = 'div', delay = 0, y, className, style, children, ...rest }: RevealProps) {
  const { ref, inView, done } = useRevealState(delay, 0);
  return (
    <Tag
      ref={ref}
      className={cn('reveal', inView && 'is-in', done && 'is-done', className)}
      style={{ '--reveal-delay': `${delay}ms`, ...(y !== undefined ? { '--reveal-y': `${y}px` } : null), ...style } as CSSProperties}
      {...rest}
    >
      {children}
    </Tag>
  );
}

type RevealGroupProps = RevealProps & {
  /** Time between two children, in ms (default 80). */
  step?: number;
};

export function RevealGroup({ as: Tag = 'div', delay = 0, step = 80, y, className, style, children, ...rest }: RevealGroupProps) {
  // The last child (CSS caps the stagger at 12) finishes 11 steps after the first.
  const { ref, inView, done } = useRevealState(delay, step * 11);
  return (
    <Tag
      ref={ref}
      className={cn('reveal-group', inView && 'is-in', done && 'is-done', className)}
      style={{
        '--reveal-delay': `${delay}ms`,
        '--reveal-step': `${step}ms`,
        ...(y !== undefined ? { '--reveal-y': `${y}px` } : null),
        ...style,
      } as CSSProperties}
      {...rest}
    >
      {children}
    </Tag>
  );
}
