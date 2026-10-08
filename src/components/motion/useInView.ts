import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

/**
 * Shared IntersectionObservers, one per option set, so a page with forty
 * reveals runs one observer, not forty.
 */
type Callback = (entry: IntersectionObserverEntry) => void;

interface Shared {
  observer: IntersectionObserver;
  callbacks: Map<Element, Callback>;
}

const pool = new Map<string, Shared>();

/**
 * A block taller than about 4 viewports can never be `threshold` (12 %) visible
 * at once (a 7,800 px programme on a 844 px phone), so it would stay hidden for
 * good. For any threshold above 0 the observer therefore also reports a few
 * small ratios, and the callback decides: "in" once the threshold ratio is
 * reached OR half a viewport of the block is on screen, whichever comes first.
 * For a block of normal height the two rules are the same and nothing changes.
 */
const TALL_STEPS = [0.005, 0.01, 0.02, 0.03, 0.05, 0.08];

function thresholdsFor(threshold: number): number | number[] {
  if (threshold <= 0) return threshold;
  return [0, ...TALL_STEPS.filter((s) => s < threshold), threshold];
}

/** True when this report means "in view" (see TALL_STEPS). */
function reachedThreshold(entry: IntersectionObserverEntry, threshold: number): boolean {
  if (!entry.isIntersecting) return false;
  if (threshold <= 0 || entry.intersectionRatio >= threshold) return true;
  const rootHeight = entry.rootBounds?.height ?? (typeof window === 'undefined' ? 0 : window.innerHeight);
  const need = Math.min(entry.boundingClientRect.height * threshold, rootHeight * 0.5);
  return entry.intersectionRect.height >= need;
}

function getShared(rootMargin: string, threshold: number): Shared {
  const key = `${rootMargin}|${threshold}`;
  let shared = pool.get(key);
  if (!shared) {
    const callbacks = new Map<Element, Callback>();
    shared = {
      callbacks,
      observer: new IntersectionObserver(
        (entries) => {
          for (const entry of entries) callbacks.get(entry.target)?.(entry);
        },
        { rootMargin, threshold: thresholdsFor(threshold) },
      ),
    };
    pool.set(key, shared);
  }
  return shared;
}

/**
 * How far below the fold an entrance starts: the watched viewport is stretched
 * 15 % downwards, so a block starts to arrive just before the reader can see it
 * and has settled by the time it shows. (Design audit, 8 Oct 2026: blocks used
 * to sit half transparent, and titles half masked, while the page scrolled.)
 */
export const ENTRANCE_ROOT_MARGIN = '0px 0px 15% 0px';

export interface InViewOptions {
  /** Grows or shrinks the viewport. Default: ENTRANCE_ROOT_MARGIN, 15 % below the bottom edge. */
  rootMargin?: string;
  /** Default 0: any part of the element inside the (stretched) viewport. */
  threshold?: number;
  /** Stop watching after the first time (default). False: report leaving too. */
  once?: boolean;
  /** Skip observing and report `true` straight away (reduced motion, or no motion wanted). */
  disabled?: boolean;
  /**
   * Safety net, in ms: if the observer has not reported anything by then (a
   * screenshot tool, a page rendered in the background, an old browser) the
   * element counts as in view, so content is never left invisible.
   */
  fallbackMs?: number;
}

/**
 * True once the element has entered the viewport (by default: once it is
 * within 15 % of a screen below the fold).
 */
export function useInView<T extends Element>(
  ref: RefObject<T>,
  { rootMargin = ENTRANCE_ROOT_MARGIN, threshold = 0, once = true, disabled = false, fallbackMs = 2000 }: InViewOptions = {},
): boolean {
  const [inView, setInView] = useState<boolean>(disabled);

  useEffect(() => {
    if (disabled) {
      setInView(true);
      return;
    }
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const shared = getShared(rootMargin, threshold);
    let reported = false;
    const stop = () => {
      shared.callbacks.delete(el);
      shared.observer.unobserve(el);
    };
    shared.callbacks.set(el, (entry) => {
      reported = true;
      if (reachedThreshold(entry, threshold)) {
        setInView(true);
        if (once) stop();
      } else if (!once) {
        setInView(false);
      }
    });
    shared.observer.observe(el);

    const timer = window.setTimeout(() => {
      // An observer reports every new target's state once, in or out, on the
      // next frame. No report at all after 2 s means it is not running here.
      if (!reported) {
        setInView(true);
        if (once) stop();
      }
    }, fallbackMs);

    return () => {
      window.clearTimeout(timer);
      stop();
    };
  }, [ref, rootMargin, threshold, once, disabled, fallbackMs]);

  return inView;
}

/**
 * Where a one-off entrance (Reveal, LineReveal, BgRevealPanel, ChannelSteps)
 * stands:
 *
 *  - 'shown': the final state, with no entrance at all. Every block starts
 *    here, and stays here when it is already on screen (or above it) the
 *    moment it mounts, under reduced motion, without IntersectionObserver, and
 *    in a hidden part of the page (display: none). Content that is in the
 *    viewport at load is therefore never hidden, not even for a frame.
 *  - 'armed': the block mounted below the fold. It is hidden (CSS) and waits.
 *  - 'in': it reached ENTRANCE_ROOT_MARGIN (or the 2 s safety net fired): it
 *    plays its entrance once, from the hidden state to the final one.
 *
 * The decision is taken in a layout effect, before the first paint, so a block
 * below the fold is never painted visible and then hidden.
 */
export type EntrancePhase = 'shown' | 'armed' | 'in';

export function useEntrance<T extends Element>(ref: RefObject<T>, disabled = false): EntrancePhase {
  const [phase, setPhase] = useState<EntrancePhase>('shown');
  // Once a block has arrived (or been shown), it never hides again.
  const settled = useRef(false);

  useLayoutEffect(() => {
    if (disabled) {
      settled.current = true;
      setPhase('shown');
      return;
    }
    if (settled.current) return;
    const el = ref.current;
    if (!el || typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') return;
    const viewport = window.innerHeight || document.documentElement.clientHeight || 0;
    // On screen, above it, or not laid out (a 0 × 0 box sits at the top): final state.
    if (el.getBoundingClientRect().top < viewport) {
      settled.current = true;
      return;
    }

    setPhase('armed');
    const shared = getShared(ENTRANCE_ROOT_MARGIN, 0);
    let reported = false;
    const stop = () => {
      shared.callbacks.delete(el);
      shared.observer.unobserve(el);
    };
    const arrive = () => {
      settled.current = true;
      setPhase('in');
      stop();
    };
    shared.callbacks.set(el, (entry) => {
      reported = true;
      if (entry.isIntersecting) arrive();
    });
    shared.observer.observe(el);
    // Safety net: an observer that never reports (a background render, a
    // screenshot tool) must not leave the block hidden.
    const timer = window.setTimeout(() => {
      if (!reported) arrive();
    }, 2000);
    return () => {
      window.clearTimeout(timer);
      stop();
    };
  }, [ref, disabled]);

  return phase;
}

/** True while the document is shown (false in a background tab). */
export function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden');
  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);
  return visible;
}

/**
 * True while any part of the element is on screen AND the tab is shown: the
 * condition for a cycle (event card, typed placeholder) to keep running.
 * Off screen or in a background tab it stops, so it costs nothing there.
 */
export function useOnScreen<T extends Element>(ref: RefObject<T>, disabled = false): boolean {
  const inView = useInView(ref, { once: false, threshold: 0, rootMargin: '0px', disabled, fallbackMs: 60000 });
  const docVisible = useDocumentVisible();
  return inView && docVisible;
}
