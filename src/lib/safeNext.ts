/**
 * Where to send someone after an e-mailed link (`?next=` on /welcome and
 * /reset-password): a path on this site, or null.
 *
 * `next` sits in URLs anyone can craft and mail out, so it must never take a
 * browser off-site. Resolving it against our origin and comparing origins is
 * not enough on its own: '/.//evil.com' and '/..//evil.com' resolve to OUR
 * origin with the pathname '//evil.com', which the browser then reads as a
 * protocol-relative URL to another site. So both what comes in and what goes
 * out are checked:
 *  - no control characters (the URL parser silently drops tabs and newlines,
 *    which can hide a '//') and no backslash anywhere (browsers read '\' as '/'
 *    in http(s) URLs, so '/\evil.com' is '//evil.com');
 *  - the input is a path starting with exactly one '/', or an absolute URL on
 *    this origin (GoTrue can hand one back);
 *  - the resolved path + query + hash starts with exactly one '/' and resolves
 *    back to this origin unchanged.
 *
 * `deny` lists destinations to refuse, typically the page doing the redirect.
 * They are compared the way React Router matches a route: case-insensitive,
 * trailing slash ignored, percent-decoded.
 */

export interface SafeNextOptions {
  deny?: readonly string[];
}

const MAX_LENGTH = 2048;

// C0 and C1 control characters (tab, CR and LF included), and every backslash.
const FORBIDDEN = /[\u0000-\u001f\u007f-\u009f\\]/;

/** Exactly one leading '/': not '//' (another host) and not '/\' (the same, to a browser). */
const isRootedPath = (s: string) => s.startsWith('/') && !s.startsWith('//') && !s.startsWith('/\\');

function routeKey(pathname: string): string {
  let p = pathname;
  try {
    p = decodeURIComponent(p);
  } catch {
    /* a malformed escape: compare it as it is */
  }
  return p.toLowerCase().replace(/\/+$/, '') || '/';
}

export function safeNext(raw: string | null | undefined, { deny = [] }: SafeNextOptions = {}): string | null {
  if (typeof window === 'undefined') return null;
  if (typeof raw !== 'string' || !raw || raw.length > MAX_LENGTH) return null;
  if (FORBIDDEN.test(raw)) return null;

  const origin = window.location.origin;
  // A path on this site, or an absolute URL on this origin: never a
  // scheme-relative '//host', a 'javascript:' URL or a bare 'evil.com'.
  if (!isRootedPath(raw) && !raw.toLowerCase().startsWith(`${origin.toLowerCase()}/`)) return null;

  let target: URL;
  try {
    target = new URL(raw, origin);
  } catch {
    return null;
  }
  if (target.origin !== origin || target.username || target.password) return null;

  // Dot segments are resolved by now: this is where '/.//evil.com' shows up as '//evil.com'.
  const path = `${target.pathname}${target.search}${target.hash}`;
  if (!isRootedPath(path) || FORBIDDEN.test(path)) return null;

  // What is handed back must mean the same thing when the browser or the router resolves it again.
  let again: URL;
  try {
    again = new URL(path, origin);
  } catch {
    return null;
  }
  if (again.origin !== origin || `${again.pathname}${again.search}${again.hash}` !== path) return null;

  const key = routeKey(target.pathname);
  if (deny.some((d) => routeKey(d) === key)) return null;

  return path;
}
