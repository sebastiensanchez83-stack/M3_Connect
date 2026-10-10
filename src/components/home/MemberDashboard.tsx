import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { LucideIcon } from 'lucide-react';
import {
  AlertCircle, Award, BookOpen, ClipboardList, Clock, ImageIcon, ImagePlus, Inbox, ListChecks,
  MessageSquare, PenLine, Plus, Ship, ShieldCheck, TrendingUp, UserCircle, UserPlus, Video, XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CoverImage } from '@/components/ui/CoverImage';
import { CardMedia, CardShell, StretchedLink } from '@/components/brand/CardShell';
import { Eyebrow } from '@/components/brand/Eyebrow';
import { UnderlineLink } from '@/components/brand/UnderlineLink';
import { HelpTip } from '@/components/help/HelpTip';
import { NeedHelpCard } from '@/components/help/NeedHelpCard';
import {
  BlockSkeleton, MemberBanner, MemberEmpty, MemberPanel, RowSkeleton, StatusPill,
} from '@/components/member/MemberUI';
import { useMediaQuery } from '@/components/motion/useReducedMotion';
import { useAuth } from '@/contexts/AuthContext';
import { useEntitlements } from '@/hooks/useEntitlements';
import { useInboxCount } from '@/hooks/useInboxCount';
import { useMemberAccess } from '@/hooks/useMemberAccess';
import { sm26Kind, sm26TeamWent, useSm26Participation } from '@/hooks/useSm26Participation';
import { lazyWithRetry } from '@/lib/lazyWithRetry';
import { CREATE_ACTIONS, canCreate } from '@/lib/nav';
import {
  accountHref, getHomeSection, homeSectionVisible, isHomePanel, legacyOpenTarget,
  type HomePanel,
} from '@/lib/accountNav';
import { scrollTopUnderBars } from '@/lib/scrollTarget';
import { cn } from '@/lib/utils';
import { CardLink, MiniRow, PanelRegion, Tile, type TileTone } from './dashboard/DashboardKit';
import { ComingUpList, NextEventCard } from './dashboard/EventBlocks';
import { TodoList, type TodoItem } from './dashboard/TodoList';
import { PublishDialog } from './dashboard/teamDialogs';
import { useDashboardData } from './dashboard/useDashboardData';

/**
 * The signed-in member's dashboard, right under "Welcome back" on the home
 * page (Victor's feedback, 9 Oct 2026: "the people who use it are not good
 * with technology: it must be really simple, despite the many features").
 *
 * From top to bottom: what blocks the account (the alerts), what waits
 * (To do, my next event), then a few big tiles: My profile, My company, My
 * team, My events, Messages, My requests, and the ones that only apply to
 * some members (Saved companies, Deal flow, Sponsorship, Press room,
 * References). Each tile says in one line where things stand ("2 waiting for
 * your answer", "Logo missing", "All set") and opens its panel in place,
 * right under its row. Inside, the information reads as rows with a "Change"
 * button that opens a small window with that one thing. Everything else the
 * old editors did stays behind "More settings". Last, lighter: events coming
 * up, opportunities for service providers, articles; then "Need help?" (three
 * questions for the member's profile, the help centre, the team).
 *
 * One panel at a time; the open one is in the address (/?open=<tile>
 * [&section=…], replaced, never pushed), so it can be linked and survives a
 * reload. The old /dashboard and /account?tab=… addresses land here
 * (src/lib/accountNav.ts); so do the first October panel keys
 * (/?open=organization, /?open=notifications).
 *
 * Drafts (sign-up not finished) only get the way back to their registration.
 * Nothing here is wrapped in a reveal: the dashboard shows at once.
 */

// The panels load when a tile opens: none of them weighs on the home page.
const ProfilePanel = lazyWithRetry(() => import('./dashboard/ProfilePanel').then((m) => ({ default: m.ProfilePanel })));
const CompanyPanel = lazyWithRetry(() => import('./dashboard/CompanyPanel').then((m) => ({ default: m.CompanyPanel })));
const TeamPanel = lazyWithRetry(() => import('./dashboard/TeamPanel').then((m) => ({ default: m.TeamPanel })));
const EventsPanel = lazyWithRetry(() => import('./dashboard/EventsPanel').then((m) => ({ default: m.EventsPanel })));
const MyRequests = lazyWithRetry(() => import('@/components/account/MyRequests').then((m) => ({ default: m.MyRequests })));
const PressRoom = lazyWithRetry(() => import('@/components/account/PressRoom').then((m) => ({ default: m.PressRoom })));
const InboxTab = lazyWithRetry(() => import('@/components/inbox/InboxTab').then((m) => ({ default: m.InboxTab })));
const ShortlistTab = lazyWithRetry(() => import('@/components/shortlist/ShortlistTab').then((m) => ({ default: m.ShortlistTab })));
const ReferenceRequestForm = lazyWithRetry(() => import('@/components/references/ReferenceRequestForm').then((m) => ({ default: m.ReferenceRequestForm })));
const SponsorPortal = lazyWithRetry(() => import('@/components/sponsorship/SponsorPortal').then((m) => ({ default: m.SponsorPortal })));

const DEMAND_PERSONAS = ['marina', 'developer'];
const SUPPLY_PERSONAS = ['partner', 'media_partner'];

const RESOURCE_ICON: Record<string, LucideIcon> = { replay: Video, article: BookOpen, guide: BookOpen, whitepaper: BookOpen, case_study: BookOpen };

interface TileDef {
  key: string;
  panel?: HomePanel;
  to?: string;
  icon: LucideIcon;
  title: string;
  count?: { value: number; label: string } | null;
  status: ReactNode;
  tone: TileTone;
}

/** Tiles per row: 1 on phones, 2 on tablets, 3 on desktops (the grid's own breakpoints). */
function useColumns(): number {
  const sm = useMediaQuery('(min-width: 640px)');
  const lg = useMediaQuery('(min-width: 1024px)');
  return lg ? 3 : sm ? 2 : 1;
}

export default function MemberDashboard() {
  const { t, i18n } = useTranslation();
  const { user, profile, organization, orgRole, isVerified } = useAuth();
  const { isFeatureEnabled } = useEntitlements();
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const columns = useColumns();

  const isDraft = profile?.onboarding_status === 'draft';
  const active = !!user && !!profile && !isDraft;
  const access = useMemberAccess(active);
  const inbox = useInboxCount(active);
  const sm26 = useSm26Participation(active);

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
    hasOrganization: !!orgId,
    access: access ? { media: access.media, sponsor: access.sponsorIds.length > 0, manager: access.manager } : null,
  }), [persona, orgType, orgId, access]);
  const visible = (key: HomePanel) => homeSectionVisible(key, sectionCtx);

  // A version bump reloads the tiles' summaries (after a change, or a panel closing).
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);
  const data = useDashboardData({
    uid, orgId, orgType, persona, isDemand, isSupply, canSeeOpportunities,
    canProjects, canRFPs, canConsultations,
    isPartnerOrg: orgType === 'partner',
    hasShortlist: visible('shortlist'),
    enabled: active,
    version,
  });

  /* ---------------------------------------------------------- the open panel */

  const rawOpen = searchParams.get('open');
  const section = searchParams.get('section');
  const requested = isHomePanel(rawOpen) ? rawOpen : null;
  // Sponsorship and the press room depend on the server's answer: wait for it before judging.
  const accessPending = access === null && (requested === 'sponsorship' || requested === 'press');
  const openPanel: HomePanel | null = requested && !accessPending && homeSectionVisible(requested, sectionCtx) ? requested : null;

  const setPanel = useCallback((key: HomePanel | null, sub?: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('open');
      next.delete('section');
      if (key) {
        next.set('open', key);
        if (sub) next.set('section', sub);
      }
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // The first October panels (/?open=organization, /?open=notifications) land on their new tile and row.
  // Otherwise an unknown panel, or one that does not apply to this member: the plain home page.
  useEffect(() => {
    if (!active || !rawOpen || accessPending) return;
    const legacy = legacyOpenTarget(rawOpen, section);
    if (legacy) { setPanel(legacy.panel, legacy.section); return; }
    // My team without a company: where the company is added.
    if (requested === 'team' && !sectionCtx.hasOrganization) { setPanel('company'); return; }
    if (!requested || !homeSectionVisible(requested, sectionCtx)) setPanel(null);
  }, [active, rawOpen, section, requested, accessPending, sectionCtx, setPanel]);

  const tileRefs = useRef<Partial<Record<string, HTMLButtonElement | null>>>({});
  const closePanel = useCallback((key: HomePanel) => {
    setPanel(null);
    // Requests may have been answered there (My team answers join requests too).
    if (key === 'inbox' || key === 'team') inbox.refresh();
    bump();
    // Back to the tile that opened it.
    requestAnimationFrame(() => tileRefs.current[key]?.focus());
  }, [setPanel, inbox, bump]);
  const togglePanel = (key: HomePanel) => {
    if (openPanel === key) closePanel(key);
    else setPanel(key);
  };

  // /#dashboard (the avatar menu's "My dashboard"): the top of the dashboard, under the header.
  useEffect(() => {
    if (location.hash !== '#dashboard') return;
    const el = document.getElementById('dashboard');
    if (el) window.scrollTo({ top: scrollTopUnderBars(el, 0, 0) });
  }, [location.key, location.hash]);

  const [publishOpen, setPublishOpen] = useState(false);

  // The to-do list waits for the inbox count too (its answers come first), but
  // never for ever: the count is a hint, and it stays empty if its read fails.
  const [inboxWait, setInboxWait] = useState(true);
  useEffect(() => {
    const id = window.setTimeout(() => setInboxWait(false), 6000);
    return () => window.clearTimeout(id);
  }, []);

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

  // The company's page as stored now when we have it, else the auth context's copy.
  const brandSrc = data.brand && data.brand.id === orgId ? data.brand : organization;
  const counts = data.orgCounts && data.orgCounts.orgId === orgId ? data.orgCounts : null;
  const companyReady = !!organization && !data.loading;
  const brand = {
    logo: !!brandSrc?.logo_url,
    banner: !!brandSrc?.banner_url,
    description: !!brandSrc?.description?.trim(),
    sectors: (counts?.sectors ?? 0) > 0,
  };

  // To do: answers someone is waiting for, then what the owner can complete, then my own profile.
  const todos: TodoItem[] = [];
  // Messages from companies are answered in Messages (one place, the same words as
  // its tile): the item opens that panel.
  if (inbox.connections > 0) {
    todos.push({
      key: 'connections', urgent: true, icon: Inbox,
      title: t('dash.todo.companyMessages', { count: inbox.connections, defaultValue_one: 'Answer {{count}} message from a company', defaultValue_other: 'Answer {{count}} messages from companies' }),
      hint: t('dash.todo.companyMessagesHint', 'Accept to start the conversation, or decline.'),
      onSelect: () => setPanel('inbox'),
    });
  }
  if (inbox.joins > 0) {
    todos.push({
      key: 'join', urgent: true, icon: UserPlus,
      title: t('dash.todo.join', { count: inbox.joins, defaultValue_one: 'Answer {{count}} person who wants to join your company', defaultValue_other: 'Answer {{count}} people who want to join your company' }),
      hint: t('dash.todo.joinHint', { org: orgName, defaultValue: 'They say they work at {{org}}.' }),
    });
  }
  if (organization && isOwner && companyReady) {
    if (!brand.logo) todos.push({ key: 'logo', urgent: false, icon: ImagePlus, title: t('dash.todo.logo', 'Add your company logo'), hint: t('dash.todo.logoHint', 'Companies with a logo are easier to recognise.') });
    if (!brand.description) todos.push({ key: 'description', urgent: false, icon: PenLine, title: t('dash.todo.description', 'Add a description of your company'), hint: t('dash.todo.descriptionHint', 'A few sentences about what you do.') });
    if (counts && !brand.sectors) {
      todos.push({
        key: 'sectors', urgent: false, icon: ListChecks,
        title: orgType === 'marina' ? t('dash.todo.interests', 'Choose what you are interested in') : t('dash.todo.sectors', 'Choose what your company does'),
        hint: orgType === 'marina' || orgType === 'partner' || orgType === 'media_partner'
          ? t('dash.todo.sectorsConnectHint', 'Companies whose activities match yours are then connected with you straight away.')
          : t('dash.todo.sectorsHint', 'So the right members find you.'),
      });
    }
    if (!brand.banner) todos.push({ key: 'banner', urgent: false, icon: ImageIcon, title: t('dash.todo.banner', 'Add a cover photo'), hint: t('dash.todo.bannerHint', 'The wide picture at the top of your company page.') });
  }
  if (!profile.avatar_url) todos.push({ key: 'photo', urgent: false, icon: UserCircle, title: t('dash.todo.photo', 'Add your photo'), hint: t('dash.todo.photoHint', 'People like to see who they talk to.') });
  if (!profile.job_title) todos.push({ key: 'job', urgent: false, icon: UserCircle, title: t('dash.todo.job', 'Add your job title'), hint: t('dash.todo.jobHint', 'It shows next to your name.') });

  const createCtx = { isVerified, orgVerified, persona, isFeatureEnabled };
  const createActions = CREATE_ACTIONS.filter((a) => canCreate(a.capability, createCtx));
  const requestTotal = data.requestCounts.projects + data.requestCounts.rfps + data.requestCounts.consultations + data.requestCounts.webinars;
  const sponsorIds = access?.sponsorIds ?? [];
  const isSponsor = sponsorIds.length > 0;
  const isManager = access?.manager === true;
  const layoutReady = !data.loading;
  const nextReg = data.nextRegistered;
  const sm26What = sm26Kind(sm26);
  // How many of my team went (the accounts My team marks "Attended"): never the whole team by default.
  const sm26Went = sm26TeamWent(sm26);

  /* ---------------------------------------------------------- the tiles */

  const loadingLine = t('dash.loadingShort', 'Loading…');
  const tiles: TileDef[] = [];

  // My profile
  {
    const noPhoto = !profile.avatar_url;
    const noJob = !profile.job_title;
    tiles.push({
      key: 'profile', panel: 'profile', icon: UserCircle, title: label('profile'),
      tone: noPhoto || noJob ? 'missing' : 'done',
      status: noPhoto && noJob
        ? t('dash.st.photoJob', 'Photo and job title missing')
        : noPhoto ? t('dash.st.photo', 'Photo missing')
          : noJob ? t('dash.st.job', 'Job title missing')
            : t('dash.st.allSet', 'All set'),
    });
  }

  // My company
  {
    let status: string;
    let tone: TileTone = 'plain';
    if (!organization) {
      status = t('dash.st.noCompany', 'Add your company');
      tone = 'missing';
    } else if (!companyReady) {
      status = loadingLine;
    } else {
      // Say WHAT is missing, in a few words: "Logo and cover photo missing".
      const missing = [
        !brand.logo && t('dash.st.n.logo', 'logo'),
        !brand.description && t('dash.st.n.description', 'description'),
        counts && !brand.sectors && (orgType === 'marina' ? t('dash.st.n.interests', 'interests') : t('dash.st.n.sectors', 'sectors')),
        !brand.banner && t('dash.st.n.cover', 'cover photo'),
      ].filter(Boolean) as string[];
      const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
      if (missing.length === 1) {
        status = cap(t('dash.st.oneMissing', { a: missing[0], defaultValue: '{{a}} missing' }));
        tone = 'missing';
      } else if (missing.length === 2) {
        status = cap(t('dash.st.twoMissing', { a: missing[0], b: missing[1], defaultValue: '{{a}} and {{b}} missing' }));
        tone = 'missing';
      } else if (missing.length > 2) {
        status = cap(t('dash.st.manyMissing', { a: missing[0], b: missing[1], count: missing.length - 2, defaultValue: '{{a}}, {{b}} and {{count}} more missing' }));
        tone = 'missing';
      } else if (!orgVerified) status = t('dash.st.checking', 'The M3 team is checking it');
      else { status = t('dash.st.allSet', 'All set'); tone = 'done'; }
    }
    tiles.push({ key: 'company', panel: 'company', icon: getHomeSection('company')!.icon, title: label('company'), status, tone });
  }

  // My team (a company is needed). The number of people is said in words, not repeated in a pill.
  if (visible('team')) {
    const members = counts?.members ?? 0;
    const maxSeats = organization?.max_seats ?? 0;
    const unlimited = orgType === 'marina' || orgType === 'developer';
    // Most companies have one place: never prompt them to invite (the team panel says how to get more).
    const roomForMore = unlimited || !maxSeats || members < maxSeats;
    let status: string;
    let tone: TileTone = 'plain';
    if (isOwner && inbox.joins > 0) {
      status = t('dash.st.joinWaiting', { count: inbox.joins, defaultValue_one: '{{count}} person waiting to join', defaultValue_other: '{{count}} people waiting to join' });
      tone = 'action';
    } else if (!counts) {
      status = loadingLine;
    } else if (members <= 1) {
      status = isOwner && roomForMore ? t('dash.st.onlyYouInvite', 'Only you so far. Invite a colleague') : t('dash.st.onlyYou', 'Only you so far');
    } else {
      status = t('dash.st.people', { count: members, defaultValue_one: '{{count}} person', defaultValue_other: '{{count}} people' });
      if (sm26Went > 0) {
        status += ` · ${sm26Went >= members
          ? t('dash.st.allWent', 'Everyone went to Smart Marina 2026')
          : t('dash.st.teamWent', { count: sm26Went, defaultValue_one: '{{count}} went to Smart Marina 2026', defaultValue_other: '{{count}} went to Smart Marina 2026' })}`;
      }
    }
    tiles.push({ key: 'team', panel: 'team', icon: getHomeSection('team')!.icon, title: label('team'), status, tone });
  }

  // My events
  {
    const parts: string[] = [];
    if (data.upcomingCount > 0) parts.push(t('dash.st.upcoming', { count: data.upcomingCount, defaultValue_one: '{{count}} upcoming event', defaultValue_other: '{{count}} upcoming events' }));
    if (sm26What === 'you') parts.push(t('dash.st.sm26You', 'You attended Smart Marina 2026'));
    else if (sm26What === 'team') parts.push(t('dash.st.sm26Team', 'Your team attended Smart Marina 2026'));
    else if (sm26What === 'company') parts.push(t('dash.st.sm26Company', 'Your company took part in Smart Marina 2026'));
    const status = data.loading ? loadingLine : parts.length > 0 ? parts.join(' · ')
      : data.pastCount > 0 ? t('dash.st.pastOnly', { count: data.pastCount, defaultValue_one: '{{count}} past event', defaultValue_other: '{{count}} past events' })
        : t('dash.st.noEvents', 'No registration yet');
    tiles.push({ key: 'registrations', panel: 'registrations', icon: getHomeSection('registrations')!.icon, title: label('registrations'), status, tone: sm26What ? 'done' : 'plain' });
  }

  // Messages: "3 unread messages · 1 request waiting" (useInboxCount, the navbar dot's count).
  {
    const parts: string[] = [];
    if (inbox.messages > 0) parts.push(t('dash.st.unreadMessages', { count: inbox.messages, defaultValue_one: '{{count}} unread message', defaultValue_other: '{{count}} unread messages' }));
    if (inbox.requests > 0) parts.push(t('dash.st.requestsWaiting', { count: inbox.requests, defaultValue_one: '{{count}} request waiting', defaultValue_other: '{{count}} requests waiting' }));
    tiles.push({
      key: 'inbox', panel: 'inbox', icon: getHomeSection('inbox')!.icon, title: label('inbox'),
      tone: inbox.total > 0 ? 'action' : 'plain',
      status: !inbox.loaded ? loadingLine : parts.length > 0
        ? parts.join(' · ')
        : t('dash.st.noNewMessages', 'No new messages'),
      count: { value: inbox.total, label: t('dash.waitingSr', { count: inbox.total, defaultValue_one: '{{count}} waiting', defaultValue_other: '{{count}} waiting' }) },
    });
  }

  // My requests
  tiles.push({
    key: 'requests', panel: 'requests', icon: getHomeSection('requests')!.icon, title: label('requests'), tone: 'plain',
    // Every request sent, whatever M3 decided: the panel says where each one stands.
    status: data.loading ? loadingLine : requestTotal > 0
      ? t('dash.st.requestsSent', { count: requestTotal, defaultValue_one: '{{count}} request sent', defaultValue_other: '{{count}} requests sent' })
      : createActions.length > 0 ? t('dash.st.publishFirst', 'Nothing yet. Publish a need') : t('dash.st.nothingPublished', 'Nothing published yet'),
  });

  // Only for some members
  if (visible('shortlist')) {
    tiles.push({
      key: 'shortlist', panel: 'shortlist', icon: getHomeSection('shortlist')!.icon, title: label('shortlist'), tone: 'plain',
      status: data.shortlistCount === null || data.loading ? loadingLine : data.shortlistCount === 0
        ? t('dash.st.noneSaved', 'None saved yet')
        : t('dash.st.saved', { count: data.shortlistCount, defaultValue_one: '{{count}} company saved', defaultValue_other: '{{count}} companies saved' }),
    });
  }
  if (isInvestor) {
    tiles.push({ key: 'dealflow', to: '/investments', icon: TrendingUp, title: t('dash.tiles.dealflow', 'Deal flow'), tone: 'plain', status: t('dash.st.dealflow', 'Marina projects looking for investors') });
  }
  if (visible('sponsorship')) {
    tiles.push({
      key: 'sponsorship', panel: 'sponsorship', icon: Award, tone: 'plain',
      title: isSponsor ? label('sponsorship') : t('dash.tiles.sponsorshipHub', 'Sponsorship hub'),
      status: isSponsor ? t('dash.st.sponsor', 'Your package and what to send us') : t('dash.st.hub', 'Agreements and follow-up for every sponsor'),
    });
  }
  if (visible('press')) {
    tiles.push({ key: 'press', panel: 'press', icon: getHomeSection('press')!.icon, title: label('press'), tone: 'plain', status: t('dash.st.press', 'Media kits and your articles') });
  }
  if (visible('references')) {
    tiles.push({
      key: 'references', panel: 'references', icon: getHomeSection('references')!.icon, title: label('references'), tone: 'plain',
      status: !data.references || data.references.total === 0
        ? t('dash.st.noRefs', 'Ask marinas you worked with to vouch for you')
        : t('dash.st.refs', { confirmed: data.references.confirmed, waiting: data.references.waiting, defaultValue: '{{confirmed}} confirmed · {{waiting}} waiting' }),
    });
  }

  /* ---------------------------------------------------------- the open panel's content */

  const panelActions = (key: HomePanel): ReactNode => {
    if (key === 'company' && organization?.slug) return <CardLink to={`/organizations/${organization.slug}`}>{t('dash.viewCompanyPage', 'View my company page')}</CardLink>;
    if (key === 'registrations') return <CardLink to="/events">{t('dash.browseEvents', 'Browse events')}</CardLink>;
    if (key === 'inbox') return <CardLink to="/inbox">{t('dash.inboxPage', 'Open as a full page')}</CardLink>;
    if (key === 'shortlist') return <CardLink to="/directory">{t('dash.findCompanies', 'Find companies')}</CardLink>;
    if (key === 'sponsorship' && isManager) return <CardLink to="/sponsorship">{t('dash.sponsorshipHub', 'Sponsorship hub')}</CardLink>;
    return null;
  };

  const panelBody = (key: HomePanel): ReactNode => {
    switch (key) {
      case 'profile': return <ProfilePanel initialSection={section} onChanged={bump} />;
      case 'company': return <CompanyPanel initialSection={section} version={version} onChanged={bump} />;
      case 'team': return <TeamPanel sm26UserIds={sm26?.team.userIds ?? []} version={version} onChanged={bump} onInboxChanged={inbox.refresh} />;
      case 'registrations': return <EventsPanel sm26={sm26} />;
      case 'inbox': return <InboxTab />;
      case 'requests':
        return (
          <div className="space-y-4">
            {createActions.length > 0 ? (
              <div className="flex flex-col gap-4 rounded-card border border-rule bg-white px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                <p className="text-[16px] leading-6 text-ink">
                  {t('dash.publishLead', 'Looking for a supplier, an expert or a speaker? Tell the network.')}
                </p>
                <Button type="button" variant="cta" size="sm" arrow={false} className="shrink-0 justify-center" onClick={() => setPublishOpen(true)}>
                  <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
                  {t('dash.publishNeed', 'Publish a new need')}
                </Button>
              </div>
            ) : (
              <p className="rounded-card border border-rule bg-white px-4 py-3 text-[15px] leading-6 text-meta sm:px-5">
                {t('dash.publishWhenVerified', 'You can publish once the M3 team has checked your company.')}
              </p>
            )}
            <MyRequests />
          </div>
        );
      case 'references': return <ReferenceRequestForm onReferenceSubmitted={bump} />;
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

  // The open panel goes right after the last tile of its row.
  const openIndex = openPanel ? tiles.findIndex((tile) => tile.panel === openPanel) : -1;
  const rowEnd = openIndex >= 0 ? Math.min(tiles.length, Math.ceil((openIndex + 1) / columns) * columns) - 1 : -1;
  const panelNode = openPanel && openIndex >= 0 ? (
    <PanelRegion
      key={`panel-${openPanel}`}
      panelKey={openPanel}
      title={tiles[openIndex].title}
      desc={descOf(openPanel)}
      actions={panelActions(openPanel)}
      layoutReady={layoutReady}
      onClose={() => closePanel(openPanel)}
      className="col-span-full"
    >
      <Suspense fallback={<div className="rounded-card border border-rule bg-white"><RowSkeleton rows={3} /></div>}>
        {panelBody(openPanel)}
      </Suspense>
    </PanelRegion>
  ) : null;

  const grid: ReactNode[] = [];
  tiles.forEach((tile, i) => {
    grid.push(
      <div key={tile.key} className="min-w-0">
        <Tile
          ref={(el) => { tileRefs.current[tile.key] = el; }}
          panelKey={tile.key}
          icon={tile.icon}
          title={tile.title}
          count={tile.count}
          status={tile.status}
          tone={tile.tone}
          to={tile.to}
          open={!!tile.panel && openPanel === tile.panel}
          onClick={tile.panel ? () => togglePanel(tile.panel!) : undefined}
        />
      </div>,
    );
    if (i === rowEnd && panelNode) grid.push(panelNode);
  });

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
            <TodoList
              items={todos}
              loading={data.loading || (!inbox.loaded && inboxWait)}
              onChanged={bump}
              onInboxChanged={inbox.refresh}
              compact={!!nextReg}
            />
          </div>
          {nextReg && (
            <div className="lg:col-span-3">
              <NextEventCard event={nextReg} lang={lang} onOpenEvents={() => setPanel('registrations')} />
            </div>
          )}
        </div>

        {/* ── The tiles: everything this member manages, each opened in place ── */}
        <section aria-labelledby="dash-tiles-title" className="mt-10 md:mt-12">
          <Eyebrow as="h3" className="mb-4">
            <span id="dash-tiles-title">{t('dash.tilesTitle', 'Your account')}</span>
          </Eyebrow>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {grid}
          </div>
        </section>

        {/* ── Worth a look: events ahead, opportunities, articles ── */}
        <section aria-labelledby="dash-forme-title" className="mt-12 md:mt-14">
          <Eyebrow as="h3" className="mb-4">
            <span id="dash-forme-title">{t('dash.forYou', 'For you')}</span>
          </Eyebrow>
          <div className={cn('grid grid-cols-1 gap-4', isSupply && 'lg:grid-cols-2')}>
            <CardShell as="article" className="p-5">
              <div className="mb-3 flex items-center justify-between gap-4">
                <h4 className="text-card-title text-navy">{t('dash.comingUp', 'Coming up')}</h4>
                <CardLink to="/events">{t('dash.allEvents', 'All events')}</CardLink>
              </div>
              <ComingUpList registeredIds={data.registeredIds} />
            </CardShell>
            {isSupply && (
              <CardShell as="article" className="p-5">
                <div className="mb-3 flex items-center justify-between gap-4">
                  <h4 className="text-card-title text-navy">{t('dashboard.opportunitiesTitle', 'Opportunities')}</h4>
                  {canSeeOpportunities && <CardLink to="/opportunities">{t('dashboard.seeAllOpportunities', 'See all')}</CardLink>}
                </div>
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
              </CardShell>
            )}
          </div>

          {/* Resources: the library's own cards — sector matches first, else the newest. */}
          <div className="mt-8 flex items-center justify-between gap-4">
            <p className="text-[16px] font-semibold text-navy">{resourcesMatched ? t('dashboard.resourcesForYou') : t('dashboard.resourcesLatest')}</p>
            <UnderlineLink to="/resources" className="min-h-11 !text-[15px] !leading-5">{t('dashboard.seeAllResources')}</UnderlineLink>
          </div>
          {data.loading ? (
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-hidden="true">
              {[0, 1, 2, 3].map((i) => <BlockSkeleton key={i} className="aspect-[4/3] rounded-card" />)}
            </div>
          ) : data.resources.length === 0 ? (
            <CardShell className="mt-4">
              <MemberEmpty icon={BookOpen} title={t('dashboard.noResources')} className="py-8" />
            </CardShell>
          ) : (
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
                    <h4 className="text-[16px] font-semibold leading-6 text-navy">
                      <StretchedLink to={`/resources/${r.id}`} arrow={false} className="[overflow-wrap:anywhere]">{r.title}</StretchedLink>
                    </h4>
                    {r.summary && <p className="mt-1.5 line-clamp-2 text-[14px] leading-5 text-meta">{r.summary}</p>}
                  </div>
                </CardShell>
              ))}
            </div>
          )}
        </section>

        {/* ── Need help? Three questions for this profile, the help centre, the team ── */}
        <section aria-labelledby="dash-help-title" className="mt-12 md:mt-14">
          <Eyebrow as="h3" className="mb-4">
            <span id="dash-help-title">{t('dash.help.eyebrow', 'Help')}</span>
          </Eyebrow>
          <NeedHelpCard hasOrganization={!!organization} persona={persona} orgType={orgType} />
        </section>
      </div>

      <PublishDialog open={publishOpen} onOpenChange={setPublishOpen} actions={createActions} />
    </section>
  );
}

/**
 * The account-state alerts: pending review (with what to do meanwhile),
 * rejected, the company under verification, and the completion banner (no
 * company, or a sign-up not completed outside a review).
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
  const linkCls = '!text-[15px] !leading-5';
  return (
    <>
      {pending && (
        <MemberBanner
          tone="warning"
          icon={Clock}
          title={(
            <>
              {t('dashboard.statusPendingTitle')}{' '}
              <HelpTip title={t('help.tips.reviewTitle', 'Why M3 checks your account')} more="verification-why">
                {t('help.tips.reviewWhy', 'M3 checks every company and every person, so members know who they talk to. You do not need to do anything for the check.')}
              </HelpTip>
            </>
          )}
          // A pending account cannot register for events yet (database rule event_reg_insert): it can look at them.
          body={t('memberHome.alerts.pendingWhile', 'The M3 team reviews each new account, usually within 24 to 48 business hours, and e-mails you as soon as yours is approved. Meanwhile, the public resources are open to you, and you can look at the coming events.')}
          action={(
            <nav aria-label={t('dashboard.pendingMeanwhile', 'While you wait')} className="flex flex-col gap-1.5 sm:items-end">
              <UnderlineLink onClick={() => onOpen('profile')} className={linkCls}>{t('dashboard.pendingProfile', 'Complete your profile')}</UnderlineLink>
              <UnderlineLink to="/resources" className={linkCls}>{t('dashboard.pendingLibrary', 'Read the library')}</UnderlineLink>
              <UnderlineLink to="/events?type=webinar" className={linkCls}>{t('dashboard.pendingWebinarsSee', 'See the coming webinars')}</UnderlineLink>
              <UnderlineLink to="/contact" className={linkCls}>{t('dashboard.pendingContact', 'Write to the M3 team')}</UnderlineLink>
            </nav>
          )}
        />
      )}
      {rejected && (
        <MemberBanner
          tone="danger"
          icon={XCircle}
          title={(
            <>
              {t('dashboard.statusRejectedTitle')}{' '}
              <HelpTip title={t('help.tips.rejectedTitle', 'What you can do now')} more="verification-rejected">
                {t('help.tips.rejected', 'Read the reason, correct your details with “Edit and resubmit”, and the M3 team looks again. Think it is a mistake? Write to us.')}
              </HelpTip>
            </>
          )}
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
        <MemberBanner
          tone="warning"
          icon={Clock}
          title={(
            <>
              {t('dashboard.orgPendingTitle', { org: orgName })}{' '}
              <HelpTip title={t('help.tips.orgReviewTitle', 'Your company is checked too')} more="verification-company">
                {t('help.tips.orgReviewNothing', 'There is nothing more to do. M3 usually checks a company within 24 to 48 business hours, and this notice goes away once it is approved.')}
              </HelpTip>
            </>
          )}
          // The opportunities follow the person's approval (has_marketplace_access), not the company's.
          // "Such as": what opens depends on the profile (an investor never publishes a need).
          body={t('dashboard.orgPendingSome', 'Some features, such as writing to other companies, publishing a need or proposing a webinar, open once your company is approved.')}
        />
      )}
      {incomplete && (
        <MemberBanner
          tone="info"
          icon={AlertCircle}
          title={hasOrganization
            ? t('home.completeOrgBanner', 'Complete your organisation profile to unlock all platform features.')
            : t('dash.noCompanyBanner', 'Add your company to unlock the whole platform.')}
          action={(
            <Button type="button" variant="outline" size="sm" className="h-11 rounded-pill border-navy/25 bg-white px-5 text-[15px] text-navy hover:border-navy hover:bg-chip" onClick={() => onOpen('company')}>
              {hasOrganization ? t('homeSections.completeProfileCta', 'Complete my profile') : t('dash.addCompany', 'Add my company')}
            </Button>
          )}
        />
      )}
    </>
  );
}
