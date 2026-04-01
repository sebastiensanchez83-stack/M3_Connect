import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Users, UserCheck, RefreshCw, Search, Download,
  Eye, AlertTriangle, ExternalLink, UserPlus, FileCheck, Clock, FileX, FileMinus, ShieldCheck,
  ArrowUpCircle,
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
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { sendNotification } from '@/lib/notifications';
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
    } catch (err) { if (import.meta.env.DEV) console.error('Error loading user detail:', err); }
    setDetailLoading(false);
  };

  // Send email notification (fire and forget — non-blocking)
  const sendStatusNotification = async (userId: string, status: 'verified' | 'rejected' | 'suspended', reason?: string) => {
    try {
      await supabase.functions.invoke('send-status-notification', {
        body: { user_id: userId, status, reason },
      });
    } catch (err) {
      if (import.meta.env.DEV) console.warn('[AdminUsers] Email notification failed (non-blocking):', err);
    }
  };

  const approveUser = async (userId: string) => {
    const { error } = await supabase.from('profiles').update({ access_status: 'verified', onboarding_status: 'completed', rejection_reason: null }).eq('user_id', userId);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    // Also verify the user's organization
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
      if (selectedUser) setSelectedUser({ ...selectedUser, persona: newPersona });
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

  // ── Tier management (merged from AdminPartners) ──
  const [updatingTier, setUpdatingTier] = useState(false);
  const [updatingOrgStatus, setUpdatingOrgStatus] = useState(false);
  const [editingSeats, setEditingSeats] = useState<number | null>(null);

  const updateOrgTier = async (orgId: string, newTier: string, userId: string) => {
    setUpdatingTier(true);
    const { data: tierConfig } = await supabase
      .from('organization_tier_config')
      .select('max_seats')
      .eq('tier', newTier)
      .single();
    const maxSeats = tierConfig?.max_seats || 1;
    const { error } = await supabase
      .from('organizations')
      .update({ tier: newTier, max_seats: maxSeats })
      .eq('id', orgId);
    setUpdatingTier(false);
    if (error) {
      toast({ title: 'Failed to update tier', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: `Tier updated to ${TIER_LABELS[newTier as OrgTier] || newTier}` });
      if (selectedUser?.user_id === userId) {
        setSelectedUser({ ...selectedUser, org_tier: newTier, org_max_seats: maxSeats });
      }
      loadUsers();
    }
  };

  const updateOrgStatus = async (orgId: string, status: string) => {
    setUpdatingOrgStatus(true);
    await supabase.from('organizations').update({ access_status: status }).eq('id', orgId);
    setUpdatingOrgStatus(false);
    toast({ title: `Organization status updated to ${status}` });
    loadUsers();
  };

  const saveOrgSeats = async (orgId: string, seats: number) => {
    const { error } = await supabase.from('organizations').update({ max_seats: seats }).eq('id', orgId);
    if (error) {
      toast({ title: 'Failed', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: `Seats updated to ${seats}` });
      loadUsers();
    }
    setEditingSeats(null);
  };

  const getTierBadge = (tier: string | null) => {
    if (!tier) return <span className="text-gray-300 text-xs">—</span>;
    const colors = TIER_COLORS[tier as OrgTier] || TIER_COLORS.member;
    const label = TIER_LABELS[tier as OrgTier] || tier;
    return <Badge className={`${colors.bg} ${colors.text} border ${colors.border} text-xs`}>{label}</Badge>;
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
        <th className="text-left p-4 font-medium">Tier</th>
        <th className="text-left p-4 font-medium">Reference</th>
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
            <td className="p-4">{getTierBadge(user.org_tier)}</td>
            <td className="p-4">
              {user.persona === 'partner' ? getReferenceBadge(user.user_id) : <span className="text-gray-300 text-xs">—</span>}
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
            <td className="p-4 text-sm text-gray-500">{new Date(user.created_at).toLocaleDateString()}</td>
          </tr>
        ))}
        {filteredUsers.length === 0 && <tr><td colSpan={7} className="p-8 text-center text-gray-400">{t('admin.userDetail.noUsersFound', 'No users found')}</td></tr>}
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

                {/* ── Tier & Org Management (merged from Partners tab) ── */}
                {selectedUser.org_id && (
                  <div className="space-y-3">
                    <h4 className="font-semibold text-sm text-gray-700 flex items-center gap-2">
                      <ArrowUpCircle className="h-4 w-4" /> Membership & Tier Management
                    </h4>
                    <div className="border rounded-lg p-4 bg-gray-50 space-y-3">
                      <div className="flex items-center justify-between">
                        <Label className="font-semibold text-sm">Membership Tier</Label>
                        <div className="flex items-center gap-2">
                          <Select
                            value={selectedUser.org_tier || 'member'}
                            onValueChange={(v) => updateOrgTier(selectedUser.org_id!, v, selectedUser.user_id)}
                            disabled={updatingTier}
                          >
                            <SelectTrigger className="w-48 h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="member">Member</SelectItem>
                              <SelectItem value="innovation_partner">Innovation Partner</SelectItem>
                              <SelectItem value="associate_partner">Associate Partner</SelectItem>
                              <SelectItem value="premium_partner">Premium Partner</SelectItem>
                              <SelectItem value="premium_sponsor">Premium Sponsor</SelectItem>
                              <SelectItem value="main_sponsor">Main Sponsor</SelectItem>
                            </SelectContent>
                          </Select>
                          {updatingTier && <RefreshCw className="h-4 w-4 animate-spin text-gray-400" />}
                        </div>
                      </div>
                      <p className="text-xs text-gray-500">Changing the tier updates seat limits automatically.</p>

                      <div className="flex items-center justify-between pt-2 border-t border-gray-200">
                        <Label className="text-sm">Max Seats</Label>
                        <div className="flex items-center gap-2">
                          <Input
                            type="number"
                            min={1}
                            max={100}
                            className="w-20 h-8 text-xs"
                            value={editingSeats ?? selectedUser.org_max_seats ?? 1}
                            onChange={(e) => setEditingSeats(parseInt(e.target.value) || 1)}
                          />
                          {editingSeats !== null && editingSeats !== selectedUser.org_max_seats && (
                            <Button size="sm" variant="outline" className="h-8 text-xs"
                              onClick={() => saveOrgSeats(selectedUser.org_id!, editingSeats)}>
                              Save
                            </Button>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-2 border-t border-gray-200">
                        <Label className="text-sm">Org Status</Label>
                        <div className="flex gap-2">
                          {selectedUser.org_access_status !== 'verified' && (
                            <Button size="sm" variant="outline" className="h-7 text-xs" disabled={updatingOrgStatus}
                              onClick={() => updateOrgStatus(selectedUser.org_id!, 'verified')}>
                              Verify Org
                            </Button>
                          )}
                          {selectedUser.org_access_status === 'verified' && (
                            <Button size="sm" variant="outline" className="h-7 text-xs text-red-600 border-red-200" disabled={updatingOrgStatus}
                              onClick={() => updateOrgStatus(selectedUser.org_id!, 'suspended')}>
                              Suspend Org
                            </Button>
                          )}
                          <Badge className={`text-xs ${selectedUser.org_access_status === 'verified' ? 'bg-green-100 text-green-800' : selectedUser.org_access_status === 'suspended' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'}`}>
                            {selectedUser.org_access_status}
                          </Badge>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
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

              {/* Reference/Recommendation Status (partners only) */}
              {selectedUser.persona === 'partner' && (
                <div className="space-y-3">
                  <h4 className="font-semibold text-sm text-gray-700">Recommendation / Reference Status ({REQUIRED_REFERENCES} required)</h4>
                  {(() => {
                    const ref = referenceStatusMap[selectedUser.user_id];

                    // Bypass active
                    if (ref?.bypass) {
                      return (
                        <div className="bg-violet-50 border border-violet-200 rounded-lg p-4">
                          <div className="flex items-start gap-3">
                            <ShieldCheck className="h-5 w-5 text-violet-600 mt-0.5 shrink-0" />
                            <div className="flex-1">
                              <p className="font-medium text-violet-800">Reference requirement bypassed</p>
                              <p className="text-sm text-violet-600 mt-1">
                                Reason: {ref.bypassReason || 'No reason provided'}
                              </p>
                              {ref.total > 0 && (
                                <div className="mt-2 text-sm flex gap-4">
                                  <span className="text-gray-600">References: {ref.confirmed}/{REQUIRED_REFERENCES} confirmed</span>
                                  {ref.pending > 0 && <span className="text-amber-700">{ref.pending} pending</span>}
                                </div>
                              )}
                              <Button
                                size="sm"
                                variant="outline"
                                className="mt-3 text-xs border-violet-300 text-violet-700 hover:bg-violet-100"
                                onClick={() => revokeBypass(selectedUser.user_id)}
                              >
                                Revoke bypass
                              </Button>
                            </div>
                          </div>
                        </div>
                      );
                    }

                    if (!ref || ref.total === 0) {
                      return (
                        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3">
                          <FileMinus className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
                          <div>
                            <p className="font-medium text-amber-800">No recommendation submitted</p>
                            <p className="text-sm text-amber-600 mt-1">
                              This partner has not yet submitted a client reference. {REQUIRED_REFERENCES} confirmed recommendations from marinas are required before approval.
                            </p>
                            <p className="text-xs text-gray-500 mt-2">
                              If this partner has not worked with marinas yet, you can bypass this requirement.
                            </p>
                          </div>
                        </div>
                      );
                    }
                    const meetsRequirement = ref.confirmed >= REQUIRED_REFERENCES;
                    return (
                      <div className={`rounded-lg p-4 border ${meetsRequirement ? 'bg-green-50 border-green-200' : ref.confirmed > 0 || ref.pending > 0 ? 'bg-blue-50 border-blue-200' : 'bg-red-50 border-red-200'}`}>
                        <div className="flex items-start gap-3">
                          {meetsRequirement ? (
                            <FileCheck className="h-5 w-5 text-green-600 mt-0.5 shrink-0" />
                          ) : ref.confirmed > 0 || ref.pending > 0 ? (
                            <Clock className="h-5 w-5 text-blue-500 mt-0.5 shrink-0" />
                          ) : (
                            <FileX className="h-5 w-5 text-red-500 mt-0.5 shrink-0" />
                          )}
                          <div className="flex-1">
                            <p className={`font-medium ${meetsRequirement ? 'text-green-800' : ref.confirmed > 0 || ref.pending > 0 ? 'text-blue-800' : 'text-red-800'}`}>
                              {meetsRequirement
                                ? `${ref.confirmed} references confirmed ✓`
                                : ref.confirmed > 0
                                  ? `${ref.confirmed}/${REQUIRED_REFERENCES} confirmed — needs ${REQUIRED_REFERENCES - ref.confirmed} more`
                                  : ref.pending > 0 ? 'References pending marina confirmation' : 'All references rejected'}
                            </p>
                            <div className="mt-2 space-y-1 text-sm">
                              <div className="flex gap-4">
                                <span className="text-gray-600">Total requests: <strong>{ref.total}</strong></span>
                                <span className="text-green-700">Confirmed: <strong>{ref.confirmed}</strong></span>
                                <span className="text-amber-700">Pending: <strong>{ref.pending}</strong></span>
                                {ref.rejected > 0 && <span className="text-red-700">Rejected: <strong>{ref.rejected}</strong></span>}
                              </div>
                              {ref.clientName && <p className="text-gray-500">Latest client: {ref.clientName}</p>}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Pending bypass request from partner */}
                  {(() => {
                    const ref = referenceStatusMap[selectedUser.user_id];
                    if (!ref?.bypassRequestId || ref.bypass) return null;
                    if (ref.bypassRequestStatus === 'pending') {
                      return (
                        <div className="mt-3 bg-violet-50 border border-violet-200 rounded-lg p-4">
                          <div className="flex items-start gap-3">
                            <ShieldCheck className="h-5 w-5 text-violet-600 mt-0.5 shrink-0" />
                            <div className="flex-1">
                              <p className="font-medium text-violet-800">Partner requested bypass</p>
                              <p className="text-sm text-violet-700 mt-1">
                                <strong>Reason:</strong> {ref.bypassRequestReason}
                              </p>
                              {ref.bypassRequestBackground && (
                                <p className="text-sm text-violet-600 mt-1">
                                  <strong>Background:</strong> {ref.bypassRequestBackground}
                                </p>
                              )}
                              <div className="flex gap-2 mt-3">
                                <Button
                                  size="sm"
                                  className="bg-violet-600 hover:bg-violet-700 text-xs"
                                  onClick={() => {
                                    setBypassDialogUserId(selectedUser.user_id);
                                    setBypassReason(ref.bypassRequestReason || '');
                                  }}
                                >
                                  <ShieldCheck className="h-3.5 w-3.5 mr-1" />
                                  Approve Bypass
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-xs border-red-300 text-red-600 hover:bg-red-50"
                                  onClick={() => rejectBypassRequest(selectedUser.user_id)}
                                >
                                  Decline
                                </Button>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    }
                    if (ref.bypassRequestStatus === 'rejected') {
                      return (
                        <p className="mt-2 text-xs text-gray-500 italic">Previous bypass request was declined.</p>
                      );
                    }
                    return null;
                  })()}
                </div>
              )}

              {/* Actions */}
              <div className="flex flex-col gap-2 pt-2 border-t">
                {/* Partner reference gate warning + bypass option */}
                {selectedUser.access_status !== 'verified' && selectedUser.persona === 'partner' && !canApprovePartner(selectedUser.user_id, selectedUser.persona) && (
                  <div className="bg-amber-50 rounded px-3 py-2 space-y-2">
                    <p className="text-xs text-amber-700">
                      ⚠ Cannot approve: partner needs {REQUIRED_REFERENCES} confirmed marina recommendations ({referenceStatusMap[selectedUser.user_id]?.confirmed || 0}/{REQUIRED_REFERENCES}).
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs border-violet-300 text-violet-700 hover:bg-violet-50"
                      onClick={() => { setBypassDialogUserId(selectedUser.user_id); setBypassReason(''); }}
                    >
                      <ShieldCheck className="h-3.5 w-3.5 mr-1" />
                      No marina clients — bypass requirement
                    </Button>
                  </div>
                )}
                <div className="flex gap-2 justify-end">
                  {selectedUser.access_status !== 'verified' && (
                    <Button
                      size="sm"
                      disabled={!canApprovePartner(selectedUser.user_id, selectedUser.persona)}
                      title={!canApprovePartner(selectedUser.user_id, selectedUser.persona) ? `Partner needs ${REQUIRED_REFERENCES} confirmed marina recommendations` : undefined}
                      onClick={() => { approveUser(selectedUser.user_id); setSelectedUser(null); }}
                    >
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
