// In-memory fake database, persisted to localStorage so a designer who reloads
// mid-take keeps what they did. Bump SEED_VERSION whenever the fixtures change,
// or browsers that already opened the demo keep showing the old data.
export type Row = Record<string, any>;
export type Db = Record<string, Row[]>;

const SEED_VERSION = 1;
const KEY = `sm-demo-db-v${SEED_VERSION}`;

let seedFn: (() => Db) | null = null;
let db: Db | null = null;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

export function registerSeed(fn: () => Db) {
  seedFn = fn;
}

function freshSeed(): Db {
  if (!seedFn) throw new Error('[demo] no seed registered');
  // Deep copy so resets never share references with the fixture module.
  return JSON.parse(JSON.stringify(seedFn()));
}

export function getDb(): Db {
  if (db) return db;
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) db = JSON.parse(saved) as Db;
  } catch { /* private window or quota: fall back to the seed */ }
  if (!db) db = freshSeed();
  return db;
}

export function table(name: string): Row[] {
  const d = getDb();
  if (!d[name]) d[name] = [];
  return d[name];
}

export function persist() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* ignore quota */ }
  }, 60);
}

export function resetDb() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('sm-demo-db-')) localStorage.removeItem(k);
  } catch { /* ignore */ }
  db = freshSeed();
  persist();
}

export const uuid = (): string =>
  (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });

export const nowIso = () => new Date().toISOString();
