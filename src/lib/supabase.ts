/// <reference types="vite/client" />

import { createClient, AuthChangeEvent, Session } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    detectSessionInUrl: true,
    persistSession: true,
    autoRefreshToken: true,
    flowType: 'pkce',
    // Storage key for the session — clearing this key logs the user out
    storageKey: `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`,
  },
});

// ─── Module-level auth subscription ─────────────────────────────────
//
// WHY: Supabase's gotrue-js uses the Web Locks API (navigator.locks)
// to coordinate token refresh across tabs. The lock is acquired when
// onAuthStateChange() is called and held internally.
//
// React StrictMode (dev) causes effects to run mount→unmount→remount.
// If onAuthStateChange() is called inside useEffect, the first mount
// acquires the lock, the simulated unmount calls subscription.unsubscribe()
// but does NOT release the internal Web Lock, and the second mount's
// onAuthStateChange() call tries to acquire the same lock → DEADLOCK.
// No Supabase API requests ever fire. The app is stuck permanently.
//
// FIX: Call onAuthStateChange() ONCE at module load time. The auth
// subscription is never torn down and re-created. React components
// register/unregister a callback via setAuthListener(). Events that
// arrive before any listener is registered are buffered and replayed.
// ─────────────────────────────────────────────────────────────────────

type AuthEventCallback = (event: AuthChangeEvent, session: Session | null) => void;

let _authListener: AuthEventCallback | null = null;
const _bufferedEvents: Array<{ event: AuthChangeEvent; session: Session | null }> = [];

// Single global subscription — never torn down
supabase.auth.onAuthStateChange((event, session) => {
  if (_authListener) {
    _authListener(event, session);
  } else {
    // Buffer events until a listener is registered (typically INITIAL_SESSION)
    _bufferedEvents.push({ event, session });
  }
});

/**
 * Register the auth event listener. Replays any buffered events
 * (usually INITIAL_SESSION that fired before React mounted).
 *
 * Only ONE listener at a time — owned by AuthContext.
 *
 * @returns cleanup function that removes the listener
 */
export function setAuthListener(callback: AuthEventCallback): () => void {
  _authListener = callback;

  // Replay buffered events (INITIAL_SESSION usually fires before
  // the React tree mounts, so it will be buffered here)
  if (_bufferedEvents.length > 0) {
    const buffered = [..._bufferedEvents];
    _bufferedEvents.length = 0;
    // Use queueMicrotask so the listener is fully registered before
    // events are replayed (avoids issues with setState during render)
    queueMicrotask(() => {
      for (const { event, session } of buffered) {
        if (_authListener === callback) {
          callback(event, session);
        }
      }
    });
  }

  return () => {
    if (_authListener === callback) {
      _authListener = null;
    }
  };
}
