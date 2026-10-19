/* ─── What the screens show for each guest ───
 *
 * The guest list is the truth for answers: once a campaign guest is linked to a
 * gl_guest row, its status there (invited, confirmed, declined, cancelled) is what
 * the screens show, whatever invitation_recipient.status says (a guest may also
 * answer on their personal page).
 */
import type { InvitationCampaign, InvitationDuplicate, InvitationRecipient } from '../types';
import type { EmailLogLite, GlGuestLite } from './api';
import { checkReasons, type CheckReason } from './names';

export type DisplayStatus = 'draft' | 'ready' | 'not_sent' | 'sent' | 'accepted' | 'declined' | 'no_answer' | 'cancelled' | 'refused';

export const STATUS_LABEL: Record<DisplayStatus, string> = {
  draft: 'Draft', ready: 'Ready', not_sent: 'On the list, e-mail not sent', sent: 'Sent, awaiting answer',
  accepted: 'Accepted', declined: 'Declined', no_answer: 'No reply', cancelled: 'Cancelled', refused: 'Refused',
};
export const STATUS_STYLE: Record<DisplayStatus, string> = {
  draft: 'bg-gray-100 text-gray-700', ready: 'bg-sky-100 text-sky-800', not_sent: 'bg-amber-100 text-amber-800',
  sent: 'bg-blue-100 text-blue-800', accepted: 'bg-green-100 text-green-800', declined: 'bg-gray-200 text-gray-700',
  no_answer: 'bg-orange-100 text-orange-800', cancelled: 'bg-gray-100 text-gray-500', refused: 'bg-red-100 text-red-700',
};

export interface GuestRow {
  r: InvitationRecipient;
  guest: GlGuestLite | null;
  status: DisplayStatus;
  reasons: CheckReason[];
  dups: InvitationDuplicate[];
  /** A pending /wys26 request with the same e-mail (not linked to any campaign guest). */
  request: GlGuestLite | null;
  adopt: boolean;
  passSent: boolean;
  invitationLogged: boolean;
  /**
   * How the invitation went out: 'platform' (the platform's e-mail) or the channel recorded with
   * "Mark as sent" (email, post, phone, in_person, third_party). null: not sent yet.
   */
  channel: string | null;
}

export function displayStatus(r: InvitationRecipient, g: GlGuestLite | null): DisplayStatus {
  if (!r.gl_guest_id || !g) {
    if (r.status === 'declined') return 'declined';
    return r.status === 'ready' ? 'ready' : r.status === 'draft' ? 'draft' : (r.status as DisplayStatus);
  }
  switch (g.status) {
    case 'confirmed': return 'accepted';
    case 'declined': return 'declined';
    case 'cancelled': return 'cancelled';
    case 'rejected': return 'refused';
    case 'requested': return 'not_sent';
    default:
      if (r.status === 'draft' || r.status === 'ready') return 'not_sent';
      return r.status === 'no_answer' ? 'no_answer' : 'sent';
  }
}

export function buildRows(c: InvitationCampaign, recipients: InvitationRecipient[], guests: GlGuestLite[], dups: InvitationDuplicate[], log: EmailLogLite[],
  channels: Map<string, string> = new Map()): GuestRow[] {
  const byId = new Map(guests.map(g => [g.id, g]));
  const linked = new Set(recipients.map(r => r.gl_guest_id).filter(Boolean) as string[]);
  const requests = new Map(guests.filter(g => g.status === 'requested' && g.source === 'request' && !linked.has(g.id))
    .map(g => [g.email.toLowerCase(), g]));
  const dismissed = new Set(c.settings?.dismissed_duplicates || []);
  const adopt = new Set(c.settings?.adopt || []);
  const kinds = new Map<string, Set<string>>();
  for (const l of log) { if (!kinds.has(l.guest_id)) kinds.set(l.guest_id, new Set()); kinds.get(l.guest_id)!.add(l.kind); }
  return recipients.map(r => {
    const guest = r.gl_guest_id ? byId.get(r.gl_guest_id) || null : null;
    const reasons = r.needs_check ? checkReasons(r) : [];
    const request = !r.gl_guest_id && r.email ? requests.get(r.email.toLowerCase()) || null : null;
    // A pending /wys26 request has its own choice (adopt or leave it to WYS 2026), not a duplicate warning.
    const ownDups = dups.filter(d => d.recipient_id === r.id && !dismissed.has(`${r.id}:${d.other_id}`) && d.other_id !== request?.id);
    const k = r.gl_guest_id ? kinds.get(r.gl_guest_id) : undefined;
    return {
      r, guest, status: displayStatus(r, guest), reasons, dups: ownDups, request, adopt: adopt.has(r.id),
      passSent: !!k?.has('pass'), invitationLogged: !!k?.has('invitation'),
      channel: channels.get(r.id) || null,
    };
  });
}

export const isSendable = (row: GuestRow) => (row.status === 'draft' || row.status === 'ready' || row.status === 'not_sent') && !!row.r.email;

export function daysUntil(iso: string | null | undefined): number | null {
  // Calendar days: 0 on the deadline itself, negative once it has passed.
  const m = (iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const now = new Date();
  return Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 86_400_000);
}

export const daysSince = (iso: string | null | undefined) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000) : null);

/** Awaiting an answer and worth a reminder: sent a week ago or more, or the deadline is close. */
export function needsReminder(row: GuestRow, deadline: string | null): boolean {
  if (row.status !== 'sent' && row.status !== 'no_answer') return false;
  const since = daysSince(row.r.sent_at || row.guest?.invited_at);
  const left = daysUntil(deadline);
  return (since !== null && since >= 7) || (left !== null && left <= 3);
}

export const guestName = (r: Pick<InvitationRecipient, 'name_on_ticket' | 'first_name' | 'last_name'>) =>
  r.name_on_ticket || [r.first_name, r.last_name].filter(Boolean).join(' ') || 'Unnamed guest';
