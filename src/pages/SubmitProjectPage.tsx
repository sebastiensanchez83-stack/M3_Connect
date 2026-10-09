import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
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
import { supabase } from '@/lib/supabase';
import { requireFreshSession } from '@/lib/session';
import { toast } from '@/hooks/use-toast';
import { accountHref } from '@/lib/accountNav';
import { notifyAdmin, sendNotification } from '@/lib/notifications';
import { Lock, Briefcase } from 'lucide-react';
import { FormCard, FormFooter, PageLoader, SubmitGuard, SubmitShell } from '@/components/submit/SubmitShell';
import { HelpTip } from '@/components/help/HelpTip';

export function SubmitProjectPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const isEditMode = Boolean(id);
  const { user, profile, isVerified, organization, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [loadingExisting, setLoadingExisting] = useState(false);
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

  // Load existing project for edit mode
  useEffect(() => {
    if (!id || !user) return;
    setLoadingExisting(true);
    supabase
      .from('marina_projects')
      .select('*')
      .eq('id', id)
      .single()
      .then(({ data, error }) => {
        if (error || !data) {
          toast({ title: 'Project not found', variant: 'destructive' });
          navigate(accountHref('submissions'));
          return;
        }
        // Only allow editing own projects
        if (data.user_id !== user.id) {
          toast({ title: 'Unauthorized', description: 'You can only edit your own projects.', variant: 'destructive' });
          navigate(accountHref('submissions'));
          return;
        }
        setFormData({
          project_type: data.project_type || '',
          budget_range: data.budget_range || '',
          timeline: data.timeline || '',
          description: data.description || '',
        });
        setConsent(true); // Pre-check consent for editing
        setLoadingExisting(false);
      });
  }, [id, user, navigate]);

  const isVerifiedMarina = (profile?.persona === 'marina' || profile?.persona === 'developer') && isVerified && organization?.access_status === 'verified';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!consent) {
      toast({ title: 'Please accept the consent checkbox', variant: 'destructive' });
      return;
    }
    if (!user) return;
    const uid = await requireFreshSession();
    if (!uid) return;
    setLoading(true);

    if (isEditMode && id) {
      // Update existing project
      const { error } = await supabase
        .from('marina_projects')
        .update({
          project_type: formData.project_type,
          budget_range: formData.budget_range,
          timeline: formData.timeline,
          description: formData.description,
        })
        .eq('id', id)
        .eq('user_id', user.id);

      if (error) {
        toast({ title: 'Error', description: error.message, variant: 'destructive' });
      } else {
        toast({ title: 'Project updated successfully' });
        navigate(accountHref('submissions'));
      }
    } else {
      // Create new project
      const { error } = await supabase.from('marina_projects').insert({
        user_id: user.id,
        organization_id: organization?.id || null,
        project_type: formData.project_type,
        budget_range: formData.budget_range,
        timeline: formData.timeline,
        description: formData.description,
        status: 'new',
      });
      if (error) {
        toast({ title: 'Erreur', description: error.message, variant: 'destructive' });
      } else {
        notifyAdmin(
          'Project',
          organization?.name || profile?.first_name || user.id.slice(0, 8),
          `Type: ${formData.project_type}, Budget: ${formData.budget_range}, Timeline: ${formData.timeline}`,
        );
        toast({ title: t('submitProject.success') });
        setFormData({ project_type: '', budget_range: '', timeline: '', description: '' });
        setConsent(false);
        navigate(accountHref('submissions'));
      }
    }
    setLoading(false);
  };

  const updateField = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  if (authLoading || loadingExisting) {
    return <PageLoader />;
  }

  if (!isVerifiedMarina) {
    return (
      <SubmitGuard
        icon={Lock}
        title={t('submitProject.restricted')}
        actions={(
          // Only a marina whose account is verified but who has no organization yet has a profile to complete;
          // everyone else is waiting for a review, which the dashboard explains.
          profile?.persona === 'marina' && isVerified && !organization
            ? <Button variant="ctaOnDark" onClick={() => navigate(accountHref('organization'))}>Complete your marina profile</Button>
            : <Button variant="ctaOnDark" onClick={() => navigate('/#dashboard')}>View account status</Button>
        )}
      >
        <p>{t('submitProject.restrictedDesc')}</p>
      </SubmitGuard>
    );
  }

  return (
    <SubmitShell
      seed="submit-project"
      icon={Briefcase}
      eyebrow={t('submitShell.eyebrowOpportunities', 'Opportunities')}
      title={isEditMode ? 'Edit Project' : t('submitProject.title')}
      subtitle={isEditMode ? 'Update your project details below.' : t('submitProject.subtitle')}
      trail={[{ label: t('nav.opportunities', 'Opportunities'), href: '/opportunities' }]}
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        <FormCard
          title={isEditMode ? 'Edit Project Details' : 'Project Details'}
          description={isEditMode ? 'Modify the fields you want to update' : 'Tell us about your project needs'}
        >
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
        </FormCard>

        <FormFooter
          note={isEditMode ? undefined : (
            <>
              {/* A project is private (marina_projects: its author and M3 only): it is not "published". */}
              {t('help.tips.projectNote', 'Only you and the M3 team see your project.')}{' '}
              {/* Learn more opens in a new tab: what was typed in the form stays. */}
              <HelpTip title={t('help.tips.publishTitle', 'What happens next')} more="publishing-project" newTab>
                {t('help.tips.project', 'The M3 team reads your project, usually within one business day, and puts you in touch with suitable service providers. Projects are not shown to other members.')}
              </HelpTip>
            </>
          )}
        >
          <Button type="submit" variant="cta" size="lg" roll={!loading} arrow={!loading} disabled={loading || !consent}>
            {loading ? t('common.loading') : isEditMode ? 'Save Changes' : t('submitProject.submit')}
          </Button>
        </FormFooter>
      </form>
    </SubmitShell>
  );
}
