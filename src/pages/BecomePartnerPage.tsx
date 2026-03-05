import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
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
import { supabase } from '@/lib/supabase';
import {
  Anchor, Building2, Newspaper, CheckCircle, ArrowRight,
  Globe, Users, Award, Shield,
} from 'lucide-react';

export function BecomePartnerPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const [signupOpen, setSignupOpen] = useState(false);
  const [stats, setStats] = useState({ marinas: 0, partners: 0 });

  useEffect(() => {
    const fetchStats = async () => {
      const [marinasRes, partnersRes] = await Promise.all([
        supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('persona', 'marina'),
        supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('persona', 'partner'),
      ]);
      setStats({
        marinas: marinasRes.count || 0,
        partners: partnersRes.count || 0,
      });
    };
    fetchStats();
  }, []);

  const memberTypes = [
    {
      id: 'marina',
      icon: <Anchor className="h-10 w-10" />,
      title: t('join.marina.title'),
      desc: t('join.marina.desc'),
      benefits: [
        t('join.marina.benefits.0'),
        t('join.marina.benefits.1'),
        t('join.marina.benefits.2'),
        t('join.marina.benefits.3'),
      ],
      cta: t('join.marina.cta'),
    },
    {
      id: 'partner',
      icon: <Building2 className="h-10 w-10" />,
      title: t('join.partner.title'),
      desc: t('join.partner.desc'),
      benefits: [
        t('join.partner.benefits.0'),
        t('join.partner.benefits.1'),
        t('join.partner.benefits.2'),
        t('join.partner.benefits.3'),
      ],
      cta: t('join.partner.cta'),
    },
    {
      id: 'media_partner',
      icon: <Newspaper className="h-10 w-10" />,
      title: t('join.mediaPartner.title'),
      desc: t('join.mediaPartner.desc'),
      benefits: [
        t('join.mediaPartner.benefits.0'),
        t('join.mediaPartner.benefits.1'),
        t('join.mediaPartner.benefits.2'),
        t('join.mediaPartner.benefits.3'),
      ],
      cta: t('join.mediaPartner.cta'),
    },
  ];

  const platformBenefits = [
    { icon: <Globe className="h-8 w-8" />, title: t('join.benefit1Title'), desc: t('join.benefit1Desc') },
    { icon: <Users className="h-8 w-8" />, title: t('join.benefit2Title'), desc: t('join.benefit2Desc') },
    { icon: <Award className="h-8 w-8" />, title: t('join.benefit3Title'), desc: t('join.benefit3Desc') },
    { icon: <Shield className="h-8 w-8" />, title: t('join.benefit4Title'), desc: t('join.benefit4Desc') },
  ];

  const handleJoin = () => {
    if (user) {
      if (!profile || profile.onboarding_status === 'draft') {
        navigate('/onboarding');
      } else {
        navigate('/account');
      }
    } else {
      setSignupOpen(true);
    }
  };

  return (
    <div>
      {/* Hero */}
      <section className="gradient-hero text-white py-20">
        <div className="container mx-auto px-4 text-center">
          <h1 className="text-4xl md:text-5xl font-bold mb-4">{t('join.heroTitle')}</h1>
          <p className="text-xl text-gray-200 max-w-2xl mx-auto mb-8">
            {t('join.heroSubtitle')}
          </p>
        </div>
      </section>

      {/* Member Types */}
      <section className="py-16">
        <div className="container mx-auto px-4">
          <h2 className="text-3xl font-bold text-center text-primary mb-4">{t('join.chooseProfile')}</h2>
          <p className="text-gray-600 text-center mb-12 max-w-xl mx-auto">
            {t('join.chooseProfileDesc')}
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
                    onClick={() => handleJoin()}
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
          <h2 className="text-3xl font-bold text-center text-primary mb-12">{t('join.whyTitle')}</h2>
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

      {/* Live Stats */}
      <section className="py-12 bg-primary text-white">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-3 gap-8 text-center max-w-3xl mx-auto">
            <div>
              <Anchor className="h-8 w-8 mx-auto mb-2" />
              <div className="text-3xl font-bold">{stats.marinas || '—'}</div>
              <div className="text-gray-300">{t('home.stats.marinas')}</div>
            </div>
            <div>
              <Globe className="h-8 w-8 mx-auto mb-2" />
              <div className="text-3xl font-bold">8+</div>
              <div className="text-gray-300">{t('becomePartner.stats.countries')}</div>
            </div>
            <div>
              <Building2 className="h-8 w-8 mx-auto mb-2" />
              <div className="text-3xl font-bold">{stats.partners || '—'}</div>
              <div className="text-gray-300">{t('home.stats.partners')}</div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 text-center">
        <div className="container mx-auto px-4">
          <h2 className="text-3xl font-bold text-primary mb-4">{t('join.readyTitle')}</h2>
          <p className="text-gray-600 mb-8 max-w-xl mx-auto">
            {t('join.readySubtitle')}
          </p>
          {user ? (
            <Button size="lg" onClick={() => navigate(profile ? '/account' : '/onboarding')}>
              {t('join.accessMySpace')}
              <ArrowRight className="h-5 w-5 ml-2" />
            </Button>
          ) : (
            <Button size="lg" onClick={() => setSignupOpen(true)}>
              {t('join.createAccount')}
              <ArrowRight className="h-5 w-5 ml-2" />
            </Button>
          )}
        </div>
      </section>

      {/* Signup Dialog */}
      <Dialog open={signupOpen} onOpenChange={setSignupOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('join.signupTitle')}</DialogTitle>
            <DialogDescription>
              {t('join.signupDesc')}
            </DialogDescription>
          </DialogHeader>
          <SignupForm onSuccess={() => { setSignupOpen(false); navigate('/onboarding'); }} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
