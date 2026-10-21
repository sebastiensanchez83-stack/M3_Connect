// Readable addresses (20 Oct 2026): the edge function's 301s and heads, the sitemap, with and
// without the slug column (supabase/migrations/20261020160000_readable_slugs.sql applied or not).
// Run: node tests/slugs.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import seo from '../netlify/edge-functions/seo.ts';
import { sitemapEntries } from '../netlify/edge-functions/sitemap.ts';
import { eventPath, resourcePath, RENDEZVOUS_6TH_EVENT_ID, RENDEZVOUS_6TH_PATH, WYS26_EVENT_ID } from '../src/lib/seoMeta.ts';

const SITE = 'https://smartmarinaconnect.com';
const ARTICLE = { id: '11111111-2222-4333-8444-555555555555', slug: 'marinas-and-standards', title: 'Marinas & standards', summary: 'Short.', published_at: '2026-10-01T09:00:00Z', created_at: '2026-10-01T09:00:00Z', updated_at: '2026-10-02T09:00:00Z' };
const EVENT = { id: '66666666-7777-4888-8999-000000000000', slug: 'blue-ports-webinar', title: 'Blue ports webinar', event_type: 'webinar', date_time: '2026-12-01T10:00:00Z', published: true };
const DRAFT = { ...EVENT, id: '66666666-7777-4888-8999-000000000001', slug: 'secret-draft', published: false };
const WYS = { ...EVENT, id: WYS26_EVENT_ID, slug: 'world-yachting-summit-2026', title: 'World Yachting Summit 2026' };
const RENDEZVOUS = { ...EVENT, id: RENDEZVOUS_6TH_EVENT_ID, slug: 'monaco-smart-and-sustainable-marina-2026-6th-edition', title: 'Monaco Smart & Sustainable Marina 2026, 6th edition', event_type: 'on_site' };
const ORG = { id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', slug: 'port-example', name: 'Port Example', organization_type: 'marina', access_status: 'verified', duplicate_of: null };
// Visitors (21 Oct 2026, Q5): a company M3 has not validated is not public; a merged copy moves to the kept one.
const PENDING_ORG = { id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1', slug: 'pending-yard', name: 'Pending Yard', organization_type: 'partner', access_status: 'pending', duplicate_of: null };
const MERGED_ORG = { id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee2', slug: 'port-example-old', name: 'Port Example (old)', organization_type: 'marina', access_status: 'suspended', duplicate_of: ORG.id };

/**
 * A fake PostgREST: `slugs` says whether the slug column (and the lookups) exist; `answer`, when
 * given, answers a request first (a failure of the database other than the missing column).
 */
function fakeDb({ slugs, answer = null }) {
  const calls = [];
  const fetchImpl = async (input) => {
    const url = new URL(input);
    calls.push(url);
    const [, , , table, fn] = url.pathname.split('/');
    const forced = answer ? answer(table, fn) : null;
    if (forced) return forced;
    const q = url.searchParams;
    const select = q.get('select') ?? '';
    const eq = (name) => (q.get(name) ?? '').replace(/^eq\./, '');
    if (!slugs && (select.split(',').includes('slug') && table !== 'organizations' || q.has('slug') && table !== 'organizations')) {
      return Response.json({ code: '42703', message: `column ${table}.slug does not exist` }, { status: 400 });
    }
    if (table === 'rpc') {
      if (!slugs) return Response.json({ code: 'PGRST202', message: 'not found' }, { status: 404 });
      const old = q.get('p_slug');
      if (fn === 'resource_slug_lookup') return Response.json(old === 'old-article-address' ? ARTICLE.slug : null);
      if (fn === 'event_slug_lookup') return Response.json(old === 'old-event-address' ? EVENT.slug : null);
      return new Response('?', { status: 404 });
    }
    const strip = (row) => (slugs ? row : Object.fromEntries(Object.entries(row).filter(([k]) => k !== 'slug')));
    let rows = [];
    if (table === 'resources') rows = [ARTICLE];
    if (table === 'events') rows = [EVENT, DRAFT, WYS, RENDEZVOUS];
    if (table === 'organizations') rows = [ORG, PENDING_ORG, MERGED_ORG];
    if (q.has('id')) rows = rows.filter((r) => r.id === eq('id'));
    if (q.has('slug') && !(q.get('slug') ?? '').startsWith('not.')) rows = rows.filter((r) => r.slug === eq('slug'));
    if (q.get('published') === 'eq.true') rows = rows.filter((r) => r.published !== false);
    if (q.get('published') === 'not.is.false') rows = rows.filter((r) => r.published !== false);
    return Response.json(rows.map(strip));
  };
  return { calls, fetchImpl };
}

async function visit(path, db) {
  const originalFetch = globalThis.fetch;
  const originalNetlify = globalThis.Netlify;
  globalThis.Netlify = { env: { get: (name) => ({ SUPABASE_URL: 'https://db.example', SUPABASE_ANON_KEY: 'sb_publishable_fixture' })[name] } };
  globalThis.fetch = db.fetchImpl;
  try {
    const page = '<!doctype html><html><head><title>Smart Marina Connect</title></head><body></body></html>';
    const context = { next: async () => new Response(page, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }) };
    const response = await seo(new Request(SITE + path), context);
    return { response, html: response && response.status === 200 ? await response.text() : '' };
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.Netlify = originalNetlify;
  }
}

const canonicalOf = (html) => html.match(/<link data-rh="true" rel="canonical" href="([^"]+)"/)?.[1] ?? null;

test('paths: the slug, else the id', () => {
  assert.equal(resourcePath(ARTICLE), '/resources/marinas-and-standards');
  assert.equal(resourcePath({ id: ARTICLE.id }), `/resources/${ARTICLE.id}`);
  assert.equal(eventPath({ id: EVENT.id, slug: null }), `/events/${EVENT.id}`);
  assert.equal(RENDEZVOUS_6TH_PATH, '/events/monaco-smart-and-sustainable-marina-2026-6th-edition');
});

test('an article by id, or by an old address, moves for good to its slug, query string kept', async () => {
  const db = fakeDb({ slugs: true });
  let { response } = await visit(`/resources/${ARTICLE.id}?utm_source=m3monaco.com&x=1`, db);
  assert.equal(response.status, 301);
  assert.equal(response.headers.get('Location'), `${SITE}/resources/marinas-and-standards?utm_source=m3monaco.com&x=1`);
  assert.equal(response.headers.get('X-SMC-SEO'), 'redirect');
  ({ response } = await visit('/resources/old-article-address', db));
  assert.equal(response.status, 301);
  assert.equal(response.headers.get('Location'), `${SITE}/resources/marinas-and-standards`);
  ({ response } = await visit('/resources/Marinas-And-Standards', db));
  assert.equal(response.status, 301);
  assert.equal(response.headers.get('Location'), `${SITE}/resources/marinas-and-standards`);
});

test('an article at its slug gets its head, canonical on the slug; an unknown slug is noindex', async () => {
  const db = fakeDb({ slugs: true });
  let { response, html } = await visit('/resources/marinas-and-standards', db);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('X-SMC-SEO'), 'resource');
  assert.equal(canonicalOf(html), `${SITE}/resources/marinas-and-standards`);
  ({ response, html } = await visit('/resources/no-such-article', db));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('X-SMC-SEO'), 'not-found');
  assert.match(html, /<meta data-rh="true" name="robots" content="noindex"/);
});

test('before the slug migration: ids as before, slugs not found, the Rendezvous slug still opens', async () => {
  const db = fakeDb({ slugs: false });
  let { response, html } = await visit(`/resources/${ARTICLE.id}`, db);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('X-SMC-SEO'), 'resource');
  assert.equal(canonicalOf(html), `${SITE}/resources/${ARTICLE.id}`);
  ({ response } = await visit('/resources/marinas-and-standards', db));
  assert.equal(response.headers.get('X-SMC-SEO'), 'not-found');
  ({ response, html } = await visit(`/events/${EVENT.id}`, db));
  assert.equal(response.status, 200);
  assert.equal(canonicalOf(html), `${SITE}/events/${EVENT.id}`);
  ({ response, html } = await visit(RENDEZVOUS_6TH_PATH, db));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('X-SMC-SEO'), 'event');
  assert.equal(canonicalOf(html), SITE + RENDEZVOUS_6TH_PATH);
  ({ response, html } = await visit(`/events/${RENDEZVOUS_6TH_EVENT_ID}`, db));
  assert.equal(response.status, 200);
  assert.equal(canonicalOf(html), SITE + RENDEZVOUS_6TH_PATH);
});

test('events: id and old address move to the slug; an unpublished event never moves; WYS goes to /wys26', async () => {
  const db = fakeDb({ slugs: true });
  let { response } = await visit(`/events/${EVENT.id}#programme`, db);
  assert.equal(response.status, 301);
  assert.equal(response.headers.get('Location'), `${SITE}/events/blue-ports-webinar`);
  ({ response } = await visit('/events/old-event-address?ref=mail', db));
  assert.equal(response.status, 301);
  assert.equal(response.headers.get('Location'), `${SITE}/events/blue-ports-webinar?ref=mail`);
  let html;
  ({ response, html } = await visit(`/events/${DRAFT.id}`, db));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('X-SMC-SEO'), 'not-found');
  assert.equal(canonicalOf(html), null);
  ({ response } = await visit('/events/secret-draft', db));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('X-SMC-SEO'), 'not-found');
  for (const path of [`/events/${WYS26_EVENT_ID}?token=abc`, '/events/world-yachting-summit-2026?token=abc']) {
    ({ response } = await visit(path, db));
    assert.equal(response.status, 301, path);
    assert.equal(response.headers.get('Location'), `${SITE}/wys26?token=abc`, path);
  }
  ({ response } = await visit(`/events/${WYS26_EVENT_ID}?token=abc`, fakeDb({ slugs: false })));
  assert.equal(response.headers.get('Location'), `${SITE}/wys26?token=abc`);
});

test('a company by id moves to its slug; the 301 keeps the security headers; a preview stays on its host', async () => {
  const db = fakeDb({ slugs: true });
  const { response } = await visit(`/organizations/${ORG.id}?tab=about`, db);
  assert.equal(response.status, 301);
  assert.equal(response.headers.get('Location'), `${SITE}/organizations/port-example?tab=about`);
  assert.equal(response.headers.get('X-Frame-Options'), 'DENY');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const originalFetch = globalThis.fetch;
  const originalNetlify = globalThis.Netlify;
  globalThis.Netlify = { env: { get: (name) => ({ SUPABASE_URL: 'https://db.example', SUPABASE_ANON_KEY: 'sb_publishable_fixture' })[name] } };
  globalThis.fetch = db.fetchImpl;
  try {
    const context = { next: async () => new Response('<html><head><title>x</title></head></html>', { status: 200, headers: { 'content-type': 'text/html' } }) };
    const preview = await seo(new Request(`https://refonte--m3connectv2.netlify.app/resources/${ARTICLE.id}`), context);
    assert.equal(preview.status, 301);
    assert.equal(preview.headers.get('Location'), 'https://refonte--m3connectv2.netlify.app/resources/marinas-and-standards');
    assert.equal(preview.headers.get('X-Robots-Tag'), 'noindex, nofollow');
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.Netlify = originalNetlify;
  }
});

test('companies: the head is the visitor version (a pending company is not found, a merged copy moves)', async () => {
  const db = fakeDb({ slugs: true });
  let { response, html } = await visit('/organizations/port-example', db);
  assert.equal(response.headers.get('X-SMC-SEO'), 'organization');
  assert.ok(html.includes('Port Example'));
  ({ response, html } = await visit('/organizations/pending-yard', db));
  assert.equal(response.headers.get('X-SMC-SEO'), 'not-found');
  assert.ok(!html.includes('Pending Yard'));
  ({ response } = await visit(`/organizations/${PENDING_ORG.id}`, db));
  assert.notEqual(response.status, 301);
  ({ response } = await visit('/organizations/port-example-old?tab=about', db));
  assert.equal(response.status, 301);
  assert.equal(response.headers.get('Location'), `${SITE}/organizations/port-example?tab=about`);
  ({ response } = await visit(`/organizations/${MERGED_ORG.id}`, db));
  assert.equal(response.status, 301);
  assert.equal(response.headers.get('Location'), `${SITE}/organizations/port-example`);
  // Only public columns are named (anon keeps exactly these at go-live).
  for (const url of db.calls.filter((u) => u.pathname.endsWith('/organizations'))) {
    assert.ok(!/owner_user_id|primary_domain|rejection_reason/.test(url.searchParams.get('select') ?? ''), url.search);
  }
});

test('the sitemap names explicit event columns, never select=* (the meeting link closes to visitors at go-live)', async () => {
  const db = fakeDb({ slugs: true });
  const originalFetch = globalThis.fetch;
  const originalNetlify = globalThis.Netlify;
  globalThis.Netlify = { env: { get: (name) => ({ SUPABASE_URL: 'https://db.example', SUPABASE_ANON_KEY: 'sb_publishable_fixture' })[name] } };
  globalThis.fetch = db.fetchImpl;
  try {
    await sitemapEntries();
    const selects = db.calls.filter((u) => u.pathname.endsWith('/events')).map((u) => u.searchParams.get('select'));
    assert.ok(selects.length > 0);
    assert.ok(selects.every((s) => s && s !== '*' && !s.includes('meeting_url')), selects.join(' | '));
    const orgQuery = db.calls.find((u) => u.pathname.endsWith('/organizations'));
    assert.equal(orgQuery.searchParams.get('archived_at'), 'is.null');
    assert.equal(orgQuery.searchParams.get('duplicate_of'), 'is.null');
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.Netlify = originalNetlify;
  }
});

test('the sitemap lists slug addresses, by id before the migration, never the WYS event row', async () => {
  for (const slugs of [true, false]) {
    const db = fakeDb({ slugs });
    const originalFetch = globalThis.fetch;
    const originalNetlify = globalThis.Netlify;
    globalThis.Netlify = { env: { get: (name) => ({ SUPABASE_URL: 'https://db.example', SUPABASE_ANON_KEY: 'sb_publishable_fixture' })[name] } };
    globalThis.fetch = db.fetchImpl;
    try {
      const { entries, state } = await sitemapEntries();
      const locs = entries.map((e) => e.loc);
      assert.equal(state, 'live');
      assert.ok(locs.includes(slugs ? `${SITE}/resources/marinas-and-standards` : `${SITE}/resources/${ARTICLE.id}`));
      assert.ok(locs.includes(slugs ? `${SITE}/events/blue-ports-webinar` : `${SITE}/events/${EVENT.id}`));
      assert.ok(locs.includes(SITE + RENDEZVOUS_6TH_PATH));
      assert.ok(!locs.some((l) => l.includes(WYS26_EVENT_ID) || l.includes('world-yachting-summit')));
      assert.ok(!locs.some((l) => l.includes('secret-draft') || l.includes(DRAFT.id)));
    } finally {
      globalThis.fetch = originalFetch;
      globalThis.Netlify = originalNetlify;
    }
  }
});

test('a 301 whose target can change is never cached (no-store); the WYS move keeps its query string and an hour', async () => {
  const db = fakeDb({ slugs: true });
  for (const path of ['/resources/old-article-address', `/resources/${ARTICLE.id}`, '/events/old-event-address', `/events/${EVENT.id}`, `/organizations/${ORG.id}`, '/organizations/Port-Example']) {
    const { response } = await visit(path, db);
    assert.equal(response.status, 301, path);
    assert.equal(response.headers.get('Cache-Control'), 'no-store', path);
  }
  for (const path of [`/events/${WYS26_EVENT_ID}?token=abc&lang=en`, '/events/world-yachting-summit-2026?token=abc&lang=en']) {
    const { response } = await visit(path, db);
    assert.equal(response.status, 301, path);
    assert.equal(response.headers.get('Location'), `${SITE}/wys26?token=abc&lang=en`, path);
    assert.equal(response.headers.get('Cache-Control'), 'public, max-age=3600', path);
  }
});

test('any other database failure (401, 403, 429, 5xx) leaves the page untouched: never a noindex, never the id fallback', async () => {
  for (const status of [401, 403, 429, 500, 503]) {
    const db = fakeDb({ slugs: true, answer: () => Response.json({ code: status === 401 ? 'PGRST301' : '57014', message: 'refused' }, { status }) });
    for (const path of ['/resources/marinas-and-standards', '/events/blue-ports-webinar', `/resources/${ARTICLE.id}`, `/events/${EVENT.id}`]) {
      const { response, html } = await visit(path, db);
      assert.equal(response.status, 200, `${status} ${path}`);
      assert.equal(response.headers.get('X-SMC-SEO'), 'fallback:lookup', `${status} ${path}`);
      assert.equal(response.headers.get('X-Robots-Tag'), null, `${status} ${path}`);
      assert.doesNotMatch(html, /noindex/, `${status} ${path}`);
      // Only the first read was made: no id fallback after an error that is not the missing column.
      assert.equal(db.calls.length, 1, `${status} ${path}`);
      db.calls.length = 0;
    }
  }
  // A 400 that is not about the slug column is not the missing column either.
  const other = fakeDb({ slugs: true, answer: () => Response.json({ code: 'PGRST100', message: 'failed to parse filter' }, { status: 400 }) });
  const { response } = await visit('/resources/marinas-and-standards', other);
  assert.equal(response.headers.get('X-SMC-SEO'), 'fallback:lookup');
  assert.equal(response.headers.get('X-Robots-Tag'), null);
});

test('the old-address lookup failing (5xx, 401) leaves the page untouched rather than noindex', async () => {
  for (const status of [500, 504, 401]) {
    const db = fakeDb({ slugs: true, answer: (table) => (table === 'rpc' ? Response.json({ code: '57014', message: 'canceling statement' }, { status }) : null) });
    for (const path of ['/resources/old-article-address', '/events/old-event-address']) {
      const { response, html } = await visit(path, db);
      assert.equal(response.status, 200, `${status} ${path}`);
      assert.equal(response.headers.get('X-SMC-SEO'), 'fallback:lookup', `${status} ${path}`);
      assert.equal(response.headers.get('X-Robots-Tag'), null, `${status} ${path}`);
      assert.doesNotMatch(html, /noindex/);
    }
  }
  // The missing column (42703) still means "before the migration": ids as before, slugs not found.
  const before = fakeDb({ slugs: false });
  let { response } = await visit('/resources/marinas-and-standards', before);
  assert.equal(response.headers.get('X-SMC-SEO'), 'not-found');
  ({ response } = await visit(`/resources/${ARTICLE.id}`, before));
  assert.equal(response.headers.get('X-SMC-SEO'), 'resource');
});

test('the sitemap reads the articles again without the slug only when the column is missing', async () => {
  const originalFetch = globalThis.fetch;
  const originalNetlify = globalThis.Netlify;
  globalThis.Netlify = { env: { get: (name) => ({ SUPABASE_URL: 'https://db.example', SUPABASE_ANON_KEY: 'sb_publishable_fixture' })[name] } };
  try {
    const db = fakeDb({ slugs: true, answer: (table) => (table === 'resources' ? Response.json({ code: 'PGRST301', message: 'JWT expired' }, { status: 401 }) : null) });
    globalThis.fetch = db.fetchImpl;
    const { entries, state } = await sitemapEntries();
    assert.equal(state, 'partial');
    assert.ok(!entries.some((e) => e.loc.includes('/resources/')));
    assert.equal(db.calls.filter((u) => u.pathname.endsWith('/resources')).length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.Netlify = originalNetlify;
  }
});
