// Files a designer uploads during a take live in IndexedDB, shared with the
// service worker (public/demo-sw.js) which serves them back as images.
const DB_NAME = 'sm-demo-uploads';
const STORE = 'files';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const r = fn(db.transaction(STORE, mode).objectStore(STORE));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export const putUpload = (key: string, blob: Blob) => tx('readwrite', s => s.put(blob, key));
export const getUpload = (key: string) => tx<Blob | undefined>('readonly', s => s.get(key) as IDBRequest<Blob | undefined>);
export const deleteUpload = (key: string) => tx('readwrite', s => s.delete(key));
export const listUploadKeys = () => tx<IDBValidKey[]>('readonly', s => s.getAllKeys());
export const clearUploads = () => tx('readwrite', s => s.clear());
