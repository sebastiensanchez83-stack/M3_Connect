/**
 * One way of writing a short date across the public pages, in the departures
 * board's own caps: "27 NOV", "20–21 SEP", "28 SEP 2026" (English) and
 * "27 NOV", "20–21 SEPT", "28 SEPT 2026" (French). Fixed month tables, so a
 * browser's "Sept" or "févr." never shows next to the board's "SEP".
 */
export const BOARD_MONTHS_EN = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
export const BOARD_MONTHS_FR = ['JANV', 'FÉVR', 'MARS', 'AVR', 'MAI', 'JUIN', 'JUIL', 'AOÛT', 'SEPT', 'OCT', 'NOV', 'DÉC'];

function isFrench(lang: string): boolean {
  return lang.toLowerCase().startsWith('fr');
}

/** Day, month index and year of `date` in `timeZone` (the visitor's zone when omitted). */
function parts(date: Date | string, timeZone?: string): { day: number; month: number; year: number } {
  const d = typeof date === 'string' ? new Date(date) : date;
  const p = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'numeric', year: 'numeric', timeZone }).formatToParts(d);
  const n = (type: string) => Number(p.find((x) => x.type === type)?.value ?? '0');
  return { day: n('day'), month: n('month') - 1, year: n('year') };
}

/** "SEP" / "SEPT" for a month index (0–11). */
export function boardMonth(month: number, lang: string): string {
  return (isFrench(lang) ? BOARD_MONTHS_FR : BOARD_MONTHS_EN)[month] ?? '';
}

/** "27 NOV" (two-digit day, as on the board: "05 MAY"). */
export function boardDay(date: Date | string, lang: string, timeZone?: string): string {
  const { day, month } = parts(date, timeZone);
  return `${String(day).padStart(2, '0')} ${boardMonth(month, lang)}`;
}

/** "28 SEP 2026": the board's caps with the year, for lists that span years. */
export function boardDate(date: Date | string, lang: string, timeZone?: string): string {
  const { day, month, year } = parts(date, timeZone);
  return `${day} ${boardMonth(month, lang)} ${year}`;
}

/** "20–21 SEP" for a stay within one month, else the start day: "27 NOV". */
export function boardRange(start: Date | string, end: Date | string | null | undefined, lang: string): string {
  const a = parts(start);
  if (end) {
    const b = parts(end);
    if (b.year === a.year && b.month === a.month && b.day !== a.day) return `${a.day}–${b.day} ${boardMonth(a.month, lang)}`;
  }
  return `${a.day} ${boardMonth(a.month, lang)}`;
}
