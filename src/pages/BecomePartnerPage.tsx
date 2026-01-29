import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { toast } from '@/hooks/use-toast';
import { Target, Megaphone, Users, Award, Anchor, Globe, Building } from 'lucide-react';

const countries = ['France', 'Monaco', 'Italy', 'Spain', 'Greece', 'Croatia', 'Portugal', 'United Kingdom', 'Germany', 'Netherlands', 'Belgium', 'United States', 'United Arab Emirates', 'Other'];
const actorTypes = ['energy', 'equipment', 'digital', 'environment', 'services', 'institution'];

export function BecomePartnerPage() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [consent, setConsent] = useState(false);
  const [formData, setFormData] = useState({
    firstName: '', lastName: '', email: '', phone: '', company: '', website: '', country: '', actorType: '', solutions: '', goals: '', engagementLevel: 'info',
  });

  const updateField = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!consent) {
      toast({ title: 'Please accept the consent checkbox', variant: 'destructive' });
      return;
    }
    setLoading(true);
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 1000));
    toast({ title: t('becomePartner.form.success') });
    setFormData({ firstName: '', lastName: '', email: '', phone: '', company: '', website: '', country: '', actorType: '', solutions: '', goals: '', engagementLevel: 'info' });
    setConsent(false);
    setLoading(false);
  };

  const benefits = [
    { icon: Target, title: t('becomePartner.benefits.access.title'), desc: t('becomePartner.benefits.access.desc') },
    { icon: Megaphone, title: t('becomePartner.benefits.showcase.title'), desc: t('becomePartner.benefits.showcase.desc') },
    { icon: Users, title: t('becomePartner.benefits.codevelop.title'), desc: t('becomePartner.benefits.codevelop.desc') },
    { icon: Award, title: t('becomePartner.benefits.recognition.title'), desc: t('becomePartner.benefits.recognition.desc') },
  ];

  return (
    <div>
      {/* Hero */}
      <section className="gradient-hero text-white py-16">
        <div className="container mx-auto px-4 text-center">
          <h1 className="text-4xl md:text-5xl font-bold mb-4">{t('becomePartner.heroTitle')}</h1>
          <p className="text-xl text-gray-200 max-w-2xl mx-auto">{t('becomePartner.heroSubtitle')}</p>
        </div>
      </section>

      {/* Benefits */}
      <section className="py-16 bg-slate-50">
        <div className="container mx-auto px-4">
          <h2 className="text-3xl font-bold text-center text-primary mb-12">{t('becomePartner.benefits.title')}</h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {benefits.map((benefit, i) => (
              <Card key={i} className="text-center">
                <CardContent className="pt-6">
                  <benefit.icon className="h-12 w-12 text-secondary mx-auto mb-4" />
                  <h3 className="font-semibold text-lg mb-2">{benefit.title}</h3>
                  <p className="text-gray-600 text-sm">{benefit.desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="py-12 bg-primary text-white">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-3 gap-8 text-center">
            <div>
              <Anchor className="h-8 w-8 mx-auto mb-2" />
              <div className="text-3xl font-bold">500+</div>
              <div className="text-gray-300">{t('becomePartner.stats.marinas')}</div>
            </div>
            <div>
              <Globe className="h-8 w-8 mx-auto mb-2" />
              <div className="text-3xl font-bold">8</div>
              <div className="text-gray-300">{t('becomePartner.stats.countries')}</div>
            </div>
            <div>
              <Building className="h-8 w-8 mx-auto mb-2" />
              <div className="text-3xl font-bold">€50M+</div>
              <div className="text-gray-300">{t('becomePartner.stats.projects')}</div>
            </div>
          </div>
        </div>
      </section>

      {/* Form + FAQ */}
      <section className="py-16">
        <div className="container mx-auto px-4">
          <div className="grid lg:grid-cols-2 gap-12">
            {/* FAQ */}
            <div>
              <h2 className="text-2xl font-bold text-primary mb-6">{t('becomePartner.faq.title')}</h2>
              <Accordion type="single" collapsible className="w-full">
                {[1, 2, 3, 4].map(i => (
                  <AccordionItem key={i} value={`item-${i}`}>
                    <AccordionTrigger>{t(`becomePartner.faq.q${i}`)}</AccordionTrigger>
                    <AccordionContent>{t(`becomePartner.faq.a${i}`)}</AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </div>

            {/* Form */}
            <Card className="shadow-lg">
              <CardHeader>
                <CardTitle>{t('becomePartner.form.title')}</CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>{t('becomePartner.form.firstName')}</Label>
                      <Input value={formData.firstName} onChange={e => updateField('firstName', e.target.value)} required />
                    </div>
                    <div className="space-y-2">
                      <Label>{t('becomePartner.form.lastName')}</Label>
                      <Input value={formData.lastName} onChange={e => updateField('lastName', e.target.value)} required />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>{t('becomePartner.form.email')} *</Label>
                    <Input type="email" value={formData.email} onChange={e => updateField('email', e.target.value)} required />
                  </div>
                  <div className="space-y-2">
                    <Label>{t('becomePartner.form.phone')}</Label>
                    <Input value={formData.phone} onChange={e => updateField('phone', e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>{t('becomePartner.form.company')} *</Label>
                    <Input value={formData.company} onChange={e => updateField('company', e.target.value)} required />
                  </div>
                  <div className="space-y-2">
                    <Label>{t('becomePartner.form.website')}</Label>
                    <Input value={formData.website} onChange={e => updateField('website', e.target.value)} placeholder="https://..." />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>{t('becomePartner.form.country')}</Label>
                      <Select value={formData.country} onValueChange={v => updateField('country', v)}>
                        <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                        <SelectContent>
                          {countries.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>{t('becomePartner.form.actorType')}</Label>
                      <Select value={formData.actorType} onValueChange={v => updateField('actorType', v)}>
                        <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                        <SelectContent>
                          {actorTypes.map(a => <SelectItem key={a} value={a}>{t(`partners.sectors.${a}`)}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>{t('becomePartner.form.solutions')}</Label>
                    <Textarea value={formData.solutions} onChange={e => updateField('solutions', e.target.value)} placeholder={t('becomePartner.form.solutionsPlaceholder')} />
                  </div>
                  <div className="space-y-2">
                    <Label>{t('becomePartner.form.goals')}</Label>
                    <Textarea value={formData.goals} onChange={e => updateField('goals', e.target.value)} placeholder={t('becomePartner.form.goalsPlaceholder')} />
                  </div>
                  <div className="space-y-2">
                    <Label>{t('becomePartner.form.engagementLevel')}</Label>
                    <RadioGroup value={formData.engagementLevel} onValueChange={v => updateField('engagementLevel', v)}>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="info" id="info" />
                        <Label htmlFor="info" className="font-normal">{t('becomePartner.form.engagement.info')}</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="meeting" id="meeting" />
                        <Label htmlFor="meeting" className="font-normal">{t('becomePartner.form.engagement.meeting')}</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="proposal" id="proposal" />
                        <Label htmlFor="proposal" className="font-normal">{t('becomePartner.form.engagement.proposal')}</Label>
                      </div>
                    </RadioGroup>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox id="consent" checked={consent} onCheckedChange={(c) => setConsent(c as boolean)} />
                    <Label htmlFor="consent" className="font-normal text-sm">{t('becomePartner.form.consent')}</Label>
                  </div>
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? t('common.loading') : t('becomePartner.form.submit')}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>
    </div>
  );
}
