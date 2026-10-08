import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { LucideIcon } from 'lucide-react';
import {
  AlertCircle, Award, BookOpen, Briefcase, Building2, CalendarDays, Check, CheckCircle2, ClipboardList, Clock,
  ImageIcon, ImagePlus, Inbox, Link2, MessageSquare, PenLine, Plus, Ship, ShieldCheck, TrendingUp, UserCircle,
  UserPlus, Video, XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CoverImage, LogoBadge } from '@/components/ui/CoverImage';
import { CardMedia, CardShell, StretchedLink } from '@/components/brand/CardShell';
import { Eyebrow } from '@/components/brand/Eyebrow';
import { UnderlineLink } from '@/components/brand/UnderlineLink';
import { RENDEZVOUS_2026_PATH } from '@/components/brand/m3Events';
import {
  BlockSkeleton, MemberBanner, MemberEmpty, MemberPanel, MemberRow, RowSkeleton, StatusPill, type PillTone,
} from '@/components/member/MemberUI';
import { useAuth } from '@/contexts/AuthContext';
import { useEntitlements } from '@/hooks/useEntitlements';
import { useInboxCount } from '@/hooks/useInboxCount';
import { useMemberAccess } from '@/hooks/useMemberAccess';
import { lazyWithRetry } from '@/lib/lazyWithRetry';
import { CREATE_ACTIONS, canCreate } from '@/lib/nav';
import {
  HOME_GROUPS, HOME_SECTIONS, accountHref, getHomeSection, homeSectionVisible, isHomePanel,
  type HomeGroupKey, type HomePanel, type RequestKind,
} from '@/lib/accountNav';
import { scrollTopUnderBars } from '@/lib/scrollTarget';
import { cn } from '@/lib/utils';
import { CardLink, CountBadge, DashCard, DashGroup, MiniRow, PanelRegion, PanelToggle } from './dashboard/DashboardKit';
import { ComingUpList, NextEventCard } from './dashboard/EventBlocks';
import { useDashboardData } from './dashboard/useDashboardData';

/**
 * The signed-in member's dashboard, right under "Welcome back" on the home
 * page. It answers, in order: is anything blocking me (the account alerts),
 * what is waiting for me (to-do, my next event), then everything this member
 * can manage, in four groups — profile & company, registrations & events,
 * requests & messages, things for me — one card per block, only the blocks
 * that apply to them.
 *
 * Edit in place: a card's Edit / Manage / Open button opens the REAL editor
 * (the old account tabs, now src/components/account/*) full width under its
 * group's cards. One at a time; the open block is in the address
 * (/?open=<block>[&section=…], replaced, never pushed), so it can be linked and
 * survives a reload. The old /dashboard and /account?tab=… addresses land here.
 *
 * Drafts (sign-up not finished) only get the way back to their registration:
 * every block would send them there anyway.
 *
 * Nothing here is wrapped in a reveal: the dashboard shows at once.
 */

// The editors load when a block opens: none of them weighs on the home page.
const ProfileEditor = lazyWithRetry(() => import('@/components/account/ProfileEditor').then((m) => ({ default: m.ProfileEditor })));
const OrganizationWorkspace = lazyWithRetry(() => import('@/components/account/OrganizationWorkspace').then((m) => ({ default: m.OrganizationWorkspace })));
const MyEvents = lazyWithRetry(() => import('@/components/account/MyEvents').then((m) => ({ default: m.MyEvents })));
const MyRequests = lazyWithRetry(() => import('@/components/account/MyRequests').then((m) => ({ default: m.MyRequests })));
const PressRoom = lazyWithRetry(() => import('@/components/account/PressRoom').then((m) => ({ default: m.PressRoom })));
const NotificationPreferencesTab = lazyWithRetry(() => import('@/components/notifications/NotificationPreferencesTab').then((m) => ({ default: m.NotificationPreferencesTab })));
const InboxTab = lazyWithRetry(() => import('@/components/inbox/InboxTab').then((m) => ({ default: m.InboxTab })));
const ShortlistTab = lazyWithRetry(() => import('@/components/shortlist/ShortlistTab').then((m) => ({ default: m.ShortlistTab })));
const ReferenceRequestForm = lazyWithRetry(() => import('@/components/references/ReferenceRequestForm').then((m) => ({ default: m.ReferenceRequestForm })));
const SponsorPortal = lazyWithRetry(() => import('@/components/sponsorship/SponsorPortal').then((m) => ({ default: m.SponsorPortal })));

const DEMAND_PERSONAS = ['marina', 'developer'];
const SUPPLY_PERSONAS = ['partner', 'media_partner'];

const RESOURCE_ICON: Record<string, LucideIcon> = { replay: Video, article: BookOpen, guide: BookOpen, whitepaper: BookOpen, case_study: BookOpen };

const REQUEST_ICON: Record<RequestKind, LucideIcon> = { projects: Ship, rfps: ClipboardList, consultations: MessageSquare, webinars: Video };

type OrgSection = 'branding' | 'gallery' | 'details' | 'team';

interface Todo {
  key: string;
  title: string;
  hint: string;
  icon: LucideIcon;
  urgent: boolean;
  open: () => void;
}

export default function MemberDashboard() {
  const { t, i18n } = useTranslation();
  const { user, profile, organization, organizations, setActiveOrganization, orgRole, isVerified } = useAuth();
  const { isFeatureEnabled } = useEntitlements();
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();

  const isDraft = profile?.onboarding_status === 'draft';
  const active = !!user && !!profile && !isDraft;
  const access = useMemberAccess(active);
  const inbox = useInboxCount(active);

  const uid = user?.id;
  const orgId = organization?.id;
  const orgType = organization?.organization_type ?? null;
  const persona = profile?.persona as string | undefined;
  const orgVerified = organization?.access_status === 'verified';
  const isOwner = orgRole === 'owner';
  const isDemand = DEMAND_PERSONAS.includes(persona ?? '');
  const isSupply = SUPPLY_PERSONAS.includes(persona ?? '');
  const isInvestor = persona === 'investor';
  const canSeeOpportunities = isVerified && orgVerified;
  const canProjects = isDemand || isFeatureEnabled('submit_project');
  const canRFPs = isDemand || isFeatureEnabled('submit_rfp');
  const canConsultations = isDemand || isFeatureEnabled('submit_consultation');

  const sectionCtx = useMemo(() => ({
    persona,
    orgType,
    access: access ? { media: access.media, sponsor: access.sponsorIds.length > 0, manager: access.manager } : null,
  }), [persona, orgType, access]);
  const visible = (key: HomePanel) => homeSectionVisible(key, sectionCtx);

  // A version bump reloads the cards' summaries (after an editor closes).
  const [version, setVersion] = useState(0);
  const data = useDashboardData({
    uid, orgId, orgType, persona, isOwner, isDemand, isSupply, canSeeOpportunities,
    canProjects, canRFPs, canConsultations,
    isPartnerOrg: orgType === 'partner',
    hasShortlist: visible('shortlist'),
    enabled: active,
    version,
  });

  /* ---------------------------------------------------------- the open block */

  const rawOpen = searchParams.get('open');
  const requested = isHomePanel(rawOpen) ? rawOpen : null;
  // Sponsorship and the press room depend on the server's answer: wait for it before judging.
  const accessPending = access === null && (requested === 'sponsorship' || requested === 'press');
  const openPanel: HomePanel | null = requested && !accessPending && homeSectionVisible(requested, sectionCtx) ? requested : null;

  const setPanel = useCallback((key: HomePanel | null, section?: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('open');
      next.delete('section');
      if (key) {
        next.set('open', key);
        if (section) next.set('section', section);
      }
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // An unknown block, or one that does not apply to this member: the plain home page.
  useEffect(() => {
    if (!active || !rawOpen || accessPending) return;
    if (!requested || !homeSectionVisible(requested, sectionCtx)) setPanel(null);
  }, [active, rawOpen, requested, accessPending, sectionCtx, setPanel]);

  const toggleRefs = useRef<Partial<Record<HomePanel, HTMLButtonElement | null>>>({});
  const closePanel = useCallback((key: HomePanel) => {
    setPanel(null);
    if (key === 'inbox') inbox.refresh();
    setVersion((v) => v + 1);
    // Back to the card that opened it.
    requestAnimationFrame(() => toggleRefs.current[key]?.focus());
  }, [setPanel, inbox]);
  const togglePanel = (key: HomePanel, section?: string) => {
    if (openPanel === key && !section) closePanel(key);
    else setPanel(key, section);
  };

  // /#dashboard (the avatar menu's "My dashboard"): the top of the dashboard, under the header.
  useEffect(() => {
    if (location.hash !== '#dashboard') return;
    const el = document.getElementById('dashboard');
    if (el) window.scrollTo({ top: scrollTopUnderBars(el, 0, 0) });
  }, [location.key, location.hash]);

  /* ---------------------------------------------------------- not yet */

  if (!user || !profile) return null;

  const lang = i18n.language === 'fr' ? 'fr-FR' : 'en-GB';
  const orgName = organization?.name ?? '';

  if (isDraft) {
    return (
      <section id="dashboard" aria-labelledby="dashboard-title" className="bg-page">
        <div className="mx-auto max-w-7xl px-4 pb-10 pt-8 sm:px-6 md:pt-10">
          <h2 id="dashboard-title" className="sr-only">{t('memberHome.title', 'Your dashboard')}</h2>
          <MemberBanner
            tone="info"
            icon={ClipboardList}
            className="mb-0"
            title={t('memberHome.alerts.draftTitle', 'Finish your registration')}
            body={t('memberHome.alerts.draftBody', 'Tell us about your organisation: the M3 team reviews it, then the whole platform opens to you.')}
            action={(
              <Button asChild variant="cta" size="sm">
                <Link to={accountHref('complete-registration')}>{t('memberHome.alerts.draftCta', 'Finish my registration')}</Link>
              </Button>
            )}
          />
        </div>
      </section>
    );
  }

  /* ---------------------------------------------------------- derived */

  const label = (key: HomePanel) => {
    const s = getHomeSection(key);
    return s ? t(s.labelKey, s.fallback) : key;
  };
  const descOf = (key: HomePanel) => {
    const s = getHomeSection(key);
    return s ? t(s.descKey, s.descFallback) : '';
  };
  const groupLabel = (key: HomeGroupKey) => {
    const g = HOME_GROUPS.find((x) => x.key === key);
    return g ? t(g.labelKey, g.fallback) : '';
  };

  // Branding as stored now when we have it, else the auth context's copy.
  const brandSrc = data.brand && data.brand.id === orgId ? data.brand : organization;
  const brand = {
    logo: !!brandSrc?.logo_url,
    banner: !!brandSrc?.banner_url,
    description: !!brandSrc?.description?.trim(),
    gallery: Array.isArray(brandSrc?.gallery) && (brandSrc?.gallery as unknown[]).length > 0,
  };
  const openOrg = (section?: OrgSection) => setPanel('organization', section);

  // To do: answers someone is waiting for, then nudges only the owner can act on.
  const todos: Todo[] = [];
  if (inbox.connections > 0) {
    todos.push({
      key: 'connections', urgent: true, icon: Inbox, open: () => setPanel('inbox'),
      title: t('dashboard.todoConnections', { count: inbox.connections }), hint: t('dashboard.todoConnectionsHint'),
    });
  }
  if (inbox.joins > 0) {
    todos.push({
      key: 'join', urgent: true, icon: UserPlus, open: () => setPanel('inbox'),
      title: t('dashboard.todoJoin', { count: inbox.joins, org: orgName }), hint: t('dashboard.todoJoinHint'),
    });
  }
  if (organization && isOwner && !data.loading) {
    if (!brand.logo) todos.push({ key: 'logo', urgent: false, icon: ImagePlus, open: () => openOrg('branding'), title: t('dashboard.todoLogo', { org: orgName }), hint: t('dashboard.todoLogoHint') });
    if (!brand.banner) todos.push({ key: 'banner', urgent: false, icon: ImageIcon, open: () => openOrg('branding'), title: t('dashboard.todoBanner', { org: orgName }), hint: t('dashboard.todoBannerHint') });
    if (!brand.description) todos.push({ key: 'description', urgent: false, icon: PenLine, open: () => openOrg('details'), title: t('dashboard.todoDescription', { org: orgName }), hint: t('dashboard.todoDescriptionHint') });
  }
  if (!profile.avatar_url || !profile.job_title) {
    todos.push({ key: 'profile', urgent: false, icon: UserCircle, open: () => setPanel('profile'), title: t('dashboard.todoProfile'), hint: t('dashboard.todoProfileHint') });
  }

  // The organisation profile meter (the owner's): logo, cover, description, sectors, a colleague, pictures.
  const counts = data.orgCounts && data.orgCounts.orgId === orgId ? data.orgCounts : null;
  const isMarinaOrgType = orgType === 'marina' || orgType === 'developer';
  const maxSeats = organization?.max_seats ?? 0;
  // Inviting is blocked when a non-marina organisation has used its seats: a one-seat plan isn't asked for a colleague.
  const teamPossible = (counts?.members ?? 0) >= 2 || isMarinaOrgType || !maxSeats || maxSeats > 1;
  const meter = [brand.logo, brand.banner, brand.description, (counts?.sectors ?? 0) > 0, ...(teamPossible ? [(counts?.members ?? 0) >= 2] : []), brand.gallery];
  const meterDone = meter.filter(Boolean).length;
  const showMeter = !!organization && isOwner && !data.loading && !!counts;

  const createCtx = { isVerified, orgVerified, persona, isFeatureEnabled };
  const createActions = CREATE_ACTIONS.filter((a) => canCreate(a.capability, createCtx));
  const requestKinds: RequestKind[] = [
    ...(canProjects ? ['projects' as const] : []),
    ...(canRFPs ? ['rfps' as const] : []),
    ...(canConsultations ? ['consultations' as const] : []),
    'webinars',
  ];
  const kindLabel = (kind: RequestKind, count: number) => {
    switch (kind) {
      case 'projects': return t('memberHome.requests.projects', { count, defaultValue_one: '{{count}} project', defaultValue_other: '{{count}} projects' });
      case 'rfps': return t('memberHome.requests.rfps', { count, defaultValue_one: '{{count}} RFP', defaultValue_other: '{{count}} RFPs' });
      case 'consultations': return t('memberHome.requests.consultations', { count, defaultValue_one: '{{count}} consultation', defaultValue_other: '{{count}} consultations' });
      default: return t('memberHome.requests.webinars', { count, defaultValue_one: '{{count}} webinar proposal', defaultValue_other: '{{count}} webinar proposals' });
    }
  };
  const kindName = (kind: RequestKind) => (
    kind === 'projects' ? t('dashboard.project') : kind === 'rfps' ? t('dashboard.rfp') : kind === 'consultations' ? t('dashboard.consultation') : t('memberHome.requests.webinar', 'Webinar proposal')
  );

  const notifOff = Object.values((profile.notification_prefs ?? {}) as Record<string, unknown>).filter((v) => v === false).length;
  const sponsorIds = access?.sponsorIds ?? [];
  const isSponsor = sponsorIds.length > 0;
  const isManager = access?.manager === true;
  const layoutReady = !data.loading;
  const displayName = `${profile.first_name || ''} ${profile.last_name || ''}`.trim() || user.email?.split('@')[0] || '';
  const initials = `${(profile.first_name?.[0] || '').toUpperCase()}${(profile.last_name?.[0] || '').toUpperCase()}` || (user.email?.[0] || '?').toUpperCase();

  /** A card's open / close button, remembered so closing the editor gives the focus back to it. */
  const toggle = (key: HomePanel, labelText: string) => (
    <PanelToggle
      ref={(el) => { toggleRefs.current[key] = el; }}
      panelKey={key}
      open={openPanel === key}
      label={labelText}
      context={label(key)}
      onToggle={() => togglePanel(key)}
    />
  );

  /** The editor of the open block, if it belongs to this group. */
  const panelFor = (group: HomeGroupKey): ReactNode => {
    if (!openPanel) return null;
    const section = HOME_SECTIONS.find((s) => s.key === openPanel);
    if (!section || section.group !== group) return null;
    return (
      <PanelRegion
        key={openPanel}
        panelKey={openPanel}
        eyebrow={groupLabel(group)}
        title={label(openPanel)}
        desc={descOf(openPanel)}
        actions={panelActions(openPanel)}
        layoutReady={layoutReady}
        onClose={() => closePanel(openPanel)}
      >
        <Suspense fallback={<div className="rounded-card border border-rule bg-white"><RowSkeleton rows={3} /></div>}>
          {panelBody(openPanel)}
        </Suspense>
      </PanelRegion>
    );
  };

  const panelActions = (key: HomePanel): ReactNode => {
    if (key === 'organization' && organization?.slug) {
      return <CardLink to={`/organizations/${organization.slug}`}>{t('memberHome.org.viewPage', 'View my company page')}</CardLink>;
    }
    if (key === 'registrations') return <CardLink to="/events">{t('accountArea.events.browse', 'Browse events')}</CardLink>;
    if (key === 'sponsorship' && isManager) return <CardLink to="/sponsorship">{t('dashboard.everything.sponsorshipHub', 'Sponsorship hub')}</CardLink>;
    return null;
  };

  const panelBody = (key: HomePanel): ReactNode => {
    switch (key) {
      case 'profile': return <ProfileEditor onOpenOrganization={() => setPanel('organization')} />;
      case 'notifications': return <NotificationPreferencesTab />;
      case 'organization': return <OrganizationWorkspace />;
      case 'registrations': return <MyEvents />;
      case 'inbox': return <InboxTab />;
      case 'requests': return <MyRequests />;
      case 'references': return <ReferenceRequestForm onReferenceSubmitted={() => setVersion((v) => v + 1)} />;
      case 'press': return <PressRoom />;
      case 'shortlist': return <ShortlistTab />;
      case 'sponsorship':
        return isSponsor ? <SponsorPortal sponsorIds={sponsorIds} /> : (
          <MemberPanel>
            <MemberEmpty
              icon={Award}
              title={t('memberHome.sponsorship.hubTitle', 'The sponsorship hub')}
              body={t('dashboard.everything.sponsorshipHubDesc', 'Agreements and fulfilment for every sponsor')}
              action={(
                <Button asChild variant="ctaNavy" size="sm">
                  <Link to="/sponsorship">{t('memberHome.sponsorship.openHub', 'Open the hub')}</Link>
                </Button>
              )}
            />
          </MemberPanel>
        );
      default: return null;
    }
  };

  /* ---------------------------------------------------------- the groups' cards */

  const companyCards: ReactNode[] = [
    <DashCard
      key="profile"
      icon={UserCircle}
      title={label('profile')}
      titleId="dash-card-profile"
      desc={descOf('profile')}
      active={openPanel === 'profile'}
      footer={toggle('profile', t('memberHome.edit', 'Edit'))}
    >
      <div className="flex items-center gap-3">
        {profile.avatar_url ? (
          <img src={profile.avatar_url} alt="" className="h-12 w-12 shrink-0 rounded-full object-cover ring-1 ring-rule" />
        ) : (
          <span aria-hidden="true" className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-navy text-[15px] font-semibold text-white">{initials}</span>
        )}
        <div className="min-w-0">
          <p className="truncate font-semibold text-navy">{displayName}</p>
          <p className="truncate text-[13px] text-meta">{profile.job_title || t('memberHome.profile.noJobTitle', 'No job title yet')}</p>
        </div>
      </div>
    </DashCard>,
    <DashCard
      key="notifications"
      icon={getHomeSection('notifications')?.icon ?? UserCircle}
      title={label('notifications')}
      titleId="dash-card-notifications"
      desc={descOf('notifications')}
      active={openPanel === 'notifications'}
      footer={toggle('notifications', t('memberHome.manage', 'Manage'))}
    >
      <p className="text-meta">
        {notifOff === 0
          ? t('memberHome.notifications.allOn', 'Every kind of email is on.')
          : t('memberHome.notifications.someOff', { count: notifOff, defaultValue_one: '{{count}} kind of email is turned off.', defaultValue_other: '{{count}} kinds of email are turned off.' })}
      </p>
    </DashCard>,
    <DashCard
      key="organization"
      icon={Building2}
      title={label('organization')}
      titleId="dash-card-organization"
      desc={descOf('organization')}
      active={openPanel === 'organization'}
      footer={(
        <>
          {toggle('organization', organization ? t('memberHome.manage', 'Manage') : t('memberHome.org.add', 'Add my organisation'))}
          {organization?.slug && <CardLink to={`/organizations/${organization.slug}`}>{t('memberHome.org.viewPage', 'View my company page')}</CardLink>}
        </>
      )}
    >
      {organization ? (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <LogoBadge src={brandSrc?.logo_url} name={organization.name} size="md" />
            <div className="min-w-0">
              <p className="truncate font-semibold text-navy">{organization.name}</p>
              {orgVerified
                ? <StatusPill tone="success" icon={ShieldCheck}>{t('dashboard.verified')}</StatusPill>
                : <StatusPill tone="warning" icon={Clock}>{t('dashboard.underReview')}</StatusPill>}
            </div>
          </div>
          {showMeter && (
            <div>
              <div className="flex items-baseline justify-between gap-3 text-[13px]">
                <span className="font-medium text-meta">{t('dashboard.profileMeter.title', 'Organisation profile')}</span>
                <span className="font-semibold tabular-nums text-navy">
                  {t('dashboard.profileMeter.score', { done: meterDone, total: meter.length, defaultValue: '{{done}} of {{total}} done' })}
                </span>
              </div>
              <div className="mt-1.5 flex gap-1" aria-hidden="true">
                {meter.map((done, i) => <span key={i} className={cn('h-1.5 flex-1 rounded-pill', i < meterDone ? 'bg-teal' : 'bg-chip')} />)}
              </div>
            </div>
          )}
          <ul className="flex flex-wrap gap-1.5" aria-label={t('accountArea.org.subnavLabel', 'Organisation sections')}>
            {([
              ['branding', t('accountArea.org.branding', 'Logo & cover')],
              ['details', t('accountArea.org.details', 'Company details')],
              ['team', t('accountArea.org.team', 'Team & invitations')],
              ['gallery', t('accountArea.org.gallery', 'Product images')],
            ] as [OrgSection, string][]).map(([key, text]) => (
              <li key={key}>
                <button
                  type="button"
                  onClick={() => openOrg(key)}
                  className="inline-flex min-h-9 items-center rounded-pill bg-chip px-3 text-[13px] font-medium text-navy transition-colors hover:bg-rule focus:outline-none focus-visible:shadow-focus"
                >
                  {text}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-meta">{t('memberHome.org.none', 'You are not attached to an organisation yet. Add yours to unlock the whole platform.')}</p>
      )}
    </DashCard>,
  ];
  if (organizations.length > 1) {
    companyCards.push(
      <DashCard key="switch" icon={Building2} title={t('memberHome.switch.title', 'Switch company')} titleId="dash-card-switch" desc={t('memberHome.switch.desc', 'You belong to several organisations: choose the one you act for.')}>
        <ul className="space-y-1" aria-label={t('memberHome.switch.title', 'Switch company')}>
          {organizations.map((m) => {
            const current = organization?.id === m.organization.id;
            return (
              <li key={m.organization.id}>
                <button
                  type="button"
                  aria-pressed={current}
                  onClick={() => { if (!current) setActiveOrganization(m.organization.id); }}
                  className={cn('flex min-h-11 w-full items-center gap-3 rounded-field px-2 text-left transition-colors focus:outline-none focus-visible:shadow-focus', current ? 'bg-chip' : 'hover:bg-page')}
                >
                  <LogoBadge src={m.organization.logo_url} name={m.organization.name} size="sm" />
                  <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-navy">{m.organization.name}</span>
                  {current && <Check className="h-4 w-4 shrink-0 text-teal" aria-hidden="true" />}
                </button>
              </li>
            );
          })}
        </ul>
      </DashCard>,
    );
  }

  const nextReg = data.nextRegistered;
  const eventCards: ReactNode[] = [
    <DashCard
      key="registrations"
      icon={CalendarDays}
      title={label('registrations')}
      titleId="dash-card-registrations"
      desc={descOf('registrations')}
      active={openPanel === 'registrations'}
      footer={toggle('registrations', t('memberHome.manage', 'Manage'))}
    >
      {data.loading ? <BlockSkeleton className="h-12" /> : (
        <div className="space-y-3">
          <p className="text-meta">
            {data.upcomingCount + data.pastCount === 0
              ? t('memberHome.events.none', 'No event registration yet.')
              : t('memberHome.events.counts', { upcoming: data.upcomingCount, past: data.pastCount, defaultValue: '{{upcoming}} upcoming · {{past}} past' })}
          </p>
          {nextReg && (
            <p className="text-[14px]">
              <span className="text-meta">{t('memberHome.events.next', 'Next:')} </span>
              <Link to={`/events/${nextReg.id}`} className="font-semibold text-navy underline-offset-4 hover:underline">{nextReg.title}</Link>
            </p>
          )}
          {/* Smart Marina 2026 is over: its participants get a mark, nothing to manage. */}
          {access?.sm26 && (
            <div className="flex items-start gap-2.5 rounded-field bg-foam p-3 text-[14px] leading-5 text-navy">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-teal" aria-hidden="true" />
              <p>
                {t('memberHome.events.sm26', 'You took part in the Monaco Smart & Sustainable Marina Rendezvous 2026.')}{' '}
                <Link to={RENDEZVOUS_2026_PATH} className="font-semibold underline underline-offset-2 hover:text-teal-text">
                  {t('memberHome.events.sm26Link', 'Event page')}
                </Link>
              </p>
            </div>
          )}
        </div>
      )}
    </DashCard>,
    <DashCard
      key="coming-up"
      icon={Clock}
      title={t('dashboard.upcomingTitle')}
      titleId="dash-card-coming-up"
      desc={t('memberHome.events.comingUpDesc', 'M3 events and webinars ahead')}
      className="xl:col-span-2"
      footer={<CardLink to="/events">{t('dashboard.seeAllEvents')}</CardLink>}
    >
      <ComingUpList registeredIds={data.registeredIds} />
    </DashCard>,
  ];

  const requestCards: ReactNode[] = [
    <DashCard
      key="inbox"
      icon={Inbox}
      title={label('inbox')}
      titleId="dash-card-inbox"
      desc={descOf('inbox')}
      badge={<CountBadge value={inbox.total} label={t('memberHome.inbox.waitingSr', { count: inbox.total, defaultValue_one: '{{count}} waiting', defaultValue_other: '{{count}} waiting' })} />}
      active={openPanel === 'inbox'}
      footer={toggle('inbox', t('memberHome.open', 'Open'))}
    >
      <p className={cn('font-medium', inbox.total > 0 ? 'text-navy' : 'text-meta')}>
        {inbox.total > 0
          ? t('memberHome.inbox.waiting', { count: inbox.total, defaultValue_one: '{{count}} request waiting for your answer', defaultValue_other: '{{count}} requests waiting for your answer' })
          : t('memberHome.inbox.clear', 'Nothing is waiting for your answer.')}
      </p>
      {data.inboxLatest.length > 0 && (
        <ul className="mt-2">
          {data.inboxLatest.map((r) => (
            <MiniRow
              key={r.id}
              icon={Link2}
              title={r.org ?? t('memberHome.inbox.request', 'Connection request')}
              meta={shortDate(r.created_at, lang)}
              aside={<RequestPill status={r.status} label={t(`memberHome.inbox.status.${r.status}`, r.status === 'pending' ? 'Pending' : r.status === 'accepted' ? 'Accepted' : 'Declined')} />}
              onClick={() => setPanel('inbox')}
            />
          ))}
        </ul>
      )}
    </DashCard>,
    <DashCard
      key="requests"
      icon={ClipboardList}
      title={label('requests')}
      titleId="dash-card-requests"
      desc={descOf('requests')}
      active={openPanel === 'requests'}
      footer={toggle('requests', t('memberHome.manage', 'Manage'))}
    >
      {data.loading ? <BlockSkeleton className="h-12" /> : (
        <div className="space-y-3">
          <p className="text-meta">{requestKinds.map((k) => kindLabel(k, data.requestCounts[k])).join(' · ')}</p>
          {data.latestRequests.length > 0 && (
            <ul>
              {data.latestRequests.map((r) => (
                <MiniRow
                  key={`${r.kind}-${r.id}`}
                  icon={REQUEST_ICON[r.kind]}
                  title={r.title}
                  meta={kindName(r.kind)}
                  aside={<RequestPill status={r.status} label={t(`dashboard.status_${r.status}`, r.status.replace(/_/g, ' '))} />}
                  onClick={() => setPanel('requests', r.kind)}
                />
              ))}
            </ul>
          )}
          {/* Publish or propose: the Create menu's forms this member may use, compact. */}
          {createActions.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5" aria-label={t('dashboard.everything.create', 'Publish or propose')}>
              {createActions.map((a) => (
                <li key={a.href}>
                  <Link
                    to={a.href}
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-pill bg-chip px-3 text-[13px] font-semibold text-navy transition-colors hover:bg-rule focus:outline-none focus-visible:shadow-focus"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    {t(a.labelKey, a.fallback)}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-meta">{t('accountArea.publishWhenVerified', 'You can publish once your organisation is verified')}</p>
          )}
        </div>
      )}
    </DashCard>,
  ];
  if (visible('references')) {
    requestCards.push(
      <DashCard
        key="references"
        icon={getHomeSection('references')?.icon ?? Award}
        title={label('references')}
        titleId="dash-card-references"
        desc={descOf('references')}
        active={openPanel === 'references'}
        footer={toggle('references', t('memberHome.manage', 'Manage'))}
      >
        <p className="text-meta">
          {!data.references || data.references.total === 0
            ? t('memberHome.references.none', 'Ask the marinas you worked with to vouch for you.')
            : t('memberHome.references.counts', { confirmed: data.references.confirmed, waiting: data.references.waiting, defaultValue: '{{confirmed}} confirmed · {{waiting}} waiting' })}
        </p>
      </DashCard>,
    );
  }
  if (visible('sponsorship')) {
    requestCards.push(
      <DashCard
        key="sponsorship"
        icon={Award}
        title={isSponsor ? label('sponsorship') : t('dashboard.everything.sponsorshipHub', 'Sponsorship hub')}
        titleId="dash-card-sponsorship"
        desc={isSponsor ? descOf('sponsorship') : t('dashboard.everything.sponsorshipHubDesc', 'Agreements and fulfilment for every sponsor')}
        active={openPanel === 'sponsorship'}
        footer={(
          <>
            {isSponsor && toggle('sponsorship', t('memberHome.open', 'Open'))}
            {isManager && <CardLink to="/sponsorship">{t('memberHome.sponsorship.openHub', 'Open the hub')}</CardLink>}
          </>
        )}
      />,
    );
  }
  if (visible('press')) {
    requestCards.push(
      <DashCard
        key="press"
        icon={getHomeSection('press')?.icon ?? Award}
        title={label('press')}
        titleId="dash-card-press"
        desc={descOf('press')}
        active={openPanel === 'press'}
        footer={toggle('press', t('memberHome.open', 'Open'))}
      />,
    );
  }

  const forMeCards: ReactNode[] = [];
  if (visible('shortlist')) {
    forMeCards.push(
      <DashCard
        key="shortlist"
        icon={getHomeSection('shortlist')?.icon ?? Award}
        title={label('shortlist')}
        titleId="dash-card-shortlist"
        desc={descOf('shortlist')}
        active={openPanel === 'shortlist'}
        footer={(
          <>
            {toggle('shortlist', t('memberHome.open', 'Open'))}
            <CardLink to="/directory">{t('memberHome.shortlist.find', 'Find companies')}</CardLink>
          </>
        )}
      >
        <p className="text-meta">
          {data.shortlistCount === null || data.loading ? '' : data.shortlistCount === 0
            ? t('memberHome.shortlist.none', 'Save companies from the directory to find them here.')
            : t('memberHome.shortlist.count', { count: data.shortlistCount, defaultValue_one: '{{count}} company saved', defaultValue_other: '{{count}} companies saved' })}
        </p>
      </DashCard>,
    );
  }
  if (isInvestor) {
    forMeCards.push(
      <DashCard
        key="dealflow"
        icon={TrendingUp}
        title={t('dashboard.dealFlowTitle')}
        titleId="dash-card-dealflow"
        desc={t('dashboard.dealFlowBody')}
        footer={<CardLink to="/investments">{t('dashboard.dealFlowCta')}</CardLink>}
      />,
    );
  }
  if (isSupply) {
    forMeCards.push(
      <DashCard
        key="opportunities"
        icon={Briefcase}
        title={t('dashboard.opportunitiesTitle')}
        titleId="dash-card-opportunities"
        className={forMeCards.length === 0 ? undefined : 'xl:col-span-2'}
        footer={canSeeOpportunities ? <CardLink to="/opportunities">{t('dashboard.seeAllOpportunities')}</CardLink> : undefined}
      >
        {!canSeeOpportunities ? (
          <p className="text-meta">{t('dashboard.opportunitiesLocked')}</p>
        ) : data.loading ? <BlockSkeleton className="h-16" /> : data.opportunities.length === 0 ? (
          <p className="text-meta">{t('dashboard.opportunitiesEmpty')}</p>
        ) : (
          <ul>
            {data.opportunities.map((o) => (
              <MiniRow
                key={`${o.kind}-${o.id}`}
                icon={o.kind === 'rfp' ? Ship : MessageSquare}
                title={o.title}
                meta={(
                  <>
                    {t(`dashboard.${o.kind}`)}
                    {o.deadline && ` · ${t('dashboard.deadline', { date: new Date(o.deadline).toLocaleDateString(lang, { day: 'numeric', month: 'short' }) })}`}
                  </>
                )}
                aside={o.matches ? <StatusPill tone="info" className="hidden sm:inline-flex">{t('dashboard.opportunitiesMatch')}</StatusPill> : undefined}
                to={`/opportunities?kind=${o.kind === 'rfp' ? 'rfps' : 'consultations'}`}
              />
            ))}
          </ul>
        )}
      </DashCard>,
    );
  }

  const resourcesMatched = data.resources.some((r) => r.matches);

  /* ---------------------------------------------------------- render */

  return (
    <section id="dashboard" aria-labelledby="dashboard-title" className="bg-page">
      <div className="mx-auto max-w-7xl px-4 pb-14 pt-8 sm:px-6 md:pb-16 md:pt-10">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <Eyebrow>{t('memberHome.eyebrow', 'Member area')}</Eyebrow>
            <h2 id="dashboard-title" className="mt-2 text-h2-sm text-navy md:text-h2">{t('memberHome.title', 'Your dashboard')}</h2>
          </div>
          {organization && (
            <p className="flex flex-wrap items-center gap-2 text-[15px] leading-6 text-meta">
              <span className="[overflow-wrap:anywhere]">{t('dashboard.actingFor', { org: orgName })}</span>
              {orgVerified
                ? <StatusPill tone="success" icon={ShieldCheck}>{t('dashboard.verified')}</StatusPill>
                : <StatusPill tone="warning" icon={Clock}>{t('dashboard.underReview')}</StatusPill>}
            </p>
          )}
        </div>

        {/* ── Account alerts, above everything else ── */}
        <Alerts onOpen={setPanel} hasOrganization={!!organization} orgName={orgName} orgVerified={orgVerified} />

        {/* ── What is waiting: the to-do list, and my next event when I have one ── */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
          <div className={nextReg ? 'lg:col-span-2' : 'lg:col-span-5'}>
            <MemberPanel title={t('dashboard.todoTitle')} className="h-full">
              {data.loading && !inbox.loaded ? (
                <RowSkeleton rows={2} />
              ) : todos.length === 0 ? (
                <div className="flex items-center gap-3 px-5 py-5 text-[15px] text-meta">
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-teal" aria-hidden="true" />
                  {t('dashboard.todoEmpty')}
                </div>
              ) : (
                <ul className={cn('divide-y divide-rule', !nextReg && 'lg:grid lg:grid-cols-2 lg:divide-y-0')}>
                  {todos.map((todo) => (
                    <MemberRow key={todo.key} onClick={todo.open} icon={todo.icon} title={todo.title} hint={todo.hint} urgent={todo.urgent} />
                  ))}
                </ul>
              )}
            </MemberPanel>
          </div>
          {nextReg && (
            <div className="lg:col-span-3">
              <NextEventCard event={nextReg} lang={lang} onOpenEvents={() => setPanel('registrations')} />
            </div>
          )}
        </div>

        {/* ── Everything this member can manage, edited in place ── */}
        <div className="mt-10 space-y-10 md:mt-12 md:space-y-12">
          <DashGroup id="dash-group-company" title={groupLabel('company')} cardCount={companyCards.length} panel={panelFor('company')}>
            {companyCards}
          </DashGroup>
          <DashGroup id="dash-group-events" title={groupLabel('events')} cardCount={3} panel={panelFor('events')}>
            {eventCards}
          </DashGroup>
          <DashGroup id="dash-group-requests" title={groupLabel('requests')} cardCount={requestCards.length} panel={panelFor('requests')}>
            {requestCards}
          </DashGroup>
          <section aria-labelledby="dash-group-forme-title">
            <Eyebrow as="h3" className="mb-4">
              <span id="dash-group-forme-title">{groupLabel('forMe')}</span>
            </Eyebrow>
            {forMeCards.length > 0 && (
              <div className={cn('mb-6 grid grid-cols-1 gap-4', forMeCards.length >= 2 ? 'sm:grid-cols-2 xl:grid-cols-3' : 'sm:grid-cols-2')}>
                {forMeCards}
              </div>
            )}
            {panelFor('forMe')}

            {/* Resources: the library's own cards — sector matches first, else the newest. */}
            <div className={cn('flex items-center justify-between gap-4', (forMeCards.length > 0 || openPanel === 'shortlist') && 'mt-6')}>
              <p className="text-[15px] font-semibold text-navy">{resourcesMatched ? t('dashboard.resourcesForYou') : t('dashboard.resourcesLatest')}</p>
              <UnderlineLink to="/resources" className="!text-[14px] !leading-5">{t('dashboard.seeAllResources')}</UnderlineLink>
            </div>
            {data.loading ? (
              <div className="mt-4 grid grid-cols-2 gap-4 xl:grid-cols-4" aria-hidden="true">
                {[0, 1, 2, 3].map((i) => <BlockSkeleton key={i} className="aspect-[3/4] rounded-card" />)}
              </div>
            ) : data.resources.length === 0 ? (
              <CardShell className="mt-4">
                <MemberEmpty icon={BookOpen} title={t('dashboard.noResources')} className="py-8" />
              </CardShell>
            ) : (
              <div className="mt-4 grid grid-cols-2 gap-4 xl:grid-cols-4">
                {data.resources.map((r) => (
                  <CardShell key={r.id} interactive>
                    <CardMedia>
                      <CoverImage src={r.thumbnail_url} alt="" seed={r.id} icon={RESOURCE_ICON[r.type] ?? BookOpen} aspect="wide">
                        <span className="absolute left-3 top-3 rounded-pill bg-white/95 px-2.5 py-0.5 text-[12px] font-semibold text-navy">
                          {t(`resources.types.${r.type}`, r.type)}
                        </span>
                      </CoverImage>
                    </CardMedia>
                    <div className="flex flex-1 flex-col p-4">
                      <h4 className="text-[15px] font-semibold leading-5 text-navy">
                        <StretchedLink to={`/resources/${r.id}`} arrow={false} className="[overflow-wrap:anywhere]">{r.title}</StretchedLink>
                      </h4>
                      {r.summary && <p className="mt-1.5 line-clamp-2 text-[13px] leading-[18px] text-meta">{r.summary}</p>}
                    </div>
                  </CardShell>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </section>
  );
}

/** State of a request, in the one pill vocabulary. */
function RequestPill({ status, label }: { status: string; label: string }) {
  const tone: PillTone =
    status === 'approved' || status === 'accepted' ? 'success'
      : status === 'rejected' ? 'danger'
        : status === 'closed' ? 'neutral'
          : 'warning';
  return <StatusPill tone={tone}>{label}</StatusPill>;
}

/**
 * The account-state alerts: pending review (with what to do meanwhile),
 * rejected, the organisation under verification, and the profile-completion
 * banner (no organisation, or a sign-up not completed outside a review).
 */
function Alerts({
  onOpen,
  hasOrganization,
  orgName,
  orgVerified,
}: {
  onOpen: (key: HomePanel) => void;
  hasOrganization: boolean;
  orgName: string;
  orgVerified: boolean;
}) {
  const { t } = useTranslation();
  const { profile, isVerified } = useAuth();
  if (!profile) return null;
  const pending = profile.access_status === 'pending';
  const rejected = profile.access_status === 'rejected';
  // Not repeated under the review or rejection banners, which already say what to do.
  const incomplete = !rejected && (!hasOrganization || (profile.onboarding_status !== 'completed' && !pending));
  const linkCls = '!text-[14px] !leading-5';
  return (
    <>
      {pending && (
        <MemberBanner
          tone="warning"
          icon={Clock}
          title={t('dashboard.statusPendingTitle')}
          body={t('memberHome.alerts.pendingBody', 'The M3 team reviews each new account, usually within 24 to 48 business hours, and emails you as soon as yours is approved. Meanwhile, public resources and events are open to you.')}
          action={(
            <nav aria-label={t('dashboard.pendingMeanwhile', 'While you wait')} className="flex flex-col gap-1.5 sm:items-end">
              <UnderlineLink onClick={() => onOpen('profile')} className={linkCls}>{t('dashboard.pendingProfile', 'Complete your profile')}</UnderlineLink>
              <UnderlineLink to="/resources" className={linkCls}>{t('dashboard.pendingLibrary', 'Read the library')}</UnderlineLink>
              <UnderlineLink to="/events?type=webinar" className={linkCls}>{t('dashboard.pendingWebinar', 'Register for a webinar')}</UnderlineLink>
              <UnderlineLink to="/contact" className={linkCls}>{t('dashboard.pendingContact', 'Write to the M3 team')}</UnderlineLink>
            </nav>
          )}
        />
      )}
      {rejected && (
        <MemberBanner
          tone="danger"
          icon={XCircle}
          title={t('dashboard.statusRejectedTitle')}
          body={profile.rejection_reason ? t('dashboard.statusRejectedBody', { reason: profile.rejection_reason }) : undefined}
          action={(
            <div className="flex flex-col gap-1.5 sm:items-end">
              <UnderlineLink to="/onboarding" className={linkCls}>{t('accountArea.banner.resubmit', 'Edit and resubmit')}</UnderlineLink>
              <UnderlineLink to="/contact" className={linkCls}>{t('dashboard.contactUs')}</UnderlineLink>
            </div>
          )}
        />
      )}
      {isVerified && hasOrganization && !orgVerified && (
        <MemberBanner tone="warning" icon={Clock} title={t('dashboard.orgPendingTitle', { org: orgName })} body={t('dashboard.orgPendingBody')} />
      )}
      {incomplete && (
        <MemberBanner
          tone="info"
          icon={AlertCircle}
          title={t('home.completeOrgBanner', 'Complete your organisation profile to unlock all platform features.')}
          action={(
            <Button type="button" variant="outline" size="sm" className="h-10 rounded-pill border-navy/25 bg-white px-4 text-navy hover:border-navy hover:bg-chip" onClick={() => onOpen('organization')}>
              {hasOrganization ? t('homeSections.completeProfileCta', 'Complete my profile') : t('memberHome.org.add', 'Add my organisation')}
            </Button>
          )}
        />
      )}
    </>
  );
}


/** "12 Oct", or nothing for a date that cannot be read. */
function shortDate(iso: string | null | undefined, lang: string): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? undefined : d.toLocaleDateString(lang, { day: 'numeric', month: 'short' });
}
