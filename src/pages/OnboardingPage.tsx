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
import { Loader2, CheckCircle, ChevronRight, Anchor, Briefcase, Newspaper } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { Sector, PersonaType } from '@/types/database';
import { toast } from '@/hooks/use-toast';

/* ─── Types ─── */
interface MarinaForm {
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
  'Blue Flag',
  'ISO 14001',
  'PIANC Green Marina',
  'Clean Marina',
  'Gold Anchor',
  'Silver Anchor',
  'Five Gold Anchors',
];

const personaCards: { value: PersonaType; icon: JSX.Element; title: string; desc: string }[] = [
  {
    value: 'marina',
    icon: <Anchor className="h-8 w-8" />,
    title: 'Marina',
    desc: 'I manage or represent a marina or port. I want to connect with industry partners and peers.',
  },
  {
    value: 'partner',
    icon: <Briefcase className="h-8 w-8" />,
    title: 'Industry Partner',
    desc: 'I provide products or services to the marina sector and want to reach new marina clients.',
  },
  {
    value: 'media_partner',
    icon: <Newspaper className="h-8 w-8" />,
    title: 'Media Partner',
    desc: 'I represent a media outlet or publication covering the marina and yachting industry.',
  },
];

const timelineOptions = [
  { value: 'immediate', label: 'Immediate' },
  { value: '0-3months', label: '0-3 months' },
  { value: '3-12months', label: '3-12 months' },
  { value: '1-3years', label: '1-3 years' },
  { value: '3+years', label: '3+ years' },
];

const defaultMarinaForm: MarinaForm = {
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
  const { user, profile, refreshProfile, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(false);
  const [creatingProfile, setCreatingProfile] = useState(false);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [selectedSectors, setSelectedSectors] = useState<string[]>([]);

  // Marina extended form
  const [marina, setMarina] = useState<MarinaForm>(defaultMarinaForm);
  // Future plans: sectorId → timeline
  const [futurePlans, setFuturePlans] = useState<Record<string, string>>({});

  // Partner & Media forms (unchanged)
  const [partner, setPartner] = useState({ company_name: '', website: '', headquarters_country: '', description: '' });
  const [media, setMedia] = useState({ media_name: '', website: '', audience_description: '' });

  const needsPersonaSetup = !authLoading && !!user && !profile;

  useEffect(() => {
    if (authLoading) return;
    if (!user) { navigate('/'); return; }
    if (profile?.onboarding_status === 'completed') {
      navigate('/account'); return;
    }
    // Submitted + pending = waiting for review → show account page
    // Submitted + rejected = allow re-editing → stay on onboarding
    if (profile?.onboarding_status === 'submitted' && profile?.access_status !== 'rejected') {
      navigate('/account'); return;
    }
    if (profile) {
      supabase.from('sectors').select('*').eq('is_active', true).order('label')
        .then(({ data }) => { if (data) setSectors(data as Sector[]); });
    }
  }, [user, profile, authLoading, navigate]);

  // Load existing profile data into form (for re-editing after rejection or pre-fill from signup)
  useEffect(() => {
    if (!user || !profile) return;
    const loadExistingData = async () => {
      if (profile.persona === 'marina') {
        const { data } = await supabase.from('marina_profiles').select('*').eq('user_id', user.id).maybeSingle();
        if (data) {
          setMarina((prev) => ({
            ...prev,
            marina_name: data.marina_name || prev.marina_name,
            country: data.country || prev.country,
            city: data.city || prev.city,
            website: data.website || prev.website,
            marina_type: data.marina_type || prev.marina_type,
            completion_date: data.completion_date || prev.completion_date,
            berths_count: data.berths_count?.toString() || prev.berths_count,
            superyacht_berths: data.superyacht_berths?.toString() || prev.superyacht_berths,
            longest_berth_meters: data.longest_berth_meters?.toString() || prev.longest_berth_meters,
            fresh_water_available: data.fresh_water_available ?? prev.fresh_water_available,
            mix_range_boats: data.mix_range_boats ?? prev.mix_range_boats,
            mix_range_description: data.mix_range_description || prev.mix_range_description,
            certifications: data.certifications || prev.certifications,
            certifications_other: data.certifications_other || prev.certifications_other,
            has_yacht_club: data.has_yacht_club ?? prev.has_yacht_club,
            yacht_club_members: data.yacht_club_members?.toString() || prev.yacht_club_members,
            has_sailing_school: data.has_sailing_school ?? prev.has_sailing_school,
            has_boat_yard: data.has_boat_yard ?? prev.has_boat_yard,
            has_restaurants: data.has_restaurants ?? prev.has_restaurants,
            restaurants_count: data.restaurants_count?.toString() || prev.restaurants_count,
            has_concierge: data.has_concierge ?? prev.has_concierge,
            marina_description: data.marina_description || prev.marina_description,
            services_description: data.services_description || prev.services_description,
            social_media_links: data.social_media_links || prev.social_media_links,
          }));
        }
      } else if (profile.persona === 'partner') {
        const { data } = await supabase.from('partner_profiles').select('*').eq('user_id', user.id).maybeSingle();
        if (data) {
          setPartner((prev) => ({
            ...prev,
            company_name: data.company_name || prev.company_name,
            website: data.website || prev.website,
            headquarters_country: data.headquarters_country || prev.headquarters_country,
            description: data.description || prev.description,
          }));
        }
      } else if (profile.persona === 'media_partner') {
        const { data } = await supabase.from('media_partner_profiles').select('*').eq('user_id', user.id).maybeSingle();
        if (data) {
          setMedia((prev) => ({
            ...prev,
            media_name: data.media_name || prev.media_name,
            website: data.website || prev.website,
            audience_description: data.audience_description || prev.audience_description,
          }));
        }
      }
    };
    loadExistingData();
  }, [user, profile]);

  /* ─── Persona selection (step 0) ─── */
  const handlePersonaSelect = async (persona: PersonaType) => {
    if (!user) return;
    setCreatingProfile(true);
    try {
      const { error: profileError } = await supabase.from('profiles').insert({
        user_id: user.id, persona, access_status: 'pending', onboarding_status: 'draft',
      });
      if (profileError) throw profileError;

      // Pre-fill company name and website from signup metadata
      const metaCompanyName = user.user_metadata?.company_name || '';
      const metaCompanyWebsite = user.user_metadata?.company_website || '';

      if (persona === 'marina') {
        await supabase.from('marina_profiles').insert({
          user_id: user.id,
          marina_name: metaCompanyName,
          website: metaCompanyWebsite || null,
        });
      } else if (persona === 'partner') {
        await supabase.from('partner_profiles').insert({
          user_id: user.id,
          company_name: metaCompanyName,
          website: metaCompanyWebsite || null,
        });
      } else if (persona === 'media_partner') {
        await supabase.from('media_partner_profiles').insert({
          user_id: user.id,
          media_name: metaCompanyName,
          website: metaCompanyWebsite || null,
        });
      }

      await refreshProfile();
      toast({ title: 'Profile type selected', description: 'Now complete your information.' });
    } catch (error: unknown) {
      toast({ title: 'Error', description: error instanceof Error ? error.message : 'Unable to create profile.', variant: 'destructive' });
    } finally {
      setCreatingProfile(false);
    }
  };

  /* ─── Marina helpers ─── */
  const updateMarina = (field: keyof MarinaForm, value: MarinaForm[keyof MarinaForm]) => {
    setMarina((prev) => ({ ...prev, [field]: value }));
  };

  const toggleCertification = (cert: string) => {
    setMarina((prev) => ({
      ...prev,
      certifications: prev.certifications.includes(cert)
        ? prev.certifications.filter((c) => c !== cert)
        : [...prev.certifications, cert],
    }));
  };

  const setFuturePlan = (sectorId: string, timeline: string) => {
    setFuturePlans((prev) => {
      const next = { ...prev };
      if (timeline === '') {
        delete next[sectorId];
      } else {
        next[sectorId] = timeline;
      }
      return next;
    });
  };

  /* ─── Submit ─── */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !profile) return;
    setLoading(true);

    try {
      if (profile.persona === 'marina') {
        if (!marina.marina_name || !marina.country || !marina.city || !marina.marina_type) {
          toast({ title: 'Required fields', description: 'Name, country, city and marina type are mandatory.', variant: 'destructive' });
          setLoading(false);
          return;
        }

        // Update marina_profiles with all fields
        const { error } = await supabase.from('marina_profiles').update({
          marina_name: marina.marina_name,
          country: marina.country,
          city: marina.city,
          website: marina.website || null,
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
          social_media_links: marina.social_media_links || null,
        }).eq('user_id', user.id);
        if (error) throw error;

        // Save interest sectors
        await supabase.from('marina_interest_sectors').delete().eq('marina_user_id', user.id);
        if (selectedSectors.length > 0) {
          await supabase.from('marina_interest_sectors').insert(
            selectedSectors.map((s) => ({ marina_user_id: user.id, sector_id: s })),
          );
        }

        // Save future plans
        await supabase.from('marina_future_plans').delete().eq('marina_user_id', user.id);
        const planEntries = Object.entries(futurePlans).filter(([, tl]) => tl);
        if (planEntries.length > 0) {
          await supabase.from('marina_future_plans').insert(
            planEntries.map(([sectorId, timeline]) => ({
              marina_user_id: user.id,
              sector_id: sectorId,
              timeline,
            })),
          );
        }

      } else if (profile.persona === 'partner') {
        if (!partner.company_name || !partner.website || !partner.description) {
          toast({ title: 'Required fields', description: 'Name, website and description are mandatory.', variant: 'destructive' });
          setLoading(false); return;
        }
        const { error } = await supabase.from('partner_profiles').update({
          company_name: partner.company_name, website: partner.website || null,
          headquarters_country: partner.headquarters_country || null, description: partner.description || null,
        }).eq('user_id', user.id);
        if (error) throw error;

        await supabase.from('partner_service_sectors').delete().eq('partner_user_id', user.id);
        if (selectedSectors.length > 0) {
          await supabase.from('partner_service_sectors').insert(
            selectedSectors.map((s) => ({ partner_user_id: user.id, sector_id: s })),
          );
        }

      } else if (profile.persona === 'media_partner') {
        if (!media.media_name || !media.website) {
          toast({ title: 'Required fields', description: 'Media name and website are mandatory.', variant: 'destructive' });
          setLoading(false); return;
        }
        const { error } = await supabase.from('media_partner_profiles').update({
          media_name: media.media_name, website: media.website || null,
          audience_description: media.audience_description || null,
        }).eq('user_id', user.id);
        if (error) throw error;
      }

      // Mark as submitted
      const { error: statusError } = await supabase
        .from('profiles').update({ onboarding_status: 'submitted' }).eq('user_id', user.id);
      if (statusError) throw statusError;

      await refreshProfile();
      toast({ title: 'Profile submitted!', description: 'Your application is being reviewed.' });
      navigate('/account');
    } catch (error: unknown) {
      toast({ title: 'Error', description: error instanceof Error ? error.message : 'An error occurred.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const toggleSector = (id: string) => {
    setSelectedSectors((prev) => prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]);
  };

  /* ─── Renders ─── */

  if (authLoading) {
    return <div className="container mx-auto py-16 text-center"><Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" /></div>;
  }

  // Step 0: persona selection
  if (needsPersonaSetup) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-primary mb-2">Welcome to M3 Connect</h1>
          <p className="text-gray-600">Select your profile type to get started.</p>
        </div>
        <div className="space-y-4">
          {personaCards.map((p) => (
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

  // Step 1: onboarding form
  return (
    <div className="container mx-auto px-4 py-8 max-w-3xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-primary mb-2">Complete your profile</h1>
        <p className="text-gray-600">
          This information will allow us to validate your{' '}
          <span className="font-medium">
            {profile.persona === 'marina' ? 'Marina' : profile.persona === 'partner' ? 'Partner' : 'Media'}
          </span>{' '}account.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">

        {/* ════════════════════════════════════════════════════════
            ██  MARINA FORM
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
                  <Input value={marina.marina_name} onChange={(e) => updateMarina('marina_name', e.target.value)} required placeholder="Port de Monaco" />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Country *</Label>
                    <Select value={marina.country} onValueChange={(v) => updateMarina('country', v)}>
                      <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                      <SelectContent>{countries.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>City *</Label>
                    <Input value={marina.city} onChange={(e) => updateMarina('city', e.target.value)} required placeholder="Monaco" />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Website</Label>
                  <Input type="url" value={marina.website} onChange={(e) => updateMarina('website', e.target.value)} placeholder="https://" />
                </div>

                <div className="space-y-2">
                  <Label>Type of Marina *</Label>
                  <RadioGroup value={marina.marina_type} onValueChange={(v) => updateMarina('marina_type', v)} className="flex flex-wrap gap-4">
                    {[
                      { value: 'in_operation', label: 'In Operation' },
                      { value: 'under_construction', label: 'Under Construction' },
                      { value: 'in_project', label: 'In Project' },
                    ].map((opt) => (
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
                    <Input type="date" value={marina.completion_date} onChange={(e) => updateMarina('completion_date', e.target.value)} />
                  </div>
                )}

                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label>Total Berths</Label>
                    <Input type="number" min="0" value={marina.berths_count} onChange={(e) => updateMarina('berths_count', e.target.value)} placeholder="500" />
                  </div>
                  <div className="space-y-2">
                    <Label>Superyacht Berths</Label>
                    <Input type="number" min="0" value={marina.superyacht_berths} onChange={(e) => updateMarina('superyacht_berths', e.target.value)} placeholder="20" />
                  </div>
                  <div className="space-y-2">
                    <Label>Longest Berth (m)</Label>
                    <Input type="number" min="0" step="0.1" value={marina.longest_berth_meters} onChange={(e) => updateMarina('longest_berth_meters', e.target.value)} placeholder="100" />
                  </div>
                </div>

                <div className="flex items-center space-x-3">
                  <Checkbox id="fresh-water" checked={marina.fresh_water_available} onCheckedChange={(c) => updateMarina('fresh_water_available', !!c)} />
                  <Label htmlFor="fresh-water" className="font-normal cursor-pointer">Fresh water available</Label>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center space-x-3">
                    <Checkbox id="mix-range" checked={marina.mix_range_boats} onCheckedChange={(c) => updateMarina('mix_range_boats', !!c)} />
                    <Label htmlFor="mix-range" className="font-normal cursor-pointer">Mix range of boats</Label>
                  </div>
                  {marina.mix_range_boats && (
                    <Input value={marina.mix_range_description} onChange={(e) => updateMarina('mix_range_description', e.target.value)}
                      placeholder="Describe the range (e.g. sailboats, motorboats, catamarans...)" className="mt-2" />
                  )}
                </div>

                <div className="space-y-2">
                  <Label>Certifications</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {certificationOptions.map((cert) => (
                      <div key={cert} className="flex items-center space-x-2">
                        <Checkbox id={`cert-${cert}`} checked={marina.certifications.includes(cert)} onCheckedChange={() => toggleCertification(cert)} />
                        <Label htmlFor={`cert-${cert}`} className="text-sm font-normal cursor-pointer">{cert}</Label>
                      </div>
                    ))}
                  </div>
                  <Input value={marina.certifications_other} onChange={(e) => updateMarina('certifications_other', e.target.value)}
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
                      <Checkbox id="yacht-club" checked={marina.has_yacht_club} onCheckedChange={(c) => updateMarina('has_yacht_club', !!c)} />
                      <Label htmlFor="yacht-club" className="font-normal cursor-pointer">Yacht Club</Label>
                    </div>
                    {marina.has_yacht_club && (
                      <Input type="number" min="0" value={marina.yacht_club_members} onChange={(e) => updateMarina('yacht_club_members', e.target.value)}
                        placeholder="Number of members" className="w-48" />
                    )}
                  </div>

                  <div className="flex items-center space-x-3">
                    <Checkbox id="sailing-school" checked={marina.has_sailing_school} onCheckedChange={(c) => updateMarina('has_sailing_school', !!c)} />
                    <Label htmlFor="sailing-school" className="font-normal cursor-pointer">Sailing School / Watersports Centre</Label>
                  </div>

                  <div className="flex items-center space-x-3">
                    <Checkbox id="boat-yard" checked={marina.has_boat_yard} onCheckedChange={(c) => updateMarina('has_boat_yard', !!c)} />
                    <Label htmlFor="boat-yard" className="font-normal cursor-pointer">Boat Yard</Label>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <Checkbox id="restaurants" checked={marina.has_restaurants} onCheckedChange={(c) => updateMarina('has_restaurants', !!c)} />
                      <Label htmlFor="restaurants" className="font-normal cursor-pointer">Restaurants</Label>
                    </div>
                    {marina.has_restaurants && (
                      <Input type="number" min="1" value={marina.restaurants_count} onChange={(e) => updateMarina('restaurants_count', e.target.value)}
                        placeholder="How many?" className="w-48" />
                    )}
                  </div>

                  <div className="flex items-center space-x-3">
                    <Checkbox id="concierge" checked={marina.has_concierge} onCheckedChange={(c) => updateMarina('has_concierge', !!c)} />
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
                  <Textarea value={marina.marina_description} onChange={(e) => updateMarina('marina_description', e.target.value)}
                    rows={4} placeholder="Describe your marina, its history, location and unique features..." />
                </div>
                <div className="space-y-2">
                  <Label>Description of Services</Label>
                  <Textarea value={marina.services_description} onChange={(e) => updateMarina('services_description', e.target.value)}
                    rows={4} placeholder="Describe the services offered to boat owners and visitors..." />
                </div>
                <div className="space-y-2">
                  <Label>Social Media Links</Label>
                  <Input value={marina.social_media_links} onChange={(e) => updateMarina('social_media_links', e.target.value)}
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
                  Leave unselected if not applicable.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {/* Timeline legend */}
                <div className="flex flex-wrap gap-3 mb-4 text-xs text-gray-500">
                  {timelineOptions.map((t) => (
                    <span key={t.value} className="bg-gray-100 px-2 py-1 rounded">{t.label}</span>
                  ))}
                </div>

                <div className="space-y-1 max-h-[600px] overflow-y-auto">
                  {sectors.map((sector) => (
                    <div key={sector.id} className="flex items-center gap-3 py-2 px-2 rounded hover:bg-gray-50 border-b border-gray-100 last:border-0">
                      <span className="text-sm flex-1 min-w-0 truncate" title={sector.label}>{sector.label}</span>
                      <div className="flex gap-1 shrink-0">
                        {timelineOptions.map((t) => (
                          <button
                            key={t.value}
                            type="button"
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

                {sectors.length === 0 && (
                  <p className="text-sm text-gray-400 text-center py-4">Loading sectors...</p>
                )}
              </CardContent>
            </Card>
          </>
        )}

        {/* ════════════════════════════════════════════════════════
            ██  PARTNER FORM (unchanged)
            ════════════════════════════════════════════════════════ */}
        {profile.persona === 'partner' && (
          <Card>
            <CardHeader>
              <CardTitle>Company Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label>Company Name *</Label>
                <Input value={partner.company_name} onChange={(e) => setPartner({ ...partner, company_name: e.target.value })} required placeholder="Acme Marine Solutions" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Headquarters Country</Label>
                  <Select value={partner.headquarters_country} onValueChange={(v) => setPartner({ ...partner, headquarters_country: v })}>
                    <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>{countries.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Website *</Label>
                  <Input type="url" value={partner.website} onChange={(e) => setPartner({ ...partner, website: e.target.value })} required placeholder="https://" />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Description *</Label>
                <Textarea value={partner.description} onChange={(e) => setPartner({ ...partner, description: e.target.value })} rows={4} required
                  placeholder="Describe your services, expertise and positioning in the marina industry..." />
              </div>
              <div className="space-y-2">
                <Label>Service Sectors *</Label>
                <p className="text-xs text-gray-500">Select at least one sector</p>
                <div className="grid grid-cols-2 gap-2 max-h-60 overflow-y-auto border rounded-lg p-3">
                  {sectors.map((s) => (
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
            ██  MEDIA FORM (unchanged)
            ════════════════════════════════════════════════════════ */}
        {profile.persona === 'media_partner' && (
          <Card>
            <CardHeader>
              <CardTitle>Media Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label>Media Name *</Label>
                <Input value={media.media_name} onChange={(e) => setMedia({ ...media, media_name: e.target.value })} required placeholder="Marina World Magazine" />
              </div>
              <div className="space-y-2">
                <Label>Website *</Label>
                <Input type="url" value={media.website} onChange={(e) => setMedia({ ...media, website: e.target.value })} required placeholder="https://" />
              </div>
              <div className="space-y-2">
                <Label>Audience Description</Label>
                <Textarea value={media.audience_description} onChange={(e) => setMedia({ ...media, audience_description: e.target.value })}
                  rows={4} placeholder="Describe your audience, editorial focus and reach..." />
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Submit button ── */}
        <Button type="submit" className="w-full" size="lg" disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle className="h-4 w-4 mr-2" />}
          {loading ? 'Submitting...' : 'Submit my profile'}
        </Button>
      </form>
    </div>
  );
}
