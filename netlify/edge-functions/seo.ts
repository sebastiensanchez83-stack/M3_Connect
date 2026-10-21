/**
 * Netlify edge function: writes each public page's own head into the HTML.
 *
 * Why: the site is a single-page app, so every URL is served the same
 * index.html, and the robots behind share previews (LinkedIn, WhatsApp,
 * Slack, X, Facebook…) never run JavaScript. Without this function, every
 * shared link shows the home page's card. Google does run JavaScript, but it
 * reads this HTML first.
 *
 * What: the title, description, canonical URL, og:* and twitter:* tags, and
 * the JSON-LD of
 *   - the fixed public pages (/, /directory, /resources, /events, /partners,
 *     /become-partner, /opportunities, /about, /contact, /sm26,
 *     /sm26/vote, /wys26, and the aliases /join, /network, /marketplace);
 *   - the legal documents (/privacy, /terms, /cookies, /mentions-legales,
 *     /conditions-commerciales) and two SM26 pages that used to show the home
 *     page's title: /sm26/agenda (canonical: the 6th edition's event page) and
 *     /sm26/register (noindex), see PLAIN_PAGES in src/lib/seoMeta.ts;
 *   - /organizations/:slug, /events/:slug and /resources/:slug, read from
 *     Supabase with the public anon key (netlify/lib/supabase-rest.ts).
 *
 * Readable addresses (20 Oct 2026, supabase/migrations/20261020160000_readable_slugs.sql):
 * an article or event address given by id (/resources/<uuid>, every link before that date,
 * the RSS feeds, the e-mails of the registration functions) or by an address the record had
 * before (resource_slug_lookup / event_slug_lookup) answers with a 301 to its current
 * /resources/<slug> or /events/<slug>, the query string kept (the browser keeps the #hash);
 * so does a company given by id (/organizations/<uuid>) and an event address of the World
 * Yachting Summit (to /wys26). Never for an unpublished event, nor for a record an anonymous
 * reader cannot see (those keep the page as it is; the page itself redirects a signed-in reader
 * who may see it). The canonical URL and og:url are the slug address. While the slug column does
 * not exist (the migration not applied) every lookup reads by id as before: the database refuses
 * the column (a 400 naming it, code 42703), and only that refusal sends the function back to the
 * old reads; any other error (a 401 from a stale key, a 429, a 5xx) leaves the page untouched,
 * never a noindex. The 301s whose target can change (an id, an old address, a company) are not
 * cached (no-store): a record can take back an old address, and a cached 301 would then loop in
 * the browser. Only the fixed move of the World Yachting Summit to /wys26 is cached an hour.
 * The words and the tags come from src/i18n/seo.ts (English) and
 * src/lib/seoMeta.ts, the same code the pages run in the browser, and every
 * tag is marked data-rh="true" so react-helmet-async replaces it rather than
 * adding a copy.
 *
 * Safety: it never changes the page body, and the only status code it changes
 * is the 301 above (a 200 page of the app only). It only runs on the paths
 * listed in `config` (end of this file), GET only. A lookup gets 800 ms, the
 * whole answer 900; after that, or on any error, the HTML goes out untouched
 * (the page then moves the address itself, in the browser). A
 * record that Supabase says does not exist (to an anonymous reader) gets a
 * noindex tag, not a 404: a signed-in member may still be allowed to see it.
 * If the function itself fails (a crash, the CPU limit, a module that does
 * not load), onError 'bypass' makes Netlify serve the normal page instead of
 * its error page: /sm26, the QR code printed on every badge, is on the list.
 *
 * Security headers: Netlify does not apply the netlify.toml [[headers]] to a
 * response an edge function returns, so every response that leaves this
 * function carries X-Frame-Options, X-Content-Type-Options and
 * Referrer-Policy itself (same values as netlify.toml; a value already there
 * is kept). For the same reason a page whose head says noindex (an unknown
 * record, /sm26/register) also gets X-Robots-Tag: noindex from here.
 *
 * Previews stay out of search engines: on any host other than the production
 * site (a deploy preview, a branch deploy such as refonte--m3connectv2.netlify.app,
 * the site's own *.netlify.app address, localhost) every response of this
 * function carries X-Robots-Tag: noindex, nofollow, and the head it writes says
 * noindex (no canonical, no og:url). This function only runs on the paths in
 * `config`; for every other path of a preview (assets, /admin…) the build adds
 * the same header to dist/_headers, see scripts/preview-noindex.mjs
 * (netlify.toml itself cannot depend on the host).
 *
 * The response header X-SMC-SEO says what happened: page, organization, event,
 * resource, redirect, not-found, or fallback:<reason>. Check it with a GET, not
 * `curl -I` (HEAD never reaches this function):
 *   curl -s -D - -o /dev/null <site>/about
 *
 * Declared inline (`config` below), not in netlify.toml: onError can only be
 * set inline, and the explicit path list cannot go out of date when a route
 * is added elsewhere.
 */
import { SEO_STRINGS } from '../../src/i18n/seo.ts';
import { withSiteSuffix } from '../../src/lib/seoText.ts';
import {
  EVENT_SEO_COLUMNS,
  KNOWN_EVENT_SLUGS,
  ORG_SEO_COLUMNS,
  RESOURCE_SEO_COLUMNS,
  WYS26_EVENT_ID,
  WYS26_PAGE_PATH,
  eventMeta,
  eventPath,
  fixedPageMeta,
  headHtml,
  isPreviewHostname,
  isUuid,
  makeSeoTr,
  orgPath,
  organizationMeta,
  resourceMeta,
  resourcePath,
  type EventSeoInput,
  type OrgSeoInput,
  type PageMeta,
  type ResourceSeoInput,
} from '../../src/lib/seoMeta.ts';
import { getRest, selectRows, selectRowsOr, supabaseEnv, withDeadline, type SupabaseEnv } from '../lib/supabase-rest.ts';

/** Netlify's edge context: only the part used here. */
interface Context {
  next(): Promise<Response>;
}

const tr = makeSeoTr(SEO_STRINGS.en.seo);
const SHARE_IMAGE_ALT = SEO_STRINGS.en.seo.shareImageAlt;
const LOOKUP_TIMEOUT_MS = 800;
const SEO_HEADER = 'X-SMC-SEO';
/** As the "/*" [[headers]] block of netlify.toml, which Netlify does not apply to edge-function responses. */
const SECURITY_HEADERS: [string, string][] = [
  ['X-Frame-Options', 'DENY'],
  ['X-Content-Type-Options', 'nosniff'],
  ['Referrer-Policy', 'strict-origin-when-cross-origin'],
];
const ROBOTS_HEADER = 'X-Robots-Tag';
const PREVIEW_ROBOTS = 'noindex, nofollow';

/** True on every host but the production site's own (deploy previews, branch deploys, *.netlify.app, localhost). */
export function isPreviewHost(url: URL): boolean {
  return isPreviewHostname(url.hostname);
}

type Route =
  | { kind: 'page'; meta: PageMeta }
  | { kind: 'organization'; key: string }
  | { kind: 'event'; key: string }
  | { kind: 'resource'; key: string };

interface Resolved {
  meta: PageMeta | null;
  source: string;
  /** The path this address moves to for good: a 301, the query string going along. */
  redirect?: string;
  /** The move never changes (WYS26 -> /wys26): the browser may keep the 301 an hour. Else no-store. */
  fixedMove?: boolean;
}

/** The page a URL is, or null when this function has nothing to say about it. */
export function routeFor(url: URL): Route | null {
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const fixed = fixedPageMeta(path, url.searchParams.get('theme'), tr);
  if (fixed) return { kind: 'page', meta: fixed };
  const match = path.match(/^\/(organizations|events|resources)\/([^/]+)$/);
  if (!match) return null;
  let param: string;
  try {
    param = decodeURIComponent(match[2]);
  } catch {
    return null;
  }
  if (!param) return null;
  if (match[1] === 'organizations') return { kind: 'organization', key: param };
  return match[1] === 'events' ? { kind: 'event', key: param } : { kind: 'resource', key: param };
}

/** A record an anonymous reader cannot see: kept out of the index, nothing else changed. */
function notFoundMeta(): PageMeta {
  return {
    title: withSiteSuffix(tr('notFound.title')),
    description: tr('home.description'),
    noindex: true,
  };
}

const notFound = (): Resolved => ({ meta: notFoundMeta(), source: 'not-found' });
const noAnswer = (): Resolved => ({ meta: null, source: 'fallback:lookup' });
/** A 301 to a record's current address: it can change again (no-store). */
const movedTo = (path: string): Resolved => ({ meta: null, source: 'redirect', redirect: path });
/** The 301 of the World Yachting Summit's event addresses to its one page: fixed, cacheable. */
const movedToWys = (): Resolved => ({ meta: null, source: 'redirect', redirect: WYS26_PAGE_PATH, fixedMove: true });
const enc = encodeURIComponent;

type EventRow = EventSeoInput & { published?: boolean | null };

/** An event row as a head, or as a move to its own address. */
function eventAnswer(row: EventRow | undefined, key: string): Resolved {
  if (!row || !row.title) return notFound();
  // The World Yachting Summit 2026 has one page, /wys26.
  if (row.id.toLowerCase() === WYS26_EVENT_ID) return movedToWys();
  const meta = eventMeta(row, tr, 'en-GB');
  // Unpublished: staff can open it, nobody should find it, and its address never moves here.
  if (row.published === false) return { meta: { ...meta, noindex: true }, source: 'not-found' };
  if (row.slug && row.slug !== key) return movedTo(eventPath(row));
  return { meta, source: 'event' };
}

/**
 * The current address of an old one, through resource_slug_lookup / event_slug_lookup (they
 * answer only for a record an anonymous reader may open, never for an unpublished event).
 * null: none; undefined: no usable answer (none in time, or any error: the page is then left as it is).
 */
async function currentSlug(env: SupabaseEnv, fn: 'resource_slug_lookup' | 'event_slug_lookup', slug: string): Promise<string | null | undefined> {
  const { body, status } = await getRest(env, `rpc/${fn}`, `p_slug=${enc(slug)}`, LOOKUP_TIMEOUT_MS);
  if (status < 200 || status >= 300) return undefined;
  return typeof body === 'string' && body ? body : null;
}

/**
 * /events/<slug | id | an old slug>. While the slug column does not exist (the migration not
 * applied: the database refuses the read with 42703), ids as before, and the slugs the code links
 * to (KNOWN_EVENT_SLUGS) by their id. Any other failure: no answer, the page untouched.
 */
async function resolveEvent(env: SupabaseEnv, key: string): Promise<Resolved> {
  const byId = isUuid(key);
  if (byId && key.toLowerCase() === WYS26_EVENT_ID) return movedToWys();
  const slug = key.toLowerCase();
  const first = await selectRowsOr<EventRow>(
    env, 'events',
    `select=${EVENT_SEO_COLUMNS},slug&${byId ? `id=eq.${enc(key)}` : `slug=eq.${enc(slug)}`}&limit=1`,
    LOOKUP_TIMEOUT_MS,
  );
  if (first.rows === null) {
    if (!first.missingSlugColumn) return noAnswer();
    const id = byId ? key : KNOWN_EVENT_SLUGS[slug];
    if (!id) return notFound();
    const rows = await selectRows<EventRow>(env, 'events', `select=${EVENT_SEO_COLUMNS}&id=eq.${enc(id)}&limit=1`, LOOKUP_TIMEOUT_MS);
    return rows === null ? noAnswer() : eventAnswer(rows[0], key);
  }
  if (first.rows.length === 0 && !byId) {
    const current = await currentSlug(env, 'event_slug_lookup', slug);
    if (current === undefined) return noAnswer();
    if (current && current !== key) return movedTo(eventPath({ id: current, slug: current }));
    const known = KNOWN_EVENT_SLUGS[slug];
    if (known) {
      const rows = await selectRows<EventRow>(env, 'events', `select=${EVENT_SEO_COLUMNS},slug&id=eq.${enc(known)}&limit=1`, LOOKUP_TIMEOUT_MS);
      return rows === null ? noAnswer() : eventAnswer(rows[0], key);
    }
  }
  return eventAnswer(first.rows[0], key);
}

/** /resources/<slug | id | an old slug>, published articles only. Before the slug migration, ids as before. */
async function resolveResource(env: SupabaseEnv, key: string): Promise<Resolved> {
  const byId = isUuid(key);
  const slug = key.toLowerCase();
  const first = await selectRowsOr<ResourceSeoInput>(
    env, 'resources',
    `select=${RESOURCE_SEO_COLUMNS},slug&${byId ? `id=eq.${enc(key)}` : `slug=eq.${enc(slug)}`}&published=eq.true&limit=1`,
    LOOKUP_TIMEOUT_MS,
  );
  let rows = first.rows;
  if (rows === null) {
    if (!first.missingSlugColumn) return noAnswer();
    // No slug column yet: only ids lead to articles.
    if (!byId) return notFound();
    rows = await selectRows<ResourceSeoInput>(
      env, 'resources', `select=${RESOURCE_SEO_COLUMNS}&id=eq.${enc(key)}&published=eq.true&limit=1`, LOOKUP_TIMEOUT_MS,
    );
    if (rows === null) return noAnswer();
  } else if (rows.length === 0 && !byId) {
    const current = await currentSlug(env, 'resource_slug_lookup', slug);
    if (current === undefined) return noAnswer();
    if (current && current !== key) return movedTo(resourcePath({ id: current, slug: current }));
  }
  const row = rows[0];
  if (!row || !row.title) return notFound();
  if (row.slug && row.slug !== key) return movedTo(resourcePath(row));
  return { meta: resourceMeta(row, tr), source: 'resource' };
}

type OrgListing = { access_status?: string | null; duplicate_of?: string | null };

/**
 * /organizations/<slug>. An id, or a slug typed in capitals, moves to the company's own address.
 * The head is the visitor version (Victor, 21 Oct 2026, Q5 and Q6: no cloaking): a company M3 has
 * not validated is "not found" (noindex), as the page itself says to a visitor and as the database
 * answers anon at go-live; a copy merged into another company moves to that company's address.
 * Only public columns are read (ORG_SEO_COLUMNS, access_status, duplicate_of: granted to anon).
 */
async function resolveOrganization(env: SupabaseEnv, key: string): Promise<Resolved> {
  const rows = await selectRows<OrgSeoInput & OrgListing>(
    env, 'organizations', `select=${ORG_SEO_COLUMNS},access_status,duplicate_of&slug=eq.${enc(key)}&limit=1`, LOOKUP_TIMEOUT_MS,
  );
  if (rows === null) return noAnswer();
  const row = rows[0];
  if (row?.duplicate_of) return movedToKept(env, row.duplicate_of, key);
  if (row && row.name && row.slug) {
    return row.access_status === 'verified' ? { meta: organizationMeta(row, tr), source: 'organization' } : notFound();
  }
  if (isUuid(key) || key !== key.toLowerCase()) {
    const filter = isUuid(key) ? `id=eq.${enc(key)}` : `slug=eq.${enc(key.toLowerCase())}`;
    const other = await selectRows<{ slug: string | null } & OrgListing>(env, 'organizations', `select=slug,access_status,duplicate_of&${filter}&limit=1`, LOOKUP_TIMEOUT_MS);
    if (other === null) return noAnswer();
    if (other[0]?.duplicate_of) return movedToKept(env, other[0].duplicate_of, key);
    const own = other[0]?.slug;
    if (own && own !== key && other[0]?.access_status === 'verified') return movedTo(orgPath(own));
  }
  return notFound();
}

/** A merged copy's address: to the validated company it was merged into, else not found. */
async function movedToKept(env: SupabaseEnv, keptId: string, key: string): Promise<Resolved> {
  const kept = await selectRows<{ slug: string | null } & OrgListing>(env, 'organizations', `select=slug,access_status&id=eq.${enc(keptId)}&limit=1`, LOOKUP_TIMEOUT_MS);
  if (kept === null) return noAnswer();
  const slug = kept[0]?.slug;
  return slug && slug !== key && kept[0]?.access_status === 'verified' ? movedTo(orgPath(slug)) : notFound();
}

export async function resolve(route: Route): Promise<Resolved> {
  if (route.kind === 'page') return { meta: route.meta, source: 'page' };
  const env = supabaseEnv();
  if (!env) return { meta: null, source: 'fallback:no-env' };
  if (route.kind === 'organization') return resolveOrganization(env, route.key);
  if (route.kind === 'event') return resolveEvent(env, route.key);
  return resolveResource(env, route.key);
}

/**
 * index.html with `meta`'s head: the default tags marked data-rh="true" come
 * out, the <title> is replaced by the page's title and tags. Null when the
 * HTML does not look like the app's shell (no <title> in a <head>).
 */
export function rewriteHead(html: string, meta: PageMeta): string | null {
  const end = html.search(/<\/head>/i);
  if (end < 0) return null;
  let head = html.slice(0, end);
  const title = /<title[^>]*>[\s\S]*?<\/title>/i;
  if (!title.test(head)) return null;
  head = head
    .replace(/[ \t]*<(?:meta|link)\b[^>]*\sdata-rh="true"[^>]*>[ \t]*\r?\n?/gi, '')
    .replace(/[ \t]*<script\b[^>]*\sdata-rh="true"[^>]*>[\s\S]*?<\/script>[ \t]*\r?\n?/gi, '')
    .replace(title, () => headHtml(meta, SHARE_IMAGE_ALT));
  return head + html.slice(end);
}

/**
 * A copy of `from`, plus the missing security headers and, when given, X-SMC-SEO.
 * `robots` is the X-Robots-Tag to send: always set on a preview host (it replaces
 * any other value), otherwise only when the response has none.
 */
function outgoingHeaders(from: Headers, source: string | null, robots: string | null = null, force = false): Headers {
  const headers = new Headers(from);
  for (const [name, value] of SECURITY_HEADERS) if (!headers.has(name)) headers.set(name, value);
  if (source) headers.set(SEO_HEADER, source);
  if (robots && (force || !headers.has(ROBOTS_HEADER))) headers.set(ROBOTS_HEADER, robots);
  return headers;
}

/** The response as it is, plus the security headers and, when given, the X-SMC-SEO header. */
function tagged(response: Response, source: string | null, preview = false): Response {
  try {
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: outgoingHeaders(response.headers, source, preview ? PREVIEW_ROBOTS : null, true),
    });
  } catch {
    return response;
  }
}

/** Cache-Control of a 301 whose target can change (an id, an old address, a company's address). */
export const MOVED_CACHE_CONTROL = 'no-store';
/** Cache-Control of the fixed move of the World Yachting Summit's event addresses to /wys26. */
export const FIXED_MOVE_CACHE_CONTROL = 'public, max-age=3600';

/**
 * The 301 to a record's own address: same host (a preview stays a preview), the query string
 * kept (links of the WYS and SM26 pages carry their tokens there; the browser keeps the #hash
 * itself). Null when it would point at the address asked (never a loop).
 * `fixed`: the move never changes (WYS26 -> /wys26), the browser may keep it an hour. Any other
 * move is no-store: a record can take back an old address (a -> b, then b -> a), and a browser
 * that kept a -> b would then loop with the edge's b -> a. Search engines read a 301 as
 * permanent whatever its cache header, and this function runs on every request anyway.
 */
function movedResponse(from: URL, path: string, preview: boolean, fixed: boolean): Response | null {
  const target = new URL(path, from.origin);
  target.search = from.search;
  if (target.pathname === from.pathname.replace(/\/+$/, '')) return null;
  const headers = outgoingHeaders(new Headers(), 'redirect', preview ? PREVIEW_ROBOTS : null, preview);
  headers.set('Location', target.toString());
  headers.set('Cache-Control', fixed ? FIXED_MOVE_CACHE_CONTROL : MOVED_CACHE_CONTROL);
  return new Response(null, { status: 301, headers });
}

export default async function seo(request: Request, context: Context): Promise<Response | undefined> {
  let route: Route | null = null;
  let preview = false;
  let url: URL | null = null;
  try {
    if (request.method === 'GET') {
      url = new URL(request.url);
      route = routeFor(url);
      preview = isPreviewHost(url);
    }
  } catch {
    route = null;
  }
  // Not a page this function describes: returning nothing lets Netlify carry on as if it were not here.
  if (!route || !url) return undefined;

  // The page and the lookup run side by side; the lookup never waits more than 800 ms.
  const lookup = withDeadline(resolve(route), LOOKUP_TIMEOUT_MS + 100);
  const response = await context.next();

  let untouched: Response | null = null;
  try {
    const type = response.headers.get('content-type') ?? '';
    if (response.status !== 200 || !type.includes('text/html')) return tagged(response, null, preview);
    const resolved = await lookup;
    if (resolved?.redirect) {
      const moved = movedResponse(url, resolved.redirect, preview, resolved.fixedMove === true);
      if (moved) {
        await response.body?.cancel();
        return moved;
      }
    }
    if (!resolved || !resolved.meta) return tagged(response, resolved?.source ?? 'fallback:timeout', preview);
    untouched = response.clone();
    // A preview is never indexed: the head says noindex (and drops its canonical), and so does the header.
    const meta: PageMeta = preview ? { ...resolved.meta, noindex: true } : resolved.meta;
    const rewritten = rewriteHead(await response.text(), meta);
    if (rewritten === null) return tagged(untouched, 'fallback:no-head', preview);
    const headers = outgoingHeaders(untouched.headers, resolved.source, preview ? PREVIEW_ROBOTS : meta.noindex ? 'noindex' : null, preview);
    headers.delete('content-length');
    headers.delete('etag'); // the body is no longer the file the tag was computed for
    return new Response(rewritten, { status: untouched.status, statusText: untouched.statusText, headers });
  } catch {
    return tagged(untouched ?? response, 'fallback:error', preview);
  }
}

/**
 * Where it runs: the pages fixedPageMeta() and routeFor() describe, nothing
 * else (files, private pages and token links are never on this list). Keep
 * it in step with FIXED_PAGES in src/lib/seoMeta.ts. GET only: HEAD and every
 * other method go straight to the site. onError 'bypass': if the function
 * fails, the visitor gets the normal page, never Netlify's error page.
 */
export const config = {
  path: [
    '/',
    '/directory',
    '/network',
    '/marketplace',
    '/resources',
    '/events',
    '/partners',
    '/sponsor',
    '/become-partner',
    '/join',
    '/opportunities',
    '/about',
    '/contact',
    '/help',
    '/sm26',
    '/sm26/vote',
    '/wys26',
    // The legal documents and two SM26 pages: PLAIN_PAGES in src/lib/seoMeta.ts.
    '/privacy',
    '/terms',
    '/cookies',
    '/mentions-legales',
    '/conditions-commerciales',
    '/sm26/agenda',
    '/sm26/register',
    '/organizations/*',
    '/events/*',
    '/resources/*',
  ],
  method: ['GET'],
  onError: 'bypass',
};
