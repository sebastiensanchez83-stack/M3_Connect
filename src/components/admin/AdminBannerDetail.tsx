import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Save, Trash2, Loader2, Image as ImageIcon, Eye, EyeOff, Upload, MonitorSmartphone,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { CardButton } from '@/components/home/dashboard/DashboardKit';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import {
  AdminDetailHeader, AdminKpiCard, AdminLoading, AdminPanel, AdminStatusPill, ADMIN_BTN, ADMIN_BTN_DANGER, ADMIN_BTN_PRIMARY,
} from './AdminUI';
import { ADMIN_INPUT, CheckCard, FormField } from './v2/ContentFormKit';

const BANNER_BUCKET = 'ad-banners';

interface AdBanner {
  id: string;
  title: string;
  image_url: string;
  target_url: string;
  placement: string;
  placements: string[];
  is_active: boolean;
  start_date: string | null;
  end_date: string | null;
  click_count: number;
  impression_count: number;
  organization_id: string | null;
  created_at: string;
}

interface OrgOption {
  id: string;
  name: string;
}

// announcement_top = strip above the navbar (homepage) · announcement_popup =
// site-wide popup. Both are for event/webinar announcements, not sponsor ads.
const PLACEMENTS = ['homepage', 'marketplace', 'resources', 'events', 'announcement_top', 'announcement_popup'] as const;

// One advert now carries a SET of pages, so the same creative is uploaded once
// and ticked onto every page it runs on.
const SPONSOR_PAGES: { value: string; label: string; hint?: string }[] = [
  { value: 'homepage', label: 'Homepage' },
  { value: 'marketplace', label: 'Marketplace' },
  { value: 'resources', label: 'Articles', hint: 'the list of articles and every article page' },
  { value: 'events', label: 'Events' },
];
const ANNOUNCEMENT_SLOTS: { value: string; label: string; hint?: string }[] = [
  { value: 'announcement_top', label: 'Top strip', hint: 'a bar above the menu, on every page' },
  { value: 'announcement_popup', label: 'Popup', hint: 'a small window that opens over the site' },
];
const isAnnouncement = (p: string[]) => p.some(x => x.startsWith('announcement_'));

export function AdminBannerDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const isNew = id === 'new';

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [banner, setBanner] = useState<AdBanner | null>(null);
  const [organizations, setOrganizations] = useState<OrgOption[]>([]);

  const [form, setForm] = useState({
    title: '',
    image_url: '',
    target_url: '',
    placements: ['homepage'] as string[],
    is_active: true,
    start_date: '',
    end_date: '',
    organization_id: '',
  });

  useEffect(() => {
    loadOrganizations();
    if (!isNew && id) loadBanner(id);
  }, [id]);

  const loadOrganizations = async () => {
    const { data } = await supabase
      .from('organizations')
      .select('id, name')
      .order('name');
    setOrganizations((data || []) as OrgOption[]);
  };

  const loadBanner = async (bannerId: string) => {
    setLoading(true);
    const { data, error } = await supabase
      .from('ad_banners')
      .select('*')
      .eq('id', bannerId)
      .single();

    if (error || !data) {
      toast({ title: 'Banner not found', variant: 'destructive' });
      navigate('/admin/banners');
      return;
    }

    const b = data as AdBanner;
    setBanner(b);
    setForm({
      title: b.title,
      image_url: b.image_url,
      target_url: b.target_url,
      // Defensive: falls back to the legacy single column if placements is empty.
      placements: b.placements?.length ? b.placements : [b.placement],
      is_active: b.is_active,
      start_date: b.start_date ? new Date(b.start_date).toISOString().slice(0, 16) : '',
      end_date: b.end_date ? new Date(b.end_date).toISOString().slice(0, 16) : '',
      organization_id: b.organization_id || '',
    });
    setLoading(false);
  };

  const handleSave = async () => {
    if (form.placements.length === 0) {
      toast({ title: 'Pick at least one page', variant: 'destructive' });
      return;
    }
    // Announcements are text-only strips — they legitimately carry no image, and
    // requiring one meant the live SM26 announcement row could never be saved.
    const needsImage = !isAnnouncement(form.placements);
    if (!form.title || !form.target_url || (needsImage && !form.image_url)) {
      toast({
        title: needsImage ? 'Title, image, and target URL are required' : 'Title and target URL are required',
        variant: 'destructive',
      });
      return;
    }
    setSaving(true);
    const payload = {
      title: form.title,
      image_url: form.image_url,
      target_url: form.target_url,
      placements: form.placements,
      // Mirrors the set's first entry for any code still reading the old single
      // column; a DB trigger keeps the two in step either way.
      placement: form.placements[0],
      is_active: form.is_active,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      organization_id: form.organization_id || null,
    };

    if (isNew) {
      const { data, error } = await supabase.from('ad_banners').insert(payload).select().single();
      if (error) {
        toast({ title: 'Failed to create banner', variant: 'destructive' });
        setSaving(false);
        return;
      }
      toast({ title: 'Banner created!' });
      navigate(`/admin/banners/${data.id}`, { replace: true });
    } else if (banner) {
      const { error } = await supabase.from('ad_banners').update(payload).eq('id', banner.id);
      if (error) {
        toast({ title: 'Failed to update banner', variant: 'destructive' });
        setSaving(false);
        return;
      }
      toast({ title: 'Banner saved!' });
      loadBanner(banner.id);
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!banner || !confirm('Delete this banner permanently?')) return;
    await supabase.from('ad_banners').delete().eq('id', banner.id);
    toast({ title: 'Banner deleted' });
    navigate('/admin/banners');
  };

  const handleToggleActive = async () => {
    if (!banner) return;
    const newActive = !form.is_active;
    setForm(f => ({ ...f, is_active: newActive }));
    await supabase.from('ad_banners').update({ is_active: newActive }).eq('id', banner.id);
    toast({ title: newActive ? 'Banner activated' : 'Banner deactivated' });
  };

  if (loading) return <AdminLoading />;

  const ctr = banner && banner.impression_count > 0
    ? ((banner.click_count / banner.impression_count) * 100).toFixed(2) + '%'
    : '—';

  const announcementMode = isAnnouncement(form.placements);
  const allPages = SPONSOR_PAGES.every(p => form.placements.includes(p.value));
  // A row is either a sponsor advert or a site announcement — never both (the DB
  // enforces the same rule), so switching sides replaces the selection.
  const togglePlacement = (value: string) => setForm(f => {
    const mixing = isAnnouncement([value]) !== isAnnouncement(f.placements);
    const base = mixing ? [] : f.placements;
    return {
      ...f,
      placements: base.includes(value) ? base.filter(x => x !== value) : [...base, value],
    };
  });

  const saveLabel = isNew ? t('adminContent.banner.create', 'Create the banner') : t('adminContent.banner.save', 'Save the changes');

  return (
    <div className="mx-auto max-w-4xl">
      <AdminDetailHeader
        back={{ to: '/admin/banners', label: t('adminContent.banner.back', 'Back to Banners and announcements') }}
        title={isNew ? t('adminContent.banner.newTitle', 'New banner') : form.title || t('adminContent.banner.untitled', 'Banner without a title')}
        badges={!isNew ? (
          <AdminStatusPill tone={form.is_active ? 'success' : 'neutral'}>
            {form.is_active ? 'Active' : 'Inactive'}
          </AdminStatusPill>
        ) : undefined}
        subtitle={!isNew ? (form.is_active
          ? t('adminContent.banner.onHint', 'Switched on: shown on the site between its dates.')
          : t('adminContent.banner.offHint', 'Switched off: not shown on the site.')) : undefined}
        actions={
          // Three buttons do not fit on one phone line: the header's action box takes the width of
          // its content, so this box is capped at the screen (less the page gutters) and wraps.
          <div className="flex max-w-[calc(100vw-2rem)] flex-wrap items-center gap-2 sm:max-w-none">
            {!isNew && (
              <>
                <Button variant="outline" onClick={handleToggleActive} className={ADMIN_BTN + ' gap-1.5'}>
                  {form.is_active
                    ? <><EyeOff className="h-4 w-4" aria-hidden="true" /> {t('adminContent.banner.turnOff', 'Hide from the site')}</>
                    : <><Eye className="h-4 w-4" aria-hidden="true" /> {t('adminContent.banner.turnOn', 'Show on the site')}</>
                  }
                </Button>
                <Button variant="outline" onClick={handleDelete} className={ADMIN_BTN_DANGER + ' gap-1.5'}>
                  <Trash2 className="h-4 w-4" aria-hidden="true" /> {t('adminContent.banner.delete', 'Delete')}
                </Button>
              </>
            )}
            <Button variant="secondary" onClick={handleSave} disabled={saving} className={ADMIN_BTN_PRIMARY + ' gap-1.5'}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
              {saveLabel}
            </Button>
          </div>
        }
      />

      <div className="space-y-6">
        {/* Figures (existing banners only) */}
        {!isNew && banner && (
          <div className="grid gap-3 sm:grid-cols-3">
            <AdminKpiCard label={t('adminContent.banner.views', 'Times shown')} value={banner.impression_count.toLocaleString()} />
            <AdminKpiCard label={t('adminContent.banner.clicks', 'Clicks')} value={banner.click_count.toLocaleString()} />
            <AdminKpiCard label={t('adminContent.banner.ctr', 'Click rate')} value={ctr} hint={t('adminContent.banner.ctrHint', 'Clicks for each 100 times shown')} />
          </div>
        )}

        <AdminPanel title={t('adminContent.banner.panel', 'The banner')} icon={ImageIcon}>
          <div className="space-y-5">
            <FormField label={t('adminContent.banner.titleLabel', 'Title')} htmlFor="banner-title" required hint={t('adminContent.banner.titleHint', 'For the team only: the title is not shown on the site.')}>
              <Input
                id="banner-title"
                value={form.title}
                onChange={e => setForm({ ...form, title: e.target.value })}
                placeholder="Banner title (internal reference)"
                className={ADMIN_INPUT}
              />
            </FormField>

            {/* Banner image upload — uses private ad-banners bucket, no shared gallery */}
            <FormField
              label={t('adminContent.banner.image', 'Image')}
              required={!announcementMode}
              hint={announcementMode ? t('adminContent.banner.imageOptional', 'Optional: an announcement is text only.') : undefined}
            >
              {form.image_url ? (
                <div className="space-y-2">
                  <div className="overflow-hidden rounded-xl border border-rule bg-chip">
                    <img src={form.image_url} alt="" className="h-40 w-full object-cover" />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setForm({ ...form, image_url: '' })}
                    className={ADMIN_BTN_DANGER + ' h-9 gap-1.5'}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" /> {t('adminContent.banner.removeImage', 'Remove this image')}
                  </Button>
                </div>
              ) : (
                <label className="block cursor-pointer rounded-xl border-2 border-dashed border-navy/30 bg-white p-6 text-center transition-colors hover:border-navy/60 hover:bg-chip/50 focus-within:shadow-focus">
                  {uploading ? (
                    <span className="flex flex-col items-center gap-2" role="status">
                      <Loader2 className="h-8 w-8 animate-spin text-navy" aria-hidden="true" />
                      <span className="text-[14px] text-meta">{t('adminContent.banner.uploading', 'Uploading…')}</span>
                    </span>
                  ) : (
                    <span className="flex flex-col items-center gap-2">
                      <Upload className="h-7 w-7 text-navy" aria-hidden="true" />
                      <span className="inline-flex min-h-10 items-center rounded-pill border border-navy/55 bg-white px-4 text-[15px] font-semibold text-navy">
                        {t('adminContent.banner.choose', 'Choose an image on this computer')}
                      </span>
                      <span className="text-[13px] leading-[18px] text-meta">JPEG, PNG, WebP or GIF (animated is fine) · 10 MB at most · best at 1200 × 300 (4:1), for every page</span>
                    </span>
                  )}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    className="sr-only"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      if (!file.type.startsWith('image/')) {
                        toast({ title: 'Invalid file type', variant: 'destructive' });
                        return;
                      }
                      if (file.size > 10 * 1024 * 1024) {
                        toast({ title: 'File too large (max 10MB)', variant: 'destructive' });
                        return;
                      }
                      setUploading(true);
                      try {
                        const ext = file.name.split('.').pop() || 'jpg';
                        const fileName = `banner-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
                        const { error: uploadErr } = await supabase.storage
                          .from(BANNER_BUCKET)
                          .upload(fileName, file, { cacheControl: '3600', upsert: false });
                        if (uploadErr) throw uploadErr;
                        const { data: urlData } = supabase.storage.from(BANNER_BUCKET).getPublicUrl(fileName);
                        setForm(f => ({ ...f, image_url: urlData.publicUrl }));
                        toast({ title: 'Banner image uploaded' });
                      } catch (err: unknown) {
                        toast({ title: 'Upload failed', description: err instanceof Error ? err.message : 'Unknown error', variant: 'destructive' });
                      }
                      setUploading(false);
                      e.target.value = '';
                    }}
                  />
                </label>
              )}
            </FormField>

            <FormField label={t('adminContent.banner.target', 'Where a click leads (web address)')} htmlFor="banner-target" required>
              <Input
                id="banner-target"
                value={form.target_url}
                onChange={e => setForm({ ...form, target_url: e.target.value })}
                placeholder="https://..."
                className={ADMIN_INPUT}
              />
            </FormField>
          </div>
        </AdminPanel>

        {/* Upload once, tick every page it runs on — instead of one row (and one
            re-uploaded image) per page, which is how the same advert used to end
            up duplicated four times with its stats split four ways. */}
        <AdminPanel
          title={t('adminContent.banner.where', 'Where it shows')}
          icon={MonitorSmartphone}
          description={announcementMode
            ? t('adminContent.banner.isAnnouncement', 'This is a site announcement (an event, a webinar), not a sponsor’s advert.')
            : t('adminContent.banner.isAdvert', 'This is a sponsor’s advert. Tick every page it runs on.')}
          actions={!announcementMode ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => setForm(f => ({
                ...f,
                placements: allPages ? [] : SPONSOR_PAGES.map(p => p.value),
              }))}
              className={ADMIN_BTN + ' h-9'}
            >
              {allPages ? t('adminContent.banner.untickAll', 'Untick every page') : t('adminContent.banner.tickAll', 'Show on every page')}
            </Button>
          ) : undefined}
        >
          <p className="mb-2 text-[14px] font-semibold leading-5 text-navy">
            {t('adminContent.banner.pages', 'Show on these pages')}<span aria-hidden="true" className="text-red-700"> *</span>
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {(announcementMode ? ANNOUNCEMENT_SLOTS : SPONSOR_PAGES).map(p => (
              <CheckCard
                key={p.value}
                checked={form.placements.includes(p.value)}
                onToggle={() => togglePlacement(p.value)}
                label={p.label}
                hint={p.hint}
              />
            ))}
          </div>
          <div className="mt-4 flex flex-col gap-2 border-t border-rule pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[13px] leading-[18px] text-meta">
              {announcementMode
                ? t('adminContent.banner.switchToAdvertHint', 'Not an announcement? Change it into a sponsor’s advert.')
                : t('adminContent.banner.switchToAnnHint', 'Announcing an event rather than showing an advert?')}
            </p>
            <CardButton onClick={() => setForm(f => ({ ...f, placements: announcementMode ? ['homepage'] : ['announcement_top'] }))}>
              {announcementMode
                ? t('adminContent.banner.toAdvert', 'Make it a sponsor’s advert')
                : t('adminContent.banner.toAnnouncement', 'Make it a site announcement')}
            </CardButton>
          </div>
        </AdminPanel>

        <AdminPanel title={t('adminContent.banner.whoWhen', 'Sponsor and dates')}>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <FormField label={t('adminContent.banner.company', 'Company')} htmlFor="banner-org" optional className="sm:col-span-2 sm:max-w-md">
              <Select
                value={form.organization_id || 'none'}
                onValueChange={v => setForm({ ...form, organization_id: v === 'none' ? '' : v })}
              >
                <SelectTrigger id="banner-org" className={ADMIN_INPUT}><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('adminContent.banner.noCompany', 'No company')}</SelectItem>
                  {organizations.map(org => (
                    <SelectItem key={org.id} value={org.id}>{org.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label={t('adminContent.banner.start', 'Starts on')} htmlFor="banner-start" optional hint={t('adminContent.banner.startHint', 'Empty: from now on.')}>
              <Input
                id="banner-start"
                type="datetime-local"
                value={form.start_date}
                onChange={e => setForm({ ...form, start_date: e.target.value })}
                className={ADMIN_INPUT}
              />
            </FormField>
            <FormField label={t('adminContent.banner.end', 'Ends on')} htmlFor="banner-end" optional hint={t('adminContent.banner.endHint', 'Empty: until it is switched off.')}>
              <Input
                id="banner-end"
                type="datetime-local"
                value={form.end_date}
                onChange={e => setForm({ ...form, end_date: e.target.value })}
                className={ADMIN_INPUT}
              />
            </FormField>
          </div>
        </AdminPanel>

        {/* Preview */}
        {form.image_url && (
          <AdminPanel title={t('adminContent.banner.preview', 'Preview')} icon={Eye} description={t('adminContent.banner.previewHint', 'How the image looks on the site, with its “Sponsored” label.')}>
            <div className="relative overflow-hidden rounded-xl">
              <img src={form.image_url} alt={form.title} className="h-auto w-full rounded-xl object-cover" />
              <span className="absolute right-2 top-2 rounded-full bg-black/50 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
                Sponsored
              </span>
            </div>
          </AdminPanel>
        )}

        {/* The main action again at the end of the form, for a long page on a phone. */}
        <div className="flex justify-end">
          <Button variant="secondary" onClick={handleSave} disabled={saving} className={ADMIN_BTN_PRIMARY + ' gap-1.5'}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
            {saveLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
