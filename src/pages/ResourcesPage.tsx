import { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Seo } from '@/components/seo/Seo';
import { themedPath } from '@/lib/seoMeta';
import { useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { BookOpen, FileText, LayoutGrid, Sparkles, X } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { AdBanner } from '@/components/ui/AdBanner';
import { LoadErrorPanel } from '@/components/ui/LoadErrorPanel';
import { PageHero } from '@/components/ui/PageHero';
import { SearchField, type SuggestGroup } from '@/components/brand/SearchField';
import { Eyebrow } from '@/components/brand/Eyebrow';
import { ContactCard } from '@/components/brand/ContactCard';
import { UnderlineLink } from '@/components/brand/UnderlineLink';
import { Reveal, RevealGroup } from '@/components/motion/Reveal';
import { subscribeScroll } from '@/components/motion/scrollLoop';
import { useMediaQuery } from '@/components/motion/useReducedMotion';
import {
  FeaturedResource, FilterPill, ResourceCard, ResourceSkeleton, ThemeDoor, type ResourceCardData,
} from '@/components/resources/ResourceParts';
import { THEMES, getTheme, themesForSectors, type Theme, type ThemeKey } from '@/lib/themes';
import { SITE_IMAGES } from '@/lib/siteMedia';
import { withSiteSuffix } from '@/lib/seoText';
import { scrollTopUnderBars } from '@/lib/scrollTarget';
import { openSignup } from '@/lib/authModal';
import { cn } from '@/lib/utils';
import '@/styles/refonte-content.css';

/** The library holds articles: its search suggests articles only. */
const ARTICLE_SUGGESTIONS: readonly SuggestGroup[] = ['articles'];

/**
 * The resource library, browsed by theme.
 *
 * Refonte (Oct 2026), on the v2 kit, like the directory:
 *   - the compact PageHero banner with the search pill (gold compass);
 *   - six photo tiles, one per theme, are the way in (src/lib/themes.ts): the
 *     title with a gold line and a small arrow, the count in a frosted pill, a
 *     gold ring on the open theme;
 *   - a sticky toolbar under the header (it rises when the header tucks away, a
 *     page-coloured shelf backs it once stuck): the live count, "All themes", the
 *     open theme's sectors, the formats (once there are two) and "For your sectors";
 *   - the newest article as a wide card on the untouched library, then the cards.
 *
 * Every filter lives in the URL (?theme=&sector=&format=&mine=1&q=), so a filtered
 * view can be shared and the back button undoes the last choice. "For your
 * sectors" is a visible chip, never a hidden default; a URL value with nothing on
 * screen to show it is ignored, never applied invisibly.
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

/** The toolbar's height before it is measured (one row of 40 px chips and its padding). */
const TOOLBAR_FALLBACK_H = 61;

/** Speakers in display order: on a copy, never sorting the fetched array in place. */
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
  // A failed read is not "no resources": the list says so (with a retry) instead of "0 resources".
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

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
      setLoadFailed(false);
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
      if (resRes.error) {
        if (import.meta.env.DEV) console.error('Error fetching resources:', resRes.error);
        setLoadFailed(true);
      }
      setResources((resRes.data ?? []) as Resource[]);
      setSectors((secRes.data ?? []) as Sector[]);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [reloadKey]);

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

  // ---------------------------------------------------------------- toolbar
  const toolbarRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  /** The toolbar is stuck under the header: a page-coloured shelf backs it, with a soft shadow. */
  const [stuck, setStuck] = useState(false);

  // Keyboard focus moving up must not land under the sticky toolbar: its height
  // feeds the page's scroll-padding (index.css) while the library is mounted.
  useEffect(() => {
    const bar = toolbarRef.current;
    const root = document.documentElement;
    if (!bar) return;
    const set = () => root.style.setProperty('--sticky-offset', `${bar.offsetHeight}px`);
    set();
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(set);
      ro.observe(bar);
    }
    return () => {
      ro?.disconnect();
      root.style.removeProperty('--sticky-offset');
    };
  }, []);

  // Stuck state: the sentinel above the toolbar has scrolled up to where the
  // toolbar sits (its computed top follows the header: 0 while it is tucked away).
  useEffect(() => {
    const bar = toolbarRef.current;
    const sentinel = sentinelRef.current;
    if (!bar || !sentinel) return;
    return subscribeScroll(() => {
      const top = parseFloat(getComputedStyle(bar).top) || 0;
      const next = sentinel.getBoundingClientRect().top <= top + 0.5;
      setStuck((prev) => (prev === next ? prev : next));
    });
  }, []);

  const barHeight = () => toolbarRef.current?.offsetHeight ?? TOOLBAR_FALLBACK_H;

  // Changing a filter from the sticky toolbar deep in the list would leave the
  // reader looking at the middle of the new results. Bring the top of the list
  // back under the toolbar — only when they are below it, never on load.
  const filterKey = `${theme?.key ?? ''}|${activeSector ?? ''}|${activeFormat ?? ''}|${activeMine}`;
  const lastFilterKey = useRef(filterKey);
  useEffect(() => {
    if (filterKey === lastFilterKey.current) return;
    lastFilterKey.current = filterKey;
    const el = resultsRef.current;
    if (!el) return;
    const top = scrollTopUnderBars(el, barHeight(), 0);
    if (window.scrollY > top) window.scrollTo({ top, behavior: 'smooth' });
  }, [filterKey]);

  const scrollToResults = () => {
    const el = resultsRef.current;
    if (el) window.scrollTo({ top: scrollTopUnderBars(el, barHeight(), 0), behavior: 'smooth' });
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

  // Cards in a row arrive 80 ms apart: how many fit in a row (1, 2, 3 at sm, lg).
  const lg = useMediaQuery('(min-width: 1024px)');
  const sm = useMediaQuery('(min-width: 640px)');
  const columns = lg ? 3 : sm ? 2 : 1;

  // ---------------------------------------------------------------- render
  return (
    <div className="min-h-screen bg-page">
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
        <SearchField
          className="max-w-xl"
          inputId="resources-search"
          value={query}
          onValueChange={(v) => update({ q: v }, true)}
          onSearch={() => {
            (document.activeElement as HTMLElement | null)?.blur();
            scrollToResults();
          }}
          // The library holds articles only: the placeholder promises nothing else (no guides, no white papers yet).
          placeholder={t('resources.searchArticles', 'Search articles…')}
          label={t('resources.searchArticlesLabel', 'Search the articles')}
          suggest={ARTICLE_SUGGESTIONS}
        />
      </PageHero>

      {/* ── Themes: the way in ── */}
      <section aria-label={t('resources.browseByTheme')} className="mx-auto w-full max-w-7xl px-4 pt-10 sm:px-6 md:pt-14">
        <Reveal>
          <Eyebrow as="h2" number="01">{t('resources.browseByTheme')}</Eyebrow>
        </Reveal>
        <RevealGroup as="ul" className="mt-5 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
          {THEMES.map((th) => (
            <li key={th.key} className="min-w-0">
              <ThemeDoor
                label={themeLabel(th)}
                hint={t(th.descKey, th.descFallback)}
                countLabel={loading || loadFailed ? '' : t('resources.results', { count: themeCounts[th.key] })}
                active={theme?.key === th.key}
                icon={th.icon}
                image={th.image}
                focusY={th.imageFocusY}
                // Clicking the open theme closes it, like a tab you can untick.
                onClick={() => update({ theme: theme?.key === th.key ? null : th.key, sector: null })}
              />
            </li>
          ))}
        </RevealGroup>
      </section>

      {/* ── Toolbar: refine within the current view. Sticks under the header. ── */}
      <div ref={sentinelRef} aria-hidden="true" className="mt-8" />
      <div
        ref={toolbarRef}
        role="region"
        aria-label={t('contentPages.library.toolbarLabel', 'Filter the library')}
        className={cn('res-toolbar sticky top-16 z-30 border-y border-rule bg-page/95 backdrop-blur-md', stuck && 'is-stuck')}
      >
        <div className="mx-auto w-full max-w-7xl px-4 py-2.5 sm:px-6">
          <div className="res-chips no-scrollbar -mx-4 flex items-center gap-2 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:overflow-visible md:px-0">
            {/* aria-live: a screen-reader user hears the new count after each filter. */}
            <span className="shrink-0 pr-1 text-sm font-semibold text-ink" aria-live="polite">
              {loading ? '…' : loadFailed ? '' : t('resources.results', { count: filtered.length })}
            </span>

            {/* Right after the count, so it can never end up scrolled off-screen. */}
            {anyFilter && (
              <button
                type="button"
                onClick={() => setParams(new URLSearchParams(), { replace: false })}
                className="focus-ring inline-flex min-h-10 shrink-0 items-center gap-1 rounded-badge px-1.5 text-sm font-semibold text-gold-text underline underline-offset-[3px] transition-colors hover:text-navy"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
                {t('resources.clearFilters')}
              </button>
            )}

            <span className="mx-1 h-5 w-px shrink-0 bg-rule" aria-hidden="true" />

            <FilterPill
              active={!theme}
              icon={LayoutGrid}
              count={indexed.length}
              // Already showing everything: a second click must not stack a
              // duplicate history entry that makes Back look broken.
              onClick={() => { if (theme) update({ theme: null, sector: null }); }}
            >
              {t('resources.allThemes')}
            </FilterPill>

            {/* Sectors of the open theme — only when there is a choice to make. */}
            {themeSectors.length > 1 && themeSectors.map((s) => (
              <FilterPill
                key={s.slug}
                active={activeSector === s.slug}
                count={s.count}
                onClick={() => update({ sector: activeSector === s.slug ? null : s.slug })}
              >
                {s.label}
              </FilterPill>
            ))}

            {formats.length > 1 && formats.map((f) => (
              <FilterPill key={f} active={activeFormat === f} onClick={() => update({ format: activeFormat === f ? null : f })}>
                {t(`resources.types.${f}`, f)}
              </FilterPill>
            ))}

            {mySectorSlugs.size > 0 && (
              <FilterPill active={activeMine} onClick={() => update({ mine: activeMine ? null : '1' })} icon={Sparkles}>
                {t('resources.forYourSectors')}
              </FilterPill>
            )}
          </div>
        </div>
      </div>

      {/* ── Results ── */}
      <div ref={resultsRef} className="mx-auto w-full max-w-7xl px-4 pb-14 pt-6 sm:px-6 md:pb-20">
        <AdBanner placement="resources" className="mb-6" />

        {loading ? (
          <>
            <p role="status" className="sr-only">{t('contentPages.library.loading', 'Loading the library…')}</p>
            <ul aria-hidden="true" className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }, (_, i) => <ResourceSkeleton key={i} />)}
            </ul>
          </>
        ) : loadFailed ? (
          <LoadErrorPanel
            title={t('loadError.resources', 'The library could not be loaded.')}
            onRetry={() => setReloadKey((k) => k + 1)}
          />
        ) : filtered.length === 0 ? (
          <div className="mx-auto max-w-xl rounded-[24px] border border-dashed border-rule bg-white px-6 py-12 text-center">
            <span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-pill bg-chip text-navy">
              <FileText className="h-6 w-6" aria-hidden="true" />
            </span>
            <p className="text-h3 text-navy" role="status">
              {resources.length === 0 ? t('resources.noResources') : t('resources.noMatch')}
            </p>
            {resources.length > 0 && (
              <>
                <p className="mt-2 text-body text-meta">{t('contentPages.library.noMatchHint', 'Try another word, or remove a filter.')}</p>
                <Button variant="ctaNavy" className="mt-6" onClick={() => setParams(new URLSearchParams())}>
                  {t('resources.clearFilters')}
                </Button>
              </>
            )}
          </div>
        ) : (
          <>
            {featured && (
              <Reveal className="mb-10">
                <FeaturedResource resource={featured as ResourceCardData} locked={!canAccess(featured.access_level)} formatDate={formatDate} />
              </Reveal>
            )}

            {theme && (
              <div className="mb-6 flex items-center gap-3">
                <span aria-hidden="true" className="grid h-11 w-11 shrink-0 place-items-center rounded-field bg-chip text-navy">
                  <theme.icon className="h-5 w-5" />
                </span>
                <div>
                  <h2 className="text-h3 text-navy">{themeLabel(theme)}</h2>
                  <p className="text-sm text-meta">{t(theme.descKey, theme.descFallback)}</p>
                </div>
              </div>
            )}

            {grid.length > 0 && (
              <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {grid.map((r, i) => (
                  <Reveal as="li" key={r.id} delay={(i % columns) * 80} className="flex min-w-0">
                    <ResourceCard
                      resource={r as ResourceCardData}
                      locked={!canAccess(r.access_level)}
                      formatDate={formatDate}
                      showFormat={formats.length > 1}
                      openTheme={theme}
                      activeSector={activeSector}
                      query={query}
                      sectorLabel={sectorLabel}
                    />
                  </Reveal>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      {/* ── The end: what is open to whom (visitors) and the person to write to ── */}
      <section aria-label={t('homePage.end.label', 'Explore and contact us')} className="mx-auto w-full max-w-7xl px-4 pb-16 sm:px-6 md:pb-24">
        <div className="grid items-center gap-8 lg:grid-cols-12 lg:gap-14">
          {!user && (
            <Reveal className="lg:col-span-7">
              <Eyebrow>{t('contentPages.library.joinEyebrow', 'Free for every member')}</Eyebrow>
              <h2 className="mt-3 max-w-2xl text-h2-sm text-navy md:text-h2">
                {t('contentPages.library.joinTitle', 'Public articles are open to everyone. Join to read the rest.')}
              </h2>
              <p className="mt-3 max-w-xl text-body md:text-body-lg text-ink">
                {t('contentPages.library.joinBody', 'Member-only articles open once your company is verified. Membership is free.')}
              </p>
              {/* Joining opens the sign-up window at once; the presentation page is the "learn more". */}
              <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3">
                <Button variant="cta" onClick={() => openSignup()}>{t('contentPages.library.joinCta', 'Sign up for free')}</Button>
                <UnderlineLink to="/join" className="text-base">{t('contentPages.library.joinMore', 'How membership works')}</UnderlineLink>
              </div>
            </Reveal>
          )}
          <Reveal delay={120} className={user ? 'lg:col-span-6' : 'lg:col-span-5'}>
            <ContactCard line={t('contentPages.library.askLine', 'Suggest an article or a webinar: write to the M3 team.')} />
          </Reveal>
        </div>
      </section>
    </div>
  );
}
