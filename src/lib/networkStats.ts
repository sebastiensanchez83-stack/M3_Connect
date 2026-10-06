import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

/**
 * The network's headline figures: verified marinas, verified partners,
 * countries and published resources.
 *
 * Live counts by default. The hand-typed numbers in
 * platform_settings.display_stats had fallen well behind (85 marinas shown,
 * 180 listed), so they now only win when an admin sets `override: true` there
 * (shown as "N+"), and otherwise fill in when a live count cannot be had.
 */

export interface NetworkFigures {
  marinas: number | null;
  partners: number | null;
  countries: number | null;
  resources: number | null;
  /** The admin's hand-typed figures (display_stats.override), shown as "N+". */
  manual: boolean;
}

export const EMPTY_FIGURES: NetworkFigures = { marinas: null, partners: null, countries: null, resources: null, manual: false };

export type OrgFigureRow = { organization_type: string | null; country: string | null; headquarters_country: string | null };

/**
 * The country field is free text: "UK" and "United Kingdom", "Italia" and
 * "Italy", "Spain/France". Counting raw values would claim ~56 countries for
 * what is really ~45, so values are folded to one key before counting.
 */
const COUNTRY_ALIASES: Record<string, string> = {
  uk: 'united kingdom', 'great britain': 'united kingdom', england: 'united kingdom', scotland: 'united kingdom', 'royaume-uni': 'united kingdom',
  usa: 'united states', us: 'united states', 'united states of america': 'united states', 'etats-unis': 'united states',
  uae: 'united arab emirates', emirates: 'united arab emirates', 'emirats arabes unis': 'united arab emirates',
  italia: 'italy', italie: 'italy', suomi: 'finland', tunisie: 'tunisia', espana: 'spain', espagne: 'spain',
  deutschland: 'germany', allemagne: 'germany', turkiye: 'turkey', turquie: 'turkey', grece: 'greece',
  croatie: 'croatia', hrvatska: 'croatia', holland: 'netherlands', 'pays-bas': 'netherlands',
  bresil: 'brazil', suisse: 'switzerland', mexique: 'mexico',
};

function countryKey(raw: string): string {
  const k = raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\./g, '')
    .trim()
    .replace(/^the\s+/, '');
  return COUNTRY_ALIASES[k] ?? k;
}

export function countCountries(rows: { country: string | null; headquarters_country: string | null }[]): number {
  const seen = new Set<string>();
  for (const r of rows) {
    const raw = r.country?.trim() || r.headquarters_country?.trim() || '';
    if (!raw) continue;
    // "Spain/France", "Spain -UAE": one organization, two countries. A bare
    // hyphen inside a name ("Pays-Bas", "Guinea-Bissau") is left alone.
    for (const part of raw.split(/\s*[/,;&]\s*|\s+-\s*|\s*-\s+/)) {
      const k = countryKey(part);
      if (k.length > 1) seen.add(k);
    }
  }
  return seen.size;
}

/**
 * Builds the figures from what was fetched. Any argument may be null when its
 * query failed: that figure then falls back to the typed setting.
 */
export function networkFigures(
  displayValue: unknown,
  orgRows: OrgFigureRow[] | null,
  resourceCount: number | null,
): NetworkFigures {
  const display = (displayValue && typeof displayValue === 'object' ? displayValue : {}) as Record<string, unknown>;
  // An explicit admin choice wins: with `override: true` the hand-typed
  // figures are shown as before ("85+", 0 hides a figure as "—").
  const manual = display.override === true;
  const typed = (v: unknown) => (typeof v === 'number' && v > 0 ? v : null);
  const pick = (live: number | null, fallback: unknown) =>
    manual ? typed(fallback) : (live !== null && live > 0 ? live : typed(fallback));

  return {
    marinas: pick(orgRows ? orgRows.filter((o) => o.organization_type === 'marina').length : null, display.marinas),
    partners: pick(orgRows ? orgRows.filter((o) => o.organization_type === 'partner').length : null, display.partners),
    countries: pick(orgRows ? countCountries(orgRows) : null, display.countries),
    resources: pick(resourceCount, display.resources),
    manual,
  };
}

/** "180" live, "85+" when typed by an admin. */
export function formatFigure(value: number, manual: boolean, lang: string): string {
  return `${value.toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-GB')}${manual ? '+' : ''}`;
}

/** Fetches the figures for a page that does not already load them itself. */
export function useNetworkFigures(): { figures: NetworkFigures; loading: boolean } {
  const [figures, setFigures] = useState<NetworkFigures>(EMPTY_FIGURES);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      // allSettled: a failed count falls back to the typed setting instead of blanking the band.
      const [settingsRes, orgsRes, resourcesRes] = await Promise.allSettled([
        supabase.from('platform_settings').select('value').eq('key', 'display_stats').maybeSingle(),
        supabase.from('organizations').select('organization_type, country, headquarters_country').eq('access_status', 'verified'),
        supabase.from('resources').select('id', { count: 'exact', head: true }).eq('published', true),
      ]);
      if (!alive) return;
      const ok = <T extends { error: unknown }>(r: PromiseSettledResult<T>): T | null =>
        r.status === 'fulfilled' && !r.value.error ? r.value : null;

      const settings = ok(settingsRes)?.data as { value?: unknown } | null | undefined;
      const orgs = (ok(orgsRes)?.data ?? null) as OrgFigureRow[] | null;
      const resources = ok(resourcesRes)?.count ?? null;
      setFigures(networkFigures(settings?.value, orgs, resources));
      setLoading(false);
    })();
    return () => { alive = false; };
  }, []);

  return { figures, loading };
}
