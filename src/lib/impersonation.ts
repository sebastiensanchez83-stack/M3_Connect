import { supabase } from '@/lib/supabase';

// Admin "View as user" (b2match-style). An admin swaps their browser session for
// the target user's real session so they see and do exactly what that user can.
// The admin's own session tokens are stashed in localStorage so the swap is fully
// reversible with one click. A visible banner (ImpersonationBanner) reads the same
// key and stays up for the whole impersonation. All swaps are server-gated
// (persona=admin, target not staff) and audited in admin_impersonation_log.

const KEY = 'sm_impersonation';

export interface ImpersonationState {
  target_name: string;
  target_email: string;
  admin_access_token: string;
  admin_refresh_token: string;
  started_at: number;
}

export function getImpersonation(): ImpersonationState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as ImpersonationState;
    if (!s?.admin_refresh_token || !s?.target_email) return null;
    return s;
  } catch {
    return null;
  }
}

export function isImpersonating(): boolean {
  return getImpersonation() !== null;
}

// Pull a human-readable error out of a functions.invoke failure (the body JSON,
// when present, carries our { error } message; fall back to the raw message).
async function readInvokeError(error: unknown): Promise<string> {
  try {
    const ctx = (error as { context?: Response })?.context;
    if (ctx && typeof ctx.json === 'function') {
      const body = await ctx.json();
      if (body?.error) return body.error;
    }
  } catch { /* ignore */ }
  return (error as { message?: string })?.message || 'Could not start impersonation';
}

/**
 * Begin impersonating a target user. Stashes the admin session, mints and applies
 * the target's session, then hard-navigates so AuthContext re-initialises cleanly
 * as the target. Throws (with a readable message) if the swap is refused.
 */
export async function startImpersonation(targetUserId: string): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token || !session?.refresh_token) {
    throw new Error('Your admin session has expired — please sign in again.');
  }

  const { data, error } = await supabase.functions.invoke('admin-impersonate', {
    body: { target_user_id: targetUserId },
  });
  if (error) throw new Error(await readInvokeError(error));
  if (!data?.ok || !data?.access_token || !data?.refresh_token) {
    throw new Error(data?.error || 'Could not start impersonation');
  }

  // Stash the admin session BEFORE swapping — setSession overwrites the shared
  // auth-token storage key, so this is the only copy we can restore from.
  localStorage.setItem(KEY, JSON.stringify({
    target_name: data.target?.name || data.target?.email || 'user',
    target_email: data.target?.email || '',
    admin_access_token: session.access_token,
    admin_refresh_token: session.refresh_token,
    started_at: Date.now(),
  } satisfies ImpersonationState));

  const { error: setErr } = await supabase.auth.setSession({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
  });
  if (setErr) {
    localStorage.removeItem(KEY);
    throw new Error('Could not apply the target session — ' + setErr.message);
  }

  // Full reload so the whole app (AuthContext, guards, data) reloads as the target.
  window.location.assign('/account?tab=dashboard');
}

/**
 * End impersonation and restore the admin session. Safe to call even if the flag
 * is already gone (no-op). Hard-navigates back to the admin console.
 */
export async function stopImpersonation(returnTo = '/admin/sm26'): Promise<void> {
  const s = getImpersonation();
  // Clear the flag first so a mid-restore reload can't leave the banner stuck up.
  localStorage.removeItem(KEY);
  if (!s) {
    window.location.assign(returnTo);
    return;
  }
  try {
    await supabase.auth.setSession({
      access_token: s.admin_access_token,
      refresh_token: s.admin_refresh_token,
    });
  } catch {
    // If the stashed admin session can't be restored, fall through to a clean
    // sign-out so the browser isn't left on the target's session.
    await supabase.auth.signOut().catch(() => {});
    window.location.assign('/');
    return;
  }
  window.location.assign(returnTo);
}
