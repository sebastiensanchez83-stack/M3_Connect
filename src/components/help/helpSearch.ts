import { fold } from '@/lib/searchSuggestions';
import type { HelpItem, HelpSection } from './helpContent';

/**
 * The help centre's search, written for how people really type a question:
 * "how do I change my password", "cant login", "email", "pending".
 *
 * - The question is folded (accents and case ignored); "log in", "sign in",
 *   "sign up" and "e mail" become one word (so "in" and "up" are not lost);
 *   then it is cut into words on spaces and punctuation, and small words (how,
 *   do, I, my, the…) are dropped, unless nothing else is left.
 * - A word matches an answer when the answer's text holds it, or holds it once
 *   spaces, hyphens and apostrophes are removed on both sides ("email" finds
 *   "e-mail", "login" finds "log in", "signup" finds "sign up"), or holds it
 *   without a final "s" ("passwords").
 * - The text of an answer: its section, question, paragraphs, steps, its id
 *   ("emails-choose" as "emails choose") and its keywords.
 * - Answers that have every word come first. When none has them all, the
 *   answers with the most words are given as "closest" (never answers with
 *   none of them).
 * - `strong`: the answers found whose question, section title or keywords hold
 *   every word ("email" is in the title of "E-mails and unsubscribing", only in
 *   the text of "What are references?"). HelpPage shows their sections first.
 */

export type HelpIndexEntry = {
  section: HelpSection;
  item: HelpItem;
  text: string;
  compact: string;
  /** The section title, the question and the keywords only. */
  head: string;
  headCompact: string;
};

export type HelpSearch =
  | { mode: 'idle'; ids: null; strong: null }
  | { mode: 'all' | 'closest' | 'none'; ids: Set<string>; strong: Set<string> };

const STOP = new Set([
  'a', 'an', 'the', 'to', 'of', 'for', 'in', 'on', 'at', 'by', 'with', 'from', 'and', 'or', 'as', 'about',
  'is', 'are', 'am', 'be', 'was', 'it', 'its', 'this', 'that', 'there', 'here',
  'i', "i'm", 'im', 'me', 'my', 'we', 'our', 'us', 'you', 'your',
  'how', 'do', 'does', 'did', 'can', 'could', 'cant', "can't", 'cannot', 'not', 'dont', "don't", 'doesnt', "doesn't",
  'what', 'where', 'when', 'why', 'which', 'who', 'please', 'help', 'get', 'have', 'has', 'will', 'would', 'should', 'want',
]);

const SPLIT = /[\s,;:/.!?()"“”«»]+/;
const squash = (s: string) => s.replace(/[\s'-]+/g, '');

/** The words of a question, folded, small words dropped (all of them kept when nothing else is left). */
export function helpQueryWords(q: string): string[] {
  const joined = fold(q)
    .replace(/\blog[\s-]*(in|on)\b/g, 'login')
    .replace(/\bsign[\s-]*in\b/g, 'signin')
    .replace(/\bsign[\s-]*up\b/g, 'signup')
    .replace(/\be[\s-]+mails?\b/g, (m) => (m.endsWith('s') ? 'emails' : 'email'));
  const words = joined.split(SPLIT).map((w) => w.replace(/^['-]+|['-]+$/g, '')).filter(Boolean);
  const meaningful = words.filter((w) => !STOP.has(w));
  return Array.from(new Set(meaningful.length > 0 ? meaningful : words)).slice(0, 8);
}

export function buildHelpIndex(sections: HelpSection[]): HelpIndexEntry[] {
  return sections.flatMap((section) => section.items.map((item) => {
    const text = fold([
      section.title,
      item.q,
      ...item.a,
      ...(item.steps ?? []),
      item.id.replace(/-/g, ' '),
      ...(item.keywords ?? []),
    ].join(' '));
    const head = fold([section.title, item.q, ...(item.keywords ?? [])].join(' '));
    return { section, item, text, compact: squash(text), head, headCompact: squash(head) };
  }));
}

function holds(text: string, compact: string, word: string): boolean {
  if (text.includes(word)) return true;
  const w = squash(word);
  if (w.length > 1 && compact.includes(w)) return true;
  // "passwords", "webinars", "emails": the singular.
  if (w.length > 3 && w.endsWith('s') && compact.includes(w.slice(0, -1))) return true;
  return false;
}

const matches = (entry: HelpIndexEntry, word: string) => holds(entry.text, entry.compact, word);
const matchesHead = (entry: HelpIndexEntry, word: string) => holds(entry.head, entry.headCompact, word);

export function searchHelp(index: HelpIndexEntry[], words: string[]): HelpSearch {
  if (words.length === 0) return { mode: 'idle', ids: null, strong: null };
  const scored = index.map((entry) => ({ entry, id: entry.item.id, score: words.filter((w) => matches(entry, w)).length }));
  const all = scored.filter((s) => s.score === words.length);
  if (all.length > 0) {
    const strong = new Set(all.filter((s) => words.every((w) => matchesHead(s.entry, w))).map((s) => s.id));
    return { mode: 'all', ids: new Set(all.map((s) => s.id)), strong };
  }
  const best = Math.max(0, ...scored.map((s) => s.score));
  if (best === 0) return { mode: 'none', ids: new Set(), strong: new Set() };
  return { mode: 'closest', ids: new Set(scored.filter((s) => s.score === best).map((s) => s.id)), strong: new Set() };
}
