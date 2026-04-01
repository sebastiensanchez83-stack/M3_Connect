import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Users, FileText, Calendar, Anchor, RefreshCw,
  Radio, Link2, ClipboardList, MessageSquare, FolderOpen,
  ArrowUpCircle, LayoutDashboard,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

export function AdminSidebar() {
  const { t } = useTranslation();
  const location = useLocation();
  const { profile, isAdmin } = useAuth();
  const isMod = profile?.persona === 'moderator';

  // Admin sees everything; moderator only sees their scoped panel
  const allLinks = [
    { to: '/admin', label: isAdmin ? t('admin.dashboard') : 'Moderator Dashboard', icon: <LayoutDashboard className="h-4 w-4" />, exact: true },
    { to: '/admin/users', label: t('admin.users'), icon: <Users className="h-4 w-4" />, adminOnly: true },
    { to: '/admin/resources', label: isAdmin ? t('admin.resources') : 'Propose Resources', icon: <FileText className="h-4 w-4" /> },
    { to: '/admin/events', label: t('admin.events'), icon: <Calendar className="h-4 w-4" />, adminOnly: true },
    // Partners merged into Users tab
    { to: '/admin/sponsorships', label: 'Sponsorships', icon: <ArrowUpCircle className="h-4 w-4" />, adminOnly: true },
    { to: '/admin/expositions', label: 'Expositions', icon: <Anchor className="h-4 w-4" />, adminOnly: true },
    { to: '/admin/projects', label: t('admin.marinaProjects'), icon: <Anchor className="h-4 w-4" />, adminOnly: true },
    { to: '/admin/leads', label: t('admin.partnerLeads'), icon: <Users className="h-4 w-4" />, adminOnly: true },
    { to: '/admin/webinars', label: isAdmin ? 'Webinar Requests' : 'Webinar Proposals', icon: <Radio className="h-4 w-4" /> },
    { to: '/admin/partner-requests', label: 'B2B Requests', icon: <Link2 className="h-4 w-4" />, adminOnly: true },
    { to: '/admin/rfps', label: 'RFPs', icon: <ClipboardList className="h-4 w-4" />, adminOnly: true },
    { to: '/admin/consultations', label: 'Consultations', icon: <MessageSquare className="h-4 w-4" />, adminOnly: true },
    { to: '/admin/resource-drafts', label: 'Resource Requests', icon: <FolderOpen className="h-4 w-4" /> },
  ];

  const links = isAdmin ? allLinks : allLinks.filter((l) => !l.adminOnly);

  const isActive = (to: string, exact?: boolean) => {
    // Strip query params from comparison — /admin/events?foo=bar should still highlight "Events"
    const path = location.pathname;
    if (exact) return path === to;
    // Special: /admin/events/123 should still highlight /admin/events
    return path.startsWith(to) && to !== '/admin';
  };

  return (
    <div className="w-56 shrink-0 bg-white border-r min-h-[calc(100vh-64px)] p-4">
      {isMod && (
        <div className="mb-3 px-3 py-1.5 bg-amber-50 text-amber-700 text-xs rounded-lg font-medium">
          Moderator View
        </div>
      )}
      <nav className="space-y-1">
        {links.map((l) => (
          <Link
            key={l.to}
            to={l.to}
            className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              isActive(l.to, l.exact)
                ? 'bg-primary/10 text-primary'
                : 'text-gray-700 hover:bg-gray-100 hover:text-primary'
            }`}
          >
            {l.icon}
            {l.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
