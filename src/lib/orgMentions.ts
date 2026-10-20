import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { orgPath } from '@/lib/seoMeta';

/**
 * Companies named in an article become links to their page (Victor, 20 Oct 2026:
 * "quand un article mentionne une entreprise qui est dans la plateforme il faut
 * que ça la tag et redirige sur son profil").
 *
 * Nothing to do for the editor: when an article is shown, its text is matched
 * against the names of the verified companies of the directory.
 *  - The FIRST mention of each company becomes a link to its page (a dotted
 *    underline, .smc-org-mention in refonte-content.css); later mentions stay
 *    plain text, as in a press article.
 *  - The companies found are also listed under the article ("Companies in this
 *    article"), as tags with their logo.
 *  - A name inside a link the editor made is never linked again (the editor's
 *    link wins) but the company still goes in the list. Headings, code and
 *    captions are left alone.
 *  - Matching is whole words, any case, but the match must start with a
 *    capital or a digit (a company name in a sentence), and the longest name
 *    wins ("Port de Monaco Services" before "Port de Monaco"). Names under 4
 *    characters and a few everyday words are never matched.
 *
 * Runs in the browser on the already sanitized HTML (DOMPurify) and only adds
 * <a> elements built with DOM methods, so it cannot open a hole the sanitizer
 * closed. A failed read of the company list simply means no links.
 */

export interface MentionOrg {
  id: string;
  slug: string;
  name: string;
  logo_url: string | null;
  organization_type: string | null;
}

/** Single words that are company names on the platform but also everyday words. */
const COMMON_WORDS = new Set([
  'admiral', 'marina', 'marinas', 'monaco', 'dubai', 'port', 'ports', 'harbour', 'harbor', 'yacht', 'yachts',
  'yachting', 'ocean', 'sea', 'blue', 'green', 'smart', 'connect', 'sustainable', 'future', 'energy', 'water',
]);
const MIN_LENGTH = 4;
/** Never inside these: links, headings, code, buttons, form text. */
const SKIP_TAGS = new Set(['A', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'CODE', 'PRE', 'BUTTON', 'SCRIPT', 'STYLE', 'TEXTAREA', 'SELECT', 'OPTION', 'FIGCAPTION']);

let cache: Promise<MentionOrg[]> | null = null;

export function fetchMentionOrgs(): Promise<MentionOrg[]> {
  if (!cache) {
    cache = Promise.resolve(
      supabase
        .from('organizations')
        .select('id, slug, name, logo_url, organization_type')
        .eq('access_status', 'verified'),
    )
      .then(({ data, error }) => (error || !Array.isArray(data) ? [] : (data as MentionOrg[])))
      .catch(() => []);
  }
  return cache;
}

export function useMentionOrgs(enabled: boolean): MentionOrg[] | null {
  const [orgs, setOrgs] = useState<MentionOrg[] | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void fetchMentionOrgs().then((list) => { if (alive) setOrgs(list); });
    return () => { alive = false; };
  }, [enabled]);
  return orgs;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Spaces in a name match any run of spaces (an article may break a line inside it). */
const namePattern = (name: string) => name.trim().split(/\s+/).map(escapeRe).join('\\s+');
const fold = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

function usableName(name: string | null | undefined): name is string {
  const n = (name ?? '').trim();
  if (n.length < MIN_LENGTH) return false;
  if (!/[\p{L}]/u.test(n)) return false;
  if (!/\s/.test(n) && COMMON_WORDS.has(n.toLowerCase())) return false;
  return true;
}

export interface MentionResult {
  html: string;
  /** The companies found, in their order of first appearance. */
  mentioned: MentionOrg[];
}

/**
 * Adds a link on the first mention of each company in `html` (already
 * sanitized). Returns the HTML unchanged when nothing matches.
 */
export function linkOrgMentions(html: string, orgs: MentionOrg[]): MentionResult {
  if (!html || orgs.length === 0 || typeof DOMParser === 'undefined') return { html, mentioned: [] };

  // One company per folded name (two pages with the same name: neither is linked, we cannot tell which).
  const byName = new Map<string, MentionOrg | null>();
  for (const o of orgs) {
    if (!o.slug || !usableName(o.name)) continue;
    const key = fold(o.name);
    byName.set(key, byName.has(key) ? null : o);
  }
  const names = [...byName.entries()].filter((e): e is [string, MentionOrg] => e[1] !== null);
  if (names.length === 0) return { html, mentioned: [] };
  names.sort((a, b) => b[0].length - a[0].length);
  // A word boundary that knows accents. The character before the name is captured
  // (group 1) rather than looked behind, for older Safari.
  let re: RegExp;
  try {
    re = new RegExp(`(^|[^\\p{L}\\p{N}_])(${names.map(([, o]) => namePattern(o.name)).join('|')})(?![\\p{L}\\p{N}_])`, 'giu');
  } catch {
    return { html, mentioned: [] };
  }

  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  // Text inside the editor's own links is read (the company still goes in the
  // list under the article) but never wrapped in a second link.
  const inEditorLink = (node: Node) => !!node.parentElement?.closest('a');
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      for (let el = node.parentElement; el && el !== doc.body; el = el.parentElement) {
        if (el.tagName !== 'A' && SKIP_TAGS.has(el.tagName)) return NodeFilter.FILTER_REJECT;
      }
      return node.nodeValue && node.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  const textNodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) textNodes.push(n as Text);

  const linked = new Set<string>();
  const listed = new Set<string>();
  const mentioned: MentionOrg[] = [];
  for (const node of textNodes) {
    const text = node.nodeValue ?? '';
    const listOnly = inEditorLink(node);
    re.lastIndex = 0;
    const parts: (string | { org: MentionOrg; text: string })[] = [];
    let last = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      const found = m[2];
      const at = m.index + m[1].length;
      // A company name in a sentence starts with a capital or a digit.
      if (!/[\p{Lu}\p{Lt}\p{N}]/u.test(found.charAt(0))) continue;
      const org = byName.get(fold(found));
      if (!org) continue;
      if (!listed.has(org.id)) { listed.add(org.id); mentioned.push(org); }
      if (listOnly || linked.has(org.id)) continue;
      linked.add(org.id);
      if (at > last) parts.push(text.slice(last, at));
      parts.push({ org, text: found });
      last = at + found.length;
    }
    if (parts.length === 0) continue;
    if (last < text.length) parts.push(text.slice(last));
    const frag = doc.createDocumentFragment();
    for (const p of parts) {
      if (typeof p === 'string') { frag.appendChild(doc.createTextNode(p)); continue; }
      const a = doc.createElement('a');
      a.setAttribute('href', orgPath(p.org.slug));
      a.setAttribute('class', 'smc-org-mention');
      a.setAttribute('data-org-mention', p.org.slug);
      a.setAttribute('title', `${p.org.name} on Smart Marina Connect`);
      a.textContent = p.text;
      frag.appendChild(a);
    }
    node.parentNode?.replaceChild(frag, node);
  }

  if (linked.size === 0) return { html, mentioned };
  return { html: doc.body.innerHTML, mentioned };
}
