/**
 * The full article HTML that a partner feed may carry (content:encoded).
 *
 * The text comes from the admin article editor (resources.content), written by
 * M3 staff; the site shows it through DOMPurify. Here an allowlist keeps what a
 * WordPress post needs and drops the rest:
 *   - script, style, iframe, object, embed, form, svg… disappear with their content;
 *   - any other unknown tag loses its markup but keeps its text;
 *   - only listed attributes survive (href and title on a link; src, alt, width
 *     and height on an image); links must be http(s), mailto or site-relative
 *     (made absolute), images http(s) or site-relative; an image without a usable
 *     source is dropped;
 *   - h1 becomes h2 (the WordPress post already has its own title).
 * Pure functions: no Deno or Netlify API, so the feed can be tested with node.
 */

const DROP_WITH_CONTENT = /<(script|style|iframe|object|embed|form|noscript|template|svg|math|select|textarea|button)\b[\s\S]*?<\/\1\s*>/gi;
const COMMENTS = /<!--[\s\S]*?-->/g;
const TAG = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
const ATTRIBUTE = /([a-zA-Z][a-zA-Z0-9:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;

const ALLOWED: Record<string, string[]> = {
  p: [], br: [], hr: [], strong: [], b: [], em: [], i: [], u: [], s: [], sub: [], sup: [], small: [],
  blockquote: [], ul: [], ol: [], li: [], h2: [], h3: [], h4: [], h5: [], h6: [], code: [], pre: [],
  a: ['href', 'title'], img: ['src', 'alt', 'width', 'height'], figure: [], figcaption: [],
  table: [], thead: [], tbody: [], tr: [], th: ['colspan', 'rowspan'], td: ['colspan', 'rowspan'],
};
const VOID = new Set(['br', 'hr', 'img']);

const attrEscape = (s: string) => s.replace(/&(?!(?:[a-zA-Z]+|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The few entities an editor writes in an address, decoded before the scheme check. */
const decodeBasic = (s: string) =>
  s.replace(/&amp;/gi, '&').replace(/&#0*58;|&#x0*3a;|&colon;/gi, ':').replace(/&#0*47;|&#x0*2f;/gi, '/').trim();

function safeUrl(raw: string, siteUrl: string, allowMailto: boolean): string | null {
  // Control characters and spaces inside a scheme are a classic way round a check.
  const url = decodeBasic(raw).replace(/[\x00-\x20]/g, (c) => (c === ' ' ? '%20' : ''));
  if (/^https?:\/\//i.test(url)) return url;
  if (allowMailto && /^mailto:/i.test(url)) return url;
  if (url.startsWith('/') && !url.startsWith('//')) return siteUrl + url;
  return null;
}

export function articleHtml(html: string, siteUrl: string): string {
  return html
    .replace(COMMENTS, '')
    .replace(DROP_WITH_CONTENT, '')
    .replace(TAG, (whole, rawName: string, rawAttrs: string) => {
      let name = rawName.toLowerCase();
      if (name === 'h1') name = 'h2';
      const allowed = ALLOWED[name];
      if (!allowed) return '';
      const closing = whole.startsWith('</');
      if (closing) return VOID.has(name) ? '' : `</${name}>`;
      const kept: string[] = [];
      for (const m of rawAttrs.matchAll(ATTRIBUTE)) {
        const attr = m[1].toLowerCase();
        if (!allowed.includes(attr)) continue;
        let value = m[2] ?? m[3] ?? m[4] ?? '';
        if (attr === 'href' || attr === 'src') {
          const safe = safeUrl(value, siteUrl, attr === 'href');
          if (!safe) continue;
          value = safe;
        }
        if ((attr === 'width' || attr === 'height' || attr === 'colspan' || attr === 'rowspan') && !/^\d{1,4}$/.test(value.trim())) continue;
        kept.push(`${attr}="${attrEscape(value)}"`);
      }
      if (name === 'img' && !kept.some((a) => a.startsWith('src='))) return '';
      const attrs = kept.length ? ' ' + kept.join(' ') : '';
      return VOID.has(name) ? `<${name}${attrs} />` : `<${name}${attrs}>`;
    })
    .trim();
}
