import { useEffect, useState, type RefObject } from 'react';

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
        { rootMargin, threshold },
      ),
    };
    pool.set(key, shared);
  }
  return shared;
}

export interface InViewOptions {
  /** Shrinks the viewport: the default triggers once the element is 6 % above the bottom edge. */
  rootMargin?: string;
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
 * True once the element has entered the viewport. Used by every entrance
 * (Reveal, LineReveal, Counter, DepartureBoard…).
 */
export function useInView<T extends Element>(
  ref: RefObject<T>,
  { rootMargin = '0px 0px -6% 0px', threshold = 0.12, once = true, disabled = false, fallbackMs = 2000 }: InViewOptions = {},
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
      if (entry.isIntersecting) {
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
 * condition for a cycle (board, pontoon tag, typed placeholder) to keep running.
 * Off screen or in a background tab it stops, so it costs nothing there.
 */
export function useOnScreen<T extends Element>(ref: RefObject<T>, disabled = false): boolean {
  const inView = useInView(ref, { once: false, threshold: 0, rootMargin: '0px', disabled, fallbackMs: 60000 });
  const docVisible = useDocumentVisible();
  return inView && docVisible;
}
