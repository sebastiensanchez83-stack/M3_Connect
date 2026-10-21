#!/usr/bin/env node
// Day-D smoke checks: anonymous, read-only HTTP GETs. No sign-in, no writes.
// Usage:
//   node scripts/smoke-day-d.mjs <baseUrl> [--production] [--save-guids]
//   --production   expect NO X-Robots-Tag noindex on public pages (the live domain after the switch)
//   --save-guids   write the current RSS guids to scripts/smoke-day-d.guids.json (run once on the
//                  live site BEFORE the switch; after the switch the same guids must still be there)
// Exit code 1 if any check fails. See docs/operations/smoke-tests-day-d.md.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const base = (args.find((a) => !a.startsWith('--')) || '').replace(/\/$/, '');
const production = args.includes('--production');
const saveGuids = args.includes('--save-guids');
if (!base) { console.error('usage: node scripts/smoke-day-d.mjs <baseUrl> [--production] [--save-guids]'); process.exit(2); }
const guidFile = fileURLToPath(new URL('./smoke-day-d.guids.json', import.meta.url));

let fails = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  (' + detail + ')' : ''}`);
};
const get = (path, redirect = 'follow') => fetch(base + path, { redirect, headers: { 'user-agent': 'smc-smoke-day-d' } });

// 1. Public SPA pages answer 200 with the app shell.
const pages = ['/', '/directory', '/events', '/resources', '/opportunities', '/partners', '/join', '/signup',
  '/reset-password', '/contact', '/about', '/sm26', '/sm26/vote', '/wys26', '/privacy', '/terms'];
for (const p of pages) {
  const r = await get(p);
  const body = await r.text();
  ok(r.status === 200 && body.includes('id="root"'), `GET ${p} -> 200 app shell`, `status ${r.status}`);
  if (p === '/' ) {
    const robots = r.headers.get('x-robots-tag') || '';
    if (production) ok(!/noindex/i.test(robots) && !/<meta[^>]+noindex/i.test(body), 'home has no noindex (production)', robots || 'no header');
    else ok(/noindex/i.test(robots), 'home is noindex (preview)', robots || 'no header');
  }
}

// 2. Private/token pages stay noindex everywhere.
for (const p of ['/wys26/guest', '/account', '/admin']) {
  const r = await get(p);
  ok(/noindex/i.test(r.headers.get('x-robots-tag') || ''), `GET ${p} carries X-Robots-Tag noindex`, r.headers.get('x-robots-tag') || 'none');
}

// 3. robots.txt and sitemap.
{
  const r = await get('/robots.txt');
  const t = await r.text();
  ok(r.status === 200 && /Sitemap:\s*https:\/\/smartmarinaconnect\.com\/sitemap\.xml/.test(t), 'robots.txt 200 with Sitemap line');
  if (production) ok(!/Disallow:\s*\/\s*$/m.test(t), 'robots.txt does not disallow everything');
}
let sitemapLocs = [];
{
  const r = await get('/sitemap.xml');
  const t = await r.text();
  sitemapLocs = [...t.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  ok(r.status === 200 && sitemapLocs.length >= 50, 'sitemap.xml 200 with >= 50 URLs', `${sitemapLocs.length} URLs`);
  ok(sitemapLocs.every((u) => u.startsWith('https://smartmarinaconnect.com/')), 'sitemap URLs all on smartmarinaconnect.com');
}

// 4. RSS feeds (m3monaco.com and s3monaco.com import these on the guid).
const guids = {};
for (const feed of ['/rss.xml', '/rss-s3.xml']) {
  const r = await get(feed);
  const t = await r.text();
  guids[feed] = [...t.matchAll(/<guid[^>]*>([^<]+)<\/guid>/g)].map((m) => m[1]);
  ok(r.status === 200 && /<rss/.test(t), `${feed} 200 and is RSS`, `${guids[feed].length} items, ${r.headers.get('content-type')}`);
  ok(guids[feed].every((g) => /^https:\/\/smartmarinaconnect\.com\/resources\/[0-9a-f-]{36}$/.test(g)), `${feed} guids keep the /resources/<uuid> form`);
}
if (saveGuids) {
  writeFileSync(guidFile, JSON.stringify({ savedFrom: base, savedAt: new Date().toISOString(), guids }, null, 2) + '\n');
  console.log(`saved guids to ${guidFile}`);
} else if (existsSync(guidFile)) {
  const saved = JSON.parse(readFileSync(guidFile, 'utf8')).guids;
  for (const feed of Object.keys(saved)) {
    const missing = saved[feed].filter((g) => !guids[feed]?.includes(g));
    ok(missing.length === 0, `${feed} still carries every saved guid`, missing.length ? `missing ${missing.length}: ${missing.slice(0, 2).join(', ')}` : `${saved[feed].length} checked`);
  }
} else console.log('SKIP  guid stability (no scripts/smoke-day-d.guids.json yet; run once with --save-guids on the live site)');

// 5. Old id URLs and slugs: a feed item (old /resources/<uuid>) must still open.
{
  const first = guids['/rss.xml']?.[0];
  if (first) {
    const r = await get(new URL(first).pathname);
    ok(r.status === 200, `old article URL ${new URL(first).pathname} -> 200`, `status ${r.status}`);
  }
  const slugUrl = sitemapLocs.find((u) => /\/resources\/(?![0-9a-f-]{36}$)[^/]+$/.test(u));
  if (slugUrl) {
    const r = await get(new URL(slugUrl).pathname);
    ok(r.status === 200, `slug article URL ${new URL(slugUrl).pathname} -> 200`, `status ${r.status}`);
  } else console.log('SKIP  no slug article URL in sitemap');
  const org = sitemapLocs.find((u) => u.includes('/organizations/'));
  if (org) {
    const r = await get(new URL(org).pathname);
    const t = await r.text();
    ok(r.status === 200 && /<title>/.test(t), `company page ${new URL(org).pathname} -> 200 with title`);
  }
}

// 6. Redirects kept for old links.
for (const [from, to] of [['/become-partner', '/join'], ['/network', '/directory'], ['/marketplace', '/directory']]) {
  // these are client-side redirects: the server must at least serve the shell (200), never 404
  const r = await get(from);
  ok(r.status === 200, `old link ${from} served (client redirect to ${to})`, `status ${r.status}`);
}

// 7. Static assets and security headers.
{
  const r = await get('/manifest.json');
  ok(r.status === 200, '/manifest.json 200');
  const h = await get('/');
  ok(/no-cache|max-age=0/.test(h.headers.get('cache-control') || ''), 'home is not cached (no-cache or max-age=0)', h.headers.get('cache-control') || 'none');
  const r404 = await get('/this-page-does-not-exist-smoke');
  ok(r404.status === 200 || r404.status === 404, 'unknown path answered (SPA 404 page)', `status ${r404.status}`);
}

console.log(`\n${fails === 0 ? 'ALL PASS' : fails + ' FAIL'}  base=${base}  mode=${production ? 'production' : 'preview'}`);
process.exit(fails ? 1 : 0);
