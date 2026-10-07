import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ElementType } from 'react';
import { cn } from '@/lib/utils';
import { useMotion } from './MotionProvider';
import { useInView } from './useInView';

/**
 * A heading whose lines rise one after the other out of a mask.
 *
 * Each word gets its own mask; after layout the words are grouped by line
 * (offsetTop), and every word of a line shares that line's delay, so the eye
 * reads lines, not words. Measured again when the fonts arrive and when the
 * width changes before the entrance has played.
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
  step = 90,
  trigger = 'view',
  id,
}: {
  as?: ElementType;
  /** Plain text only (no markup): it is split into words. */
  children: string;
  className?: string;
  /** ms before the first line. */
  delay?: number;
  /** ms between two lines. */
  step?: number;
  /** 'view' when scrolled into view; 'mount' straight away (hero titles). */
  trigger?: 'view' | 'mount';
  id?: string;
}) {
  const { reduced } = useMotion();
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { disabled: reduced || trigger === 'mount' });
  const words = useMemo(() => children.split(/\s+/).filter(Boolean), [children]);
  const [lineOf, setLineOf] = useState<number[]>([]);
  const [armed, setArmed] = useState(trigger !== 'mount');

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

  useLayoutEffect(() => {
    if (!reduced) measure();
  }, [reduced, measure, words]);

  // Fonts change the line breaks; so does the width, until the entrance has played.
  useEffect(() => {
    if (reduced) return;
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
  }, [reduced, measure]);

  // 'mount': let the hidden state paint once before rising. A timer rather than
  // animation frames, which never fire in a tab rendered in the background: the
  // title must not stay hidden there.
  useEffect(() => {
    if (trigger !== 'mount' || reduced) return;
    const timer = window.setTimeout(() => setArmed(true), 40);
    return () => window.clearTimeout(timer);
  }, [trigger, reduced]);

  if (reduced) {
    return <Tag id={id} className={className}>{children}</Tag>;
  }

  const shown = trigger === 'mount' ? armed : inView;

  return (
    <Tag
      ref={ref}
      id={id}
      className={cn('line-reveal', shown && 'is-in', className)}
      style={{ '--lr-delay': `${delay}ms`, '--lr-step': `${step}ms` } as CSSProperties}
    >
      {/* The words stay real text, once: screen readers, translation tools and
          search engines read the sentence as written (the spaces sit between
          the masks, so it is never read as one long word). */}
      {words.map((word, i) => (
        <span key={`${word}-${i}`}>
          <span className="lr-w" data-lr-word>
            <span className="lr-i" style={{ '--li': lineOf[i] ?? 0 } as CSSProperties}>{word}</span>
          </span>
          {i < words.length - 1 ? ' ' : null}
        </span>
      ))}
    </Tag>
  );
}
