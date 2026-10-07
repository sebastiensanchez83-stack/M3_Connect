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
 *     /become-partner, /opportunities, /about, /contact, /tiers, /sm26,
 *     /sm26/vote, /wys26, and the aliases /join, /network, /marketplace);
 *   - /organizations/:slug, /events/:id and /resources/:id, read from
 *     Supabase with the public anon key (netlify/lib/supabase-rest.ts).
 * The words and the tags come from src/i18n/seo.ts (English) and
 * src/lib/seoMeta.ts, the same code the pages run in the browser, and every
 * tag is marked data-rh="true" so react-helmet-async replaces it rather than
 * adding a copy.
 *
 * Safety: it never changes a route, a status code or the page body. It only
 * runs on the paths listed in `config` (end of this file), GET only. A lookup
 * gets 800 ms; after that, or on any error, the HTML goes out untouched. A
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
 * is kept).
 *
 * The response header X-SMC-SEO says what happened: page, organization, event,
 * resource, not-found, or fallback:<reason>. Check it with a GET, not
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
  ORG_SEO_COLUMNS,
  RESOURCE_SEO_COLUMNS,
  eventMeta,
  fixedPageMeta,
  headHtml,
  makeSeoTr,
  organizationMeta,
  resourceMeta,
  type EventSeoInput,
  type OrgSeoInput,
  type PageMeta,
  type ResourceSeoInput,
} from '../../src/lib/seoMeta.ts';
import { selectRows, supabaseEnv, withDeadline } from '../lib/supabase-rest.ts';

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
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Route =
  | { kind: 'page'; meta: PageMeta }
  | { kind: 'organization'; slug: string }
  | { kind: 'event'; id: string }
  | { kind: 'resource'; id: string };

interface Resolved {
  meta: PageMeta | null;
  source: string;
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
  if (match[1] === 'organizations') return { kind: 'organization', slug: param };
  return match[1] === 'events' ? { kind: 'event', id: param } : { kind: 'resource', id: param };
}

/** A record an anonymous reader cannot see: kept out of the index, nothing else changed. */
function notFoundMeta(): PageMeta {
  return {
    title: withSiteSuffix(tr('notFound.title')),
    description: tr('home.description'),
    noindex: true,
  };
}

export async function resolve(route: Route): Promise<Resolved> {
  if (route.kind === 'page') return { meta: route.meta, source: 'page' };
  // Event and resource ids are UUIDs: anything else is a wrong link.
  if (route.kind !== 'organization' && !UUID.test(route.id)) return { meta: notFoundMeta(), source: 'not-found' };

  const env = supabaseEnv();
  if (!env) return { meta: null, source: 'fallback:no-env' };

  if (route.kind === 'organization') {
    const rows = await selectRows<OrgSeoInput>(
      env, 'organizations',
      `select=${ORG_SEO_COLUMNS}&slug=eq.${encodeURIComponent(route.slug)}&limit=1`,
      LOOKUP_TIMEOUT_MS,
    );
    if (rows === null) return { meta: null, source: 'fallback:lookup' };
    if (rows.length === 0 || !rows[0].name || !rows[0].slug) return { meta: notFoundMeta(), source: 'not-found' };
    return { meta: organizationMeta(rows[0], tr), source: 'organization' };
  }

  if (route.kind === 'event') {
    const rows = await selectRows<EventSeoInput & { published?: boolean | null }>(
      env, 'events',
      `select=${EVENT_SEO_COLUMNS}&id=eq.${encodeURIComponent(route.id)}&limit=1`,
      LOOKUP_TIMEOUT_MS,
    );
    if (rows === null) return { meta: null, source: 'fallback:lookup' };
    if (rows.length === 0 || !rows[0].title) return { meta: notFoundMeta(), source: 'not-found' };
    const meta = eventMeta(rows[0], tr, 'en-GB');
    // Unpublished: staff can open it, nobody should find it.
    return rows[0].published === false ? { meta: { ...meta, noindex: true }, source: 'not-found' } : { meta, source: 'event' };
  }

  const rows = await selectRows<ResourceSeoInput>(
    env, 'resources',
    `select=${RESOURCE_SEO_COLUMNS}&id=eq.${encodeURIComponent(route.id)}&published=eq.true&limit=1`,
    LOOKUP_TIMEOUT_MS,
  );
  if (rows === null) return { meta: null, source: 'fallback:lookup' };
  if (rows.length === 0 || !rows[0].title) return { meta: notFoundMeta(), source: 'not-found' };
  return { meta: resourceMeta(rows[0], tr), source: 'resource' };
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

/** A copy of `from`, plus the missing security headers and, when given, X-SMC-SEO. */
function outgoingHeaders(from: Headers, source: string | null): Headers {
  const headers = new Headers(from);
  for (const [name, value] of SECURITY_HEADERS) if (!headers.has(name)) headers.set(name, value);
  if (source) headers.set(SEO_HEADER, source);
  return headers;
}

/** The response as it is, plus the security headers and, when given, the X-SMC-SEO header. */
function tagged(response: Response, source: string | null): Response {
  try {
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: outgoingHeaders(response.headers, source),
    });
  } catch {
    return response;
  }
}

export default async function seo(request: Request, context: Context): Promise<Response | undefined> {
  let route: Route | null = null;
  try {
    if (request.method === 'GET') route = routeFor(new URL(request.url));
  } catch {
    route = null;
  }
  // Not a page this function describes: returning nothing lets Netlify carry on as if it were not here.
  if (!route) return undefined;

  // The page and the lookup run side by side; the lookup never waits more than 800 ms.
  const lookup = withDeadline(resolve(route), LOOKUP_TIMEOUT_MS + 100);
  const response = await context.next();

  let untouched: Response | null = null;
  try {
    const type = response.headers.get('content-type') ?? '';
    if (response.status !== 200 || !type.includes('text/html')) return tagged(response, null);
    const resolved = await lookup;
    if (!resolved || !resolved.meta) return tagged(response, resolved?.source ?? 'fallback:timeout');
    untouched = response.clone();
    const rewritten = rewriteHead(await response.text(), resolved.meta);
    if (rewritten === null) return tagged(untouched, 'fallback:no-head');
    const headers = outgoingHeaders(untouched.headers, resolved.source);
    headers.delete('content-length');
    headers.delete('etag'); // the body is no longer the file the tag was computed for
    return new Response(rewritten, { status: untouched.status, statusText: untouched.statusText, headers });
  } catch {
    return tagged(untouched ?? response, 'fallback:error');
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
    '/become-partner',
    '/join',
    '/opportunities',
    '/about',
    '/contact',
    '/tiers',
    '/sm26',
    '/sm26/vote',
    '/wys26',
    '/organizations/*',
    '/events/*',
    '/resources/*',
  ],
  method: ['GET'],
  onError: 'bypass',
};
