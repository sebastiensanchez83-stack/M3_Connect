import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Organization, OrganizationMember, OrganizationInvitation, OrganizationMarinaDetails, Sector,
  TIER_LABELS, OrgTier,
} from '@/types/database';
import {
  Building2, Users, Mail, Crown, UserPlus, Loader2, ExternalLink,
  Trash2, LogOut, ArrowRightLeft, Globe, MapPin, Shield, CheckCircle, Clock, XCircle,
  ArrowUpCircle,
} from 'lucide-react';
import { SponsorBadge } from '@/components/ui/SponsorBadge';
import { isSponsorTier } from '@/types/database';

const timelineOptions = [
  { value: 'immediate', label: 'Immediate' },
  { value: '0-3months', label: '0-3 months' },
  { value: '3-12months', label: '3-12 months' },
  { value: '1-3years', label: '1-3 years' },
  { value: '3+years', label: '3+ years' },
];

export function OrganizationTab() {
  const { t } = useTranslation();
  const { user, profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [org, setOrg] = useState<Organization | null>(null);
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [invitations, setInvitations] = useState<OrganizationInvitation[]>([]);
  const [isOwner, setIsOwner] = useState(false);

  // Create org form
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState({
    name: '', domain: '', website: '', description: '', country: '', city: '',
  });

  // Edit org
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editForm, setEditForm] = useState({
    name: '', website: '', description: '', country: '', city: '',
    // Partner / Media fields
    headquarters_country: '', audience_description: '',
    // Marina detail fields
    marina_type: '' as string, berths_count: '' as string, superyacht_berths: '' as string,
    longest_berth_meters: '' as string, fresh_water_available: false,
    certifications: [] as string[],
    has_yacht_club: false, yacht_club_members: '' as string,
    has_sailing_school: false, has_boat_yard: false,
    has_restaurants: false, restaurants_count: '' as string,
    has_concierge: false,
    marina_description: '', services_description: '',
  });

  // Invite dialog
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [inviteForm, setInviteForm] = useState({ email: '', firstName: '', lastName: '' });

  // Transfer dialog
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferTarget, setTransferTarget] = useState<OrganizationMember | null>(null);
  const [transferring, setTransferring] = useState(false);

  // Future plans (marina only)
  const [allSectors, setAllSectors] = useState<Sector[]>([]);
  const [interestSectors, setInterestSectors] = useState<string[]>([]);
  const [futurePlans, setFuturePlans] = useState<Record<string, string>>({});

  // Sponsorship upgrade dialog
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [upgradeSubmitting, setUpgradeSubmitting] = useState(false);
  const [upgradeTier, setUpgradeTier] = useState('innovation_partner');

  const handleUpgradeRequest = async () => {
    if (!org || !user) return;
    setUpgradeSubmitting(true);
    try {
      const { error } = await supabase.from('sponsorship_requests').insert({
        organization_id: org.id,
        requested_by: user.id,
        requested_tier: upgradeTier,
        current_tier: org.tier,
        amount_already_paid: org.tier === 'member' ? 500 : 0,
      });
      if (error) throw error;
      toast({ title: 'Sponsorship request submitted', description: 'M3 will contact you with details about the selected package.' });
      setUpgradeOpen(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      toast({ title: 'Error', description: message, variant: 'destructive' });
    } finally {
      setUpgradeSubmitting(false);
    }
  };

  const fetchOrg = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      // Get user's org membership
      const { data: membership } = await supabase
        .from('organization_members')
        .select('organization_id, role')
        .eq('user_id', user.id)
        .maybeSingle();

      if (!membership) {
        setOrg(null);
        setLoading(false);
        return;
      }

      // Fetch org
      const { data: orgData } = await supabase
        .from('organizations')
        .select('*')
        .eq('id', membership.organization_id)
        .single();

      if (orgData) {
        setOrg(orgData as Organization);
        setIsOwner(membership.role === 'owner');

        // Fetch marina details if marina org
        let md: OrganizationMarinaDetails | null = null;
        if (orgData.organization_type === 'marina') {
          const { data: marinaData } = await supabase
            .from('organization_marina_details')
            .select('*')
            .eq('organization_id', orgData.id)
            .maybeSingle();
          md = marinaData as OrganizationMarinaDetails | null;
        }

        setEditForm({
          name: orgData.name || '',
          website: orgData.website || '',
          description: orgData.description || '',
          country: orgData.country || '',
          city: orgData.city || '',
          headquarters_country: orgData.headquarters_country || '',
          audience_description: orgData.audience_description || '',
          marina_type: md?.marina_type || '',
          berths_count: md?.berths_count?.toString() || '',
          superyacht_berths: md?.superyacht_berths?.toString() || '',
          longest_berth_meters: md?.longest_berth_meters?.toString() || '',
          fresh_water_available: md?.fresh_water_available || false,
          certifications: md?.certifications || [],
          has_yacht_club: md?.has_yacht_club || false,
          yacht_club_members: md?.yacht_club_members?.toString() || '',
          has_sailing_school: md?.has_sailing_school || false,
          has_boat_yard: md?.has_boat_yard || false,
          has_restaurants: md?.has_restaurants || false,
          restaurants_count: md?.restaurants_count?.toString() || '',
          has_concierge: md?.has_concierge || false,
          marina_description: md?.marina_description || '',
          services_description: md?.services_description || '',
        });
      }

      // Fetch marina interest sectors + future plans
      if (orgData.organization_type === 'marina') {
        const [{ data: sectorsList }, { data: interestData }, { data: plansData }] = await Promise.all([
          supabase.from('sectors').select('*').eq('is_active', true).order('label'),
          supabase.from('organization_interest_sectors').select('sector_id').eq('organization_id', orgData.id),
          supabase.from('organization_future_plans').select('sector_id, timeline').eq('organization_id', orgData.id),
        ]);
        if (sectorsList) setAllSectors(sectorsList as Sector[]);
        if (interestData) setInterestSectors(interestData.map((d: any) => d.sector_id));
        if (plansData) {
          const plans: Record<string, string> = {};
          (plansData as any[]).forEach((p) => { plans[p.sector_id] = p.timeline; });
          setFuturePlans(plans);
        }
      }

      // Fetch members with profile info
      const { data: membersData } = await supabase
        .from('organization_members')
        .select('id, organization_id, user_id, role, joined_at, profiles(first_name, last_name, email, persona)')
        .eq('organization_id', membership.organization_id)
        .order('joined_at', { ascending: true });

      if (membersData) setMembers(membersData as unknown as OrganizationMember[]);

      // Fetch pending invitations (owner only)
      if (membership.role === 'owner') {
        const { data: invData } = await supabase
          .from('organization_invitations')
          .select('*')
          .eq('organization_id', membership.organization_id)
          .eq('status', 'pending')
          .order('created_at', { ascending: false });

        if (invData) setInvitations(invData as OrganizationInvitation[]);
      }
    } catch (err) {
      console.error('Error fetching org:', err);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => { fetchOrg(); }, [fetchOrg]);

  // Pre-fill create form from profile/metadata
  useEffect(() => {
    if (!user || !profile) return;
    const email = user.email || '';
    const domain = email.includes('@') ? email.split('@')[1]?.toLowerCase() : '';
    const companyName = user.user_metadata?.company_name || '';
    const companyWebsite = user.user_metadata?.company_website || '';

    const PUBLIC_DOMAINS = [
      'gmail.com','yahoo.com','yahoo.fr','hotmail.com','hotmail.fr',
      'outlook.com','outlook.fr','live.com','live.fr',
      'aol.com','icloud.com','me.com','mac.com',
      'mail.com','protonmail.com','proton.me','gmx.com','gmx.fr',
      'wanadoo.fr','orange.fr','free.fr','sfr.fr','laposte.net',
      'msn.com','ymail.com','fastmail.com','zoho.com',
    ];

    setCreateForm((prev) => ({
      ...prev,
      name: companyName || prev.name,
      domain: (!PUBLIC_DOMAINS.includes(domain) ? domain : '') || prev.domain,
      website: companyWebsite || prev.website,
    }));
  }, [user, profile]);

  const handleCreate = async () => {
    if (!createForm.name.trim()) return;
    setCreating(true);
    try {
      // Only pass organization_type if persona is a valid org type
      const validOrgTypes = ['marina', 'partner', 'media_partner'];
      const orgType = profile?.persona && validOrgTypes.includes(profile.persona) ? profile.persona : null;

      const { data, error } = await supabase.rpc('create_organization', {
        p_name: createForm.name.trim(),
        p_organization_type: orgType,
        p_primary_domain: createForm.domain.trim() || null,
        p_website: createForm.website.trim() || null,
        p_description: createForm.description.trim() || null,
        p_country: createForm.country.trim() || null,
        p_city: createForm.city.trim() || null,
      });

      if (error) throw error;
      toast({ title: t('org.created'), description: t('org.createdDesc') });
      setShowCreateForm(false);
      fetchOrg();
    } catch (err: any) {
      toast({ title: t('common.error'), description: err.message, variant: 'destructive' });
    }
    setCreating(false);
  };

  const handleSaveEdit = async () => {
    if (!org) return;
    setSaving(true);
    try {
      // Save organization base fields
      const orgPayload: Record<string, unknown> = {
        name: editForm.name.trim(),
        website: editForm.website.trim() || null,
        description: editForm.description.trim() || null,
        country: editForm.country.trim() || null,
        city: editForm.city.trim() || null,
        updated_at: new Date().toISOString(),
      };
      if (org.organization_type === 'partner') {
        orgPayload.headquarters_country = editForm.headquarters_country.trim() || null;
      }
      if (org.organization_type === 'media_partner') {
        orgPayload.audience_description = editForm.audience_description.trim() || null;
      }

      const { error } = await supabase
        .from('organizations')
        .update(orgPayload)
        .eq('id', org.id);
      if (error) throw error;

      // Save marina details if applicable
      if (org.organization_type === 'marina') {
        const marinaPayload = {
          organization_id: org.id,
          marina_type: editForm.marina_type || null,
          berths_count: editForm.berths_count ? parseInt(editForm.berths_count) : null,
          superyacht_berths: editForm.superyacht_berths ? parseInt(editForm.superyacht_berths) : null,
          longest_berth_meters: editForm.longest_berth_meters ? parseFloat(editForm.longest_berth_meters) : null,
          fresh_water_available: editForm.fresh_water_available,
          certifications: editForm.certifications.length > 0 ? editForm.certifications : null,
          has_yacht_club: editForm.has_yacht_club,
          yacht_club_members: editForm.yacht_club_members ? parseInt(editForm.yacht_club_members) : null,
          has_sailing_school: editForm.has_sailing_school,
          has_boat_yard: editForm.has_boat_yard,
          has_restaurants: editForm.has_restaurants,
          restaurants_count: editForm.restaurants_count ? parseInt(editForm.restaurants_count) : null,
          has_concierge: editForm.has_concierge,
          marina_description: editForm.marina_description.trim() || null,
          services_description: editForm.services_description.trim() || null,
          updated_at: new Date().toISOString(),
        };
        const { error: mdError } = await supabase
          .from('organization_marina_details')
          .upsert(marinaPayload, { onConflict: 'organization_id' });
        if (mdError) throw mdError;

        // Save interest sectors
        await supabase.from('organization_interest_sectors').delete().eq('organization_id', org.id);
        if (interestSectors.length > 0) {
          await supabase.from('organization_interest_sectors').insert(
            interestSectors.map(s => ({ organization_id: org.id, sector_id: s }))
          );
        }

        // Save future plans
        await supabase.from('organization_future_plans').delete().eq('organization_id', org.id);
        const planEntries = Object.entries(futurePlans).filter(([, tl]) => tl);
        if (planEntries.length > 0) {
          await supabase.from('organization_future_plans').insert(
            planEntries.map(([sectorId, timeline]) => ({ organization_id: org.id, sector_id: sectorId, timeline }))
          );
        }
      }

      toast({ title: t('org.saved') });
      setEditing(false);
      fetchOrg();
    } catch (err: any) {
      toast({ title: t('common.error'), description: err.message, variant: 'destructive' });
    }
    setSaving(false);
  };

  const handleInvite = async () => {
    if (!org || !inviteForm.email.trim()) return;

    // Capacity check — block invite if at max_seats
    const totalOccupied = members.length + invitations.length;
    if (org.max_seats && totalOccupied >= org.max_seats) {
      const tierLabel = TIER_LABELS[(org.tier || 'member') as OrgTier];
      toast({
        title: 'Team capacity reached',
        description: `Your ${tierLabel} plan includes ${org.max_seats} seat${org.max_seats > 1 ? 's' : ''}. Contact M3 to add additional seats.`,
        variant: 'destructive',
      });
      return;
    }

    // Domain check — skip for marina orgs (marinas use personal emails, invite-only)
    const inviteDomain = inviteForm.email.split('@')[1]?.toLowerCase();
    if (org.primary_domain && org.organization_type !== 'marina' && inviteDomain !== org.primary_domain) {
      toast({ title: t('common.error'), description: t('org.inviteDomainMismatch'), variant: 'destructive' });
      return;
    }
    setInviting(true);
    try {
      const { error } = await supabase
        .from('organization_invitations')
        .insert({
          organization_id: org.id,
          email: inviteForm.email.trim().toLowerCase(),
          normalized_domain: inviteDomain || null,
          invited_by_user_id: user!.id,
          first_name: inviteForm.firstName.trim() || null,
          last_name: inviteForm.lastName.trim() || null,
        });

      if (error) throw error;
      toast({ title: t('org.inviteSent'), description: t('org.inviteSentDesc', { email: inviteForm.email }) });
      setInviteOpen(false);
      setInviteForm({ email: '', firstName: '', lastName: '' });
      fetchOrg();
    } catch (err: any) {
      toast({ title: t('common.error'), description: err.message, variant: 'destructive' });
    }
    setInviting(false);
  };

  const handleCancelInvitation = async (invId: string) => {
    try {
      const { error } = await supabase
        .from('organization_invitations')
        .update({ status: 'cancelled' })
        .eq('id', invId);
      if (error) throw error;
      toast({ title: t('org.invitationCancelled') });
      fetchOrg();
    } catch (err: any) {
      toast({ title: t('common.error'), description: err.message, variant: 'destructive' });
    }
  };

  const handleRemoveMember = async (member: OrganizationMember) => {
    if (!org) return;
    const fullN = member.profiles ? `${member.profiles.first_name || ''} ${member.profiles.last_name || ''}`.trim() : '';
    const name = fullN || member.profiles?.email?.split('@')[0] || 'this member';
    if (!window.confirm(t('org.removeMemberConfirm', { name }))) return;
    try {
      const { error } = await supabase
        .from('organization_members')
        .delete()
        .eq('id', member.id);
      if (error) throw error;
      toast({ title: t('org.memberRemoved') });
      fetchOrg();
    } catch (err: any) {
      toast({ title: t('common.error'), description: err.message, variant: 'destructive' });
    }
  };

  const handleLeaveOrg = async () => {
    if (!org || !user) return;
    if (!window.confirm(t('org.leaveConfirm'))) return;
    try {
      const { error } = await supabase
        .from('organization_members')
        .delete()
        .eq('organization_id', org.id)
        .eq('user_id', user.id);
      if (error) throw error;
      toast({ title: t('org.leftOrg') });
      setOrg(null);
      setMembers([]);
      setInvitations([]);
    } catch (err: any) {
      toast({ title: t('common.error'), description: err.message, variant: 'destructive' });
    }
  };

  const handleTransfer = async () => {
    if (!org || !transferTarget) return;
    setTransferring(true);
    try {
      const { error } = await supabase.rpc('transfer_org_ownership', {
        p_org_id: org.id,
        p_new_owner_user_id: transferTarget.user_id,
      });
      if (error) throw error;
      toast({ title: t('org.transferSuccess') });
      setTransferOpen(false);
      setTransferTarget(null);
      fetchOrg();
    } catch (err: any) {
      toast({ title: t('common.error'), description: err.message, variant: 'destructive' });
    }
    setTransferring(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary/40" />
      </div>
    );
  }

  // ── NO ORG: Show create form ──
  if (!org) {
    return (
      <div className="space-y-6">
        <Card>
          <CardContent className="pt-6 text-center">
            <Building2 className="h-12 w-12 mx-auto text-gray-300 mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">{t('org.noOrg')}</h3>
            <p className="text-gray-500 text-sm mb-6">{t('org.createOrgDesc')}</p>
            <Button onClick={() => setShowCreateForm(true)}>
              <Building2 className="h-4 w-4 mr-2" />
              {t('org.createOrg')}
            </Button>
          </CardContent>
        </Card>

        {showCreateForm && (
          <Card>
            <CardHeader>
              <CardTitle>{t('org.createOrg')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>{t('org.orgName')} *</Label>
                <Input
                  value={createForm.name}
                  onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                  placeholder={t('org.orgNamePlaceholder')}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>{t('org.domain')}</Label>
                <Input
                  value={createForm.domain}
                  onChange={(e) => setCreateForm({ ...createForm, domain: e.target.value })}
                  placeholder={t('org.domainPlaceholder')}
                />
                <p className="text-xs text-gray-500">{t('org.domainHelp')}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>{t('org.website')}</Label>
                  <Input
                    value={createForm.website}
                    onChange={(e) => setCreateForm({ ...createForm, website: e.target.value })}
                    placeholder={t('org.websitePlaceholder')}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t('org.country')}</Label>
                  <Input
                    value={createForm.country}
                    onChange={(e) => setCreateForm({ ...createForm, country: e.target.value })}
                    placeholder={t('org.countryPlaceholder')}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>{t('org.city')}</Label>
                <Input
                  value={createForm.city}
                  onChange={(e) => setCreateForm({ ...createForm, city: e.target.value })}
                  placeholder={t('org.cityPlaceholder')}
                />
              </div>
              <div className="space-y-2">
                <Label>{t('org.description')}</Label>
                <textarea
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[80px]"
                  value={createForm.description}
                  onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                  placeholder={t('org.descriptionPlaceholder')}
                />
              </div>
              <div className="flex gap-3 justify-end">
                <Button variant="outline" onClick={() => setShowCreateForm(false)}>{t('common.cancel')}</Button>
                <Button onClick={handleCreate} disabled={creating || !createForm.name.trim()}>
                  {creating && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  {creating ? t('org.creating') : t('org.createOrg')}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  // ── HAS ORG: Show org details ──
  const canInvite = isOwner;

  return (
    <div className="space-y-6">
      {/* Organization Info Card */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between">
          <div className="flex items-center gap-3">
            {org.logo_url ? (
              <img src={org.logo_url} alt={org.name} className="w-12 h-12 rounded-lg object-cover" />
            ) : (
              <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
                <Building2 className="h-6 w-6 text-primary" />
              </div>
            )}
            <div>
              <div className="flex items-center gap-2">
                <CardTitle className="text-xl">{org.name}</CardTitle>
                <SponsorBadge tier={org.tier as OrgTier} />
              </div>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <Badge variant="outline">{t(`org.${isOwner ? 'owner' : 'collaborator'}`)}</Badge>
                <Badge variant="secondary">{TIER_LABELS[org.tier as OrgTier] || org.tier}</Badge>
                {org.access_status === 'verified' && (
                  <Badge className="bg-green-100 text-green-800 border-green-200"><CheckCircle className="h-3 w-3 mr-1" />{t('org.statusVerified', 'Verified')}</Badge>
                )}
                {org.access_status === 'pending' && (
                  <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200"><Clock className="h-3 w-3 mr-1" />{t('org.statusPending', 'Pending')}</Badge>
                )}
                {org.access_status === 'rejected' && (
                  <Badge className="bg-red-100 text-red-800 border-red-200"><XCircle className="h-3 w-3 mr-1" />{t('org.statusRejected', 'Rejected')}</Badge>
                )}
                {org.access_status === 'suspended' && (
                  <Badge className="bg-gray-100 text-gray-800 border-gray-200"><XCircle className="h-3 w-3 mr-1" />{t('org.statusSuspended', 'Suspended')}</Badge>
                )}
                {org.onboarding_status === 'submitted' && org.access_status === 'pending' && (
                  <Badge variant="outline" className="text-blue-600 border-blue-200">{t('org.onboardingSubmitted', 'Under Review')}</Badge>
                )}
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link to={`/organizations/${org.slug}`}>
                <ExternalLink className="h-4 w-4 mr-1" />
                {t('org.viewPublicPage')}
              </Link>
            </Button>
            {isOwner && (
              <Button variant="outline" size="sm" onClick={() => setEditing(!editing)}>
                {t('org.editOrg')}
              </Button>
            )}
            {isOwner && org.access_status === 'verified' && !isSponsorTier(org.tier as OrgTier) && (
              <Button size="sm" className="bg-gradient-to-r from-blue-600 to-purple-600 text-white hover:from-blue-700 hover:to-purple-700" onClick={() => setUpgradeOpen(true)}>
                <ArrowUpCircle className="h-4 w-4 mr-1" />
                Upgrade to Sponsor
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Org details */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            {org.primary_domain && (
              <div className="flex items-center gap-2 text-gray-600">
                <Mail className="h-4 w-4 text-primary" />
                <span>{org.primary_domain}</span>
              </div>
            )}
            {org.website && (
              <div className="flex items-center gap-2 text-gray-600">
                <Globe className="h-4 w-4 text-primary" />
                <a href={org.website} target="_blank" rel="noopener noreferrer" className="hover:underline truncate">
                  {org.website.replace(/^https?:\/\//, '')}
                </a>
              </div>
            )}
            {(org.city || org.country) && (
              <div className="flex items-center gap-2 text-gray-600">
                <MapPin className="h-4 w-4 text-primary" />
                <span>{[org.city, org.country].filter(Boolean).join(', ')}</span>
              </div>
            )}
            <div className="flex items-center gap-2 text-gray-600">
              <Users className="h-4 w-4 text-primary" />
              <span>{members.length} {members.length === 1 ? 'member' : 'members'}</span>
            </div>
          </div>

          {org.description && (
            <p className="text-gray-600 text-sm">{org.description}</p>
          )}

          {/* Edit form */}
          {editing && isOwner && (
            <div className="border-t pt-4 space-y-4">
              {/* Base fields */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>{t('org.orgName')}</Label>
                  <Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>{t('org.website')}</Label>
                  <Input value={editForm.website} onChange={(e) => setEditForm({ ...editForm, website: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>{t('org.country')}</Label>
                  <Input value={editForm.country} onChange={(e) => setEditForm({ ...editForm, country: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>{t('org.city')}</Label>
                  <Input value={editForm.city} onChange={(e) => setEditForm({ ...editForm, city: e.target.value })} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>{t('org.description')}</Label>
                <textarea
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[80px]"
                  value={editForm.description}
                  onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                />
              </div>

              {/* Partner-specific fields */}
              {org.organization_type === 'partner' && (
                <div className="space-y-2">
                  <Label>Headquarters Country</Label>
                  <Input value={editForm.headquarters_country} onChange={(e) => setEditForm({ ...editForm, headquarters_country: e.target.value })} placeholder="e.g. France" />
                </div>
              )}

              {/* Media-specific fields */}
              {org.organization_type === 'media_partner' && (
                <div className="space-y-2">
                  <Label>Audience Description</Label>
                  <textarea
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[80px]"
                    value={editForm.audience_description}
                    onChange={(e) => setEditForm({ ...editForm, audience_description: e.target.value })}
                    placeholder="Describe your target audience..."
                  />
                </div>
              )}

              {/* Marina-specific fields */}
              {org.organization_type === 'marina' && (
                <div className="space-y-4 border-t pt-4">
                  <h4 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Marina Details</h4>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label>Marina Type</Label>
                      <Select value={editForm.marina_type} onValueChange={(v) => setEditForm({ ...editForm, marina_type: v })}>
                        <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="in_operation">In Operation</SelectItem>
                          <SelectItem value="under_construction">Under Construction</SelectItem>
                          <SelectItem value="in_project">In Project</SelectItem>
                          <SelectItem value="renovation">Renovation</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Total Berths</Label>
                      <Input type="number" value={editForm.berths_count} onChange={(e) => setEditForm({ ...editForm, berths_count: e.target.value })} />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-2">
                      <Label>Superyacht Berths</Label>
                      <Input type="number" value={editForm.superyacht_berths} onChange={(e) => setEditForm({ ...editForm, superyacht_berths: e.target.value })} />
                    </div>
                    <div className="space-y-2">
                      <Label>Longest Berth (m)</Label>
                      <Input type="number" value={editForm.longest_berth_meters} onChange={(e) => setEditForm({ ...editForm, longest_berth_meters: e.target.value })} />
                    </div>
                    <div className="flex items-end pb-2">
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id="fresh_water"
                          checked={editForm.fresh_water_available}
                          onCheckedChange={(c) => setEditForm({ ...editForm, fresh_water_available: c as boolean })}
                        />
                        <Label htmlFor="fresh_water">Fresh Water</Label>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Certifications (comma-separated)</Label>
                    <Input
                      value={editForm.certifications.join(', ')}
                      onChange={(e) => setEditForm({ ...editForm, certifications: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                      placeholder="e.g. Blue Flag, ISO 14001, Gold Anchor"
                    />
                  </div>

                  <h4 className="text-sm font-semibold text-gray-700 uppercase tracking-wide pt-2">Facilities</h4>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex items-center gap-2">
                      <Checkbox id="yacht_club" checked={editForm.has_yacht_club} onCheckedChange={(c) => setEditForm({ ...editForm, has_yacht_club: c as boolean })} />
                      <Label htmlFor="yacht_club">Yacht Club</Label>
                      {editForm.has_yacht_club && (
                        <Input type="number" className="w-24 ml-2" placeholder="Members" value={editForm.yacht_club_members} onChange={(e) => setEditForm({ ...editForm, yacht_club_members: e.target.value })} />
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Checkbox id="sailing_school" checked={editForm.has_sailing_school} onCheckedChange={(c) => setEditForm({ ...editForm, has_sailing_school: c as boolean })} />
                      <Label htmlFor="sailing_school">Sailing School</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Checkbox id="boat_yard" checked={editForm.has_boat_yard} onCheckedChange={(c) => setEditForm({ ...editForm, has_boat_yard: c as boolean })} />
                      <Label htmlFor="boat_yard">Boat Yard</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Checkbox id="restaurants" checked={editForm.has_restaurants} onCheckedChange={(c) => setEditForm({ ...editForm, has_restaurants: c as boolean })} />
                      <Label htmlFor="restaurants">Restaurants</Label>
                      {editForm.has_restaurants && (
                        <Input type="number" className="w-20 ml-2" placeholder="Count" value={editForm.restaurants_count} onChange={(e) => setEditForm({ ...editForm, restaurants_count: e.target.value })} />
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Checkbox id="concierge" checked={editForm.has_concierge} onCheckedChange={(c) => setEditForm({ ...editForm, has_concierge: c as boolean })} />
                      <Label htmlFor="concierge">Concierge Service</Label>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Marina Description</Label>
                    <textarea
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[80px]"
                      value={editForm.marina_description}
                      onChange={(e) => setEditForm({ ...editForm, marina_description: e.target.value })}
                      placeholder="Describe your marina..."
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Services Description</Label>
                    <textarea
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[80px]"
                      value={editForm.services_description}
                      onChange={(e) => setEditForm({ ...editForm, services_description: e.target.value })}
                      placeholder="Describe the services you offer..."
                    />
                  </div>

                  {/* Sectors of Interest */}
                  <h4 className="text-sm font-semibold text-gray-700 uppercase tracking-wide pt-2">Sectors of Interest</h4>
                  <div className="grid grid-cols-2 gap-2 max-h-60 overflow-y-auto border rounded-lg p-3">
                    {allSectors.map(s => (
                      <div key={s.id} className="flex items-center space-x-2">
                        <Checkbox
                          id={`is-${s.id}`}
                          checked={interestSectors.includes(s.id)}
                          onCheckedChange={() => {
                            setInterestSectors(prev =>
                              prev.includes(s.id) ? prev.filter(id => id !== s.id) : [...prev, s.id]
                            );
                          }}
                        />
                        <Label htmlFor={`is-${s.id}`} className="text-sm cursor-pointer font-normal">{s.label}</Label>
                      </div>
                    ))}
                  </div>

                  {/* Future Development Plans */}
                  <h4 className="text-sm font-semibold text-gray-700 uppercase tracking-wide pt-2">Future Development Plans</h4>
                  <p className="text-xs text-gray-500">For each sector of interest, select the timeline that best matches your development plans.</p>
                  <div className="space-y-1 max-h-[400px] overflow-y-auto border rounded-lg p-3">
                    {allSectors.filter(s => interestSectors.includes(s.id)).map(sector => (
                      <div key={sector.id} className="flex items-center gap-3 py-2 px-2 rounded hover:bg-gray-50 border-b border-gray-100 last:border-0">
                        <span className="text-sm flex-1 min-w-0 truncate" title={sector.label}>{sector.label}</span>
                        <div className="flex gap-1 shrink-0">
                          {timelineOptions.map(tOpt => (
                            <button key={tOpt.value} type="button"
                              onClick={() => {
                                setFuturePlans(prev => {
                                  const next = { ...prev };
                                  if (next[sector.id] === tOpt.value) { delete next[sector.id]; } else { next[sector.id] = tOpt.value; }
                                  return next;
                                });
                              }}
                              title={tOpt.label}
                              className={`px-2 py-1 text-xs rounded border transition-colors ${
                                futurePlans[sector.id] === tOpt.value
                                  ? 'bg-primary text-white border-primary'
                                  : 'bg-white text-gray-500 border-gray-200 hover:border-primary hover:text-primary'
                              }`}
                            >
                              {tOpt.label.replace(' months', 'm').replace(' years', 'y').replace('Immediate', 'Now')}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                    {interestSectors.length === 0 && (
                      <p className="text-sm text-gray-400 text-center py-4">Select sectors of interest above to set development timelines.</p>
                    )}
                  </div>
                </div>
              )}

              <div className="flex gap-3 justify-end">
                <Button variant="outline" onClick={() => setEditing(false)}>{t('common.cancel')}</Button>
                <Button onClick={handleSaveEdit} disabled={saving}>
                  {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  {t('org.saveChanges')}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Members */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5 text-primary" />
              {t('org.members')}
            </CardTitle>
            {/* Seat counter */}
            {org.max_seats > 0 && (
              <div className="mt-2 flex items-center gap-2">
                <div className="flex-1 max-w-[160px] h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      members.length >= org.max_seats ? 'bg-red-500' : members.length >= org.max_seats * 0.8 ? 'bg-amber-500' : 'bg-primary'
                    }`}
                    style={{ width: `${Math.min(100, (members.length / org.max_seats) * 100)}%` }}
                  />
                </div>
                <span className="text-xs text-gray-500">
                  {members.length} / {org.max_seats} seats
                </span>
              </div>
            )}
            {org.max_seats > 0 && members.length >= org.max_seats && (
              <p className="text-xs text-amber-600 mt-1">
                {isSponsorTier((org.tier || 'member') as OrgTier)
                  ? 'Contact M3 to request additional seats.'
                  : 'Additional team members cost €250 each. Contact M3 to add seats.'}
              </p>
            )}
          </div>
          {canInvite && (
            <Button
              size="sm"
              onClick={() => setInviteOpen(true)}
              disabled={org.max_seats > 0 && (members.length + invitations.length) >= org.max_seats}
            >
              <UserPlus className="h-4 w-4 mr-1" />
              {t('org.inviteMember')}
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <div className="divide-y">
            {members.map((member) => {
              const p = member.profiles;
              const fullName = p ? `${p.first_name || ''} ${p.last_name || ''}`.trim() : '';
              const name = fullName || p?.email?.split('@')[0] || 'Unknown';
              const initials = fullName
                ? fullName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
                : name.slice(0, 2).toUpperCase();
              return (
                <div key={member.id} className="flex items-center justify-between py-3">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm">
                      {initials}
                    </div>
                    <div>
                      <div className="font-medium text-gray-900 flex items-center gap-2">
                        {name}
                        {member.role === 'owner' && (
                          <Crown className="h-4 w-4 text-amber-500" />
                        )}
                      </div>
                      <div className="text-xs text-gray-500">{p?.email}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">
                      {t(`org.${member.role}`)}
                    </Badge>
                    {isOwner && member.user_id !== user!.id && (
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => { setTransferTarget(member); setTransferOpen(true); }}
                          title={t('org.transferOwnership')}
                        >
                          <ArrowRightLeft className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs text-red-600 hover:text-red-700"
                          onClick={() => handleRemoveMember(member)}
                          title={t('org.removeMember')}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    )}
                    {!isOwner && member.user_id === user!.id && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs text-red-600 hover:text-red-700"
                        onClick={handleLeaveOrg}
                      >
                        <LogOut className="h-3 w-3 mr-1" />
                        {t('org.leaveOrg')}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Pending Invitations (owner only) */}
      {isOwner && invitations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5 text-primary" />
              {t('org.pendingInvitations')} ({invitations.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="divide-y">
              {invitations.map((inv) => (
                <div key={inv.id} className="flex items-center justify-between py-3">
                  <div>
                    <div className="font-medium text-gray-900">
                      {[inv.first_name, inv.last_name].filter(Boolean).join(' ') || inv.email}
                    </div>
                    <div className="text-xs text-gray-500">{inv.email}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-400">
                      {new Date(inv.expires_at).toLocaleDateString()}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs text-red-600"
                      onClick={() => handleCancelInvitation(inv.id)}
                    >
                      {t('org.cancelInvitation')}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Invite Dialog */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('org.inviteMember')}</DialogTitle>
            <DialogDescription>
              {org.primary_domain
                ? t('org.domainHelp')
                : t('org.inviteMember')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t('org.inviteEmail')} *</Label>
              <Input
                type="email"
                value={inviteForm.email}
                onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
                placeholder={t('org.inviteEmailPlaceholder')}
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>{t('org.inviteFirstName')}</Label>
                <Input
                  value={inviteForm.firstName}
                  onChange={(e) => setInviteForm({ ...inviteForm, firstName: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>{t('org.inviteLastName')}</Label>
                <Input
                  value={inviteForm.lastName}
                  onChange={(e) => setInviteForm({ ...inviteForm, lastName: e.target.value })}
                />
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setInviteOpen(false)}>{t('common.cancel')}</Button>
              <Button onClick={handleInvite} disabled={inviting || !inviteForm.email.trim()}>
                {inviting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                {inviting ? t('org.inviteSending') : t('org.inviteSend')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Transfer Ownership Dialog */}
      <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('org.transferOwnership')}</DialogTitle>
            <DialogDescription>
              {transferTarget && t('org.transferConfirm', {
                name: (transferTarget.profiles
                  ? `${transferTarget.profiles.first_name || ''} ${transferTarget.profiles.last_name || ''}`.trim()
                  : '') || transferTarget.profiles?.email?.split('@')[0] || 'this member',
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setTransferOpen(false)}>{t('common.cancel')}</Button>
            <Button variant="destructive" onClick={handleTransfer} disabled={transferring}>
              {transferring && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {t('org.transferOwnership')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Upgrade to Sponsor Dialog */}
      <Dialog open={upgradeOpen} onOpenChange={setUpgradeOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Upgrade to Sponsor</DialogTitle>
            <DialogDescription>
              Submit a sponsorship request to M3 Monaco. Our team will contact you with details about the selected package. Your current membership fee (€500) will be deducted from the sponsor package price.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label>Select Sponsor Level</Label>
              <Select value={upgradeTier} onValueChange={setUpgradeTier}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="innovation_partner">Innovation Partner</SelectItem>
                  <SelectItem value="associate_partner">Associate Partner</SelectItem>
                  <SelectItem value="premium_partner">Premium Partner</SelectItem>
                  <SelectItem value="main_sponsor">Main Sponsor</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
              <p className="font-medium mb-1">How it works:</p>
              <ol className="list-decimal ml-4 space-y-1 text-blue-700">
                <li>Submit your sponsorship request</li>
                <li>M3 team will contact you with pricing details</li>
                <li>Receive an invoice (€500 deducted)</li>
                <li>Once payment is confirmed, your tier is upgraded</li>
              </ol>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={() => setUpgradeOpen(false)}>Cancel</Button>
              <Button onClick={handleUpgradeRequest} disabled={upgradeSubmitting} className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700">
                {upgradeSubmitting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Submit Request
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
