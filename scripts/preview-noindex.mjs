// Keeps every Netlify deploy that is not the production site out of search engines.
//
// Why a build step: netlify.toml cannot depend on the host or the deploy context,
// and netlify/edge-functions/seo.ts only runs on the pages it describes (it adds
// the same header there, for any host that is not smartmarinaconnect.com). This
// covers every other path of a preview: files, assets, /admin, token pages…
//
// What: on a Netlify build whose CONTEXT is not "production" (deploy-preview,
// branch-deploy, or a branch name for a configured context), append a catch-all
// X-Robots-Tag: noindex, nofollow rule to dist/_headers. Netlify applies the
// publish folder's _headers file together with netlify.toml's [[headers]].
//
// Safe by construction: it does nothing when CONTEXT is "production" or unset
// (a local build), so the production bundle is byte for byte what vite built.
// It is the npm "postbuild" hook of `npm run build`. Idempotent.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const MARKER = '# preview-noindex (scripts/preview-noindex.mjs)';
const context = process.env.CONTEXT;

if (!context || context === 'production') {
  console.log(`preview-noindex: skipped (CONTEXT=${context ?? 'unset'})`);
  process.exit(0);
}

const dist = path.resolve(process.cwd(), process.env.PREVIEW_NOINDEX_DIST || 'dist');
const file = path.join(dist, '_headers');
mkdirSync(dist, { recursive: true });
const current = existsSync(file) ? readFileSync(file, 'utf8') : '';
if (current.includes(MARKER)) {
  console.log('preview-noindex: already present');
  process.exit(0);
}
const rule = `${MARKER}\n/*\n  X-Robots-Tag: noindex, nofollow\n`;
if (current) appendFileSync(file, `${current.endsWith('\n') ? '' : '\n'}\n${rule}`);
else writeFileSync(file, rule);
console.log(`preview-noindex: X-Robots-Tag: noindex, nofollow added to ${path.relative(process.cwd(), file)} (CONTEXT=${context})`);
