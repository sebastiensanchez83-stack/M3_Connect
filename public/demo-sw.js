// Demo site only. Serves images for the fake Supabase Storage: files uploaded
// during a take come from IndexedDB, everything else from /demo-assets.
const DB_NAME = 'sm-demo-uploads';
const STORE = 'files';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

function getUpload(key) {
  return new Promise((resolve) => {
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onerror = () => resolve(undefined);
    open.onsuccess = () => {
      try {
        const r = open.result.transaction(STORE, 'readonly').objectStore(STORE).get(key);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => resolve(undefined);
      } catch (_) { resolve(undefined); }
    };
  });
}

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  const m = url.pathname.match(/^\/__demo\/storage\/v1\/object\/(?:public|sign|authenticated)\/(.+)$/);
  if (!m) return;
  const key = decodeURIComponent(m[1]);
  e.respondWith(getUpload(key).then((blob) => (blob ? new Response(blob) : fetch('/demo-assets/' + m[1]))));
});
