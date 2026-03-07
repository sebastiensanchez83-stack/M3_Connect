import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Loader2, CheckCircle, ChevronRight, Anchor, Briefcase, Newspaper, Building2, Users } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { Sector, PersonaType, PendingInvitationResult } from '@/types/database';
import { toast } from '@/hooks/use-toast';

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
  const [detectedOrg, setDetectedOrg] = useState<{ id: string; name: string } | null>(null);
  const [acceptingInvite, setAcceptingInvite] = useState(false);
  const [joiningOrg, setJoiningOrg] = useState(false);

  // Org creation state
  const [orgCreated, setOrgCreated] = useState(false);
  const [orgId, setOrgId] = useState<string | null>(null);

  // Marina org form
  const [marina, setMarina] = useState<MarinaOrgForm>(defaultMarinaForm);
  const [futurePlans, setFuturePlans] = useState<Record<string, string>>({});

  // Partner org form
  const [partner, setPartner] = useState({ company_name: '', website: '', headquarters_country: '', description: '' });

  // Media org form
  const [media, setMedia] = useState({ media_name: '', website: '', audience_description: '' });

  const needsPersonaSetup = !authLoading && !!user && !profile;

  /* ─── Navigation guards ─── */
  useEffect(() => {
    if (authLoading) return;
    if (!user) { navigate('/'); return; }
    if (profile?.onboarding_status === 'completed') { navigate('/account'); return; }
    if (profile?.onboarding_status === 'submitted' && profile?.access_status !== 'rejected') {
      navigate('/account'); return;
    }
    // If already has org, skip to org-form step to fill details or redirect
    if (hasOrganization) {
      navigate('/account'); return;
    }
    if (profile) {
      supabase.from('sectors').select('*').eq('is_active', true).order('label')
        .then(({ data }) => { if (data) setSectors(data as Sector[]); });
    }
  }, [user, profile, authLoading, hasOrganization, navigate]);

  /* ─── Organization resolution: check invitation + domain ─── */
  useEffect(() => {
    if (!user || !profile || needsPersonaSetup || hasOrganization) return;
    const resolveOrg = async () => {
      setResolving(true);
      try {
        // 1. Check for pending invitation
        const { data: invData } = await supabase.rpc('check_pending_invitation', { p_email: user.email });
        if (invData && invData.length > 0) {
          setPendingInvitation(invData[0] as PendingInvitationResult);
          setResolving(false);
          return;
        }

        // 2. Check domain match (partner/media only — marinas use invite-only)
        if (profile.persona !== 'marina' && user.email) {
          const domain = user.email.split('@')[1]?.toLowerCase();
          if (domain && !PUBLIC_DOMAINS.includes(domain)) {
            const { data: orgMatch } = await supabase
              .from('organizations')
              .select('id, name')
              .eq('primary_domain', domain)
              .maybeSingle();
            if (orgMatch) {
              setDetectedOrg(orgMatch);
              setResolving(false);
              return;
            }
          }
        }

        // 3. No match → go to org creation form
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
        console.error('Error resolving org:', err);
        setStep('org-form');
      }
      setResolving(false);
    };
    resolveOrg();
  }, [user, profile, needsPersonaSetup, hasOrganization]);

  /* ─── Accept invitation ─── */
  const handleAcceptInvitation = async () => {
    if (!pendingInvitation) return;
    setAcceptingInvite(true);
    try {
      const { error } = await supabase.rpc('accept_org_invitation', { p_invitation_id: pendingInvitation.invitation_id });
      if (error) throw error;
      await refreshProfile();
      toast({ title: 'Welcome!', description: `You've joined ${pendingInvitation.organization_name}` });
      navigate('/account');
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
    setAcceptingInvite(false);
  };

  /* ─── Join via domain match ─── */
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
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
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

      if (profile.persona === 'marina') {
        if (!marina.marina_name || !marina.country || !marina.city || !marina.marina_type) {
          toast({ title: 'Required fields', description: 'Name, country, city and marina type are mandatory.', variant: 'destructive' });
          setLoading(false); return;
        }

        // Create organization if not already created
        if (!createdOrgId) {
          const domain = user.email?.split('@')[1]?.toLowerCase();
          const primaryDomain = domain && !PUBLIC_DOMAINS.includes(domain) ? domain : null;
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

        // Also create legacy marina_profiles row for backward compat
        await supabase.from('marina_profiles').upsert({
          user_id: user.id,
          marina_name: marina.marina_name,
          country: marina.country,
          city: marina.city,
          website: marina.website || null,
        }, { onConflict: 'user_id' });

      } else if (profile.persona === 'partner') {
        if (!partner.company_name || !partner.website || !partner.description) {
          toast({ title: 'Required fields', description: 'Name, website and description are mandatory.', variant: 'destructive' });
          setLoading(false); return;
        }

        if (!createdOrgId) {
          const domain = user.email?.split('@')[1]?.toLowerCase();
          const primaryDomain = domain && !PUBLIC_DOMAINS.includes(domain) ? domain : null;
          const { data: orgResult, error: orgErr } = await supabase.rpc('create_organization', {
            p_name: partner.company_name,
            p_organization_type: 'partner',
            p_primary_domain: primaryDomain,
            p_website: partner.website || null,
            p_description: partner.description || null,
            p_country: partner.headquarters_country || null,
            p_city: null,
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

        // Legacy partner_profiles
        await supabase.from('partner_profiles').upsert({
          user_id: user.id,
          company_name: partner.company_name,
          website: partner.website || null,
          headquarters_country: partner.headquarters_country || null,
          description: partner.description || null,
        }, { onConflict: 'user_id' });

      } else if (profile.persona === 'media_partner') {
        if (!media.media_name || !media.website) {
          toast({ title: 'Required fields', description: 'Media name and website are mandatory.', variant: 'destructive' });
          setLoading(false); return;
        }

        if (!createdOrgId) {
          const domain = user.email?.split('@')[1]?.toLowerCase();
          const primaryDomain = domain && !PUBLIC_DOMAINS.includes(domain) ? domain : null;
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

        // Legacy media_partner_profiles
        await supabase.from('media_partner_profiles').upsert({
          user_id: user.id,
          media_name: media.media_name,
          website: media.website || null,
          audience_description: media.audience_description || null,
        }, { onConflict: 'user_id' });
      }

      // Mark org + profile as submitted
      if (createdOrgId) {
        await supabase.from('organizations').update({ onboarding_status: 'submitted' }).eq('id', createdOrgId);
      }
      await supabase.from('profiles').update({ onboarding_status: 'submitted' }).eq('user_id', user.id);

      await refreshProfile();
      toast({ title: 'Organization profile submitted!', description: 'Your application is being reviewed.' });
      navigate('/account');
    } catch (error: unknown) {
      toast({ title: 'Error', description: error instanceof Error ? error.message : 'An error occurred.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  /* ─── Renders ─── */

  if (authLoading) {
    return <div className="container mx-auto py-16 text-center"><Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" /></div>;
  }

  // Step 0: persona selection (rare — only if handle_new_user trigger didn't fire)
  if (needsPersonaSetup) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-primary mb-2">Welcome to M3 Connect</h1>
          <p className="text-gray-600">Select your profile type to get started.</p>
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
            <Loader2 className="h-4 w-4 animate-spin" /> Creating profile...
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
          <h1 className="text-3xl font-bold text-primary mb-2">Join your Organization</h1>
          <p className="text-gray-600">We found an existing organization for you.</p>
        </div>

        {pendingInvitation && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5 text-primary" />
                You've been invited!
              </CardTitle>
              <CardDescription>
                {pendingInvitation.invited_by_name} has invited you to join <strong>{pendingInvitation.organization_name}</strong>.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-primary/5 rounded-lg p-4 text-center">
                <Building2 className="h-10 w-10 text-primary mx-auto mb-2" />
                <div className="font-semibold text-lg">{pendingInvitation.organization_name}</div>
                <div className="text-sm text-gray-500">Invited by {pendingInvitation.invited_by_name}</div>
              </div>
              <div className="flex gap-3">
                <Button className="flex-1" onClick={handleAcceptInvitation} disabled={acceptingInvite}>
                  {acceptingInvite ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle className="h-4 w-4 mr-2" />}
                  Accept & Join
                </Button>
                <Button variant="outline" onClick={() => { setPendingInvitation(null); setStep('org-form'); }}>
                  Create my own organization
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {!pendingInvitation && detectedOrg && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-5 w-5 text-primary" />
                Organization found
              </CardTitle>
              <CardDescription>
                Your email domain matches an existing organization.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-primary/5 rounded-lg p-4 text-center">
                <Building2 className="h-10 w-10 text-primary mx-auto mb-2" />
                <div className="font-semibold text-lg">{detectedOrg.name}</div>
                <div className="text-sm text-gray-500">Your email domain matches this organization</div>
              </div>
              <div className="flex gap-3">
                <Button className="flex-1" onClick={handleJoinDetectedOrg} disabled={joiningOrg}>
                  {joiningOrg ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle className="h-4 w-4 mr-2" />}
                  Join {detectedOrg.name}
                </Button>
                <Button variant="outline" onClick={() => { setDetectedOrg(null); setStep('org-form'); }}>
                  Create a new organization
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  if (resolving) {
    return <div className="container mx-auto py-16 text-center"><Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" /><p className="text-gray-500 mt-2">Checking for existing organization...</p></div>;
  }

  // Step 2: Organization creation form
  return (
    <div className="container mx-auto px-4 py-8 max-w-3xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-primary mb-2">Create your Organization Profile</h1>
        <p className="text-gray-600">
          This information will be showcased in the marketplace and allow us to validate your{' '}
          <span className="font-medium">
            {profile.persona === 'marina' ? 'Marina' : profile.persona === 'partner' ? 'Partner' : 'Media'}
          </span>{' '}organization.
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
                <CardTitle>General Information</CardTitle>
                <CardDescription>Basic details about your marina</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="space-y-2">
                  <Label>Marina Name *</Label>
                  <Input value={marina.marina_name} onChange={e => updateMarina('marina_name', e.target.value)} required placeholder="Port de Monaco" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Country *</Label>
                    <Select value={marina.country} onValueChange={v => updateMarina('country', v)}>
                      <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                      <SelectContent>{countries.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>City *</Label>
                    <Input value={marina.city} onChange={e => updateMarina('city', e.target.value)} required placeholder="Monaco" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Website</Label>
                  <Input type="url" value={marina.website} onChange={e => updateMarina('website', e.target.value)} placeholder="https://" />
                </div>
                <div className="space-y-2">
                  <Label>Type of Marina *</Label>
                  <RadioGroup value={marina.marina_type} onValueChange={v => updateMarina('marina_type', v)} className="flex flex-wrap gap-4">
                    {[
                      { value: 'in_operation', label: 'In Operation' },
                      { value: 'under_construction', label: 'Under Construction' },
                      { value: 'in_project', label: 'In Project' },
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
                    <Label>Expected Completion Date</Label>
                    <Input type="date" value={marina.completion_date} onChange={e => updateMarina('completion_date', e.target.value)} />
                  </div>
                )}
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label>Total Berths</Label>
                    <Input type="number" min="0" value={marina.berths_count} onChange={e => updateMarina('berths_count', e.target.value)} placeholder="500" />
                  </div>
                  <div className="space-y-2">
                    <Label>Superyacht Berths</Label>
                    <Input type="number" min="0" value={marina.superyacht_berths} onChange={e => updateMarina('superyacht_berths', e.target.value)} placeholder="20" />
                  </div>
                  <div className="space-y-2">
                    <Label>Longest Berth (m)</Label>
                    <Input type="number" min="0" step="0.1" value={marina.longest_berth_meters} onChange={e => updateMarina('longest_berth_meters', e.target.value)} placeholder="100" />
                  </div>
                </div>
                <div className="flex items-center space-x-3">
                  <Checkbox id="fresh-water" checked={marina.fresh_water_available} onCheckedChange={c => updateMarina('fresh_water_available', !!c)} />
                  <Label htmlFor="fresh-water" className="font-normal cursor-pointer">Fresh water available</Label>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center space-x-3">
                    <Checkbox id="mix-range" checked={marina.mix_range_boats} onCheckedChange={c => updateMarina('mix_range_boats', !!c)} />
                    <Label htmlFor="mix-range" className="font-normal cursor-pointer">Mix range of boats</Label>
                  </div>
                  {marina.mix_range_boats && (
                    <Input value={marina.mix_range_description} onChange={e => updateMarina('mix_range_description', e.target.value)}
                      placeholder="Describe the range (e.g. sailboats, motorboats, catamarans...)" className="mt-2" />
                  )}
                </div>
                <div className="space-y-2">
                  <Label>Certifications</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {certificationOptions.map(cert => (
                      <div key={cert} className="flex items-center space-x-2">
                        <Checkbox id={`cert-${cert}`} checked={marina.certifications.includes(cert)} onCheckedChange={() => toggleCertification(cert)} />
                        <Label htmlFor={`cert-${cert}`} className="text-sm font-normal cursor-pointer">{cert}</Label>
                      </div>
                    ))}
                  </div>
                  <Input value={marina.certifications_other} onChange={e => updateMarina('certifications_other', e.target.value)}
                    placeholder="Other certifications..." className="mt-2" />
                </div>
              </CardContent>
            </Card>

            {/* ── Section 2: Facilities & Amenities ── */}
            <Card>
              <CardHeader>
                <CardTitle>Facilities & Amenities</CardTitle>
                <CardDescription>What does your marina offer?</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <Checkbox id="yacht-club" checked={marina.has_yacht_club} onCheckedChange={c => updateMarina('has_yacht_club', !!c)} />
                      <Label htmlFor="yacht-club" className="font-normal cursor-pointer">Yacht Club</Label>
                    </div>
                    {marina.has_yacht_club && (
                      <Input type="number" min="0" value={marina.yacht_club_members} onChange={e => updateMarina('yacht_club_members', e.target.value)}
                        placeholder="Number of members" className="w-48" />
                    )}
                  </div>
                  <div className="flex items-center space-x-3">
                    <Checkbox id="sailing-school" checked={marina.has_sailing_school} onCheckedChange={c => updateMarina('has_sailing_school', !!c)} />
                    <Label htmlFor="sailing-school" className="font-normal cursor-pointer">Sailing School / Watersports Centre</Label>
                  </div>
                  <div className="flex items-center space-x-3">
                    <Checkbox id="boat-yard" checked={marina.has_boat_yard} onCheckedChange={c => updateMarina('has_boat_yard', !!c)} />
                    <Label htmlFor="boat-yard" className="font-normal cursor-pointer">Boat Yard</Label>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <Checkbox id="restaurants" checked={marina.has_restaurants} onCheckedChange={c => updateMarina('has_restaurants', !!c)} />
                      <Label htmlFor="restaurants" className="font-normal cursor-pointer">Restaurants</Label>
                    </div>
                    {marina.has_restaurants && (
                      <Input type="number" min="1" value={marina.restaurants_count} onChange={e => updateMarina('restaurants_count', e.target.value)}
                        placeholder="How many?" className="w-48" />
                    )}
                  </div>
                  <div className="flex items-center space-x-3">
                    <Checkbox id="concierge" checked={marina.has_concierge} onCheckedChange={c => updateMarina('has_concierge', !!c)} />
                    <Label htmlFor="concierge" className="font-normal cursor-pointer">Concierge Services</Label>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* ── Section 3: Descriptions & Media ── */}
            <Card>
              <CardHeader>
                <CardTitle>Descriptions & Media</CardTitle>
                <CardDescription>Tell us more about your marina</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="space-y-2">
                  <Label>Marina Description</Label>
                  <Textarea value={marina.marina_description} onChange={e => updateMarina('marina_description', e.target.value)}
                    rows={4} placeholder="Describe your marina, its history, location and unique features..." />
                </div>
                <div className="space-y-2">
                  <Label>Description of Services</Label>
                  <Textarea value={marina.services_description} onChange={e => updateMarina('services_description', e.target.value)}
                    rows={4} placeholder="Describe the services offered to boat owners and visitors..." />
                </div>
                <div className="space-y-2">
                  <Label>Social Media Links</Label>
                  <Input value={marina.social_media_links} onChange={e => updateMarina('social_media_links', e.target.value)}
                    placeholder="Instagram, LinkedIn, Facebook URLs..." />
                </div>
              </CardContent>
            </Card>

            {/* ── Section 4: Future Plans ── */}
            <Card>
              <CardHeader>
                <CardTitle>Future Development Plans</CardTitle>
                <CardDescription>
                  For each sector relevant to your marina, select the timeline that best matches your development plans.
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
                {sectors.length === 0 && <p className="text-sm text-gray-400 text-center py-4">Loading sectors...</p>}
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
              <CardTitle>Company Information</CardTitle>
              <CardDescription>This information will be visible in the marketplace</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label>Company Name *</Label>
                <Input value={partner.company_name} onChange={e => setPartner({ ...partner, company_name: e.target.value })} required placeholder="Acme Marine Solutions" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Headquarters Country</Label>
                  <Select value={partner.headquarters_country} onValueChange={v => setPartner({ ...partner, headquarters_country: v })}>
                    <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>{countries.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Website *</Label>
                  <Input type="url" value={partner.website} onChange={e => setPartner({ ...partner, website: e.target.value })} required placeholder="https://" />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Description *</Label>
                <Textarea value={partner.description} onChange={e => setPartner({ ...partner, description: e.target.value })} rows={4} required
                  placeholder="Describe your services, expertise and positioning in the marina industry..." />
              </div>
              <div className="space-y-2">
                <Label>Service Sectors *</Label>
                <p className="text-xs text-gray-500">Select at least one sector</p>
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
              <CardTitle>Media Information</CardTitle>
              <CardDescription>This information will be visible in the marketplace</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label>Media Name *</Label>
                <Input value={media.media_name} onChange={e => setMedia({ ...media, media_name: e.target.value })} required placeholder="Marina World Magazine" />
              </div>
              <div className="space-y-2">
                <Label>Website *</Label>
                <Input type="url" value={media.website} onChange={e => setMedia({ ...media, website: e.target.value })} required placeholder="https://" />
              </div>
              <div className="space-y-2">
                <Label>Audience Description</Label>
                <Textarea value={media.audience_description} onChange={e => setMedia({ ...media, audience_description: e.target.value })}
                  rows={4} placeholder="Describe your audience, editorial focus and reach..." />
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Submit button ── */}
        <Button type="submit" className="w-full" size="lg" disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle className="h-4 w-4 mr-2" />}
          {loading ? 'Submitting...' : 'Submit organization profile'}
        </Button>
      </form>
    </div>
  );
}
