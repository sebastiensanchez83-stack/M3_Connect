import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
// The field kit of the sign-in screens: same names as the shadcn ones, 48 px / 12 px radius.
import { AuthInput as Input, AuthLabel as Label, AuthTextarea as Textarea, AuthSelectTrigger as SelectTrigger, AuthNotice, AuthSection, CTA_WRAP } from '@/components/auth/fields';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Loader2, CheckCircle, ArrowRight, Anchor, Briefcase, Newspaper, Building2, Users, Clock, Send, KeyRound } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { AuthLoading, AuthShell, AuthStatus, AuthSteps } from '@/components/auth/AuthShell';
import { PageHero } from '@/components/ui/PageHero';
import { UnderlineLink } from '@/components/brand/UnderlineLink';
import { HelpTip } from '@/components/help/HelpTip';
import { SITE_IMAGES } from '@/lib/siteMedia';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { Sector, PersonaType, PendingInvitationResult } from '@/types/database';
import { toast } from '@/hooks/use-toast';
import { getStoredInvite, clearStoredInvite } from '@/lib/invite-store';
import { sendNotification } from '@/lib/notifications';
import { COUNTRIES } from '@/lib/countries';

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
const countries = COUNTRIES;

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

const personaCards: { value: PersonaType; icon: JSX.Element; title: string; desc: string }[] = [
  { value: 'marina', icon: <Anchor className="h-8 w-8" />, title: 'Marina', desc: 'I manage or represent a marina or port.' },
  { value: 'partner', icon: <Briefcase className="h-8 w-8" />, title: 'Service provider', desc: 'I provide products or services to marinas.' },
  { value: 'media_partner', icon: <Newspaper className="h-8 w-8" />, title: 'Media', desc: 'I represent a media outlet covering marinas and yachting.' },
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
  // M3-vetted accounts (e.g. SM26-provisioned) arrive here already verified +
  // completed. Submitting the org form must NEVER regress them to 'submitted'
  // — that strands them as verified+submitted, a state with no admin approve
  // action, locked out of pages that require onboarding completed.
  const alreadyVerified = profile?.access_status === 'verified';
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

  // Claim code state — auto-fill from URL param or sessionStorage (set by SignupForm)
  const [claimCode, setClaimCode] = useState(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const urlCode = params.get('code');
      if (urlCode) return urlCode;
      const stored = sessionStorage.getItem('pending_claim_code');
      if (stored) {
        sessionStorage.removeItem('pending_claim_code');
        return stored;
      }
    } catch { /* ignore */ }
    return '';
  });
  const [claimingOrg, setClaimingOrg] = useState(false);

  // Marina org form
  const [marina, setMarina] = useState<MarinaOrgForm>(defaultMarinaForm);
  const [futurePlans, setFuturePlans] = useState<Record<string, string>>({});

  // Partner org form
  const [partner, setPartner] = useState({ company_name: '', website: '', headquarters_country: '', city: '', description: '', social_media_links: { linkedin: '', twitter: '', instagram: '', facebook: '' } });

  // Media org form
  const [media, setMedia] = useState({ media_name: '', website: '', audience_description: '', social_media_links: { linkedin: '', twitter: '', instagram: '', facebook: '' } });

  // Duplicate-company guard: if the typed company name already exists as an org,
  // surface it so the user joins (via the owner / events@m3monaco.com) instead of
  // creating a duplicate. Authenticated normalized-exact match (no enumeration).
  const [nameMatch, setNameMatch] = useState<{ org_id: string; org_name: string; owner_name: string | null } | null>(null);
  useEffect(() => {
    const name = (marina.marina_name || partner.company_name || media.media_name || '').trim();
    if (name.length < 3) { setNameMatch(null); return; }
    const tmr = setTimeout(async () => {
      const { data } = await supabase.rpc('sm_org_name_match', { p_name: name });
      const m = Array.isArray(data) ? data[0] : data;
      setNameMatch((m as { org_id: string; org_name: string; owner_name: string | null }) || null);
    }, 500);
    return () => clearTimeout(tmr);
  }, [marina.marina_name, partner.company_name, media.media_name]);

  const needsPersonaSetup = !authLoading && !!user && !profile;

  // Handle email_confirmed query param (user arriving from confirmation link)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('email_confirmed') === 'true') {
      toast({ title: '✉️ Email confirmed!', description: 'Your email has been verified. Let\'s complete your registration.' });
      // Clean URL
      const url = new URL(window.location.href);
      url.searchParams.delete('email_confirmed');
      window.history.replaceState({}, '', url.pathname);
    }
  }, []);

  // Load sectors independently (not inside navigation guards so it always runs)
  useEffect(() => {
    supabase.from('sectors').select('*').eq('is_active', true).order('label')
      .then(({ data }) => { if (data) setSectors(data as Sector[]); });
  }, []);

  // Auto-claim org if user arrives with a pending claim code (from email link / SignupForm)
  // Runs once after user + profile are loaded
  const autoClaimAttemptedRef = useRef(false);
  useEffect(() => {
    if (autoClaimAttemptedRef.current) return;
    if (authLoading || !user || !profile || !claimCode.trim() || submitted) return;
    autoClaimAttemptedRef.current = true;

    (async () => {
      setClaimingOrg(true);
      try {
        const { data, error } = await supabase.rpc('claim_organization', { p_claim_code: claimCode.trim() });
        if (error) throw error;
        const result = data as { organization_id: string; organization_name: string; role: string };
        await refreshProfile();
        toast({ title: 'Welcome!', description: `You've joined ${result.organization_name} as ${result.role}. Setup complete.` });
        setSubmitted(true);
        navigate('/account', { replace: true });
      } catch (err: unknown) {
        // If auto-claim fails (e.g. already a member), just stay on onboarding — user can retry manually
        const msg = err instanceof Error ? err.message : 'Unable to auto-claim';
        console.warn('Auto-claim failed:', msg);
      }
      setClaimingOrg(false);
    })();
  }, [authLoading, user, profile, claimCode, submitted, refreshProfile, navigate]);

  /* ─── Navigation guards ─── */
  // If user has a pending invite token, STAY on onboarding to resolve it.
  // Otherwise redirect to /account as normal.
  const hasPendingInvite = !!getStoredInvite();

  useEffect(() => {
    if (authLoading || submitted) return;
    if (!user) { navigate('/'); return; }

    // If there's a pending invite, skip ALL redirects — let resolveOrg handle it
    if (hasPendingInvite) return;

    // While resolving org (checking invites/domain match), don't redirect
    if (resolving) return;

    // If resolve step found a domain match or pending invitation, stay on onboarding
    if (step === 'resolve' && (detectedOrg || pendingInvitation || joinRequested)) return;

    // Completed or submitted → always go to account
    if (profile?.onboarding_status === 'completed') { navigate('/account', { replace: true }); return; }
    if (profile?.onboarding_status === 'submitted' && profile?.access_status !== 'rejected') {
      navigate('/account', { replace: true }); return;
    }
    // Draft status — only redirect if resolve step didn't find a match (step moved to 'org-form')
    if (profile?.onboarding_status === 'draft' && profile?.access_status !== 'rejected' && step === 'org-form') {
      navigate('/account?tab=organization', { replace: true }); return;
    }
    // If already has org, redirect to account
    if (hasOrganization) {
      navigate('/account', { replace: true }); return;
    }
    // If AuthContext didn't load org (timeout), double-check directly
    if (profile && !hasOrganization && step === 'org-form') {
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
  }, [user, profile, authLoading, hasOrganization, submitted, hasPendingInvite, resolving, step, detectedOrg, pendingInvitation, joinRequested, navigate]);

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

        // ── Domain-match check removed: users can create a new org even if
        //    another org exists with the same email domain. Priority 1\u20133 (invites
        //    and pending join requests) still take precedence.

        // ── No match → go to org creation form ──
        setStep('org-form');
        // Pre-fill from signup metadata
        const metaCompanyName = user.user_metadata?.company_name || '';
        const metaCompanyWebsite = user.user_metadata?.company_website || '';
        if (profile.persona === 'marina') {
          setMarina(prev => ({ ...prev, marina_name: metaCompanyName, website: metaCompanyWebsite }));
        } else if (profile.persona === 'partner' || profile.persona === 'developer' || profile.persona === 'investor') {
          // Developer and Investor reuse the partner form shape (basic org info + sectors)
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
        // Check seat availability before joining
        const { data: orgInfo } = await supabase
          .from('organizations')
          .select('max_seats, access_status')
          .eq('id', detectedOrg.id)
          .single();
        const { count: currentMembers } = await supabase
          .from('organization_members')
          .select('id', { count: 'exact' })
          .eq('organization_id', detectedOrg.id);
        if (orgInfo && orgInfo.max_seats > 0 && (currentMembers || 0) >= orgInfo.max_seats) {
          toast({ title: 'Team capacity reached', description: `${detectedOrg.name} has no available seats. Your join request will be sent to the organization owner instead.`, variant: 'destructive' });
          // Fall through to standard join-request flow below
        } else {
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
          // Auto-verify user if org is verified
          if (orgInfo?.access_status === 'verified') {
            await supabase.from('profiles')
              .update({ access_status: 'verified', onboarding_status: 'completed' })
              .eq('user_id', user.id);
          } else if (!alreadyVerified) {
            await supabase.from('profiles')
              .update({ onboarding_status: 'submitted' })
              .eq('user_id', user.id);
          }
          await refreshProfile();
          toast({ title: 'Welcome!', description: `You've automatically joined ${detectedOrg.name}.` });
          // Small delay so toast is visible before navigation
          setTimeout(() => navigate('/account'), 600);
          return;
        }
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
      // Mark onboarding as submitted so user lands on account page with pending
      // status — unless they're already verified (never regress those).
      if (!alreadyVerified) {
        await supabase.from('profiles').update({ onboarding_status: 'submitted' }).eq('user_id', user.id);
      }
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
      } else if (!alreadyVerified) {
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

  /* ─── Claim organization via code ─── */
  const handleClaimOrg = async () => {
    if (!claimCode.trim()) return;
    setClaimingOrg(true);
    try {
      const { data, error } = await supabase.rpc('claim_organization', { p_claim_code: claimCode.trim() });
      if (error) throw error;
      const result = data as { organization_id: string; organization_name: string; role: string };
      await refreshProfile();
      toast({ title: 'Welcome!', description: `You've joined ${result.organization_name} as ${result.role}.` });
      setSubmitted(true);
      navigate('/account', { replace: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Invalid code';
      toast({ title: 'Invalid organization code', description: msg, variant: 'destructive' });
    }
    setClaimingOrg(false);
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

      // Never infer primary_domain from the signer's e-mail. Two server-side
      // rules make that inference a dead end at the very last click, after the
      // whole form has been filled: create_organization rejects public domains
      // (gmail/outlook/\u2026), and organizations.primary_domain carries a UNIQUE
      // index, so a corporate domain already used by another org fails with a
      // raw 23505. Multiple organizations legitimately share a mail suffix
      // anyway (e.g. two marinas under one holding). The domain is set later by
      // the owner or an admin, where it can be handled interactively.
      const primaryDomain: string | null = null;

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

      } else if (profile.persona === 'partner' || profile.persona === 'developer' || profile.persona === 'investor') {
        // Partner, Developer, and Investor all use the same lightweight form
        // shape (basic org info + sectors). They differ in:
        //   - organization_type stored on the org row
        //   - sector table they populate: service vs interest
        const usesInterest = profile.persona === 'developer' || profile.persona === 'investor';
        const sectorTable = usesInterest ? 'organization_interest_sectors' : 'organization_service_sectors';

        if (!partner.company_name || !partner.website || !partner.description) {
          toast({ title: 'Required fields', description: 'Name, website and description are mandatory.', variant: 'destructive' });
          setLoading(false); return;
        }

        if (!createdOrgId) {
          const { data: orgResult, error: orgErr } = await supabase.rpc('create_organization', {
            p_name: partner.company_name,
            p_organization_type: profile.persona,
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

        // Save sectors (interest for developer/investor, service for partner)
        await supabase.from(sectorTable).delete().eq('organization_id', createdOrgId);
        if (selectedSectors.length > 0) {
          await supabase.from(sectorTable).insert(
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

      // Mark org + profile as submitted for review. Already-verified users
      // (SM26-provisioned) never regress: profile stays completed and their
      // new org is auto-verified server-side by create_organization.
      if (createdOrgId) {
        await supabase.from('organizations').update({ onboarding_status: alreadyVerified ? 'completed' : 'submitted' }).eq('id', createdOrgId);
      }
      await supabase.from('profiles').update({ onboarding_status: alreadyVerified ? 'completed' : 'submitted' }).eq('user_id', user.id);

      setSubmitted(true);
      await refreshProfile();
      toast(alreadyVerified
        ? { title: 'Organization created!', description: 'Your company is set up and live on the platform.' }
        : { title: 'Organization profile submitted!', description: 'Your application is being reviewed.' });
      navigate('/account', { replace: true });
    } catch (error: unknown) {
      toast({ title: 'Error', description: error instanceof Error ? error.message : 'An error occurred.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  /* ─── Renders ─── */

  if (authLoading || submitted) {
    return <AuthLoading />;
  }

  // Synchronous redirect guard — prevent form from flashing before useEffect fires
  // BUT: if we're still resolving or found a domain/invitation match, let the resolve UI show
  if (profile?.onboarding_status === 'draft' && profile?.access_status !== 'rejected'
      && !resolving && !detectedOrg && !pendingInvitation && !joinRequested && step === 'org-form') {
    return <AuthLoading label={t('onboarding.redirecting')} />;
  }
  if (profile?.onboarding_status === 'completed' || (profile?.onboarding_status === 'submitted' && profile?.access_status !== 'rejected')) {
    return <AuthLoading />;
  }

  // Step 0: persona selection (rare — only if handle_new_user trigger didn't fire)
  if (needsPersonaSetup) {
    return (
      <AuthShell step={1} title={t('onboarding.welcome')} lead={t('onboarding.selectProfile')}>
        <div className="space-y-3">
          {personaCards.map(p => (
            <button key={p.value} type="button" disabled={creatingProfile} onClick={() => handlePersonaSelect(p.value)}
              className="group card-lift flex w-full items-center gap-4 rounded-card border border-rule bg-white p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50">
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-field bg-chip text-navy">{p.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-card-title text-navy">
                  <span className="card-ul">{p.title}</span>
                  <ArrowRight className="card-arrow" strokeWidth={2.25} aria-hidden="true" />
                </span>
                <span className="mt-0.5 block text-sm leading-5 text-meta">{p.desc}</span>
              </span>
            </button>
          ))}
        </div>
        {creatingProfile && (
          <p role="status" className="mt-5 flex items-center justify-center gap-2 text-sm text-meta">
            <Loader2 className="h-4 w-4 animate-spin" /> {t('onboarding.creatingProfile')}
          </p>
        )}
      </AuthShell>
    );
  }

  if (!profile) {
    return <AuthLoading />;
  }

  // Step 1: Organization resolution — invitation or domain match
  if (step === 'resolve' && !resolving && (pendingInvitation || detectedOrg)) {
    return (
      <AuthShell step={2} title={t('onboarding.joinOrg')} lead={t('onboarding.orgFound')}>
        {pendingInvitation && !showProfileCompletion && (
          <AuthStatus icon={<Users className="h-6 w-6" />} title={t('onboarding.youveBeenInvited')}>
            <p className="text-sm leading-6 text-meta">
              {pendingInvitation.invited_by_name} has invited you to join <strong className="font-semibold text-navy">{pendingInvitation.organization_name}</strong>.
            </p>
            <div className="rounded-field border border-rule bg-page p-5 text-center">
              <span className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-field bg-chip text-navy">
                <Building2 className="h-7 w-7" />
              </span>
              <div className="text-card-title text-navy">{pendingInvitation.organization_name}</div>
              <div className="mt-0.5 text-sm text-meta">{t('onboarding.invitedBy', { name: pendingInvitation.invited_by_name })}</div>
            </div>
            <Button variant="cta" roll={false} className={cn('w-full justify-between', CTA_WRAP)} onClick={handleAcceptInvitation} disabled={acceptingInvite}>
              {acceptingInvite ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {t('onboarding.acceptJoin')}
            </Button>
          </AuthStatus>
        )}

        {/* Post-invitation profile completion form */}
        {showProfileCompletion && (
          <AuthStatus icon={<CheckCircle className="h-6 w-6" />} title={t('onboarding.completeProfile')}>
            <p className="text-sm leading-6 text-meta">{t('onboarding.completeProfileDesc')}</p>
            <div className="space-y-5">
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
              <Button
                variant="cta"
                className="w-full justify-between"
                onClick={handleSaveProfileCompletion}
                disabled={savingProfile || !profileForm.firstName.trim() || !profileForm.lastName.trim()}
              >
                {savingProfile && <Loader2 className="h-4 w-4 animate-spin" />}
                {t('onboarding.saveContinue')}
              </Button>
              <div className="text-center">
                <UnderlineLink arrow={false} onClick={() => navigate('/account')}>
                  {t('onboarding.skipForNow')}
                </UnderlineLink>
              </div>
            </div>
          </AuthStatus>
        )}

        {!pendingInvitation && detectedOrg && (
          <AuthStatus
            tone={joinRequested ? 'warning' : 'default'}
            icon={joinRequested ? <Clock className="h-6 w-6" /> : <Building2 className="h-6 w-6" />}
            title={joinRequested ? 'Join Request Sent' : 'Organization Found'}
          >
            <p className="text-sm leading-6 text-meta">
              {joinRequested
                ? 'Your request is pending approval from the organization owner.'
                : 'We found an organization matching your email domain. Join your team instead of creating a new profile.'}
            </p>
            {/* Org card with logo, name, tier, member count */}
            <div className="rounded-field border border-rule bg-page p-5 text-center">
              {detectedOrg.logo_url ? (
                <img src={detectedOrg.logo_url} alt={detectedOrg.name} className="mx-auto mb-3 h-16 w-16 rounded-field border border-rule bg-white object-cover" />
              ) : (
                <div className="mx-auto mb-3 grid h-16 w-16 place-items-center rounded-field bg-chip text-navy">
                  <Building2 className="h-8 w-8" />
                </div>
              )}
              <div className="text-h3 text-navy">{detectedOrg.name}</div>
              {detectedOrg.member_count !== undefined && (
                <div className="mt-1.5 flex items-center justify-center gap-3 text-sm text-meta">
                  <span className="flex items-center gap-1">
                    <Users className="h-3.5 w-3.5" />
                    {detectedOrg.member_count} member{detectedOrg.member_count !== 1 ? 's' : ''}
                  </span>
                </div>
              )}
            </div>
            {joinRequested && (
              <AuthNotice tone="warning">
                <p>The organization owner has been notified by email. You'll receive an email when your request is approved.</p>
              </AuthNotice>
            )}
            {!joinRequested && detectedOrg.auto_approve && (
              <AuthNotice tone="success">
                <p>This organization accepts new members automatically</p>
              </AuthNotice>
            )}

            {joinRequested ? (
              <Button variant="cta" className="w-full justify-between" onClick={() => navigate('/account')}>
                Go to My Account
              </Button>
            ) : (
              <div className="space-y-4">
                <Button variant="cta" roll={false} className={cn('w-full justify-between', CTA_WRAP)} onClick={handleRequestJoinOrg} disabled={requestingJoin}>
                  {requestingJoin ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {detectedOrg.auto_approve ? `Join ${detectedOrg.name}` : `Request to Join ${detectedOrg.name}`}
                </Button>
                <div className="text-center">
                  <UnderlineLink arrow={false} onClick={() => { setDetectedOrg(null); setStep('org-form'); }} className="!text-sm !font-medium">
                    I want to create a new organization instead
                  </UnderlineLink>
                </div>
              </div>
            )}
          </AuthStatus>
        )}
      </AuthShell>
    );
  }

  if (resolving) {
    return (
      <AuthLoading label={t('onboarding.checkingOrg')}>
        <UnderlineLink arrow={false} onClick={() => { setResolving(false); setStep('org-form'); }}>
          {t('onboarding.takingTooLong')}
        </UnderlineLink>
      </AuthLoading>
    );
  }

  // Step 2: Organization creation form
  const orgIntro = [
    t('onboarding.orgProfileDesc'),
    profile.persona === 'marina' ? t('onboarding.orgProfileDescMarina') : profile.persona === 'partner' ? t('onboarding.orgProfileDescPartner') : t('onboarding.orgProfileDescMedia'),
    t('onboarding.orgProfileDescSuffix'),
  ].join(' ');

  return (
    <>
    <PageHero
      image={SITE_IMAGES.joinHero}
      seed="onboarding"
      icon={Building2}
      title={t('onboarding.createOrgProfile')}
      subtitle={orgIntro}
      breadcrumbs={false}
      containerClassName="max-w-3xl"
    >
      <AuthSteps current={2} />
    </PageHero>
    <div className="bg-page">
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 md:py-14">
      {nameMatch && (
        <AuthNotice tone="warning" className="mb-8 p-5" title={<>&ldquo;{nameMatch.org_name}&rdquo; is already on Smart Marina Connect.</>}>
          <p>
            If this is your company you don&rsquo;t need to create it again
            {nameMatch.owner_name ? <> — ask <strong>{nameMatch.owner_name}</strong>, who owns it, to invite you</> : null}, or email{' '}
            <UnderlineLink href="mailto:events@m3monaco.com" arrow={false} className="!text-sm !leading-5">events@m3monaco.com</UnderlineLink> and we&rsquo;ll connect you.
            If it&rsquo;s a different company that happens to share the name, just continue below.
          </p>
        </AuthNotice>
      )}

      {/* ── Claim Code Banner ── */}
      <section className="mb-8 rounded-card border border-rule bg-white p-6 sm:p-8">
        <div className="flex items-start gap-4">
          <span aria-hidden="true" className="grid h-12 w-12 shrink-0 place-items-center rounded-field bg-chip text-navy">
            <KeyRound className="h-6 w-6" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <h2 className="text-card-title text-navy">Have an organization code?</h2>
              <HelpTip title={t('help.tips.codeTitle', 'What is an organization code?')} more="marina-listed" newTab className="text-meta">
                {t('help.tips.codeLink', 'M3 gives a code to some companies it has already listed, such as marinas in the directory. Enter it to link your account to your page instead of creating a second one. No code? Just fill in the form below.')}
              </HelpTip>
            </div>
            <p className="mt-1 text-sm leading-6 text-meta">If your marina or organization has already been registered on the platform, enter the code provided to you to join directly.</p>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3 sm:pl-16">
          <Input
            value={claimCode}
            onChange={(e) => setClaimCode(e.target.value.toUpperCase())}
            placeholder="e.g. ABCD-1234"
            aria-label="Organization code"
            className="max-w-[220px] uppercase tracking-wider font-mono"
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleClaimOrg(); } }}
          />
          <Button type="button" variant="ctaNavy" size="sm" arrow={false} onClick={handleClaimOrg} disabled={claimingOrg || !claimCode.trim()}>
            {claimingOrg ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Join
          </Button>
        </div>
      </section>

      <form onSubmit={handleSubmit} className="space-y-8">

        {/* ════════════════════════════════════════════════════════
            ██  MARINA ORGANIZATION FORM
            ════════════════════════════════════════════════════════ */}
        {profile.persona === 'marina' && (
          <>
            {/* ── Section 1: General Information ── */}
            <AuthSection number="01" title={t('onboarding.marinaForm.generalInfo')} description={t('onboarding.marinaForm.basicDetails')} contentClassName="space-y-5">
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
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
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
              </AuthSection>

            {/* ── Section 2: Facilities & Amenities ── */}
            <AuthSection number="02" title={t('onboarding.marinaFacilities.title')} description={t('onboarding.marinaFacilities.subtitle')} contentClassName="space-y-4">
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center space-x-3">
                      <Checkbox id="yacht-club" checked={marina.has_yacht_club} onCheckedChange={c => updateMarina('has_yacht_club', !!c)} />
                      <Label htmlFor="yacht-club" className="font-normal cursor-pointer">{t('onboarding.marinaFacilities.yachtClub')}</Label>
                    </div>
                    {marina.has_yacht_club && (
                      <div className="flex items-center gap-2">
                        <Input type="number" min="0" value={marina.yacht_club_members} onChange={e => updateMarina('yacht_club_members', e.target.value)}
                          placeholder="0" className="w-24" />
                        <span className="text-sm text-meta">members</span>
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
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center space-x-3">
                      <Checkbox id="restaurants" checked={marina.has_restaurants} onCheckedChange={c => updateMarina('has_restaurants', !!c)} />
                      <Label htmlFor="restaurants" className="font-normal cursor-pointer">{t('onboarding.marinaFacilities.restaurants')}</Label>
                    </div>
                    {marina.has_restaurants && (
                      <div className="flex items-center gap-2">
                        <Input type="number" min="1" value={marina.restaurants_count} onChange={e => updateMarina('restaurants_count', e.target.value)}
                          placeholder="0" className="w-20" />
                        <span className="text-sm text-meta">restaurants</span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center space-x-3">
                    <Checkbox id="concierge" checked={marina.has_concierge} onCheckedChange={c => updateMarina('has_concierge', !!c)} />
                    <Label htmlFor="concierge" className="font-normal cursor-pointer">{t('onboarding.marinaFacilities.concierge')}</Label>
                  </div>
                </div>
              </AuthSection>

            {/* ── Section 3: Descriptions & Media ── */}
            <AuthSection number="03" title={t('onboarding.marinaDescriptions.title')} description={t('onboarding.marinaDescriptions.subtitle')} contentClassName="space-y-5">
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
              </AuthSection>

            {/* ── Section 4: Future Plans ── */}
            <AuthSection number="04" title={t('onboarding.marinaFuturePlans.title')} description={t('onboarding.marinaFuturePlans.subtitle')}>
                <div className="mb-4 flex flex-wrap gap-2 text-[13px] text-meta">
                  {timelineOptions.map(t => (
                    <span key={t.value} className="rounded-full bg-chip px-2.5 py-1">{t.label}</span>
                  ))}
                </div>
                <div className="space-y-1 max-h-[600px] overflow-y-auto">
                  {sectors.map(sector => (
                    <div key={sector.id} className="flex flex-col gap-2 rounded-field border-b border-rule px-2 py-2.5 last:border-0 hover:bg-page sm:flex-row sm:items-center sm:gap-3">
                      <span className="min-w-0 flex-1 text-sm text-ink sm:truncate" title={sector.label}>{sector.label}</span>
                      <div className="flex shrink-0 flex-wrap gap-1">
                        {timelineOptions.map(t => (
                          <button key={t.value} type="button"
                            onClick={() => setFuturePlan(sector.id, futurePlans[sector.id] === t.value ? '' : t.value)}
                            title={t.label}
                            aria-pressed={futurePlans[sector.id] === t.value}
                            className={`min-h-8 rounded-full border px-2.5 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ${
                              futurePlans[sector.id] === t.value
                                ? 'border-navy bg-navy text-white'
                                : 'border-rule bg-white text-meta hover:border-navy hover:text-navy'
                            }`}
                          >
                            {t.label.replace(' months', 'm').replace(' years', 'y').replace('Immediate', 'Now')}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                {sectors.length === 0 && <p className="py-4 text-center text-sm text-meta">{t('onboarding.marinaFuturePlans.loadingSectors')}</p>}
              </AuthSection>
          </>
        )}

        {/* ════════════════════════════════════════════════════════
            ██  PARTNER ORGANIZATION FORM
            ════════════════════════════════════════════════════════ */}
        {(profile.persona === 'partner' || profile.persona === 'developer' || profile.persona === 'investor') && (
          <AuthSection title={<>
                {profile.persona === 'developer' && t('onboarding.developerForm.title', 'Developer details')}
                {profile.persona === 'investor' && t('onboarding.investorForm.title', 'Investor details')}
                {profile.persona === 'partner' && t('onboarding.partnerForm.title')}
              </>} description={<>
                {profile.persona === 'developer' && t('onboarding.developerForm.subtitle', 'Tell us about your company and the marina sectors you focus on.')}
                {profile.persona === 'investor' && t('onboarding.investorForm.subtitle', 'Tell us about your fund or family office and the sectors you invest in.')}
                {profile.persona === 'partner' && t('onboarding.partnerForm.subtitle')}
              </>} contentClassName="space-y-5">
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
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label className="text-[13px] font-medium text-meta">{t('onboarding.socialLabels.linkedin')}</Label>
                    <Input value={partner.social_media_links.linkedin} onChange={e => setPartner({ ...partner, social_media_links: { ...partner.social_media_links, linkedin: e.target.value } })} placeholder="https://linkedin.com/company/..." />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-[13px] font-medium text-meta">{t('onboarding.socialLabels.twitter')}</Label>
                    <Input value={partner.social_media_links.twitter} onChange={e => setPartner({ ...partner, social_media_links: { ...partner.social_media_links, twitter: e.target.value } })} placeholder="https://x.com/..." />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-[13px] font-medium text-meta">{t('onboarding.socialLabels.instagram')}</Label>
                    <Input value={partner.social_media_links.instagram} onChange={e => setPartner({ ...partner, social_media_links: { ...partner.social_media_links, instagram: e.target.value } })} placeholder="https://instagram.com/..." />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-[13px] font-medium text-meta">{t('onboarding.socialLabels.facebook')}</Label>
                    <Input value={partner.social_media_links.facebook} onChange={e => setPartner({ ...partner, social_media_links: { ...partner.social_media_links, facebook: e.target.value } })} placeholder="https://facebook.com/..." />
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Label>
                    {profile.persona === 'developer' && t('onboarding.developerForm.interestSectors', 'Sectors of interest')}
                    {profile.persona === 'investor' && t('onboarding.investorForm.interestSectors', 'Investment focus sectors')}
                    {profile.persona === 'partner' && t('onboarding.partnerForm.serviceSectors')}
                  </Label>
                  <HelpTip title={t('help.tips.sectorsTitle', 'Why sectors matter')} more="company-sectors" newTab className="text-meta">
                    {t('help.tips.sectorsWhy', 'They say what your company offers or looks for, and decide which needs and articles we suggest to you.')}
                  </HelpTip>
                </div>
                <p className="text-[13px] leading-5 text-meta">
                  {profile.persona === 'developer' && t('onboarding.developerForm.interestSectorsHint', 'Pick the marina-industry sectors most relevant to your projects.')}
                  {profile.persona === 'investor' && t('onboarding.investorForm.interestSectorsHint', 'Pick the sectors you invest in or look at for deal flow.')}
                  {profile.persona === 'partner' && t('onboarding.partnerForm.serviceSectorsHint')}
                </p>
                <div className="grid max-h-60 grid-cols-1 gap-2 overflow-y-auto rounded-field border border-checkbox p-3 sm:grid-cols-2">
                  {sectors.map(s => (
                    <div key={s.id} className="flex items-center space-x-2">
                      <Checkbox id={`ps-${s.id}`} checked={selectedSectors.includes(s.id)} onCheckedChange={() => toggleSector(s.id)} />
                      <Label htmlFor={`ps-${s.id}`} className="text-sm cursor-pointer font-normal">{s.label}</Label>
                    </div>
                  ))}
                </div>
              </div>
            </AuthSection>
        )}

        {/* ════════════════════════════════════════════════════════
            ██  MEDIA ORGANIZATION FORM
            ════════════════════════════════════════════════════════ */}
        {profile.persona === 'media_partner' && (
          <AuthSection title={t('onboarding.mediaForm.title')} description={t('onboarding.mediaForm.subtitle')} contentClassName="space-y-5">
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
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label className="text-[13px] font-medium text-meta">{t('onboarding.socialLabels.linkedin')}</Label>
                    <Input value={media.social_media_links.linkedin} onChange={e => setMedia({ ...media, social_media_links: { ...media.social_media_links, linkedin: e.target.value } })} placeholder="https://linkedin.com/company/..." />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-[13px] font-medium text-meta">{t('onboarding.socialLabels.twitter')}</Label>
                    <Input value={media.social_media_links.twitter} onChange={e => setMedia({ ...media, social_media_links: { ...media.social_media_links, twitter: e.target.value } })} placeholder="https://x.com/..." />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-[13px] font-medium text-meta">{t('onboarding.socialLabels.instagram')}</Label>
                    <Input value={media.social_media_links.instagram} onChange={e => setMedia({ ...media, social_media_links: { ...media.social_media_links, instagram: e.target.value } })} placeholder="https://instagram.com/..." />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-[13px] font-medium text-meta">{t('onboarding.socialLabels.facebook')}</Label>
                    <Input value={media.social_media_links.facebook} onChange={e => setMedia({ ...media, social_media_links: { ...media.social_media_links, facebook: e.target.value } })} placeholder="https://facebook.com/..." />
                  </div>
                </div>
              </div>
            </AuthSection>
        )}

        {/* ── What happens next, then the submit button ── */}
        {!alreadyVerified && (
          <p className="flex items-center gap-1.5 text-sm leading-5 text-meta">
            <span>{t('help.tips.onboardingNextWhen', 'Next, the M3 team checks your company, usually within 24 to 48 business hours, and e-mails you.')}</span>
            <HelpTip title={t('help.tips.onboardingWaitTitle', 'While you wait')} more="verification-meanwhile" newTab>
              {t('help.tips.onboardingWait', 'You can complete your profile, read the public resources and look at the coming events. Registering for events, messages and publishing open once you are approved.')}
            </HelpTip>
          </p>
        )}
        {/* ── Submit button ── */}
        <Button type="submit" variant="cta" size="lg" className="w-full justify-between" disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {loading ? t('onboarding.submitting') : t('onboarding.submitOrgProfile')}
        </Button>
      </form>
    </div>
    </div>
    </>
  );
}
