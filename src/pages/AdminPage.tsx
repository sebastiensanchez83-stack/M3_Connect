import { useState, useEffect } from 'react';
import { Routes, Route, Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Users, UserCheck, FileText, Calendar, Anchor, RefreshCw, Search,
  Download, Plus, Pencil, Trash2, Eye, ChevronRight, Radio,
  Link2, ClipboardList, MessageSquare, BookOpen, FolderOpen,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RichTextEditor } from '@/components/ui/RichTextEditor';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';

/* ─── Types ─── */
interface AdminProfile {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  persona: string;
  access_status: string;
  onboarding_status: string;
  rejection_reason: string | null;
  created_at: string;
  marina_profiles: { marina_name: string } | null;
  partner_profiles: { company_name: string } | null;
  media_partner_profiles: { media_name: string } | null;
}

interface Resource {
  id: string;
  title: string;
  summary: string;
  content: string | null;
  type: string;
  topic: string;
  language: string;
  access_level: string;
  thumbnail_url: string | null;
  file_url: string | null;
  published: boolean;
}

interface Event {
  id: string;
  title: string;
  description: string;
  date_time: string;
  location: string | null;
  language: string;
  access_level: string;
  speakers: { name: string; title: string }[];
  replay_url: string | null;
}

interface Partner {
  id: string;
  name: string;
  description: string;
  logo_url: string | null;
  website: string | null;
  sector: string;
  country: string;
  is_featured: boolean;
}

interface MarinaProject {
  id: string;
  user_id: string;
  project_type: string;
  budget_range: string;
  timeline: string;
  description: string;
  status: string;
  admin_notes: string | null;
  created_at: string;
}

interface PartnerLead {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  company: string;
  website: string | null;
  country: string;
  actor_type: string;
  solutions: string | null;
  goals: string | null;
  engagement_level: string;
  status: string;
  admin_notes: string | null;
  created_at: string;
}

interface WebinarRequest {
  id: string;
  user_id: string;
  title: string;
  description: string;
  preferred_language: string;
  preferred_timeframe: string | null;
  status: string;
  moderator_notes: string | null;
  reviewed_at: string | null;
  created_at: string;
}

interface PartnerRequest {
  id: string;
  partner_user_id: string;
  marina_user_id: string;
  sector_id: string | null;
  message: string;
  status: string;
  created_at: string;
}

interface RFP {
  id: string;
  marina_user_id: string;
  title: string;
  scope: string;
  sector_id: string | null;
  deadline_date: string | null;
  is_open: boolean;
  created_at: string;
}

interface Consultation {
  id: string;
  marina_user_id: string;
  title: string;
  description: string;
  sector_id: string | null;
  is_open: boolean;
  created_at: string;
}

interface ContentDraft {
  id: string;
  content_item_id: string | null;
  title: string;
  summary: string | null;
  body_markdown: string;
  tags: string[];
  status: string;
  created_by: string;
  created_at: string;
}

interface ResourceDraft {
  id: string;
  resource_id: string | null;
  title: string;
  summary: string | null;
  content: string;
  type: string | null;
  topic: string | null;
  language: string | null;
  access_level: string | null;
  status: string;
  created_by: string;
  created_at: string;
}

/* ─── Sidebar ─── */
function AdminSidebar() {
  const { t } = useTranslation();
  const links = [
    { to: '/admin', label: t('admin.dashboard'), icon: <RefreshCw className="h-4 w-4" />, exact: true },
    { to: '/admin/users', label: t('admin.users'), icon: <Users className="h-4 w-4" /> },
    { to: '/admin/resources', label: t('admin.resources'), icon: <FileText className="h-4 w-4" /> },
    { to: '/admin/events', label: t('admin.events'), icon: <Calendar className="h-4 w-4" /> },
    { to: '/admin/partners', label: t('admin.partners'), icon: <UserCheck className="h-4 w-4" /> },
    { to: '/admin/projects', label: t('admin.marinaProjects'), icon: <Anchor className="h-4 w-4" /> },
    { to: '/admin/leads', label: t('admin.partnerLeads'), icon: <Users className="h-4 w-4" /> },
    { to: '/admin/webinars', label: 'Webinar Requests', icon: <Radio className="h-4 w-4" /> },
    { to: '/admin/partner-requests', label: 'B2B Requests', icon: <Link2 className="h-4 w-4" /> },
    { to: '/admin/rfps', label: 'RFPs', icon: <ClipboardList className="h-4 w-4" /> },
    { to: '/admin/consultations', label: 'Consultations', icon: <MessageSquare className="h-4 w-4" /> },
    { to: '/admin/content', label: 'CMS Content', icon: <BookOpen className="h-4 w-4" /> },
    { to: '/admin/resource-drafts', label: 'Resource Drafts', icon: <FolderOpen className="h-4 w-4" /> },
  ];
  return (
    <div className="w-56 shrink-0 bg-white border-r min-h-[calc(100vh-64px)] p-4">
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

/* ─── Dashboard ─── */
function Dashboard() {
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
              <div key={u.user_id} className="flex items-center justify-between py-3">
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
              </div>
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

/* ─── Users Admin ─── */
function UsersAdmin() {
  const { t } = useTranslation();
  const [users, setUsers] = useState<AdminProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [personaFilter, setPersonaFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [rejectingUserId, setRejectingUserId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [selectedUser, setSelectedUser] = useState<AdminProfile | null>(null);
  const [detailData, setDetailData] = useState<Record<string, unknown> | null>(null);
  const [detailSectors, setDetailSectors] = useState<string[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => { loadUsers(); }, []);

  const loadUsers = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select(`
          user_id, first_name, last_name, email, persona,
          access_status, onboarding_status, rejection_reason, created_at,
          marina_profiles(marina_name),
          partner_profiles(company_name),
          media_partner_profiles(media_name)
        `)
        .order('created_at', { ascending: false });
      if (error) { console.error('Error loading users:', error); toast({ title: 'Error loading users', description: error.message, variant: 'destructive' }); }
      // Normalize: PostgREST may return arrays for embedded resources
      const normalized = (data || []).map((row: Record<string, unknown>) => ({
        ...row,
        marina_profiles: Array.isArray(row.marina_profiles) ? row.marina_profiles[0] || null : row.marina_profiles,
        partner_profiles: Array.isArray(row.partner_profiles) ? row.partner_profiles[0] || null : row.partner_profiles,
        media_partner_profiles: Array.isArray(row.media_partner_profiles) ? row.media_partner_profiles[0] || null : row.media_partner_profiles,
      }));
      setUsers(normalized as unknown as AdminProfile[]);
    } catch (err) { console.error('Error loading users:', err); }
    setLoading(false);
  };

  const getUserName = (u: AdminProfile) => {
    try {
      if (u.first_name || u.last_name) return `${u.first_name || ''} ${u.last_name || ''}`.trim();
      return u.email?.split('@')[0] || t('admin.userDetail.noName');
    } catch { return t('admin.userDetail.noName'); }
  };

  const getOrgName = (u: AdminProfile) => {
    try {
      if (u.marina_profiles?.marina_name) return u.marina_profiles.marina_name;
      if (u.partner_profiles?.company_name) return u.partner_profiles.company_name;
      if (u.media_partner_profiles?.media_name) return u.media_partner_profiles.media_name;
      return '';
    } catch { return ''; }
  };

  const openUserDetail = async (u: AdminProfile) => {
    setSelectedUser(u);
    setDetailData(null);
    setDetailSectors([]);
    setDetailLoading(true);
    try {
      if (u.persona === 'marina') {
        const [{ data: mp }, { data: sectors }] = await Promise.all([
          supabase.from('marina_profiles').select('*').eq('user_id', u.user_id).maybeSingle(),
          supabase.from('marina_interest_sectors').select('sectors(label)').eq('user_id', u.user_id),
        ]);
        setDetailData(mp as Record<string, unknown> | null);
        setDetailSectors((sectors || []).map((s: Record<string, unknown>) => ((s.sectors as Record<string, unknown> | null)?.label as string) || '').filter(Boolean));
      } else if (u.persona === 'partner') {
        const [{ data: pp }, { data: sectors }] = await Promise.all([
          supabase.from('partner_profiles').select('*').eq('user_id', u.user_id).maybeSingle(),
          supabase.from('partner_service_sectors').select('sectors(label)').eq('user_id', u.user_id),
        ]);
        setDetailData(pp as Record<string, unknown> | null);
        setDetailSectors((sectors || []).map((s: Record<string, unknown>) => ((s.sectors as Record<string, unknown> | null)?.label as string) || '').filter(Boolean));
      } else if (u.persona === 'media_partner') {
        const { data: mpp } = await supabase.from('media_partner_profiles').select('*').eq('user_id', u.user_id).maybeSingle();
        setDetailData(mpp as Record<string, unknown> | null);
      }
    } catch (err) { console.error('Error loading user detail:', err); }
    setDetailLoading(false);
  };

  const approveUser = async (userId: string) => {
    const { error } = await supabase.from('profiles').update({ access_status: 'verified', onboarding_status: 'completed', rejection_reason: null }).eq('user_id', userId);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'User approved' }); loadUsers();
  };
  const openReject = (userId: string) => { setRejectingUserId(userId); setRejectReason(''); };
  const confirmReject = async () => {
    if (!rejectingUserId || !rejectReason.trim()) { toast({ title: t('admin.userDetail.reasonRequired'), variant: 'destructive' }); return; }
    const { error } = await supabase.from('profiles').update({ access_status: 'rejected', onboarding_status: 'draft', rejection_reason: rejectReason.trim() }).eq('user_id', rejectingUserId);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'User rejected' }); setRejectingUserId(null); loadUsers();
  };
  const updateUserStatus = async (userId: string, newStatus: string) => {
    if (newStatus === 'verified') { await approveUser(userId); return; }
    if (newStatus === 'rejected') { openReject(userId); return; }
    await supabase.from('profiles').update({ access_status: newStatus }).eq('user_id', userId);
    toast({ title: `Status: ${newStatus}` }); loadUsers();
  };

  const filteredUsers = users.filter(user => {
    const name = getUserName(user).toLowerCase();
    const org = getOrgName(user).toLowerCase();
    const email = (user.email || '').toLowerCase();
    const q = search.toLowerCase();
    const matchesSearch = search === '' || name.includes(q) || org.includes(q) || email.includes(q) || user.persona.includes(q);
    const matchesPersona = personaFilter === 'all' || user.persona === personaFilter;
    const matchesStatus = statusFilter === 'all' || user.access_status === statusFilter;
    return matchesSearch && matchesPersona && matchesStatus;
  });

  const exportCSV = () => {
    const csv = [['Name', 'Email', 'Organization', 'Persona', 'Access Status', 'Onboarding', 'Created'].join(','),
      ...filteredUsers.map(u => [
        `"${getUserName(u)}"`, `"${u.email || ''}"`, `"${getOrgName(u)}"`,
        u.persona, u.access_status, u.onboarding_status, new Date(u.created_at).toLocaleDateString()
      ].join(','))
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'users.csv'; a.click();
  };

  const getPersonaBadge = (persona: string) => {
    switch (persona) {
      case 'admin': return <Badge variant="destructive">Admin</Badge>;
      case 'moderator': return <Badge variant="destructive">Moderator</Badge>;
      case 'partner': return <Badge variant="success">Partner</Badge>;
      case 'marina': return <Badge variant="info">Marina</Badge>;
      case 'media_partner': return <Badge variant="secondary">Media</Badge>;
      default: return <Badge variant="secondary">{persona}</Badge>;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'verified': return <Badge variant="success">Verified</Badge>;
      case 'pending': return <Badge variant="warning">Pending</Badge>;
      case 'rejected': return <Badge variant="destructive">Rejected</Badge>;
      case 'suspended': return <Badge variant="destructive">Suspended</Badge>;
      default: return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const DetailRow = ({ label, value }: { label: string; value: React.ReactNode }) => {
    if (!value) return null;
    return (
      <div className="flex justify-between py-2 border-b border-gray-100 last:border-0">
        <span className="text-sm text-gray-500 font-medium">{label}</span>
        <span className="text-sm text-gray-900 text-right max-w-[60%]">{value}</span>
      </div>
    );
  };

  if (loading) return <div className="flex items-center justify-center h-64"><RefreshCw className="h-8 w-8 animate-spin text-gray-400" /></div>;

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">{t('admin.users')} ({users.length})</h1>
        <Button variant="outline" size="sm" onClick={exportCSV}><Download className="h-4 w-4 mr-2" />{t('admin.export')}</Button>
      </div>
      <div className="flex gap-4 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input placeholder={t('admin.userDetail.searchPlaceholder')} value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="verified">Verified</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
            <SelectItem value="suspended">Suspended</SelectItem>
          </SelectContent>
        </Select>
        <Select value={personaFilter} onValueChange={setPersonaFilter}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Persona" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="marina">Marina</SelectItem>
            <SelectItem value="partner">Partner</SelectItem>
            <SelectItem value="media_partner">Media</SelectItem>
            <SelectItem value="moderator">Moderator</SelectItem>
            <SelectItem value="admin">Admin</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Card><CardContent className="p-0"><div className="overflow-x-auto"><table className="w-full"><thead className="bg-gray-50 border-b"><tr>
        <th className="text-left p-4 font-medium">{t('admin.userDetail.name')}</th>
        <th className="text-left p-4 font-medium">{t('admin.userDetail.organization')}</th>
        <th className="text-left p-4 font-medium">{t('admin.userDetail.persona')}</th>
        <th className="text-left p-4 font-medium">{t('admin.userDetail.onboarding')}</th>
        <th className="text-left p-4 font-medium">{t('admin.userDetail.accessStatus')}</th>
        <th className="text-left p-4 font-medium">{t('admin.userDetail.created')}</th>
      </tr></thead><tbody>
        {filteredUsers.map(user => (
          <tr key={user.user_id} className="border-b hover:bg-gray-50 cursor-pointer" onClick={() => openUserDetail(user)}>
            <td className="p-4">
              <div className="font-medium text-gray-900">{getUserName(user)}</div>
              <div className="text-xs text-gray-500">{user.email || ''}</div>
            </td>
            <td className="p-4 text-sm text-gray-700">{getOrgName(user) || <span className="text-gray-400">—</span>}</td>
            <td className="p-4">{getPersonaBadge(user.persona)}</td>
            <td className="p-4 text-sm capitalize">{user.onboarding_status}</td>
            <td className="p-4">
              <Select value={user.access_status} onValueChange={(v) => { v !== user.access_status && updateUserStatus(user.user_id, v); }}>
                <SelectTrigger className="w-36" onClick={(e) => e.stopPropagation()}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">Pending</SelectItem><SelectItem value="verified">Verified</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem><SelectItem value="suspended">Suspended</SelectItem>
                </SelectContent>
              </Select>
            </td>
            <td className="p-4 text-sm text-gray-500">{new Date(user.created_at).toLocaleDateString()}</td>
          </tr>
        ))}
        {filteredUsers.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-gray-400">No users found</td></tr>}
      </tbody></table></div></CardContent></Card>

      {/* ─── User Detail Dialog ─── */}
      <Dialog open={!!selectedUser} onOpenChange={() => setSelectedUser(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('admin.userDetail.title')}</DialogTitle>
            <DialogDescription>{selectedUser?.email || ''}</DialogDescription>
          </DialogHeader>
          {selectedUser && (
            <div className="space-y-6 mt-2">
              {/* Header */}
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-lg font-semibold">{getUserName(selectedUser)}</h3>
                  <p className="text-sm text-gray-500">{selectedUser.email}</p>
                </div>
                <div className="flex gap-2">
                  {getPersonaBadge(selectedUser.persona)}
                  {getStatusBadge(selectedUser.access_status)}
                </div>
              </div>

              {/* Base info */}
              <div className="bg-gray-50 rounded-lg p-4">
                <DetailRow label={t('admin.userDetail.name')} value={selectedUser.first_name || selectedUser.last_name ? `${selectedUser.first_name || ''} ${selectedUser.last_name || ''}`.trim() : t('admin.userDetail.noName')} />
                <DetailRow label={t('admin.userDetail.email')} value={selectedUser.email} />
                <DetailRow label={t('admin.userDetail.organization')} value={getOrgName(selectedUser) || t('admin.userDetail.noOrg')} />
                <DetailRow label={t('admin.userDetail.persona')} value={selectedUser.persona} />
                <DetailRow label={t('admin.userDetail.onboarding')} value={selectedUser.onboarding_status} />
                <DetailRow label={t('admin.userDetail.accessStatus')} value={selectedUser.access_status} />
                <DetailRow label={t('admin.userDetail.created')} value={new Date(selectedUser.created_at).toLocaleDateString()} />
                {selectedUser.rejection_reason && (
                  <DetailRow label={t('admin.userDetail.rejectionReason')} value={<span className="text-red-600">{selectedUser.rejection_reason}</span>} />
                )}
              </div>

              {/* Persona-specific details */}
              {detailLoading ? (
                <div className="flex justify-center py-4"><RefreshCw className="h-5 w-5 animate-spin text-gray-400" /></div>
              ) : detailData && (
                <div className="space-y-3">
                  <h4 className="font-semibold text-sm text-gray-700">
                    {selectedUser.persona === 'marina' ? t('admin.userDetail.marinaInfo')
                      : selectedUser.persona === 'partner' ? t('admin.userDetail.partnerInfo')
                      : t('admin.userDetail.mediaInfo')}
                  </h4>
                  <div className="bg-gray-50 rounded-lg p-4">
                    {selectedUser.persona === 'marina' && (
                      <>
                        <DetailRow label={t('admin.userDetail.marinaName')} value={detailData.marina_name as string} />
                        <DetailRow label={t('admin.userDetail.country')} value={detailData.country as string} />
                        <DetailRow label={t('admin.userDetail.city')} value={detailData.city as string} />
                        <DetailRow label={t('admin.userDetail.website')} value={detailData.website ? <a href={detailData.website as string} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{detailData.website as string}</a> : null} />
                        <DetailRow label={t('admin.userDetail.berths')} value={detailData.berths_count as number} />
                        <DetailRow label={t('admin.userDetail.marinaType')} value={detailData.marina_type as string} />
                        <DetailRow label={t('admin.userDetail.superyachtBerths')} value={detailData.superyacht_berths as number} />
                        <DetailRow label={t('admin.userDetail.longestBerth')} value={detailData.longest_berth_meters as number} />
                        <DetailRow label={t('admin.userDetail.certifications')} value={detailData.certifications ? (detailData.certifications as string[]).join(', ') : null} />
                      </>
                    )}
                    {selectedUser.persona === 'partner' && (
                      <>
                        <DetailRow label={t('admin.userDetail.companyName')} value={detailData.company_name as string} />
                        <DetailRow label={t('admin.userDetail.headquartersCountry')} value={detailData.headquarters_country as string} />
                        <DetailRow label={t('admin.userDetail.website')} value={detailData.website ? <a href={detailData.website as string} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{detailData.website as string}</a> : null} />
                        <DetailRow label={t('admin.userDetail.description')} value={detailData.description as string} />
                      </>
                    )}
                    {selectedUser.persona === 'media_partner' && (
                      <>
                        <DetailRow label={t('admin.userDetail.mediaName')} value={detailData.media_name as string} />
                        <DetailRow label={t('admin.userDetail.website')} value={detailData.website ? <a href={detailData.website as string} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{detailData.website as string}</a> : null} />
                        <DetailRow label={t('admin.userDetail.audienceDescription')} value={detailData.audience_description as string} />
                      </>
                    )}
                    {detailSectors.length > 0 && (
                      <DetailRow label={t('admin.userDetail.sectors')} value={
                        <div className="flex flex-wrap gap-1 justify-end">
                          {detailSectors.map(s => <Badge key={s} variant="outline" className="text-xs">{s}</Badge>)}
                        </div>
                      } />
                    )}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2 justify-end pt-2 border-t">
                {selectedUser.access_status !== 'verified' && (
                  <Button size="sm" onClick={() => { approveUser(selectedUser.user_id); setSelectedUser(null); }}>
                    <UserCheck className="h-4 w-4 mr-1" />{t('admin.userDetail.approve')}
                  </Button>
                )}
                {selectedUser.access_status !== 'rejected' && (
                  <Button size="sm" variant="destructive" onClick={() => { openReject(selectedUser.user_id); setSelectedUser(null); }}>
                    {t('admin.userDetail.reject')}
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ─── Reject Dialog ─── */}
      <Dialog open={!!rejectingUserId} onOpenChange={() => setRejectingUserId(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{t('admin.userDetail.rejectUser')}</DialogTitle><DialogDescription>{t('admin.userDetail.rejectReason')}</DialogDescription></DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-2"><Label>{t('admin.userDetail.rejectionReason')} *</Label><Textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} rows={3} placeholder="..." /></div>
            <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setRejectingUserId(null)}>{t('admin.userDetail.cancel')}</Button><Button variant="destructive" onClick={confirmReject}>{t('admin.userDetail.confirmRejection')}</Button></div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ─── Resources Admin ─── */
function ResourcesAdmin() {
  const { t } = useTranslation();
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingResource, setEditingResource] = useState<Resource | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [formData, setFormData] = useState({ title: '', summary: '', content: '', type: 'article', topic: 'Sustainability', language: 'EN', access_level: 'public', thumbnail_url: '', file_url: '', published: true });

  useEffect(() => { loadResources(); }, []);
  const loadResources = async () => { setLoading(true); const { data } = await supabase.from('resources').select('*').order('created_at', { ascending: false }); setResources(data || []); setLoading(false); };

  const openCreate = () => { setEditingResource(null); setFormData({ title: '', summary: '', content: '', type: 'article', topic: 'Sustainability', language: 'EN', access_level: 'public', thumbnail_url: '', file_url: '', published: true }); setIsDialogOpen(true); };
  const openEdit = (resource: Resource) => { setEditingResource(resource); setFormData({ title: resource.title, summary: resource.summary, content: resource.content || '', type: resource.type, topic: resource.topic, language: resource.language, access_level: resource.access_level, thumbnail_url: resource.thumbnail_url || '', file_url: resource.file_url || '', published: resource.published }); setIsDialogOpen(true); };

  const handleSave = async () => {
    const payload = { ...formData, thumbnail_url: formData.thumbnail_url || null, file_url: formData.file_url || null, content: formData.content || null };
    if (editingResource) { await supabase.from('resources').update(payload).eq('id', editingResource.id); toast({ title: 'Resource updated!' }); }
    else { await supabase.from('resources').insert(payload); toast({ title: 'Resource created!' }); }
    setIsDialogOpen(false); loadResources();
  };
  const handleDelete = async (id: string) => { if (!confirm('Delete this resource?')) return; await supabase.from('resources').delete().eq('id', id); toast({ title: 'Deleted' }); loadResources(); };

  const types = ['article', 'whitepaper', 'guide', 'replay', 'case_study'];
  const topics = ['Sustainability', 'Technology', 'Energy', 'Management', 'Events', 'Infrastructure'];

  if (loading) return <div className="flex items-center justify-center h-64"><RefreshCw className="h-8 w-8 animate-spin text-gray-400" /></div>;

  return (
    <div>
      <div className="flex justify-between items-center mb-6"><h1 className="text-2xl font-bold">{t('admin.resources')} ({resources.length})</h1><Button onClick={openCreate}><Plus className="h-4 w-4 mr-2" />Add Resource</Button></div>
      <Card><CardContent className="p-0"><div className="overflow-x-auto"><table className="w-full"><thead className="bg-gray-50 border-b"><tr><th className="text-left p-4 font-medium">Title</th><th className="text-left p-4 font-medium">Type</th><th className="text-left p-4 font-medium">Access</th><th className="text-left p-4 font-medium">Lang</th><th className="text-left p-4 font-medium">Status</th><th className="text-left p-4 font-medium">Actions</th></tr></thead><tbody>
        {resources.map(r => (<tr key={r.id} className="border-b hover:bg-gray-50"><td className="p-4"><div className="font-medium">{r.title}</div><div className="text-sm text-gray-500 truncate max-w-xs">{r.summary}</div></td><td className="p-4"><Badge variant="outline">{r.type}</Badge></td><td className="p-4"><Badge variant={r.access_level === 'public' ? 'success' : 'info'}>{r.access_level}</Badge></td><td className="p-4">{r.language}</td><td className="p-4"><Badge variant={r.published ? 'success' : 'secondary'}>{r.published ? 'Published' : 'Draft'}</Badge></td><td className="p-4"><div className="flex gap-2"><Button size="sm" variant="ghost" onClick={() => openEdit(r)}><Pencil className="h-4 w-4" /></Button><Button size="sm" variant="ghost" onClick={() => handleDelete(r.id)}><Trash2 className="h-4 w-4 text-red-500" /></Button></div></td></tr>))}
      </tbody></table></div></CardContent></Card>
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}><DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>{editingResource ? 'Edit Resource' : 'Add Resource'}</DialogTitle><DialogDescription>Fill in the resource details below.</DialogDescription></DialogHeader><div className="space-y-4 mt-4">
        <div className="space-y-2"><Label>Title *</Label><Input value={formData.title} onChange={e => setFormData({ ...formData, title: e.target.value })} /></div>
        <div className="space-y-2"><Label>Summary *</Label><Textarea value={formData.summary} onChange={e => setFormData({ ...formData, summary: e.target.value })} rows={2} /></div>
        <div className="space-y-2"><Label>Content</Label><RichTextEditor content={formData.content} onChange={(html) => setFormData({ ...formData, content: html })} placeholder="Write the resource content..." /></div>
        <div className="grid grid-cols-2 gap-4"><div className="space-y-2"><Label>Type</Label><Select value={formData.type} onValueChange={v => setFormData({ ...formData, type: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{types.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label>Topic</Label><Select value={formData.topic} onValueChange={v => setFormData({ ...formData, topic: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{topics.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select></div></div>
        <div className="grid grid-cols-2 gap-4"><div className="space-y-2"><Label>Language</Label><Select value={formData.language} onValueChange={v => setFormData({ ...formData, language: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="EN">English</SelectItem><SelectItem value="FR">Français</SelectItem></SelectContent></Select></div><div className="space-y-2"><Label>Access</Label><Select value={formData.access_level} onValueChange={v => setFormData({ ...formData, access_level: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="public">Public</SelectItem><SelectItem value="members">Members</SelectItem><SelectItem value="marina">Marina</SelectItem></SelectContent></Select></div></div>
        <div className="space-y-2"><Label>Thumbnail URL</Label><Input value={formData.thumbnail_url} onChange={e => setFormData({ ...formData, thumbnail_url: e.target.value })} placeholder="https://..." /></div>
        <div className="space-y-2"><Label>File URL</Label><Input value={formData.file_url} onChange={e => setFormData({ ...formData, file_url: e.target.value })} placeholder="https://..." /></div>
        <div className="flex items-center space-x-2"><Checkbox id="published" checked={formData.published} onCheckedChange={(c) => setFormData({ ...formData, published: c as boolean })} /><Label htmlFor="published">Published</Label></div>
        <div className="flex justify-end gap-2 pt-4"><Button variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button><Button onClick={handleSave}>{editingResource ? 'Update' : 'Create'}</Button></div>
      </div></DialogContent></Dialog>
    </div>
  );
}

/* ─── Events Admin ─── */
function EventsAdmin() {
  const { t } = useTranslation();
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingEvent, setEditingEvent] = useState<Event | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [formData, setFormData] = useState({ title: '', description: '', date_time: '', location: '', language: 'EN', access_level: 'public', speakers: '', replay_url: '' });

  useEffect(() => { loadEvents(); }, []);
  const loadEvents = async () => { setLoading(true); const { data } = await supabase.from('events').select('*').order('date_time', { ascending: false }); setEvents(data || []); setLoading(false); };

  const openCreate = () => { setEditingEvent(null); setFormData({ title: '', description: '', date_time: '', location: '', language: 'EN', access_level: 'public', speakers: '', replay_url: '' }); setIsDialogOpen(true); };
  const openEdit = (event: Event) => { setEditingEvent(event); setFormData({ title: event.title, description: event.description, date_time: event.date_time ? new Date(event.date_time).toISOString().slice(0, 16) : '', location: event.location || '', language: event.language, access_level: event.access_level, speakers: event.speakers ? JSON.stringify(event.speakers) : '', replay_url: event.replay_url || '' }); setIsDialogOpen(true); };

  const handleSave = async () => {
    let speakers: { name: string; title: string }[] = [];
    try { if (formData.speakers) speakers = JSON.parse(formData.speakers); } catch { toast({ title: 'Invalid speakers JSON', variant: 'destructive' }); return; }
    const payload = { title: formData.title, description: formData.description, date_time: formData.date_time, location: formData.location || null, language: formData.language, access_level: formData.access_level, speakers, replay_url: formData.replay_url || null };
    if (editingEvent) { await supabase.from('events').update(payload).eq('id', editingEvent.id); toast({ title: 'Event updated!' }); }
    else { await supabase.from('events').insert(payload); toast({ title: 'Event created!' }); }
    setIsDialogOpen(false); loadEvents();
  };
  const handleDelete = async (id: string) => { if (!confirm('Delete this event?')) return; await supabase.from('events').delete().eq('id', id); toast({ title: 'Deleted' }); loadEvents(); };

  if (loading) return <div className="flex items-center justify-center h-64"><RefreshCw className="h-8 w-8 animate-spin text-gray-400" /></div>;

  return (
    <div>
      <div className="flex justify-between items-center mb-6"><h1 className="text-2xl font-bold">{t('admin.events')} ({events.length})</h1><Button onClick={openCreate}><Plus className="h-4 w-4 mr-2" />Add Event</Button></div>
      <Card><CardContent className="p-0"><div className="overflow-x-auto"><table className="w-full"><thead className="bg-gray-50 border-b"><tr><th className="text-left p-4 font-medium">Title</th><th className="text-left p-4 font-medium">Date</th><th className="text-left p-4 font-medium">Location</th><th className="text-left p-4 font-medium">Access</th><th className="text-left p-4 font-medium">Actions</th></tr></thead><tbody>
        {events.map(e => (<tr key={e.id} className="border-b hover:bg-gray-50"><td className="p-4 font-medium">{e.title}</td><td className="p-4">{new Date(e.date_time).toLocaleDateString()}</td><td className="p-4">{e.location || 'Online'}</td><td className="p-4"><Badge variant={e.access_level === 'public' ? 'success' : 'info'}>{e.access_level}</Badge></td><td className="p-4"><div className="flex gap-2"><Button size="sm" variant="ghost" onClick={() => openEdit(e)}><Pencil className="h-4 w-4" /></Button><Button size="sm" variant="ghost" onClick={() => handleDelete(e.id)}><Trash2 className="h-4 w-4 text-red-500" /></Button></div></td></tr>))}
      </tbody></table></div></CardContent></Card>
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}><DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>{editingEvent ? 'Edit Event' : 'Add Event'}</DialogTitle><DialogDescription>Manage event details.</DialogDescription></DialogHeader><div className="space-y-4 mt-4">
        <div className="space-y-2"><Label>Title *</Label><Input value={formData.title} onChange={e => setFormData({ ...formData, title: e.target.value })} /></div>
        <div className="space-y-2"><Label>Description *</Label><Textarea value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })} rows={3} /></div>
        <div className="grid grid-cols-2 gap-4"><div className="space-y-2"><Label>Date & Time *</Label><Input type="datetime-local" value={formData.date_time} onChange={e => setFormData({ ...formData, date_time: e.target.value })} /></div><div className="space-y-2"><Label>Location</Label><Input value={formData.location} onChange={e => setFormData({ ...formData, location: e.target.value })} placeholder="Monaco Yacht Club" /></div></div>
        <div className="grid grid-cols-2 gap-4"><div className="space-y-2"><Label>Language</Label><Select value={formData.language} onValueChange={v => setFormData({ ...formData, language: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="EN">English</SelectItem><SelectItem value="FR">Français</SelectItem></SelectContent></Select></div><div className="space-y-2"><Label>Access Level</Label><Select value={formData.access_level} onValueChange={v => setFormData({ ...formData, access_level: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="public">Public</SelectItem><SelectItem value="members">Members</SelectItem><SelectItem value="marina">Marina Only</SelectItem></SelectContent></Select></div></div>
        <div className="space-y-2"><Label>Speakers (JSON)</Label><Textarea value={formData.speakers} onChange={e => setFormData({ ...formData, speakers: e.target.value })} placeholder='[{"name":"John","title":"CEO"}]' rows={2} /></div>
        <div className="space-y-2"><Label>Replay URL</Label><Input value={formData.replay_url} onChange={e => setFormData({ ...formData, replay_url: e.target.value })} /></div>
        <div className="flex justify-end gap-2 pt-4"><Button variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button><Button onClick={handleSave}>{editingEvent ? 'Update' : 'Create'}</Button></div>
      </div></DialogContent></Dialog>
    </div>
  );
}

/* ─── Partners Admin ─── */
function PartnersAdmin() {
  const { t } = useTranslation();
  const [partners, setPartners] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingPartner, setEditingPartner] = useState<Partner | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [formData, setFormData] = useState({ name: '', description: '', logo_url: '', website: '', sector: 'services', country: '', is_featured: false });
  const sectors = ['energy', 'equipment', 'digital', 'environment', 'services', 'institution'];

  useEffect(() => { loadPartners(); }, []);
  const loadPartners = async () => { setLoading(true); const { data } = await supabase.from('partners').select('*').order('name'); setPartners(data || []); setLoading(false); };

  const openCreate = () => { setEditingPartner(null); setFormData({ name: '', description: '', logo_url: '', website: '', sector: 'services', country: '', is_featured: false }); setIsDialogOpen(true); };
  const openEdit = (p: Partner) => { setEditingPartner(p); setFormData({ name: p.name, description: p.description, logo_url: p.logo_url || '', website: p.website || '', sector: p.sector, country: p.country, is_featured: p.is_featured }); setIsDialogOpen(true); };

  const handleSave = async () => {
    const payload = { ...formData, logo_url: formData.logo_url || null, website: formData.website || null };
    if (editingPartner) { await supabase.from('partners').update(payload).eq('id', editingPartner.id); toast({ title: 'Updated!' }); }
    else { await supabase.from('partners').insert(payload); toast({ title: 'Created!' }); }
    setIsDialogOpen(false); loadPartners();
  };
  const handleDelete = async (id: string) => { if (!confirm('Delete?')) return; await supabase.from('partners').delete().eq('id', id); toast({ title: 'Deleted' }); loadPartners(); };

  if (loading) return <div className="flex items-center justify-center h-64"><RefreshCw className="h-8 w-8 animate-spin text-gray-400" /></div>;

  return (
    <div>
      <div className="flex justify-between items-center mb-6"><h1 className="text-2xl font-bold">{t('admin.partners')} ({partners.length})</h1><Button onClick={openCreate}><Plus className="h-4 w-4 mr-2" />Add Partner</Button></div>
      <Card><CardContent className="p-0"><table className="w-full"><thead className="bg-gray-50 border-b"><tr><th className="text-left p-4 font-medium">Name</th><th className="text-left p-4 font-medium">Sector</th><th className="text-left p-4 font-medium">Country</th><th className="text-left p-4 font-medium">Featured</th><th className="text-left p-4 font-medium">Actions</th></tr></thead><tbody>
        {partners.map(p => (<tr key={p.id} className="border-b hover:bg-gray-50"><td className="p-4 font-medium">{p.name}</td><td className="p-4"><Badge variant="outline">{p.sector}</Badge></td><td className="p-4">{p.country}</td><td className="p-4">{p.is_featured ? 'Yes' : '-'}</td><td className="p-4"><div className="flex gap-2"><Button size="sm" variant="ghost" onClick={() => openEdit(p)}><Pencil className="h-4 w-4" /></Button><Button size="sm" variant="ghost" onClick={() => handleDelete(p.id)}><Trash2 className="h-4 w-4 text-red-500" /></Button></div></td></tr>))}
      </tbody></table></CardContent></Card>
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>{editingPartner ? 'Edit Partner' : 'Add Partner'}</DialogTitle><DialogDescription>Manage partner information.</DialogDescription></DialogHeader><div className="space-y-4 mt-4">
        <div className="space-y-2"><Label>Name *</Label><Input value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} /></div>
        <div className="space-y-2"><Label>Description *</Label><Textarea value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })} /></div>
        <div className="grid grid-cols-2 gap-4"><div className="space-y-2"><Label>Sector</Label><Select value={formData.sector} onValueChange={v => setFormData({ ...formData, sector: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{sectors.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label>Country</Label><Input value={formData.country} onChange={e => setFormData({ ...formData, country: e.target.value })} /></div></div>
        <div className="space-y-2"><Label>Logo URL</Label><Input value={formData.logo_url} onChange={e => setFormData({ ...formData, logo_url: e.target.value })} /></div>
        <div className="space-y-2"><Label>Website</Label><Input value={formData.website} onChange={e => setFormData({ ...formData, website: e.target.value })} /></div>
        <div className="flex items-center space-x-2"><Checkbox id="featured" checked={formData.is_featured} onCheckedChange={(c) => setFormData({ ...formData, is_featured: c as boolean })} /><Label htmlFor="featured">Featured</Label></div>
        <div className="flex justify-end gap-2 pt-4"><Button variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button><Button onClick={handleSave}>{editingPartner ? 'Update' : 'Create'}</Button></div>
      </div></DialogContent></Dialog>
    </div>
  );
}

/* ─── Projects Admin ─── */
function ProjectsAdmin() {
  const { t } = useTranslation();
  const [projects, setProjects] = useState<MarinaProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedProject, setSelectedProject] = useState<MarinaProject | null>(null);
  const [adminNotes, setAdminNotes] = useState('');

  useEffect(() => { loadProjects(); }, []);
  const loadProjects = async () => { setLoading(true); const { data } = await supabase.from('marina_projects').select('*').order('created_at', { ascending: false }); setProjects(data || []); setLoading(false); };
  const updateStatus = async (id: string, status: string) => { await supabase.from('marina_projects').update({ status }).eq('id', id); toast({ title: `Status: ${status}` }); loadProjects(); };
  const saveNotes = async () => { if (!selectedProject) return; await supabase.from('marina_projects').update({ admin_notes: adminNotes }).eq('id', selectedProject.id); toast({ title: 'Notes saved' }); setSelectedProject(null); loadProjects(); };

  if (loading) return <div className="flex items-center justify-center h-64"><RefreshCw className="h-8 w-8 animate-spin text-gray-400" /></div>;

  return (
    <div>
      <div className="flex justify-between items-center mb-6"><h1 className="text-2xl font-bold">{t('admin.marinaProjects')} ({projects.length})</h1></div>
      <Card><CardContent className="p-0"><table className="w-full"><thead className="bg-gray-50 border-b"><tr><th className="text-left p-4 font-medium">Marina</th><th className="text-left p-4 font-medium">Type</th><th className="text-left p-4 font-medium">Budget</th><th className="text-left p-4 font-medium">Status</th><th className="text-left p-4 font-medium">Date</th><th className="text-left p-4 font-medium">Actions</th></tr></thead><tbody>
        {projects.map(p => (<tr key={p.id} className="border-b hover:bg-gray-50"><td className="p-4 font-mono text-xs text-gray-600">{p.user_id}</td><td className="p-4">{p.project_type}</td><td className="p-4">{p.budget_range}</td><td className="p-4"><Select value={p.status} onValueChange={v => updateStatus(p.id, v)}><SelectTrigger className="w-32"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="new">New</SelectItem><SelectItem value="in_progress">In Progress</SelectItem><SelectItem value="completed">Completed</SelectItem></SelectContent></Select></td><td className="p-4 text-gray-500">{new Date(p.created_at).toLocaleDateString()}</td><td className="p-4"><Button size="sm" variant="ghost" onClick={() => { setSelectedProject(p); setAdminNotes(p.admin_notes || ''); }}><Eye className="h-4 w-4" /></Button></td></tr>))}
      </tbody></table></CardContent></Card>
      <Dialog open={!!selectedProject} onOpenChange={() => setSelectedProject(null)}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>Project Details</DialogTitle><DialogDescription>View and manage project notes.</DialogDescription></DialogHeader>{selectedProject && (<div className="space-y-4 mt-4"><div><strong>Type:</strong> {selectedProject.project_type}</div><div><strong>Budget:</strong> {selectedProject.budget_range}</div><div><strong>Description:</strong><p className="mt-1 p-2 bg-gray-50 rounded text-sm">{selectedProject.description}</p></div><div className="space-y-2"><Label>Admin Notes</Label><Textarea value={adminNotes} onChange={e => setAdminNotes(e.target.value)} rows={3} /></div><Button onClick={saveNotes} className="w-full">Save Notes</Button></div>)}</DialogContent></Dialog>
    </div>
  );
}

/* ─── Leads Admin ─── */
function LeadsAdmin() {
  const { t } = useTranslation();
  const [leads, setLeads] = useState<PartnerLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLead, setSelectedLead] = useState<PartnerLead | null>(null);
  const [adminNotes, setAdminNotes] = useState('');

  useEffect(() => { loadLeads(); }, []);
  const loadLeads = async () => { setLoading(true); const { data } = await supabase.from('partner_leads').select('*').order('created_at', { ascending: false }); setLeads(data || []); setLoading(false); };
  const updateStatus = async (id: string, status: string) => { await supabase.from('partner_leads').update({ status }).eq('id', id); toast({ title: `Status: ${status}` }); loadLeads(); };
  const saveNotes = async () => { if (!selectedLead) return; await supabase.from('partner_leads').update({ admin_notes: adminNotes }).eq('id', selectedLead.id); toast({ title: 'Notes saved' }); setSelectedLead(null); loadLeads(); };

  if (loading) return <div className="flex items-center justify-center h-64"><RefreshCw className="h-8 w-8 animate-spin text-gray-400" /></div>;

  return (
    <div>
      <div className="flex justify-between items-center mb-6"><h1 className="text-2xl font-bold">{t('admin.partnerLeads')} ({leads.length})</h1></div>
      <Card><CardContent className="p-0"><table className="w-full"><thead className="bg-gray-50 border-b"><tr><th className="text-left p-4 font-medium">Company</th><th className="text-left p-4 font-medium">Contact</th><th className="text-left p-4 font-medium">Type</th><th className="text-left p-4 font-medium">Status</th><th className="text-left p-4 font-medium">Date</th><th className="text-left p-4 font-medium">Actions</th></tr></thead><tbody>
        {leads.map(l => (<tr key={l.id} className="border-b hover:bg-gray-50"><td className="p-4"><div className="font-medium">{l.company}</div><div className="text-sm text-gray-500">{l.country}</div></td><td className="p-4"><div>{l.first_name} {l.last_name}</div><div className="text-sm text-gray-500">{l.email}</div></td><td className="p-4"><Badge variant="outline">{l.actor_type}</Badge></td><td className="p-4"><Select value={l.status} onValueChange={v => updateStatus(l.id, v)}><SelectTrigger className="w-36"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="new">New</SelectItem><SelectItem value="qualified">Qualified</SelectItem><SelectItem value="in_discussion">In Discussion</SelectItem><SelectItem value="signed">Signed</SelectItem><SelectItem value="rejected">Rejected</SelectItem></SelectContent></Select></td><td className="p-4 text-gray-500">{new Date(l.created_at).toLocaleDateString()}</td><td className="p-4"><Button size="sm" variant="ghost" onClick={() => { setSelectedLead(l); setAdminNotes(l.admin_notes || ''); }}><Eye className="h-4 w-4" /></Button></td></tr>))}
      </tbody></table></CardContent></Card>
      <Dialog open={!!selectedLead} onOpenChange={() => setSelectedLead(null)}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>Lead Details</DialogTitle><DialogDescription>View lead information and manage notes.</DialogDescription></DialogHeader>{selectedLead && (<div className="space-y-4 mt-4"><div className="grid grid-cols-2 gap-4"><div><strong>Company:</strong> {selectedLead.company}</div><div><strong>Country:</strong> {selectedLead.country}</div><div><strong>Contact:</strong> {selectedLead.first_name} {selectedLead.last_name}</div><div><strong>Email:</strong> {selectedLead.email}</div></div><div className="space-y-2"><Label>Admin Notes</Label><Textarea value={adminNotes} onChange={e => setAdminNotes(e.target.value)} rows={3} /></div><Button onClick={saveNotes} className="w-full">Save Notes</Button></div>)}</DialogContent></Dialog>
    </div>
  );
}

/* ─── Webinar Requests Admin ─── */
function WebinarRequestsAdmin() {
  const [requests, setRequests] = useState<WebinarRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<WebinarRequest | null>(null);
  const [moderatorNotes, setModeratorNotes] = useState('');

  useEffect(() => { loadRequests(); }, []);
  const loadRequests = async () => { setLoading(true); const { data } = await supabase.from('webinar_requests').select('*').order('created_at', { ascending: false }); setRequests(data || []); setLoading(false); };
  const updateStatus = async (id: string, status: string) => { await supabase.from('webinar_requests').update({ status, reviewed_at: new Date().toISOString() }).eq('id', id); toast({ title: `Status: ${status}` }); loadRequests(); };
  const saveNotes = async () => { if (!selected) return; await supabase.from('webinar_requests').update({ moderator_notes: moderatorNotes.trim() || null }).eq('id', selected.id); toast({ title: 'Notes saved' }); setSelected(null); loadRequests(); };

  if (loading) return <div className="flex items-center justify-center h-64"><RefreshCw className="h-8 w-8 animate-spin text-gray-400" /></div>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Webinar Requests ({requests.length})</h1>
      <Card><CardContent className="p-0"><div className="overflow-x-auto"><table className="w-full"><thead className="bg-gray-50 border-b"><tr><th className="text-left p-4 font-medium">Title</th><th className="text-left p-4 font-medium">Lang</th><th className="text-left p-4 font-medium">Status</th><th className="text-left p-4 font-medium">Date</th><th className="text-left p-4 font-medium">Actions</th></tr></thead><tbody>
        {requests.map(r => (<tr key={r.id} className="border-b hover:bg-gray-50"><td className="p-4 font-medium max-w-xs truncate">{r.title}</td><td className="p-4">{r.preferred_language}</td><td className="p-4"><Select value={r.status} onValueChange={v => updateStatus(r.id, v)}><SelectTrigger className="w-36"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="submitted">Submitted</SelectItem><SelectItem value="under_review">Under Review</SelectItem><SelectItem value="accepted">Accepted</SelectItem><SelectItem value="rejected">Rejected</SelectItem></SelectContent></Select></td><td className="p-4 text-gray-500">{new Date(r.created_at).toLocaleDateString()}</td><td className="p-4"><Button size="sm" variant="ghost" onClick={() => { setSelected(r); setModeratorNotes(r.moderator_notes || ''); }}><Eye className="h-4 w-4" /></Button></td></tr>))}
        {requests.length === 0 && <tr><td colSpan={5} className="p-8 text-center text-gray-400">No requests yet</td></tr>}
      </tbody></table></div></CardContent></Card>
      <Dialog open={!!selected} onOpenChange={() => setSelected(null)}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>Webinar Request Details</DialogTitle><DialogDescription>Review and add moderator notes.</DialogDescription></DialogHeader>{selected && (<div className="space-y-4 mt-2"><div><strong>Title:</strong> {selected.title}</div><div><strong>Description:</strong><p className="mt-1 p-3 bg-gray-50 rounded text-sm whitespace-pre-wrap">{selected.description}</p></div><div className="space-y-2"><Label>Moderator Notes</Label><Textarea value={moderatorNotes} onChange={e => setModeratorNotes(e.target.value)} rows={3} /></div><Button onClick={saveNotes} className="w-full">Save Notes</Button></div>)}</DialogContent></Dialog>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   NEW ADMIN SECTIONS
   ═══════════════════════════════════════════════════════════ */

/* ─── Partner Requests Admin (B2B Matching) ─── */
function PartnerRequestsAdmin() {
  const [requests, setRequests] = useState<PartnerRequest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, []);
  const load = async () => { setLoading(true); const { data } = await supabase.from('partner_requests').select('*').order('created_at', { ascending: false }); setRequests(data || []); setLoading(false); };

  const statusBadge = (s: string) => {
    const m: Record<string, 'warning' | 'success' | 'destructive' | 'secondary'> = { pending: 'warning', accepted: 'success', rejected: 'destructive', withdrawn: 'secondary' };
    return <Badge variant={m[s] || 'secondary'}>{s}</Badge>;
  };

  if (loading) return <div className="flex items-center justify-center h-64"><RefreshCw className="h-8 w-8 animate-spin text-gray-400" /></div>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">B2B Partner Requests ({requests.length})</h1>
      <Card><CardContent className="p-0"><div className="overflow-x-auto"><table className="w-full"><thead className="bg-gray-50 border-b"><tr>
        <th className="text-left p-4 font-medium">Partner</th><th className="text-left p-4 font-medium">Marina</th><th className="text-left p-4 font-medium">Message</th><th className="text-left p-4 font-medium">Status</th><th className="text-left p-4 font-medium">Date</th>
      </tr></thead><tbody>
        {requests.map(r => (<tr key={r.id} className="border-b hover:bg-gray-50">
          <td className="p-4 text-xs font-mono text-gray-500">{r.partner_user_id.slice(0, 8)}...</td>
          <td className="p-4 text-xs font-mono text-gray-500">{r.marina_user_id.slice(0, 8)}...</td>
          <td className="p-4 text-sm max-w-xs truncate">{r.message}</td>
          <td className="p-4">{statusBadge(r.status)}</td>
          <td className="p-4 text-sm text-gray-500">{new Date(r.created_at).toLocaleDateString()}</td>
        </tr>))}
        {requests.length === 0 && <tr><td colSpan={5} className="p-8 text-center text-gray-400">No B2B requests yet</td></tr>}
      </tbody></table></div></CardContent></Card>
    </div>
  );
}

/* ─── RFPs Admin ─── */
function RFPsAdmin() {
  const [rfps, setRfps] = useState<RFP[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<RFP | null>(null);

  useEffect(() => { load(); }, []);
  const load = async () => { setLoading(true); const { data } = await supabase.from('rfps').select('*').order('created_at', { ascending: false }); setRfps(data || []); setLoading(false); };
  const toggleOpen = async (id: string, is_open: boolean) => { await supabase.from('rfps').update({ is_open }).eq('id', id); toast({ title: is_open ? 'RFP reopened' : 'RFP closed' }); load(); };

  if (loading) return <div className="flex items-center justify-center h-64"><RefreshCw className="h-8 w-8 animate-spin text-gray-400" /></div>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">RFPs ({rfps.length})</h1>
      <Card><CardContent className="p-0"><div className="overflow-x-auto"><table className="w-full"><thead className="bg-gray-50 border-b"><tr>
        <th className="text-left p-4 font-medium">Title</th><th className="text-left p-4 font-medium">Marina</th><th className="text-left p-4 font-medium">Deadline</th><th className="text-left p-4 font-medium">Status</th><th className="text-left p-4 font-medium">Actions</th>
      </tr></thead><tbody>
        {rfps.map(r => (<tr key={r.id} className="border-b hover:bg-gray-50">
          <td className="p-4 font-medium max-w-xs truncate">{r.title}</td>
          <td className="p-4 text-xs font-mono text-gray-500">{r.marina_user_id.slice(0, 8)}...</td>
          <td className="p-4 text-sm text-gray-500">{r.deadline_date ? new Date(r.deadline_date).toLocaleDateString() : '—'}</td>
          <td className="p-4"><Badge variant={r.is_open ? 'success' : 'secondary'}>{r.is_open ? 'Open' : 'Closed'}</Badge></td>
          <td className="p-4"><div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setSelected(r)}><Eye className="h-4 w-4" /></Button>
            <Button size="sm" variant="outline" onClick={() => toggleOpen(r.id, !r.is_open)}>{r.is_open ? 'Close' : 'Reopen'}</Button>
          </div></td>
        </tr>))}
        {rfps.length === 0 && <tr><td colSpan={5} className="p-8 text-center text-gray-400">No RFPs yet</td></tr>}
      </tbody></table></div></CardContent></Card>
      <Dialog open={!!selected} onOpenChange={() => setSelected(null)}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>RFP Details</DialogTitle><DialogDescription>View the full scope of this RFP.</DialogDescription></DialogHeader>{selected && (<div className="space-y-4 mt-2"><div><strong>Title:</strong> {selected.title}</div><div><strong>Scope:</strong><p className="mt-1 p-3 bg-gray-50 rounded text-sm whitespace-pre-wrap">{selected.scope}</p></div><div className="grid grid-cols-2 gap-4 text-sm"><div><strong>Deadline:</strong> {selected.deadline_date || '—'}</div><div><strong>Status:</strong> {selected.is_open ? 'Open' : 'Closed'}</div></div></div>)}</DialogContent></Dialog>
    </div>
  );
}

/* ─── Consultations Admin ─── */
function ConsultationsAdmin() {
  const [consultations, setConsultations] = useState<Consultation[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Consultation | null>(null);

  useEffect(() => { load(); }, []);
  const load = async () => { setLoading(true); const { data } = await supabase.from('consultations').select('*').order('created_at', { ascending: false }); setConsultations(data || []); setLoading(false); };
  const toggleOpen = async (id: string, is_open: boolean) => { await supabase.from('consultations').update({ is_open }).eq('id', id); toast({ title: is_open ? 'Reopened' : 'Closed' }); load(); };

  if (loading) return <div className="flex items-center justify-center h-64"><RefreshCw className="h-8 w-8 animate-spin text-gray-400" /></div>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Consultations ({consultations.length})</h1>
      <Card><CardContent className="p-0"><div className="overflow-x-auto"><table className="w-full"><thead className="bg-gray-50 border-b"><tr>
        <th className="text-left p-4 font-medium">Title</th><th className="text-left p-4 font-medium">Marina</th><th className="text-left p-4 font-medium">Status</th><th className="text-left p-4 font-medium">Date</th><th className="text-left p-4 font-medium">Actions</th>
      </tr></thead><tbody>
        {consultations.map(c => (<tr key={c.id} className="border-b hover:bg-gray-50">
          <td className="p-4 font-medium max-w-xs truncate">{c.title}</td>
          <td className="p-4 text-xs font-mono text-gray-500">{c.marina_user_id.slice(0, 8)}...</td>
          <td className="p-4"><Badge variant={c.is_open ? 'success' : 'secondary'}>{c.is_open ? 'Open' : 'Closed'}</Badge></td>
          <td className="p-4 text-sm text-gray-500">{new Date(c.created_at).toLocaleDateString()}</td>
          <td className="p-4"><div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setSelected(c)}><Eye className="h-4 w-4" /></Button>
            <Button size="sm" variant="outline" onClick={() => toggleOpen(c.id, !c.is_open)}>{c.is_open ? 'Close' : 'Reopen'}</Button>
          </div></td>
        </tr>))}
        {consultations.length === 0 && <tr><td colSpan={5} className="p-8 text-center text-gray-400">No consultations yet</td></tr>}
      </tbody></table></div></CardContent></Card>
      <Dialog open={!!selected} onOpenChange={() => setSelected(null)}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>Consultation Details</DialogTitle><DialogDescription>View the consultation question.</DialogDescription></DialogHeader>{selected && (<div className="space-y-4 mt-2"><div><strong>Title:</strong> {selected.title}</div><div><strong>Description:</strong><p className="mt-1 p-3 bg-gray-50 rounded text-sm whitespace-pre-wrap">{selected.description}</p></div></div>)}</DialogContent></Dialog>
    </div>
  );
}

/* ─── CMS Content Drafts Admin ─── */
function ContentDraftsAdmin() {
  const { user } = useAuth();
  const [drafts, setDrafts] = useState<ContentDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ContentDraft | null>(null);
  const [formData, setFormData] = useState({ title: '', summary: '', body_markdown: '', tags: '' });

  useEffect(() => { load(); }, []);
  const load = async () => { setLoading(true); const { data } = await supabase.from('content_drafts').select('*').order('created_at', { ascending: false }); setDrafts(data || []); setLoading(false); };

  const openCreate = () => { setEditing(null); setFormData({ title: '', summary: '', body_markdown: '', tags: '' }); setIsDialogOpen(true); };
  const openEdit = (d: ContentDraft) => { setEditing(d); setFormData({ title: d.title, summary: d.summary || '', body_markdown: d.body_markdown, tags: d.tags.join(', ') }); setIsDialogOpen(true); };

  const handleSave = async () => {
    const tags = formData.tags.split(',').map(t => t.trim()).filter(Boolean);
    const payload = { title: formData.title, summary: formData.summary || null, body_markdown: formData.body_markdown, tags, created_by: user!.id };
    if (editing) { await supabase.from('content_drafts').update(payload).eq('id', editing.id); toast({ title: 'Draft updated' }); }
    else { await supabase.from('content_drafts').insert({ ...payload, status: 'draft' }); toast({ title: 'Draft created' }); }
    setIsDialogOpen(false); load();
  };

  const updateStatus = async (id: string, status: string) => {
    if (status === 'published') {
      // Publish: create content_item from draft
      const draft = drafts.find(d => d.id === id);
      if (!draft) return;
      const { error: pubError } = await supabase.from('content_items').insert({
        title: draft.title, summary: draft.summary, body_markdown: draft.body_markdown,
        tags: draft.tags, is_published: true, published_at: new Date().toISOString(), published_by: user!.id,
      });
      if (pubError) { toast({ title: 'Publish failed', description: pubError.message, variant: 'destructive' }); return; }
      await supabase.from('content_drafts').update({ status: 'published' }).eq('id', id);
      toast({ title: 'Content published!' }); load(); return;
    }
    await supabase.from('content_drafts').update({ status }).eq('id', id);
    toast({ title: `Status: ${status}` }); load();
  };

  const statusColor = (s: string): 'secondary' | 'warning' | 'info' | 'success' | 'destructive' => {
    const m: Record<string, 'secondary' | 'warning' | 'info' | 'success' | 'destructive'> = { draft: 'secondary', submitted: 'warning', review_1: 'info', review_2: 'info', approved: 'success', published: 'success', rejected: 'destructive' };
    return m[s] || 'secondary';
  };

  if (loading) return <div className="flex items-center justify-center h-64"><RefreshCw className="h-8 w-8 animate-spin text-gray-400" /></div>;

  return (
    <div>
      <div className="flex justify-between items-center mb-6"><h1 className="text-2xl font-bold">CMS Content ({drafts.length})</h1><Button onClick={openCreate}><Plus className="h-4 w-4 mr-2" />New Draft</Button></div>
      <Card><CardContent className="p-0"><div className="overflow-x-auto"><table className="w-full"><thead className="bg-gray-50 border-b"><tr>
        <th className="text-left p-4 font-medium">Title</th><th className="text-left p-4 font-medium">Tags</th><th className="text-left p-4 font-medium">Status</th><th className="text-left p-4 font-medium">Date</th><th className="text-left p-4 font-medium">Actions</th>
      </tr></thead><tbody>
        {drafts.map(d => (<tr key={d.id} className="border-b hover:bg-gray-50">
          <td className="p-4"><div className="font-medium">{d.title}</div>{d.summary && <div className="text-sm text-gray-500 truncate max-w-xs">{d.summary}</div>}</td>
          <td className="p-4"><div className="flex flex-wrap gap-1">{d.tags.map(t => <Badge key={t} variant="outline" className="text-xs">{t}</Badge>)}</div></td>
          <td className="p-4">
            <Select value={d.status} onValueChange={v => updateStatus(d.id, v)}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Draft</SelectItem><SelectItem value="submitted">Submitted</SelectItem>
                <SelectItem value="review_1">Review 1</SelectItem><SelectItem value="review_2">Review 2</SelectItem>
                <SelectItem value="approved">Approved</SelectItem><SelectItem value="published">Publish</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>
          </td>
          <td className="p-4 text-sm text-gray-500">{new Date(d.created_at).toLocaleDateString()}</td>
          <td className="p-4"><Button size="sm" variant="ghost" onClick={() => openEdit(d)}><Pencil className="h-4 w-4" /></Button></td>
        </tr>))}
        {drafts.length === 0 && <tr><td colSpan={5} className="p-8 text-center text-gray-400">No content drafts</td></tr>}
      </tbody></table></div></CardContent></Card>
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}><DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>{editing ? 'Edit Draft' : 'New Content Draft'}</DialogTitle><DialogDescription>Write content for the platform.</DialogDescription></DialogHeader><div className="space-y-4 mt-4">
        <div className="space-y-2"><Label>Title *</Label><Input value={formData.title} onChange={e => setFormData({ ...formData, title: e.target.value })} /></div>
        <div className="space-y-2"><Label>Summary</Label><Textarea value={formData.summary} onChange={e => setFormData({ ...formData, summary: e.target.value })} rows={2} /></div>
        <div className="space-y-2"><Label>Body (Markdown) *</Label><Textarea value={formData.body_markdown} onChange={e => setFormData({ ...formData, body_markdown: e.target.value })} rows={10} className="font-mono text-sm" /></div>
        <div className="space-y-2"><Label>Tags (comma-separated)</Label><Input value={formData.tags} onChange={e => setFormData({ ...formData, tags: e.target.value })} placeholder="sustainability, technology, marina" /></div>
        <div className="flex justify-end gap-2 pt-4"><Button variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button><Button onClick={handleSave}>{editing ? 'Update' : 'Create'}</Button></div>
      </div></DialogContent></Dialog>
    </div>
  );
}

/* ─── Resource Drafts Admin ─── */
function ResourceDraftsAdmin() {
  const { user } = useAuth();
  const [drafts, setDrafts] = useState<ResourceDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ResourceDraft | null>(null);
  const [formData, setFormData] = useState({ title: '', summary: '', content: '', type: 'article', topic: 'Sustainability', language: 'EN', access_level: 'public' });

  const types = ['article', 'whitepaper', 'guide', 'replay', 'case_study'];
  const topics = ['Sustainability', 'Technology', 'Energy', 'Management', 'Events', 'Infrastructure'];

  useEffect(() => { load(); }, []);
  const load = async () => { setLoading(true); const { data } = await supabase.from('resource_drafts').select('*').order('created_at', { ascending: false }); setDrafts(data || []); setLoading(false); };

  const openCreate = () => { setEditing(null); setFormData({ title: '', summary: '', content: '', type: 'article', topic: 'Sustainability', language: 'EN', access_level: 'public' }); setIsDialogOpen(true); };
  const openEdit = (d: ResourceDraft) => { setEditing(d); setFormData({ title: d.title, summary: d.summary || '', content: d.content, type: d.type || 'article', topic: d.topic || 'Sustainability', language: d.language || 'EN', access_level: d.access_level || 'public' }); setIsDialogOpen(true); };

  const handleSave = async () => {
    const payload = { title: formData.title, summary: formData.summary || null, content: formData.content, type: formData.type, topic: formData.topic, language: formData.language, access_level: formData.access_level, created_by: user!.id };
    if (editing) { await supabase.from('resource_drafts').update(payload).eq('id', editing.id); toast({ title: 'Draft updated' }); }
    else { await supabase.from('resource_drafts').insert({ ...payload, status: 'draft' }); toast({ title: 'Draft created' }); }
    setIsDialogOpen(false); load();
  };

  const updateStatus = async (id: string, status: string) => {
    if (status === 'published') {
      const draft = drafts.find(d => d.id === id);
      if (!draft) return;
      const { error: pubError } = await supabase.from('resources').insert({
        title: draft.title, summary: draft.summary, content: draft.content, type: draft.type, topic: draft.topic,
        language: draft.language, access_level: draft.access_level, published: true,
      });
      if (pubError) { toast({ title: 'Publish failed', description: pubError.message, variant: 'destructive' }); return; }
      await supabase.from('resource_drafts').update({ status: 'published' }).eq('id', id);
      toast({ title: 'Resource published!' }); load(); return;
    }
    await supabase.from('resource_drafts').update({ status }).eq('id', id);
    toast({ title: `Status: ${status}` }); load();
  };

  if (loading) return <div className="flex items-center justify-center h-64"><RefreshCw className="h-8 w-8 animate-spin text-gray-400" /></div>;

  return (
    <div>
      <div className="flex justify-between items-center mb-6"><h1 className="text-2xl font-bold">Resource Drafts ({drafts.length})</h1><Button onClick={openCreate}><Plus className="h-4 w-4 mr-2" />New Draft</Button></div>
      <Card><CardContent className="p-0"><div className="overflow-x-auto"><table className="w-full"><thead className="bg-gray-50 border-b"><tr>
        <th className="text-left p-4 font-medium">Title</th><th className="text-left p-4 font-medium">Type</th><th className="text-left p-4 font-medium">Status</th><th className="text-left p-4 font-medium">Date</th><th className="text-left p-4 font-medium">Actions</th>
      </tr></thead><tbody>
        {drafts.map(d => (<tr key={d.id} className="border-b hover:bg-gray-50">
          <td className="p-4"><div className="font-medium">{d.title}</div></td>
          <td className="p-4"><Badge variant="outline">{d.type || '—'}</Badge></td>
          <td className="p-4">
            <Select value={d.status} onValueChange={v => updateStatus(d.id, v)}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Draft</SelectItem><SelectItem value="submitted">Submitted</SelectItem>
                <SelectItem value="review_1">Review 1</SelectItem><SelectItem value="review_2">Review 2</SelectItem>
                <SelectItem value="approved">Approved</SelectItem><SelectItem value="published">Publish</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>
          </td>
          <td className="p-4 text-sm text-gray-500">{new Date(d.created_at).toLocaleDateString()}</td>
          <td className="p-4"><Button size="sm" variant="ghost" onClick={() => openEdit(d)}><Pencil className="h-4 w-4" /></Button></td>
        </tr>))}
        {drafts.length === 0 && <tr><td colSpan={5} className="p-8 text-center text-gray-400">No resource drafts</td></tr>}
      </tbody></table></div></CardContent></Card>
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}><DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>{editing ? 'Edit Resource Draft' : 'New Resource Draft'}</DialogTitle><DialogDescription>Create or edit a resource draft for review.</DialogDescription></DialogHeader><div className="space-y-4 mt-4">
        <div className="space-y-2"><Label>Title *</Label><Input value={formData.title} onChange={e => setFormData({ ...formData, title: e.target.value })} /></div>
        <div className="space-y-2"><Label>Summary</Label><Textarea value={formData.summary} onChange={e => setFormData({ ...formData, summary: e.target.value })} rows={2} /></div>
        <div className="space-y-2"><Label>Content *</Label><RichTextEditor content={formData.content} onChange={(html) => setFormData({ ...formData, content: html })} placeholder="Write the resource content..." /></div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2"><Label>Type</Label><Select value={formData.type} onValueChange={v => setFormData({ ...formData, type: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{types.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-2"><Label>Topic</Label><Select value={formData.topic} onValueChange={v => setFormData({ ...formData, topic: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{topics.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select></div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2"><Label>Language</Label><Select value={formData.language} onValueChange={v => setFormData({ ...formData, language: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="EN">English</SelectItem><SelectItem value="FR">Français</SelectItem></SelectContent></Select></div>
          <div className="space-y-2"><Label>Access</Label><Select value={formData.access_level} onValueChange={v => setFormData({ ...formData, access_level: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="public">Public</SelectItem><SelectItem value="members">Members</SelectItem><SelectItem value="marina">Marina</SelectItem></SelectContent></Select></div>
        </div>
        <div className="flex justify-end gap-2 pt-4"><Button variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button><Button onClick={handleSave}>{editing ? 'Update' : 'Create'}</Button></div>
      </div></DialogContent></Dialog>
    </div>
  );
}

/* ─── Admin Page (root) ─── */
export function AdminPage() {
  const { user, loading, isModerator } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && (!user || !isModerator)) {
      navigate('/');
      toast({ title: 'Access denied. Admin only.', variant: 'destructive' });
    }
  }, [user, isModerator, loading, navigate]);

  if (loading) return <div className="flex items-center justify-center h-screen"><RefreshCw className="h-8 w-8 animate-spin text-primary" /></div>;
  if (!user || !isModerator) return null;

  return (
    <div className="flex">
      <AdminSidebar />
      <div className="flex-1 p-8 bg-gray-50 min-h-[calc(100vh-64px)] overflow-auto">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/users" element={<UsersAdmin />} />
          <Route path="/resources" element={<ResourcesAdmin />} />
          <Route path="/events" element={<EventsAdmin />} />
          <Route path="/partners" element={<PartnersAdmin />} />
          <Route path="/projects" element={<ProjectsAdmin />} />
          <Route path="/leads" element={<LeadsAdmin />} />
          <Route path="/webinars" element={<WebinarRequestsAdmin />} />
          <Route path="/partner-requests" element={<PartnerRequestsAdmin />} />
          <Route path="/rfps" element={<RFPsAdmin />} />
          <Route path="/consultations" element={<ConsultationsAdmin />} />
          <Route path="/content" element={<ContentDraftsAdmin />} />
          <Route path="/resource-drafts" element={<ResourceDraftsAdmin />} />
        </Routes>
      </div>
    </div>
  );
}
