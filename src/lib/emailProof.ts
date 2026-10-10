import { supabase } from '@/lib/supabase';

/**
 * Tell the database that this session was opened from an e-mailed link
 * (database function mark_email_proven, migration 20261009210000_registration_core).
 *
 * Called by /welcome and /reset-password as soon as the link's session is in
 * place, before the person types anything. The database decides on its own
 * whether the session proves the address (a link session less than 15 minutes
 * old, after the last e-mail change, not an admin "view as user"); a password
 * session proves nothing. Once proven, the registrations sent to that address
 * join the account, and on-site registrations waiting for that proof are
 * provisioned again.
 *
 * Fire and forget: it never blocks or breaks the page. Before the migration is
 * applied the function does not exist yet, and the call simply fails quietly.
 */
export function markEmailProven(): void {
  void (async () => {
    try {
      const { error } = await supabase.rpc('mark_email_proven');
      if (error && import.meta.env.DEV) console.warn('mark_email_proven:', error.message);
    } catch {
      /* Not reachable or not installed yet: nothing to do. */
    }
  })();
}
