import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Lock, MessageSquare } from 'lucide-react';
import { FormCard, FormFooter, PageLoader, SubmitGuard, SubmitShell } from '@/components/submit/SubmitShell';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { Sector } from '@/types/database';
import { toast } from '@/hooks/use-toast';
import { accountHref } from '@/lib/accountNav';
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
          navigate(accountHref('submissions'));
          return;
        }
        if (data.marina_user_id !== user.id) {
          toast({ title: 'Unauthorized', description: 'You can only edit your own consultations.', variant: 'destructive' });
          navigate(accountHref('submissions'));
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
        navigate(accountHref('submissions'));
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
        navigate(accountHref('consultations'));
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
    return <PageLoader />;
  }

  // Access guard: only verified marina (or developer) users with verified org
  const canSubmitHere = profile?.persona === 'marina' || profile?.persona === 'developer';
  if (!user || !canSubmitHere || !isVerified || organization?.access_status !== 'verified') {
    return (
      <SubmitGuard
        icon={Lock}
        title={t('submitConsultation.restrictedTitle')}
        actions={(
          <>
            {!user && (
              <Button variant="ctaOnDark" onClick={() => navigate('/')}>{t('common.goHome')}</Button>
            )}
            {/* A signed-in member always gets a way forward: the dashboard says where the review of the account or the organization stands. */}
            {user && canSubmitHere && (
              <Button variant="ctaOnDark" onClick={() => navigate('/#dashboard')}>{t('common.viewAccountStatus')}</Button>
            )}
            {user && !canSubmitHere && (
              <Button variant="ctaOnDark" onClick={() => navigate('/#dashboard')}>{t('common.backToAccount')}</Button>
            )}
          </>
        )}
      >
        <p>
          {!user
            ? t('submitConsultation.restrictedNoUser')
            : !canSubmitHere
              ? t('submitConsultation.restrictedNotMarina')
              : t('submitConsultation.restrictedNotVerified')}
        </p>
      </SubmitGuard>
    );
  }

  return (
    <SubmitShell
      seed="submit-consultation"
      icon={MessageSquare}
      eyebrow={t('submitShell.eyebrowOpportunities', 'Opportunities')}
      title={isEditMode ? 'Edit Consultation' : t('submitConsultation.title')}
      subtitle={isEditMode ? 'Update your consultation details below.' : t('submitConsultation.subtitle')}
      trail={[{ label: t('nav.opportunities', 'Opportunities'), href: '/opportunities' }]}
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        <FormCard
          title={isEditMode ? 'Edit Consultation Details' : t('submitConsultation.cardTitle')}
          description={isEditMode ? 'Modify the fields you want to update' : t('submitConsultation.cardDescription')}
        >
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
        </FormCard>

        <FormFooter note={isEditMode ? undefined : t('opportunities.emptyCreatorReviewed', 'Each request is reviewed by the M3 team before it is published.')}>
          <Button type="submit" variant="cta" size="lg" roll={!loading} arrow={!loading} disabled={loading}>
            {loading
              ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />{isEditMode ? 'Saving...' : t('submitConsultation.submitting')}</>
              : (isEditMode ? 'Save Changes' : t('submitConsultation.submitBtn'))
            }
          </Button>
        </FormFooter>
      </form>
    </SubmitShell>
  );
}
