import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Users, UserCheck, FileText, Calendar, Anchor, RefreshCw,
  Radio, Link2, ClipboardList, MessageSquare, BookOpen, FolderOpen,
  ArrowUpCircle,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

export function AdminSidebar() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const isAdmin = profile?.persona === 'admin';

  const allLinks = [
    { to: '/admin', label: t('admin.dashboard'), icon: <RefreshCw className="h-4 w-4" />, exact: true },
    { to: '/admin/users', label: t('admin.users'), icon: <Users className="h-4 w-4" />, adminOnly: true },
    { to: '/admin/resources', label: t('admin.resources'), icon: <FileText className="h-4 w-4" /> },
    { to: '/admin/events', label: t('admin.events'), icon: <Calendar className="h-4 w-4" />, adminOnly: true },
    { to: '/admin/partners', label: t('admin.partners'), icon: <UserCheck className="h-4 w-4" />, adminOnly: true },
    { to: '/admin/sponsorships', label: 'Sponsorships', icon: <ArrowUpCircle className="h-4 w-4" />, adminOnly: true },
    { to: '/admin/expositions', label: 'Expositions', icon: <Anchor className="h-4 w-4" />, adminOnly: true },
    { to: '/admin/projects', label: t('admin.marinaProjects'), icon: <Anchor className="h-4 w-4" />, adminOnly: true },
    { to: '/admin/leads', label: t('admin.partnerLeads'), icon: <Users className="h-4 w-4" />, adminOnly: true },
    { to: '/admin/webinars', label: 'Webinar Requests', icon: <Radio className="h-4 w-4" /> },
    { to: '/admin/partner-requests', label: 'B2B Requests', icon: <Link2 className="h-4 w-4" />, adminOnly: true },
    { to: '/admin/rfps', label: 'RFPs', icon: <ClipboardList className="h-4 w-4" />, adminOnly: true },
    { to: '/admin/consultations', label: 'Consultations', icon: <MessageSquare className="h-4 w-4" />, adminOnly: true },
    { to: '/admin/content', label: 'CMS Content', icon: <BookOpen className="h-4 w-4" />, adminOnly: true },
    { to: '/admin/resource-drafts', label: 'Resource Drafts', icon: <FolderOpen className="h-4 w-4" /> },
  ];

  const links = isAdmin ? allLinks : allLinks.filter((l) => !l.adminOnly);

  return (
    <div className="w-56 shrink-0 bg-white border-r min-h-[calc(100vh-64px)] p-4">
      {!isAdmin && (
        <div className="mb-3 px-3 py-1.5 bg-amber-50 text-amber-700 text-xs rounded-lg font-medium">
          Moderator View
        </div>
      )}
      <nav className="space-y-1">
        {links.map((l) => (
          <Link
            key={l.to}
            to={l.to}
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-700 hover:bg-gray-100 hover:text-primary transition-colors"
          >
            {l.icon}
            {l.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
