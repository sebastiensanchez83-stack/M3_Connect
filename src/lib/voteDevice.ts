// The SM26 audience vote has no accounts: a phone is identified by a random key
// kept in its own storage, and the server binds that phone to the first name
// that votes on it. Clearing storage loses the key, not the votes (they stay
// bound to the name).

const DEVICE_KEY = 'sm26-vote-device';
const NAME_KEY = 'sm26-vote-name';

let memoryDevice: string | null = null;

function randomHex(bytes: number): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
}

export function getVoteDevice(): string {
  try {
    const existing = localStorage.getItem(DEVICE_KEY);
    if (existing && /^[0-9a-f]{32,64}$/.test(existing)) return existing;
    const fresh = randomHex(16);
    localStorage.setItem(DEVICE_KEY, fresh);
    return fresh;
  } catch {
    // Private mode: one key for this page load.
    memoryDevice = memoryDevice || randomHex(16);
    return memoryDevice;
  }
}

export function readVoteName(): { first: string; last: string } {
  try {
    const raw = localStorage.getItem(NAME_KEY);
    const p = raw ? JSON.parse(raw) as { first?: unknown; last?: unknown } : null;
    return { first: typeof p?.first === 'string' ? p.first : '', last: typeof p?.last === 'string' ? p.last : '' };
  } catch { return { first: '', last: '' }; }
}

export function storeVoteName(first: string, last: string) {
  try { localStorage.setItem(NAME_KEY, JSON.stringify({ first, last })); } catch { /* ignore */ }
}
