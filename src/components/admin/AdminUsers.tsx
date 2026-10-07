import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  UserCheck, RefreshCw, Download,
  AlertTriangle, UserPlus, FileCheck, Clock, FileX, FileMinus,
} from 'lucide-react';
import { TIER_LABELS, TIER_COLORS, OrgTier } from '@/types/database';
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
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { sendNotification } from '@/lib/notifications';
import { AdminContextBanner } from './AdminContextBanner';
import {
  AdminPageHeader, AdminFilterBar, AdminTableCard, AdminKpiCard, AdminLoading, AdminStatusPill, AdminEmpty,
  ADMIN_BTN, ADMIN_BTN_PRIMARY,
} from './AdminUI';
import type { AdminProfile } from './types';

// Marina recommendation counts for partner organizations (informational only)
type ReferenceStatus = {
  total: number;
  confirmed: number;
  pending: number;
  rejected: number;
  clientName: string | null;
};

export function AdminUsers() {
  const { t } = useTranslation();
  const { user: currentUser } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlStatus = searchParams.get('status') || '';
  const urlPersona = searchParams.get('persona') || '';
  // The dashboard tiles open this list pre-filtered: ?onboarding=draft (not activated), ?status=verified&activity=inactive (dormant).
  const urlOnboarding = searchParams.get('onboarding') || '';
  const urlInactive = searchParams.get('activity') === 'inactive';
  const hasUrlFilters = !!urlStatus || !!urlPersona || !!urlOnboarding || urlInactive;

  const [users, setUsers] = useState<AdminProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [personaFilter, setPersonaFilter] = useState(urlPersona || 'all');
  const [statusFilter, setStatusFilter] = useState(urlStatus || 'all');
  const [onboardingFilter, setOnboardingFilter] = useState(urlOnboarding || 'all');
  const [inactiveOnly, setInactiveOnly] = useState(urlInactive);
  const [rejectingUserId, setRejectingUserId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [emailStatusMap, setEmailStatusMap] = useState<Record<string, boolean>>({});
  const [referenceStatusMap, setReferenceStatusMap] = useState<Record<string, ReferenceStatus>>({});
  const [unconfirmedUsers, setUnconfirmedUsers] = useState<{ id: string; email: string; created_at: string; first_name: string | null; last_name: string | null; persona: string | null }[]>([]);
  const [showUnconfirmed, setShowUnconfirmed] = useState(false);
  const [createAdminOpen, setCreateAdminOpen] = useState(false);
  const [createAdminForm, setCreateAdminForm] = useState({ email: '', password: '', firstName: '', lastName: '' });
  const [creatingAdmin, setCreatingAdmin] = useState(false);
  const [invitePartnerOpen, setInvitePartnerOpen] = useState(false);
  const [invitePartnerForm, setInvitePartnerForm] = useState({ email: '', firstName: '' });
  const [sendingPartnerInvite, setSendingPartnerInvite] = useState(false);
  const [changingPersona, setChangingPersona] = useState(false);

  useEffect(() => { loadUsers(); }, []);

  const loadUsers = async () => {
    setLoading(true);
    try {
      // Split into separate queries to avoid Supabase relationship join error
      const [{ data: profilesData, error }, { data: membershipsData }, { data: emailData }, { data: unconfData }] = await Promise.all([
        supabase
          .from('profiles')
          .select('user_id, first_name, last_name, email, persona, access_status, onboarding_status, rejection_reason, created_at, updated_at')
          .order('created_at', { ascending: false }),
        supabase
          .from('organization_members')
          .select('user_id, organization_id, organizations(id, name, tier, organization_type, access_status, max_seats, website, country, city, description, logo_url)'),
        supabase.rpc('get_users_email_status'),
        supabase.rpc('get_unconfirmed_users'),
      ]);
      if (error) { if (import.meta.env.DEV) console.error('Error loading users:', error); toast({ title: 'Error loading users', description: error.message, variant: 'destructive' }); }
      // Build a map from user_id → org info (including tier, type, status for merged Partners view)
      const orgMap = new Map<string, { org_id: string; org_name: string; org_tier: string; org_type: string | null; org_access_status: string; org_max_seats: number; org_website: string | null; org_country: string | null; org_city: string | null; org_description: string | null; org_logo_url: string | null }>();
      (membershipsData || []).forEach((m: Record<string, unknown>) => {
        const org = m.organizations as Record<string, unknown> | null;
        if (org) {
          orgMap.set(m.user_id as string, {
            org_id: org.id as string,
            org_name: org.name as string,
            org_tier: (org.tier as string) || 'member',
            org_type: (org.organization_type as string) || null,
            org_access_status: (org.access_status as string) || 'pending',
            org_max_seats: (org.max_seats as number) || 1,
            org_website: (org.website as string) || null,
            org_country: (org.country as string) || null,
            org_city: (org.city as string) || null,
            org_description: (org.description as string) || null,
            org_logo_url: (org.logo_url as string) || null,
          });
        }
      });
      // Merge profiles with org info
      const merged = (profilesData || []).map((row: Record<string, unknown>) => {
        const orgInfo = orgMap.get(row.user_id as string);
        return {
          ...row,
          org_name: orgInfo?.org_name || null,
          org_id: orgInfo?.org_id || null,
          org_tier: orgInfo?.org_tier || null,
          org_type: orgInfo?.org_type || null,
          org_access_status: orgInfo?.org_access_status || null,
          org_max_seats: orgInfo?.org_max_seats || null,
          org_website: orgInfo?.org_website || null,
          org_country: orgInfo?.org_country || null,
          org_city: orgInfo?.org_city || null,
          org_description: orgInfo?.org_description || null,
          org_logo_url: orgInfo?.org_logo_url || null,
        };
      });
      setUsers(merged as unknown as AdminProfile[]);
      // Build email confirmation status map
      const statusMap: Record<string, boolean> = {};
      (emailData || []).forEach((row: { user_id: string; email_confirmed: boolean }) => { statusMap[row.user_id] = row.email_confirmed; });
      setEmailStatusMap(statusMap);
      setUnconfirmedUsers((unconfData || []) as typeof unconfirmedUsers);

      // ── Load marina recommendation counts for partner orgs (informational) ──
      const partnerUsers = (merged as unknown as AdminProfile[]).filter((u) => u.persona === 'partner' && u.org_id);
      const partnerOrgIds = partnerUsers.map((u) => u.org_id as string);
      if (partnerOrgIds.length > 0) {
        const uniqueOrgIds = [...new Set(partnerOrgIds)];
        const { data: refData } = await supabase
          .from('reference_requests')
          .select('id, partner_organization_id, status, client_legal_name, confirmed_at, created_at')
          .in('partner_organization_id', uniqueOrgIds)
          .order('created_at', { ascending: false });

        const refMap: Record<string, ReferenceStatus> = {};
        const orgRefMap = new Map<string, typeof refData>();
        (refData || []).forEach((ref: { id: string; partner_organization_id: string; status: string; client_legal_name: string; confirmed_at: string | null; created_at: string }) => {
          const orgId = ref.partner_organization_id;
          if (!orgRefMap.has(orgId)) orgRefMap.set(orgId, []);
          orgRefMap.get(orgId)!.push(ref);
        });

        partnerUsers.forEach((u) => {
          const refs = orgRefMap.get(u.org_id!) || [];
          const confirmed = refs.filter((r: { status: string }) => r.status === 'confirmed').length;
          const pending = refs.filter((r: { status: string }) => r.status === 'pending' || r.status === 'sent').length;
          const rejected = refs.filter((r: { status: string }) => r.status === 'rejected').length;
          const latest = refs[0];
          refMap[u.user_id] = {
            total: refs.length,
            confirmed,
            pending,
            rejected,
            clientName: latest?.client_legal_name || null,
          };
        });
        setReferenceStatusMap(refMap);
      } else {
        setReferenceStatusMap({});
      }
    } catch (err) { if (import.meta.env.DEV) console.error('Error loading users:', err); }
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

  // Send email notification (fire and forget — non-blocking)
  const sendStatusNotification = async (userId: string, status: 'verified' | 'rejected' | 'suspended', reason?: string) => {
    try {
      await supabase.functions.invoke('send-status-notification', {
        body: { user_id: userId, status, reason },
        headers: currentUser?.id ? { 'x-caller-user-id': currentUser.id } : undefined,
      });
    } catch (err) {
      if (import.meta.env.DEV) console.warn('[AdminUsers] Email notification failed (non-blocking):', err);
    }
  };

  const approveUser = async (userId: string) => {
    const { error } = await supabase.from('profiles').update({ access_status: 'verified', onboarding_status: 'completed', rejection_reason: null }).eq('user_id', userId);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    // Cascade to the org ONLY when this user is its owner and it's still pending
    // — approving a collaborator must not auto-verify an unreviewed organization.
    const { data: membership } = await supabase.from('organization_members').select('organization_id').eq('user_id', userId).eq('role', 'owner').maybeSingle();
    if (membership?.organization_id) {
      await supabase.from('organizations').update({ access_status: 'verified', onboarding_status: 'completed' }).eq('id', membership.organization_id).eq('access_status', 'pending');
    }
    sendStatusNotification(userId, 'verified');
    toast({ title: 'User approved — email notification sent' }); loadUsers();
  };
  const openReject = (userId: string) => { setRejectingUserId(userId); setRejectReason(''); };
  const confirmReject = async () => {
    if (!rejectingUserId || !rejectReason.trim()) { toast({ title: t('admin.userDetail.reasonRequired'), variant: 'destructive' }); return; }
    const { error } = await supabase.from('profiles').update({ access_status: 'rejected', onboarding_status: 'draft', rejection_reason: rejectReason.trim() }).eq('user_id', rejectingUserId);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    // Cascade to the org ONLY when this user is its owner and it's still pending
    // — never reject a verified/established org because one collaborator was.
    const { data: membership } = await supabase.from('organization_members').select('organization_id').eq('user_id', rejectingUserId).eq('role', 'owner').maybeSingle();
    if (membership?.organization_id) {
      await supabase.from('organizations').update({ access_status: 'rejected', rejection_reason: rejectReason.trim() }).eq('id', membership.organization_id).eq('access_status', 'pending');
    }
    sendStatusNotification(rejectingUserId, 'rejected', rejectReason.trim());
    toast({ title: 'User rejected — email notification sent' }); setRejectingUserId(null); loadUsers();
  };
  const updateUserStatus = async (userId: string, newStatus: string) => {
    if (newStatus === 'verified') {
      await approveUser(userId);
      return;
    }
    if (newStatus === 'rejected') { openReject(userId); return; }
    await supabase.from('profiles').update({ access_status: newStatus }).eq('user_id', userId);
    if (newStatus === 'suspended') sendStatusNotification(userId, 'suspended');
    toast({ title: `Status: ${newStatus}` }); loadUsers();
  };

  const handleChangePersona = async (userId: string, newPersona: string) => {
    setChangingPersona(true);
    const { error } = await supabase.from('profiles').update({ persona: newPersona }).eq('user_id', userId);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: `Role updated to ${newPersona}` });
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
      if (import.meta.env.DEV) console.error('Create admin error:', err);
      toast({ title: 'Error', description: 'Network error', variant: 'destructive' });
    }
    setCreatingAdmin(false);
  };

  // Dormant = not updated for 30+ days (the same rule as the dashboard's Inactive tile).
  const dormantBefore = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const isDormant = (u: AdminProfile) => !!u.updated_at && new Date(u.updated_at).getTime() <= dormantBefore;

  const filteredUsers = users.filter(user => {
    const name = getUserName(user).toLowerCase();
    const org = getOrgName(user).toLowerCase();
    const email = (user.email || '').toLowerCase();
    const q = search.toLowerCase();
    const matchesSearch = search === '' || name.includes(q) || org.includes(q) || email.includes(q) || user.persona.includes(q);
    const matchesPersona = personaFilter === 'all' || user.persona === personaFilter;
    const matchesStatus = statusFilter === 'all' || user.access_status === statusFilter;
    const matchesOnboarding = onboardingFilter === 'all'
      || (onboardingFilter === 'in_progress' && ['draft', 'submitted', 'under_review'].includes(user.onboarding_status))
      || user.onboarding_status === onboardingFilter;
    const matchesActivity = !inactiveOnly || isDormant(user);
    return matchesSearch && matchesPersona && matchesStatus && matchesOnboarding && matchesActivity;
  });

  // Count users by onboarding stage (for the summary strip)
  const inProgressCount = users.filter(u => ['draft', 'submitted', 'under_review'].includes(u.onboarding_status)).length;
  const draftCount = users.filter(u => u.onboarding_status === 'draft').length;
  const submittedCount = users.filter(u => u.onboarding_status === 'submitted').length;

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
      case 'admin': return <AdminStatusPill tone="danger">Admin</AdminStatusPill>;
      case 'moderator': return <AdminStatusPill tone="danger">Moderator</AdminStatusPill>;
      case 'partner': return <AdminStatusPill tone="success">Service provider</AdminStatusPill>;
      case 'marina': return <AdminStatusPill tone="info">Marina</AdminStatusPill>;
      case 'media_partner': return <AdminStatusPill>Media</AdminStatusPill>;
      default: return <AdminStatusPill>{persona}</AdminStatusPill>;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'verified': return <AdminStatusPill tone="success">Verified</AdminStatusPill>;
      case 'pending': return <AdminStatusPill tone="warning">Pending</AdminStatusPill>;
      case 'rejected': return <AdminStatusPill tone="danger">Rejected</AdminStatusPill>;
      case 'suspended': return <AdminStatusPill tone="danger">Suspended</AdminStatusPill>;
      default: return <AdminStatusPill>{status}</AdminStatusPill>;
    }
  };

  const getOnboardingBadge = (user: AdminProfile) => {
    // Email not confirmed yet — before they even created a profile
    if (emailStatusMap[user.user_id] === false) {
      return <AdminStatusPill tone="warning" icon={Clock} title="Account created but email not yet confirmed">Email unconfirmed</AdminStatusPill>;
    }
    const stage = user.onboarding_status;
    const hasOrg = !!user.org_id;
    switch (stage) {
      case 'draft':
        return <AdminStatusPill tone="warning" icon={Clock} title={hasOrg ? 'Persona & profile created, organization form in progress' : 'Step 1/3: persona selected, has not filled the organization form yet'}>
          {hasOrg ? 'Filling profile' : 'Persona chosen'}
        </AdminStatusPill>;
      case 'submitted':
        return <AdminStatusPill tone="info" icon={FileCheck} title="Organization form submitted, waiting for admin review">Awaiting review</AdminStatusPill>;
      case 'under_review':
        return <AdminStatusPill tone="info" icon={FileCheck}>Under review</AdminStatusPill>;
      case 'completed':
        return <AdminStatusPill tone="success" icon={FileCheck}>Completed</AdminStatusPill>;
      default:
        return <AdminStatusPill>{stage || '—'}</AdminStatusPill>;
    }
  };

  const getReferenceBadge = (userId: string) => {
    const ref = referenceStatusMap[userId];
    if (!ref || ref.total === 0) {
      return (
        <AdminStatusPill icon={FileMinus} title="No marina recommendations yet">0</AdminStatusPill>
      );
    }
    if (ref.confirmed > 0) {
      return (
        <AdminStatusPill tone="success" icon={FileCheck} title={`${ref.confirmed} confirmed recommendation(s) — latest: ${ref.clientName}`}>
          {ref.confirmed} confirmed
        </AdminStatusPill>
      );
    }
    if (ref.rejected > 0 && ref.pending === 0) {
      return (
        <AdminStatusPill tone="danger" icon={FileX} title={`${ref.rejected} declined by marina`}>
          {ref.rejected} declined
        </AdminStatusPill>
      );
    }
    return (
      <AdminStatusPill tone="warning" icon={Clock} title={`${ref.pending} pending — latest: ${ref.clientName}`}>
        {ref.pending} pending
      </AdminStatusPill>
    );
  };

  const getTierBadge = (tier: string | null) => {
    if (!tier) return <span className="text-gray-300 text-xs">—</span>;
    const colors = TIER_COLORS[tier as OrgTier] || TIER_COLORS.member;
    const label = TIER_LABELS[tier as OrgTier] || tier;
    return <Badge className={`${colors.bg} ${colors.text} border ${colors.border} text-xs`}>{label}</Badge>;
  };

  if (loading) return <AdminLoading />;

  return (
    <div>
      <AdminPageHeader
        title={t('admin.users')}
        count={users.length}
        description={t('adminUi.pages.users')}
        actions={
          <>
            {unconfirmedUsers.length > 0 && (
              <Button variant="outline" size="sm" className={showUnconfirmed ? 'h-10 rounded-pill border-amber-300 bg-amber-50 px-4 text-amber-900 hover:bg-amber-100 hover:text-amber-900' : ADMIN_BTN} onClick={() => setShowUnconfirmed(!showUnconfirmed)}>
                <AlertTriangle className="h-4 w-4 mr-2" />
                {unconfirmedUsers.length} Unconfirmed Email{unconfirmedUsers.length > 1 ? 's' : ''}
              </Button>
            )}
            <Button variant="outline" size="sm" className={ADMIN_BTN} onClick={exportCSV}><Download className="h-4 w-4 mr-2" />{t('admin.export')}</Button>
            <Button variant="outline" size="sm" className={ADMIN_BTN} onClick={() => setInvitePartnerOpen(true)}><UserPlus className="h-4 w-4 mr-2" />Invite a service provider</Button>
            <Button variant="secondary" size="sm" className={ADMIN_BTN_PRIMARY} onClick={() => setCreateAdminOpen(true)}><UserPlus className="h-4 w-4 mr-2" />Create Admin</Button>
          </>
        }
      />

      {/* URL-based filter context banner */}
      {hasUrlFilters && (
        <AdminContextBanner
          label={[
            urlStatus ? `Status: ${urlStatus.replace('_', ' ')}` : '',
            urlPersona ? `Type: ${urlPersona.replace('_', ' ')}` : '',
            urlOnboarding ? `Onboarding: ${urlOnboarding.replace('_', ' ')}` : '',
            urlInactive ? 'Inactive 30+ days' : '',
          ].filter(Boolean).join(' + ')}
          count={users.filter(u => {
            const matchStatus = !urlStatus || u.access_status === urlStatus;
            const matchPersona = !urlPersona || u.persona === urlPersona;
            const matchOnboarding = !urlOnboarding || u.onboarding_status === urlOnboarding;
            const matchActivity = !urlInactive || isDormant(u);
            return matchStatus && matchPersona && matchOnboarding && matchActivity;
          }).length}
          onClear={() => {
            setSearchParams({}, { replace: true });
            setStatusFilter('all');
            setPersonaFilter('all');
            setOnboardingFilter('all');
            setInactiveOnly(false);
          }}
          color={urlStatus === 'pending' ? 'amber' : urlStatus === 'rejected' ? 'red' : 'blue'}
        />
      )}

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
                    {u.persona && <AdminStatusPill className="ml-2">{u.persona}</AdminStatusPill>}
                  </div>
                  <span className="text-xs text-gray-400">{new Date(u.created_at).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
      {/* Onboarding progress strip — quick overview of users still in the signup funnel */}
      {inProgressCount > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <AdminKpiCard
            label="In progress"
            hint="users still onboarding"
            value={inProgressCount}
            selected={onboardingFilter === 'in_progress'}
            onClick={() => setOnboardingFilter(onboardingFilter === 'in_progress' ? 'all' : 'in_progress')}
          />
          <AdminKpiCard
            label="Draft"
            hint="filling profile (pre-submit)"
            value={draftCount}
            selected={onboardingFilter === 'draft'}
            onClick={() => setOnboardingFilter(onboardingFilter === 'draft' ? 'all' : 'draft')}
          />
          <AdminKpiCard
            label="Submitted"
            hint="awaiting your review"
            value={submittedCount}
            selected={onboardingFilter === 'submitted'}
            onClick={() => setOnboardingFilter(onboardingFilter === 'submitted' ? 'all' : 'submitted')}
          />
          {onboardingFilter !== 'all' && (
            <button
              type="button"
              onClick={() => setOnboardingFilter('all')}
              className="rounded-card border border-dashed border-navy/25 bg-white p-4 text-left transition-colors hover:border-navy hover:bg-chip focus:outline-none focus-visible:shadow-focus"
            >
              <div className="text-[13px] text-meta">Clear filter</div>
              <div className="mt-1 text-[15px] font-semibold text-navy">Show all users</div>
            </button>
          )}
        </div>
      )}

      <AdminFilterBar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder={t('admin.userDetail.searchPlaceholder')}
      >
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
        <Select value={onboardingFilter} onValueChange={setOnboardingFilter}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Onboarding" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All stages</SelectItem>
            <SelectItem value="in_progress">In progress (any)</SelectItem>
            <SelectItem value="draft">Draft — filling profile</SelectItem>
            <SelectItem value="submitted">Submitted</SelectItem>
            <SelectItem value="under_review">Under review</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
          </SelectContent>
        </Select>
        <Select value={personaFilter} onValueChange={setPersonaFilter}>
          <SelectTrigger className="w-48"><SelectValue placeholder="Persona" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All account types</SelectItem>
            <SelectItem value="marina">Marina</SelectItem>
            <SelectItem value="partner">Service provider</SelectItem>
            <SelectItem value="media_partner">Media</SelectItem>
            <SelectItem value="developer">Developer</SelectItem>
            <SelectItem value="investor">Investor</SelectItem>
            <SelectItem value="moderator">Moderator</SelectItem>
            <SelectItem value="admin">Admin</SelectItem>
          </SelectContent>
        </Select>
      </AdminFilterBar>
      <AdminTableCard footer={`${filteredUsers.length} of ${users.length} users`}><table className="w-full"><thead><tr>
        <th className="text-left">{t('admin.userDetail.name')}</th>
        <th className="text-left">{t('admin.userDetail.organization')}</th>
        <th className="text-left">{t('admin.userDetail.persona')}</th>
        <th className="text-left">Onboarding</th>
        <th className="text-left">Tier</th>
        <th className="text-left">Recommendations</th>
        <th className="text-left">{t('admin.userDetail.accessStatus')}</th>
        <th className="text-left">{t('admin.userDetail.created')}</th>
      </tr></thead><tbody>
        {filteredUsers.map(user => (
          <tr key={user.user_id} className="cursor-pointer group" onClick={() => navigate(`/admin/users/${user.user_id}`)}>
            <td>
              <Link
                to={`/admin/users/${user.user_id}`}
                onClick={(e) => e.stopPropagation()}
                className="rounded-sm font-medium text-navy focus:outline-none focus-visible:shadow-focus"
              >
                <span className="card-ul">{getUserName(user)}</span>
              </Link>
              <div className="flex items-center gap-1 text-xs text-meta">
                {user.email || ''}
                {emailStatusMap[user.user_id] === false && (
                  <span className="inline-flex items-center gap-0.5 text-amber-600" title="Email not confirmed">
                    <AlertTriangle className="h-3 w-3" />
                  </span>
                )}
              </div>
            </td>
            <td className="text-sm text-ink">{getOrgName(user) || <span className="text-meta/60">---</span>}</td>
            <td>
              <Select value={user.persona} onValueChange={(v) => { if (v !== user.persona) handleChangePersona(user.user_id, v); }}>
                <SelectTrigger className="h-8 w-40 text-xs" onClick={(e) => e.stopPropagation()}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="marina">Marina</SelectItem>
                  <SelectItem value="partner">Service provider</SelectItem>
                  <SelectItem value="media_partner">Media</SelectItem>
                  <SelectItem value="developer">Developer</SelectItem>
                  <SelectItem value="investor">Investor</SelectItem>
                  <SelectItem value="moderator">Moderator</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </td>
            <td>{getOnboardingBadge(user)}</td>
            <td>{getTierBadge(user.org_tier)}</td>
            <td>
              {user.persona === 'partner' ? getReferenceBadge(user.user_id) : <span className="text-meta/60 text-xs">---</span>}
            </td>
            <td>
              <Select value={user.access_status} onValueChange={(v) => { v !== user.access_status && updateUserStatus(user.user_id, v); }}>
                <SelectTrigger className="h-8 w-32 text-xs" onClick={(e) => e.stopPropagation()}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">Pending</SelectItem><SelectItem value="verified">Verified</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem><SelectItem value="suspended">Suspended</SelectItem>
                </SelectContent>
              </Select>
            </td>
            <td>
              <span className="whitespace-nowrap text-sm text-meta">{new Date(user.created_at).toLocaleDateString()}</span>
            </td>
          </tr>
        ))}
        {filteredUsers.length === 0 && <tr><td colSpan={8}><AdminEmpty icon={UserCheck} title={t('admin.userDetail.noUsersFound', 'No users found')} /></td></tr>}
      </tbody></table></AdminTableCard>


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

      {/* ─── Invite Partner Dialog ─── */}
      <Dialog open={invitePartnerOpen} onOpenChange={setInvitePartnerOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Invite a service provider</DialogTitle>
            <DialogDescription>
              Send the onboarding guide email to a service provider. They'll receive a short email explaining the 3-step signup process with a direct link to create their account.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>First Name</Label>
              <Input
                value={invitePartnerForm.firstName}
                onChange={(e) => setInvitePartnerForm({ ...invitePartnerForm, firstName: e.target.value })}
                placeholder="(optional — used in greeting)"
              />
            </div>
            <div className="space-y-2">
              <Label>Email *</Label>
              <Input
                type="email"
                value={invitePartnerForm.email}
                onChange={(e) => setInvitePartnerForm({ ...invitePartnerForm, email: e.target.value })}
                placeholder="partner@company.com"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setInvitePartnerOpen(false)}>Cancel</Button>
              <Button
                onClick={async () => {
                  if (!invitePartnerForm.email.trim()) return;
                  setSendingPartnerInvite(true);
                  try {
                    await sendNotification({
                      type: 'partner_onboarding_welcome',
                      email: invitePartnerForm.email.trim(),
                      data: {
                        email: invitePartnerForm.email.trim(),
                        first_name: invitePartnerForm.firstName.trim(),
                      },
                    });
                    toast({ title: 'Invitation sent', description: `Onboarding guide sent to ${invitePartnerForm.email.trim()}.` });
                    setInvitePartnerForm({ email: '', firstName: '' });
                    setInvitePartnerOpen(false);
                  } catch {
                    toast({ title: 'Failed to send', description: 'Please try again.', variant: 'destructive' });
                  }
                  setSendingPartnerInvite(false);
                }}
                disabled={sendingPartnerInvite || !invitePartnerForm.email.trim()}
              >
                {sendingPartnerInvite && <RefreshCw className="h-4 w-4 animate-spin mr-2" />}
                Send Invitation
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
}
