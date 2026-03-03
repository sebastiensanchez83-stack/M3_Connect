import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { SignupForm } from '@/components/auth/SignupForm';
import { useAuth } from '@/contexts/AuthContext';
import {
  Anchor, Building2, Newspaper, CheckCircle, ArrowRight,
  Globe, Users, Award, Shield,
} from 'lucide-react';

const memberTypes = [
  {
    id: 'marina',
    icon: <Anchor className="h-10 w-10" />,
    title: 'Marina / Port',
    desc: 'Opérateurs et gestionnaires de marina, ports de plaisance et installations nautiques.',
    benefits: [
      'Accès aux ressources exclusives du réseau',
      'Mise en relation avec des partenaires qualifiés',
      'Soumission de projets et appels d\'offres',
      'Événements et webinars sectoriels',
    ],
    cta: 'Rejoindre en tant que Marina',
    color: 'blue',
  },
  {
    id: 'partner',
    icon: <Building2 className="h-10 w-10" />,
    title: 'Partenaire Industrie',
    desc: 'Fournisseurs de services, équipements et solutions pour l\'industrie marina.',
    benefits: [
      'Visibilité auprès de 500+ marinas',
      'Accès aux projets et appels d\'offres',
      'Référencement dans l\'annuaire partenaires',
      'Co-développement et innovation',
    ],
    cta: 'Devenir Partenaire',
    color: 'green',
  },
  {
    id: 'media_partner',
    icon: <Newspaper className="h-10 w-10" />,
    title: 'Média Partenaire',
    desc: 'Journalistes et publications spécialisées dans le secteur maritime et nautique.',
    benefits: [
      'Accès aux communiqués et actualités',
      'Invitations aux événements exclusifs',
      'Contenus et études de cas partagées',
      'Réseau d\'experts du secteur',
    ],
    cta: 'Rejoindre en tant que Média',
    color: 'purple',
  },
];

const platformBenefits = [
  { icon: <Globe className="h-8 w-8" />, title: 'Réseau International', desc: 'Connectez-vous avec des professionnels de l\'industrie marina dans plus de 8 pays.' },
  { icon: <Users className="h-8 w-8" />, title: 'Communauté Vérifiée', desc: 'Chaque membre est vérifié par notre équipe pour garantir la qualité des échanges.' },
  { icon: <Award className="h-8 w-8" />, title: 'Innovation', desc: 'Accédez aux dernières innovations et projets du secteur maritime.' },
  { icon: <Shield className="h-8 w-8" />, title: 'Accompagnement', desc: 'Notre équipe vous accompagne à chaque étape de votre intégration.' },
];

export function BecomePartnerPage() {
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const [signupOpen, setSignupOpen] = useState(false);

  const handleJoin = (typeId: string) => {
    if (user) {
      // User is already logged in
      if (!profile) {
        // No profile yet → go to onboarding (which handles persona selection)
        navigate('/onboarding');
      } else if (profile.onboarding_status === 'draft') {
        // Profile exists but not completed → go to onboarding form
        navigate('/onboarding');
      } else {
        // Already submitted or completed
        navigate('/account');
      }
    } else {
      // Not logged in → open signup dialog
      setSignupOpen(true);
    }
  };

  return (
    <div>
      {/* Hero */}
      <section className="gradient-hero text-white py-20">
        <div className="container mx-auto px-4 text-center">
          <h1 className="text-4xl md:text-5xl font-bold mb-4">Rejoignez M3 Connect</h1>
          <p className="text-xl text-gray-200 max-w-2xl mx-auto mb-8">
            La plateforme qui connecte l'industrie marina. Choisissez votre profil et accédez à un réseau de professionnels vérifiés.
          </p>
        </div>
      </section>

      {/* Member Types */}
      <section className="py-16">
        <div className="container mx-auto px-4">
          <h2 className="text-3xl font-bold text-center text-primary mb-4">Choisissez votre profil</h2>
          <p className="text-gray-600 text-center mb-12 max-w-xl mx-auto">
            Sélectionnez le type de membre qui correspond à votre activité pour découvrir les avantages associés.
          </p>

          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {memberTypes.map((type) => (
              <Card key={type.id} className="relative overflow-hidden hover:shadow-lg transition-shadow border-2 hover:border-primary/30 flex flex-col">
                <CardContent className="pt-8 pb-6 flex flex-col flex-1">
                  <div className="text-primary mb-4">{type.icon}</div>
                  <h3 className="text-xl font-bold mb-2">{type.title}</h3>
                  <p className="text-gray-600 text-sm mb-6">{type.desc}</p>

                  <div className="space-y-3 mb-8 flex-1">
                    {type.benefits.map((b, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <CheckCircle className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />
                        <span className="text-sm text-gray-700">{b}</span>
                      </div>
                    ))}
                  </div>

                  <Button
                    onClick={() => handleJoin(type.id)}
                    className="w-full group"
                  >
                    {type.cta}
                    <ArrowRight className="h-4 w-4 ml-2 group-hover:translate-x-1 transition-transform" />
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Platform Benefits */}
      <section className="py-16 bg-slate-50">
        <div className="container mx-auto px-4">
          <h2 className="text-3xl font-bold text-center text-primary mb-12">Pourquoi M3 Connect ?</h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-5xl mx-auto">
            {platformBenefits.map((b, i) => (
              <Card key={i} className="text-center">
                <CardContent className="pt-6">
                  <div className="text-secondary mx-auto mb-4 flex justify-center">{b.icon}</div>
                  <h3 className="font-semibold text-lg mb-2">{b.title}</h3>
                  <p className="text-gray-600 text-sm">{b.desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="py-12 bg-primary text-white">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-3 gap-8 text-center max-w-3xl mx-auto">
            <div>
              <Anchor className="h-8 w-8 mx-auto mb-2" />
              <div className="text-3xl font-bold">500+</div>
              <div className="text-gray-300">Marinas</div>
            </div>
            <div>
              <Globe className="h-8 w-8 mx-auto mb-2" />
              <div className="text-3xl font-bold">8</div>
              <div className="text-gray-300">Pays</div>
            </div>
            <div>
              <Building2 className="h-8 w-8 mx-auto mb-2" />
              <div className="text-3xl font-bold">50+</div>
              <div className="text-gray-300">Partenaires</div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 text-center">
        <div className="container mx-auto px-4">
          <h2 className="text-3xl font-bold text-primary mb-4">Prêt à nous rejoindre ?</h2>
          <p className="text-gray-600 mb-8 max-w-xl mx-auto">
            Créez votre compte gratuitement et commencez à explorer les opportunités du réseau M3 Connect.
          </p>
          {user ? (
            <Button size="lg" onClick={() => navigate(profile ? '/account' : '/onboarding')}>
              Accéder à mon espace
              <ArrowRight className="h-5 w-5 ml-2" />
            </Button>
          ) : (
            <Button size="lg" onClick={() => setSignupOpen(true)}>
              Créer mon compte
              <ArrowRight className="h-5 w-5 ml-2" />
            </Button>
          )}
        </div>
      </section>

      {/* Signup Dialog */}
      <Dialog open={signupOpen} onOpenChange={setSignupOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Créer un compte</DialogTitle>
            <DialogDescription>
              Sélectionnez votre type de profil puis renseignez vos identifiants.
            </DialogDescription>
          </DialogHeader>
          <SignupForm onSuccess={() => { setSignupOpen(false); navigate('/onboarding'); }} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
