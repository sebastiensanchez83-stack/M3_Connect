import {
  Award, BadgeCheck, Bell, Building2, CalendarDays, ClipboardList, Inbox, Newspaper, Star, UserCircle,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/**
 * The member's own area, as one model shared by the home dashboard, the
 * navbar (avatar menu, mobile menu), the footer and every link into it.
 *
 * Since October 2026 a signed-in member manages everything from the home page:
 * `/` shows "Welcome back", then the dashboard, whose blocks open the real
 * editors in place. A block that is open is in the address, so it can be
 * linked and survives a reload:
 *
 *   /?open=<panel>[&section=<sub>]      e.g. /?open=organization&section=team
 *
 * The old addresses keep working (notification e-mails and bookmarks use them):
 * /dashboard goes to `/`, /account?tab=<tab>[&section=…] to the matching panel
 * (legacyTabTarget below), /sm26/me to the events block. Tab values stay
 * readable here for that reason: never rename one.
 */

/** The old /account?tab= values: still in e-mails already sent, so all of them keep a target. */
export type AccountTab =
  | 'registrations'
  | 'event'
  | 'inbox'
  | 'shortlist'
  | 'projects'
  | 'rfps'
  | 'consultations'
  | 'webinars'
  | 'submissions'
  | 'organization'
  | 'references'
  | 'sponsorship'
  | 'press'
  | 'profile'
  | 'notifications';

/** The blocks of the home dashboard that open an editor in place (`/?open=<panel>`). */
export type HomePanel =
  | 'profile'
  | 'notifications'
  | 'organization'
  | 'registrations'
  | 'inbox'
  | 'requests'
  | 'references'
  | 'sponsorship'
  | 'press'
  | 'shortlist';

export type HomeGroupKey = 'company' | 'events' | 'requests' | 'forMe';

export interface HomeGroup {
  key: HomeGroupKey;
  labelKey: string;
  fallback: string;
}

export interface HomeSection {
  key: HomePanel;
  group: HomeGroupKey;
  labelKey: string;
  fallback: string;
  /** One line, used where there is room (the cards, the mobile menu). */
  descKey: string;
  descFallback: string;
  icon: LucideIcon;
}

export const HOME_GROUPS: HomeGroup[] = [
  { key: 'company', labelKey: 'memberHome.groups.company', fallback: 'Profile & company' },
  { key: 'events', labelKey: 'memberHome.groups.events', fallback: 'Registrations & events' },
  { key: 'requests', labelKey: 'memberHome.groups.requests', fallback: 'Requests & messages' },
  { key: 'forMe', labelKey: 'memberHome.groups.forMe', fallback: 'For me' },
];

export const HOME_SECTIONS: HomeSection[] = [
  {
    key: 'profile', group: 'company', icon: UserCircle,
    labelKey: 'memberHome.sections.profile', fallback: 'My profile',
    descKey: 'memberHome.sections.profileDesc', descFallback: 'Photo, name, job title and password',
  },
  {
    key: 'notifications', group: 'company', icon: Bell,
    labelKey: 'memberHome.sections.notifications', fallback: 'Email notifications',
    descKey: 'memberHome.sections.notificationsDesc', descFallback: 'Which emails you receive',
  },
  {
    key: 'organization', group: 'company', icon: Building2,
    labelKey: 'memberHome.sections.organization', fallback: 'Organisation & team',
    descKey: 'memberHome.sections.organizationDesc', descFallback: 'Company page, logo, details and team',
  },
  {
    key: 'registrations', group: 'events', icon: CalendarDays,
    labelKey: 'memberHome.sections.registrations', fallback: 'My events',
    descKey: 'memberHome.sections.registrationsDesc', descFallback: 'Registrations, payments and replays',
  },
  {
    key: 'inbox', group: 'requests', icon: Inbox,
    labelKey: 'memberHome.sections.inbox', fallback: 'Inbox',
    descKey: 'memberHome.sections.inboxDesc', descFallback: 'Connection and team requests',
  },
  {
    key: 'requests', group: 'requests', icon: ClipboardList,
    labelKey: 'memberHome.sections.requests', fallback: 'My requests',
    descKey: 'memberHome.sections.requestsDesc', descFallback: 'Projects, RFPs, consultations and webinar proposals',
  },
  {
    key: 'references', group: 'requests', icon: BadgeCheck,
    labelKey: 'memberHome.sections.references', fallback: 'Recommendations',
    descKey: 'memberHome.sections.referencesDesc', descFallback: 'References from marinas you worked with',
  },
  {
    key: 'sponsorship', group: 'requests', icon: Award,
    labelKey: 'memberHome.sections.sponsorship', fallback: 'Sponsorship',
    descKey: 'memberHome.sections.sponsorshipDesc', descFallback: 'Your sponsor package and assets',
  },
  {
    key: 'press', group: 'requests', icon: Newspaper,
    labelKey: 'memberHome.sections.press', fallback: 'Press room',
    descKey: 'memberHome.sections.pressDesc', descFallback: 'Media kits and press materials',
  },
  {
    key: 'shortlist', group: 'forMe', icon: Star,
    labelKey: 'memberHome.sections.shortlist', fallback: 'Shortlist',
    descKey: 'memberHome.sections.shortlistDesc', descFallback: 'Companies you saved',
  },
];

const PANEL_KEYS = new Set<string>(HOME_SECTIONS.map((s) => s.key));

export function isHomePanel(value: string | null | undefined): value is HomePanel {
  return !!value && PANEL_KEYS.has(value);
}

export function getHomeSection(key: string | null | undefined): HomeSection | null {
  return HOME_SECTIONS.find((s) => s.key === key) ?? null;
}

/** The member home, optionally with one block open (and one of its sections). */
export function memberHomeHref(panel?: HomePanel | null, section?: string | null): string {
  if (!panel) return '/';
  const params = new URLSearchParams({ open: panel });
  if (section) params.set('section', section);
  return `/?${params.toString()}`;
}

/** The kinds of the merged "My requests" block, in its order (also the old tab values). */
export const REQUEST_KINDS = ['projects', 'rfps', 'consultations', 'webinars'] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];

/**
 * Where an old /account?tab=<tab>[&section=…] lands now: a panel of the home
 * dashboard, or null for the top of the home page (?tab=dashboard, a bare
 * /account, an unknown value). ?tab=pricing depends on the account (the sponsor
 * portal for an account linked to a sponsor), so the caller decides; this
 * gives the default, the events block.
 */
export function legacyTabTarget(tab: string | null | undefined, section?: string | null): { panel: HomePanel; section?: string } | null {
  switch (tab) {
    case 'profile':
    case 'notifications':
    case 'registrations':
    case 'inbox':
    case 'shortlist':
    case 'references':
    case 'sponsorship':
    case 'press':
      return { panel: tab };
    case 'organization':
      return section ? { panel: 'organization', section } : { panel: 'organization' };
    // The SM26 hub tab: the event is over, its participants find their mark in the events block.
    case 'event':
    case 'pricing':
      return { panel: 'registrations' };
    case 'b2b-requests':
      return { panel: 'inbox' };
    // "All submissions" and the four lists it repeated are one block now.
    case 'submissions':
      return { panel: 'requests' };
    case 'projects':
    case 'rfps':
    case 'consultations':
    case 'webinars':
      return { panel: 'requests', section: tab };
    default:
      return null;
  }
}

/**
 * Where a part of the member area lives. Every internal link goes through
 * here, so moving a block moves every link to it. 'complete-registration' is
 * the one screen that stays on /account: a draft account is sent there until
 * its sign-up is finished.
 */
export function accountHref(tab: AccountTab | 'dashboard' | 'complete-registration', section?: string): string {
  if (tab === 'complete-registration') return '/account?tab=complete-registration';
  if (tab === 'dashboard') return '/';
  const target = legacyTabTarget(tab, section);
  return target ? memberHomeHref(target.panel, target.section) : '/';
}

/** What decides which blocks a member sees. */
export interface HomeSectionContext {
  persona: string | null | undefined;
  orgType: string | null | undefined;
  /** Null while the server has not answered yet: the blocks that depend on it stay hidden. */
  access: { media: boolean; sponsor: boolean; manager: boolean } | null;
}

/**
 * Which blocks apply to this member: the old account menu's own rules. Every
 * member has a profile, notifications, an organisation, events, an inbox and
 * requests (webinar proposals are open to all).
 */
export function homeSectionVisible(key: HomePanel, ctx: HomeSectionContext): boolean {
  switch (key) {
    case 'shortlist':
      return ctx.persona === 'marina' || ctx.persona === 'developer' || ctx.persona === 'investor';
    case 'references':
      return ctx.orgType === 'partner';
    case 'sponsorship':
      return !!ctx.access && (ctx.access.sponsor || ctx.access.manager);
    case 'press':
      return !!ctx.access && ctx.access.media;
    default:
      return true;
  }
}
