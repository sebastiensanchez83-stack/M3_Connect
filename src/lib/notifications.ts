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
 */
export async function sendNotification({ type, userId, email, data }: SendNotificationParams): Promise<void> {
  try {
    // Edge function uses verify_jwt: false with internal apikey check
    // supabase-js automatically sends the anon key as apikey header
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

/**
 * Notify the admin team about a new submission.
 * Calls the `notify-admins` edge function which fans out to every admin user
 * in the profiles table (persona = 'admin') plus the generic contact inbox.
 */
export async function notifyAdmin(submissionType: string, submitter: string, details?: string): Promise<void> {
  try {
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
