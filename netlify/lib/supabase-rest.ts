/**
 * Anonymous, read-only Supabase (PostgREST) reads for the Netlify edge
 * functions: the same public rows an anonymous visitor's browser reads, under
 * the same row-level security. Never a service key, never a write.
 *
 * The project URL and the public anon key come from the site's environment
 * variables, never from this file (the repository is public): first
 * SUPABASE_URL + SUPABASE_ANON_KEY, then the VITE_ pair the front end is built
 * with. Netlify only hands a variable to edge functions when its scope
 * includes "Functions"; without one, the callers skip their lookups and serve
 * the page as it is.
 *
 * Kept outside netlify/edge-functions/ so Netlify never takes it for a function.
 */

export interface SupabaseEnv {
  url: string;
  key: string;
}

type EnvReader = { env?: { get(name: string): string | undefined } };

function readEnv(name: string): string | undefined {
  const g = globalThis as unknown as { Netlify?: EnvReader; Deno?: EnvReader };
  try {
    const fromNetlify = g.Netlify?.env?.get(name);
    if (fromNetlify) return fromNetlify;
  } catch {
    // no Netlify global: not on Netlify
  }
  try {
    return g.Deno?.env?.get(name) ?? undefined;
  } catch {
    return undefined; // env access refused
  }
}

/** The first complete URL + key pair, or null. */
export function supabaseEnv(): SupabaseEnv | null {
  const pairs: [string, string][] = [
    ['SUPABASE_URL', 'SUPABASE_ANON_KEY'],
    ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'],
  ];
  for (const [urlName, keyName] of pairs) {
    const url = readEnv(urlName)?.trim();
    const key = readEnv(keyName)?.trim();
    if (url && key && /^https:\/\/[^\s/]+/i.test(url)) return { url: url.replace(/\/+$/, ''), key };
  }
  return null;
}

/**
 * GET /rest/v1/<table>?<query>. The rows, or null on any failure: missing
 * table or column, refused by RLS with an error, network error, or no answer
 * within `timeoutMs` (the body included). An empty array means "no such row".
 */
export async function selectRows<T>(env: SupabaseEnv, table: string, query: string, timeoutMs: number): Promise<T[] | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = { apikey: env.key, Accept: 'application/json' };
    // A legacy anon key is a JWT and goes in Authorization too; a new
    // publishable key (sb_publishable_…) must not.
    if (env.key.startsWith('eyJ')) headers.Authorization = `Bearer ${env.key}`;
    const res = await fetch(`${env.url}/rest/v1/${table}?${query}`, { headers, signal: controller.signal });
    if (!res.ok) {
      await res.body?.cancel();
      return null;
    }
    const rows: unknown = await res.json();
    return Array.isArray(rows) ? (rows as T[]) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** `promise`, or null if it has not settled (or has failed) after `ms`. */
export function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      () => { clearTimeout(timer); resolve(null); },
    );
  });
}
