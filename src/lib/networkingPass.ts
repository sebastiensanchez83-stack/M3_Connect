// The SM26 networking pass a guest (no account) created on this phone. The
// server token is the identity; name and company are kept only to show under
// the QR. Clearing storage loses this phone's copy, never the connections.

export interface StoredPass { v: 1; token: string; name: string; company: string | null }

const KEY = 'sm26-networking-pass';
const TOKEN_RE = /^[0-9a-f]{32}$/;

export function readStoredPass(): StoredPass | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<StoredPass>;
    return p && p.v === 1 && typeof p.token === 'string' && TOKEN_RE.test(p.token) && typeof p.name === 'string'
      ? { v: 1, token: p.token, name: p.name, company: typeof p.company === 'string' ? p.company : null }
      : null;
  } catch { return null; }
}

export function storePass(p: { token: string; name: string; company: string | null }) {
  try { localStorage.setItem(KEY, JSON.stringify({ v: 1, ...p })); } catch { /* private mode: they retype next time */ }
}

export function clearStoredPass() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

// Shown on a phone screen, so the current origin is right (production in
// production). Printed exhibitor codes are generated against production directly.
export const connectUrl = (token: string) => `${window.location.origin}/sm26/connect?c=${token}`;
