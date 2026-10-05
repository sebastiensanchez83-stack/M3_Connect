import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Helmet } from 'react-helmet-async';
import type { LucideIcon } from 'lucide-react';
import {
  Anchor, ArrowRight, Briefcase, Building2, Compass, HardHat, LayoutGrid, MapPin,
  Newspaper, Search, Sparkles, Star, TrendingUp, Users, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHero } from '@/components/ui/PageHero';
import { FilterBar, FilterChip } from '@/components/ui/FilterChip';
import { ThemeTile, ThemeTileRow } from '@/components/ui/ThemeTile';
import { CoverImage, LogoBadge } from '@/components/ui/CoverImage';
import { SponsorBadge } from '@/components/ui/SponsorBadge';
import { AdBanner } from '@/components/ui/AdBanner';
import { BookmarkButton } from '@/components/shortlist/BookmarkButton';
import { LoadingSkeleton } from '@/components/LoadingSkeleton';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { THEMES, getTheme, themesForSectors, type Theme, type ThemeKey } from '@/lib/themes';
import { SITE_IMAGES } from '@/lib/siteMedia';
import { SPONSOR_TIERS, type OrgTier } from '@/types/database';
import { cn } from '@/lib/utils';

/**
 * The directory: who is on Smart Marina Connect. Served at /directory.
 *
 * It used to be the first tab of the four-tab "Network" screen
 * (MarketplacePage): a search box, a type dropdown, a sidebar of 17 sector
 * checkboxes pre-ticked with the visitor's own sectors (silently, and again on
 * every tab refocus), and every one of the 263 cards rendered at once.
 *
 * Now, like the resource library:
 *   - the type is a segmented control showing only types that exist;
 *   - six theme tiles (src/lib/themes.ts) are the way into the 17 sectors, and
 *     the open theme's sectors become chips in the sticky bar;
 *   - "For your sectors" is a visible chip, never a hidden default;
 *   - every filter lives in the URL (?type=&theme=&sector=&q=&joined=1&mine=1),
 *     and a param with no chip to show it is ignored, never applied invisibly;
 *   - paying-tier organizations open the untouched list in their own strip;
 *   - cards come in batches of 24.
 *
 * What an organization's sectors mean depends on its side of the market: a
 * supplier's are the services it offers, a marina's (or investor's, or
 * developer's) are what it is looking for.
 *
 * There is deliberately no "Contact" button on the cards. The old Network
 * screen still carries a contact dialog, but nothing has opened it since
 * March 2026, and it saved partner_requests with sender and recipient the
 * other way round from what the inbox reads (the inbox treats
 * partner_user_id as the SENDER). Members connect from the organization
 * profile ("Request to Connect"), which writes the right direction and checks
 * for an existing request. Each card leads there.
 */

/* ─── Model ──────────────────────────────────────────────────────── */

interface SectorRef {
  id: string;
  slug: string;
  label: string;
}

interface OrgCard {
  id: string;
  slug: string;
  name: string;
  organization_type: string | null;
  tier: string;
  website: string | null;
  country: string | null;
  city: string | null;
  headquarters_country: string | null;
  description: string | null;
  audience_description: string | null;
  logo_url: string | null;
  /** banner_url, else the first gallery picture, else null (gradient). */
  cover_url: string | null;
  /** Service sectors for suppliers, interest sectors for marinas/investors/developers. */
  sectors: SectorRef[];
  member_count: number;
}

/** A card with its themes and search text resolved once, not on every render. */
interface Indexed extends OrgCard {
  sectorSlugs: string[];
  themes: ThemeKey[];
  haystack: string;
}

type TypeKey = 'marina' | 'partner' | 'investor' | 'developer' | 'media_partner';

interface TypeFacet {
  key: TypeKey;
  icon: LucideIcon;
  /** Plural, for the segmented control. */
  labelKey: string;
  fallback: string;
  /** Singular, for the card. */
  oneKey: string;
  oneFallback: string;
}

const TYPE_FACETS: TypeFacet[] = [
  { key: 'marina', icon: Anchor, labelKey: 'directory.types.marina', fallback: 'Marinas', oneKey: 'directory.typeOne.marina', oneFallback: 'Marina' },
  { key: 'partner', icon: Briefcase, labelKey: 'directory.types.partner', fallback: 'Suppliers & experts', oneKey: 'directory.typeOne.partner', oneFallback: 'Supplier & expert' },
  { key: 'investor', icon: TrendingUp, labelKey: 'directory.types.investor', fallback: 'Investors', oneKey: 'directory.typeOne.investor', oneFallback: 'Investor' },
  { key: 'developer', icon: HardHat, labelKey: 'directory.types.developer', fallback: 'Developers', oneKey: 'directory.typeOne.developer', oneFallback: 'Developer' },
  { key: 'media_partner', icon: Newspaper, labelKey: 'directory.types.media_partner', fallback: 'Media', oneKey: 'directory.typeOne.media_partner', oneFallback: 'Media' },
];
const FACET_BY_KEY = new Map(TYPE_FACETS.map((f) => [f.key as string, f]));

/** Types whose sectors are "what we are looking for" rather than "what we offer". */
const INTEREST_SIDE = new Set(['marina', 'developer', 'investor']);

/** Sponsorship order, as on the old Network screen. */
const TIER_ORDER: Record<string, number> = { main_sponsor: 0, premium_sponsor: 1, premium_partner: 1, associate_partner: 2, innovation_partner: 3, member: 4 };

const isPaying = (tier: string) => (SPONSOR_TIERS as string[]).includes(tier);

const PAGE_SIZE = 24;

/** Navbar (64 px) + filter toolbar (~61 px): where the list should start when scrolled to. */
const STICKY_OFFSET = 64 + 61;

function countThemes(list: Indexed[]): Record<ThemeKey, number> {
  const counts = {} as Record<ThemeKey, number>;
  for (const th of THEMES) counts[th.key] = 0;
  for (const o of list) for (const k of o.themes) counts[k] += 1;
  return counts;
}

/** Themes worth a tile for this list: the row only helps with two or more. */
function themesWithOrgs(counts: Record<ThemeKey, number>): Theme[] {
  return THEMES.filter((th) => counts[th.key] > 0);
}

/* ─── Page ───────────────────────────────────────────────────────── */

export function DirectoryPage() {
  const { t } = useTranslation();
  const { user, organization } = useAuth();
  const [params, setParams] = useSearchParams();

  const [orgs, setOrgs] = useState<OrgCard[]>([]);
  const [sectors, setSectors] = useState<SectorRef[]>([]);
  const [mySectorIds, setMySectorIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [limit, setLimit] = useState(PAGE_SIZE);

  // ---------------------------------------------------------------- URL state
  const typeParam = params.get('type');
  const themeParam = getTheme(params.get('theme'));
  const sectorParam = params.get('sector');
  const query = params.get('q') ?? '';
  const joinedOnly = params.get('joined') === '1';
  const mine = params.get('mine') === '1';

  /** Change some filters, keep the rest. Search typing replaces history; clicks push. */
  const update = (changes: Record<string, string | null>, replace = false) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
    }
    setParams(next, { replace });
  };

  // ---------------------------------------------------------------- data
  // Runs once. Only verified organizations are listed.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [orgRes, secRes] = await Promise.all([
          supabase
            .from('organizations')
            .select('id, slug, name, organization_type, tier, website, country, city, headquarters_country, description, audience_description, logo_url, banner_url, gallery, access_status')
            .eq('access_status', 'verified'),
          supabase.from('sectors').select('id, slug, label').eq('is_active', true).order('label'),
        ]);
        if (orgRes.error) throw orgRes.error;
        if (!alive) return;
        setSectors((secRes.data ?? []) as SectorRef[]);

        type OrgRow = {
          id: string; slug: string; name: string; organization_type: string | null; tier: string | null;
          website: string | null; country: string | null; city: string | null; headquarters_country: string | null;
          description: string | null; audience_description: string | null; logo_url: string | null;
          banner_url: string | null; gallery: unknown;
        };
        const orgRows = (orgRes.data ?? []) as OrgRow[];
        if (orgRows.length === 0) { setOrgs([]); return; }
        const orgIds = orgRows.map((o) => o.id);

        // Member counts, then service sectors (suppliers) and interest sectors (marinas).
        type LinkRow = { organization_id: string; sector_id: string; sectors: SectorRef | null };
        const [{ data: memberRows }, { data: serviceRows }, { data: interestRows }] = await Promise.all([
          supabase.from('organization_members').select('organization_id').in('organization_id', orgIds),
          supabase.from('organization_service_sectors').select('organization_id, sector_id, sectors(id, slug, label)').in('organization_id', orgIds),
          supabase.from('organization_interest_sectors').select('organization_id, sector_id, sectors(id, slug, label)').in('organization_id', orgIds),
        ]);
        if (!alive) return;

        const memberCount: Record<string, number> = {};
        for (const row of (memberRows ?? []) as { organization_id: string }[]) {
          memberCount[row.organization_id] = (memberCount[row.organization_id] || 0) + 1;
        }

        const toMap = (rows: unknown) => {
          const map: Record<string, SectorRef[]> = {};
          for (const link of (rows ?? []) as LinkRow[]) {
            if (!link.sectors) continue;
            const list = (map[link.organization_id] ??= []);
            if (!list.some((s) => s.id === link.sectors!.id)) {
              list.push({ id: link.sectors.id, slug: link.sectors.slug, label: link.sectors.label });
            }
          }
          return map;
        };
        const serviceMap = toMap(serviceRows);
        const interestMap = toMap(interestRows);

        const cards: OrgCard[] = orgRows.map((o) => {
          const interestSide = INTEREST_SIDE.has(o.organization_type ?? '');
          const primary = (interestSide ? interestMap[o.id] : serviceMap[o.id]) ?? [];
          const other = (interestSide ? serviceMap[o.id] : interestMap[o.id]) ?? [];
          const gallery = Array.isArray(o.gallery) ? (o.gallery as unknown[]).filter((u): u is string => typeof u === 'string' && u.length > 0) : [];
          return {
            id: o.id,
            slug: o.slug,
            name: o.name,
            organization_type: o.organization_type,
            tier: o.tier || 'member',
            website: o.website,
            country: o.country,
            city: o.city,
            headquarters_country: o.headquarters_country,
            description: o.description,
            audience_description: o.audience_description,
            logo_url: o.logo_url || null,
            cover_url: o.banner_url || gallery[0] || null,
            sectors: primary.length > 0 ? primary : other,
            member_count: memberCount[o.id] || 0,
          };
        });

        // Organisations whose team has actually joined come FIRST. Most of the
        // marina directory is pre-created records that were never claimed, and
        // they'd otherwise bury the real accounts. Then sponsorship tier, then
        // alphabetically.
        cards.sort((a, b) => {
          const aJoined = a.member_count > 0 ? 0 : 1;
          const bJoined = b.member_count > 0 ? 0 : 1;
          if (aJoined !== bJoined) return aJoined - bJoined;
          const aOrder = TIER_ORDER[a.tier] ?? 5;
          const bOrder = TIER_ORDER[b.tier] ?? 5;
          if (aOrder !== bOrder) return aOrder - bOrder;
          return a.name.localeCompare(b.name);
        });

        setOrgs(cards);
      } catch (err) {
        if (import.meta.env.DEV) console.error('Error fetching organizations:', err);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  // The member's own sectors, for the "For your sectors" chip. Keyed on the
  // organization's id and type — never on the user object, which auth-js
  // replaces on every tab refocus.
  const orgId = organization?.id;
  const orgType = organization?.organization_type;
  const signedIn = !!user;
  useEffect(() => {
    if (!signedIn || !orgId) { setMySectorIds([]); return; }
    const table = (orgType === 'marina' || orgType === 'developer' || orgType === 'investor')
      ? 'organization_interest_sectors'
      : 'organization_service_sectors';
    let alive = true;
    supabase.from(table).select('sector_id').eq('organization_id', orgId).then(({ data }) => {
      if (alive) setMySectorIds(((data ?? []) as { sector_id: string }[]).map((d) => d.sector_id));
    });
    return () => { alive = false; };
  }, [orgId, orgType, signedIn]);

  // ---------------------------------------------------------------- derived
  const labelBySlug = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of sectors) map.set(s.slug, s.label);
    for (const o of orgs) for (const s of o.sectors) if (!map.has(s.slug)) map.set(s.slug, s.label);
    return map;
  }, [sectors, orgs]);

  const sectorLabel = (slug: string) => t(`sectorNames.${slug}`, labelBySlug.get(slug) ?? slug);
  const themeLabel = (th: Theme) => t(th.labelKey, th.fallback);

  const indexed: Indexed[] = useMemo(() => orgs.map((o) => {
    const sectorSlugs = [...new Set(o.sectors.map((s) => s.slug))];
    const themes = themesForSectors(sectorSlugs);
    const haystack = [
      o.name, o.city ?? '', o.country ?? '', o.headquarters_country ?? '',
      o.description ?? '', o.audience_description ?? '',
      // The database label (English) and the displayed one (French when switched).
      ...o.sectors.map((s) => s.label),
      ...o.sectors.map((s) => t(`sectorNames.${s.slug}`, s.label)),
      ...themes.map((k) => { const th = getTheme(k)!; return t(th.labelKey, th.fallback); }),
    ].join(' ').toLowerCase();
    return { ...o, sectorSlugs, themes, haystack };
    // `t` changes identity when the language switches, so French sector names
    // become searchable without a reload.
  }), [orgs, t]);

  // Types that actually have organizations. Untyped ones live under "All" only.
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const o of indexed) if (o.organization_type) counts[o.organization_type] = (counts[o.organization_type] || 0) + 1;
    return counts;
  }, [indexed]);
  const facets = TYPE_FACETS.filter((f) => (typeCounts[f.key] ?? 0) > 0);
  const activeType: TypeKey | null = facets.some((f) => f.key === typeParam) ? (typeParam as TypeKey) : null;

  const typed = useMemo(
    () => (activeType ? indexed.filter((o) => o.organization_type === activeType) : indexed),
    [indexed, activeType],
  );

  const themeCounts = useMemo(() => countThemes(typed), [typed]);
  const tileThemes = themesWithOrgs(themeCounts);
  const showThemes = tileThemes.length >= 2;

  // Every filter that narrows the list must show as a chip or tile that can
  // undo it. A URL value with nothing on screen to show it — a theme the row
  // does not offer for this type, a sector outside the open theme, "mine" for
  // someone without sectors (or whose sectors are still loading) — is ignored.
  const activeTheme = showThemes && themeParam && themeCounts[themeParam.key] > 0 ? themeParam : null;

  const themeSectors = useMemo(() => {
    if (!activeTheme) return [];
    return activeTheme.sectors
      .map((slug) => ({ slug, count: typed.filter((o) => o.sectorSlugs.includes(slug)).length }))
      .filter((s) => s.count > 0);
  }, [activeTheme, typed]);

  const activeSector = activeTheme && sectorParam && themeSectors.length > 1 && themeSectors.some((s) => s.slug === sectorParam)
    ? sectorParam
    : null;

  const mySectorSlugs = useMemo(() => {
    const bySlugId = new Map<string, string>();
    for (const s of sectors) bySlugId.set(s.id, s.slug);
    for (const o of orgs) for (const s of o.sectors) bySlugId.set(s.id, s.slug);
    return new Set(mySectorIds.map((id) => bySlugId.get(id)).filter((s): s is string => !!s));
  }, [mySectorIds, sectors, orgs]);
  const activeMine = mine && mySectorSlugs.size > 0;

  const q = query.trim().toLowerCase();

  // Everything but the "On the platform" toggle, so its chip can say how many it would keep.
  const beforeJoined = useMemo(() => typed.filter((o) =>
    (!activeTheme || o.themes.includes(activeTheme.key)) &&
    (!activeSector || o.sectorSlugs.includes(activeSector)) &&
    (!activeMine || o.sectorSlugs.some((s) => mySectorSlugs.has(s))) &&
    (!q || o.haystack.includes(q)),
  ), [typed, activeTheme, activeSector, activeMine, mySectorSlugs, q]);

  const joinedAvailable = useMemo(() => beforeJoined.filter((o) => o.member_count > 0).length, [beforeJoined]);
  const filtered = useMemo(
    () => (joinedOnly ? beforeJoined.filter((o) => o.member_count > 0) : beforeJoined),
    [beforeJoined, joinedOnly],
  );

  const anyFilter = !!(activeType || activeTheme || activeSector || activeMine || joinedOnly || q);

  // Paying-tier organizations open the untouched list in their own strip.
  const featured = useMemo(() => (anyFilter ? [] : filtered
    .filter((o) => isPaying(o.tier))
    .sort((a, b) => (TIER_ORDER[a.tier] ?? 5) - (TIER_ORDER[b.tier] ?? 5) || a.name.localeCompare(b.name))),
  [anyFilter, filtered]);
  const rest = useMemo(
    () => (featured.length > 0 ? filtered.filter((o) => !isPaying(o.tier)) : filtered),
    [featured, filtered],
  );
  const visible = rest.slice(0, limit);
  const shownCount = featured.length + visible.length;

  // A new filter starts from the first batch again.
  const filterKey = `${activeType ?? ''}|${activeTheme?.key ?? ''}|${activeSector ?? ''}|${activeMine}|${joinedOnly}`;
  useEffect(() => { setLimit(PAGE_SIZE); }, [filterKey, q]);

  // Changing a filter from the sticky toolbar deep in the list would leave the
  // reader looking at the middle of the new results. Bring the top of the list
  // back under the toolbar — only when they are below it, never on load.
  const resultsRef = useRef<HTMLDivElement>(null);
  const lastFilterKey = useRef(filterKey);
  useEffect(() => {
    if (filterKey === lastFilterKey.current) return;
    lastFilterKey.current = filterKey;
    const el = resultsRef.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY - STICKY_OFFSET;
    if (window.scrollY > top) window.scrollTo({ top, behavior: 'smooth' });
  }, [filterKey]);

  const scrollToResults = () => {
    const el = resultsRef.current;
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - STICKY_OFFSET, behavior: 'smooth' });
  };

  /** Switch type, keeping the open theme (and sector) only if they still mean something there. */
  const selectType = (key: TypeKey | null) => {
    if (key === activeType) return;
    const nextList = key ? indexed.filter((o) => o.organization_type === key) : indexed;
    const counts = countThemes(nextList);
    const keepTheme = !!activeTheme && counts[activeTheme.key] > 0 && themesWithOrgs(counts).length >= 2;
    const nextSectors = keepTheme
      ? activeTheme!.sectors.filter((slug) => nextList.some((o) => o.sectorSlugs.includes(slug)))
      : [];
    const keepSector = keepTheme && !!activeSector && nextSectors.length > 1 && nextSectors.includes(activeSector);
    update({
      type: key,
      theme: keepTheme ? activeTheme!.key : null,
      sector: keepSector ? activeSector : null,
    });
  };

  // ---------------------------------------------------------------- render
  const themeHint = !activeType
    ? t('directory.themesHint.all', 'Suppliers are grouped by the services they offer, marinas by their areas of interest.')
    : INTEREST_SIDE.has(activeType)
      ? t('directory.themesHint.interest', "Grouped by each organization's areas of interest.")
      : t('directory.themesHint.supply', 'Grouped by the services each company offers.');

  const cardProps = {
    openTheme: activeTheme,
    activeSector,
    sectorLabel,
    themeLabel,
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Helmet>
        <title>
          {activeTheme
            ? `${themeLabel(activeTheme)} — ${t('directory.eyebrow', 'Directory')}`
            : t('directory.metaTitle', 'Directory — Smart Marina Connect')}
        </title>
        <meta name="description" content={t('directory.metaDescription', 'Marinas, suppliers, experts and investors on the Smart Marina Connect network.')} />
        <meta property="og:title" content={t('directory.metaTitle', 'Directory — Smart Marina Connect')} />
        <meta property="og:description" content={t('directory.metaDescription', 'Marinas, suppliers, experts and investors on the Smart Marina Connect network.')} />
      </Helmet>

      <PageHero
        image={SITE_IMAGES.directoryHero}
        seed="directory-hero"
        icon={Compass}
        eyebrow={t('directory.eyebrow', 'Directory')}
        title={t('directory.title', "Who's who in the marina industry")}
        subtitle={t('directory.subtitle', 'Marinas, suppliers, experts and investors on Smart Marina Connect. Find the right partner for your next project.')}
      >
        {/* A real form, so Enter on a phone keyboard closes it and shows the results. */}
        <form
          role="search"
          className="relative max-w-xl"
          onSubmit={(e) => {
            e.preventDefault();
            (document.activeElement as HTMLElement | null)?.blur();
            scrollToResults();
          }}
        >
          <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" aria-hidden="true" />
          <Input
            type="search"
            enterKeyHint="search"
            aria-label={t('directory.search', 'Search by name, country or sector…')}
            placeholder={t('directory.search', 'Search by name, country or sector…')}
            value={query}
            onChange={(e) => update({ q: e.target.value }, true)}
            className="h-12 rounded-full border-0 bg-white pl-12 pr-4 text-base text-gray-800 shadow-lg placeholder:text-gray-500"
          />
        </form>
      </PageHero>

      {!loading && (
        <>
          {/* ── Type: who are you looking for ── */}
          {facets.length > 0 && (
            <section className="container mx-auto px-4 pt-6">
              <div className="no-scrollbar -mx-4 overflow-x-auto px-4 py-1">
                <div
                  role="group"
                  aria-label={t('directory.typeGroup', 'Type of organization')}
                  className="inline-flex gap-1 rounded-full bg-white p-1 shadow-sm ring-1 ring-gray-200"
                >
                  <TypeSegment
                    active={!activeType}
                    icon={LayoutGrid}
                    label={t('directory.types.all', 'All')}
                    count={indexed.length}
                    onClick={() => selectType(null)}
                  />
                  {facets.map((f) => (
                    <TypeSegment
                      key={f.key}
                      active={activeType === f.key}
                      icon={f.icon}
                      label={t(f.labelKey, f.fallback)}
                      count={typeCounts[f.key] ?? 0}
                      onClick={() => selectType(f.key)}
                    />
                  ))}
                </div>
              </div>
            </section>
          )}

          {/* ── Themes: the way in, when there is a choice to make ── */}
          {showThemes && (
            <section className="container mx-auto px-4 pt-6" aria-labelledby="directory-themes-heading">
              <div className="mb-2">
                <h2 id="directory-themes-heading" className="text-sm font-semibold uppercase tracking-wider text-gray-500">
                  {t('directory.browseByTheme', 'Browse by theme')}
                </h2>
                <p className="text-sm text-gray-600">{themeHint}</p>
              </div>
              <ThemeTileRow>
                <ThemeTile
                  label={t('directory.allThemes', 'All themes')}
                  hint={t('directory.allThemesDesc', 'Every organization, whatever its field')}
                  count={typed.length}
                  active={!activeTheme}
                  seed="directory-all-themes"
                  icon={LayoutGrid}
                  image={null}
                  // Already showing everything: a second click must not stack a
                  // duplicate history entry that makes Back look broken.
                  onClick={() => { if (activeTheme) update({ theme: null, sector: null }); }}
                />
                {tileThemes.map((th) => (
                  <ThemeTile
                    key={th.key}
                    label={themeLabel(th)}
                    hint={t(th.descKey, th.descFallback)}
                    count={themeCounts[th.key]}
                    active={activeTheme?.key === th.key}
                    seed={`theme-${th.key}`}
                    icon={th.icon}
                    image={th.image}
                    focusY={th.imageFocusY}
                    // Clicking the open theme closes it, like a tab you can untick.
                    onClick={() => update({ theme: activeTheme?.key === th.key ? null : th.key, sector: null })}
                  />
                ))}
              </ThemeTileRow>
            </section>
          )}
        </>
      )}

      {/* ── Toolbar: refine within the current view. Sticks under the 64 px navbar. ── */}
      <FilterBar sticky className="mt-6">
        {/* aria-live: a screen-reader user hears the new count after each filter. */}
        <span className="shrink-0 text-sm font-medium text-gray-900" aria-live="polite">
          {loading ? '…' : t('directory.results', { count: filtered.length, defaultValue: '{{count}} organizations' })}
        </span>

        {/* Right after the count, so it can never end up scrolled off-screen. */}
        {anyFilter && (
          <button
            type="button"
            onClick={() => setParams(new URLSearchParams(), { replace: false })}
            className="inline-flex min-h-10 shrink-0 items-center gap-1 rounded-full px-3 text-sm text-gray-600 hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            {t('directory.clearFilters', 'Clear filters')}
          </button>
        )}

        <span className="mx-1 h-5 w-px shrink-0 bg-gray-200" aria-hidden="true" />

        {/* Members-first is the default order; this hides the never-claimed records entirely. */}
        <span title={t('directory.onPlatformHint', 'Show only organizations whose team has an account on the platform')} className="inline-flex shrink-0">
          <FilterChip
            active={joinedOnly}
            icon={Users}
            count={loading ? undefined : joinedAvailable}
            onClick={() => update({ joined: joinedOnly ? null : '1' })}
          >
            {t('directory.onPlatform', 'On the platform')}
          </FilterChip>
        </span>

        {mySectorSlugs.size > 0 && (
          <span title={t('directory.forYourSectorsHint', 'Organizations working in the sectors of your organization')} className="inline-flex shrink-0">
            <FilterChip active={activeMine} icon={Sparkles} onClick={() => update({ mine: activeMine ? null : '1' })}>
              {t('directory.forYourSectors', 'For your sectors')}
            </FilterChip>
          </span>
        )}

        {/* Sectors of the open theme — only when there is a choice to make. */}
        {themeSectors.length > 1 && (
          <>
            <span className="mx-1 h-5 w-px shrink-0 bg-gray-200" aria-hidden="true" />
            {themeSectors.map((s) => (
              <FilterChip
                key={s.slug}
                active={activeSector === s.slug}
                count={s.count}
                onClick={() => update({ sector: activeSector === s.slug ? null : s.slug })}
              >
                {sectorLabel(s.slug)}
              </FilterChip>
            ))}
          </>
        )}
      </FilterBar>

      <div className="container mx-auto px-4 pt-6">
        <AdBanner placement="marketplace" className="mb-2" />
      </div>

      {/* ── Results ── */}
      <div ref={resultsRef} className="container mx-auto px-4 pb-16 pt-6">
        {loading ? (
          <LoadingSkeleton variant="card" count={6} />
        ) : filtered.length === 0 ? (
          <div className="py-24 text-center">
            <div className="mb-4 inline-flex h-20 w-20 items-center justify-center rounded-full bg-gray-100">
              <Building2 className="h-10 w-10 text-gray-400" aria-hidden="true" />
            </div>
            <p className="mb-3 text-lg text-gray-600">
              {orgs.length === 0
                ? t('directory.noOrganizations', 'No organizations are listed yet.')
                : t('directory.noMatch', 'No organization matches these filters.')}
            </p>
            {orgs.length > 0 && anyFilter && (
              <Button variant="outline" className="min-h-10" onClick={() => setParams(new URLSearchParams())}>
                {t('directory.clearFilters', 'Clear filters')}
              </Button>
            )}
          </div>
        ) : (
          <>
            {featured.length > 0 && (
              <section
                aria-labelledby="directory-featured-heading"
                className="mb-10 rounded-2xl bg-gradient-to-br from-secondary/20 via-white to-white p-4 ring-1 ring-secondary/40 sm:p-6"
              >
                <div className="mb-4 flex flex-wrap items-center gap-3">
                  <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary/25 text-primary">
                    <Star className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2 id="directory-featured-heading" className="text-lg font-semibold text-gray-900">
                      {t('directory.featuredTitle', 'Platform partners')}
                    </h2>
                    <p className="text-sm text-gray-600">{t('directory.featuredDesc', 'Companies that support Smart Marina Connect')}</p>
                  </div>
                  <Link
                    to="/partners"
                    className="inline-flex min-h-10 items-center gap-1 rounded-full px-3 text-sm font-medium text-primary hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    {t('directory.featuredAll', 'All partners')} <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </div>
                <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                  {featured.map((o) => <DirectoryCard key={o.id} org={o} featured {...cardProps} />)}
                </div>
              </section>
            )}

            {activeTheme && (
              <div className="mb-6 flex items-center gap-3">
                <activeTheme.icon className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">{themeLabel(activeTheme)}</h2>
                  <p className="text-sm text-gray-600">{t(activeTheme.descKey, activeTheme.descFallback)}</p>
                </div>
              </div>
            )}

            {visible.length > 0 && (
              <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                {visible.map((o) => <DirectoryCard key={o.id} org={o} {...cardProps} />)}
              </div>
            )}

            {rest.length > visible.length && (
              <div className="mt-10 flex flex-col items-center gap-3">
                <p className="text-sm text-gray-600">
                  {t('directory.shownOf', 'Showing {{shown}} of {{total}}', { shown: shownCount, total: filtered.length })}
                </p>
                <Button
                  variant="outline"
                  className="min-h-11 rounded-full bg-white px-6"
                  onClick={() => setLimit((n) => n + PAGE_SIZE)}
                >
                  {t('directory.showMore', 'Show more')}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ─── Pieces ─────────────────────────────────────────────────────── */

function TypeSegment({
  active, icon: Icon, label, count, onClick,
}: {
  active: boolean;
  icon: LucideIcon;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex min-h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-4 text-sm font-medium transition-colors',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
        active ? 'bg-primary text-white shadow-sm' : 'text-gray-700 hover:bg-gray-100',
      )}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      {label}
      <span className={cn('tabular-nums text-xs', active ? 'text-white/80' : 'text-gray-500')}>{count}</span>
    </button>
  );
}

/**
 * One organization. The name is the link and stretches over the whole card
 * (so the shortlist star can sit inside it without nesting a button in an <a>).
 * The profile it leads to is where members send a connection request.
 */
function DirectoryCard({
  org, featured = false, openTheme, activeSector, sectorLabel, themeLabel,
}: {
  org: Indexed;
  featured?: boolean;
  openTheme: Theme | null;
  activeSector: string | null;
  sectorLabel: (slug: string) => string;
  themeLabel: (th: Theme) => string;
}) {
  const { t } = useTranslation();
  const facet = FACET_BY_KEY.get(org.organization_type ?? '');
  const TypeIcon = facet?.icon ?? Building2;
  const typeLabel = facet ? t(facet.oneKey, facet.oneFallback) : t('directory.typeOne.organization', 'Organization');
  const location = [org.city, org.country || org.headquarters_country].filter(Boolean).join(', ');
  const blurb = org.description || org.audience_description;

  // What the card is about, in up to two chips. In the whole directory that is
  // its themes; inside an open theme every card would repeat the same name, so
  // the chips name its sectors within that theme instead.
  let chips: { key: string; label: string; icon: LucideIcon }[];
  let more = 0;
  if (openTheme) {
    const inTheme = org.sectorSlugs.filter((s) => openTheme.sectors.includes(s));
    const ordered = activeSector && inTheme.includes(activeSector)
      ? [activeSector, ...inTheme.filter((s) => s !== activeSector)]
      : inTheme;
    chips = ordered.slice(0, 2).map((slug) => ({ key: slug, label: sectorLabel(slug), icon: openTheme.icon }));
    more = Math.max(0, ordered.length - 2);
  } else {
    chips = org.themes.slice(0, 2).map((k) => { const th = getTheme(k)!; return { key: k, label: themeLabel(th), icon: th.icon }; });
    more = Math.max(0, org.themes.length - 2);
  }

  return (
    <article
      className={cn(
        'group relative flex h-full flex-col overflow-hidden rounded-2xl bg-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md',
        featured ? 'ring-2 ring-secondary/60' : 'ring-1 ring-gray-100',
        'has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-primary',
      )}
    >
      <CoverImage
        src={org.cover_url}
        alt=""
        seed={org.id}
        icon={TypeIcon}
        aspect="banner"
        imageClassName="group-hover:scale-105"
      >
        {/* Above the stretched link, so the star toggles instead of navigating.
            Each star loads its own org_bookmarks row (renders only for
            marina, developer and investor viewers); see the BookmarkButton
            follow-up in the integration notes before raising PAGE_SIZE. */}
        <div className="absolute right-2 top-2 z-20">
          <BookmarkButton
            organizationId={org.id}
            organizationName={org.name}
            className="h-10 w-10 bg-white/95 shadow-sm hover:bg-white"
          />
        </div>
      </CoverImage>

      <div className="flex flex-1 flex-col px-4 pb-4">
        {/* Positioned, so it paints over the cover it overlaps. */}
        <div className="relative -mt-8 mb-2 w-fit">
          <LogoBadge src={org.logo_url} name={org.name} size="lg" className="shadow-sm ring-4 ring-white" />
        </div>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h3 className="min-w-0 font-semibold leading-snug text-gray-900">
            <Link
              to={`/organizations/${org.slug}`}
              className="after:absolute after:inset-0 after:content-[''] focus:outline-none group-hover:text-primary"
            >
              {org.name}
            </Link>
          </h3>
          <SponsorBadge tier={org.tier as OrgTier} size="sm" />
        </div>

        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-600">
          <span className="inline-flex items-center gap-1">
            <TypeIcon className="h-3.5 w-3.5" aria-hidden="true" />
            {typeLabel}
          </span>
          {location && (
            <span className="inline-flex min-w-0 items-center gap-1">
              <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{location}</span>
            </span>
          )}
        </p>

        {chips.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {chips.map((c) => (
              <span key={c.key} className="inline-flex max-w-full items-center gap-1 rounded-full bg-primary/5 px-2.5 py-1 text-xs font-medium text-primary">
                <c.icon className="h-3 w-3 shrink-0" aria-hidden="true" />
                <span className="truncate">{c.label}</span>
              </span>
            ))}
            {more > 0 && (
              <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600">+{more}</span>
            )}
          </div>
        )}

        {blurb && <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-gray-600">{blurb}</p>}

        <div className="mt-auto pt-4">
          <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
            {org.member_count > 0 ? (
              <span className="inline-flex items-center gap-1 text-xs text-gray-600">
                <Users className="h-3.5 w-3.5" aria-hidden="true" />
                {t('directory.members', { count: org.member_count, defaultValue: '{{count}} members' })}
              </span>
            ) : (
              <span
                className="text-xs italic text-gray-500"
                title={t('directory.notYetJoinedHint', "Listed, but its team hasn't joined the platform yet.")}
              >
                {t('directory.notYetJoined', 'Not yet on the platform')}
              </span>
            )}

            <span className="ml-auto inline-flex items-center gap-1 text-sm font-medium text-primary">
              {t('directory.viewProfile', 'View profile')}
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
            </span>
          </div>
        </div>
      </div>
    </article>
  );
}
