/* ─── Campaign texts: variables and light markup ───
 *
 * Variables in {{double braces}} are replaced per guest (VARIABLES lists them).
 * "Dear {{greeting}}" becomes "Your Excellency" alone when the greeting starts with
 * "Your " (Victor, 16 Oct: "Your Excellency," without "Dear").
 * In the letter, **bold** prints in Montserrat SemiBold and *italic* (conference
 * titles) in Pagella Italic, as in the kit.
 * Pure functions: the e-mail preview shown to staff is built here.
 */
import type { InvitationCampaign, InvitationRecipient } from '../types';
import { clean } from './norm';

export const VARIABLES: { key: string; label: string }[] = [
  { key: 'greeting', label: 'What follows "Dear" (Mr Doe, Jane Doe, Your Excellency)' },
  { key: 'name', label: 'Name on the letter' },
  { key: 'name_on_ticket', label: 'Name on the ticket' },
  { key: 'first_name', label: 'First name' },
  { key: 'last_name', label: 'Surname' },
  { key: 'position', label: 'Job title' },
  { key: 'organisation', label: 'Organisation' },
  { key: 'event_name', label: 'Event name' },
  { key: 'edition', label: 'Edition' },
  { key: 'event_date', label: 'Event date' },
  { key: 'venue', label: 'Venue' },
  { key: 'city', label: 'City' },
  { key: 'access', label: 'Access' },
  { key: 'rsvp_deadline', label: 'RSVP deadline' },
  { key: 'rsvp_email', label: 'RSVP e-mail' },
  { key: 'hosts', label: 'Hosts' },
  { key: 'website', label: 'Website' },
];

type Guest = Pick<InvitationRecipient, 'greeting' | 'name_on_ticket' | 'name_on_letter' | 'first_name' | 'last_name' | 'position' | 'organisation'>;

export function variablesFor(c: Pick<InvitationCampaign, 'settings'>, g: Partial<Guest> | null): Record<string, string> {
  const s = c.settings || {};
  const ticket = clean(g?.name_on_ticket);
  return {
    greeting: clean(g?.greeting) || clean(g?.name_on_letter) || ticket || 'Guest',
    name: clean(g?.name_on_letter) || ticket,
    name_on_ticket: ticket,
    first_name: clean(g?.first_name),
    last_name: clean(g?.last_name),
    position: clean(g?.position),
    organisation: clean(g?.organisation),
    event_name: clean(s.name),
    edition: clean(s.edition),
    event_date: clean(s.date_label),
    venue: clean(s.venue),
    city: clean(s.city),
    access: clean(s.access),
    rsvp_deadline: clean(s.rsvp_deadline_label),
    rsvp_email: clean(s.rsvp_email),
    hosts: clean(s.hosts),
    website: clean(s.website),
  };
}

/** Replaces {{variables}}; unknown ones are left visible so a typo shows in the preview. */
export function fill(text: string | null | undefined, vars: Record<string, string>): string {
  let t = text || '';
  const g = vars.greeting || '';
  if (/^your\s/i.test(g)) t = t.replace(/\bDear\s+\{\{\s*greeting\s*\}\}/g, g);
  return t.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, k: string) => (k in vars ? vars[k] : m));
}

/** {{names}} used in a text that are not variables (shown as a warning in Settings). */
export function unknownVariables(text: string | null | undefined): string[] {
  const known = new Set(VARIABLES.map(v => v.key));
  const out = new Set<string>();
  for (const m of (text || '').matchAll(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g)) if (!known.has(m[1])) out.add(m[1]);
  return [...out];
}

export type RunStyle = 'regular' | 'bold' | 'italic';
export interface Run { text: string; style: RunStyle }

/** "**bold** and *italic*" in runs. An unclosed marker is printed as written. */
export function parseMarkup(text: string): Run[] {
  const runs: Run[] = [];
  const re = /\*\*(.+?)\*\*|\*(.+?)\*/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) runs.push({ text: text.slice(last, m.index), style: 'regular' });
    runs.push(m[1] !== undefined ? { text: m[1], style: 'bold' } : { text: m[2], style: 'italic' });
    last = m.index! + m[0].length;
  }
  if (last < text.length) runs.push({ text: text.slice(last), style: 'regular' });
  return runs.filter(r => r.text);
}

export const stripMarkup = (t: string) => parseMarkup(t).map(r => r.text).join('');

/** Default wording of the optional line inviting the guest to the platform (no account is created). */
export const JOIN_PLATFORM_DEFAULT =
  'You are also welcome to join Smart Marina Connect, the online meeting place of the marina and yachting community: smartmarinaconnect.com/join';

export interface EmailPreview { to: string; subject: string; body: string }

/**
 * The invitation e-mail as staff see it in the preview. The optional platform line is
 * added as a last paragraph when the campaign turns it on (texts.email.join_platform_line).
 */
export function emailFor(c: Pick<InvitationCampaign, 'settings' | 'texts'>, g: (Partial<Guest> & { email?: string | null }) | null): EmailPreview {
  const vars = variablesFor(c, g);
  const e = c.texts?.email || {};
  let body = fill(e.body, vars).replace(/\r\n/g, '\n');
  const join = clean(e.join_platform_line);
  if (join) body = `${body.replace(/\s+$/, '')}\n\n${fill(join, vars)}`;
  return { to: clean(g?.email), subject: fill(e.subject, vars), body };
}

/** "2026-11-13" as "13 November 2026". */
export function dateLabel(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** Today in ISO (local date), for a letter dated today. */
export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Defaults' rule: no em dash, en dash or spaced hyphen used as punctuation. */
export function dashProblems(text: string | null | undefined): boolean {
  return DASHES.test(text || '');
}
const DASHES = new RegExp('[' + String.fromCharCode(0x2014, 0x2013) + ']| - ');
