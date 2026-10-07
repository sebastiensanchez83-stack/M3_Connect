import { useState, useEffect, useRef } from 'react';
import { Loader2, Upload, Link2, ExternalLink, Trash2, Image as ImageIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { BTN_OUTLINE, FOCUS, MemberPanel } from '@/components/member/MemberUI';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { useFileDrop } from '@/hooks/useFileDrop';
import { SPONSORSHIP_BUCKET, SpBrandAsset } from '@/lib/sponsorship';
import { FIELD, ICON_BTN } from './sponsorshipUi';
import { cn } from '@/lib/utils';

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
    <MemberPanel title="Brand assets">
      <div className="space-y-3 p-5">
        <p className="text-[14px] leading-5 text-meta">Logos uploaded once and reused by every "logo on…" placement.</p>
        {assets.length === 0 && <p className="text-[14px] leading-5 text-meta">No brand asset yet.</p>}
        {assets.map(a => (
          <div key={a.id} className="flex items-center justify-between gap-2 rounded-xl border border-rule bg-white py-0.5 pl-3 pr-1">
            <button type="button" onClick={() => view(a)} className={cn('group flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-md text-left', FOCUS)}>
              {a.external_url ? <Link2 className="h-4 w-4 shrink-0 text-meta" aria-hidden="true" /> : <ImageIcon className="h-4 w-4 shrink-0 text-meta" aria-hidden="true" />}
              <span className="min-w-0 truncate py-0.5 text-[14px] text-navy"><span className="card-ul">{a.label || a.filename || 'Logo'}</span></span>
              <ExternalLink className="h-3.5 w-3.5 shrink-0 text-meta" aria-hidden="true" />
              <span className="sr-only">(opens in a new tab)</span>
            </button>
            {canEdit && (
              <Button type="button" size="icon" variant="ghost" className={cn(ICON_BTN, 'text-meta hover:bg-red-50 hover:text-red-700')} disabled={busy === a.id} onClick={() => remove(a)} title="Remove" aria-label="Remove this brand asset">
                {busy === a.id ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Trash2 className="h-4 w-4" aria-hidden="true" />}
              </Button>
            )}
          </div>
        ))}
        {canEdit && (
          <div {...dropHandlers} className={cn('space-y-2 rounded-xl border border-dashed p-3 transition-colors', isDragging ? 'border-navy bg-chip' : 'border-rule')}>
            <Input value={label} onChange={e => setLabel(e.target.value)} placeholder="Label (e.g. Primary logo)" aria-label="Label for the next logo" className={FIELD} />
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" className={cn(BTN_OUTLINE, 'gap-1.5')} disabled={uploading} onClick={() => fileRef.current?.click()}>
                {uploading ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Upload className="h-4 w-4" aria-hidden="true" />} Upload logo
              </Button>
              <span className="text-[13px] text-meta">or drop a file</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Input value={linkUrl} onChange={e => setLinkUrl(e.target.value)} placeholder="or paste a link…" aria-label="Link to a logo" className={cn(FIELD, 'min-w-[140px] flex-1')} />
              <Button type="button" variant="outline" className={BTN_OUTLINE} onClick={addLink}>Add link</Button>
            </div>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" aria-label="Choose a logo file" onChange={e => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
          </div>
        )}
      </div>
    </MemberPanel>
  );
}
