import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft, Save, Loader2, User, Building2, Shield, ShieldCheck,
  ExternalLink, UserCheck, FileCheck, FileMinus, FileX, Clock,
  ArrowUpCircle, RefreshCw, ToggleLeft,
} from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { TIER_LABELS, TIER_COLORS, OrgTier } from '@/types/database';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { sendNotification } from '@/lib/notifications';
import type { AdminProfile } from './types';

const REQUIRED_REFERENCES = 2;

interface ReferenceItem {
  id: string;
  status: string;
  client_legal_name: string;
  confirmed_at: string | null;
  created_at: string;
}

interface ReferenceStatus {
  total: number;
  confirmed: number;
  pending: number;
  rejected: number;
  latestStatus: string;
  clientName: string | null;
  bypass: boolean;
  bypassReason: string | null;
  items: ReferenceItem[];
}

export function AdminUserDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [user, setUser] = useState<AdminProfile | null>(null);
  const [orgData, setOrgData] = useState<Record<string, unknown> | null>(null);
  const [sectors, setSectors] = useState<string[]>([]);
  const [refStatus, setRefStatus] = useState<ReferenceStatus | null>(null);

  // Editable fields
  const [persona, setPersona] = useState('');
  const [accessStatus, setAccessStatus] = useState('');
  const [adminNotes, setAdminNotes] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectForm, setShowRejectForm] = useState(false);

  // Tier management
  const [updatingTier, setUpdatingTier] = useState(false);
  const [editingSeats, setEditingSeats] = useState<number | null>(null);

  // Feature entitlements
  const FEATURE_DEFINITIONS: { key: string; label: string; description: string; personas?: string[] }[] = [
    { key: 'marketplace_access', label: 'Marketplace Access', description: 'Browse marketplace & express interest' },
    { key: 'submit_project', label: 'Submit Projects', description: 'Submit marina projects', personas: ['marina'] },
    { key: 'submit_rfp', label: 'Submit RFPs', description: 'Create Requests for Proposals', personas: ['marina'] },
    { key: 'submit_consultation', label: 'Submit Consultations', description: 'Create consultation requests', personas: ['marina'] },
    { key: 'request_webinar', label: 'Propose Webinars', description: 'Propose and host webinars' },
    { key: 'b2b_matching', label: 'B2B Matching', description: 'Send & receive partner connection requests' },
    { key: 'analytics_dashboard', label: 'Analytics Dashboard', description: 'View profile analytics & insights' },
    { key: 'team_management', label: 'Team Management', description: 'Invite and manage team members' },
    { key: 'document_upload', label: 'Document Upload', description: 'Upload organization documents' },
    { key: 'expo_request', label: 'Expo Requests', description: 'Request exhibition booth spaces' },
    { key: 'sponsorship_upgrade', label: 'Sponsorship Upgrade', description: 'Request tier upgrades' },
  ];
  const [featureStates, setFeatureStates] = useState<Record<string, boolean>>({});
  const [featureLoading, setFeatureLoading] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (id) loadUser(id);
  }, [id]);

  const loadUser = async (userId: string) => {
    setLoading(true);

    // Load profile
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('user_id, first_name, last_name, email, persona, access_status, onboarding_status, rejection_reason, created_at')
      .eq('user_id', userId)
      .single();

    if (error || !profile) {
      toast({ title: 'User not found', variant: 'destructive' });
      navigate('/admin/users');
      return;
    }

    // Load org membership
    const { data: membership } = await supabase
      .from('organization_members')
      .select('user_id, organization_id, organizations(id, name, tier, organization_type, access_status, max_seats, website, country, city, description, logo_url)')
      .eq('user_id', userId)
      .maybeSingle();

    const org = (membership?.organizations as unknown as Record<string, unknown>) || null;
    const merged: AdminProfile = {
      ...(profile as unknown as AdminProfile),
      org_name: (org?.name as string) || null,
      org_id: (org?.id as string) || null,
      org_tier: (org?.tier as string) || null,
      org_type: (org?.organization_type as string) || null,
      org_access_status: (org?.access_status as string) || null,
      org_max_seats: (org?.max_seats as number) || null,
      org_website: (org?.website as string) || null,
      org_country: (org?.country as string) || null,
      org_city: (org?.city as string) || null,
      org_description: (org?.description as string) || null,
      org_logo_url: (org?.logo_url as string) || null,
    };

    setUser(merged);
    setPersona(merged.persona);
    setAccessStatus(merged.access_status);
    setRejectReason('');
    setShowRejectForm(false);

    // Load org detail + sectors in parallel
    if (org?.id) {
      const orgId = org.id as string;
      const [{ data: orgDetail }, { data: sectorData }] = await Promise.all([
        supabase.from('organizations').select('*').eq('id', orgId).maybeSingle(),
        supabase
          .from(merged.persona === 'marina' || merged.persona === 'media_partner' ? 'organization_interest_sectors' : 'organization_service_sectors')
          .select('sectors(label)')
          .eq('organization_id', orgId),
      ]);

      // For marina, also load marina details
      if (merged.persona === 'marina') {
        const { data: marinaDetails } = await supabase
          .from('organization_marina_details')
          .select('*')
          .eq('organization_id', orgId)
          .maybeSingle();
        setOrgData({ ...orgDetail, marina_details: marinaDetails } as Record<string, unknown>);
      } else {
        setOrgData(orgDetail as Record<string, unknown> | null);
      }

      setSectors((sectorData || []).map((s: Record<string, unknown>) => ((s.sectors as Record<string, unknown> | null)?.label as string) || '').filter(Boolean));

      // Load reference status for partners
      if (merged.persona === 'partner') {
        await loadReferenceStatus(orgId);
      }

      // Load feature entitlements
      const { data: entData } = await supabase
        .from('entitlements')
        .select('feature_key, enabled')
        .eq('organization_id', orgId);
      const fStates: Record<string, boolean> = {};
      for (const e of entData || []) fStates[e.feature_key] = e.enabled;
      setFeatureStates(fStates);
    } else {
      setOrgData(null);
      setSectors([]);
      setRefStatus(null);
      setFeatureStates({});
    }

    setLoading(false);
  };

  const loadReferenceStatus = async (orgId: string) => {
    const [{ data: refData }, { data: bypassData }] = await Promise.all([
      supabase
        .from('reference_requests')
        .select('id, partner_organization_id, status, client_legal_name, confirmed_at, created_at')
        .eq('partner_organization_id', orgId)
        .order('created_at', { ascending: false }),
      supabase
        .from('organizations')
        .select('id, reference_bypass, reference_bypass_reason')
        .eq('id', orgId)
        .single(),
    ]);

    const refs = refData || [];
    const bp = bypassData || { reference_bypass: false, reference_bypass_reason: null };
    const confirmed = refs.filter((r: { status: string }) => r.status === 'confirmed').length;
    const pending = refs.filter((r: { status: string }) => r.status === 'pending' || r.status === 'sent').length;
    const rejected = refs.filter((r: { status: string }) => r.status === 'rejected').length;
    const latest = refs[0] as { status: string; client_legal_name: string } | undefined;

    setRefStatus({
      total: refs.length,
      confirmed,
      pending,
      rejected,
      latestStatus: latest?.status || 'none',
      clientName: latest?.client_legal_name || null,
      bypass: bp.reference_bypass,
      bypassReason: bp.reference_bypass_reason,
      items: refs as ReferenceItem[],
    });
  };

  const canApprovePartner = (): boolean => {
    if (persona !== 'partner') return true;
    if (!refStatus) return false;
    if (refStatus.bypass) return true;
    return refStatus.confirmed >= REQUIRED_REFERENCES;
  };

  const handleSavePersona = async () => {
    if (!user || persona === user.persona) return;
    setSaving(true);
    const { error } = await supabase.from('profiles').update({ persona }).eq('user_id', user.user_id);
    setSaving(false);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: `Role updated to ${persona}` });
      loadUser(user.user_id);
    }
  };

  const handleApprove = async () => {
    if (!user) return;
    if (!canApprovePartner()) {
      toast({ title: 'Cannot approve partner', description: `This partner needs ${REQUIRED_REFERENCES} confirmed marina recommendations (or admin bypass) before approval.`, variant: 'destructive' });
      return;
    }
    setSaving(true);

    const { error } = await supabase.from('profiles').update({ access_status: 'verified', onboarding_status: 'completed', rejection_reason: null }).eq('user_id', user.user_id);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); setSaving(false); return; }

    // Also update org
    const { data: membership } = await supabase.from('organization_members').select('organization_id').eq('user_id', user.user_id).maybeSingle();
    if (membership?.organization_id) {
      await supabase.from('organizations').update({ access_status: 'verified', onboarding_status: 'completed' }).eq('id', membership.organization_id);
    }

    sendNotification({
      type: 'user_account_approved',
      userId: user.user_id,
      data: {
        first_name: user.first_name || '',
        org_name: user.org_name || '',
      },
    });
    toast({ title: 'User approved' });
    setSaving(false);
    loadUser(user.user_id);
  };

  const handleReject = async () => {
    if (!user || !rejectReason.trim()) {
      toast({ title: 'Rejection reason is required', variant: 'destructive' });
      return;
    }
    setSaving(true);
    const { error } = await supabase.from('profiles').update({ access_status: 'rejected', onboarding_status: 'draft', rejection_reason: rejectReason.trim() }).eq('user_id', user.user_id);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); setSaving(false); return; }

    const { data: membership } = await supabase.from('organization_members').select('organization_id').eq('user_id', user.user_id).maybeSingle();
    if (membership?.organization_id) {
      await supabase.from('organizations').update({ access_status: 'rejected', rejection_reason: rejectReason.trim() }).eq('id', membership.organization_id);
    }

    sendNotification({
      type: 'user_account_rejected',
      userId: user.user_id,
      data: {
        first_name: user.first_name || '',
        reason: rejectReason.trim(),
      },
    });
    toast({ title: 'User rejected' });
    setSaving(false);
    setShowRejectForm(false);
    loadUser(user.user_id);
  };

  const handleSuspend = async () => {
    if (!user) return;
    setSaving(true);
    await supabase.from('profiles').update({ access_status: 'suspended' }).eq('user_id', user.user_id);
    toast({ title: 'User suspended' });
    setSaving(false);
    loadUser(user.user_id);
  };

  // handleSetPaymentPending removed — no payment flow

  const handleSaveAdminNotes = async () => {
    if (!user?.org_id) return;
    setSaving(true);
    await supabase.from('organizations').update({ admin_notes: adminNotes }).eq('id', user.org_id);
    toast({ title: 'Admin notes saved' });
    setSaving(false);
  };

  const updateOrgTier = async (newTier: string) => {
    if (!user?.org_id) return;
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
      .eq('id', user.org_id);
    setUpdatingTier(false);
    if (error) {
      toast({ title: 'Failed to update tier', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: `Tier updated to ${TIER_LABELS[newTier as OrgTier] || newTier}` });
      loadUser(user.user_id);
    }
  };

  const saveOrgSeats = async (seats: number) => {
    if (!user?.org_id) return;
    const { error } = await supabase.from('organizations').update({ max_seats: seats }).eq('id', user.org_id);
    if (error) {
      toast({ title: 'Failed', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: `Seats updated to ${seats}` });
      loadUser(user.user_id);
    }
    setEditingSeats(null);
  };

  const handleBypass = async () => {
    if (!user?.org_id) return;
    const reason = prompt('Enter bypass justification:');
    if (!reason?.trim()) return;
    const adminUserId = (await supabase.auth.getUser()).data.user?.id || null;
    await supabase.from('organizations').update({
      reference_bypass: true,
      reference_bypass_reason: reason.trim(),
      reference_bypass_at: new Date().toISOString(),
      reference_bypass_by: adminUserId,
    }).eq('id', user.org_id);
    sendNotification({ type: 'bypass_approved', userId: user.user_id, data: { admin_notes: reason.trim() } });
    toast({ title: 'Reference requirement bypassed' });
    loadUser(user.user_id);
  };

  const revokeBypass = async () => {
    if (!user?.org_id) return;
    await supabase.from('organizations').update({
      reference_bypass: false,
      reference_bypass_reason: null,
      reference_bypass_at: null,
      reference_bypass_by: null,
    }).eq('id', user.org_id);
    toast({ title: 'Bypass revoked' });
    loadUser(user.user_id);
  };

  const toggleFeature = async (featureKey: string, enabled: boolean) => {
    if (!user?.org_id) return;
    setFeatureLoading(prev => ({ ...prev, [featureKey]: true }));

    // Upsert entitlement row
    const { error } = await supabase
      .from('entitlements')
      .upsert(
        { organization_id: user.org_id, feature_key: featureKey, enabled, updated_at: new Date().toISOString() },
        { onConflict: 'organization_id,feature_key' }
      );

    if (error) {
      toast({ title: 'Failed to update feature', description: error.message, variant: 'destructive' });
    } else {
      setFeatureStates(prev => ({ ...prev, [featureKey]: enabled }));
      toast({ title: `${featureKey.replace(/_/g, ' ')} ${enabled ? 'enabled' : 'disabled'}` });
    }
    setFeatureLoading(prev => ({ ...prev, [featureKey]: false }));
  };

  const enableAllFeatures = async () => {
    if (!user?.org_id) return;
    // Enable every defined feature, including cross-persona ones
    const keys = FEATURE_DEFINITIONS.map(f => f.key);
    for (const key of keys) {
      await supabase.from('entitlements').upsert(
        { organization_id: user.org_id, feature_key: key, enabled: true, updated_at: new Date().toISOString() },
        { onConflict: 'organization_id,feature_key' }
      );
    }
    const newStates: Record<string, boolean> = {};
    for (const key of keys) newStates[key] = true;
    setFeatureStates(prev => ({ ...prev, ...newStates }));
    toast({ title: 'All features enabled' });
  };

  const getPersonaBadge = (p: string) => {
    switch (p) {
      case 'admin': return <Badge variant="destructive">Admin</Badge>;
      case 'moderator': return <Badge variant="destructive">Moderator</Badge>;
      case 'partner': return <Badge variant="success">Partner</Badge>;
      case 'marina': return <Badge variant="info">Marina</Badge>;
      case 'media_partner': return <Badge variant="secondary">Media</Badge>;
      default: return <Badge variant="secondary">{p}</Badge>;
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

  const getTierBadge = (tier: string | null) => {
    if (!tier) return <span className="text-gray-300 text-xs">--</span>;
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

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );

  if (!user) return null;

  const getUserName = () => {
    if (user.first_name || user.last_name) return `${user.first_name || ''} ${user.last_name || ''}`.trim();
    return user.email?.split('@')[0] || 'Unknown';
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate('/admin/users')} className="gap-1.5">
            <ArrowLeft className="h-4 w-4" /> Users
          </Button>
          <Separator orientation="vertical" className="h-6" />
          <h1 className="text-xl font-bold text-gray-900">{getUserName()}</h1>
          {getPersonaBadge(user.persona)}
          {getStatusBadge(user.access_status)}
        </div>
      </div>

      {/* Profile Details */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold text-gray-700 flex items-center gap-2">
            <User className="h-4 w-4 text-blue-500" /> User Profile
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="bg-gray-50 rounded-lg p-4">
            <DetailRow label="First Name" value={user.first_name} />
            <DetailRow label="Last Name" value={user.last_name} />
            <DetailRow label="Email" value={user.email} />
            <DetailRow label="Persona" value={user.persona} />
            <DetailRow label="Access Status" value={user.access_status} />
            <DetailRow label="Onboarding" value={user.onboarding_status} />
            <DetailRow label="Created" value={new Date(user.created_at).toLocaleString()} />
            {user.rejection_reason && (
              <DetailRow label="Rejection Reason" value={<span className="text-red-600">{user.rejection_reason}</span>} />
            )}
          </div>
        </CardContent>
      </Card>

      {/* Organization Info */}
      {orgData && (
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-bold text-gray-700 flex items-center gap-2">
              <Building2 className="h-4 w-4 text-emerald-500" /> Organization
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="bg-blue-50 rounded-lg p-4">
              <DetailRow label="Name" value={orgData.name as string} />
              <DetailRow label="Type" value={orgData.organization_type as string} />
              <DetailRow label="Tier" value={getTierBadge(user.org_tier)} />
              <DetailRow label="Country" value={orgData.country as string} />
              <DetailRow label="City" value={orgData.city as string} />
              <DetailRow label="Website" value={orgData.website ? <a href={orgData.website as string} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline flex items-center gap-1">{orgData.website as string} <ExternalLink className="h-3 w-3" /></a> : null} />
              <DetailRow label="Status" value={orgData.access_status as string} />
              {typeof orgData.description === 'string' && orgData.description && (
                <DetailRow label="Description" value={<span className="line-clamp-3">{orgData.description}</span>} />
              )}
              {sectors.length > 0 && (
                <DetailRow label="Sectors" value={
                  <div className="flex flex-wrap gap-1 justify-end">
                    {sectors.map(s => <Badge key={s} variant="outline" className="text-xs">{s}</Badge>)}
                  </div>
                } />
              )}
              {user.org_id && (
                <div className="mt-2">
                  <Link to={`/organizations/${user.org_id}`} target="_blank" className="text-xs text-primary hover:underline flex items-center gap-1">
                    <ExternalLink className="h-3 w-3" /> View public page
                  </Link>
                </div>
              )}
            </div>

            {/* Persona-specific org details */}
            {user.persona === 'marina' && !!orgData.marina_details && (
              <div className="mt-4 bg-gray-50 rounded-lg p-4">
                <h4 className="text-sm font-semibold text-gray-700 mb-2">Marina Details</h4>
                <DetailRow label="Berths" value={String((orgData.marina_details as Record<string, unknown>)?.berths_count ?? '')} />
                <DetailRow label="Marina Type" value={String((orgData.marina_details as Record<string, unknown>)?.marina_type ?? '')} />
                <DetailRow label="Superyacht Berths" value={String((orgData.marina_details as Record<string, unknown>)?.superyacht_berths ?? '')} />
                <DetailRow label="Longest Berth (m)" value={String((orgData.marina_details as Record<string, unknown>)?.longest_berth_meters ?? '')} />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Tier & Membership Management */}
      {user.org_id && (
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-bold text-gray-700 flex items-center gap-2">
              <ArrowUpCircle className="h-4 w-4 text-violet-500" /> Membership & Tier Management
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <Label className="font-semibold text-sm">Membership Tier</Label>
              <div className="flex items-center gap-2">
                <Select
                  value={user.org_tier || 'member'}
                  onValueChange={updateOrgTier}
                  disabled={updatingTier}
                >
                  <SelectTrigger className="w-full sm:w-48 h-8 text-xs"><SelectValue /></SelectTrigger>
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
                  value={editingSeats ?? user.org_max_seats ?? 1}
                  onChange={(e) => setEditingSeats(parseInt(e.target.value) || 1)}
                />
                {editingSeats !== null && editingSeats !== user.org_max_seats && (
                  <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => saveOrgSeats(editingSeats)}>
                    Save
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Feature Access Toggles */}
      {user.org_id && (
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-bold text-gray-700 flex items-center gap-2">
                <ToggleLeft className="h-4 w-4 text-primary" /> Feature Access
              </CardTitle>
              <Button
                variant="outline"
                size="sm"
                className="text-xs h-7"
                onClick={enableAllFeatures}
              >
                Enable All
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-gray-100">
              {FEATURE_DEFINITIONS.map(feature => {
                const isNative = !feature.personas || feature.personas.includes(user.persona);
                return (
                  <div key={feature.key} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                    <div className="flex-1 min-w-0 pr-4">
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="text-sm font-medium text-gray-900">{feature.label}</div>
                        {!isNative && (
                          <Badge variant="outline" className="text-[10px] font-normal border-amber-300 text-amber-700 bg-amber-50">
                            Cross-persona
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-gray-500">
                        {feature.description}
                        {!isNative && feature.personas && (
                          <span className="ml-1 text-amber-700">
                            — normally {feature.personas.join(', ')} only. Enabling grants manual access.
                          </span>
                        )}
                      </div>
                    </div>
                    <Switch
                      checked={featureStates[feature.key] ?? false}
                      onCheckedChange={(checked) => toggleFeature(feature.key, checked)}
                      disabled={featureLoading[feature.key]}
                    />
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-gray-400 mt-4 pt-3 border-t border-gray-100">
              All features are manageable. Enabling a "cross-persona" feature grants this user manual access to something normally restricted to another account type.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Reference Status (partners only) */}
      {user.persona === 'partner' && (
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-bold text-gray-700 flex items-center gap-2">
              <Shield className="h-4 w-4 text-amber-500" /> Reference Status ({REQUIRED_REFERENCES} required)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {refStatus ? (
              <div className="space-y-3">
                {refStatus.bypass ? (
                  <div className="bg-violet-50 border border-violet-200 rounded-lg p-4 flex items-start gap-3">
                    <ShieldCheck className="h-5 w-5 text-violet-600 mt-0.5 shrink-0" />
                    <div className="flex-1">
                      <p className="font-medium text-violet-800">Reference requirement bypassed</p>
                      <p className="text-sm text-violet-600 mt-1">Reason: {refStatus.bypassReason || 'No reason provided'}</p>
                      {refStatus.total > 0 && (
                        <p className="text-sm text-gray-600 mt-1">{refStatus.confirmed}/{REQUIRED_REFERENCES} confirmed</p>
                      )}
                      <Button size="sm" variant="outline" className="mt-2 text-xs border-violet-300 text-violet-700 hover:bg-violet-100" onClick={revokeBypass}>
                        Revoke bypass
                      </Button>
                    </div>
                  </div>
                ) : refStatus.confirmed >= REQUIRED_REFERENCES ? (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-start gap-3">
                    <FileCheck className="h-5 w-5 text-green-600 mt-0.5 shrink-0" />
                    <div>
                      <p className="font-medium text-green-800">{refStatus.confirmed} references confirmed</p>
                      <div className="mt-1 text-sm flex gap-4">
                        <span className="text-gray-600">Total: {refStatus.total}</span>
                        <span className="text-green-700">Confirmed: {refStatus.confirmed}</span>
                        {refStatus.pending > 0 && <span className="text-amber-700">Pending: {refStatus.pending}</span>}
                      </div>
                    </div>
                  </div>
                ) : refStatus.total === 0 ? (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3">
                    <FileMinus className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
                    <div>
                      <p className="font-medium text-amber-800">No recommendation submitted</p>
                      <p className="text-sm text-amber-600 mt-1">This partner has not yet submitted a client reference.</p>
                    </div>
                  </div>
                ) : (
                  <div className={`rounded-lg p-4 border ${refStatus.confirmed > 0 || refStatus.pending > 0 ? 'bg-blue-50 border-blue-200' : 'bg-red-50 border-red-200'}`}>
                    <div className="flex items-start gap-3">
                      {refStatus.pending > 0 || refStatus.confirmed > 0 ? (
                        <Clock className="h-5 w-5 text-blue-500 mt-0.5 shrink-0" />
                      ) : (
                        <FileX className="h-5 w-5 text-red-500 mt-0.5 shrink-0" />
                      )}
                      <div>
                        <p className={`font-medium ${refStatus.confirmed > 0 || refStatus.pending > 0 ? 'text-blue-800' : 'text-red-800'}`}>
                          {refStatus.confirmed > 0
                            ? `${refStatus.confirmed}/${REQUIRED_REFERENCES} confirmed`
                            : refStatus.pending > 0 ? 'References pending confirmation' : 'All references rejected'}
                        </p>
                        <div className="mt-1 text-sm flex gap-4">
                          <span className="text-gray-600">Total: {refStatus.total}</span>
                          <span className="text-green-700">Confirmed: {refStatus.confirmed}</span>
                          <span className="text-amber-700">Pending: {refStatus.pending}</span>
                          {refStatus.rejected > 0 && <span className="text-red-700">Rejected: {refStatus.rejected}</span>}
                        </div>
                        {refStatus.clientName && <p className="text-sm text-gray-500 mt-1">Latest client: {refStatus.clientName}</p>}
                      </div>
                    </div>
                  </div>
                )}

                {/* Bypass button if not already bypassed */}
                {!refStatus.bypass && refStatus.confirmed < REQUIRED_REFERENCES && (
                  <Button size="sm" variant="outline" className="text-xs border-violet-300 text-violet-700 hover:bg-violet-50" onClick={handleBypass}>
                    <ShieldCheck className="h-3.5 w-3.5 mr-1" /> Bypass reference requirement
                  </Button>
                )}

                {/* Per-reference breakdown */}
                {refStatus.items.length > 0 && (
                  <div className="mt-4 border rounded-lg divide-y">
                    <div className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50">
                      Individual references ({refStatus.items.length})
                    </div>
                    {refStatus.items.map((ref) => {
                      const statusColor =
                        ref.status === 'confirmed' ? 'text-green-700 bg-green-50 border-green-200'
                        : ref.status === 'rejected' ? 'text-red-700 bg-red-50 border-red-200'
                        : 'text-amber-700 bg-amber-50 border-amber-200';
                      return (
                        <div key={ref.id} className="px-3 py-2 flex items-center justify-between gap-3 text-sm">
                          <div className="min-w-0 flex-1">
                            <div className="font-medium text-gray-800 truncate">{ref.client_legal_name || 'Unnamed client'}</div>
                            <div className="text-xs text-gray-500">
                              Submitted {new Date(ref.created_at).toLocaleDateString()}
                              {ref.confirmed_at && ` · Confirmed ${new Date(ref.confirmed_at).toLocaleDateString()}`}
                            </div>
                          </div>
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${statusColor} capitalize`}>
                            {ref.status}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-400">No reference data available</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Editable Fields */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold text-gray-700 flex items-center gap-2">
            <Save className="h-4 w-4 text-gray-500" /> Edit User
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Persona / Role</Label>
              <div className="flex items-center gap-2">
                <Select value={persona} onValueChange={setPersona}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="marina">Marina</SelectItem>
                    <SelectItem value="partner">Partner</SelectItem>
                    <SelectItem value="media_partner">Media Partner</SelectItem>
                    <SelectItem value="moderator">Moderator</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="individual">Individual</SelectItem>
                  </SelectContent>
                </Select>
                {persona !== user.persona && (
                  <Button size="sm" onClick={handleSavePersona} disabled={saving}>
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
                  </Button>
                )}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Access Status</Label>
              <div className="text-sm text-gray-700">{getStatusBadge(user.access_status)}</div>
              <p className="text-xs text-gray-400">Use action buttons below to change status</p>
            </div>
          </div>

          {user.org_id && (
            <div className="space-y-2">
              <Label>Admin Notes</Label>
              <Textarea value={adminNotes} onChange={e => setAdminNotes(e.target.value)} rows={3} placeholder="Internal notes about this user or organization..." />
              <Button size="sm" variant="outline" onClick={handleSaveAdminNotes} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
                Save Notes
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Actions */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold text-gray-700 flex items-center gap-2">
            <UserCheck className="h-4 w-4 text-green-500" /> Actions
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Partner gate warning */}
          {persona === 'partner' && !canApprovePartner() && user.access_status !== 'verified' && (
            <div className="bg-amber-50 rounded-lg px-4 py-3 text-sm text-amber-700">
              Cannot approve: partner needs {REQUIRED_REFERENCES} confirmed marina recommendations ({refStatus?.confirmed || 0}/{REQUIRED_REFERENCES}).
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {user.access_status !== 'verified' && (
              <Button
                onClick={handleApprove}
                disabled={saving || !canApprovePartner()}
                className="gap-1.5"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserCheck className="h-4 w-4" />}
                Approve
              </Button>
            )}
            {user.access_status !== 'rejected' && !showRejectForm && (
              <Button variant="destructive" onClick={() => setShowRejectForm(true)} className="gap-1.5">
                Reject
              </Button>
            )}
            {user.access_status !== 'suspended' && (
              <Button variant="outline" onClick={handleSuspend} disabled={saving} className="text-red-600 hover:bg-red-50 gap-1.5">
                Suspend
              </Button>
            )}
            {/* Payment pending button removed — member tier is free */}
          </div>

          {/* Reject form */}
          {showRejectForm && (
            <div className="border border-red-200 rounded-lg p-4 bg-red-50 space-y-3">
              <Label className="text-red-800">Rejection Reason *</Label>
              <Textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} rows={3} placeholder="Explain why this user is being rejected..." />
              <div className="flex gap-2">
                <Button variant="destructive" onClick={handleReject} disabled={saving || !rejectReason.trim()}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                  Confirm Rejection
                </Button>
                <Button variant="outline" onClick={() => setShowRejectForm(false)}>Cancel</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
