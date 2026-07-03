import { useRef, useState } from 'react';
import { Upload, Loader2, X, FileText, Image as ImageIcon } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/use-toast';

// Registration-time file picker. Works BEFORE the registrant has an account:
// it just holds the chosen File objects (resizing images client-side to keep
// them web-sized), shows previews, and hands them back via onChange. The parent
// persists them on submit — uploading to storage for logged-in members, or
// base64-ing them into the sm26-register payload for guests.

const IMG_RE = /^image\//i;
const MAX_DIM = 1600;
const MAX_BYTES = 12 * 1024 * 1024; // hard cap on any single source file

// Downscale an image File to <= MAX_DIM on its longest side, re-encoded as JPEG.
// Non-images (PDF, etc.) pass through untouched.
async function resizeImage(file: File): Promise<File> {
  if (!IMG_RE.test(file.type) || file.type === 'image/svg+xml' || file.type === 'image/gif') return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_DIM / Math.max(bitmap.width, bitmap.height));
    if (scale >= 1 && file.size < 900 * 1024) { bitmap.close(); return file; }
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) { bitmap.close(); return file; }
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const blob: Blob | null = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.85));
    if (!blob) return file;
    const base = file.name.replace(/\.[^.]+$/, '') || 'image';
    return new File([blob], `${base}.jpg`, { type: 'image/jpeg' });
  } catch {
    return file; // fall back to the original if the browser can't decode it
  }
}

export interface SM26RegUploadProps {
  label: string;
  hint?: string;
  value: File[];
  onChange: (files: File[]) => void;
  accept?: string;              // e.g. 'image/*' or '.pdf,application/pdf'
  multiple?: boolean;
  max?: number;
  required?: boolean;
}

export function SM26RegUpload({ label, hint, value, onChange, accept = 'image/*', multiple = false, max = multiple ? 12 : 1, required }: SM26RegUploadProps) {
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const add = async (files: File[]) => {
    if (!files.length) return;
    const room = Math.max(0, max - value.length);
    if (room === 0) { toast({ title: `Up to ${max} file${max > 1 ? 's' : ''} here`, variant: 'destructive' }); return; }
    setBusy(true);
    const out: File[] = [];
    for (const f of files.slice(0, room)) {
      if (f.size > MAX_BYTES) { toast({ title: `${f.name} is too large`, description: 'Max 12 MB per file.', variant: 'destructive' }); continue; }
      out.push(await resizeImage(f));
    }
    setBusy(false);
    if (out.length) onChange(multiple ? [...value, ...out] : out.slice(0, 1));
  };

  const removeAt = (i: number) => onChange(value.filter((_, x) => x !== i));

  return (
    <div className="space-y-1.5">
      <Label className="text-sm">{label}{required && <span className="text-red-500"> *</span>}</Label>
      {hint && <p className="text-xs text-gray-500 -mt-0.5">{hint}</p>}
      <div className="flex flex-wrap gap-2">
        {value.map((f, i) => {
          const isImg = IMG_RE.test(f.type);
          const url = isImg ? URL.createObjectURL(f) : null;
          return (
            <div key={i} className="relative group w-16 h-16 rounded-lg border border-gray-200 bg-gray-50 overflow-hidden flex items-center justify-center shrink-0">
              {url ? <img src={url} alt="" className="w-full h-full object-cover" onLoad={() => URL.revokeObjectURL(url)} />
                   : <FileText className="h-6 w-6 text-gray-400" />}
              <button type="button" onClick={() => removeAt(i)} className="absolute top-0.5 right-0.5 bg-white/90 rounded-full p-0.5 text-gray-500 hover:text-red-600 shadow-sm">
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}
        {value.length < max && (
          <button type="button" onClick={() => inputRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
            onDrop={e => { e.preventDefault(); setDrag(false); add(Array.from(e.dataTransfer.files)); }}
            className={`w-16 h-16 rounded-lg border-2 border-dashed flex items-center justify-center shrink-0 transition-colors ${drag ? 'border-primary bg-primary/5' : 'border-gray-200 hover:border-primary/40'}`}>
            {busy ? <Loader2 className="h-5 w-5 animate-spin text-gray-400" /> : accept.includes('image') ? <ImageIcon className="h-5 w-5 text-gray-400" /> : <Upload className="h-5 w-5 text-gray-400" />}
          </button>
        )}
      </div>
      <input ref={inputRef} type="file" accept={accept} multiple={multiple} className="hidden"
        onChange={e => { add(Array.from(e.target.files || [])); e.target.value = ''; }} />
    </div>
  );
}
