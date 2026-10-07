/**
 * SMC motion kit (refonte, Oct 2026). Generic web patterns plus our own harbour
 * motifs; see src/styles/smc-motion.css for the keyframes and the global
 * switches (reduced motion, pause). Dev showcase: /__brand (dev server only).
 */
export { MotionProvider, useMotion } from './MotionProvider';
export { MotionPauseToggle } from './MotionPauseToggle';
export { useReducedMotion, useMediaQuery, prefersReducedMotion } from './useReducedMotion';
export { useInView, useOnScreen, useDocumentVisible, type InViewOptions } from './useInView';
export { Reveal, RevealGroup } from './Reveal';
export { LineReveal } from './LineReveal';
export { useScrollProgress, useScrollProgressValue, type ScrollProgressMode } from './useScrollProgress';
export { Counter } from './Counter';
export { LogoMarquee, type MarqueeGroup, type MarqueeLogo } from './LogoMarquee';
export { BathyPattern } from './BathyPattern';
export { Graticule } from './Graticule';
export { WaveEdge, wavePath, type WaveLayer } from './WaveEdge';
export { WavePanel } from './WavePanel';
export { ChannelSteps, type ChannelStep } from './ChannelSteps';
export { PontoonTimeline, type PontoonItem } from './PontoonTimeline';
