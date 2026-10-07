import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useMotion } from './MotionProvider';
import { useInView } from './useInView';

/**
 * A key figure that counts up once, the first time it scrolls into view
 * (0.9 s, ease-out). Only real, live figures go through it (networkStats).
 *
 * `value` may arrive late (null while loading): the count starts when both the
 * figure is known and the element is in view. Reduced motion: final number.
 * Tabular figures, so the width does not wobble while counting.
 */
export function Counter({
  value,
  duration = 900,
  format,
  suffix = '',
  placeholder = '—',
  className,
}: {
  value: number | null | undefined;
  duration?: number;
  /** Defaults to the locale's grouping (1,234 / 1 234). */
  format?: (n: number) => string;
  /** Appended after the number, e.g. "+" for an admin-typed figure. */
  suffix?: string;
  /** Shown while value is null. */
  placeholder?: string;
  className?: string;
}) {
  const { i18n } = useTranslation();
  const { reduced } = useMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { disabled: reduced });
  const [shown, setShown] = useState<number | null>(reduced ? value ?? null : null);
  const ran = useRef(false);

  useEffect(() => {
    if (value == null) return;
    if (reduced || ran.current) {
      setShown(value);
      return;
    }
    if (!inView) return;
    ran.current = true;
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      setShown(Math.round(value * (1 - Math.pow(1 - p, 3))));
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    // Background tabs throttle rAF: make sure the true figure lands anyway.
    const settle = window.setTimeout(() => setShown(value), duration + 250);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(settle);
    };
  }, [value, inView, reduced, duration]);

  const fmt = format ?? ((n: number) => n.toLocaleString(i18n.language === 'fr' ? 'fr-FR' : 'en-GB'));
  const text = value == null ? placeholder : `${fmt(shown ?? 0)}${suffix}`;

  return (
    <span ref={ref} className={cn('tabular', className)}>
      {text}
    </span>
  );
}
