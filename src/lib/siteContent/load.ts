import { supabase } from '@/lib/supabase';
import { initSitePreview, setPublishedSiteContent, type SiteContentRow } from './store';

/**
 * Fetches the published blocks of public.site_content (store.ts says what they
 * are). The last answer is kept in localStorage so a returning visitor gets the
 * published text on the first paint; the network answer replaces it a moment
 * later. A browser that blocks storage simply waits for the network.
 *
 * Before the migration is applied the table does not exist: the read fails
 * (42P01 / PGRST205), nothing is applied, and every page keeps its code's text.
 * Any other failure keeps whatever the cache had.
 */

const CACHE_KEY = 'smc-site-content-v1';

export function isMissingSiteContentTable(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === '42P01' || error.code === 'PGRST205' || error.code === 'PGRST202'
    || /site_content.*(does not exist|schema cache)|relation .* does not exist/i.test(error.message ?? '');
}

function readCache(): SiteContentRow[] | null {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const rows = JSON.parse(raw);
    return Array.isArray(rows) ? (rows as SiteContentRow[]) : null;
  } catch {
    return null;
  }
}

function writeCache(rows: SiteContentRow[]) {
  try {
    if (rows.length) window.localStorage.setItem(CACHE_KEY, JSON.stringify(rows));
    else window.localStorage.removeItem(CACHE_KEY);
  } catch { /* storage blocked or full: the network answer still applies */ }
}

let inFlight: Promise<void> | null = null;

/** Reads the published blocks again (after a Publish in the admin, for instance). */
export function refreshSiteContent(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      // Columns named: the table grants these five only (select * is refused).
      const { data, error } = await supabase
        .from('site_content')
        .select('key, kind, body')
        .eq('published', true);
      if (error) {
        if (isMissingSiteContentTable(error)) {
          setPublishedSiteContent([]);
          writeCache([]);
        }
        return;
      }
      const rows = (data ?? []) as SiteContentRow[];
      setPublishedSiteContent(rows);
      writeCache(rows);
    } catch {
      /* offline: keep the cached text */
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** main.tsx, before the first render. */
export function startSiteContent() {
  if (typeof window === 'undefined') return;
  const cached = readCache();
  if (cached) setPublishedSiteContent(cached);
  initSitePreview();
  void refreshSiteContent();
}
