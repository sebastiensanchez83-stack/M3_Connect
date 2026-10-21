import { useState, useEffect, ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Users, FileText, Calendar, Anchor, Radio, MessageSquare, ClipboardList,
  Award, Home, Settings, Image, Building2, Tag, Ship, ChevronRight, Store, UsersRound,
  Megaphone, Plus, QrCode, CalendarDays, BookOpen, Truck, Scale, Activity, Upload,
  Newspaper, Mail, Archive, ShieldCheck, UserCheck, MessagesSquare, Send, Download,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { registerAdminRefonteStrings } from '@/i18n/refonte-admin';

registerAdminRefonteStrings();

// The admin menu by TASKS (Victor, 21 Oct 2026), on a marine rail:
//   Today          Home ("To do today", with the Market tab that replaced Industry Pulse)
//   Members        Companies, To validate (the one place to validate), conversations between companies
//   Events         All events, Smart 26 (frozen console), WYS 2026, webinar proposals, invitation campaigns, create
//   Site content   Articles, Banners and announcements, Sponsors and partners
//   Marketplace    Marina projects, RFPs, Consultations, Partner leads
//   Settings       Switches, Rights per company type, Sectors, Press, Accounts and export, Archives
// Entries whose screen does not exist yet (Inbox, Site pages, Site health, Exports) are left out:
// the lanes that build them add them here at merge. Every route of the old menu is still in
// this one, or redirected (/admin/pulse -> /admin?tab=market). The admin / moderator split is
// unchanged: moderators see Home, To validate, webinar proposals, invitations and Articles.

interface NavItem { to: string; label: string; icon?: ReactNode; exact?: boolean; adminOnly?: boolean; activeAlso?: string[] }

const ICON = 'h-4 w-4 shrink-0';

export function AdminSidebar({ mobile = false, onNavigate, reviewCount = null }: { mobile?: boolean; onNavigate?: () => void; reviewCount?: number | null } = {}) {
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

  // ---- Smart 26 sub-tabs (real routes; the SM26 console is frozen) ----
  const sm26Children: NavItem[] = [
    { to: '/admin/sm26/health', label: 'Overview', icon: <Activity className={ICON} /> },
    { to: '/admin/sm26', label: 'Registrations', icon: <ClipboardList className={ICON} />, exact: true },
    { to: '/admin/sm26/checkin', label: 'Check-in', icon: <QrCode className={ICON} /> },
    { to: '/admin/sm26/agenda', label: 'Programme', icon: <CalendarDays className={ICON} /> },
    { to: '/admin/sm26/evaluation', label: 'Evaluation & Awards', icon: <Scale className={ICON} /> },
    { to: '/admin/sm26/architecture', label: 'Architecture', icon: <Building2 className={ICON} /> },
    { to: '/admin/sm26/ecat', label: 'E-catalogue', icon: <BookOpen className={ICON} /> },
    { to: '/admin/sm26/mediakits', label: 'Media kits', icon: <Megaphone className={ICON} /> },
    { to: '/admin/sm26/logistics', label: 'Logistics', icon: <Truck className={ICON} /> },
    { to: '/admin/sm26/networking', label: 'Networking', icon: <UsersRound className={ICON} /> },
    { to: '/admin/sm26/invitations', label: 'Invitations', icon: <Mail className={ICON} /> },
    { to: '/admin/sm26/feedback', label: 'Feedback', icon: <MessageSquare className={ICON} /> },
    { to: '/admin/sm26/import', label: 'Import', icon: <Upload className={ICON} /> },
  ];
  // "Registrations" owns /admin/sm26 AND the registration detail (/admin/sm26/:id),
  // but NOT the named sub-routes: pick the most specific match.
  const sm26SubPrefixes = sm26Children.filter(c => c.to !== '/admin/sm26').map(c => c.to);
  const sm26ChildActive = (c: NavItem) => {
    if (c.to === '/admin/sm26') return path.startsWith('/admin/sm26') && !sm26SubPrefixes.some(p => path.startsWith(p));
    return path.startsWith(c.to);
  };
  const onSm26 = path.startsWith('/admin/sm26');
  // ---- WYS 2026 (guest-list event): its guest list and its invitations ----
  const wysInvitations = path.startsWith('/admin/guest-list/wys26/invitations');
  const onWys = path.startsWith('/admin/guest-list/wys26');
  const wysChildren: (NavItem & { active: boolean })[] = [
    { to: '/admin/guest-list/wys26', label: 'Guest list', icon: <ClipboardList className={ICON} />, active: onWys && !wysInvitations },
    { to: '/admin/guest-list/wys26/invitations', label: 'Invitations', icon: <Mail className={ICON} />, active: wysInvitations },
  ];
  // Old queues kept reachable (both empty when archived on 8 Oct 2026).
  const archiveItems: NavItem[] = [
    { to: '/admin/sponsorship-requests', label: 'Old sponsorship requests', icon: <Award className={ICON} />, adminOnly: true },
    { to: '/admin/expositions', label: 'Old exposition requests', icon: <Store className={ICON} />, adminOnly: true },
  ];
  const onArchives = archiveItems.some(i => path.startsWith(i.to));
  // "All events" is the list and every event's own page, not the SM26 / WYS consoles.
  const onEventList = path === '/admin/events' || (path.startsWith('/admin/events/') && !path.startsWith('/admin/events/new'));

  // ---- The groups, in Victor's order ----
  interface Group { key: string; label: string; items: NavItem[] }
  const groups: Group[] = [
    { key: 'members', label: t('adminNav.members', 'Members'), items: [
      { to: '/admin/organizations', label: t('adminNav.companies', 'Companies'), icon: <Building2 className={ICON} />, adminOnly: true },
      // Company-to-company conversations (the old "B2B requests").
      { to: '/admin/partner-requests', label: t('adminNav.conversations', 'Conversations'), icon: <MessagesSquare className={ICON} />, adminOnly: true },
    ] },
    { key: 'content', label: t('adminNav.content', 'Site content'), items: [
      { to: '/admin/resources', label: t('adminNav.articles', 'Articles'), icon: <FileText className={ICON} /> },
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
      // Every account in one list, its CSV export and the staff accounts. A person's page
      // (/admin/users/:id) opens from their company or the search; this is not a People menu.
      { to: '/admin/users', label: t('adminNav.accounts', 'Accounts and export'), icon: <Download className={ICON} />, adminOnly: true },
    ] },
  ];

  const visible = (items: NavItem[]) => (isAdmin ? items : items.filter(i => !i.adminOnly));

  // Expansion state: Smart 26, WYS 2026 and Archives. The one holding the current route opens.
  const [open, setOpen] = useState<Record<string, boolean>>(() => ({ smart26: onSm26, wys26: onWys, archives: onArchives }));
  const toggle = (k: string) => setOpen(p => ({ ...p, [k]: !p[k] }));
  useEffect(() => {
    setOpen(p => ({
      ...p,
      ...(onSm26 ? { smart26: true } : {}),
      ...(onWys ? { wys26: true } : {}),
      ...(onArchives ? { archives: true } : {}),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  const linkClass = (active: boolean) => cn(
    'flex w-full items-center gap-3 rounded-xl px-3 py-2 text-[14px] font-medium leading-5 transition-colors',
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-white',
    active ? 'bg-white text-navy' : 'text-white/80 hover:bg-white/10 hover:text-white',
  );
  const quietLink = cn(
    'flex w-full items-center gap-3 rounded-xl px-3 py-2 text-[14px] leading-5 text-white/60 transition-colors',
    'hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white',
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
            {branch('smart26', 'Smart 26', <Ship className={ICON} />, onSm26, sm26Children.map(c => renderLink(c, sm26ChildActive(c))))}
            {branch('wys26', 'WYS 2026', <Mail className={ICON} />, onWys, wysChildren.map(c => renderLink(c, c.active)))}
          </>
        )}
        {renderItem({ to: '/admin/webinars', label: t('adminNav.webinarProposals', 'Webinar proposals'), icon: <Radio className={ICON} /> })}
        {/* Every invitation campaign, any event (the WYS ones are also under WYS 2026). */}
        {renderLink({ to: '/admin/invitations', label: t('adminNav.invitations', 'Invitation campaigns'), icon: <Send className={ICON} /> }, path.startsWith('/admin/invitations'))}
        {isAdmin && (
          <>
            <Link to="/admin/events/new?type=on_site&editor=new" onClick={onNavigate} className={quietLink}>
              <Plus className={ICON} /> {t('adminNav.createEvent', 'Create an on-site event')}
            </Link>
            <Link to="/admin/events/new?type=webinar&editor=new" onClick={onNavigate} className={quietLink}>
              <Plus className={ICON} /> {t('adminNav.createWebinar', 'Create a webinar')}
            </Link>
          </>
        )}

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
