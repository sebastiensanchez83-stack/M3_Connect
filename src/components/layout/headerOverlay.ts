import { useLayoutEffect, useState, useSyncExternalStore, type RefObject } from 'react';

/**
 * Lets a full-bleed hero tell the Navbar "I am at the top of this page".
 *
 * While a hero is registered, the header overlaps it (it no longer pushes the
 * page down) and stays transparent with a white logo until the hero has scrolled
 * under it; then it turns solid white with a thin bottom rule. Pages without a
 * registered hero (admin, account, forms…) get the solid header as before.
 *
 * A hero only registers when it really is the first thing in <main>: a PageHero
 * placed lower on a page must not make the header transparent over other content.
 */

let hero: HTMLElement | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The registered hero element, or null. For the Navbar. */
export function useHeaderHero(): HTMLElement | null {
  return useSyncExternalStore(subscribe, () => hero, () => null);
}

/** True when `el` starts at the top of <main id="main-content"> (an inset hero keeps its 12 px margin above it). */
function isAtTopOfMain(el: HTMLElement): boolean {
  const main = document.getElementById('main-content');
  if (!main || !main.contains(el)) return false;
  const offset = el.getBoundingClientRect().top - main.getBoundingClientRect().top;
  return offset > -2 && offset <= 16;
}

/**
 * Called by InsetHero and PageHero. Returns whether the header now overlaps
 * this hero, so the hero can add room for it (padding-top = header height).
 */
export function useRegisterHeaderHero(ref: RefObject<HTMLElement>, enabled = true): boolean {
  const [overlaid, setOverlaid] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!enabled || !el || !isAtTopOfMain(el)) {
      setOverlaid(false);
      return;
    }
    hero = el;
    emit();
    setOverlaid(true);
    return () => {
      if (hero === el) {
        hero = null;
        emit();
      }
    };
  }, [ref, enabled]);
  return overlaid;
}
