import { fold } from '@/lib/searchSuggestions';
import type { HelpItem, HelpSection } from './helpContent';

/**
 * The help centre's search, written for how people really type a question:
 * "how do i change my password", "cant login", "email", "pending",
 * "how do i contact a marina".
 *
 * - The question is folded (accents and case ignored); "log in", "sign in",
 *   "sign up" and "e mail" become one word (so "in" and "up" are not lost), and
 *   the answers' text is joined the same way ("e-mail" reads "email"); then
 *   it is cut into words on spaces and punctuation, and small words (how, do,
 *   I, my, the…) are dropped, unless nothing else is left.
 * - A word matches an answer when one of the answer's words STARTS with it
 *   ("pass" finds "password", "email" finds "e-mails"), never in the middle of
 *   a word: "marina" does not find "smartmarinaconnect.com", "long" does not
 *   find "belong". A word ending in "s" also matches without it ("passwords").
 * - A few words people use that the answers do not: "supplier" or "vendor"
 *   also look for "service provider", "contact", "talk" and "reach" also for
 *   "message" and "write", "mail" is "email".
 * - The text of an answer: its section, question, paragraphs, steps, its id
 *   ("emails-choose" as "emails choose") and its keywords.
 * - Answers that have every word come first. When none has them all, the
 *   answers with the most words are given as "closest", but only up to
 *   CLOSEST_MAX of them: more than that is noise ("mot de passe" matched 43),
 *   and the page shows "No answer" and the contact card instead.
 * - `strong`: the answers found whose question, section title or keywords hold
 *   every word ("email" is in the title of "E-mails and unsubscribing", only in
 *   the text of "What are references?"). HelpPage shows their sections first.
 */

export type HelpIndexEntry = {
  section: HelpSection;
  item: HelpItem;
  text: string;
  /** The section title, the question and the keywords only. */
  head: string;
};

export type HelpSearch =
  | { mode: 'idle'; ids: null; strong: null }
  | { mode: 'all' | 'closest' | 'none'; ids: Set<string>; strong: Set<string> };

/** More "closest" answers than this is a wall of results: "No answer" instead. */
const CLOSEST_MAX = 6;

const STOP = new Set([
  'a', 'an', 'the', 'to', 'of', 'for', 'in', 'on', 'at', 'by', 'with', 'from', 'and', 'or', 'as', 'about',
  'is', 'are', 'am', 'be', 'was', 'it', 'its', 'this', 'that', 'there', 'here',
  'i', "i'm", 'im', 'me', 'my', 'we', 'our', 'us', 'you', 'your',
  'how', 'do', 'does', 'did', 'can', 'could', 'cant', "can't", 'cannot', 'not', 'dont', "don't", 'doesnt', "doesn't",
  'what', 'where', 'when', 'why', 'which', 'who', 'please', 'help', 'get', 'have', 'has', 'will', 'would', 'should', 'want',
]);

/** Words people type that the answers say otherwise (a word also always looks for itself). */
const PROVIDER = ['supplier', 'vendor', 'service provider'];
const REACH = ['contact', 'message', 'write', 'talk', 'reach'];
const ALSO: Record<string, string[]> = {
  supplier: PROVIDER,
  vendor: PROVIDER,
  contact: REACH,
  talk: REACH,
  reach: REACH,
  mail: ['email'],
};

const SPLIT = /[\s,;:/.!?()"“”«»]+/;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** "log in", "sign-up", "e-mails" as one word each, on both sides (the question and the answers). */
function joinPhrases(folded: string): string {
  return folded
    .replace(/\blog[\s-]*(in|on)\b/g, 'login')
    .replace(/\bsign[\s-]*in\b/g, 'signin')
    .replace(/\bsign[\s-]*up\b/g, 'signup')
    .replace(/\be[\s-]+mails?\b/g, (m) => (m.endsWith('s') ? 'emails' : 'email'));
}

/** The words of a question, folded, small words dropped (all of them kept when nothing else is left). */
export function helpQueryWords(q: string): string[] {
  const words = joinPhrases(fold(q)).split(SPLIT).map((w) => w.replace(/^['-]+|['-]+$/g, '')).filter(Boolean);
  const meaningful = words.filter((w) => !STOP.has(w));
  return Array.from(new Set(meaningful.length > 0 ? meaningful : words)).slice(0, 8);
}

export function buildHelpIndex(sections: HelpSection[]): HelpIndexEntry[] {
  return sections.flatMap((section) => section.items.map((item) => {
    const text = joinPhrases(fold([
      section.title,
      item.q,
      ...item.a,
      ...(item.steps ?? []),
      item.id.replace(/-/g, ' '),
      ...(item.keywords ?? []),
    ].join(' ')));
    const head = joinPhrases(fold([section.title, item.q, ...(item.keywords ?? [])].join(' ')));
    return { section, item, text, head };
  }));
}

/** One test per word of the question: does a word of the text start with it (or with one of its other words)? */
function wordTest(word: string): RegExp {
  const forms = new Set<string>([word]);
  // "passwords", "webinars", "emails": the singular too.
  if (word.length > 3 && word.endsWith('s')) forms.add(word.slice(0, -1));
  for (const f of Array.from(forms)) (ALSO[f] ?? []).forEach((x) => forms.add(x));
  return new RegExp(`(?:^|[^a-z0-9])(?:${Array.from(forms).map(escapeRe).join('|')})`);
}

export function searchHelp(index: HelpIndexEntry[], words: string[]): HelpSearch {
  if (words.length === 0) return { mode: 'idle', ids: null, strong: null };
  const tests = words.map(wordTest);
  const scored = index.map((entry) => ({ entry, id: entry.item.id, score: tests.filter((re) => re.test(entry.text)).length }));
  const all = scored.filter((s) => s.score === tests.length);
  if (all.length > 0) {
    const strong = new Set(all.filter((s) => tests.every((re) => re.test(s.entry.head))).map((s) => s.id));
    return { mode: 'all', ids: new Set(all.map((s) => s.id)), strong };
  }
  const best = Math.max(0, ...scored.map((s) => s.score));
  const closest = best === 0 ? [] : scored.filter((s) => s.score === best);
  if (closest.length === 0 || closest.length > CLOSEST_MAX) return { mode: 'none', ids: new Set(), strong: new Set() };
  return { mode: 'closest', ids: new Set(closest.map((s) => s.id)), strong: new Set() };
}
