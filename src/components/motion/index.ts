/**
 * SMC motion kit (refonte, Oct 2026). Generic web patterns (reveals, line
 * reveals, counters, parallax, scroll progress, logo marquee) plus the sounding
 * lines motif; see src/styles/smc-motion.css for the keyframes and the global
 * switches (reduced motion, pause). The brand components built on top of them
 * (SplitHero, NewsBand, Carousel…) live in components/brand.
 * Dev showcase: /__brand (dev server only).
 *
 * Entrances since the design audit of 8 Oct 2026 (useEntrance): nothing on
 * screen at load is ever hidden, heroes never wait, a block below the fold
 * starts arriving 15 % of a screen early and takes 300 ms, staggers are 40 ms
 * (60 at most) and capped, and figures show their final value.
 */
export { MotionProvider, useMotion } from './MotionProvider';
export { MotionPauseToggle } from './MotionPauseToggle';
export { useReducedMotion, useMediaQuery, prefersReducedMotion } from './useReducedMotion';
export {
  useInView, useOnScreen, useDocumentVisible, useEntrance, ENTRANCE_ROOT_MARGIN,
  type InViewOptions, type EntrancePhase,
} from './useInView';
export { Reveal, RevealGroup } from './Reveal';
export { LineReveal } from './LineReveal';
export { useScrollProgress, useScrollProgressValue, type ScrollProgressMode } from './useScrollProgress';
export { useParallax } from './useParallax';
export { subscribeScroll, subscribeTicker } from './scrollLoop';
export { Counter } from './Counter';
export { LogoMarquee, type MarqueeGroup, type MarqueeLogo } from './LogoMarquee';
export { BathyPattern } from './BathyPattern';
export { Graticule } from './Graticule';
export { ChannelSteps, type ChannelStep } from './ChannelSteps';
