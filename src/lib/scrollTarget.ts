import { prefersReducedMotion } from '@/components/motion/useReducedMotion';

/**
 * The header's height while it shows: the layout publishes it as --header-full
 * (64 px on phones and working screens, 72 px from md, src/index.css). 64 is only
 * the fallback when the variable cannot be read.
 */
function headerHeight(): number {
  if (typeof document === 'undefined') return 64;
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-full'));
  return Number.isFinite(v) && v > 0 ? v : 64;
}

/**
 * Where to scroll so `el` lands just under a page's sticky bar.
 *
 * The header tucks away when the page scrolls down and comes back when it
 * scrolls up, so its height only counts on the way up. Under reduced motion it
 * never tucks away, so it always counts.
 */
export function scrollTopUnderBars(el: HTMLElement, barHeight: number, gap = 8): number {
  const base = el.getBoundingClientRect().top + window.scrollY - barHeight - gap;
  const goingUp = base < window.scrollY;
  const headerShows = goingUp || prefersReducedMotion();
  return Math.max(0, headerShows ? base - headerHeight() : base);
}
