import { lazy, type ComponentType } from 'react';

/**
 * lazyWithRetry — drop-in replacement for React.lazy() that survives stale
 * chunk hashes after a new deploy.
 *
 * WHY THIS EXISTS:
 * When Netlify deploys a new build, all JS chunk filenames change (they are
 * hashed). Any browser that still has the old `index.html` cached will try to
 * fetch assets like `/assets/EventsPage-OLDHASH.js` — those no longer exist on
 * the server, so Netlify's SPA fallback serves `index.html` instead. The
 * browser then refuses to execute HTML as a module script and throws:
 *
 *     Failed to load module script: Expected a JavaScript-or-Wasm module
 *     script but the server responded with a MIME type of "text/html".
 *
 * followed by a TypeError from React.lazy's dynamic import, which crashes the
 * route into our ErrorBoundary.
 *
 * HOW THIS FIXES IT:
 * On the first failure, we flag sessionStorage and hard-reload the page. The
 * reload fetches a fresh `index.html` (which our `_headers` file marks
 * `no-cache`), so React.lazy will then receive the new chunk paths on next
 * attempt. If the reload also fails (genuine error — not a stale deploy), we
 * stop retrying and rethrow so the ErrorBoundary shows the real error.
 *
 * Works with both `default` and named exports via the importer callback.
 */
const SESSION_FLAG = 'smc:chunk-reload-attempted';

type Importer<T extends ComponentType<any>> = () => Promise<{ default: T }>;

export function lazyWithRetry<T extends ComponentType<any>>(importer: Importer<T>) {
  return lazy(async () => {
    try {
      const mod = await importer();
      // Success — clear any lingering reload flag
      if (typeof window !== 'undefined') {
        window.sessionStorage.removeItem(SESSION_FLAG);
      }
      return mod;
    } catch (err) {
      const isChunkError = isDynamicImportError(err);
      const hasReloaded =
        typeof window !== 'undefined' &&
        window.sessionStorage.getItem(SESSION_FLAG) === 'true';

      if (isChunkError && !hasReloaded && typeof window !== 'undefined') {
        // Set flag BEFORE reload so we don't loop
        window.sessionStorage.setItem(SESSION_FLAG, 'true');
        // eslint-disable-next-line no-console
        console.warn(
          '[lazyWithRetry] Chunk load failed — likely stale deploy. Reloading once to fetch fresh assets.',
          err
        );
        // Hard reload bypasses HTTP cache for the navigation request
        window.location.reload();
        // Return a never-resolving promise so React suspends on the fallback
        // until the reload navigates away.
        return new Promise<{ default: T }>(() => {});
      }

      // Either not a chunk error, or we already tried reloading once.
      // Rethrow so the ErrorBoundary can show a proper error.
      throw err;
    }
  });
}

/** Detect the Vite/Chromium/Firefox variants of "failed to dynamically import module". */
function isDynamicImportError(err: unknown): boolean {
  if (!err) return false;
  const message = err instanceof Error ? err.message : String(err);
  // Known stable substrings across browsers + Vite + Webpack:
  return (
    /Failed to fetch dynamically imported module/i.test(message) ||
    /error loading dynamically imported module/i.test(message) ||
    /Importing a module script failed/i.test(message) ||
    /Loading chunk \d+ failed/i.test(message) || // webpack flavour, harmless to keep
    /ChunkLoadError/i.test(message) ||
    (err instanceof Error && err.name === 'ChunkLoadError')
  );
}
