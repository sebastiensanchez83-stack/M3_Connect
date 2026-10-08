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
}

export function openSignup(persona?: PersonaType): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<OpenSignupDetail>(OPEN_SIGNUP_EVENT, { detail: { persona } }));
}
