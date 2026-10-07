import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Lock, AlertCircle, Info, Video } from 'lucide-react';
import { FormCard, FormFooter, PageLoader, SubmitGuard, SubmitShell } from '@/components/submit/SubmitShell';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { useEntitlements } from '@/hooks/useEntitlements';
import { supabase } from '@/lib/supabase';
import { Sector } from '@/types/database';
import { toast } from '@/hooks/use-toast';
import { notifyAdmin } from '@/lib/notifications';
import { requireFreshSession } from '@/lib/session';

const FEATURE_KEY = 'webinar_requests';

export function WebinarRequestPage() {
  const { t } = useTranslation();
  const { user, profile, isVerified, organization, loading: authLoading } = useAuth();
  const { isFeatureEnabled, getQuota, getUsage, isLoading: entitlementsLoading } = useEntitlements();
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

  useEffect(() => {
    if (authLoading) return;
    if (!user) { navigate('/'); return; }
    if (isVerified && organization?.access_status === 'verified') {
      supabase.from('sectors').select('*').eq('is_active', true).order('label')
        .then(({ data }) => { if (data) setSectors(data as Sector[]); });
    }
  }, [user, isVerified, organization, authLoading, navigate]);

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
          title: 'This proposal can no longer be edited',
          description: 'Only your own proposals still waiting for review can be changed.',
          variant: 'destructive',
        });
        navigate('/account?tab=webinars', { replace: true });
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
  }, [editId, userId, authLoading, navigate]);

  const toggleSector = (id: string) => {
    setSelectedSectors((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!form.title.trim() || !form.description.trim()) {
      toast({ title: 'Required fields', description: 'Title and description are mandatory.', variant: 'destructive' });
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
        if (!updated || updated.length === 0) throw new Error('This proposal can no longer be edited.');

        const { error: clearError } = await supabase.from('webinar_request_sectors').delete().eq('request_id', editId);
        if (clearError) throw clearError;
        if (selectedSectors.length > 0) {
          const { error: sectorError } = await supabase.from('webinar_request_sectors').insert(
            selectedSectors.map((sector_id) => ({ request_id: editId, sector_id }))
          );
          if (sectorError) throw sectorError;
        }
        toast({ title: 'Webinar request updated', description: 'Our team will review the new version.' });
        navigate('/account?tab=webinars');
        return;
      }

      const { data: request, error } = await supabase
        .from('webinar_requests')
        .insert({
          user_id: user.id,
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
        title: 'Webinar request submitted!',
        description: 'Our team will review your proposal and get back to you.',
      });
      navigate('/account?tab=webinars');
    } catch (err: unknown) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'An error occurred.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  // ── Loading states ────────────────────────────────────────────────────
  if (authLoading || loadingExisting || (isVerified && organization?.access_status === 'verified' && entitlementsLoading)) {
    return <PageLoader />;
  }

  // ── Access guard: not logged in or not verified ───────────────────────
  if (!user || !isVerified || organization?.access_status !== 'verified') {
    return (
      <SubmitGuard
        icon={Lock}
        title="Members Only"
        actions={(
          <>
            {!user && (
              <Button variant="ctaOnDark" onClick={() => navigate('/')}>Go to Homepage</Button>
            )}
            {user && (
              <Button variant="ctaOnDark" onClick={() => navigate('/dashboard')}>View Account Status</Button>
            )}
          </>
        )}
      >
        <p>
          {!user
            ? 'Please log in to propose a webinar topic.'
            : 'Your account must be verified to submit a webinar request.'}
        </p>
      </SubmitGuard>
    );
  }

  // ── Entitlement: webinar requests are open to all verified members ────
  // (tier gating removed — any verified marina/partner can propose)
  void isFeatureEnabled;

  // ── Quota display (quota=null means unlimited) ────────────────────────
  const quota = getQuota(FEATURE_KEY);
  const usage = getUsage(FEATURE_KEY);
  const usedCount = usage?.usage_count ?? 0;
  const remaining = quota !== null ? quota - usedCount : null;
  const quotaExhausted = remaining !== null && remaining <= 0;

  // ── Quota exhausted guard ─────────────────────────────────────────────
  if (quotaExhausted && !isEditMode) {
    return (
      <SubmitGuard
        icon={AlertCircle}
        title="All webinar proposals used"
        actions={(
          <Button asChild variant="ctaOnDark">
            <Link to="/contact?subject=partnership">Contact the M3 team</Link>
          </Button>
        )}
      >
        <p>
          You have used the {quota} webinar proposal{quota === 1 ? '' : 's'} included in your sponsor level for this period.
          Talk to the M3 team if you would like to propose more.
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
      title={isEditMode ? "Edit your webinar proposal" : "Propose a Webinar"}
      subtitle="Suggest a topic or expert you'd like to see featured in a Smart Marina Connect webinar. Our team will review your proposal and notify you."
      trail={[{ label: t('nav.events', 'Events'), href: '/events' }]}
    >
      {/* Quota info banner (only when quota is finite) */}
      {!isEditMode && quota !== null && remaining !== null && (
        <div className="mb-6 flex items-start gap-2.5 rounded-field bg-foam px-4 py-3 text-sm leading-5 text-navy">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-teal" aria-hidden="true" />
          <span>
            You have <strong>{remaining}</strong> webinar request{remaining === 1 ? '' : 's'} remaining
            this period (used {usedCount} of {quota}).
          </span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <FormCard title="Webinar Details" description="Tell us what you'd like to explore">
          <div className="space-y-2">
            <Label>Topic / Title *</Label>
            <Input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              required
              placeholder="e.g. Sustainable shore power solutions for marinas"
            />
          </div>

          <div className="space-y-2">
            <Label>Description *</Label>
            <Textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              required
              rows={5}
              placeholder="Describe the topic, why it matters to the marina industry, any specific questions you'd like answered, or experts you'd like to hear from..."
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Preferred Language</Label>
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
              <Label>Preferred Timeframe</Label>
              <Input
                value={form.preferred_timeframe}
                onChange={(e) => setForm({ ...form, preferred_timeframe: e.target.value })}
                placeholder="e.g. Q3 2026, Autumn 2026"
              />
            </div>
          </div>
        </FormCard>

        <FormCard title="Related Sectors" description="Select the sectors most relevant to this webinar topic">
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
            <p className="py-4 text-center text-sm text-meta">Loading sectors...</p>
          )}
        </FormCard>

        <FormFooter>
          <Button type="submit" variant="cta" size="lg" roll={!loading} arrow={!loading} disabled={loading}>
            {loading
              ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />{isEditMode ? 'Saving...' : 'Submitting...'}</>
              : isEditMode ? 'Save changes' : 'Submit Webinar Request'
            }
          </Button>
        </FormFooter>
      </form>
    </SubmitShell>
  );
}
