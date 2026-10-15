import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { readRegistrationFlags } from '@/lib/flags';
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
 *
 * With registration_flags.review_queue on, the figure is what waits for a DECISION in the
 * v2 list: the People & companies, Event registrations and Reports & content topics
 * (admin_review_queue_counts(): people + registrations + content). The FYI topics (Team
 * joins, Duplicates, Retro-review) are left out, as the 08:00 digest leaves them out; their
 * own counts show on their tabs. A join request (the owner decides) is in People & companies
 * and counts until M3 marks it seen: admin_review_queue_counts() does not split it out, and
 * /admin/review announces the same figure (needsDecision). If that function is not installed
 * yet, the v1 count as before.
 */

export const REVIEW_QUEUE_EVENT = 'smc:review-queue-changed';

/** The v2 topics whose items wait for a decision (the badge); the others are FYI. */
export const DECISION_TABS = ['people', 'registrations', 'content'] as const;

/** A v2 row that counts in the badge (same rule as the counts below). */
export function needsDecision(row: { tab: string }): boolean {
  return (DECISION_TABS as readonly string[]).includes(row.tab);
}

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
    void (async () => {
      const flags = await readRegistrationFlags();
      // Which list (v1 or v2) the badge counts depends on the switch: when it cannot be read,
      // no badge rather than a guess (the next refresh tries again).
      if (!flags) {
        if (mounted.current) setCount(null);
        return;
      }
      if (flags.review_queue) {
        const { data, error } = await supabase.rpc('admin_review_queue_counts');
        const counts = !error && data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
        const parts = counts ? DECISION_TABS.map(k => counts[k]) : [];
        if (counts && parts.every(n => typeof n === 'number')) {
          if (mounted.current) setCount((parts as number[]).reduce((a, b) => a + b, 0));
          return;
        }
      }
      const { data, error } = await supabase.rpc('admin_review_queue_count');
      if (mounted.current) setCount(!error && typeof data === 'number' ? data : null);
    })();
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
