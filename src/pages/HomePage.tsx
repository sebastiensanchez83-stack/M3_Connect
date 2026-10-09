import { lazy, Suspense, useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Seo } from '@/components/seo/Seo';
import { AlertCircle, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { Sm26WelcomeBadge } from '@/components/home/Sm26WelcomeBadge';
import { supabase } from '@/lib/supabase';
import { SITE_IMAGES } from '@/lib/siteMedia';
import { THEMES, themesForSectors, type ThemeKey } from '@/lib/themes';
import { networkFigures, formatFigure, type OrgFigureRow } from '@/lib/networkStats';
import { SPONSOR_TIERS, isSponsorTier, type OrgTier } from '@/types/database';
import { SplitHero, HeroIn } from '@/components/brand/SplitHero';
import { EventCard } from '@/components/brand/EventCard';
import { SearchField, ALL_SUGGESTIONS } from '@/components/brand/SearchField';
import { Eyebrow } from '@/components/brand/Eyebrow';
import { featuredEventItems } from '@/components/brand/m3Events';
import { LineReveal } from '@/components/motion/LineReveal';
import { FiguresBand, type HomeFigures } from '@/components/home/FiguresBand';
import type { ProviderCardData } from '@/components/home/NeedPanel';
import type { HomeResource } from '@/components/home/ResourcesAgenda';
import type { SponsorLogo } from '@/components/home/SponsorsBand';
import { lazyWithRetry } from '@/lib/lazyWithRetry';
import { openSignup } from '@/lib/authModal';

// Everything below the figures band is its own chunk: the entry bundle (every
// route, /admin and /sm26 included) does not carry the home page's lower sections.
const HomeBelowFold = lazy(() => import('@/components/home/HomeBelowFold'));
// The member's dashboard (and, behind it, the editors it opens in place): a
// chunk of its own, loaded for signed-in members only.
const MemberDashboard = lazyWithRetry(() => import('@/components/home/MemberDashboard'));

/**
 * The homepage (refonte v2, Oct 2026): large photography, slow scroll-linked
 * motion, one gold action.
 *
 * Visitors:
 *   split hero: text on marine (H1 by lines, live-figures sentence, search,
 *               buttons, trust line) and a rounded photo frame with the "next
 *               event" card floating over its corner (the three M3 events)
 *   (the news ticker of new articles, members and events runs above the
 *   header on this page too: SiteTicker, App.tsx)
 *   figures band: the four figures on plain white
 *   who it is for: photo cards in an accordion
 *   "Run a marina?": need form preview + a row of members following the scroll
 *   latest articles + agenda
 *   "Our events": a carousel of three photo cards
 *   how it works: channel steps
 *   event sponsors, logo tiles by tier
 *   directory and resources tiles + contact panel
 *
 * Signed-in members (Oct 2026: the member home and the dashboard are one page):
 *   "Welcome back" in a shorter hero, then the FULL dashboard (MemberDashboard:
 *   account alerts, to-do, every block of the account, edited in place), then,
 *   lighter, the figures, the events carousel, the sponsors and
 *   the closing tiles. /dashboard and /account?tab=… land here.
 *
 * Everything from the profiles down is a lazy chunk (HomeBelowFold).
 *
 * Figures are live counts (networkStats) unless an admin sets
 * display_stats.override, in which case they show as "N+". The M3 events
 * (World Yachting Summit in Dubai, 27 Nov 2026, by invitation; webinars; the
 * Rendezvous) are carried by the hero card, the news ticker, the agenda and the
 * events carousel, all three side by side: the platform is not the Rendezvous' own site. The
 * platform teaser plays only when asked, in a dialog on the Rendezvous card.
 */

/* ─── Model ──────────────────────────────────────────────────────── */

type HomeStats = HomeFigures;

type FeaturedOrgRow = { id: string; slug: string; name: string; logo_url: string | null; tier: OrgTier | null; organization_type: string | null };

/* ─── Helpers ────────────────────────────────────────────────────── */

/** Six members for the providers row: those with a logo first, in a fresh order on each visit. */
function pickProviders(rows: ProviderCardData[], n = 6): ProviderCardData[] {
  const shuffle = <T,>(list: T[]) => {
    const a = [...list];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const withLogo = shuffle(rows.filter((r) => r.logo_url));
  const without = shuffle(rows.filter((r) => !r.logo_url));
  return [...withLogo, ...without].slice(0, n);
}

/* ─── Page ───────────────────────────────────────────────────────── */

export function HomePage() {
  const { t, i18n } = useTranslation();
  const { user, profile, profileTimedOut, refreshProfile } = useAuth();
  const [retrying, setRetrying] = useState(false);

  // Public sections
  const [publicLoading, setPublicLoading] = useState(true);
  const [stats, setStats] = useState<HomeStats>({ marinas: null, suppliers: null, countries: null, resources: null, memberMarinas: null, manual: false });
  const [featuredResources, setFeaturedResources] = useState<HomeResource[]>([]);
  const [themeCounts, setThemeCounts] = useState<Record<ThemeKey, number> | null>(null);
  const [sponsors, setSponsors] = useState<SponsorLogo[]>([]);
  const [providers, setProviders] = useState<ProviderCardData[]>([]);

  const lang = i18n.language === 'fr' ? 'fr-FR' : 'en-GB';

  // Everything public, once, in parallel — allSettled so a 503 on one
  // section never blanks the others. Anonymous reads of public data only.
  useEffect(() => {
    let alive = true;
    const fetchAll = async () => {
      const [
        settingsRes, orgStatsRes, sectorsRes, resIndexRes, featuredRes,
        featuredOrgRes, memberMarinasRes, providersRes, sponsorsRes,
      ] = await Promise.allSettled([
        // Admin-editable display stats: used as they are when the admin has
        // set `override: true`, otherwise only as a fallback for a failed live count.
        supabase.from('platform_settings').select('value').eq('key', 'display_stats').maybeSingle(),
        // One light row per verified organization: counts by type and countries.
        supabase.from('organizations').select('organization_type, country, headquarters_country').eq('access_status', 'verified'),
        supabase.from('sectors').select('id, slug'),
        // Every published resource's sectors, for the theme counts and the total.
        supabase.from('resources').select('id, resource_sectors(sector_id)').eq('published', true),
        // The latest six for the logbook, in the library's own order.
        supabase
          .from('resources')
          .select('id, title, summary, type, access_level, thumbnail_url, created_at, published_at, resource_sectors(sector_id)')
          .eq('published', true)
          .order('published_at', { ascending: false, nullsFirst: false })
          .order('created_at', { ascending: false })
          .limit(6),
        // Organisations an admin has featured on the home page: their sponsor
        // tiers join the logo band (only paying tiers are "partners").
        supabase
          .from('organizations')
          .select('id, slug, name, logo_url, tier, organization_type')
          .eq('access_status', 'verified')
          .eq('featured_partner', true)
          .limit(6),
        // How many of the listed marinas are members (an owner on the platform):
        // most of the listed ones were imported and nobody has claimed them yet.
        supabase
          .from('organizations')
          .select('id', { count: 'exact', head: true })
          .eq('access_status', 'verified')
          .eq('organization_type', 'marina')
          .not('owner_user_id', 'is', null),
        // Real service-provider members for the row in the "need" panel.
        supabase
          .from('organizations')
          .select('id, slug, name, organization_type, logo_url, city, country, description')
          .eq('access_status', 'verified')
          .eq('organization_type', 'partner')
          .not('owner_user_id', 'is', null)
          .order('created_at', { ascending: false })
          .limit(30),
        // Event sponsors (paying tiers), same rule as the Partners page.
        supabase
          .from('organizations')
          .select('id, slug, name, logo_url, tier')
          .eq('access_status', 'verified')
          .in('tier', SPONSOR_TIERS),
      ]);
      if (!alive) return;

      const ok = <T extends { error: unknown }>(r: PromiseSettledResult<T>): T | null =>
        r.status === 'fulfilled' && !r.value.error ? r.value : null;

      // ── Figures (shared with the Join page: live counts unless an admin overrides) ──
      const orgRows = (ok(orgStatsRes)?.data ?? null) as OrgFigureRow[] | null;
      const resIndex = (ok(resIndexRes)?.data ?? null) as { id: string; resource_sectors: { sector_id: string }[] | null }[] | null;
      const figures = networkFigures(
        (ok(settingsRes)?.data as { value?: unknown } | null)?.value,
        orgRows,
        resIndex ? resIndex.length : null,
      );
      const memberCount = ok(memberMarinasRes)?.count;

      setStats({
        marinas: figures.marinas,
        suppliers: figures.partners,
        countries: figures.countries,
        resources: figures.resources,
        memberMarinas: typeof memberCount === 'number' ? memberCount : null,
        manual: figures.manual,
      });

      // ── Resources and their themes ──
      const sectorRows = (ok(sectorsRes)?.data ?? null) as { id: string; slug: string }[] | null;
      const slugById = new Map((sectorRows ?? []).map((s) => [s.id, s.slug]));
      const themesOf = (links: { sector_id: string }[] | null | undefined) =>
        themesForSectors((links ?? []).map((l) => slugById.get(l.sector_id)));

      if (sectorRows && resIndex) {
        const counts = {} as Record<ThemeKey, number>;
        for (const th of THEMES) counts[th.key] = 0;
        for (const r of resIndex) for (const k of themesOf(r.resource_sectors)) counts[k] += 1;
        setThemeCounts(counts);
      }

      type ResRow = Omit<HomeResource, 'themes'> & { resource_sectors?: { sector_id: string }[] | null };
      setFeaturedResources(((ok(featuredRes)?.data ?? []) as ResRow[]).map((r) => ({
        id: r.id,
        title: r.title,
        summary: r.summary,
        type: r.type,
        access_level: r.access_level,
        thumbnail_url: r.thumbnail_url,
        created_at: r.created_at,
        published_at: r.published_at,
        themes: themesOf(r.resource_sectors),
      })).slice(0, 6));

      // ── Sponsors: paying tiers only, from the sponsor query and the featured orgs ──
      const byId = new Map<string, SponsorLogo>();
      const sponsorRows = [
        ...((ok(sponsorsRes)?.data ?? []) as FeaturedOrgRow[]),
        ...((ok(featuredOrgRes)?.data ?? []) as FeaturedOrgRow[]),
      ];
      for (const o of sponsorRows) {
        const tier = (o.tier || 'member') as OrgTier;
        if (isSponsorTier(tier) && !byId.has(o.id)) byId.set(o.id, { id: o.id, slug: o.slug, name: o.name, logo_url: o.logo_url, tier });
      }
      setSponsors([...byId.values()].sort((a, b) => a.name.localeCompare(b.name)));

      // ── Service-provider members for the need panel ──
      setProviders(pickProviders((ok(providersRes)?.data ?? []) as ProviderCardData[]));

      setPublicLoading(false);
    };

    fetchAll().catch((err) => {
      if (import.meta.env.DEV) console.error('Home sections failed:', err);
      if (alive) setPublicLoading(false);
    });
    return () => { alive = false; };
  }, []);

  // The live figures, once loaded, go into the hero and the meta description
  // ("180 marinas listed…"); until then both use the sentence without numbers.
  const figure = (n: number) => formatFigure(n, stats.manual, i18n.language);
  const liveFigures = !publicLoading && stats.marinas !== null && stats.suppliers !== null && stats.countries !== null
    ? { marinas: figure(stats.marinas), suppliers: figure(stats.suppliers), countries: figure(stats.countries) }
    : null;
  const seoTitle = t('seo.home.title', 'Smart Marina Connect — The marina industry network');
  const seoDescription = liveFigures
    ? t('seo.home.descriptionLive', liveFigures)
    : t('seo.home.description', 'Free B2B network for marinas and their service providers, with industry events in Monaco, Dubai and online. Companies reviewed by M3.');

  const searchExamples = useMemo(
    () => [t('brand.search.ex1'), t('brand.search.ex2'), t('brand.search.ex3'), t('brand.search.ex4')],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [i18n.language],
  );
  // The floating card turns the three M3 events (WYS while upcoming, webinars, the Rendezvous).
  const eventItems = useMemo(() => featuredEventItems(t), [t]);
  const card = useMemo(() => <EventCard items={eventItems} />, [eventItems]);

  // "Run a marina?" (the need form preview) speaks to visitors: a signed-in
  // member publishes from the dashboard's "My requests" block instead.
  const showNeedPanel = !user;

  // The end tiles' lines: "180 marinas and 66 service providers in 45 countries", "30 resources in six themes".
  const directoryLine = liveFigures
    ? t('homePage.end.directoryLive', liveFigures)
    : t('homePage.end.directory', 'Marinas, service providers, investors and media');
  const resourcesLine = !publicLoading && stats.resources !== null && !stats.manual
    ? t('homePage.end.resourcesLive', { count: stats.resources, defaultValue: '{{count}} resources in six themes' })
    : t('homePage.end.resources', 'Articles, guides and replays in six themes');

  const trust = [
    t('home.trustFree', 'Free for every member'),
    t('home.trustVerified', 'Open to marinas, service providers, investors and media'),
    t('home.trustEvents', 'By M3 Monaco, organiser of the Monaco Smart & Sustainable Marina Rendezvous and the World Yachting Summit'),
  ];

  return (
    <div className="flex flex-col bg-page">
      <Seo title={seoTitle} description={seoDescription} path="/" />

      {/* ════════════ Split hero: text on marine, photo frame, floating event card ════════════ */}
      <SplitHero
        image={SITE_IMAGES.homeHero}
        seed="home-hero"
        labelledBy="home-hero-title"
        card={card}
        compact={!!user}
      >
        {!user ? (
          <>
            <div className="max-w-[600px]">
              <HeroIn>
                <Eyebrow tone="onDark">{t('homePage.hero.eyebrow', 'Smart Marina Connect · by M3 Monaco')}</Eyebrow>
              </HeroIn>
              <LineReveal
                as="h1"
                id="home-hero-title"
                trigger="mount"
                delay={160}
                className="mt-5 text-balance text-[34px] font-semibold leading-[40px] tracking-[-0.025em] text-white sm:text-[42px] sm:leading-[48px] xl:text-[52px] xl:leading-[58px]"
              >
                {t('home.heroTitle', 'Marinas and the companies that serve them, in one network')}
              </LineReveal>
              <HeroIn as="p" delay={260} className="mt-5 max-w-[560px] text-[17px] leading-[27px] text-white/85 md:text-[18px] md:leading-[29px]">
                {liveFigures
                  ? t('home.heroSubtitleLive', liveFigures)
                  : t('home.heroSubtitle', "Marinas publish their needs, service providers answer them, and everyone meets at M3's events in Monaco, Dubai and online.")}
              </HeroIn>
              <HeroIn delay={340} className="mt-6 max-w-[520px]">
                <SearchField examples={searchExamples} suggest={ALL_SUGGESTIONS} />
              </HeroIn>
              <HeroIn delay={420} className="mt-5 flex flex-wrap items-center gap-3">
                {/* On the navy hero: gold with WHITE water, so it never vanishes on hover/focus.
                    It opens the sign-up window directly (the presentation page is /join). */}
                <Button type="button" variant="ctaOnDark" size="lg" onClick={() => openSignup()}>
                  {t('home.joinNowFree', 'Sign up')}
                </Button>
                <Button asChild variant="ctaLight" size="lg">
                  <Link to="/directory">{t('home.exploreDirectory', 'Explore the directory')}</Link>
                </Button>
              </HeroIn>
              <HeroIn as="ul" delay={500} aria-label={t('homePage.hero.trustLabel', 'Why join')} className="mt-7 grid gap-2.5 text-[14px] leading-5 text-white/85">
                {trust.map((line) => (
                  <li key={line} className="flex gap-2.5">
                    <Check className="mt-px h-[18px] w-[18px] shrink-0 text-gold" strokeWidth={2.5} aria-hidden="true" />
                    {line}
                  </li>
                ))}
              </HeroIn>
            </div>
          </>
        ) : (
          <div className="max-w-[600px]">
            <HeroIn>
              <Eyebrow tone="onDark">{t('homePage.hero.memberEyebrow', 'Smart Marina Connect · your network')}</Eyebrow>
            </HeroIn>
            <LineReveal
              as="h1"
              id="home-hero-title"
              trigger="mount"
              delay={160}
              className="mt-5 text-balance text-[34px] font-semibold leading-[40px] tracking-[-0.025em] text-white sm:text-[42px] sm:leading-[48px] xl:text-[52px] xl:leading-[58px]"
            >
              {`${t('home.welcomeBack', 'Welcome back')}${profile?.first_name ? `, ${profile.first_name}` : ''}!`}
            </LineReveal>
            {profileTimedOut && !profile && (
              <div className="mt-4 inline-flex flex-wrap items-center gap-3 rounded-field bg-white/15 px-4 py-2 text-sm text-white/90 backdrop-blur-sm">
                <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{t('homeSections.profileSlow', 'Profile data is loading slowly.')}</span>
                <button
                  type="button"
                  onClick={async () => { setRetrying(true); await refreshProfile(); setRetrying(false); }}
                  disabled={retrying}
                  className="focus-ring min-h-11 rounded font-medium underline hover:text-white disabled:opacity-50"
                >
                  {retrying ? t('homeSections.retrying', 'Retrying…') : t('homeSections.retry', 'Retry now')}
                </button>
              </div>
            )}
            <HeroIn as="p" delay={260} className="mt-5 max-w-[560px] text-[17px] leading-[27px] text-white/85 md:text-[18px] md:leading-[29px]">
              {t('memberHome.heroSubtitle', 'Your dashboard is right below: your profile, your company, your events and your requests, all managed from here.')}
            </HeroIn>
            <HeroIn delay={340} className="mt-6 max-w-[520px]">
              <SearchField examples={searchExamples} suggest={ALL_SUGGESTIONS} />
            </HeroIn>
            <HeroIn delay={420} className="mt-5 flex flex-wrap items-center gap-3">
              {/* A plain anchor: the dashboard is on this page (html's scroll-padding keeps it clear of the header). */}
              <Button asChild variant="ctaOnDark" size="lg">
                <a href="#dashboard">{t('memberHome.heroDashboard', 'Go to my dashboard')}</a>
              </Button>
              <Button asChild variant="ctaLight" size="lg">
                <Link to="/resources">{t('home.exploreResources', 'Explore resources')}</Link>
              </Button>
            </HeroIn>
            {/* Took part in Smart Marina 2026: a small mark, linked to My events. Last, so nothing above it moves when it arrives. */}
            <div><Sm26WelcomeBadge /></div>
          </div>
        )}
      </SplitHero>

      {/* ════════════ Signed in: the dashboard, right under "Welcome back" ════════════ */}
      {user && (
        <Suspense fallback={<div aria-hidden="true" className="min-h-[70vh] bg-page" />}>
          <MemberDashboard />
        </Suspense>
      )}

      {/* The news band that used to sit here is the site-wide ticker above the header now (SiteTicker). */}

      {/* ════════════ Figures band: the figures on plain white ════════════ */}
      <FiguresBand figures={stats} loading={publicLoading} />

      {/* ════════════ Below the figures: its own chunk ════════════ */}
      <Suspense fallback={<div aria-hidden="true" className="min-h-[220vh] bg-page" />}>
        <HomeBelowFold
          signedIn={!!user}
          showNeedPanel={showNeedPanel}
          canSubmitNeed={false}
          providers={providers}
          resources={featuredResources}
          themeCounts={themeCounts}
          sponsors={sponsors}
          loading={publicLoading}
          lang={lang}
          directoryLine={directoryLine}
          resourcesLine={resourcesLine}
        />
      </Suspense>
    </div>
  );
}
