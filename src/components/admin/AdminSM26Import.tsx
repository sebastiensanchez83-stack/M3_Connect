import { useState, useRef, useEffect, type DragEvent } from 'react';
import {
  Upload, FileUp, FolderUp, RefreshCw, AlertTriangle, CheckCircle2, FileWarning,
  Users, Sparkles, KeyRound, Info, X,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';

// Drag & drop importer for the Jotform registration exports.
//
// Phase 1 = PREVIEW ONLY. Nothing is written: the CSV is sent to the sm26-import
// engine with dry_run:true, which runs the whole pipeline (dedupe, account
// linking, claim-code generation, enrichment matching) and returns the same
// counters without touching the database. File re-hosting and the real import
// come in phase 2.
//
// The engine stays the single source of truth for the business rules. This
// screen only: parses the CSV locally, matches each Jotform file URL to a
// dropped file, and renders what would happen.

/* ─── Engine-compatible CSV parser (mirrors sm26-import parseCSV) ─── */
function parseCSV(str: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let f = ''; let i = 0; let q = false;
  while (i < str.length) {
    const c = str[i];
    if (q) { if (c === '"') { if (str[i + 1] === '"') { f += '"'; i += 2; continue; } q = false; i++; continue; } f += c; i++; continue; }
    if (c === '"') { q = true; i++; continue; }
    if (c === ',') { row.push(f); f = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; i++; continue; }
    f += c; i++;
  }
  if (f.length || row.length) { row.push(f); rows.push(row); }
  return rows;
}

// File-bearing columns, by 0-based index — same indices the engine uses.
// `ingested` = the engine stores this column, so it is worth re-hosting.
// Uploading a column nothing reads would just leave orphans in storage.
const FILE_COLUMNS: { idx: number; label: string; ingested: boolean }[] = [
  { idx: 20, label: 'Profile photo', ingested: true },
  { idx: 21, label: 'Company logo (architecture)', ingested: true },
  { idx: 22, label: 'Company image (architecture)', ingested: true },
  { idx: 23, label: 'Project renders (architecture)', ingested: true },
  { idx: 31, label: 'Proof of enrolment', ingested: true },
  { idx: 32, label: 'Profile photo (student)', ingested: true },
  { idx: 41, label: 'Company logo (jury)', ingested: true },
  { idx: 42, label: 'Profile picture (jury)', ingested: true },
  { idx: 47, label: 'Company logo (marina)', ingested: true },
  { idx: 63, label: 'Marina HD images', ingested: true },
  { idx: 64, label: 'Marina building images', ingested: true },
  { idx: 65, label: 'Marina pitch media', ingested: true },
  { idx: 73, label: 'Sustainability image', ingested: true },
  { idx: 75, label: 'Water image', ingested: true },
  { idx: 77, label: 'Energy image', ingested: true },
  { idx: 79, label: 'Waste image', ingested: true },
  { idx: 81, label: 'Innovation image', ingested: true },
  { idx: 83, label: 'Security image', ingested: true },
  { idx: 85, label: 'Press card', ingested: true },
  { idx: 95, label: 'Product images', ingested: true },
  { idx: 103, label: 'Company logo (startup)', ingested: true },
  { idx: 104, label: 'Pitch deck', ingested: true },
  { idx: 110, label: 'Pitch media', ingested: true },
];

// Storage prefix for re-hosted files. Matches what is already in event-media
// (~300 objects) and the relative-path form sm26-register stores, so an imported
// registration is indistinguishable from a self-registration.
const importPath = (submissionId: string, filename: string) =>
  `imported/${submissionId}/${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

const UPLOAD_CONCURRENCY = 4;

// Roles the engine maps today (matched case/space-insensitively, like the
// engine). Anything else falls back to "visitor" — notably "Architecture
// contest", which is why the preview flags it (phase 4 fixes it).
const MAPPED_PARTICIPATION = new Set([
  'jury member', 'marina', 'speaker', 'startup / scaleup', 'visitor',
  'media', 'press', 'media / press', 'media/press', 'press / media', 'media partner',
  'architecture contest',
]);
const normParticipation = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

interface ImportResult {
  total: number; deduped: number; imported: number; enriched: number;
  skipped: number; linked: number; dry_run?: boolean;
  codes: { email: string; code: string }[];
  role_suggestions: { email: string; has_roles: string[]; suggested: string[] }[];
  errors: { email: string; error: string }[];
}

interface FileRef { submissionId: string; filename: string; column: string; ingested: boolean; url: string; file?: File }
interface LocalAnalysis {
  rows: number;
  refs: FileRef[];
  matched: FileRef[];
  missing: FileRef[];
  architectPro: number;
  architectStudent: number;
  unmappedParticipation: { value: string; count: number }[];
}

/* ─── Jotform URL → { submissionId, filename } ─── */
function parseJotformUrl(u: string): { submissionId: string; filename: string } | null {
  try {
    const url = new URL(u.trim());
    const segs = url.pathname.split('/').filter(Boolean); // uploads/<user>/<formId>/<submissionId>/<filename>
    const i = segs.indexOf('uploads');
    if (i === -1 || segs.length < i + 5) return null;
    return { submissionId: segs[i + 3], filename: decodeURIComponent(segs[i + 4]) };
  } catch { return null; }
}

const basename = (p: string) => p.split('/').pop() || p;

// Retry a transient cold-start network failure once (same pattern as AdminSM26Health).
async function invokeWithRetry(name: string, body: Record<string, unknown>) {
  for (let attempt = 0; ; attempt++) {
    const res = await supabase.functions.invoke(name, { body });
    if (res.error && (res.error as { name?: string }).name === 'FunctionsFetchError' && attempt < 1) {
      await new Promise(r => setTimeout(r, 900));
      continue;
    }
    return res;
  }
}

/* ─── Recursively read a dropped directory entry ─── */
interface FsEntry {
  isFile: boolean; isDirectory: boolean; name: string; fullPath: string;
  file?: (cb: (f: File) => void, err?: (e: unknown) => void) => void;
  createReader?: () => { readEntries: (cb: (entries: FsEntry[]) => void, err?: (e: unknown) => void) => void };
}
async function readEntry(entry: FsEntry, prefix: string, out: { path: string; file: File }[]): Promise<void> {
  if (entry.isFile && entry.file) {
    const file = await new Promise<File | null>(res => entry.file!(f => res(f), () => res(null)));
    if (file) out.push({ path: `${prefix}${entry.name}`, file });
    return;
  }
  if (entry.isDirectory && entry.createReader) {
    const reader = entry.createReader();
    // readEntries returns at most 100 entries per call — keep reading until empty.
    for (;;) {
      const batch = await new Promise<FsEntry[]>(res => reader.readEntries(e => res(e || []), () => res([])));
      if (!batch.length) break;
      for (const child of batch) await readEntry(child, `${prefix}${entry.name}/`, out);
    }
  }
}

export function AdminSM26Import() {
  const [csvName, setCsvName] = useState<string | null>(null);
  const [csvText, setCsvText] = useState<string | null>(null);
  const [assets, setAssets] = useState<{ path: string; file: File }[]>([]);
  const [analysis, setAnalysis] = useState<LocalAnalysis | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [uploadFailures, setUploadFailures] = useState<FileRef[]>([]);
  // Tracked client-side rather than read back from the response: we know which
  // call we made, so the confirm step can never go missing if the engine ever
  // stops echoing the flag.
  const [mode, setMode] = useState<'preview' | 'imported' | null>(null);

  const csvRef = useRef<HTMLInputElement | null>(null);
  const dirRef = useRef<HTMLInputElement | null>(null);

  // webkitdirectory isn't in the React typings — set it on the DOM node.
  useEffect(() => {
    if (dirRef.current) {
      dirRef.current.setAttribute('webkitdirectory', '');
      dirRef.current.setAttribute('directory', '');
    }
  }, []);

  const reset = () => {
    setCsvName(null); setCsvText(null); setAssets([]); setAnalysis(null);
    setResult(null); setProgress(null); setUploadFailures([]); setMode(null);
  };

  const takeFiles = async (incoming: { path: string; file: File }[]) => {
    const csv = incoming.find(x => x.file.name.toLowerCase().endsWith('.csv'));
    if (csv) { setCsvName(csv.file.name); setCsvText(await csv.file.text()); }
    const rest = incoming.filter(x => !x.file.name.toLowerCase().endsWith('.csv'));
    if (rest.length) setAssets(prev => [...prev, ...rest]);
    setAnalysis(null); setResult(null);
  };

  const onDrop = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault(); setDragging(false);
    const items = Array.from(e.dataTransfer.items || []);
    const out: { path: string; file: File }[] = [];
    const entries = items
      .map(it => (it as unknown as { webkitGetAsEntry?: () => FsEntry | null }).webkitGetAsEntry?.() || null)
      .filter((x): x is FsEntry => !!x);
    if (entries.length) {
      for (const entry of entries) await readEntry(entry, '', out);
    } else {
      for (const f of Array.from(e.dataTransfer.files || [])) out.push({ path: f.name, file: f });
    }
    await takeFiles(out);
  };

  /* ─── Local analysis: match every Jotform file URL to a dropped file ─── */
  const analyseLocal = (text: string): LocalAnalysis => {
    const rows = parseCSV(text);
    const data = rows.slice(1).filter(r => (r[3] || '').trim() || (r[1] || '').trim());

    // Index the dropped files by "<submissionId>/<basename>" and by basename.
    const bySub = new Map<string, File>();
    const byName = new Map<string, File[]>();
    for (const { path, file } of assets) {
      const name = basename(path);
      const seg = path.split('/').find(s => s.startsWith('uploads_'));
      if (seg) bySub.set(`${seg.slice('uploads_'.length)}/${name}`, file);
      const list = byName.get(name) || []; list.push(file); byName.set(name, list);
    }

    const refs: FileRef[] = [];
    let architectPro = 0; let architectStudent = 0;
    const unmapped = new Map<string, number>();

    for (const r of data) {
      const participation = (r[15] || '').trim();
      const p = normParticipation(participation);
      // Same split the engine applies: r[16] Professional/Student, defaulting to
      // professional when the column is blank.
      if (p.startsWith('architecture')) {
        if (normParticipation(r[16] || '') === 'student') architectStudent++; else architectPro++;
      }
      // "Architecture contest" is unmapped too, but it gets its own dedicated
      // warning below — listing it here as well just says the same thing twice.
      if (participation && p !== 'architecture contest' && !MAPPED_PARTICIPATION.has(p)) {
        unmapped.set(participation, (unmapped.get(participation) || 0) + 1);
      }
      for (const col of FILE_COLUMNS) {
        const cell = (r[col.idx] || '').trim();
        if (!cell) continue;
        for (const raw of cell.split('\n').map(s => s.trim()).filter(Boolean)) {
          if (!/^https?:\/\//i.test(raw)) continue;
          const parsed = parseJotformUrl(raw);
          if (!parsed) continue;
          refs.push({ ...parsed, column: col.label, ingested: col.ingested, url: raw });
        }
      }
    }

    const matched: FileRef[] = []; const missing: FileRef[] = [];
    for (const ref of refs) {
      const exact = bySub.get(`${ref.submissionId}/${ref.filename}`);
      const fallback = byName.get(ref.filename);
      const file = exact || (fallback && fallback.length === 1 ? fallback[0] : undefined);
      if (file) matched.push({ ...ref, file }); else missing.push(ref);
    }

    return {
      rows: data.length, refs, matched, missing, architectPro, architectStudent,
      unmappedParticipation: [...unmapped.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count),
    };
  };

  const runPreview = async () => {
    if (!csvText) return;
    setBusy(true); setResult(null);
    try {
      const local = analyseLocal(csvText);
      setAnalysis(local);
      const { data, error } = await invokeWithRetry('sm26-import', { csv: csvText, dry_run: true });
      if (error) {
        let msg = error.message;
        try {
          const b = await (error as { context?: Response }).context?.json();
          if (b?.error) msg = b.error;
        } catch { /* keep the generic message */ }
        toast({ title: 'Preview failed', description: msg, variant: 'destructive' });
        return;
      }
      setResult(data as ImportResult);
      setMode('preview');
      toast({ title: 'Preview ready', description: 'Nothing has been written to the database.' });
    } catch (e) {
      toast({ title: 'Preview failed', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  /* ─── Confirm: re-host the matched files, rewrite the CSV, run the import ─── */
  const runImport = async () => {
    if (!csvText || !analysis || !result) return;
    const toUpload = analysis.matched.filter(m => m.ingested && m.file);
    const laterPhase = analysis.matched.length - toUpload.length;
    const confirmed = window.confirm(
      `Import ${result.deduped} registration(s)?\n\n` +
      `- ${toUpload.length} file(s) will be re-hosted into event-media\n` +
      `- ${analysis.missing.length} file(s) not found keep their original Jotform URL\n` +
      (laterPhase > 0 ? `- ${laterPhase} file(s) belong to columns the engine doesn't store yet (architecture / press card) and are left untouched\n` : '') +
      `\nThis writes to the database.`
    );
    if (!confirmed) return;

    setBusy(true);
    setUploadFailures([]);
    setProgress({ done: 0, total: toUpload.length });
    try {
      // 1. Upload each distinct URL once, in small concurrent batches.
      const byUrl = new Map<string, FileRef>();
      for (const m of toUpload) if (!byUrl.has(m.url)) byUrl.set(m.url, m);
      const jobs = [...byUrl.values()];
      const urlToPath = new Map<string, string>();
      const failed: FileRef[] = [];
      let done = 0;

      for (let i = 0; i < jobs.length; i += UPLOAD_CONCURRENCY) {
        const batch = jobs.slice(i, i + UPLOAD_CONCURRENCY);
        await Promise.all(batch.map(async ref => {
          const path = importPath(ref.submissionId, ref.filename);
          // upsert: the path is fully determined by (submissionId, filename), so
          // re-running writes the same bytes to the same key — which is what
          // makes re-importing the same export idempotent.
          const { error } = await supabase.storage.from('event-media')
            .upload(path, ref.file!, { upsert: true, contentType: ref.file!.type || 'application/octet-stream' });
          if (error) failed.push(ref); else urlToPath.set(ref.url, path);
          done++; setProgress({ done, total: jobs.length });
        }));
      }
      setUploadFailures(failed);

      // 2. Rewrite the RAW csv text: swap each Jotform URL for its storage path.
      //    Plain string replacement on the raw text (never re-serialised), so the
      //    quoting is untouched and multi-file cells keep their newline layout.
      //    Longest URL first, so one URL can never clobber a longer sibling.
      let rewritten = csvText;
      for (const [url, path] of [...urlToPath.entries()].sort((a, b) => b[0].length - a[0].length)) {
        rewritten = rewritten.split(url).join(path);
      }

      // 3. Hand the rewritten CSV to the engine for the real write.
      const { data, error } = await invokeWithRetry('sm26-import', { csv: rewritten, dry_run: false });
      if (error) {
        let msg = error.message;
        try {
          const b = await (error as { context?: Response }).context?.json();
          if (b?.error) msg = b.error;
        } catch { /* keep the generic message */ }
        // Deliberately no rollback: paths are deterministic, so a previous
        // successful import may already reference these exact objects — deleting
        // them would break it. Re-running is safe (upload upserts, engine enriches).
        toast({ title: 'Import failed', description: `${msg}. Uploaded files were kept — you can safely retry.`, variant: 'destructive' });
        return;
      }
      setResult(data as ImportResult);
      setMode('imported');
      const r = data as ImportResult;
      toast({ title: 'Import complete', description: `${r.imported} created, ${r.enriched} enriched, ${urlToPath.size} file(s) re-hosted.` });
    } catch (e) {
      toast({ title: 'Import failed', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const stat = (label: string, value: number | string, tone?: string) => (
    <div className="rounded-lg border border-gray-100 bg-white px-3 py-2.5">
      <div className="text-[11px] uppercase tracking-wide text-gray-400">{label}</div>
      <div className={`text-xl font-bold ${tone || 'text-gray-900'}`}>{value}</div>
    </div>
  );

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
        <Upload className="h-6 w-6 text-primary" /> Import registrations
      </h1>
      <p className="text-sm text-gray-500 -mt-2">
        Drop the Jotform CSV export and its <code>uploads_*</code> folders to preview what would be
        imported. This screen is preview-only — nothing is written yet.
      </p>

      {/* Dropzone */}
      <Card>
        <CardContent className="pt-6">
          <div
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={`rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors ${dragging ? 'border-primary bg-primary/5' : 'border-gray-200'}`}
          >
            <FolderUp className={`h-8 w-8 mx-auto mb-3 ${dragging ? 'text-primary' : 'text-gray-300'}`} />
            <p className="text-sm text-gray-700 font-medium">Drop the CSV export and the <code>uploads_*</code> folders here</p>
            <p className="text-xs text-gray-500 mt-1">Folders are read recursively. You can also pick them manually:</p>
            <div className="flex items-center justify-center gap-2 mt-4">
              <input ref={csvRef} type="file" accept=".csv" className="hidden"
                onChange={async e => { const f = e.target.files?.[0]; if (f) await takeFiles([{ path: f.name, file: f }]); e.target.value = ''; }} />
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => csvRef.current?.click()}>
                <FileUp className="h-4 w-4" /> Choose CSV
              </Button>
              <input ref={dirRef} type="file" multiple className="hidden"
                onChange={async e => {
                  const list = Array.from(e.target.files || []).map(f => ({ path: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name, file: f }));
                  if (list.length) await takeFiles(list);
                  e.target.value = '';
                }} />
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => dirRef.current?.click()}>
                <FolderUp className="h-4 w-4" /> Choose folder
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 mt-4">
            {csvName
              ? <Badge variant="secondary" className="gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-green-600" /> {csvName}</Badge>
              : <Badge variant="outline" className="text-gray-400">No CSV yet</Badge>}
            <Badge variant="outline">{assets.length} file{assets.length === 1 ? '' : 's'} staged</Badge>
            {(csvName || assets.length > 0) && (
              <Button size="sm" variant="ghost" className="gap-1.5 text-gray-500" onClick={reset}>
                <X className="h-3.5 w-3.5" /> Clear
              </Button>
            )}
            <div className="flex-1" />
            <Button className="gap-1.5" disabled={!csvText || busy} onClick={runPreview}>
              {busy ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Preview import
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Preview */}
      {result && (
        <>
          {mode === 'preview' ? (
            <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 text-xs text-blue-900 flex items-start gap-2">
              <Info className="h-4 w-4 mt-px shrink-0" />
              <span>
                <strong>Preview only — nothing was written.</strong> Counters come from the import engine
                running in dry-run mode. <em>Skipped</em> is an estimate: rows that would collide with a
                unique index (re-importing a declined or cancelled registration) are counted as new here.
              </span>
            </div>
          ) : (
            <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2.5 text-xs text-green-900 flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 mt-px shrink-0" />
              <span>
                <strong>Import complete.</strong> Registrations were created or enriched, and the matched
                files now live in <code>event-media</code>. Running the same export again is safe: it
                enriches instead of duplicating, and never overwrites a value that is already filled.
              </span>
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            {stat('Rows', result.total)}
            {stat('After dedupe', result.deduped)}
            {stat('New', result.imported, 'text-green-600')}
            {stat('Enriched', result.enriched, 'text-blue-600')}
            {stat('Linked to account', result.linked)}
            {stat('Skipped (est.)', result.skipped, 'text-gray-500')}
          </div>

          {analysis && (
            <Card>
              <CardContent className="pt-6 space-y-3">
                <div className="text-sm font-medium flex items-center gap-2">
                  <FileWarning className="h-4 w-4 text-primary" /> Files
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {stat('Referenced', analysis.refs.length)}
                  {stat('Matched', analysis.matched.length, 'text-green-600')}
                  {stat('To re-host', analysis.matched.filter(m => m.ingested).length, 'text-primary')}
                  {stat('Not found', analysis.missing.length, analysis.missing.length ? 'text-amber-600' : 'text-gray-900')}
                </div>
                {analysis.matched.some(m => !m.ingested) && (
                  <p className="text-xs text-gray-500">
                    {analysis.matched.filter(m => !m.ingested).length} matched file(s) belong to columns the
                    engine doesn't store yet (architecture entry, press card) — they are left untouched
                    until phases 3 and 4.
                  </p>
                )}
                {analysis.missing.length > 0 && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 space-y-1">
                    <div className="flex items-start gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                      <span>
                        These files were referenced in the CSV but not found in the dropped folders. On
                        import they keep their original Jotform URL — the import is never blocked.
                      </span>
                    </div>
                    <ul className="pl-5 list-disc max-h-40 overflow-y-auto">
                      {analysis.missing.slice(0, 40).map((m, i) => (
                        <li key={i}><code>{m.filename}</code> <span className="text-amber-600">· {m.column} · submission {m.submissionId}</span></li>
                      ))}
                    </ul>
                    {analysis.missing.length > 40 && <div className="pl-5 text-amber-600">+ {analysis.missing.length - 40} more</div>}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {analysis && (analysis.architectPro + analysis.architectStudent) > 0 && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-900 flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 mt-px shrink-0" />
              <span>
                <strong>{analysis.architectPro + analysis.architectStudent} architecture contest entr{(analysis.architectPro + analysis.architectStudent) === 1 ? 'y' : 'ies'}</strong>{' '}
                ({analysis.architectPro} professional, {analysis.architectStudent} student) — imported with
                their competition entry: company description, sustainability statement, references, team,
                portfolio link, and the re-hosted logo, company image and project renders.
              </span>
            </div>
          )}

          {analysis && analysis.unmappedParticipation.length > 0 && (
            <Card>
              <CardContent className="pt-6">
                <div className="text-sm font-medium mb-2">Unmapped participation values</div>
                <div className="flex flex-wrap gap-2">
                  {analysis.unmappedParticipation.map(u => (
                    <Badge key={u.value} variant="outline" className="text-amber-700 border-amber-300">
                      {u.value} · {u.count}
                    </Badge>
                  ))}
                </div>
                <p className="text-xs text-gray-500 mt-2">These fall back to the <code>visitor</code> role.</p>
              </CardContent>
            </Card>
          )}

          {result.codes.length > 0 && (
            <Card>
              <CardContent className="pt-6">
                <div className="text-sm font-medium flex items-center gap-2 mb-2">
                  <KeyRound className="h-4 w-4 text-primary" /> Claim codes to be generated ({result.codes.length})
                </div>
                <div className="max-h-56 overflow-y-auto text-xs divide-y divide-gray-100">
                  {result.codes.map(c => (
                    <div key={c.email} className="flex items-center justify-between py-1.5 gap-3">
                      <span className="text-gray-600 truncate">{c.email}</span>
                      <code className="shrink-0 text-gray-900">{c.code}</code>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-gray-400 mt-2">Codes are regenerated on the real import — treat these as indicative.</p>
              </CardContent>
            </Card>
          )}

          {result.role_suggestions.length > 0 && (
            <Card>
              <CardContent className="pt-6">
                <div className="text-sm font-medium flex items-center gap-2 mb-2">
                  <Users className="h-4 w-4 text-primary" /> Role suggestions ({result.role_suggestions.length})
                </div>
                <div className="max-h-56 overflow-y-auto text-xs divide-y divide-gray-100">
                  {result.role_suggestions.map(s => (
                    <div key={s.email} className="py-1.5">
                      <div className="text-gray-700">{s.email}</div>
                      <div className="text-gray-500">
                        has: {s.has_roles.join(', ') || '—'} · suggested: <span className="text-amber-700">{s.suggested.join(', ')}</span>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-gray-400 mt-2">Suggestions are recorded for staff review — roles are never added automatically.</p>
              </CardContent>
            </Card>
          )}

          {result.errors.length > 0 && (
            <Card>
              <CardContent className="pt-6">
                <div className="text-sm font-medium flex items-center gap-2 mb-2 text-red-600">
                  <AlertTriangle className="h-4 w-4" /> Row errors ({result.errors.length})
                </div>
                <div className="max-h-56 overflow-y-auto text-xs divide-y divide-gray-100">
                  {result.errors.map((e, i) => (
                    <div key={i} className="py-1.5">
                      <div className="text-gray-700">{e.email}</div>
                      <div className="text-red-600">{e.error}</div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {uploadFailures.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <div className="flex items-start gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>
                  <strong>{uploadFailures.length} file(s) could not be uploaded</strong> and kept their
                  original Jotform URL: {uploadFailures.slice(0, 8).map(f => f.filename).join(', ')}
                  {uploadFailures.length > 8 ? ` + ${uploadFailures.length - 8} more` : ''}.
                </span>
              </div>
            </div>
          )}

          {mode === 'preview' && (
            <Card>
              <CardContent className="pt-6 space-y-3">
                {progress && progress.total > 0 && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs text-gray-500">
                      <span>Re-hosting files…</span>
                      <span>{progress.done} / {progress.total}</span>
                    </div>
                    <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                      <div className="h-full bg-primary transition-all"
                        style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }} />
                    </div>
                  </div>
                )}
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-gray-500">
                    Confirming re-hosts the matched files into <code>event-media</code> and writes the
                    registrations. Files that weren't found keep their Jotform URL.
                  </p>
                  <Button className="gap-1.5 shrink-0" disabled={busy} onClick={runImport}>
                    {busy ? <RefreshCw className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Confirm import
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
