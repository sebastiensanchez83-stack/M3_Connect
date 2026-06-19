import { useState, useEffect, ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Users, FileText, Calendar, Anchor, Radio, Link2, ClipboardList, MessageSquare,
  ArrowUpCircle, LayoutDashboard, Settings, Image, Building2, Tag, TrendingUp, Ship,
  ChevronRight, Megaphone, Store, UsersRound,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

// Grouped, collapsible admin navigation. The flat 18-item list was too long, so
// links are organised into a handful of sections; the section containing the
// current route stays open, the rest collapse. Events nests on-site (Smart 26 +
// other events) and webinars, per the agreed structure.

interface NavItem { to: string; label: string; icon: ReactNode; exact?: boolean; adminOnly?: boolean }
interface NavSection { label?: string; items: NavItem[] }
interface NavGroup { key: string; label: string; icon: ReactNode; sections: NavSection[] }

export function AdminSidebar({ mobile = false, onNavigate }: { mobile?: boolean; onNavigate?: () => void } = {}) {
  const { t } = useTranslation();
  const location = useLocation();
  const { profile, isAdmin } = useAuth();
  const isMod = profile?.persona === 'moderator';

  // Always-visible quick links (no group header).
  const overview: NavItem[] = [
    { to: '/admin', label: isAdmin ? t('admin.dashboard') : 'Moderator Dashboard', icon: <LayoutDashboard className="h-4 w-4" />, exact: true },
    { to: '/admin/pulse', label: 'Industry Pulse', icon: <TrendingUp className="h-4 w-4" />, adminOnly: true },
  ];

  const groups: NavGroup[] = [
    {
      key: 'events', label: 'Events', icon: <Calendar className="h-4 w-4" />,
      sections: [
        { label: 'On-site', items: [
          { to: '/admin/sm26', label: 'Smart Marina 26', icon: <Ship className="h-4 w-4" />, adminOnly: true },
          { to: '/admin/events', label: 'All events', icon: <Calendar className="h-4 w-4" />, adminOnly: true },
        ] },
        { label: 'Webinars', items: [
          { to: '/admin/webinars', label: isAdmin ? 'Webinar requests' : 'Webinar proposals', icon: <Radio className="h-4 w-4" /> },
        ] },
      ],
    },
    {
      key: 'community', label: 'Community', icon: <UsersRound className="h-4 w-4" />,
      sections: [{ items: [
        { to: '/admin/users', label: t('admin.users'), icon: <Users className="h-4 w-4" />, adminOnly: true },
        { to: '/admin/organizations', label: 'Organizations', icon: <Building2 className="h-4 w-4" />, adminOnly: true },
        { to: '/admin/partner-requests', label: 'B2B requests', icon: <Link2 className="h-4 w-4" />, adminOnly: true },
      ] }],
    },
    {
      key: 'marketplace', label: 'Marketplace', icon: <Store className="h-4 w-4" />,
      sections: [{ items: [
        { to: '/admin/projects', label: t('admin.marinaProjects'), icon: <Anchor className="h-4 w-4" />, adminOnly: true },
        { to: '/admin/rfps', label: 'RFPs', icon: <ClipboardList className="h-4 w-4" />, adminOnly: true },
        { to: '/admin/consultations', label: 'Consultations', icon: <MessageSquare className="h-4 w-4" />, adminOnly: true },
        { to: '/admin/leads', label: t('admin.partnerLeads'), icon: <Users className="h-4 w-4" />, adminOnly: true },
      ] }],
    },
    {
      key: 'content', label: 'Content', icon: <FileText className="h-4 w-4" />,
      sections: [{ items: [
        { to: '/admin/resources', label: isAdmin ? t('admin.resources') : 'Propose Resources', icon: <FileText className="h-4 w-4" /> },
        { to: '/admin/banners', label: 'Ad banners', icon: <Image className="h-4 w-4" />, adminOnly: true },
        { to: '/admin/sectors', label: 'Sectors', icon: <Tag className="h-4 w-4" />, adminOnly: true },
      ] }],
    },
    {
      key: 'commercial', label: 'Commercial', icon: <Megaphone className="h-4 w-4" />,
      sections: [{ items: [
        { to: '/admin/sponsorships', label: 'Sponsorships', icon: <ArrowUpCircle className="h-4 w-4" />, adminOnly: true },
        { to: '/admin/expositions', label: 'Expositions', icon: <Anchor className="h-4 w-4" />, adminOnly: true },
      ] }],
    },
    {
      key: 'system', label: 'System', icon: <Settings className="h-4 w-4" />,
      sections: [{ items: [
        { to: '/admin/settings', label: 'Platform settings', icon: <Settings className="h-4 w-4" />, adminOnly: true },
      ] }],
    },
  ];

  const visibleItems = (items: NavItem[]) => (isAdmin ? items : items.filter(i => !i.adminOnly));

  const isActive = (to: string, exact?: boolean) => {
    const path = location.pathname;
    const toPath = to.split('?')[0];
    if (exact) return path === toPath;
    return path.startsWith(toPath) && toPath !== '/admin';
  };

  // Which group owns the current route? Used to auto-open it.
  const groupHasActive = (g: NavGroup) =>
    g.sections.some(s => visibleItems(s.items).some(i => isActive(i.to, i.exact)));
  const activeGroupKey = groups.find(groupHasActive)?.key;

  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(groups.map(g => [g.key, g.key === activeGroupKey])));

  // Keep the active group open as the route changes (manual toggles preserved otherwise).
  useEffect(() => {
    if (activeGroupKey) setOpen(prev => (prev[activeGroupKey] ? prev : { ...prev, [activeGroupKey]: true }));
  }, [activeGroupKey]);

  const itemLink = (l: NavItem) => (
    <Link
      key={l.to}
      to={l.to}
      onClick={onNavigate}
      className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
        isActive(l.to, l.exact) ? 'bg-primary/10 text-primary' : 'text-gray-700 hover:bg-gray-100 hover:text-primary'
      }`}
    >
      {l.icon}
      {l.label}
    </Link>
  );

  return (
    <div className={`${mobile ? 'block' : 'hidden md:block'} w-56 shrink-0 bg-white border-r min-h-[calc(100vh-64px)] p-4`}>
      {isMod && (
        <div className="mb-3 px-3 py-1.5 bg-amber-50 text-amber-700 text-xs rounded-lg font-medium">Moderator View</div>
      )}

      <nav className="space-y-1">
        {visibleItems(overview).map(itemLink)}

        {groups.map(g => {
          const sections = g.sections
            .map(s => ({ ...s, items: visibleItems(s.items) }))
            .filter(s => s.items.length > 0);
          if (sections.length === 0) return null; // hide empty groups (e.g. for moderators)
          const isOpen = !!open[g.key];
          const hasActive = g.key === activeGroupKey;
          return (
            <div key={g.key} className="pt-2">
              <button
                type="button"
                onClick={() => setOpen(prev => ({ ...prev, [g.key]: !prev[g.key] }))}
                className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-[11px] font-semibold uppercase tracking-wide transition-colors ${
                  hasActive ? 'text-primary' : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                <ChevronRight className={`h-3.5 w-3.5 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                {g.label}
              </button>
              {isOpen && (
                <div className="mt-1 space-y-1">
                  {sections.map((s, si) => (
                    <div key={si} className="space-y-1">
                      {s.label && <div className="px-3 pt-1 text-[10px] uppercase tracking-wider text-gray-300">{s.label}</div>}
                      {s.items.map(itemLink)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </div>
  );
}
