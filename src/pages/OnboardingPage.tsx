// src/pages/OnboardingPage.tsx
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { Loader2, CheckCircle, Anchor, Building2, Newspaper } from 'lucide-react';
import { Sector, PersonaType } from '@/types/database';

const countries = [
  'France', 'Monaco', 'Italie', 'Espagne', 'Grèce', 'Croatie', 'Portugal',
  'Royaume-Uni', 'Allemagne', 'Pays-Bas', 'Belgique', 'États-Unis',
  'Émirats arabes unis', 'Autre',
];

const personaCards = [
  {
    value: 'marina' as PersonaType,
    icon: <Anchor className="h-8 w-8" />,
    title: 'Marina / Port',
    desc: 'Opérateurs et gestionnaires de marina, ports de plaisance',
  },
  {
    value: 'partner' as PersonaType,
    icon: <Building2 className="h-8 w-8" />,
    title: 'Partenaire Industrie',
    desc: 'Fournisseurs de services, équipements et solutions pour marinas',
  },
  {
    value: 'media_partner' as PersonaType,
    icon: <Newspaper className="h-8 w-8" />,
    title: 'Média Partenaire',
    desc: 'Journalistes et publications spécialisées dans le secteur maritime',
  },
];

export function OnboardingPage() {
  const navigate = useNavigate();
  const { user, profile, refreshProfile, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(false);
  const [creatingProfile, setCreatingProfile] = useState(false);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [selectedSectors, setSelectedSectors] = useState<string[]>([]);

  const [marina, setMarina] = useState({
    marina_name: '', country: '', city: '', website: '', berths_count: '',
  });
  const [partner, setPartner] = useState({
    company_name: '', website: '', headquarters_country: '', description: '',
  });
  const [media, setMedia] = useState({
    media_name: '', website: '', audience_description: '',
  });

  // Determine if the user needs to select a persona first
  const needsPersonaSetup = !authLoading && !!user && !profile;

  useEffect(() => {
    if (authLoading) return;
    if (!user) { navigate('/'); return; }

    // If already submitted or completed → redirect to account
    if (profile?.onboarding_status === 'submitted' || profile?.onboarding_status === 'completed') {
      navigate('/account');
      return;
    }

    // Fetch sectors for the form (only if profile exists)
    if (profile) {
      supabase
        .from('sectors')
        .select('*')
        .eq('is_active', true)
        .order('label')
        .then(({ data }) => { if (data) setSectors(data as Sector[]); });
    }
  }, [user, profile, authLoading, navigate]);

  // Handle persona selection for users without a profile
  const handlePersonaSelect = async (persona: PersonaType) => {
    if (!user) return;
    setCreatingProfile(true);

    try {
      // Create the profile row
      const { error: profileError } = await supabase.from('profiles').insert({
        user_id: user.id,
        persona,
        access_status: 'pending',
        onboarding_status: 'draft',
      });
      if (profileError) throw profileError;

      // Create the persona detail row
      if (persona === 'marina') {
        await supabase.from('marina_profiles').insert({ user_id: user.id, marina_name: '' });
      } else if (persona === 'partner') {
        await supabase.from('partner_profiles').insert({ user_id: user.id, company_name: '' });
      } else if (persona === 'media_partner') {
        await supabase.from('media_partner_profiles').insert({ user_id: user.id, media_name: '' });
      }

      // Refresh the profile in AuthContext so the form renders
      await refreshProfile();
      toast({ title: 'Type de profil sélectionné', description: 'Complétez maintenant vos informations.' });
    } catch (error: unknown) {
      toast({
        title: 'Erreur',
        description: error instanceof Error ? error.message : 'Impossible de créer le profil.',
        variant: 'destructive',
      });
    } finally {
      setCreatingProfile(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !profile) return;
    setLoading(true);

    try {
      if (profile.persona === 'marina') {
        if (!marina.marina_name || !marina.country || !marina.city) {
          toast({ title: 'Champs requis', description: 'Nom, pays et ville sont obligatoires.', variant: 'destructive' });
          setLoading(false);
          return;
        }
        const { error } = await supabase.from('marina_profiles').update({
          marina_name: marina.marina_name,
          country: marina.country,
          city: marina.city,
          website: marina.website || null,
          berths_count: marina.berths_count ? parseInt(marina.berths_count) : null,
        }).eq('user_id', user.id);
        if (error) throw error;

        await supabase.from('marina_interest_sectors').delete().eq('marina_user_id', user.id);
        if (selectedSectors.length > 0) {
          await supabase.from('marina_interest_sectors').insert(
            selectedSectors.map((s) => ({ marina_user_id: user.id, sector_id: s })),
          );
        }
      } else if (profile.persona === 'partner') {
        if (!partner.company_name || !partner.website || !partner.description) {
          toast({ title: 'Champs requis', description: 'Nom, site web et description sont obligatoires.', variant: 'destructive' });
          setLoading(false);
          return;
        }
        const { error } = await supabase.from('partner_profiles').update({
          company_name: partner.company_name,
          website: partner.website || null,
          headquarters_country: partner.headquarters_country || null,
          description: partner.description || null,
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
          toast({ title: 'Champs requis', description: 'Nom du média et site web sont obligatoires.', variant: 'destructive' });
          setLoading(false);
          return;
        }
        const { error } = await supabase.from('media_partner_profiles').update({
          media_name: media.media_name,
          website: media.website || null,
          audience_description: media.audience_description || null,
        }).eq('user_id', user.id);
        if (error) throw error;
      }

      const { error: statusError } = await supabase
        .from('profiles')
        .update({ onboarding_status: 'submitted' })
        .eq('user_id', user.id);
      if (statusError) throw statusError;

      await refreshProfile();
      toast({ title: 'Profil soumis !', description: 'Votre demande est en cours de validation.' });
      navigate('/account');
    } catch (error: unknown) {
      toast({
        title: 'Erreur',
        description: error instanceof Error ? error.message : 'Une erreur est survenue.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const toggleSector = (id: string) => {
    setSelectedSectors((prev) => prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]);
  };

  // Loading state
  if (authLoading) {
    return (
      <div className="container mx-auto py-16 text-center">
        <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
      </div>
    );
  }

  // ── STEP 0: User has no profile → persona selection ──
  if (needsPersonaSetup) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-primary mb-2">Bienvenue sur M3 Connect</h1>
          <p className="text-gray-600">Sélectionnez votre type de profil pour commencer.</p>
        </div>

        <div className="space-y-4">
          {personaCards.map((p) => (
            <button
              key={p.value}
              type="button"
              disabled={creatingProfile}
              onClick={() => handlePersonaSelect(p.value)}
              className="w-full flex items-center gap-5 p-6 rounded-xl border-2 border-gray-200 hover:border-primary hover:bg-primary/5 transition-all text-left group disabled:opacity-50"
            >
              <div className="text-primary shrink-0">{p.icon}</div>
              <div>
                <div className="font-semibold text-lg text-gray-900 group-hover:text-primary">{p.title}</div>
                <div className="text-sm text-gray-500">{p.desc}</div>
              </div>
            </button>
          ))}
        </div>

        {creatingProfile && (
          <div className="mt-6 text-center text-gray-500 flex items-center justify-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Création du profil...
          </div>
        )}
      </div>
    );
  }

  // If profile is null for some other reason, show loading
  if (!profile) {
    return (
      <div className="container mx-auto py-16 text-center">
        <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
      </div>
    );
  }

  // ── STEP 1: Profile exists → show the onboarding form ──
  const personaLabels = {
    marina: 'Marina / Port',
    partner: 'Partenaire',
    media_partner: 'Média',
    moderator: 'Modérateur',
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-2xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-primary mb-2">Complétez votre profil</h1>
        <p className="text-gray-600">
          Ces informations nous permettront de valider votre compte{' '}
          <span className="font-medium">{personaLabels[profile.persona]}</span>.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {profile.persona === 'marina' && 'Informations de la Marina'}
            {profile.persona === 'partner' && 'Informations de l\'Entreprise'}
            {profile.persona === 'media_partner' && 'Informations du Média'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">

            {/* ── MARINA ── */}
            {profile.persona === 'marina' && (
              <>
                <div className="space-y-2">
                  <Label>Nom de la marina *</Label>
                  <Input
                    value={marina.marina_name}
                    onChange={(e) => setMarina({ ...marina, marina_name: e.target.value })}
                    required
                    placeholder="Port de Monaco"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Pays *</Label>
                    <Select value={marina.country} onValueChange={(v) => setMarina({ ...marina, country: v })}>
                      <SelectTrigger><SelectValue placeholder="Sélectionner" /></SelectTrigger>
                      <SelectContent>
                        {countries.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Ville *</Label>
                    <Input
                      value={marina.city}
                      onChange={(e) => setMarina({ ...marina, city: e.target.value })}
                      required
                      placeholder="Monaco"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Site web</Label>
                    <Input
                      type="url"
                      value={marina.website}
                      onChange={(e) => setMarina({ ...marina, website: e.target.value })}
                      placeholder="https://"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Nombre d'anneaux</Label>
                    <Input
                      type="number"
                      value={marina.berths_count}
                      onChange={(e) => setMarina({ ...marina, berths_count: e.target.value })}
                      placeholder="500"
                      min="0"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Secteurs d'intérêt</Label>
                  <div className="grid grid-cols-2 gap-2 max-h-60 overflow-y-auto border rounded-lg p-3">
                    {sectors.map((s) => (
                      <div key={s.id} className="flex items-center space-x-2">
                        <Checkbox
                          id={s.id}
                          checked={selectedSectors.includes(s.id)}
                          onCheckedChange={() => toggleSector(s.id)}
                        />
                        <Label htmlFor={s.id} className="text-sm cursor-pointer font-normal">{s.label}</Label>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* ── PARTNER ── */}
            {profile.persona === 'partner' && (
              <>
                <div className="space-y-2">
                  <Label>Nom de l'entreprise *</Label>
                  <Input
                    value={partner.company_name}
                    onChange={(e) => setPartner({ ...partner, company_name: e.target.value })}
                    required
                    placeholder="Acme Marine Solutions"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Pays du siège</Label>
                    <Select value={partner.headquarters_country} onValueChange={(v) => setPartner({ ...partner, headquarters_country: v })}>
                      <SelectTrigger><SelectValue placeholder="Sélectionner" /></SelectTrigger>
                      <SelectContent>
                        {countries.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Site web *</Label>
                    <Input
                      type="url"
                      value={partner.website}
                      onChange={(e) => setPartner({ ...partner, website: e.target.value })}
                      required
                      placeholder="https://"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Description *</Label>
                  <Textarea
                    value={partner.description}
                    onChange={(e) => setPartner({ ...partner, description: e.target.value })}
                    rows={4}
                    required
                    placeholder="Décrivez vos services, votre expertise et votre positionnement dans l'industrie marina..."
                  />
                </div>
                <div className="space-y-2">
                  <Label>Secteurs de services *</Label>
                  <p className="text-xs text-gray-500">Sélectionnez au moins un secteur</p>
                  <div className="grid grid-cols-2 gap-2 max-h-60 overflow-y-auto border rounded-lg p-3">
                    {sectors.map((s) => (
                      <div key={s.id} className="flex items-center space-x-2">
                        <Checkbox
                          id={s.id}
                          checked={selectedSectors.includes(s.id)}
                          onCheckedChange={() => toggleSector(s.id)}
                        />
                        <Label htmlFor={s.id} className="text-sm cursor-pointer font-normal">{s.label}</Label>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* ── MEDIA PARTNER ── */}
            {profile.persona === 'media_partner' && (
              <>
                <div className="space-y-2">
                  <Label>Nom du média *</Label>
                  <Input
                    value={media.media_name}
                    onChange={(e) => setMedia({ ...media, media_name: e.target.value })}
                    required
                    placeholder="Marina World Magazine"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Site web *</Label>
                  <Input
                    type="url"
                    value={media.website}
                    onChange={(e) => setMedia({ ...media, website: e.target.value })}
                    required
                    placeholder="https://"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Description de l'audience</Label>
                  <Textarea
                    value={media.audience_description}
                    onChange={(e) => setMedia({ ...media, audience_description: e.target.value })}
                    rows={4}
                    placeholder="Décrivez votre audience, votre ligne éditoriale et votre portée..."
                  />
                </div>
              </>
            )}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading
                ? <Loader2 className="h-4 w-4 animate-spin mr-2" />
                : <CheckCircle className="h-4 w-4 mr-2" />}
              {loading ? 'Envoi en cours...' : 'Soumettre mon profil'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
