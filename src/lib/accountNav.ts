import {
  Award, BadgeCheck, Building2, CalendarDays, ClipboardList, MessageSquare, Newspaper, Star, UserCircle, Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/**
 * The member's own area, as one model shared by the home dashboard, the
 * navbar (avatar menu, mobile menu), the footer and every link into it.
 *
 * Since October 2026 a signed-in member manages everything from the home page:
 * `/` shows "Welcome back", then the dashboard: a few big tiles (My profile, My
 * company, My team, My events, Messages, My requests, then the ones that only
 * apply to some members). A tile opens its panel in place, one at a time; the
 * open panel is in the address, so it can be linked and survives a reload:
 *
 *   /?open=<panel>[&section=<sub>]      e.g. /?open=company&section=gallery
 *
 * The old addresses keep working (notification e-mails and bookmarks use them):
 * /dashboard goes to `/`, /account?tab=<tab>[&section=…] to the matching tile
 * and row (legacyTabTarget below), /sm26/me to My events, and the panel keys of
 * the first October dashboard (/?open=organization, /?open=notifications) to
 * their new tile (legacyOpenTarget). Tab values stay readable here for that
 * reason: never rename one.
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

/** The tiles of the home dashboard that open a panel in place (`/?open=<panel>`). */
export type HomePanel =
  | 'profile'
  | 'company'
  | 'team'
  | 'registrations'
  | 'inbox'
  | 'requests'
  | 'shortlist'
  | 'references'
  | 'sponsorship'
  | 'press';

export interface HomeSection {
  key: HomePanel;
  labelKey: string;
  fallback: string;
  /** One line, used where there is room (the mobile menu, the panel's header). */
  descKey: string;
  descFallback: string;
  icon: LucideIcon;
}

/** The tiles, in the dashboard's order. */
export const HOME_SECTIONS: HomeSection[] = [
  {
    key: 'profile', icon: UserCircle,
    labelKey: 'dash.tiles.profile', fallback: 'My profile',
    descKey: 'dash.tiles.profileDesc', descFallback: 'Your photo, your name, your job title, your password and your e-mails',
  },
  {
    key: 'company', icon: Building2,
    labelKey: 'dash.tiles.company', fallback: 'My company',
    descKey: 'dash.tiles.companyDesc', descFallback: 'What everyone sees on your company page',
  },
  {
    key: 'team', icon: Users,
    labelKey: 'dash.tiles.team', fallback: 'My team',
    descKey: 'dash.tiles.teamDesc', descFallback: 'The people of your company on the platform',
  },
  {
    key: 'registrations', icon: CalendarDays,
    labelKey: 'dash.tiles.events', fallback: 'My events',
    descKey: 'dash.tiles.eventsDesc', descFallback: 'Your registrations, past events and replays',
  },
  {
    key: 'inbox', icon: MessageSquare,
    labelKey: 'dash.tiles.messages', fallback: 'Messages',
    descKey: 'dash.tiles.messagesDesc', descFallback: 'Your conversations with other companies',
  },
  {
    key: 'requests', icon: ClipboardList,
    labelKey: 'dash.tiles.requests', fallback: 'My requests',
    descKey: 'dash.tiles.requestsDesc', descFallback: 'The needs and proposals you published',
  },
  {
    key: 'shortlist', icon: Star,
    labelKey: 'dash.tiles.shortlist', fallback: 'Saved companies',
    descKey: 'dash.tiles.shortlistDesc', descFallback: 'The companies you saved in the directory',
  },
  {
    key: 'references', icon: BadgeCheck,
    labelKey: 'dash.tiles.references', fallback: 'References',
    descKey: 'dash.tiles.referencesDesc', descFallback: 'Marinas you worked with vouch for you',
  },
  {
    key: 'sponsorship', icon: Award,
    labelKey: 'dash.tiles.sponsorship', fallback: 'Sponsorship',
    descKey: 'dash.tiles.sponsorshipDesc', descFallback: 'Your sponsor package and what you send us',
  },
  {
    key: 'press', icon: Newspaper,
    labelKey: 'dash.tiles.press', fallback: 'Press room',
    descKey: 'dash.tiles.pressDesc', descFallback: 'Media kits and press materials',
  },
];

const PANEL_KEYS = new Set<string>(HOME_SECTIONS.map((s) => s.key));

export function isHomePanel(value: string | null | undefined): value is HomePanel {
  return !!value && PANEL_KEYS.has(value);
}

export function getHomeSection(key: string | null | undefined): HomeSection | null {
  return HOME_SECTIONS.find((s) => s.key === key) ?? null;
}

/** The member home, optionally with one tile open (and one of its rows or sections). */
export function memberHomeHref(panel?: HomePanel | null, section?: string | null): string {
  if (!panel) return '/';
  const params = new URLSearchParams({ open: panel });
  if (section) params.set('section', section);
  return `/?${params.toString()}`;
}

/** The kinds of the merged "My requests" panel, in its order (also the old tab values). */
export const REQUEST_KINDS = ['projects', 'rfps', 'consultations', 'webinars'] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];

/**
 * The rows and sections of the "My company" panel an address can point at:
 * a row (branding = the logo, details = the name, gallery = the photos,
 * documents) or the full editor ("more", and its capital / thesis sections).
 */
export const COMPANY_SECTIONS = ['branding', 'details', 'gallery', 'documents', 'more', 'capital', 'thesis'] as const;

/** Where the old organisation editor's sections live now: "team" is its own tile. */
function organizationTarget(section?: string | null): { panel: HomePanel; section?: string } {
  if (section === 'team') return { panel: 'team' };
  if (section && (COMPANY_SECTIONS as readonly string[]).includes(section)) return { panel: 'company', section };
  return { panel: 'company' };
}

/**
 * Where an old /account?tab=<tab>[&section=…] lands now: a tile of the home
 * dashboard (and a row of it), or null for the top of the home page
 * (?tab=dashboard, a bare /account, an unknown value). ?tab=pricing depends on
 * the account (the sponsor portal for an account linked to a sponsor), so the
 * caller decides; this gives the default, My events.
 */
export function legacyTabTarget(tab: string | null | undefined, section?: string | null): { panel: HomePanel; section?: string } | null {
  switch (tab) {
    case 'profile':
    case 'registrations':
    case 'inbox':
    case 'shortlist':
    case 'references':
    case 'sponsorship':
    case 'press':
      return { panel: tab };
    // E-mail preferences are a row of My profile: the address opens their window.
    case 'notifications':
      return { panel: 'profile', section: 'notifications' };
    case 'organization':
      return organizationTarget(section);
    // The SM26 hub tab: the event is over, its participants find their mark in My events.
    case 'event':
    case 'pricing':
      return { panel: 'registrations' };
    case 'b2b-requests':
      return { panel: 'inbox' };
    // "All submissions" and the four lists it repeated are one panel now.
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
 * The panel keys of the first October 2026 dashboard that are no longer tiles
 * (/?open=organization[&section=team], /?open=notifications): where they land
 * now. Null for any other value.
 */
export function legacyOpenTarget(open: string | null | undefined, section?: string | null): { panel: HomePanel; section?: string } | null {
  if (open === 'organization') return organizationTarget(section);
  if (open === 'notifications') return { panel: 'profile', section: 'notifications' };
  return null;
}

/**
 * Where a part of the member area lives. Every internal link goes through
 * here, so moving a tile moves every link to it. 'complete-registration' is
 * the one screen that stays on /account: a draft account is sent there until
 * its sign-up is finished.
 */
export function accountHref(tab: AccountTab | 'dashboard' | 'complete-registration', section?: string): string {
  if (tab === 'complete-registration') return '/account?tab=complete-registration';
  if (tab === 'dashboard') return '/';
  const target = legacyTabTarget(tab, section);
  return target ? memberHomeHref(target.panel, target.section) : '/';
}

/** What decides which tiles a member sees. */
export interface HomeSectionContext {
  persona: string | null | undefined;
  orgType: string | null | undefined;
  /** False for a member with no company yet: My team has nobody to show. Unknown (undefined) counts as true. */
  hasOrganization?: boolean;
  /** Null while the server has not answered yet: the tiles that depend on it stay hidden. */
  access: { media: boolean; sponsor: boolean; manager: boolean } | null;
}

/**
 * Which tiles apply to this member: the old account menu's own rules. Every
 * member has a profile, a company, events, messages and requests (webinar
 * proposals are open to all); My team needs a company.
 */
export function homeSectionVisible(key: HomePanel, ctx: HomeSectionContext): boolean {
  switch (key) {
    case 'team':
      return ctx.hasOrganization !== false;
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
