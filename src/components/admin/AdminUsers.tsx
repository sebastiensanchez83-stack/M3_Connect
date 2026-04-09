import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  UserCheck, RefreshCw, Search, Download,
  AlertTriangle, UserPlus, FileCheck, Clock, FileX, FileMinus, ShieldCheck,
  ChevronRight,
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
import type { AdminProfile } from './types';

// Reference status for partner organizations
type ReferenceStatus = {
  total: number;        // total reference requests submitted
  confirmed: number;    // references confirmed by marina
  pending: number;      // references still pending
  rejected: number;     // references rejected by marina
  latestStatus: string; // status of latest reference request
  clientName: string | null; // client name of latest reference
  bypass: boolean;      // admin override — no marina clients
  bypassReason: string | null;
  bypassRequestId: string | null;       // pending bypass request from partner
  bypassRequestStatus: string | null;
  bypassRequestReason: string | null;
  bypassRequestBackground: string | null;
};

const REQUIRED_REFERENCES = 2;

export function AdminUsers() {
  const { t } = useTranslation();
  const { user: currentUser } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlStatus = searchParams.get('status') || '';
  const urlPersona = searchParams.get('persona') || '';
  const hasUrlFilters = !!urlStatus || !!urlPersona;

  const [users, setUsers] = useState<AdminProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [personaFilter, setPersonaFilter] = useState(urlPersona || 'all');
  const [statusFilter, setStatusFilter] = useState(urlStatus || 'all');
  const [rejectingUserId, setRejectingUserId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [emailStatusMap, setEmailStatusMap] = useState<Record<string, boolean>>({});
  const [referenceStatusMap, setReferenceStatusMap] = useState<Record<string, ReferenceStatus>>({});
  const [unconfirmedUsers, setUnconfirmedUsers] = useState<{ id: string; email: string; created_at: string; first_name: string | null; last_name: string | null; persona: string | null }[]>([]);
  const [showUnconfirmed, setShowUnconfirmed] = useState(false);
  const [createAdminOpen, setCreateAdminOpen] = useState(false);
  const [createAdminForm, setCreateAdminForm] = useState({ email: '', password: '', firstName: '', lastName: '' });
  const [creatingAdmin, setCreatingAdmin] = useState(false);
  const [changingPersona, setChangingPersona] = useState(false);
  const [bypassDialogUserId, setBypassDialogUserId] = useState<string | null>(null);
  const [bypassReason, setBypassReason] = useState('');

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

      // ── Load reference/recommendation status for partner orgs ──
      const partnerUsers = (merged as unknown as AdminProfile[]).filter((u) => u.persona === 'partner' && u.org_id);
      const partnerOrgIds = partnerUsers.map((u) => u.org_id as string);
      if (partnerOrgIds.length > 0) {
        const uniqueOrgIds = [...new Set(partnerOrgIds)];
        const [{ data: refData }, { data: bypassData }, { data: bypassReqData }] = await Promise.all([
          supabase
            .from('reference_requests')
            .select('id, partner_organization_id, status, client_legal_name, confirmed_at, created_at')
            .in('partner_organization_id', uniqueOrgIds)
            .order('created_at', { ascending: false }),
          supabase
            .from('organizations')
            .select('id, reference_bypass, reference_bypass_reason')
            .in('id', uniqueOrgIds),
          supabase
            .from('reference_bypass_requests')
            .select('id, organization_id, status, reason, company_background')
            .in('organization_id', uniqueOrgIds)
            .order('created_at', { ascending: false }),
        ]);

        // Build bypass map: org_id → { bypass, reason }
        const bypassMap = new Map<string, { bypass: boolean; reason: string | null }>();
        (bypassData || []).forEach((org: { id: string; reference_bypass: boolean; reference_bypass_reason: string | null }) => {
          bypassMap.set(org.id, { bypass: org.reference_bypass, reason: org.reference_bypass_reason });
        });

        // Build bypass request map: org_id → latest bypass request
        const bypassReqMap = new Map<string, { id: string; status: string; reason: string; company_background: string | null }>();
        (bypassReqData || []).forEach((req: { id: string; organization_id: string; status: string; reason: string; company_background: string | null }) => {
          // Only store the first (latest) per org
          if (!bypassReqMap.has(req.organization_id)) {
            bypassReqMap.set(req.organization_id, req);
          }
        });

        const refMap: Record<string, ReferenceStatus> = {};

        // Group references by org_id
        const orgRefMap = new Map<string, typeof refData>();
        (refData || []).forEach((ref: { id: string; partner_organization_id: string; status: string; client_legal_name: string; confirmed_at: string | null; created_at: string }) => {
          const orgId = ref.partner_organization_id;
          if (!orgRefMap.has(orgId)) orgRefMap.set(orgId, []);
          orgRefMap.get(orgId)!.push(ref);
        });

        // Map back to user_id
        partnerUsers.forEach((u) => {
          const refs = orgRefMap.get(u.org_id!) || [];
          const confirmed = refs.filter((r: { status: string }) => r.status === 'confirmed').length;
          const pending = refs.filter((r: { status: string }) => r.status === 'pending' || r.status === 'sent').length;
          const rejected = refs.filter((r: { status: string }) => r.status === 'rejected').length;
          const latest = refs[0]; // already sorted desc
          const bp = bypassMap.get(u.org_id!) || { bypass: false, reason: null };
          const bpReq = bypassReqMap.get(u.org_id!) || null;
          refMap[u.user_id] = {
            total: refs.length,
            confirmed,
            pending,
            rejected,
            latestStatus: latest?.status || 'none',
            clientName: latest?.client_legal_name || null,
            bypass: bp.bypass,
            bypassReason: bp.reason,
            bypassRequestId: bpReq?.id || null,
            bypassRequestStatus: bpReq?.status || null,
            bypassRequestReason: bpReq?.reason || null,
            bypassRequestBackground: bpReq?.company_background || null,
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
    // Also update the user's organization
    const { data: membership } = await supabase.from('organization_members').select('organization_id').eq('user_id', userId).maybeSingle();
    if (membership?.organization_id) {
      await supabase.from('organizations').update({ access_status: 'verified', onboarding_status: 'completed' }).eq('id', membership.organization_id);
    }
    sendStatusNotification(userId, 'verified');
    toast({ title: 'User approved — email notification sent' }); loadUsers();
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
    sendStatusNotification(rejectingUserId, 'rejected', rejectReason.trim());
    toast({ title: 'User rejected — email notification sent' }); setRejectingUserId(null); loadUsers();
  };
  const updateUserStatus = async (userId: string, newStatus: string) => {
    if (newStatus === 'verified') {
      // Check reference gate for partners
      const user = users.find(u => u.user_id === userId);
      if (user && !canApprovePartner(userId, user.persona)) {
        toast({
          title: 'Cannot approve partner',
          description: `This partner needs ${REQUIRED_REFERENCES} confirmed marina recommendations (or admin bypass) before approval.`,
          variant: 'destructive',
        });
        return;
      }
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

  const handleBypassReference = async () => {
    if (!bypassDialogUserId || !bypassReason.trim()) {
      toast({ title: 'A justification is required', variant: 'destructive' });
      return;
    }
    const user = users.find(u => u.user_id === bypassDialogUserId);
    if (!user?.org_id) {
      toast({ title: 'No organization found for this user', variant: 'destructive' });
      return;
    }
    const adminUserId = (await supabase.auth.getUser()).data.user?.id || null;
    const { error } = await supabase.from('organizations').update({
      reference_bypass: true,
      reference_bypass_reason: bypassReason.trim(),
      reference_bypass_at: new Date().toISOString(),
      reference_bypass_by: adminUserId,
    }).eq('id', user.org_id);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      return;
    }
    // Also mark the partner's bypass request as approved if one exists
    const ref = referenceStatusMap[bypassDialogUserId];
    if (ref?.bypassRequestId) {
      await supabase.from('reference_bypass_requests').update({
        status: 'approved',
        admin_notes: bypassReason.trim(),
        reviewed_by: adminUserId,
        reviewed_at: new Date().toISOString(),
      }).eq('id', ref.bypassRequestId);
    }
    // Notify partner that bypass was approved
    sendNotification({ type: 'bypass_approved', userId: bypassDialogUserId, data: { admin_notes: bypassReason.trim() } });
    toast({ title: 'Reference requirement bypassed', description: 'This partner can now be approved without 2 confirmed marina references.' });
    setBypassDialogUserId(null);
    setBypassReason('');
    loadUsers();
  };

  const rejectBypassRequest = async (userId: string) => {
    const ref = referenceStatusMap[userId];
    if (!ref?.bypassRequestId) return;
    const adminUserId = (await supabase.auth.getUser()).data.user?.id || null;
    await supabase.from('reference_bypass_requests').update({
      status: 'rejected',
      admin_notes: bypassReason.trim() || 'Bypass request declined by admin',
      reviewed_by: adminUserId,
      reviewed_at: new Date().toISOString(),
    }).eq('id', ref.bypassRequestId);
    // Notify partner that bypass was rejected
    sendNotification({ type: 'bypass_rejected', userId, data: { admin_notes: bypassReason.trim() || 'Bypass request declined by admin' } });
    toast({ title: 'Bypass request declined' });
    loadUsers();
  };

  const revokeBypass = async (userId: string) => {
    const user = users.find(u => u.user_id === userId);
    if (!user?.org_id) return;
    await supabase.from('organizations').update({
      reference_bypass: false,
      reference_bypass_reason: null,
      reference_bypass_at: null,
      reference_bypass_by: null,
    }).eq('id', user.org_id);
    toast({ title: 'Bypass revoked' });
    loadUsers();
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

  const getReferenceBadge = (userId: string) => {
    const ref = referenceStatusMap[userId];
    if (!ref || ref.total === 0) {
      return (
        <div className="flex flex-col gap-1">
          <Badge variant="outline" className="text-xs gap-1 border-gray-300 text-gray-500" title="No recommendation submitted yet">
            <FileMinus className="h-3 w-3" /> 0/{REQUIRED_REFERENCES} refs
          </Badge>
          {ref?.bypass && (
            <Badge variant="secondary" className="text-xs gap-1" title={`Bypass: ${ref.bypassReason}`}>
              <ShieldCheck className="h-3 w-3" /> Bypassed
            </Badge>
          )}
          {ref?.bypassRequestStatus === 'pending' && !ref?.bypass && (
            <Badge className="text-xs gap-1 bg-violet-100 text-violet-700 border-0" title="Partner requested bypass">
              <ShieldCheck className="h-3 w-3" /> Bypass req.
            </Badge>
          )}
        </div>
      );
    }
    if (ref.bypass) {
      return (
        <div className="flex flex-col gap-1">
          <Badge variant="secondary" className="text-xs gap-1 border-violet-300 bg-violet-50 text-violet-700" title={`Bypass: ${ref.bypassReason}`}>
            <ShieldCheck className="h-3 w-3" /> Bypassed
          </Badge>
          <span className="text-[10px] text-gray-400">{ref.confirmed}/{REQUIRED_REFERENCES} confirmed</span>
        </div>
      );
    }
    if (ref.confirmed >= REQUIRED_REFERENCES) {
      return (
        <Badge variant="success" className="text-xs gap-1" title={`${ref.confirmed} confirmed reference(s) — ${ref.clientName}`}>
          <FileCheck className="h-3 w-3" /> {ref.confirmed}/{REQUIRED_REFERENCES} refs ✓
        </Badge>
      );
    }
    if (ref.confirmed > 0) {
      return (
        <Badge variant="warning" className="text-xs gap-1" title={`${ref.confirmed}/${REQUIRED_REFERENCES} confirmed — needs ${REQUIRED_REFERENCES - ref.confirmed} more`}>
          <FileCheck className="h-3 w-3" /> {ref.confirmed}/{REQUIRED_REFERENCES} refs
        </Badge>
      );
    }
    if (ref.rejected > 0 && ref.pending === 0) {
      return (
        <Badge variant="destructive" className="text-xs gap-1" title={`${ref.rejected} reference(s) rejected by marina — ${ref.clientName}`}>
          <FileX className="h-3 w-3" /> Ref rejected
        </Badge>
      );
    }
    return (
      <Badge variant="warning" className="text-xs gap-1" title={`${ref.pending} pending reference(s) — ${ref.clientName}`}>
        <Clock className="h-3 w-3" /> {ref.confirmed}/{REQUIRED_REFERENCES} pending
      </Badge>
    );
  };

  // Check if partner can be approved (must have 2 confirmed references OR admin bypass)
  const canApprovePartner = (userId: string, persona: string): boolean => {
    if (persona !== 'partner') return true; // non-partners: no reference gate
    const ref = referenceStatusMap[userId];
    if (!ref) return false;
    if (ref.bypass) return true; // admin override
    return ref.confirmed >= REQUIRED_REFERENCES;
  };

  const getTierBadge = (tier: string | null) => {
    if (!tier) return <span className="text-gray-300 text-xs">—</span>;
    const colors = TIER_COLORS[tier as OrgTier] || TIER_COLORS.member;
    const label = TIER_LABELS[tier as OrgTier] || tier;
    return <Badge className={`${colors.bg} ${colors.text} border ${colors.border} text-xs`}>{label}</Badge>;
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

      {/* URL-based filter context banner */}
      {hasUrlFilters && (
        <AdminContextBanner
          label={[
            urlStatus ? `Status: ${urlStatus.replace('_', ' ')}` : '',
            urlPersona ? `Type: ${urlPersona.replace('_', ' ')}` : '',
          ].filter(Boolean).join(' + ')}
          count={users.filter(u => {
            const matchStatus = !urlStatus || u.access_status === urlStatus;
            const matchPersona = !urlPersona || u.persona === urlPersona;
            return matchStatus && matchPersona;
          }).length}
          onClear={() => {
            setSearchParams({}, { replace: true });
            setStatusFilter('all');
            setPersonaFilter('all');
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
        <th className="text-left p-4 font-medium">Tier</th>
        <th className="text-left p-4 font-medium">Reference</th>
        <th className="text-left p-4 font-medium">{t('admin.userDetail.accessStatus')}</th>
        <th className="text-left p-4 font-medium">{t('admin.userDetail.created')}</th>
      </tr></thead><tbody>
        {filteredUsers.map(user => (
          <tr key={user.user_id} className="border-b hover:bg-muted/50 cursor-pointer transition-colors group" onClick={() => navigate(`/admin/users/${user.user_id}`)}>
            <td className="p-4">
              <span className="font-medium text-gray-900 group-hover:text-primary transition-colors">{getUserName(user)}</span>
              <div className="flex items-center gap-1 text-xs text-gray-500">
                {user.email || ''}
                {emailStatusMap[user.user_id] === false && (
                  <span className="inline-flex items-center gap-0.5 text-amber-600" title="Email not confirmed">
                    <AlertTriangle className="h-3 w-3" />
                  </span>
                )}
              </div>
            </td>
            <td className="p-4 text-sm text-gray-700">{getOrgName(user) || <span className="text-gray-400">---</span>}</td>
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
            <td className="p-4">{getTierBadge(user.org_tier)}</td>
            <td className="p-4">
              {user.persona === 'partner' ? getReferenceBadge(user.user_id) : <span className="text-gray-300 text-xs">---</span>}
            </td>
            <td className="p-4">
              <Select value={user.access_status} onValueChange={(v) => { v !== user.access_status && updateUserStatus(user.user_id, v); }}>
                <SelectTrigger className="w-36" onClick={(e) => e.stopPropagation()}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">Pending</SelectItem><SelectItem value="verified">Verified</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem><SelectItem value="suspended">Suspended</SelectItem>
                </SelectContent>
              </Select>
            </td>
            <td className="p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">{new Date(user.created_at).toLocaleDateString()}</span>
                <ChevronRight className="h-4 w-4 text-gray-300 group-hover:text-primary transition-colors" />
              </div>
            </td>
          </tr>
        ))}
        {filteredUsers.length === 0 && <tr><td colSpan={7} className="p-8 text-center text-gray-400">{t('admin.userDetail.noUsersFound', 'No users found')}</td></tr>}
      </tbody></table></div></CardContent></Card>

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

      {/* ─── Bypass Reference Dialog ─── */}
      <Dialog open={!!bypassDialogUserId} onOpenChange={() => setBypassDialogUserId(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-violet-600" />
              Bypass Reference Requirement
            </DialogTitle>
            <DialogDescription>
              This partner has not yet provided {REQUIRED_REFERENCES} confirmed marina references. If this partner has never worked with marinas before, you can bypass this requirement with a justification.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="bg-violet-50 border border-violet-200 rounded-lg p-3 text-sm text-violet-700">
              <strong>Note:</strong> This override will be logged. The partner will be approvable immediately after bypass. You can revoke it later if needed.
            </div>
            <div className="space-y-2">
              <Label>Justification *</Label>
              <Textarea
                value={bypassReason}
                onChange={(e) => setBypassReason(e.target.value)}
                rows={3}
                placeholder="e.g. New company with no marina clients yet, strong industry credentials, recommended by board member..."
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setBypassDialogUserId(null)}>Cancel</Button>
              <Button
                className="bg-violet-600 hover:bg-violet-700"
                onClick={handleBypassReference}
                disabled={!bypassReason.trim()}
              >
                <ShieldCheck className="h-4 w-4 mr-1" />
                Confirm Bypass
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
