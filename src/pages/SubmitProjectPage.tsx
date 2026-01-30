import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/hooks/use-toast';
import { Lock, Anchor } from 'lucide-react';

export function SubmitProjectPage() {
  const { t } = useTranslation();
  const { user, profile, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [consent, setConsent] = useState(false);
  const [formData, setFormData] = useState({
    project_type: '',
    budget_range: '',
    timeline: '',
    description: '',
  });

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/');
    }
  }, [user, authLoading, navigate]);

  const isVerifiedMarina = profile?.role === 'marina' && profile?.status === 'verified';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!consent) {
      toast({ title: 'Please accept the consent checkbox', variant: 'destructive' });
      return;
    }
    setLoading(true);
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 1000));
    toast({ title: t('submitProject.success') });
    setFormData({ project_type: '', budget_range: '', timeline: '', description: '' });
    setConsent(false);
    setLoading(false);
  };

  const updateField = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  if (authLoading) {
    return <div className="container mx-auto px-4 py-8 text-center">{t('common.loading')}</div>;
  }

  if (!isVerifiedMarina) {
    return (
      <div className="container mx-auto px-4 py-16 max-w-lg">
        <Card className="text-center">
          <CardContent className="pt-8 pb-8">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Lock className="h-8 w-8 text-gray-400" />
            </div>
            <h2 className="text-xl font-semibold mb-2">{t('submitProject.restricted')}</h2>
            <p className="text-gray-600 mb-6">{t('submitProject.restrictedDesc')}</p>
            <Button onClick={() => navigate('/account')}>
              <Anchor className="h-4 w-4 mr-2" />
              Complete Marina Profile
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-2xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-primary mb-2">{t('submitProject.title')}</h1>
        <p className="text-gray-600">{t('submitProject.subtitle')}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Project Details</CardTitle>
          <CardDescription>Tell us about your project needs</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label>{t('submitProject.projectType')} *</Label>
              <Select value={formData.project_type} onValueChange={v => updateField('project_type', v)} required>
                <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                  {['energy', 'digital', 'infrastructure', 'services', 'other'].map(type => (
                    <SelectItem key={type} value={type}>{t(`submitProject.projectTypes.${type}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>{t('submitProject.budgetRange')} *</Label>
              <Select value={formData.budget_range} onValueChange={v => updateField('budget_range', v)} required>
                <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                  {['under_10k', '10k_50k', '50k_100k', '100k_500k', 'over_500k'].map(budget => (
                    <SelectItem key={budget} value={budget}>{t(`submitProject.budgets.${budget}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>{t('submitProject.timeline')} *</Label>
              <Select value={formData.timeline} onValueChange={v => updateField('timeline', v)} required>
                <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                  {['0_12_months', '12_24_months', '24_plus'].map(timeline => (
                    <SelectItem key={timeline} value={timeline}>{t(`submitProject.timelines.${timeline}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>{t('submitProject.description')} *</Label>
              <Textarea
                value={formData.description}
                onChange={e => updateField('description', e.target.value)}
                placeholder={t('submitProject.descriptionPlaceholder')}
                rows={5}
                required
              />
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox id="consent" checked={consent} onCheckedChange={(c) => setConsent(c as boolean)} />
              <Label htmlFor="consent" className="font-normal text-sm">{t('submitProject.consent')}</Label>
            </div>

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? t('common.loading') : t('submitProject.submit')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
