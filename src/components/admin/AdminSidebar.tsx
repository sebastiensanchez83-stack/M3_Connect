import { useState, useEffect, ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Users, FileText, Calendar, Anchor, Radio, MessageSquare, ClipboardList,
  Award, Home, Settings, Image, Building2, Tag, ChevronRight, Store,
  Plus, CalendarDays,
  Newspaper, Archive, ShieldCheck, UserCheck, MessagesSquare, Send, Download, Inbox, PenLine, MailCheck,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { registerAdminRefonteStrings } from '@/i18n/refonte-admin';
import { useEventMenu } from './v2/events/eventMenu';
import { shortDate, type EventSummary } from './v2/events/eventsApi';
import {
  activeConsoleLink, consoleLinks, FAIR_CONSOLE_BASE, FAIR_CONSOLE_SLUG, onConsoleOf, onPageOf,
} from './v2/events/eventSystems';

registerAdminRefonteStrings();

// The admin menu by TASKS (Victor, 21 Oct 2026), on a marine rail:
//   Today          Home ("To do today", with the Market tab that replaced Industry Pulse)
//   Members        Companies, To validate (the one place to validate), conversations between companies
//   Events         All events, then the current and coming events READ FROM THE DATABASE (each opens
//                  its event page; a guest list or a fair also lists its console screens under it),
//                  Create an event, webinar proposals, invitation campaigns (wave 2, 21 Oct 2026)
//   Site content   Articles, Banners and announcements, Sponsors and partners
//   Marketplace    Marina projects, RFPs, Consultations, Partner leads
//   Settings       Switches, Rights per company type, Sectors, Press, Accounts and export, Archives
// Entries whose screen does not exist yet (Inbox, Site pages, Site health, Exports) are left out:
// the lanes that build them add them here at merge. Every route of the old menu is still in
// this one, or redirected (/admin/pulse -> /admin?tab=market). The admin / moderator split is
// unchanged: moderators see Home, To validate, webinar proposals, invitations and Articles.

interface NavItem { to: string; label: string; icon?: ReactNode; exact?: boolean; adminOnly?: boolean; activeAlso?: string[] }

const ICON = 'h-4 w-4 shrink-0';

export function AdminSidebar({ mobile = false, onNavigate, reviewCount = null, inboxCount = null }: { mobile?: boolean; onNavigate?: () => void; reviewCount?: number | null; inboxCount?: number | null } = {}) {
  const { t } = useTranslation();
  const location = useLocation();
  const { profile, isAdmin } = useAuth();
  const isMod = profile?.persona === 'moderator';
  const path = location.pathname;

  const isActive = (l: NavItem) => {
    const toPath = l.to.split('?')[0];
    if (l.exact) return path === toPath;
    if (l.activeAlso?.some(p => path.startsWith(p))) return true;
    return path.startsWith(toPath) && toPath !== '/admin';
  };

  // ---- Events, read from the database (src/components/admin/v2/events/eventMenu.ts) ----
  // No event name or slug here: each event brings its console screens from its system
  // (eventSystems.ts), so SM27 or another fair needs no code change. The event of the screen on
  // show is always listed, so its console screens stay one press away.
  const eventMenu = useEventMenu(path, isAdmin);
  const menuEvents: EventSummary[] = [...(eventMenu.items ?? []), ...(eventMenu.context ? [eventMenu.context] : [])];
  // While the list loads (or if it cannot be read), a console screen still shows its own links.
  const fallbackEvent: EventSummary | null = (() => {
    if (menuEvents.some(e => onConsoleOf(e, path) || onPageOf(e, path))) return null;
    const base = {
      kind: 'onsite' as const, start: null, end: null, allDay: false, place: null, published: null, test: false,
      invitationOnly: false, capacity: null, catalogueId: null, catalogueSlug: null, publicHref: null,
    };
    if (path === FAIR_CONSOLE_BASE || path.startsWith(`${FAIR_CONSOLE_BASE}/`)) {
      return {
        ...base, key: 'fallback:fair', system: 'fair', title: t('adminNav.fairConsole', 'Fair console'), gl: null,
        fair: { id: '', slug: FAIR_CONSOLE_SLUG }, href: `/admin/events/fair/${FAIR_CONSOLE_SLUG}`,
      };
    }
    const m = /^\/admin\/guest-list\/([^/]+)/.exec(path);
    if (m) {
      // A mistyped address (a broken %-code) must not blank the whole admin.
      let slug: string;
      try { slug = decodeURIComponent(m[1]); } catch { slug = m[1]; }
      return {
        ...base, key: 'fallback:gl', system: 'guest_list', title: slug, gl: { id: '', slug, engine: 'guest_list_v1' }, fair: null,
        href: `/admin/events/guest-list/${encodeURIComponent(slug)}`,
      };
    }
    return null;
  })();
  const shownEvents = fallbackEvent ? [...menuEvents, fallbackEvent] : menuEvents;
  const eventHere = shownEvents.find(e => onPageOf(e, path) || onConsoleOf(e, path)) ?? null;
  // Old queues kept reachable (both empty when archived on 8 Oct 2026).
  const archiveItems: NavItem[] = [
    { to: '/admin/sponsorship-requests', label: 'Old sponsorship requests', icon: <Award className={ICON} />, adminOnly: true },
    { to: '/admin/expositions', label: 'Old exposition requests', icon: <Store className={ICON} />, adminOnly: true },
  ];
  const onArchives = archiveItems.some(i => path.startsWith(i.to));
  // "All events" is the list, and the page of an event that has no entry of its own in the menu.
  const onEventList = path === '/admin/events' || (path.startsWith('/admin/events/') && !path.startsWith('/admin/events/new') && !eventHere);

  // ---- The groups, in Victor's order ----
  interface Group { key: string; label: string; items: NavItem[] }
  const groups: Group[] = [
    { key: 'members', label: t('adminNav.members', 'Members'), items: [
      // One list: companies, and people without a company as "Individual" rows. A person's page
      // opens from their company or the search.
      { to: '/admin/companies', label: t('adminNav.companies', 'Companies'), icon: <Building2 className={ICON} />, adminOnly: true, activeAlso: ['/admin/organizations', '/admin/people'] },
      // Company-to-company conversations (the old "B2B requests").
      { to: '/admin/partner-requests', label: t('adminNav.conversations', 'Conversations'), icon: <MessagesSquare className={ICON} />, adminOnly: true },
    ] },
    { key: 'content', label: t('adminNav.content', 'Site content'), items: [
      { to: '/admin/resources', label: t('adminNav.articles', 'Articles'), icon: <FileText className={ICON} /> },
      { to: '/admin/site-pages', label: t('adminNav.sitePages', 'Site pages'), icon: <PenLine className={ICON} /> },
      { to: '/admin/banners', label: t('adminNav.banners', 'Banners and announcements'), icon: <Image className={ICON} />, adminOnly: true },
      { to: '/admin/sponsorships', label: t('adminNav.sponsors', 'Sponsors and partners'), icon: <Award className={ICON} />, adminOnly: true },
    ] },
    { key: 'marketplace', label: t('adminNav.marketplace', 'Marketplace'), items: [
      { to: '/admin/projects', label: t('adminNav.projects', 'Marina projects'), icon: <Anchor className={ICON} />, adminOnly: true },
      { to: '/admin/rfps', label: t('adminNav.rfps', 'RFPs'), icon: <ClipboardList className={ICON} />, adminOnly: true },
      { to: '/admin/consultations', label: t('adminNav.consultations', 'Consultations'), icon: <MessageSquare className={ICON} />, adminOnly: true },
      { to: '/admin/leads', label: t('adminNav.leads', 'Partner leads'), icon: <Users className={ICON} />, adminOnly: true },
    ] },
    { key: 'settings', label: t('adminNav.settings', 'Settings'), items: [
      { to: '/admin/settings', label: t('adminNav.switches', 'Switches'), icon: <Settings className={ICON} />, adminOnly: true },
      { to: '/admin/rights', label: t('adminNav.rights', 'Rights per company type'), icon: <ShieldCheck className={ICON} />, adminOnly: true },
      { to: '/admin/sectors', label: t('adminNav.sectors', 'Sectors'), icon: <Tag className={ICON} />, adminOnly: true },
      { to: '/admin/media-downloads', label: t('adminNav.press', 'Press'), icon: <Newspaper className={ICON} />, adminOnly: true },
      { to: '/admin/email-log', label: t('adminNav.emailLog', 'E-mail log'), icon: <MailCheck className={ICON} />, adminOnly: true },
      // Every account in one list, its CSV export and the staff accounts. A person's page
      // (/admin/users/:id) opens from their company or the search; this is not a People menu.
      { to: '/admin/users', label: t('adminNav.accounts', 'Accounts and export'), icon: <Download className={ICON} />, adminOnly: true },
    ] },
  ];

  const visible = (items: NavItem[]) => (isAdmin ? items : items.filter(i => !i.adminOnly));

  // Expansion state: each event's console screens, and Archives. The one holding the current route opens.
  const hereKey = eventHere ? `ev:${eventHere.key}` : null;
  const [open, setOpen] = useState<Record<string, boolean>>(() => ({ archives: onArchives, ...(hereKey ? { [hereKey]: true } : {}) }));
  const toggle = (k: string) => setOpen(p => ({ ...p, [k]: !p[k] }));
  useEffect(() => {
    setOpen(p => ({
      ...p,
      ...(hereKey ? { [hereKey]: true } : {}),
      ...(onArchives ? { archives: true } : {}),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, hereKey]);

  const linkClass = (active: boolean) => cn(
    'flex w-full items-center gap-3 rounded-xl px-3 py-2 text-[14px] font-medium leading-5 transition-colors',
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-white',
    active ? 'bg-white text-navy' : 'text-white/80 hover:bg-white/10 hover:text-white',
  );
  const sectionLabel = 'px-3 pb-1.5 pt-5 text-[11px] font-semibold uppercase tracking-[0.08em] text-white/50';
  const nested = 'ml-3 space-y-0.5 border-l border-white/15 pl-2';

  const renderLink = (l: NavItem, active: boolean, trailing?: ReactNode) => (
    <Link key={l.to} to={l.to} onClick={onNavigate} className={linkClass(active)} aria-current={active ? 'page' : undefined}>
      {l.icon}<span className="min-w-0 flex-1 leading-tight">{l.label}</span>{trailing}
    </Link>
  );
  const renderItem = (l: NavItem) => renderLink(l, isActive(l));

  const caret = (isOpen: boolean) => (
    <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 transition-transform motion-reduce:transition-none', isOpen && 'rotate-90')} aria-hidden="true" />
  );
  const branch = (key: string, label: string, icon: ReactNode, on: boolean, children: ReactNode) => (
    <>
      <button type="button" onClick={() => toggle(key)} aria-expanded={!!open[key]} className={cn(linkClass(on && !open[key]), 'justify-between')}>
        <span className="flex items-center gap-3">{icon} {label}</span>
        {caret(!!open[key])}
      </button>
      {open[key] && <div className={nested}>{children}</div>}
    </>
  );

  // One event of the menu: its page (title and date), and, for a guest list or a fair, a
  // caret that shows its console screens (open on its page and on those screens).
  const renderEvent = (e: EventSummary) => {
    const links = consoleLinks(e);
    const k = `ev:${e.key}`;
    const expanded = links.length > 0 && !!open[k];
    const onPage = onPageOf(e, path);
    const current = activeConsoleLink(links, path);
    const date = shortDate(e);
    return (
      <div key={e.key}>
        <div className="flex items-stretch gap-1">
          <Link to={e.href} onClick={onNavigate} className={cn(linkClass(onPage), 'items-start')} aria-current={onPage ? 'page' : undefined}>
            <CalendarDays className={cn(ICON, 'mt-0.5')} />
            <span className="min-w-0 flex-1">
              <span className="line-clamp-2 leading-tight">{e.title}</span>
              <span className={cn('mt-0.5 block text-[12px] font-normal leading-4', onPage ? 'text-navy/70' : 'text-white/55')}>
                {date ?? t('adminNav.noDate', 'Date to be set')}
              </span>
            </span>
          </Link>
          {links.length > 0 && (
            <button
              type="button"
              onClick={() => toggle(k)}
              aria-expanded={expanded}
              aria-label={expanded
                ? t('adminNav.hideScreens', 'Hide the screens of {{name}}', { name: e.title })
                : t('adminNav.showScreens', 'Show the screens of {{name}}', { name: e.title })}
              className="grid w-9 shrink-0 place-items-center rounded-xl text-white/70 transition-colors hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              {caret(expanded)}
            </button>
          )}
        </div>
        {expanded && (
          <div className={cn(nested, 'mt-0.5')}>
            <div className="px-3 pb-0.5 pt-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-white/45">
              {e.system === 'fair' ? t('adminNav.fairScreens', 'Fair console') : t('adminNav.guestListScreens', 'Guest list screens')}
            </div>
            {links.map(l => renderLink({ to: l.to, label: l.label, icon: <l.icon className={ICON} /> }, current === l))}
          </div>
        )}
      </div>
    );
  };

  const inboxItem: NavItem = { to: '/admin/inbox', label: t('adminNav.inbox', 'Inbox'), icon: <Inbox className={ICON} /> };
  const reviewItem: NavItem = { to: '/admin/review', label: t('adminNav.toValidate', 'To validate'), icon: <UserCheck className={ICON} /> };

  return (
    <nav
      aria-label={t('adminUi.menu')}
      className={cn(
        'flex shrink-0 flex-col overflow-y-auto bg-navy px-3 pt-4 text-white',
        mobile ? 'h-full w-full' : 'sticky top-16 hidden h-[calc(100vh-4rem)] w-60 md:flex',
      )}
    >
      {isMod && (
        <div className="mb-1 rounded-xl bg-white/10 px-3 py-1.5 text-[12px] font-semibold text-white">Moderator View</div>
      )}

      <div className="shrink-0 space-y-0.5 pb-6">
        {/* Today */}
        <div className={cn(sectionLabel, 'pt-1')}>{t('adminNav.today', 'Today')}</div>
        {renderItem({ to: '/admin', label: t('adminNav.home', 'Home'), icon: <Home className={ICON} />, exact: true })}
        {renderLink(inboxItem, isActive(inboxItem), !!inboxCount && (
          <span className="shrink-0 rounded-pill bg-gold px-2 text-[12px] font-bold leading-5 tabular-nums text-navy">
            {inboxCount}<span className="sr-only"> {t('adminInbox.navCount', 'to handle')}</span>
          </span>
        ))}

        {/* Members: Companies, To validate (with its count), Conversations */}
        <div className={sectionLabel}>{t('adminNav.members', 'Members')}</div>
        {visible(groups[0].items).slice(0, 1).map(renderItem)}
        {renderLink(reviewItem, isActive(reviewItem), !!reviewCount && (
          <span className="shrink-0 rounded-pill bg-gold px-2 text-[12px] font-bold leading-5 tabular-nums text-navy">
            {reviewCount}<span className="sr-only"> {t('adminReview.navCount', 'waiting')}</span>
          </span>
        ))}
        {visible(groups[0].items).slice(1).map(renderItem)}

        {/* Events */}
        <div className={sectionLabel}>{t('adminNav.events', 'Events')}</div>
        {isAdmin && (
          <>
            {renderLink({ to: '/admin/events', label: t('adminNav.allEvents', 'All events'), icon: <Calendar className={ICON} /> }, onEventList)}
            {shownEvents.map(e => renderEvent(e))}
            {renderLink({ to: '/admin/events/new', label: t('adminNav.createAnEvent', 'Create an event'), icon: <Plus className={ICON} /> }, path.startsWith('/admin/events/new'))}
          </>
        )}
        {renderItem({ to: '/admin/webinars', label: t('adminNav.webinarProposals', 'Webinar proposals'), icon: <Radio className={ICON} /> })}
        {/* Every invitation campaign, any event (a guest list's own are also under that event). */}
        {renderLink({ to: '/admin/invitations', label: t('adminNav.invitations', 'Invitation campaigns'), icon: <Send className={ICON} /> }, path.startsWith('/admin/invitations'))}

        {/* Site content, Marketplace, Settings */}
        {groups.slice(1).map(g => {
          const items = visible(g.items);
          if (items.length === 0) return null;
          return (
            <div key={g.key} className="space-y-0.5">
              <div className={sectionLabel}>{g.label}</div>
              {items.map(renderItem)}
              {/* Archives: small, at the end of Settings. Old queues nobody links to any more. */}
              {g.key === 'settings' && isAdmin && branch('archives', t('adminNav.archives', 'Archives'), <Archive className={ICON} />, onArchives, visible(archiveItems).map(renderItem))}
            </div>
          );
        })}
      </div>
    </nav>
  );
}
