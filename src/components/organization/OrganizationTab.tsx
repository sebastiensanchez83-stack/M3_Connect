import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
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
  TIER_LABELS, TIER_COLORS, OrgTier,
} from '@/types/database';
import {
  Building2, Users, Mail, Crown, UserPlus, Loader2, ExternalLink,
  Trash2, LogOut, ArrowRightLeft, Globe, MapPin, Shield, CheckCircle, Clock, XCircle,
  ArrowUpCircle, Upload, FileText, X, Camera, CreditCard,
} from 'lucide-react';
import { SponsorBadge } from '@/components/ui/SponsorBadge';
import { isSponsorTier } from '@/types/database';
import { PaymentForm } from '@/components/payment/PaymentForm';

interface OrgDocument {
  id: string;
  organization_id: string;
  uploaded_by: string;
  file_name: string;
  file_url: string;
  file_size: number;
  description: string | null;
  created_at: string;
}

const timelineOptions = [
  { value: 'immediate', label: 'Immediate' },
  { value: '0-3months', label: '0-3 months' },
  { value: '3-12months', label: '3-12 months' },
  { value: '1-3years', label: '1-3 years' },
  { value: '3+years', label: '3+ years' },
];

export function OrganizationTab() {
  const { t } = useTranslation();
  const { user, profile, isPaymentPending, refreshProfile } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
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

  // Sectors
  const [allSectors, setAllSectors] = useState<Sector[]>([]);
  const [interestSectors, setInterestSectors] = useState<string[]>([]);
  const [serviceSectors, setServiceSectors] = useState<string[]>([]);
  const [futurePlans, setFuturePlans] = useState<Record<string, string>>({});

  // Sponsorship upgrade dialog
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [upgradeSubmitting, setUpgradeSubmitting] = useState(false);
  const [upgradeTier, setUpgradeTier] = useState('innovation_partner');
  const [upgradeInvoiceFile, setUpgradeInvoiceFile] = useState<File | null>(null);
  const [uploadingInvoice, setUploadingInvoice] = useState(false);
  const invoiceInputRef = useRef<HTMLInputElement>(null);

  // Create org — multi-step (plan selection for partner/media_partner)
  const [createStep, setCreateStep] = useState<'details' | 'plan'>('details');
  const [selectedPlan, setSelectedPlan] = useState<OrgTier>('member');
  const [pendingUpgradePlan, setPendingUpgradePlan] = useState<OrgTier | null>(null);

  // Membership payment
  const [showMembershipPayment, setShowMembershipPayment] = useState(false);
  const [membershipPaid, setMembershipPaid] = useState(false);
  const [memberPaid, setMemberPaid] = useState(false);

  // Additional seats payment
  const [showSeatPayment, setShowSeatPayment] = useState(false);
  const [seatsToBuy, setSeatsToBuy] = useState(1);
  const ADDITIONAL_SEAT_PRICE_CENTS = 25000; // €250 per additional seat

  // Logo upload
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  // Organization documents
  const [orgDocs, setOrgDocs] = useState<OrgDocument[]>([]);
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [docDescription, setDocDescription] = useState('');
  const docInputRef = useRef<HTMLInputElement>(null);

  const handleUpgradeRequest = async () => {
    if (!org || !user) return;
    setUpgradeSubmitting(true);
    try {
      // Upload invoice file if provided
      let invoiceUrl: string | null = null;
      if (upgradeInvoiceFile) {
        setUploadingInvoice(true);
        const ext = upgradeInvoiceFile.name.split('.').pop() || 'pdf';
        const storagePath = `${org.id}/invoice-${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage.from('org-documents').upload(storagePath, upgradeInvoiceFile, { cacheControl: '3600' });
        if (upErr) throw upErr;
        const { data: signedData } = await supabase.storage.from('org-documents').createSignedUrl(storagePath, 60 * 60 * 24 * 365);
        invoiceUrl = signedData?.signedUrl || null;
        setUploadingInvoice(false);
      }

      const { error } = await supabase.from('sponsorship_requests').insert({
        organization_id: org.id,
        requested_by: user.id,
        requested_tier: upgradeTier,
        current_tier: org.tier,
        amount_already_paid: (() => {
          // Map current tier to approximate paid amount for deduction
          const paidMap: Record<string, number> = { member: 500, innovation_partner: 3000, associate_partner: 15000, premium_partner: 40000, premium_sponsor: 100000, main_sponsor: 150000 };
          return paidMap[org.tier] || 0;
        })(),
        invoice_url: invoiceUrl,
      });
      if (error) throw error;
      toast({ title: 'Sponsorship request submitted', description: 'M3 will contact you with details about the selected package.' });
      setUpgradeOpen(false);
      setUpgradeInvoiceFile(null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      toast({ title: 'Error', description: message, variant: 'destructive' });
    } finally {
      setUpgradeSubmitting(false);
      setUploadingInvoice(false);
    }
  };

  // ── Logo upload handler ──
  const handleLogoUpload = async (file: File) => {
    if (!org || !user) return;
    if (!file.type.startsWith('image/')) {
      toast({ title: 'Invalid file type', description: 'Please upload an image (JPEG, PNG, WebP, GIF, SVG)', variant: 'destructive' });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: 'File too large', description: 'Maximum 5 MB', variant: 'destructive' });
      return;
    }
    setUploadingLogo(true);
    try {
      const ext = file.name.split('.').pop() || 'png';
      const fileName = `${org.id}/logo-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('org-logos').upload(fileName, file, { cacheControl: '3600', upsert: true });
      if (upErr) throw upErr;
      const { data: urlData } = supabase.storage.from('org-logos').getPublicUrl(fileName);
      const logoUrl = urlData.publicUrl;
      const { error: dbErr } = await supabase.from('organizations').update({ logo_url: logoUrl }).eq('id', org.id);
      if (dbErr) throw dbErr;
      setOrg({ ...org, logo_url: logoUrl });
      toast({ title: 'Logo updated' });
    } catch (err: unknown) {
      toast({ title: 'Upload failed', description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
    }
    setUploadingLogo(false);
  };

  const handleRemoveLogo = async () => {
    if (!org) return;
    try {
      const { error } = await supabase.from('organizations').update({ logo_url: null }).eq('id', org.id);
      if (error) throw error;
      setOrg({ ...org, logo_url: null });
      toast({ title: 'Logo removed' });
    } catch (err: unknown) {
      toast({ title: 'Error', description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
    }
  };

  // ── Document handlers ──
  const fetchDocs = useCallback(async (orgId: string) => {
    const { data } = await supabase
      .from('organization_documents')
      .select('*')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false });
    if (data) setOrgDocs(data as OrgDocument[]);
  }, []);

  const handleDocUpload = async (file: File) => {
    if (!org || !user) return;
    if (file.size > 20 * 1024 * 1024) {
      toast({ title: 'File too large', description: 'Maximum 20 MB', variant: 'destructive' });
      return;
    }
    setUploadingDoc(true);
    try {
      const ext = file.name.split('.').pop() || 'pdf';
      const storagePath = `${org.id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const { error: upErr } = await supabase.storage.from('org-documents').upload(storagePath, file, { cacheControl: '3600' });
      if (upErr) throw upErr;
      // For private bucket, we build a signed URL or use the path for later download
      const { data: signedData } = await supabase.storage.from('org-documents').createSignedUrl(storagePath, 60 * 60 * 24 * 365);
      const fileUrl = signedData?.signedUrl || storagePath;
      const { error: dbErr } = await supabase.from('organization_documents').insert({
        organization_id: org.id,
        uploaded_by: user.id,
        file_name: file.name,
        file_url: fileUrl,
        file_size: file.size,
        description: docDescription.trim() || null,
      });
      if (dbErr) throw dbErr;
      toast({ title: 'Document uploaded' });
      setDocDescription('');
      fetchDocs(org.id);
    } catch (err: unknown) {
      toast({ title: 'Upload failed', description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
    }
    setUploadingDoc(false);
  };

  const handleDeleteDoc = async (doc: OrgDocument) => {
    if (!window.confirm(`Delete "${doc.file_name}"?`)) return;
    try {
      const { error } = await supabase.from('organization_documents').delete().eq('id', doc.id);
      if (error) throw error;
      setOrgDocs(prev => prev.filter(d => d.id !== doc.id));
      toast({ title: 'Document deleted' });
    } catch (err: unknown) {
      toast({ title: 'Error', description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
    }
  };

  // Use user.id as stable dependency (user object reference changes on every auth state update)
  const userId = user?.id;

  const fetchOrg = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      // Get user's org membership
      const { data: membership } = await supabase
        .from('organization_members')
        .select('organization_id, role')
        .eq('user_id', userId)
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
        if (interestData) setInterestSectors(interestData.map((d: { sector_id: string }) => d.sector_id));
        if (plansData) {
          const plans: Record<string, string> = {};
          (plansData as { sector_id: string; timeline: string }[]).forEach((p) => { plans[p.sector_id] = p.timeline; });
          setFuturePlans(plans);
        }
      }

      // Fetch service sectors for partner/moderator/media orgs
      if (orgData.organization_type !== 'marina') {
        const [{ data: sectorsList }, { data: svcData }] = await Promise.all([
          supabase.from('sectors').select('*').eq('is_active', true).order('label'),
          supabase.from('organization_service_sectors').select('sector_id').eq('organization_id', orgData.id),
        ]);
        if (sectorsList) setAllSectors(sectorsList as Sector[]);
        if (svcData) setServiceSectors(svcData.map((d: { sector_id: string }) => d.sector_id));
      }

      // Fetch members with profile info
      const { data: membersData } = await supabase
        .from('organization_members')
        .select('id, organization_id, user_id, role, joined_at, profiles(first_name, last_name, email, persona)')
        .eq('organization_id', membership.organization_id)
        .order('joined_at', { ascending: true });

      if (membersData) setMembers(membersData as unknown as OrganizationMember[]);

      // Fetch organization documents
      fetchDocs(membership.organization_id);

      // Fetch pending invitations (owner only — ignore RLS 403 gracefully)
      if (membership.role === 'owner') {
        const { data: invData, error: invErr } = await supabase
          .from('organization_invitations')
          .select('*')
          .eq('organization_id', membership.organization_id)
          .eq('status', 'pending')
          .order('created_at', { ascending: false });

        if (!invErr && invData) setInvitations(invData as OrganizationInvitation[]);
        // If invErr (e.g. 403 from RLS), silently ignore — owner check above is best-effort
      }
    } catch (err) {
      if (import.meta.env.DEV) console.error('Error fetching org:', err);
    }
    setLoading(false);
  }, [userId, fetchDocs]);

  useEffect(() => { fetchOrg(); }, [fetchOrg]);

  // Auto-open membership payment dialog when URL has ?action=pay-membership
  useEffect(() => {
    if (org && searchParams.get('action') === 'pay-membership' && isPaymentPending) {
      setShowMembershipPayment(true);
      // Clear the action param so it doesn't re-trigger
      const newParams = new URLSearchParams(searchParams);
      newParams.delete('action');
      setSearchParams(newParams, { replace: true });
    }
  }, [org, searchParams, isPaymentPending, setSearchParams]);

  // Open upgrade dialog after org is created when a sponsor plan was pre-selected
  useEffect(() => {
    if (org && pendingUpgradePlan) {
      setUpgradeTier(pendingUpgradePlan);
      setUpgradeOpen(true);
      setPendingUpgradePlan(null);
    }
  }, [org, pendingUpgradePlan]);

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
      // Check for duplicate domain before creating
      const trimmedDomain = createForm.domain.trim();
      if (trimmedDomain) {
        const { data: existingOrg } = await supabase
          .from('organizations')
          .select('id, name, slug')
          .eq('primary_domain', trimmedDomain)
          .maybeSingle();

        if (existingOrg) {
          toast({
            title: 'Domain already registered',
            description: `An organization with domain '${trimmedDomain}' already exists: ${existingOrg.name}. Consider requesting to join instead.`,
            variant: 'destructive',
          });
          const proceed = window.confirm(
            `An organization with domain '${trimmedDomain}' already exists: "${existingOrg.name}".\n\nClick OK to create a new organization anyway, or Cancel to go back and request to join the existing one.`
          );
          if (!proceed) {
            setCreating(false);
            return;
          }
        }
      }

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
      setShowCreateForm(false);
      setCreateStep('details');
      if (selectedPlan !== 'member') {
        setPendingUpgradePlan(selectedPlan);
      }
      const chosePaidMember = memberPaid;
      setSelectedPlan('member');
      setMemberPaid(false);
      await fetchOrg();
      // If the user chose the paid Member option, show the payment form
      if (chosePaidMember) {
        setTimeout(() => setShowMembershipPayment(true), 600);
      }
      // Auto-open edit mode so user can complete sector selection
      setTimeout(() => setEditing(true), 500);
      toast({
        title: 'Organization created!',
        description: chosePaidMember
          ? 'Complete your membership payment to unlock full platform access.'
          : 'Now complete your profile by adding your service sectors and details below.',
      });
    } catch (err: unknown) {
      toast({ title: t('common.error'), description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
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

      // Save service sectors for partner/moderator/media orgs
      if (org.organization_type !== 'marina') {
        await supabase.from('organization_service_sectors').delete().eq('organization_id', org.id);
        if (serviceSectors.length > 0) {
          await supabase.from('organization_service_sectors').insert(
            serviceSectors.map(s => ({ organization_id: org.id, sector_id: s }))
          );
        }
      }

      // If this is the first time completing the org profile, mark as submitted for review
      if (profile?.onboarding_status === 'draft') {
        await supabase.from('profiles').update({ onboarding_status: 'submitted' }).eq('user_id', user!.id);
        refreshProfile();
        toast({ title: 'Profile submitted for review!', description: 'An admin will review your profile shortly. You will be notified once approved.' });
      } else {
        toast({ title: t('org.saved') });
      }
      setEditing(false);
      fetchOrg();
    } catch (err: unknown) {
      toast({ title: t('common.error'), description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
    }
    setSaving(false);
  };

  const handleInvite = async () => {
    if (!org || !inviteForm.email.trim()) return;

    // Capacity check — block invite if at max_seats (marinas have unlimited seats)
    const isMarinaOrg = org.organization_type === 'marina';
    const totalOccupied = members.length + invitations.length;
    if (!isMarinaOrg && org.max_seats && totalOccupied >= org.max_seats) {
      const tierLabel = TIER_LABELS[(org.tier || 'member') as OrgTier];
      toast({
        title: 'Team capacity reached',
        description: `Your ${tierLabel} plan includes ${org.max_seats} seat${org.max_seats > 1 ? 's' : ''}. You can purchase additional seats below.`,
        variant: 'destructive',
      });
      setSeatsToBuy(1);
      setShowSeatPayment(true);
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
    } catch (err: unknown) {
      toast({ title: t('common.error'), description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
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
    } catch (err: unknown) {
      toast({ title: t('common.error'), description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
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
    } catch (err: unknown) {
      toast({ title: t('common.error'), description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
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
    } catch (err: unknown) {
      toast({ title: t('common.error'), description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
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
    } catch (err: unknown) {
      toast({ title: t('common.error'), description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
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

            <div className="space-y-3 mb-6 inline-block text-left">
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-full bg-green-100 text-green-700 flex items-center justify-center text-sm font-bold">1</div>
                <span className="text-sm text-green-700 font-medium line-through">Create your account</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-bold">2</div>
                <span className="text-sm text-primary font-medium">Create & complete your organization profile</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-full bg-gray-100 text-gray-400 flex items-center justify-center text-sm font-bold">3</div>
                <span className="text-sm text-gray-400">Admin review & approval</span>
              </div>
            </div>

            <Button onClick={() => setShowCreateForm(true)}>
              <Building2 className="h-4 w-4 mr-2" />
              {t('org.createOrg')}
            </Button>
          </CardContent>
        </Card>

        {showCreateForm && (
          <Card>
            <CardHeader>
              <CardTitle>
                {createStep === 'plan' ? 'Choose your membership plan' : t('org.createOrg')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {createStep === 'details' && (
                <>
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
                    <Button
                      variant="outline"
                      onClick={() => { setShowCreateForm(false); setCreateStep('details'); setSelectedPlan('member'); setMemberPaid(false); }}
                    >
                      {t('common.cancel')}
                    </Button>
                    {(profile?.persona === 'partner' || profile?.persona === 'media_partner') ? (
                      <Button
                        onClick={() => setCreateStep('plan')}
                        disabled={!createForm.name.trim()}
                      >
                        Next →
                      </Button>
                    ) : (
                      <Button onClick={handleCreate} disabled={creating || !createForm.name.trim()}>
                        {creating && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                        {creating ? t('org.creating') : t('org.createOrg')}
                      </Button>
                    )}
                  </div>
                </>
              )}

              {createStep === 'plan' && (
                <>
                  <p className="text-sm text-gray-500">
                    Choose your access level. Basic is free with limited features. Member unlocks the full platform. Sponsorship packages are confirmed by annual bank invoice.
                  </p>
                  <div className="grid gap-2">
                    {([
                      { tier: 'member' as OrgTier, price: 'Free', note: 'Basic access only', seats: 1, paid: false,
                        features: 'Register for events & webinars, view public content' },
                      { tier: 'member' as OrgTier, price: '€500/year', note: 'Full platform access', seats: 1, paid: true,
                        features: '5 connect requests, member resources & events, network directory', recommended: true },
                      { tier: 'innovation_partner' as OrgTier, price: '€3,000/year', note: 'Annual invoice', seats: 5, paid: false,
                        features: '20 connect requests, webinar proposals, all content access' },
                      { tier: 'associate_partner' as OrgTier, price: '€15,000/year', note: 'Annual invoice', seats: 10, paid: false,
                        features: 'Unlimited connects, priority events, sponsor badge' },
                      { tier: 'premium_partner' as OrgTier, price: '€40,000/year', note: 'Annual invoice', seats: 15, paid: false,
                        features: 'Unlimited connects, VIP events, priority support' },
                      { tier: 'premium_sponsor' as OrgTier, price: '€100,000/year', note: 'Annual invoice', seats: 20, paid: false,
                        features: 'Full VIP experience, maximum visibility' },
                      { tier: 'main_sponsor' as OrgTier, price: '€150,000/year', note: 'Annual invoice', seats: 25, paid: false,
                        features: 'Title sponsor, exclusive benefits' },
                    ]).map(({ tier, price, note, seats, paid, features, recommended }) => {
                      const colors = TIER_COLORS[tier];
                      const uniqueKey = paid ? `${tier}-paid` : tier;
                      const isSelected = paid
                        ? (selectedPlan === tier && memberPaid)
                        : (selectedPlan === tier && !memberPaid);
                      return (
                        <button
                          key={uniqueKey}
                          type="button"
                          onClick={() => { setSelectedPlan(tier); setMemberPaid(!!paid); }}
                          className={`relative w-full text-left rounded-lg border-2 px-4 py-3 transition-all ${
                            isSelected
                              ? 'border-primary bg-primary/5'
                              : recommended
                                ? 'border-blue-300 hover:border-blue-400 bg-blue-50/30'
                                : 'border-gray-200 hover:border-gray-300 bg-white'
                          }`}
                        >
                          {recommended && (
                            <span className="absolute -top-2.5 right-3 px-2 py-0.5 bg-blue-600 text-white text-[10px] font-bold rounded-full uppercase tracking-wide">
                              Recommended
                            </span>
                          )}
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold border ${colors.bg} ${colors.text} ${colors.border}`}>
                                {paid && tier === 'member' ? 'Member' : (!paid && tier === 'member') ? 'Basic Access' : TIER_LABELS[tier]}
                              </span>
                              <span className="text-xs text-gray-500">Up to {seats} seat{seats > 1 ? 's' : ''}</span>
                              {isSelected && <CheckCircle className="h-4 w-4 text-primary" />}
                            </div>
                            <div className="text-right">
                              <div className="text-sm font-semibold">{price}</div>
                              <div className="text-xs text-gray-400">{note}</div>
                            </div>
                          </div>
                          <p className="text-xs text-gray-500 mt-1.5 pl-0.5">{features}</p>
                        </button>
                      );
                    })}
                  </div>
                  {selectedPlan !== 'member' && (
                    <p className="text-xs text-blue-700 bg-blue-50 border border-blue-100 rounded p-2">
                      A sponsorship upgrade request will be submitted automatically after your organization is created. M3 will contact you with invoice details.
                    </p>
                  )}
                  {selectedPlan === 'member' && !memberPaid && (
                    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded p-2">
                      Basic access is free but limited. Upgrade to Member anytime to unlock full platform features.
                    </p>
                  )}
                  <div className="flex gap-3 justify-end pt-2 border-t">
                    <Button variant="outline" onClick={() => setCreateStep('details')}>← Back</Button>
                    <Button onClick={handleCreate} disabled={creating}>
                      {creating && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                      {creating ? t('org.creating') : 'Confirm & Create'}
                    </Button>
                  </div>
                </>
              )}
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
      {/* Membership payment required banner */}
      {isPaymentPending && isOwner && (
        <Card className="border-2 border-amber-300 bg-amber-50/50">
          <CardContent className="p-5">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="bg-amber-100 rounded-full p-2.5">
                  <CreditCard className="h-6 w-6 text-amber-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-amber-900">Complete Your Membership Payment</h3>
                  <p className="text-sm text-amber-700">Your account has been approved by M3. Pay the €500 annual membership fee to activate full platform access for your organization.</p>
                </div>
              </div>
              <Button
                className="bg-amber-600 hover:bg-amber-700 text-white shrink-0 shadow-sm"
                onClick={() => setShowMembershipPayment(true)}
              >
                <CreditCard className="h-4 w-4 mr-2" />
                Pay €500
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Organization Info Card */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between">
          <div className="flex items-center gap-3">
            {/* Logo with upload overlay for owners */}
            <div className="relative group">
              {org.logo_url ? (
                <img src={org.logo_url} alt={org.name} className="w-14 h-14 rounded-lg object-cover border" />
              ) : (
                <div className="w-14 h-14 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Building2 className="h-7 w-7 text-primary" />
                </div>
              )}
              {isOwner && (
                <button
                  type="button"
                  onClick={() => logoInputRef.current?.click()}
                  className="absolute inset-0 rounded-lg bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                  title="Change logo"
                >
                  {uploadingLogo ? (
                    <Loader2 className="h-5 w-5 animate-spin text-white" />
                  ) : (
                    <Camera className="h-5 w-5 text-white" />
                  )}
                </button>
              )}
              {isOwner && org.logo_url && (
                <button
                  type="button"
                  onClick={handleRemoveLogo}
                  className="absolute -top-1.5 -right-1.5 p-0.5 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Remove logo"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
              <input
                ref={logoInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif,image/svg+xml"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleLogoUpload(f); if (logoInputRef.current) logoInputRef.current.value = ''; }}
              />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <CardTitle className="text-xl">{org.name}</CardTitle>
                <SponsorBadge tier={org.tier as OrgTier} />
              </div>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <Badge variant="outline">{t(`org.${isOwner ? 'owner' : 'collaborator'}`)}</Badge>
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
            {isOwner && org.access_status === 'verified' && org.tier !== 'main_sponsor' && (
              <Button size="sm" className="bg-primary text-white hover:bg-primary/90" onClick={() => {
                // Pre-select the next tier above current
                const tierOrder: OrgTier[] = ['member', 'innovation_partner', 'associate_partner', 'premium_partner', 'premium_sponsor', 'main_sponsor'];
                const currentIdx = tierOrder.indexOf(org.tier as OrgTier);
                const nextTier = currentIdx >= 0 && currentIdx < tierOrder.length - 1 ? tierOrder[currentIdx + 1] : 'innovation_partner';
                setUpgradeTier(nextTier);
                setUpgradeOpen(true);
              }}>
                <ArrowUpCircle className="h-4 w-4 mr-1" />
                {isSponsorTier(org.tier as OrgTier) ? 'Upgrade Tier' : 'Upgrade to Sponsor'}
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

          {/* Detailed Organization Info (read-only) */}
          {!editing && (
            <div className="border-t pt-4 space-y-4">
              {/* General Details */}
              <h4 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">{t('org.generalDetails', 'General Details')}</h4>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                <div>
                  <span className="text-gray-500 block">{t('org.orgType', 'Organization Type')}</span>
                  <span className="font-medium capitalize">{org.organization_type?.replace('_', ' ') || '—'}</span>
                </div>
                <div>
                  <span className="text-gray-500 block">{t('org.tier', 'Tier')}</span>
                  <span className="font-medium">{TIER_LABELS[org.tier as OrgTier] || org.tier}</span>
                </div>
                {org.country && (
                  <div>
                    <span className="text-gray-500 block">{t('org.country', 'Country')}</span>
                    <span className="font-medium">{org.country}</span>
                  </div>
                )}
                {org.city && (
                  <div>
                    <span className="text-gray-500 block">{t('org.city', 'City')}</span>
                    <span className="font-medium">{org.city}</span>
                  </div>
                )}
                {org.primary_domain && (
                  <div>
                    <span className="text-gray-500 block">{t('org.domain', 'Primary Domain')}</span>
                    <span className="font-medium">{org.primary_domain}</span>
                  </div>
                )}
                {org.website && (
                  <div>
                    <span className="text-gray-500 block">{t('org.website', 'Website')}</span>
                    <a href={org.website} target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline inline-flex items-center gap-1">
                      {org.website.replace(/^https?:\/\//, '')}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                )}
                <div>
                  <span className="text-gray-500 block">{t('org.status', 'Status')}</span>
                  <span className="font-medium capitalize">{org.access_status}</span>
                </div>
                <div>
                  <span className="text-gray-500 block">{t('org.created', 'Created')}</span>
                  <span className="font-medium">{new Date(org.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
                </div>
              </div>

              {/* Partner-specific details */}
              {org.organization_type === 'partner' && org.headquarters_country && (
                <div className="text-sm">
                  <span className="text-gray-500 block">{t('org.headquartersCountry', 'Headquarters Country')}</span>
                  <span className="font-medium">{org.headquarters_country}</span>
                </div>
              )}

              {/* Media partner-specific details */}
              {org.organization_type === 'media_partner' && org.audience_description && (
                <div className="text-sm">
                  <span className="text-gray-500 block mb-1">{t('org.audienceDescription', 'Audience Description')}</span>
                  <p className="text-gray-700">{org.audience_description}</p>
                </div>
              )}

              {/* Marina-specific details */}
              {org.organization_type === 'marina' && (
                <div className="space-y-4">
                  <h4 className="text-sm font-semibold text-gray-700 uppercase tracking-wide border-t pt-4">{t('org.marinaDetails', 'Marina Details')}</h4>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                    {editForm.marina_type && (
                      <div>
                        <span className="text-gray-500 block">{t('org.marinaType', 'Marina Type')}</span>
                        <span className="font-medium capitalize">{editForm.marina_type.replace('_', ' ')}</span>
                      </div>
                    )}
                    {editForm.berths_count && (
                      <div>
                        <span className="text-gray-500 block">{t('org.totalBerths', 'Total Berths')}</span>
                        <span className="font-medium">{editForm.berths_count}</span>
                      </div>
                    )}
                    {editForm.superyacht_berths && (
                      <div>
                        <span className="text-gray-500 block">{t('org.superyachtBerths', 'Superyacht Berths')}</span>
                        <span className="font-medium">{editForm.superyacht_berths}</span>
                      </div>
                    )}
                    {editForm.longest_berth_meters && (
                      <div>
                        <span className="text-gray-500 block">{t('org.longestBerth', 'Longest Berth')}</span>
                        <span className="font-medium">{editForm.longest_berth_meters} m</span>
                      </div>
                    )}
                    <div>
                      <span className="text-gray-500 block">{t('org.freshWater', 'Fresh Water')}</span>
                      <span className="font-medium">{editForm.fresh_water_available ? t('common.yes', 'Yes') : t('common.no', 'No')}</span>
                    </div>
                  </div>

                  {editForm.certifications.length > 0 && (
                    <div className="text-sm">
                      <span className="text-gray-500 block mb-1">{t('org.certifications', 'Certifications')}</span>
                      <div className="flex flex-wrap gap-1.5">
                        {editForm.certifications.map((cert, i) => (
                          <Badge key={i} variant="secondary" className="text-xs">{cert}</Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Facilities */}
                  {(editForm.has_yacht_club || editForm.has_sailing_school || editForm.has_boat_yard || editForm.has_restaurants || editForm.has_concierge) && (
                    <div className="text-sm">
                      <span className="text-gray-500 block mb-1">{t('org.facilities', 'Facilities')}</span>
                      <div className="flex flex-wrap gap-1.5">
                        {editForm.has_yacht_club && (
                          <Badge variant="outline" className="text-xs">
                            Yacht Club{editForm.yacht_club_members ? ` (${editForm.yacht_club_members} members)` : ''}
                          </Badge>
                        )}
                        {editForm.has_sailing_school && <Badge variant="outline" className="text-xs">Sailing School</Badge>}
                        {editForm.has_boat_yard && <Badge variant="outline" className="text-xs">Boat Yard</Badge>}
                        {editForm.has_restaurants && (
                          <Badge variant="outline" className="text-xs">
                            Restaurants{editForm.restaurants_count ? ` (${editForm.restaurants_count})` : ''}
                          </Badge>
                        )}
                        {editForm.has_concierge && <Badge variant="outline" className="text-xs">Concierge Service</Badge>}
                      </div>
                    </div>
                  )}

                  {editForm.marina_description && (
                    <div className="text-sm">
                      <span className="text-gray-500 block mb-1">{t('org.marinaDescription', 'Marina Description')}</span>
                      <p className="text-gray-700">{editForm.marina_description}</p>
                    </div>
                  )}

                  {editForm.services_description && (
                    <div className="text-sm">
                      <span className="text-gray-500 block mb-1">{t('org.servicesDescription', 'Services Description')}</span>
                      <p className="text-gray-700">{editForm.services_description}</p>
                    </div>
                  )}

                  {/* Sectors of Interest (read-only) */}
                  {interestSectors.length > 0 && (
                    <div className="text-sm">
                      <span className="text-gray-500 block mb-1">{t('org.sectorsOfInterest', 'Sectors of Interest')}</span>
                      <div className="flex flex-wrap gap-1.5">
                        {allSectors.filter(s => interestSectors.includes(s.id)).map(sector => (
                          <Badge key={sector.id} variant="secondary" className="text-xs">{sector.label}</Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Future Plans (read-only) */}
                  {Object.keys(futurePlans).length > 0 && (
                    <div className="text-sm">
                      <span className="text-gray-500 block mb-1">{t('org.futurePlans', 'Future Development Plans')}</span>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {allSectors.filter(s => futurePlans[s.id]).map(sector => (
                          <div key={sector.id} className="flex items-center justify-between bg-gray-50 rounded px-3 py-1.5">
                            <span className="text-gray-700 truncate">{sector.label}</span>
                            <Badge variant="outline" className="text-xs ml-2 shrink-0">
                              {timelineOptions.find(opt => opt.value === futurePlans[sector.id])?.label || futurePlans[sector.id]}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
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

              {/* Service Sectors — for partner/moderator/media orgs */}
              {org.organization_type !== 'marina' && allSectors.length > 0 && (
                <div className="space-y-2 border-t pt-4">
                  <h4 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Service Sectors</h4>
                  <p className="text-xs text-gray-500">Select the sectors your organization operates in.</p>
                  <div className="grid grid-cols-2 gap-2 max-h-60 overflow-y-auto border rounded-lg p-3">
                    {allSectors.map(s => (
                      <div key={s.id} className="flex items-center space-x-2">
                        <Checkbox
                          id={`svc-${s.id}`}
                          checked={serviceSectors.includes(s.id)}
                          onCheckedChange={() => {
                            setServiceSectors(prev =>
                              prev.includes(s.id) ? prev.filter(id => id !== s.id) : [...prev, s.id]
                            );
                          }}
                        />
                        <Label htmlFor={`svc-${s.id}`} className="text-sm cursor-pointer font-normal">{s.label}</Label>
                      </div>
                    ))}
                  </div>
                  {serviceSectors.length > 0 && (
                    <p className="text-xs text-gray-500">{serviceSectors.length} sector(s) selected</p>
                  )}
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
            {/* Seat counter — hidden for marinas (unlimited) */}
            {org.organization_type !== 'marina' && org.max_seats > 0 && (
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
            {org.organization_type !== 'marina' && org.max_seats > 0 && members.length >= org.max_seats && (
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
              disabled={org.organization_type !== 'marina' && org.max_seats > 0 && (members.length + invitations.length) >= org.max_seats}
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

      {/* Organization Documents */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            Documents
          </CardTitle>
          {isOwner && (
            <Button size="sm" onClick={() => docInputRef.current?.click()} disabled={uploadingDoc}>
              {uploadingDoc ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Upload className="h-4 w-4 mr-1" />}
              Upload
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {/* Upload area (owner) */}
          {isOwner && (
            <>
              <input
                ref={docInputRef}
                type="file"
                accept=".pdf,.doc,.docx,.xls,.xlsx"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleDocUpload(f);
                  if (docInputRef.current) docInputRef.current.value = '';
                }}
              />
              <div className="mb-4">
                <Input
                  value={docDescription}
                  onChange={(e) => setDocDescription(e.target.value)}
                  placeholder="Optional description for next upload..."
                  className="text-sm"
                />
              </div>
            </>
          )}

          {/* Document list */}
          {orgDocs.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">No documents uploaded yet.</p>
          ) : (
            <div className="divide-y">
              {orgDocs.map((doc) => (
                <div key={doc.id} className="flex items-center justify-between py-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-lg bg-red-50 flex items-center justify-center shrink-0">
                      <FileText className="h-5 w-5 text-red-500" />
                    </div>
                    <div className="min-w-0">
                      <a
                        href={doc.file_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-medium text-gray-900 hover:text-primary truncate block"
                      >
                        {doc.file_name}
                      </a>
                      <div className="text-xs text-gray-500 flex items-center gap-2">
                        <span>{(doc.file_size / 1024).toFixed(0)} KB</span>
                        <span>{new Date(doc.created_at).toLocaleDateString()}</span>
                        {doc.description && <span>— {doc.description}</span>}
                      </div>
                    </div>
                  </div>
                  {isOwner && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs text-red-600 hover:text-red-700 shrink-0"
                      onClick={() => handleDeleteDoc(doc)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

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

      {/* Membership Payment Dialog (€500 for partner/media) */}
      <Dialog open={showMembershipPayment} onOpenChange={setShowMembershipPayment}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5" />
              Membership Payment
            </DialogTitle>
            <DialogDescription>
              Complete your €500 annual membership fee to activate your organization on M3 Connect.
            </DialogDescription>
          </DialogHeader>
          {membershipPaid ? (
            <div className="text-center py-6">
              <CheckCircle className="h-12 w-12 text-green-600 mx-auto mb-3" />
              <h3 className="text-lg font-semibold text-green-800 mb-1">Payment Successful!</h3>
              <p className="text-sm text-gray-600 mb-4">Your membership is now active. Welcome to M3 Connect!</p>
              <Button onClick={() => { setShowMembershipPayment(false); setMembershipPaid(false); }}>
                Continue
              </Button>
            </div>
          ) : (
            <div className="mt-2">
              <PaymentForm
                amountCents={50000}
                paymentType="membership"
                organizationId={org?.id}
                label="Annual Membership Fee"
                description="€500.00 — M3 Connect annual membership for your organization"
                onSuccess={() => {
                  setMembershipPaid(true);
                  toast({ title: 'Membership activated', description: 'Your membership payment has been processed successfully. You now have full access!' });
                  fetchOrg();
                  refreshProfile();
                }}
                onError={(err) => {
                  toast({ title: 'Payment failed', description: err, variant: 'destructive' });
                }}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Additional Seats Payment Dialog */}
      <Dialog open={showSeatPayment} onOpenChange={setShowSeatPayment}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Purchase Additional Seats
            </DialogTitle>
            <DialogDescription>
              Your current plan includes {org?.max_seats || 1} seat{(org?.max_seats || 1) > 1 ? 's' : ''} and all are occupied. Purchase additional seats at €{(ADDITIONAL_SEAT_PRICE_CENTS / 100).toFixed(0)} per seat.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="flex items-center gap-3">
              <Label className="whitespace-nowrap">Number of seats:</Label>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={() => setSeatsToBuy(Math.max(1, seatsToBuy - 1))}
                  disabled={seatsToBuy <= 1}
                >
                  −
                </Button>
                <span className="w-8 text-center font-semibold">{seatsToBuy}</span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={() => setSeatsToBuy(seatsToBuy + 1)}
                  disabled={seatsToBuy >= 20}
                >
                  +
                </Button>
              </div>
              <span className="text-sm text-gray-600 ml-auto font-medium">
                €{((ADDITIONAL_SEAT_PRICE_CENTS * seatsToBuy) / 100).toFixed(0)}
              </span>
            </div>
            <PaymentForm
              key={`seats-${seatsToBuy}`}
              amountCents={ADDITIONAL_SEAT_PRICE_CENTS * seatsToBuy}
              paymentType="additional_seats"
              organizationId={org?.id}
              metadata={{ seats_count: String(seatsToBuy) }}
              label={`Purchase ${seatsToBuy} Additional Seat${seatsToBuy > 1 ? 's' : ''}`}
              description={`€${((ADDITIONAL_SEAT_PRICE_CENTS * seatsToBuy) / 100).toFixed(0)}.00 — ${seatsToBuy} additional seat${seatsToBuy > 1 ? 's' : ''} for your organization`}
              onSuccess={() => {
                toast({ title: 'Seats purchased!', description: `${seatsToBuy} additional seat${seatsToBuy > 1 ? 's have' : ' has'} been added to your organization.` });
                setShowSeatPayment(false);
                fetchOrg();
              }}
              onError={(err) => {
                toast({ title: 'Payment failed', description: err, variant: 'destructive' });
              }}
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* Upgrade to Sponsor Dialog */}
      <Dialog open={upgradeOpen} onOpenChange={setUpgradeOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{isSponsorTier(org.tier as OrgTier) ? 'Upgrade Sponsorship' : 'Upgrade to Sponsor'}</DialogTitle>
            <DialogDescription>
              {isSponsorTier(org.tier as OrgTier)
                ? `You are currently a ${TIER_LABELS[org.tier as OrgTier]}. Submit an upgrade request and M3 will contact you with details about the higher tier package. Your existing sponsorship investment will be accounted for.`
                : 'Submit a sponsorship request to M3 Monaco. Our team will contact you with details about the selected package. Your current membership fee (€500) will be deducted from the sponsor package price.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label>Select Sponsor Level</Label>
              <Select value={upgradeTier} onValueChange={setUpgradeTier}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(['innovation_partner', 'associate_partner', 'premium_partner', 'premium_sponsor', 'main_sponsor'] as OrgTier[])
                    .filter(t => {
                      // Only show tiers above the current tier
                      const tierOrder: OrgTier[] = ['member', 'innovation_partner', 'associate_partner', 'premium_partner', 'premium_sponsor', 'main_sponsor'];
                      return tierOrder.indexOf(t) > tierOrder.indexOf((org?.tier || 'member') as OrgTier);
                    })
                    .map(t => (
                      <SelectItem key={t} value={t}>{TIER_LABELS[t]}</SelectItem>
                    ))
                  }
                </SelectContent>
              </Select>
            </div>
            {/* Invoice Upload */}
            <div className="space-y-2">
              <Label>Upload Invoice (optional)</Label>
              <p className="text-xs text-gray-500">If you have already received an invoice from M3, upload it here.</p>
              <input
                ref={invoiceInputRef}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    if (file.size > 10 * 1024 * 1024) {
                      toast({ title: 'File too large', description: 'Maximum 10 MB', variant: 'destructive' });
                      return;
                    }
                    setUpgradeInvoiceFile(file);
                  }
                }}
              />
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => invoiceInputRef.current?.click()}>
                  <Upload className="h-4 w-4 mr-2" />
                  {upgradeInvoiceFile ? 'Change File' : 'Choose File'}
                </Button>
                {upgradeInvoiceFile && (
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <FileText className="h-4 w-4" />
                    <span className="truncate max-w-[200px]">{upgradeInvoiceFile.name}</span>
                    <button type="button" onClick={() => setUpgradeInvoiceFile(null)} className="text-gray-400 hover:text-red-500">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
              <p className="font-medium mb-1">How it works:</p>
              <ol className="list-decimal ml-4 space-y-1 text-blue-700">
                <li>Submit your sponsorship request</li>
                <li>M3 team will contact you with pricing details</li>
                <li>Upload your invoice when received (€500 membership deducted)</li>
                <li>Once payment is confirmed, your tier is upgraded</li>
              </ol>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={() => { setUpgradeOpen(false); setUpgradeInvoiceFile(null); }}>Cancel</Button>
              <Button onClick={handleUpgradeRequest} disabled={upgradeSubmitting || uploadingInvoice} className="bg-primary hover:bg-primary/90">
                {(upgradeSubmitting || uploadingInvoice) && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Submit Request
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
