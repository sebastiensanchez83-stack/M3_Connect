import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Lock, Video } from 'lucide-react';
import { FormCard, FormFooter, PageLoader, SubmitGuard, SubmitShell } from '@/components/submit/SubmitShell';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { Sector } from '@/types/database';
import { toast } from '@/hooks/use-toast';
import { accountHref } from '@/lib/accountNav';
import { notifyAdmin } from '@/lib/notifications';
import { requireFreshSession } from '@/lib/session';

/**
 * Propose a webinar topic.
 *
 * Open to every person M3 verified, with or without a company (Victor, 9 Oct 2026).
 * The database allows it since 20261009204234 (webinar_proposals_any_verified_member),
 * which also lifted the old subscription quota: the page no longer reads entitlements,
 * and no longer asks for a validated company. The active company, when there is one,
 * is still attached to the proposal for the M3 team.
 *
 * The rights switch (src/lib/capabilities.ts) changes nothing here: every verified
 * person has propose_webinar (the participant set), so the page asks only that.
 */
export function WebinarRequestPage() {
  const { t } = useTranslation();
  const { user, isVerified, organization, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  // /request-webinar?edit=<id> (the Edit button on a submitted proposal in the account) loads that proposal and updates it.
  const [searchParams] = useSearchParams();
  const editId = searchParams.get('edit');
  const isEditMode = Boolean(editId);
  const userId = user?.id;
  const [loadingExisting, setLoadingExisting] = useState(Boolean(editId));
  const [loading, setLoading] = useState(false);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [selectedSectors, setSelectedSectors] = useState<string[]>([]);

  const [form, setForm] = useState({
    title: '',
    description: '',
    preferred_language: 'EN',
    preferred_timeframe: '',
  });

  // Who may propose: every person M3 verified, company or not.
  const mayPropose = !!user && isVerified;

  useEffect(() => {
    if (authLoading) return;
    if (!userId) { navigate('/'); return; }
    if (mayPropose) {
      supabase.from('sectors').select('*').eq('is_active', true).order('label')
        .then(({ data }) => { if (data) setSectors(data as Sector[]); });
    }
  }, [userId, mayPropose, authLoading, navigate]);

  // Edit mode: load the member's own proposal (still waiting for review) into the form.
  useEffect(() => {
    if (!editId) { setLoadingExisting(false); return; }
    if (authLoading || !userId) return;
    let alive = true;
    setLoadingExisting(true);
    (async () => {
      const { data, error } = await supabase
        .from('webinar_requests')
        .select('id, user_id, title, description, preferred_language, preferred_timeframe, status')
        .eq('id', editId)
        .maybeSingle();
      if (!alive) return;
      if (error || !data || data.user_id !== userId || data.status !== 'submitted') {
        toast({
          title: t('webinarRequest.cannotEditTitle', 'This proposal can no longer be edited'),
          description: t('webinarRequest.cannotEditBody', 'Only your own proposals still waiting for review can be changed.'),
          variant: 'destructive',
        });
        navigate(accountHref('webinars'), { replace: true });
        return;
      }
      setForm({
        title: data.title ?? '',
        description: data.description ?? '',
        preferred_language: data.preferred_language ?? 'EN',
        preferred_timeframe: data.preferred_timeframe ?? '',
      });
      const { data: links } = await supabase.from('webinar_request_sectors').select('sector_id').eq('request_id', editId);
      if (!alive) return;
      setSelectedSectors((links ?? []).map((l) => l.sector_id as string));
      setLoadingExisting(false);
    })();
    return () => { alive = false; };
  }, [editId, userId, authLoading, navigate, t]);

  const toggleSector = (id: string) => {
    setSelectedSectors((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!form.title.trim() || !form.description.trim()) {
      toast({
        title: t('webinarRequest.requiredTitle', 'Required fields'),
        description: t('webinarRequest.requiredBody', 'Title and description are mandatory.'),
        variant: 'destructive',
      });
      return;
    }

    const uid = await requireFreshSession();
    if (!uid) return;

    setLoading(true);
    try {
      if (editId) {
        // Update the proposal in place instead of creating a second one.
        const { data: updated, error: updateError } = await supabase
          .from('webinar_requests')
          .update({
            title: form.title.trim(),
            description: form.description.trim(),
            preferred_language: form.preferred_language,
            preferred_timeframe: form.preferred_timeframe.trim() || null,
          })
          .eq('id', editId)
          .eq('user_id', user.id)
          .eq('status', 'submitted')
          .select('id');
        if (updateError) throw updateError;
        if (!updated || updated.length === 0) throw new Error(t('webinarRequest.cannotEditTitle', 'This proposal can no longer be edited'));

        const { error: clearError } = await supabase.from('webinar_request_sectors').delete().eq('request_id', editId);
        if (clearError) throw clearError;
        if (selectedSectors.length > 0) {
          const { error: sectorError } = await supabase.from('webinar_request_sectors').insert(
            selectedSectors.map((sector_id) => ({ request_id: editId, sector_id }))
          );
          if (sectorError) throw sectorError;
        }
        toast({
          title: t('webinarRequest.updatedTitle', 'Webinar proposal updated'),
          description: t('webinarRequest.updatedBody', 'Our team will review the new version.'),
        });
        navigate(accountHref('webinars'));
        return;
      }

      const { data: request, error } = await supabase
        .from('webinar_requests')
        .insert({
          user_id: user.id,
          // The active company, when there is one: context for the M3 team, not a condition.
          organization_id: organization?.id || null,
          title: form.title.trim(),
          description: form.description.trim(),
          preferred_language: form.preferred_language,
          preferred_timeframe: form.preferred_timeframe.trim() || null,
          status: 'submitted',
        })
        .select('id')
        .single();

      if (error) throw error;

      if (selectedSectors.length > 0 && request) {
        await supabase.from('webinar_request_sectors').insert(
          selectedSectors.map((sector_id) => ({ request_id: request.id, sector_id }))
        );
      }

      notifyAdmin('Webinar Proposal', form.title.trim(), `Language: ${form.preferred_language}`);

      toast({
        title: t('webinarRequest.sentTitle', 'Webinar proposal sent'),
        description: t('webinarRequest.sentBody', 'Our team will review your proposal and get back to you.'),
      });
      navigate(accountHref('webinars'));
    } catch (err: unknown) {
      toast({
        title: t('webinarRequest.errorTitle', 'Your proposal was not sent'),
        description: err instanceof Error ? err.message : t('webinarRequest.errorBody', 'Please check your connection and try again.'),
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  // ── Loading states ────────────────────────────────────────────────────
  if (authLoading || loadingExisting) {
    return <PageLoader />;
  }

  // ── Access guard: signed in and verified by M3 (a company is not required) ──
  if (!mayPropose) {
    return (
      <SubmitGuard
        icon={Lock}
        title={t('webinarRequest.guardTitle', 'Members only')}
        actions={(
          <>
            {!user && (
              <Button variant="ctaOnDark" onClick={() => navigate('/')}>{t('webinarRequest.goHome', 'Go to the home page')}</Button>
            )}
            {user && (
              <Button variant="ctaOnDark" onClick={() => navigate('/#dashboard')}>{t('webinarRequest.viewStatus', 'View account status')}</Button>
            )}
          </>
        )}
      >
        <p>
          {!user
            ? t('webinarRequest.guardSignedOut', 'Please sign in to propose a webinar topic.')
            : t('webinarRequest.guardUnverified', 'You can propose a webinar once the M3 team has verified your account.')}
        </p>
      </SubmitGuard>
    );
  }

  // ── Main form ─────────────────────────────────────────────────────────
  return (
    <SubmitShell
      seed="submit-webinar"
      icon={Video}
      eyebrow={t('submitShell.eyebrowWebinars', 'Webinars')}
      title={isEditMode ? t('webinarRequest.editTitle', 'Edit your webinar proposal') : t('webinarRequest.title', 'Propose a webinar')}
      subtitle={t('webinarRequest.subtitle', "Suggest a topic or an expert you would like to see in a Smart Marina Connect webinar. Our team will review your proposal and get back to you.")}
      trail={[{ label: t('nav.events', 'Events'), href: '/events' }]}
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        <FormCard title={t('webinarRequest.detailsTitle', 'Webinar details')} description={t('webinarRequest.detailsDesc', "Tell us what you would like to explore")}>
          <div className="space-y-2">
            <Label htmlFor="webinar-title">{t('webinarRequest.topicLabel', 'Topic or title')} *</Label>
            <Input
              id="webinar-title"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              required
              placeholder={t('webinarRequest.topicPlaceholder', 'e.g. Sustainable shore power for marinas')}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="webinar-description">{t('webinarRequest.descriptionLabel', 'Description')} *</Label>
            <Textarea
              id="webinar-description"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              required
              rows={5}
              placeholder={t('webinarRequest.descriptionPlaceholder', 'Describe the topic, why it matters to marinas, the questions you would like answered, or the experts you would like to hear...')}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>{t('webinarRequest.languageLabel', 'Preferred language')}</Label>
              <Select
                value={form.preferred_language}
                onValueChange={(v) => setForm({ ...form, preferred_language: v })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="EN">English</SelectItem>
                  <SelectItem value="FR">Français</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="webinar-timeframe">{t('webinarRequest.timeframeLabel', 'Preferred timeframe')}</Label>
              <Input
                id="webinar-timeframe"
                value={form.preferred_timeframe}
                onChange={(e) => setForm({ ...form, preferred_timeframe: e.target.value })}
                placeholder={t('webinarRequest.timeframePlaceholder', 'e.g. Q1 2027, spring 2027')}
              />
            </div>
          </div>
        </FormCard>

        <FormCard title={t('webinarRequest.sectorsTitle', 'Related sectors')} description={t('webinarRequest.sectorsDesc', 'Select the sectors most relevant to this topic')}>
          <div className="grid max-h-60 grid-cols-1 gap-2 overflow-y-auto rounded-field border border-rule bg-page/60 p-3 sm:grid-cols-2">
            {sectors.map((s) => (
              <div key={s.id} className="flex items-center space-x-2">
                <Checkbox
                  id={`ws-${s.id}`}
                  checked={selectedSectors.includes(s.id)}
                  onCheckedChange={() => toggleSector(s.id)}
                />
                <Label htmlFor={`ws-${s.id}`} className="text-sm cursor-pointer font-normal">
                  {s.label}
                </Label>
              </div>
            ))}
          </div>
          {sectors.length === 0 && (
            <p className="py-4 text-center text-sm text-meta">{t('webinarRequest.sectorsLoading', 'Loading sectors...')}</p>
          )}
        </FormCard>

        <FormFooter>
          <Button type="submit" variant="cta" size="lg" roll={!loading} arrow={!loading} disabled={loading}>
            {loading
              ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />{isEditMode ? t('webinarRequest.saving', 'Saving...') : t('webinarRequest.sending', 'Sending...')}</>
              : isEditMode ? t('webinarRequest.save', 'Save changes') : t('webinarRequest.send', 'Send the proposal')
            }
          </Button>
        </FormFooter>
      </form>
    </SubmitShell>
  );
}
