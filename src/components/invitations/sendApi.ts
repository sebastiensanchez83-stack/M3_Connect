import { supabase } from '@/lib/supabase';

/* ─── Invitation campaigns: the sender (edge function "invitation-campaign") ───
 *
 * The contract between the admin screens and supabase/functions/invitation-campaign
 * (POST with the signed-in staff member's JWT; verify_jwt true; is_moderator() checked).
 * The e-mail itself is built by render.ts, shared with the function, so the admin preview
 * shows exactly what the guest receives.
 *
 * Order for one wave: "test" to yourself (PDFs of that guest uploaded first); "preview_send"
 * with pdfs_on_send for the confirmation screen; then, 10 guests at a time, generate their PDFs
 * in the browser, upload them to the private bucket invitation-files as
 * <campaign id>/<recipient id>/ticket.pdf and letter.pdf, and "send" them (call "send" again
 * with "remaining" until it is empty: a call starts no new guest after 70 s). A guest already
 * sent, or whose last send may have gone out, is never sent again by "send"; "resend" is the
 * explicit action.
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
export {
  INVITATION_HAND_CHANNELS, INVITATION_HAND_PREFIX, MARK_SENT_BATCH_MAX, invitationChannels,
  type InvitationHandChannel,
} from '../../../supabase/functions/invitation-campaign/markSent.ts';
import type { InvitationHandChannel } from '../../../supabase/functions/invitation-campaign/markSent.ts';
import { SM26_INVITE_CHANNELS } from '@/components/admin/types';

export const INVITATION_SEND_BATCH = 10;

/**
 * How an invitation went out: the platform's e-mail, or one of the SM26 channels (Victor's own
 * mailbox, a posted letter, a phone call, in person, through somebody else), recorded with
 * "Mark as sent". Same labels as the SM26 invitations.
 */
export const INVITATION_CHANNEL_LABELS: Record<string, string> = {
  platform: 'Platform e-mail',
  ...Object.fromEntries(SM26_INVITE_CHANNELS.filter(c => c.key !== 'platform_letter').map(c => [c.key, c.label])),
};
export const invitationChannelLabel = (c: string | null | undefined) => (c ? INVITATION_CHANNEL_LABELS[c] || c : '');

/** Codes a guest can come back with (results of send / resend, states of preview_send). */
export type InvitationSendCode =
  // nothing done
  | 'already_sent' | 'in_progress' | 'in_progress_or_sent' | 'not_found' | 'needs_explicit_resend' | 'not_sent_yet'
  // blocked before anything was written
  | 'no_email' | 'missing_name' | 'missing_pdfs' | 'too_large' | 'empty_email' | 'unresolved_variables'
  | 'duplicate_email' | 'guest_linked_elsewhere' | 'same_person' | 'pending_request' | 'already_on_list' | 'not_adoptable' | 'capacity'
  | 'campaign_archived' | 'engine_not_supported' | 'bad_status' | 'no_request' | 'not_pending_request'
  | `guest_${string}`
  // the send itself
  | 'sender_domain_not_verified' | 'send_uncertain' | 'sent_not_recorded' | 'resend_unreachable' | `resend_${number}` | 'error';

/** How staff find out whether an e-mail whose sending was interrupted reached the guest. */
export const INVITATION_UNCERTAIN_HOW_TO_CHECK =
  "Look for it in the Resend log (resend.com, Emails, search the guest's address) or ask the guest. If it is not there, use \"Resend\" in Tracking.";

/** English labels for the screens. */
export const INVITATION_SEND_LABELS: Record<string, string> = {
  already_sent: 'Already sent. Use "Resend" in Tracking to send it again.',
  in_progress: 'Being sent right now.',
  in_progress_or_sent: 'Being sent right now, or already sent.',
  not_found: 'Not in this campaign.',
  needs_explicit_resend: 'The last send was interrupted and may have gone out, so it is not sent again from here. ' + INVITATION_UNCERTAIN_HOW_TO_CHECK,
  not_sent_yet: 'Never sent: use Send.',
  no_email: 'No e-mail address.',
  missing_name: 'First and last name are needed for the guest list.',
  missing_pdfs: 'Ticket or letter PDF missing: generate them first.',
  too_large: 'The PDFs are too large to attach.',
  empty_email: 'The e-mail text is empty.',
  unresolved_variables: 'The e-mail text uses an unknown {{variable}}.',
  duplicate_email: 'Another guest of this event has the same e-mail address (one address = one person).',
  same_person: 'Possible duplicate: same name as another guest of this event. Open the guest in the Guests tab and choose "Not the same person", or remove one of them.',
  guest_linked_elsewhere: 'This address is already invited through another campaign guest.',
  pending_request: 'This person already asked for an invitation on the event page. Adopt the request, or leave it to the guest list.',
  already_on_list: 'Already on the event\'s guest list (invited, approved or answered in WYS 2026): not invited a second time.',
  not_adoptable: 'On the event\'s guest list as refused or cancelled in WYS 2026: not invited again from here.',
  capacity: 'No seat left (invited and confirmed guests fill the capacity).',
  campaign_archived: 'The campaign is archived.',
  engine_not_supported: 'This event does not run on the guest list.',
  bad_status: 'Only draft or ready guests are sent.',
  no_request: 'No request to adopt for this address.',
  not_pending_request: 'The request is no longer pending.',
  sender_domain_not_verified: 'The sender address is not verified in Resend: use noreply@smartmarinaconnect.com.',
  send_uncertain: 'Sending was interrupted: the e-mail may have gone. ' + INVITATION_UNCERTAIN_HOW_TO_CHECK,
  sent_not_recorded: 'Sent, but not recorded. Do not send it again; tell the developer.',
  resend_unreachable: 'The e-mail service could not be reached.',
  error: 'Unexpected error.',
  // "Mark as sent" (an invitation sent outside the platform).
  bad_channel: 'Choose how the invitation went out.',
  bad_date: 'The date is not a valid day.',
  future_date: 'The date is in the future.',
  too_old: 'The date is more than a year ago.',
  mark_failed: 'Not recorded. Reload the page to see where this guest stands, then try again.',
  date_not_saved: "Marked as sent, but with today's date: the date given was not saved.",
  // Request-level answers of the function.
  test_only_to_yourself: 'A test goes only to your own address.',
  no_address_for_you: 'Your account has no e-mail address for the test.',
  recipient_not_found: 'This guest is no longer in the campaign.',
  campaign_not_found: 'Campaign not found.',
  event_not_found: 'The campaign\'s event was not found.',
  not_linked: 'Not on the guest list yet.',
  not_relinkable: 'Cancelled on the guest list (WYS 2026): it is not re-opened from here.',
  Unauthorized: 'Your session has expired: sign in again.',
  Forbidden: 'Only verified admins and moderators can do this.',
  network: 'The server could not be reached.',
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
  /** linked: still on the list after a failed send; relink: its own row, cancelled after a refused send, is re-opened. */
  code?: InvitationSendCode | 'linked' | 'relink';
  detail?: string;
  /** A pending /wys26 request staff may adopt for this guest (chosen in the Guests tab). */
  can_adopt?: 'request';
  adopt?: 'request';
  guest_status?: string;
  guest_source?: string;
  other_id?: string;
  /** "recipient:<id>" or "guest:<id>" with the same name, not dismissed by staff: blocks the send (same_person). */
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
    total: number; duplicates: number; same_person: number; pending_request: number; already_on_list: number; not_adoptable: number;
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
  adopted?: 'request';
  status?: string;
}

export interface InvitationSendResult {
  ok: true; sent: number; failed: number; uncertain: number; blocked: number; skipped: number;
  results: InvitationSendItem[];
  /** Ids this call did not handle (beyond the first 10, or after 70 s): call send again with them. */
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

/** One guest of a "mark_sent" call. */
export interface InvitationMarkItem {
  id: string;
  outcome: 'sent' | 'skipped' | 'blocked' | 'failed';
  code?: InvitationSendCode | 'mark_failed';
  detail?: string;
  guest_id?: string;
  adopted?: 'request';
  status?: string;
  channel?: InvitationHandChannel;
}

export interface InvitationMarkResult {
  ok: true; marked: number; blocked: number; skipped: number; failed: number;
  results: InvitationMarkItem[];
  /** Ids this call did not handle (beyond the first 25, or after 70 s): call mark_sent again with them. */
  remaining: string[];
}

type Body =
  | { action: 'test'; campaign_id: string; recipient_id: string; to?: string }
  /** pdfs_on_send: the screen uploads fresh PDFs right before "send", so missing files do not block here. */
  | { action: 'preview_send'; campaign_id: string; recipient_ids: string[]; adopt?: string[]; pdfs_on_send?: boolean }
  | { action: 'send'; campaign_id: string; recipient_ids: string[]; force_capacity?: boolean; adopt?: string[] }
  | { action: 'resend'; campaign_id: string; recipient_id: string }
  | { action: 'set_answer'; campaign_id: string; recipient_id: string; answer: 'accepted' | 'declined' | 'no_answer'; force?: boolean }
  /** sent_on: YYYY-MM-DD; omitted or null = now. adopt: as for send (pending /wys26 requests staff chose to adopt). */
  | { action: 'mark_sent'; campaign_id: string; recipient_ids: string[]; channel: InvitationHandChannel; sent_on?: string | null;
      adopt?: string[]; force_capacity?: boolean };

type Out<B extends Body> =
  B extends { action: 'test' } ? InvitationTestResult
  : B extends { action: 'preview_send' } ? InvitationPreviewResult
  : B extends { action: 'send' } ? InvitationSendResult
  : B extends { action: 'resend' } ? { ok: boolean; result: InvitationSendItem }
  : B extends { action: 'mark_sent' } ? InvitationMarkResult
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
