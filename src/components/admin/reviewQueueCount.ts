import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';

/**
 * The number of items waiting on /admin/review: admin_review_queue_count()
 * (staff only, migration 20261009230000). AdminPage reads it ONCE for the whole
 * admin area and shares it through ReviewCountContext: the sidebar badge, the
 * phone bar and the dashboard card show the same figure, and the full queue is
 * not recomputed by every screen.
 *
 * It is read again:
 * - when /admin/review announces a new total (REVIEW_QUEUE_EVENT, detail.count);
 * - when the tab comes back into view, or the admin moves to another admin
 *   screen, at most once every 30 seconds;
 * - when a screen asks for it (refresh(), e.g. the dashboard's Refresh button).
 * null = unknown (function not deployed yet, not staff, or an error): no badge.
 */

export const REVIEW_QUEUE_EVENT = 'smc:review-queue-changed';

export interface ReviewCount {
  count: number | null;
  refresh: () => void;
}

export const ReviewCountContext = createContext<ReviewCount>({ count: null, refresh: () => undefined });

/** The shared figure, for any screen inside the admin area. */
export function useReviewCount(): ReviewCount {
  return useContext(ReviewCountContext);
}

const MIN_GAP_MS = 30_000;

/** The source of the figure (AdminPage only). Keyed on the user id: auth re-emits the user on every refocus. */
export function useReviewCountSource(enabled: boolean, uid: string | undefined, pathname: string): ReviewCount {
  const [count, setCount] = useState<number | null>(null);
  const lastFetch = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const fetchCount = useCallback(() => {
    lastFetch.current = Date.now();
    supabase.rpc('admin_review_queue_count').then(({ data, error }) => {
      if (mounted.current) setCount(!error && typeof data === 'number' ? data : null);
    });
  }, []);

  const active = enabled && !!uid;

  useEffect(() => {
    if (!active) return;
    fetchCount();
    const onChange = (e: Event) => {
      const n = (e as CustomEvent<{ count?: unknown }>).detail?.count;
      if (typeof n === 'number') {
        lastFetch.current = Date.now();
        setCount(n);
      } else fetchCount();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastFetch.current > MIN_GAP_MS) fetchCount();
    };
    window.addEventListener(REVIEW_QUEUE_EVENT, onChange);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener(REVIEW_QUEUE_EVENT, onChange);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [active, uid, fetchCount]);

  // Another admin screen: a decision may have been taken there.
  useEffect(() => {
    if (active && Date.now() - lastFetch.current > MIN_GAP_MS) fetchCount();
  }, [active, pathname, fetchCount]);

  return useMemo(() => ({ count, refresh: fetchCount }), [count, fetchCount]);
}
