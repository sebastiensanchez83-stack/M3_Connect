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

/** PostgREST's error body ({ code, message, details, hint }), as far as it could be read. */
export interface RestError {
  code?: string;
  message?: string;
}

/**
 * The answer to one GET: the parsed JSON body (null on any failure), the HTTP status (0 when
 * there was no answer: network error, or nothing within the time allowed), and on a non-2xx
 * answer the error body PostgREST sent (null when it was not JSON).
 */
export interface RestAnswer {
  body: unknown;
  status: number;
  error: RestError | null;
}

/**
 * GET /rest/v1/<path>?<query>: a table, or `rpc/<function>` for a STABLE function called
 * with its arguments in the query string. Never throws.
 */
export async function getRest(env: SupabaseEnv, path: string, query: string, timeoutMs: number): Promise<RestAnswer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = { apikey: env.key, Accept: 'application/json' };
    // A legacy anon key is a JWT and goes in Authorization too; a new
    // publishable key (sb_publishable_…) must not.
    if (env.key.startsWith('eyJ')) headers.Authorization = `Bearer ${env.key}`;
    const res = await fetch(`${env.url}/rest/v1/${path}?${query}`, { headers, signal: controller.signal });
    if (!res.ok) {
      const err = (await res.json().catch(() => null)) as unknown;
      return { body: null, status: res.status, error: err && typeof err === 'object' ? (err as RestError) : null };
    }
    return { body: (await res.json()) as unknown, status: res.status, error: null };
  } catch {
    return { body: null, status: 0, error: null };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * GET /rest/v1/<table>?<query>. The rows, or null on any failure: missing
 * table or column, refused by RLS with an error, network error, or no answer
 * within `timeoutMs` (the body included). An empty array means "no such row".
 */
export async function selectRows<T>(env: SupabaseEnv, table: string, query: string, timeoutMs: number): Promise<T[] | null> {
  const { body } = await getRest(env, table, query, timeoutMs);
  return Array.isArray(body) ? (body as T[]) : null;
}

/**
 * PostgREST's answer to a read naming a slug column that does not exist (yet): a 400 with 42703
 * (a select or a filter) or PGRST204, the message naming the column. The same test as
 * isMissingSlugColumn() in src/lib/slugRoutes.ts. Nothing else counts: a 401 (a stale or rotated
 * key), a 403, a 429 or a 5xx says nothing about the column.
 */
export function isMissingSlugColumn(status: number, error: RestError | null): boolean {
  return status === 400 && (error?.code === '42703' || error?.code === 'PGRST204') && /slug/i.test(error?.message ?? '');
}

/**
 * As selectRows, and whether the failure was the database saying the slug column does not exist
 * (supabase/migrations/20261020160000_readable_slugs.sql not applied): `missingSlugColumn`. Any
 * other failure gives rows null and missingSlugColumn false: the caller leaves the page as it is.
 */
export async function selectRowsOr<T>(env: SupabaseEnv, table: string, query: string, timeoutMs: number): Promise<{ rows: T[] | null; missingSlugColumn: boolean }> {
  const { body, status, error } = await getRest(env, table, query, timeoutMs);
  const rows = Array.isArray(body) ? (body as T[]) : null;
  return { rows, missingSlugColumn: rows === null && isMissingSlugColumn(status, error) };
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
