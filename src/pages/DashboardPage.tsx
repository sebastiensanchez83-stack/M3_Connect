import { useEffect, useRef, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Helmet } from 'react-helmet-async';
import type { LucideIcon } from 'lucide-react';
import {
  Inbox, UserPlus, ImageIcon, ImagePlus, PenLine, UserCircle, ChevronRight,
  CheckCircle2, Clock, AlertCircle, CalendarDays, Video, MapPin, Ship,
  MessageSquare, Wrench, BookOpen, ArrowRight, TrendingUp, ShieldCheck,
  CircleDashed, Tags, Users, GalleryHorizontal, LayoutGrid, ExternalLink, Eye,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useEntitlements } from '@/hooks/useEntitlements';
import { supabase } from '@/lib/supabase';
import { CoverImage, LogoBadge } from '@/components/ui/CoverImage';
import { SITE_IMAGES, eventCover } from '@/lib/siteMedia';
import { Button } from '@/components/ui/button';
import { AddToCalendarButtons } from '@/components/events/AddToCalendarButtons';
import { CREATE_ACTIONS, DEAL_FLOW_ITEM, MEMBER_NAV, canCreate } from '@/lib/nav';
import { ACCOUNT_GROUPS, ACCOUNT_SECTIONS, accountHref, type AccountTab } from '@/lib/accountNav';
import { cn, type CalendarEventInput } from '@/lib/utils';

/**
 * The page a signed-in member lands on.
 *
 * It replaces the old "Dashboard" tab of /account, which showed three counters
 * (usually zero), a "recommended resources" box that stayed empty forever for
 * any organization without sectors, and "upcoming events" that were never
 * filtered by date. This page answers, in order: is anything blocking me, what
 * is waiting for me, and what is new for someone like me — and, at the
 * bottom, everything else this member can do, grouped like the account menu.
 *
 * Every block degrades to something useful rather than to an empty box: no
 * sector match falls back to the newest items, no registration falls back to
 * the next public events.
 */

/* ------------------------------------------------------------------ types */

interface Todo {
  key: string;
  title: string;
  hint: string;
  href: string;
  icon: LucideIcon;
  /** Someone is waiting on an answer, as opposed to a nudge to fill a field. */
  urgent: boolean;
}

interface Opportunity {
  id: string;
  kind: 'rfp' | 'consultation';
  title: string;
  deadline: string | null;
  created_at: string;
  matches: boolean;
}

interface MyRequest {
  id: string;
  kind: 'rfp' | 'consultation' | 'project';
  title: string;
  status: string;
  created_at: string;
}

interface DashEvent {
  id: string;
  title: string;
  description: string | null;
  date_time: string;
  end_date_time: string | null;
  location: string | null;
  event_type: string | null;
  is_full_day: boolean;
  registered: boolean;
  /** Only ever filled for an event I am registered for — the event page's rule. */
  meeting_url: string | null;
  /** Uploaded cover; null falls back to the built-in photo or a gradient (eventCover). */
  image_url: string | null;
}

interface DashResource {
  id: string;
  title: string;
  summary: string | null;
  type: string;
  thumbnail_url: string | null;
  matches: boolean;
}

type EventRow = {
  id: string; title: string; date_time: string | null; end_date_time: string | null;
  location: string | null; event_type: string | null; published: boolean | null; is_full_day: boolean | null;
  description?: string | null; meeting_url?: string | null; image_url?: string | null;
};

/** The organization's branding as stored now — the auth context's copy goes stale after an upload. */
interface OrgBrand {
  id: string;
  logo_url: string | null;
  banner_url: string | null;
  description: string | null;
  gallery: unknown;
}

/** Counts behind the profile meter, tagged with the organization they belong to. */
interface OrgCounts {
  orgId: string;
  members: number;
  sectors: number;
}

/** Account sections whose visibility needs a query (same three as the account page). */
interface SectionAccess {
  sm26: boolean;
  media: boolean;
  sponsor: boolean;
}

type MeterKey = 'logo' | 'banner' | 'description' | 'sectors' | 'team' | 'gallery';

interface MeterItem {
  key: MeterKey;
  done: boolean;
  icon: LucideIcon;
  href: string;
  /** A missing one is already a nudge in "Needs your attention" — link it once, there. */
  inTodo: boolean;
}

type QuickTone = 'navy' | 'gold' | 'soft';

interface QuickItem {
  key: string;
  href: string;
  label: string;
  desc: string;
  icon: LucideIcon;
  badge?: number;
}

interface QuickGroup {
  key: string;
  label: string;
  tone: QuickTone;
  items: QuickItem[];
}

/* ------------------------------------------------------------------ helpers */

const DEMAND_PERSONAS = ['marina', 'developer'];
const SUPPLY_PERSONAS = ['partner', 'media_partner'];

/** Same default as the event page when an event has no end time. */
const DEFAULT_DURATION_MS = 60 * 60 * 1000;

/** Row links inside a card: the card clips, so the focus ring sits inside. */
const ROW_FOCUS = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary';
const FOCUS = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2';

/** The organization tab, opened on one of its sections (AccountPage honours ?section=). */
function orgSectionHref(section: 'branding' | 'gallery' | 'details' | 'team'): string {
  return `${accountHref('organization')}&section=${section}`;
}

/** Which side of the market a persona's sectors describe. */
function sectorTableFor(persona: string | undefined): string | null {
  if (persona === 'marina' || persona === 'developer' || persona === 'investor') return 'organization_interest_sectors';
  if (persona === 'partner' || persona === 'media_partner') return 'organization_service_sectors';
  return null;
}

/**
 * Still upcoming = it has not finished yet, so a two-day conference stays on
 * day two. Without an end time it runs DEFAULT_DURATION_MS — the event page's
 * rule — so a webinar's join link is still here once it has started.
 */
function isUpcoming(e: { date_time: string | null; end_date_time: string | null }, now: number): boolean {
  if (!e.date_time) return false;
  const end = e.end_date_time
    ? new Date(e.end_date_time).getTime()
    : new Date(e.date_time).getTime() + DEFAULT_DURATION_MS;
  return end >= now;
}

const RESOURCE_ICON: Record<string, LucideIcon> = {
  replay: Video,
  article: BookOpen,
  guide: BookOpen,
  whitepaper: BookOpen,
  case_study: BookOpen,
};

const METER_ICON: Record<MeterKey, LucideIcon> = {
  logo: ImagePlus,
  banner: ImageIcon,
  description: PenLine,
  sectors: Tags,
  team: Users,
  gallery: GalleryHorizontal,
};

const METER_LABEL: Record<MeterKey, string> = {
  logo: 'Logo',
  banner: 'Cover photo',
  description: 'Description',
  sectors: 'Sectors',
  team: 'A second team member',
  gallery: 'Product images',
};

const METER_HINT: Partial<Record<MeterKey, string>> = {
  sectors: 'Pick your sectors so the right members find you',
  team: 'Invite a colleague to share the work',
  gallery: 'Show your products, sites or berths in pictures',
};

/* ------------------------------------------------------------------ page */

export function DashboardPage() {
  const { t, i18n } = useTranslation();
  const { user, profile, organization, orgRole, isVerified } = useAuth();
  const { isFeatureEnabled } = useEntitlements();

  const [loading, setLoading] = useState(true);
  const [pendingConnections, setPendingConnections] = useState(0);
  const [joinRequests, setJoinRequests] = useState(0);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [myRequests, setMyRequests] = useState<MyRequest[]>([]);
  const [events, setEvents] = useState<DashEvent[]>([]);
  const [resources, setResources] = useState<DashResource[]>([]);
  const [freshOrg, setFreshOrg] = useState<OrgBrand | null>(null);
  const [orgCounts, setOrgCounts] = useState<OrgCounts | null>(null);
  const [access, setAccess] = useState<SectionAccess | null>(null);
  const firstLoad = useRef(true);
  const everythingRef = useRef<HTMLElement>(null);
  const everythingTitleRef = useRef<HTMLHeadingElement>(null);

  const uid = user?.id;
  const userEmail = user?.email ?? null;
  const orgId = organization?.id;
  const orgType = organization?.organization_type ?? null;
  const persona = profile?.persona as string | undefined;
  const orgVerified = organization?.access_status === 'verified';
  const isOwner = orgRole === 'owner';
  const isDemand = DEMAND_PERSONAS.includes(persona ?? '');
  const isSupply = SUPPLY_PERSONAS.includes(persona ?? '');
  const canSeeOpportunities = isVerified && orgVerified;

  // Keyed on ids and flags, never on the `user` object: auth-js hands us a new
  // user object on every tab refocus, and re-running this on each one would
  // blank the page (see the refocus-reload trap).
  useEffect(() => {
    if (!uid) return;
    let alive = true;

    const load = async () => {
      if (firstLoad.current) setLoading(true);
      const now = Date.now();
      // A day of slack so an event that started this morning still comes back.
      const since = new Date(now - 24 * 3600 * 1000).toISOString();

      const sectorTable = sectorTableFor(persona);
      // The profile meter is the owner's; its sectors are the ones the
      // organization tab edits — interests for a marina, services otherwise.
      const meterOn = isOwner && !!orgId;
      const orgSectorTable = orgType === 'marina' ? 'organization_interest_sectors' : 'organization_service_sectors';
      // Same rule as the event page: my own registrations, plus any made as a
      // guest with my (confirmed) email before I had an account. The server
      // answers with the event ids and, for webinars, the join link — which is
      // never read from the events table (registrants and staff only).

      const [
        connRes, joinRes, sectorRes, rfpRes, consultRes,
        myRfpRes, myConsultRes, myProjRes, myRegsRes, upcomingRes, resRes,
        orgRes, memberCountRes, orgSectorCountRes,
      ] = await Promise.all([
        // Same rule as the inbox: received (not sent by me) and still pending.
        supabase.from('partner_requests').select('id', { count: 'exact', head: true })
          .eq('marina_user_id', uid).neq('partner_user_id', uid).eq('status', 'pending'),
        isOwner && orgId
          ? supabase.from('organization_invitations').select('id', { count: 'exact', head: true })
            .eq('organization_id', orgId).eq('status', 'join_requested')
          : Promise.resolve({ count: 0 }),
        sectorTable && orgId
          ? supabase.from(sectorTable).select('sector_id').eq('organization_id', orgId)
          : Promise.resolve({ data: [] as { sector_id: string }[] }),
        !isDemand && canSeeOpportunities
          ? supabase.from('rfps').select('id, title, deadline_date, created_at, sector_id')
            .eq('status', 'approved').eq('is_open', true).order('created_at', { ascending: false }).limit(8)
          : Promise.resolve({ data: [] }),
        !isDemand && canSeeOpportunities
          ? supabase.from('consultations').select('id, title, created_at, sector_id')
            .eq('status', 'approved').eq('is_open', true).order('created_at', { ascending: false }).limit(8)
          : Promise.resolve({ data: [] }),
        isDemand
          ? supabase.from('rfps').select('id, title, status, created_at')
            .eq('marina_user_id', uid).order('created_at', { ascending: false }).limit(5)
          : Promise.resolve({ data: [] }),
        isDemand
          ? supabase.from('consultations').select('id, title, status, created_at')
            .eq('marina_user_id', uid).order('created_at', { ascending: false }).limit(5)
          : Promise.resolve({ data: [] }),
        isDemand
          ? supabase.from('marina_projects').select('id, project_type, status, created_at')
            .eq('user_id', uid).order('created_at', { ascending: false }).limit(5)
          : Promise.resolve({ data: [] }),
        supabase.rpc('get_my_event_access', { p_event_ids: null }),
        supabase.from('events')
          .select('id, title, date_time, end_date_time, location, event_type, published, is_full_day, image_url')
          .gte('date_time', since).order('date_time', { ascending: true }).limit(6),
        supabase.from('resources')
          .select('id, title, summary, type, thumbnail_url, published_at, resource_sectors(sector_id)')
          .eq('published', true).order('published_at', { ascending: false, nullsFirst: false })
          .order('created_at', { ascending: false }).limit(12),
        meterOn
          ? supabase.from('organizations').select('id, logo_url, banner_url, description, gallery').eq('id', orgId).maybeSingle()
          : Promise.resolve({ data: null }),
        meterOn
          ? supabase.from('organization_members').select('id', { count: 'exact', head: true }).eq('organization_id', orgId)
          : Promise.resolve({ count: 0 }),
        meterOn
          ? supabase.from(orgSectorTable).select('sector_id', { count: 'exact', head: true }).eq('organization_id', orgId)
          : Promise.resolve({ count: 0 }),
      ]);
      if (!alive) return;

      setPendingConnections(connRes.count ?? 0);
      setJoinRequests(joinRes.count ?? 0);

      const mySectors = new Set(
        ((sectorRes.data ?? []) as { sector_id: string }[]).map((s) => s.sector_id),
      );

      // Opportunities — sector matches first, then newest.
      type OppRow = { id: string; title: string; deadline_date?: string | null; created_at: string; sector_id: string | null };
      const opps: Opportunity[] = [
        ...((rfpRes.data ?? []) as OppRow[]).map((r) => ({
          id: r.id, kind: 'rfp' as const, title: r.title, deadline: r.deadline_date ?? null,
          created_at: r.created_at, matches: !!r.sector_id && mySectors.has(r.sector_id),
        })),
        ...((consultRes.data ?? []) as OppRow[]).map((c) => ({
          id: c.id, kind: 'consultation' as const, title: c.title, deadline: null,
          created_at: c.created_at, matches: !!c.sector_id && mySectors.has(c.sector_id),
        })),
      ].sort((a, b) => Number(b.matches) - Number(a.matches) || b.created_at.localeCompare(a.created_at));
      setOpportunities(opps.slice(0, 4));

      // My own requests, newest first across the three kinds.
      type ReqRow = { id: string; title?: string; project_type?: string; status: string; created_at: string };
      const reqs: MyRequest[] = [
        ...((myRfpRes.data ?? []) as ReqRow[]).map((r) => ({ id: r.id, kind: 'rfp' as const, title: r.title ?? '', status: r.status, created_at: r.created_at })),
        ...((myConsultRes.data ?? []) as ReqRow[]).map((r) => ({ id: r.id, kind: 'consultation' as const, title: r.title ?? '', status: r.status, created_at: r.created_at })),
        ...((myProjRes.data ?? []) as ReqRow[]).map((r) => ({
          id: r.id, kind: 'project' as const,
          title: (r.project_type ?? '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()),
          status: r.status, created_at: r.created_at,
        })),
      ].sort((a, b) => b.created_at.localeCompare(a.created_at));
      setMyRequests(reqs.slice(0, 4));

      // Events — my own upcoming registrations first, then what's next publicly.
      const myAccess = ((myRegsRes.data ?? []) as { event_id: string; is_registered: boolean; meeting_url: string | null }[])
        .filter((a) => a.is_registered);
      const joinLinks = new Map(myAccess.map((a) => [a.event_id, a.meeting_url] as const));
      const myEventRows = joinLinks.size > 0
        ? ((await supabase.from('events')
          .select('id, title, description, date_time, end_date_time, location, event_type, published, is_full_day, image_url')
          .in('id', [...joinLinks.keys()])).data ?? []) as EventRow[]
        : [];
      if (!alive) return;
      const registered = new Map<string, EventRow>();
      for (const e of myEventRows) {
        if (isUpcoming(e, now)) registered.set(e.id, { ...e, meeting_url: joinLinks.get(e.id) ?? null });
      }
      const merged: DashEvent[] = [];
      const push = (e: EventRow, isRegistered: boolean) => {
        if (!e.date_time || merged.some((m) => m.id === e.id)) return;
        merged.push({
          id: e.id, title: e.title, description: e.description ?? null,
          date_time: e.date_time, end_date_time: e.end_date_time,
          location: e.location, event_type: e.event_type, is_full_day: !!e.is_full_day,
          registered: isRegistered,
          meeting_url: isRegistered ? (e.meeting_url ?? null) : null,
          image_url: e.image_url ?? null,
        });
      };
      [...registered.values()]
        .sort((a, b) => (a.date_time ?? '').localeCompare(b.date_time ?? ''))
        .forEach((e) => push(e, true));
      ((upcomingRes.data ?? []) as EventRow[])
        .filter((e) => e.published !== false && isUpcoming(e, now))
        .sort((a, b) => (a.date_time ?? '').localeCompare(b.date_time ?? ''))
        .forEach((e) => push(e, registered.has(e.id)));
      setEvents(merged.slice(0, 3));

      // Resources — sector matches first; without sectors, simply the newest.
      type ResRow = Omit<DashResource, 'matches'> & { resource_sectors?: { sector_id: string }[] };
      const res = ((resRes.data ?? []) as ResRow[]).map((r) => ({
        id: r.id, title: r.title, summary: r.summary, type: r.type, thumbnail_url: r.thumbnail_url,
        matches: (r.resource_sectors ?? []).some((s) => mySectors.has(s.sector_id)),
      }));
      // Stable sort keeps the newest-first order inside each group.
      res.sort((a, b) => Number(b.matches) - Number(a.matches));
      setResources(res.slice(0, 4));

      // Profile meter — the organization as stored now, and its two counts.
      setFreshOrg(meterOn ? ((orgRes.data ?? null) as OrgBrand | null) : null);
      setOrgCounts(meterOn && orgId
        ? { orgId, members: memberCountRes.count ?? 0, sectors: orgSectorCountRes.count ?? 0 }
        : null);

      firstLoad.current = false;
      setLoading(false);
    };

    load().catch((err) => {
      if (import.meta.env.DEV) console.error('Dashboard load failed:', err);
      if (alive) setLoading(false);
    });
    return () => { alive = false; };
  }, [uid, userEmail, orgId, orgType, persona, isOwner, isDemand, canSeeOpportunities]);

  // The three account sections whose visibility is decided by a query — the
  // same queries as the account page, so the shortcuts below never offer a
  // section that the account menu would hide.
  useEffect(() => {
    if (!uid) return;
    let alive = true;

    const sm26 = (async () => {
      try {
        const { data: ev } = await supabase.from('sm_event').select('id').eq('slug', 'sm26').maybeSingle();
        if (!ev) return false;
        const { data } = await supabase.from('sm_registration').select('id')
          .eq('event_id', (ev as { id: string }).id).limit(1);
        return !!(data && data.length);
      } catch {
        return false;
      }
    })();
    const media = (async () => {
      try {
        const { data } = await supabase.rpc('is_media_user');
        return data === true;
      } catch {
        return false;
      }
    })();
    const sponsor = (async () => {
      try {
        const { data } = await supabase.from('sp_sponsor_user').select('sponsor_id').eq('user_id', uid);
        return ((data ?? []) as unknown[]).length > 0;
      } catch {
        return false;
      }
    })();

    Promise.all([sm26, media, sponsor]).then(([a, b, c]) => {
      if (alive) setAccess({ sm26: a, media: b, sponsor: c });
    });
    return () => { alive = false; };
  }, [uid]);

  // Still in the signup wizard: finishing it is the only thing that matters.
  if (profile?.onboarding_status === 'draft') {
    return <Navigate to="/account?tab=complete-registration" replace />;
  }

  /* -------------------------------------------------------------- derived */

  const lang = i18n.language === 'fr' ? 'fr-FR' : 'en-GB';
  const firstName = profile?.first_name || user?.email?.split('@')[0] || '';
  const orgName = organization?.name ?? '';

  // Branding as stored now when we have it for this organization, else the
  // auth context's copy (which an upload in the account page doesn't refresh).
  const brandSrc = freshOrg && freshOrg.id === orgId ? freshOrg : organization;
  const brand = {
    logo: !!brandSrc?.logo_url,
    banner: !!brandSrc?.banner_url,
    description: !!brandSrc?.description?.trim(),
    gallery: Array.isArray(brandSrc?.gallery) && (brandSrc?.gallery as unknown[]).length > 0,
  };

  const todos: Todo[] = [];
  if (pendingConnections > 0) {
    todos.push({
      key: 'connections', urgent: true, icon: Inbox, href: '/inbox',
      title: t('dashboard.todoConnections', { count: pendingConnections }),
      hint: t('dashboard.todoConnectionsHint'),
    });
  }
  if (joinRequests > 0) {
    todos.push({
      key: 'join', urgent: true, icon: UserPlus, href: '/inbox',
      title: t('dashboard.todoJoin', { count: joinRequests, org: orgName }),
      hint: t('dashboard.todoJoinHint'),
    });
  }
  // Nudges toward a livelier directory — only the owner can act on them. Each
  // opens the organization tab on the right section.
  if (organization && isOwner) {
    if (!brand.logo) {
      todos.push({
        key: 'logo', urgent: false, icon: ImagePlus, href: orgSectionHref('branding'),
        title: t('dashboard.todoLogo', { org: orgName }), hint: t('dashboard.todoLogoHint'),
      });
    }
    if (!brand.banner) {
      todos.push({
        key: 'banner', urgent: false, icon: ImageIcon, href: orgSectionHref('branding'),
        title: t('dashboard.todoBanner', { org: orgName }), hint: t('dashboard.todoBannerHint'),
      });
    }
    if (!brand.description) {
      todos.push({
        key: 'description', urgent: false, icon: PenLine, href: orgSectionHref('details'),
        title: t('dashboard.todoDescription', { org: orgName }), hint: t('dashboard.todoDescriptionHint'),
      });
    }
  }
  if (profile && (!profile.avatar_url || !profile.job_title)) {
    todos.push({
      key: 'profile', urgent: false, icon: UserCircle, href: '/account?tab=profile',
      title: t('dashboard.todoProfile'), hint: t('dashboard.todoProfileHint'),
    });
  }

  const createCtx = { isVerified, orgVerified, persona, isFeatureEnabled };
  const allCreateActions = CREATE_ACTIONS.filter((a) => canCreate(a.capability, createCtx));
  // The "your requests" empty state offers the three marina submissions only.
  const createActions = allCreateActions.filter((a) => a.capability !== 'request_webinar');

  const nextRegistered = events.find((e) => e.registered) ?? null;
  const otherEvents = events.filter((e) => e !== nextRegistered);
  const resourcesMatched = resources.some((r) => r.matches);

  /* ---------------------------------------------------- profile meter */

  const counts = orgCounts && orgCounts.orgId === orgId ? orgCounts : null;
  const memberCount = counts?.members ?? 0;
  // Inviting is blocked when a non-marina organization has used its seats
  // (OrganizationTab's capacity check), so a one-seat plan isn't asked for a
  // colleague it cannot add.
  const isMarinaOrgType = orgType === 'marina' || orgType === 'developer';
  const maxSeats = organization?.max_seats ?? 0;
  const teamPossible = memberCount >= 2 || isMarinaOrgType || !maxSeats || maxSeats > 1;

  const meterItems: MeterItem[] = ([
    { key: 'logo', done: brand.logo, href: orgSectionHref('branding'), inTodo: true },
    { key: 'banner', done: brand.banner, href: orgSectionHref('branding'), inTodo: true },
    { key: 'description', done: brand.description, href: orgSectionHref('details'), inTodo: true },
    { key: 'sectors', done: (counts?.sectors ?? 0) > 0, href: orgSectionHref('details'), inTodo: false },
    ...(teamPossible ? [{ key: 'team' as const, done: memberCount >= 2, href: orgSectionHref('team'), inTodo: false }] : []),
    { key: 'gallery', done: brand.gallery, href: orgSectionHref('gallery'), inTodo: false },
  ] as Omit<MeterItem, 'icon'>[]).map((m) => ({ ...m, icon: METER_ICON[m.key] }));
  const showMeter = !!organization && isOwner;

  /* ---------------------------------------------------- everything grid */

  // Who sees which account section — the account page's own rules.
  const isInvestor = persona === 'investor';
  const isPartnerPersona = persona === 'partner' || persona === 'media_partner';
  const canProjects = isDemand || isFeatureEnabled('submit_project');
  const canRFPs = isDemand || isFeatureEnabled('submit_rfp');
  const canConsultations = isDemand || isFeatureEnabled('submit_consultation');
  const sectionVisible: Record<AccountTab, boolean> = {
    registrations: true,
    event: access?.sm26 === true,
    inbox: true,
    shortlist: isDemand || isInvestor,
    projects: canProjects,
    rfps: canRFPs,
    consultations: canConsultations,
    webinars: true,
    submissions: canProjects || canRFPs || canConsultations || isPartnerPersona,
    organization: true,
    references: organization?.organization_type === 'partner',
    sponsorship: access?.sponsor === true,
    press: access?.media === true,
    pricing: true,
    profile: true,
    notifications: true,
  };
  const inboxWaiting = pendingConnections + joinRequests;

  const quickGroups: QuickGroup[] = [
    {
      key: 'explore',
      label: t('dashboard.everything.explore', 'Explore the platform'),
      tone: 'navy' as const,
      items: [...MEMBER_NAV.filter((n) => n.href !== '/dashboard'), ...(isInvestor ? [DEAL_FLOW_ITEM] : [])]
        .map((n) => ({ key: n.href, href: n.href, label: t(n.labelKey, n.fallback), desc: t(n.descKey, n.descFallback), icon: n.icon })),
    },
    {
      key: 'create',
      label: t('dashboard.everything.create', 'Publish or propose'),
      tone: 'gold' as const,
      items: allCreateActions
        .map((a) => ({ key: a.href, href: a.href, label: t(a.labelKey, a.fallback), desc: t(a.descKey, a.descFallback), icon: a.icon })),
    },
    ...ACCOUNT_GROUPS.map((g) => ({
      key: g.key,
      label: t(g.labelKey, g.fallback),
      tone: 'soft' as const,
      items: ACCOUNT_SECTIONS
        .filter((s) => s.group === g.key && sectionVisible[s.value])
        .map((s) => ({
          key: s.value,
          href: accountHref(s.value),
          label: t(s.labelKey, s.fallback),
          desc: t(s.descKey, s.descFallback),
          icon: s.icon,
          badge: s.value === 'inbox' && inboxWaiting > 0 ? inboxWaiting : undefined,
        })),
    })),
  ].filter((g) => g.items.length > 0);

  const jumpToEverything = () => {
    const section = everythingRef.current;
    if (!section) return;
    const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    section.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    everythingTitleRef.current?.focus({ preventScroll: true });
  };

  /* ---------------------------------------------------- events blocks */

  // Without a registration this is the old block: the next public events,
  // the first one featured. With one, the registration gets a card of its
  // own and this lists what else is coming.
  const upcomingList = nextRegistered ? otherEvents.slice(0, 2) : events.slice(0, 3);
  const upcomingSection = (
    <Section
      title={nextRegistered ? t('dashboard.alsoComingUp', 'Also coming up') : t('dashboard.upcomingTitle')}
      link={{ to: '/events', label: t('dashboard.seeAllEvents') }}
      footer={nextRegistered ? undefined : { to: accountHref('registrations'), label: t('accountNav.registrations', 'My events') }}
    >
      {loading ? (
        <div className="p-5"><div className="aspect-video rounded-xl bg-gray-100 animate-pulse" /></div>
      ) : upcomingList.length === 0 ? (
        <p className="px-5 py-6 text-sm text-gray-600">{t('dashboard.noEvents')}</p>
      ) : (
        <div className="space-y-4 p-5">
          {upcomingList.map((e, i) => (
            <EventCard key={e.id} event={e} lang={lang} featured={!nextRegistered && i === 0} />
          ))}
        </div>
      )}
    </Section>
  );

  /* -------------------------------------------------------------- render */

  return (
    <div className="min-h-screen bg-gray-50 pb-16">
      <Helmet>
        <title>{`${t('dashboard.title')} — Smart Marina Connect`}</title>
      </Helmet>

      {/* ── Header band: the organization's own cover; without one (most
          organizations), an SM26 photo rather than a bare gradient. ── */}
      <CoverImage
        src={brandSrc?.banner_url || SITE_IMAGES.dashboardBand.src}
        focusY={brandSrc?.banner_url ? 0.5 : SITE_IMAGES.dashboardBand.focusY}
        alt=""
        seed={orgId ?? uid ?? 'member'}
        icon={Ship}
        aspect="fill"
        tone="sea"
        eager
        className="h-48 sm:h-56"
      >
        {/* Navy wash rising from the greeting, so white text reads on any photo. */}
        <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-[#0b2653]/90 via-[#0b2653]/55 to-[#0b2653]/25" />
        <div className="absolute inset-0 flex items-end">
          <div className="container mx-auto px-4 pb-6 flex items-end gap-4">
            {organization && (
              <LogoBadge
                src={brandSrc?.logo_url}
                name={organization.name}
                size="lg"
                className="hidden sm:flex ring-4 ring-white/90 shadow-lg"
              />
            )}
            <div className="min-w-0 flex-1 text-white">
              <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight drop-shadow-sm">
                {t('dashboard.greeting', { name: firstName })}
              </h1>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-white/85">
                {organization && <span className="truncate">{t('dashboard.actingFor', { org: orgName })}</span>}
                {organization && (
                  orgVerified ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-xs backdrop-blur-sm">
                      <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" /> {t('dashboard.verified')}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/25 px-2 py-0.5 text-xs backdrop-blur-sm">
                      <Clock className="h-3.5 w-3.5" aria-hidden="true" /> {t('dashboard.underReview')}
                    </span>
                  )
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={jumpToEverything}
              className="hidden shrink-0 items-center gap-2 rounded-full bg-white/15 px-4 min-h-10 text-sm font-medium text-white ring-1 ring-white/30 backdrop-blur-sm transition-colors hover:bg-white/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-white md:inline-flex"
            >
              <LayoutGrid className="h-4 w-4" aria-hidden="true" />
              {t('dashboard.everything.jump', 'Everything you can do')}
            </button>
          </div>
        </div>
      </CoverImage>

      <div className="container mx-auto px-4 pt-8">
        {/* ── Blocking status, above everything else ── */}
        {profile?.access_status === 'pending' && (
          <StatusCard tone="amber" icon={Clock} title={t('dashboard.statusPendingTitle')} body={t('dashboard.statusPendingBody')} />
        )}
        {profile?.access_status === 'rejected' && (
          <StatusCard
            tone="red"
            icon={AlertCircle}
            title={t('dashboard.statusRejectedTitle')}
            body={profile.rejection_reason ? t('dashboard.statusRejectedBody', { reason: profile.rejection_reason }) : ''}
            action={<Link to="/contact" className="font-medium underline underline-offset-2">{t('dashboard.contactUs')}</Link>}
          />
        )}
        {isVerified && organization && !orgVerified && (
          <StatusCard tone="amber" icon={Clock} title={t('dashboard.orgPendingTitle', { org: orgName })} body={t('dashboard.orgPendingBody')} />
        )}

        {/* On a phone the hero has no room for the shortcut; it opens the page instead. */}
        <button
          type="button"
          onClick={jumpToEverything}
          className={cn(
            'mb-6 flex min-h-11 w-full items-center gap-3 rounded-2xl bg-white px-4 py-2.5 text-left text-sm font-medium text-gray-900 shadow-sm ring-1 ring-gray-100 transition-colors hover:bg-gray-50 md:hidden',
            FOCUS,
          )}
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-white">
            <LayoutGrid className="h-4 w-4" aria-hidden="true" />
          </span>
          <span className="flex-1">{t('dashboard.everything.jump', 'Everything you can do')}</span>
          <ChevronRight className="h-4 w-4 rotate-90 text-gray-400" aria-hidden="true" />
        </button>

        {/* grid-cols-1 is minmax(0, 1fr): a truncated title can't widen the phone column. */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* ════════════ Main column ════════════ */}
          <div className="space-y-6 lg:col-span-2">
            {/* To do */}
            <Section title={t('dashboard.todoTitle')}>
              {loading ? (
                <RowSkeleton rows={2} />
              ) : todos.length === 0 ? (
                <div className="flex items-center gap-3 px-5 py-6 text-sm text-gray-600">
                  <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" aria-hidden="true" />
                  {t('dashboard.todoEmpty')}
                </div>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {todos.map((todo) => (
                    <li key={todo.key}>
                      <Link to={todo.href} className={cn('group flex items-center gap-4 px-5 py-3.5 hover:bg-gray-50 transition-colors', ROW_FOCUS)}>
                        <span className={cn(
                          'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
                          todo.urgent ? 'bg-secondary/15 text-secondary-dark' : 'bg-primary/5 text-primary',
                        )}>
                          <todo.icon className="h-5 w-5" aria-hidden="true" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-gray-900">{todo.title}</span>
                          <span className="block text-xs text-gray-500">{todo.hint}</span>
                        </span>
                        <ChevronRight className="h-4 w-4 text-gray-300 group-hover:text-gray-500 shrink-0" aria-hidden="true" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            {/* My next event comes right after the to-do list on every screen.
                Without one, the "coming up" block takes that place on phones
                (on desktop it sits in the side column). */}
            {nextRegistered
              ? <NextEventCard event={nextRegistered} lang={lang} />
              : <div className="lg:hidden">{upcomingSection}</div>}

            {/* Demand side: what I've put out there */}
            {isDemand && (
              <Section
                title={t('dashboard.myRequestsTitle')}
                link={myRequests.length > 0 ? { to: '/account?tab=submissions', label: t('dashboard.seeAllRequests') } : undefined}
              >
                {loading ? (
                  <RowSkeleton rows={2} />
                ) : myRequests.length === 0 ? (
                  <div className="px-5 py-6">
                    <p className="text-sm text-gray-600 max-w-prose">{t('dashboard.myRequestsEmpty')}</p>
                    {createActions.length > 0 && (
                      <div className="mt-4 flex flex-wrap gap-2">
                        {createActions.map((a) => (
                          <Link
                            key={a.href}
                            to={a.href}
                            className={cn('inline-flex min-h-10 items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-800 hover:border-primary/40 hover:text-primary transition-colors', FOCUS)}
                          >
                            <a.icon className="h-4 w-4" aria-hidden="true" />
                            {t(a.labelKey, a.fallback)}
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <ul className="divide-y divide-gray-100">
                    {myRequests.map((r) => {
                      const Icon = r.kind === 'rfp' ? Ship : r.kind === 'consultation' ? MessageSquare : Wrench;
                      const tab = r.kind === 'rfp' ? 'rfps' : r.kind === 'consultation' ? 'consultations' : 'projects';
                      return (
                        <li key={`${r.kind}-${r.id}`}>
                          <Link to={`/account?tab=${tab}`} className={cn('group flex items-center gap-4 px-5 py-3.5 hover:bg-gray-50 transition-colors', ROW_FOCUS)}>
                            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/5 text-primary">
                              <Icon className="h-5 w-5" aria-hidden="true" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium text-gray-900">{r.title}</span>
                              <span className="block text-xs text-gray-500">{t(`dashboard.${r.kind}`)}</span>
                            </span>
                            <StatusPill status={r.status} label={t(`dashboard.status_${r.status}`, r.status)} />
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Section>
            )}

            {/* Supply side: open business */}
            {isSupply && (
              <Section
                title={t('dashboard.opportunitiesTitle')}
                link={canSeeOpportunities ? { to: '/opportunities', label: t('dashboard.seeAllOpportunities') } : undefined}
              >
                {!canSeeOpportunities ? (
                  <p className="px-5 py-6 text-sm text-gray-600">{t('dashboard.opportunitiesLocked')}</p>
                ) : loading ? (
                  <RowSkeleton rows={3} />
                ) : opportunities.length === 0 ? (
                  <p className="px-5 py-6 text-sm text-gray-600">{t('dashboard.opportunitiesEmpty')}</p>
                ) : (
                  <ul className="divide-y divide-gray-100">
                    {opportunities.map((o) => (
                      <li key={`${o.kind}-${o.id}`}>
                        <Link to="/opportunities" className={cn('group flex items-center gap-4 px-5 py-3.5 hover:bg-gray-50 transition-colors', ROW_FOCUS)}>
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/5 text-primary">
                            {o.kind === 'rfp'
                              ? <Ship className="h-5 w-5" aria-hidden="true" />
                              : <MessageSquare className="h-5 w-5" aria-hidden="true" />}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-gray-900">{o.title}</span>
                            <span className="block text-xs text-gray-500">
                              {t(`dashboard.${o.kind}`)}
                              {o.deadline && ` · ${t('dashboard.deadline', {
                                date: new Date(o.deadline).toLocaleDateString(lang, { day: 'numeric', month: 'short' }),
                              })}`}
                            </span>
                          </span>
                          {o.matches && (
                            <span className="hidden sm:inline-flex rounded-full bg-secondary/15 px-2 py-0.5 text-[11px] font-medium text-secondary-dark">
                              {t('dashboard.opportunitiesMatch')}
                            </span>
                          )}
                          <ChevronRight className="h-4 w-4 text-gray-300 group-hover:text-gray-500 shrink-0" aria-hidden="true" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            )}

            {/* Resources — the visual block */}
            <Section
              title={resourcesMatched ? t('dashboard.resourcesForYou') : t('dashboard.resourcesLatest')}
              link={{ to: '/resources', label: t('dashboard.seeAllResources') }}
            >
              {loading ? (
                <div className="grid grid-cols-2 gap-4 p-5 xl:grid-cols-4">
                  {[0, 1, 2, 3].map((i) => <div key={i} className="aspect-[3/2] rounded-xl bg-gray-100 animate-pulse" />)}
                </div>
              ) : resources.length === 0 ? (
                <p className="px-5 py-6 text-sm text-gray-600">{t('dashboard.noResources')}</p>
              ) : (
                <div className="grid grid-cols-2 gap-4 p-5 xl:grid-cols-4">
                  {resources.map((r) => (
                    <Link key={r.id} to={`/resources/${r.id}`} className={cn('group block rounded-xl', FOCUS)}>
                      <CoverImage
                        src={r.thumbnail_url}
                        alt=""
                        seed={r.id}
                        icon={RESOURCE_ICON[r.type] ?? BookOpen}
                        aspect="wide"
                        className="rounded-xl"
                        imageClassName="group-hover:scale-[1.03]"
                      >
                        <span className="absolute left-3 top-3 rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-medium text-gray-800 backdrop-blur-sm">
                          {t(`resources.types.${r.type}`, r.type)}
                        </span>
                      </CoverImage>
                      <h3 className="mt-3 line-clamp-2 text-sm font-semibold text-gray-900 group-hover:text-primary transition-colors">
                        {r.title}
                      </h3>
                      {r.summary && <p className="mt-1 line-clamp-2 text-xs text-gray-500">{r.summary}</p>}
                    </Link>
                  ))}
                </div>
              )}
            </Section>
          </div>

          {/* ════════════ Side column ════════════ */}
          <div className="space-y-6">
            {nextRegistered
              ? (otherEvents.length > 0 && upcomingSection)
              : <div className="hidden lg:block">{upcomingSection}</div>}

            {showMeter && organization && (
              <ProfileMeter
                items={meterItems}
                loading={loading}
                orgName={orgName}
                publicHref={organization.slug ? `/organizations/${organization.slug}` : null}
              />
            )}

            {persona === 'investor' && (
              <Link
                to="/investments"
                className={cn('group block rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-100 hover:ring-primary/30 transition', FOCUS)}
              >
                <TrendingUp className="h-6 w-6 text-primary" aria-hidden="true" />
                <h2 className="mt-3 font-semibold text-gray-900">{t('dashboard.dealFlowTitle')}</h2>
                <p className="mt-1 text-sm text-gray-600">{t('dashboard.dealFlowBody')}</p>
                <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary">
                  {t('dashboard.dealFlowCta')}
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                </span>
              </Link>
            )}
          </div>
        </div>

        {/* ════════════ Everything you can do here ════════════ */}
        <section
          ref={everythingRef}
          aria-labelledby="dash-everything-title"
          className="mt-6 scroll-mt-20 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-gray-100"
        >
          <header className="border-b border-gray-100 px-5 py-4">
            <h2
              id="dash-everything-title"
              ref={everythingTitleRef}
              tabIndex={-1}
              className="text-base font-semibold text-gray-900 focus:outline-none"
            >
              {t('dashboard.everything.title', 'Everything you can do here')}
            </h2>
            <p className="mt-0.5 text-sm text-gray-600">
              {t('dashboard.everything.intro', 'Every feature open to you, grouped like your account menu.')}
            </p>
          </header>
          <div className="grid grid-cols-1 gap-x-6 gap-y-7 p-3 sm:grid-cols-2 sm:p-5 xl:grid-cols-3">
            {quickGroups.map((g) => (
              <QuickGroupList key={g.key} group={g} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ pieces */

function HeaderLink({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      className={cn(
        '-my-2 -mr-2 inline-flex min-h-10 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-medium text-primary hover:underline underline-offset-2',
        ROW_FOCUS,
      )}
    >
      {label}
      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
    </Link>
  );
}

function Section({
  title,
  link,
  footer,
  children,
}: {
  title: string;
  link?: { to: string; label: string };
  /** A secondary destination, shown under the content. */
  footer?: { to: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-gray-100">
      <header className="flex items-center justify-between gap-4 border-b border-gray-100 px-5 py-3.5">
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        {link && <HeaderLink to={link.to} label={link.label} />}
      </header>
      {children}
      {footer && (
        <div className="border-t border-gray-100 px-5 py-2">
          <Link
            to={footer.to}
            className={cn('-mx-2 inline-flex min-h-10 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-primary hover:underline underline-offset-2', ROW_FOCUS)}
          >
            <CalendarDays className="h-4 w-4" aria-hidden="true" />
            {footer.label}
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </div>
      )}
    </section>
  );
}

function StatusCard({
  tone,
  icon: Icon,
  title,
  body,
  action,
}: {
  tone: 'amber' | 'red';
  icon: LucideIcon;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className={cn(
      'mb-6 flex gap-3 rounded-2xl p-4 ring-1',
      tone === 'amber' ? 'bg-amber-50 text-amber-900 ring-amber-200' : 'bg-red-50 text-red-900 ring-red-200',
    )}>
      <Icon className="h-5 w-5 shrink-0 mt-0.5" aria-hidden="true" />
      <div className="text-sm">
        <p className="font-semibold">{title}</p>
        {body && <p className="mt-1 opacity-90">{body}</p>}
        {action && <p className="mt-2">{action}</p>}
      </div>
    </div>
  );
}

function StatusPill({ status, label }: { status: string; label: string }) {
  const tone =
    status === 'approved' ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
      : status === 'rejected' ? 'bg-red-50 text-red-700 ring-red-200'
        : status === 'closed' ? 'bg-gray-100 text-gray-600 ring-gray-200'
          : 'bg-amber-50 text-amber-700 ring-amber-200';
  return (
    <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1', tone)}>
      {label}
    </span>
  );
}

function EventCard({ event, lang, featured }: { event: DashEvent; lang: string; featured: boolean }) {
  const { t } = useTranslation();
  const start = new Date(event.date_time);
  const isWebinar = event.event_type === 'webinar';
  const cover = eventCover(event);

  return (
    <Link to={`/events/${event.id}`} className={cn('group block rounded-xl', FOCUS)}>
      {featured && (
        <CoverImage
          src={cover?.src ?? null}
          focusY={cover?.focusY}
          alt=""
          seed={event.id}
          icon={isWebinar ? Video : CalendarDays}
          aspect="video"
          className="mb-3 rounded-xl"
        >
          <div className="absolute left-3 top-3 flex flex-col items-center rounded-lg bg-white/95 px-2.5 py-1.5 text-center shadow-sm">
            <span className="text-lg font-bold leading-none text-primary">{start.getDate()}</span>
            <span className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-500">
              {start.toLocaleDateString(lang, { month: 'short' })}
            </span>
          </div>
          {event.registered && (
            <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-emerald-700 px-2 py-0.5 text-[11px] font-medium text-white">
              <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> {t('dashboard.registered')}
            </span>
          )}
        </CoverImage>
      )}
      <div className={cn(!featured && 'flex gap-3')}>
        {!featured && (
          <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl bg-primary/5 text-center">
            <span className="text-base font-bold leading-none text-primary">{start.getDate()}</span>
            <span className="mt-0.5 text-[10px] font-medium uppercase text-gray-500">
              {start.toLocaleDateString(lang, { month: 'short' })}
            </span>
          </div>
        )}
        <div className="min-w-0">
          <h3 className="line-clamp-2 text-sm font-semibold text-gray-900 group-hover:text-primary transition-colors">
            {event.title}
          </h3>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-gray-500">
            {isWebinar ? <Video className="h-3.5 w-3.5" aria-hidden="true" /> : <MapPin className="h-3.5 w-3.5" aria-hidden="true" />}
            <span className="truncate">
              {isWebinar ? t('dashboard.webinar') : (event.location || t('dashboard.onSite'))}
              {/* A full-day event has no meaningful start time — "00:00" would read as midnight. */}
              {!event.is_full_day && ` · ${start.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' })}`}
            </span>
          </p>
          {!featured && event.registered && (
            <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700">
              <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> {t('dashboard.registered')}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

/**
 * The next event I'm registered for, with everything needed to actually be
 * there: a countdown, the calendar buttons and — for a webinar — the joining
 * link, shown to registered attendees exactly as the event page does.
 */
function NextEventCard({ event, lang }: { event: DashEvent; lang: string }) {
  const { t } = useTranslation();
  // Its own clock: a tick re-renders this card only, never the page.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const start = new Date(event.date_time);
  const end = event.end_date_time ? new Date(event.end_date_time) : null;
  const startMs = start.getTime();
  const endMs = end ? end.getTime() : startMs + DEFAULT_DURATION_MS;
  const hasEnded = endMs <= now;
  const isLive = startMs <= now && !hasEnded;
  const isWebinar = event.event_type === 'webinar';
  const multiDay = !!end && end.toDateString() !== start.toDateString();

  const fmtDay = (d: Date) => d.toLocaleDateString(lang, { weekday: 'short', day: 'numeric', month: 'short' });
  const fmtTime = (d: Date) => d.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' });
  const when = multiDay
    ? `${fmtDay(start)} – ${fmtDay(end as Date)}`
    : `${fmtDay(start)} · ${event.is_full_day
      ? t('dashboard.allDay', 'All day')
      : end ? `${fmtTime(start)}–${fmtTime(end)}` : fmtTime(start)}`;
  const where = isWebinar ? t('dashboard.webinarOnline', 'Webinar · online') : (event.location || t('dashboard.onSite'));

  // Countdown parts: days only while there are any, minutes always.
  const left = Math.max(0, startMs - now);
  const days = Math.floor(left / 86_400_000);
  const hours = Math.floor((left % 86_400_000) / 3_600_000);
  const minutes = Math.floor((left % 3_600_000) / 60_000);
  const parts = [
    ...(days > 0 ? [{ key: 'd', value: days, label: t('dashboard.unitDays', { count: days, defaultValue_one: 'day', defaultValue_other: 'days' }) }] : []),
    { key: 'h', value: hours, label: t('dashboard.unitHours', { count: hours, defaultValue_one: 'hour', defaultValue_other: 'hours' }) },
    { key: 'm', value: minutes, label: t('dashboard.unitMinutes', { count: minutes, defaultValue_one: 'min', defaultValue_other: 'min' }) },
  ];
  const startsIn = t('dashboard.startsIn', 'Starts in');

  const calendarEvent: CalendarEventInput = {
    title: event.title,
    description: event.description,
    date_time: event.date_time,
    end_date_time: event.end_date_time,
    location: event.location,
    url: event.meeting_url,
  };

  return (
    <section aria-labelledby="dash-next-event-title" className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-gray-100">
      <header className="flex items-center justify-between gap-4 border-b border-gray-100 px-5 py-3.5">
        <h2 id="dash-next-event-title" className="text-sm font-semibold text-gray-900">{t('dashboard.nextEventTitle')}</h2>
        <HeaderLink to={accountHref('registrations')} label={t('accountNav.registrations', 'My events')} />
      </header>

      <div className="md:grid md:grid-cols-5">
        {/* The picture repeats the title link below, so it stays out of the tab order. */}
        <Link to={`/events/${event.id}`} tabIndex={-1} aria-hidden="true" className="block md:col-span-2">
          <CoverImage
            src={eventCover(event)?.src ?? null}
            focusY={eventCover(event)?.focusY}
            alt=""
            seed={event.id}
            icon={isWebinar ? Video : CalendarDays}
            aspect="fill"
            tone="sea"
            className="h-40 md:h-full md:min-h-[17rem]"
          >
            <div className="absolute left-3 top-3 flex flex-col items-center rounded-lg bg-white/95 px-3 py-2 text-center shadow-sm">
              <span className="text-2xl font-bold leading-none text-primary">{start.getDate()}</span>
              <span className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-gray-600">
                {start.toLocaleDateString(lang, { month: 'short' })}
              </span>
            </div>
            <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-emerald-700 px-2 py-0.5 text-[11px] font-medium text-white">
              <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> {t('dashboard.registered')}
            </span>
          </CoverImage>
        </Link>

        <div className="space-y-4 p-5 md:col-span-3">
          <div>
            <h3 className="text-lg font-semibold leading-snug text-gray-900">
              <Link to={`/events/${event.id}`} className={cn('rounded hover:text-primary transition-colors', FOCUS)}>
                {event.title}
              </Link>
            </h3>
            <p className="mt-1.5 flex items-center gap-1.5 text-sm text-gray-600">
              <CalendarDays className="h-4 w-4 shrink-0 text-gray-500" aria-hidden="true" />
              <span>{when}</span>
            </p>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-gray-600">
              {isWebinar
                ? <Video className="h-4 w-4 shrink-0 text-gray-500" aria-hidden="true" />
                : <MapPin className="h-4 w-4 shrink-0 text-gray-500" aria-hidden="true" />}
              <span className="truncate">{where}</span>
            </p>
          </div>

          {isLive ? (
            <p className="inline-flex items-center gap-2 rounded-full bg-red-50 px-3 py-1 text-sm font-semibold text-red-700 ring-1 ring-red-200">
              <span className="relative flex h-2 w-2" aria-hidden="true">
                <span className="absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75 motion-safe:animate-ping" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-red-600" />
              </span>
              {t('dashboard.happeningNow', 'Happening now')}
            </p>
          ) : !hasEnded ? (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-600" aria-hidden="true">{startsIn}</p>
              <div className="mt-2 flex gap-2" aria-hidden="true">
                {parts.map((p) => (
                  <div key={p.key} className="min-w-[4.25rem] rounded-xl bg-primary px-3 py-2 text-center text-white">
                    <span className="block text-2xl font-bold leading-none tabular-nums">{p.value}</span>
                    <span className="mt-1 block text-[11px] uppercase tracking-wide text-white/80">{p.label}</span>
                  </div>
                ))}
              </div>
              <p className="sr-only">{`${startsIn} ${parts.map((p) => `${p.value} ${p.label}`).join(', ')}`}</p>
            </div>
          ) : null}

          {/* Webinar: registered attendees get the joining link, as on the event page. */}
          {isWebinar && !hasEnded && (
            event.meeting_url ? (
              <Button asChild className="h-11 w-full rounded-xl sm:w-auto">
                <a href={event.meeting_url} target="_blank" rel="noopener noreferrer">
                  <Video className="mr-2 h-4 w-4" aria-hidden="true" />
                  {t('dashboard.joinWebinar', 'Join the webinar')}
                  <ExternalLink className="ml-2 h-3.5 w-3.5 opacity-80" aria-hidden="true" />
                  <span className="sr-only"> {t('dashboard.opensNewTab', '(opens in a new tab)')}</span>
                </a>
              </Button>
            ) : (
              <p className="flex items-start gap-2 rounded-xl bg-primary/5 p-3 text-sm text-gray-700">
                <Video className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                {t('dashboard.joinLater', 'The joining link will appear here before the webinar starts.')}
              </p>
            )
          )}

          {!hasEnded && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-600">
                {t('dashboard.addToCalendar', 'Add to your calendar')}
              </p>
              <AddToCalendarButtons event={calendarEvent} />
            </div>
          )}

          <Link
            to={`/events/${event.id}`}
            className={cn('-mx-2 inline-flex min-h-10 items-center gap-1 rounded-lg px-2 text-sm font-medium text-primary hover:underline underline-offset-2', FOCUS)}
          >
            {t('dashboard.viewEvent')}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </section>
  );
}

/**
 * How complete the organization's public profile is. Logo, cover and
 * description are already nudges in "Needs your attention", so here they only
 * count and point there; the other three link to their own section.
 */
function ProfileMeter({
  items,
  loading,
  orgName,
  publicHref,
}: {
  items: MeterItem[];
  loading: boolean;
  orgName: string;
  publicHref: string | null;
}) {
  const { t } = useTranslation();
  const total = items.length;
  const done = items.filter((i) => i.done).length;
  const percent = total ? Math.round((done / total) * 100) : 100;
  const complete = done === total;
  const scoreText = t('dashboard.profileMeter.score', { done, total, defaultValue: '{{done}} of {{total}} done' });

  // What to do first: the rows with a link of their own, then the ones the
  // to-do list already carries, then what's done.
  const rank = (i: MeterItem) => (i.done ? 2 : i.inTodo ? 1 : 0);
  const ordered = [...items].sort((a, b) => rank(a) - rank(b));

  return (
    <section aria-labelledby="dash-meter-title" className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-gray-100">
      <header className="flex items-center justify-between gap-4 border-b border-gray-100 px-5 py-3.5">
        <h2 id="dash-meter-title" className="text-sm font-semibold text-gray-900">
          {t('dashboard.profileMeter.title', 'Organization profile')}
        </h2>
        <HeaderLink to={accountHref('organization')} label={t('dashboard.profileMeter.edit', 'Edit')} />
      </header>

      {loading ? (
        <div className="space-y-3 p-5">
          <div className="h-6 w-1/3 rounded bg-gray-100 animate-pulse" />
          <div className="h-2 rounded-full bg-gray-100 animate-pulse" />
          <div className="h-3 w-2/3 rounded bg-gray-100 animate-pulse" />
        </div>
      ) : complete ? (
        <div className="flex gap-3 p-5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
            <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900">{t('dashboard.profileMeter.completeTitle', 'Your profile is complete')}</p>
            <p className="mt-0.5 text-sm text-gray-600">
              {t('dashboard.profileMeter.completeBody', { org: orgName, defaultValue: 'Every part of the {{org}} profile is filled in.' })}
            </p>
            {publicHref && (
              <Link
                to={publicHref}
                className={cn('-mx-2 mt-1 inline-flex min-h-10 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-primary hover:underline underline-offset-2', FOCUS)}
              >
                <Eye className="h-4 w-4" aria-hidden="true" />
                {t('dashboard.profileMeter.viewPublic', 'See your public profile')}
              </Link>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="px-5 pt-5 pb-4">
            <div className="flex items-end justify-between gap-3">
              <p className="text-2xl font-bold leading-none text-primary tabular-nums">{percent}%</p>
              <p className="text-xs font-medium text-gray-600">{scoreText}</p>
            </div>
            <div
              role="progressbar"
              aria-label={t('dashboard.profileMeter.progressLabel', 'Profile completeness')}
              aria-valuemin={0}
              aria-valuemax={total}
              aria-valuenow={done}
              aria-valuetext={scoreText}
              className="mt-3 flex gap-1"
            >
              {items.map((i, idx) => (
                <span
                  key={i.key}
                  className={cn('h-2 flex-1 rounded-full', idx < done ? 'bg-secondary' : 'bg-gray-100')}
                />
              ))}
            </div>
            <p className="mt-3 text-xs text-gray-600">
              {t('dashboard.profileMeter.intro', 'Complete profiles are easier to find, and to trust, in the directory.')}
            </p>
          </div>
          <ul className="divide-y divide-gray-100 border-t border-gray-100">
            {ordered.map((item) => {
              const label = t(`dashboard.profileMeter.items.${item.key}`, METER_LABEL[item.key]);
              if (item.done) {
                return (
                  <li key={item.key} className="flex items-center gap-3 px-5 py-2.5 text-sm text-gray-600">
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
                    <span className="flex-1">{label}</span>
                    <span className="sr-only">{t('dashboard.profileMeter.done', 'Done')}</span>
                  </li>
                );
              }
              if (item.inTodo) {
                return (
                  <li key={item.key} className="flex items-center gap-3 px-5 py-2.5 text-sm text-gray-800">
                    <CircleDashed className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
                    <span className="flex-1">{label}</span>
                    <span className="text-xs text-gray-500">{t('dashboard.profileMeter.inTodo', 'In your to-do list')}</span>
                  </li>
                );
              }
              return (
                <li key={item.key}>
                  <Link
                    to={item.href}
                    className={cn('group flex items-center gap-3 px-5 py-3 transition-colors hover:bg-gray-50', ROW_FOCUS)}
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/5 text-primary">
                      <item.icon className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-gray-900">{label}</span>
                      {METER_HINT[item.key] && (
                        <span className="block text-xs text-gray-500">
                          {t(`dashboard.profileMeter.hints.${item.key}`, METER_HINT[item.key] as string)}
                        </span>
                      )}
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-gray-300 group-hover:text-gray-500" aria-hidden="true" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}

const QUICK_TONE: Record<QuickTone, string> = {
  navy: 'bg-primary text-white',
  gold: 'bg-secondary text-primary',
  soft: 'bg-primary/5 text-primary',
};

/** One group of the "everything you can do here" map. */
function QuickGroupList({ group }: { group: QuickGroup }) {
  const { t } = useTranslation();
  const headingId = `dash-quick-${group.key}`;
  return (
    <div>
      <h3 id={headingId} className="px-2.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
        {group.label}
      </h3>
      <ul aria-labelledby={headingId} className="mt-2 space-y-0.5">
        {group.items.map((item) => (
          <li key={item.key}>
            <Link
              to={item.href}
              className={cn(
                'group flex min-h-[3.25rem] items-center gap-3 rounded-xl px-2.5 py-2 transition-colors hover:bg-gray-50',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary',
              )}
            >
              <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', QUICK_TONE[group.tone])}>
                <item.icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-gray-900 group-hover:text-primary transition-colors">{item.label}</span>
                <span className="block truncate text-xs text-gray-500">{item.desc}</span>
              </span>
              {item.badge ? (
                <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-semibold text-primary">
                  <span aria-hidden="true">{item.badge}</span>
                  <span className="sr-only">
                    {t('dashboard.everything.waiting', { count: item.badge, defaultValue_one: '{{count}} waiting', defaultValue_other: '{{count}} waiting' })}
                  </span>
                </span>
              ) : null}
              <ChevronRight className="h-4 w-4 shrink-0 text-gray-300 group-hover:text-gray-500" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RowSkeleton({ rows }: { rows: number }) {
  return (
    <div className="divide-y divide-gray-100">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-3.5">
          <div className="h-10 w-10 rounded-xl bg-gray-100 animate-pulse" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-2/3 rounded bg-gray-100 animate-pulse" />
            <div className="h-2.5 w-1/3 rounded bg-gray-100 animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}
