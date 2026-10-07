import { prefersReducedMotion } from '@/components/motion/useReducedMotion';

/** The header's height while it shows (src/components/layout/Navbar.tsx). */
const HEADER_H = 64;

/**
 * Where to scroll so `el` lands just under a page's sticky bar.
 *
 * The header tucks away when the page scrolls down and comes back when it
 * scrolls up, so its 64 px only count on the way up. Under reduced motion it
 * never tucks away, so it always counts.
 */
export function scrollTopUnderBars(el: HTMLElement, barHeight: number, gap = 8): number {
  const base = el.getBoundingClientRect().top + window.scrollY - barHeight - gap;
  const goingUp = base < window.scrollY;
  const headerShows = goingUp || prefersReducedMotion();
  return Math.max(0, headerShows ? base - HEADER_H : base);
}
