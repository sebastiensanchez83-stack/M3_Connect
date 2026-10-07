import { useState, useEffect, ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Users, FileText, Calendar, Anchor, Radio, Link2, ClipboardList, MessageSquare,
  Award, LayoutDashboard, Settings, Image, Building2, Tag, TrendingUp, Ship,
  ChevronRight, Store, UsersRound, Megaphone, Plus, QrCode, CalendarDays, BookOpen, Truck,
  Scale, Activity, Upload, Newspaper, Mail,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { registerAdminRefonteStrings } from '@/i18n/refonte-admin';

registerAdminRefonteStrings();

// Grouped admin navigation, on a marine rail. Events nests On-site → Smart 26
// (which expands to its operational sub-tabs) and a separate Webinars branch;
// the rest of the admin lives in a few labelled groups, always visible. The
// branch containing the current route auto-opens. Routes, labels and the
// admin / moderator split are unchanged: this file only draws them.

interface NavItem { to: string; label: string; icon?: ReactNode; exact?: boolean; adminOnly?: boolean }

const ICON = 'h-4 w-4 shrink-0';

export function AdminSidebar({ mobile = false, onNavigate }: { mobile?: boolean; onNavigate?: () => void } = {}) {
  const { t } = useTranslation();
  const location = useLocation();
  const { profile, isAdmin } = useAuth();
  const isMod = profile?.persona === 'moderator';
  const path = location.pathname;

  const isActive = (to: string, exact?: boolean) => {
    const toPath = to.split('?')[0];
    if (exact) return path === toPath;
    return path.startsWith(toPath) && toPath !== '/admin';
  };

  // ---- Smart 26 sub-tabs (real routes) ----
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
  // but NOT the named sub-routes — pick the most specific match.
  const sm26SubPrefixes = sm26Children.filter(c => c.to !== '/admin/sm26').map(c => c.to);
  const sm26ChildActive = (c: NavItem) => {
    if (c.to === '/admin/sm26') return path.startsWith('/admin/sm26') && !sm26SubPrefixes.some(p => path.startsWith(p));
    return path.startsWith(c.to);
  };
  const onSm26 = path.startsWith('/admin/sm26');
  const onWebinarList = path === '/admin/events' && new URLSearchParams(location.search).get('type') === 'webinar';
  const onWebinars = path.startsWith('/admin/webinars') || onWebinarList;

  // ---- Labelled groups ----
  interface Group { key: string; label: string; items: NavItem[] }
  const groups: Group[] = [
    { key: 'people', label: 'People & companies', items: [
      { to: '/admin/users', label: t('admin.users'), icon: <Users className={ICON} />, adminOnly: true },
      { to: '/admin/organizations', label: 'Organizations', icon: <Building2 className={ICON} />, adminOnly: true },
      { to: '/admin/partner-requests', label: 'B2B requests', icon: <Link2 className={ICON} />, adminOnly: true },
    ] },
    { key: 'marketplace', label: 'Marketplace', items: [
      { to: '/admin/projects', label: t('admin.marinaProjects'), icon: <Anchor className={ICON} />, adminOnly: true },
      { to: '/admin/rfps', label: 'RFPs', icon: <ClipboardList className={ICON} />, adminOnly: true },
      { to: '/admin/consultations', label: 'Consultations', icon: <MessageSquare className={ICON} />, adminOnly: true },
      { to: '/admin/leads', label: t('admin.partnerLeads'), icon: <Users className={ICON} />, adminOnly: true },
    ] },
    { key: 'commercial', label: 'Commercial & content', items: [
      { to: '/admin/sponsorships', label: 'Sponsorship', icon: <Award className={ICON} />, adminOnly: true },
      { to: '/admin/resources', label: isAdmin ? t('admin.resources') : 'Propose Resources', icon: <FileText className={ICON} /> },
      { to: '/admin/banners', label: 'Ad banners', icon: <Image className={ICON} />, adminOnly: true },
      { to: '/admin/sectors', label: 'Sectors', icon: <Tag className={ICON} />, adminOnly: true },
      { to: '/admin/media-downloads', label: 'Press', icon: <Newspaper className={ICON} />, adminOnly: true },
    ] },
  ];

  const visible = (items: NavItem[]) => (isAdmin ? items : items.filter(i => !i.adminOnly));

  // Expansion state: the Events branches only. The one holding the current route opens.
  const [open, setOpen] = useState<Record<string, boolean>>(() => ({
    onsite: onSm26 || isAdmin,           // on-site open by default for admins
    smart26: onSm26,
    webinars: onWebinars,
  }));
  const toggle = (k: string) => setOpen(p => ({ ...p, [k]: !p[k] }));
  useEffect(() => {
    setOpen(p => ({
      ...p,
      ...(onSm26 ? { onsite: true, smart26: true } : {}),
      ...(onWebinars ? { webinars: true } : {}),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  const linkClass = (active: boolean) => cn(
    'flex w-full items-center gap-3 rounded-xl px-3 py-2 text-[14px] font-medium leading-5 transition-colors',
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-white',
    active ? 'bg-white text-navy' : 'text-white/75 hover:bg-white/10 hover:text-white',
  );
  const quietLink = cn(
    'flex w-full items-center gap-3 rounded-xl px-3 py-2 text-[14px] leading-5 text-white/55 transition-colors',
    'hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white',
  );
  const sectionLabel = 'px-3 pb-1.5 pt-5 text-[11px] font-semibold uppercase tracking-[0.08em] text-white/45';
  const nested = 'ml-3 space-y-0.5 border-l border-white/15 pl-2';

  const renderItem = (l: NavItem) => (
    <Link key={l.to} to={l.to} onClick={onNavigate} className={linkClass(isActive(l.to, l.exact))} aria-current={isActive(l.to, l.exact) ? 'page' : undefined}>
      {l.icon}<span className="min-w-0 truncate">{l.label}</span>
    </Link>
  );

  const caret = (isOpen: boolean) => (
    <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 transition-transform motion-reduce:transition-none', isOpen && 'rotate-90')} aria-hidden="true" />
  );

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

      <div className="shrink-0 space-y-0.5 pb-3">
        {/* Overview */}
        <div className={cn(sectionLabel, 'pt-1')}>Overview</div>
        {renderItem({ to: '/admin', label: isAdmin ? t('admin.dashboard') : 'Moderator Dashboard', icon: <LayoutDashboard className={ICON} />, exact: true })}
        {isAdmin && renderItem({ to: '/admin/pulse', label: 'Industry Pulse', icon: <TrendingUp className={ICON} /> })}

        {/* Events */}
        <div className={sectionLabel}>Events</div>
        {isAdmin ? (
          <>
            {/* On-site */}
            <button type="button" onClick={() => toggle('onsite')} aria-expanded={!!open.onsite} className={cn(linkClass(false), 'justify-between')}>
              <span className="flex items-center gap-3"><Anchor className={ICON} /> On-site</span>
              {caret(!!open.onsite)}
            </button>
            {open.onsite && (
              <div className={nested}>
                {/* Smart 26 (expands to its sub-tabs) */}
                <button type="button" onClick={() => toggle('smart26')} aria-expanded={!!open.smart26} className={cn(linkClass(onSm26 && !open.smart26), 'justify-between')}>
                  <span className="flex items-center gap-3"><Ship className={ICON} /> Smart 26</span>
                  {caret(!!open.smart26)}
                </button>
                {open.smart26 && (
                  <div className={nested}>
                    {sm26Children.map(c => (
                      <Link key={c.to} to={c.to} onClick={onNavigate} className={linkClass(sm26ChildActive(c))} aria-current={sm26ChildActive(c) ? 'page' : undefined}>
                        {c.icon}<span className="min-w-0 leading-tight">{c.label}</span>
                      </Link>
                    ))}
                  </div>
                )}
                {/* Guest-list events (invitation-only) */}
                {renderItem({ to: '/admin/guest-list/wys26', label: 'WYS 2026', icon: <Mail className={ICON} /> })}
                {/* Add another on-site event */}
                <Link to="/admin/events/new?type=on_site" onClick={onNavigate} className={quietLink}>
                  <Plus className={ICON} /> Add on-site event
                </Link>
              </div>
            )}

            {/* Webinars (separate from on-site) */}
            <button type="button" onClick={() => toggle('webinars')} aria-expanded={!!open.webinars} className={cn(linkClass(onWebinars && !open.webinars), 'justify-between')}>
              <span className="flex items-center gap-3"><Radio className={ICON} /> Webinars</span>
              {caret(!!open.webinars)}
            </button>
            {open.webinars && (
              <div className={nested}>
                <Link to="/admin/events?type=webinar" onClick={onNavigate} className={linkClass(onWebinarList)} aria-current={onWebinarList ? 'page' : undefined}>
                  <Calendar className={ICON} /><span className="min-w-0 truncate">All webinars</span>
                </Link>
                {renderItem({ to: '/admin/webinars', label: 'Webinar requests', icon: <Radio className={ICON} /> })}
                <Link to="/admin/events/new?type=webinar" onClick={onNavigate} className={quietLink}>
                  <Plus className={ICON} /> Create webinar
                </Link>
              </div>
            )}
          </>
        ) : (
          /* Moderator sees only the webinar queue under Events */
          renderItem({ to: '/admin/webinars', label: 'Webinar proposals', icon: <Radio className={ICON} /> })
        )}

        {/* Labelled groups */}
        {groups.map(g => {
          const items = visible(g.items);
          if (items.length === 0) return null;
          return (
            <div key={g.key} className="space-y-0.5">
              <div className={sectionLabel}>{g.label}</div>
              {items.map(renderItem)}
            </div>
          );
        })}

      </div>

      {/* Settings: pinned to the bottom of the rail. It sits outside the spaced list so
          mt-auto holds it down on a tall screen, and stays stuck while the groups scroll. */}
      {isAdmin && (
        <div className="sticky bottom-0 mt-auto shrink-0 border-t border-white/15 bg-navy pb-4 pt-3">
          {renderItem({ to: '/admin/settings', label: 'Settings', icon: <Settings className={ICON} /> })}
        </div>
      )}
    </nav>
  );
}
