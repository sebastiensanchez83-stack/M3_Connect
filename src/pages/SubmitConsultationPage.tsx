import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
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
import { notifyAdmin } from '@/lib/notifications';
import { requireFreshSession } from '@/lib/session';

export function SubmitConsultationPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const isEditMode = Boolean(id);
  const { user, profile, isVerified, organization, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [loadingExisting, setLoadingExisting] = useState(false);
  const [sectors, setSectors] = useState<Sector[]>([]);

  const [form, setForm] = useState({
    title: '',
    description: '',
    sector_id: '',
  });

  useEffect(() => {
    if (authLoading) return;
    if (!user) { navigate('/'); return; }
    if ((profile?.persona === 'marina' || profile?.persona === 'developer') && isVerified && organization?.access_status === 'verified') {
      supabase.from('sectors').select('*').eq('is_active', true).order('label')
        .then(({ data }) => { if (data) setSectors(data as Sector[]); });
    }
  }, [user, profile, isVerified, organization, authLoading, navigate]);

  // Load existing consultation for edit mode
  useEffect(() => {
    if (!id || !user) return;
    setLoadingExisting(true);
    supabase
      .from('consultations')
      .select('*')
      .eq('id', id)
      .single()
      .then(({ data, error }) => {
        if (error || !data) {
          toast({ title: 'Consultation not found', variant: 'destructive' });
          navigate('/account?tab=submissions');
          return;
        }
        if (data.marina_user_id !== user.id) {
          toast({ title: 'Unauthorized', description: 'You can only edit your own consultations.', variant: 'destructive' });
          navigate('/account?tab=submissions');
          return;
        }
        setForm({
          title: data.title || '',
          description: data.description || '',
          sector_id: data.sector_id || '',
        });
        setLoadingExisting(false);
      });
  }, [id, user, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!form.title.trim() || !form.description.trim()) {
      toast({ title: t('submitConsultation.errorRequired'), description: t('submitConsultation.errorRequiredDesc'), variant: 'destructive' });
      return;
    }

    const uid = await requireFreshSession();
    if (!uid) return;

    setLoading(true);
    try {
      if (isEditMode && id) {
        // Update existing consultation
        const { error } = await supabase
          .from('consultations')
          .update({
            title: form.title.trim(),
            description: form.description.trim(),
            sector_id: form.sector_id || null,
          })
          .eq('id', id)
          .eq('marina_user_id', user.id);

        if (error) throw error;

        toast({ title: 'Consultation updated successfully' });
        navigate('/account?tab=submissions');
      } else {
        // Create new consultation
        const { error } = await supabase
          .from('consultations')
          .insert({
            marina_user_id: user.id,
            organization_id: organization?.id || null,
            title: form.title.trim(),
            description: form.description.trim(),
            sector_id: form.sector_id || null,
            is_open: true,
          });

        if (error) throw error;

        notifyAdmin('Consultation', form.title.trim(), `Submitted by marina`);

        toast({
          title: t('submitConsultation.success'),
          description: t('submitConsultation.successDesc'),
        });
        navigate('/account?tab=consultations');
      }
    } catch (err: unknown) {
      toast({
        title: t('submitConsultation.error'),
        description: err instanceof Error ? err.message : t('submitConsultation.errorGeneric'),
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  if (authLoading || loadingExisting) {
    return (
      <div className="container mx-auto py-16 text-center">
        <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
      </div>
    );
  }

  // Access guard: only verified marina (or developer) users with verified org
  const canSubmitHere = profile?.persona === 'marina' || profile?.persona === 'developer';
  if (!user || !canSubmitHere || !isVerified || organization?.access_status !== 'verified') {
    return (
      <div className="container mx-auto px-4 py-16 max-w-lg text-center">
        <h1 className="text-2xl font-bold text-gray-800 mb-2">{t('submitConsultation.restrictedTitle')}</h1>
        <p className="text-gray-500 mb-6">
          {!user
            ? t('submitConsultation.restrictedNoUser')
            : !canSubmitHere
              ? t('submitConsultation.restrictedNotMarina')
              : t('submitConsultation.restrictedNotVerified')}
        </p>
        {!user && (
          <Button onClick={() => navigate('/')}>{t('common.goHome')}</Button>
        )}
        {user && !isVerified && (
          <Button onClick={() => navigate('/account')}>{t('common.viewAccountStatus')}</Button>
        )}
        {user && isVerified && !canSubmitHere && (
          <Button onClick={() => navigate('/account')}>{t('common.backToAccount')}</Button>
        )}
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-2xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-primary mb-2">
          {isEditMode ? 'Edit Consultation' : t('submitConsultation.title')}
        </h1>
        <p className="text-gray-600">
          {isEditMode ? 'Update your consultation details below.' : t('submitConsultation.subtitle')}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>{isEditMode ? 'Edit Consultation Details' : t('submitConsultation.cardTitle')}</CardTitle>
            <CardDescription>{isEditMode ? 'Modify the fields you want to update' : t('submitConsultation.cardDescription')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label>{t('submitConsultation.fieldTitle')} *</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                required
                placeholder={t('submitConsultation.titlePlaceholder')}
              />
            </div>

            <div className="space-y-2">
              <Label>{t('submitConsultation.fieldDescription')} *</Label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                required
                rows={6}
                placeholder={t('submitConsultation.descriptionPlaceholder')}
              />
            </div>

            <div className="space-y-2">
              <Label>{t('submitConsultation.fieldSector')}</Label>
              <Select
                value={form.sector_id}
                onValueChange={(v) => setForm({ ...form, sector_id: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('submitConsultation.selectSector')} />
                </SelectTrigger>
                <SelectContent>
                  {sectors.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Button type="submit" className="w-full" size="lg" disabled={loading}>
          {loading
            ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />{isEditMode ? 'Saving...' : t('submitConsultation.submitting')}</>
            : <><CheckCircle className="h-4 w-4 mr-2" />{isEditMode ? 'Save Changes' : t('submitConsultation.submitBtn')}</>
          }
        </Button>
      </form>
    </div>
  );
}
