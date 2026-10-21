import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { LucideIcon } from 'lucide-react';
import {
  AlertCircle, Award, BookOpen, ClipboardList, Clock, ImageIcon, ImagePlus, Inbox, ListChecks,
  MessageSquare, PenLine, Plus, Ship, Sparkles, TrendingUp, UserCircle, UserPlus, Video, XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CoverImage } from '@/components/ui/CoverImage';
import { CardMedia, CardShell, StretchedLink } from '@/components/brand/CardShell';
import { Eyebrow } from '@/components/brand/Eyebrow';
import { HelpTip } from '@/components/help/HelpTip';
import { NeedHelpCard } from '@/components/help/NeedHelpCard';
import {
  BlockSkeleton, MemberBanner, MemberEmpty, MemberPanel, RowSkeleton,
} from '@/components/member/MemberUI';
import { prefersReducedMotion, useMediaQuery } from '@/components/motion/useReducedMotion';
import { useAuth } from '@/contexts/AuthContext';
import { useEntitlements } from '@/hooks/useEntitlements';
import { useInboxCount } from '@/hooks/useInboxCount';
import { useMemberAccess } from '@/hooks/useMemberAccess';
import { sm26Kind, sm26TeamWent, useSm26Participation } from '@/hooks/useSm26Participation';
import { lazyWithRetry } from '@/lib/lazyWithRetry';
import { newEventPagesOn, useRegistrationFlags } from '@/lib/flags';
import { isV2Signup } from '@/lib/accountSignup';
import { CREATE_ACTIONS, canCreate } from '@/lib/nav';
import {
  accountHref, getHomeSection, homeSectionVisible, isHomePanel, legacyOpenTarget,
  type HomePanel,
} from '@/lib/accountNav';
import { scrollTopUnderBars } from '@/lib/scrollTarget';
import { cn } from '@/lib/utils';
import {
  ActionCue, CardButton, CardLink, MiniRow, PanelRegion, Tile, panelDomId, type IconTone, type TileTone,
} from './dashboard/DashboardKit';
import { DashboardBand, type BandFigure, type Completeness } from './dashboard/DashboardBand';
import { ComingUpList, NextEventCard, agendaAhead } from './dashboard/EventBlocks';
import { TodoList, type TodoItem } from './dashboard/TodoList';
import { PublishDialog, SwitchCompanyDialog } from './dashboard/teamDialogs';
import { AccountStatus } from './dashboard/AccountStatus';
import { DEFAULT_DURATION_MS, useDashboardData } from './dashboard/useDashboardData';
import { useHomeAgenda } from './useHomeAgenda';
import { eventPath, resourcePath } from '@/lib/seoMeta';

/**
 * The signed-in member's dashboard, right under "Welcome back" on the home
 * page (Victor's feedback, 9 Oct 2026: "the people who use it are not good
 * with technology: it must be really simple, despite the many features").
 *
 * First the navy band (Victor, 21 Oct 2026, direction A: DashboardBand): the
 * greeting, the company acted for, how complete the profile is and four key
 * figures, each saying in words where it leads. Everything that can be pressed
 * shows it at rest, with the same pill ("Answer →", "Edit my profile ⌄"):
 * DashboardKit's ActionCue (Victor's second request that day: members who are
 * not at ease with technology must see what is clickable and what it opens).
 *
 * Then, from top to bottom: what blocks the account (the alerts), what waits
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
  /** The icon square's colour, by meaning (DashboardKit's IconTone). */
  iconTone: IconTone;
  title: string;
  count?: { value: number; label: string } | null;
  status: ReactNode;
  tone: TileTone;
  /** What pressing the tile does, in a few words ("Edit my profile"). */
  action: string;
}

/** Tiles per row: 1 on phones, 2 on tablets, 3 on desktops (the grid's own breakpoints). */
function useColumns(): number {
  const sm = useMediaQuery('(min-width: 640px)');
  const lg = useMediaQuery('(min-width: 1024px)');
  return lg ? 3 : sm ? 2 : 1;
}

export default function MemberDashboard() {
  const { t, i18n } = useTranslation();
  const { user, profile, organization, organizations, orgRole, isVerified, can, capabilitiesEnforced } = useAuth();
  const { isFeatureEnabled } = useEntitlements();
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const columns = useColumns();

  const { flags: regFlags, ready: regFlagsReady } = useRegistrationFlags();
  // Flag front_door (spec regspec-en.md §6 /dashboard): one status card instead of the
  // alerts, the e-mail proof banner, "Add my company"; a draft account (a new sign-up
  // waiting for its proof, an old unfinished one) gets the dashboard, not the wizard.
  // A sign-up v2 account gets the same (its company request is with M3), even while
  // front_door is still off: the old "finish your registration" would send it to the wizard.
  const v2Account = isV2Signup(profile);
  const frontDoor = regFlags.front_door || v2Account;
  const draftRaw = profile?.onboarding_status === 'draft';
  // Until the switches are known, a draft waits (no flash of the old "finish your registration").
  const draftWaiting = draftRaw && !regFlagsReady && !v2Account;
  const isDraft = draftRaw && !frontDoor;
  const active = !!user && !!profile && !isDraft && !draftWaiting;
  const access = useMemberAccess(active);
  const inbox = useInboxCount(active);
  const sm26 = useSm26Participation(active);
  // The agenda, read once: "Coming up" lists it, the band counts down to its next event.
  // Not for a draft (no dashboard to show it on).
  const agenda = useHomeAgenda(8, active);

  const uid = user?.id;
  const orgId = organization?.id;
  const orgType = organization?.organization_type ?? null;
  const persona = profile?.persona as string | undefined;
  const orgVerified = organization?.access_status === 'verified';
  const isOwner = orgRole === 'owner';
  const isDemand = DEMAND_PERSONAS.includes(persona ?? '');
  const isSupply = SUPPLY_PERSONAS.includes(persona ?? '');
  // Today: the investor persona, and a verified company. Once the rights switch is on
  // (src/lib/capabilities.ts): the company types, as the database (Deal flow also for
  // the verified SM26-confirmed investors: capability_person_grant).
  const showDealFlow = capabilitiesEnforced ? isVerified && can('see_dealflow') : persona === 'investor';
  const canSeeOpportunities = capabilitiesEnforced ? isVerified && can('see_opportunities') : isVerified && orgVerified;
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
    unified: regFlagsReady && newEventPagesOn(regFlags),
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
  const [switchOpen, setSwitchOpen] = useState(false);

  // The to-do list waits for the inbox count too (its answers come first), but
  // never for ever: the count is a hint, and it stays empty if its read fails.
  const [inboxWait, setInboxWait] = useState(true);
  useEffect(() => {
    const id = window.setTimeout(() => setInboxWait(false), 6000);
    return () => window.clearTimeout(id);
  }, []);

  /* ---------------------------------------------------------- not yet */

  if (!user || !profile) return null;
  if (draftWaiting) return <div aria-hidden="true" className="min-h-[40vh] bg-page" />;

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
      action: t('dash.todo.openMessages', 'Open messages'),
      onSelect: () => setPanel('inbox'),
    });
  }
  if (inbox.joins > 0) {
    todos.push({
      key: 'join', urgent: true, icon: UserPlus,
      title: t('dash.todo.join', { count: inbox.joins, defaultValue_one: 'Answer {{count}} person who wants to join your company', defaultValue_other: 'Answer {{count}} people who want to join your company' }),
      hint: t('dash.todo.joinHint', { org: orgName, defaultValue: 'They say they work at {{org}}.' }),
      action: t('dash.todo.review', 'Review'),
    });
  }
  // The M3 team asked a question about a registration: the answer is given on its page.
  if (data.eventInfo.count > 0) {
    todos.push({
      key: 'event_info', urgent: true, icon: MessageSquare,
      to: data.eventInfo.path ?? accountHref('registrations'),
      title: t('dash.todo.eventInfo', { count: data.eventInfo.count, defaultValue_one: 'Answer the M3 team about your registration', defaultValue_other: 'Answer the M3 team about {{count}} registrations' }),
      hint: t('dash.todo.eventInfoHint', 'They need one more detail before deciding.'),
      action: t('dash.todo.answer', 'Answer'),
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

  // Icon squares by meaning (DashboardKit's IconTone): who you are in navy, what
  // you take part in in teal, conversations and business in the accent.
  const loadingLine = t('dash.loadingShort', 'Loading…');
  const tiles: TileDef[] = [];

  // My profile
  {
    const noPhoto = !profile.avatar_url;
    const noJob = !profile.job_title;
    tiles.push({
      key: 'profile', panel: 'profile', icon: UserCircle, iconTone: 'navy', title: label('profile'),
      action: t('dash.act.editProfile', 'Edit my profile'),
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
    if (!organization && frontDoor) {
      // A participant is complete without a company: no "missing" mark (front_door).
      status = t('dash.st.noCompanyOptional', 'No company (optional)');
    } else if (!organization) {
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
    tiles.push({
      key: 'company', panel: 'company', icon: getHomeSection('company')!.icon, iconTone: 'navy', title: label('company'), status, tone,
      action: organization ? t('dash.act.editCompany', 'Edit my company page') : t('dash.addCompany', 'Add my company'),
    });
  }

  // My team (a company is needed). The number of people is said in words, not repeated in a pill.
  if (visible('team')) {
    const members = counts?.members ?? 0;
    const maxSeats = organization?.max_seats ?? 0;
    // The platform is free (Victor, 6 Oct 2026): no seat cap with account_signup_v2.
    const unlimited = orgType === 'marina' || orgType === 'developer' || regFlags.account_signup_v2;
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
    tiles.push({
      key: 'team', panel: 'team', icon: getHomeSection('team')!.icon, iconTone: 'navy', title: label('team'), status, tone,
      // "Requests" are the needs a member publishes (My requests): never this word here.
      action: isOwner && inbox.joins > 0 ? t('dash.act.seeWhoJoins', 'See who wants to join')
        : isOwner && counts && members <= 1 && roomForMore ? t('dash.act.invite', 'Invite a colleague')
          : t('dash.act.seeTeam', 'See my team'),
    });
  }

  // My events
  {
    const parts: string[] = [];
    if (data.eventInfo.count > 0) parts.push(t('dash.st.eventInfo', 'The M3 team needs a detail from you'));
    if (data.upcomingCount > 0) parts.push(t('dash.st.upcoming', { count: data.upcomingCount, defaultValue_one: '{{count}} upcoming event', defaultValue_other: '{{count}} upcoming events' }));
    if (sm26What === 'you') parts.push(t('dash.st.sm26You', 'You attended Smart Marina 2026'));
    else if (sm26What === 'team') parts.push(t('dash.st.sm26Team', 'Your team attended Smart Marina 2026'));
    else if (sm26What === 'company') parts.push(t('dash.st.sm26Company', 'Your company took part in Smart Marina 2026'));
    const status = data.loading ? loadingLine : parts.length > 0 ? parts.join(' · ')
      : data.pastCount > 0 ? t('dash.st.pastOnly', { count: data.pastCount, defaultValue_one: '{{count}} past event', defaultValue_other: '{{count}} past events' })
        : t('dash.st.noEvents', 'No registration yet');
    tiles.push({
      key: 'registrations', panel: 'registrations', icon: getHomeSection('registrations')!.icon, iconTone: 'teal', title: label('registrations'), status,
      tone: data.eventInfo.count > 0 ? 'action' : sm26What ? 'done' : 'plain',
      action: data.eventInfo.count > 0 ? t('dash.act.answerM3', 'Answer the M3 team') : t('dash.act.seeEvents', 'See my events'),
    });
  }

  // Messages: "3 unread messages · 1 message from a company waiting" (useInboxCount, the
  // navbar dot's count). The same words as the To do list; "requests" are My requests.
  {
    const parts: string[] = [];
    if (inbox.messages > 0) parts.push(t('dash.st.unreadMessages', { count: inbox.messages, defaultValue_one: '{{count}} unread message', defaultValue_other: '{{count}} unread messages' }));
    if (inbox.requests > 0) parts.push(t('dash.st.companyMessagesWaiting', { count: inbox.requests, defaultValue_one: '{{count}} message from a company waiting', defaultValue_other: '{{count}} messages from companies waiting' }));
    tiles.push({
      key: 'inbox', panel: 'inbox', icon: getHomeSection('inbox')!.icon, iconTone: 'accent', title: label('inbox'),
      tone: inbox.total > 0 ? 'action' : 'plain',
      action: inbox.total > 0 ? t('dash.act.readAnswer', 'Read and answer') : t('dash.act.openMessages', 'Open my messages'),
      status: !inbox.loaded ? loadingLine : parts.length > 0
        ? parts.join(' · ')
        : t('dash.st.noNewMessages', 'No new messages'),
      count: { value: inbox.total, label: t('dash.waitingSr', { count: inbox.total, defaultValue_one: '{{count}} waiting', defaultValue_other: '{{count}} waiting' }) },
    });
  }

  // My requests
  tiles.push({
    key: 'requests', panel: 'requests', icon: getHomeSection('requests')!.icon, iconTone: 'accent', title: label('requests'), tone: 'plain',
    // It opens the panel (whose first button publishes): "Publish a need" is the band's, which opens the window itself.
    action: t('dash.act.seeRequests', 'See my requests'),
    // Every request sent, whatever M3 decided: the panel says where each one stands.
    status: data.loading ? loadingLine : requestTotal > 0
      ? t('dash.st.requestsSent', { count: requestTotal, defaultValue_one: '{{count}} request sent', defaultValue_other: '{{count}} requests sent' })
      : createActions.length > 0 ? t('dash.st.publishFirst', 'Nothing yet. Publish a need') : t('dash.st.nothingPublished', 'Nothing published yet'),
  });

  // Only for some members
  if (visible('shortlist')) {
    tiles.push({
      key: 'shortlist', panel: 'shortlist', icon: getHomeSection('shortlist')!.icon, iconTone: 'teal', title: label('shortlist'), tone: 'plain',
      action: t('dash.act.seeSaved', 'See saved companies'),
      status: data.shortlistCount === null || data.loading ? loadingLine : data.shortlistCount === 0
        ? t('dash.st.noneSaved', 'None saved yet')
        : t('dash.st.saved', { count: data.shortlistCount, defaultValue_one: '{{count}} company saved', defaultValue_other: '{{count}} companies saved' }),
    });
  }
  if (showDealFlow) {
    tiles.push({
      key: 'dealflow', to: '/investments', icon: TrendingUp, iconTone: 'accent', title: t('dash.tiles.dealflow', 'Deal flow'), tone: 'plain',
      status: t('dash.st.dealflow', 'Marina projects looking for investors'),
      action: t('dash.act.seeProjects', 'See the projects'),
    });
  }
  if (visible('sponsorship')) {
    tiles.push({
      key: 'sponsorship', panel: 'sponsorship', icon: Award, iconTone: 'accent', tone: 'plain',
      action: isSponsor ? t('dash.act.openSponsorship', 'Open my sponsorship') : t('dash.act.openHub', 'Open the hub'),
      title: isSponsor ? label('sponsorship') : t('dash.tiles.sponsorshipHub', 'Sponsorship hub'),
      status: isSponsor ? t('dash.st.sponsor', 'Your package and what to send us') : t('dash.st.hub', 'Agreements and follow-up for every sponsor'),
    });
  }
  if (visible('press')) {
    tiles.push({
      key: 'press', panel: 'press', icon: getHomeSection('press')!.icon, iconTone: 'teal', title: label('press'), tone: 'plain',
      status: t('dash.st.press', 'Media kits and your articles'),
      action: t('dash.act.openPress', 'Open the press room'),
    });
  }
  if (visible('references')) {
    tiles.push({
      key: 'references', panel: 'references', icon: getHomeSection('references')!.icon, iconTone: 'teal', title: label('references'), tone: 'plain',
      action: !data.references || data.references.total === 0 ? t('dash.act.askReference', 'Ask for a reference') : t('dash.act.seeReferences', 'See my references'),
      status: !data.references || data.references.total === 0
        ? t('dash.st.noRefs', 'Ask marinas you worked with to vouch for you')
        : t('dash.st.refs', { confirmed: data.references.confirmed, waiting: data.references.waiting, defaultValue: '{{confirmed}} confirmed · {{waiting}} waiting' }),
    });
  }

  /* ---------------------------------------------------------- the band */

  // A key figure opens its panel; when that panel is open already, it is brought back into view.
  const goToPanel = (key: HomePanel) => {
    if (openPanel !== key) { setPanel(key); return; }
    const el = document.getElementById(panelDomId(key));
    if (!el) return;
    window.scrollTo({ top: scrollTopUnderBars(el, 0, 16), behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    document.getElementById(`${panelDomId(key)}-title`)?.focus({ preventScroll: true });
  };
  // "See what is missing": the To do list, right under the band, with the focus on its title.
  const goToTodo = () => {
    const title = document.getElementById('todo-title');
    const box = title?.closest('section');
    if (!title || !box) return;
    window.scrollTo({ top: scrollTopUnderBars(box, 0, 16), behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    title.focus({ preventScroll: true });
  };

  // How complete: exactly the To do list's own checks (photo and job title; for the
  // company's owner, logo, description, sectors once counted, cover photo).
  let completeness: Completeness | null = null;
  {
    const checks = [!!profile.avatar_url, !!profile.job_title];
    const withCompany = !!organization && isOwner;
    const companyPending = withCompany && !companyReady;
    if (withCompany && companyReady) {
      checks.push(brand.logo, brand.description, brand.banner);
      if (counts) checks.push(brand.sectors);
    }
    // For the owner the company's page counts too, and the words say so ("Profile and company page 50% complete").
    if (!companyPending) completeness = { done: checks.filter(Boolean).length, total: checks.length, includesCompany: withCompany };
  }

  const figures: BandFigure[] = [];
  // 1. What waits for my answer in Messages (the navbar dot's count: unread messages + first messages).
  figures.push({
    key: 'inbox',
    kicker: label('inbox'),
    value: inbox.loaded ? String(inbox.total) : null,
    label: inbox.total === 0
      ? t('dash.band.noMessages', 'No message waiting for your answer')
      : t('dash.band.messagesWaiting', { count: inbox.total, defaultValue_one: 'message waiting for your answer', defaultValue_other: 'messages waiting for your answer' }),
    action: inbox.total > 0 ? t('dash.band.answer', 'Answer') : t('dash.band.seeMessages', 'See messages'),
    onClick: () => goToPanel('inbox'),
  });
  // 2. The company's owner: people asking to join. Another member: the team. No company: my registrations.
  if (organization && visible('team') && isOwner) {
    figures.push({
      key: 'joins',
      kicker: label('team'),
      value: inbox.loaded ? String(inbox.joins) : null,
      label: inbox.joins === 0
        ? t('dash.band.noJoins', 'Nobody waiting to join your company')
        : t('dash.band.joins', { count: inbox.joins, defaultValue_one: 'person wants to join your company', defaultValue_other: 'people want to join your company' }),
      action: inbox.joins > 0 ? t('dash.band.review', 'Review') : t('dash.band.seeTeam', 'See my team'),
      onClick: () => goToPanel('team'),
    });
  } else if (organization && visible('team')) {
    figures.push({
      key: 'team',
      kicker: label('team'),
      value: counts ? String(counts.members) : null,
      label: t('dash.band.teamPeople', { count: counts?.members ?? 0, defaultValue_one: 'person in your team', defaultValue_other: 'people in your team' }),
      action: t('dash.band.seeTeam', 'See my team'),
      onClick: () => goToPanel('team'),
    });
  } else {
    figures.push({
      key: 'registrations',
      kicker: label('registrations'),
      value: data.loading ? null : String(data.upcomingCount),
      label: data.upcomingCount === 0
        ? t('dash.band.noUpcoming', 'No upcoming registration')
        : t('dash.band.upcoming', { count: data.upcomingCount, defaultValue_one: 'upcoming event you are registered for', defaultValue_other: 'upcoming events you are registered for' }),
      action: t('dash.band.seeEvents', 'See my events'),
      onClick: () => goToPanel('registrations'),
    });
  }
  // 3. Requests sent (the My requests tile's count); none yet: straight to "Publish a need" when allowed.
  {
    const publishFirst = requestTotal === 0 && createActions.length > 0;
    figures.push({
      key: 'requests',
      kicker: label('requests'),
      value: data.loading ? null : String(requestTotal),
      label: requestTotal === 0
        ? t('dash.band.noRequests', 'No request sent yet')
        : t('dash.band.requestsSent', { count: requestTotal, defaultValue_one: 'request sent', defaultValue_other: 'requests sent' }),
      action: requestTotal > 0 ? t('dash.band.seeThem', 'See them') : publishFirst ? t('dash.band.publish', 'Publish a need') : t('dash.band.seeRequests', 'See requests'),
      onClick: publishFirst ? () => setPublishOpen(true) : () => goToPanel('requests'),
    });
  }
  // 4. The next event: mine (registered) first, else the agenda's next one. D-37 in big, the words under it.
  {
    const nowMs = Date.now();
    const nextAgenda = agendaAhead(agenda.entries, nowMs).find((e) => Date.parse(e.at) >= nowMs) ?? null;
    // Mine are known once the dashboard has loaded: no agenda event shown first, then replaced.
    const waiting = data.loading || (!nextReg && agenda.loading);
    const next = waiting ? null : nextReg
      ? { title: nextReg.title, at: nextReg.date_time, end: nextReg.end_date_time, href: eventPath(nextReg), mine: true }
      : nextAgenda ? { title: nextAgenda.title, at: nextAgenda.at, end: null as string | null, href: nextAgenda.href, mine: false } : null;
    // Not mine: "Next on the agenda", so it never contradicts the hero's featured summit above.
    const kicker = next?.mine ? t('dash.band.yourNextEvent', 'Your next event') : t('dash.band.nextOnAgenda', 'Next on the agenda');
    if (!next) {
      figures.push({
        key: 'event', kicker,
        value: waiting ? null : '—',
        valueDecorative: true,
        label: waiting ? '' : t('dash.band.noEvent', 'No event planned yet'),
        action: t('dash.band.allEvents', 'See all events'),
        to: '/events',
      });
    } else {
      const startMs = Date.parse(next.at);
      const endMs = next.end ? Date.parse(next.end) : startMs + DEFAULT_DURATION_MS;
      const start = new Date(startMs);
      const today = new Date(nowMs);
      const days = Math.round(
        (new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime()
          - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / 86_400_000,
      );
      const live = startMs <= nowMs && nowMs < endMs;
      // The date in words ("Fri 30 Oct"), not "In 2 days": "Your next event" below counts in
      // days and hours, and the two must never seem to disagree. D-xx counts calendar days.
      const dateWords = start.toLocaleDateString(lang, { weekday: 'short', day: 'numeric', month: 'short' });
      figures.push({
        key: 'event', kicker,
        value: live ? t('dash.band.now', 'Now') : days <= 0 ? t('dash.band.today', 'Today') : `D-${days}`,
        valueDecorative: true,
        label: next.title,
        hoverTitle: next.title,
        meta: live ? t('dash.band.happeningNow', 'Happening now')
          : days <= 0 ? t('dash.band.startsToday', 'Starts today')
            : dateWords,
        action: t('dash.band.viewEvent', 'View event'),
        to: next.href,
      });
    }
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
          iconTone={tile.iconTone}
          action={tile.action}
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
        {/* ── The navy band: greeting, company, how complete, four key figures ── */}
        <div className="mb-8 md:mb-10">
          <DashboardBand
            firstName={profile.first_name?.trim() || null}
            orgName={orgName}
            hasOrganization={!!organization}
            orgVerified={orgVerified}
            onSwitchCompany={organizations.length > 1 ? () => setSwitchOpen(true) : undefined}
            completeness={completeness}
            onSeeMissing={goToTodo}
            figures={figures}
          />
        </div>

        {/* ── Account alerts, above everything else (front_door: the proof banner, one status card, Add my company) ── */}
        {frontDoor
          ? <AccountStatus onOpen={setPanel} hasOrganization={!!organization} orgName={orgName} orgVerified={orgVerified} signupV2={regFlags.account_signup_v2} />
          : <Alerts onOpen={setPanel} hasOrganization={!!organization} orgName={orgName} orgVerified={orgVerified} />}

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
              <ComingUpList registeredIds={data.registeredIds} entries={agenda.entries} loading={agenda.loading} />
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
                            {/* A match is plain words with a mark, never a pill: it cannot be pressed apart from the row. */}
                            {o.matches && (
                              <span className="font-semibold text-teal-text">
                                {' · '}<Sparkles className="inline h-3 w-3 -translate-y-px" aria-hidden="true" /> {t('dashboard.opportunitiesMatch')}
                              </span>
                            )}
                          </>
                        )}
                        cue={t('dash.cue.view', 'View')}
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
            <CardLink to="/resources">{t('dashboard.seeAllResources', 'Browse the library')}</CardLink>
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
                      {/* A tag, squared: only what can be pressed is a pill ("Read →" below). */}
                      <span className="absolute left-3 top-3 rounded-[6px] bg-white/95 px-2 py-0.5 text-[12px] font-semibold text-navy">
                        {t(`resources.types.${r.type}`, r.type)}
                      </span>
                    </CoverImage>
                  </CardMedia>
                  <div className="flex flex-1 flex-col p-4">
                    <h4 className="text-[16px] font-semibold leading-6 text-navy">
                      <StretchedLink to={resourcePath(r)} arrow={false} className="[overflow-wrap:anywhere]">{r.title}</StretchedLink>
                    </h4>
                    {r.summary && <p className="mt-1.5 line-clamp-2 text-[14px] leading-5 text-meta">{r.summary}</p>}
                    {/* What pressing the card does (the whole card is the link). */}
                    <span aria-hidden="true" className="mt-auto flex pt-3">
                      <ActionCue size="sm">{r.type === 'replay' ? t('dash.cue.watch', 'Watch') : t('dash.cue.read', 'Read')}</ActionCue>
                    </span>
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
      {organizations.length > 1 && <SwitchCompanyDialog open={switchOpen} onOpenChange={setSwitchOpen} />}
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
  return (
    <>
      {pending && (
        <MemberBanner
          tone="warning"
          icon={Clock}
          title={(
            <>
              {t('dashboard.statusPendingTitle')}{' '}
              <HelpTip title={t('help.tips.reviewTitle', 'Why M3 checks your account')} label={t('dash.helpWhy', 'Why?')} more="verification-why">
                {t('help.tips.reviewWhy', 'M3 checks every company and every person, so members know who they talk to. You do not need to do anything for the check.')}
              </HelpTip>
            </>
          )}
          // A pending account cannot register for events yet (database rule event_reg_insert): it can look at them.
          body={t('memberHome.alerts.pendingWhile', 'The M3 team reviews each new account, usually within 24 to 48 business hours, and e-mails you as soon as yours is approved. Meanwhile, the public resources are open to you, and you can look at the coming events.')}
          action={(
            <nav aria-label={t('dashboard.pendingMeanwhile', 'While you wait')} className="flex flex-col items-start gap-2 sm:items-end">
              <CardButton onClick={() => onOpen('profile')}>{t('dashboard.pendingProfile', 'Complete your profile')}</CardButton>
              <CardLink to="/resources">{t('dashboard.pendingLibrary', 'Read the library')}</CardLink>
              <CardLink to="/events?type=webinar">{t('dashboard.pendingWebinarsSee', 'See the coming webinars')}</CardLink>
              <CardLink to="/contact">{t('dashboard.pendingContact', 'Write to the M3 team')}</CardLink>
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
              <HelpTip title={t('help.tips.rejectedTitle', 'What you can do now')} label={t('dash.helpWhatNow', 'What now?')} more="verification-rejected">
                {t('help.tips.rejected', 'Read the reason, correct your details with “Edit and resubmit”, and the M3 team looks again. Think it is a mistake? Write to us.')}
              </HelpTip>
            </>
          )}
          body={profile.rejection_reason ? t('dashboard.statusRejectedBody', { reason: profile.rejection_reason }) : undefined}
          action={(
            <div className="flex flex-col items-start gap-2 sm:items-end">
              <CardLink to="/onboarding">{t('accountArea.banner.resubmit', 'Edit and resubmit')}</CardLink>
              <CardLink to="/contact">{t('dashboard.contactUs', 'Contact us')}</CardLink>
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
              <HelpTip title={t('help.tips.orgReviewTitle', 'Your company is checked too')} label={t('dash.helpWhy', 'Why?')} more="verification-company">
                {t('help.tips.orgReviewNothing', 'There is nothing more to do. M3 usually checks a company within 24 to 48 business hours, and this notice goes away once it is approved.')}
              </HelpTip>
            </>
          )}
          // The opportunities follow the person's approval (has_marketplace_access), not the company's.
          // "Such as": what opens depends on the profile (an investor never publishes a need).
          body={t('dashboard.orgPendingSomeNoWebinar', 'Some features, such as writing to other companies or publishing a need, open once your company is approved.')}
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
            <CardButton onClick={() => onOpen('company')}>
              {hasOrganization ? t('homeSections.completeProfileCta', 'Complete my profile') : t('dash.addCompany', 'Add my company')}
            </CardButton>
          )}
        />
      )}
    </>
  );
}
