import { useRef, useState } from 'react';
import { Upload, Loader2, Trash2, Image as ImageIcon, FileText } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';

// Multi-file, drag-and-drop uploader for an SM26 asset field. Stores a LIST of
// storage paths and is backward-compatible with the old single-string value
// (a plain string is treated as a one-item list). The caller owns persistence:
// we upload the files, then hand back the full new path list via onChange.

const IMG_RE = /\.(png|jpe?g|webp|gif|svg|avif|bmp)$/i;
const isImg = (p: string) => IMG_RE.test((p.split('?')[0] || ''));
// strip the `${timestamp}-${rand}-` prefix we add on upload, for a clean label
const prettyName = (p: string) => (p.split('/').pop() || p).replace(/^\d+-\d+-/, '');

export interface SM26AssetUploadProps {
  value: string | string[] | null | undefined;
  basePath: string;            // e.g. `${userId}/${roleId}/${field}`
  accept?: string;
  disabled?: boolean;
  maxFiles?: number;
  onChange: (paths: string[]) => void | Promise<void>;
}

export function SM26AssetUpload({ value, basePath, accept, disabled, maxFiles = 12, onChange }: SM26AssetUploadProps) {
  const paths = Array.isArray(value) ? value : value ? [value] : [];
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const addFiles = async (files: File[]) => {
    if (disabled || files.length === 0) return;
    const room = Math.max(0, maxFiles - paths.length);
    if (room === 0) { toast({ title: `Up to ${maxFiles} files here`, description: 'Remove one to add another.', variant: 'destructive' }); return; }
    const take = files.slice(0, room);
    if (files.length > room) toast({ title: `Only ${room} more allowed`, description: `Added the first ${room}; ${maxFiles} max.` });
    // iPhone HEIC/HEIF photos don't render in browsers (→ broken catalogue
    // thumbnails). Reject with guidance rather than store an undisplayable file.
    const isHeic = (f: File) => /\.(heic|heif)$/i.test(f.name) || /heic|heif/i.test(f.type);
    const usable = take.filter(f => !isHeic(f));
    if (usable.length < take.length) {
      toast({ title: 'iPhone HEIC photos aren’t supported', description: 'Please upload a JPG or PNG (on iPhone: share/export the photo as JPEG, or Settings → Camera → Formats → Most Compatible).', variant: 'destructive' });
    }
    if (usable.length === 0) return;
    setBusy(true);
    const added: string[] = [];
    for (const file of usable) {
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `${basePath}/${Date.now()}-${Math.floor(Math.random() * 100000)}-${safe}`;
      const { error } = await supabase.storage.from('event-media').upload(path, file, { upsert: false });
      if (error) { toast({ title: `Couldn't upload ${file.name}`, description: error.message, variant: 'destructive' }); continue; }
      added.push(path);
    }
    setBusy(false);
    if (added.length) await onChange([...paths, ...added]);
  };

  const removeAt = async (p: string) => {
    if (disabled) return;
    await onChange(paths.filter(x => x !== p));
    supabase.storage.from('event-media').remove([p]).catch(() => { /* best-effort cleanup */ });
  };

  const openFile = async (p: string) => {
    const { data } = await supabase.storage.from('event-media').createSignedUrl(p, 300);
    if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener');
  };

  return (
    <div className="space-y-2">
      {paths.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {paths.map(p => (
            <div key={p} className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 pl-2 pr-1 py-1 text-xs max-w-full">
              {isImg(p) ? <ImageIcon className="h-3.5 w-3.5 text-gray-400 shrink-0" /> : <FileText className="h-3.5 w-3.5 text-gray-400 shrink-0" />}
              <button type="button" onClick={() => openFile(p)} className="text-primary truncate max-w-[170px] hover:underline" title={prettyName(p)}>{prettyName(p)}</button>
              {!disabled && (
                <button type="button" onClick={() => removeAt(p)} className="text-gray-400 hover:text-red-600 p-0.5 shrink-0" aria-label={`Remove ${prettyName(p)}`}>
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {!disabled && paths.length < maxFiles && (
        <div
          onDragOver={e => { e.preventDefault(); if (!busy) setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={e => { e.preventDefault(); setDrag(false); addFiles(Array.from(e.dataTransfer.files || [])); }}
          onClick={() => !busy && inputRef.current?.click()}
          className={`rounded-lg border border-dashed px-3 py-2.5 text-center text-xs cursor-pointer transition-colors ${drag ? 'border-primary bg-primary/5 text-primary' : 'border-gray-300 text-gray-500 hover:border-primary/40 hover:bg-gray-50'}`}
        >
          <input ref={inputRef} type="file" multiple accept={accept} className="hidden"
            onChange={e => { addFiles(Array.from(e.target.files || [])); e.target.value = ''; }} />
          {busy
            ? <span className="inline-flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Uploading…</span>
            : <span className="inline-flex items-center gap-1.5"><Upload className="h-3.5 w-3.5" /> {paths.length ? 'Add more — drag files here or click' : 'Drag files here, or click to upload'}</span>}
        </div>
      )}
    </div>
  );
}
