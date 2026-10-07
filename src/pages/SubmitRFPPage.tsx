import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, Lock, Ship } from 'lucide-react';
import { FormCard, FormFooter, PageLoader, SubmitGuard, SubmitShell } from '@/components/submit/SubmitShell';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { Sector } from '@/types/database';
import { toast } from '@/hooks/use-toast';
import { notifyAdmin } from '@/lib/notifications';
import { requireFreshSession } from '@/lib/session';

export function SubmitRFPPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const isEditMode = Boolean(id);
  const { user, profile, isVerified, organization, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [loadingExisting, setLoadingExisting] = useState(false);
  const [sectors, setSectors] = useState<Sector[]>([]);

  const [selectedSectors, setSelectedSectors] = useState<string[]>([]);
  const [form, setForm] = useState({
    title: '',
    scope: '',
    deadline_date: '',
  });

  useEffect(() => {
    if (authLoading) return;
    if (!user) { navigate('/'); return; }
    if ((profile?.persona === 'marina' || profile?.persona === 'developer') && isVerified && organization?.access_status === 'verified') {
      supabase.from('sectors').select('*').eq('is_active', true).order('label')
        .then(({ data }) => { if (data) setSectors(data as Sector[]); });
    }
  }, [user, profile, isVerified, organization, authLoading, navigate]);

  // Load existing RFP for edit mode
  useEffect(() => {
    if (!id || !user) return;
    setLoadingExisting(true);

    const loadRfp = async () => {
      const { data, error } = await supabase
        .from('rfps')
        .select('*')
        .eq('id', id)
        .single();

      if (error || !data) {
        toast({ title: 'RFP not found', variant: 'destructive' });
        navigate('/account?tab=submissions');
        return;
      }
      if (data.marina_user_id !== user.id) {
        toast({ title: 'Unauthorized', description: 'You can only edit your own RFPs.', variant: 'destructive' });
        navigate('/account?tab=submissions');
        return;
      }

      setForm({
        title: data.title || '',
        scope: data.scope || '',
        deadline_date: data.deadline_date || '',
      });

      // Load associated sectors from junction table
      const { data: sectorData } = await supabase
        .from('rfp_sectors')
        .select('sector_id')
        .eq('rfp_id', id);

      if (sectorData && sectorData.length > 0) {
        setSelectedSectors(sectorData.map((s: { sector_id: string }) => s.sector_id));
      }

      setLoadingExisting(false);
    };

    loadRfp();
  }, [id, user, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!form.title.trim() || !form.scope.trim()) {
      toast({ title: t('submitRfp.errorRequired'), description: t('submitRfp.errorRequiredDesc'), variant: 'destructive' });
      return;
    }

    const uid = await requireFreshSession();
    if (!uid) return;

    setLoading(true);
    try {
      if (isEditMode && id) {
        // Update existing RFP
        const { error } = await supabase
          .from('rfps')
          .update({
            title: form.title.trim(),
            scope: form.scope.trim(),
            sector_id: selectedSectors[0] || null,
            deadline_date: form.deadline_date || null,
          })
          .eq('id', id)
          .eq('marina_user_id', user.id);

        if (error) throw error;

        // Replace sectors: delete old, insert new
        await supabase.from('rfp_sectors').delete().eq('rfp_id', id);
        if (selectedSectors.length > 0) {
          await supabase.from('rfp_sectors').insert(
            selectedSectors.map(sid => ({ rfp_id: id, sector_id: sid }))
          );
        }

        toast({ title: 'RFP updated successfully' });
        navigate('/account?tab=submissions');
      } else {
        // Create new RFP
        const { data: rfpData, error } = await supabase
          .from('rfps')
          .insert({
            marina_user_id: user.id,
            organization_id: organization?.id || null,
            title: form.title.trim(),
            scope: form.scope.trim(),
            sector_id: selectedSectors[0] || null,
            deadline_date: form.deadline_date || null,
            is_open: true,
          })
          .select('id')
          .single();

        if (error) throw error;

        if (rfpData && selectedSectors.length > 0) {
          await supabase.from('rfp_sectors').insert(
            selectedSectors.map(sid => ({ rfp_id: rfpData.id, sector_id: sid }))
          );
        }

        notifyAdmin('RFP', form.title.trim(), `Submitted by marina — ${selectedSectors.length} sector(s)`);

        toast({
          title: t('submitRfp.success'),
          description: t('submitRfp.successDesc'),
        });
        navigate('/account?tab=rfps');
      }
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

  if (authLoading || loadingExisting) {
    return <PageLoader />;
  }

  // Access guard: only verified marina (or developer) users with verified org
  const canSubmitHere = profile?.persona === 'marina' || profile?.persona === 'developer';
  if (!user || !canSubmitHere || !isVerified || organization?.access_status !== 'verified') {
    return (
      <SubmitGuard
        icon={Lock}
        title={t('submitRfp.restrictedTitle')}
        actions={(
          <>
            {!user && (
              <Button variant="ctaOnDark" onClick={() => navigate('/')}>{t('common.goHome')}</Button>
            )}
            {/* A signed-in member always gets a way forward: the dashboard says where the review of the account or the organization stands. */}
            {user && canSubmitHere && (
              <Button variant="ctaOnDark" onClick={() => navigate('/dashboard')}>{t('common.viewAccountStatus')}</Button>
            )}
            {user && !canSubmitHere && (
              <Button variant="ctaOnDark" onClick={() => navigate('/dashboard')}>{t('common.backToAccount')}</Button>
            )}
          </>
        )}
      >
        <p>
          {!user
            ? t('submitRfp.restrictedNoUser')
            : !canSubmitHere
              ? t('submitRfp.restrictedNotMarina')
              : t('submitRfp.restrictedNotVerified')}
        </p>
      </SubmitGuard>
    );
  }

  return (
    <SubmitShell
      seed="submit-rfp"
      icon={Ship}
      eyebrow={t('submitShell.eyebrowOpportunities', 'Opportunities')}
      title={isEditMode ? 'Edit RFP' : t('submitRfp.title')}
      subtitle={isEditMode ? 'Update your RFP details below.' : t('submitRfp.subtitle')}
      trail={[{ label: t('nav.opportunities', 'Opportunities'), href: '/opportunities' }]}
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        <FormCard
          title={isEditMode ? 'Edit RFP Details' : t('submitRfp.cardTitle')}
          description={isEditMode ? 'Modify the fields you want to update' : t('submitRfp.cardDescription')}
        >
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

          <div className="space-y-2">
            <Label>{t('submitRfp.fieldSector')}</Label>
            <div className="grid max-h-48 grid-cols-1 gap-2 overflow-y-auto rounded-field border border-rule bg-page/60 p-3 sm:grid-cols-2">
              {sectors.map((s) => (
                <div key={s.id} className="flex items-center space-x-2">
                  <Checkbox
                    id={`rfp-sector-${s.id}`}
                    checked={selectedSectors.includes(s.id)}
                    onCheckedChange={() => {
                      setSelectedSectors(prev =>
                        prev.includes(s.id) ? prev.filter(sid => sid !== s.id) : [...prev, s.id]
                      );
                    }}
                  />
                  <Label htmlFor={`rfp-sector-${s.id}`} className="text-sm cursor-pointer font-normal">{s.label}</Label>
                </div>
              ))}
            </div>
            {selectedSectors.length > 0 && (
              <p className="text-xs text-meta">{selectedSectors.length} {t('marketplace.sectorsSelected', 'sector(s) selected')}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label>{t('submitRfp.fieldDeadline')}</Label>
            <Input
              type="date"
              value={form.deadline_date}
              onChange={(e) => setForm({ ...form, deadline_date: e.target.value })}
            />
          </div>
        </FormCard>

        <FormFooter note={isEditMode ? undefined : t('opportunities.emptyCreatorReviewed', 'Each request is reviewed by the M3 team before it is published.')}>
          <Button type="submit" variant="cta" size="lg" roll={!loading} arrow={!loading} disabled={loading}>
            {loading
              ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />{isEditMode ? 'Saving...' : t('submitRfp.submitting')}</>
              : (isEditMode ? 'Save Changes' : t('submitRfp.submitBtn'))
            }
          </Button>
        </FormFooter>
      </form>
    </SubmitShell>
  );
}
