import { supabase } from '@/lib/supabase';

/**
 * Tell the database that this session was opened from an e-mailed link
 * (database function mark_email_proven, migration 20261009210000_registration_core).
 *
 * Called by /welcome and /reset-password once the person has SAVED A NEW
 * PASSWORD from the link's session, never as soon as the link opens: until then
 * the account's password may be someone else's (anyone can create an account
 * with another person's address while "Confirm email" is off), and the proof
 * would hand that person the registrations sent to that address. Saving a new
 * password ends the account's other sessions (GoTrue, and the pages also sign
 * the others out), so only the mailbox owner keeps the account. This is the
 * ONLY way an address becomes proven: no auth trigger proves anything.
 *
 * The database decides on its own whether the session proves the address (a
 * link session less than 60 minutes old, after the last e-mail change, not an
 * admin "view as user"); a password session proves nothing. Once proven, the
 * registrations sent to that address join the account, and on-site
 * registrations waiting for that proof are provisioned again. A link session
 * too old to count is noted for staff in review_log (action
 * 'email_proof_late'): they tell the person to use "Forgot password?" again.
 * The page itself says nothing about it: the password is saved either way.
 *
 * Never throws and never takes more than a few seconds: await it before a
 * sign-out (the call needs the session), or call it with `void`. Before the
 * migration is applied the function does not exist yet, and the call simply
 * fails quietly.
 */
export async function markEmailProven(): Promise<void> {
  try {
    const call = supabase.rpc('mark_email_proven').then(({ data, error }) => {
      if (error) {
        if (import.meta.env.DEV) console.warn('mark_email_proven:', error.message);
        return;
      }
      // Not proven (link_session_too_old, email_changed_since...): a short, personal-data-free
      // line for whoever helps the person; staff also see the late case in review_log.
      const out = data as { proven?: boolean; reason?: string } | null;
      if (out && out.proven === false && out.reason) console.info('mark_email_proven: not proven:', out.reason);
    });
    await Promise.race([call, new Promise<void>((resolve) => window.setTimeout(resolve, 4000))]);
  } catch {
    /* Not reachable or not installed yet: nothing to do. */
  }
}
