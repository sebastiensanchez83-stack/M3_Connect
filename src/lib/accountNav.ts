import {
  Ship, Newspaper, Award, Building2, UserCircle, CalendarDays, Anchor, Radio,
  ClipboardList, MessageSquare, BadgeCheck, FileText, Inbox, Star, Bell,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/**
 * The member's own area — everything under /account — as one model shared by
 * the account page's menu, the navbar's avatar menu and the dashboard's
 * shortcuts, so the three can never name or order things differently.
 *
 * Before: one flat list of up to 17 tabs ("Dashboard, Event hub, Press room,
 * Sponsorship, Organization, Profile, Registrations, Projects, Webinars, RFPs,
 * Consultations, Recommendations, My Submissions, Inbox, Shortlist, Pricing,
 * Notifications"), mixing what I do, what I asked for, what my company is and
 * how my account is set up. Now four groups, each answering one question.
 *
 * Which sections a given member sees is decided where the data is — the
 * account page knows the persona, the entitlements, whether there is an SM26
 * registration — this file only says what each section is and where it lives.
 *
 * Tab values are URLs: notification emails deep-link to /account?tab=<value>,
 * so a value must never be renamed. Labels can change freely. A retired value
 * keeps a redirect in AccountPage: ?tab=pricing (the old "Plan & billing",
 * later "Membership & sponsorship" level comparison, removed because the
 * platform is free) lands on ?tab=sponsorship for an account linked to a
 * sponsor, otherwise on ?tab=registrations, where payments due are shown.
 */

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

export type AccountGroupKey = 'activity' | 'requests' | 'organization' | 'account';

export interface AccountGroup {
  key: AccountGroupKey;
  labelKey: string;
  fallback: string;
}

export interface AccountSection {
  value: AccountTab;
  group: AccountGroupKey;
  labelKey: string;
  fallback: string;
  /** One line, used where there is room (dashboard shortcuts, mobile menu). */
  descKey: string;
  descFallback: string;
  icon: LucideIcon;
}

export const ACCOUNT_GROUPS: AccountGroup[] = [
  { key: 'activity', labelKey: 'accountNav.groups.activity', fallback: 'My activity' },
  { key: 'requests', labelKey: 'accountNav.groups.requests', fallback: 'My requests' },
  { key: 'organization', labelKey: 'accountNav.groups.organization', fallback: 'My organization' },
  { key: 'account', labelKey: 'accountNav.groups.account', fallback: 'My account' },
];

export const ACCOUNT_SECTIONS: AccountSection[] = [
  // ── What I'm taking part in ──
  {
    value: 'registrations', group: 'activity', icon: CalendarDays,
    labelKey: 'accountNav.registrations', fallback: 'My events',
    descKey: 'accountNav.registrationsDesc', descFallback: 'Registrations, tickets and replays',
  },
  {
    value: 'event', group: 'activity', icon: Ship,
    labelKey: 'accountNav.event', fallback: 'Event hub',
    descKey: 'accountNav.eventDesc', descFallback: 'Your event badge, programme and documents',
  },
  {
    value: 'inbox', group: 'activity', icon: Inbox,
    labelKey: 'accountNav.inbox', fallback: 'Inbox',
    descKey: 'accountNav.inboxDesc', descFallback: 'Connection and team requests',
  },
  {
    value: 'shortlist', group: 'activity', icon: Star,
    labelKey: 'accountNav.shortlist', fallback: 'Shortlist',
    descKey: 'accountNav.shortlistDesc', descFallback: 'Companies you saved',
  },
  // ── What I've put out there ──
  {
    value: 'projects', group: 'requests', icon: Anchor,
    labelKey: 'accountNav.projects', fallback: 'Projects',
    descKey: 'accountNav.projectsDesc', descFallback: 'Needs you submitted to service providers',
  },
  {
    value: 'rfps', group: 'requests', icon: ClipboardList,
    labelKey: 'accountNav.rfps', fallback: 'RFPs',
    descKey: 'accountNav.rfpsDesc', descFallback: 'Your formal requests for proposals',
  },
  {
    value: 'consultations', group: 'requests', icon: MessageSquare,
    labelKey: 'accountNav.consultations', fallback: 'Consultations',
    descKey: 'accountNav.consultationsDesc', descFallback: 'Questions put to experts',
  },
  {
    value: 'webinars', group: 'requests', icon: Radio,
    labelKey: 'accountNav.webinars', fallback: 'Webinar proposals',
    descKey: 'accountNav.webinarsDesc', descFallback: 'Talks you proposed to give',
  },
  {
    value: 'submissions', group: 'requests', icon: FileText,
    labelKey: 'accountNav.submissions', fallback: 'All submissions',
    descKey: 'accountNav.submissionsDesc', descFallback: 'Everything you sent, in one list',
  },
  // ── Who I represent ──
  {
    value: 'organization', group: 'organization', icon: Building2,
    labelKey: 'accountNav.organization', fallback: 'Organization & team',
    descKey: 'accountNav.organizationDesc', descFallback: 'Company profile, logo, team members',
  },
  {
    value: 'references', group: 'organization', icon: BadgeCheck,
    labelKey: 'accountNav.references', fallback: 'Recommendations',
    descKey: 'accountNav.referencesDesc', descFallback: 'References from marinas you worked with',
  },
  {
    value: 'sponsorship', group: 'organization', icon: Award,
    labelKey: 'accountNav.sponsorship', fallback: 'Sponsorship',
    descKey: 'accountNav.sponsorshipDesc', descFallback: 'Your sponsor package and assets',
  },
  {
    value: 'press', group: 'organization', icon: Newspaper,
    labelKey: 'accountNav.press', fallback: 'Press room',
    descKey: 'accountNav.pressDesc', descFallback: 'Media kits and press materials',
  },
  // ── How my account is set up ──
  {
    value: 'profile', group: 'account', icon: UserCircle,
    labelKey: 'accountNav.profile', fallback: 'Profile',
    descKey: 'accountNav.profileDesc', descFallback: 'Your name, photo and job title',
  },
  {
    value: 'notifications', group: 'account', icon: Bell,
    labelKey: 'accountNav.notifications', fallback: 'Notifications',
    descKey: 'accountNav.notificationsDesc', descFallback: 'Which emails you receive',
  },
];

/** Where a section lives. The inbox has its own top-level route; the rest are tabs. */
export function accountHref(tab: AccountTab | 'dashboard' | 'complete-registration'): string {
  if (tab === 'dashboard') return '/dashboard';
  if (tab === 'inbox') return '/inbox';
  return `/account?tab=${tab}`;
}

export function getAccountSection(value: string | null | undefined): AccountSection | null {
  return ACCOUNT_SECTIONS.find((s) => s.value === value) ?? null;
}
