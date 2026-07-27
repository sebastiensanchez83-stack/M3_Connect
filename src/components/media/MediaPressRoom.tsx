import { useState, useEffect, useCallback } from 'react';
import { Image as ImageIcon, FileText, ExternalLink, Download, Plus, Trash2, Loader2, Link2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';

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

export function MediaPressRoom() {
  const { user, organization } = useAuth();
  const [resources, setResources] = useState<PressResource[]>([]);
  const [coverage, setCoverage] = useState<Coverage[]>([]);
  const [eventId, setEventId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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

  if (loading) return <div className="py-10 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-gray-300" /></div>;

  const photos = resources.filter(r => r.kind === 'photos');
  const releases = resources.filter(r => r.kind === 'press_release');

  const item = (r: PressResource) => (
    <button key={r.id} type="button" disabled={busy === r.id} onClick={() => open(r)}
      className="w-full flex items-center gap-2 rounded-lg border border-gray-100 hover:border-primary/40 px-3 py-2 text-left disabled:opacity-50">
      {busy === r.id ? <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
        : r.mode === 'link' ? <ExternalLink className="h-4 w-4 text-primary shrink-0" />
        : <Download className="h-4 w-4 text-primary shrink-0" />}
      <span className="text-sm text-gray-800 truncate flex-1">
        {r.title || r.filename || (r.kind === 'photos' ? 'Photo library' : 'Press release')}
      </span>
      {r.sm_event?.name && <Badge variant="outline" className="text-[10px] shrink-0">{r.sm_event.name}</Badge>}
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="grid md:grid-cols-2 gap-3">
        <Card><CardContent className="pt-6">
          <div className="text-sm font-medium flex items-center gap-2 mb-2"><ImageIcon className="h-4 w-4 text-primary" /> Photos</div>
          {photos.length === 0
            ? <p className="text-xs text-gray-400">No photo library published yet.</p>
            : <div className="space-y-1.5">{photos.map(item)}</div>}
        </CardContent></Card>
        <Card><CardContent className="pt-6">
          <div className="text-sm font-medium flex items-center gap-2 mb-2"><FileText className="h-4 w-4 text-primary" /> Press releases</div>
          {releases.length === 0
            ? <p className="text-xs text-gray-400">No press release published yet.</p>
            : <div className="space-y-1.5">{releases.map(item)}</div>}
        </CardContent></Card>
      </div>

      <Card><CardContent className="pt-6 space-y-3">
        <div>
          <div className="text-sm font-medium flex items-center gap-2"><Link2 className="h-4 w-4 text-primary" /> My coverage</div>
          <p className="text-xs text-gray-500 mt-0.5">
            Share what you publish about the event — the organisers see it and it feeds the coverage report.
          </p>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="space-y-1 sm:col-span-2">
            <Label className="text-xs">Link *</Label>
            <Input value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} placeholder="https://" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Outlet</Label>
            <Input value={form.outlet} onChange={e => setForm({ ...form, outlet: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Published on</Label>
            <Input type="date" value={form.published_at} onChange={e => setForm({ ...form, published_at: e.target.value })} />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label className="text-xs">Title</Label>
            <Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
          </div>
        </div>
        <div className="flex justify-end">
          <Button size="sm" className="gap-1.5" disabled={saving} onClick={addCoverage}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add coverage
          </Button>
        </div>

        {coverage.length > 0 && (
          <div className="divide-y divide-gray-100 border-t border-gray-100 pt-1">
            {coverage.map(c => (
              <div key={c.id} className="py-2 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <a href={c.url} target="_blank" rel="noreferrer" className="text-sm text-primary hover:underline truncate block">
                    {c.title || c.url}
                  </a>
                  <div className="text-xs text-gray-500">
                    {c.outlet}{c.outlet && c.published_at ? ' · ' : ''}
                    {c.published_at ? new Date(c.published_at).toLocaleDateString('en-GB') : ''}
                  </div>
                </div>
                <button onClick={() => removeCoverage(c.id)} className="text-gray-400 hover:text-red-600 p-1 shrink-0">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </CardContent></Card>
    </div>
  );
}
