import { useState, useEffect, useRef } from 'react';
import { Loader2, Upload, Link2, ExternalLink, Trash2, Image as ImageIcon } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { useFileDrop } from '@/hooks/useFileDrop';
import { SPONSORSHIP_BUCKET, SpBrandAsset } from '@/lib/sponsorship';

// Per-sponsor brand-asset locker: logo(s) uploaded once (native or link) and
// reused by every "logo on X" placement, so we don't re-collect it per item.

export function SponsorBrandAssets({ sponsorId, canEdit }: { sponsorId: string; canEdit: boolean }) {
  const [assets, setAssets] = useState<SpBrandAsset[]>([]);
  const [label, setLabel] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { isDragging, dropHandlers } = useFileDrop(files => { const f = files[0]; if (f) void upload(f); }, uploading || !canEdit);

  const load = async () => {
    const { data } = await supabase.from('sp_brand_asset').select('*').eq('sponsor_id', sponsorId).order('created_at', { ascending: true });
    setAssets((data || []) as SpBrandAsset[]);
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [sponsorId]);

  const add = async (row: Partial<SpBrandAsset>) => {
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from('sp_brand_asset').insert({
      sponsor_id: sponsorId, kind: 'logo', label: label.trim() || null, uploaded_by: u?.user?.id || null, ...row,
    });
    if (error) { toast({ title: 'Could not save', description: error.message, variant: 'destructive' }); return false; }
    setLabel(''); await load(); return true;
  };

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const safe = file.name.replace(/[^\w.\-]+/g, '_').slice(-80);
      const path = `${sponsorId}/brand/${Date.now()}-${safe}`;
      const { error: upErr } = await supabase.storage.from(SPONSORSHIP_BUCKET).upload(path, file, { upsert: false });
      if (upErr) { toast({ title: 'Upload failed', description: upErr.message, variant: 'destructive' }); return; }
      const ok = await add({ storage_path: path, filename: file.name, mime: file.type, size_bytes: file.size });
      if (!ok) await supabase.storage.from(SPONSORSHIP_BUCKET).remove([path]).catch(() => {});
      else toast({ title: 'Brand asset uploaded' });
    } finally { setUploading(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  const addLink = async () => {
    const url = linkUrl.trim();
    if (!/^https?:\/\//i.test(url)) { toast({ title: 'Enter a valid URL', variant: 'destructive' }); return; }
    if (await add({ external_url: url, filename: url.split('/').pop() || 'Logo link' })) setLinkUrl('');
  };

  const view = async (a: SpBrandAsset) => {
    if (a.external_url) { window.open(a.external_url, '_blank'); return; }
    if (!a.storage_path) return;
    const { data } = await supabase.storage.from(SPONSORSHIP_BUCKET).createSignedUrl(a.storage_path, 300);
    if (data) window.open(data.signedUrl, '_blank');
  };

  const remove = async (a: SpBrandAsset) => {
    if (!window.confirm('Remove this brand asset?')) return;
    setBusy(a.id);
    if (a.storage_path) await supabase.storage.from(SPONSORSHIP_BUCKET).remove([a.storage_path]).catch(() => {});
    const { error } = await supabase.from('sp_brand_asset').delete().eq('id', a.id);
    setBusy(null);
    if (error) { toast({ title: 'Could not remove', description: error.message, variant: 'destructive' }); return; }
    setAssets(prev => prev.filter(x => x.id !== a.id));
  };

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2"><ImageIcon className="h-4 w-4 text-primary" /> Brand assets</CardTitle>
        <CardDescription>Logos uploaded once and reused by every "logo on…" placement.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {assets.length === 0 && <p className="text-sm text-gray-400">No brand asset yet.</p>}
        {assets.map(a => (
          <div key={a.id} className="flex items-center justify-between gap-2 rounded-lg border border-gray-100 px-3 py-2">
            <button onClick={() => view(a)} className="min-w-0 flex items-center gap-2 text-left group">
              {a.external_url ? <Link2 className="h-4 w-4 text-gray-400 shrink-0" /> : <ImageIcon className="h-4 w-4 text-gray-400 shrink-0" />}
              <span className="text-sm text-gray-800 truncate group-hover:text-primary">{a.label || a.filename || 'Logo'}</span>
              <ExternalLink className="h-3 w-3 text-gray-300 shrink-0" />
            </button>
            {canEdit && (
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-gray-300 hover:text-red-600" disabled={busy === a.id} onClick={() => remove(a)}>
                {busy === a.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              </Button>
            )}
          </div>
        ))}
        {canEdit && (
          <div {...dropHandlers} className={`rounded-lg border border-dashed p-2.5 space-y-2 transition-colors ${isDragging ? 'border-primary bg-primary/5' : 'border-gray-200'}`}>
            <Input value={label} onChange={e => setLabel(e.target.value)} placeholder="Label (e.g. Primary logo)" className="h-8 text-sm" />
            <div className="flex items-center gap-1.5 flex-wrap">
              <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" disabled={uploading} onClick={() => fileRef.current?.click()}>
                {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Upload logo
              </Button>
              <Input value={linkUrl} onChange={e => setLinkUrl(e.target.value)} placeholder="or paste a link…" className="h-8 text-xs flex-1 min-w-[140px]" />
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={addLink}>Add link</Button>
            </div>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
