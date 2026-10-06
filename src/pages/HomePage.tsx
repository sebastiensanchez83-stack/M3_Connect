import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Helmet } from 'react-helmet-async';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Anchor, ArrowRight, BookOpen, Briefcase, Building2, CalendarDays, CheckCircle, CheckCircle2,
  ClipboardCheck, Clock, Eye, FileText, Globe2, Inbox, LayoutDashboard, Link2, Lock, MapPin,
  Newspaper, PlayCircle, Sparkles, Unlock, UserPlus, Users, Video, AlertCircle, HeartHandshake, Mail,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { AdBanner } from '@/components/ui/AdBanner';
import { CoverImage, LogoBadge } from '@/components/ui/CoverImage';
import { SponsorBadge } from '@/components/ui/SponsorBadge';
import { MomentsStrip } from '@/components/ui/MomentsStrip';
import { TeaserVideo } from '@/components/home/TeaserVideo';
import { SITE_IMAGES, PERSONA_IMAGES } from '@/lib/siteMedia';
import { THEMES, getTheme, themesForSectors, type Theme, type ThemeKey } from '@/lib/themes';
import { accountHref } from '@/lib/accountNav';
import { networkFigures, formatFigure, type OrgFigureRow } from '@/lib/networkStats';
import type { OrgTier } from '@/types/database';
import { cn } from '@/lib/utils';

/**
 * The homepage.
 *
 * The two heroes (visitor: hall photo + teaser; member: welcome band) are kept
 * as they were. Everything below them follows the new pages: picture cards,
 * theme doors into the library, date-chip event cards and a logo wall, on the
 * gray-50 / white rhythm of the resource library and the dashboard.
 *
 * Figures are live counts (verified organizations, published resources) by
 * default, not the hand-typed numbers in platform_settings.display_stats —
 * those had fallen well behind (85 marinas shown, 180 listed). The setting
 * still wins when an admin sets `override: true` in it, and otherwise fills in
 * when a live count cannot be had.
 *
 * The partner wall shows only organizations an admin has featured
 * (featured_partner); every other member is one click away in the directory.
 *
 * Members get their own band right under the hero with a door to /dashboard,
 * their counters and their personal feed — the homepage is where a returning
 * member lands after clicking the logo, and it must not be a dead end.
 */

/* ─── Model ──────────────────────────────────────────────────────── */

interface FeaturedResource {
  id: string;
  title: string;
  summary: string | null;
  type: string;
  access_level: string;
  thumbnail_url: string | null;
  created_at: string;
  published_at: string | null;
  themes: ThemeKey[];
}

interface PersonalResource {
  id: string;
  title: string;
  summary: string | null;
  type: string;
  access_level: string;
  thumbnail_url: string | null;
}

interface UpcomingEvent {
  id: string;
  title: string;
  date_time: string;
  access_level: string;
}

interface HomeEvent {
  id: string;
  title: string;
  date_time: string;
  end_date_time: string | null;
  event_type: string | null;
  location: string | null;
  is_full_day: boolean;
  invitation_only: boolean;
  replay_url: string | null;
}

interface OrgLogo {
  id: string;
  slug: string;
  name: string;
  logo_url: string | null;
  tier: OrgTier;
  organization_type: string | null;
}

interface HomeStats {
  marinas: number | null;
  suppliers: number | null;
  countries: number | null;
  resources: number | null;
  /** The admin's hand-typed figures (display_stats.override), shown as "N+". */
  manual: boolean;
}

type EventRow = {
  id: string; title: string; date_time: string | null; end_date_time: string | null;
  event_type: string | null; location: string | null; is_full_day: boolean | null;
  invitation_only: boolean | null; replay_url: string | null; published: boolean | null;
};

/* ─── Helpers ────────────────────────────────────────────────────── */

/** Still upcoming = not finished yet, so a two-day conference stays listed on day two. */
function isUpcoming(e: { date_time: string | null; end_date_time: string | null }, now: number): boolean {
  if (!e.date_time) return false;
  return new Date(e.end_date_time ?? e.date_time).getTime() >= now;
}

function toHomeEvent(e: EventRow): HomeEvent {
  return {
    id: e.id,
    title: e.title,
    date_time: e.date_time as string,
    end_date_time: e.end_date_time,
    event_type: e.event_type,
    location: e.location,
    is_full_day: !!e.is_full_day,
    invitation_only: !!e.invitation_only,
    replay_url: e.replay_url,
  };
}

/** Day (or day range) and month for the chip on an event card. */
function dateChip(e: HomeEvent, lang: string): { day: string; month: string } {
  const start = new Date(e.date_time);
  const end = e.end_date_time ? new Date(e.end_date_time) : null;
  const month = start.toLocaleDateString(lang, { month: 'short' }).replace('.', '');
  if (end && end.toDateString() !== start.toDateString() && end.getMonth() === start.getMonth()) {
    return { day: `${start.getDate()}–${end.getDate()}`, month };
  }
  return { day: String(start.getDate()), month };
}

/** The date line under an event title: a range for multi-day events, a time otherwise. */
function dateLine(e: HomeEvent, lang: string): string {
  const start = new Date(e.date_time);
  const end = e.end_date_time ? new Date(e.end_date_time) : null;
  if (end && end.toDateString() !== start.toDateString()) {
    if (end.getMonth() === start.getMonth() && end.getFullYear() === start.getFullYear()) {
      return `${start.getDate()}–${end.getDate()} ${start.toLocaleDateString(lang, { month: 'long', year: 'numeric' })}`;
    }
    return `${start.toLocaleDateString(lang, { day: 'numeric', month: 'short' })} – ${end.toLocaleDateString(lang, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  }
  const day = start.toLocaleDateString(lang, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
  // A full-day event has no meaningful start time — "00:00" would read as midnight.
  return e.is_full_day ? day : `${day} · ${start.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' })}`;
}

const focusRing = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2';

/* ─── Page ───────────────────────────────────────────────────────── */

export function HomePage() {
  const { t, i18n } = useTranslation();
  const { user, profile, organization, profileTimedOut, refreshProfile, loading: authLoading } = useAuth();
  const [retrying, setRetrying] = useState(false);

  // Public sections
  const [publicLoading, setPublicLoading] = useState(true);
  const [stats, setStats] = useState<HomeStats>({ marinas: null, suppliers: null, countries: null, resources: null, manual: false });
  const [orgCount, setOrgCount] = useState<number | null>(null);
  const [featuredResources, setFeaturedResources] = useState<FeaturedResource[]>([]);
  const [themeCounts, setThemeCounts] = useState<Record<ThemeKey, number> | null>(null);
  const [upcomingEvents, setUpcomingEvents] = useState<HomeEvent[]>([]);
  const [pastEvents, setPastEvents] = useState<HomeEvent[]>([]);
  const [featuredPartners, setFeaturedPartners] = useState<OrgLogo[]>([]);

  // Personalized data for logged-in users
  const [accountLoaded, setAccountLoaded] = useState(false);
  const [feedLoaded, setFeedLoaded] = useState(false);
  const [personalResources, setPersonalResources] = useState<PersonalResource[]>([]);
  const [personalEvents, setPersonalEvents] = useState<UpcomingEvent[]>([]);
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
          const unique = new Map<string, UpcomingEvent>();
          for (const e of feedEvt as unknown as { event_id: string; events: UpcomingEvent & { published: boolean | null } }[]) {
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
  // section never blanks the others.
  useEffect(() => {
    let alive = true;
    const fetchAll = async () => {
      const now = Date.now();
      const nowIso = new Date(now).toISOString();
      // A week of slack so a multi-day event that started recently still comes back.
      const since = new Date(now - 7 * 24 * 3600 * 1000).toISOString();

      const [
        settingsRes, orgStatsRes, sectorsRes, resIndexRes, featuredRes,
        upcomingRes, pastRes, featuredOrgRes,
      ] = await Promise.allSettled([
        // Admin-editable display stats: used as they are when the admin has
        // set `override: true`, otherwise only as a fallback for a failed live count.
        supabase.from('platform_settings').select('value').eq('key', 'display_stats').maybeSingle(),
        // One light row per verified organization: counts by type and countries.
        supabase.from('organizations').select('organization_type, country, headquarters_country').eq('access_status', 'verified'),
        supabase.from('sectors').select('id, slug'),
        // Every published resource's sectors, for the theme counts and the total.
        supabase.from('resources').select('id, resource_sectors(sector_id)').eq('published', true),
        // The latest four, in the library's own order.
        supabase
          .from('resources')
          .select('id, title, summary, type, access_level, thumbnail_url, created_at, published_at, resource_sectors(sector_id)')
          .eq('published', true)
          .order('published_at', { ascending: false, nullsFirst: false })
          .order('created_at', { ascending: false })
          .limit(4),
        supabase
          .from('events')
          .select('id, title, date_time, end_date_time, event_type, location, is_full_day, invitation_only, replay_url, published')
          .gte('date_time', since)
          .order('date_time', { ascending: true })
          .limit(8),
        supabase
          .from('events')
          .select('id, title, date_time, end_date_time, event_type, location, is_full_day, invitation_only, replay_url, published')
          .lt('date_time', nowIso)
          .order('date_time', { ascending: false })
          .limit(6),
        // Partner previews — only orgs an admin has explicitly featured on the
        // home page (not every free member). Curated via the org admin page.
        supabase
          .from('organizations')
          .select('id, slug, name, logo_url, tier, organization_type')
          .eq('access_status', 'verified')
          .eq('featured_partner', true)
          .limit(6),
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

      setStats({
        marinas: figures.marinas,
        suppliers: figures.partners,
        countries: figures.countries,
        resources: figures.resources,
        manual: figures.manual,
      });
      setOrgCount(orgRows ? orgRows.length : null);

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

      type ResRow = Omit<FeaturedResource, 'themes'> & { resource_sectors?: { sector_id: string }[] | null };
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
      })).slice(0, 4));

      // ── Events: unpublished ones stay hidden, as on the events page ──
      const upcoming = ((ok(upcomingRes)?.data ?? []) as EventRow[])
        .filter((e) => e.published !== false && isUpcoming(e, now))
        .map(toHomeEvent)
        .sort((a, b) => a.date_time.localeCompare(b.date_time))
        .slice(0, 3);
      const past = ((ok(pastRes)?.data ?? []) as EventRow[])
        .filter((e) => e.published !== false && !isUpcoming(e, now))
        .map(toHomeEvent)
        .sort((a, b) => b.date_time.localeCompare(a.date_time))
        .slice(0, 3);
      setUpcomingEvents(upcoming);
      setPastEvents(past);

      // ── Partners: the curated featured_partner orgs only ──
      const featuredOrgs = ((ok(featuredOrgRes)?.data ?? []) as OrgLogo[]).map((o) => ({ ...o, tier: (o.tier || 'member') as OrgTier }));
      setFeaturedPartners(featuredOrgs.slice(0, 6));

      setPublicLoading(false);
    };

    fetchAll().catch((err) => {
      if (import.meta.env.DEV) console.error('Home sections failed:', err);
      if (alive) setPublicLoading(false);
    });
    return () => { alive = false; };
  }, []);

  const registeredIds = useMemo(() => new Set(myRegistrations.map((r) => r.event_id)), [myRegistrations]);

  return (
    <div className="flex flex-col">
      <Helmet>
        <title>Smart Marina Connect — The B2B Platform for the Marina &amp; Yachting Industry</title>
        <meta name="description" content="Smart Marina Connect is the professional B2B network connecting marinas, service providers, and media partners worldwide. Access exclusive resources, industry events, RFPs, and grow your marina business." />
        <meta property="og:title" content="Smart Marina Connect — The B2B Platform for the Marina & Yachting Industry" />
        <meta property="og:description" content="Connect marinas, service providers, and media partners. Share expertise, find solutions, and grow your marina business on the industry's professional network." />
        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://smartmarinaconnect.com/" />
      </Helmet>
      {/* Hero — visitors: the SM26 hall behind, the platform teaser beside the pitch */}
      {!user && (
        <section className="relative overflow-hidden text-white">
          <CoverImage
            src={SITE_IMAGES.homeHero.src}
            focusY={SITE_IMAGES.homeHero.focusY}
            alt=""
            seed="home-hero"
            aspect="fill"
            tone="sea"
            eager
            className="absolute inset-0"
          />
          {/* Navy wash, heavier on the text side, so the copy reads on any crop. */}
          <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-b from-[#0b2653]/90 via-[#0b2653]/80 to-[#0b2653]/90 lg:bg-gradient-to-r lg:from-[#0b2653]/95 lg:via-[#0b2653]/80 lg:to-[#0b2653]/55" />
          <div className="relative container mx-auto grid items-center gap-10 px-4 py-14 md:py-20 lg:grid-cols-[1fr_1.1fr] lg:gap-14 lg:py-24">
            <div className="text-center lg:text-left">
              <h1 className="mb-5 text-4xl font-bold leading-tight md:text-5xl xl:text-6xl">
                {t('home.heroTitle', 'The B2B Network for the Marina & Yachting Industry')}
              </h1>
              <p className="mx-auto mb-8 max-w-2xl text-lg text-gray-200 md:text-xl lg:mx-0">
                {t('home.heroSubtitle', 'Connect marinas, service providers, and media partners. Share expertise, find solutions, grow your business.')}
              </p>
              <div className="flex flex-col justify-center gap-4 sm:flex-row lg:justify-start">
                <Button size="lg" variant="secondary" asChild>
                  <Link to="/become-partner">
                    {t('home.joinNowFree', 'Join Now — It\'s Free')}
                    <ArrowRight className="ml-2 h-5 w-5" />
                  </Link>
                </Button>
                <Button size="lg" variant="outline" className="bg-transparent border-white text-white hover:bg-white/10" asChild>
                  <Link to="/directory">
                    {t('home.exploreDirectory', 'Explore the directory')}
                  </Link>
                </Button>
              </div>
              {/* Trust indicators */}
              <div className="mt-8 flex flex-wrap justify-center gap-3 text-xs text-gray-200 sm:gap-6 sm:text-sm lg:justify-start">
                <span className="flex items-center gap-1.5"><CheckCircle className="h-4 w-4 text-green-300" /> {t('home.trustFree', 'Free for Marinas')}</span>
                <span className="flex items-center gap-1.5"><CheckCircle className="h-4 w-4 text-green-300" /> {t('home.trustVerified', 'Verified Partners')}</span>
                <span className="flex items-center gap-1.5"><CheckCircle className="h-4 w-4 text-green-300" /> {t('home.trustEvents', 'Industry Events & Resources')}</span>
              </div>
            </div>
            <TeaserVideo />
          </div>
        </section>
      )}

      {/* Hero — signed-in members */}
      {user && (
      <section className="gradient-hero text-white py-20 md:py-32">
        <div className="container mx-auto px-4 text-center">
            <>
              <h1 className="text-3xl md:text-5xl font-bold mb-4">
                {t('home.welcomeBack', 'Welcome back')}{profile?.first_name ? `, ${profile.first_name}` : ''}!
              </h1>
              {profileTimedOut && !profile && (
                <div className="mb-4 inline-flex items-center gap-3 bg-white/15 backdrop-blur-sm rounded-lg px-4 py-2 text-sm text-white/90">
                  <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{t('homeSections.profileSlow', 'Profile data is loading slowly.')}</span>
                  <button
                    onClick={async () => { setRetrying(true); await refreshProfile(); setRetrying(false); }}
                    disabled={retrying}
                    className="underline font-medium hover:text-white disabled:opacity-50"
                  >
                    {retrying ? t('homeSections.retrying', 'Retrying…') : t('homeSections.retry', 'Retry now')}
                  </button>
                </div>
              )}
              <p className="text-lg md:text-xl text-gray-200 mb-8 max-w-2xl mx-auto">
                {t('home.personalizedSubtitle', 'Here\'s what\'s happening in the marina industry for you.')}
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Button size="lg" variant="secondary" asChild>
                  <Link to="/resources">
                    {t('home.exploreResources')}
                    <ArrowRight className="ml-2 h-5 w-5" />
                  </Link>
                </Button>
                <Button size="lg" variant="outline" className="bg-transparent border-white text-white hover:bg-white/10" asChild>
                  <Link to="/dashboard">
                    {t('nav.dashboard', 'Dashboard')}
                  </Link>
                </Button>
              </div>
            </>
        </div>
      </section>
      )}

      {/* ════════════ Signed out: the pitch ════════════ */}
      {!user && (
        <>
          <StatsBand stats={stats} loading={publicLoading} />
          <WhyJoin />
          <HowItWorks />
        </>
      )}

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

      {/* ════════════ Everyone ════════════ */}
      <ResourcesSection
        resources={featuredResources}
        themeCounts={themeCounts}
        loading={publicLoading}
        lang={lang}
        className={user ? 'bg-white' : 'bg-gray-50'}
      />

      {/* Sponsor Ad Banner */}
      <section className={cn('py-4', user ? 'bg-white' : 'bg-gray-50')}>
        <div className="container mx-auto px-4">
          <AdBanner placement="homepage" />
        </div>
      </section>

      <EventsSection
        upcoming={upcomingEvents}
        past={pastEvents}
        loading={publicLoading}
        registeredIds={registeredIds}
        lang={lang}
        className={user ? 'bg-gray-50' : 'bg-white'}
      />

      <MomentsStrip className={user ? 'bg-white' : 'bg-gray-50'} />

      <PartnersWall
        featured={featuredPartners}
        orgCount={orgCount}
        loading={publicLoading}
        className={user ? 'bg-gray-50' : 'bg-white'}
      />

      {/* CTA Banner — only for logged-out users */}
      {!user && <ClosingCta />}
    </div>
  );
}

/* ─── Shared pieces ──────────────────────────────────────────────── */

function SectionHeader({
  id, eyebrow, title, subtitle, link, center = false,
}: {
  id: string;
  eyebrow?: string;
  title: string;
  subtitle?: string;
  link?: { to: string; label: string };
  center?: boolean;
}) {
  return (
    <div className={cn('mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-3', center && 'flex-col items-center text-center')}>
      <div className={cn('max-w-2xl', center && 'mx-auto')}>
        {eyebrow && (
          <p className={cn('flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary', center && 'justify-center')}>
            <span aria-hidden="true" className="h-0.5 w-6 rounded-full bg-secondary" />
            {eyebrow}
          </p>
        )}
        <h2 id={id} className="mt-2 text-2xl font-bold tracking-tight text-primary sm:text-3xl">{title}</h2>
        {subtitle && <p className="mt-2 text-gray-600">{subtitle}</p>}
      </div>
      {link && (
        <Link
          to={link.to}
          className={cn('inline-flex min-h-10 items-center gap-1 rounded-md text-sm font-semibold text-primary underline-offset-4 hover:underline', focusRing)}
        >
          {link.label}
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      )}
    </div>
  );
}

/* ─── Signed out ─────────────────────────────────────────────────── */

function StatsBand({ stats, loading }: { stats: HomeStats; loading: boolean }) {
  const { t, i18n } = useTranslation();
  const items: { key: string; icon: LucideIcon; value: number | null; label: string; to: string }[] = [
    { key: 'marinas', icon: Anchor, value: stats.marinas, label: t('homeSections.stats.marinas', 'Marinas'), to: '/directory?type=marina' },
    { key: 'suppliers', icon: Briefcase, value: stats.suppliers, label: t('homeSections.stats.suppliers', 'Suppliers & experts'), to: '/directory?type=partner' },
    { key: 'countries', icon: Globe2, value: stats.countries, label: t('homeSections.stats.countries', 'Countries'), to: '/directory' },
    { key: 'resources', icon: BookOpen, value: stats.resources, label: t('homeSections.stats.resources', 'Articles & resources'), to: '/resources' },
  ];
  return (
    <section aria-labelledby="home-stats-heading" className="border-b border-gray-100 bg-white">
      <h2 id="home-stats-heading" className="sr-only">{t('homeSections.stats.heading', 'Smart Marina Connect in figures')}</h2>
      <div className="container mx-auto px-4 py-8 sm:py-10">
        <ul className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {items.map((item) => (
            <li key={item.key}>
              <Link
                to={item.to}
                className={cn(
                  'group flex h-full items-center gap-3 rounded-2xl bg-gray-50 p-4 ring-1 ring-gray-100 transition hover:bg-white hover:shadow-md sm:gap-4 sm:p-5',
                  focusRing,
                )}
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-white shadow-sm transition-transform group-hover:scale-105 sm:h-12 sm:w-12">
                  <item.icon className="h-5 w-5 sm:h-6 sm:w-6" aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  {loading ? (
                    <span className="block h-8 w-16 animate-pulse rounded bg-gray-200" aria-hidden="true" />
                  ) : (
                    <span className="block text-2xl font-bold leading-none tabular-nums text-primary sm:text-3xl">
                      {item.value !== null ? formatFigure(item.value, stats.manual, i18n.language) : '—'}
                    </span>
                  )}
                  <span className="mt-1 block text-xs font-medium text-gray-600 sm:text-sm">{item.label}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function WhyJoin() {
  const { t } = useTranslation();
  const personas: {
    key: string; image: string; icon: LucideIcon; title: string; desc: string; points: string[];
    cta: string; browse: { to: string; label: string };
  }[] = [
    {
      key: 'marinas',
      image: PERSONA_IMAGES.marinas,
      icon: Anchor,
      title: t('homeSections.persona.marinas.title', 'For marinas'),
      desc: t('homeSections.persona.marinas.desc', 'Find qualified suppliers, put your projects and RFPs in front of the right experts, and learn from your peers.'),
      points: [
        t('homeSections.persona.marinas.point1', 'Free membership'),
        t('homeSections.persona.marinas.point2', 'Projects, RFPs and expert consultations'),
        t('homeSections.persona.marinas.point3', 'Events and replays for your teams'),
      ],
      cta: t('homeSections.persona.marinas.cta', 'Join as a marina'),
      browse: { to: '/directory?type=partner', label: t('homeSections.persona.marinas.browse', 'Browse suppliers') },
    },
    {
      key: 'suppliers',
      image: PERSONA_IMAGES.suppliers,
      icon: Briefcase,
      title: t('homeSections.persona.suppliers.title', 'For suppliers & experts'),
      desc: t('homeSections.persona.suppliers.desc', 'Showcase your solutions, answer marina RFPs and meet the decision-makers who run ports and marinas.'),
      points: [
        t('homeSections.persona.suppliers.point1', 'A company profile in the directory'),
        t('homeSections.persona.suppliers.point2', 'Open RFPs and consultations'),
        t('homeSections.persona.suppliers.point3', 'Partner packages for more visibility'),
      ],
      cta: t('homeSections.persona.suppliers.cta', 'Join as a supplier'),
      browse: { to: '/directory?type=marina', label: t('homeSections.persona.suppliers.browse', 'See the marinas') },
    },
    {
      key: 'media',
      image: PERSONA_IMAGES.media,
      icon: Newspaper,
      title: t('homeSections.persona.media.title', 'For media & investors'),
      desc: t('homeSections.persona.media.desc', 'Follow the projects shaping the sector, reach a specialised audience and meet the teams behind them.'),
      points: [
        t('homeSections.persona.media.point1', 'Industry news, events and replays'),
        t('homeSections.persona.media.point2', 'Direct access to marinas and suppliers'),
        t('homeSections.persona.media.point3', 'Press access to events, deal flow for investors'),
      ],
      cta: t('homeSections.persona.media.cta', 'Join the network'),
      browse: { to: '/directory', label: t('homeSections.persona.media.browse', 'Explore the directory') },
    },
  ];

  return (
    <section aria-labelledby="home-why-heading" className="bg-gray-50 py-16">
      <div className="container mx-auto px-4">
        <SectionHeader
          id="home-why-heading"
          center
          eyebrow={t('homeSections.whyEyebrow', 'Who it is for')}
          title={t('homeSections.whyTitle', 'One network for the whole marina industry')}
          subtitle={t('homeSections.whySubtitle', 'Marinas, the companies that equip and serve them, and the media and investors who follow the sector — all on one platform.')}
        />
        <div className="grid gap-6 md:grid-cols-3">
          {personas.map((p) => (
            <article key={p.key} className="group flex flex-col overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-gray-100 transition hover:shadow-md">
              <CoverImage
                src={p.image}
                alt=""
                seed={`persona-${p.key}`}
                icon={p.icon}
                aspect="wide"
                imageClassName="group-hover:scale-105"
              >
                <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-[#0b2653]/90 via-[#0b2653]/20 to-transparent" />
                <span className="absolute left-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/95 text-primary shadow-sm">
                  <p.icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <h3 className="absolute inset-x-0 bottom-0 p-4 text-xl font-semibold text-white drop-shadow-sm">{p.title}</h3>
              </CoverImage>
              <div className="flex flex-1 flex-col p-5">
                <p className="text-sm leading-relaxed text-gray-600">{p.desc}</p>
                <ul className="mt-4 space-y-2">
                  {p.points.map((point) => (
                    <li key={point} className="flex gap-2 text-sm text-gray-800">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
                      {point}
                    </li>
                  ))}
                </ul>
                <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 pt-6">
                  <Button asChild className="h-auto min-h-10 whitespace-normal rounded-full px-5">
                    <Link to="/become-partner">
                      {p.cta}
                      <ArrowRight className="ml-1.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    </Link>
                  </Button>
                  <Link
                    to={p.browse.to}
                    className={cn('inline-flex min-h-10 items-center rounded-md text-sm font-medium text-primary underline-offset-4 hover:underline', focusRing)}
                  >
                    {p.browse.label}
                  </Link>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  const { t } = useTranslation();
  const steps: { icon: LucideIcon; title: string; desc: string }[] = [
    {
      icon: UserPlus,
      title: t('homeSections.steps.account.title', 'Create your free account'),
      desc: t('homeSections.steps.account.desc', 'Tell us whether you run a marina, supply the industry or cover it.'),
    },
    {
      icon: Building2,
      title: t('homeSections.steps.organization.title', 'Set up your organization'),
      desc: t('homeSections.steps.organization.desc', 'Join your company if it is already listed, or create its profile.'),
    },
    {
      icon: ClipboardCheck,
      title: t('homeSections.steps.verify.title', 'Get verified'),
      desc: t('homeSections.steps.verify.desc', 'Our team reviews every new member before opening full access.'),
    },
    {
      icon: Unlock,
      title: t('homeSections.steps.platform.title', 'Use the whole platform'),
      desc: t('homeSections.steps.platform.desc', 'Directory, opportunities, events and the full resource library.'),
    },
  ];
  return (
    <section aria-labelledby="home-how-heading" className="bg-white py-16">
      <div className="container mx-auto px-4">
        <SectionHeader
          id="home-how-heading"
          center
          eyebrow={t('homeSections.howEyebrow', 'Getting started')}
          title={t('homeSections.howTitle', 'How it works')}
          subtitle={t('homeSections.howSubtitle', 'Every member is checked by the M3 team, so you always know who you are talking to.')}
        />
        <div className="relative mx-auto max-w-5xl">
          {/* The thread joining the four steps, desktop only. */}
          <div aria-hidden="true" className="absolute left-[12.5%] right-[12.5%] top-7 hidden h-0.5 bg-gradient-to-r from-primary/15 via-secondary to-primary/15 lg:block" />
          <ol className="relative grid gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:gap-6">
            {steps.map((step, i) => (
              <li
                key={step.title}
                className="flex gap-4 rounded-2xl bg-gray-50 p-4 ring-1 ring-gray-100 lg:flex-col lg:items-center lg:bg-transparent lg:p-2 lg:text-center lg:ring-0"
              >
                <span className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary text-white shadow-md ring-4 ring-white">
                  <step.icon className="h-6 w-6" aria-hidden="true" />
                  <span aria-hidden="true" className="absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full bg-secondary text-xs font-bold text-primary">
                    {i + 1}
                  </span>
                </span>
                <span className="min-w-0">
                  <span className="block font-semibold text-gray-900">{step.title}</span>
                  <span className="mt-1 block text-sm text-gray-600">{step.desc}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
        <div className="mt-10 text-center">
          <Button asChild size="lg" className="h-auto min-h-11 whitespace-normal rounded-full">
            <Link to="/become-partner">
              {t('homeSections.createAccount', 'Create my free account')}
              <ArrowRight className="ml-2 h-5 w-5 shrink-0" aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}

function ClosingCta() {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="home-cta-heading" className="relative overflow-hidden text-white">
      <CoverImage
        src={SITE_IMAGES.joinHero.src}
        focusY={SITE_IMAGES.joinHero.focusY}
        alt=""
        seed="home-cta"
        icon={Anchor}
        aspect="fill"
        tone="sea"
        className="absolute inset-0"
      />
      <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-b from-[#0b2653]/90 to-[#0b2653]/95 md:bg-gradient-to-r md:from-[#0b2653]/95 md:via-[#0b2653]/85 md:to-[#0b2653]/50" />
      <div className="relative container mx-auto px-4 py-16 sm:py-20">
        <div className="max-w-2xl">
          <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-medium backdrop-blur-sm">
            <Anchor className="h-3.5 w-3.5 text-secondary" aria-hidden="true" />
            {t('homeSections.ctaEyebrow', 'Join the network')}
          </span>
          <h2 id="home-cta-heading" className="mt-4 text-3xl font-bold leading-tight drop-shadow-sm sm:text-4xl">
            {t('homeSections.ctaTitle', 'Ready to grow with the marina industry?')}
          </h2>
          <p className="mt-3 text-lg text-white/85">
            {t('homeSections.ctaSubtitle', 'Create your free account in a few minutes. Our team verifies every member, so the network stays professional.')}
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Button size="lg" variant="secondary" asChild className="h-auto min-h-11 whitespace-normal">
              <Link to="/become-partner">
                {t('homeSections.createAccount', 'Create my free account')}
                <ArrowRight className="ml-2 h-5 w-5 shrink-0" aria-hidden="true" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild className="h-auto min-h-11 whitespace-normal border-white bg-transparent text-white hover:bg-white/10 hover:text-white">
              <Link to="/tiers">{t('homeSections.ctaSecondary', 'Compare memberships')}</Link>
            </Button>
          </div>
          <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-white/90">
            <span className="flex items-center gap-1.5"><CheckCircle className="h-4 w-4 text-green-300" aria-hidden="true" /> {t('home.trustFree', 'Free for Marinas')}</span>
            <span className="flex items-center gap-1.5"><CheckCircle className="h-4 w-4 text-green-300" aria-hidden="true" /> {t('home.trustVerified', 'Verified Partners')}</span>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─── Signed in ──────────────────────────────────────────────────── */

function MemberSpace({
  profileIncomplete, orgName, orgLogo, personalStats, accountLoaded, feedLoaded,
  myRegistrations, personalResources, personalEvents, lang,
}: {
  profileIncomplete: boolean;
  orgName: string | null;
  orgLogo: string | null;
  personalStats: { profileViews: number; connectionRequests: number; pendingItems: number } | null;
  /** Registrations and counters (need only the account). */
  accountLoaded: boolean;
  /** The sector feed (needs the profile; also true once auth settled without one). */
  feedLoaded: boolean;
  myRegistrations: { event_id: string; title: string; date_time: string }[];
  personalResources: PersonalResource[];
  personalEvents: UpcomingEvent[];
  lang: string;
}) {
  const { t } = useTranslation();
  const shortcuts: { to: string; icon: LucideIcon; label: string }[] = [
    { to: accountHref('inbox'), icon: Inbox, label: t('accountNav.inbox', 'Inbox') },
    { to: accountHref('registrations'), icon: CalendarDays, label: t('accountNav.registrations', 'My events') },
    { to: accountHref('organization'), icon: Building2, label: t('accountNav.organization', 'Organization & team') },
  ];
  const statTiles: { key: string; to: string; icon: LucideIcon; value: number | undefined; label: string }[] = [
    { key: 'views', to: '/account', icon: Eye, value: personalStats?.profileViews, label: t('homeSections.personalStats.profileViews', 'Profile views') },
    { key: 'connections', to: accountHref('inbox'), icon: Link2, value: personalStats?.connectionRequests, label: t('homeSections.personalStats.connections', 'Connections') },
    { key: 'pending', to: accountHref('inbox'), icon: Inbox, value: personalStats?.pendingItems, label: t('homeSections.personalStats.pending', 'Pending requests') },
  ];

  return (
    <section aria-labelledby="home-member-heading" className="bg-gray-50 py-8 sm:py-10">
      <div className="container mx-auto px-4">
        <h2 id="home-member-heading" className="sr-only">{t('homeSections.memberEyebrow', 'Your space')}</h2>

        {/* Complete Profile Notification */}
        {profileIncomplete && (
          <div className="mb-6 flex flex-col gap-3 rounded-2xl bg-amber-50 p-4 text-amber-900 ring-1 ring-amber-200 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-start gap-3 text-sm font-medium">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" aria-hidden="true" />
              {t('home.completeOrgBanner', 'Complete your organization profile to unlock all platform features.')}
            </p>
            <Button size="sm" variant="outline" className="min-h-10 shrink-0 border-amber-300 bg-white text-amber-900 hover:bg-amber-100" asChild>
              <Link to="/account">{t('homeSections.completeProfileCta', 'Complete my profile')}</Link>
            </Button>
          </div>
        )}

        {/* The door to the dashboard: the obvious next step for a member on / */}
        <div className="relative overflow-hidden rounded-2xl text-white shadow-sm">
          <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-br from-[#0b2653] via-[#0f3557] to-[#1c4b86]" />
          <div className="relative grid gap-6 p-5 sm:p-6 lg:grid-cols-[1.2fr_1fr] lg:items-center lg:p-8">
            <div>
              <div className="flex items-center gap-3">
                {orgName ? (
                  <LogoBadge src={orgLogo} name={orgName} size="md" className="ring-2 ring-white/80" />
                ) : (
                  <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/15">
                    <LayoutDashboard className="h-6 w-6" aria-hidden="true" />
                  </span>
                )}
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-wider text-secondary">{t('homeSections.memberEyebrow', 'Your space')}</p>
                  {orgName && <p className="truncate text-sm text-white/90">{orgName}</p>}
                </div>
              </div>
              <h3 className="mt-4 text-2xl font-semibold tracking-tight">{t('homeSections.dashboardTitle', 'Your dashboard')}</h3>
              <p className="mt-1 max-w-xl text-sm text-white/85">
                {t('homeSections.dashboardBody', 'Requests to answer, your next events and open opportunities — all in one place.')}
              </p>
              <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                <Button asChild variant="secondary" className="h-auto min-h-11 whitespace-normal rounded-full px-5 font-semibold">
                  <Link to="/dashboard">
                    <LayoutDashboard className="mr-2 h-4 w-4 shrink-0" aria-hidden="true" />
                    {t('homeSections.dashboardCta', 'Open my dashboard')}
                    <ArrowRight className="ml-2 h-4 w-4 shrink-0" aria-hidden="true" />
                  </Link>
                </Button>
                <nav aria-label={t('homeSections.shortcuts', 'Shortcuts')} className="flex flex-wrap gap-2">
                  {shortcuts.map((s) => (
                    <Link
                      key={s.to}
                      to={s.to}
                      className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-white/10 px-3.5 text-sm font-medium text-white transition hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
                    >
                      <s.icon className="h-4 w-4" aria-hidden="true" />
                      {s.label}
                    </Link>
                  ))}
                </nav>
              </div>
            </div>

            <ul className="grid grid-cols-3 gap-2 sm:gap-3">
              {statTiles.map((tile) => (
                <li key={tile.key}>
                  <Link
                    to={tile.to}
                    className="group flex h-full flex-col items-center justify-center rounded-xl bg-white/10 px-2 py-4 text-center transition hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
                  >
                    <tile.icon className="h-5 w-5 text-secondary transition-transform group-hover:scale-110" aria-hidden="true" />
                    {!accountLoaded && tile.value === undefined ? (
                      <span className="mt-2 block h-7 w-10 animate-pulse rounded bg-white/20" aria-hidden="true" />
                    ) : (
                      <span className="mt-2 text-2xl font-bold tabular-nums sm:text-3xl">{tile.value ?? 0}</span>
                    )}
                    <span className="mt-1 text-xs leading-tight text-white/85 sm:text-sm">{tile.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Personalized Feed */}
        <div className="mt-6 grid gap-6 md:grid-cols-3">
          <FeedCard
            icon={CalendarDays}
            title={t('homeSections.myRegistrations', 'My registrations')}
            link={{ to: accountHref('registrations'), label: t('homeSections.viewAllRegistrations', 'All my events') }}
          >
            {!accountLoaded ? <FeedSkeleton /> : myRegistrations.length === 0 ? (
              <FeedEmpty>{t('homeSections.noRegistrations', 'No event registrations yet.')}</FeedEmpty>
            ) : (
              <ul className="divide-y divide-gray-100">
                {myRegistrations.map((r) => (
                  <li key={r.event_id}>
                    <FeedEventRow to={`/events/${r.event_id}`} title={r.title} dateTime={r.date_time} lang={lang} />
                  </li>
                ))}
              </ul>
            )}
          </FeedCard>

          <FeedCard
            icon={Sparkles}
            title={t('homeSections.forYou', 'Picked for you')}
            link={{ to: '/resources', label: t('homeSections.resourcesLink', 'Browse the library') }}
          >
            {!feedLoaded ? <FeedSkeleton /> : personalResources.length === 0 ? (
              <FeedEmpty>{t('homeSections.noPersonalResources', 'Add your sectors to your organization profile to get recommendations.')}</FeedEmpty>
            ) : (
              <ul className="divide-y divide-gray-100">
                {personalResources.slice(0, 4).map((r) => (
                  <li key={r.id}>
                    <Link to={`/resources/${r.id}`} className={cn('group flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-gray-50', focusRing)}>
                      <CoverImage
                        src={r.thumbnail_url}
                        alt=""
                        seed={r.id}
                        icon={BookOpen}
                        aspect="square"
                        className="w-12 shrink-0 rounded-lg"
                      />
                      <span className="min-w-0">
                        <span className="block text-xs text-gray-500">{t(`resources.types.${r.type}`, r.type)}</span>
                        <span className="block truncate text-sm font-medium text-gray-900 group-hover:text-primary">{r.title}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </FeedCard>

          <FeedCard
            icon={Clock}
            title={t('homeSections.eventsForYou', 'Events in your sectors')}
            link={{ to: '/events', label: t('homeSections.eventsLink', 'All events') }}
          >
            {!feedLoaded ? <FeedSkeleton /> : personalEvents.length === 0 ? (
              <FeedEmpty>{t('homeSections.noPersonalEvents', 'No upcoming events in your sectors.')}</FeedEmpty>
            ) : (
              <ul className="divide-y divide-gray-100">
                {personalEvents.map((e) => (
                  <li key={e.id}>
                    <FeedEventRow to={`/events/${e.id}`} title={e.title} dateTime={e.date_time} lang={lang} />
                  </li>
                ))}
              </ul>
            )}
          </FeedCard>
        </div>
      </div>
    </section>
  );
}

function FeedCard({
  icon: Icon, title, link, children,
}: {
  icon: LucideIcon;
  title: string;
  link: { to: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-gray-100">
      <header className="flex items-center gap-2 border-b border-gray-100 px-5 py-3.5">
        <Icon className="h-4 w-4 text-primary" aria-hidden="true" />
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      </header>
      <div className="flex-1 px-3 py-2">{children}</div>
      <footer className="border-t border-gray-100 px-5 py-1.5">
        <Link
          to={link.to}
          className={cn('inline-flex min-h-10 items-center gap-1 rounded-md text-sm font-medium text-primary underline-offset-4 hover:underline', focusRing)}
        >
          {link.label}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </footer>
    </section>
  );
}

function FeedEventRow({ to, title, dateTime, lang }: { to: string; title: string; dateTime: string; lang: string }) {
  const d = new Date(dateTime);
  return (
    <Link to={to} className={cn('group flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-gray-50', focusRing)}>
      <span className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-xl bg-primary/5 text-center">
        <span className="text-sm font-bold leading-none text-primary">{d.getDate()}</span>
        <span className="mt-0.5 text-[10px] font-medium uppercase text-gray-600">{d.toLocaleDateString(lang, { month: 'short' }).replace('.', '')}</span>
      </span>
      <span className="min-w-0 truncate text-sm font-medium text-gray-900 group-hover:text-primary">{title}</span>
    </Link>
  );
}

function FeedEmpty({ children }: { children: React.ReactNode }) {
  return <p className="px-2 py-6 text-center text-sm text-gray-600">{children}</p>;
}

function FeedSkeleton() {
  return (
    <div className="space-y-1 py-1" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-3 px-2 py-2.5">
          <div className="h-11 w-11 animate-pulse rounded-xl bg-gray-100" />
          <div className="h-3 flex-1 animate-pulse rounded bg-gray-100" />
        </div>
      ))}
    </div>
  );
}

/* ─── Everyone ───────────────────────────────────────────────────── */

function ResourcesSection({
  resources, themeCounts, loading, lang, className,
}: {
  resources: FeaturedResource[];
  themeCounts: Record<ThemeKey, number> | null;
  loading: boolean;
  lang: string;
  className?: string;
}) {
  const { t } = useTranslation();
  // A door that opens on an empty list is worse than no door.
  const themes = themeCounts ? THEMES.filter((th) => themeCounts[th.key] > 0) : THEMES;
  const [lead, ...rest] = resources;
  const formatDate = (iso: string) => new Date(iso).toLocaleDateString(lang, { day: 'numeric', month: 'short', year: 'numeric' });
  const themeLabel = (th: Theme) => t(th.labelKey, th.fallback);

  return (
    <section aria-labelledby="home-resources-heading" className={cn('py-16', className)}>
      <div className="container mx-auto px-4">
        <SectionHeader
          id="home-resources-heading"
          eyebrow={t('homeSections.resourcesEyebrow', 'Knowledge library')}
          title={t('homeSections.resourcesTitle', 'Featured resources')}
          link={{ to: '/resources', label: t('homeSections.resourcesLink', 'Browse the library') }}
        />

        {/* Theme doors into the library */}
        {!loading && themes.length > 1 && (
          <nav aria-label={t('resources.browseByTheme', 'Browse by theme')} className="mb-8">
            {/* py-2 keeps the focus ring (3 px + 2 px offset) from being clipped by the scroller. */}
            <ul className="no-scrollbar -mx-4 flex snap-x scroll-px-4 gap-3 overflow-x-auto px-4 py-2 lg:mx-0 lg:grid lg:grid-cols-6 lg:overflow-visible lg:px-0">
              {themes.map((th) => (
                <li key={th.key} className="w-44 shrink-0 snap-start lg:w-auto">
                  <Link
                    to={`/resources?theme=${th.key}`}
                    title={t(th.descKey, th.descFallback)}
                    className="group block overflow-hidden rounded-xl transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus-visible:ring-[3px] focus-visible:ring-secondary-dark focus-visible:ring-offset-2"
                  >
                    <CoverImage
                      src={th.image}
                      focusY={th.imageFocusY}
                      alt=""
                      seed={`theme-${th.key}`}
                      icon={th.icon}
                      aspect="wide"
                      tone="sea"
                      imageClassName="group-hover:scale-105"
                    >
                      <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-[#0b2653]/95 via-[#0b2653]/45 to-[#0b2653]/5" />
                      <div className="absolute inset-x-0 bottom-0 p-3 text-white">
                        <span className="block text-sm font-semibold leading-tight drop-shadow-sm">{themeLabel(th)}</span>
                        {themeCounts && (
                          <span className="mt-0.5 block text-xs text-white/85">
                            {t('resources.results', { count: themeCounts[th.key], defaultValue: '{{count}} resources' })}
                          </span>
                        )}
                      </div>
                    </CoverImage>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}

        {loading ? (
          <div className="grid gap-6 lg:grid-cols-5" aria-hidden="true">
            <div className="aspect-video animate-pulse rounded-2xl bg-gray-200 lg:col-span-3" />
            <div className="space-y-4 lg:col-span-2">
              {[0, 1, 2].map((i) => <div key={i} className="h-28 animate-pulse rounded-2xl bg-gray-200" />)}
            </div>
          </div>
        ) : !lead ? (
          <div className="rounded-2xl bg-white p-10 text-center shadow-sm ring-1 ring-gray-100">
            <FileText className="mx-auto mb-3 h-10 w-10 text-gray-300" aria-hidden="true" />
            <p className="text-gray-600">{t('homeSections.resourcesEmpty', 'The first articles are on their way.')}</p>
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-5">
            {/* The newest, large */}
            <Link
              to={`/resources/${lead.id}`}
              className={cn('group flex flex-col overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-gray-100 transition hover:shadow-lg lg:col-span-3', focusRing)}
            >
              <CoverImage
                src={lead.thumbnail_url}
                alt=""
                seed={lead.id}
                icon={getTheme(lead.themes[0])?.icon ?? BookOpen}
                aspect="video"
                tone="sea"
                // A little flatter on desktop, so it lines up with the three beside it.
                className="lg:aspect-[2/1]"
                imageClassName="group-hover:scale-105"
              >
                <span className="absolute left-4 top-4 rounded-full bg-secondary px-3 py-1 text-xs font-bold uppercase tracking-wide text-primary">
                  {t('resources.latest', 'Latest')}
                </span>
                <AccessChip level={lead.access_level} className="right-4 top-4" />
              </CoverImage>
              <div className="flex flex-1 flex-col p-5 sm:p-6">
                {lead.themes.length > 0 && (
                  <p className="text-xs font-semibold uppercase tracking-wider text-primary/80">
                    {lead.themes.map((k) => themeLabel(getTheme(k)!)).join(' · ')}
                  </p>
                )}
                <h3 className="mt-2 text-xl font-bold leading-snug text-gray-900 transition-colors group-hover:text-primary sm:text-2xl">
                  {lead.title}
                </h3>
                {lead.summary && <p className="mt-2 line-clamp-3 leading-relaxed text-gray-600">{lead.summary}</p>}
                <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-4 text-sm">
                  <span className="flex items-center gap-1 text-gray-500">
                    <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
                    {formatDate(lead.published_at || lead.created_at)}
                  </span>
                  <span className="inline-flex items-center gap-1 font-semibold text-primary transition-all group-hover:gap-2">
                    {t('resources.readMore', 'Read more')} <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </span>
                </div>
              </div>
            </Link>

            {/* The next three, compact */}
            {rest.length > 0 && (
              <ul className="flex flex-col gap-4 lg:col-span-2">
                {rest.map((r) => {
                  const th = getTheme(r.themes[0]);
                  return (
                    <li key={r.id} className="flex-1">
                      <Link
                        to={`/resources/${r.id}`}
                        className={cn('group flex h-full items-center gap-4 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-gray-100 transition hover:shadow-md', focusRing)}
                      >
                        <CoverImage
                          src={r.thumbnail_url}
                          alt=""
                          seed={r.id}
                          icon={th?.icon ?? BookOpen}
                          aspect="square"
                          className="w-24 shrink-0 rounded-xl sm:w-28"
                          imageClassName="group-hover:scale-105"
                        >
                          <AccessChip level={r.access_level} compact className="left-1.5 top-1.5" />
                        </CoverImage>
                        <div className="min-w-0 py-1">
                          {th && (
                            <p className="flex items-center gap-1 text-xs font-medium text-primary/80">
                              <th.icon className="h-3 w-3 shrink-0" aria-hidden="true" />
                              <span className="truncate">{themeLabel(th)}</span>
                            </p>
                          )}
                          <h3 className="mt-1 line-clamp-2 font-semibold leading-snug text-gray-900 transition-colors group-hover:text-primary">
                            {r.title}
                          </h3>
                          <p className="mt-1 text-xs text-gray-500">{formatDate(r.published_at || r.created_at)}</p>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

/** Shown only when a resource is not public: who it is for. */
function AccessChip({ level, compact = false, className }: { level: string; compact?: boolean; className?: string }) {
  const { t } = useTranslation();
  if (level === 'public' || !level) return null;
  const label = t(`resources.accessLevels.${level}`, level);
  return (
    <span
      className={cn('absolute inline-flex items-center gap-1 rounded-full bg-white/95 px-2 py-0.5 text-[11px] font-medium text-gray-800 shadow-sm', className)}
      title={label}
    >
      <Lock className="h-3 w-3" aria-hidden="true" />
      {compact ? <span className="sr-only">{label}</span> : label}
    </span>
  );
}

function EventsSection({
  upcoming, past, loading, registeredIds, lang, className,
}: {
  upcoming: HomeEvent[];
  past: HomeEvent[];
  loading: boolean;
  registeredIds: Set<string>;
  lang: string;
  className?: string;
}) {
  const { t } = useTranslation();
  // Nothing announced yet: show what just happened (replays) rather than an empty box.
  const showingPast = upcoming.length === 0 && past.length > 0;
  const list = showingPast ? past : upcoming;

  return (
    <section aria-labelledby="home-events-heading" className={cn('py-16', className)}>
      <div className="container mx-auto px-4">
        <SectionHeader
          id="home-events-heading"
          eyebrow={t('homeSections.eventsEyebrow', 'Events & webinars')}
          title={showingPast ? t('homeSections.eventsRecentTitle', 'Recent events') : t('homeSections.eventsTitle', 'Upcoming events')}
          subtitle={showingPast ? t('homeSections.eventsNoneUpcoming', 'No upcoming event announced yet — catch up on the latest ones.') : undefined}
          link={{ to: '/events', label: t('homeSections.eventsLink', 'All events') }}
        />
        {loading ? (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
            {[0, 1, 2].map((i) => <div key={i} className="h-72 animate-pulse rounded-2xl bg-gray-200" />)}
          </div>
        ) : list.length === 0 ? (
          <div className="flex flex-col items-center rounded-2xl bg-white p-10 text-center shadow-sm ring-1 ring-gray-100">
            <CalendarDays className="mb-3 h-10 w-10 text-gray-300" aria-hidden="true" />
            <p className="text-gray-600">{t('homeSections.eventsEmpty', 'No event announced yet. New dates are published here first.')}</p>
          </div>
        ) : (
          <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((e) => (
              <li key={e.id}>
                <EventCard event={e} past={showingPast} registered={registeredIds.has(e.id)} lang={lang} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function EventCard({ event, past, registered, lang }: { event: HomeEvent; past: boolean; registered: boolean; lang: string }) {
  const { t } = useTranslation();
  const isWebinar = event.event_type === 'webinar';
  const chip = dateChip(event, lang);
  const where = isWebinar ? t('homeSections.online', 'Online') : (event.location || t('homeSections.onSite', 'On site'));

  return (
    <Link
      to={`/events/${event.id}`}
      className={cn('group flex h-full flex-col overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-gray-100 transition hover:-translate-y-0.5 hover:shadow-md', focusRing)}
    >
      <CoverImage
        src={null}
        alt=""
        seed={event.id}
        icon={isWebinar ? Video : CalendarDays}
        aspect="banner"
        tone="sea"
      >
        <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-white/95 px-2.5 py-1 text-xs font-medium text-gray-800 shadow-sm">
          {isWebinar ? <Video className="h-3 w-3" aria-hidden="true" /> : <MapPin className="h-3 w-3" aria-hidden="true" />}
          {isWebinar ? t('homeSections.webinar', 'Webinar') : t('homeSections.onSite', 'On site')}
        </span>
        <span className="absolute right-3 top-3 flex flex-col items-end gap-1">
          {registered && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-700 px-2.5 py-1 text-xs font-medium text-white">
              <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> {t('homeSections.registered', 'Registered')}
            </span>
          )}
          {event.invitation_only && !past && (
            <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold text-primary">
              <Mail className="h-3 w-3" aria-hidden="true" /> {t('homeSections.invitationOnly', 'By invitation')}
            </span>
          )}
          {past && (
            <span className="inline-flex items-center gap-1 rounded-full bg-white/95 px-2.5 py-1 text-xs font-medium text-gray-800">
              {event.replay_url
                ? <><PlayCircle className="h-3 w-3" aria-hidden="true" /> {t('homeSections.replay', 'Replay available')}</>
                : t('homeSections.past', 'Past event')}
            </span>
          )}
        </span>
      </CoverImage>

      <div className="flex flex-1 flex-col px-4 pb-4">
        {/* Overlaps the cover, like the logo on a directory card. */}
        <div className="relative -mt-7 mb-3 flex w-fit min-w-[3.5rem] flex-col items-center rounded-xl bg-white px-3 py-1.5 text-center shadow-md ring-1 ring-gray-100">
          <span className="text-lg font-bold leading-none tabular-nums text-primary">{chip.day}</span>
          <span className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-gray-600">{chip.month}</span>
        </div>
        <h3 className="line-clamp-2 font-semibold leading-snug text-gray-900 transition-colors group-hover:text-primary">{event.title}</h3>
        <p className="mt-2 flex items-start gap-1.5 text-sm text-gray-600">
          <CalendarDays className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{dateLine(event, lang)}</span>
        </p>
        <p className="mt-1 flex items-start gap-1.5 text-sm text-gray-600">
          {isWebinar ? <Video className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
          <span className="line-clamp-1">{where}</span>
        </p>
        <span className="mt-auto inline-flex items-center gap-1 pt-4 text-sm font-semibold text-primary transition-all group-hover:gap-2">
          {t('homeSections.viewEvent', 'View event')} <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </span>
      </div>
    </Link>
  );
}

function PartnersWall({
  featured, orgCount, loading, className,
}: {
  featured: OrgLogo[];
  orgCount: number | null;
  loading: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const directoryLabel = orgCount
    ? t('homeSections.directoryCta', { count: orgCount, defaultValue: 'Explore the directory ({{count}} organizations)' })
    : t('home.exploreDirectory', 'Explore the directory');

  return (
    <section aria-labelledby="home-partners-heading" className={cn('py-16', className)}>
      <div className="container mx-auto px-4">
        <SectionHeader
          id="home-partners-heading"
          eyebrow={t('homeSections.partnersEyebrow', 'Partners & sponsors')}
          title={t('homeSections.featuredPartners', 'Our partners')}
          link={{ to: '/partners', label: t('homeSections.partnersLink', 'All partners') }}
        />

        {/* Curated by an admin (featured_partner) — never an automatic pick of
            free members: every other organization is in the directory below. */}
        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
            {[0, 1, 2].map((i) => <div key={i} className="h-24 animate-pulse rounded-2xl bg-gray-200" />)}
          </div>
        ) : featured.length === 0 ? (
          <p className="rounded-2xl bg-white p-8 text-center text-gray-600 shadow-sm ring-1 ring-gray-100">
            {t('homeSections.partnersEmpty', 'Partner profiles are coming soon.')}
          </p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {featured.map((o) => (
              <li key={o.id}>
                <Link
                  to={`/organizations/${o.slug}`}
                  className={cn('group flex h-full items-center gap-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-secondary/50 transition hover:-translate-y-0.5 hover:shadow-md', focusRing)}
                >
                  <LogoBadge src={o.logo_url} name={o.name} size="lg" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-gray-900 group-hover:text-primary">{o.name}</span>
                    <span className="mt-1 block"><SponsorBadge tier={o.tier} size="sm" /></span>
                  </span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-gray-400 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <Button asChild variant="outline" className="h-auto min-h-11 whitespace-normal rounded-full border-primary/30 px-5 text-primary hover:bg-primary/5 hover:text-primary">
            <Link to="/directory">
              <Users className="mr-2 h-4 w-4 shrink-0" aria-hidden="true" />
              {directoryLabel}
            </Link>
          </Button>
          <Button asChild variant="ghost" className="h-auto min-h-11 whitespace-normal rounded-full px-5 text-primary hover:bg-primary/5 hover:text-primary">
            <Link to="/tiers">
              <HeartHandshake className="mr-2 h-4 w-4 shrink-0" aria-hidden="true" />
              {t('homeSections.becomePartner', 'Become a partner')}
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
