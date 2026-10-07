/**
 * Small text helpers for page titles and meta descriptions.
 *
 * The rules (design-seo study, B.1): a title is at most 60 characters and only
 * gets the " | Smart Marina Connect" suffix when the whole still fits; a meta
 * description is at most 155 characters, cut at a word, never mid-word.
 * The words themselves live in the i18n `seo` object (src/i18n/seo.ts).
 */

export const SITE_NAME = 'Smart Marina Connect';
export const TITLE_MAX = 60;
export const DESCRIPTION_MAX = 155;

/** Collapses whitespace and strips the markdown/HTML a description field may carry. */
function plain(text: string): string {
  return text
    .replace(/<[^>]+>/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#*_`>[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Cuts at the last whole word that fits, then adds an ellipsis. */
export function cutAtWord(text: string, max: number = DESCRIPTION_MAX): string {
  const clean = plain(text);
  if (clean.length <= max) return clean;
  const slice = clean.slice(0, max - 1);
  const lastSpace = slice.lastIndexOf(' ');
  const cut = (lastSpace > max * 0.5 ? slice.slice(0, lastSpace) : slice).replace(/[\s,;:.–—-]+$/, '');
  return `${cut}…`;
}

/** "Title | Smart Marina Connect" when it fits in 60 characters and the title does not already name the site. */
export function withSiteSuffix(title: string): string {
  const clean = plain(title);
  if (clean.includes(SITE_NAME)) return clean;
  const full = `${clean} | ${SITE_NAME}`;
  return full.length <= TITLE_MAX ? full : clean;
}

/**
 * Dates in titles and descriptions are read in Monaco time, not in the
 * reader's: the same text is written by the browser and by the Netlify edge
 * function (netlify/edge-functions/seo.ts, which runs in UTC), and the two
 * must agree on the day.
 */
const SEO_TIME_ZONE = 'Europe/Monaco';

/** [year, month, day] of an instant, in Monaco. */
function calendarDay(d: Date): [number, number, number] {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: SEO_TIME_ZONE, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(d);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return [get('year'), get('month'), get('day')];
}

/** "20–21 Sept 2026", "30 Sept – 2 Oct 2026" or "20 Sept 2026", in the reader's language. */
export function shortDateRange(startIso: string, endIso: string | null | undefined, locale: string): string {
  const start = new Date(startIso);
  const end = endIso ? new Date(endIso) : null;
  const tz = { timeZone: SEO_TIME_ZONE };
  const full = (d: Date) => d.toLocaleDateString(locale, { ...tz, day: 'numeric', month: 'short', year: 'numeric' });
  const [sy, sm, sd] = calendarDay(start);
  const [ey, em, ed] = end ? calendarDay(end) : [sy, sm, sd];
  if (!end || (ey === sy && em === sm && ed === sd)) return full(start);
  if (ey === sy && em === sm) {
    const monthYear = start.toLocaleDateString(locale, { ...tz, month: 'short', year: 'numeric' });
    return `${sd}–${ed} ${monthYear}`;
  }
  const dayMonth = (d: Date) => d.toLocaleDateString(locale, { ...tz, day: 'numeric', month: 'short' });
  return `${dayMonth(start)} – ${full(end)}`;
}
