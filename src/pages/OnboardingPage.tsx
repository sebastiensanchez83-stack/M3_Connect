import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Loader2, CheckCircle, ChevronRight, Anchor, Briefcase, Newspaper, Building2, Users, Clock, Send } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { LoadingSkeleton } from '@/components/LoadingSkeleton';
import { supabase } from '@/lib/supabase';
import { Sector, PersonaType, PendingInvitationResult } from '@/types/database';
import { toast } from '@/hooks/use-toast';
import { getStoredInvite, clearStoredInvite } from '@/lib/invite-store';
import { sendNotification } from '@/lib/notifications';

/* ─── Types ─── */
interface MarinaOrgForm {
  marina_name: string;
  country: string;
  city: string;
  website: string;
  marina_type: string;
  completion_date: string;
  berths_count: string;
  superyacht_berths: string;
  longest_berth_meters: string;
  fresh_water_available: boolean;
  mix_range_boats: boolean;
  mix_range_description: string;
  certifications: string[];
  certifications_other: string;
  has_yacht_club: boolean;
  yacht_club_members: string;
  has_sailing_school: boolean;
  has_boat_yard: boolean;
  has_restaurants: boolean;
  restaurants_count: string;
  has_concierge: boolean;
  marina_description: string;
  services_description: string;
  social_media_links: string;
}

/* ─── Constants ─── */
const countries = [
  'Albania', 'Algeria', 'Bahrain', 'Belgium', 'Brazil', 'Canada', 'Chile', 'China',
  'Croatia', 'Cyprus', 'Denmark', 'Egypt', 'Estonia', 'Finland', 'France', 'Germany',
  'Gibraltar', 'Greece', 'Indonesia', 'Ireland', 'Israel', 'Italy', 'Japan', 'Jordan',
  'Kuwait', 'Latvia', 'Lebanon', 'Libya', 'Lithuania', 'Malta', 'Mauritius', 'Mexico',
  'Monaco', 'Montenegro', 'Morocco', 'Netherlands', 'New Zealand', 'Norway', 'Oman',
  'Philippines', 'Poland', 'Portugal', 'Qatar', 'Romania', 'Saudi Arabia', 'Singapore',
  'Slovenia', 'South Africa', 'Spain', 'Sweden', 'Thailand', 'Tunisia', 'Turkey',
  'United Arab Emirates', 'United Kingdom', 'United States', 'Other',
];

const certificationOptions = [
  'Blue Flag', 'ISO 14001', 'PIANC Green Marina', 'Clean Marina',
  'Gold Anchor', 'Silver Anchor', 'Five Gold Anchors',
];

const timelineOptions = [
  { value: 'immediate', label: 'Immediate' },
  { value: '0-3months', label: '0-3 months' },
  { value: '3-12months', label: '3-12 months' },
  { value: '1-3years', label: '1-3 years' },
  { value: '3+years', label: '3+ years' },
];

const PUBLIC_DOMAINS = [
  'gmail.com','yahoo.com','yahoo.fr','hotmail.com','hotmail.fr',
  'outlook.com','outlook.fr','live.com','live.fr',
  'aol.com','icloud.com','me.com','mac.com',
  'mail.com','protonmail.com','proton.me','gmx.com','gmx.fr',
  'wanadoo.fr','orange.fr','free.fr','sfr.fr','laposte.net',
  'msn.com','ymail.com','fastmail.com','zoho.com',
];

const personaCards: { value: PersonaType; icon: JSX.Element; title: string; desc: string }[] = [
  { value: 'marina', icon: <Anchor className="h-8 w-8" />, title: 'Marina', desc: 'I manage or represent a marina or port.' },
  { value: 'partner', icon: <Briefcase className="h-8 w-8" />, title: 'Industry Partner', desc: 'I provide products or services to the marina sector.' },
  { value: 'media_partner', icon: <Newspaper className="h-8 w-8" />, title: 'Media Partner', desc: 'I represent a media outlet covering the marina and yachting industry.' },
];

const defaultMarinaForm: MarinaOrgForm = {
  marina_name: '', country: '', city: '', website: '',
  marina_type: '', completion_date: '',
  berths_count: '', superyacht_berths: '', longest_berth_meters: '',
  fresh_water_available: false, mix_range_boats: false, mix_range_description: '',
  certifications: [], certifications_other: '',
  has_yacht_club: false, yacht_club_members: '',
  has_sailing_school: false, has_boat_yard: false,
  has_restaurants: false, restaurants_count: '',
  has_concierge: false,
  marina_description: '', services_description: '', social_media_links: '',
};

/* ─── Component ─── */
export function OnboardingPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { user, profile, refreshProfile, hasOrganization, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(false);
  const [creatingProfile, setCreatingProfile] = useState(false);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [selectedSectors, setSelectedSectors] = useState<string[]>([]);

  // Step tracking: 'resolve' (check invitation/domain), 'org-form' (create org), 'done'
  const [step, setStep] = useState<'resolve' | 'org-form'>('resolve');
  const [resolving, setResolving] = useState(true);

  // Organization resolution state
  const [pendingInvitation, setPendingInvitation] = useState<PendingInvitationResult | null>(null);
  const [detectedOrg, setDetectedOrg] = useState<{ id: string; name: string; logo_url?: string | null; tier?: string | null; member_count?: number; auto_approve?: boolean } | null>(null);
  const [acceptingInvite, setAcceptingInvite] = useState(false);
  const [joiningOrg, setJoiningOrg] = useState(false);
  const [joinRequested, setJoinRequested] = useState(false);
  const [requestingJoin, setRequestingJoin] = useState(false);

  // Org creation state
  const [orgCreated, setOrgCreated] = useState(false);
  const [orgId, setOrgId] = useState<string | null>(null);
  // Prevent re-render loop after submission
  const [submitted, setSubmitted] = useState(false);

  // Marina org form
  const [marina, setMarina] = useState<MarinaOrgForm>(defaultMarinaForm);
  const [futurePlans, setFuturePlans] = useState<Record<string, string>>({});

  // Partner org form
  const [partner, setPartner] = useState({ company_name: '', website: '', headquarters_country: '', city: '', description: '', social_media_links: { linkedin: '', twitter: '', instagram: '', facebook: '' } });

  // Media org form
  const [media, setMedia] = useState({ media_name: '', website: '', audience_description: '', social_media_links: { linkedin: '', twitter: '', instagram: '', facebook: '' } });

  const needsPersonaSetup = !authLoading && !!user && !profile;

  // Load sectors independently (not inside navigation guards so it always runs)
  useEffect(() => {
    supabase.from('sectors').select('*').eq('is_active', true).order('label')
      .then(({ data }) => { if (data) setSectors(data as Sector[]); });
  }, []);

  /* ─── Navigation guards ─── */
  // If user has a pending invite token, STAY on onboarding to resolve it.
  // Otherwise redirect to /account as normal.
  const hasPendingInvite = !!getStoredInvite();

  useEffect(() => {
    if (authLoading || submitted) return;
    if (!user) { navigate('/'); return; }

    // If there's a pending invite, skip ALL redirects — let resolveOrg handle it
    if (hasPendingInvite) return;

    // Completed or submitted → always go to account
    if (profile?.onboarding_status === 'completed') { navigate('/account', { replace: true }); return; }
    if (profile?.onboarding_status === 'submitted' && profile?.access_status !== 'rejected') {
      navigate('/account', { replace: true }); return;
    }
    // Draft status (new user after email confirm) → go to account, complete from there
    if (profile?.onboarding_status === 'draft' && profile?.access_status !== 'rejected') {
      navigate('/account?tab=organization', { replace: true }); return;
    }
    // If already has org, redirect to account
    if (hasOrganization) {
      navigate('/account', { replace: true }); return;
    }
    // If AuthContext didn't load org (timeout), double-check directly
    if (profile && !hasOrganization) {
      supabase
        .from('organization_members')
        .select('organization_id')
        .eq('user_id', user.id)
        .maybeSingle()
        .then(({ data }) => {
          if (data?.organization_id) {
            navigate('/account', { replace: true });
          }
        });
    }
  }, [user, profile, authLoading, hasOrganization, submitted, hasPendingInvite, navigate]);

  /* ─── Organization resolution: check invitation + domain ─── */
  useEffect(() => {
    // If profile is null (e.g. after AuthContext timeout), don't stay stuck on resolving
    if (!user || needsPersonaSetup) {
      setResolving(false);
      return;
    }
    // If already in an org AND no pending invite, skip resolution
    if (!profile || (hasOrganization && !hasPendingInvite)) {
      setResolving(false);
      return;
    }
    const resolveOrg = async () => {
      setResolving(true);
      try {
        // ── Priority 1: Check localStorage invite token (from email link ?invite=<id>) ──
        const storedInviteId = getStoredInvite();
        if (storedInviteId) {
          const { data: invRow } = await supabase
            .from('organization_invitations')
            .select('id, organization_id, email, status, organizations(name), profiles!organization_invitations_invited_by_user_id_fkey(first_name, last_name)')
            .eq('id', storedInviteId)
            .eq('status', 'pending')
            .maybeSingle();

          if (invRow && (invRow as Record<string, unknown>)) {
            const row = invRow as Record<string, unknown>;
            const org = row.organizations as { name: string } | null;
            const inviter = row.profiles as { first_name: string | null; last_name: string | null } | null;
            setPendingInvitation({
              invitation_id: row.id as string,
              organization_id: row.organization_id as string,
              organization_name: org?.name || 'Unknown Organization',
              invited_by_name: inviter ? `${inviter.first_name || ''} ${inviter.last_name || ''}`.trim() : 'A team member',
            });
            setResolving(false);
            return;
          }
          // Invalid/expired invite token → clear it and continue
          clearStoredInvite();
        }

        // ── Priority 2: Check for pending invitation by email (RPC fallback) ──
        if (!user.email) { setResolving(false); return; }
        const { data: invData } = await supabase.rpc('check_pending_invitation', { p_email: user.email });
        if (invData && invData.length > 0) {
          setPendingInvitation(invData[0] as PendingInvitationResult);
          setResolving(false);
          return;
        }

        // ── Priority 3: Check if an existing join request was already sent ──
        if (user.email) {
          const { data: existingRequest } = await supabase
            .from('organization_invitations')
            .select('id, organization_id, status, organizations(name)')
            .eq('email', user.email.toLowerCase())
            .eq('status', 'join_requested')
            .maybeSingle();
          if (existingRequest) {
            const org = (existingRequest as Record<string, unknown>).organizations as { name: string } | null;
            setDetectedOrg({ id: existingRequest.organization_id, name: org?.name || 'Organization' });
            setJoinRequested(true);
            setResolving(false);
            return;
          }
        }

        // ── Priority 4: Check domain match → offer to request to join ──
        if (user.email) {
          const domain = user.email.split('@')[1]?.toLowerCase();
          if (domain && !PUBLIC_DOMAINS.includes(domain)) {
            const { data: orgMatch } = await supabase
              .from('organizations')
              .select('id, name, logo_url, tier, auto_approve_domain_joins')
              .eq('primary_domain', domain)
              .maybeSingle();
            if (orgMatch) {
              // Fetch member count for the detected org
              const { count: memberCount } = await supabase
                .from('organization_members')
                .select('id', { count: 'exact' })
                .eq('organization_id', orgMatch.id);
              setDetectedOrg({
                ...orgMatch,
                member_count: memberCount || 0,
                auto_approve: orgMatch.auto_approve_domain_joins || false,
              });
              setResolving(false);
              return;
            }
          }
        }

        // ── No match → go to org creation form ──
        setStep('org-form');
        // Pre-fill from signup metadata
        const metaCompanyName = user.user_metadata?.company_name || '';
        const metaCompanyWebsite = user.user_metadata?.company_website || '';
        if (profile.persona === 'marina') {
          setMarina(prev => ({ ...prev, marina_name: metaCompanyName, website: metaCompanyWebsite }));
        } else if (profile.persona === 'partner') {
          setPartner(prev => ({ ...prev, company_name: metaCompanyName, website: metaCompanyWebsite }));
        } else if (profile.persona === 'media_partner') {
          setMedia(prev => ({ ...prev, media_name: metaCompanyName, website: metaCompanyWebsite }));
        }
      } catch (err) {
        if (import.meta.env.DEV) console.error('Error resolving org:', err);
        setStep('org-form');
      }
      setResolving(false);
    };
    resolveOrg();
  }, [user, profile, needsPersonaSetup, hasOrganization]);

  /* ─── Post-invite profile completion ─── */
  const [showProfileCompletion, setShowProfileCompletion] = useState(false);
  const [profileForm, setProfileForm] = useState({ firstName: '', lastName: '', jobTitle: '' });
  const [savingProfile, setSavingProfile] = useState(false);

  /* ─── Accept invitation ─── */
  const handleAcceptInvitation = async () => {
    if (!pendingInvitation) return;
    setAcceptingInvite(true);
    try {
      const { error } = await supabase.rpc('accept_org_invitation', { p_invitation_id: pendingInvitation.invitation_id });
      if (error) throw error;
      clearStoredInvite();
      // Re-fetch profile to get updated state
      const { data: freshProfile } = await supabase.from('profiles').select('first_name, last_name').eq('user_id', user!.id).maybeSingle();
      await refreshProfile();
      toast({ title: 'Welcome!', description: `You've joined ${pendingInvitation.organization_name}` });
      // Only show completion form if name is truly missing (wasn't provided at signup)
      if (!freshProfile?.first_name || !freshProfile?.last_name) {
        setShowProfileCompletion(true);
      } else {
        navigate('/account');
      }
    } catch (err: unknown) {
      toast({ title: 'Error', description: err instanceof Error ? err.message : 'An unexpected error occurred.', variant: 'destructive' });
    }
    setAcceptingInvite(false);
  };

  const handleSaveProfileCompletion = async () => {
    if (!user) return;
    setSavingProfile(true);
    try {
      const { error } = await supabase.from('profiles').update({
        first_name: profileForm.firstName.trim() || null,
        last_name: profileForm.lastName.trim() || null,
        job_title: profileForm.jobTitle.trim() || null,
        onboarding_status: 'completed',
      }).eq('user_id', user.id);
      if (error) throw error;
      await refreshProfile();
      toast({ title: 'Profile updated!' });
      navigate('/account');
    } catch (err: unknown) {
      toast({ title: 'Error', description: err instanceof Error ? err.message : 'An unexpected error occurred.', variant: 'destructive' });
    }
    setSavingProfile(false);
  };

  /* ─── Request to join via domain match (pending owner approval or auto-approve) ─── */
  const handleRequestJoinOrg = async () => {
    if (!detectedOrg || !user) return;
    setRequestingJoin(true);
    try {
      // If org has auto-approve enabled, directly join instead of requesting
      if (detectedOrg.auto_approve) {
        // Check if already a member
        const { data: existing } = await supabase
          .from('organization_members')
          .select('id')
          .eq('organization_id', detectedOrg.id)
          .eq('user_id', user.id)
          .maybeSingle();
        if (!existing) {
          const { error } = await supabase
            .from('organization_members')
            .insert({ organization_id: detectedOrg.id, user_id: user.id, role: 'collaborator' });
          if (error) throw error;
        }
        // Check org verification status → auto-verify user if org is verified
        const { data: orgData } = await supabase
          .from('organizations')
          .select('access_status')
          .eq('id', detectedOrg.id)
          .single();
        if (orgData?.access_status === 'verified') {
          await supabase.from('profiles')
            .update({ access_status: 'verified', onboarding_status: 'completed' })
            .eq('user_id', user.id);
        } else {
          await supabase.from('profiles')
            .update({ onboarding_status: 'submitted' })
            .eq('user_id', user.id);
        }
        await refreshProfile();
        toast({ title: 'Welcome!', description: `You've automatically joined ${detectedOrg.name}.` });
        navigate('/account');
        return;
      }

      // Standard flow: create join request pending owner approval
      const { error } = await supabase.rpc('request_org_join', { p_organization_id: detectedOrg.id });
      if (error) throw error;

      // Notify org owner about the join request (in-app + email)
      const { data: ownerMember } = await supabase
        .from('organization_members')
        .select('user_id')
        .eq('organization_id', detectedOrg.id)
        .eq('role', 'owner')
        .maybeSingle();
      if (ownerMember?.user_id) {
        // Send email notification to owner
        sendNotification({
          type: 'join_request_received',
          userId: ownerMember.user_id,
          data: {
            org_name: detectedOrg.name,
            requester_name: `${profile?.first_name || ''} ${profile?.last_name || ''}`.trim() || user.email?.split('@')[0] || '',
            requester_email: user.email || '',
          },
        });
      }

      setJoinRequested(true);
      // Mark onboarding as submitted so user lands on account page with pending status
      await supabase.from('profiles').update({ onboarding_status: 'submitted' }).eq('user_id', user.id);
      await refreshProfile();
      toast({ title: 'Request sent!', description: `Your request to join ${detectedOrg.name} has been sent to the organization owner for approval.` });
    } catch (err: unknown) {
      toast({ title: 'Error', description: err instanceof Error ? err.message : 'An unexpected error occurred.', variant: 'destructive' });
    }
    setRequestingJoin(false);
  };

  /* ─── Join via domain match (legacy — kept for direct invitation acceptance) ─── */
  const handleJoinDetectedOrg = async () => {
    if (!detectedOrg || !user) return;
    setJoiningOrg(true);
    try {
      // Check if already a member
      const { data: existing } = await supabase
        .from('organization_members')
        .select('id')
        .eq('organization_id', detectedOrg.id)
        .eq('user_id', user.id)
        .maybeSingle();
      if (!existing) {
        const { error } = await supabase
          .from('organization_members')
          .insert({ organization_id: detectedOrg.id, user_id: user.id, role: 'collaborator' });
        if (error) throw error;
      }

      // Check if org is verified → auto-validate user
      const { data: orgData } = await supabase
        .from('organizations')
        .select('access_status')
        .eq('id', detectedOrg.id)
        .single();
      if (orgData?.access_status === 'verified') {
        await supabase.from('profiles')
          .update({ access_status: 'verified', onboarding_status: 'completed' })
          .eq('user_id', user.id);
      } else {
        await supabase.from('profiles')
          .update({ onboarding_status: 'submitted' })
          .eq('user_id', user.id);
      }

      await refreshProfile();
      toast({ title: 'Welcome!', description: `You've joined ${detectedOrg.name}` });
      navigate('/account');
    } catch (err: unknown) {
      toast({ title: 'Error', description: err instanceof Error ? err.message : 'An unexpected error occurred.', variant: 'destructive' });
    }
    setJoiningOrg(false);
  };

  /* ─── Persona selection (step 0) ─── */
  const handlePersonaSelect = async (persona: PersonaType) => {
    if (!user) return;
    setCreatingProfile(true);
    try {
      const { error: profileError } = await supabase.from('profiles').insert({
        user_id: user.id, persona, access_status: 'pending', onboarding_status: 'draft',
        job_title: user.user_metadata?.job_title || null,
      });
      if (profileError) throw profileError;
      await refreshProfile();
      toast({ title: 'Profile type selected', description: 'Now complete your organization profile.' });
    } catch (error: unknown) {
      toast({ title: 'Error', description: error instanceof Error ? error.message : 'Unable to create profile.', variant: 'destructive' });
    } finally {
      setCreatingProfile(false);
    }
  };

  /* ─── Marina helpers ─── */
  const updateMarina = (field: keyof MarinaOrgForm, value: MarinaOrgForm[keyof MarinaOrgForm]) => {
    setMarina(prev => ({ ...prev, [field]: value }));
  };
  const toggleCertification = (cert: string) => {
    setMarina(prev => ({
      ...prev,
      certifications: prev.certifications.includes(cert)
        ? prev.certifications.filter(c => c !== cert)
        : [...prev.certifications, cert],
    }));
  };
  const setFuturePlan = (sectorId: string, timeline: string) => {
    setFuturePlans(prev => {
      const next = { ...prev };
      if (timeline === '') { delete next[sectorId]; } else { next[sectorId] = timeline; }
      return next;
    });
  };
  const toggleSector = (id: string) => {
    setSelectedSectors(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]);
  };

  /* ─── Submit org form ─── */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !profile) return;
    setLoading(true);

    try {
      let createdOrgId = orgId;

      // ── Prevent duplicate organizations by domain ──
      const emailDomain = user.email?.split('@')[1]?.toLowerCase();
      const primaryDomain = emailDomain && !PUBLIC_DOMAINS.includes(emailDomain) ? emailDomain : null;

      if (!createdOrgId && primaryDomain) {
        const { data: existingOrg } = await supabase
          .from('organizations')
          .select('id, name')
          .eq('primary_domain', primaryDomain)
          .maybeSingle();
        if (existingOrg) {
          toast({
            title: 'Organization already exists',
            description: `An organization with the domain "${primaryDomain}" already exists (${existingOrg.name}). Please request to join it instead.`,
            variant: 'destructive',
          });
          setDetectedOrg(existingOrg);
          setStep('resolve');
          setLoading(false);
          return;
        }
      }

      if (profile.persona === 'marina') {
        if (!marina.marina_name || !marina.country || !marina.city || !marina.marina_type) {
          toast({ title: 'Required fields', description: 'Name, country, city and marina type are mandatory.', variant: 'destructive' });
          setLoading(false); return;
        }

        // Create organization if not already created
        if (!createdOrgId) {
          const { data: orgResult, error: orgErr } = await supabase.rpc('create_organization', {
            p_name: marina.marina_name,
            p_organization_type: 'marina',
            p_primary_domain: primaryDomain,
            p_website: marina.website || null,
            p_description: marina.marina_description || null,
            p_country: marina.country,
            p_city: marina.city,
          });
          if (orgErr) throw orgErr;
          createdOrgId = orgResult as string;
          setOrgId(createdOrgId);
          setOrgCreated(true);
        }

        // Update organization with extra fields
        await supabase.from('organizations').update({
          social_media_links: marina.social_media_links || null,
        }).eq('id', createdOrgId);

        // Upsert marina details
        const { error: detailsErr } = await supabase.from('organization_marina_details').upsert({
          organization_id: createdOrgId,
          marina_type: marina.marina_type,
          completion_date: marina.completion_date || null,
          berths_count: marina.berths_count ? parseInt(marina.berths_count) : null,
          superyacht_berths: marina.superyacht_berths ? parseInt(marina.superyacht_berths) : null,
          longest_berth_meters: marina.longest_berth_meters ? parseFloat(marina.longest_berth_meters) : null,
          fresh_water_available: marina.fresh_water_available,
          mix_range_boats: marina.mix_range_boats,
          mix_range_description: marina.mix_range_description || null,
          certifications: marina.certifications.length > 0 ? marina.certifications : null,
          certifications_other: marina.certifications_other || null,
          has_yacht_club: marina.has_yacht_club,
          yacht_club_members: marina.yacht_club_members ? parseInt(marina.yacht_club_members) : null,
          has_sailing_school: marina.has_sailing_school,
          has_boat_yard: marina.has_boat_yard,
          has_restaurants: marina.has_restaurants,
          restaurants_count: marina.restaurants_count ? parseInt(marina.restaurants_count) : null,
          has_concierge: marina.has_concierge,
          marina_description: marina.marina_description || null,
          services_description: marina.services_description || null,
        }, { onConflict: 'organization_id' });
        if (detailsErr) throw detailsErr;

        // Save interest sectors
        await supabase.from('organization_interest_sectors').delete().eq('organization_id', createdOrgId);
        if (selectedSectors.length > 0) {
          await supabase.from('organization_interest_sectors').insert(
            selectedSectors.map(s => ({ organization_id: createdOrgId!, sector_id: s }))
          );
        }

        // Save future plans
        await supabase.from('organization_future_plans').delete().eq('organization_id', createdOrgId);
        const planEntries = Object.entries(futurePlans).filter(([, tl]) => tl);
        if (planEntries.length > 0) {
          await supabase.from('organization_future_plans').insert(
            planEntries.map(([sectorId, timeline]) => ({ organization_id: createdOrgId!, sector_id: sectorId, timeline }))
          );
        }

      } else if (profile.persona === 'partner') {
        if (!partner.company_name || !partner.website || !partner.description) {
          toast({ title: 'Required fields', description: 'Name, website and description are mandatory.', variant: 'destructive' });
          setLoading(false); return;
        }

        if (!createdOrgId) {
          const { data: orgResult, error: orgErr } = await supabase.rpc('create_organization', {
            p_name: partner.company_name,
            p_organization_type: 'partner',
            p_primary_domain: primaryDomain,
            p_website: partner.website || null,
            p_description: partner.description || null,
            p_country: partner.headquarters_country || null,
            p_city: partner.city || null,
          });
          if (orgErr) throw orgErr;
          createdOrgId = orgResult as string;
          setOrgId(createdOrgId);
          setOrgCreated(true);
        }

        // Update extra org fields
        await supabase.from('organizations').update({
          headquarters_country: partner.headquarters_country || null,
        }).eq('id', createdOrgId);

        // Save service sectors
        await supabase.from('organization_service_sectors').delete().eq('organization_id', createdOrgId);
        if (selectedSectors.length > 0) {
          await supabase.from('organization_service_sectors').insert(
            selectedSectors.map(s => ({ organization_id: createdOrgId!, sector_id: s }))
          );
        }

      } else if (profile.persona === 'media_partner') {
        if (!media.media_name || !media.website) {
          toast({ title: 'Required fields', description: 'Media name and website are mandatory.', variant: 'destructive' });
          setLoading(false); return;
        }

        if (!createdOrgId) {
          const { data: orgResult, error: orgErr } = await supabase.rpc('create_organization', {
            p_name: media.media_name,
            p_organization_type: 'media_partner',
            p_primary_domain: primaryDomain,
            p_website: media.website || null,
            p_description: null,
            p_country: null,
            p_city: null,
          });
          if (orgErr) throw orgErr;
          createdOrgId = orgResult as string;
          setOrgId(createdOrgId);
          setOrgCreated(true);
        }

        // Update audience description
        await supabase.from('organizations').update({
          audience_description: media.audience_description || null,
        }).eq('id', createdOrgId);

      }

      // Mark org + profile as submitted
      if (createdOrgId) {
        await supabase.from('organizations').update({ onboarding_status: 'submitted' }).eq('id', createdOrgId);
      }
      await supabase.from('profiles').update({ onboarding_status: 'submitted' }).eq('user_id', user.id);

      setSubmitted(true);
      await refreshProfile();
      toast({ title: 'Organization profile submitted!', description: 'Your application is being reviewed.' });
      navigate('/account', { replace: true });
    } catch (error: unknown) {
      toast({ title: 'Error', description: error instanceof Error ? error.message : 'An error occurred.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  /* ─── Renders ─── */

  if (authLoading || submitted) {
    return <LoadingSkeleton variant="page" />;
  }

  // Synchronous redirect guard — prevent form from flashing before useEffect fires
  // Draft users go to /account to complete their profile from the Organization tab
  if (profile?.onboarding_status === 'draft' && profile?.access_status !== 'rejected') {
    return <div className="container mx-auto py-16 text-center"><Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" /><p className="text-sm text-gray-500 mt-3">{t('onboarding.redirecting')}</p></div>;
  }
  if (profile?.onboarding_status === 'completed' || (profile?.onboarding_status === 'submitted' && profile?.access_status !== 'rejected')) {
    return <div className="container mx-auto py-16 text-center"><Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" /></div>;
  }

  // Step 0: persona selection (rare — only if handle_new_user trigger didn't fire)
  if (needsPersonaSetup) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-primary mb-2">{t('onboarding.welcome')}</h1>
          <p className="text-gray-600">{t('onboarding.selectProfile')}</p>
        </div>
        <div className="space-y-4">
          {personaCards.map(p => (
            <button key={p.value} type="button" disabled={creatingProfile} onClick={() => handlePersonaSelect(p.value)}
              className="w-full flex items-center gap-5 p-6 rounded-xl border-2 border-gray-200 hover:border-primary hover:bg-primary/5 transition-all text-left group disabled:opacity-50">
              <div className="text-primary shrink-0">{p.icon}</div>
              <div className="flex-1">
                <div className="font-semibold text-lg text-gray-900 group-hover:text-primary">{p.title}</div>
                <div className="text-sm text-gray-500">{p.desc}</div>
              </div>
              <ChevronRight className="h-5 w-5 text-gray-300 group-hover:text-primary shrink-0" />
            </button>
          ))}
        </div>
        {creatingProfile && (
          <div className="mt-6 text-center text-gray-500 flex items-center justify-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> {t('onboarding.creatingProfile')}
          </div>
        )}
      </div>
    );
  }

  if (!profile) {
    return <div className="container mx-auto py-16 text-center"><Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" /></div>;
  }

  // Step 1: Organization resolution — invitation or domain match
  if (step === 'resolve' && !resolving && (pendingInvitation || detectedOrg)) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-primary mb-2">{t('onboarding.joinOrg')}</h1>
          <p className="text-gray-600">{t('onboarding.orgFound')}</p>
        </div>

        {pendingInvitation && !showProfileCompletion && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5 text-primary" />
                {t('onboarding.youveBeenInvited')}
              </CardTitle>
              <CardDescription>
                {pendingInvitation.invited_by_name} has invited you to join <strong>{pendingInvitation.organization_name}</strong>.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-primary/5 rounded-lg p-4 text-center">
                <Building2 className="h-10 w-10 text-primary mx-auto mb-2" />
                <div className="font-semibold text-lg">{pendingInvitation.organization_name}</div>
                <div className="text-sm text-gray-500">{t('onboarding.invitedBy', { name: pendingInvitation.invited_by_name })}</div>
              </div>
              <Button className="w-full" onClick={handleAcceptInvitation} disabled={acceptingInvite}>
                {acceptingInvite ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle className="h-4 w-4 mr-2" />}
                {t('onboarding.acceptJoin')}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Post-invitation profile completion form */}
        {showProfileCompletion && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle className="h-5 w-5 text-green-600" />
                {t('onboarding.completeProfile')}
              </CardTitle>
              <CardDescription>
                {t('onboarding.completeProfileDesc')}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>{t('onboarding.firstName')}</Label>
                  <Input
                    value={profileForm.firstName}
                    onChange={(e) => setProfileForm({ ...profileForm, firstName: e.target.value })}
                    placeholder={t('onboarding.firstNamePlaceholder')}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t('onboarding.lastName')}</Label>
                  <Input
                    value={profileForm.lastName}
                    onChange={(e) => setProfileForm({ ...profileForm, lastName: e.target.value })}
                    placeholder={t('onboarding.lastNamePlaceholder')}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>{t('onboarding.jobTitle')}</Label>
                <Input
                  value={profileForm.jobTitle}
                  onChange={(e) => setProfileForm({ ...profileForm, jobTitle: e.target.value })}
                  placeholder={t('onboarding.jobTitlePlaceholder')}
                />
              </div>
              <div className="flex gap-3">
                <Button
                  className="flex-1"
                  onClick={handleSaveProfileCompletion}
                  disabled={savingProfile || !profileForm.firstName.trim() || !profileForm.lastName.trim()}
                >
                  {savingProfile && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  {t('onboarding.saveContinue')}
                </Button>
                <Button variant="outline" onClick={() => navigate('/account')}>
                  {t('onboarding.skipForNow')}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {!pendingInvitation && detectedOrg && (
          <Card className="overflow-hidden">
            <CardHeader className={joinRequested ? 'bg-amber-50/50' : 'bg-primary/5'}>
              <CardTitle className="flex items-center gap-2">
                {joinRequested ? (
                  <Clock className="h-5 w-5 text-amber-600" />
                ) : (
                  <Building2 className="h-5 w-5 text-primary" />
                )}
                {joinRequested ? 'Join Request Sent' : 'Organization Found'}
              </CardTitle>
              <CardDescription>
                {joinRequested
                  ? 'Your request is pending approval from the organization owner.'
                  : 'We found an organization matching your email domain. Join your team instead of creating a new profile.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5 pt-6">
              {/* Org card with logo, name, tier, member count */}
              <div className={`rounded-xl p-5 text-center border ${joinRequested ? 'bg-amber-50/50 border-amber-200' : 'bg-gray-50 border-gray-200'}`}>
                {detectedOrg.logo_url ? (
                  <img src={detectedOrg.logo_url} alt={detectedOrg.name} className="h-16 w-16 rounded-lg object-cover mx-auto mb-3 border border-gray-200" />
                ) : (
                  <div className="h-16 w-16 rounded-lg bg-primary/10 flex items-center justify-center mx-auto mb-3">
                    <Building2 className={`h-8 w-8 ${joinRequested ? 'text-amber-500' : 'text-primary'}`} />
                  </div>
                )}
                <div className="font-bold text-xl text-gray-900">{detectedOrg.name}</div>
                <div className="flex items-center justify-center gap-3 mt-2 text-sm text-gray-500">
                  {detectedOrg.member_count !== undefined && (
                    <span className="flex items-center gap-1">
                      <Users className="h-3.5 w-3.5" />
                      {detectedOrg.member_count} member{detectedOrg.member_count !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
                {joinRequested && (
                  <div className="mt-3 text-sm text-amber-700 bg-amber-100/60 rounded-lg px-3 py-2">
                    The organization owner has been notified by email. You'll receive an email when your request is approved.
                  </div>
                )}
                {!joinRequested && detectedOrg.auto_approve && (
                  <div className="mt-3 text-sm text-green-700 bg-green-100/60 rounded-lg px-3 py-2 flex items-center justify-center gap-1.5">
                    <CheckCircle className="h-3.5 w-3.5" />
                    This organization accepts new members automatically
                  </div>
                )}
              </div>

              {joinRequested ? (
                <Button className="w-full" onClick={() => navigate('/account')}>
                  <CheckCircle className="h-4 w-4 mr-2" />
                  Go to My Account
                </Button>
              ) : (
                <div className="space-y-3">
                  <Button className="w-full" size="lg" onClick={handleRequestJoinOrg} disabled={requestingJoin}>
                    {requestingJoin ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
                    {detectedOrg.auto_approve ? `Join ${detectedOrg.name}` : `Request to Join ${detectedOrg.name}`}
                  </Button>
                  <button
                    type="button"
                    onClick={() => { setDetectedOrg(null); setStep('org-form'); }}
                    className="w-full text-center text-sm text-gray-400 hover:text-gray-600 transition-colors py-2"
                  >
                    I want to create a new organization instead
                  </button>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  if (resolving) {
    return (
      <div className="container mx-auto py-16 text-center">
        <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
        <p className="text-gray-500 mt-2">{t('onboarding.checkingOrg')}</p>
        <Button variant="link" className="mt-4 text-sm" onClick={() => { setResolving(false); setStep('org-form'); }}>
          {t('onboarding.takingTooLong')}
        </Button>
      </div>
    );
  }

  // Step 2: Organization creation form
  return (
    <div className="container mx-auto px-4 py-8 max-w-3xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-primary mb-2">{t('onboarding.createOrgProfile')}</h1>
        <p className="text-gray-600">
          {t('onboarding.orgProfileDesc')}{' '}
          <span className="font-medium">
            {profile.persona === 'marina' ? t('onboarding.orgProfileDescMarina') : profile.persona === 'partner' ? t('onboarding.orgProfileDescPartner') : t('onboarding.orgProfileDescMedia')}
          </span>{' '}{t('onboarding.orgProfileDescSuffix')}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">

        {/* ════════════════════════════════════════════════════════
            ██  MARINA ORGANIZATION FORM
            ════════════════════════════════════════════════════════ */}
        {profile.persona === 'marina' && (
          <>
            {/* ── Section 1: General Information ── */}
            <Card>
              <CardHeader>
                <CardTitle>{t('onboarding.marinaForm.generalInfo')}</CardTitle>
                <CardDescription>{t('onboarding.marinaForm.basicDetails')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="space-y-2">
                  <Label>{t('onboarding.marinaForm.marinaName')}</Label>
                  <Input value={marina.marina_name} onChange={e => updateMarina('marina_name', e.target.value)} required placeholder={t('onboarding.marinaForm.marinaNamePlaceholder')} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>{t('onboarding.marinaForm.country')}</Label>
                    <Select value={marina.country} onValueChange={v => updateMarina('country', v)}>
                      <SelectTrigger><SelectValue placeholder={t('onboarding.marinaForm.selectPlaceholder')} /></SelectTrigger>
                      <SelectContent>{countries.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>{t('onboarding.marinaForm.city')}</Label>
                    <Input value={marina.city} onChange={e => updateMarina('city', e.target.value)} required placeholder={t('onboarding.marinaForm.cityPlaceholder')} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>{t('onboarding.marinaForm.website')}</Label>
                  <Input type="url" value={marina.website} onChange={e => updateMarina('website', e.target.value)} placeholder={t('onboarding.marinaForm.websitePlaceholder')} />
                </div>
                <div className="space-y-2">
                  <Label>{t('onboarding.marinaForm.marinaType')}</Label>
                  <RadioGroup value={marina.marina_type} onValueChange={v => updateMarina('marina_type', v)} className="flex flex-wrap gap-4">
                    {[
                      { value: 'in_operation', label: t('onboarding.marinaForm.inOperation') },
                      { value: 'under_construction', label: t('onboarding.marinaForm.underConstruction') },
                      { value: 'in_project', label: t('onboarding.marinaForm.inProject') },
                    ].map(opt => (
                      <div key={opt.value} className="flex items-center space-x-2">
                        <RadioGroupItem value={opt.value} id={`mt-${opt.value}`} />
                        <Label htmlFor={`mt-${opt.value}`} className="font-normal cursor-pointer">{opt.label}</Label>
                      </div>
                    ))}
                  </RadioGroup>
                </div>
                {(marina.marina_type === 'under_construction' || marina.marina_type === 'in_project') && (
                  <div className="space-y-2">
                    <Label>{t('onboarding.marinaForm.completionDate')}</Label>
                    <Input type="date" value={marina.completion_date} onChange={e => updateMarina('completion_date', e.target.value)} />
                  </div>
                )}
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label>{t('onboarding.marinaForm.totalBerths')}</Label>
                    <Input type="number" min="0" value={marina.berths_count} onChange={e => updateMarina('berths_count', e.target.value)} placeholder="500" />
                  </div>
                  <div className="space-y-2">
                    <Label>{t('onboarding.marinaForm.superyachtBerths')}</Label>
                    <Input type="number" min="0" value={marina.superyacht_berths} onChange={e => updateMarina('superyacht_berths', e.target.value)} placeholder="20" />
                  </div>
                  <div className="space-y-2">
                    <Label>{t('onboarding.marinaForm.longestBerth')}</Label>
                    <Input type="number" min="0" step="0.1" value={marina.longest_berth_meters} onChange={e => updateMarina('longest_berth_meters', e.target.value)} placeholder="100" />
                  </div>
                </div>
                <div className="flex items-center space-x-3">
                  <Checkbox id="fresh-water" checked={marina.fresh_water_available} onCheckedChange={c => updateMarina('fresh_water_available', !!c)} />
                  <Label htmlFor="fresh-water" className="font-normal cursor-pointer">{t('onboarding.marinaForm.freshWater')}</Label>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center space-x-3">
                    <Checkbox id="mix-range" checked={marina.mix_range_boats} onCheckedChange={c => updateMarina('mix_range_boats', !!c)} />
                    <Label htmlFor="mix-range" className="font-normal cursor-pointer">{t('onboarding.marinaForm.mixRange')}</Label>
                  </div>
                  {marina.mix_range_boats && (
                    <Input value={marina.mix_range_description} onChange={e => updateMarina('mix_range_description', e.target.value)}
                      placeholder={t('onboarding.marinaForm.mixRangePlaceholder')} className="mt-2" />
                  )}
                </div>
                <div className="space-y-2">
                  <Label>{t('onboarding.marinaForm.certifications')}</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {certificationOptions.map(cert => (
                      <div key={cert} className="flex items-center space-x-2">
                        <Checkbox id={`cert-${cert}`} checked={marina.certifications.includes(cert)} onCheckedChange={() => toggleCertification(cert)} />
                        <Label htmlFor={`cert-${cert}`} className="text-sm font-normal cursor-pointer">{cert}</Label>
                      </div>
                    ))}
                  </div>
                  <Input value={marina.certifications_other} onChange={e => updateMarina('certifications_other', e.target.value)}
                    placeholder={t('onboarding.marinaForm.otherCertifications')} className="mt-2" />
                </div>
              </CardContent>
            </Card>

            {/* ── Section 2: Facilities & Amenities ── */}
            <Card>
              <CardHeader>
                <CardTitle>{t('onboarding.marinaFacilities.title')}</CardTitle>
                <CardDescription>{t('onboarding.marinaFacilities.subtitle')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <Checkbox id="yacht-club" checked={marina.has_yacht_club} onCheckedChange={c => updateMarina('has_yacht_club', !!c)} />
                      <Label htmlFor="yacht-club" className="font-normal cursor-pointer">{t('onboarding.marinaFacilities.yachtClub')}</Label>
                    </div>
                    {marina.has_yacht_club && (
                      <div className="flex items-center gap-2">
                        <Input type="number" min="0" value={marina.yacht_club_members} onChange={e => updateMarina('yacht_club_members', e.target.value)}
                          placeholder="0" className="w-24" />
                        <span className="text-sm text-gray-500">members</span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center space-x-3">
                    <Checkbox id="sailing-school" checked={marina.has_sailing_school} onCheckedChange={c => updateMarina('has_sailing_school', !!c)} />
                    <Label htmlFor="sailing-school" className="font-normal cursor-pointer">{t('onboarding.marinaFacilities.sailingSchool')}</Label>
                  </div>
                  <div className="flex items-center space-x-3">
                    <Checkbox id="boat-yard" checked={marina.has_boat_yard} onCheckedChange={c => updateMarina('has_boat_yard', !!c)} />
                    <Label htmlFor="boat-yard" className="font-normal cursor-pointer">{t('onboarding.marinaFacilities.boatYard')}</Label>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <Checkbox id="restaurants" checked={marina.has_restaurants} onCheckedChange={c => updateMarina('has_restaurants', !!c)} />
                      <Label htmlFor="restaurants" className="font-normal cursor-pointer">{t('onboarding.marinaFacilities.restaurants')}</Label>
                    </div>
                    {marina.has_restaurants && (
                      <div className="flex items-center gap-2">
                        <Input type="number" min="1" value={marina.restaurants_count} onChange={e => updateMarina('restaurants_count', e.target.value)}
                          placeholder="0" className="w-20" />
                        <span className="text-sm text-gray-500">restaurants</span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center space-x-3">
                    <Checkbox id="concierge" checked={marina.has_concierge} onCheckedChange={c => updateMarina('has_concierge', !!c)} />
                    <Label htmlFor="concierge" className="font-normal cursor-pointer">{t('onboarding.marinaFacilities.concierge')}</Label>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* ── Section 3: Descriptions & Media ── */}
            <Card>
              <CardHeader>
                <CardTitle>{t('onboarding.marinaDescriptions.title')}</CardTitle>
                <CardDescription>{t('onboarding.marinaDescriptions.subtitle')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="space-y-2">
                  <Label>{t('onboarding.marinaDescriptions.description')}</Label>
                  <Textarea value={marina.marina_description} onChange={e => updateMarina('marina_description', e.target.value)}
                    rows={4} placeholder={t('onboarding.marinaDescriptions.descriptionPlaceholder')} />
                </div>
                <div className="space-y-2">
                  <Label>{t('onboarding.marinaDescriptions.servicesDescription')}</Label>
                  <Textarea value={marina.services_description} onChange={e => updateMarina('services_description', e.target.value)}
                    rows={4} placeholder={t('onboarding.marinaDescriptions.servicesPlaceholder')} />
                </div>
                <div className="space-y-2">
                  <Label>{t('onboarding.marinaDescriptions.socialMedia')}</Label>
                  <Input value={marina.social_media_links} onChange={e => updateMarina('social_media_links', e.target.value)}
                    placeholder={t('onboarding.marinaDescriptions.socialMediaPlaceholder')} />
                </div>
              </CardContent>
            </Card>

            {/* ── Section 4: Future Plans ── */}
            <Card>
              <CardHeader>
                <CardTitle>{t('onboarding.marinaFuturePlans.title')}</CardTitle>
                <CardDescription>
                  {t('onboarding.marinaFuturePlans.subtitle')}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-3 mb-4 text-xs text-gray-500">
                  {timelineOptions.map(t => (
                    <span key={t.value} className="bg-gray-100 px-2 py-1 rounded">{t.label}</span>
                  ))}
                </div>
                <div className="space-y-1 max-h-[600px] overflow-y-auto">
                  {sectors.map(sector => (
                    <div key={sector.id} className="flex items-center gap-3 py-2 px-2 rounded hover:bg-gray-50 border-b border-gray-100 last:border-0">
                      <span className="text-sm flex-1 min-w-0 truncate" title={sector.label}>{sector.label}</span>
                      <div className="flex gap-1 shrink-0">
                        {timelineOptions.map(t => (
                          <button key={t.value} type="button"
                            onClick={() => setFuturePlan(sector.id, futurePlans[sector.id] === t.value ? '' : t.value)}
                            title={t.label}
                            className={`px-2 py-1 text-xs rounded border transition-colors ${
                              futurePlans[sector.id] === t.value
                                ? 'bg-primary text-white border-primary'
                                : 'bg-white text-gray-500 border-gray-200 hover:border-primary hover:text-primary'
                            }`}
                          >
                            {t.label.replace(' months', 'm').replace(' years', 'y').replace('Immediate', 'Now')}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                {sectors.length === 0 && <p className="text-sm text-gray-400 text-center py-4">{t('onboarding.marinaFuturePlans.loadingSectors')}</p>}
              </CardContent>
            </Card>
          </>
        )}

        {/* ════════════════════════════════════════════════════════
            ██  PARTNER ORGANIZATION FORM
            ════════════════════════════════════════════════════════ */}
        {profile.persona === 'partner' && (
          <Card>
            <CardHeader>
              <CardTitle>{t('onboarding.partnerForm.title')}</CardTitle>
              <CardDescription>{t('onboarding.partnerForm.subtitle')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label>{t('onboarding.partnerForm.companyName')}</Label>
                <Input value={partner.company_name} onChange={e => setPartner({ ...partner, company_name: e.target.value })} required placeholder={t('onboarding.partnerForm.companyNamePlaceholder')} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t('onboarding.partnerForm.headquartersCountry')}</Label>
                  <Select value={partner.headquarters_country} onValueChange={v => setPartner({ ...partner, headquarters_country: v })}>
                    <SelectTrigger><SelectValue placeholder={t('onboarding.marinaForm.selectPlaceholder')} /></SelectTrigger>
                    <SelectContent>{countries.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t('onboarding.partnerForm.city')}</Label>
                  <Input value={partner.city} onChange={e => setPartner({ ...partner, city: e.target.value })} placeholder={t('onboarding.partnerForm.cityPlaceholder')} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>{t('onboarding.partnerForm.website')}</Label>
                <Input type="url" value={partner.website} onChange={e => setPartner({ ...partner, website: e.target.value })} required placeholder={t('onboarding.partnerForm.websitePlaceholder')} />
              </div>
              <div className="space-y-2">
                <Label>{t('onboarding.partnerForm.description')}</Label>
                <Textarea value={partner.description} onChange={e => setPartner({ ...partner, description: e.target.value })} rows={4} required
                  placeholder={t('onboarding.partnerForm.descriptionPlaceholder')} />
              </div>
              <div className="space-y-2">
                <Label>{t('onboarding.partnerForm.socialMedia')}</Label>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-xs text-gray-500">{t('onboarding.socialLabels.linkedin')}</Label>
                    <Input value={partner.social_media_links.linkedin} onChange={e => setPartner({ ...partner, social_media_links: { ...partner.social_media_links, linkedin: e.target.value } })} placeholder="https://linkedin.com/company/..." />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs text-gray-500">{t('onboarding.socialLabels.twitter')}</Label>
                    <Input value={partner.social_media_links.twitter} onChange={e => setPartner({ ...partner, social_media_links: { ...partner.social_media_links, twitter: e.target.value } })} placeholder="https://x.com/..." />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs text-gray-500">{t('onboarding.socialLabels.instagram')}</Label>
                    <Input value={partner.social_media_links.instagram} onChange={e => setPartner({ ...partner, social_media_links: { ...partner.social_media_links, instagram: e.target.value } })} placeholder="https://instagram.com/..." />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs text-gray-500">{t('onboarding.socialLabels.facebook')}</Label>
                    <Input value={partner.social_media_links.facebook} onChange={e => setPartner({ ...partner, social_media_links: { ...partner.social_media_links, facebook: e.target.value } })} placeholder="https://facebook.com/..." />
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <Label>{t('onboarding.partnerForm.serviceSectors')}</Label>
                <p className="text-xs text-gray-500">{t('onboarding.partnerForm.serviceSectorsHint')}</p>
                <div className="grid grid-cols-2 gap-2 max-h-60 overflow-y-auto border rounded-lg p-3">
                  {sectors.map(s => (
                    <div key={s.id} className="flex items-center space-x-2">
                      <Checkbox id={`ps-${s.id}`} checked={selectedSectors.includes(s.id)} onCheckedChange={() => toggleSector(s.id)} />
                      <Label htmlFor={`ps-${s.id}`} className="text-sm cursor-pointer font-normal">{s.label}</Label>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ════════════════════════════════════════════════════════
            ██  MEDIA ORGANIZATION FORM
            ════════════════════════════════════════════════════════ */}
        {profile.persona === 'media_partner' && (
          <Card>
            <CardHeader>
              <CardTitle>{t('onboarding.mediaForm.title')}</CardTitle>
              <CardDescription>{t('onboarding.mediaForm.subtitle')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label>{t('onboarding.mediaForm.mediaName')}</Label>
                <Input value={media.media_name} onChange={e => setMedia({ ...media, media_name: e.target.value })} required placeholder={t('onboarding.mediaForm.mediaNamePlaceholder')} />
              </div>
              <div className="space-y-2">
                <Label>{t('onboarding.mediaForm.website')}</Label>
                <Input type="url" value={media.website} onChange={e => setMedia({ ...media, website: e.target.value })} required placeholder={t('onboarding.mediaForm.websitePlaceholder')} />
              </div>
              <div className="space-y-2">
                <Label>{t('onboarding.mediaForm.audienceDescription')}</Label>
                <Textarea value={media.audience_description} onChange={e => setMedia({ ...media, audience_description: e.target.value })}
                  rows={4} placeholder={t('onboarding.mediaForm.audiencePlaceholder')} />
              </div>
              <div className="space-y-2">
                <Label>{t('onboarding.mediaForm.socialMedia')}</Label>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-xs text-gray-500">{t('onboarding.socialLabels.linkedin')}</Label>
                    <Input value={media.social_media_links.linkedin} onChange={e => setMedia({ ...media, social_media_links: { ...media.social_media_links, linkedin: e.target.value } })} placeholder="https://linkedin.com/company/..." />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs text-gray-500">{t('onboarding.socialLabels.twitter')}</Label>
                    <Input value={media.social_media_links.twitter} onChange={e => setMedia({ ...media, social_media_links: { ...media.social_media_links, twitter: e.target.value } })} placeholder="https://x.com/..." />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs text-gray-500">{t('onboarding.socialLabels.instagram')}</Label>
                    <Input value={media.social_media_links.instagram} onChange={e => setMedia({ ...media, social_media_links: { ...media.social_media_links, instagram: e.target.value } })} placeholder="https://instagram.com/..." />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs text-gray-500">{t('onboarding.socialLabels.facebook')}</Label>
                    <Input value={media.social_media_links.facebook} onChange={e => setMedia({ ...media, social_media_links: { ...media.social_media_links, facebook: e.target.value } })} placeholder="https://facebook.com/..." />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Submit button ── */}
        <Button type="submit" className="w-full" size="lg" disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle className="h-4 w-4 mr-2" />}
          {loading ? t('onboarding.submitting') : t('onboarding.submitOrgProfile')}
        </Button>
      </form>
    </div>
  );
}
