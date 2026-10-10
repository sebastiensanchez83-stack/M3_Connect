import { supabase } from '@/lib/supabase';

/**
 * Tell the database that this session was opened from an e-mailed link
 * (database function mark_email_proven, migration 20261009210000_registration_core).
 *
 * Called by /welcome and /reset-password once the person has SAVED A NEW
 * PASSWORD from the link's session, never as soon as the link opens: until then
 * the account's password may be someone else's (anyone can create an account
 * with another person's address while "Confirm email" is off), and the proof
 * would hand that person the registrations sent to the address. Saving a new
 * password ends the account's other sessions (GoTrue, and the pages also sign
 * the others out), so only the mailbox owner keeps the account.
 *
 * The database decides on its own whether the session proves the address (a
 * link session less than 15 minutes old, after the last e-mail change, not an
 * admin "view as user"); a password session proves nothing. Once proven, the
 * registrations sent to that address join the account, and on-site
 * registrations waiting for that proof are provisioned again.
 *
 * Never throws and never takes more than a few seconds: await it before a
 * sign-out (the call needs the session), or call it with `void`. Before the
 * migration is applied the function does not exist yet, and the call simply
 * fails quietly.
 */
export async function markEmailProven(): Promise<void> {
  try {
    const call = supabase.rpc('mark_email_proven').then(({ error }) => {
      if (error && import.meta.env.DEV) console.warn('mark_email_proven:', error.message);
    });
    await Promise.race([call, new Promise<void>((resolve) => window.setTimeout(resolve, 4000))]);
  } catch {
    /* Not reachable or not installed yet: nothing to do. */
  }
}
