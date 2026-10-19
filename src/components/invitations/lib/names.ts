/* ─── Titles, names and greetings (Victor's rules, 16 Oct 2026) ───
 *
 * - Titles in the style of the validated kit list: Dr, Mr, Mrs, Ms, Miss without a
 *   period; Eng. and H.E. with one. "S.E." (Son Excellence) becomes "H.E.".
 * - Greeting after "Dear": a civility title, Dr or Eng. gives "Title + surname";
 *   no title gives the full name (gender is never guessed); an Excellency gives
 *   "Your Excellency" (written without "Dear").
 * - H.E. stays on the ticket and the letter. A suffix such as CFA stays on the
 *   letter, never on the ticket.
 * - Other titles (H.H., Sheikh, Prof., Capt., M., Mme...) are kept as written and
 *   flagged; so are names whose surname split is not obvious.
 * Pure functions: also run by scripts/invitations-check.mjs.
 */
import { clean } from './norm';
import { translatePosition } from './positions';

export type TitleKind = 'excellency' | 'highness' | 'doctor' | 'engineer' | 'civility' | 'other';

interface TitleRule { re: RegExp; canonical: string | null; kind: TitleKind; standard: boolean; useFirst?: boolean; read?: boolean }

// Each pattern must be followed by a space or the end, so "Drew" or "Msaad" never lose letters.
const END = '(?=\\s|$)';
const TITLE_RULES: TitleRule[] = [
  // "HE", "SE" and "HH" written without periods, in capitals only: "He" in normal case is a
  // common surname (He Wei). Read as titles, and flagged so staff check it.
  { re: new RegExp(`^(?:HE|SE)\\.?${END}`), canonical: 'H.E.', kind: 'excellency', standard: true, read: true },
  { re: new RegExp(`^HH\\.?${END}`), canonical: 'H.H.', kind: 'highness', standard: false, read: true },
  { re: new RegExp(`^(?:h\\.\\s?e\\.?|s\\.\\s?e\\.?|his excellency|her excellency|son excellence)${END}`, 'i'), canonical: 'H.E.', kind: 'excellency', standard: true },
  { re: new RegExp(`^(?:h\\.\\s?h\\.?|his highness|her highness|son altesse)${END}`, 'i'), canonical: 'H.H.', kind: 'highness', standard: false },
  { re: new RegExp(`^(?:dr\\.?|doctor|docteur)${END}`, 'i'), canonical: 'Dr', kind: 'doctor', standard: true },
  { re: new RegExp(`^(?:eng\\.?|engr\\.?|ing\\.|engineer)${END}`, 'i'), canonical: 'Eng.', kind: 'engineer', standard: true },
  { re: new RegExp(`^(?:mr\\.?|mister)${END}`, 'i'), canonical: 'Mr', kind: 'civility', standard: true },
  { re: new RegExp(`^mrs\\.?${END}`, 'i'), canonical: 'Mrs', kind: 'civility', standard: true },
  { re: new RegExp(`^ms\\.?${END}`, 'i'), canonical: 'Ms', kind: 'civility', standard: true },
  { re: new RegExp(`^miss${END}`, 'i'), canonical: 'Miss', kind: 'civility', standard: true },
  { re: new RegExp(`^(?:prof\\.?|professor|professeur)${END}`, 'i'), canonical: null, kind: 'other', standard: false },
  { re: new RegExp(`^(?:capt\\.?|captain|capitaine|cpt\\.)${END}`, 'i'), canonical: null, kind: 'other', standard: false },
  { re: new RegExp(`^(?:sheikha|sheikh|shaikha|shaikh|cheikh)${END}`, 'i'), canonical: null, kind: 'other', standard: false, useFirst: true },
  { re: new RegExp(`^(?:mme\\.?|madame|mlle\\.?|mademoiselle|monsieur|m\\.)${END}`, 'i'), canonical: null, kind: 'other', standard: false },
  { re: new RegExp(`^(?:sir|dame|lord|lady)${END}`, 'i'), canonical: null, kind: 'other', standard: false, useFirst: true },
];

export interface Title { text: string; kind: TitleKind; standard: boolean; useFirst: boolean; read?: boolean }

/** Peels the leading titles off a name: "S.E. Dr. Jane Doe" gives [H.E., Dr] and "Jane Doe". */
export function splitTitles(raw: string): { titles: Title[]; rest: string } {
  let rest = clean(raw);
  const titles: Title[] = [];
  for (let guard = 0; guard < 5; guard++) {
    const rule = TITLE_RULES.find(r => r.re.test(rest));
    if (!rule) break;
    const m = rest.match(rule.re)!;
    titles.push({ text: rule.canonical ?? m[0], kind: rule.kind, standard: rule.standard, useFirst: !!rule.useFirst, ...(rule.read ? { read: true } : {}) });
    rest = clean(rest.slice(m[0].length));
  }
  return { titles, rest };
}

/** Canonical form of a title typed on its own ("dr." gives "Dr"; "S.E." gives "H.E."). */
export function canonicalTitles(raw: string | null | undefined): Title[] {
  const { titles, rest } = splitTitles(clean(raw) + ' x');
  return rest === 'x' ? titles : [];
}

const SUFFIXES = new Set(['cfa', 'phd', 'ph.d.', 'ph.d', 'mba', 'cpa', 'acca', 'fcca', 'fca', 'aca', 'frics', 'mrics', 'obe', 'mbe',
  'cbe', 'kbe', 'dbe', 'jr', 'jr.', 'sr', 'sr.', 'ii', 'iii', 'iv', 'esq.', 'esq', 'pmp', 'cfp', 'caia', 'llm', 'msc', 'bsc', 'md', 'pe']);

/** "Jane Doe, CFA" and "Jane Doe CFA" give "Jane Doe" and "CFA". */
export function splitSuffix(raw: string): { name: string; suffix: string } {
  const s = clean(raw);
  const comma = s.indexOf(',');
  if (comma > 0) {
    const tail = clean(s.slice(comma + 1));
    if (tail && tail.length <= 30 && tail.split(/[\s,]+/).every(t => SUFFIXES.has(t.toLowerCase()) || /^[A-Z.]{2,8}$/.test(t))) {
      return { name: clean(s.slice(0, comma)), suffix: tail };
    }
  }
  const words = s.split(' ');
  const tail: string[] = [];
  while (words.length > 2 && SUFFIXES.has(words[words.length - 1].toLowerCase())) tail.unshift(words.pop()!);
  return { name: words.join(' '), suffix: tail.join(' ') };
}

// Words that belong to the surname that follows them (Al Nouri, bin Salem, de Vries...).
const PARTICLES = new Set(['al', 'el', 'bin', 'ben', 'bint', 'ibn', 'abu', 'abou', 'de', 'da', 'di', 'du', 'del', 'della', 'der',
  'den', 'van', 'von', 'le', 'la', 'st', 'st.', 'saint', 'dos', 'das', 'do', 'mac', 'mc', 'ter', 'ten', 'af', 'av']);

const isCaps = (w: string) => /\p{Lu}/u.test(w) && w === w.toUpperCase() && /\p{L}{2,}/u.test(w);
/** "AL NOURI" gives "Al Nouri"; "o'NEIL" gives "O'Neil"; hyphenated parts too. */
export function titleCase(w: string): string {
  return w.toLowerCase().replace(/(^|[\s\-'’])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase());
}

export type CheckReason =
  | 'title_other' | 'title_read' | 'name_split' | 'single_name' | 'case_changed' | 'suffix'
  | 'position_translated' | 'position_french' | 'note_check' | 'greeting_kept';

export const CHECK_LABEL: Record<CheckReason, string> = {
  title_other: 'Uncommon title kept as written: check the greeting',
  title_read: 'HE, SE or HH without periods read as a title (H.E. or H.H.): check it is not part of the name',
  name_split: 'Check the split between first name and surname',
  single_name: 'Only one name: add the first name or surname',
  case_changed: 'Capitals changed to normal case: check the spelling',
  suffix: 'Suffix kept on the letter only',
  position_translated: 'Job title translated from French: check it',
  position_french: 'Job title looks French: translate it',
  note_check: 'The notes ask for a check',
  greeting_kept: 'Greeting taken from the file (the rules would give another one)',
};

export interface ParsedName {
  honorific: string;      // "H.E. Dr"
  first: string;
  last: string;
  suffix: string;         // "CFA"
  titles: Title[];
  reasons: CheckReason[];
}

/** Splits a full contact ("S.E. Dr Jane van Doe, CFA") into its parts. */
export function parseContact(raw: string): ParsedName {
  const reasons: CheckReason[] = [];
  const { name, suffix } = splitSuffix(raw);
  const { titles, rest } = splitTitles(name);
  let words = rest.split(' ').filter(Boolean);
  if (titles.some(t => !t.standard)) reasons.push('title_other');
  if (titles.some(t => t.read)) reasons.push('title_read');
  if (suffix) reasons.push('suffix');

  let first: string[] = [];
  let last: string[] = [];
  // "DOE Jane": a list written surname first, in capitals.
  const capsLead = words.length >= 2 && isCaps(words[0]) && !words.every(isCaps);
  if (capsLead) {
    let i = 0;
    while (i < words.length - 1 && isCaps(words[i])) i++;
    last = words.slice(0, i).map(titleCase);
    first = words.slice(i);
    reasons.push('case_changed');
  } else {
    if (words.length > 1 && words.every(isCaps)) { words = words.map(titleCase); reasons.push('case_changed'); }
    if (words.length === 1) {
      last = words;
    } else if (words.length > 1) {
      let i = words.length - 1;
      while (i > 1 && PARTICLES.has(words[i - 1].toLowerCase())) i--;
      first = words.slice(0, i);
      last = words.slice(i);
    }
  }
  if (first.length + last.length > 2) reasons.push('name_split');
  if (!first.length) reasons.push('single_name');
  return { honorific: titles.map(t => t.text).join(' '), first: first.join(' '), last: last.join(' '), suffix, titles, reasons };
}

export interface NameProposal { name_on_ticket: string; name_on_letter: string; greeting: string }

/** Proposes the three printed forms from the parts. */
export function proposeNames(p: { honorific?: string | null; first?: string | null; last?: string | null; suffix?: string | null }): NameProposal {
  const titles = canonicalTitles(p.honorific);
  const honorific = titles.length ? titles.map(t => t.text).join(' ') : clean(p.honorific);
  const first = clean(p.first);
  const last = clean(p.last);
  const full = [first, last].filter(Boolean).join(' ');
  const ticket = [honorific, full].filter(Boolean).join(' ');
  const suffix = clean(p.suffix);
  return { name_on_ticket: ticket, name_on_letter: suffix ? `${ticket}, ${suffix}` : ticket, greeting: proposeGreeting(titles, honorific, first, last) };
}

function proposeGreeting(titles: Title[], honorific: string, first: string, last: string): string {
  const full = [first, last].filter(Boolean).join(' ');
  if (titles.some(t => t.kind === 'excellency')) return 'Your Excellency';
  if (titles.some(t => t.kind === 'highness')) return 'Your Highness';
  const pick = titles.find(t => t.kind === 'doctor') || titles.find(t => t.kind === 'engineer') || titles.find(t => t.kind === 'civility');
  if (pick) return last ? `${pick.text} ${last}` : `${pick.text} ${full}`.trim();
  const other = titles[0];
  if (other) return other.useFirst ? `${other.text} ${full}` : `${other.text} ${last || full}`;
  if (!titles.length && honorific) return `${honorific} ${last || full}`;
  return full;
}

/** "Dear Mr Doe" in a file becomes "Mr Doe"; "Dear Your Excellency" becomes "Your Excellency". */
export function cleanGreeting(raw: string | null | undefined): string {
  let g = clean(raw).replace(/^dear\s+/i, '').replace(/[,;:]+$/, '');
  const { titles, rest } = splitTitles(g);
  if (titles.length && rest) g = `${titles.map(t => t.text).join(' ')} ${rest}`;
  if (/^(your )?excellency$/i.test(g)) g = 'Your Excellency';
  return g;
}

/** Normalises the titles at the start of a printed name ("S.E. Jane Doe" gives "H.E. Jane Doe"). */
export function normaliseNameTitles(raw: string | null | undefined): string {
  const { titles, rest } = splitTitles(clean(raw));
  return [titles.map(t => t.text).join(' '), rest].filter(Boolean).join(' ');
}

/** The line that opens the letter and the e-mail: "Dear Mr Doe," or "Your Excellency,". */
export function salutation(greeting: string | null | undefined, fallbackName = ''): string {
  const g = clean(greeting) || clean(fallbackName);
  if (!g) return 'Dear Guest,';
  return /^your\s/i.test(g) ? `${g},` : `Dear ${g},`;
}

/** The notes ask for a check ("à vérifier", "a verifier", "to check"): as the database flags them. */
export const notesAskCheck = (notes: string | null | undefined) => /v.rifier|to (be )?check/i.test(notes || '');

/** Every reason to look at a guest again, computed from what is stored now. */
export function checkReasons(r: {
  honorific?: string | null; first_name?: string | null; last_name?: string | null; name_on_ticket?: string | null;
  name_on_letter?: string | null; position?: string | null; notes?: string | null;
}): CheckReason[] {
  const out = new Set<CheckReason>();
  const titles = r.honorific ? canonicalTitles(r.honorific) : splitTitles(r.name_on_ticket || '').titles;
  if (r.honorific && !titles.length) out.add('title_other');
  if (titles.some(t => !t.standard)) out.add('title_other');
  const words = [r.first_name, r.last_name].map(v => clean(v)).filter(Boolean).join(' ').split(' ').filter(Boolean);
  if (words.length > 2) out.add('name_split');
  if (!clean(r.first_name) || !clean(r.last_name)) out.add('single_name');
  if (r.position && translatePosition(r.position).french) out.add('position_french');
  if (notesAskCheck(r.notes)) out.add('note_check');
  return [...out];
}
