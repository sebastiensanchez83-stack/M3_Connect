import { supabase } from '@/lib/supabase';
import { SPONSOR_TIERS } from '@/types/database';
import { WYS26_EVENT_ID } from '@/components/brand/m3Events';
import { countryKey, countryParts, rawCountryOf } from '@/lib/networkStats';
import { bestSpelling, countrySlug, localizedCountryName } from '@/lib/countryNames';

/**
 * The search pill's suggestions (SearchField `suggest`): public, read-only
 * queries with the same visibility rules as the pages that list each kind.
 *
 *  - companies: verified organisations (DirectoryPage), or on /partners the
 *    event sponsors only (paying tiers, plus media outlets tagged as event media
 *    partners: PartnersPage's two queries in one);
 *  - countries: the countries of the verified organisations (DirectoryPage's
 *    country filter, ?country=), read once per visit;
 *  - articles: published resources (ResourcesPage);
 *  - events: published (or unflagged) events, never the World Yachting Summit's
 *    draft row (EventsPage); the UI adds the Summit itself, linking to /wys26;
 *  - themes: the six themes are local (lib/themes.ts); the 17 sectors are read
 *    once per visit.
 *
 * Every word typed must appear in the name or title, case and accents ignored
 * on our side, so "marina nice" finds "Port de Nice Marina" and "Göcek" finds
 * "D-Marin Göcek". The database compares letters as typed (ILIKE does not ignore
 * accents): an accented letter or an apostrophe is sent as a one-character
 * wildcard, so "Göcek" and "Egypt's" (typed with a straight apostrophe) match
 * "Göcek" and "Egypt’s"; "gocek" without its accent cannot find "Göcek" yet
 * (that needs an unaccented search column in the database).
 *
 * Companies are read in four small queries (names starting with the search,
 * names with a word starting with it, members, and the rest A to Z), so a
 * common word such as "marina" (100+ matches) still brings back the best
 * matches and the real members, then ranked here: a name that starts with the
 * search first, then a word that starts with it, then members (an owner on the
 * platform) before imported listings. Results are kept for the visit, per
 * viewer, so going back a letter is instant.
 */

export type SuggestGroup = 'companies' | 'countries' | 'articles' | 'events' | 'themes';

/** Every group, in the order they are shown. */
export const ALL_SUGGESTIONS: readonly SuggestGroup[] = ['companies', 'countries', 'articles', 'events', 'themes'];

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

export interface CountryRow {
  /** The folded country key (networkStats.countryKey): "united kingdom". */
  key: string;
  /** The directory's URL form (?country=united-kingdom). */
  slug: string;
  /** The English name: "United Kingdom". */
  name: string;
  /** How many verified organisations are in it. */
  count: number;
}

export interface SuggestResults {
  companies: CompanyRow[];
  articles: ArticleRow[];
  events: EventRow[];
  sectors: SectorRow[];
  countries: CountryRow[];
}

/** How many suggestions a group shows at most. */
export const PER_GROUP = 5;
/** When three groups or more answer (home, 404), each shows this many, so the list stays short. */
export const PER_GROUP_COMPACT = 3;

/** Lower case, accents off, curly apostrophes straight: "Côte" → "cote", "Egypt’s" → "egypt's". */
export const fold = (s: string) =>
  s.normalize('NFD').replace(/\p{M}/gu, '').replace(/[‘’ʼ`´]/g, "'").toLowerCase();

const SPLIT = /[\s,;/]+/;

/** The words of a search, folded, at most five (our side: filtering, ranking, highlighting). */
export function searchWords(q: string): string[] {
  return fold(q).split(SPLIT).map((w) => w.trim()).filter(Boolean).slice(0, 5);
}

/** The words of a search as typed, in lower case, at most five (the database side). */
function typedWords(q: string): string[] {
  return q.normalize('NFC').toLowerCase().split(SPLIT).map((w) => w.trim()).filter(Boolean).slice(0, 5);
}

/**
 * One word for ILIKE: its own %, _ and \ are literal; * (PostgREST's wildcard)
 * is dropped; an accented (non-ASCII) letter or an apostrophe of any kind
 * becomes _ (any one character), since ILIKE does not ignore accents.
 */
function likeWord(word: string): string {
  return word
    .replace(/\*/g, '')
    .replace(/[\\%_]/g, (c) => `\\${c}`)
    // Anything outside printable ASCII (an accented letter), or an apostrophe.
    .replace(/[^ -~]|['`]/gu, '_');
}

const contains = (w: string) => `%${likeWord(w)}%`;
const startsWith = (w: string) => `${likeWord(w)}%`;
const wordStartsWith = (w: string) => `% ${likeWord(w)}%`;

/** 0: the text starts with the search; 1: a word of it does; 2: it only contains it. */
export function matchRank(text: string, q: string): number {
  const t = fold(text);
  const f = fold(q.trim());
  if (t.startsWith(f)) return 0;
  const first = searchWords(q)[0] ?? f;
  return new RegExp(`(^|[^\\p{L}\\p{N}])${first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'u').test(t) ? 1 : 2;
}

/** Every folded word of the search is in the text (case, accents and apostrophes ignored). */
export function hasAllWords(text: string, words: readonly string[]): boolean {
  const f = fold(text);
  return words.length > 0 && words.every((w) => f.includes(w));
}

let sectorsPromise: Promise<SectorRow[]> | null = null;
/**
 * The active sectors, read once per visit. A failure, or an empty answer (the
 * sectors are only readable once a signed-in account has its profile), is
 * asked again next time.
 */
function loadSectors(): Promise<SectorRow[]> {
  if (!sectorsPromise) {
    sectorsPromise = Promise.resolve(
      supabase.from('sectors').select('id, slug, label').eq('is_active', true).order('label'),
    ).then(({ data, error }) => {
      if (error || !Array.isArray(data) || data.length === 0) {
        sectorsPromise = null;
        return Array.isArray(data) ? (data as SectorRow[]) : [];
      }
      return data as SectorRow[];
    }, () => {
      sectorsPromise = null;
      return [];
    });
  }
  return sectorsPromise;
}

let countriesPromise: Promise<CountryRow[]> | null = null;
/**
 * The countries of the verified organisations, read once per visit, folded the
 * way the directory folds them (one key per country whatever the spelling), so
 * a suggestion's ?country= is one the directory's filter knows.
 */
function loadCountries(): Promise<CountryRow[]> {
  if (!countriesPromise) {
    countriesPromise = Promise.resolve(
      supabase.from('organizations').select('country, headquarters_country').eq('access_status', 'verified'),
    ).then(({ data, error }) => {
      if (error || !Array.isArray(data) || data.length === 0) {
        countriesPromise = null;
        return [];
      }
      const spellings = new Map<string, Map<string, number>>();
      const counts = new Map<string, number>();
      for (const row of data as { country: string | null; headquarters_country: string | null }[]) {
        const keys = new Set<string>();
        for (const part of countryParts(rawCountryOf(row))) {
          const key = countryKey(part);
          keys.add(key);
          const bucket = spellings.get(key) ?? new Map<string, number>();
          bucket.set(part, (bucket.get(part) ?? 0) + 1);
          spellings.set(key, bucket);
        }
        for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      const out: CountryRow[] = [];
      for (const [key, bucket] of spellings) {
        const slug = countrySlug(key);
        if (!slug) continue;
        out.push({ key, slug, name: localizedCountryName(key, bestSpelling(key, bucket), 'en'), count: counts.get(key) ?? 0 });
      }
      return out.sort((a, b) => b.count - a.count);
    }, () => {
      countriesPromise = null;
      return [];
    });
  }
  return countriesPromise;
}

/**
 * The countries a search names: every word starts a word of the country's
 * English name ("fra" → France, "united k" → United Kingdom), or the whole
 * search is one of the directory's aliases ("UK", "USA", "Italia").
 */
export function matchCountries(countries: readonly CountryRow[], q: string): CountryRow[] {
  const words = searchWords(q);
  if (!words.length) return [];
  const alias = countryKey(fold(q.trim()));
  const startsAWord = (name: string, w: string) => fold(name).split(/[^\p{L}\p{N}']+/u).some((part) => part.startsWith(w));
  return countries
    .filter((c) => c.key === alias || words.every((w) => startsAWord(c.name, w) || startsAWord(c.key, w)))
    .map((c) => ({ c, r: c.key === alias ? 0 : matchRank(c.name, q) }))
    .sort((x, y) => x.r - y.r || y.c.count - x.c.count)
    .map(({ c }) => c);
}

const cache = new Map<string, SuggestResults>();
const CACHE_MAX = 60;

/**
 * The cache key of a search: the page's scope and groups, who is asking (row
 * security can show a member a little more than a visitor, and signing out
 * does not reload the page), and the words as typed (accents matter to the
 * database).
 */
export function cacheKey(q: string, groups: readonly SuggestGroup[], scope: SuggestScope, viewer = 'anon'): string {
  return `${viewer}|${scope}|${groups.join(',')}|${typedWords(q).join(' ')}`;
}

export function cachedSuggestions(key: string): SuggestResults | undefined {
  return cache.get(key);
}

type Answer<T> = T[] | null;

/** The rows of a settled query, or null when it failed. */
function rowsOf<T>(r: PromiseSettledResult<{ data: unknown; error: unknown }>): Answer<T> {
  return r.status === 'fulfilled' && !r.value.error && Array.isArray(r.value.data) ? (r.value.data as T[]) : null;
}

/**
 * Suggestions for `q` in `groups`. Throws when every query failed. A group
 * whose query failed comes back empty, and the answer is then not cached (the
 * next keystroke asks again).
 */
export async function fetchSuggestions(
  q: string,
  groups: readonly SuggestGroup[],
  scope: SuggestScope,
  signal?: AbortSignal,
  viewer = 'anon',
): Promise<SuggestResults> {
  const words = typedWords(q);
  const folded = searchWords(q);
  const want = (g: SuggestGroup) => groups.includes(g) && words.length > 0;
  const withSignal = <B extends { abortSignal: (s: AbortSignal) => B }>(b: B): B => (signal ? b.abortSignal(signal) : b);

  // ── Companies: four small reads, merged (see the top of this file) ──
  const companyBase = () => {
    let query = supabase
      .from('organizations')
      .select('id, slug, name, organization_type, logo_url, country, headquarters_country, owner_user_id')
      .eq('access_status', 'verified');
    if (scope === 'sponsors') {
      // A fixed filter (no user input inside or()): the paying tiers, or a tagged event media partner.
      query = query.or(`tier.in.(${SPONSOR_TIERS.join(',')}),and(organization_type.eq.media_partner,is_event_media_partner.eq.true)`);
    }
    for (const w of words) query = query.ilike('name', contains(w));
    return query;
  };
  const companies: Promise<{ rows: Answer<CompanyRow>; complete: boolean }> = (async () => {
    if (!want('companies')) return { rows: [], complete: true };
    const first = words[0];
    const settled = await Promise.allSettled([
      withSignal(companyBase().ilike('name', startsWith(first)).order('name').limit(12)),
      withSignal(companyBase().ilike('name', wordStartsWith(first)).order('name').limit(12)),
      withSignal(companyBase().not('owner_user_id', 'is', null).order('name').limit(12)),
      withSignal(companyBase().order('name').limit(24)),
    ]);
    const answers = settled.map((r) => rowsOf<CompanyRow>(r));
    if (answers.every((a) => a === null)) return { rows: null, complete: false };
    const byId = new Map<string, CompanyRow>();
    for (const a of answers) for (const o of a ?? []) if (!byId.has(o.id)) byId.set(o.id, o);
    return { rows: [...byId.values()], complete: answers.every((a) => a !== null) };
  })();

  const articles = (() => {
    if (!want('articles')) return Promise.resolve({ data: [] as unknown[], error: null });
    let query = supabase.from('resources').select('id, title, type, published_at').eq('published', true);
    for (const w of words) query = query.ilike('title', contains(w));
    return withSignal(query.order('published_at', { ascending: false, nullsFirst: false }).limit(12));
  })();

  const events = (() => {
    if (!want('events')) return Promise.resolve({ data: [] as unknown[], error: null });
    let query = supabase
      .from('events')
      .select('id, title, date_time, event_type')
      .not('published', 'is', false)
      .neq('id', WYS26_EVENT_ID);
    for (const w of words) query = query.ilike('title', contains(w));
    return withSignal(query.order('date_time', { ascending: false }).limit(12));
  })();

  const [c, a, e, s, k] = await Promise.allSettled([
    companies,
    articles,
    events,
    groups.includes('themes') ? loadSectors() : Promise.resolve([] as SectorRow[]),
    groups.includes('countries') ? loadCountries() : Promise.resolve([] as CountryRow[]),
  ]);
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  const company = c.status === 'fulfilled' ? c.value : { rows: null, complete: false };
  const cr = want('companies') ? company.rows : [];
  const ar = want('articles') ? rowsOf<ArticleRow>(a) : [];
  const er = want('events') ? rowsOf<EventRow>(e) : [];
  const sr = s.status === 'fulfilled' ? s.value : [];
  const kr = k.status === 'fulfilled' ? k.value : [];
  const asked = [want('companies') && cr, want('articles') && ar, want('events') && er].filter((x) => x !== false);
  if (asked.length > 0 && asked.every((x) => x === null)) throw new Error('Suggestions unavailable');

  // The wildcard letters can let through a near miss ("g_cek"): our side keeps what really matches.
  const matches = (text: string) => hasAllWords(text, folded);

  // Ranked: the best match first, then (companies) members before imported listings, then A to Z / newest.
  const companiesRanked = (cr ?? [])
    .filter((o) => o.slug && o.name && matches(o.name))
    .map((o) => ({ o, r: matchRank(o.name, q) }))
    .sort((x, y) => x.r - y.r || Number(!x.o.owner_user_id) - Number(!y.o.owner_user_id) || x.o.name.localeCompare(y.o.name))
    .map(({ o }) => o)
    .slice(0, PER_GROUP);
  const articlesRanked = (ar ?? [])
    .filter((r) => r.id && r.title && matches(r.title))
    .map((r, i) => ({ r, k: matchRank(r.title, q), i }))
    .sort((x, y) => x.k - y.k || x.i - y.i)
    .map(({ r }) => r)
    .slice(0, PER_GROUP);
  // Upcoming first (soonest first), then past ones (latest first).
  const now = Date.now();
  const eventsRanked = (er ?? [])
    .filter((ev) => ev.id && ev.title && ev.date_time && matches(ev.title))
    .sort((x, y) => {
      const tx = Date.parse(x.date_time);
      const ty = Date.parse(y.date_time);
      const ux = tx >= now ? 0 : 1;
      const uy = ty >= now ? 0 : 1;
      if (ux !== uy) return ux - uy;
      return ux === 0 ? tx - ty : ty - tx;
    })
    .slice(0, PER_GROUP);

  const result: SuggestResults = { companies: companiesRanked, articles: articlesRanked, events: eventsRanked, sectors: sr, countries: kr };
  // Cached only when every query asked answered: a passing error must not hide a group for the whole visit.
  const complete =
    (!want('companies') || company.complete) && (!want('articles') || ar !== null) && (!want('events') || er !== null);
  if (complete) {
    cache.set(cacheKey(q, groups, scope, viewer), result);
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
  }
  return result;
}
