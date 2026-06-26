import { useState, useEffect, ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Users, FileText, Calendar, Anchor, Radio, Link2, ClipboardList, MessageSquare,
  ArrowUpCircle, LayoutDashboard, Settings, Image, Building2, Tag, TrendingUp, Ship,
  ChevronRight, Store, UsersRound, Megaphone, Plus, QrCode, CalendarDays, BookOpen,
  Scale, Trophy, Activity,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

// Grouped, collapsible admin navigation. Events nests On-site → Smart 26 (which
// expands to its operational sub-tabs) and a separate Webinars branch; the rest
// of the admin lives in a few condensed groups. The branch containing the
// current route auto-opens.

interface NavItem { to: string; label: string; icon?: ReactNode; exact?: boolean; adminOnly?: boolean }

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
    { to: '/admin/sm26/health', label: 'Overview', icon: <Activity className="h-4 w-4" /> },
    { to: '/admin/sm26', label: 'Registrations', icon: <ClipboardList className="h-4 w-4" />, exact: true },
    { to: '/admin/sm26/checkin', label: 'Check-in', icon: <QrCode className="h-4 w-4" /> },
    { to: '/admin/sm26/agenda', label: 'Programme', icon: <CalendarDays className="h-4 w-4" /> },
    { to: '/admin/sm26/jury', label: 'Jury & evaluation', icon: <Scale className="h-4 w-4" /> },
    { to: '/admin/sm26/awards', label: 'Awards & voting', icon: <Trophy className="h-4 w-4" /> },
    { to: '/admin/sm26/ecat', label: 'E-catalogue', icon: <BookOpen className="h-4 w-4" /> },
    { to: '/admin/sm26/networking', label: 'Networking', icon: <UsersRound className="h-4 w-4" /> },
    { to: '/admin/sm26/feedback', label: 'Feedback', icon: <MessageSquare className="h-4 w-4" /> },
  ];
  // "Registrations" owns /admin/sm26 AND the registration detail (/admin/sm26/:id),
  // but NOT the named sub-routes — pick the most specific match.
  const sm26SubPrefixes = sm26Children.filter(c => c.to !== '/admin/sm26').map(c => c.to);
  const sm26ChildActive = (c: NavItem) => {
    if (c.to === '/admin/sm26') return path.startsWith('/admin/sm26') && !sm26SubPrefixes.some(p => path.startsWith(p));
    return path.startsWith(c.to);
  };
  const onSm26 = path.startsWith('/admin/sm26');
  const onWebinars = path.startsWith('/admin/webinars');

  // ---- Condensed bottom groups ----
  interface Group { key: string; label: string; icon: ReactNode; items: NavItem[] }
  const groups: Group[] = [
    { key: 'people', label: 'People & companies', icon: <UsersRound className="h-4 w-4" />, items: [
      { to: '/admin/users', label: t('admin.users'), icon: <Users className="h-4 w-4" />, adminOnly: true },
      { to: '/admin/organizations', label: 'Organizations', icon: <Building2 className="h-4 w-4" />, adminOnly: true },
      { to: '/admin/partner-requests', label: 'B2B requests', icon: <Link2 className="h-4 w-4" />, adminOnly: true },
    ] },
    { key: 'marketplace', label: 'Marketplace', icon: <Store className="h-4 w-4" />, items: [
      { to: '/admin/projects', label: t('admin.marinaProjects'), icon: <Anchor className="h-4 w-4" />, adminOnly: true },
      { to: '/admin/rfps', label: 'RFPs', icon: <ClipboardList className="h-4 w-4" />, adminOnly: true },
      { to: '/admin/consultations', label: 'Consultations', icon: <MessageSquare className="h-4 w-4" />, adminOnly: true },
      { to: '/admin/leads', label: t('admin.partnerLeads'), icon: <Users className="h-4 w-4" />, adminOnly: true },
    ] },
    { key: 'commercial', label: 'Commercial & content', icon: <Megaphone className="h-4 w-4" />, items: [
      { to: '/admin/sponsorships', label: 'Sponsorships', icon: <ArrowUpCircle className="h-4 w-4" />, adminOnly: true },
      { to: '/admin/expositions', label: 'Expositions', icon: <Anchor className="h-4 w-4" />, adminOnly: true },
      { to: '/admin/resources', label: isAdmin ? t('admin.resources') : 'Propose Resources', icon: <FileText className="h-4 w-4" /> },
      { to: '/admin/banners', label: 'Ad banners', icon: <Image className="h-4 w-4" />, adminOnly: true },
      { to: '/admin/sectors', label: 'Sectors', icon: <Tag className="h-4 w-4" />, adminOnly: true },
    ] },
  ];

  const visible = (items: NavItem[]) => (isAdmin ? items : items.filter(i => !i.adminOnly));
  const activeGroupKey = groups.find(g => visible(g.items).some(i => isActive(i.to, i.exact)))?.key;

  // Expansion state. Events branches + active bottom group open by default.
  const [open, setOpen] = useState<Record<string, boolean>>(() => ({
    onsite: onSm26 || isAdmin,           // on-site open by default for admins
    smart26: onSm26,
    webinars: onWebinars,
    ...(activeGroupKey ? { [activeGroupKey]: true } : {}),
  }));
  const toggle = (k: string) => setOpen(p => ({ ...p, [k]: !p[k] }));
  useEffect(() => {
    setOpen(p => ({
      ...p,
      ...(onSm26 ? { onsite: true, smart26: true } : {}),
      ...(onWebinars ? { webinars: true } : {}),
      ...(activeGroupKey ? { [activeGroupKey]: true } : {}),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  const linkClass = (active: boolean) =>
    `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
      active ? 'bg-primary/10 text-primary' : 'text-gray-700 hover:bg-gray-100 hover:text-primary'
    }`;

  const Item = ({ l, indent = 0 }: { l: NavItem; indent?: number }) => (
    <Link key={l.to} to={l.to} onClick={onNavigate} className={linkClass(isActive(l.to, l.exact))} style={indent ? { paddingLeft: 12 + indent * 14 } : undefined}>
      {l.icon}{l.label}
    </Link>
  );

  const Caret = ({ isOpen }: { isOpen: boolean }) => (
    <ChevronRight className={`h-3.5 w-3.5 transition-transform shrink-0 ${isOpen ? 'rotate-90' : ''}`} />
  );

  const sectionLabel = 'px-3 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400';

  return (
    <div className={`${mobile ? 'block' : 'hidden md:block'} w-56 shrink-0 bg-white border-r min-h-[calc(100vh-64px)] p-4`}>
      {isMod && (
        <div className="mb-3 px-3 py-1.5 bg-amber-50 text-amber-700 text-xs rounded-lg font-medium">Moderator View</div>
      )}

      <nav className="space-y-1">
        {/* Overview */}
        <Item l={{ to: '/admin', label: isAdmin ? t('admin.dashboard') : 'Moderator Dashboard', icon: <LayoutDashboard className="h-4 w-4" />, exact: true }} />
        {isAdmin && <Item l={{ to: '/admin/pulse', label: 'Industry Pulse', icon: <TrendingUp className="h-4 w-4" /> }} />}

        {/* Events */}
        {isAdmin && (
          <>
            <div className={sectionLabel}>Events</div>

            {/* On-site */}
            <button type="button" onClick={() => toggle('onsite')} className={`w-full ${linkClass(false)} justify-between`}>
              <span className="flex items-center gap-3"><Anchor className="h-4 w-4" /> On-site</span>
              <Caret isOpen={!!open.onsite} />
            </button>
            {open.onsite && (
              <div className="ml-2 pl-2 border-l border-gray-100 space-y-1">
                {/* Smart 26 (expands to its sub-tabs) */}
                <button type="button" onClick={() => toggle('smart26')} className={`w-full ${linkClass(onSm26)} justify-between`}>
                  <span className="flex items-center gap-3"><Ship className="h-4 w-4" /> Smart 26</span>
                  <Caret isOpen={!!open.smart26} />
                </button>
                {open.smart26 && (
                  <div className="ml-2 pl-2 border-l border-gray-100 space-y-1">
                    {sm26Children.map(c => (
                      <Link key={c.to} to={c.to} onClick={onNavigate} className={linkClass(sm26ChildActive(c))}>
                        {c.icon}{c.label}
                      </Link>
                    ))}
                  </div>
                )}
                {/* Add another on-site event */}
                <Link to="/admin/events" onClick={onNavigate} className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-400 hover:text-primary hover:bg-gray-100 transition-colors">
                  <Plus className="h-4 w-4" /> Add on-site event
                </Link>
              </div>
            )}

            {/* Webinars (separate from on-site) */}
            <button type="button" onClick={() => toggle('webinars')} className={`w-full ${linkClass(onWebinars)} justify-between`}>
              <span className="flex items-center gap-3"><Radio className="h-4 w-4" /> Webinars</span>
              <Caret isOpen={!!open.webinars} />
            </button>
            {open.webinars && (
              <div className="ml-2 pl-2 border-l border-gray-100 space-y-1">
                <Item l={{ to: '/admin/webinars', label: 'Webinar requests', icon: <Radio className="h-4 w-4" /> }} />
              </div>
            )}
          </>
        )}
        {/* Moderator sees only the webinar queue under Events */}
        {!isAdmin && (
          <>
            <div className={sectionLabel}>Events</div>
            <Item l={{ to: '/admin/webinars', label: 'Webinar proposals', icon: <Radio className="h-4 w-4" /> }} />
          </>
        )}

        {/* Condensed bottom groups */}
        {groups.map(g => {
          const items = visible(g.items);
          if (items.length === 0) return null;
          const isOpen = !!open[g.key];
          const hasActive = g.key === activeGroupKey;
          return (
            <div key={g.key}>
              <div className={sectionLabel}>{g.label}</div>
              <button type="button" onClick={() => toggle(g.key)} className={`w-full ${linkClass(hasActive && !isOpen)} justify-between`}>
                <span className="flex items-center gap-3 min-w-0">{g.icon}<span className="truncate text-gray-500">{items.map(i => i.label).join(' · ')}</span></span>
                <Caret isOpen={isOpen} />
              </button>
              {isOpen && <div className="ml-2 pl-2 border-l border-gray-100 space-y-1 mt-1">{items.map(l => <Item key={l.to} l={l} />)}</div>}
            </div>
          );
        })}

        {/* Settings (pinned) */}
        {isAdmin && (
          <div className="pt-3 mt-2 border-t border-gray-100">
            <Item l={{ to: '/admin/settings', label: 'Settings', icon: <Settings className="h-4 w-4" /> }} />
          </div>
        )}
      </nav>
    </div>
  );
}
