import { supabase } from '@/lib/supabase';

// Yacht Club catalogue exports. Two things:
//  - downloadAsset(): fetch a single file's bytes and save it directly (so the
//    browser downloads the real file instead of opening it in a tab).
//  - downloadDossierZip(): bundle a company's whole entry into ONE .zip — a
//    readable <company>-dossier.pdf (all text fields + inline images) plus an
//    assets/ folder with every original image and file at full quality.
// jspdf + jszip are dynamically imported so they only load when used.

const isHttp = (s: string) => /^https?:\/\//i.test(s);
const isImg = (s: string) => /\.(png|jpe?g|webp|gif|svg|avif|bmp)$/i.test(s.split('?')[0]);
const slug = (s: string) => (s || 'entry').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'entry';
const baseName = (value: string) => decodeURIComponent(value.split('/').pop()?.split('?')[0] || 'file');

export interface DossierData {
  company?: string | null; name?: string | null; job_title?: string | null;
  country?: string | null; website?: string | null; email?: string | null;
  roleLabel?: string | null;
  text: { label: string; value: string }[];
  assets: { label: string; value: string }[];
  signed: Record<string, string>;
  missing?: string[];
}

// Resolve an asset value to a fetchable URL (external link, pre-signed, or sign now).
async function resolveUrl(value: string, signed: Record<string, string>): Promise<string | null> {
  if (isHttp(value)) return value;
  if (signed[value]) return signed[value];
  const { data } = await supabase.storage.from('event-media').createSignedUrl(value, 600);
  return data?.signedUrl || null;
}

/** Download a single asset's actual bytes (not open-in-tab). */
export async function downloadAsset(value: string, signed: Record<string, string>): Promise<void> {
  const url = await resolveUrl(value, signed);
  if (!url) throw new Error('File unavailable');
  const blob = await (await fetch(url)).blob();
  const obj = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = obj; a.download = baseName(value);
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(obj), 1500);
}

// Decode a blob to a normalized JPEG data URL + pixel dims via an object URL
// (same-origin → the canvas is never tainted, so no CORS surprises).
function blobToJpeg(blob: Blob): Promise<{ data: string; w: number; h: number } | null> {
  return new Promise((resolve) => {
    const obj = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        const ctx = c.getContext('2d');
        if (!ctx || !c.width || !c.height) { URL.revokeObjectURL(obj); return resolve(null); }
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0);
        const data = c.toDataURL('image/jpeg', 0.85);
        URL.revokeObjectURL(obj);
        resolve({ data, w: img.naturalWidth, h: img.naturalHeight });
      } catch { URL.revokeObjectURL(obj); resolve(null); }
    };
    img.onerror = () => { URL.revokeObjectURL(obj); resolve(null); };
    img.src = obj;
  });
}

/** Build and download a .zip: a PDF (text + images) + an assets/ folder of originals. */
export async function downloadDossierZip(d: DossierData): Promise<void> {
  const [{ default: JSZip }, { jsPDF }] = await Promise.all([import('jszip'), import('jspdf')]);
  const zip = new JSZip();

  // Fetch every asset's bytes once (reused for both the PDF and the zip).
  const blobs = new Map<string, Blob>();
  for (const a of d.assets) {
    const url = await resolveUrl(a.value, d.signed);
    if (!url) continue;
    try { blobs.set(a.value, await (await fetch(url)).blob()); } catch { /* skip unreadable */ }
  }

  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const M = 40;
  const PW = doc.internal.pageSize.getWidth();
  const PH = doc.internal.pageSize.getHeight();
  const CW = PW - M * 2;
  let y = M;
  const ensure = (h: number) => { if (y + h > PH - M) { doc.addPage(); y = M; } };
  const heading = (t: string) => {
    y += 6; ensure(26);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(120, 130, 150);
    doc.text(t.toUpperCase(), M, y); y += 6;
    doc.setDrawColor(230, 232, 238); doc.line(M, y, PW - M, y); y += 15;
  };

  // Title + subtitle
  doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.setTextColor(11, 38, 83);
  const title = d.company || d.name || 'Entry';
  const tLines = doc.splitTextToSize(title, CW);
  doc.text(tLines, M, y + 14); y += 14 + tLines.length * 22;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(107, 122, 153);
  doc.text(`Smart & Sustainable Marina Rendezvous 2026${d.roleLabel ? ' · ' + d.roleLabel : ''}`, M, y); y += 8;

  // Contact & profile
  heading('Contact & profile');
  const rows: [string, string | null | undefined][] = [
    ['Name', d.name], ['Company', d.company], ['Job title', d.job_title],
    ['Country', d.country], ['Website', d.website], ['Email', d.email],
  ];
  doc.setFontSize(10.5);
  for (const [k, v] of rows) {
    if (!v) continue;
    const lines = doc.splitTextToSize(String(v), CW - 110);
    ensure(Math.max(15, lines.length * 13));
    doc.setFont('helvetica', 'bold'); doc.setTextColor(107, 122, 153); doc.text(k, M, y);
    doc.setFont('helvetica', 'normal'); doc.setTextColor(30, 40, 60); doc.text(lines, M + 110, y);
    y += Math.max(15, lines.length * 13);
  }

  // Details (every text answer)
  if (d.text.length) {
    heading('Details');
    for (const t of d.text) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(150, 160, 180);
      ensure(14); doc.text((t.label || '').toUpperCase(), M, y); y += 12;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5); doc.setTextColor(30, 40, 60);
      for (const ln of doc.splitTextToSize(t.value || '', CW)) { ensure(14); doc.text(ln, M, y); y += 14; }
      y += 6;
    }
  }

  // Images inline
  const imgAssets = d.assets.filter(a => isImg(a.value));
  const fileAssets = d.assets.filter(a => !isImg(a.value));
  if (imgAssets.length) {
    heading('Images');
    for (const a of imgAssets) {
      const blob = blobs.get(a.value);
      if (!blob) continue;
      const jp = await blobToJpeg(blob);
      if (!jp) continue;
      const scale = Math.min(CW / jp.w, 300 / jp.h, 1);
      const w = jp.w * scale, h = jp.h * scale;
      ensure(h + 18);
      doc.addImage(jp.data, 'JPEG', M, y, w, h); y += h + 4;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(150, 160, 180);
      doc.text(a.label || '', M, y); y += 14;
    }
  }
  if (fileAssets.length) {
    heading('Other files (included in this zip)');
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(30, 40, 60);
    for (const a of fileAssets) { ensure(14); doc.text('• ' + (a.label || '') + ' — ' + baseName(a.value), M, y); y += 14; }
  }
  if (d.missing?.length) {
    heading('Still missing for the catalogue');
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(180, 60, 60);
    for (const ln of doc.splitTextToSize(d.missing.join(', '), CW)) { ensure(14); doc.text(ln, M, y); y += 14; }
  }

  const base = slug(d.company || d.name || 'entry');
  zip.file(`${base}-dossier.pdf`, doc.output('blob'));

  // Original files at full quality, de-duplicated names.
  const used = new Set<string>();
  for (const a of d.assets) {
    const blob = blobs.get(a.value);
    if (!blob) continue;
    let n = baseName(a.value);
    if (used.has(n)) { const dot = n.lastIndexOf('.'); let i = 1; let cand = n; while (used.has(cand)) { cand = dot > 0 ? `${n.slice(0, dot)}-${i}${n.slice(dot)}` : `${n}-${i}`; i++; } n = cand; }
    used.add(n);
    zip.file(`assets/${n}`, blob);
  }

  const out = await zip.generateAsync({ type: 'blob' });
  const obj = URL.createObjectURL(out);
  const a = document.createElement('a');
  a.href = obj; a.download = `${base}-sm26-dossier.zip`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(obj), 2000);
}
