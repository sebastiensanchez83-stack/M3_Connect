import { useState, useEffect, useRef } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import { RefreshCw, ArrowLeft, Ruler, Upload, Trash2, Download, Loader2, Save, FileText, Clock, CheckCircle2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';

// Admin hub for the architecture competition: the shared download pack, the
// (separate) submission deadline, and a tracker of who has uploaded. Files live in
// event-media/architecture-pack/* (registered architects can read them).

interface Resource { id: string; label: string; file_path: string; content_type: string | null; size_bytes: number | null; display_order: number }
interface Entry { role_assignment_id: string; anon_code: string | null; company: string; category: string; file_count: number; last_upload: string | null }

const fmtSize = (b: number | null) => b == null ? '' : b < 1024 * 1024 ? `${Math.round(b / 1024)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`;
const catLabel = (r: string) => r === 'architect_student' ? 'Student' : r === 'architect_pro' ? 'Professional' : r;

export function AdminSM26Architecture() {
  const [eventId, setEventId] = useState<string | null>(null);
  const [resources, setResources] = useState<Resource[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [deadline, setDeadline] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = async () => {
    setLoading(true);
    const { data: ev } = await supabase.from('sm_event').select('id, settings').eq('slug', 'sm26').maybeSingle();
    const e = ev as { id: string; settings?: { architecture_closes_at?: string } } | null;
    const eid = e?.id || null;
    setEventId(eid);
    setDeadline(e?.settings?.architecture_closes_at || '');
    if (!eid) { setLoading(false); return; }
    const [{ data: rs }, { data: en }] = await Promise.all([
      supabase.rpc('sm_architecture_resources', { p_event_id: eid }),
      supabase.rpc('sm_architecture_admin_entries', { p_event_id: eid }),
    ]);
    setResources((rs || []) as Resource[]);
    setEntries((en || []) as Entry[]);
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const saveDeadline = async () => {
    if (!eventId) return;
    setBusy(true);
    const { error } = await supabase.rpc('sm_set_architecture_deadline', { p_event_id: eventId, p_date: deadline || '' });
    setBusy(false);
    if (error) { toast({ title: 'Could not save', description: error.message, variant: 'destructive' }); return; }
    toast({ title: deadline ? 'Deadline saved' : 'Deadline cleared' });
  };

  const upload = async (file: File) => {
    if (!eventId) return;
    setBusy(true);
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `architecture-pack/${Date.now()}-${safe}`;
    const { error: upErr } = await supabase.storage.from('event-media').upload(path, file, { upsert: false });
    if (upErr) { setBusy(false); toast({ title: 'Upload failed', description: upErr.message, variant: 'destructive' }); return; }
    const { error } = await supabase.rpc('sm_architecture_resource_add', { p_event_id: eventId, p_label: label.trim() || file.name, p_path: path, p_content_type: file.type || null, p_size: file.size });
    setBusy(false);
    if (error) { toast({ title: 'Could not save', description: error.message, variant: 'destructive' }); return; }
    setLabel('');
    toast({ title: 'File added to the pack' });
    load();
  };

  const removeResource = async (r: Resource) => {
    if (!confirm(`Remove "${r.label}" from the pack?`)) return;
    setBusy(true);
    const { error } = await supabase.rpc('sm_architecture_resource_remove', { p_id: r.id });
    if (!error) await supabase.storage.from('event-media').remove([r.file_path]).catch(() => {});
    setBusy(false);
    if (error) { toast({ title: 'Could not remove', description: error.message, variant: 'destructive' }); return; }
    load();
  };

  const download = async (path: string) => {
    const { data } = await supabase.storage.from('event-media').createSignedUrl(path, 300);
    if (data) window.open(data.signedUrl, '_blank');
  };

  if (loading) return <div className="flex items-center justify-center h-[60vh]"><RefreshCw className="h-7 w-7 animate-spin text-primary" /></div>;

  const submitted = entries.filter(e => e.file_count > 0).length;

  return (
    <div className="container mx-auto px-4 py-6 max-w-3xl">
      <Helmet><title>Architecture competition — SM26 admin</title></Helmet>
      <Link to="/admin/sm26" className="text-sm text-gray-500 hover:text-primary inline-flex items-center gap-1.5 mb-3"><ArrowLeft className="h-4 w-4" /> Smart 26</Link>
      <div className="flex items-center justify-between gap-2 mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Ruler className="h-6 w-6 text-primary" /> Architecture competition</h1>
          <p className="text-sm text-gray-500 mt-0.5">The shared download pack, the submission deadline, and who has submitted.</p>
        </div>
        <Button size="sm" variant="outline" className="gap-1.5 shrink-0" onClick={load}><RefreshCw className="h-3.5 w-3.5" /> Refresh</Button>
      </div>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Clock className="h-4 w-4 text-primary" /> Submission deadline</CardTitle>
          <CardDescription>Architects can upload until the end of this day (Monaco time). Leave empty for no deadline. This is separate from the general participant editing deadline.</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-2">
          <Input type="date" value={deadline} onChange={e => setDeadline(e.target.value)} className="h-9 w-48" />
          <Button size="sm" onClick={saveDeadline} disabled={busy} className="gap-1.5"><Save className="h-4 w-4" /> Save</Button>
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><FileText className="h-4 w-4 text-primary" /> Competition files ({resources.length})</CardTitle>
          <CardDescription>The shared pack every registered architect downloads — brief, site files, board template, rules.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {resources.length === 0 ? <p className="text-sm text-gray-400">No files yet.</p> : resources.map(r => (
            <div key={r.id} className="flex items-center justify-between gap-2 rounded-lg border border-gray-100 px-3 py-2">
              <button onClick={() => download(r.file_path)} className="flex items-center gap-2 min-w-0 text-left">
                <Download className="h-4 w-4 text-primary shrink-0" />
                <span className="text-sm text-gray-800 truncate">{r.label}</span>
                {r.size_bytes != null && <span className="text-xs text-gray-400 shrink-0">{fmtSize(r.size_bytes)}</span>}
              </button>
              <button onClick={() => removeResource(r)} disabled={busy} className="text-gray-400 hover:text-red-600 p-1 shrink-0"><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
          <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
            <Input value={label} onChange={e => setLabel(e.target.value)} placeholder="Label (optional — defaults to the file name)" className="h-9" />
            <input ref={fileRef} type="file" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} />
            <Button size="sm" variant="outline" className="gap-1.5 shrink-0" disabled={busy} onClick={() => fileRef.current?.click()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Add file
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-primary" /> Submissions ({submitted}/{entries.length})</CardTitle>
          <CardDescription>Every registered architecture entry and whether they've uploaded their project.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {entries.length === 0 ? <p className="text-sm text-gray-400 p-4">No architecture entries registered yet.</p> : (
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead><tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
                <th className="px-4 py-2">Entry</th><th className="px-4 py-2">Category</th><th className="px-4 py-2">Files</th><th className="px-4 py-2">Last upload</th>
              </tr></thead>
              <tbody>{entries.map(e => (
                <tr key={e.role_assignment_id} className="border-b border-gray-50">
                  <td className="px-4 py-2.5"><span className="font-medium">{e.company}</span>{e.anon_code && <span className="text-xs text-gray-400 ml-1.5">#{e.anon_code}</span>}</td>
                  <td className="px-4 py-2.5 text-gray-500">{catLabel(e.category)}</td>
                  <td className="px-4 py-2.5">{e.file_count > 0
                    ? <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border bg-green-50 text-green-700 border-green-200"><CheckCircle2 className="h-3 w-3" /> {e.file_count}</span>
                    : <span className="text-xs text-gray-400">none</span>}</td>
                  <td className="px-4 py-2.5 text-gray-400 text-xs">{e.last_upload ? new Date(e.last_upload).toLocaleString() : '—'}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
