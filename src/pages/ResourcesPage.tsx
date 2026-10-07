import { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Seo } from '@/components/seo/Seo';
import { themedPath } from '@/lib/seoMeta';
import { Link, useSearchParams } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Search, Lock, FileText, Calendar, Clock, ArrowRight, BookOpen, Users, X, LayoutGrid, Sparkles, Tag,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { LoadingSkeleton } from '@/components/LoadingSkeleton';
import { supabase } from '@/lib/supabase';
import { AdBanner } from '@/components/ui/AdBanner';
import { CoverImage } from '@/components/ui/CoverImage';
import { PageHero } from '@/components/ui/PageHero';
import { FilterBar, FilterChip } from '@/components/ui/FilterChip';
import { ThemeTile, ThemeTileRow } from '@/components/ui/ThemeTile';
import { THEMES, getTheme, themesForSectors, type Theme, type ThemeKey } from '@/lib/themes';
import { SITE_IMAGES } from '@/lib/siteMedia';
import { readMinutes } from '@/lib/readTime';
import { withSiteSuffix } from '@/lib/seoText';
import { scrollTopUnderBars } from '@/lib/scrollTarget';

/**
 * The resource library, browsed by theme.
 *
 * Before: a row of five format pills (four of which matched nothing — every
 * published resource is an article), a sidebar of 17 sector checkboxes, and
 * the visitor's organization sectors pre-ticked without saying so — and ticked
 * again on every tab refocus, wiping whatever the visitor had chosen.
 *
 * Now: six theme tiles with pictures are the way in (src/lib/themes.ts); once a
 * theme is open its sectors become chips to narrow it down. "For your sectors"
 * is a visible chip, never a hidden default. Every filter lives in the URL
 * (?theme=&sector=&format=&mine=1&q=), so a filtered view can be shared and
 * the back button undoes the last choice.
 */

interface Sector {
  id: string;
  slug: string;
  label: string;
}

interface Resource {
  id: string;
  title: string;
  summary: string | null;
  content: string | null;
  type: string;
  access_level: string;
  thumbnail_url: string | null;
  created_at: string;
  published_at: string | null;
  tags: string[] | null;
  resource_speakers?: { id: string; full_name: string; display_order: number }[];
  resource_sectors?: { sector_id: string }[];
}

/** A resource with its sectors and themes resolved once, not on every render. */
interface Indexed extends Resource {
  sectorSlugs: string[];
  themes: ThemeKey[];
  haystack: string;
}

/** Navbar (64 px) + filter toolbar (~57 px): where the list should start when scrolled to. */
/** The sticky filter bar's height; the header's 64 px are added on the way up only (scrollTopUnderBars). */
const FILTER_BAR_H = 57;

/** Speakers in display order — on a copy, never sorting the fetched array in place. */
function speakerNames(r: Resource): string {
  return [...(r.resource_speakers ?? [])]
    .sort((a, b) => a.display_order - b.display_order)
    .map((s) => s.full_name)
    .join(', ');
}

export function ResourcesPage() {
  const { t, i18n } = useTranslation();
  const { user, profile, isVerified, isModerator, organization } = useAuth();
  const [params, setParams] = useSearchParams();
  const [resources, setResources] = useState<Resource[]>([]);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [mySectorIds, setMySectorIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  // ---------------------------------------------------------------- URL state
  const theme = getTheme(params.get('theme'));
  const sectorSlug = params.get('sector');
  const format = params.get('format');
  const mine = params.get('mine') === '1';
  const query = params.get('q') ?? '';

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
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const [resRes, secRes] = await Promise.all([
        supabase
          .from('resources')
          .select('id, title, summary, content, type, access_level, thumbnail_url, created_at, published_at, tags, resource_speakers(id, full_name, display_order), resource_sectors(sector_id)')
          .eq('published', true)
          .order('published_at', { ascending: false, nullsFirst: false })
          // published_at is stamped by a DB trigger on first publish (and was
          // backfilled from created_at); creation date only breaks ties.
          .order('created_at', { ascending: false }),
        supabase.from('sectors').select('id, slug, label').eq('is_active', true).order('label'),
      ]);
      if (!alive) return;
      if (resRes.error && import.meta.env.DEV) console.error('Error fetching resources:', resRes.error);
      setResources((resRes.data ?? []) as Resource[]);
      setSectors((secRes.data ?? []) as Sector[]);
      setLoading(false);
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
  const sectorById = useMemo(() => new Map(sectors.map((s) => [s.id, s])), [sectors]);

  const indexed: Indexed[] = useMemo(() => resources.map((r) => {
    const sectorSlugs = (r.resource_sectors ?? [])
      .map((rs) => sectorById.get(rs.sector_id)?.slug)
      .filter((s): s is string => !!s);
    return {
      ...r,
      sectorSlugs,
      themes: themesForSectors(sectorSlugs),
      haystack: [r.title, r.summary ?? '', ...(r.tags ?? []), speakerNames(r)].join(' ').toLowerCase(),
    };
  }), [resources, sectorById]);

  const themeCounts = useMemo(() => {
    const counts = {} as Record<ThemeKey, number>;
    for (const th of THEMES) counts[th.key] = 0;
    for (const r of indexed) for (const k of r.themes) counts[k] += 1;
    return counts;
  }, [indexed]);

  // Formats actually present. Today that is "article" only, and a filter with
  // one option is noise — the chips appear the day a second format exists.
  const formats = useMemo(() => [...new Set(indexed.map((r) => r.type))], [indexed]);

  const mySectorSlugs = useMemo(
    () => new Set(mySectorIds.map((id) => sectorById.get(id)?.slug).filter(Boolean) as string[]),
    [mySectorIds, sectorById],
  );

  // The open theme's sectors, in the order the theme lists them, with counts.
  const themeSectors = useMemo(() => {
    if (!theme) return [];
    return theme.sectors
      .map((slug) => ({
        slug,
        label: t(`sectorNames.${slug}`, sectors.find((s) => s.slug === slug)?.label ?? slug),
        count: indexed.filter((r) => r.sectorSlugs.includes(slug)).length,
      }))
      .filter((s) => s.count > 0);
  }, [theme, sectors, indexed, t]);

  // Every filter that narrows the list must show as a chip that can undo it.
  // So a URL value with no chip to show it — a sector outside the open theme, a
  // format that no longer exists, "mine" for someone without sectors (or whose
  // sectors are still loading) — is ignored rather than applied invisibly, and
  // a shared link never opens on an unexplained empty list.
  const activeSector = theme && sectorSlug && themeSectors.length > 1 && themeSectors.some((s) => s.slug === sectorSlug)
    ? sectorSlug
    : null;
  const activeFormat = format && formats.length > 1 && formats.includes(format) ? format : null;
  const activeMine = mine && mySectorSlugs.size > 0;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return indexed.filter((r) =>
      (!theme || r.themes.includes(theme.key)) &&
      (!activeSector || r.sectorSlugs.includes(activeSector)) &&
      (!activeFormat || r.type === activeFormat) &&
      (!activeMine || r.sectorSlugs.some((s) => mySectorSlugs.has(s))) &&
      (!q || r.haystack.includes(q)),
    );
  }, [indexed, theme, activeSector, activeFormat, activeMine, mySectorSlugs, query]);

  const anyFilter = !!(theme || activeSector || activeFormat || activeMine || query.trim());

  // Changing a filter from the sticky toolbar deep in the list would leave the
  // reader looking at the middle of the new results. Bring the top of the list
  // back under the toolbar — only when they are below it, never on load.
  const resultsRef = useRef<HTMLDivElement>(null);
  const filterKey = `${theme?.key ?? ''}|${activeSector ?? ''}|${activeFormat ?? ''}|${activeMine}`;
  const lastFilterKey = useRef(filterKey);
  useEffect(() => {
    if (filterKey === lastFilterKey.current) return;
    lastFilterKey.current = filterKey;
    const el = resultsRef.current;
    if (!el) return;
    const top = scrollTopUnderBars(el, FILTER_BAR_H, 0);
    if (window.scrollY > top) window.scrollTo({ top, behavior: 'smooth' });
  }, [filterKey]);

  const scrollToResults = () => {
    const el = resultsRef.current;
    if (el) window.scrollTo({ top: scrollTopUnderBars(el, FILTER_BAR_H, 0), behavior: 'smooth' });
  };
  // "Featured" only means something on the untouched library.
  const featured = !anyFilter ? filtered[0] ?? null : null;
  const grid = featured ? filtered.slice(1) : filtered;

  const canAccess = (level: string) => {
    if (level === 'public') return true;
    if (!user) return false;
    if (level === 'members') return isVerified;
    if (level === 'marina') {
      const isInterestSide = profile?.persona === 'marina' || profile?.persona === 'developer' || profile?.persona === 'investor';
      return (isInterestSide && isVerified) || isModerator;
    }
    return false;
  };

  const locale = i18n.language === 'fr' ? 'fr-FR' : 'en-GB';
  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });

  const themeLabel = (th: Theme) => t(th.labelKey, th.fallback);
  const sectorLabel = (slug: string) => t(`sectorNames.${slug}`, sectors.find((s) => s.slug === slug)?.label ?? slug);

  // The real number of published articles, once loaded ("30 articles in 6 themes").
  const resourceCount = !loading && resources.length > 0 ? resources.length : null;
  const seoTitle = theme
    ? withSiteSuffix(t('seo.resources.themeTitle', { theme: themeLabel(theme), defaultValue: '{{theme}} — marina resources' }))
    : withSiteSuffix(t('seo.resources.title', 'Marina industry resources, by theme'));
  const seoDescription = theme
    ? t('seo.resources.themeDescription', { theme: themeLabel(theme), defaultValue: '{{theme}}: articles for marinas and their service providers, from the Smart Marina Connect library.' })
    : resourceCount !== null
      ? t('seo.resources.descriptionLive', { count: resourceCount, defaultValue: '{{count}} articles on marina infrastructure, design, digital, energy, operations and business, sorted into 6 themes.' })
      : t('seo.resources.description', 'Articles on marina infrastructure, design, digital, energy, operations and business, sorted into 6 themes in the Smart Marina Connect library.');

  // ---------------------------------------------------------------- render
  return (
    <div className="min-h-screen bg-gray-50">
      <Seo title={seoTitle} description={seoDescription} path={themedPath('/resources', theme?.key)} />

      <PageHero
        image={SITE_IMAGES.resourcesHero}
        seed="resources-hero"
        icon={BookOpen}
        eyebrow={t('resources.heroTag', 'Library')}
        title={t('resources.title', 'Marina industry resources, by theme')}
        subtitle={resourceCount !== null
          ? t('resources.subtitleLive', { count: resourceCount, defaultValue: '{{count}} articles in 6 themes: infrastructure, design, digital, energy, operations and business.' })
          : t('resources.subtitle', 'Articles in 6 themes: infrastructure, design, digital, energy, operations and business.')}
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
            aria-label={t('resources.search')}
            placeholder={t('resources.search')}
            value={query}
            onChange={(e) => update({ q: e.target.value }, true)}
            className="h-12 rounded-full border-0 bg-white pl-12 pr-4 text-base text-gray-800 shadow-lg placeholder:text-gray-500"
          />
        </form>
      </PageHero>

      {/* ── Themes: the way in ── */}
      <section className="container mx-auto px-4 pt-8" aria-labelledby="themes-heading">
        <h2 id="themes-heading" className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-500">
          {t('resources.browseByTheme')}
        </h2>
        <ThemeTileRow>
          <ThemeTile
            label={t('resources.allThemes')}
            hint={t('resources.allThemesDesc')}
            count={indexed.length}
            active={!theme}
            seed="all-themes"
            icon={LayoutGrid}
            image={null}
            // Already showing everything: a second click must not stack a
            // duplicate history entry that makes Back look broken.
            onClick={() => { if (theme) update({ theme: null, sector: null }); }}
          />
          {THEMES.map((th) => (
            <ThemeTile
              key={th.key}
              label={themeLabel(th)}
              hint={t(th.descKey, th.descFallback)}
              count={themeCounts[th.key]}
              active={theme?.key === th.key}
              seed={`theme-${th.key}`}
              icon={th.icon}
              image={th.image}
              focusY={th.imageFocusY}
              // Clicking the open theme closes it, like a tab you can untick.
              onClick={() => update({ theme: theme?.key === th.key ? null : th.key, sector: null })}
            />
          ))}
        </ThemeTileRow>
      </section>

      {/* ── Toolbar: refine within the current view. Sticks under the 64 px navbar. ── */}
      <FilterBar sticky className="mt-6">
          {/* aria-live: a screen-reader user hears the new count after each filter. */}
          <span className="shrink-0 text-sm font-medium text-gray-900" aria-live="polite">
            {loading ? '…' : t('resources.results', { count: filtered.length })}
          </span>

          {/* Right after the count, so it can never end up scrolled off-screen. */}
          {anyFilter && (
            <button
              type="button"
              onClick={() => setParams(new URLSearchParams(), { replace: false })}
              className="inline-flex min-h-10 shrink-0 items-center gap-1 rounded-full px-3 text-sm text-gray-600 hover:bg-gray-100 hover:text-gray-900"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
              {t('resources.clearFilters')}
            </button>
          )}

          {(themeSectors.length > 1 || formats.length > 1 || mySectorSlugs.size > 0) && (
            <span className="mx-1 h-5 w-px shrink-0 bg-gray-200" aria-hidden="true" />
          )}

          {/* Sectors of the open theme — only when there is a choice to make. */}
          {themeSectors.length > 1 && themeSectors.map((s) => (
            <FilterChip
              key={s.slug}
              active={activeSector === s.slug}
              count={s.count}
              onClick={() => update({ sector: activeSector === s.slug ? null : s.slug })}
            >
              {s.label}
            </FilterChip>
          ))}

          {formats.length > 1 && formats.map((f) => (
            <FilterChip key={f} active={activeFormat === f} onClick={() => update({ format: activeFormat === f ? null : f })}>
              {t(`resources.types.${f}`, f)}
            </FilterChip>
          ))}

          {mySectorSlugs.size > 0 && (
            <FilterChip active={activeMine} onClick={() => update({ mine: activeMine ? null : '1' })} icon={Sparkles}>
              {t('resources.forYourSectors')}
            </FilterChip>
          )}
      </FilterBar>

      <div className="container mx-auto px-4 pt-6">
        <AdBanner placement="resources" className="mb-2" />
      </div>

      {/* ── Results ── */}
      <div ref={resultsRef} className="container mx-auto px-4 pb-16 pt-6">
        {loading ? (
          <LoadingSkeleton variant="card" count={6} />
        ) : filtered.length === 0 ? (
          <div className="py-24 text-center">
            <div className="mb-4 inline-flex h-20 w-20 items-center justify-center rounded-full bg-gray-100">
              <FileText className="h-10 w-10 text-gray-300" aria-hidden="true" />
            </div>
            <p className="mb-2 text-lg text-gray-500">
              {resources.length === 0 ? t('resources.noResources') : t('resources.noMatch')}
            </p>
            {resources.length > 0 && (
              <Button variant="outline" size="sm" onClick={() => setParams(new URLSearchParams())}>
                {t('resources.clearFilters')}
              </Button>
            )}
          </div>
        ) : (
          <>
            {featured && (
              <FeaturedCard
                resource={featured}
                locked={!canAccess(featured.access_level)}
                formatDate={formatDate}
              />
            )}

            {theme && (
              <div className="mb-6 flex items-center gap-3">
                <theme.icon className="h-5 w-5 text-primary" aria-hidden="true" />
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">{themeLabel(theme)}</h2>
                  <p className="text-sm text-gray-500">{t(theme.descKey, theme.descFallback)}</p>
                </div>
              </div>
            )}

            {grid.length > 0 && (
              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {grid.map((r) => (
                  <ResourceCard
                    key={r.id}
                    resource={r}
                    locked={!canAccess(r.access_level)}
                    formatDate={formatDate}
                    showFormat={formats.length > 1}
                    openTheme={theme}
                    activeSector={activeSector}
                    query={query}
                    sectorLabel={sectorLabel}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ─── Pieces ─────────────────────────────────────────────────────── */

function LockOverlay({ level }: { level: string }) {
  const { t } = useTranslation();
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/50">
      <div className="p-3 text-center text-white">
        <Lock className="mx-auto mb-1 h-6 w-6" aria-hidden="true" />
        <p className="text-xs font-medium">
          {level === 'members' ? t('resources.signupToAccess') : t('resources.verifyMarinaToAccess')}
        </p>
      </div>
    </div>
  );
}

/**
 * What the card is about, in one chip. In the whole library that is its theme;
 * inside an open theme every card would repeat the same name, so the chip
 * names the resource's sector within that theme instead.
 */
function ThemeBadge({
  resource, openTheme, activeSector, sectorLabel,
}: {
  resource: Indexed;
  openTheme: Theme | null;
  activeSector: string | null;
  sectorLabel: (slug: string) => string;
}) {
  const { t } = useTranslation();
  let icon: Theme['icon'] | null = null;
  let text = '';
  if (openTheme) {
    // The chip the reader picked wins, so the card agrees with the filter.
    const slug = activeSector && resource.sectorSlugs.includes(activeSector)
      ? activeSector
      : resource.sectorSlugs.find((s) => openTheme.sectors.includes(s));
    if (slug) { icon = openTheme.icon; text = sectorLabel(slug); }
  } else {
    const th = getTheme(resource.themes[0]);
    if (th) { icon = th.icon; text = t(th.labelKey, th.fallback); }
  }
  if (!icon || !text) return null;
  const Icon = icon;
  return (
    <span className="absolute left-3 top-3 inline-flex max-w-[85%] items-center gap-1 rounded-full bg-white/90 px-2.5 py-1 text-xs font-medium text-gray-800 backdrop-blur-sm">
      <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span className="truncate">{text}</span>
    </span>
  );
}

function FeaturedCard({
  resource, locked, formatDate,
}: {
  resource: Indexed;
  locked: boolean;
  formatDate: (iso: string) => string;
}) {
  const { t } = useTranslation();
  const speakers = speakerNames(resource);
  return (
    <Link to={`/resources/${resource.id}`} state={{ fromList: true }} className="group mb-10 block">
      <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm transition-all duration-300 hover:shadow-lg">
        <div className="grid lg:grid-cols-2">
          <CoverImage
            src={resource.thumbnail_url}
            alt=""
            seed={resource.id}
            icon={getTheme(resource.themes[0])?.icon ?? BookOpen}
            aspect="fill"
            tone="sea"
            eager
            className="h-64 lg:h-80"
            imageClassName="group-hover:scale-105"
          >
            {locked && <LockOverlay level={resource.access_level} />}
            <span className="absolute left-4 top-4 rounded-full bg-secondary px-3 py-1 text-xs font-bold uppercase tracking-wide text-primary">
              {t('resources.latest')}
            </span>
          </CoverImage>
          <div className="flex flex-col justify-center p-6 lg:p-8">
            {resource.themes.length > 0 && (
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-secondary-dark">
                {resource.themes.map((k) => { const th = getTheme(k)!; return t(th.labelKey, th.fallback); }).join(' · ')}
              </p>
            )}
            <h2 className="mb-3 text-xl font-bold leading-tight text-gray-900 transition-colors group-hover:text-primary lg:text-2xl">
              {resource.title}
            </h2>
            {resource.summary && <p className="mb-4 line-clamp-3 leading-relaxed text-gray-600">{resource.summary}</p>}
            <div className="mb-4 flex items-center gap-4 text-sm text-gray-500">
              <span className="flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
                {formatDate(resource.published_at || resource.created_at)}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                {t('resources.minRead', { count: readMinutes(resource.content) })}
              </span>
            </div>
            {speakers && (
              <div className="mb-2 flex items-center gap-2 text-sm text-gray-500">
                <Users className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{speakers}</span>
              </div>
            )}
            <span className="flex items-center gap-1 text-sm font-semibold text-primary transition-all group-hover:gap-2">
              {t('resources.readMore')} <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}

function ResourceCard({
  resource, locked, formatDate, showFormat, openTheme, activeSector, sectorLabel, query,
}: {
  resource: Indexed;
  locked: boolean;
  formatDate: (iso: string) => string;
  showFormat: boolean;
  openTheme: Theme | null;
  activeSector: string | null;
  sectorLabel: (slug: string) => string;
  query: string;
}) {
  const { t } = useTranslation();
  const speakers = speakerNames(resource);
  // Tags are searched but no longer printed on every card. When a search hits
  // one, show it — otherwise the card is in the results with no visible reason.
  const q = query.trim().toLowerCase();
  const matchedTags = q ? (resource.tags ?? []).filter((tag) => tag.toLowerCase().includes(q)).slice(0, 3) : [];
  return (
    <Link
      to={`/resources/${resource.id}`}
      state={{ fromList: true }}
      className="group block overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md"
    >
      <CoverImage
        src={resource.thumbnail_url}
        alt=""
        seed={resource.id}
        icon={getTheme(resource.themes[0])?.icon ?? BookOpen}
        aspect="wide"
        imageClassName="group-hover:scale-105"
      >
        {locked && <LockOverlay level={resource.access_level} />}
        <ThemeBadge resource={resource} openTheme={openTheme} activeSector={activeSector} sectorLabel={sectorLabel} />
      </CoverImage>
      <div className="p-4">
        <div className="mb-2 flex items-center gap-3 text-xs text-gray-500">
          <span className="flex items-center gap-1">
            <Calendar className="h-3 w-3" aria-hidden="true" />
            {formatDate(resource.published_at || resource.created_at)}
          </span>
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" aria-hidden="true" />
            {t('resources.minRead', { count: readMinutes(resource.content) })}
          </span>
          {showFormat && <span>{t(`resources.types.${resource.type}`, resource.type)}</span>}
        </div>
        <h3 className="mb-2 line-clamp-2 font-semibold leading-snug text-gray-800 transition-colors group-hover:text-primary">
          {resource.title}
        </h3>
        {resource.summary && <p className="line-clamp-2 text-sm leading-relaxed text-gray-500">{resource.summary}</p>}
        {speakers && (
          <div className="mt-2 flex items-center gap-1.5 text-xs text-gray-500">
            <Users className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span className="truncate">{speakers}</span>
          </div>
        )}
        {matchedTags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {matchedTags.map((tag) => (
              <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-secondary/15 px-2 py-0.5 text-xs font-medium text-secondary-dark">
                <Tag className="h-3 w-3" aria-hidden="true" />{tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}
