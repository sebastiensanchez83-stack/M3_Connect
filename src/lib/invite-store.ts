/**
 * Invite token persistence via localStorage.
 * Captures ?invite=<id> from URL and persists through signup/email-confirm redirects.
 */

const STORAGE_KEY = 'm3_pending_invite';

/** Save invite ID to localStorage (called on any page load with ?invite= param) */
export function captureInviteFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  const inviteId = params.get('invite');
  if (inviteId) {
    localStorage.setItem(STORAGE_KEY, inviteId);
    // Clean up URL without reload
    params.delete('invite');
    const newUrl = params.toString()
      ? `${window.location.pathname}?${params.toString()}`
      : window.location.pathname;
    window.history.replaceState({}, '', newUrl);
  }
  return inviteId || localStorage.getItem(STORAGE_KEY);
}

/** Get stored invite ID (if any) */
export function getStoredInvite(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

/** Clear stored invite (after successful acceptance) */
export function clearStoredInvite(): void {
  localStorage.removeItem(STORAGE_KEY);
}
