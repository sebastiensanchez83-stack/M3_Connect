import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, CheckCircle } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { Sector } from '@/types/database';
import { toast } from '@/hooks/use-toast';

export function SubmitRFPPage() {
  const { t } = useTranslation();
  const { user, profile, isVerified, organization, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [sectors, setSectors] = useState<Sector[]>([]);

  const [form, setForm] = useState({
    title: '',
    scope: '',
    sector_id: '',
    deadline_date: '',
  });

  useEffect(() => {
    if (authLoading) return;
    if (!user) { navigate('/'); return; }
    if (profile?.persona === 'marina' && isVerified && organization?.access_status === 'verified') {
      supabase.from('sectors').select('*').eq('is_active', true).order('label')
        .then(({ data }) => { if (data) setSectors(data as Sector[]); });
    }
  }, [user, profile, isVerified, organization, authLoading, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!form.title.trim() || !form.scope.trim()) {
      toast({ title: t('submitRfp.errorRequired'), description: t('submitRfp.errorRequiredDesc'), variant: 'destructive' });
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase
        .from('rfps')
        .insert({
          marina_user_id: user.id,
          organization_id: organization?.id || null,
          title: form.title.trim(),
          scope: form.scope.trim(),
          sector_id: form.sector_id || null,
          deadline_date: form.deadline_date || null,
          is_open: true,
        });

      if (error) throw error;

      toast({
        title: t('submitRfp.success'),
        description: t('submitRfp.successDesc'),
      });
      navigate('/account?tab=rfps');
    } catch (err: unknown) {
      toast({
        title: t('submitRfp.error'),
        description: err instanceof Error ? err.message : t('submitRfp.errorGeneric'),
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  if (authLoading) {
    return (
      <div className="container mx-auto py-16 text-center">
        <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
      </div>
    );
  }

  // Access guard: only verified marina users with verified org
  if (!user || profile?.persona !== 'marina' || !isVerified || organization?.access_status !== 'verified') {
    return (
      <div className="container mx-auto px-4 py-16 max-w-lg text-center">
        <h1 className="text-2xl font-bold text-gray-800 mb-2">{t('submitRfp.restrictedTitle')}</h1>
        <p className="text-gray-500 mb-6">
          {!user
            ? t('submitRfp.restrictedNoUser')
            : profile?.persona !== 'marina'
              ? t('submitRfp.restrictedNotMarina')
              : t('submitRfp.restrictedNotVerified')}
        </p>
        {!user && (
          <Button onClick={() => navigate('/')}>{t('common.goHome')}</Button>
        )}
        {user && !isVerified && (
          <Button onClick={() => navigate('/account')}>{t('common.viewAccountStatus')}</Button>
        )}
        {user && isVerified && profile?.persona !== 'marina' && (
          <Button onClick={() => navigate('/account')}>{t('common.backToAccount')}</Button>
        )}
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-2xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-primary mb-2">{t('submitRfp.title')}</h1>
        <p className="text-gray-600">
          {t('submitRfp.subtitle')}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>{t('submitRfp.cardTitle')}</CardTitle>
            <CardDescription>{t('submitRfp.cardDescription')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label>{t('submitRfp.fieldTitle')} *</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                required
                placeholder={t('submitRfp.titlePlaceholder')}
              />
            </div>

            <div className="space-y-2">
              <Label>{t('submitRfp.fieldScope')} *</Label>
              <Textarea
                value={form.scope}
                onChange={(e) => setForm({ ...form, scope: e.target.value })}
                required
                rows={6}
                placeholder={t('submitRfp.scopePlaceholder')}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t('submitRfp.fieldSector')}</Label>
                <Select
                  value={form.sector_id}
                  onValueChange={(v) => setForm({ ...form, sector_id: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t('submitRfp.selectSector')} />
                  </SelectTrigger>
                  <SelectContent>
                    {sectors.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>{t('submitRfp.fieldDeadline')}</Label>
                <Input
                  type="date"
                  value={form.deadline_date}
                  onChange={(e) => setForm({ ...form, deadline_date: e.target.value })}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Button type="submit" className="w-full" size="lg" disabled={loading}>
          {loading
            ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />{t('submitRfp.submitting')}</>
            : <><CheckCircle className="h-4 w-4 mr-2" />{t('submitRfp.submitBtn')}</>
          }
        </Button>
      </form>
    </div>
  );
}
