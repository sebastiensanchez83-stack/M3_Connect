import { safeNext } from '@/lib/safeNext';

/**
 * Where a signed-in member lands when nothing else is asked for: the home page,
 * which shows them "Welcome back" and their dashboard (/dashboard is an old
 * address of it).
 */
export const MEMBER_HOME = '/';

/**
 * Where a signed-out visitor was heading when a protected page (/inbox,
 * /account?tab=…, /dashboard, …) showed the sign-in form in place: the current
 * address, as a path on this site, or null for the default (MEMBER_HOME).
 *
 * It goes into the `?next=` of the e-mailed sign-in and password-reset links
 * (LoginForm), which /welcome and /reset-password already read through
 * safeNext. A password sign-in needs no hop: the form is on the page itself, so
 * once the session exists the page renders where it stands.
 *
 * What a confirmation link or GoTrue appended to the address (email_confirmed,
 * code, error…) is left out. The bare home page and the old /dashboard are the
 * default anyway, and /welcome and /reset-password are never a destination; the
 * home page with one of its blocks open (/?open=inbox) is a real one.
 */
const AUTH_PARAMS = ['email_confirmed', 'code', 'error', 'error_code', 'error_description'];

export function signInDestination(): string | null {
  if (typeof window === 'undefined') return null;
  const url = new URL(window.location.href);
  for (const key of AUTH_PARAMS) url.searchParams.delete(key);
  const path = url.pathname.toLowerCase().replace(/\/+$/, '') || '/';
  if (path === '/dashboard') return null;
  if (path === '/' && url.searchParams.has('open')) return safeNext(`/${url.search}`);
  return safeNext(`${url.pathname}${url.search}`, { deny: ['/', '/welcome', '/reset-password'] });
}
