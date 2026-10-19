/* ─── Invitation campaigns (admin module) ───
 *
 * Hand-written to match supabase/migrations/20261017090000_invitation_campaigns.sql
 * and 20261017091000_invitation_guest_link.sql; regenerate or check them against the
 * database once the migrations are applied.
 *
 * One campaign = one guest-list event (gl_event). One invitation_recipient = one
 * invited person. When the invitation goes out, the person becomes an "invited" row
 * of that event's guest list (gl_guest, through invitation_link_guest): same token,
 * same QR, same door and personal page as every other guest. The guest-list row is
 * the truth for the answer: a guest may also answer on their personal page, so the
 * screens read gl_guest.status through gl_guest_id, not only `status` here.
 *
 * Tables are staff only (verified admins and moderators, RLS). The journal
 * (invitation_log) is append-only. invitation_link_guest is called by the sender only
 * (service role, acting for a verified staff member through p_actor), in the same action
 * as the invitation e-mail, so no guest-list row is ever created without its e-mail.
 */

/** Ticket background: white page with a navy stub, or the reverse. */
export type InvitationTicketStyle = 'white' | 'navy';

/**
 * draft and ready are set by staff; sent by the sender; accepted, declined and
 * no_answer only through invitation_set_answer (a trigger refuses the rest).
 */
export type InvitationRecipientStatus = 'draft' | 'ready' | 'sent' | 'accepted' | 'declined' | 'no_answer';

export const INVITATION_RECIPIENT_STATUSES: { key: InvitationRecipientStatus; label: string }[] = [
  { key: 'draft', label: 'Draft' },
  { key: 'ready', label: 'Ready' },
  { key: 'sent', label: 'Sent' },
  { key: 'accepted', label: 'Accepted' },
  { key: 'declined', label: 'Declined' },
  { key: 'no_answer', label: 'No reply' },
];

/**
 * invitation_campaign.settings: the event facts printed on the ticket and the letter,
 * keyed as the "event" block of the kit's wys_dubai_2026_content.json, plus the artwork
 * folder under public/invitations/. Every key is optional: the module fills them.
 */
export interface InvitationCampaignSettings {
  name?: string;
  edition?: string;
  date_iso?: string;
  date_label?: string;
  city?: string;
  venue?: string;
  access?: string;
  /**
   * The times printed on the ticket, one entry per part (e.g. "Conference and lunch",
   * "9:00 to 15:00"). Absent: the WYS 2026 times when the campaign carries the WYS
   * event facts; an empty list prints nothing.
   */
  schedule?: { label: string; time: string }[];
  rsvp_deadline_iso?: string;
  rsvp_deadline_label?: string;
  rsvp_email?: string;
  hosts?: string;
  website?: string;
  contact_email_ticket?: string;
  phone?: string;
  /** Folder under public/invitations/ holding templates/ and logos/, e.g. "wys26". */
  assets?: string;
  /**
   * Ticket artwork: "template" prints the name on the folder's validated blank ticket
   * (identical to the kit samples); "drawn" draws every text from these settings.
   */
  ticket_artwork?: 'template' | 'drawn';
  /** Letter signature: the SM26 letterhead copy (event-media, staff signed URL), or none. */
  signature?: 'sm26' | 'none';
  /** File names: "WYS" gives WYS_Ticket_First_Last.pdf. */
  file_prefix?: string;
  /** Guests whose pending /wys26 request staff chose to adopt (send action "adopt"). */
  adopt?: string[];
  /** "recipientId:otherId" pairs staff marked as different people. */
  dismissed_duplicates?: string[];
}

/**
 * invitation_campaign.texts: the editable texts, with {{variables}} such as {{greeting}};
 * the ticket, letter and email blocks of the kit's content file.
 */
export interface InvitationCampaignTexts {
  ticket?: {
    eyebrow?: string;
    line_under_name?: string;
    fine_print?: string;
    stub_top?: string;
    stub_day?: string;
    stub_month_year?: string;
    stub_city?: string;
    stub_edition?: string;
  };
  letter?: {
    /** "Monaco" in "Monaco, 9 October 2026" at the top of the letter. */
    place?: string;
    /** **bold** and *italic* as in the kit. */
    paragraphs?: string[];
    bullets?: string[];
    closing_paragraphs?: string[];
    signatory_name?: string;
    signatory_title?: string;
    footer?: string;
  };
  email?: {
    subject?: string;
    body?: string;
    /** Optional "join Smart Marina Connect" line; no account is ever created for the guest. */
    join_platform_line?: string | null;
  };
}

export interface InvitationCampaign {
  id: string;
  gl_event_id: string;
  name: string;
  ticket_style: InvitationTicketStyle;
  /** ISO date (YYYY-MM-DD). */
  rsvp_deadline: string | null;
  /** ISO date shown on the letter. */
  letter_date: string | null;
  /**
   * Access written on every guest-list row of the campaign; at least one is true. One value
   * per campaign: the WYS 2026 ticket backgrounds print "Conference and Gala Dinner".
   */
  conference: boolean;
  gala: boolean;
  sender_name: string | null;
  sender_email: string | null;
  reply_to: string | null;
  settings: InvitationCampaignSettings;
  texts: InvitationCampaignTexts;
  archived_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type InvitationCampaignInsert = Pick<InvitationCampaign, 'gl_event_id' | 'name'> &
  Partial<Pick<InvitationCampaign, 'id' | 'ticket_style' | 'rsvp_deadline' | 'letter_date' | 'conference' | 'gala'
    | 'sender_name' | 'sender_email' | 'reply_to' | 'settings' | 'texts' | 'archived_at'>>;
export type InvitationCampaignUpdate = Partial<Omit<InvitationCampaignInsert, 'id'>>;

export interface InvitationRecipient {
  id: string;
  campaign_id: string;
  /** Order in the list; the ZIP folders are numbered from it (01_First_Last/). */
  sort_order: number | null;
  honorific: string | null;
  /** Both needed on the guest list (gl_guest), max 80 characters each. */
  first_name: string | null;
  last_name: string | null;
  name_on_ticket: string;
  name_on_letter: string | null;
  /** What follows "Dear" (or replaces it: "Your Excellency"). */
  greeting: string | null;
  position: string | null;
  organisation: string | null;
  /** Lower-cased and trimmed by the database; unique per campaign. */
  email: string | null;
  phone: string | null;
  country: string | null;
  notes: string | null;
  /** Set on insert when the notes say "a verifier" / "to check"; staff clear it. */
  needs_check: boolean;
  /** An existing account with this proven address, kept by the database. Information only, never created. */
  profile_user_id: string | null;
  /** The guest-list row, once invitation_link_guest has run. */
  gl_guest_id: string | null;
  status: InvitationRecipientStatus;
  generated_at: string | null;
  sent_at: string | null;
  responded_at: string | null;
  /** Paths in the private bucket "invitation-files". */
  ticket_pdf_path: string | null;
  letter_pdf_path: string | null;
  /** Set by the sender while it works on this guest (double-click lock). */
  sending_at: string | null;
  send_error: string | null;
  /** Kept by the database for the duplicate checks. */
  name_key: string;
  org_key: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** What staff may write directly (the rest is kept by the database or the module's actions). */
export type InvitationRecipientInsert = Pick<InvitationRecipient, 'campaign_id' | 'name_on_ticket'> &
  Partial<Pick<InvitationRecipient, 'id' | 'sort_order' | 'honorific' | 'first_name' | 'last_name' | 'name_on_letter'
    | 'greeting' | 'position' | 'organisation' | 'email' | 'phone' | 'country' | 'notes' | 'needs_check'
    | 'generated_at' | 'ticket_pdf_path' | 'letter_pdf_path'>> & {
    status?: 'draft' | 'ready';
  };
export type InvitationRecipientUpdate = Partial<Omit<InvitationRecipientInsert, 'id' | 'campaign_id'>>;

export interface InvitationLogEntry {
  id: number;
  campaign_id: string | null;
  recipient_id: string | null;
  /** lower_snake_case: recipient_added, status_changed, guest_created, answer, ... */
  action: string;
  actor_id: string | null;
  payload: Record<string, unknown>;
  at: string;
}

/** Staff may add a line in their own name (actor_id defaults to them). */
export type InvitationLogInsert = Pick<InvitationLogEntry, 'action'> &
  Partial<Pick<InvitationLogEntry, 'campaign_id' | 'recipient_id' | 'payload'>>;

/** One row of invitation_find_duplicates(p_campaign_id, p_recipient_id?). */
export interface InvitationDuplicate {
  recipient_id: string;
  /** email; name_org = same name and organisation; name = same name only. */
  match_on: 'email' | 'name_org' | 'name';
  /** Another campaign guest of the same event, or a row of the event's guest list. */
  other_kind: 'recipient' | 'guest';
  other_id: string;
  other_campaign_id: string | null;
  other_label: string;
  other_status: string;
}

/** Status of a guest-list row (gl_guest.status) as the guest-list event uses it. */
export type InvitationGuestStatus = 'requested' | 'invited' | 'confirmed' | 'declined' | 'rejected' | 'cancelled';

export type InvitationLinkGuestError =
  | 'recipient_not_found' | 'bad_status' | 'campaign_archived' | 'engine_not_supported' | 'no_email' | 'missing_name'
  | 'guest_linked_elsewhere' | 'already_on_list' | 'pending_request' | 'not_adoptable' | 'capacity';

/**
 * invitation_link_guest(p_recipient_id, p_force?, p_adopt?, p_actor): puts a draft or ready
 * guest on the guest list as guest-list v6 "invite" does. No e-mail. SERVICE ROLE ONLY (the
 * sender), with p_actor = the verified staff member. A pending public request is never
 * adopted ('pending_request'): staff handle it in "WYS 2026". The sender always passes
 * p_adopt false (an address already on the list is never invited twice) and adopts a pending
 * request, when staff chose it, with invitation_adopt_request.
 */
export type InvitationLinkGuestResult =
  | {
      ok: true;
      guest_id: string;
      guest_status: InvitationGuestStatus;
      created: boolean;
      adopted: boolean;
      already_linked?: true;
    }
  | {
      ok: false;
      error: InvitationLinkGuestError;
      /** The campaign status, with 'bad_status'. */
      status?: InvitationRecipientStatus;
      guest_id?: string;
      guest_status?: InvitationGuestStatus;
      guest_source?: 'request' | 'invitation' | 'plus_one';
      other_recipient_id?: string;
      held?: number;
      capacity?: number;
      engine?: string;
    };

export type InvitationAnswer = 'accepted' | 'declined' | 'no_answer';

/**
 * invitation_unlink_guest(p_recipient_id, p_actor?): undoes a link whose invitation never
 * went out (draft or ready guest, row created by the module, still invited, no e-mail
 * logged). The guest-list row is cancelled as v6 "cancel" does and stays on the list.
 * Staff call it directly; the service role passes p_actor.
 */
export type InvitationUnlinkGuestResult =
  | { ok: true; guest_id: string; guest_status: 'cancelled' }
  | { ok: false; error: 'recipient_not_found' | 'not_linked' | 'bad_status' | 'not_undoable';
      status?: InvitationRecipientStatus; guest_id?: string; guest_status?: InvitationGuestStatus;
      guest_source?: 'request' | 'invitation' | 'plus_one' };

/**
 * invitation_set_answer(p_recipient_id, p_answer, p_force?, p_actor?). Staff call it
 * directly; the service role passes p_actor (a verified staff member). After an accepted answer
 * with pass_needed, send the entry pass with the guest-list function's existing
 * "resend" action (guestList({ action: 'resend', slug, guest_id })).
 */
export type InvitationSetAnswerResult =
  | { ok: true; guest_id: string | null; guest_status: InvitationGuestStatus | null; changed: boolean; pass_needed: boolean }
  | { ok: false; error: 'recipient_not_found' | 'not_linked' | 'capacity' | 'guest_answered' | `guest_${InvitationGuestStatus}`;
      guest_status?: InvitationGuestStatus; held?: number; capacity?: number };

/** Private bucket of the generated PDFs (staff only, signed URLs). */
export const INVITATION_FILES_BUCKET = 'invitation-files';

/**
 * The kit's public artwork (public/invitations/). Fonts are embedded whole
 * (pdf-lib embedFont with subset: false; see the kit's SPEC.md). Event artwork
 * lives in a folder per event, named in settings.assets.
 */
export const INVITATION_FONTS = {
  montserratLight: '/invitations/fonts/Montserrat-Light.ttf',
  montserratRegular: '/invitations/fonts/Montserrat-Regular.ttf',
  montserratMedium: '/invitations/fonts/Montserrat-Medium.ttf',
  montserratSemiBold: '/invitations/fonts/Montserrat-SemiBold.ttf',
  pagellaRegular: '/invitations/fonts/Pagella-Regular.ttf',
  pagellaItalic: '/invitations/fonts/Pagella-Italic.ttf',
} as const;

export const invitationArtwork = (folder: string) => ({
  templates: {
    ticketWhite: `/invitations/${folder}/templates/tpl_ticket_white.pdf`,
    ticketNavy: `/invitations/${folder}/templates/tpl_ticket_navy.pdf`,
    letter: `/invitations/${folder}/templates/tpl_letter.pdf`,
  },
  logos: {
    letterBanner: `/invitations/${folder}/logos/letter_banner.png`,
    m3Navy: `/invitations/${folder}/logos/m3_navy.png`,
    m3White: `/invitations/${folder}/logos/m3_white.png`,
    wysNavy: `/invitations/${folder}/logos/wys_navy.png`,
    wysWhite: `/invitations/${folder}/logos/wys_white.png`,
    omniNavy: `/invitations/${folder}/logos/omni_navy.png`,
    omniWhite: `/invitations/${folder}/logos/omni_white.png`,
  },
});
