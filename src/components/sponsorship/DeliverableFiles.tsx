import { useState, useEffect, useRef } from 'react';
import { Loader2, Upload, Link2, ExternalLink, Trash2, FileText, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { BTN, BTN_OUTLINE, FOCUS, StatusPill, type PillTone } from '@/components/member/MemberUI';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { useFileDrop } from '@/hooks/useFileDrop';
import { SPONSORSHIP_BUCKET, SpDeliverableFile } from '@/lib/sponsorship';
import { FIELD, ICON_BTN } from './sponsorshipUi';
import { cn } from '@/lib/utils';

// Files a sponsor provides for a deliverable — native Storage upload OR an
// external link (Drive/Dropbox, for large videos). Exactly one per row (DB
// CHECK). Managers approve/reject; the uploader can remove a not-yet-approved
// file. Reused in the admin/YCM hub and the sponsor portal.

const REVIEW_TONE: Record<string, PillTone> = {
  pending: 'warning', approved: 'success', rejected: 'danger',
};

export function DeliverableFiles({ sponsorId, benefitId, isManager, canUpload, onChanged }: {
  sponsorId: string; benefitId: string; isManager: boolean; canUpload: boolean; onChanged?: () => void;
}) {
  const [files, setFiles] = useState<SpDeliverableFile[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [showLink, setShowLink] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { isDragging, dropHandlers } = useFileDrop(files => { const f = files[0]; if (f) void upload(f); }, uploading || !canUpload);

  const load = async () => {
    const { data } = await supabase.from('sp_deliverable_file')
      .select('*').eq('agreement_benefit_id', benefitId).order('created_at', { ascending: true });
    setFiles((data || []) as SpDeliverableFile[]);
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [benefitId]);

  const addRow = async (row: Partial<SpDeliverableFile>) => {
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from('sp_deliverable_file').insert({
      agreement_benefit_id: benefitId, uploaded_by: u?.user?.id || null, ...row,
    });
    if (error) { toast({ title: 'Could not save', description: error.message, variant: 'destructive' }); return false; }
    await load(); onChanged?.(); return true;
  };

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const safe = file.name.replace(/[^\w.\-]+/g, '_').slice(-80);
      const path = `${sponsorId}/deliverables/${benefitId}/${Date.now()}-${safe}`;
      const { error: upErr } = await supabase.storage.from(SPONSORSHIP_BUCKET).upload(path, file, { upsert: false });
      if (upErr) { toast({ title: 'Upload failed', description: upErr.message, variant: 'destructive' }); return; }
      const ok = await addRow({ storage_path: path, filename: file.name, mime: file.type, size_bytes: file.size });
      if (!ok) await supabase.storage.from(SPONSORSHIP_BUCKET).remove([path]).catch(() => {});
      else toast({ title: 'File uploaded' });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const addLink = async () => {
    const url = linkUrl.trim();
    if (!/^https?:\/\//i.test(url)) { toast({ title: 'Enter a valid URL (https://…)', variant: 'destructive' }); return; }
    const ok = await addRow({ external_url: url, filename: url.split('/').pop() || 'External link' });
    if (ok) { setLinkUrl(''); setShowLink(false); toast({ title: 'Link added' }); }
  };

  const view = async (f: SpDeliverableFile) => {
    if (f.external_url) { window.open(f.external_url, '_blank'); return; }
    if (!f.storage_path) return;
    const { data, error } = await supabase.storage.from(SPONSORSHIP_BUCKET).createSignedUrl(f.storage_path, 300);
    if (error || !data) { toast({ title: 'Could not open file', variant: 'destructive' }); return; }
    window.open(data.signedUrl, '_blank');
  };

  const review = async (f: SpDeliverableFile, status: 'approved' | 'rejected') => {
    setBusy(f.id);
    const { data: u } = await supabase.auth.getUser();
    let note: string | null = null;
    if (status === 'rejected') { note = window.prompt('Reason for rejecting this file (optional):') || null; }
    const { error } = await supabase.from('sp_deliverable_file')
      .update({ review_status: status, review_note: note, reviewed_by: u?.user?.id || null, reviewed_at: new Date().toISOString() })
      .eq('id', f.id);
    setBusy(null);
    if (error) { toast({ title: 'Could not update', description: error.message, variant: 'destructive' }); return; }
    setFiles(prev => prev.map(x => x.id === f.id ? { ...x, review_status: status, review_note: note } : x));
    onChanged?.();
  };

  const remove = async (f: SpDeliverableFile) => {
    if (!window.confirm('Remove this file?')) return;
    setBusy(f.id);
    if (f.storage_path) await supabase.storage.from(SPONSORSHIP_BUCKET).remove([f.storage_path]).catch(() => {});
    const { error } = await supabase.from('sp_deliverable_file').delete().eq('id', f.id);
    setBusy(null);
    if (error) { toast({ title: 'Could not remove', description: error.message, variant: 'destructive' }); return; }
    setFiles(prev => prev.filter(x => x.id !== f.id));
    onChanged?.();
  };

  return (
    <div className="space-y-2">
      {files.map(f => (
        <div key={f.id} className="flex items-center justify-between gap-2 rounded-xl border border-rule bg-white py-0.5 pl-3 pr-1">
          <button type="button" onClick={() => view(f)} className={cn('group flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-md text-left', FOCUS)}>
            {f.external_url ? <Link2 className="h-4 w-4 shrink-0 text-meta" aria-hidden="true" /> : <FileText className="h-4 w-4 shrink-0 text-meta" aria-hidden="true" />}
            <span className="min-w-0 truncate py-0.5 text-[14px] text-navy"><span className="card-ul">{f.filename || 'File'}</span></span>
            <ExternalLink className="h-3.5 w-3.5 shrink-0 text-meta" aria-hidden="true" />
            <span className="sr-only">(opens in a new tab)</span>
          </button>
          <div className="flex shrink-0 items-center gap-1">
            <StatusPill tone={REVIEW_TONE[f.review_status] ?? 'neutral'} className="capitalize">{f.review_status}</StatusPill>
            {isManager && f.review_status !== 'approved' && (
              <Button type="button" size="icon" variant="ghost" className={cn(ICON_BTN, 'text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800')} disabled={busy === f.id} onClick={() => review(f, 'approved')} title="Approve" aria-label="Approve this file"><Check className="h-4 w-4" aria-hidden="true" /></Button>
            )}
            {isManager && f.review_status !== 'rejected' && (
              <Button type="button" size="icon" variant="ghost" className={cn(ICON_BTN, 'text-meta hover:bg-red-50 hover:text-red-700')} disabled={busy === f.id} onClick={() => review(f, 'rejected')} title="Reject" aria-label="Reject this file"><X className="h-4 w-4" aria-hidden="true" /></Button>
            )}
            {(isManager || f.review_status !== 'approved') && canUpload && (
              <Button type="button" size="icon" variant="ghost" className={cn(ICON_BTN, 'text-meta hover:bg-red-50 hover:text-red-700')} disabled={busy === f.id} onClick={() => remove(f)} title="Remove" aria-label="Remove this file">
                {busy === f.id ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Trash2 className="h-4 w-4" aria-hidden="true" />}
              </Button>
            )}
          </div>
        </div>
      ))}
      {files.some(f => f.review_status === 'rejected' && f.review_note) && (
        <p className="px-1 text-[13px] leading-5 text-red-700">{files.filter(f => f.review_status === 'rejected' && f.review_note).map(f => `“${f.review_note}”`).join(' ')}</p>
      )}

      {canUpload && (
        <div {...dropHandlers} className={cn('flex flex-wrap items-center gap-2 rounded-xl border border-dashed p-2 transition-colors', isDragging ? 'border-navy bg-chip' : 'border-rule')}>
          <Button type="button" variant="outline" className={cn(BTN_OUTLINE, 'gap-1.5')} disabled={uploading} onClick={() => fileRef.current?.click()}>
            {uploading ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Upload className="h-4 w-4" aria-hidden="true" />} Upload
          </Button>
          <Button type="button" variant="outline" className={cn(BTN_OUTLINE, 'gap-1.5')} aria-expanded={showLink} onClick={() => setShowLink(v => !v)}>
            <Link2 className="h-4 w-4" aria-hidden="true" /> Link
          </Button>
          <span className="text-[13px] text-meta">or drop a file</span>
          <input ref={fileRef} type="file" className="hidden" aria-label="Choose a file to upload" onChange={e => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
        </div>
      )}
      {showLink && canUpload && (
        <div className="flex items-center gap-2">
          <Input value={linkUrl} onChange={e => setLinkUrl(e.target.value)} placeholder="https://drive.google.com/…" aria-label="Link to the file" className={cn(FIELD, 'flex-1')} />
          <Button type="button" className={BTN} onClick={addLink}>Add</Button>
        </div>
      )}
    </div>
  );
}
