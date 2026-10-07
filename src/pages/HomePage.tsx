import { lazy, Suspense, useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Seo } from '@/components/seo/Seo';
import { AlertCircle, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { SITE_IMAGES } from '@/lib/siteMedia';
import { THEMES, themesForSectors, type ThemeKey } from '@/lib/themes';
import { networkFigures, formatFigure, type OrgFigureRow } from '@/lib/networkStats';
import { SPONSOR_TIERS, isSponsorTier, type OrgTier } from '@/types/database';
import { InsetHero, HeroIn } from '@/components/brand/InsetHero';
import { EventNotch } from '@/components/brand/EventNotch';
import { SearchField } from '@/components/brand/SearchField';
import { Eyebrow } from '@/components/brand/Eyebrow';
import { notchEventItems } from '@/components/brand/m3Events';
import { LineReveal } from '@/components/motion/LineReveal';
import { FiguresBand, type HomeFigures } from '@/components/home/FiguresBand';
import type { ProviderCardData } from '@/components/home/NeedPanel';
import type { HomeResource } from '@/components/home/ResourcesAgenda';
import type { SponsorLogo } from '@/components/home/SponsorsBand';
import { MemberSpace, type PersonalEvent, type PersonalResource } from '@/components/home/MemberSpace';

// Everything below the figures band is its own chunk: the entry bundle (every
// route, /admin and /sm26 included) does not carry the home page's lower sections.
const HomeBelowFold = lazy(() => import('@/components/home/HomeBelowFold'));

/**
 * The homepage (refonte v2, Oct 2026), in the spirit of the Solar Impulse
 * Foundation site: large photography, slow scroll-linked motion, one gold action.
 *
 *   inset hero: photo, H1 by lines, live-figures sentence, search, buttons,
 *               giant marquee, notch card turning the three M3 events  — everyone
 *   figures band: graticule, ruler that draws itself, counters         — everyone
 *   member band: dashboard door, counters, personal feeds               — signed in
 *   who it is for: photo cards in an accordion                          — visitors
 *   "Run a marina?": need form preview + a row of members following the scroll
 *                                                          — visitors and marinas
 *   latest articles + agenda                                            — everyone
 *   giant editorial marquee, then "Our events": a sticky stack        — everyone
 *   how it works: channel steps                                         — visitors
 *   event sponsors, logo tiles by tier                                  — everyone
 *   directory and resources tiles + contact panel                       — everyone
 *
 * Everything from the profiles down is a lazy chunk (HomeBelowFold).
 *
 * Figures are live counts (networkStats) unless an admin sets
 * display_stats.override, in which case they show as "N+". The M3 events
 * (World Yachting Summit in Dubai, 27 Nov 2026, by invitation; webinars; the
 * Rendezvous) are carried by the notch, the agenda and the events stack, all
 * three side by side: the platform is not the Rendezvous' own site. The
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
  const { user, profile, organization, profileTimedOut, refreshProfile, loading: authLoading } = useAuth();
  const [retrying, setRetrying] = useState(false);

  // Public sections
  const [publicLoading, setPublicLoading] = useState(true);
  const [stats, setStats] = useState<HomeStats>({ marinas: null, suppliers: null, countries: null, resources: null, memberMarinas: null, manual: false });
  const [featuredResources, setFeaturedResources] = useState<HomeResource[]>([]);
  const [themeCounts, setThemeCounts] = useState<Record<ThemeKey, number> | null>(null);
  const [sponsors, setSponsors] = useState<SponsorLogo[]>([]);
  const [providers, setProviders] = useState<ProviderCardData[]>([]);

  // Personalized data for logged-in users
  const [accountLoaded, setAccountLoaded] = useState(false);
  const [feedLoaded, setFeedLoaded] = useState(false);
  const [personalResources, setPersonalResources] = useState<PersonalResource[]>([]);
  const [personalEvents, setPersonalEvents] = useState<PersonalEvent[]>([]);
  const [myRegistrations, setMyRegistrations] = useState<{ event_id: string; title: string; date_time: string }[]>([]);
  const [personalStats, setPersonalStats] = useState<{ profileViews: number; connectionRequests: number; pendingItems: number } | null>(null);

  const lang = i18n.language === 'fr' ? 'fr-FR' : 'en-GB';

  // Keyed on ids and primitives, never on the user/profile/organization
  // objects: auth-js hands a new user object on every tab refocus, and
  // re-running this on each one would refetch and flicker the member band.
  const uid = user?.id;
  const persona = profile?.persona as string | undefined;
  const hasProfile = !!profile;
  const feedOrgId = organization?.id;

  // My registrations and my counters only need the account, not the profile:
  // they load even when the profile is slow or never arrives (the AuthContext
  // safety timeout, a failed profile fetch), so the band never pulses forever.
  // uid only changes on sign-in / sign-out / account switch — a real first load.
  useEffect(() => {
    // A different account (or none): nothing of the previous one may linger.
    // Functional updates so the very first mount does not re-render for nothing.
    const clear = <T,>(prev: T[]) => (prev.length ? [] : prev);
    setAccountLoaded(false);
    setMyRegistrations(clear);
    setPersonalStats(null);
    setFeedLoaded(false);
    setPersonalResources(clear);
    setPersonalEvents(clear);
    if (!uid) return;
    let alive = true;
    const fetchMine = async () => {
      // Using allSettled so a 503 on one table doesn't block the others
      const [regsRes, viewsRes, connectionsRes, pendingRes] = await Promise.allSettled([
        // My registrations
        supabase
          .from('event_registrations')
          .select('event_id, events(title, date_time)')
          .eq('user_id', uid)
          .order('created_at', { ascending: false })
          .limit(5),
        // Personal stats: profile views, connection requests, pending items
        supabase
          .from('profile_views')
          .select('id', { count: 'exact' })
          .eq('viewed_user_id', uid),
        supabase
          .from('partner_requests')
          .select('id', { count: 'exact' })
          .eq('marina_user_id', uid)
          .in('status', ['pending', 'accepted']),
        supabase
          .from('partner_requests')
          .select('id', { count: 'exact' })
          .eq('marina_user_id', uid)
          .eq('status', 'pending'),
      ]);
      if (!alive) return;
      const regs = regsRes.status === 'fulfilled' ? regsRes.value.data : null;
      if (regs) {
        setMyRegistrations(
          (regs as unknown as { event_id: string; events: { title: string; date_time: string } | null }[])
            .filter((r): r is { event_id: string; events: { title: string; date_time: string } } => r.events !== null)
            .map(r => ({ event_id: r.event_id, title: r.events.title, date_time: r.events.date_time }))
        );
      }
      setPersonalStats({
        profileViews: viewsRes.status === 'fulfilled' ? (viewsRes.value.count || 0) : 0,
        connectionRequests: connectionsRes.status === 'fulfilled' ? (connectionsRes.value.count || 0) : 0,
        pendingItems: pendingRes.status === 'fulfilled' ? (pendingRes.value.count || 0) : 0,
      });
      setAccountLoaded(true);
    };
    fetchMine().catch((err) => {
      if (import.meta.env.DEV) console.error('Home member counters failed:', err);
      if (alive) setAccountLoaded(true);
    });
    return () => { alive = false; };
  }, [uid]);

  // Fetch personalized feed for logged-in users (from org-level sectors).
  // Needs the persona, so it waits for the profile. A later re-run (company
  // switch) keeps the current cards until the new ones arrive — no skeleton.
  useEffect(() => {
    if (!uid || !hasProfile) return;
    let alive = true;
    const fetchFeed = async () => {
      const orgSectorTable = (persona === 'marina' || persona === 'developer' || persona === 'investor')
        ? 'organization_interest_sectors'
        : (persona === 'partner' || persona === 'media_partner')
        ? 'organization_service_sectors'
        : null;

      let sectorIds: string[] = [];
      if (orgSectorTable && feedOrgId) {
        const { data: userSectors } = await supabase
          .from(orgSectorTable)
          .select('sector_id')
          .eq('organization_id', feedOrgId);
        sectorIds = (userSectors || []).map((s: { sector_id: string }) => s.sector_id);
      }

      if (sectorIds.length > 0) {
        const { data: feedRes } = await supabase
          .from('resource_sectors')
          .select('resource_id, resources!inner(id, title, summary, type, access_level, thumbnail_url, published)')
          .in('sector_id', sectorIds)
          .eq('resources.published', true)
          .limit(8);

        if (alive && feedRes) {
          const unique = new Map<string, PersonalResource>();
          for (const r of feedRes as unknown as { resource_id: string; resources: PersonalResource & { published: boolean } }[]) {
            if (r.resources && !unique.has(r.resources.id)) {
              unique.set(r.resources.id, r.resources);
            }
          }
          setPersonalResources(Array.from(unique.values()).slice(0, 6));
        }

        const { data: feedEvt } = await supabase
          .from('event_sectors')
          .select('event_id, events!inner(id, title, date_time, access_level, published)')
          .in('sector_id', sectorIds)
          .limit(8);

        if (alive && feedEvt) {
          const unique = new Map<string, PersonalEvent>();
          for (const e of feedEvt as unknown as { event_id: string; events: PersonalEvent & { published: boolean | null } }[]) {
            // Same rule as the events page: an unpublished event is not announced.
            if (e.events && e.events.published !== false && new Date(e.events.date_time) > new Date() && !unique.has(e.events.id)) {
              unique.set(e.events.id, e.events);
            }
          }
          setPersonalEvents(Array.from(unique.values()).slice(0, 4));
        }
      } else if (alive) {
        // No sectors for this company (or a persona without a sector feed):
        // drop whatever a previously active company had recommended.
        setPersonalResources([]);
        setPersonalEvents([]);
      }
      if (alive) setFeedLoaded(true);
    };
    fetchFeed().catch((err) => {
      if (import.meta.env.DEV) console.error('Home personal feed failed:', err);
      if (alive) setFeedLoaded(true);
    });
    return () => { alive = false; };
  }, [uid, hasProfile, persona, feedOrgId]);

  // The sector feed is ready once fetched — or once auth has settled without a
  // profile, in which case the cards show their empty states instead of a
  // skeleton that would never resolve.
  const feedReady = feedLoaded || (!authLoading && !hasProfile);

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
    : t('seo.home.description', 'Free B2B network for marinas and their service providers, with industry events in Monaco, Dubai and online. Every member checked by M3.');

  const searchExamples = useMemo(
    () => [t('brand.search.ex1'), t('brand.search.ex2'), t('brand.search.ex3'), t('brand.search.ex4')],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [i18n.language],
  );
  // The notch card turns the three M3 events (WYS while upcoming, webinars, the Rendezvous).
  const notch = useMemo(() => <EventNotch items={notchEventItems(t)} />, [t]);
  const marquee = useMemo(
    () => [t('brand.hero.marquee1', 'Smart'), t('brand.hero.marquee2', 'Sustainable'), t('brand.hero.marquee3', 'Connected')],
    [t],
  );

  // "Run a marina?" speaks to visitors and to marinas; for a signed-in marina it opens the real forms.
  const showNeedPanel = !user || persona === 'marina';

  // The end tiles' lines: "180 marinas and 66 service providers in 45 countries", "30 resources in six themes".
  const directoryLine = liveFigures
    ? t('homePage.end.directoryLive', liveFigures)
    : t('homePage.end.directory', 'Marinas, service providers, investors and media');
  const resourcesLine = !publicLoading && stats.resources !== null && !stats.manual
    ? t('homePage.end.resourcesLive', { count: stats.resources, defaultValue: '{{count}} resources in six themes' })
    : t('homePage.end.resources', 'Articles, guides and replays in six themes');

  const trust = [
    t('home.trustFree', 'Free for every member'),
    t('home.trustVerified', 'Every member checked by the M3 team'),
    t('home.trustEvents', 'By M3 Monaco, organiser of industry events in Monaco, Dubai and online'),
  ];

  return (
    <div className="flex flex-col bg-page">
      <Seo title={seoTitle} description={seoDescription} path="/" />

      {/* ════════════ Inset hero ════════════ */}
      <InsetHero
        image={SITE_IMAGES.homeHero}
        seed="home-hero"
        labelledBy="home-hero-title"
        marquee={marquee}
        notch={notch}
        className={user ? 'md:min-h-[min(calc(100svh-52px),760px)]' : undefined}
      >
        {!user ? (
          <>
            <div className="max-w-[780px]">
              <HeroIn>
                <Eyebrow tone="onDark">{t('homePage.hero.eyebrow', 'Smart Marina Connect · by M3 Monaco')}</Eyebrow>
              </HeroIn>
              <LineReveal
                as="h1"
                id="home-hero-title"
                trigger="mount"
                delay={160}
                className="mt-5 text-balance text-[36px] font-semibold leading-[42px] tracking-[-0.025em] text-white md:text-[54px] md:leading-[60px] xl:text-[58px] xl:leading-[64px]"
              >
                {t('home.heroTitle', 'Marinas and the companies that serve them, in one network')}
              </LineReveal>
              <HeroIn as="p" delay={260} className="mt-5 max-w-[660px] text-[17px] leading-[27px] text-white/85 md:text-[19px] md:leading-[30px]">
                {liveFigures
                  ? t('home.heroSubtitleLive', liveFigures)
                  : t('home.heroSubtitle', "Marinas publish their needs, service providers answer them, and everyone meets at M3's events in Monaco, Dubai and online.")}
              </HeroIn>
              <HeroIn delay={340} className="mt-6 max-w-[540px]">
                <SearchField examples={searchExamples} />
              </HeroIn>
              <HeroIn delay={420} className="mt-5 flex flex-wrap items-center gap-3">
                {/* On the navy hero: gold with WHITE water, so it never vanishes on hover/focus. */}
                <Button asChild variant="ctaOnDark" size="lg">
                  <Link to="/become-partner">{t('home.joinNowFree', 'Sign up')}</Link>
                </Button>
                <Button asChild variant="ctaLight" size="lg">
                  <Link to="/directory">{t('home.exploreDirectory', 'Explore the directory')}</Link>
                </Button>
              </HeroIn>
            </div>
            <HeroIn
              as="ul"
              delay={500}
              aria-label={t('homePage.hero.trustLabel', 'Why join')}
              // From xl the notch takes the bottom left corner: the commitments start after it (.hero-after-notch).
              className="hero-after-notch mt-7 grid max-w-[880px] gap-3 text-[14px] leading-5 text-white/85 md:grid-cols-[0.78fr_1fr_1.6fr] md:gap-0"
            >
              {trust.map((line, i) => (
                <li
                  key={line}
                  className={
                    i === 0
                      ? 'flex gap-2.5 md:pr-5'
                      : i === 1
                        ? 'flex gap-2.5 md:border-l md:border-white/25 md:px-5'
                        : 'flex gap-2.5 md:border-l md:border-white/25 md:pl-5'
                  }
                >
                  <Check className="mt-px h-[18px] w-[18px] shrink-0 text-gold" strokeWidth={2.5} aria-hidden="true" />
                  {line}
                </li>
              ))}
            </HeroIn>
          </>
        ) : (
          <div className="max-w-[780px]">
            <HeroIn>
              <Eyebrow tone="onDark">{t('homePage.hero.memberEyebrow', 'Smart Marina Connect · your network')}</Eyebrow>
            </HeroIn>
            <LineReveal
              as="h1"
              id="home-hero-title"
              trigger="mount"
              delay={160}
              className="mt-5 text-balance text-[36px] font-semibold leading-[42px] tracking-[-0.025em] text-white md:text-[54px] md:leading-[60px] xl:text-[58px] xl:leading-[64px]"
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
                  className="focus-ring rounded font-medium underline hover:text-white disabled:opacity-50"
                >
                  {retrying ? t('homeSections.retrying', 'Retrying…') : t('homeSections.retry', 'Retry now')}
                </button>
              </div>
            )}
            <HeroIn as="p" delay={260} className="mt-5 max-w-[660px] text-[17px] leading-[27px] text-white/85 md:text-[19px] md:leading-[30px]">
              {t('home.personalizedSubtitle', "Here's what's happening in the marina industry for you.")}
            </HeroIn>
            <HeroIn delay={340} className="mt-6 max-w-[540px]">
              <SearchField examples={searchExamples} />
            </HeroIn>
            <HeroIn delay={420} className="mt-5 flex flex-wrap items-center gap-3">
              <Button asChild variant="ctaOnDark" size="lg">
                <Link to="/resources">{t('home.exploreResources', 'Explore resources')}</Link>
              </Button>
              <Button asChild variant="ctaLight" size="lg">
                <Link to="/dashboard">{t('nav.dashboard', 'Dashboard')}</Link>
              </Button>
            </HeroIn>
          </div>
        )}
      </InsetHero>

      {/* ════════════ Figures band: graticule, ruler, counters ════════════ */}
      <FiguresBand figures={stats} loading={publicLoading} className={user ? 'pb-10 md:pb-12' : undefined} />

      {/* ════════════ Signed in: the member's own band ════════════ */}
      {user && (
        <MemberSpace
          profileIncomplete={!!profile && (profile.onboarding_status !== 'completed' || !organization)}
          orgName={organization?.name ?? null}
          orgLogo={organization?.logo_url ?? null}
          personalStats={personalStats}
          accountLoaded={accountLoaded}
          feedLoaded={feedReady}
          myRegistrations={myRegistrations}
          personalResources={personalResources}
          personalEvents={personalEvents}
          lang={lang}
        />
      )}

      {/* ════════════ Below the figures: its own chunk ════════════ */}
      <Suspense fallback={<div aria-hidden="true" className="min-h-[220vh] bg-page" />}>
        <HomeBelowFold
          signedIn={!!user}
          showNeedPanel={showNeedPanel}
          canSubmitNeed={!!user && persona === 'marina'}
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
