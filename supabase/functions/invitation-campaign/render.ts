// Invitation e-mail of the "Invitation campaigns" admin module: subject, HTML and plain text,
// built from the campaign's e-mail text (invitation_campaign.texts.email) with {{variables}},
// the attachment file names and the sender.
//
// PURE: no import, no Deno, DOM or network API, erasable TypeScript only. The edge function
// invitation-campaign sends what this returns; scripts/invitation-email-preview.mjs (node)
// renders the same thing to files; the admin preview may import it too, so what Victor sees
// is what the guest gets.
//
// The look is a personal letter, not a newsletter: left aligned text on white, the campaign's
// own words and signature, no banner. The ticket and the letter PDFs carry the event's
// artwork. This is the prototype's e-mail (wys-invitation-kit/reference), sent instead of
// copied into Outlook.
//
// Greeting rule (Victor, 16 Oct): "Your Excellency," replaces "Dear ...,": when the greeting
// starts with "Your " (Your Excellency, Your Highness), "Dear {{greeting}}" becomes
// "{{greeting}}".

export interface InvitationRenderCampaign {
  name?: string | null;
  /** ISO date (YYYY-MM-DD). */
  rsvp_deadline?: string | null;
  sender_name?: string | null;
  sender_email?: string | null;
  reply_to?: string | null;
  settings?: Record<string, unknown> | null;
  texts?: {
    email?: { subject?: string | null; body?: string | null; join_platform_line?: string | null } | null;
  } | null;
}

export interface InvitationRenderRecipient {
  honorific?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  name_on_ticket?: string | null;
  name_on_letter?: string | null;
  greeting?: string | null;
  position?: string | null;
  organisation?: string | null;
  country?: string | null;
}

export interface InvitationRenderedEmail {
  subject: string;
  html: string;
  text: string;
  /** {{variables}} left in the subject or body that this module does not know (a typo). */
  unknown: string[];
  /** The body was empty: nothing to send. */
  empty: boolean;
}

/** The {{variables}} an e-mail text may use, with what each one prints. */
export const INVITATION_EMAIL_VARIABLES: ReadonlyArray<readonly [string, string]> = [
  ['greeting', 'What follows "Dear" (the greeting column, else the name on the letter). "Your Excellency" replaces "Dear ..."'],
  ['name', 'Name on the letter, else the name on the ticket'],
  ['name_on_ticket', 'Name on the ticket'],
  ['first_name', 'First name'],
  ['last_name', 'Last name'],
  ['honorific', 'Title (Dr, Mr, H.E. ...)'],
  ['position', 'Position'],
  ['organisation', 'Organisation'],
  ['country', 'Country'],
  ['event_name', 'Event name (campaign settings)'],
  ['edition', 'Edition'],
  ['event_date', 'Event date, as written in the settings ({{date}} works too)'],
  ['date', 'Event date (same as {{event_date}})'],
  ['city', 'City'],
  ['venue', 'Venue'],
  ['access', 'Access, e.g. Conference and Gala Dinner'],
  ['rsvp_deadline', 'RSVP deadline'],
  ['rsvp_email', 'RSVP e-mail address'],
  ['hosts', 'Hosts'],
  ['website', 'Website'],
  ['join_platform_line', 'The optional "join Smart Marina Connect" line (empty when the campaign does not use it)'],
];

/**
 * Suggested text for the optional per-campaign line (off by default: the campaign uses it only
 * when texts.email.join_platform_line is not empty). No account is ever created for a guest.
 */
export const INVITATION_JOIN_LINE_DEFAULT =
  'P.S. You are also most welcome to join Smart Marina Connect, the free online community of the marina and yachting industry run by M3 Monaco: https://smartmarinaconnect.com';

/**
 * Default sender. events@m3monaco.com is not used by default: no function of the platform has
 * ever sent from m3monaco.com, so it is not known to be a verified domain of the platform's
 * Resend account. A campaign switches by setting sender_email once a test send went through.
 */
export const INVITATION_DEFAULT_SENDER_EMAIL = 'noreply@smartmarinaconnect.com';
export const INVITATION_DEFAULT_REPLY_TO = 'events@m3monaco.com';
export const INVITATION_DEFAULT_SENDER_NAME = 'M3 Monaco';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October',
  'November', 'December'];

/** Trim, and turn every run of white space (tabs, no-break spaces, line breaks) into one space. */
function one(s: unknown): string {
  return typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '';
}

/** "2026-11-13" -> "13 November 2026"; anything else as it is. */
export function invitationDateLabel(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(one(iso));
  if (!m) return one(iso);
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${Number(m[3])} ${month} ${m[1]}` : one(iso);
}

function setting(c: InvitationRenderCampaign, key: string): string {
  const v = c.settings ? c.settings[key] : undefined;
  return typeof v === 'string' ? one(v) : '';
}

/** The greeting printed after "Dear" (or alone, for "Your Excellency"). */
export function invitationGreeting(r: InvitationRenderRecipient): string {
  return one(r.greeting) || one(r.name_on_letter) || one(r.name_on_ticket)
    || one([r.first_name, r.last_name].filter(Boolean).join(' ')) || 'Guest';
}

/** Every variable's value for one guest of one campaign. */
export function invitationVariables(c: InvitationRenderCampaign, r: InvitationRenderRecipient): Record<string, string> {
  const name = one(r.name_on_letter) || one(r.name_on_ticket) || one([r.first_name, r.last_name].filter(Boolean).join(' '));
  const date = setting(c, 'date_label') || invitationDateLabel(setting(c, 'date_iso'));
  return {
    greeting: invitationGreeting(r),
    name,
    name_on_ticket: one(r.name_on_ticket) || name,
    first_name: one(r.first_name),
    last_name: one(r.last_name),
    honorific: one(r.honorific),
    position: one(r.position),
    organisation: one(r.organisation),
    country: one(r.country),
    event_name: setting(c, 'name') || one(c.name),
    edition: setting(c, 'edition'),
    // The admin screens' name for it is event_date (as in the ticket and letter texts); both work.
    event_date: date,
    date,
    city: setting(c, 'city'),
    venue: setting(c, 'venue'),
    access: setting(c, 'access'),
    rsvp_deadline: setting(c, 'rsvp_deadline_label') || invitationDateLabel(c.rsvp_deadline || setting(c, 'rsvp_deadline_iso')),
    rsvp_email: setting(c, 'rsvp_email') || one(c.reply_to) || INVITATION_DEFAULT_REPLY_TO,
    hosts: setting(c, 'hosts'),
    website: setting(c, 'website'),
    join_platform_line: one(c.texts?.email?.join_platform_line),
  };
}

const VAR_RE = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

/** Fills {{variables}}; unknown ones stay as written and are listed. */
export function fillInvitationTemplate(template: string, vars: Record<string, string>): { text: string; unknown: string[] } {
  const unknown: string[] = [];
  let t = template;
  // "Your Excellency," replaces "Dear ...," (never "Dear Your Excellency,").
  if (/^your\s/i.test(vars.greeting || '')) t = t.replace(/\bDear\s+(\{\{\s*greeting\s*\}\})/gi, '$1');
  const text = t.replace(VAR_RE, (whole: string, key: string) => {
    const k = key.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(vars, k)) return vars[k];
    if (!unknown.includes(whole)) unknown.push(whole);
    return whole;
  });
  return { text, unknown };
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const INK = '#1F2D40';
const LINK = '#0A2E5C';
const FONT = 'Arial, Helvetica, sans-serif';

// On HTML-safe text: **bold**, *italic* (as in the kit's texts), and links for web and e-mail
// addresses (mail clients do it anyway; doing it here makes it the same everywhere).
const LINK_RE = /(https?:\/\/[^\s<]+[^\s<.,;:!?)])|(www\.[A-Za-z0-9-]+\.[^\s<]*[^\s<.,;:!?)])|([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
function inline(safe: string): string {
  return safe
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(LINK_RE, (m: string, url: string, www: string, mail: string) => {
      const href = url ? url : www ? `https://${www}` : `mailto:${mail}`;
      return `<a href="${href}" style="color:${LINK};text-decoration:underline;">${m}</a>`;
    });
}

/** Blank line = new paragraph; line break = <br>. */
function paragraphs(text: string): string {
  return text
    .split(/\n[ \t]*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p style="margin:0 0 16px;font-family:${FONT};font-size:15px;line-height:23px;color:${INK};">${
      inline(esc(p)).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** The e-mail one guest receives. `test` prefixes the subject with "[Test] " and changes nothing else. */
export function renderInvitationEmail(c: InvitationRenderCampaign, r: InvitationRenderRecipient,
                                      opts: { test?: boolean } = {}): InvitationRenderedEmail {
  const vars = invitationVariables(c, r);
  const e = c.texts?.email || {};
  let bodyTpl = typeof e.body === 'string' ? e.body.replace(/\r\n?/g, '\n') : '';
  // The optional "join Smart Marina Connect" line: where {{join_platform_line}} stands, else
  // after the text (a P.S.). Empty when the campaign does not use it.
  if (vars.join_platform_line && !/\{\{\s*join_platform_line\s*\}\}/i.test(bodyTpl)) {
    bodyTpl = `${bodyTpl.replace(/\s+$/, '')}\n\n{{join_platform_line}}`;
  }
  const body = fillInvitationTemplate(bodyTpl, vars);
  const subj = fillInvitationTemplate(one(e.subject) || `Invitation: ${vars.event_name || 'our event'}`, vars);
  const unknown = [...subj.unknown, ...body.unknown.filter((u) => !subj.unknown.includes(u))];
  const text = tidy(body.text);
  const subject = `${opts.test ? '[Test] ' : ''}${one(subj.text)}`;
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#ffffff;" bgcolor="#ffffff">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="background-color:#ffffff;">
<tr><td style="padding:24px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">
<tr><td style="font-family:${FONT};font-size:15px;line-height:23px;color:${INK};">
${paragraphs(text)}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
  return { subject, html, text: `${text}\n`, unknown, empty: !text };
}

/** The prototype's file name part: "Mr Jean Dupont" -> "Mr_Jean_Dupont" (accents dropped). */
export function invitationFileSlug(name: string | null | undefined): string {
  return (one(name) || 'Guest').normalize('NFD').replace(/\p{M}/gu, '').replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'Guest';
}

/**
 * Attachment names, as the prototype saves them: WYS_Letter_Mr_Jean_Dupont.pdf and
 * WYS_Ticket_Mr_Jean_Dupont.pdf. The prefix is settings.file_prefix, else the initials of the
 * event name (World Yachting Summit -> WYS), else "Invitation".
 */
export function invitationAttachmentNames(c: InvitationRenderCampaign, r: InvitationRenderRecipient): { letter: string; ticket: string } {
  const initials = (setting(c, 'name') || one(c.name)).split(' ').filter((w) => /^[A-Z]/.test(w)).map((w) => w[0]).join('');
  const prefix = (setting(c, 'file_prefix') || initials || 'Invitation').replace(/[^A-Za-z0-9]+/g, '') || 'Invitation';
  const slug = invitationFileSlug(r.name_on_ticket || r.name_on_letter);
  return { letter: `${prefix}_Letter_${slug}.pdf`, ticket: `${prefix}_Ticket_${slug}.pdf` };
}

/** From and reply-to: the campaign's sender settings, else the defaults above. */
export function invitationSender(c: InvitationRenderCampaign): { from: string; fromEmail: string; fromName: string; replyTo: string } {
  const fromEmail = one(c.sender_email).toLowerCase() || INVITATION_DEFAULT_SENDER_EMAIL;
  const fromName = (one(c.sender_name) || setting(c, 'name') || INVITATION_DEFAULT_SENDER_NAME).replace(/[<>"\\]/g, '').slice(0, 120)
    || INVITATION_DEFAULT_SENDER_NAME;
  const replyTo = one(c.reply_to).toLowerCase() || setting(c, 'rsvp_email').toLowerCase() || INVITATION_DEFAULT_REPLY_TO;
  return { from: `${fromName} <${fromEmail}>`, fromEmail, fromName, replyTo };
}
