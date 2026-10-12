import type { PersonaType } from '@/types/database';

/**
 * Opens the sign-up window (the Navbar's dialog) from anywhere on the page, so
 * a "Sign up" button signs up in one click instead of sending people to the
 * presentation page (/join) first. An optional persona skips the first step
 * ("Sign up as a marina").
 *
 * The Navbar listens for this event; ?signup=true in the address (e-mailed
 * claim links) still opens the same dialog.
 */
export const OPEN_SIGNUP_EVENT = 'smc:open-signup';

export interface OpenSignupDetail {
  persona?: PersonaType;
  /**
   * Where to continue once the account exists (a path on this site, e.g. /register/<slug>):
   * the sign-up v2 carries it (flag account_signup_v2). The Navbar uses the current
   * page when it is an event's registration and nothing is given.
   */
  then?: string;
}

export function openSignup(persona?: PersonaType, options: { then?: string } = {}): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<OpenSignupDetail>(OPEN_SIGNUP_EVENT, { detail: { persona, then: options.then } }));
}

/** The sign-up page (flag front_door). The presentation page stays /join (Victor, 8 Oct 2026). */
export const SIGNUP_PATH = '/signup';

/**
 * The address the sign-in window starts with after /reset-password signs a person
 * out and opens /?signin=true: kept in this tab's sessionStorage (never in the URL),
 * read once and removed by the Navbar.
 */
export const SIGNIN_EMAIL_KEY = 'smc_signin_email';
