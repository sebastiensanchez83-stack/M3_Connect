import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useMotion } from '@/components/motion/MotionProvider';
import { useInView } from '@/components/motion/useInView';

/**
 * A live figure set on split-flap tiles, like the departures board: semibold,
 * tabular, in the signage face. The tiles stay blank until the figure scrolls
 * into view, then each digit flips once (70 ms apart) and stays. Only real,
 * live figures go through it (networkStats).
 *
 * Screen readers get the number as text; the tiles are aria-hidden. Reduced
 * motion: the final number at once. While the figure is loading: a dash.
 */
const NBSP = String.fromCharCode(0xa0);
const STEP_MS = 70;
const FOLD_MS = 380;

export function FlapFigure({
  value,
  suffix = '',
  className,
}: {
  value: number | null | undefined;
  /** Appended after the number, e.g. "+" for an admin-typed figure. */
  suffix?: string;
  /** Font size and colour context; the tiles scale with the font size. */
  className?: string;
}) {
  const { i18n } = useTranslation();
  const { reduced } = useMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { disabled: reduced, threshold: 0.5 });
  const text = value == null ? null : `${value.toLocaleString(i18n.language === 'fr' ? 'fr-FR' : 'en-GB')}${suffix}`;
  const [phase, setPhase] = useState<'blank' | 'flip' | 'done'>(reduced ? 'done' : 'blank');

  useEffect(() => {
    if (text === null) return;
    if (reduced) {
      setPhase('done');
      return;
    }
    if (!inView || phase !== 'blank') return;
    setPhase('flip');
    const timer = window.setTimeout(() => setPhase('done'), (text.length - 1) * STEP_MS + FOLD_MS + 60);
    return () => window.clearTimeout(timer);
    // Flips once: later changes of the figure simply show.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView, reduced, text === null]);

  return (
    <span ref={ref} className={cn('inline-flex items-center font-signage font-semibold tabular', className)}>
      {text === null ? (
        <span aria-hidden="true" className="flap flap-tight">—</span>
      ) : (
        <>
          <span className="sr-only">{text}</span>
          <span aria-hidden="true" className="inline-flex">
            {Array.from(text).map((c, i) => {
              const glyph = c === ' ' || c === ' ' ? NBSP : c;
              if (phase === 'blank') return <span key={i} className="flap flap-tight">{NBSP}</span>;
              if (phase === 'done') return <span key={i} className="flap flap-tight">{glyph}</span>;
              return (
                <span key={i} className="flap flap-tight" style={{ '--d': `${i * STEP_MS}ms` } as CSSProperties}>
                  <span className="flap-half flap-top"><span>{glyph}</span></span>
                  <span className="flap-half flap-bottom"><span>{NBSP}</span></span>
                  <span className="flap-half flap-fold-top"><span>{NBSP}</span></span>
                  <span className="flap-half flap-fold-bottom"><span>{glyph}</span></span>
                </span>
              );
            })}
          </span>
        </>
      )}
    </span>
  );
}
