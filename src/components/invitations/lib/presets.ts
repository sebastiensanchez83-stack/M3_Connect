/* ─── Campaign presets ───
 * WYS 2026 Dubai: the kit's wys_dubai_2026_content.json (event facts, ticket, letter and
 * e-mail texts validated by Victor; the only personal details are his own signature
 * block and the M3 office phone, already printed on the public letter template).
 */
import type { InvitationCampaignInsert, InvitationCampaignSettings, InvitationCampaignTexts } from '../types';
import wys from '../presets/wys-dubai-2026.json';
import { todayIso } from './render';

export interface Preset { key: string; label: string; build: (glEventId: string) => InvitationCampaignInsert }

/**
 * Sender: no platform function sends from m3monaco.com today, so the domain is not proven
 * on the platform's Resend account. Default: "World Yachting Summit"
 * <noreply@smartmarinaconnect.com>, replies to events@m3monaco.com (editable in Settings).
 */
export const PRESETS: Preset[] = [
  {
    key: 'wys-dubai-2026',
    label: 'World Yachting Summit 2026, Dubai (kit texts)',
    build: (glEventId) => ({
      gl_event_id: glEventId,
      name: 'WYS 2026 Dubai, invitations',
      ticket_style: 'white',
      rsvp_deadline: wys.event.rsvp_deadline_iso,
      letter_date: todayIso(),
      conference: true,
      gala: true,
      sender_name: 'World Yachting Summit',
      sender_email: 'noreply@smartmarinaconnect.com',
      reply_to: wys.event.rsvp_email,
      settings: { ...wys.event, assets: 'wys26', ticket_artwork: 'template', signature: 'sm26', file_prefix: 'WYS' } as InvitationCampaignSettings,
      texts: { ticket: wys.ticket, letter: wys.letter, email: { ...wys.email, join_platform_line: null } } as InvitationCampaignTexts,
    }),
  },
  {
    key: 'blank',
    label: 'Blank (fill every text in Settings)',
    build: (glEventId) => ({
      gl_event_id: glEventId,
      name: 'New invitation campaign',
      ticket_style: 'white',
      letter_date: todayIso(),
      conference: true,
      gala: true,
      sender_name: null,
      sender_email: 'noreply@smartmarinaconnect.com',
      reply_to: null,
      settings: { assets: 'wys26', ticket_artwork: 'drawn', signature: 'sm26', file_prefix: 'Invitation' },
      texts: {
        ticket: { eyebrow: '', line_under_name: '', fine_print: 'Strictly by invitation. Personal and non transferable, valid for the guest named above.' },
        letter: { place: 'Monaco', paragraphs: [], bullets: [], closing_paragraphs: ['With our warmest regards,'] },
        email: { subject: '', body: 'Dear {{greeting}},\n\n', join_platform_line: null },
      },
    }),
  },
];

/** The kit's texts, to compare with a campaign in template mode (the artwork prints them). */
export const WYS_TICKET_TEXTS = wys.ticket;
export const WYS_EVENT = wys.event;
