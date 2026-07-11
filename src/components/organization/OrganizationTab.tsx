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
import { sendNotification } from '@/lib/notifications';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
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
import { CapitalIntentSection } from '@/components/capital/CapitalIntentSection';
import { InvestmentThesisSection } from '@/components/capital/InvestmentThesisSection';
import { resizeImage, fileMeta } from '@/lib/image';

// PaymentForm removed — member tier is free, payment integration deferred

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
  const { user, profile, refreshProfile } = useAuth();
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
  // Membership payment states removed — member tier is free
  // memberPaid removed — member tier is always free

  // Additional seats payment
  // Seat payment states removed — contact M3 for additional seats

  // Logo upload
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [galleryBusy, setGalleryBusy] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const [logoMeta, setLogoMeta] = useState('');
  const [bannerMeta, setBannerMeta] = useState('');
  const bannerInputRef = useRef<HTMLInputElement>(null);

  // Organization documents
  const [orgDocs, setOrgDocs] = useState<OrgDocument[]>([]);
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [docDescription, setDocDescription] = useState('');
  const docInputRef = useRef<HTMLInputElement>(null);

  // Sponsorship is now sales-led: packages are arranged directly with the M3
  // team and tracked in the sp_* fulfilment tracker, not via a self-service
  // request queue. The "Upgrade to Sponsor" button opens a contact prompt
  // (see the dialog below) instead of writing to the retired
  // sponsorship_requests table.
  const SPONSORSHIP_CONTACT = 'events@m3monaco.com';

  // ── Product-image gallery (any member; shown on the public profile) ──
  const handleGalleryUpload = async (files: FileList) => {
    if (!org || !user || !files.length) return;
    setGalleryBusy(true);
    try {
      const added: string[] = [];
      for (const file of Array.from(files).slice(0, 12)) {
        if (!file.type.startsWith('image/')) continue;
        if (file.size > 25 * 1024 * 1024) { toast({ title: `${file.name} is too large`, description: 'Max 25 MB', variant: 'destructive' }); continue; }
        const blob = await resizeImage(file, 1400, 1400);
        const ctype = (blob as Blob).type || file.type;
        const ext = ctype === 'image/png' ? 'png' : ctype === 'image/webp' ? 'webp' : 'jpg';
        const fileName = `${org.id}/gallery-${Date.now()}-${Math.floor(Math.random() * 100000)}.${ext}`;
        const { error: upErr } = await supabase.storage.from('org-logos').upload(fileName, blob, { cacheControl: '3600', upsert: false, contentType: ctype });
        if (upErr) { toast({ title: `Couldn't upload ${file.name}`, description: upErr.message, variant: 'destructive' }); continue; }
        added.push(supabase.storage.from('org-logos').getPublicUrl(fileName).data.publicUrl);
      }
      if (added.length) {
        const next = [...(org.gallery || []), ...added];
        const { error } = await supabase.rpc('update_org_gallery', { p_org_id: org.id, p_urls: next });
        if (error) throw error;
        setOrg({ ...org, gallery: next });
        toast({ title: `Added ${added.length} image${added.length > 1 ? 's' : ''}` });
      }
    } catch (err: unknown) {
      toast({ title: 'Upload failed', description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
    }
    setGalleryBusy(false);
  };

  const removeGalleryImage = async (url: string) => {
    if (!org) return;
    const next = (org.gallery || []).filter(u => u !== url);
    const { error } = await supabase.rpc('update_org_gallery', { p_org_id: org.id, p_urls: next });
    if (error) { toast({ title: 'Could not remove', description: error.message, variant: 'destructive' }); return; }
    setOrg({ ...org, gallery: next });
  };

  // ── Logo upload handler ──
  const handleLogoUpload = async (file: File) => {
    if (!org || !user) return;
    if (!file.type.startsWith('image/')) {
      toast({ title: 'Invalid file type', description: 'Please upload an image (JPEG, PNG, WebP, GIF, SVG)', variant: 'destructive' });
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      toast({ title: 'File too large', description: 'Maximum 25 MB', variant: 'destructive' });
      return;
    }
    setUploadingLogo(true);
    try {
      const meta = await fileMeta(file);
      const blob = await resizeImage(file, 600, 600); // shrink big files; keep PNG/SVG transparency
      const ctype = (blob as Blob).type || file.type;
      const ext = ctype === 'image/svg+xml' ? 'svg' : ctype === 'image/png' ? 'png' : 'jpg';
      const fileName = `${org.id}/logo-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('org-logos').upload(fileName, blob, { cacheControl: '3600', upsert: true, contentType: ctype });
      if (upErr) throw upErr;
      const { data: urlData } = supabase.storage.from('org-logos').getPublicUrl(fileName);
      const logoUrl = urlData.publicUrl;
      const { error: dbErr } = await supabase.rpc('update_org_branding', { p_org_id: org.id, p_field: 'logo', p_url: logoUrl });
      if (dbErr) throw dbErr;
      setOrg({ ...org, logo_url: logoUrl });
      setLogoMeta(meta);
      toast({ title: 'Logo updated', description: meta });
    } catch (err: unknown) {
      toast({ title: 'Upload failed', description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
    }
    setUploadingLogo(false);
  };

  const handleRemoveLogo = async () => {
    if (!org) return;
    try {
      const { error } = await supabase.rpc('update_org_branding', { p_org_id: org.id, p_field: 'logo', p_url: null });
      if (error) throw error;
      setOrg({ ...org, logo_url: null });
      toast({ title: 'Logo removed' });
    } catch (err: unknown) {
      toast({ title: 'Error', description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
    }
  };

  // ── Cover banner upload handler ──
  const handleBannerUpload = async (file: File) => {
    if (!org || !user) return;
    if (!file.type.startsWith('image/')) {
      toast({ title: 'Invalid file type', description: 'Please upload an image (JPEG, PNG, WebP)', variant: 'destructive' });
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      toast({ title: 'File too large', description: 'Maximum 25 MB', variant: 'destructive' });
      return;
    }
    setUploadingBanner(true);
    try {
      const meta = await fileMeta(file);
      const blob = await resizeImage(file, 2000, 700); // wide cover; shrinks big files
      const ctype = (blob as Blob).type || file.type;
      const ext = ctype === 'image/svg+xml' ? 'svg' : ctype === 'image/png' ? 'png' : 'jpg';
      const fileName = `${org.id}/banner-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('org-logos').upload(fileName, blob, { cacheControl: '3600', upsert: true, contentType: ctype });
      if (upErr) throw upErr;
      const { data: urlData } = supabase.storage.from('org-logos').getPublicUrl(fileName);
      const bannerUrl = urlData.publicUrl;
      const { error: dbErr } = await supabase.rpc('update_org_branding', { p_org_id: org.id, p_field: 'banner', p_url: bannerUrl });
      if (dbErr) throw dbErr;
      setOrg({ ...org, banner_url: bannerUrl });
      setBannerMeta(meta);
      toast({ title: 'Cover photo updated', description: meta });
    } catch (err: unknown) {
      toast({ title: 'Upload failed', description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
    }
    setUploadingBanner(false);
  };

  const handleRemoveBanner = async () => {
    if (!org) return;
    try {
      const { error } = await supabase.rpc('update_org_branding', { p_org_id: org.id, p_field: 'banner', p_url: null });
      if (error) throw error;
      setOrg({ ...org, banner_url: null });
      toast({ title: 'Cover photo removed' });
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

      // Fetch pending invitations + join requests (visible to all members, actions owner-only)
      const { data: invData, error: invErr } = await supabase
        .from('organization_invitations')
        .select('*')
        .eq('organization_id', membership.organization_id)
        .in('status', ['pending', 'join_requested', 'accepted'])
        .order('created_at', { ascending: false });

      if (invErr) {
        if (import.meta.env.DEV) console.warn('[OrganizationTab] Invitation fetch error (check RLS policy):', invErr);
        // Fallback: try fetching with service role via RPC if direct query fails
        // For now, log the error so we can diagnose
      }
      if (invData) setInvitations(invData as OrganizationInvitation[]);
      else if (import.meta.env.DEV) console.log('[OrganizationTab] No invitation data returned. invErr:', invErr);
    } catch (err) {
      if (import.meta.env.DEV) console.error('Error fetching org:', err);
    }
    setLoading(false);
  }, [userId, fetchDocs]);

  useEffect(() => { fetchOrg(); }, [fetchOrg]);

  // Payment auto-open removed — member tier is free

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
      'yandex.com','tutanota.com',
      'mailinator.com','guerrillamail.com','guerrillamail.info','sharklasers.com',
      'trashmail.com','10minutemail.com','tempmail.com','yopmail.com',
      'maildrop.cc','mintemail.com','throwawaymail.com','dispostable.com',
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
      setSelectedPlan('member');
      await fetchOrg();
      // Auto-open edit mode so user can complete sector selection
      setTimeout(() => setEditing(true), 500);
      toast({
        title: 'Organization created!',
        description: 'Now complete your profile by adding your service sectors and details below.',
        duration: 8000,
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

    // Capacity check — block invite if at max_seats (marinas/developers have unlimited seats)
    const isMarinaOrg = org.organization_type === 'marina' || org.organization_type === 'developer';
    const totalOccupied = members.length + invitations.length;
    if (!isMarinaOrg && org.max_seats && totalOccupied >= org.max_seats) {
      const tierLabel = TIER_LABELS[(org.tier || 'member') as OrgTier];
      toast({
        title: 'Team capacity reached',
        description: `Your ${tierLabel} plan includes ${org.max_seats} seat${org.max_seats > 1 ? 's' : ''}. Contact Smart Marina Connect to request additional seats.`,
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

      // Fetch the newly created invitation ID so we can include it in the email link
      const { data: newInvite } = await supabase
        .from('organization_invitations')
        .select('id')
        .eq('organization_id', org.id)
        .eq('email', inviteForm.email.trim().toLowerCase())
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const inviteUrl = newInvite?.id
        ? `${window.location.origin}/join/${newInvite.id}`
        : window.location.origin;

      // Send invitation email via edge function
      sendNotification({
        type: 'team_invitation',
        email: inviteForm.email.trim().toLowerCase(),
        data: {
          org_name: org.name || 'An organization',
          inviter_name: profile?.first_name ? `${profile.first_name}${profile.last_name ? ' ' + profile.last_name : ''}` : user?.email?.split('@')[0] || 'A team member',
          signup_url: inviteUrl,
          first_name: inviteForm.firstName.trim() || '',
        },
      });

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

  const handleApproveJoinRequest = async (invId: string, invEmail: string) => {
    try {
      const { error } = await supabase.rpc('approve_join_request', { p_invitation_id: invId });
      if (error) throw error;
      toast({ title: 'Join request approved', description: `${invEmail} has been added to the team.` });
      // Notify the requester by email
      sendNotification({
        type: 'join_request_approved',
        email: invEmail,
        data: {
          org_name: org?.name || 'Your organization',
          first_name: '',
        },
      });
      fetchOrg();
    } catch (err: unknown) {
      toast({ title: t('common.error'), description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
    }
  };

  const handleToggleAutoApprove = async () => {
    if (!org) return;
    const newValue = !org.auto_approve_domain_joins;
    try {
      const { error } = await supabase
        .from('organizations')
        .update({ auto_approve_domain_joins: newValue })
        .eq('id', org.id);
      if (error) throw error;
      toast({
        title: newValue ? 'Auto-approve enabled' : 'Auto-approve disabled',
        description: newValue
          ? 'New members with matching email domain will be automatically added to your team.'
          : 'New members will need your approval to join the team.',
      });
      fetchOrg();
    } catch (err: unknown) {
      toast({ title: t('common.error'), description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
    }
  };

  const handleRejectJoinRequest = async (invId: string, invEmail: string) => {
    if (!window.confirm(`Reject join request from ${invEmail}?`)) return;
    try {
      const { error } = await supabase.rpc('reject_join_request', { p_invitation_id: invId });
      if (error) throw error;
      toast({ title: 'Join request rejected' });
      // Notify the requester by email
      sendNotification({
        type: 'join_request_rejected',
        email: invEmail,
        data: {
          org_name: org?.name || 'Your organization',
          first_name: '',
        },
      });
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
                      onClick={() => { setShowCreateForm(false); setCreateStep('details'); setSelectedPlan('member'); }}
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
                    Choose your membership tier. Member access is free. Sponsorship packages provide enhanced visibility and are confirmed by M3 after your organization is created.
                  </p>
                  <div className="grid gap-2">
                    {([
                      { tier: 'member' as OrgTier, price: 'Free', note: 'Full platform access', seats: 1,
                        features: 'Events & webinars, connect requests, member resources, network directory', recommended: true },
                      { tier: 'innovation_partner' as OrgTier, price: 'Contact Us', note: 'Annual invoice', seats: 5,
                        features: '20 connect requests, webinar proposals, all content access' },
                      { tier: 'associate_partner' as OrgTier, price: 'Contact Us', note: 'Annual invoice', seats: 10,
                        features: 'Unlimited connects, priority events, sponsor badge' },
                      { tier: 'premium_partner' as OrgTier, price: 'Contact Us', note: 'Annual invoice', seats: 15,
                        features: 'Unlimited connects, VIP events, priority support' },
                      { tier: 'premium_sponsor' as OrgTier, price: 'Contact Us', note: 'Annual invoice', seats: 20,
                        features: 'Full VIP experience, maximum visibility' },
                      { tier: 'main_sponsor' as OrgTier, price: 'Contact Us', note: 'Annual invoice', seats: 25,
                        features: 'Title sponsor, exclusive benefits' },
                    ]).map(({ tier, price, note, seats, features, recommended }) => {
                      const colors = TIER_COLORS[tier];
                      const isSelected = selectedPlan === tier;
                      return (
                        <button
                          key={tier}
                          type="button"
                          onClick={() => { setSelectedPlan(tier); }}
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
                                {TIER_LABELS[tier]}
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
  // Any member of the org (owner or collaborator) can update branding (logo /
  // cover). The update_org_branding RPC enforces membership server-side.
  const canEditBranding = true;
  // Any member can also edit the org's profile details (name, description,
  // location, marina facts, sectors). Sensitive fields (tier, verification,
  // claim code, ownership, domain settings) stay owner/admin-only — enforced by
  // RLS + the guard_org_sensitive_columns trigger.
  const canEditOrg = true;

  return (
    <div className="space-y-6">
      {/* Payment banner removed — member tier is free */}

      {/* Organization Info Card */}
      <Card className="overflow-hidden">
        {/* Cover banner (3:1) — full-bleed, with an always-visible upload button for owners */}
        <div className="relative aspect-[3/1] min-h-[10rem] bg-gradient-to-br from-slate-100 to-slate-200">
          {org.banner_url ? (
            <>
              <img src={org.banner_url} alt={`${org.name} cover`} className="w-full h-full object-cover object-center" />
              {bannerMeta && <span className="absolute bottom-2 left-2 text-[10px] font-medium text-white bg-black/50 rounded px-1.5 py-0.5">{bannerMeta}</span>}
            </>
          ) : (
            <button
              type="button"
              onClick={() => canEditBranding && bannerInputRef.current?.click()}
              disabled={!canEditBranding}
              className="w-full h-full flex flex-col items-center justify-center gap-1.5 text-slate-400 hover:text-slate-500 transition-colors disabled:cursor-default"
            >
              <Camera className="h-9 w-9 opacity-40" />
              {canEditBranding && <span className="text-xs font-medium">Add a cover photo</span>}
            </button>
          )}
          {canEditBranding && (
            <>
              {/* always visible so users don't have to hover to discover it */}
              <button
                type="button"
                onClick={() => bannerInputRef.current?.click()}
                disabled={uploadingBanner}
                className="absolute top-3 right-3 flex items-center gap-1.5 bg-white/90 hover:bg-white text-slate-700 text-xs font-medium rounded-full px-3 py-1.5 shadow-sm disabled:opacity-60"
              >
                {uploadingBanner ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
                {org.banner_url ? 'Change cover' : 'Upload cover'}
              </button>
              {org.banner_url && (
                <button
                  type="button"
                  onClick={handleRemoveBanner}
                  className="absolute top-3 left-3 p-1.5 bg-red-500/90 hover:bg-red-500 text-white rounded-full shadow-sm"
                  title="Remove cover photo"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
              <input
                ref={bannerInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleBannerUpload(f); if (bannerInputRef.current) bannerInputRef.current.value = ''; }}
              />
            </>
          )}
        </div>
        {canEditBranding && (
          <p className="px-6 pt-2 text-[11px] leading-snug text-slate-400">
            Cover photo — wide image, recommended 1600×400&nbsp;px (JPG, PNG or WebP). Up to 25&nbsp;MB; large photos are optimised automatically on upload.
          </p>
        )}
        <CardHeader className="flex flex-row items-start justify-between">
          <div className="flex items-center gap-3">
            {/* Logo + always-visible upload button for owners */}
            <div className="flex flex-col items-center gap-1.5 shrink-0">
              <div className="relative group">
                {org.logo_url ? (
                  <img src={org.logo_url} alt={org.name} className="w-14 h-14 rounded-lg object-contain border bg-white p-1" />
                ) : (
                  <div className="w-14 h-14 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Building2 className="h-7 w-7 text-primary" />
                  </div>
                )}
                {canEditBranding && org.logo_url && (
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
              {canEditBranding && (
                <>
                  <button
                    type="button"
                    onClick={() => logoInputRef.current?.click()}
                    disabled={uploadingLogo}
                    className="flex items-center gap-1 text-[11px] font-medium text-primary hover:underline disabled:opacity-60"
                  >
                    {uploadingLogo ? <Loader2 className="h-3 w-3 animate-spin" /> : <Camera className="h-3 w-3" />}
                    {org.logo_url ? 'Change logo' : 'Add logo'}
                  </button>
                  <span className="text-[10px] text-slate-400 whitespace-nowrap">Square · max 25 MB</span>
                </>
              )}
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
            {canEditOrg && (
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

          {/* Product images — any member manages; shown on the public profile */}
          <div className="border-t pt-4">
            <div className="flex items-center justify-between gap-2 mb-1">
              <h4 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Product images</h4>
              {canEditOrg && (
                <label className="inline-flex items-center gap-1.5 text-xs font-medium text-primary cursor-pointer hover:underline">
                  <input type="file" accept="image/*" multiple className="hidden" disabled={galleryBusy}
                    onChange={e => { if (e.target.files) handleGalleryUpload(e.target.files); e.target.value = ''; }} />
                  {galleryBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Add images
                </label>
              )}
            </div>
            <p className="text-xs text-gray-400 mb-2">Shown on your public organization profile. Any team member can add or remove them.</p>
            {(org.gallery || []).length === 0 ? (
              <p className="text-sm text-gray-400">No product images yet.</p>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {(org.gallery || []).map((url) => (
                  <div key={url} className="relative group aspect-square rounded-lg border border-gray-100 overflow-hidden bg-gray-50">
                    <img src={url} alt="" className="w-full h-full object-cover" />
                    {canEditOrg && (
                      <button type="button" onClick={() => removeGalleryImage(url)}
                        className="absolute top-1 right-1 bg-white/90 rounded-full p-1 text-gray-500 hover:text-red-600 shadow-sm opacity-0 group-hover:opacity-100 transition-opacity" aria-label="Remove image">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

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
          {editing && canEditOrg && (
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
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="yacht_club" className="cursor-pointer">Yacht Club</Label>
                      <div className="flex items-center gap-2">
                        {editForm.has_yacht_club && (
                          <div className="flex items-center gap-1.5">
                            <Input type="number" min="0" className="w-20 h-8 text-xs" placeholder="0" value={editForm.yacht_club_members} onChange={(e) => setEditForm({ ...editForm, yacht_club_members: e.target.value })} />
                            <span className="text-xs text-gray-500 whitespace-nowrap">members</span>
                          </div>
                        )}
                        <Switch id="yacht_club" checked={editForm.has_yacht_club} onCheckedChange={(c) => setEditForm({ ...editForm, has_yacht_club: c })} />
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <Label htmlFor="sailing_school" className="cursor-pointer">Sailing School</Label>
                      <Switch id="sailing_school" checked={editForm.has_sailing_school} onCheckedChange={(c) => setEditForm({ ...editForm, has_sailing_school: c })} />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label htmlFor="boat_yard" className="cursor-pointer">Boat Yard</Label>
                      <Switch id="boat_yard" checked={editForm.has_boat_yard} onCheckedChange={(c) => setEditForm({ ...editForm, has_boat_yard: c })} />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label htmlFor="restaurants" className="cursor-pointer">Restaurants</Label>
                      <div className="flex items-center gap-2">
                        {editForm.has_restaurants && (
                          <div className="flex items-center gap-1.5">
                            <Input type="number" min="0" className="w-16 h-8 text-xs" placeholder="0" value={editForm.restaurants_count} onChange={(e) => setEditForm({ ...editForm, restaurants_count: e.target.value })} />
                            <span className="text-xs text-gray-500 whitespace-nowrap">restaurants</span>
                          </div>
                        )}
                        <Switch id="restaurants" checked={editForm.has_restaurants} onCheckedChange={(c) => setEditForm({ ...editForm, has_restaurants: c })} />
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <Label htmlFor="concierge" className="cursor-pointer">Concierge Service</Label>
                      <Switch id="concierge" checked={editForm.has_concierge} onCheckedChange={(c) => setEditForm({ ...editForm, has_concierge: c })} />
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
                All seats are occupied. Contact Smart Marina Connect to request additional seats.
              </p>
            )}
            {/* Auto-approve toggle — only visible to org owners with a domain */}
            {isOwner && org.primary_domain && (
              <div className="mt-3 flex items-center gap-3 bg-gray-50 rounded-lg px-3 py-2.5 border border-gray-200">
                <Switch
                  checked={org.auto_approve_domain_joins}
                  onCheckedChange={handleToggleAutoApprove}
                  id="auto-approve-toggle"
                />
                <label htmlFor="auto-approve-toggle" className="text-xs text-gray-600 cursor-pointer leading-tight">
                  <span className="font-medium text-gray-700">Auto-approve</span>
                  <br />
                  <span className="text-gray-500">Automatically add users with @{org.primary_domain} email</span>
                </label>
              </div>
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
            {/* Active members */}
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

            {/* Invitations & join requests — visible to all members, actions owner-only */}
            {invitations.length > 0 && (
              <div className="pt-3 mt-3 border-t border-gray-100">
                <div className="flex items-center gap-2 mb-2">
                  <Mail className="h-4 w-4 text-amber-500" />
                  <span className="text-sm font-semibold text-gray-600">Invitations & Requests ({invitations.length})</span>
                </div>
              </div>
            )}
            {invitations.map((inv) => {
              const invName = [inv.first_name, inv.last_name].filter(Boolean).join(' ');
              const invInitials = invName
                ? invName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
                : inv.email.slice(0, 2).toUpperCase();
              const isJoinRequest = inv.status === 'join_requested';
              const isAccepted = inv.status === 'accepted';
              // Don't show accepted invitations if the person is already in the members list
              if (isAccepted && members.some(m => m.profiles?.email?.toLowerCase() === inv.email.toLowerCase())) return null;
              return (
                <div key={inv.id} className={`flex items-center justify-between py-3 ${isAccepted ? '' : 'opacity-70'}`}>
                  <div className="flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm border ${
                      isAccepted ? 'bg-green-100 text-green-600 border-green-300' :
                      isJoinRequest ? 'bg-blue-100 text-blue-600 border-blue-300 border-dashed' :
                      'bg-amber-100 text-amber-600 border-amber-300 border-dashed'
                    }`}>
                      {invInitials}
                    </div>
                    <div>
                      <div className="font-medium text-gray-700 flex items-center gap-2">
                        {invName || inv.email.split('@')[0]}
                        {isAccepted ? (
                          <Badge className="bg-green-100 text-green-700 border-green-200 text-[10px] px-1.5 py-0">
                            <CheckCircle className="h-3 w-3 mr-0.5" />
                            Joined
                          </Badge>
                        ) : isJoinRequest ? (
                          <Badge className="bg-blue-100 text-blue-700 border-blue-200 text-[10px] px-1.5 py-0">
                            <Users className="h-3 w-3 mr-0.5" />
                            Join Request
                          </Badge>
                        ) : (
                          <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-[10px] px-1.5 py-0">
                            <Clock className="h-3 w-3 mr-0.5" />
                            Pending
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-gray-500">
                        {inv.email}
                        <span className="text-gray-400 ml-2">
                          {isAccepted ? 'Joined' : isJoinRequest ? 'Requested' : 'Invited'} {new Date(inv.created_at).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {isOwner && isJoinRequest && (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs text-green-600 hover:text-green-700 hover:bg-green-50"
                          onClick={() => handleApproveJoinRequest(inv.id, inv.email)}
                          title="Approve join request"
                        >
                          <CheckCircle className="h-3 w-3 mr-1" />
                          Approve
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs text-red-600 hover:text-red-700"
                          onClick={() => handleRejectJoinRequest(inv.id, inv.email)}
                          title="Reject join request"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </>
                    )}
                    {isOwner && !isJoinRequest && !isAccepted && (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs text-primary hover:text-primary/80"
                          onClick={() => {
                            const reminderUrl = `${window.location.origin}/join/${inv.id}`;
                            sendNotification({
                              type: 'team_invitation_reminder',
                              email: inv.email,
                              data: {
                                org_name: org.name || 'An organization',
                                inviter_name: profile?.first_name ? `${profile.first_name}${profile.last_name ? ' ' + profile.last_name : ''}` : user?.email?.split('@')[0] || 'A team member',
                                signup_url: reminderUrl,
                                first_name: inv.first_name || '',
                              },
                            });
                            toast({ title: 'Reminder sent', description: `Resent invitation to ${inv.email}` });
                          }}
                          title="Resend invitation email"
                        >
                          <Mail className="h-3 w-3 mr-1" />
                          Resend
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs text-red-600 hover:text-red-700"
                          onClick={() => handleCancelInvitation(inv.id)}
                          title="Cancel invitation"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Pending Invitations card removed — invitations now shown inline in members list above */}
      {false && isOwner && invitations.length > 0 && (
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
              <div className="mb-1">
                <Input
                  value={docDescription}
                  onChange={(e) => setDocDescription(e.target.value)}
                  placeholder="Optional description for next upload..."
                  className="text-sm"
                />
              </div>
              <p className="mb-4 text-[11px] text-slate-400">PDF, Word or Excel — up to 20&nbsp;MB per file.</p>
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

      {/* Capital raise (marina / developer / partner) */}
      {(org.organization_type === 'marina' || org.organization_type === 'developer' || org.organization_type === 'partner') && (
        <CapitalIntentSection organizationId={org.id} isOwner={isOwner} />
      )}

      {/* Investment thesis (investor) */}
      {org.organization_type === 'investor' && (
        <InvestmentThesisSection
          org={org}
          isOwner={isOwner}
          onSaved={(updated) => setOrg(org ? ({ ...org, ...updated } as Organization) : null)}
        />
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

      {/* Payment dialogs removed — member tier is free, sponsor upgrades handled via contact */}

      {/* Upgrade to Sponsor Dialog */}
      <Dialog open={upgradeOpen} onOpenChange={setUpgradeOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{isSponsorTier(org.tier as OrgTier) ? 'Upgrade sponsorship' : 'Become a sponsor'}</DialogTitle>
            <DialogDescription>
              {isSponsorTier(org.tier as OrgTier)
                ? `You are currently a ${TIER_LABELS[org.tier as OrgTier]}. Talk to the M3 team about moving to a higher tier — your existing sponsorship investment is accounted for.`
                : 'Sponsorship packages are arranged directly with the M3 team.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
              <p className="font-medium mb-1">Tailored to your organization</p>
              <p className="text-blue-700">
                Every package is put together with you — the M3 team will walk you through the tiers,
                benefits and pricing, then set everything up. Compare the tiers on the{' '}
                <Link to="/tiers" className="underline font-medium" onClick={() => setUpgradeOpen(false)}>Tiers page</Link>.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setUpgradeOpen(false)}>Close</Button>
              <Button
                className="bg-primary hover:bg-primary/90"
                onClick={() => { window.location.href = `mailto:${SPONSORSHIP_CONTACT}?subject=${encodeURIComponent('Sponsorship enquiry — ' + (org.name || ''))}`; }}
              >
                <Mail className="h-4 w-4 mr-2" /> Contact the M3 team
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
