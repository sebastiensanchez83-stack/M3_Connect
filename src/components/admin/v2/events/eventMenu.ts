import { useEffect, useState } from 'react';
import { eventPhase, loadEventDirectory, sortEvents, type EventSummary } from './eventsApi';
import { onConsoleOf, onPageOf } from './eventSystems';

/**
 * The Events group of the admin menu, read from the database (Victor, 21 Oct 2026: no event
 * name in the code, so SM27 or another fair needs no developer).
 *
 *   - the current and upcoming events (soonest first), then the ones that ended in the last
 *     RECENT_DAYS days (most recent first: invoices, feedback and replays still happen then);
 *     test events never; at most MENU_MAX;
 *   - plus the event of the screen on show when it is not among them (an older event's page,
 *     its guest list, the fair console), so its console links stay reachable.
 *
 * One read for the whole admin area, kept for CACHE_MS; a save in the event editor asks for a
 * fresh one (notifyEventsChanged).
 */

export const MENU_MAX = 6;
const RECENT_DAYS = 120;
const CACHE_MS = 60_000;
const CHANGED = 'smc:admin-events-changed';

let cache: { at: number; list: EventSummary[] } | null = null;
let inflight: Promise<EventSummary[]> | null = null;

function fetchDirectory(force = false): Promise<EventSummary[]> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return Promise.resolve(cache.list);
  if (inflight) return inflight;
  inflight = loadEventDirectory()
    .then(list => { cache = { at: Date.now(), list }; return list; })
    .finally(() => { inflight = null; });
  return inflight;
}

/** An event was created, saved or copied: the menu reads the events again. */
export function notifyEventsChanged(): void {
  cache = null;
  try { window.dispatchEvent(new Event(CHANGED)); } catch { /* no window (tests) */ }
}

export function menuEvents(all: EventSummary[], now = Date.now()): EventSummary[] {
  const live = all.filter(e => !e.test);
  const { upcoming, past } = sortEvents(live, now);
  const recent = past.filter(e => {
    const end = e.end ? Date.parse(e.end) : e.start ? Date.parse(e.start) : 0;
    return now - end <= RECENT_DAYS * 24 * 3600 * 1000;
  });
  // Undated events are drafts being prepared: after the dated ones.
  const dated = upcoming.filter(e => eventPhase(e, now) !== 'undated');
  const undated = upcoming.filter(e => eventPhase(e, now) === 'undated');
  return [...dated, ...recent, ...undated].slice(0, MENU_MAX);
}

/** The event the screen on show belongs to (its page or one of its console screens). */
export function eventOfPath(all: EventSummary[], path: string): EventSummary | null {
  return all.find(e => onPageOf(e, path)) ?? all.find(e => onConsoleOf(e, path)) ?? null;
}

export interface EventMenuState {
  /** null while the first read is on its way. */
  items: EventSummary[] | null;
  /** The event of the current screen when it is not in `items`. */
  context: EventSummary | null;
  failed: boolean;
}

export function useEventMenu(path: string, enabled: boolean): EventMenuState {
  const [all, setAll] = useState<EventSummary[] | null>(cache?.list ?? null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const onChange = () => setTick(n => n + 1);
    window.addEventListener(CHANGED, onChange);
    return () => window.removeEventListener(CHANGED, onChange);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    fetchDirectory()
      .then(list => { if (alive) { setAll(list); setFailed(false); } })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
    // A new screen re-reads only when the cached list is older than CACHE_MS.
  }, [enabled, path, tick]);

  if (!all) return { items: null, context: null, failed };
  const items = menuEvents(all);
  const here = eventOfPath(all, path);
  const context = here && !items.some(e => e.key === here.key) ? here : null;
  return { items, context, failed };
}
