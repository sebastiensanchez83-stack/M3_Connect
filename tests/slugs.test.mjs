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
const ORG = { id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', slug: 'port-example', name: 'Port Example', organization_type: 'marina' };

/** A fake PostgREST: `slugs` says whether the slug column (and the lookups) exist. */
function fakeDb({ slugs }) {
  const calls = [];
  const fetchImpl = async (input) => {
    const url = new URL(input);
    calls.push(url);
    const [, , , table, fn] = url.pathname.split('/');
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
    if (table === 'organizations') rows = [ORG];
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
  assert.equal(response.headers.get('Cache-Control'), 'public, max-age=3600');
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
