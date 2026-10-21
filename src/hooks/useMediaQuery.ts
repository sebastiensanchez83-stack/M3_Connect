import { useEffect, useState } from 'react';

/**
 * Whether a CSS media query matches now, following changes (a window resized, a tablet turned).
 * False where matchMedia does not exist. For a part of a page that must be mounted in one place
 * only (e.g. the comments: the side column on large screens, under the article on phones), so it
 * does not load twice the way two copies hidden by CSS would.
 */
export function useMediaQuery(query: string): boolean {
  const get = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(query);
    const on = () => setMatches(mq.matches);
    on();
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, [query]);
  return matches;
}
