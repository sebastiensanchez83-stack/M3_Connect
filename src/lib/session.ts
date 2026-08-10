import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';

// Guards logged-in writes against a silently-expired session.
//
// A tab left idle for a long time keeps the user object in memory (AuthContext
// restored it from the stored session), but the underlying JWT can expire. A
// direct PostgREST write then arrives with no valid token, auth.uid() resolves
// to null, and every RLS policy that depends on it (user_id = auth.uid(),
// is_org_member(), SECURITY DEFINER functions reading auth.uid(), …) fails —
// surfacing to the user as the cryptic "new row violates row-level security
// policy" error. Call one of these at the top of a save handler so the write
// runs with a guaranteed-fresh token.
//
// The first version of this guard asked the auth server on every single save
// (`supabase.auth.getUser()` is a network round-trip) and treated any failure
// as an expired session. Two participants with perfectly healthy sessions were
// told to sign in again and could not register: a moment of bad connectivity
// looked exactly like a dead token. So the check now reads the stored session
// FIRST — no network, no failure mode — and only goes to the server when the
// token really has expired. And when it cannot reach the server it says so,
// instead of accusing the user of being signed out.

export type SessionState =
  | { ok: true; userId: string }
  /** Genuinely signed out, or the refresh token was rejected. */
  | { ok: false; reason: 'signed_out' }
  /** A valid-looking session we could not confirm — almost always the network. */
  | { ok: false; reason: 'unreachable' };

/** Seconds of headroom, so a token that dies mid-request never slips through. */
const SKEW = 60;

export async function checkSession(): Promise<SessionState> {
  let session = null;
  try {
    session = (await supabase.auth.getSession()).data.session;
  } catch {
    return { ok: false, reason: 'unreachable' };
  }
  if (!session?.user?.id) return { ok: false, reason: 'signed_out' };

  const now = Math.floor(Date.now() / 1000);
  if ((session.expires_at ?? 0) - now > SKEW) return { ok: true, userId: session.user.id };

  // Expired, or about to be. This is the only case that needs the network.
  try {
    const { data, error } = await supabase.auth.refreshSession();
    if (data.session?.user?.id) return { ok: true, userId: data.session.user.id };
    // A refresh token the server actively rejects is a real sign-out. Anything
    // else — offline, DNS, proxy, a 5xx — is not the user's fault and telling
    // them to sign in again would be a lie.
    const status = (error as { status?: number } | null)?.status ?? 0;
    return { ok: false, reason: status >= 400 && status < 500 ? 'signed_out' : 'unreachable' };
  } catch {
    return { ok: false, reason: 'unreachable' };
  }
}

/**
 * Return the current authenticated user id, refreshing an expired access token
 * first. Returns null only when the write genuinely cannot succeed. Never throws.
 */
export async function getFreshUserId(): Promise<string | null> {
  const s = await checkSession();
  return s.ok ? s.userId : null;
}

/** Standard toast, worded for what actually went wrong. */
export function toastSessionProblem(reason: 'signed_out' | 'unreachable'): void {
  toast(reason === 'signed_out'
    ? {
        title: 'Your session has expired',
        description: 'Please sign in again, then try once more.',
        variant: 'destructive',
      }
    : {
        title: 'No connection to the server',
        description: 'Check your internet connection and try again — nothing was lost.',
        variant: 'destructive',
      });
}

/** Kept for callers that only care that something went wrong. */
export function toastSessionExpired(): void {
  toastSessionProblem('signed_out');
}

/**
 * Convenience wrapper: returns a fresh user id, or shows the right toast and
 * returns null. Use at the top of a logged-in save handler:
 *
 *   const uid = await requireFreshSession();
 *   if (!uid) return;
 */
export async function requireFreshSession(): Promise<string | null> {
  const s = await checkSession();
  if (!s.ok) { toastSessionProblem(s.reason); return null; }
  return s.userId;
}
