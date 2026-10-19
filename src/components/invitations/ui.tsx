import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { STATUS_LABEL, STATUS_STYLE, type DisplayStatus } from './lib/model';
import type { PdfIssue } from './lib/pdf';

export function StatusChip({ status }: { status: DisplayStatus }) {
  return <span className={`inline-block text-xs leading-tight rounded px-2 py-0.5 ${STATUS_STYLE[status]}`}>{STATUS_LABEL[status]}</span>;
}

export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-md border bg-white overflow-hidden">
      {options.map(o => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}
          className={`px-3 py-1.5 text-sm ${value === o.value ? 'bg-[#0A2E5C] text-white' : 'text-gray-700 hover:bg-gray-50'}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Issues({ issues }: { issues: PdfIssue[] }) {
  if (!issues.length) return null;
  return (
    <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 space-y-1">
      {issues.map((i, k) => (
        <div key={k} className="flex gap-2"><AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" /><span>{i.message}</span></div>
      ))}
    </div>
  );
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#5E9CC4]">{children}</h2>
      {aside}
    </div>
  );
}

/* ─── PDF page 1 on a canvas (pdf.js, loaded on first use) ─── */

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
let pdfjsP: Promise<PdfJs> | null = null;
function pdfjs(): Promise<PdfJs> {
  if (!pdfjsP) {
    pdfjsP = Promise.all([
      import('pdfjs-dist/legacy/build/pdf.mjs'),
      import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
    ]).then(([m, w]) => { m.GlobalWorkerOptions.workerSrc = w.default; return m; });
    pdfjsP.catch(() => { pdfjsP = null; });
  }
  return pdfjsP;
}

export function PdfCanvas({ bytes, label, maxWidth = 900 }: { bytes: Uint8Array | null; label: string; maxWidth?: number }) {
  const box = useRef<HTMLDivElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [width, setWidth] = useState(0);
  const [err, setErr] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.min(maxWidth, Math.max(200, el.clientWidth - 24))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [maxWidth]);

  useEffect(() => {
    if (!bytes || !bytes.length || !width || !canvas.current) return;
    let cancelled = false;
    setBusy(true); setErr(false);
    (async () => {
      const lib = await pdfjs();
      const doc = await lib.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
      try {
        const page = await doc.getPage(1);
        const vp1 = page.getViewport({ scale: 1 });
        const ratio = Math.min(2.5, (window.devicePixelRatio || 1) * 1.25);
        const vp = page.getViewport({ scale: (width / vp1.width) * ratio });
        const cv = canvas.current;
        if (cancelled || !cv) return;
        cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
        cv.style.width = `${width}px`; cv.style.height = `${Math.round(vp.height / ratio)}px`;
        await page.render({ canvasContext: cv.getContext('2d')!, viewport: vp }).promise;
      } finally { doc.destroy(); }
    })().catch(() => { if (!cancelled) setErr(true); }).finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [bytes, width]);

  return (
    <div ref={box} className="relative rounded-md bg-[#DDE4ED] p-3 grid place-items-center min-h-[160px]">
      {bytes && bytes.length ? <canvas ref={canvas} aria-label={label} role="img" className="max-w-full h-auto bg-white shadow-[0_2px_14px_rgba(10,46,92,0.18)]" /> : null}
      {busy && <RefreshCw className="absolute right-3 top-3 h-4 w-4 animate-spin text-gray-500" aria-hidden />}
      {err && <p className="text-sm text-red-700">The preview could not be drawn. Reload the page and try again.</p>}
    </div>
  );
}
