import { useState, useEffect, useCallback, useId } from 'react';
import { Image as ImageIcon, FileText, ExternalLink, Download, Plus, Trash2, Loader2, Link2, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { CardShell } from '@/components/brand/CardShell';
import { BTN } from '@/components/member/MemberUI';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

// Press room: the material an outlet needs, and the coverage it produces.
// Resources come in two modes — a link to the organiser's own site (Yacht Club
// events) or a file hosted here. Hosted downloads are signed on the fly and
// logged; links are logged too, so the reporting is complete either way.

interface PressResource {
  id: string; event_id: string; kind: 'photos' | 'press_release'; mode: 'link' | 'hosted';
  url: string | null; storage_path: string | null; filename: string | null;
  title: string | null; embargo_at: string | null;
  sm_event: { name: string | null; slug: string } | null;
}
interface Coverage {
  id: string; url: string; outlet: string | null; title: string | null;
  published_at: string | null; event_id: string | null;
}

const EMPTY = { url: '', outlet: '', title: '', published_at: '' };

// Kit pieces of the member area (as in NotificationPreferencesTab): the icon in a
// chip tile, semibold navy field labels, the quiet empty line.
const TILE = 'grid h-10 w-10 shrink-0 place-items-center rounded-field bg-chip text-navy';
const LABEL = 'text-[13px] font-semibold leading-5 text-navy';
const EMPTY_LINE = 'rounded-field border border-dashed border-rule bg-page px-4 py-5 text-center text-[14px] leading-5 text-meta';

/** A card's head: the icon tile, the title (an h3 under the tab's h2) and an optional line of help. */
function CardHead({ icon: Icon, title, hint }: { icon: LucideIcon; title: string; hint?: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className={TILE} aria-hidden="true">
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <h3 className="text-card-title text-navy">{title}</h3>
        {hint && <p className="mt-0.5 text-[14px] leading-5 text-meta">{hint}</p>}
      </div>
    </div>
  );
}

export function MediaPressRoom() {
  const { user, organization } = useAuth();
  const [resources, setResources] = useState<PressResource[]>([]);
  const [coverage, setCoverage] = useState<Coverage[]>([]);
  const [eventId, setEventId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fieldId = useId();

  const load = useCallback(async () => {
    const [res, cov, ev] = await Promise.all([
      supabase.from('event_press_resource')
        .select('id, event_id, kind, mode, url, storage_path, filename, title, embargo_at, sm_event(name, slug)')
        .order('created_at', { ascending: false }),
      supabase.from('media_coverage')
        .select('id, url, outlet, title, published_at, event_id')
        .order('published_at', { ascending: false, nullsFirst: false }),
      supabase.from('sm_event').select('id').eq('slug', 'sm26').maybeSingle(),
    ]);
    setResources((res.data || []) as unknown as PressResource[]);
    setCoverage((cov.data || []) as Coverage[]);
    setEventId((ev.data as { id: string } | null)?.id || null);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const open = async (r: PressResource) => {
    setBusy(r.id);
    try {
      let href = r.url;
      if (r.mode === 'hosted' && r.storage_path) {
        const { data } = await supabase.storage.from('event-media').createSignedUrl(r.storage_path, 300);
        href = data?.signedUrl || null;
      }
      if (!href) { toast({ title: 'This item is unavailable', variant: 'destructive' }); return; }
      window.open(href, '_blank');
      await supabase.rpc('media_log_download', {
        p_resource_type: r.kind === 'photos' ? 'photo_link' : 'press_release',
        p_resource_id: r.id,
        p_resource_ref: r.mode === 'hosted' ? r.storage_path : r.url,
        p_label: r.title || r.filename || (r.kind === 'photos' ? 'Photos' : 'Press release'),
        p_event_id: r.event_id,
      });
    } finally { setBusy(null); }
  };

  const addCoverage = async () => {
    if (!form.url.trim()) { toast({ title: 'A link is required', variant: 'destructive' }); return; }
    setSaving(true);
    const { error } = await supabase.from('media_coverage').insert({
      user_id: user!.id,
      organization_id: organization?.id ?? null,
      event_id: eventId,
      url: form.url.trim(),
      outlet: form.outlet.trim() || null,
      title: form.title.trim() || null,
      published_at: form.published_at || null,
    });
    setSaving(false);
    if (error) { toast({ title: 'Could not save', description: error.message, variant: 'destructive' }); return; }
    setForm(EMPTY);
    toast({ title: 'Coverage added', description: 'Thank you — the organisers can see it.' });
    load();
  };

  const removeCoverage = async (id: string) => {
    if (!confirm('Remove this coverage?')) return;
    const { error } = await supabase.from('media_coverage').delete().eq('id', id);
    if (error) { toast({ title: 'Could not remove', description: error.message, variant: 'destructive' }); return; }
    load();
  };

  if (loading) return <div className="py-10 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-meta" /></div>;

  const photos = resources.filter(r => r.kind === 'photos');
  const releases = resources.filter(r => r.kind === 'press_release');

  const item = (r: PressResource) => (
    <button key={r.id} type="button" disabled={busy === r.id} onClick={() => open(r)}
      className="flex min-h-11 w-full items-center gap-3 rounded-field border border-rule bg-white px-3.5 py-2.5 text-left transition-colors hover:border-navy/30 hover:bg-page focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50">
      {busy === r.id ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-navy" aria-hidden="true" />
        : r.mode === 'link' ? <ExternalLink className="h-4 w-4 shrink-0 text-navy" aria-hidden="true" />
        : <Download className="h-4 w-4 shrink-0 text-navy" aria-hidden="true" />}
      <span className="min-w-0 flex-1 truncate text-[14px] font-medium leading-5 text-navy">
        {r.title || r.filename || (r.kind === 'photos' ? 'Photo library' : 'Press release')}
      </span>
      {r.sm_event?.name && (
        <Badge variant="outline" className="shrink-0 border-transparent bg-chip text-[12px] font-medium text-navy">{r.sm_event.name}</Badge>
      )}
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <CardShell className="p-5 sm:p-6">
          <CardHead icon={ImageIcon} title="Photos" />
          <div className="mt-4">
            {photos.length === 0
              ? <p className={EMPTY_LINE}>No photo library published yet.</p>
              : <div className="space-y-2">{photos.map(item)}</div>}
          </div>
        </CardShell>
        <CardShell className="p-5 sm:p-6">
          <CardHead icon={FileText} title="Press releases" />
          <div className="mt-4">
            {releases.length === 0
              ? <p className={EMPTY_LINE}>No press release published yet.</p>
              : <div className="space-y-2">{releases.map(item)}</div>}
          </div>
        </CardShell>
      </div>

      <CardShell className="p-5 sm:p-6">
        <CardHead
          icon={Link2}
          title="My coverage"
          hint="Share what you publish about the event — the organisers see it and it feeds the coverage report."
        />
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor={`${fieldId}-url`} className={LABEL}>Link *</Label>
            <Input id={`${fieldId}-url`} value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} placeholder="https://" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${fieldId}-outlet`} className={LABEL}>Outlet</Label>
            <Input id={`${fieldId}-outlet`} value={form.outlet} onChange={e => setForm({ ...form, outlet: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${fieldId}-date`} className={LABEL}>Published on</Label>
            <Input id={`${fieldId}-date`} type="date" value={form.published_at} onChange={e => setForm({ ...form, published_at: e.target.value })} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor={`${fieldId}-title`} className={LABEL}>Title</Label>
            <Input id={`${fieldId}-title`} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <Button className={cn(BTN, 'gap-1.5')} disabled={saving} onClick={addCoverage}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />} Add coverage
          </Button>
        </div>

        {coverage.length > 0 && (
          <ul className="mt-5 divide-y divide-rule border-t border-rule">
            {coverage.map(c => (
              <li key={c.id} className="flex items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <a
                    href={c.url}
                    target="_blank"
                    rel="noreferrer"
                    className="focus-ring block truncate rounded-badge text-[14px] font-medium leading-5 text-navy underline decoration-navy/30 underline-offset-2 transition-colors hover:text-teal-text hover:decoration-current"
                  >
                    {c.title || c.url}
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                  <div className="mt-0.5 text-[13px] leading-5 text-meta">
                    {c.outlet}{c.outlet && c.published_at ? ' · ' : ''}
                    {c.published_at ? new Date(c.published_at).toLocaleDateString('en-GB') : ''}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => removeCoverage(c.id)}
                  aria-label="Remove this coverage"
                  title="Remove this coverage"
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-pill text-meta transition-colors hover:bg-red-50 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardShell>
    </div>
  );
}
