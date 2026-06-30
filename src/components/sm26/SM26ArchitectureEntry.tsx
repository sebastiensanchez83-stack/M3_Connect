import { useState, useEffect, useRef } from 'react';
import { Loader2, Save, Download, Upload, Trash2, FileText, Folder, Lock, AlertTriangle, CheckCircle2, Film, ChevronDown, ChevronRight } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { useSm26EditLock } from '@/components/sm26/useSm26EditLock';

// The architect's account area. Two clearly separate things:
//  • Company information FOR THE E-CATALOGUE (the firm — from registration; general
//    editing deadline; shown in the catalogue; NEVER sent to the blind jury).
//  • The COMPETITION SUBMISSION (the project — 8 A2 panels + 1 A3 notice + optional
//    3D animation per the brief; ≤10 MB each; its own deadline; anonymous to jury).

// Catalogue/company fields (the firm — NOT judged).
const CATALOGUE_FIELDS: { key: string; label: string }[] = [
  { key: 'company_description', label: 'Company description' },
  { key: 'sustainability_statement', label: 'Sustainability approach' },
  { key: 'domain', label: 'Domain / area of expertise' },
  { key: 'references_text', label: 'Signature projects / references' },
  { key: 'portfolio_link', label: 'Portfolio link' },
];
// What each of the 8 A2 panels should contain (from the competition brief).
const PANEL_GUIDE = [
  'Panel 1 — Introduction & site context: intro text (≤250 words), site plan, key strategies, zoning, circulation.',
  'Panel 2 — Overall vision: relationship of the required elements; aerial perspectives in context with the Lungomare.',
  'Panel 3 — Required 01, Marina Hub: programme, plans, sections, elevations at 1:200; observation level clearly indicated.',
  'Panel 4 — Required 02 & 03, Sailing School & Sea Attraction: programme drawings, sections, visualisations.',
  'Panel 5 — Additional proposals (optional): landscape, public spaces, infrastructure, environmental features.',
  'Panel 6 — Sustainability & technical: sustainable strategies, materials, energy diagrams, constructability.',
  'Panel 7 — Exhibition, site: aerial view of the overall proposal; curated visual summary of Panels 1–2.',
  'Panel 8 — Exhibition, buildings: high-quality renders of the required elements; minimal, concise captions.',
];
const MAX_BYTES = 10 * 1024 * 1024;
const fmtSize = (b: number | null) => b == null ? '' : b < 1024 * 1024 ? `${Math.round(b / 1024)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`;

interface Resource { id: string; label: string; file_path: string; size_bytes: number | null; folder: string | null }
interface Sub { id: string; file_path: string; filename: string | null; size_bytes: number | null; kind: string; created_at: string }

export function SM26ArchitectureEntry({ roleAssignmentId }: { roleAssignmentId: string }) {
  const { user } = useAuth();
  const { locked: catalogueLocked, prettyDate: cataloguePretty } = useSm26EditLock();
  const [loading, setLoading] = useState(true);
  const [deadline, setDeadline] = useState<string | null>(null);
  const [resources, setResources] = useState<Resource[]>([]);
  const [files, setFiles] = useState<Sub[]>([]);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [savingText, setSavingText] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const panelRef = useRef<HTMLInputElement | null>(null);
  const noticeRef = useRef<HTMLInputElement | null>(null);
  const animRef = useRef<HTMLInputElement | null>(null);

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Monaco' });
  const subLocked = !!deadline && today > deadline;
  const prettyDeadline = deadline ? new Date(deadline + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : null;

  const panels = files.filter(f => f.kind === 'panel');
  const notice = files.find(f => f.kind === 'notice') || null;
  const animation = files.find(f => f.kind === 'animation') || null;

  const load = async () => {
    setLoading(true);
    const { data: ev } = await supabase.from('sm_event').select('id, settings').eq('slug', 'sm26').maybeSingle();
    const e = ev as { id: string; settings?: { architecture_closes_at?: string } } | null;
    const eid = e?.id || null;
    setDeadline(e?.settings?.architecture_closes_at || null);
    const [rs, fs, entry] = await Promise.all([
      eid ? supabase.rpc('sm_architecture_resources', { p_event_id: eid }) : Promise.resolve({ data: [] as Resource[] }),
      supabase.rpc('sm_architecture_my_files', { p_role_assignment_id: roleAssignmentId }),
      supabase.from('sm_architecture_entry').select(CATALOGUE_FIELDS.map(f => f.key).join(',')).eq('role_assignment_id', roleAssignmentId).maybeSingle(),
    ]);
    setResources((rs.data || []) as Resource[]);
    setFiles((fs.data || []) as Sub[]);
    const d = (entry.data || {}) as Record<string, unknown>;
    const v: Record<string, string> = {};
    for (const f of CATALOGUE_FIELDS) v[f.key] = typeof d[f.key] === 'string' ? (d[f.key] as string) : '';
    setVals(v);
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [roleAssignmentId]);

  const openSigned = async (path: string) => {
    const { data } = await supabase.storage.from('event-media').createSignedUrl(path, 300);
    if (data) window.open(data.signedUrl, '_blank');
  };

  const saveText = async () => {
    if (catalogueLocked) return;
    setSavingText(true);
    const patch: Record<string, unknown> = {};
    for (const f of CATALOGUE_FIELDS) patch[f.key] = vals[f.key]?.trim() || null;
    const { error } = await supabase.from('sm_architecture_entry').update(patch).eq('role_assignment_id', roleAssignmentId);
    setSavingText(false);
    if (error) { toast({ title: 'Could not save', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Saved' });
  };

  // replace=true (notice/animation are single) clears any existing file of that kind first.
  const doUpload = async (file: File, kind: string, replace: boolean) => {
    if (subLocked || !user) return;
    if (file.size > MAX_BYTES) { toast({ title: 'File too large', description: 'Maximum 10 MB per file (per the brief).', variant: 'destructive' }); return; }
    setBusy(true);
    if (replace) {
      for (const ex of files.filter(f => f.kind === kind)) {
        await supabase.rpc('sm_architecture_file_remove', { p_id: ex.id });
        await supabase.storage.from('event-media').remove([ex.file_path]).catch(() => {});
      }
    }
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `${user.id}/architecture/${roleAssignmentId}/${kind}-${Date.now()}-${safe}`;
    const { error: upErr } = await supabase.storage.from('event-media').upload(path, file, { upsert: false });
    if (upErr) { setBusy(false); toast({ title: 'Upload failed', description: upErr.message, variant: 'destructive' }); return; }
    const { error } = await supabase.rpc('sm_architecture_file_add', { p_role_assignment_id: roleAssignmentId, p_path: path, p_filename: file.name, p_content_type: file.type || null, p_size: file.size, p_kind: kind });
    setBusy(false);
    if (error) { toast({ title: 'Could not record file', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Uploaded' });
    load();
  };

  const removeFile = async (f: Sub) => {
    if (subLocked) return;
    if (!confirm('Remove this file?')) return;
    setBusy(true);
    const { error } = await supabase.rpc('sm_architecture_file_remove', { p_id: f.id });
    if (!error) await supabase.storage.from('event-media').remove([f.file_path]).catch(() => {});
    setBusy(false);
    if (error) { toast({ title: 'Could not remove', description: error.message, variant: 'destructive' }); return; }
    load();
  };

  if (loading) return <Card><CardContent className="py-6 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gray-300" /></CardContent></Card>;

  const fileRow = (f: Sub, label: string) => (
    <div key={f.id} className="flex items-center gap-2 rounded-lg border border-gray-100 px-3 py-2">
      <button onClick={() => openSigned(f.file_path)} className="flex items-center gap-2 min-w-0 flex-1 text-left">
        <FileText className="h-4 w-4 text-gray-400 shrink-0" />
        <span className="text-sm text-gray-800 truncate">{label}</span>
        {f.size_bytes != null && <span className="text-xs text-gray-400 shrink-0">{fmtSize(f.size_bytes)}</span>}
      </button>
      {!subLocked && <button onClick={() => removeFile(f)} disabled={busy} className="text-gray-400 hover:text-red-600 p-1 shrink-0"><Trash2 className="h-4 w-4" /></button>}
    </div>
  );

  // Group the download pack by folder (ungrouped first).
  const packGroups = (() => {
    const m = new Map<string, Resource[]>();
    for (const r of resources) { const k = (r.folder || '').trim(); if (!m.has(k)) m.set(k, []); m.get(k)!.push(r); }
    return [...m.entries()].sort((a, b) => (a[0] === '' ? -1 : b[0] === '' ? 1 : a[0].localeCompare(b[0])));
  })();

  return (
    <div className="space-y-3">
      {/* Download pack */}
      <Card>
        <CardContent className="py-4">
          <div className="text-sm font-medium flex items-center gap-2 mb-2"><Download className="h-4 w-4 text-primary" /> Competition files</div>
          {resources.length === 0
            ? <p className="text-xs text-gray-500">The competition pack will appear here once the organizers publish it.</p>
            : <div className="space-y-2.5">{packGroups.map(([fname, items]) => (
                <div key={fname || '_root'} className="space-y-1.5">
                  {fname && <div className="text-[11px] font-medium uppercase tracking-wide text-gray-500 flex items-center gap-1.5"><Folder className="h-3.5 w-3.5 text-gray-400" /> {fname}</div>}
                  {items.map(r => (
                    <button key={r.id} onClick={() => openSigned(r.file_path)} className="flex items-center gap-2 w-full text-left rounded-lg border border-gray-100 hover:border-primary/40 px-3 py-2">
                      <Download className="h-4 w-4 text-primary shrink-0" />
                      <span className="text-sm text-gray-800 truncate flex-1">{r.label}</span>
                      {r.size_bytes != null && <span className="text-xs text-gray-400">{fmtSize(r.size_bytes)}</span>}
                    </button>
                  ))}
                </div>
              ))}</div>}
        </CardContent>
      </Card>

      {/* Competition submission */}
      <Card>
        <CardContent className="py-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-medium flex items-center gap-2"><Upload className="h-4 w-4 text-primary" /> Competition submission</div>
            {subLocked && <span className="text-xs text-gray-400 inline-flex items-center gap-1.5"><Lock className="h-3.5 w-3.5" /> Closed{prettyDeadline ? ` · ${prettyDeadline}` : ''}</span>}
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 flex items-start gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>Judging is <strong>anonymous</strong> — no name, logo, or company anywhere in the documents. PDF, max 10 MB each. Name files <code>LASTNAME-FIRSTNAME_1.pdf</code>…{prettyDeadline ? <> Deadline: <strong>{prettyDeadline}</strong>.</> : null}</span>
          </div>

          {/* Panels */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs flex items-center gap-1.5">8 × A2 panels (PDF, 300 dpi) · <span className={panels.length >= 8 ? 'text-green-600' : 'text-gray-400'}>{panels.length}/8</span></Label>
              <button type="button" onClick={() => setShowGuide(g => !g)} className="text-[11px] text-primary inline-flex items-center gap-0.5">{showGuide ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />} What goes on each panel</button>
            </div>
            {showGuide && <ul className="text-[11px] text-gray-500 space-y-0.5 rounded-lg border border-gray-100 p-2">{PANEL_GUIDE.map((g, i) => <li key={i}>{g}</li>)}</ul>}
            {panels.map((f, i) => fileRow(f, `Panel ${i + 1} — ${f.filename || 'PDF'}`))}
            {!subLocked && (
              <>
                <input ref={panelRef} type="file" accept=".pdf" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) doUpload(f, 'panel', false); e.target.value = ''; }} />
                <Button size="sm" variant="outline" className="gap-1.5" disabled={busy} onClick={() => panelRef.current?.click()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Add a panel</Button>
              </>
            )}
          </div>

          {/* Notice */}
          <div className="space-y-1.5 border-t border-gray-100 pt-2.5">
            <Label className="text-xs">A3 descriptive notice (PDF)</Label>
            {notice && fileRow(notice, notice.filename || 'Descriptive notice')}
            {!subLocked && !notice && (
              <>
                <input ref={noticeRef} type="file" accept=".pdf" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) doUpload(f, 'notice', true); e.target.value = ''; }} />
                <Button size="sm" variant="outline" className="gap-1.5" disabled={busy} onClick={() => noticeRef.current?.click()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Upload the notice</Button>
              </>
            )}
          </div>

          {/* Animation (optional) */}
          <div className="space-y-1.5 border-t border-gray-100 pt-2.5">
            <Label className="text-xs flex items-center gap-1.5"><Film className="h-3.5 w-3.5" /> 3D animation (optional)</Label>
            {animation && fileRow(animation, animation.filename || '3D animation')}
            {!subLocked && !animation && (
              <>
                <input ref={animRef} type="file" accept="video/*,.mp4,.mov,.gif" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) doUpload(f, 'animation', true); e.target.value = ''; }} />
                <Button size="sm" variant="ghost" className="gap-1.5 text-gray-500" disabled={busy} onClick={() => animRef.current?.click()}><Upload className="h-4 w-4" /> Add an animation</Button>
              </>
            )}
          </div>

          {!subLocked && panels.length > 0 && notice && <div className="text-xs text-green-600 inline-flex items-center gap-1 pt-1"><CheckCircle2 className="h-3.5 w-3.5" /> Submission in progress — {panels.length} panel{panels.length > 1 ? 's' : ''} + notice uploaded.</div>}
        </CardContent>
      </Card>

      {/* Company info — catalogue (NOT judged) */}
      <Card>
        <CardContent className="py-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-medium flex items-center gap-2"><FileText className="h-4 w-4 text-primary" /> Company information <span className="text-xs font-normal text-gray-400">· for the e-catalogue</span></div>
            {catalogueLocked && <span className="text-xs text-gray-400 inline-flex items-center gap-1.5"><Lock className="h-3.5 w-3.5" /> Editing closed{cataloguePretty ? ` · ${cataloguePretty}` : ''}</span>}
          </div>
          <p className="text-xs text-gray-500 -mt-1">About your firm — shown in the catalogue directory. Not part of the (anonymous) competition judging.</p>
          {CATALOGUE_FIELDS.map(f => (
            <div key={f.key} className="space-y-1">
              <Label className="text-xs">{f.label}</Label>
              <Textarea rows={2} value={vals[f.key] || ''} disabled={catalogueLocked} onChange={e => setVals(p => ({ ...p, [f.key]: e.target.value }))} />
            </div>
          ))}
          {!catalogueLocked && <div className="flex justify-end"><Button size="sm" onClick={saveText} disabled={savingText} className="gap-1.5">{savingText ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save</Button></div>}
        </CardContent>
      </Card>
    </div>
  );
}
