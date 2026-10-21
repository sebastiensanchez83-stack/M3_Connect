import {
  Activity, BookOpen, Building2, CalendarDays, ClipboardList, Mail, Megaphone, MessageSquare, QrCode, Scale, Truck, Upload, UsersRound,
  type LucideIcon,
} from 'lucide-react';
import type { EventSummary } from './eventsApi';

/**
 * The screens each event SYSTEM brings with it (its "console"), read from the event's system,
 * never from its name: a new guest list gets its links by its slug, a new fair the day a console
 * serves it. The sidebar shows them under the event, and the event page links to them.
 *
 *   guest_list  /admin/guest-list/<slug> (the guest list), …/invitations, …/checkin (the door).
 *               These screens are frozen for the World Yachting Summit: linked to, never changed.
 *   fair        the Smart Marina console, /admin/sm26/* (frozen). It serves ONE fair: the one whose
 *               slug it reads itself (FAIR_CONSOLE_SLUG below, the same constant as in the console's
 *               own queries). Another fair (SM27…) is listed and gets its own page with its figures;
 *               its console links appear once the console modules are made generic.
 *   core, legacy everything is on the event page (and the old editor for an old-system event).
 */

export interface ConsoleLink {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Active on this path and on any path under it that no other link of the console claims. */
  ownsRest?: boolean;
}

/** The slug of the fair the frozen Smart Marina console reads (AdminSM26*.tsx: sm_event.slug = 'sm26'). */
export const FAIR_CONSOLE_SLUG = 'sm26';
export const FAIR_CONSOLE_BASE = '/admin/sm26';

/** The fair console's 13 screens, in the order of the old menu. */
const FAIR_CONSOLE: ConsoleLink[] = [
  { to: `${FAIR_CONSOLE_BASE}/health`, label: 'Overview', icon: Activity },
  { to: FAIR_CONSOLE_BASE, label: 'Registrations', icon: ClipboardList, ownsRest: true },
  { to: `${FAIR_CONSOLE_BASE}/checkin`, label: 'Check-in', icon: QrCode },
  { to: `${FAIR_CONSOLE_BASE}/agenda`, label: 'Programme', icon: CalendarDays },
  { to: `${FAIR_CONSOLE_BASE}/evaluation`, label: 'Evaluation & Awards', icon: Scale },
  { to: `${FAIR_CONSOLE_BASE}/architecture`, label: 'Architecture', icon: Building2 },
  { to: `${FAIR_CONSOLE_BASE}/ecat`, label: 'E-catalogue', icon: BookOpen },
  { to: `${FAIR_CONSOLE_BASE}/mediakits`, label: 'Media kits', icon: Megaphone },
  { to: `${FAIR_CONSOLE_BASE}/logistics`, label: 'Logistics', icon: Truck },
  { to: `${FAIR_CONSOLE_BASE}/networking`, label: 'Networking', icon: UsersRound },
  { to: `${FAIR_CONSOLE_BASE}/invitations`, label: 'Invitations', icon: Mail },
  { to: `${FAIR_CONSOLE_BASE}/feedback`, label: 'Feedback', icon: MessageSquare },
  { to: `${FAIR_CONSOLE_BASE}/import`, label: 'Import', icon: Upload },
];

export function fairHasConsole(slug: string | null | undefined): boolean {
  return slug === FAIR_CONSOLE_SLUG;
}

const guestListBase = (slug: string) => `/admin/guest-list/${encodeURIComponent(slug)}`;

/** The console screens of an event (empty when everything is on its page). */
export function consoleLinks(e: Pick<EventSummary, 'system' | 'gl' | 'fair'>): ConsoleLink[] {
  if (e.system === 'fair' && e.fair && fairHasConsole(e.fair.slug)) return FAIR_CONSOLE;
  if (e.system === 'guest_list' && e.gl) {
    const base = guestListBase(e.gl.slug);
    return [
      { to: base, label: 'Guest list', icon: ClipboardList, ownsRest: true },
      { to: `${base}/invitations`, label: 'Invitations', icon: Mail },
      { to: `${base}/checkin`, label: 'Door check-in', icon: QrCode },
    ];
  }
  return [];
}

/** Is this path one of the event's console screens? */
export function onConsoleOf(e: Pick<EventSummary, 'system' | 'gl' | 'fair'>, path: string): boolean {
  if (e.system === 'fair' && e.fair && fairHasConsole(e.fair.slug)) return path === FAIR_CONSOLE_BASE || path.startsWith(`${FAIR_CONSOLE_BASE}/`);
  if (e.gl) {
    const base = guestListBase(e.gl.slug);
    return path === base || path.startsWith(`${base}/`);
  }
  return false;
}

/** Is this path the event's admin page (any tab)? Its id, its guest list's id, or its system route. */
export function onPageOf(e: Pick<EventSummary, 'href' | 'catalogueId' | 'gl'>, path: string): boolean {
  const ids = [e.catalogueId, e.gl?.id].filter(Boolean).map(id => `/admin/events/${id}`);
  return [e.href, ...ids].some(p => path === p || path.startsWith(`${p}/`));
}

/** The one console link that is active on this path (the most specific one). */
export function activeConsoleLink(links: ConsoleLink[], path: string): ConsoleLink | null {
  const exact = links.filter(l => !l.ownsRest && (path === l.to || path.startsWith(`${l.to}/`)));
  if (exact.length) return exact.sort((a, b) => b.to.length - a.to.length)[0];
  return links.find(l => l.ownsRest && (path === l.to || path.startsWith(`${l.to}/`))) ?? null;
}
