import { useEffect, useRef, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Helmet } from 'react-helmet-async';
import type { LucideIcon } from 'lucide-react';
import {
  Inbox, UserPlus, ImageIcon, ImagePlus, PenLine, UserCircle,
  CheckCircle2, Clock, AlertCircle, CalendarDays, Video, MapPin, Ship,
  MessageSquare, Wrench, BookOpen, ArrowRight, TrendingUp, ShieldCheck,
  CircleDashed, Tags, Users, GalleryHorizontal, Briefcase, ClipboardList, Award,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useEntitlements } from '@/hooks/useEntitlements';
import { supabase } from '@/lib/supabase';
import { CoverImage, LogoBadge } from '@/components/ui/CoverImage';
import { SITE_IMAGES, eventCover } from '@/lib/siteMedia';
import { Button } from '@/components/ui/button';
import { AddToCalendarButtons } from '@/components/events/AddToCalendarButtons';
import { CardShell, CardMedia, StretchedLink } from '@/components/brand/CardShell';
import { Eyebrow } from '@/components/brand/Eyebrow';
import { UnderlineLink } from '@/components/brand/UnderlineLink';
import { Reveal, RevealGroup } from '@/components/motion/Reveal';
import {
  BandPill, BlockSkeleton, FOCUS, MemberBanner, MemberEmpty, MemberHeader, MemberPanel, MemberRow,
  RowSkeleton, SectionHeading, StatusPill, type PillTone,
} from '@/components/member/MemberUI';
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
  /** M3 staff or Yacht Club de Monaco: the sponsorship fulfilment hub (/sponsorship) is theirs. */
  manager: boolean;
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
  items: QuickItem[];
}

/* ------------------------------------------------------------------ helpers */

const DEMAND_PERSONAS = ['marina', 'developer'];
const SUPPLY_PERSONAS = ['partner', 'media_partner'];

/** Same default as the event page when an event has no end time. */
const DEFAULT_DURATION_MS = 60 * 60 * 1000;

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

    const manager = (async () => {
      try {
        const { data } = await supabase.rpc('is_sponsorship_manager');
        return data === true;
      } catch {
        return false;
      }
    })();

    Promise.all([sm26, media, sponsor, manager]).then(([a, b, c, d]) => {
      if (alive) setAccess({ sm26: a, media: b, sponsor: c, manager: d });
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
    profile: true,
    notifications: true,
  };
  const inboxWaiting = pendingConnections + joinRequests;

  const quickGroups: QuickGroup[] = [
    {
      key: 'explore',
      label: t('dashboard.everything.explore', 'Explore the platform'),
      items: [...MEMBER_NAV.filter((n) => n.href !== '/dashboard'), ...(isInvestor ? [DEAL_FLOW_ITEM] : [])]
        .map((n) => ({ key: n.href, href: n.href, label: t(n.labelKey, n.fallback), desc: t(n.descKey, n.descFallback), icon: n.icon })),
    },
    {
      key: 'create',
      label: t('dashboard.everything.create', 'Publish or propose'),
      items: allCreateActions
        .map((a) => ({ key: a.href, href: a.href, label: t(a.labelKey, a.fallback), desc: t(a.descKey, a.descFallback), icon: a.icon })),
    },
    ...ACCOUNT_GROUPS.map((g): QuickGroup => ({
      key: g.key,
      label: t(g.labelKey, g.fallback),
      items: [
        ...ACCOUNT_SECTIONS
          .filter((s) => s.group === g.key && sectionVisible[s.value])
          .map((s): QuickItem => ({
            key: s.value,
            href: accountHref(s.value),
            label: t(s.labelKey, s.fallback),
            desc: t(s.descKey, s.descFallback),
            icon: s.icon,
            badge: s.value === 'inbox' && inboxWaiting > 0 ? inboxWaiting : undefined,
          })),
        // The sponsorship hub has no tab of its own: managers (M3 staff, Yacht Club) reach it from here.
        ...(g.key === 'organization' && access?.manager === true ? [{
          key: 'sponsorship-hub',
          href: '/sponsorship',
          label: t('dashboard.everything.sponsorshipHub', 'Sponsorship hub'),
          desc: t('dashboard.everything.sponsorshipHubDesc', 'Agreements and fulfilment for every sponsor'),
          icon: Award,
        } satisfies QuickItem] : []),
      ],
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
    <MemberPanel
      title={nextRegistered ? t('dashboard.alsoComingUp', 'Also coming up') : t('dashboard.upcomingTitle')}
      link={{ to: '/events', label: t('dashboard.seeAllEvents') }}
    >
      {loading ? (
        <div className="p-5"><BlockSkeleton className="aspect-video" /></div>
      ) : upcomingList.length === 0 ? (
        <MemberEmpty icon={CalendarDays} title={t('dashboard.noEvents')} className="py-8" />
      ) : (
        <div className="space-y-4 p-5">
          {upcomingList.map((e, i) => (
            <EventCard key={e.id} event={e} lang={lang} featured={!nextRegistered && i === 0} />
          ))}
        </div>
      )}
      {!nextRegistered && (
        <div className="border-t border-rule px-5 py-3">
          <UnderlineLink to={accountHref('registrations')} className="!text-[14px] !leading-5">
            {t('accountNav.registrations', 'My events')}
          </UnderlineLink>
        </div>
      )}
    </MemberPanel>
  );

  /* -------------------------------------------------------------- render */

  return (
    <div className="min-h-screen bg-page pb-20">
      <Helmet>
        <title>{`${t('dashboard.title')} — Smart Marina Connect`}</title>
      </Helmet>

      {/* ── Header band: the organization's own cover; without one (most
          organizations), an SM26 photo rather than a bare gradient. ── */}
      <MemberHeader
        image={brandSrc?.banner_url ? { src: brandSrc.banner_url, focusY: 0.5 } : SITE_IMAGES.dashboardBand}
        seed={orgId ?? uid ?? 'member'}
        icon={Ship}
        eyebrow={t('dashboard.title')}
        title={t('dashboard.greeting', { name: firstName })}
        leading={organization ? (
          <LogoBadge
            src={brandSrc?.logo_url}
            name={organization.name}
            size="lg"
            className="hidden ring-2 ring-white/80 sm:flex"
          />
        ) : undefined}
        actions={(
          <UnderlineLink tone="light" onClick={jumpToEverything}>
            {t('dashboard.everything.jump', 'Everything you can do')}
          </UnderlineLink>
        )}
      >
        {organization && <span className="min-w-0 [overflow-wrap:anywhere]">{t('dashboard.actingFor', { org: orgName })}</span>}
        {organization && (
          orgVerified ? (
            <BandPill icon={ShieldCheck}>{t('dashboard.verified')}</BandPill>
          ) : (
            <BandPill tone="warning" icon={Clock}>{t('dashboard.underReview')}</BandPill>
          )
        )}
      </MemberHeader>

      <div className="mx-auto w-full max-w-7xl px-4 pt-8 sm:px-6 md:pt-10">
        {/* ── Blocking status, above everything else ── */}
        {profile?.access_status === 'pending' && (
          <MemberBanner
            tone="warning"
            icon={Clock}
            title={t('dashboard.statusPendingTitle')}
            body={t('dashboard.statusPendingBody')}
            action={(
              <nav aria-label={t('dashboard.pendingMeanwhile', 'While you wait')} className="flex flex-col gap-1.5 sm:items-end">
                <UnderlineLink to={accountHref('profile')} className="!text-[14px] !leading-5">{t('dashboard.pendingProfile', 'Complete your profile')}</UnderlineLink>
                <UnderlineLink to="/resources" className="!text-[14px] !leading-5">{t('dashboard.pendingLibrary', 'Read the library')}</UnderlineLink>
                <UnderlineLink to="/events?type=webinar" className="!text-[14px] !leading-5">{t('dashboard.pendingWebinar', 'Register for a webinar')}</UnderlineLink>
                <UnderlineLink to="/contact" className="!text-[14px] !leading-5">{t('dashboard.pendingContact', 'Write to the M3 team')}</UnderlineLink>
              </nav>
            )}
          />
        )}
        {profile?.access_status === 'rejected' && (
          <MemberBanner
            tone="danger"
            icon={AlertCircle}
            title={t('dashboard.statusRejectedTitle')}
            body={profile.rejection_reason ? t('dashboard.statusRejectedBody', { reason: profile.rejection_reason }) : undefined}
            action={<UnderlineLink to="/contact">{t('dashboard.contactUs')}</UnderlineLink>}
          />
        )}
        {isVerified && organization && !orgVerified && (
          <MemberBanner tone="warning" icon={Clock} title={t('dashboard.orgPendingTitle', { org: orgName })} body={t('dashboard.orgPendingBody')} />
        )}

        {/* grid-cols-1 is minmax(0, 1fr): a long title can't widen the phone column. */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 lg:gap-8">
          {/* ════════════ Main column ════════════ */}
          <div className="space-y-6 lg:col-span-2 lg:space-y-8">
            {/* To do */}
            <Reveal>
              <MemberPanel title={t('dashboard.todoTitle')}>
                {loading ? (
                  <RowSkeleton rows={2} />
                ) : todos.length === 0 ? (
                  <div className="flex items-center gap-3 px-5 py-6 text-[15px] text-meta">
                    <CheckCircle2 className="h-5 w-5 shrink-0 text-teal" aria-hidden="true" />
                    {t('dashboard.todoEmpty')}
                  </div>
                ) : (
                  <ul className="divide-y divide-rule">
                    {todos.map((todo) => (
                      <MemberRow key={todo.key} to={todo.href} icon={todo.icon} title={todo.title} hint={todo.hint} urgent={todo.urgent} />
                    ))}
                  </ul>
                )}
              </MemberPanel>
            </Reveal>

            {/* My next event comes right after the to-do list on every screen.
                Without one, the "coming up" block takes that place on phones
                (on desktop it sits in the side column). */}
            {nextRegistered
              ? <Reveal><NextEventCard event={nextRegistered} lang={lang} /></Reveal>
              : <div className="lg:hidden">{upcomingSection}</div>}

            {/* Demand side: what I've put out there */}
            {isDemand && (
              <Reveal>
                <MemberPanel
                  title={t('dashboard.myRequestsTitle')}
                  link={myRequests.length > 0 ? { to: '/account?tab=submissions', label: t('dashboard.seeAllRequests') } : undefined}
                >
                  {loading ? (
                    <RowSkeleton rows={2} />
                  ) : myRequests.length === 0 ? (
                    <MemberEmpty
                      icon={ClipboardList}
                      title={t('dashboard.myRequestsEmptyTitle', 'Nothing published yet')}
                      body={t('dashboard.myRequestsEmpty')}
                      action={createActions.map((a, i) => (
                        <Button key={a.href} asChild variant={i === 0 ? 'cta' : 'ctaOutline'} size="sm">
                          <Link to={a.href}>{t(a.labelKey, a.fallback)}</Link>
                        </Button>
                      ))}
                    />
                  ) : (
                    <ul className="divide-y divide-rule">
                      {myRequests.map((r) => {
                        const Icon = r.kind === 'rfp' ? Ship : r.kind === 'consultation' ? MessageSquare : Wrench;
                        const tab = r.kind === 'rfp' ? 'rfps' : r.kind === 'consultation' ? 'consultations' : 'projects';
                        return (
                          <MemberRow
                            key={`${r.kind}-${r.id}`}
                            to={`/account?tab=${tab}`}
                            icon={Icon}
                            title={r.title}
                            hint={t(`dashboard.${r.kind}`)}
                            aside={<RequestPill status={r.status} label={t(`dashboard.status_${r.status}`, r.status)} />}
                          />
                        );
                      })}
                    </ul>
                  )}
                </MemberPanel>
              </Reveal>
            )}

            {/* Supply side: open business */}
            {isSupply && (
              <Reveal>
                <MemberPanel
                  title={t('dashboard.opportunitiesTitle')}
                  link={canSeeOpportunities ? { to: '/opportunities', label: t('dashboard.seeAllOpportunities') } : undefined}
                >
                  {!canSeeOpportunities ? (
                    <MemberEmpty icon={ShieldCheck} title={t('dashboard.opportunitiesLocked')} className="py-8" />
                  ) : loading ? (
                    <RowSkeleton rows={3} />
                  ) : opportunities.length === 0 ? (
                    <MemberEmpty icon={Briefcase} title={t('dashboard.opportunitiesEmpty')} className="py-8" />
                  ) : (
                    <ul className="divide-y divide-rule">
                      {opportunities.map((o) => (
                        <MemberRow
                          key={`${o.kind}-${o.id}`}
                          // Open the list on the kind of the row that was clicked, so the item is on screen.
                          to={`/opportunities?kind=${o.kind === 'rfp' ? 'rfps' : 'consultations'}`}
                          icon={o.kind === 'rfp' ? Ship : MessageSquare}
                          title={o.title}
                          hint={(
                            <>
                              {t(`dashboard.${o.kind}`)}
                              {o.deadline && ` · ${t('dashboard.deadline', {
                                date: new Date(o.deadline).toLocaleDateString(lang, { day: 'numeric', month: 'short' }),
                              })}`}
                            </>
                          )}
                          aside={o.matches ? (
                            <StatusPill tone="info" className="hidden sm:inline-flex">{t('dashboard.opportunitiesMatch')}</StatusPill>
                          ) : undefined}
                        />
                      ))}
                    </ul>
                  )}
                </MemberPanel>
              </Reveal>
            )}

            {/* Resources — the visual block: the library's own cards, straight on the page */}
            <Reveal as="section" aria-labelledby="dash-resources-title">
              <div className="mb-4 flex items-center justify-between gap-4">
                <Eyebrow as="h2">
                  <span id="dash-resources-title">{resourcesMatched ? t('dashboard.resourcesForYou') : t('dashboard.resourcesLatest')}</span>
                </Eyebrow>
                <UnderlineLink to="/resources" className="!text-[14px] !leading-5">{t('dashboard.seeAllResources')}</UnderlineLink>
              </div>
              {loading ? (
                <div className="grid grid-cols-2 gap-4 xl:grid-cols-4" aria-hidden="true">
                  {[0, 1, 2, 3].map((i) => <BlockSkeleton key={i} className="aspect-[3/4] rounded-card" />)}
                </div>
              ) : resources.length === 0 ? (
                <CardShell>
                  <MemberEmpty icon={BookOpen} title={t('dashboard.noResources')} className="py-8" />
                </CardShell>
              ) : (
                <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
                  {resources.map((r) => (
                    <CardShell key={r.id} interactive>
                      <CardMedia>
                        <CoverImage
                          src={r.thumbnail_url}
                          alt=""
                          seed={r.id}
                          icon={RESOURCE_ICON[r.type] ?? BookOpen}
                          aspect="wide"
                        >
                          <span className="absolute left-3 top-3 rounded-pill bg-white/95 px-2.5 py-0.5 text-[12px] font-semibold text-navy">
                            {t(`resources.types.${r.type}`, r.type)}
                          </span>
                        </CoverImage>
                      </CardMedia>
                      <div className="flex flex-1 flex-col p-4">
                        <h3 className="text-[15px] font-semibold leading-5 text-navy">
                          <StretchedLink to={`/resources/${r.id}`} arrow={false} className="[overflow-wrap:anywhere]">{r.title}</StretchedLink>
                        </h3>
                        {r.summary && <p className="mt-1.5 line-clamp-2 text-[13px] leading-[18px] text-meta">{r.summary}</p>}
                      </div>
                    </CardShell>
                  ))}
                </div>
              )}
            </Reveal>
          </div>

          {/* ════════════ Side column ════════════ */}
          <div className="space-y-6 lg:space-y-8">
            {nextRegistered
              ? (otherEvents.length > 0 && <Reveal delay={80}>{upcomingSection}</Reveal>)
              : <Reveal delay={80} className="hidden lg:block">{upcomingSection}</Reveal>}

            {showMeter && organization && (
              <Reveal delay={160}>
                <ProfileMeter
                  items={meterItems}
                  loading={loading}
                  orgName={orgName}
                  publicHref={organization.slug ? `/organizations/${organization.slug}` : null}
                />
              </Reveal>
            )}

            {persona === 'investor' && (
              <Reveal delay={160}>
                <CardShell interactive className="p-5">
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-chip text-navy">
                    <TrendingUp className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <h2 className="mt-4 text-card-title text-navy">
                    <StretchedLink to="/investments">{t('dashboard.dealFlowTitle')}</StretchedLink>
                  </h2>
                  <p className="mt-1.5 text-[15px] leading-6 text-meta">{t('dashboard.dealFlowBody')}</p>
                  <p className="mt-3 text-[14px] font-semibold text-navy">{t('dashboard.dealFlowCta')}</p>
                </CardShell>
              </Reveal>
            )}
          </div>
        </div>

        {/* ════════════ Everything you can do here ════════════ */}
        <section
          ref={everythingRef}
          aria-labelledby="dash-everything-title"
          className="mt-14 scroll-mt-24 md:mt-20"
        >
          <SectionHeading
            eyebrow={t('memberUi.memberArea', 'Member area')}
            title={t('dashboard.everything.title', 'Everything you can do here')}
            intro={t('dashboard.everything.intro', 'Every feature open to you, grouped like your account menu.')}
            titleId="dash-everything-title"
            titleRef={everythingTitleRef}
          />
          <RevealGroup className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {quickGroups.map((g) => (
              <QuickGroupList key={g.key} group={g} />
            ))}
          </RevealGroup>
        </section>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ pieces */

/** State of one of my requests, in the one pill vocabulary. */
function RequestPill({ status, label }: { status: string; label: string }) {
  const tone: PillTone =
    status === 'approved' ? 'success'
      : status === 'rejected' ? 'danger'
        : status === 'closed' ? 'neutral'
          : 'warning';
  return <StatusPill tone={tone}>{label}</StatusPill>;
}

/** Small date tile: day and month, in the signage face. */
function DateTile({ start, lang, large = false }: { start: Date; lang: string; large?: boolean }) {
  return (
    <div className={cn('flex shrink-0 flex-col items-center justify-center rounded-xl text-center', large ? 'bg-white px-3 py-2 shadow-hover' : 'h-12 w-12 bg-chip')}>
      <span className={cn('font-signage font-semibold leading-none tabular-nums text-navy', large ? 'text-[26px]' : 'text-[19px]')}>{start.getDate()}</span>
      <span className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-meta">
        {start.toLocaleDateString(lang, { month: 'short' })}
      </span>
    </div>
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
          <div className="absolute left-3 top-3"><DateTile start={start} lang={lang} large /></div>
          {event.registered && (
            <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-pill bg-emerald-700 px-2.5 py-0.5 text-[12px] font-semibold text-white">
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> {t('dashboard.registered')}
            </span>
          )}
        </CoverImage>
      )}
      <div className={cn(!featured && 'flex gap-3')}>
        {!featured && <DateTile start={start} lang={lang} />}
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold leading-5 text-navy [overflow-wrap:anywhere]">
            <span className="card-ul">{event.title}</span>
          </h3>
          <p className="mt-1.5 flex items-center gap-1.5 text-[13px] leading-[18px] text-meta">
            {isWebinar ? <Video className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
            <span className="truncate">
              {isWebinar ? t('dashboard.webinar') : (event.location || t('dashboard.onSite'))}
              {/* A full-day event has no meaningful start time — "00:00" would read as midnight. */}
              {!event.is_full_day && ` · ${start.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' })}`}
            </span>
          </p>
          {!featured && event.registered && (
            <StatusPill tone="success" icon={CheckCircle2} className="mt-1.5">{t('dashboard.registered')}</StatusPill>
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
    <CardShell as="section">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-rule px-5 py-4">
        <Eyebrow as="h2"><span id="dash-next-event-title">{t('dashboard.nextEventTitle')}</span></Eyebrow>
        <UnderlineLink to={accountHref('registrations')} className="!text-[14px] !leading-5">
          {t('accountNav.registrations', 'My events')}
        </UnderlineLink>
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
            className="h-44 md:h-full md:min-h-[17rem]"
          >
            <div className="absolute left-3 top-3"><DateTile start={start} lang={lang} large /></div>
            <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-pill bg-emerald-700 px-2.5 py-0.5 text-[12px] font-semibold text-white">
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> {t('dashboard.registered')}
            </span>
          </CoverImage>
        </Link>

        <div className="space-y-4 p-5 md:col-span-3">
          <div className="group">
            <h3 className="text-card-title text-navy [overflow-wrap:anywhere]">
              <Link to={`/events/${event.id}`} className={cn('rounded', FOCUS)}>
                <span className="card-ul">{event.title}</span>
                <ArrowRight className="card-arrow" strokeWidth={2.25} aria-hidden="true" />
              </Link>
            </h3>
            <p className="mt-2 flex items-center gap-2 text-[15px] leading-6 text-meta">
              <CalendarDays className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{when}</span>
            </p>
            <p className="mt-1 flex items-center gap-2 text-[15px] leading-6 text-meta">
              {isWebinar
                ? <Video className="h-4 w-4 shrink-0" aria-hidden="true" />
                : <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />}
              <span className="truncate">{where}</span>
            </p>
          </div>

          {isLive ? (
            <p className="inline-flex items-center gap-2 rounded-pill bg-red-50 px-3 py-1 text-[14px] font-semibold text-red-700 ring-1 ring-inset ring-red-200">
              <span className="relative flex h-2 w-2" aria-hidden="true">
                <span className="absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75 motion-safe:animate-ping" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-red-600" />
              </span>
              {t('dashboard.happeningNow', 'Happening now')}
            </p>
          ) : !hasEnded ? (
            <div>
              <p className="text-meta-caps" aria-hidden="true">{startsIn}</p>
              <div className="mt-2 flex gap-2" aria-hidden="true">
                {parts.map((p) => (
                  <div key={p.key} className="min-w-[4.5rem] rounded-xl bg-navy px-3 py-2 text-center text-white">
                    <span className="block font-signage text-[28px] font-semibold leading-none tabular-nums">{p.value}</span>
                    <span className="mt-1 block text-[11px] font-semibold uppercase tracking-wide text-white/80">{p.label}</span>
                  </div>
                ))}
              </div>
              <p className="sr-only">{`${startsIn} ${parts.map((p) => `${p.value} ${p.label}`).join(', ')}`}</p>
            </div>
          ) : null}

          {/* Webinar: registered attendees get the joining link, as on the event page. */}
          {isWebinar && !hasEnded && (
            event.meeting_url ? (
              <Button asChild variant="cta" size="sm" className="w-full justify-between sm:w-auto">
                <a href={event.meeting_url} target="_blank" rel="noopener noreferrer">
                  {t('dashboard.joinWebinar', 'Join the webinar')}
                  <span className="sr-only"> {t('dashboard.opensNewTab', '(opens in a new tab)')}</span>
                </a>
              </Button>
            ) : (
              <p className="flex items-start gap-2 rounded-xl bg-foam p-3 text-[14px] leading-5 text-navy">
                <Video className="mt-0.5 h-4 w-4 shrink-0 text-teal" aria-hidden="true" />
                {t('dashboard.joinLater', 'The joining link will appear here before the webinar starts.')}
              </p>
            )
          )}

          {!hasEnded && (
            <div>
              <p className="text-meta-caps mb-2">
                {t('dashboard.addToCalendar', 'Add to your calendar')}
              </p>
              <AddToCalendarButtons event={calendarEvent} />
            </div>
          )}
        </div>
      </div>
    </CardShell>
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
    <MemberPanel
      title={t('dashboard.profileMeter.title', 'Organisation profile')}
      titleId="dash-meter-title"
      link={{ to: accountHref('organization'), label: t('dashboard.profileMeter.edit', 'Edit') }}
    >
      {loading ? (
        <div className="space-y-3 p-5" aria-hidden="true">
          <BlockSkeleton className="h-7 w-1/3" />
          <BlockSkeleton className="h-2 rounded-pill" />
          <BlockSkeleton className="h-3 w-2/3" />
        </div>
      ) : complete ? (
        <div className="flex gap-3 p-5">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-foam text-teal">
            <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-[15px] font-semibold leading-5 text-navy">{t('dashboard.profileMeter.completeTitle', 'Your profile is complete')}</p>
            <p className="mt-1 text-[14px] leading-5 text-meta">
              {t('dashboard.profileMeter.completeBody', { org: orgName, defaultValue: 'Every part of the {{org}} profile is filled in.' })}
            </p>
            {publicHref && (
              <div className="mt-3">
                <UnderlineLink to={publicHref} className="!text-[14px] !leading-5">
                  {t('dashboard.profileMeter.viewPublic', 'See your public profile')}
                </UnderlineLink>
              </div>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="px-5 pb-4 pt-5">
            <div className="flex items-end justify-between gap-3">
              <p className="font-signage text-[36px] font-semibold leading-none tabular-nums text-navy">{percent}%</p>
              <p className="text-[13px] font-medium text-meta">{scoreText}</p>
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
                  className={cn('h-2 flex-1 rounded-pill', idx < done ? 'bg-teal' : 'bg-chip')}
                />
              ))}
            </div>
            <p className="mt-3 text-[13px] leading-5 text-meta">
              {t('dashboard.profileMeter.intro', 'Complete profiles are easier to find, and to trust, in the directory.')}
            </p>
          </div>
          <ul className="divide-y divide-rule border-t border-rule">
            {ordered.map((item) => {
              const label = t(`dashboard.profileMeter.items.${item.key}`, METER_LABEL[item.key]);
              if (item.done) {
                return (
                  <li key={item.key} className="flex items-center gap-3 px-5 py-2.5 text-[14px] text-meta">
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-teal" aria-hidden="true" />
                    <span className="flex-1">{label}</span>
                    <span className="sr-only">{t('dashboard.profileMeter.done', 'Done')}</span>
                  </li>
                );
              }
              if (item.inTodo) {
                return (
                  <li key={item.key} className="flex items-center gap-3 px-5 py-2.5 text-[14px] text-ink">
                    <CircleDashed className="h-4 w-4 shrink-0 text-meta/60" aria-hidden="true" />
                    <span className="flex-1">{label}</span>
                    <span className="text-[13px] text-meta">{t('dashboard.profileMeter.inTodo', 'In your to-do list')}</span>
                  </li>
                );
              }
              return (
                <MemberRow
                  key={item.key}
                  to={item.href}
                  icon={item.icon}
                  title={label}
                  hint={METER_HINT[item.key] ? t(`dashboard.profileMeter.hints.${item.key}`, METER_HINT[item.key] as string) : undefined}
                />
              );
            })}
          </ul>
        </>
      )}
    </MemberPanel>
  );
}

/** One group of the "everything you can do here" map. */
function QuickGroupList({ group }: { group: QuickGroup }) {
  const { t } = useTranslation();
  const headingId = `dash-quick-${group.key}`;
  return (
    <MemberPanel title={group.label} titleId={headingId}>
      <ul aria-labelledby={headingId} className="divide-y divide-rule">
        {group.items.map((item) => (
          <MemberRow
            key={item.key}
            to={item.href}
            icon={item.icon}
            title={item.label}
            hint={item.desc}
            aside={item.badge ? (
              <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-pill bg-navy px-1.5 text-[12px] font-semibold leading-none tabular-nums text-white">
                <span aria-hidden="true">{item.badge}</span>
                <span className="sr-only">
                  {t('dashboard.everything.waiting', { count: item.badge, defaultValue_one: '{{count}} waiting', defaultValue_other: '{{count}} waiting' })}
                </span>
              </span>
            ) : undefined}
          />
        ))}
      </ul>
    </MemberPanel>
  );
}
