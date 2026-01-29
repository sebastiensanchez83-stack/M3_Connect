import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, Routes, Route, Link, useLocation } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { LayoutDashboard, Users, FileText, Calendar, Anchor, Building, Download, ChevronRight, UserCheck, Plus, Pencil, Trash2, Eye, RefreshCw, Search } from 'lucide-react';

// Types
interface Profile { id: string; user_id: string; first_name: string; last_name: string; email: string; organization_name: string; organization_type: string; country: string; role: string; created_at: string; }
interface Resource { id: string; title: string; summary: string; content: string | null; type: string; topic: string; language: string; access_level: string; thumbnail_url: string | null; file_url: string | null; published: boolean; created_at: string; }
interface Event { id: string; title: string; description: string; date_time: string; location: string | null; language: string; access_level: string; speakers: any[]; replay_url: string | null; created_at: string; }
interface Partner { id: string; name: string; description: string; logo_url: string | null; website: string | null; sector: string; country: string; is_featured: boolean; created_at: string; }
interface MarinaProject { id: string; user_id: string; project_type: string; budget_range: string; timeline: string; description: string; status: string; admin_notes: string | null; created_at: string; profiles?: any; }
interface PartnerLead { id: string; first_name: string; last_name: string; email: string; phone: string | null; company: string; website: string | null; country: string; actor_type: string; solutions: string | null; goals: string | null; engagement_level: string; status: string; admin_notes: string | null; created_at: string; }

function AdminSidebar() {
  const { t } = useTranslation();
  const location = useLocation();
  const links = [
    { to: '/admin', icon: LayoutDashboard, label: t('admin.dashboard'), exact: true },
    { to: '/admin/users', icon: Users, label: t('admin.users') },
    { to: '/admin/resources', icon: FileText, label: t('admin.resources') },
    { to: '/admin/events', icon: Calendar, label: t('admin.events') },
    { to: '/admin/partners', icon: Building, label: t('admin.partners') },
    { to: '/admin/projects', icon: Anchor, label: t('admin.marinaProjects') },
    { to: '/admin/leads', icon: Users, label: t('admin.partnerLeads') },
  ];
  return (
    <div className="w-64 bg-primary text-white min-h-[calc(100vh-64px)] p-4">
      <div className="mb-6"><h2 className="text-lg font-bold">Admin Panel</h2><p className="text-sm text-gray-300">M3 Connect</p></div>
      <nav className="space-y-2">
        {links.map(link => {
          const isActive = link.exact ? location.pathname === link.to : location.pathname.startsWith(link.to) && link.to !== '/admin';
          return (<Link key={link.to} to={link.to} className={`flex items-center gap-3 px-4 py-2 rounded-lg transition-colors ${isActive ? 'bg-white/20' : 'hover:bg-white/10'}`}><link.icon className="h-5 w-5" />{link.label}</Link>);
        })}
      </nav>
    </div>
  );
}

function Dashboard() {
  const { t } = useTranslation();
  const [stats, setStats] = useState({ totalUsers: 0, pendingMarinas: 0, verifiedMarinas: 0, totalResources: 0, totalEvents: 0, newProjects: 0, newLeads: 0 });
  const [recentProjects, setRecentProjects] = useState<MarinaProject[]>([]);
  const [recentLeads, setRecentLeads] = useState<PartnerLead[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadDashboard(); }, []);

  const loadDashboard = async () => {
    setLoading(true);
    try {
      const [{ count: totalUsers }, { count: pendingMarinas }, { count: verifiedMarinas }, { count: totalResources }, { count: totalEvents }, { count: newProjects }, { count: newLeads }, { data: projects }, { data: leads }] = await Promise.all([
        supabase.from('profiles').select('*', { count: 'exact', head: true }),
        supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'marina_pending'),
        supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'marina_verified'),
        supabase.from('resources').select('*', { count: 'exact', head: true }),
        supabase.from('events').select('*', { count: 'exact', head: true }),
        supabase.from('marina_projects').select('*', { count: 'exact', head: true }).eq('status', 'new'),
        supabase.from('partner_leads').select('*', { count: 'exact', head: true }).eq('status', 'new'),
        supabase.from('marina_projects').select('*, profiles(first_name, last_name, organization_name)').order('created_at', { ascending: false }).limit(5),
        supabase.from('partner_leads').select('*').order('created_at', { ascending: false }).limit(5),
      ]);
      setStats({ totalUsers: totalUsers || 0, pendingMarinas: pendingMarinas || 0, verifiedMarinas: verifiedMarinas || 0, totalResources: totalResources || 0, totalEvents: totalEvents || 0, newProjects: newProjects || 0, newLeads: newLeads || 0 });
      setRecentProjects(projects || []);
      setRecentLeads(leads || []);
    } catch (error) { console.error('Error loading dashboard:', error); }
    setLoading(false);
  };

  const statCards = [
    { label: 'Total Users', value: stats.totalUsers, icon: Users, color: 'text-blue-600' },
    { label: 'Pending Marinas', value: stats.pendingMarinas, icon: Anchor, color: 'text-yellow-600' },
    { label: 'Verified Marinas', value: stats.verifiedMarinas, icon: UserCheck, color: 'text-green-600' },
    { label: 'Resources', value: stats.totalResources, icon: FileText, color: 'text-purple-600' },
    { label: 'Events', value: stats.totalEvents, icon: Calendar, color: 'text-pink-600' },
    { label: 'New Projects', value: stats.newProjects, icon: Anchor, color: 'text-orange-600' },
    { label: 'New Leads', value: stats.newLeads, icon: Users, color: 'text-teal-600' },
  ];

  if (loading) return <div className="flex items-center justify-center h-64"><RefreshCw className="h-8 w-8 animate-spin text-gray-400" /></div>;

  return (
    <div>
      <div className="flex justify-between items-center mb-6"><h1 className="text-2xl font-bold">{t('admin.dashboard')}</h1><Button variant="outline" size="sm" onClick={loadDashboard}><RefreshCw className="h-4 w-4 mr-2" />Refresh</Button></div>
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4 mb-8">
        {statCards.map((stat, i) => (<Card key={i}><CardContent className="pt-4 pb-4"><div className="flex flex-col items-center text-center"><stat.icon className={`h-6 w-6 mb-2 ${stat.color}`} /><div className="text-2xl font-bold">{stat.value}</div><div className="text-xs text-gray-500">{stat.label}</div></div></CardContent></Card>))}
      </div>
      <div className="grid md:grid-cols-2 gap-6">
        <Card><CardHeader className="flex flex-row items-center justify-between pb-2"><CardTitle className="text-lg">Recent Marina Projects</CardTitle><Link to="/admin/projects" className="text-sm text-secondary flex items-center">View all <ChevronRight className="h-4 w-4" /></Link></CardHeader><CardContent>{recentProjects.length === 0 ? <p className="text-gray-500 text-center py-4">No projects yet</p> : <div className="space-y-3">{recentProjects.map(project => (<div key={project.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"><div><div className="font-medium">{project.profiles?.organization_name || 'Unknown'}</div><div className="text-sm text-gray-500">{project.project_type} • {project.budget_range}</div></div><Badge variant={project.status === 'new' ? 'warning' : project.status === 'in_progress' ? 'info' : 'success'}>{project.status}</Badge></div>))}</div>}</CardContent></Card>
        <Card><CardHeader className="flex flex-row items-center justify-between pb-2"><CardTitle className="text-lg">Recent Partner Leads</CardTitle><Link to="/admin/leads" className="text-sm text-secondary flex items-center">View all <ChevronRight className="h-4 w-4" /></Link></CardHeader><CardContent>{recentLeads.length === 0 ? <p className="text-gray-500 text-center py-4">No leads yet</p> : <div className="space-y-3">{recentLeads.map(lead => (<div key={lead.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"><div><div className="font-medium">{lead.company}</div><div className="text-sm text-gray-500">{lead.first_name} {lead.last_name} • {lead.actor_type}</div></div><Badge variant={lead.status === 'new' ? 'warning' : lead.status === 'qualified' ? 'success' : 'info'}>{lead.status}</Badge></div>))}</div>}</CardContent></Card>
      </div>
    </div>
  );
}

function UsersAdmin() {
  const { t } = useTranslation();
  const [users, setUsers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');

  useEffect(() => { loadUsers(); }, []);

  const loadUsers = async () => {
    setLoading(true);
    const { data } = await supabase.from('profiles').select('*').order('created_at', { ascending: false });
    setUsers(data || []);
    setLoading(false);
  };

  const updateUserRole = async (userId: string, newRole: string) => {
    await supabase.from('profiles').update({ role: newRole } as any).eq('user_id', userId);
    toast({ title: `User role updated to ${newRole}` });
    loadUsers();
  };

  const filteredUsers = users.filter(user => {
    const matchesSearch = user.first_name?.toLowerCase().includes(search.toLowerCase()) || user.last_name?.toLowerCase().includes(search.toLowerCase()) || user.email?.toLowerCase().includes(search.toLowerCase()) || user.organization_name?.toLowerCase().includes(search.toLowerCase());
    const matchesRole = roleFilter === 'all' || user.role === roleFilter;
    return matchesSearch && matchesRole;
  });

  const exportCSV = () => {
    const csv = [['Name', 'Email', 'Organization', 'Type', 'Country', 'Role', 'Created'].join(','), ...filteredUsers.map(u => [`${u.first_name} ${u.last_name}`, u.email, u.organization_name, u.organization_type, u.country, u.role, new Date(u.created_at).toLocaleDateString()].join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'users.csv'; a.click();
  };

  const getRoleBadge = (role: string) => {
    switch (role) { case 'admin': return <Badge variant="destructive">Admin</Badge>; case 'marina_verified': return <Badge variant="success">Marina ✓</Badge>; case 'marina_pending': return <Badge variant="warning">Marina Pending</Badge>; default: return <Badge variant="secondary">User</Badge>; }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><RefreshCw className="h-8 w-8 animate-spin text-gray-400" /></div>;

  return (
    <div>
      <div className="flex justify-between items-center mb-6"><h1 className="text-2xl font-bold">{t('admin.users')} ({users.length})</h1><Button variant="outline" size="sm" onClick={exportCSV}><Download className="h-4 w-4 mr-2" />Export CSV</Button></div>
      <div className="flex gap-4 mb-4">
        <div className="relative flex-1"><Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" /><Input placeholder="Search by name, email, organization..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" /></div>
        <Select value={roleFilter} onValueChange={setRoleFilter}><SelectTrigger className="w-48"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All Roles</SelectItem><SelectItem value="user">Users</SelectItem><SelectItem value="marina_pending">Marina Pending</SelectItem><SelectItem value="marina_verified">Marina Verified</SelectItem><SelectItem value="admin">Admins</SelectItem></SelectContent></Select>
      </div>
      <Card><CardContent className="p-0"><div className="overflow-x-auto"><table className="w-full"><thead className="bg-gray-50 border-b"><tr><th className="text-left p-4 font-medium">Name</th><th className="text-left p-4 font-medium">Email</th><th className="text-left p-4 font-medium">Organization</th><th className="text-left p-4 font-medium">Role</th><th className="text-left p-4 font-medium">Actions</th></tr></thead><tbody>
        {filteredUsers.map(user => (<tr key={user.id} className="border-b hover:bg-gray-50"><td className="p-4">{user.first_name} {user.last_name}</td><td className="p-4 text-gray-600">{user.email}</td><td className="p-4"><div>{user.organization_name}</div><div className="text-xs text-gray-500">{user.organization_type}</div></td><td className="p-4">{getRoleBadge(user.role)}</td><td className="p-4"><Select value={user.role} onValueChange={(value) => updateUserRole(user.user_id, value)}><SelectTrigger className="w-40"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="user">User</SelectItem><SelectItem value="marina_pending">Marina Pending</SelectItem><SelectItem value="marina_verified">Marina Verified</SelectItem><SelectItem value="admin">Admin</SelectItem></SelectContent></Select></td></tr>))}
      </tbody></table></div></CardContent></Card>
    </div>
  );
}
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
    if (editingResource) { await supabase.from('resources').update(payload as any).eq('id', editingResource.id); toast({ title: 'Resource updated!' }); }
    else { await supabase.from('resources').insert(payload as any); toast({ title: 'Resource created!' }); }
    setIsDialogOpen(false); loadResources();
  };

  const handleDelete = async (id: string) => { if (!confirm('Delete this resource?')) return; await supabase.from('resources').delete().eq('id', id); toast({ title: 'Resource deleted' }); loadResources(); };

  const types = ['article', 'whitepaper', 'guide', 'replay', 'case_study'];
  const topics = ['Sustainability', 'Technology', 'Energy', 'Management', 'Events', 'Infrastructure'];

  if (loading) return <div className="flex items-center justify-center h-64"><RefreshCw className="h-8 w-8 animate-spin text-gray-400" /></div>;

  return (
    <div>
      <div className="flex justify-between items-center mb-6"><h1 className="text-2xl font-bold">{t('admin.resources')} ({resources.length})</h1><Button onClick={openCreate}><Plus className="h-4 w-4 mr-2" />Add Resource</Button></div>
      <Card><CardContent className="p-0"><div className="overflow-x-auto"><table className="w-full"><thead className="bg-gray-50 border-b"><tr><th className="text-left p-4 font-medium">Title</th><th className="text-left p-4 font-medium">Type</th><th className="text-left p-4 font-medium">Access</th><th className="text-left p-4 font-medium">Lang</th><th className="text-left p-4 font-medium">Status</th><th className="text-left p-4 font-medium">Actions</th></tr></thead><tbody>
        {resources.map(resource => (<tr key={resource.id} className="border-b hover:bg-gray-50"><td className="p-4"><div className="font-medium">{resource.title}</div><div className="text-sm text-gray-500 truncate max-w-xs">{resource.summary}</div></td><td className="p-4"><Badge variant="outline">{resource.type}</Badge></td><td className="p-4"><Badge variant={resource.access_level === 'public' ? 'success' : resource.access_level === 'members' ? 'info' : 'purple'}>{resource.access_level}</Badge></td><td className="p-4">{resource.language}</td><td className="p-4"><Badge variant={resource.published ? 'success' : 'secondary'}>{resource.published ? 'Published' : 'Draft'}</Badge></td><td className="p-4"><div className="flex gap-2"><Button size="sm" variant="ghost" onClick={() => openEdit(resource)}><Pencil className="h-4 w-4" /></Button><Button size="sm" variant="ghost" onClick={() => handleDelete(resource.id)}><Trash2 className="h-4 w-4 text-red-500" /></Button></div></td></tr>))}
      </tbody></table></div></CardContent></Card>
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}><DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>{editingResource ? 'Edit Resource' : 'Add Resource'}</DialogTitle></DialogHeader><div className="space-y-4 mt-4">
        <div className="space-y-2"><Label>Title *</Label><Input value={formData.title} onChange={e => setFormData({ ...formData, title: e.target.value })} /></div>
        <div className="space-y-2"><Label>Summary *</Label><Textarea value={formData.summary} onChange={e => setFormData({ ...formData, summary: e.target.value })} rows={2} /></div>
        <div className="space-y-2"><Label>Content (optional)</Label><Textarea value={formData.content} onChange={e => setFormData({ ...formData, content: e.target.value })} rows={4} /></div>
        <div className="grid grid-cols-2 gap-4"><div className="space-y-2"><Label>Type *</Label><Select value={formData.type} onValueChange={v => setFormData({ ...formData, type: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{types.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label>Topic *</Label><Select value={formData.topic} onValueChange={v => setFormData({ ...formData, topic: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{topics.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select></div></div>
        <div className="grid grid-cols-2 gap-4"><div className="space-y-2"><Label>Language *</Label><Select value={formData.language} onValueChange={v => setFormData({ ...formData, language: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="EN">English</SelectItem><SelectItem value="FR">Français</SelectItem></SelectContent></Select></div><div className="space-y-2"><Label>Access Level *</Label><Select value={formData.access_level} onValueChange={v => setFormData({ ...formData, access_level: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="public">Public</SelectItem><SelectItem value="members">Members</SelectItem><SelectItem value="marina">Marina</SelectItem></SelectContent></Select></div></div>
        <div className="space-y-2"><Label>Thumbnail URL</Label><Input value={formData.thumbnail_url} onChange={e => setFormData({ ...formData, thumbnail_url: e.target.value })} placeholder="https://..." /></div>
        <div className="space-y-2"><Label>File URL (PDF, etc.)</Label><Input value={formData.file_url} onChange={e => setFormData({ ...formData, file_url: e.target.value })} placeholder="https://..." /></div>
        <div className="flex items-center space-x-2"><Checkbox id="published" checked={formData.published} onCheckedChange={(c) => setFormData({ ...formData, published: c as boolean })} /><Label htmlFor="published">Published</Label></div>
        <div className="flex justify-end gap-2 pt-4"><Button variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button><Button onClick={handleSave}>{editingResource ? 'Update' : 'Create'}</Button></div>
      </div></DialogContent></Dialog>
    </div>
  );
}

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
    let speakers = []; try { if (formData.speakers) speakers = JSON.parse(formData.speakers); } catch { toast({ title: 'Invalid speakers JSON', variant: 'destructive' }); return; }
    const payload = { title: formData.title, description: formData.description, date_time: formData.date_time, location: formData.location || null, language: formData.language, access_level: formData.access_level, speakers, replay_url: formData.replay_url || null };
    if (editingEvent) { await supabase.from('events').update(payload as any).eq('id', editingEvent.id); toast({ title: 'Event updated!' }); }
    else { await supabase.from('events').insert(payload as any); toast({ title: 'Event created!' }); }
    setIsDialogOpen(false); loadEvents();
  };

  const handleDelete = async (id: string) => { if (!confirm('Delete this event?')) return; await supabase.from('events').delete().eq('id', id); toast({ title: 'Event deleted' }); loadEvents(); };

  if (loading) return <div className="flex items-center justify-center h-64"><RefreshCw className="h-8 w-8 animate-spin text-gray-400" /></div>;

  return (
    <div>
      <div className="flex justify-between items-center mb-6"><h1 className="text-2xl font-bold">{t('admin.events')} ({events.length})</h1><Button onClick={openCreate}><Plus className="h-4 w-4 mr-2" />Add Event</Button></div>
      <Card><CardContent className="p-0"><div className="overflow-x-auto"><table className="w-full"><thead className="bg-gray-50 border-b"><tr><th className="text-left p-4 font-medium">Title</th><th className="text-left p-4 font-medium">Date</th><th className="text-left p-4 font-medium">Location</th><th className="text-left p-4 font-medium">Access</th><th className="text-left p-4 font-medium">Replay</th><th className="text-left p-4 font-medium">Actions</th></tr></thead><tbody>
        {events.map(event => (<tr key={event.id} className="border-b hover:bg-gray-50"><td className="p-4 font-medium">{event.title}</td><td className="p-4">{new Date(event.date_time).toLocaleDateString()}</td><td className="p-4">{event.location || 'Online'}</td><td className="p-4"><Badge variant={event.access_level === 'public' ? 'success' : event.access_level === 'members' ? 'info' : 'purple'}>{event.access_level}</Badge></td><td className="p-4">{event.replay_url ? <Badge variant="success">Yes</Badge> : <Badge variant="secondary">No</Badge>}</td><td className="p-4"><div className="flex gap-2"><Button size="sm" variant="ghost" onClick={() => openEdit(event)}><Pencil className="h-4 w-4" /></Button><Button size="sm" variant="ghost" onClick={() => handleDelete(event.id)}><Trash2 className="h-4 w-4 text-red-500" /></Button></div></td></tr>))}
      </tbody></table></div></CardContent></Card>
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}><DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>{editingEvent ? 'Edit Event' : 'Add Event'}</DialogTitle></DialogHeader><div className="space-y-4 mt-4">
        <div className="space-y-2"><Label>Title *</Label><Input value={formData.title} onChange={e => setFormData({ ...formData, title: e.target.value })} /></div>
        <div className="space-y-2"><Label>Description *</Label><Textarea value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })} rows={3} /></div>
        <div className="grid grid-cols-2 gap-4"><div className="space-y-2"><Label>Date & Time *</Label><Input type="datetime-local" value={formData.date_time} onChange={e => setFormData({ ...formData, date_time: e.target.value })} /></div><div className="space-y-2"><Label>Location (empty = online)</Label><Input value={formData.location} onChange={e => setFormData({ ...formData, location: e.target.value })} placeholder="Monaco Yacht Club" /></div></div>
        <div className="grid grid-cols-2 gap-4"><div className="space-y-2"><Label>Language *</Label><Select value={formData.language} onValueChange={v => setFormData({ ...formData, language: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="EN">English</SelectItem><SelectItem value="FR">Français</SelectItem></SelectContent></Select></div><div className="space-y-2"><Label>Access Level *</Label><Select value={formData.access_level} onValueChange={v => setFormData({ ...formData, access_level: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="public">Public</SelectItem><SelectItem value="members">Members</SelectItem><SelectItem value="marina">Marina Only</SelectItem></SelectContent></Select></div></div>
        <div className="space-y-2"><Label>Speakers (JSON)</Label><Textarea value={formData.speakers} onChange={e => setFormData({ ...formData, speakers: e.target.value })} placeholder='[{"name": "John Doe", "title": "CEO"}]' rows={2} /></div>
        <div className="space-y-2"><Label>Replay URL</Label><Input value={formData.replay_url} onChange={e => setFormData({ ...formData, replay_url: e.target.value })} placeholder="https://..." /></div>
        <div className="flex justify-end gap-2 pt-4"><Button variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button><Button onClick={handleSave}>{editingEvent ? 'Update' : 'Create'}</Button></div>
      </div></DialogContent></Dialog>
    </div>
  );
}

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
  const openEdit = (partner: Partner) => { setEditingPartner(partner); setFormData({ name: partner.name, description: partner.description, logo_url: partner.logo_url || '', website: partner.website || '', sector: partner.sector, country: partner.country, is_featured: partner.is_featured }); setIsDialogOpen(true); };

  const handleSave = async () => {
    const payload = { ...formData, logo_url: formData.logo_url || null, website: formData.website || null };
    if (editingPartner) { await supabase.from('partners').update(payload as any).eq('id', editingPartner.id); toast({ title: 'Partner updated!' }); }
    else { await supabase.from('partners').insert(payload as any); toast({ title: 'Partner created!' }); }
    setIsDialogOpen(false); loadPartners();
  };

  const handleDelete = async (id: string) => { if (!confirm('Delete this partner?')) return; await supabase.from('partners').delete().eq('id', id); toast({ title: 'Partner deleted' }); loadPartners(); };

  if (loading) return <div className="flex items-center justify-center h-64"><RefreshCw className="h-8 w-8 animate-spin text-gray-400" /></div>;

  return (
    <div>
      <div className="flex justify-between items-center mb-6"><h1 className="text-2xl font-bold">{t('admin.partners')} ({partners.length})</h1><Button onClick={openCreate}><Plus className="h-4 w-4 mr-2" />Add Partner</Button></div>
      <Card><CardContent className="p-0"><table className="w-full"><thead className="bg-gray-50 border-b"><tr><th className="text-left p-4 font-medium">Name</th><th className="text-left p-4 font-medium">Sector</th><th className="text-left p-4 font-medium">Country</th><th className="text-left p-4 font-medium">Featured</th><th className="text-left p-4 font-medium">Actions</th></tr></thead><tbody>
        {partners.map(partner => (<tr key={partner.id} className="border-b hover:bg-gray-50"><td className="p-4 font-medium">{partner.name}</td><td className="p-4"><Badge variant="outline">{partner.sector}</Badge></td><td className="p-4">{partner.country}</td><td className="p-4">{partner.is_featured ? '⭐' : '-'}</td><td className="p-4"><div className="flex gap-2"><Button size="sm" variant="ghost" onClick={() => openEdit(partner)}><Pencil className="h-4 w-4" /></Button><Button size="sm" variant="ghost" onClick={() => handleDelete(partner.id)}><Trash2 className="h-4 w-4 text-red-500" /></Button></div></td></tr>))}
      </tbody></table></CardContent></Card>
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>{editingPartner ? 'Edit Partner' : 'Add Partner'}</DialogTitle></DialogHeader><div className="space-y-4 mt-4">
        <div className="space-y-2"><Label>Name *</Label><Input value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} /></div>
        <div className="space-y-2"><Label>Description *</Label><Textarea value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })} /></div>
        <div className="grid grid-cols-2 gap-4"><div className="space-y-2"><Label>Sector *</Label><Select value={formData.sector} onValueChange={v => setFormData({ ...formData, sector: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{sectors.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label>Country *</Label><Input value={formData.country} onChange={e => setFormData({ ...formData, country: e.target.value })} /></div></div>
        <div className="space-y-2"><Label>Logo URL</Label><Input value={formData.logo_url} onChange={e => setFormData({ ...formData, logo_url: e.target.value })} placeholder="https://..." /></div>
        <div className="space-y-2"><Label>Website</Label><Input value={formData.website} onChange={e => setFormData({ ...formData, website: e.target.value })} placeholder="https://..." /></div>
        <div className="flex items-center space-x-2"><Checkbox id="featured" checked={formData.is_featured} onCheckedChange={(c) => setFormData({ ...formData, is_featured: c as boolean })} /><Label htmlFor="featured">Featured on homepage</Label></div>
        <div className="flex justify-end gap-2 pt-4"><Button variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button><Button onClick={handleSave}>{editingPartner ? 'Update' : 'Create'}</Button></div>
      </div></DialogContent></Dialog>
    </div>
  );
}

function ProjectsAdmin() {
  const { t } = useTranslation();
  const [projects, setProjects] = useState<MarinaProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedProject, setSelectedProject] = useState<MarinaProject | null>(null);
  const [adminNotes, setAdminNotes] = useState('');

  useEffect(() => { loadProjects(); }, []);
  const loadProjects = async () => { setLoading(true); const { data } = await supabase.from('marina_projects').select('*, profiles(first_name, last_name, email, organization_name)').order('created_at', { ascending: false }); setProjects(data || []); setLoading(false); };

  const updateStatus = async (id: string, status: string) => { await supabase.from('marina_projects').update({ status } as any).eq('id', id); toast({ title: `Status updated to ${status}` }); loadProjects(); };
  const saveNotes = async () => { if (!selectedProject) return; await supabase.from('marina_projects').update({ admin_notes: adminNotes } as any).eq('id', selectedProject.id); toast({ title: 'Notes saved' }); setSelectedProject(null); loadProjects(); };

  const exportCSV = () => { const csv = [['Marina', 'Email', 'Type', 'Budget', 'Timeline', 'Status', 'Date'].join(','), ...projects.map(p => [p.profiles?.organization_name || '', p.profiles?.email || '', p.project_type, p.budget_range, p.timeline, p.status, new Date(p.created_at).toLocaleDateString()].join(','))].join('\n'); const blob = new Blob([csv], { type: 'text/csv' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'marina-projects.csv'; a.click(); };

  if (loading) return <div className="flex items-center justify-center h-64"><RefreshCw className="h-8 w-8 animate-spin text-gray-400" /></div>;

  return (
    <div>
      <div className="flex justify-between items-center mb-6"><h1 className="text-2xl font-bold">{t('admin.marinaProjects')} ({projects.length})</h1><Button variant="outline" size="sm" onClick={exportCSV}><Download className="h-4 w-4 mr-2" />Export CSV</Button></div>
      <Card><CardContent className="p-0"><table className="w-full"><thead className="bg-gray-50 border-b"><tr><th className="text-left p-4 font-medium">Marina</th><th className="text-left p-4 font-medium">Type</th><th className="text-left p-4 font-medium">Budget</th><th className="text-left p-4 font-medium">Timeline</th><th className="text-left p-4 font-medium">Status</th><th className="text-left p-4 font-medium">Date</th><th className="text-left p-4 font-medium">Actions</th></tr></thead><tbody>
        {projects.map(project => (<tr key={project.id} className="border-b hover:bg-gray-50"><td className="p-4"><div className="font-medium">{project.profiles?.organization_name}</div><div className="text-sm text-gray-500">{project.profiles?.email}</div></td><td className="p-4">{project.project_type}</td><td className="p-4">{project.budget_range}</td><td className="p-4">{project.timeline}</td><td className="p-4"><Select value={project.status} onValueChange={v => updateStatus(project.id, v)}><SelectTrigger className="w-32"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="new">New</SelectItem><SelectItem value="in_progress">In Progress</SelectItem><SelectItem value="completed">Completed</SelectItem></SelectContent></Select></td><td className="p-4 text-gray-500">{new Date(project.created_at).toLocaleDateString()}</td><td className="p-4"><Button size="sm" variant="ghost" onClick={() => { setSelectedProject(project); setAdminNotes(project.admin_notes || ''); }}><Eye className="h-4 w-4" /></Button></td></tr>))}
      </tbody></table></CardContent></Card>
      <Dialog open={!!selectedProject} onOpenChange={() => setSelectedProject(null)}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>Project Details</DialogTitle></DialogHeader>{selectedProject && (<div className="space-y-4 mt-4"><div><strong>Marina:</strong> {selectedProject.profiles?.organization_name}</div><div><strong>Contact:</strong> {selectedProject.profiles?.first_name} {selectedProject.profiles?.last_name}</div><div><strong>Email:</strong> {selectedProject.profiles?.email}</div><div><strong>Type:</strong> {selectedProject.project_type}</div><div><strong>Budget:</strong> {selectedProject.budget_range}</div><div><strong>Timeline:</strong> {selectedProject.timeline}</div><div><strong>Description:</strong><p className="mt-1 p-2 bg-gray-50 rounded text-sm">{selectedProject.description}</p></div><div className="space-y-2"><Label>Admin Notes</Label><Textarea value={adminNotes} onChange={e => setAdminNotes(e.target.value)} rows={3} /></div><Button onClick={saveNotes} className="w-full">Save Notes</Button></div>)}</DialogContent></Dialog>
    </div>
  );
}

function LeadsAdmin() {
  const { t } = useTranslation();
  const [leads, setLeads] = useState<PartnerLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLead, setSelectedLead] = useState<PartnerLead | null>(null);
  const [adminNotes, setAdminNotes] = useState('');

  useEffect(() => { loadLeads(); }, []);
  const loadLeads = async () => { setLoading(true); const { data } = await supabase.from('partner_leads').select('*').order('created_at', { ascending: false }); setLeads(data || []); setLoading(false); };

  const updateStatus = async (id: string, status: string) => { await supabase.from('partner_leads').update({ status } as any).eq('id', id); toast({ title: `Status updated to ${status}` }); loadLeads(); };
  const saveNotes = async () => { if (!selectedLead) return; await supabase.from('partner_leads').update({ admin_notes: adminNotes } as any).eq('id', selectedLead.id); toast({ title: 'Notes saved' }); setSelectedLead(null); loadLeads(); };

  const exportCSV = () => { const csv = [['Company', 'Contact', 'Email', 'Phone', 'Type', 'Engagement', 'Status', 'Date'].join(','), ...leads.map(l => [l.company, `${l.first_name} ${l.last_name}`, l.email, l.phone || '', l.actor_type, l.engagement_level, l.status, new Date(l.created_at).toLocaleDateString()].join(','))].join('\n'); const blob = new Blob([csv], { type: 'text/csv' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'partner-leads.csv'; a.click(); };

  if (loading) return <div className="flex items-center justify-center h-64"><RefreshCw className="h-8 w-8 animate-spin text-gray-400" /></div>;

  return (
    <div>
      <div className="flex justify-between items-center mb-6"><h1 className="text-2xl font-bold">{t('admin.partnerLeads')} ({leads.length})</h1><Button variant="outline" size="sm" onClick={exportCSV}><Download className="h-4 w-4 mr-2" />Export CSV</Button></div>
      <Card><CardContent className="p-0"><table className="w-full"><thead className="bg-gray-50 border-b"><tr><th className="text-left p-4 font-medium">Company</th><th className="text-left p-4 font-medium">Contact</th><th className="text-left p-4 font-medium">Type</th><th className="text-left p-4 font-medium">Engagement</th><th className="text-left p-4 font-medium">Status</th><th className="text-left p-4 font-medium">Date</th><th className="text-left p-4 font-medium">Actions</th></tr></thead><tbody>
        {leads.map(lead => (<tr key={lead.id} className="border-b hover:bg-gray-50"><td className="p-4"><div className="font-medium">{lead.company}</div><div className="text-sm text-gray-500">{lead.country}</div></td><td className="p-4"><div>{lead.first_name} {lead.last_name}</div><div className="text-sm text-gray-500">{lead.email}</div></td><td className="p-4"><Badge variant="outline">{lead.actor_type}</Badge></td><td className="p-4 capitalize">{lead.engagement_level}</td><td className="p-4"><Select value={lead.status} onValueChange={v => updateStatus(lead.id, v)}><SelectTrigger className="w-36"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="new">New</SelectItem><SelectItem value="qualified">Qualified</SelectItem><SelectItem value="in_discussion">In Discussion</SelectItem><SelectItem value="signed">Signed</SelectItem><SelectItem value="rejected">Rejected</SelectItem></SelectContent></Select></td><td className="p-4 text-gray-500">{new Date(lead.created_at).toLocaleDateString()}</td><td className="p-4"><Button size="sm" variant="ghost" onClick={() => { setSelectedLead(lead); setAdminNotes(lead.admin_notes || ''); }}><Eye className="h-4 w-4" /></Button></td></tr>))}
      </tbody></table></CardContent></Card>
      <Dialog open={!!selectedLead} onOpenChange={() => setSelectedLead(null)}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>Lead Details</DialogTitle></DialogHeader>{selectedLead && (<div className="space-y-4 mt-4"><div className="grid grid-cols-2 gap-4"><div><strong>Company:</strong> {selectedLead.company}</div><div><strong>Country:</strong> {selectedLead.country}</div><div><strong>Contact:</strong> {selectedLead.first_name} {selectedLead.last_name}</div><div><strong>Email:</strong> {selectedLead.email}</div><div><strong>Phone:</strong> {selectedLead.phone || '-'}</div><div><strong>Website:</strong> {selectedLead.website || '-'}</div><div><strong>Type:</strong> {selectedLead.actor_type}</div><div><strong>Engagement:</strong> {selectedLead.engagement_level}</div></div>{selectedLead.solutions && (<div><strong>Solutions:</strong><p className="mt-1 p-2 bg-gray-50 rounded text-sm">{selectedLead.solutions}</p></div>)}{selectedLead.goals && (<div><strong>Goals:</strong><p className="mt-1 p-2 bg-gray-50 rounded text-sm">{selectedLead.goals}</p></div>)}<div className="space-y-2"><Label>Admin Notes</Label><Textarea value={adminNotes} onChange={e => setAdminNotes(e.target.value)} rows={3} placeholder="Add your notes here..." /></div><Button onClick={saveNotes} className="w-full">Save Notes</Button></div>)}</DialogContent></Dialog>
    </div>
  );
}

export function AdminPage() {
  const { t } = useTranslation();
  const { user, profile, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => { if (!loading && (!user || profile?.role !== 'admin')) { navigate('/'); toast({ title: 'Access denied. Admin only.', variant: 'destructive' }); } }, [user, profile, loading, navigate]);

  if (loading) return <div className="flex items-center justify-center h-screen"><RefreshCw className="h-8 w-8 animate-spin text-primary" /></div>;
  if (!user || profile?.role !== 'admin') return null;

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
        </Routes>
      </div>
    </div>
  );
}
