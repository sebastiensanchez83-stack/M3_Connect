import { useState, useEffect, useRef } from 'react';
import { Loader2, Save, Download, Upload, Trash2, FileText, Lock, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';

// The architect's whole competition entry in one place: download the shared pack,
// edit the written entry fields, and upload the project files — all governed by the
// (separate) architecture submission deadline. Judging is blind, so we remind them
// not to identify themselves on the boards.

const ARCH_FIELDS: { key: string; label: string }[] = [
  { key: 'company_description', label: 'Company description' },
  { key: 'sustainability_statement', label: 'Sustainability statement' },
  { key: 'domain', label: 'Domain / area of expertise' },
  { key: 'references_text', label: 'References' },
  { key: 'portfolio_link', label: 'Portfolio link' },
];
const MAX_BYTES = 50 * 1024 * 1024;
const fmtSize = (b: number | null) => b == null ? '' : b < 1024 * 1024 ? `${Math.round(b / 1024)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`;

interface Resource { id: string; label: string; file_path: string; size_bytes: number | null }
interface Sub { id: string; file_path: string; filename: string | null; size_bytes: number | null; created_at: string }

export function SM26ArchitectureEntry({ roleAssignmentId }: { roleAssignmentId: string }) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [deadline, setDeadline] = useState<string | null>(null);
  const [resources, setResources] = useState<Resource[]>([]);
  const [files, setFiles] = useState<Sub[]>([]);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [savingText, setSavingText] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Monaco' });
  const locked = !!deadline && today > deadline;
  const prettyDeadline = deadline ? new Date(deadline + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : null;

  const load = async () => {
    setLoading(true);
    const { data: ev } = await supabase.from('sm_event').select('id, settings').eq('slug', 'sm26').maybeSingle();
    const e = ev as { id: string; settings?: { architecture_closes_at?: string } } | null;
    const eid = e?.id || null;
    setDeadline(e?.settings?.architecture_closes_at || null);
    const [rs, fs, entry] = await Promise.all([
      eid ? supabase.rpc('sm_architecture_resources', { p_event_id: eid }) : Promise.resolve({ data: [] as Resource[] }),
      supabase.rpc('sm_architecture_my_files', { p_role_assignment_id: roleAssignmentId }),
      supabase.from('sm_architecture_entry').select(ARCH_FIELDS.map(f => f.key).join(',')).eq('role_assignment_id', roleAssignmentId).maybeSingle(),
    ]);
    setResources((rs.data || []) as Resource[]);
    setFiles((fs.data || []) as Sub[]);
    const d = (entry.data || {}) as Record<string, unknown>;
    const v: Record<string, string> = {};
    for (const f of ARCH_FIELDS) v[f.key] = typeof d[f.key] === 'string' ? (d[f.key] as string) : '';
    setVals(v);
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [roleAssignmentId]);

  const openSigned = async (path: string) => {
    const { data } = await supabase.storage.from('event-media').createSignedUrl(path, 300);
    if (data) window.open(data.signedUrl, '_blank');
  };

  const saveText = async () => {
    if (locked) return;
    setSavingText(true);
    const patch: Record<string, unknown> = {};
    for (const f of ARCH_FIELDS) patch[f.key] = vals[f.key]?.trim() || null;
    const { error } = await supabase.from('sm_architecture_entry').update(patch).eq('role_assignment_id', roleAssignmentId);
    setSavingText(false);
    if (error) { toast({ title: 'Could not save', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Saved' });
  };

  const uploadFile = async (file: File) => {
    if (locked || !user) return;
    if (file.size > MAX_BYTES) { toast({ title: 'File too large', description: 'Maximum 50 MB per file.', variant: 'destructive' }); return; }
    setBusy(true);
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `${user.id}/architecture/${roleAssignmentId}/${Date.now()}-${safe}`;
    const { error: upErr } = await supabase.storage.from('event-media').upload(path, file, { upsert: false });
    if (upErr) { setBusy(false); toast({ title: 'Upload failed', description: upErr.message, variant: 'destructive' }); return; }
    const { error } = await supabase.rpc('sm_architecture_file_add', { p_role_assignment_id: roleAssignmentId, p_path: path, p_filename: file.name, p_content_type: file.type || null, p_size: file.size });
    setBusy(false);
    if (error) { toast({ title: 'Could not record file', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'File uploaded' });
    load();
  };

  const removeFile = async (f: Sub) => {
    if (locked) return;
    if (!confirm(`Remove "${f.filename || 'this file'}"?`)) return;
    setBusy(true);
    const { error } = await supabase.rpc('sm_architecture_file_remove', { p_id: f.id });
    if (!error) await supabase.storage.from('event-media').remove([f.file_path]).catch(() => {});
    setBusy(false);
    if (error) { toast({ title: 'Could not remove', description: error.message, variant: 'destructive' }); return; }
    load();
  };

  if (loading) return <Card><CardContent className="py-6 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gray-300" /></CardContent></Card>;

  const ClosedNote = () => <span className="text-xs text-gray-400 inline-flex items-center gap-1.5"><Lock className="h-3.5 w-3.5" /> Closed{prettyDeadline ? ` · ${prettyDeadline}` : ''}</span>;

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="py-4">
          <div className="text-sm font-medium flex items-center gap-2 mb-2"><Download className="h-4 w-4 text-primary" /> Competition files</div>
          {resources.length === 0
            ? <p className="text-xs text-gray-500">The competition pack will appear here once the organizers publish it.</p>
            : <div className="space-y-1.5">{resources.map(r => (
                <button key={r.id} onClick={() => openSigned(r.file_path)} className="flex items-center gap-2 w-full text-left rounded-lg border border-gray-100 hover:border-primary/40 px-3 py-2">
                  <Download className="h-4 w-4 text-primary shrink-0" />
                  <span className="text-sm text-gray-800 truncate flex-1">{r.label}</span>
                  {r.size_bytes != null && <span className="text-xs text-gray-400">{fmtSize(r.size_bytes)}</span>}
                </button>
              ))}</div>}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="py-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-medium flex items-center gap-2"><FileText className="h-4 w-4 text-primary" /> Your entry details</div>
            {locked && <ClosedNote />}
          </div>
          {ARCH_FIELDS.map(f => (
            <div key={f.key} className="space-y-1">
              <Label className="text-xs">{f.label}</Label>
              <Textarea rows={2} value={vals[f.key] || ''} disabled={locked} onChange={e => setVals(p => ({ ...p, [f.key]: e.target.value }))} />
            </div>
          ))}
          {!locked && <div className="flex justify-end"><Button size="sm" onClick={saveText} disabled={savingText} className="gap-1.5">{savingText ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save</Button></div>}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="py-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-medium flex items-center gap-2"><Upload className="h-4 w-4 text-primary" /> Your project submission</div>
            {locked && <ClosedNote />}
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 flex items-start gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" /> Judging is anonymous — please don't put your name, logo, or company on the boards. Up to 50 MB per file.
          </div>
          {files.length > 0 && <div className="space-y-1.5">{files.map(f => (
            <div key={f.id} className="flex items-center gap-2 rounded-lg border border-gray-100 px-3 py-2">
              <button onClick={() => openSigned(f.file_path)} className="flex items-center gap-2 min-w-0 flex-1 text-left">
                <FileText className="h-4 w-4 text-gray-400 shrink-0" />
                <span className="text-sm text-gray-800 truncate">{f.filename || 'File'}</span>
                {f.size_bytes != null && <span className="text-xs text-gray-400 shrink-0">{fmtSize(f.size_bytes)}</span>}
              </button>
              {!locked && <button onClick={() => removeFile(f)} disabled={busy} className="text-gray-400 hover:text-red-600 p-1 shrink-0"><Trash2 className="h-4 w-4" /></button>}
            </div>
          ))}</div>}
          {locked
            ? (files.length === 0 && <p className="text-xs text-gray-500">Submissions are closed.</p>)
            : <div className="flex items-center gap-2">
                <input ref={fileRef} type="file" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = ''; }} />
                <Button size="sm" variant="outline" className="gap-1.5" disabled={busy} onClick={() => fileRef.current?.click()}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Upload a file
                </Button>
                {files.length > 0 && <span className="text-xs text-green-600 inline-flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" /> {files.length} file{files.length > 1 ? 's' : ''} uploaded</span>}
              </div>}
        </CardContent>
      </Card>
    </div>
  );
}
