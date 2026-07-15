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
// runs with a guaranteed-fresh token, or the user is told to sign in again.

/**
 * Return the current authenticated user id, transparently refreshing an expired
 * access token first. Returns null only if the session genuinely can't be
 * recovered (the caller should then prompt a re-login rather than attempt a
 * doomed write). Never throws.
 */
export async function getFreshUserId(): Promise<string | null> {
  try {
    let id = (await supabase.auth.getUser()).data.user?.id ?? null;
    if (!id) id = (await supabase.auth.refreshSession()).data.user?.id ?? null;
    return id;
  } catch {
    return null;
  }
}

/** Standard toast shown when the session can't be recovered. */
export function toastSessionExpired(): void {
  toast({
    title: 'Your session has expired',
    description: 'Please sign in again, then try once more.',
    variant: 'destructive',
  });
}

/**
 * Convenience wrapper: returns a fresh user id, or shows the standard
 * session-expired toast and returns null. Use at the top of a logged-in save
 * handler:
 *
 *   const uid = await requireFreshSession();
 *   if (!uid) return;
 */
export async function requireFreshSession(): Promise<string | null> {
  const id = await getFreshUserId();
  if (!id) toastSessionExpired();
  return id;
}
