import { supabase } from '@/lib/supabase';
import { SPONSOR_TIERS } from '@/types/database';
import { WYS26_EVENT_ID } from '@/components/brand/m3Events';

/**
 * The search pill's suggestions (SearchField `suggest`): public, read-only
 * queries with the same visibility rules as the pages that list each kind.
 *
 *  - companies: verified organisations (DirectoryPage), or on /partners the
 *    event sponsors only (paying tiers, plus media outlets tagged as event media
 *    partners: PartnersPage's two queries in one);
 *  - articles: published resources (ResourcesPage);
 *  - events: published (or unflagged) events, never the World Yachting Summit's
 *    draft row (EventsPage); the UI adds the Summit itself, linking to /wys26;
 *  - themes: the six themes are local (lib/themes.ts); the 17 sectors are read
 *    once per visit.
 *
 * Every word typed must appear in the name or title (case-insensitive), so
 * "marina nice" finds "Port de Nice Marina". A few more rows than shown are
 * read, then ranked here: a name that starts with the search first, then a word
 * that starts with it, then members (an owner on the platform) before imported
 * listings. Results are kept for the visit, so going back a letter is instant.
 */

export type SuggestGroup = 'companies' | 'articles' | 'events' | 'themes';

/** Every group, in the order they are shown. */
export const ALL_SUGGESTIONS: readonly SuggestGroup[] = ['companies', 'articles', 'events', 'themes'];

export type SuggestScope = 'directory' | 'sponsors';

export interface CompanyRow {
  id: string;
  slug: string;
  name: string;
  organization_type: string | null;
  logo_url: string | null;
  country: string | null;
  headquarters_country: string | null;
  owner_user_id: string | null;
}

export interface ArticleRow {
  id: string;
  title: string;
  type: string | null;
  published_at: string | null;
}

export interface EventRow {
  id: string;
  title: string;
  date_time: string;
  event_type: string | null;
}

export interface SectorRow {
  id: string;
  slug: string;
  label: string;
}

export interface SuggestResults {
  companies: CompanyRow[];
  articles: ArticleRow[];
  events: EventRow[];
  sectors: SectorRow[];
}

/** How many suggestions a group shows at most. */
export const PER_GROUP = 5;

/** Lower case, accents off: "Côte" → "cote". */
export const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** The words of a search, folded, at most five. */
export function searchWords(q: string): string[] {
  return fold(q).split(/[\s,;/]+/).map((w) => w.trim()).filter(Boolean).slice(0, 5);
}

/** A LIKE pattern for one word: its own %, _ and \ are literal; * (PostgREST's wildcard) is dropped. */
function likePattern(word: string): string {
  return `%${word.replace(/\*/g, '').replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** 0: the text starts with the search; 1: a word of it does; 2: it only contains it. */
export function matchRank(text: string, q: string): number {
  const t = fold(text);
  const f = fold(q.trim());
  if (t.startsWith(f)) return 0;
  const first = searchWords(q)[0] ?? f;
  return new RegExp(`(^|[^\\p{L}\\p{N}])${first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'u').test(t) ? 1 : 2;
}

let sectorsPromise: Promise<SectorRow[]> | null = null;
/** The active sectors, read once per visit (a failure is retried next time). */
function loadSectors(): Promise<SectorRow[]> {
  if (!sectorsPromise) {
    sectorsPromise = Promise.resolve(
      supabase.from('sectors').select('id, slug, label').eq('is_active', true).order('label'),
    ).then(({ data, error }) => {
      if (error || !Array.isArray(data)) {
        sectorsPromise = null;
        return [];
      }
      return data as SectorRow[];
    }, () => {
      sectorsPromise = null;
      return [];
    });
  }
  return sectorsPromise;
}

const cache = new Map<string, SuggestResults>();
const CACHE_MAX = 60;

export function cacheKey(q: string, groups: readonly SuggestGroup[], scope: SuggestScope): string {
  return `${scope}|${groups.join(',')}|${searchWords(q).join(' ')}`;
}

export function cachedSuggestions(key: string): SuggestResults | undefined {
  return cache.get(key);
}

/**
 * Suggestions for `q` in `groups`. Throws when every query failed (nothing is
 * cached then); a group whose query failed comes back empty.
 */
export async function fetchSuggestions(
  q: string,
  groups: readonly SuggestGroup[],
  scope: SuggestScope,
  signal?: AbortSignal,
): Promise<SuggestResults> {
  const words = searchWords(q);
  const empty = Promise.resolve({ data: [] as unknown[], error: null });
  const want = (g: SuggestGroup) => groups.includes(g) && words.length > 0;

  const companies = (() => {
    if (!want('companies')) return empty;
    let query = supabase
      .from('organizations')
      .select('id, slug, name, organization_type, logo_url, country, headquarters_country, owner_user_id')
      .eq('access_status', 'verified');
    if (scope === 'sponsors') {
      // A fixed filter (no user input inside or()): the paying tiers, or a tagged event media partner.
      query = query.or(`tier.in.(${SPONSOR_TIERS.join(',')}),and(organization_type.eq.media_partner,is_event_media_partner.eq.true)`);
    }
    for (const w of words) query = query.ilike('name', likePattern(w));
    query = query.order('name').limit(24);
    return signal ? query.abortSignal(signal) : query;
  })();

  const articles = (() => {
    if (!want('articles')) return empty;
    let query = supabase.from('resources').select('id, title, type, published_at').eq('published', true);
    for (const w of words) query = query.ilike('title', likePattern(w));
    query = query.order('published_at', { ascending: false, nullsFirst: false }).limit(12);
    return signal ? query.abortSignal(signal) : query;
  })();

  const events = (() => {
    if (!want('events')) return empty;
    let query = supabase
      .from('events')
      .select('id, title, date_time, event_type')
      .not('published', 'is', false)
      .neq('id', WYS26_EVENT_ID);
    for (const w of words) query = query.ilike('title', likePattern(w));
    query = query.order('date_time', { ascending: false }).limit(12);
    return signal ? query.abortSignal(signal) : query;
  })();

  const [c, a, e, s] = await Promise.allSettled([
    companies,
    articles,
    events,
    groups.includes('themes') ? loadSectors() : Promise.resolve([] as SectorRow[]),
  ]);
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  const rows = <T,>(r: PromiseSettledResult<{ data: unknown; error: unknown }>, asked: boolean): T[] | null => {
    if (!asked) return [];
    return r.status === 'fulfilled' && !r.value.error && Array.isArray(r.value.data) ? (r.value.data as T[]) : null;
  };
  const cr = rows<CompanyRow>(c, want('companies'));
  const ar = rows<ArticleRow>(a, want('articles'));
  const er = rows<EventRow>(e, want('events'));
  const sr = s.status === 'fulfilled' ? s.value : [];
  const asked = [want('companies') && cr, want('articles') && ar, want('events') && er].filter((x) => x !== false);
  if (asked.length > 0 && asked.every((x) => x === null)) throw new Error('Suggestions unavailable');

  // Ranked: the best match first, then (companies) members before imported listings, then A to Z / newest.
  const companiesRanked = (cr ?? [])
    .filter((o) => o.slug && o.name)
    .map((o) => ({ o, r: matchRank(o.name, q) }))
    .sort((x, y) => x.r - y.r || Number(!x.o.owner_user_id) - Number(!y.o.owner_user_id) || x.o.name.localeCompare(y.o.name))
    .map(({ o }) => o)
    .slice(0, PER_GROUP);
  const articlesRanked = (ar ?? [])
    .filter((r) => r.id && r.title)
    .map((r, i) => ({ r, k: matchRank(r.title, q), i }))
    .sort((x, y) => x.k - y.k || x.i - y.i)
    .map(({ r }) => r)
    .slice(0, PER_GROUP);
  // Upcoming first (soonest first), then past ones (latest first).
  const now = Date.now();
  const eventsRanked = (er ?? [])
    .filter((ev) => ev.id && ev.title && ev.date_time)
    .sort((x, y) => {
      const tx = Date.parse(x.date_time);
      const ty = Date.parse(y.date_time);
      const ux = tx >= now ? 0 : 1;
      const uy = ty >= now ? 0 : 1;
      if (ux !== uy) return ux - uy;
      return ux === 0 ? tx - ty : ty - tx;
    })
    .slice(0, PER_GROUP);

  const result: SuggestResults = { companies: companiesRanked, articles: articlesRanked, events: eventsRanked, sectors: sr };
  const key = cacheKey(q, groups, scope);
  cache.set(key, result);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
  return result;
}
