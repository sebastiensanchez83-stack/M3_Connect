/**
 * Netlify edge function: /sitemap.xml, built on request.
 *
 * Lists the fixed public pages (src/lib/seoMeta.ts, SITEMAP_FIXED_PATHS), every
 * organization listed in the directory (access_status = verified — the
 * imported marinas included, on purpose: they stay indexed), every published
 * resource and every published event, with <lastmod> when the record has one.
 * robots.txt points here. Articles and events are listed at their readable
 * address (/resources/<slug>, /events/<slug>, 20 Oct 2026), by id while the slug
 * column does not exist yet (the database refuses it: the resources are then read
 * again without it). The World Yachting Summit's event row is left out: its page
 * is /wys26.
 *
 * Read with the public anon key (netlify/lib/supabase-rest.ts). Each query gets
 * 2 seconds — more than a page's 800 ms, since only robots wait for this file
 * and a short list would hide records from them. If a query fails, the
 * sitemap goes out without that part; with no Supabase at all, it is the
 * fixed pages alone. A complete sitemap is kept an hour on Netlify's CDN, a
 * partial one is not kept at all, so the next robot gets a fresh try.
 *
 * The response header X-SMC-Sitemap says which: live, partial or fixed.
 * Check it with: curl -s -D - -o /dev/null <site>/sitemap.xml
 * Declared in netlify.toml.
 */
import {
  SITEMAP_FIXED_PATHS, WYS26_EVENT_ID, absoluteUrl, eventCanonicalPath, orgPath, resourcePath,
} from '../../src/lib/seoMeta.ts';
import { selectRows, selectRowsOr, supabaseEnv, type SupabaseEnv } from '../lib/supabase-rest.ts';

const LOOKUP_TIMEOUT_MS = 2000;

interface Entry {
  loc: string;
  lastmod?: string;
}

type Row = Record<string, unknown>;

const xmlEscape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** The first valid timestamp among `fields`, as YYYY-MM-DD. */
function lastmodOf(row: Row, fields: string[]): string | undefined {
  for (const field of fields) {
    const value = row[field];
    if (typeof value !== 'string' || !value) continue;
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  }
  return undefined;
}

export function renderSitemap(entries: Entry[]): string {
  const urls = entries.map(({ loc, lastmod }) =>
    `  <url><loc>${xmlEscape(loc)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

const RESOURCE_QUERY = 'updated_at,published_at,created_at&published=eq.true&order=published_at.desc.nullslast&limit=5000';

/** The published articles, with their slug; without it while the column does not exist. */
async function resourceRows(env: SupabaseEnv): Promise<Row[] | null> {
  const first = await selectRowsOr<Row>(env, 'resources', `select=id,slug,${RESOURCE_QUERY}`, LOOKUP_TIMEOUT_MS);
  if (first.rows !== null || !first.missingSlugColumn) return first.rows;
  return selectRows<Row>(env, 'resources', `select=id,${RESOURCE_QUERY}`, LOOKUP_TIMEOUT_MS);
}

const slugOf = (row: Row) => (typeof row.slug === 'string' && row.slug ? row.slug : null);

/** Every entry, and whether every query answered. */
export async function sitemapEntries(): Promise<{ entries: Entry[]; state: 'live' | 'partial' | 'fixed' }> {
  const fixed: Entry[] = SITEMAP_FIXED_PATHS.map((path) => ({ loc: absoluteUrl(path) }));
  const env = supabaseEnv();
  if (!env) return { entries: fixed, state: 'fixed' };

  const [orgs, resources, events] = await Promise.all([
    selectRows<Row>(env, 'organizations', 'select=slug,updated_at&access_status=eq.verified&slug=not.is.null&order=slug.asc&limit=5000', LOOKUP_TIMEOUT_MS),
    resourceRows(env),
    // select=* as the events page does for any visitor: no assumption about which date columns
    // exist; it brings the slug once the column is there.
    selectRows<Row>(env, 'events', 'select=*&published=not.is.false&order=date_time.desc.nullslast&limit=5000', LOOKUP_TIMEOUT_MS),
  ]);

  const entries = [...fixed];
  for (const org of orgs ?? []) {
    if (typeof org.slug === 'string' && org.slug) entries.push({ loc: absoluteUrl(orgPath(org.slug)), lastmod: lastmodOf(org, ['updated_at']) });
  }
  for (const resource of resources ?? []) {
    if (typeof resource.id === 'string') {
      entries.push({
        loc: absoluteUrl(resourcePath({ id: resource.id, slug: slugOf(resource) })),
        lastmod: lastmodOf(resource, ['updated_at', 'published_at', 'created_at']),
      });
    }
  }
  for (const event of events ?? []) {
    // No made-up date: an event without updated_at gets no <lastmod>. The Summit's page is /wys26.
    if (typeof event.id !== 'string' || event.id.toLowerCase() === WYS26_EVENT_ID) continue;
    entries.push({ loc: absoluteUrl(eventCanonicalPath({ id: event.id, slug: slugOf(event) })), lastmod: lastmodOf(event, ['updated_at']) });
  }
  const answered = [orgs, resources, events].filter((rows) => rows !== null).length;
  return { entries, state: answered === 3 ? 'live' : answered === 0 ? 'fixed' : 'partial' };
}

export default async function sitemap(request: Request): Promise<Response> {
  let entries: Entry[];
  let state: 'live' | 'partial' | 'fixed';
  try {
    ({ entries, state } = await sitemapEntries());
  } catch {
    entries = SITEMAP_FIXED_PATHS.map((path) => ({ loc: absoluteUrl(path) }));
    state = 'fixed';
  }
  const headers = new Headers({
    'Content-Type': 'application/xml; charset=utf-8',
    'Cache-Control': 'public, max-age=0, must-revalidate',
    'Netlify-CDN-Cache-Control': state === 'live' ? 'public, s-maxage=3600, stale-while-revalidate=86400' : 'no-store',
    'X-SMC-Sitemap': state,
  });
  return new Response(request.method === 'HEAD' ? null : renderSitemap(entries), { status: 200, headers });
}
