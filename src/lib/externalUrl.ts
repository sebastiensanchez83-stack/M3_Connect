/**
 * An address typed by a person into a "website" field, made safe to use as a
 * link's href.
 *
 * Team- and member-entered values are often scheme-less ("www.plusmarine.com",
 * "urbanthink.eu") or slightly malformed ("https:/www.eurazeo.com"). A scheme-
 * less href is resolved by the browser against the current page, so a new tab
 * opens on /organizations/www.plusmarine.com (an in-site "not found") instead of
 * the company's site. Returns null when there is nothing usable (empty, or a
 * script-like scheme), so callers can skip the link.
 */
export function externalUrl(raw: string | null | undefined): string | null {
  const value = (raw ?? '').trim();
  if (!value) return null;
  // "https:/www.x.com" (one slash) -> "https://www.x.com"
  const fixed = value.replace(/^(https?):\/(?!\/)/i, '$1://');
  if (/^https?:\/\//i.test(fixed)) return fixed;
  if (fixed.startsWith('//')) return `https:${fixed}`;
  // Never turn a script-like or local scheme into a link.
  if (/^(javascript|data|vbscript|file|blob):/i.test(fixed)) return null;
  return `https://${fixed}`;
}
