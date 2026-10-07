import { useEffect, useRef, useState, type RefObject } from 'react';

/**
 * How far the page has scrolled through an element, 0 → 1, computed once per
 * animation frame from a single passive scroll listener.
 *
 *  - mode 'pin' (default): for a tall section with a sticky inner panel.
 *    0 when the section's top reaches the top of the viewport, 1 when its
 *    bottom reaches the bottom: the stretch during which the panel is pinned.
 *  - mode 'through': 0 when the element's top enters at the bottom of the
 *    viewport, 1 when its bottom leaves at the top (parallax, progress bars).
 *
 * Pass a callback to drive styles directly (no React render per frame), e.g.
 * EventRoute moves its boat with it. `useScrollProgressValue` is the state
 * flavour, for when a re-render per change is fine.
 */
export type ScrollProgressMode = 'pin' | 'through';

export function useScrollProgress<T extends HTMLElement>(
  ref: RefObject<T>,
  onProgress: (progress: number) => void,
  { mode = 'pin', enabled = true }: { mode?: ScrollProgressMode; enabled?: boolean } = {},
): void {
  const cb = useRef(onProgress);
  cb.current = onProgress;

  useEffect(() => {
    if (!enabled) return;
    let frame = 0;
    let last = -1;

    const compute = () => {
      frame = 0;
      const el = ref.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight || document.documentElement.clientHeight;
      let p: number;
      if (mode === 'pin') {
        const travel = rect.height - vh;
        p = travel > 0 ? -rect.top / travel : rect.top <= 0 ? 1 : 0;
      } else {
        p = (vh - rect.top) / (vh + rect.height);
      }
      p = Math.min(1, Math.max(0, p));
      if (Math.abs(p - last) < 0.0005) return;
      last = p;
      cb.current(p);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(compute);
    };

    compute();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [ref, mode, enabled]);
}

/** State flavour: re-renders when the progress moves by `precision` (default 1 %). */
export function useScrollProgressValue<T extends HTMLElement>(
  ref: RefObject<T>,
  { mode = 'pin', enabled = true, precision = 0.01 }: { mode?: ScrollProgressMode; enabled?: boolean; precision?: number } = {},
): number {
  const [value, setValue] = useState(0);
  useScrollProgress(
    ref,
    (p) => {
      const q = Math.round(p / precision) * precision;
      setValue((prev) => (prev === q ? prev : q));
    },
    { mode, enabled },
  );
  return value;
}
