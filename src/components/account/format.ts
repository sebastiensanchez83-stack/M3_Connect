/** Small formatting helpers of the member area's editors (moved from the old AccountPage). */

/** snake_case → "Snake Case", for raw values that have no label of their own. */
export function humanize(raw: string): string {
  return raw.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Raw budget_range values ("50000-100000", "under_10k") as readable labels. */
export function formatBudgetRange(raw: string, under10kLabel: string): string {
  if (raw === 'under_10k') return under10kLabel;
  const m = raw.match(/^(\d+)-(\d+)$/);
  if (m) {
    const fmt = (n: number) => (n >= 1_000_000 ? `€${n / 1_000_000}M` : `€${(n / 1_000).toFixed(0)}k`);
    return `${fmt(Number(m[1]))} – ${fmt(Number(m[2]))}`;
  }
  return humanize(raw);
}

/** The interface language's date locale (the interface is English; kept for the French resources still loaded). */
export function uiLocale(language: string | undefined): string {
  return language?.startsWith('fr') ? 'fr-FR' : 'en-GB';
}

/** "12 Oct 2026" by default. */
export function formatDay(iso: string, locale: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }): string {
  return new Date(iso).toLocaleDateString(locale, opts);
}
