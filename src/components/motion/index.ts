/**
 * SMC motion kit (refonte, Oct 2026). Generic web patterns (reveals, line
 * reveals, counters, parallax, scroll progress, logo marquee) plus the sounding
 * lines motif; see src/styles/smc-motion.css for the keyframes and the global
 * switches (reduced motion, pause). The brand components built on top of them
 * (InsetHero, GiantMarquee, StickyStack…) live in components/brand.
 * Dev showcase: /__brand (dev server only).
 */
export { MotionProvider, useMotion } from './MotionProvider';
export { MotionPauseToggle } from './MotionPauseToggle';
export { useReducedMotion, useMediaQuery, prefersReducedMotion } from './useReducedMotion';
export { useInView, useOnScreen, useDocumentVisible, type InViewOptions } from './useInView';
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
