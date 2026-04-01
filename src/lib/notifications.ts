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
  | 'rfp_closed'
  | 'consultation_submitted'
  | 'consultation_closed'
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
  | 'bypass_approved'
  | 'bypass_rejected'
  | 'event_registration_confirmed'
  | 'admin_new_submission'
  | 'payment_confirmed'
  | 'payment_failed'
  | 'membership_payment_received';

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
 * Notify admin team about a new submission (generic).
 * Sends to a hardcoded admin email — the edge function also supports user_id lookup.
 */
export async function notifyAdmin(submissionType: string, submitter: string, details?: string): Promise<void> {
  await sendNotification({
    type: 'admin_new_submission',
    email: 'info@m3monaco.com',
    data: {
      submission_type: submissionType,
      submitter,
      details: details || '',
    },
  });
}
