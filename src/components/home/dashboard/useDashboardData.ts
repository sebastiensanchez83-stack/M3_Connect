import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { withSlug } from '@/lib/slugRoutes';
import type { RequestKind } from '@/lib/accountNav';
import { isActiveStatus, statusPagePath, type Participation } from '@/lib/registration';

/**
 * Everything the home dashboard's cards summarise, in one parallel load (the
 * editors behind them load their own data when they open). Moved from the old
 * DashboardPage, with what its "everything" grid could not show: counts and
 * latest items per block.
 *
 * Keyed on ids and flags, never on the auth objects: auth-js hands over a new
 * user object on every tab refocus, and re-running this on each one would blank
 * the cards (the refocus-reload trap). Each query fails on its own into "none".
 */

export interface Opportunity {
  id: string;
  kind: 'rfp' | 'consultation';
  title: string;
  deadline: string | null;
  created_at: string;
  matches: boolean;
}

export interface DashEvent {
  id: string;
  /** The readable address (absent before the slug migration): eventPath(). */
  slug?: string | null;
  title: string;
  description: string | null;
  date_time: string;
  end_date_time: string | null;
  location: string | null;
  event_type: string | null;
  is_full_day: boolean;
  /** Only ever filled for an event I am registered for — the event page's rule. */
  meeting_url: string | null;
  image_url: string | null;
}

export interface DashResource {
  id: string;
  /** The readable address (absent before the slug migration): resourcePath(). */
  slug?: string | null;
  title: string;
  summary: string | null;
  type: string;
  thumbnail_url: string | null;
  matches: boolean;
}

/** The organisation's branding as stored now — the auth context's copy goes stale after an upload. */
export interface OrgBrand {
  id: string;
  logo_url: string | null;
  banner_url: string | null;
  description: string | null;
  gallery: unknown;
}

export interface OrgCounts {
  orgId: string;
  members: number;
  sectors: number;
}

export interface DashboardData {
  loading: boolean;
  opportunities: Opportunity[];
  requestCounts: Record<RequestKind, number>;
  /** My next registered event that has not finished. */
  nextRegistered: DashEvent | null;
  registeredIds: Set<string>;
  upcomingCount: number;
  pastCount: number;
  resources: DashResource[];
  /** The company's page as stored now (every member: anyone in the company edits it). */
  brand: OrgBrand | null;
  orgCounts: OrgCounts | null;
  references: { total: number; confirmed: number; waiting: number } | null;
  shortlistCount: number | null;
  /**
   * Unified registration: upcoming registrations where the M3 team asked a question
   * (status needs_info), and where to answer (the registration's page when there is
   * exactly one linked to the account, else null: My events).
   */
  eventInfo: { count: number; path: string | null };
}

export interface DashboardDataInput {
  uid: string | undefined;
  orgId: string | undefined;
  orgType: string | null;
  persona: string | undefined;
  /** Marinas and developers: they publish; service providers and media answer. */
  isDemand: boolean;
  isSupply: boolean;
  canSeeOpportunities: boolean;
  canProjects: boolean;
  canRFPs: boolean;
  canConsultations: boolean;
  isPartnerOrg: boolean;
  hasShortlist: boolean;
  /** Drafts see no dashboard: nothing is loaded for them. */
  enabled: boolean;
  /** Bumped to load again in place (an editor was closed: its summary may have changed). */
  version: number;
  /**
   * The unified registration is on (registration_flags): "My events" counts every
   * registration of my_participations (requests under review, waiting lists and
   * questions from M3 included), as the events panel lists them.
   */
  unified?: boolean;
}

/** Same default as the event page when an event has no end time. */
export const DEFAULT_DURATION_MS = 60 * 60 * 1000;

/** Which side of the market a persona's sectors describe. */
function sectorTableFor(persona: string | undefined): string | null {
  if (persona === 'marina' || persona === 'developer' || persona === 'investor') return 'organization_interest_sectors';
  if (persona === 'partner' || persona === 'media_partner') return 'organization_service_sectors';
  return null;
}

/** Still upcoming = it has not finished yet, so a two-day conference stays on day two. */
export function isUpcoming(e: { date_time: string | null; end_date_time: string | null }, now: number): boolean {
  if (!e.date_time) return false;
  const end = e.end_date_time ? new Date(e.end_date_time).getTime() : new Date(e.date_time).getTime() + DEFAULT_DURATION_MS;
  return end >= now;
}

type Res<T> = { data: T | null; count: number | null };
const NONE: Res<never> = { data: null, count: 0 };

/** A query that can only resolve: an error or a thrown RPC becomes "nothing". */
function safe<T>(query: PromiseLike<{ data: unknown; count?: number | null; error?: unknown }> | null): Promise<Res<T>> {
  if (!query) return Promise.resolve(NONE as Res<T>);
  return Promise.resolve(query).then(
    (r) => (r.error ? (NONE as Res<T>) : { data: r.data as T | null, count: r.count ?? null }),
    () => NONE as Res<T>,
  );
}

const EMPTY_COUNTS: Record<RequestKind, number> = { projects: 0, rfps: 0, consultations: 0, webinars: 0 };

export function useDashboardData(input: DashboardDataInput): DashboardData {
  const {
    uid, orgId, orgType, persona, isDemand, isSupply, canSeeOpportunities,
    canProjects, canRFPs, canConsultations, isPartnerOrg, hasShortlist, enabled, version,
  } = input;
  const unified = input.unified === true;
  const [data, setData] = useState<Omit<DashboardData, 'loading'>>({
    opportunities: [],
    requestCounts: EMPTY_COUNTS,
    nextRegistered: null,
    registeredIds: new Set(),
    upcomingCount: 0,
    pastCount: 0,
    resources: [],
    brand: null,
    orgCounts: null,
    references: null,
    shortlistCount: null,
    eventInfo: { count: 0, path: null },
  });
  const [loading, setLoading] = useState(true);
  const firstLoad = useRef(true);

  useEffect(() => {
    if (!uid || !enabled) return;
    let alive = true;

    const load = async () => {
      // Only the first load shows skeletons; later ones (a company switch) swap in place.
      if (firstLoad.current) setLoading(true);
      const now = Date.now();
      const sectorTable = sectorTableFor(persona);
      // The company's page (logo, cover, description, sectors, team): its tile
      // says what is missing, for every member. Its sectors are the ones the
      // organisation editor writes — interests for a marina, services otherwise.
      const meterOn = !!orgId;
      const orgSectorTable = orgType === 'marina' ? 'organization_interest_sectors' : 'organization_service_sectors';

      const [
        sectorRes, rfpRes, consultRes, myRfpRes, myConsultRes, myProjRes, myWebinarRes, accessRes, resRes,
        orgRes, memberCountRes, orgSectorCountRes, refRes, shortlistRes, partsRes,
      ] = await Promise.all([
        safe<{ sector_id: string }[]>(sectorTable && orgId ? supabase.from(sectorTable).select('sector_id').eq('organization_id', orgId) : null),
        safe<{ id: string; title: string; deadline_date: string | null; created_at: string; sector_id: string | null }[]>(isSupply && canSeeOpportunities
          ? supabase.from('rfps').select('id, title, deadline_date, created_at, sector_id').eq('status', 'approved').eq('is_open', true).order('created_at', { ascending: false }).limit(8)
          : null),
        safe<{ id: string; title: string; created_at: string; sector_id: string | null }[]>(isSupply && canSeeOpportunities
          ? supabase.from('consultations').select('id, title, created_at, sector_id').eq('status', 'approved').eq('is_open', true).order('created_at', { ascending: false }).limit(8)
          : null),
        safe<{ id: string; title: string; status: string; created_at: string }[]>(canRFPs
          ? supabase.from('rfps').select('id, title, status, created_at').eq('marina_user_id', uid).order('created_at', { ascending: false }).limit(50)
          : null),
        safe<{ id: string; title: string; status: string; created_at: string }[]>(canConsultations
          ? supabase.from('consultations').select('id, title, status, created_at').eq('marina_user_id', uid).order('created_at', { ascending: false }).limit(50)
          : null),
        safe<{ id: string; project_type: string; status: string; created_at: string }[]>(canProjects
          ? supabase.from('marina_projects').select('id, project_type, status, created_at').eq('user_id', uid).order('created_at', { ascending: false }).limit(50)
          : null),
        safe<{ id: string; title: string; status: string; created_at: string }[]>(
          supabase.from('webinar_requests').select('id, title, status, created_at').eq('user_id', uid).order('created_at', { ascending: false }).limit(50),
        ),
        // My registrations, including any made as a guest with my (confirmed)
        // e-mail before I had an account; for webinars, the join link (never
        // read from the events table: registrants and staff only).
        safe<{ event_id: string; is_registered: boolean; meeting_url: string | null }[]>(supabase.rpc('get_my_event_access', { p_event_ids: null })),
        // Slugs when the database has them (withSlug: id links before the slug migration).
        safe<(Omit<DashResource, 'matches'> & { resource_sectors?: { sector_id: string }[] })[]>(withSlug('resources', (slug) => supabase.from('resources')
          .select(`id, title, summary, type, thumbnail_url, published_at${slug}, resource_sectors(sector_id)`)
          .eq('published', true).order('published_at', { ascending: false, nullsFirst: false })
          .order('created_at', { ascending: false }).limit(12))),
        safe<OrgBrand>(meterOn ? supabase.from('organizations').select('id, logo_url, banner_url, description, gallery').eq('id', orgId).maybeSingle() : null),
        safe<unknown>(meterOn ? supabase.from('organization_members').select('id', { count: 'exact', head: true }).eq('organization_id', orgId) : null),
        safe<unknown>(meterOn ? supabase.from(orgSectorTable).select('sector_id', { count: 'exact', head: true }).eq('organization_id', orgId) : null),
        safe<{ status: string }[]>(isPartnerOrg && orgId ? supabase.from('reference_requests').select('status').eq('partner_organization_id', orgId) : null),
        safe<unknown>(hasShortlist ? supabase.from('org_bookmarks').select('id', { count: 'exact', head: true }).eq('user_id', uid) : null),
        safe<Participation[]>(unified ? supabase.rpc('my_participations') : null),
      ]);
      if (!alive) return;

      const mySectors = new Set((sectorRes.data ?? []).map((s) => s.sector_id));

      // Opportunities — sector matches first, then newest.
      const opportunities: Opportunity[] = [
        ...(rfpRes.data ?? []).map((r) => ({
          id: r.id, kind: 'rfp' as const, title: r.title, deadline: r.deadline_date ?? null,
          created_at: r.created_at, matches: !!r.sector_id && mySectors.has(r.sector_id),
        })),
        ...(consultRes.data ?? []).map((c) => ({
          id: c.id, kind: 'consultation' as const, title: c.title, deadline: null,
          created_at: c.created_at, matches: !!c.sector_id && mySectors.has(c.sector_id),
        })),
      ].sort((a, b) => Number(b.matches) - Number(a.matches) || b.created_at.localeCompare(a.created_at)).slice(0, 4);

      // My requests: how many of each kind (the panel lists them).
      const requestCounts: Record<RequestKind, number> = {
        projects: myProjRes.data?.length ?? 0,
        rfps: myRfpRes.data?.length ?? 0,
        consultations: myConsultRes.data?.length ?? 0,
        webinars: myWebinarRes.data?.length ?? 0,
      };

      // My events: every registration, then the next one that has not finished.
      const joinLinks = new Map((accessRes.data ?? []).filter((a) => a.is_registered).map((a) => [a.event_id, a.meeting_url] as const));
      type EventRow = Omit<DashEvent, 'meeting_url' | 'is_full_day' | 'date_time'> & { date_time: string | null; is_full_day: boolean | null; published: boolean | null };
      const myEventRows = joinLinks.size > 0
        ? (await safe<EventRow[]>(withSlug('events', (slug) => supabase.from('events')
          .select(`id, title, description, date_time, end_date_time, location, event_type, published, is_full_day, image_url${slug}`)
          .in('id', [...joinLinks.keys()])))).data ?? []
        : [];
      if (!alive) return;
      let upcomingCount = 0;
      let pastCount = 0;
      const upcomingRegistered: DashEvent[] = [];
      for (const e of myEventRows) {
        if (!e.date_time) { upcomingCount += 1; continue; }
        if (isUpcoming(e, now)) {
          upcomingCount += 1;
          upcomingRegistered.push({
            id: e.id, slug: e.slug ?? null, title: e.title, description: e.description ?? null, date_time: e.date_time,
            end_date_time: e.end_date_time, location: e.location, event_type: e.event_type,
            is_full_day: !!e.is_full_day, meeting_url: joinLinks.get(e.id) ?? null, image_url: e.image_url ?? null,
          });
        } else {
          pastCount += 1;
        }
      }
      upcomingRegistered.sort((a, b) => a.date_time.localeCompare(b.date_time));

      // Unified registration: the counts of the events panel (every engine; Smart Marina 2026
      // has its own line on the tile). Unreadable, the counts above stay.
      let eventInfo: DashboardData['eventInfo'] = { count: 0, path: null };
      if (unified && Array.isArray(partsRes.data)) {
        const held = partsRes.data.filter((p) => p.engine !== 'sm26' && isActiveStatus(p.status));
        upcomingCount = held.filter((p) => !p.is_past).length;
        pastCount = held.filter((p) => p.is_past).length;
        const asked = held.filter((p) => !p.is_past && p.status_display === 'needs_info');
        const only = asked.length === 1 && asked[0].engine === 'core_v2' && asked[0].linked ? asked[0] : null;
        eventInfo = { count: asked.length, path: only ? statusPagePath(only.registration_id) : null };
      }

      // Resources — sector matches first; without sectors, simply the newest (stable sort).
      const resources = (resRes.data ?? []).map((r) => ({
        id: r.id, slug: r.slug ?? null, title: r.title, summary: r.summary, type: r.type, thumbnail_url: r.thumbnail_url,
        matches: (r.resource_sectors ?? []).some((s) => mySectors.has(s.sector_id)),
      }));
      resources.sort((a, b) => Number(b.matches) - Number(a.matches));

      const refs = refRes.data;
      setData({
        opportunities,
        requestCounts,
        nextRegistered: upcomingRegistered[0] ?? null,
        registeredIds: new Set(joinLinks.keys()),
        upcomingCount,
        pastCount,
        resources: resources.slice(0, 4),
        brand: meterOn ? orgRes.data ?? null : null,
        orgCounts: meterOn && orgId ? { orgId, members: memberCountRes.count ?? 0, sectors: orgSectorCountRes.count ?? 0 } : null,
        references: refs ? {
          total: refs.length,
          confirmed: refs.filter((r) => r.status === 'confirmed').length,
          waiting: refs.filter((r) => r.status === 'pending' || r.status === 'sent').length,
        } : null,
        shortlistCount: hasShortlist ? shortlistRes.count ?? 0 : null,
        eventInfo,
      });
      firstLoad.current = false;
      setLoading(false);
    };

    load().catch((err) => {
      if (import.meta.env.DEV) console.error('Dashboard load failed:', err);
      if (alive) setLoading(false);
    });
    return () => { alive = false; };
  }, [uid, orgId, orgType, persona, isDemand, isSupply, canSeeOpportunities, canProjects, canRFPs, canConsultations, isPartnerOrg, hasShortlist, enabled, version, unified]);

  return { ...data, loading: enabled ? loading : false };
}
