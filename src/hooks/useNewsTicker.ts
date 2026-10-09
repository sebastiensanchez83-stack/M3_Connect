import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { WYS26_EVENT_ID } from '@/components/brand/m3Events';

/**
 * The data of the site-wide news ticker (SiteTicker): the latest articles, the
 * newest members and the next events and webinars. Public, read-only queries
 * with the same visibility rules as the pages that list them:
 *
 *  - articles: published resources, newest first (ResourcesPage's order);
 *  - members: verified organisations that have an owner on the platform (the
 *    imported, never-claimed listings are not "members"), newest first. There is
 *    no verification date in the table: the creation date stands for it, as on
 *    the home page's band before;
 *  - events: published (or unflagged) events from now on, soonest first, never
 *    the World Yachting Summit's draft row (EventsPage's rule; the ticker adds
 *    the Summit itself, linking to /wys26).
 *
 * Kept in memory and in this tab's sessionStorage, so moving from page to page
 * neither refetches nor blinks; after 5 minutes the next page asks again, the
 * old items staying on screen meanwhile. Kept apart for visitors and for each
 * signed-in account (row-level security may show members a little more).
 */

export interface TickerArticle {
  id: string;
  title: string;
  type: string | null;
  published_at: string | null;
}

export interface TickerMember {
  id: string;
  slug: string;
  name: string;
  organization_type: string | null;
  country: string | null;
  headquarters_country: string | null;
}

export interface TickerEvent {
  id: string;
  title: string;
  date_time: string;
  event_type: string | null;
  location: string | null;
}

export interface TickerData {
  articles: TickerArticle[];
  members: TickerMember[];
  events: TickerEvent[];
}

/** 'visitor', or 'member:<account id>' (each account its own copy). */
export type TickerScope = string;

/** How many of each kind the ticker carries. */
export const TICKER_PER_KIND = 4;
const TTL = 5 * 60 * 1000;
const STORAGE_PREFIX = 'smc-news-ticker:';

type Entry = { at: number; data: TickerData };
const memory = new Map<TickerScope, Entry>();
const inflight = new Map<TickerScope, Promise<TickerData | null>>();

function fresh(entry: Entry | null | undefined): entry is Entry {
  return !!entry && Date.now() - entry.at < TTL;
}

function readStored(scope: TickerScope): Entry | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_PREFIX + scope);
    if (!raw) return null;
    const entry = JSON.parse(raw) as Entry;
    if (!entry || typeof entry.at !== 'number' || !entry.data || !Array.isArray(entry.data.articles)) return null;
    return entry;
  } catch {
    return null;
  }
}

function store(scope: TickerScope, entry: Entry) {
  memory.set(scope, entry);
  try {
    window.sessionStorage.setItem(STORAGE_PREFIX + scope, JSON.stringify(entry));
  } catch {
    /* storage full or blocked: the in-memory copy is enough */
  }
}

/** What the cache holds for this scope, fresh or not (memory first, then this tab's sessionStorage). */
function peek(scope: TickerScope): Entry | null {
  const mem = memory.get(scope);
  if (mem) return mem;
  const stored = readStored(scope);
  if (stored) memory.set(scope, stored);
  return stored;
}

async function fetchTicker(): Promise<TickerData | null> {
  const now = new Date().toISOString();
  const [articles, members, events] = await Promise.allSettled([
    supabase
      .from('resources')
      .select('id, title, type, published_at')
      .eq('published', true)
      .order('published_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(TICKER_PER_KIND),
    supabase
      .from('organizations')
      .select('id, slug, name, organization_type, country, headquarters_country')
      .eq('access_status', 'verified')
      .not('owner_user_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(TICKER_PER_KIND),
    supabase
      .from('events')
      .select('id, title, date_time, event_type, location')
      .not('published', 'is', false)
      .neq('id', WYS26_EVENT_ID)
      .gte('date_time', now)
      .order('date_time', { ascending: true })
      .limit(TICKER_PER_KIND),
  ]);
  const rows = <T,>(r: PromiseSettledResult<{ data: unknown; error: unknown }>): T[] | null =>
    r.status === 'fulfilled' && !r.value.error && Array.isArray(r.value.data) ? (r.value.data as T[]) : null;

  const a = rows<TickerArticle>(articles);
  const m = rows<TickerMember>(members);
  const e = rows<TickerEvent>(events);
  // Nothing came back at all (offline, outage): not cached, the next page tries again.
  if (!a && !m && !e) return null;
  return {
    articles: (a ?? []).filter((r) => r.id && r.title),
    members: (m ?? []).filter((r) => r.slug && r.name),
    events: (e ?? []).filter((r) => r.id && r.title && r.date_time),
  };
}

function load(scope: TickerScope): Promise<TickerData | null> {
  const pending = inflight.get(scope);
  if (pending) return pending;
  const p = fetchTicker()
    .then((data) => {
      if (data) store(scope, { at: Date.now(), data });
      return data;
    })
    .catch(() => null)
    .finally(() => inflight.delete(scope));
  inflight.set(scope, p);
  return p;
}

/**
 * The ticker's data for `scope`. What the cache holds shows at once, even past
 * its 5 minutes (it is then fetched again and the strip updates in place);
 * `loading` is true only while nothing at all is known yet. A change of
 * `revalidate` (the page's path) checks the age again.
 */
export function useNewsTicker(
  enabled: boolean,
  scope: TickerScope,
  revalidate?: string,
): { data: TickerData | null; loading: boolean } {
  const [state, setState] = useState<{ scope: TickerScope; data: TickerData | null; done: boolean }>(() => {
    const data = enabled ? peek(scope)?.data ?? null : null;
    return { scope, data, done: !!data };
  });

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const hit = peek(scope);
    if (hit) setState((s) => (s.scope === scope && s.data === hit.data ? s : { scope, data: hit.data, done: true }));
    else setState((s) => (s.scope === scope ? s : { scope, data: null, done: false }));
    if (fresh(hit)) return;
    load(scope).then((data) => {
      if (!alive) return;
      setState((s) => ({ scope, data: data ?? (s.scope === scope ? s.data : null), done: true }));
    });
    return () => {
      alive = false;
    };
  }, [enabled, scope, revalidate]);

  const current = state.scope === scope ? state : { data: null, done: false };
  return { data: current.data, loading: enabled && !current.done };
}
