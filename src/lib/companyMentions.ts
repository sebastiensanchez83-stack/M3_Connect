import DOMPurify from 'dompurify';

/**
 * Companies mentioned in an article (Victor, 20 Oct 2026: "when an article mentions a company
 * that is on the platform, tag it and send readers to its page when clicked").
 *
 * M3 confirms the mentions in the article editor (ResourceMentionsPanel); they are stored in
 * resource_organization_mention, never in the article's HTML. At render time the article page
 * turns the FIRST occurrence of each confirmed name into a link to the company page
 * (linkFirstMentions), after DOMPurify, and lists the companies under the text.
 *
 * Matching rules, shared by the editor's suggestions and the article page:
 * - case-insensitive, whole words only ("Seares" does not match "Searesco");
 * - straight and curly apostrophes are the same, any run of spaces matches any other;
 * - names shorter than 3 characters, and a few that are words or placeholders ("M3", "N/A"…),
 *   are never matched (they can still be added by hand in the editor: they then show in the
 *   "Companies in this article" row only);
 * - longer names first, so "Port de Monaco" wins over a company called "Monaco".
 */

export interface MentionOrg {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  organization_type?: string | null;
}

/** Never matched in the text (lower case, trimmed). */
export const MENTION_STOP_LIST = new Set([
  'm3', 'n/a', 'na', 'none', 'test', 'marina', 'port', 'the marina', 'yacht club', 'monaco',
]);

/** Whether a company name may be looked for in an article's text. */
export function isMatchableName(name: string | null | undefined): boolean {
  const n = (name ?? '').trim().replace(/\s+/g, ' ');
  if (n.length < 3) return false;
  return !MENTION_STOP_LIST.has(n.toLowerCase());
}

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The search pattern of one name (global, case-insensitive, unicode). Null when not matchable. */
export function namePattern(name: string): RegExp | null {
  if (!isMatchableName(name)) return null;
  const parts = name.trim().split(/\s+/).map((w) => escapeRegExp(w).replace(/['’]/g, "['’]"));
  return new RegExp(parts.join('[\\s\\u00a0]+'), 'giu');
}

/** Where a whole-word occurrence of the pattern starts in the text, from `from`; -1 when none. */
function findWhole(text: string, re: RegExp, from = 0): { index: number; length: number } | null {
  re.lastIndex = from;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const before = m.index > 0 ? text[m.index - 1] : '';
    const after = text[m.index + m[0].length] ?? '';
    if (!LETTER_OR_DIGIT.test(before) && !LETTER_OR_DIGIT.test(after)) return { index: m.index, length: m[0].length };
    re.lastIndex = m.index + 1;
  }
  return null;
}

/** How many whole-word times the name appears in a plain text. */
export function countMentions(text: string, name: string): number {
  const re = namePattern(name);
  if (!re || !text) return 0;
  let n = 0;
  let from = 0;
  for (;;) {
    const hit = findWhole(text, re, from);
    if (!hit) return n;
    n += 1;
    from = hit.index + hit.length;
  }
}

/** The readable text of an article's HTML (the editor's scan). */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return '';
  if (typeof DOMParser === 'undefined') return html.replace(/<[^>]*>/g, ' ');
  const doc = new DOMParser().parseFromString(html, 'text/html');
  // Block elements end with a space, so two paragraphs never glue two words together.
  doc.querySelectorAll('p, div, li, h1, h2, h3, h4, h5, h6, br, td, th, blockquote, figcaption').forEach((el) => el.append(' '));
  return (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** The companies whose names appear in the text, most mentioned first, then by name. */
export function suggestMentions<T extends MentionOrg>(text: string, orgs: T[]): { org: T; count: number }[] {
  if (!text) return [];
  const out: { org: T; count: number }[] = [];
  for (const org of orgs) {
    const count = countMentions(text, org.name);
    if (count > 0) out.push({ org, count });
  }
  return out.sort((a, b) => b.count - a.count || a.org.name.localeCompare(b.org.name));
}

/** Text inside these is never turned into a link. */
const SKIP_TAGS = new Set(['A', 'BUTTON', 'CODE', 'PRE', 'SCRIPT', 'STYLE', 'TEXTAREA', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6']);

/** The company page of a mention. */
export function mentionHref(slug: string): string {
  return `/organizations/${encodeURIComponent(slug)}`;
}

/**
 * The article's HTML with the first occurrence of each company's name linked to its page.
 * `html` must already be sanitized; the result is sanitized again before it is returned, so
 * what reaches the page is always DOMPurify's output. The stored article is never changed.
 */
export function linkFirstMentions(html: string, orgs: MentionOrg[]): string {
  if (!html || orgs.length === 0 || typeof DOMParser === 'undefined') return html;
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const body = doc.body;
  const ordered = [...orgs]
    .filter((o) => o.slug && isMatchableName(o.name))
    .sort((a, b) => b.name.trim().length - a.name.trim().length);
  if (ordered.length === 0) return html;

  const skipped = (node: Node): boolean => {
    for (let el = node.parentElement; el && el !== body; el = el.parentElement) {
      if (SKIP_TAGS.has(el.tagName)) return true;
    }
    return false;
  };

  for (const org of ordered) {
    const re = namePattern(org.name);
    if (!re) continue;
    const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode() as Text | null;
    while (node) {
      if (!skipped(node)) {
        const hit = findWhole(node.data, re);
        if (hit) {
          const target = node.splitText(hit.index);
          target.splitText(hit.length);
          const a = doc.createElement('a');
          a.setAttribute('href', mentionHref(org.slug));
          a.setAttribute('class', 'smc-mention');
          a.setAttribute('data-org-mention', org.slug);
          a.textContent = target.data;
          target.replaceWith(a);
          break;
        }
      }
      node = walker.nextNode() as Text | null;
    }
  }
  return DOMPurify.sanitize(body.innerHTML);
}

/** Accent- and case-insensitive key, for the editor's "add a company" search. */
export function foldName(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
