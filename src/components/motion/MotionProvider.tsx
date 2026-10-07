import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useReducedMotion } from './useReducedMotion';

/**
 * One switch for all continuous motion on the site (WCAG 2.2.2 "Pause, Stop,
 * Hide"): the slow hero zoom, the drifting waves and sounding lines, the
 * sponsor marquee, the departure board and pontoon tag cycles, the typed
 * search placeholder.
 *
 *  - `reduced`: the visitor's system asks for less motion. Everything shows its
 *    final state and no loop starts (CSS handles the rest, see smc-motion.css).
 *  - `paused`: the visitor pressed a pause control (MotionPauseToggle). Loops
 *    freeze where they are; one-off entrances still finish. Remembered in this
 *    browser only (localStorage, best effort).
 *  - `still`: either of the two. Components with a JS timer check this.
 *
 * The provider mirrors `paused` on <html data-motion-paused>, which is what the
 * CSS listens to, so a purely CSS loop needs no React code to obey it.
 */

const STORAGE_KEY = 'smc-motion-paused';

interface MotionState {
  reduced: boolean;
  paused: boolean;
  still: boolean;
  setPaused: (paused: boolean) => void;
  togglePaused: () => void;
}

const MotionContext = createContext<MotionState>({
  reduced: false,
  paused: false,
  still: false,
  setPaused: () => {},
  togglePaused: () => {},
});

function readStoredPause(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function MotionProvider({ children }: { children: React.ReactNode }) {
  const reduced = useReducedMotion();
  const [paused, setPausedState] = useState<boolean>(readStoredPause);

  useEffect(() => {
    const root = document.documentElement;
    if (paused) root.setAttribute('data-motion-paused', '');
    else root.removeAttribute('data-motion-paused');
  }, [paused]);

  const setPaused = useCallback((next: boolean) => {
    setPausedState(next);
    try {
      if (next) window.localStorage.setItem(STORAGE_KEY, '1');
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* storage blocked: the choice lasts for this page only */
    }
  }, []);

  const togglePaused = useCallback(() => setPaused(!paused), [paused, setPaused]);

  const value = useMemo<MotionState>(
    () => ({ reduced, paused, still: reduced || paused, setPaused, togglePaused }),
    [reduced, paused, setPaused, togglePaused],
  );

  return <MotionContext.Provider value={value}>{children}</MotionContext.Provider>;
}

/** The site-wide motion state. Safe outside the provider (everything moving, nothing paused). */
export function useMotion(): MotionState {
  return useContext(MotionContext);
}
