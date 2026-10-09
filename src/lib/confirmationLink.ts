/**
 * Where a sign-up confirmation link lands: always /welcome, with the real
 * destination in ?next=.
 *
 * Why (pre-registration takeover): anyone can sign up with someone else's
 * address and a password of their choosing. Once "Confirm email" is ON, the
 * real owner of the mailbox gets the activation e-mail; if their click only
 * confirmed the address, the stranger's password would keep working on the
 * now-confirmed account. Through /welcome, a type=signup link always ends with
 * the forced "Choose your password" step (WelcomePage, pw_pending reason
 * "signup"), so only the mailbox owner's password is left. Someone who signed up
 * themselves simply types the password they chose again.
 *
 * This is only the app's own request. The guarantee is on the server: the
 * send-email hook (signupConfirmLink) builds every sign-up activation link on
 * /welcome whatever redirect the caller asked for, since a stranger can call the
 * Auth API directly or use the old site. It hands /welcome the token_hash itself
 * (any device, safe from mail scanners). With "Confirm email" OFF no confirmation
 * e-mail is sent and nothing changes.
 *
 * Idempotent: a URL already on /welcome is returned as it is. Only a URL on this
 * site is wrapped; anything else is returned unchanged.
 */
export function throughWelcome(url: string): string {
  if (typeof window === 'undefined') return url;
  try {
    const origin = window.location.origin;
    const target = new URL(url, origin);
    if (target.origin !== origin) return url;
    if ((target.pathname.replace(/\/+$/, '') || '/') === '/welcome') return target.toString();
    const welcome = new URL('/welcome', origin);
    welcome.searchParams.set('next', `${target.pathname}${target.search}`);
    return welcome.toString();
  } catch {
    return url;
  }
}
