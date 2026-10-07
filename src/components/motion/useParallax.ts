import { useEffect, type RefObject } from 'react';
import { useMotion } from './MotionProvider';
import { subscribeScroll } from './scrollLoop';

/**
 * Parallax: the element drifts slower than the page, by at most `max` px.
 *
 *  - mode 'element' (default): for a picture inside a clipping frame (a card,
 *    a tile). 0 when the frame is centred in the viewport, up to ±max at the
 *    edges. The element's PARENT is the frame; give the element `max` px of
 *    bleed above and below (top: -max; bottom: -max) so it never shows an edge.
 *  - mode 'page': for a hero photo. Moves down by 6 % of the scroll distance,
 *    up to `max`, as the page scrolls (the photo lags behind the page).
 *
 * Transform only, one passive listener for the whole page. Off under reduced
 * motion (the picture stays put). Pausing the animations does not stop it: it
 * only moves while the reader scrolls.
 */
export function useParallax<T extends HTMLElement>(
  ref: RefObject<T>,
  { max = 24, mode = 'element', enabled = true }: { max?: number; mode?: 'element' | 'page'; enabled?: boolean } = {},
): void {
  const { reduced } = useMotion();
  const active = enabled && !reduced;
  useEffect(() => {
    const el = ref.current;
    if (!active || !el) return;
    const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
    const unsubscribe = subscribeScroll(() => {
      if (mode === 'page') {
        const y = window.scrollY;
        // Past the hero nothing is visible: stop writing.
        if (y > window.innerHeight * 2) return;
        el.style.transform = `translate3d(0, ${clamp(y * 0.06, 0, max).toFixed(1)}px, 0)`;
        return;
      }
      const frame = el.parentElement;
      if (!frame) return;
      const vh = window.innerHeight;
      const r = frame.getBoundingClientRect();
      if (r.bottom < -60 || r.top > vh + 60) return;
      const p = clamp((r.top + r.height / 2 - vh / 2) / (vh / 2 + r.height / 2), -1, 1);
      el.style.transform = `translate3d(0, ${(-p * max).toFixed(1)}px, 0)`;
    });
    return () => {
      unsubscribe();
      el.style.transform = '';
    };
  }, [ref, active, max, mode]);
}
