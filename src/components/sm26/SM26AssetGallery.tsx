import { useState, useEffect } from 'react';
import { Loader2, Download, ChevronLeft, ChevronRight, ImageOff } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';

// Renders a participant's uploaded documents as PREVIEWS (signed-URL thumbnails
// with a paging lightbox; non-images as download buttons), sourced from the
// single sm26-assets resolver so every surface (hub, portfolio, jury, dossier,
// partner) shows the same assets the same way — regardless of where each asset
// is stored or how its key is named. The resolver signs server-side, so an owner
// sees their own imported/… files that per-user storage RLS would block.

export interface SM26Asset {
  role: string; role_assignment_id: string; kind: string;
  label: string; url: string; is_image: boolean; filename: string | null;
}

export function SM26AssetGallery({ registrationId, roleAssignmentId, provided, title = 'Documents', emptyText, compact, onLoaded }: {
  registrationId?: string; roleAssignmentId?: string; provided?: SM26Asset[]; title?: string;
  emptyText?: string; compact?: boolean; onLoaded?: (assets: SM26Asset[]) => void;
}) {
  const [assets, setAssets] = useState<SM26Asset[]>(provided || []);
  const [loading, setLoading] = useState(!provided);
  const [openPos, setOpenPos] = useState<number | null>(null);

  useEffect(() => {
    if (provided) { setAssets(provided); setLoading(false); return; }
    let active = true;
    setLoading(true);
    const body: Record<string, string> = {};
    if (roleAssignmentId) body.role_assignment_id = roleAssignmentId;
    else if (registrationId) body.registration_id = registrationId;
    supabase.functions.invoke('sm26-assets', { body }).then(({ data }) => {
      if (!active) return;
      const list = ((data as { assets?: SM26Asset[] } | null)?.assets || []);
      setAssets(list);
      setLoading(false);
      onLoaded?.(list);
    }).catch(() => { if (active) { setAssets([]); setLoading(false); } });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registrationId, roleAssignmentId, provided]);

  const imgIndex = assets.map((a, i) => ({ a, i })).filter(x => x.a.is_image).map(x => x.i);
  const cur = openPos != null ? imgIndex[openPos] : null;
  const go = (d: number) => setOpenPos(p => (p == null ? p : (p + d + imgIndex.length) % imgIndex.length));

  useEffect(() => {
    if (openPos == null) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'ArrowLeft') go(-1); if (e.key === 'ArrowRight') go(1); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openPos, imgIndex.length]);

  if (loading) return <div className="flex items-center gap-2 text-sm text-gray-400 py-3"><Loader2 className="h-4 w-4 animate-spin" /> Loading documents…</div>;
  if (assets.length === 0) {
    if (emptyText === '') return null;
    return <div className="flex items-center gap-2 text-sm text-gray-400 py-2"><ImageOff className="h-4 w-4" /> {emptyText || 'No documents uploaded yet.'}</div>;
  }

  const thumb = compact ? 'h-16 w-16' : 'h-20 w-20';

  return (
    <div className="space-y-1.5">
      {title && <div className="text-[11px] uppercase tracking-wide text-gray-400">{title}</div>}
      <div className="flex flex-wrap gap-2">
        {assets.map((a, i) => a.is_image ? (
          <button key={i} type="button" onClick={() => setOpenPos(imgIndex.indexOf(i))} title={a.label} className="block shrink-0">
            <img src={a.url} alt={a.label} className={`${thumb} rounded-lg object-cover border border-gray-200 bg-white hover:ring-2 hover:ring-primary/30 transition`} />
          </button>
        ) : (
          <Button key={i} size="sm" variant="outline" className="h-9 gap-1.5 max-w-[14rem]" onClick={() => window.open(a.url, '_blank')} title={a.label}>
            <Download className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{a.label}</span>
          </Button>
        ))}
      </div>

      <Dialog open={openPos != null} onOpenChange={o => !o && setOpenPos(null)}>
        <DialogContent className="max-w-4xl">
          <DialogTitle className="sr-only">{cur != null ? assets[cur].label : 'Image'}</DialogTitle>
          <div className="relative">
            {cur != null && <img src={assets[cur].url} alt={assets[cur].label} className="max-h-[68vh] w-auto mx-auto rounded-lg" />}
            {imgIndex.length > 1 && (
              <>
                <button type="button" onClick={() => go(-1)} aria-label="Previous" className="absolute left-1 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full bg-white/90 shadow flex items-center justify-center hover:bg-white"><ChevronLeft className="h-5 w-5" /></button>
                <button type="button" onClick={() => go(1)} aria-label="Next" className="absolute right-1 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full bg-white/90 shadow flex items-center justify-center hover:bg-white"><ChevronRight className="h-5 w-5" /></button>
              </>
            )}
          </div>
          <div className="flex items-center justify-center gap-3 pt-2">
            {imgIndex.length > 1 && <span className="text-xs text-gray-400 tabular-nums">{(openPos ?? 0) + 1} / {imgIndex.length}</span>}
            {cur != null && <Button asChild size="sm" variant="outline" className="gap-1.5"><a href={assets[cur].url} download={assets[cur].filename || undefined} target="_blank" rel="noreferrer"><Download className="h-3.5 w-3.5" /> Download</a></Button>}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
