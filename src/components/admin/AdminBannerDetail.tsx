import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Save, Trash2, Loader2, Image as ImageIcon, BarChart3,
  ToggleLeft, ToggleRight,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';

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
  { value: 'resources', label: 'Resources', hint: 'the Resources list and every article page' },
  { value: 'events', label: 'Events' },
];
const ANNOUNCEMENT_SLOTS: { value: string; label: string; hint?: string }[] = [
  { value: 'announcement_top', label: 'Top strip', hint: 'bar above the navigation' },
  { value: 'announcement_popup', label: 'Popup', hint: 'site-wide dialog' },
];
const isAnnouncement = (p: string[]) => p.some(x => x.startsWith('announcement_'));

export function AdminBannerDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
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

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );

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

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate('/admin/banners')} className="gap-1.5">
            <ArrowLeft className="h-4 w-4" /> Banners
          </Button>
          <Separator orientation="vertical" className="h-6" />
          <h1 className="text-xl font-bold text-gray-900">
            {isNew ? 'Create Banner' : form.title || 'Edit Banner'}
          </h1>
          {!isNew && (
            <Badge variant={form.is_active ? 'success' : 'secondary'}>
              {form.is_active ? 'Active' : 'Inactive'}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!isNew && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={handleToggleActive}
                className="gap-1.5"
              >
                {form.is_active
                  ? <><ToggleRight className="h-4 w-4" /> Deactivate</>
                  : <><ToggleLeft className="h-4 w-4" /> Activate</>
                }
              </Button>
              <Button variant="outline" size="sm" onClick={handleDelete} className="text-red-600 hover:bg-red-50 gap-1.5">
                <Trash2 className="h-4 w-4" /> Delete
              </Button>
            </>
          )}
          <Button onClick={handleSave} disabled={saving} className="gap-1.5">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {isNew ? 'Create Banner' : 'Save Changes'}
          </Button>
        </div>
      </div>

      {/* Stats (existing banners only) */}
      {!isNew && banner && (
        <div className="grid grid-cols-3 gap-4">
          <Card className="border-0 shadow-sm">
            <CardContent className="py-4 text-center">
              <div className="text-2xl font-bold text-gray-900">{banner.impression_count.toLocaleString()}</div>
              <div className="text-xs text-gray-500">Impressions</div>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm">
            <CardContent className="py-4 text-center">
              <div className="text-2xl font-bold text-gray-900">{banner.click_count.toLocaleString()}</div>
              <div className="text-xs text-gray-500">Clicks</div>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm">
            <CardContent className="py-4 text-center">
              <div className="text-2xl font-bold text-violet-600">{ctr}</div>
              <div className="text-xs text-gray-500">CTR</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Banner Details */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold text-gray-700 flex items-center gap-2">
            <ImageIcon className="h-4 w-4 text-pink-500" /> Banner Details
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Title *</Label>
            <Input
              value={form.title}
              onChange={e => setForm({ ...form, title: e.target.value })}
              placeholder="Banner title (internal reference)"
            />
          </div>

          {/* Banner image upload — uses private ad-banners bucket, no shared gallery */}
          <div className="space-y-2">
            <Label>Banner Image {announcementMode ? <span className="text-gray-400 font-normal">(optional — announcements are text-only)</span> : '*'}</Label>
            {form.image_url ? (
              <div className="relative group rounded-lg overflow-hidden border bg-gray-50">
                <img src={form.image_url} alt="Banner" className="w-full h-40 object-cover" />
                <button
                  type="button"
                  onClick={() => setForm({ ...form, image_url: '' })}
                  className="absolute top-2 right-2 p-1 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <label className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors hover:border-primary/50 hover:bg-gray-50 block">
                {uploading ? (
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    <span className="text-sm text-gray-600">Uploading...</span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2">
                    <ImageIcon className="h-8 w-8 text-gray-400" />
                    <span className="text-sm text-gray-600">Click to upload banner image</span>
                    <span className="text-xs text-gray-400">JPEG, PNG, WebP — Max 10MB — Recommended: 1200×300 (4:1 ratio) — All placements</span>
                  </div>
                )}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
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
          </div>

          <div className="space-y-2">
            <Label>Target URL *</Label>
            <Input
              value={form.target_url}
              onChange={e => setForm({ ...form, target_url: e.target.value })}
              placeholder="https://..."
            />
          </div>

          {/* Upload once, tick every page it runs on — instead of one row (and one
              re-uploaded image) per page, which is how the same advert used to end
              up duplicated four times with its stats split four ways. */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <Label>Show on these pages *</Label>
              {!announcementMode && (
                <button
                  type="button"
                  onClick={() => setForm(f => ({
                    ...f,
                    placements: allPages ? [] : SPONSOR_PAGES.map(p => p.value),
                  }))}
                  className="text-xs text-primary hover:underline"
                >
                  {allPages ? 'Clear all' : 'Show on every page'}
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {(announcementMode ? ANNOUNCEMENT_SLOTS : SPONSOR_PAGES).map(p => {
                const on = form.placements.includes(p.value);
                return (
                  <label
                    key={p.value}
                    className={`flex items-start gap-2.5 rounded-lg border px-3 py-2 cursor-pointer transition-colors ${on ? 'border-primary bg-primary/5' : 'border-gray-200 hover:border-gray-300'}`}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => togglePlacement(p.value)}
                      className="mt-0.5 rounded border-gray-300"
                    />
                    <span className="min-w-0">
                      <span className="text-sm font-medium text-gray-800 block">{p.label}</span>
                      {p.hint && <span className="text-[11px] text-gray-400 block">{p.hint}</span>}
                    </span>
                  </label>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => setForm(f => ({ ...f, placements: announcementMode ? ['homepage'] : ['announcement_top'] }))}
              className="text-xs text-gray-400 hover:text-gray-600"
            >
              {announcementMode ? '← This is a sponsor advert, not an announcement' : 'This is a site announcement, not a sponsor advert →'}
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Organization (optional)</Label>
              <Select
                value={form.organization_id || 'none'}
                onValueChange={v => setForm({ ...form, organization_id: v === 'none' ? '' : v })}
              >
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {organizations.map(org => (
                    <SelectItem key={org.id} value={org.id}>{org.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Start Date (optional)</Label>
              <Input
                type="datetime-local"
                value={form.start_date}
                onChange={e => setForm({ ...form, start_date: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>End Date (optional)</Label>
              <Input
                type="datetime-local"
                value={form.end_date}
                onChange={e => setForm({ ...form, end_date: e.target.value })}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Preview */}
      {form.image_url && (
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-bold text-gray-700 flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-blue-500" /> Preview
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="relative rounded-xl overflow-hidden shadow-sm">
              <img src={form.image_url} alt={form.title} className="w-full h-auto object-cover rounded-xl" />
              <span className="absolute top-2 right-2 bg-black/50 text-white text-[10px] font-medium px-2 py-0.5 rounded-full backdrop-blur-sm">
                Sponsored
              </span>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
