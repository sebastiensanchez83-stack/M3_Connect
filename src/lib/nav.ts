import {
  LayoutDashboard, BookOpen, CalendarDays, Building2, Compass,
  Briefcase, TrendingUp, UserPlus, Info, FileText, Ship,
  MessageSquare, Mic2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/**
 * The single source of truth for the platform's navigation.
 *
 * Before this file the navbar built its links inline, which is how we ended up
 * with the word "partner" meaning three different things in the same bar:
 * /partners (companies on a paying tier), the first tab of /network (every
 * organization) and /become-partner (the signup). Naming is a navigation
 * problem, so the names live here, once.
 *
 * Two distinct bars, because a verified marina manager and a first-time
 * visitor are not looking for the same thing:
 *   - PUBLIC_NAV  — what the platform is, for someone not signed in
 *   - MEMBER_NAV  — the product, for someone signed in
 *
 * `labelKey` goes through i18next with `fallback` as the literal default, so a
 * missing translation degrades to readable English instead of a raw key.
 */

export interface NavItem {
  href: string;
  labelKey: string;
  fallback: string;
  /** One line shown under the label in the mobile drawer. */
  descKey: string;
  descFallback: string;
  icon: LucideIcon;
}

/** Signed out: what we are and what's inside, nothing that needs an account. */
export const PUBLIC_NAV: NavItem[] = [
  {
    href: '/directory',
    labelKey: 'nav.directory',
    fallback: 'Directory',
    descKey: 'nav.directoryDesc',
    descFallback: 'Marinas, service providers, investors and media',
    icon: Compass,
  },
  {
    href: '/resources',
    labelKey: 'nav.resources',
    fallback: 'Resources',
    descKey: 'nav.resourcesDesc',
    descFallback: 'Articles, guides, whitepapers and replays',
    icon: BookOpen,
  },
  {
    href: '/events',
    labelKey: 'nav.events',
    fallback: 'Events',
    descKey: 'nav.eventsDesc',
    descFallback: 'Conferences in Monaco and Dubai, webinars online',
    icon: CalendarDays,
  },
  {
    href: '/partners',
    labelKey: 'nav.partners',
    fallback: 'Partners',
    descKey: 'nav.partnersDesc',
    descFallback: 'The companies that sponsor our events',
    icon: Building2,
  },
  {
    href: '/about',
    labelKey: 'nav.about',
    fallback: 'About',
    descKey: 'nav.aboutDesc',
    descFallback: 'Who we are and how the platform works',
    icon: Info,
  },
];

/** Signed in: the product. Five nouns, no overlap between any two of them. */
export const MEMBER_NAV: NavItem[] = [
  {
    href: '/dashboard',
    labelKey: 'nav.dashboard',
    fallback: 'Dashboard',
    descKey: 'nav.dashboardDesc',
    descFallback: 'What needs your attention',
    icon: LayoutDashboard,
  },
  {
    href: '/directory',
    labelKey: 'nav.directory',
    fallback: 'Directory',
    descKey: 'nav.directoryDesc',
    descFallback: 'Marinas, service providers, investors and media',
    icon: Compass,
  },
  {
    href: '/opportunities',
    labelKey: 'nav.opportunities',
    fallback: 'Opportunities',
    descKey: 'nav.opportunitiesDesc',
    descFallback: 'Open RFPs, consultations and projects',
    icon: Briefcase,
  },
  {
    href: '/resources',
    labelKey: 'nav.resources',
    fallback: 'Resources',
    descKey: 'nav.resourcesDesc',
    descFallback: 'Articles, guides, whitepapers and replays',
    icon: BookOpen,
  },
  {
    href: '/events',
    labelKey: 'nav.events',
    fallback: 'Events',
    descKey: 'nav.eventsDesc',
    descFallback: 'Conferences in Monaco and Dubai, webinars online',
    icon: CalendarDays,
  },
];

/** Only personas that actually have a deal flow see this one. */
export const DEAL_FLOW_ITEM: NavItem = {
  href: '/investments',
  labelKey: 'nav.dealFlow',
  fallback: 'Deal flow',
  descKey: 'nav.dealFlowDesc',
  descFallback: 'Startups raising, matched to your thesis',
  icon: TrendingUp,
};

/** Shown in the public bar as the call to action, never to a signed-in member. */
export const JOIN_ITEM: NavItem = {
  href: '/become-partner',
  labelKey: 'nav.becomePartner',
  fallback: 'Join the network',
  descKey: 'nav.becomePartnerDesc',
  descFallback: 'Free for every member',
  icon: UserPlus,
};

/**
 * The things a member creates. These used to sit under "Actions" inside the
 * avatar dropdown — the platform's whole reason to exist, two levels deep
 * behind an icon that reads as account settings. They now get a primary
 * button of their own in the bar.
 *
 * `capability` is resolved by the navbar against the user's persona,
 * verification state and entitlements; this file says nothing about who may
 * do what.
 */
export type CreateCapability =
  | 'submit_project'
  | 'submit_rfp'
  | 'submit_consultation'
  | 'request_webinar';

export interface CreateAction extends NavItem {
  capability: CreateCapability;
}

export const CREATE_ACTIONS: CreateAction[] = [
  {
    capability: 'submit_project',
    href: '/submit-project',
    labelKey: 'nav.submitProject',
    fallback: 'Submit a project',
    descKey: 'nav.submitProjectDesc',
    descFallback: 'Find service providers for a specific need',
    icon: FileText,
  },
  {
    capability: 'submit_rfp',
    href: '/submit-rfp',
    labelKey: 'nav.submitRfp',
    fallback: 'Submit an RFP',
    descKey: 'nav.submitRfpDesc',
    descFallback: 'Put a formal request to service providers',
    icon: Ship,
  },
  {
    capability: 'submit_consultation',
    href: '/submit-consultation',
    labelKey: 'nav.requestConsultation',
    fallback: 'Request a consultation',
    descKey: 'nav.requestConsultationDesc',
    descFallback: 'Get expert advice on one question',
    icon: MessageSquare,
  },
  {
    capability: 'request_webinar',
    href: '/request-webinar',
    labelKey: 'nav.proposeWebinar',
    fallback: 'Propose a webinar',
    descKey: 'nav.proposeWebinarDesc',
    descFallback: 'Speak to the network on your subject',
    icon: Mic2,
  },
];

export interface CreateContext {
  isVerified: boolean;
  orgVerified: boolean;
  persona: string | null | undefined;
  isFeatureEnabled: (featureKey: string) => boolean;
}

/**
 * Who may create what. Shared by the navbar's Create menu and the dashboard's
 * empty states, so the two can never offer different things. The routes keep
 * their own guards (ProtectedRoute) — this only decides what to show.
 */
export function canCreate(capability: CreateCapability, ctx: CreateContext): boolean {
  if (!ctx.isVerified || !ctx.orgVerified) return false;
  // Proposing a webinar is open to every verified member; the three marina
  // submissions need either a marina-like persona or a bought entitlement.
  if (capability === 'request_webinar') return true;
  const isMarinaLike = ctx.persona === 'marina' || ctx.persona === 'developer';
  return isMarinaLike || ctx.isFeatureEnabled(capability);
}

/**
 * Whether a nav item should read as current. Exact match for the roots that
 * would otherwise swallow everything; prefix match elsewhere so
 * /resources/:id keeps Resources lit.
 */
export function isNavItemActive(href: string, pathname: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}
