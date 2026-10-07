/**
 * The background colour a wave edge must melt into.
 *
 * A hero's bottom waterline is painted in the colour of whatever comes next on
 * the page (white, gray-50, the new page grey…), and pages differ. Rather than
 * making every page pass a colour, we read it: the next section's own
 * background, or its first full-width child's, or failing that the nearest
 * ancestor's, or white.
 */

const TRANSPARENT = /^(transparent|rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\))$/i;

function solidBackground(el: Element | null): string | null {
  if (!el) return null;
  const bg = getComputedStyle(el).backgroundColor;
  if (!bg || TRANSPARENT.test(bg)) return null;
  // Semi-transparent colours would show the wave through: only trust opaque ones.
  const m = bg.match(/rgba\([^)]*,\s*([\d.]+)\s*\)$/);
  if (m && parseFloat(m[1]) < 0.95) return null;
  return bg;
}

/** Background of the content that follows `el` (down to 3 levels into it), else of its ancestors. */
export function backgroundBelow(el: HTMLElement): string {
  const width = el.getBoundingClientRect().width;
  let next: Element | null = el.nextElementSibling;
  // Skip invisible siblings (script/style/sr-only bits, Helmet leaves nothing in the body).
  while (next && next.getBoundingClientRect().height === 0) next = next.nextElementSibling;
  let probe: Element | null = next;
  for (let depth = 0; probe && depth < 4; depth++) {
    const bg = solidBackground(probe);
    if (bg) return bg;
    const child: Element | null = probe.firstElementChild;
    // Only follow a child that spans the band, or we would pick a card's white.
    if (!child || child.getBoundingClientRect().width < width - 2) break;
    probe = child;
  }
  return backgroundBehind(el);
}

/** Background of the nearest ancestor that paints one, else white. */
export function backgroundBehind(el: HTMLElement): string {
  let parent: HTMLElement | null = el.parentElement;
  while (parent) {
    const bg = solidBackground(parent);
    if (bg) return bg;
    parent = parent.parentElement;
  }
  return solidBackground(document.body) ?? '#ffffff';
}

/** Background of the content just above `el` (its previous sibling's last full-width descendants). */
export function backgroundAbove(el: HTMLElement): string {
  const width = el.getBoundingClientRect().width;
  let prev: Element | null = el.previousElementSibling;
  while (prev && prev.getBoundingClientRect().height === 0) prev = prev.previousElementSibling;
  let probe: Element | null = prev;
  let found: string | null = null;
  // Walk down the last children: the deepest full-width one with a background wins.
  for (let depth = 0; probe && depth < 6; depth++) {
    found = solidBackground(probe) ?? found;
    let child: Element | null = probe.lastElementChild;
    while (child && child.getBoundingClientRect().height === 0) child = child.previousElementSibling;
    if (!child || child.getBoundingClientRect().width < width - 2) break;
    probe = child;
  }
  return found ?? backgroundBehind(el);
}
