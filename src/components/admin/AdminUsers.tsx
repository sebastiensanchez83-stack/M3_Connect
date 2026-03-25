import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Users, UserCheck, RefreshCw, Search, Download, Pencil,
  Eye, AlertTriangle, ExternalLink, UserPlus,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
import type { AdminProfile } from './types';

export function AdminUsers() {
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
  const [emailStatusMap, setEmailStatusMap] = useState<Record<string, boolean>>({});
  const [unconfirmedUsers, setUnconfirmedUsers] = useState<{ id: string; email: string; created_at: string; first_name: string | null; last_name: string | null; persona: string | null }[]>([]);
  const [showUnconfirmed, setShowUnconfirmed] = useState(false);
  const [createAdminOpen, setCreateAdminOpen] = useState(false);
  const [createAdminForm, setCreateAdminForm] = useState({ email: '', password: '', firstName: '', lastName: '' });
  const [creatingAdmin, setCreatingAdmin] = useState(false);
  const [changingPersona, setChangingPersona] = useState(false);

  useEffect(() => { loadUsers(); }, []);

  const loadUsers = async () => {
    setLoading(true);
    try {
      // Split into separate queries to avoid Supabase relationship join error
      const [{ data: profilesData, error }, { data: membershipsData }, { data: emailData }, { data: unconfData }] = await Promise.all([
        supabase
          .from('profiles')
          .select('user_id, first_name, last_name, email, persona, access_status, onboarding_status, rejection_reason, created_at')
          .order('created_at', { ascending: false }),
        supabase
          .from('organization_members')
          .select('user_id, organization_id, organizations(id, name)'),
        supabase.rpc('get_users_email_status'),
        supabase.rpc('get_unconfirmed_users'),
      ]);
      if (error) { console.error('Error loading users:', error); toast({ title: 'Error loading users', description: error.message, variant: 'destructive' }); }
      // Build a map from user_id → org info
      const orgMap = new Map<string, { org_id: string; org_name: string }>();
      (membershipsData || []).forEach((m: Record<string, unknown>) => {
        const org = m.organizations as Record<string, unknown> | null;
        if (org) {
          orgMap.set(m.user_id as string, { org_id: org.id as string, org_name: org.name as string });
        }
      });
      // Merge profiles with org info
      const merged = (profilesData || []).map((row: Record<string, unknown>) => {
        const orgInfo = orgMap.get(row.user_id as string);
        return {
          ...row,
          org_name: orgInfo?.org_name || null,
          org_id: orgInfo?.org_id || null,
        };
      });
      setUsers(merged as unknown as AdminProfile[]);
      // Build email confirmation status map
      const statusMap: Record<string, boolean> = {};
      (emailData || []).forEach((row: { user_id: string; email_confirmed: boolean }) => { statusMap[row.user_id] = row.email_confirmed; });
      setEmailStatusMap(statusMap);
      setUnconfirmedUsers((unconfData || []) as typeof unconfirmedUsers);
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
    return u.org_name || '';
  };

  const openUserDetail = async (u: AdminProfile) => {
    setSelectedUser(u);
    setDetailData(null);
    setDetailSectors([]);
    setDetailLoading(true);
    try {
      if (!u.org_id) {
        // No organization — nothing to load
        setDetailLoading(false);
        return;
      }
      // Load organization data
      const { data: org } = await supabase.from('organizations').select('*').eq('id', u.org_id).maybeSingle();
      // Determine sector table based on persona
      const sectorTable = u.persona === 'marina' || u.persona === 'media_partner'
        ? 'organization_interest_sectors'
        : 'organization_service_sectors';
      const { data: sectors } = await supabase
        .from(sectorTable)
        .select('sectors(label)')
        .eq('organization_id', u.org_id);
      // For marina, also load marina_details
      if (u.persona === 'marina') {
        const { data: marinaDetails } = await supabase
          .from('organization_marina_details')
          .select('*')
          .eq('organization_id', u.org_id)
          .maybeSingle();
        setDetailData({ ...org, marina_details: marinaDetails } as Record<string, unknown>);
      } else {
        setDetailData(org as Record<string, unknown> | null);
      }
      setDetailSectors((sectors || []).map((s: Record<string, unknown>) => ((s.sectors as Record<string, unknown> | null)?.label as string) || '').filter(Boolean));
    } catch (err) { console.error('Error loading user detail:', err); }
    setDetailLoading(false);
  };

  const approveUser = async (userId: string) => {
    const { error } = await supabase.from('profiles').update({ access_status: 'verified', onboarding_status: 'completed', rejection_reason: null }).eq('user_id', userId);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    // Also verify the user's organization
    const { data: membership } = await supabase.from('organization_members').select('organization_id').eq('user_id', userId).maybeSingle();
    if (membership?.organization_id) {
      await supabase.from('organizations').update({ access_status: 'verified', onboarding_status: 'completed' }).eq('id', membership.organization_id);
    }
    toast({ title: 'User approved' }); loadUsers();
  };
  const openReject = (userId: string) => { setRejectingUserId(userId); setRejectReason(''); };
  const confirmReject = async () => {
    if (!rejectingUserId || !rejectReason.trim()) { toast({ title: t('admin.userDetail.reasonRequired'), variant: 'destructive' }); return; }
    const { error } = await supabase.from('profiles').update({ access_status: 'rejected', onboarding_status: 'draft', rejection_reason: rejectReason.trim() }).eq('user_id', rejectingUserId);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    // Also reject the user's organization
    const { data: membership } = await supabase.from('organization_members').select('organization_id').eq('user_id', rejectingUserId).maybeSingle();
    if (membership?.organization_id) {
      await supabase.from('organizations').update({ access_status: 'rejected', rejection_reason: rejectReason.trim() }).eq('id', membership.organization_id);
    }
    toast({ title: 'User rejected' }); setRejectingUserId(null); loadUsers();
  };
  const updateUserStatus = async (userId: string, newStatus: string) => {
    if (newStatus === 'verified') { await approveUser(userId); return; }
    if (newStatus === 'rejected') { openReject(userId); return; }
    await supabase.from('profiles').update({ access_status: newStatus }).eq('user_id', userId);
    toast({ title: `Status: ${newStatus}` }); loadUsers();
  };

  const handleChangePersona = async (userId: string, newPersona: string) => {
    setChangingPersona(true);
    const { error } = await supabase.from('profiles').update({ persona: newPersona }).eq('user_id', userId);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: `Role updated to ${newPersona}` });
      if (selectedUser) setSelectedUser({ ...selectedUser, persona: newPersona });
      loadUsers();
    }
    setChangingPersona(false);
  };

  const handleCreateAdmin = async () => {
    const { email, password, firstName, lastName } = createAdminForm;
    if (!email || !password || !firstName || !lastName) {
      toast({ title: 'All fields are required', variant: 'destructive' });
      return;
    }
    if (password.length < 8) {
      toast({ title: 'Password must be at least 8 characters', variant: 'destructive' });
      return;
    }
    setCreatingAdmin(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { toast({ title: 'Not authenticated', variant: 'destructive' }); setCreatingAdmin(false); return; }
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL || 'https://djjbgzasuomhyfvtlidi.supabase.co'}/functions/v1/create-admin-user`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify({ email, password, first_name: firstName, last_name: lastName }),
      });
      const result = await res.json();
      if (!res.ok) {
        toast({ title: 'Error', description: result.error || 'Failed to create admin', variant: 'destructive' });
      } else {
        toast({ title: 'Admin user created', description: `${firstName} ${lastName} (${email}) has been created as admin.` });
        setCreateAdminOpen(false);
        setCreateAdminForm({ email: '', password: '', firstName: '', lastName: '' });
        loadUsers();
      }
    } catch (err) {
      console.error('Create admin error:', err);
      toast({ title: 'Error', description: 'Network error', variant: 'destructive' });
    }
    setCreatingAdmin(false);
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
        <div className="flex items-center gap-2">
          {unconfirmedUsers.length > 0 && (
            <Button variant={showUnconfirmed ? 'default' : 'outline'} size="sm" onClick={() => setShowUnconfirmed(!showUnconfirmed)}>
              <AlertTriangle className="h-4 w-4 mr-2" />
              {unconfirmedUsers.length} Unconfirmed Email{unconfirmedUsers.length > 1 ? 's' : ''}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={exportCSV}><Download className="h-4 w-4 mr-2" />{t('admin.export')}</Button>
          <Button size="sm" onClick={() => setCreateAdminOpen(true)}><UserPlus className="h-4 w-4 mr-2" />Create Admin</Button>
        </div>
      </div>

      {/* Unconfirmed emails section */}
      {showUnconfirmed && unconfirmedUsers.length > 0 && (
        <Card className="mb-6 border-amber-200 bg-amber-50">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              <h3 className="font-semibold text-amber-800">Users who haven't confirmed their email</h3>
            </div>
            <p className="text-sm text-amber-700 mb-3">These accounts were created but the email address was never confirmed. They don't have a profile yet.</p>
            <div className="space-y-2">
              {unconfirmedUsers.map(u => (
                <div key={u.id} className="flex items-center justify-between bg-white rounded-lg p-3 border border-amber-200">
                  <div>
                    <span className="font-medium text-gray-900">{u.first_name || u.last_name ? `${u.first_name || ''} ${u.last_name || ''}`.trim() : 'No name'}</span>
                    <span className="text-gray-500 text-sm ml-2">{u.email}</span>
                    {u.persona && <Badge variant="secondary" className="ml-2 text-xs">{u.persona}</Badge>}
                  </div>
                  <span className="text-xs text-gray-400">{new Date(u.created_at).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
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
              <Link to={`/users/${user.user_id}`} className="font-medium text-primary hover:underline" onClick={(e) => e.stopPropagation()}>{getUserName(user)}</Link>
              <div className="flex items-center gap-1 text-xs text-gray-500">
                {user.email || ''}
                {emailStatusMap[user.user_id] === false && (
                  <span className="inline-flex items-center gap-0.5 text-amber-600" title="Email not confirmed">
                    <AlertTriangle className="h-3 w-3" />
                  </span>
                )}
              </div>
            </td>
            <td className="p-4 text-sm text-gray-700">{getOrgName(user) || <span className="text-gray-400">—</span>}</td>
            <td className="p-4">
              <Select value={user.persona} onValueChange={(v) => { if (v !== user.persona) handleChangePersona(user.user_id, v); }}>
                <SelectTrigger className="w-36 h-8 text-xs" onClick={(e) => e.stopPropagation()}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="marina">Marina</SelectItem>
                  <SelectItem value="partner">Partner</SelectItem>
                  <SelectItem value="media_partner">Media Partner</SelectItem>
                  <SelectItem value="moderator">Moderator</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </td>
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
                <DetailRow label={t('admin.userDetail.persona')} value={
                  <Select value={selectedUser.persona} onValueChange={(v) => handleChangePersona(selectedUser.user_id, v)} disabled={changingPersona}>
                    <SelectTrigger className="w-36 h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="marina">Marina</SelectItem>
                      <SelectItem value="partner">Partner</SelectItem>
                      <SelectItem value="media_partner">Media Partner</SelectItem>
                      <SelectItem value="moderator">Moderator</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                } />
                <DetailRow label={t('admin.userDetail.onboarding')} value={selectedUser.onboarding_status} />
                <DetailRow label={t('admin.userDetail.accessStatus')} value={selectedUser.access_status} />
                <DetailRow label={t('admin.userDetail.created')} value={new Date(selectedUser.created_at).toLocaleDateString()} />
                {selectedUser.rejection_reason && (
                  <DetailRow label={t('admin.userDetail.rejectionReason')} value={<span className="text-red-600">{selectedUser.rejection_reason}</span>} />
                )}
              </div>

              {/* Organization details */}
              {detailLoading ? (
                <div className="flex justify-center py-4"><RefreshCw className="h-5 w-5 animate-spin text-gray-400" /></div>
              ) : detailData && (
                <>
                <div className="space-y-3">
                  <h4 className="font-semibold text-sm text-gray-700">Organization Info</h4>
                  <div className="bg-blue-50 rounded-lg p-4">
                    <DetailRow label="Name" value={detailData.name as string} />
                    <DetailRow label="Type" value={detailData.organization_type as string} />
                    <DetailRow label="Tier" value={detailData.tier as string} />
                    <DetailRow label="Country" value={detailData.country as string} />
                    <DetailRow label="City" value={detailData.city as string} />
                    <DetailRow label="Website" value={detailData.website ? <a href={detailData.website as string} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{detailData.website as string}</a> : null} />
                    <DetailRow label="Status" value={detailData.access_status as string} />
                    {typeof detailData.description === 'string' && detailData.description && <DetailRow label="Description" value={<span className="line-clamp-3">{detailData.description}</span>} />}
                    {selectedUser.org_id && (
                      <div className="mt-2"><Link to={`/organizations/${selectedUser.org_id}`} target="_blank" className="text-xs text-primary hover:underline flex items-center gap-1"><ExternalLink className="h-3 w-3" />View public page</Link></div>
                    )}
                  </div>
                </div>
                </>
              )}

              {/* Persona-specific details */}
              {!detailLoading && detailData && (
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

      {/* ─── Create Admin Dialog ─── */}
      <Dialog open={createAdminOpen} onOpenChange={setCreateAdminOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create Admin User</DialogTitle>
            <DialogDescription>Create a new admin account with full platform access. The user will be automatically verified.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>First Name *</Label>
                <Input value={createAdminForm.firstName} onChange={(e) => setCreateAdminForm({ ...createAdminForm, firstName: e.target.value })} placeholder="John" />
              </div>
              <div className="space-y-2">
                <Label>Last Name *</Label>
                <Input value={createAdminForm.lastName} onChange={(e) => setCreateAdminForm({ ...createAdminForm, lastName: e.target.value })} placeholder="Doe" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Email *</Label>
              <Input type="email" value={createAdminForm.email} onChange={(e) => setCreateAdminForm({ ...createAdminForm, email: e.target.value })} placeholder="admin@example.com" />
            </div>
            <div className="space-y-2">
              <Label>Password *</Label>
              <Input type="password" value={createAdminForm.password} onChange={(e) => setCreateAdminForm({ ...createAdminForm, password: e.target.value })} placeholder="Minimum 8 characters" />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setCreateAdminOpen(false)}>Cancel</Button>
              <Button onClick={handleCreateAdmin} disabled={creatingAdmin}>
                {creatingAdmin && <RefreshCw className="h-4 w-4 animate-spin mr-2" />}
                Create Admin
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
