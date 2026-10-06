/**
 * Centralized notification helper — fire-and-forget email notifications
 * via the `send-notification` Supabase Edge Function.
 */
import { supabase } from '@/lib/supabase';

export type NotificationType =
  | 'webinar_accepted'
  | 'webinar_rejected'
  | 'webinar_moderator_approved'
  | 'rfp_submitted'
  | 'rfp_approved'
  | 'rfp_rejected'
  | 'rfp_closed'
  | 'consultation_submitted'
  | 'consultation_approved'
  | 'consultation_rejected'
  | 'consultation_closed'
  | 'project_rejected'
  | 'project_status_updated'
  | 'exposition_approved'
  | 'exposition_invoice_sent'
  | 'exposition_paid'
  | 'exposition_rejected'
  | 'sponsorship_invoice_sent'
  | 'sponsorship_paid'
  | 'sponsorship_approved'
  | 'sponsorship_rejected'
  | 'partner_request_received'
  | 'partner_request_accepted'
  | 'partner_request_rejected'
  | 'reference_confirmed'
  | 'reference_rejected'
  | 'event_registration_confirmed'
  | 'admin_new_submission'
  | 'payment_confirmed'
  | 'payment_failed'
  | 'membership_payment_received'
  | 'team_invitation'
  | 'team_invitation_reminder'
  | 'join_request_received'
  | 'join_request_approved'
  | 'join_request_rejected'
  | 'user_account_approved'
  | 'user_account_rejected'
  | 'org_claim_code'
  | 'partner_onboarding_welcome';

interface SendNotificationParams {
  type: NotificationType;
  /** Target user ID — edge function resolves email from profiles table */
  userId?: string;
  /** Direct email address (alternative to userId) */
  email?: string;
  /** Extra data passed to the email template */
  data?: Record<string, string>;
}

/**
 * Send an email notification via the send-notification edge function.
 * This is fire-and-forget: errors are logged but never thrown.
 *
 * supabase.functions.invoke sends the signed-in user's access token. The edge
 * function (verify_jwt false, it checks the caller itself) lets a verified
 * admin/moderator send any type to anyone; any other member only the e-mails
 * the app sends on their behalf, with the recipient checked against the row
 * that justifies it (partner request, join request, invitation, or the caller
 * themself). Call it right after writing that row.
 */
export async function sendNotification({ type, userId, email, data }: SendNotificationParams): Promise<void> {
  try {
    await supabase.functions.invoke('send-notification', {
      body: {
        type,
        user_id: userId,
        email,
        data,
      },
    });
  } catch {
    // Fire-and-forget: swallow all errors silently in production
  }
}

/** The address of a new sign-up, from the "Email: ..." line AuthContext puts in `details`. */
function signupEmailFrom(details?: string): string | null {
  const m = /^Email:\s*(\S+@\S+)\s*$/m.exec(details || '');
  return m ? m[1].trim() : null;
}

/**
 * Tell the admin team about a brand-new sign-up. Works without a session: only
 * the address is sent, notify-admins reads everything else from the account
 * created in the last 30 minutes and alerts once per account.
 */
export async function notifyAdminsOfSignup(email: string): Promise<void> {
  try {
    const signupEmail = email.trim();
    if (!signupEmail) return;
    await supabase.functions.invoke('notify-admins', {
      body: { signup_email: signupEmail },
    });
  } catch {
    // Fire-and-forget: swallow all errors silently in production
  }
}

/**
 * Notify the admin team about a new submission.
 * Calls the `notify-admins` edge function which fans out to every verified
 * admin plus the generic contact inbox.
 *
 * - 'new user signup' (AuthContext.signUp) runs before any session exists, so
 *   only the new address is sent; notify-admins builds the alert itself from
 *   the account that was just created. The other arguments are not sent.
 * - Every other submission type needs a signed-in member; the edge function
 *   caps the text and adds the sender's sign-in address.
 */
export async function notifyAdmin(submissionType: string, submitter: string, details?: string): Promise<void> {
  try {
    if (submissionType.trim().toLowerCase() === 'new user signup') {
      const signupEmail = signupEmailFrom(details);
      if (signupEmail) await notifyAdminsOfSignup(signupEmail);
      return;
    }
    await supabase.functions.invoke('notify-admins', {
      body: {
        submission_type: submissionType,
        submitter,
        details: details || '',
        include_contact_inbox: true,
      },
    });
  } catch {
    // Fire-and-forget: swallow all errors silently in production
  }
}
