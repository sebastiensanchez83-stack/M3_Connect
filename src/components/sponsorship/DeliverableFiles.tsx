import { useState, useEffect, useRef } from 'react';
import { Loader2, Upload, Link2, ExternalLink, Trash2, FileText, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { useFileDrop } from '@/hooks/useFileDrop';
import { SPONSORSHIP_BUCKET, SpDeliverableFile } from '@/lib/sponsorship';

// Files a sponsor provides for a deliverable — native Storage upload OR an
// external link (Drive/Dropbox, for large videos). Exactly one per row (DB
// CHECK). Managers approve/reject; the uploader can remove a not-yet-approved
// file. Reused in the admin/YCM hub and the sponsor portal.

const REVIEW_CLS: Record<string, string> = {
  pending: 'text-amber-600', approved: 'text-green-600', rejected: 'text-red-600',
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
    <div className="space-y-1.5">
      {files.map(f => (
        <div key={f.id} className="flex items-center justify-between gap-2 rounded-md border border-gray-100 px-2.5 py-1.5">
          <button onClick={() => view(f)} className="min-w-0 flex items-center gap-2 text-left group">
            {f.external_url ? <Link2 className="h-3.5 w-3.5 text-gray-400 shrink-0" /> : <FileText className="h-3.5 w-3.5 text-gray-400 shrink-0" />}
            <span className="text-xs text-gray-700 truncate group-hover:text-primary group-hover:underline">{f.filename || 'File'}</span>
            <ExternalLink className="h-3 w-3 text-gray-300 shrink-0" />
          </button>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className={`text-[10px] font-medium ${REVIEW_CLS[f.review_status]}`}>{f.review_status}</span>
            {isManager && f.review_status !== 'approved' && (
              <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-green-600" disabled={busy === f.id} onClick={() => review(f, 'approved')} title="Approve"><Check className="h-3.5 w-3.5" /></Button>
            )}
            {isManager && f.review_status !== 'rejected' && (
              <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-gray-400 hover:text-red-600" disabled={busy === f.id} onClick={() => review(f, 'rejected')} title="Reject"><X className="h-3.5 w-3.5" /></Button>
            )}
            {(isManager || f.review_status !== 'approved') && canUpload && (
              <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-gray-300 hover:text-red-600" disabled={busy === f.id} onClick={() => remove(f)} title="Remove">
                {busy === f.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              </Button>
            )}
          </div>
        </div>
      ))}
      {files.some(f => f.review_status === 'rejected' && f.review_note) && (
        <p className="text-[11px] text-red-600 px-1">{files.filter(f => f.review_status === 'rejected' && f.review_note).map(f => `“${f.review_note}”`).join(' ')}</p>
      )}

      {canUpload && (
        <div {...dropHandlers} className={`flex items-center gap-1.5 pt-0.5 rounded-md transition-colors ${isDragging ? 'ring-2 ring-primary/40 bg-primary/5' : ''}`}>
          <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" disabled={uploading} onClick={() => fileRef.current?.click()}>
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Upload
          </Button>
          <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={() => setShowLink(v => !v)}>
            <Link2 className="h-3.5 w-3.5" /> Link
          </Button>
          <span className="text-[10px] text-gray-400">or drop a file</span>
          <input ref={fileRef} type="file" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
        </div>
      )}
      {showLink && canUpload && (
        <div className="flex items-center gap-1.5">
          <Input value={linkUrl} onChange={e => setLinkUrl(e.target.value)} placeholder="https://drive.google.com/…" className="h-7 text-xs" />
          <Button size="sm" className="h-7 text-xs" onClick={addLink}>Add</Button>
        </div>
      )}
    </div>
  );
}
