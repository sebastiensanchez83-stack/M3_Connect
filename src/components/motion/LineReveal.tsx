import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ElementType } from 'react';
import { cn } from '@/lib/utils';
import { useMotion } from './MotionProvider';
import { useEntrance } from './useInView';

/**
 * A heading whose lines rise one after the other out of a mask, when it
 * arrives from below the fold.
 *
 * Each word gets its own mask; after layout the words are grouped by line
 * (offsetTop), and every word of a line shares that line's delay, so the eye
 * reads lines, not words. Measured again when the fonts arrive and when the
 * width changes before the entrance has played.
 *
 * Since the design audit of 8 Oct 2026 (titles were caught half masked while
 * the page scrolled, the /directory hero stayed empty for two seconds):
 *  - a heading already on screen when it mounts is plain text, with no mask
 *    and no entrance; so is every hero title (`trigger="mount"`): a hero never
 *    waits for an animation;
 *  - below the fold, the lines start rising 15 % of a screen before they show,
 *    in 300 ms, 50 ms apart (at most three steps); `delay` is halved and capped
 *    at 120 ms, like Reveal's.
 *
 * The text exists once in the page (no hidden duplicate), so an H1 reads the
 * same for screen readers and search engines. Under reduced motion the text is
 * rendered as is.
 *
 *   <LineReveal as="h2" className="text-h2-sm md:text-h2 text-navy">
 *     One network for marinas and the companies that serve them
 *   </LineReveal>
 */
export function LineReveal({
  as: Tag = 'h2',
  children,
  className,
  delay = 0,
  step = 50,
  trigger = 'view',
  id,
}: {
  as?: ElementType;
  /** Plain text only (no markup): it is split into words. */
  children: string;
  className?: string;
  /** ms before the first line (halved, at most 120 ms). */
  delay?: number;
  /** ms between two lines (at most 60). */
  step?: number;
  /** 'view': rises when it arrives from below the fold. 'mount' (hero titles): shown at once, as plain text. */
  trigger?: 'view' | 'mount';
  id?: string;
}) {
  const { reduced } = useMotion();
  const ref = useRef<HTMLElement>(null);
  const phase = useEntrance(ref, reduced || trigger === 'mount');
  const words = useMemo(() => children.split(/\s+/).filter(Boolean), [children]);
  const [lineOf, setLineOf] = useState<number[]>([]);
  const [done, setDone] = useState(false);
  const masked = phase !== 'shown';

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const spans = el.querySelectorAll<HTMLElement>('[data-lr-word]');
    const next: number[] = [];
    let line = -1;
    let lastTop: number | null = null;
    spans.forEach((span) => {
      const top = span.offsetTop;
      if (lastTop === null || Math.abs(top - lastTop) > 4) {
        line += 1;
        lastTop = top;
      }
      next.push(line);
    });
    setLineOf((prev) => (prev.length === next.length && prev.every((v, i) => v === next[i]) ? prev : next));
  }, []);

  // The masks exist only while the heading waits below the fold or rises.
  useLayoutEffect(() => {
    if (phase === 'armed') measure();
  }, [phase, measure, words]);

  // Fonts change the line breaks; so does the width, until the entrance has played.
  useEffect(() => {
    if (phase !== 'armed') return;
    let alive = true;
    document.fonts?.ready.then(() => alive && measure()).catch(() => {});
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return () => { alive = false; };
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    return () => {
      alive = false;
      ro.disconnect();
    };
  }, [phase, measure]);

  const wait = Math.min(120, Math.max(0, Math.round(delay / 2)));
  const gap = Math.min(60, Math.max(0, step));
  const lines = lineOf.length > 0 ? Math.min(3, Math.max(...lineOf)) : 0;

  // Once risen, the transitions are dropped (the words stay in their masks: no reflow).
  useEffect(() => {
    if (phase !== 'in' || done) return;
    const timer = window.setTimeout(() => setDone(true), wait + lines * gap + 350);
    return () => window.clearTimeout(timer);
  }, [phase, done, wait, lines, gap]);

  if (!masked) {
    return <Tag ref={ref} id={id} className={className}>{children}</Tag>;
  }

  return (
    <Tag
      ref={ref}
      id={id}
      className={cn('line-reveal', phase === 'armed' ? 'is-armed' : done ? 'is-done' : 'is-entering', className)}
      style={{ '--lr-delay': `${wait}ms`, '--lr-step': `${gap}ms` } as CSSProperties}
    >
      {/* The words stay real text, once: screen readers, translation tools and
          search engines read the sentence as written (the spaces sit between
          the masks, so it is never read as one long word). */}
      {words.map((word, i) => (
        <span key={`${word}-${i}`}>
          <span className="lr-w" data-lr-word>
            <span className="lr-i" style={{ '--li': Math.min(3, lineOf[i] ?? 0) } as CSSProperties}>{word}</span>
          </span>
          {i < words.length - 1 ? ' ' : null}
        </span>
      ))}
    </Tag>
  );
}
