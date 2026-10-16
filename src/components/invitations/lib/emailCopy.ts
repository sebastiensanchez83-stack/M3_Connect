/* ─── The invitation e-mail, to send from your own mailbox ───
 *
 * Victor often sends invitations himself (as for SM26): the same e-mail the platform would
 * send, rendered by the sender's own module (render.ts), with the guest's greeting and name
 * filled, as plain text ready to paste in Outlook. **bold** and *italic* markers are dropped
 * (Outlook pastes plain text as it is). A mailto: link opens a new e-mail with the address,
 * subject and text, but it cannot carry the two PDFs: they are attached by hand.
 * Pure: no DOM, no network.
 */
import type { InvitationCampaign, InvitationRecipient } from '../types';
import { renderInvitationEmail } from '../../../../supabase/functions/invitation-campaign/render.ts';
import { stripMarkup } from './render';

export interface InvitationEmailCopy {
  to: string;
  subject: string;
  /** Plain text, paragraphs separated by a blank line. */
  body: string;
  /** {{variables}} the module does not know (a typo in Settings): left as written. */
  unknown: string[];
  /** mailto: with address, subject and text, or null when too long for mail programs (about 2,000 characters). */
  mailto: string | null;
}

type CopyCampaign = Pick<InvitationCampaign, 'name' | 'rsvp_deadline' | 'sender_name' | 'sender_email' | 'reply_to' | 'settings' | 'texts'>;
type CopyGuest = Partial<Pick<InvitationRecipient, 'email' | 'honorific' | 'first_name' | 'last_name' | 'name_on_ticket' | 'name_on_letter'
  | 'greeting' | 'position' | 'organisation' | 'country'>>;

const MAILTO_MAX = 2000;

export function emailCopyFor(c: CopyCampaign, r: CopyGuest): InvitationEmailCopy {
  type RC = Parameters<typeof renderInvitationEmail>[0];
  const mail = renderInvitationEmail(c as unknown as RC, r);
  const body = mail.text.replace(/\r\n?/g, '\n').split('\n').map(stripMarkup).join('\n').replace(/\n+$/, '');
  const to = (r.email || '').trim();
  const href = `mailto:${encodeURIComponent(to).replace(/%40/g, '@')}?subject=${encodeURIComponent(mail.subject)}&body=${encodeURIComponent(body.replace(/\n/g, '\r\n'))}`;
  return { to, subject: mail.subject, body, unknown: mail.unknown, mailto: href.length <= MAILTO_MAX ? href : null };
}

/** The e-mail as a text file (in the ZIP of a selection): address, subject, then the text. */
export function emailCopyText(m: InvitationEmailCopy): string {
  return [`To: ${m.to || '(no e-mail address yet)'}`, `Subject: ${m.subject}`, '', m.body, ''].join('\r\n').replace(/\r?\n/g, '\r\n');
}
