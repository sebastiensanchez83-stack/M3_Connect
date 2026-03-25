import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Users, UserCheck, FileText, Calendar, Anchor, RefreshCw,
  Link2, ClipboardList, MessageSquare, ChevronRight, FolderOpen,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';

export function AdminDashboard() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    totalUsers: 0, pendingUsers: 0, verifiedUsers: 0,
    totalResources: 0, totalEvents: 0, newProjects: 0, newLeads: 0, newWebinars: 0,
    pendingB2B: 0, openRFPs: 0, openConsultations: 0, contentDrafts: 0,
  });
  const [recentUsers, setRecentUsers] = useState<{ user_id: string; first_name: string | null; last_name: string | null; email: string | null; persona: string; access_status: string; created_at: string }[]>([]);

  useEffect(() => { loadDashboard(); }, []);

  const loadDashboard = async () => {
    setLoading(true);
    try {
      const [
        { count: totalUsers }, { count: pendingUsers }, { count: verifiedUsers },
        { count: totalResources }, { count: totalEvents },
        { count: newProjects }, { count: newLeads }, { count: newWebinars },
        { count: pendingB2B }, { count: openRFPs }, { count: openConsultations }, { count: contentDrafts },
        { data: recent },
      ] = await Promise.all([
        supabase.from('profiles').select('*', { count: 'exact', head: true }),
        supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('access_status', 'pending'),
        supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('access_status', 'verified'),
        supabase.from('resources').select('*', { count: 'exact', head: true }),
        supabase.from('events').select('*', { count: 'exact', head: true }),
        supabase.from('marina_projects').select('*', { count: 'exact', head: true }).eq('status', 'new'),
        supabase.from('partner_leads').select('*', { count: 'exact', head: true }).eq('status', 'new'),
        supabase.from('webinar_requests').select('*', { count: 'exact', head: true }).eq('status', 'submitted'),
        supabase.from('partner_requests').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('rfps').select('*', { count: 'exact', head: true }).eq('is_open', true),
        supabase.from('consultations').select('*', { count: 'exact', head: true }).eq('is_open', true),
        supabase.from('content_drafts').select('*', { count: 'exact', head: true }).eq('status', 'submitted'),
        supabase.from('profiles').select('user_id, first_name, last_name, email, persona, access_status, created_at').order('created_at', { ascending: false }).limit(5),
      ]);
      setStats({
        totalUsers: totalUsers || 0, pendingUsers: pendingUsers || 0, verifiedUsers: verifiedUsers || 0,
        totalResources: totalResources || 0, totalEvents: totalEvents || 0,
        newProjects: newProjects || 0, newLeads: newLeads || 0, newWebinars: newWebinars || 0,
        pendingB2B: pendingB2B || 0, openRFPs: openRFPs || 0, openConsultations: openConsultations || 0, contentDrafts: contentDrafts || 0,
      });
      setRecentUsers((recent || []) as typeof recentUsers);
    } catch (error) { console.error('Error loading dashboard:', error); }
    setLoading(false);
  };

  const getPersonaBadgeSmall = (persona: string) => {
    switch (persona) {
      case 'admin': return <Badge variant="destructive" className="text-[10px]">Admin</Badge>;
      case 'moderator': return <Badge variant="destructive" className="text-[10px]">Mod</Badge>;
      case 'partner': return <Badge variant="success" className="text-[10px]">Partner</Badge>;
      case 'marina': return <Badge variant="info" className="text-[10px]">Marina</Badge>;
      case 'media_partner': return <Badge variant="secondary" className="text-[10px]">Media</Badge>;
      default: return <Badge variant="secondary" className="text-[10px]">{persona}</Badge>;
    }
  };

  const getStatusDot = (status: string) => {
    const colors: Record<string, string> = { verified: 'bg-green-500', pending: 'bg-yellow-500', rejected: 'bg-red-500', suspended: 'bg-gray-500' };
    return <span className={`inline-block h-2 w-2 rounded-full ${colors[status] || 'bg-gray-400'}`} />;
  };

  if (loading) return <div className="flex items-center justify-center h-64"><RefreshCw className="h-8 w-8 animate-spin text-gray-400" /></div>;

  const needsAttention = stats.pendingUsers + stats.newProjects + stats.newWebinars + stats.pendingB2B + stats.contentDrafts;

  return (
    <div className="space-y-6">
      {/* Welcome Header */}
      <div className="rounded-xl bg-gradient-to-r from-[#1e3a5f] to-[#0d9488] p-6 text-white">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-2xl font-bold mb-1">{t('admin.dashboard')}</h1>
            <p className="text-white/80 text-sm">
              {user?.email?.split('@')[0]} &mdash; {new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            </p>
            {needsAttention > 0 && (
              <p className="mt-2 text-sm bg-white/20 rounded-lg px-3 py-1 inline-block">
                {needsAttention} item{needsAttention > 1 ? 's' : ''} need your attention
              </p>
            )}
          </div>
          <Button variant="ghost" size="sm" onClick={loadDashboard} className="text-white hover:bg-white/20">
            <RefreshCw className="h-4 w-4 mr-2" />Refresh
          </Button>
        </div>
      </div>

      {/* Key Metrics — top row (large cards) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="border-l-4 border-l-blue-500">
          <CardContent className="pt-5 pb-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-500">Total Users</p>
                <p className="text-3xl font-bold text-gray-900">{stats.totalUsers}</p>
              </div>
              <div className="h-12 w-12 rounded-full bg-blue-50 flex items-center justify-center">
                <Users className="h-6 w-6 text-blue-600" />
              </div>
            </div>
            <div className="mt-3 flex gap-4 text-xs">
              <span className="text-green-600 font-medium">{stats.verifiedUsers} verified</span>
              <span className="text-yellow-600 font-medium">{stats.pendingUsers} pending</span>
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-purple-500">
          <CardContent className="pt-5 pb-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-500">Resources</p>
                <p className="text-3xl font-bold text-gray-900">{stats.totalResources}</p>
              </div>
              <div className="h-12 w-12 rounded-full bg-purple-50 flex items-center justify-center">
                <FileText className="h-6 w-6 text-purple-600" />
              </div>
            </div>
            <div className="mt-3 flex gap-4 text-xs">
              <span className="text-violet-600 font-medium">{stats.contentDrafts} drafts pending</span>
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-pink-500">
          <CardContent className="pt-5 pb-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-500">Events</p>
                <p className="text-3xl font-bold text-gray-900">{stats.totalEvents}</p>
              </div>
              <div className="h-12 w-12 rounded-full bg-pink-50 flex items-center justify-center">
                <Calendar className="h-6 w-6 text-pink-600" />
              </div>
            </div>
            <div className="mt-3 flex gap-4 text-xs">
              <span className="text-indigo-600 font-medium">{stats.newWebinars} webinar requests</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Activity Cards — smaller items requiring action */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: 'Pending Approval', value: stats.pendingUsers, icon: UserCheck, bg: 'bg-yellow-50', color: 'text-yellow-600', link: '/admin/users' },
          { label: 'New Projects', value: stats.newProjects, icon: Anchor, bg: 'bg-orange-50', color: 'text-orange-600', link: '/admin/projects' },
          { label: 'New Leads', value: stats.newLeads, icon: Users, bg: 'bg-teal-50', color: 'text-teal-600', link: '/admin/leads' },
          { label: 'Pending B2B', value: stats.pendingB2B, icon: Link2, bg: 'bg-rose-50', color: 'text-rose-600', link: '/admin/partner-requests' },
          { label: 'Open RFPs', value: stats.openRFPs, icon: ClipboardList, bg: 'bg-amber-50', color: 'text-amber-600', link: '/admin/rfps' },
          { label: 'Open Consults', value: stats.openConsultations, icon: MessageSquare, bg: 'bg-cyan-50', color: 'text-cyan-600', link: '/admin/consultations' },
        ].map((item, i) => (
          <Card key={i} className="hover:shadow-md transition-shadow cursor-pointer group" onClick={() => navigate(item.link)}>
            <CardContent className="pt-4 pb-4 px-4">
              <div className="flex flex-col items-center text-center gap-2">
                <div className={`h-10 w-10 rounded-lg ${item.bg} flex items-center justify-center group-hover:scale-110 transition-transform`}>
                  <item.icon className={`h-5 w-5 ${item.color}`} />
                </div>
                <div className="text-2xl font-bold">{item.value}</div>
                <div className="text-[11px] text-gray-500 leading-tight">{item.label}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Recent Users */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Recent Users</CardTitle>
            <Button variant="ghost" size="sm" className="text-sm text-primary" onClick={() => navigate('/admin/users')}>
              View all <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="divide-y">
            {recentUsers.map((u) => (
              <Link key={u.user_id} to={`/users/${u.user_id}`} className="flex items-center justify-between py-3 hover:bg-gray-50 -mx-2 px-2 rounded-lg transition-colors">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-full bg-gray-100 flex items-center justify-center text-sm font-medium text-gray-600">
                    {(u.first_name?.[0] || u.email?.[0] || '?').toUpperCase()}
                  </div>
                  <div>
                    <div className="text-sm font-medium text-gray-900">
                      {u.first_name || u.last_name ? `${u.first_name || ''} ${u.last_name || ''}`.trim() : u.email?.split('@')[0] || '—'}
                    </div>
                    <div className="text-xs text-gray-500">{u.email || '—'}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {getPersonaBadgeSmall(u.persona)}
                  {getStatusDot(u.access_status)}
                  <span className="text-xs text-gray-400">{new Date(u.created_at).toLocaleDateString()}</span>
                </div>
              </Link>
            ))}
            {recentUsers.length === 0 && <p className="py-4 text-center text-sm text-gray-400">No users yet</p>}
          </div>
        </CardContent>
      </Card>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Manage Users', icon: Users, link: '/admin/users' },
          { label: 'Add Resource', icon: FileText, link: '/admin/resources' },
          { label: 'Add Event', icon: Calendar, link: '/admin/events' },
          { label: 'Resource Drafts', icon: FolderOpen, link: '/admin/resource-drafts' },
        ].map((action, i) => (
          <Button key={i} variant="outline" className="h-auto py-4 flex flex-col gap-2 hover:bg-primary/5 hover:border-primary/30" onClick={() => navigate(action.link)}>
            <action.icon className="h-5 w-5 text-primary" />
            <span className="text-sm font-medium">{action.label}</span>
          </Button>
        ))}
      </div>
    </div>
  );
}
