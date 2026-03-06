import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Helmet } from 'react-helmet-async';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { SignupForm } from '@/components/auth/SignupForm';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { PersonaType } from '@/types/database';
import {
  Anchor, Building2, Newspaper, CheckCircle, ArrowRight,
  Globe, Users, Award, Shield, UserPlus, FileText, ShieldCheck, Unlock,
  ChevronDown,
} from 'lucide-react';

export function BecomePartnerPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const [signupOpen, setSignupOpen] = useState(false);
  const [selectedPersonaType, setSelectedPersonaType] = useState<PersonaType | undefined>(undefined);
  const [stats, setStats] = useState({ marinas: 0, partners: 0 });
  const [openFaq, setOpenFaq] = useState<number | null>(null);

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

  const processSteps = [
    {
      step: 1,
      icon: <UserPlus className="h-7 w-7" />,
      title: t('join.process.step1Title'),
      desc: t('join.process.step1Desc'),
    },
    {
      step: 2,
      icon: <FileText className="h-7 w-7" />,
      title: t('join.process.step2Title'),
      desc: t('join.process.step2Desc'),
    },
    {
      step: 3,
      icon: <ShieldCheck className="h-7 w-7" />,
      title: t('join.process.step3Title'),
      desc: t('join.process.step3Desc'),
    },
    {
      step: 4,
      icon: <Unlock className="h-7 w-7" />,
      title: t('join.process.step4Title'),
      desc: t('join.process.step4Desc'),
    },
  ];

  const faqItems = [
    { q: t('join.faq.q1'), a: t('join.faq.a1') },
    { q: t('join.faq.q2'), a: t('join.faq.a2') },
    { q: t('join.faq.q3'), a: t('join.faq.a3') },
    { q: t('join.faq.q4'), a: t('join.faq.a4') },
    { q: t('join.faq.q5'), a: t('join.faq.a5') },
  ];

  const handleJoin = (persona?: PersonaType) => {
    if (user) {
      if (!profile || profile.onboarding_status === 'draft') {
        navigate('/onboarding');
      } else {
        navigate('/account');
      }
    } else {
      setSelectedPersonaType(persona);
      setSignupOpen(true);
    }
  };

  return (
    <div>
      <Helmet>
        <title>Become a Member — M3 Connect</title>
        <meta name="description" content="Join M3 Connect as a marina operator, service provider or media partner. Discover the membership process and start connecting with the marina industry." />
        <meta property="og:title" content="Become a Member — M3 Connect" />
        <meta property="og:description" content="Join the B2B platform connecting marina professionals worldwide." />
      </Helmet>

      {/* Hero */}
      <section className="gradient-hero text-white py-20">
        <div className="container mx-auto px-4 text-center">
          <h1 className="text-4xl md:text-5xl font-bold mb-4">{t('join.heroTitle')}</h1>
          <p className="text-xl text-gray-200 max-w-2xl mx-auto mb-8">
            {t('join.heroSubtitle')}
          </p>
        </div>
      </section>

      {/* How It Works — Process Steps */}
      <section className="py-16 bg-white">
        <div className="container mx-auto px-4">
          <h2 className="text-3xl font-bold text-center text-primary mb-4">{t('join.process.title')}</h2>
          <p className="text-gray-600 text-center mb-12 max-w-xl mx-auto">{t('join.process.subtitle')}</p>

          <div className="max-w-4xl mx-auto">
            <div className="grid md:grid-cols-4 gap-6 relative">
              {/* Connecting line (desktop only) */}
              <div className="hidden md:block absolute top-12 left-[12.5%] right-[12.5%] h-0.5 bg-gradient-to-r from-primary/20 via-primary/40 to-primary/20" />

              {processSteps.map((s) => (
                <div key={s.step} className="relative text-center flex flex-col items-center">
                  {/* Step circle */}
                  <div className="relative z-10 w-24 h-24 rounded-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center text-white shadow-lg mb-4">
                    {s.icon}
                  </div>
                  {/* Step number badge */}
                  <div className="absolute top-0 right-1/2 translate-x-[2.5rem] -translate-y-1 w-7 h-7 rounded-full bg-white border-2 border-primary text-primary text-xs font-bold flex items-center justify-center shadow-sm z-20">
                    {s.step}
                  </div>
                  <h3 className="font-semibold text-lg mb-2 text-gray-900">{s.title}</h3>
                  <p className="text-gray-600 text-sm leading-relaxed">{s.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Member Types */}
      <section className="py-16 bg-gray-50">
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
                    onClick={() => handleJoin(type.id as PersonaType)}
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
      <section className="py-16 bg-white">
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

      {/* FAQ Section */}
      <section className="py-16 bg-gray-50">
        <div className="container mx-auto px-4">
          <h2 className="text-3xl font-bold text-center text-primary mb-4">{t('join.faq.title')}</h2>
          <p className="text-gray-600 text-center mb-10 max-w-xl mx-auto">{t('join.faq.subtitle')}</p>

          <div className="max-w-2xl mx-auto space-y-3">
            {faqItems.map((item, i) => (
              <Collapsible key={i} open={openFaq === i} onOpenChange={(open) => setOpenFaq(open ? i : null)}>
                <Card className="border">
                  <CollapsibleTrigger className="w-full">
                    <CardContent className="flex items-center justify-between py-4 px-5 cursor-pointer hover:bg-gray-50 transition-colors">
                      <span className="font-medium text-left text-gray-900">{item.q}</span>
                      <ChevronDown className={`h-5 w-5 text-gray-400 shrink-0 ml-4 transition-transform ${openFaq === i ? 'rotate-180' : ''}`} />
                    </CardContent>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="px-5 pb-4 text-gray-600 text-sm leading-relaxed border-t pt-3">
                      {item.a}
                    </div>
                  </CollapsibleContent>
                </Card>
              </Collapsible>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 text-center bg-white">
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
          <SignupForm defaultPersona={selectedPersonaType} onSuccess={() => { setSignupOpen(false); navigate('/onboarding'); }} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
