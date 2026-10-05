import { useEffect, useRef, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Helmet } from 'react-helmet-async';
import type { LucideIcon } from 'lucide-react';
import {
  Inbox, UserPlus, ImageIcon, ImagePlus, PenLine, UserCircle, ChevronRight,
  CheckCircle2, Clock, AlertCircle, CalendarDays, Video, MapPin, Ship,
  MessageSquare, Wrench, BookOpen, ArrowRight, TrendingUp, ShieldCheck,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useEntitlements } from '@/hooks/useEntitlements';
import { supabase } from '@/lib/supabase';
import { CoverImage, LogoBadge } from '@/components/ui/CoverImage';
import { CREATE_ACTIONS, canCreate } from '@/lib/nav';
import { cn } from '@/lib/utils';

/**
 * The page a signed-in member lands on.
 *
 * It replaces the old "Dashboard" tab of /account, which showed three counters
 * (usually zero), a "recommended resources" box that stayed empty forever for
 * any organization without sectors, and "upcoming events" that were never
 * filtered by date. This page answers, in order: is anything blocking me, what
 * is waiting for me, and what is new for someone like me.
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
  date_time: string;
  end_date_time: string | null;
  location: string | null;
  event_type: string | null;
  is_full_day: boolean;
  registered: boolean;
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
};

/* ------------------------------------------------------------------ helpers */

const DEMAND_PERSONAS = ['marina', 'developer'];
const SUPPLY_PERSONAS = ['partner', 'media_partner'];

/** Which side of the market a persona's sectors describe. */
function sectorTableFor(persona: string | undefined): string | null {
  if (persona === 'marina' || persona === 'developer' || persona === 'investor') return 'organization_interest_sectors';
  if (persona === 'partner' || persona === 'media_partner') return 'organization_service_sectors';
  return null;
}

/** Still upcoming = it has not finished yet, so a two-day conference stays on day two. */
function isUpcoming(e: { date_time: string | null; end_date_time: string | null }, now: number): boolean {
  if (!e.date_time) return false;
  return new Date(e.end_date_time ?? e.date_time).getTime() >= now;
}

const RESOURCE_ICON: Record<string, LucideIcon> = {
  replay: Video,
  article: BookOpen,
  guide: BookOpen,
  whitepaper: BookOpen,
  case_study: BookOpen,
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
  const firstLoad = useRef(true);

  const uid = user?.id;
  const orgId = organization?.id;
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

      const [
        connRes, joinRes, sectorRes, rfpRes, consultRes,
        myRfpRes, myConsultRes, myProjRes, myRegsRes, upcomingRes, resRes,
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
        supabase.from('event_registrations')
          .select('event_id, events(id, title, date_time, end_date_time, location, event_type, published, is_full_day)')
          .eq('user_id', uid),
        supabase.from('events')
          .select('id, title, date_time, end_date_time, location, event_type, published, is_full_day')
          .gte('date_time', since).order('date_time', { ascending: true }).limit(6),
        supabase.from('resources')
          .select('id, title, summary, type, thumbnail_url, published_at, resource_sectors(sector_id)')
          .eq('published', true).order('published_at', { ascending: false, nullsFirst: false }).limit(12),
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
      const registered = new Map<string, EventRow>();
      for (const row of (myRegsRes.data ?? []) as unknown as { events: EventRow | null }[]) {
        if (row.events && isUpcoming(row.events, now)) registered.set(row.events.id, row.events);
      }
      const merged: DashEvent[] = [];
      const push = (e: EventRow, isRegistered: boolean) => {
        if (!e.date_time || merged.some((m) => m.id === e.id)) return;
        merged.push({
          id: e.id, title: e.title, date_time: e.date_time, end_date_time: e.end_date_time,
          location: e.location, event_type: e.event_type, is_full_day: !!e.is_full_day,
          registered: isRegistered,
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

      firstLoad.current = false;
      setLoading(false);
    };

    load().catch((err) => {
      if (import.meta.env.DEV) console.error('Dashboard load failed:', err);
      if (alive) setLoading(false);
    });
    return () => { alive = false; };
  }, [uid, orgId, persona, isOwner, isDemand, canSeeOpportunities]);

  // Still in the signup wizard: finishing it is the only thing that matters.
  if (profile?.onboarding_status === 'draft') {
    return <Navigate to="/account?tab=complete-registration" replace />;
  }

  /* -------------------------------------------------------------- derived */

  const lang = i18n.language === 'fr' ? 'fr-FR' : 'en-GB';
  const firstName = profile?.first_name || user?.email?.split('@')[0] || '';
  const orgName = organization?.name ?? '';

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
  // Nudges toward a livelier directory — only the owner can act on them.
  if (organization && isOwner) {
    if (!organization.logo_url) {
      todos.push({
        key: 'logo', urgent: false, icon: ImagePlus, href: '/account?tab=organization',
        title: t('dashboard.todoLogo', { org: orgName }), hint: t('dashboard.todoLogoHint'),
      });
    }
    if (!organization.banner_url) {
      todos.push({
        key: 'banner', urgent: false, icon: ImageIcon, href: '/account?tab=organization',
        title: t('dashboard.todoBanner', { org: orgName }), hint: t('dashboard.todoBannerHint'),
      });
    }
    if (!organization.description?.trim()) {
      todos.push({
        key: 'description', urgent: false, icon: PenLine, href: '/account?tab=organization',
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
  const createActions = CREATE_ACTIONS.filter(
    (a) => a.capability !== 'request_webinar' && canCreate(a.capability, createCtx),
  );

  const nextRegistered = events.find((e) => e.registered) ?? null;
  const otherEvents = events.filter((e) => e !== nextRegistered);
  const resourcesMatched = resources.some((r) => r.matches);

  // Rendered in two places (main column on phones, side column on desktop),
  // so it is built once here.
  const eventsSection = (
    <Section
      title={nextRegistered ? t('dashboard.nextEventTitle') : t('dashboard.upcomingTitle')}
      link={{ to: '/events', label: t('dashboard.seeAllEvents') }}
    >
      {loading ? (
        <div className="p-5"><div className="aspect-video rounded-xl bg-gray-100 animate-pulse" /></div>
      ) : events.length === 0 ? (
        <p className="px-5 py-6 text-sm text-gray-600">{t('dashboard.noEvents')}</p>
      ) : (
        <div className="space-y-4 p-5">
          {(nextRegistered ? [nextRegistered] : []).concat(otherEvents).slice(0, 3).map((e, i) => (
            <EventCard key={e.id} event={e} lang={lang} featured={i === 0} />
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

      {/* ── Header band: the organization's own cover, or its gradient ── */}
      <CoverImage
        src={organization?.banner_url}
        alt=""
        seed={orgId ?? uid ?? 'member'}
        icon={Ship}
        aspect="fill"
        tone="sea"
        scrim
        eager
        className="h-48 sm:h-56"
      >
        <div className="absolute inset-0 flex items-end">
          <div className="container mx-auto px-4 pb-6 flex items-end gap-4">
            {organization && (
              <LogoBadge
                src={organization.logo_url}
                name={organization.name}
                size="lg"
                className="hidden sm:flex ring-4 ring-white/90 shadow-lg"
              />
            )}
            <div className="min-w-0 text-white">
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

        <div className="grid gap-6 lg:grid-cols-3">
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
                      <Link to={todo.href} className="group flex items-center gap-4 px-5 py-3.5 hover:bg-gray-50 transition-colors">
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

            {/* On a phone the side column stacks last; the next event matters
                more than that, so it follows the to-do list there. */}
            <div className="lg:hidden">{eventsSection}</div>

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
                            className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-800 hover:border-primary/40 hover:text-primary transition-colors"
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
                          <Link to={`/account?tab=${tab}`} className="group flex items-center gap-4 px-5 py-3.5 hover:bg-gray-50 transition-colors">
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
                        <Link to="/opportunities" className="group flex items-center gap-4 px-5 py-3.5 hover:bg-gray-50 transition-colors">
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
                    <Link key={r.id} to={`/resources/${r.id}`} className="group block">
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
            <div className="hidden lg:block">{eventsSection}</div>

            {persona === 'investor' && (
              <Link
                to="/investments"
                className="group block rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-100 hover:ring-primary/30 transition"
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
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ pieces */

function Section({
  title,
  link,
  children,
}: {
  title: string;
  link?: { to: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-gray-100">
      <header className="flex items-center justify-between gap-4 border-b border-gray-100 px-5 py-3.5">
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        {link && (
          <Link to={link.to} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline underline-offset-2">
            {link.label}
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        )}
      </header>
      {children}
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

  return (
    <Link to={`/events/${event.id}`} className="group block">
      {featured && (
        <CoverImage
          src={null}
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
            <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-emerald-500 px-2 py-0.5 text-[11px] font-medium text-white">
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
            <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600">
              <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> {t('dashboard.registered')}
            </span>
          )}
        </div>
      </div>
    </Link>
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
