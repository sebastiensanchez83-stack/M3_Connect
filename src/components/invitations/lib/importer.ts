/* ─── Import: columns, proposals, duplicates ───
 *
 * Victor's usual Excel: sheet "Prêts pour invitation", columns #, Pays / Région,
 * Organisation, Contact, Poste, Notes. The kit CSV: name_on_ticket, name_on_letter,
 * greeting, position, organisation, email, notes. Any other list maps by hand.
 * Nothing is merged: a duplicate is shown with what it matches, and staff choose.
 * Pure functions (no browser API).
 */
import { clean, isEmail, normKey, personKey } from './norm';
import {
  type CheckReason, cleanGreeting, normaliseNameTitles, notesAskCheck, parseContact, proposeNames, splitSuffix,
} from './names';
import { translatePosition } from './positions';

export type FieldKey =
  | 'order' | 'contact' | 'honorific' | 'first_name' | 'last_name' | 'name_on_ticket' | 'name_on_letter' | 'greeting'
  | 'position' | 'organisation' | 'country' | 'email' | 'phone' | 'notes';

export const FIELDS: { key: FieldKey; label: string; names: string[] }[] = [
  { key: 'order', label: 'Order (#)', names: ['#', 'no', 'n', 'n°', 'num', 'number', 'ordre', 'order', 'rang'] },
  { key: 'contact', label: 'Full name with title (Contact)', names: ['contact', 'name', 'nom', 'full name', 'nom complet', 'guest', 'invite', 'personne', 'participant'] },
  { key: 'honorific', label: 'Title (Mr, Dr, H.E.)', names: ['civilite', 'civility', 'honorific', 'titre de civilite', 'salutation title'] },
  { key: 'first_name', label: 'First name', names: ['first name', 'firstname', 'first', 'prenom', 'given name'] },
  { key: 'last_name', label: 'Surname', names: ['last name', 'lastname', 'surname', 'nom de famille', 'family name'] },
  { key: 'name_on_ticket', label: 'Name on ticket', names: ['name on ticket', 'nom sur le ticket', 'nom ticket'] },
  { key: 'name_on_letter', label: 'Name on letter', names: ['name on letter', 'nom sur la lettre', 'nom lettre'] },
  { key: 'greeting', label: 'Greeting (after "Dear")', names: ['greeting', 'salutation', 'formule', 'formule de politesse', 'dear'] },
  { key: 'position', label: 'Job title', names: ['position', 'poste', 'job title', 'fonction', 'role', 'title', 'titre'] },
  { key: 'organisation', label: 'Organisation', names: ['organisation', 'organization', 'company', 'societe', 'entreprise', 'institution', 'organisme', 'employer'] },
  { key: 'country', label: 'Country', names: ['pays / region', 'pays/region', 'pays', 'country', 'region', 'country / region', 'country/region'] },
  { key: 'email', label: 'E-mail', names: ['email', 'e mail', 'mail', 'courriel', 'adresse e mail', 'adresse email', 'email address'] },
  { key: 'phone', label: 'Phone', names: ['phone', 'telephone', 'tel', 'mobile', 'portable', 'phone number'] },
  { key: 'notes', label: 'Notes', names: ['notes', 'note', 'comment', 'comments', 'commentaire', 'commentaires', 'remarque', 'remarques'] },
];

export const headerKey = (h: string) => h.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  .replace(/[_-]+/g, ' ').replace(/[:*]+$/g, '').replace(/\s+/g, ' ').trim();

export type Mapping = Partial<Record<FieldKey, number>>;

/** The header row: the first of the first ten rows that names at least two known columns. */
export function findHeaderRow(rows: string[][]): number {
  let best = -1; let bestScore = 0;
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const keys = (rows[i] || []).map(headerKey);
    const score = FIELDS.filter(f => keys.some(k => f.names.includes(k))).length;
    if (score >= 2) return i;
    if (score > bestScore) { best = i; bestScore = score; }
  }
  if (best >= 0) return best;
  return Math.max(0, rows.findIndex(r => (r || []).some(c => clean(c))));
}

export function guessMapping(header: string[]): Mapping {
  const keys = header.map(headerKey);
  const m: Mapping = {};
  const used = new Set<number>();
  for (const f of FIELDS) {
    const i = keys.findIndex((k, idx) => !used.has(idx) && f.names.includes(k));
    if (i >= 0) { m[f.key] = i; used.add(i); }
  }
  // A file with name_on_ticket does not need Contact; a "Name" column then means nothing more.
  return m;
}

export const DEFAULT_SHEET = 'Prêts pour invitation';
export function pickSheet(names: string[]): number {
  const want = headerKey(DEFAULT_SHEET);
  const i = names.findIndex(n => headerKey(n) === want);
  return i >= 0 ? i : 0;
}

/** One guest read from the file, with the module's proposals. */
export interface ImportDraft {
  line: number;                 // line number in the file (1-based, header included)
  order: number | null;
  honorific: string;
  first_name: string;
  last_name: string;
  name_on_ticket: string;
  name_on_letter: string;
  greeting: string;
  /** The greeting the rules would give, when the file's own differs. */
  suggested_greeting: string | null;
  position: string;
  position_original: string | null;
  organisation: string;
  country: string;
  email: string;
  email_invalid: boolean;
  phone: string;
  notes: string;
  reasons: CheckReason[];
}

export function buildDrafts(rows: string[][], headerRow: number, map: Mapping): ImportDraft[] {
  const out: ImportDraft[] = [];
  const at = (r: string[], k: FieldKey) => (map[k] === undefined ? '' : clean(r[map[k] as number]));
  for (let i = headerRow + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    if (!r.some(c => clean(c))) continue;
    const reasons = new Set<CheckReason>();
    const contact = at(r, 'contact');
    const ticketIn = at(r, 'name_on_ticket');
    const letterIn = at(r, 'name_on_letter');
    const firstIn = at(r, 'first_name');
    const lastIn = at(r, 'last_name');
    const honorificIn = at(r, 'honorific');

    // The parts: from first/last columns when present, else from the full name.
    const source = contact || ticketIn || letterIn || [honorificIn, firstIn, lastIn].filter(Boolean).join(' ');
    if (!source) continue;
    const parsed = parseContact(source);
    parsed.reasons.forEach(x => reasons.add(x));
    let honorific = parsed.honorific;
    let first = parsed.first;
    let last = parsed.last;
    if (firstIn || lastIn) {
      first = firstIn; last = lastIn;
      reasons.delete('name_split'); reasons.delete('single_name');
      if (!firstIn || !lastIn) reasons.add('single_name');
    }
    if (honorificIn) honorific = parseContact(`${honorificIn} x`).honorific || honorificIn;
    // The suffix ("CFA") may come from the letter column of the kit CSV.
    const suffix = parsed.suffix || (letterIn ? splitSuffix(letterIn).suffix : '');

    const proposal = proposeNames({ honorific, first, last, suffix });
    const name_on_ticket = ticketIn ? normaliseNameTitles(splitSuffix(ticketIn).name) : proposal.name_on_ticket;
    const name_on_letter = letterIn ? normaliseNameTitles(letterIn) : (ticketIn && suffix ? `${name_on_ticket}, ${suffix}` : (ticketIn ? name_on_ticket : proposal.name_on_letter));
    const greetIn = cleanGreeting(at(r, 'greeting'));
    const greeting = greetIn || proposal.greeting;
    const suggested = greetIn && greetIn !== proposal.greeting ? proposal.greeting : null;
    if (suggested) reasons.add('greeting_kept');

    const pos = translatePosition(at(r, 'position'));
    if (pos.translated) reasons.add('position_translated');
    if (pos.french) reasons.add('position_french');
    const notes = at(r, 'notes');
    if (notesAskCheck(notes)) reasons.add('note_check');
    const email = at(r, 'email').toLowerCase();
    const orderRaw = at(r, 'order');
    const order = /^\d{1,5}$/.test(orderRaw) ? Number(orderRaw) : null;

    out.push({
      line: i + 1, order, honorific, first_name: first, last_name: last,
      name_on_ticket: name_on_ticket || [first, last].filter(Boolean).join(' '),
      name_on_letter, greeting, suggested_greeting: suggested,
      position: pos.text, position_original: pos.translated ? at(r, 'position') : null,
      organisation: at(r, 'organisation'), country: at(r, 'country'), email,
      email_invalid: !!email && !isEmail(email), phone: at(r, 'phone'), notes, reasons: [...reasons],
    });
  }
  return out;
}

/* ─── Duplicates ─── */

/** Something already known that a new guest may be: a campaign guest or a guest-list row. */
export interface KnownPerson {
  kind: 'recipient' | 'guest';
  id: string;
  /** This campaign, another campaign of the same event, or the event's guest list. */
  where: 'this' | 'other_campaign' | 'guest_list';
  campaign_name?: string;
  label: string;
  email: string | null;
  name_key: string;
  org_key: string;
  status: string;
  /** gl_guest.source for a guest-list row. */
  source?: string;
}

export interface DuplicateHit { person: KnownPerson; on: 'email' | 'name_org' | 'name' }

export function findHits(d: Pick<ImportDraft, 'email' | 'first_name' | 'last_name' | 'name_on_ticket' | 'organisation'>, known: KnownPerson[]): DuplicateHit[] {
  const key = personKey(d);
  const org = normKey(d.organisation, false);
  const email = d.email ? d.email.toLowerCase() : '';
  const hits: DuplicateHit[] = [];
  for (const p of known) {
    if (email && p.email && p.email.toLowerCase() === email) hits.push({ person: p, on: 'email' });
    // Same name and the same organisation, an empty one on both sides included.
    else if (key && p.name_key === key) hits.push({ person: p, on: p.org_key === org ? 'name_org' : 'name' });
  }
  const rank = { email: 0, name_org: 1, name: 2 } as const;
  return hits.sort((a, b) => rank[a.on] - rank[b.on]);
}

export type ImportChoice = 'import' | 'skip';

/**
 * What happens to a row unless staff change it. Same e-mail anywhere on this event, or
 * same name and organisation in this campaign: skipped (one person, one invitation).
 * A pending /wys26 request: imported, flagged, adoption chosen per row. Name matches
 * elsewhere: imported and flagged.
 */
export function defaultChoice(hits: DuplicateHit[], earlierInFile: boolean): ImportChoice {
  if (earlierInFile) return 'skip';
  for (const h of hits) {
    if (h.on === 'email') {
      if (h.person.where === 'guest_list' && h.person.status === 'requested' && h.person.source === 'request') continue;
      return 'skip';
    }
    if (h.on === 'name_org' && h.person.where === 'this') return 'skip';
  }
  return 'import';
}

/** Same e-mail, or same name and organisation, as an earlier row of the same file. */
export function earlierInFile(drafts: ImportDraft[]): Set<number> {
  const seen = new Set<string>();
  const dup = new Set<number>();
  drafts.forEach((d, i) => {
    const keys = [d.email ? `e:${d.email}` : '', `n:${personKey(d)}|${normKey(d.organisation, false)}`].filter(Boolean);
    if (keys.some(k => seen.has(k))) dup.add(i);
    keys.forEach(k => seen.add(k));
  });
  return dup;
}

export const HIT_LABEL = { email: 'Same e-mail', name_org: 'Same name and organisation', name: 'Same name' } as const;
export const WHERE_LABEL = { this: 'in this campaign', other_campaign: 'in another campaign of this event', guest_list: 'on the event guest list' } as const;
