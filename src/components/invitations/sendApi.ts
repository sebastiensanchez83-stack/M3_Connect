import { supabase } from '@/lib/supabase';

/* ─── Invitation campaigns: the sender (edge function "invitation-campaign") ───
 *
 * The contract between the admin screens and supabase/functions/invitation-campaign
 * (POST with the signed-in staff member's JWT; verify_jwt true; is_moderator() checked).
 * The e-mail itself is built by render.ts, shared with the function, so the admin preview
 * shows exactly what the guest receives.
 *
 * Order for one wave: generate the PDFs in the browser and upload them to the private bucket
 * invitation-files as <campaign id>/<recipient id>/ticket.pdf and letter.pdf; "test" to
 * yourself; "preview_send" for the confirmation screen; then "send" 10 guests at a time
 * (call again with "remaining" until it is empty). A guest already sent is never sent again
 * by "send"; "resend" is the explicit action.
 */

export {
  renderInvitationEmail,
  invitationAttachmentNames,
  invitationSender,
  invitationVariables,
  INVITATION_EMAIL_VARIABLES,
  INVITATION_JOIN_LINE_DEFAULT,
  INVITATION_DEFAULT_SENDER_EMAIL,
  INVITATION_DEFAULT_REPLY_TO,
} from '../../../supabase/functions/invitation-campaign/render.ts';

export const INVITATION_SEND_BATCH = 10;

/** Codes a guest can come back with (results of send / resend, states of preview_send). */
export type InvitationSendCode =
  // nothing done
  | 'already_sent' | 'in_progress' | 'in_progress_or_sent' | 'not_found' | 'needs_explicit_resend' | 'not_sent_yet'
  // blocked before anything was written
  | 'no_email' | 'missing_name' | 'missing_pdfs' | 'too_large' | 'empty_email' | 'unresolved_variables'
  | 'duplicate_email' | 'guest_linked_elsewhere' | 'pending_request' | 'already_on_list' | 'not_adoptable' | 'capacity'
  | 'campaign_archived' | 'engine_not_supported' | 'bad_status' | 'no_request' | 'not_pending_request'
  | `guest_${string}`
  // the send itself
  | 'sender_domain_not_verified' | 'send_uncertain' | 'sent_not_recorded' | 'resend_unreachable' | `resend_${number}` | 'error';

/** English labels for the screens. */
export const INVITATION_SEND_LABELS: Record<string, string> = {
  already_sent: 'Already sent. Use "Resend invitation" to send it again.',
  in_progress: 'Being sent right now.',
  in_progress_or_sent: 'Being sent right now, or already sent.',
  not_found: 'Not in this campaign.',
  needs_explicit_resend: 'The last send may have gone out. Check, then use "Resend invitation" if it did not.',
  not_sent_yet: 'Never sent: use Send.',
  no_email: 'No e-mail address.',
  missing_name: 'First and last name are needed for the guest list.',
  missing_pdfs: 'Ticket or letter PDF missing: generate them first.',
  too_large: 'The PDFs are too large to attach.',
  empty_email: 'The e-mail text is empty.',
  unresolved_variables: 'The e-mail text uses an unknown {{variable}}.',
  duplicate_email: 'Another guest of this event has the same e-mail address (one address = one person).',
  guest_linked_elsewhere: 'This address is already invited through another campaign guest.',
  pending_request: 'This person already asked for an invitation on the event page. Adopt the request, or leave it to the guest list.',
  already_on_list: 'Already on the event\'s guest list. Adopt that row, or leave it.',
  not_adoptable: 'On the guest list as refused or cancelled: it cannot be adopted.',
  capacity: 'No seat left (invited and confirmed guests fill the capacity).',
  campaign_archived: 'The campaign is archived.',
  engine_not_supported: 'This event does not run on the guest list.',
  bad_status: 'Only draft or ready guests are sent.',
  no_request: 'No request to adopt for this address.',
  not_pending_request: 'The request is no longer pending.',
  sender_domain_not_verified: 'The sender address is not verified in Resend: use noreply@smartmarinaconnect.com.',
  send_uncertain: 'The e-mail service did not answer: it may have gone. Check before resending.',
  sent_not_recorded: 'Sent, but not recorded. Do not send it again; tell the developer.',
  resend_unreachable: 'The e-mail service could not be reached.',
  error: 'Unexpected error.',
};
export const invitationSendLabel = (code?: string | null) =>
  !code ? '' : INVITATION_SEND_LABELS[code] || (code.startsWith('resend_') ? `The e-mail service refused it (${code.slice(7)}).` : code);

export interface InvitationTestResult {
  ok: boolean; error?: string; to: string; from: string; reply_to: string; subject: string;
  unknown_variables: string[]; attachments_bytes: number;
}

export interface InvitationPreviewItem {
  id: string;
  state: 'sendable' | 'no_email' | 'blocked' | 'already_sent' | 'in_progress';
  code?: InvitationSendCode | 'linked';
  detail?: string;
  /** What staff may choose to adopt for this guest (an existing guest-list row). */
  can_adopt?: 'request' | 'existing';
  adopt?: 'request' | 'existing';
  guest_status?: string;
  guest_source?: string;
  other_id?: string;
  /** "recipient:<id>" or "guest:<id>" with the same name (a warning; staff decide). */
  same_name?: string[];
  status?: string;
  bytes?: number;
  seat?: boolean;
}

export interface InvitationPreviewResult {
  ok: true;
  selected: number;
  not_found: string[];
  sendable: number;
  without_email: number;
  without_email_ids: string[];
  already_sent: number;
  in_progress: number;
  blocked: {
    total: number; duplicates: number; pending_request: number; already_on_list: number; not_adoptable: number;
    capacity: number; missing_pdfs: number; missing_name: number; other: number;
  };
  same_name_warnings: number;
  seats: { capacity: number | null; held: number; left: number | null; needed: number };
  seats_left: number | null;
  from: string;
  reply_to: string;
  batch_max: number;
  recipients: InvitationPreviewItem[];
}

export interface InvitationSendItem {
  id: string;
  outcome: 'sent' | 'skipped' | 'blocked' | 'failed' | 'uncertain';
  code?: InvitationSendCode;
  detail?: string;
  guest_id?: string;
  adopted?: 'request' | 'existing';
  status?: string;
}

export interface InvitationSendResult {
  ok: true; sent: number; failed: number; uncertain: number; blocked: number; skipped: number;
  results: InvitationSendItem[];
  /** Ids beyond the first 10: call send again with them. */
  remaining: string[];
}

export interface InvitationAnswerResult {
  ok: boolean;
  error?: string;
  guest_id?: string | null;
  guest_status?: string | null;
  changed?: boolean;
  pass_needed?: boolean;
  /** After "accepted": the platform's entry pass (QR), sent by guest-list "resend". null = not needed. */
  pass?: { sent: boolean; error?: string } | null;
}

type Body =
  | { action: 'test'; campaign_id: string; recipient_id: string; to?: string }
  | { action: 'preview_send'; campaign_id: string; recipient_ids: string[]; adopt?: string[] }
  | { action: 'send'; campaign_id: string; recipient_ids: string[]; force_capacity?: boolean; adopt?: string[] }
  | { action: 'resend'; campaign_id: string; recipient_id: string }
  | { action: 'set_answer'; campaign_id: string; recipient_id: string; answer: 'accepted' | 'declined' | 'no_answer'; force?: boolean };

type Out<B extends Body> =
  B extends { action: 'test' } ? InvitationTestResult
  : B extends { action: 'preview_send' } ? InvitationPreviewResult
  : B extends { action: 'send' } ? InvitationSendResult
  : B extends { action: 'resend' } ? { ok: boolean; result: InvitationSendItem }
  : InvitationAnswerResult;

/** Calls the sender. Returns its JSON whether it answered 2xx or not ({ error } on failure). */
export async function invitationCampaign<B extends Body>(body: B): Promise<Out<B> & { error?: string }> {
  const { data, error } = await supabase.functions.invoke('invitation-campaign', { body });
  if (!error) return data;
  try {
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') return await ctx.json();
  } catch { /* fall through */ }
  return { error: (error as { message?: string }).message || 'network' } as Out<B> & { error?: string };
}
