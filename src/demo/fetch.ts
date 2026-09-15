// The demo backend router. supabase-js is created with this as its fetch, and
// window.fetch is wrapped too, so direct calls to any *.supabase.co URL (a few
// admin screens build those by hand) are also answered here and never leave the
// browser.
import { DEMO_API_BASE } from './demoMode';
import { handleTable, misses } from './postgrest';
import { handleAuth, seedSession } from './auth';
import { handleStorage } from './storage';
import { RPC, FUNCTIONS, noteMiss } from './registry';
import { resetDb, registerSeed } from './store';
import { clearUploads } from './uploads';
import { buildSeed } from './fixtures/index';
import './handlers';

registerSeed(buildSeed);

const LATENCY_MS = 70; // a hint of network time keeps spinners and transitions natural on camera

const json = (status: number, body: any, headers: Record<string, string> = {}) =>
  new Response(status === 204 || body === null ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function demoFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const req = new Request(input as RequestInfo, init);
  const url = new URL(req.url);
  const method = req.method.toUpperCase();
  const path = url.pathname;
  await sleep(LATENCY_MS);

  try {
    const rest = path.match(/\/rest\/v1\/(.*)$/);
    if (rest) {
      const target = decodeURIComponent(rest[1]);
      if (target.startsWith('rpc/')) {
        const name = target.slice(4);
        const args = method === 'GET'
          ? Object.fromEntries(url.searchParams.entries())
          : await req.clone().json().catch(() => ({}));
        const fn = RPC[name];
        if (!fn) { noteMiss(`rpc ${name}`); return json(200, null); }
        const out = await fn(args, req);
        if (out instanceof Response) return out;
        return json(200, out === undefined ? null : out);
      }
      const body = method === 'GET' || method === 'HEAD' || method === 'DELETE' ? null : await req.clone().json().catch(() => null);
      const res = handleTable(method, target, url.searchParams, req.headers, body);
      return json(res.status, res.body, res.headers);
    }

    const auth = path.match(/\/auth\/v1\/(.*)$/);
    if (auth) {
      const res = handleAuth(method, auth[1], url.searchParams);
      return json(res.status, res.body);
    }

    const storage = path.match(/\/storage\/v1\/(.*)$/);
    if (storage) {
      const res = await handleStorage(method, storage[1], req);
      if (res.raw) return new Response(res.raw, { status: 200 });
      return json(res.status, res.body);
    }

    const fnMatch = path.match(/\/functions\/v1\/([^/?]+)/);
    if (fnMatch) {
      const name = fnMatch[1];
      const ct = req.headers.get('content-type') || '';
      const body = ct.includes('json') ? await req.clone().json().catch(() => ({})) : {};
      const fn = FUNCTIONS[name];
      if (!fn) { noteMiss(`function ${name} ${JSON.stringify(body).slice(0, 120)}`); return json(200, { ok: true }); }
      const out = await fn(body, req);
      if (out instanceof Response) return out;
      return json(200, out === undefined ? { ok: true } : out);
    }

    noteMiss(`unrouted ${method} ${path}`);
    return json(404, { message: 'not found in demo' });
  } catch (err) {
    console.error('[demo] handler error', method, path, err);
    return json(500, { message: err instanceof Error ? err.message : String(err) });
  }
}

let installed = false;

export function installDemo(storageKey: string) {
  if (installed) return;
  installed = true;
  seedSession(storageKey);

  const original = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (href.startsWith(DEMO_API_BASE) || /^https?:\/\/[^/]*supabase\.co\//.test(href)) return demoFetch(input, init);
    return original(input, init);
  };

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/demo-sw.js').catch(() => { /* images still load via the rewrite */ });

  const reset = async () => {
    resetDb();
    try { await clearUploads(); } catch { /* ignore */ }
    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith('sb-') || k === 'sm-demo-signed-out' || k.startsWith('m3_')) localStorage.removeItem(k);
    } catch { /* ignore */ }
    window.location.href = '/account?tab=event';
  };

  // Hidden on purpose so it never appears on camera: Ctrl+Shift+D, or ?demo-reset=1.
  window.addEventListener('keydown', e => {
    if (e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
      if (window.confirm('Reset the demo data to its starting state?')) reset();
    }
  });
  if (new URLSearchParams(window.location.search).has('demo-reset')) reset();

  (window as any).__demo = { misses, reset };
}
