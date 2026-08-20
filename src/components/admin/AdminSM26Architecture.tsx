import { useState, useEffect, useRef } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import { RefreshCw, ArrowLeft, Ruler, Upload, Trash2, Download, Loader2, Save, FileText, Folder, Clock, CheckCircle2, ChevronRight, AlertTriangle, Image as ImageIcon, Users, UserPlus, Copy, ExternalLink, Ban, RotateCcw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { SM26AssetGallery, type SM26Asset } from '@/components/sm26/SM26AssetGallery';

// Entrants are capped at the brief's 10 MB in their own form; staff uploading on
// someone's behalf are capped only by what the store accepts.
const STAFF_MAX_BYTES = 50 * 1024 * 1024;

// Admin hub for the architecture competition: the shared download pack, the
// (separate) submission deadline, and a tracker of who has uploaded. Files live in
// event-media/architecture-pack/* (registered architects can read them).
//
// Two participant-file sources exist for the same entry and they are NOT the same
// thing, so the tracker keeps them apart:
//  • sm_architecture_file — the COMPETITION SUBMISSION (8 A2 panels + A3 notice +
//    optional animation). This is what the deadline governs and what is counted.
//  • sm_architecture_entry.project_renders — the firm's e-catalogue portfolio,
//    collected at registration. Shown as context only; folding it into the count
//    would flip the tracker to "everyone submitted" and nobody would be chased.

interface Resource { id: string; label: string; file_path: string; content_type: string | null; size_bytes: number | null; display_order: number; folder: string | null }
interface Entry { role_assignment_id: string; anon_code: string | null; company: string; category: string; file_count: number; last_upload: string | null }
// One submitted competition file, as returned by sm_architecture_my_files — which
// authorizes owner OR sm_is_staff(), so an admin reads any entry with the same call
// the architect's own page makes.
interface SubFile { id: string; file_path: string; filename: string | null; content_type: string | null; size_bytes: number | null; kind: string; created_at: string }
interface Kinds { panel: number; notice: number; animation: number }
// One external jury member — an architect who will most likely never create an
// account. The token in their link IS the credential, and their scores are filed
// under a synthetic juror_user_id that has no auth.users row behind it.
interface Reviewer { id: string; name: string; email: string | null; token: string; created_at: string; revoked_at: string | null; submitted: number; drafted: number; total: number }

const fmtSize = (b: number | null) => b == null ? '' : b < 1024 * 1024 ? `${Math.round(b / 1024)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`;
const catLabel = (r: string) => r === 'architect_student' ? 'Student' : r === 'architect_pro' ? 'Professional' : r;
// The stored deadline is a bare date; render it the way the architect sees it.
const prettyDate = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
const nameOf = (f: SubFile) => f.filename || f.file_path.split('/').pop() || 'file';

// The brief is 8 A2 panels + 1 A3 notice, so a bare file count hides a half-finished
// entry ("4" reads like progress but is not a submission). Show the shape instead.
const shapeOf = (k: Kinds | undefined) => {
  const p = k?.panel || 0, n = k?.notice || 0, a = k?.animation || 0;
  if (p === 0 && n === 0 && a === 0) return null;
  const extra = a > 0 ? ' + animation' : '';
  return p >= 8 && n >= 1
    ? { label: `8 panels + notice${extra}`, complete: true, cls: 'bg-green-50 text-green-700 border-green-200' }
    : { label: `${p}/8 panels${n ? ' + notice' : ', no notice'}${extra}`, complete: false, cls: 'bg-amber-50 text-amber-700 border-amber-200' };
};

// Name each file the way the brief names it. Unlike the jury, staff also see the
// real filename — the anonymisation rule is the jury's alone and stays there.
// The RPC orders by (kind, created_at), which puts the A3 notice above Panel 1 and
// numbers panels by upload order — so a re-upload would renumber every panel after
// it. Order panels by filename instead, which is what the brief asks them to name.
const labelled = (files: SubFile[]): { f: SubFile; label: string }[] => {
  const of = (k: string) => files.filter(f => f.kind === k);
  const panels = of('panel').sort((a, b) => nameOf(a).localeCompare(nameOf(b), undefined, { numeric: true }));
  return [
    ...panels.map((f, i) => ({ f, label: `Panel ${i + 1} (A2)` })),
    ...of('notice').map(f => ({ f, label: 'Descriptive notice (A3)' })),
    ...of('animation').map(f => ({ f, label: '3D animation' })),
    ...files.filter(f => !['panel', 'notice', 'animation'].includes(f.kind)).map(f => ({ f, label: f.kind })),
  ];
};

// Saved files land flat in ~/Downloads, so two entries pulled in a row would mix.
// Lead with the anonymous code the jury and the exhibition use.
const dlName = (e: Entry, label: string, fallback: string) => {
  const ext = fallback.includes('.') ? fallback.slice(fallback.lastIndexOf('.')) : '';
  const stem = `${e.anon_code || e.company}_${label}`.replace(/[^a-zA-Z0-9._-]+/g, '-');
  return ext ? `${stem}${ext}` : stem;
};

export function AdminSM26Architecture() {
  const { user } = useAuth();
  const [eventId, setEventId] = useState<string | null>(null);
  const [resources, setResources] = useState<Resource[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [deadline, setDeadline] = useState('');
  const [savedDeadline, setSavedDeadline] = useState('');
  const [kinds, setKinds] = useState<Record<string, Kinds>>({});
  const [renders, setRenders] = useState<Record<string, number>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [entryFiles, setEntryFiles] = useState<Record<string, SubFile[]>>({});
  // Per row, not one shared slot: two rows opened in quick succession would
  // otherwise clear each other's spinner and render a loaded-but-empty entry as
  // "nothing submitted" — the one sentence that must never be wrong here.
  const [filesBusy, setFilesBusy] = useState<Record<string, boolean>>({});
  const [filesError, setFilesError] = useState<Record<string, boolean>>({});
  const [entryAssets, setEntryAssets] = useState<Record<string, SM26Asset[]>>({});
  const [dlBusy, setDlBusy] = useState<string | null>(null);
  const [uploadBusy, setUploadBusy] = useState<string | null>(null);
  // One hidden input per kind, retargeted at whichever entry is open.
  const staffPanelRef = useRef<HTMLInputElement | null>(null);
  const staffNoticeRef = useRef<HTMLInputElement | null>(null);
  const [uploadFor, setUploadFor] = useState<Entry | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState('');
  const [folder, setFolder] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [reviewers, setReviewers] = useState<Reviewer[]>([]);
  const [revName, setRevName] = useState('');
  const [revEmail, setRevEmail] = useState('');
  const [revBusy, setRevBusy] = useState(false);

  // Its own fetch rather than a slice of load(): adding or revoking a reviewer
  // must not collapse an open entry row and re-download every file with it.
  // The error is ignored on purpose — the tracker above still has to render if
  // the reviewer RPCs are not deployed yet.
  const loadReviewers = async (eid: string) => {
    const { data } = await supabase.rpc('sm_architecture_reviewer_list', { p_event_id: eid });
    setReviewers((data || []) as Reviewer[]);
  };

  const load = async () => {
    setLoading(true);
    const { data: ev } = await supabase.from('sm_event').select('id, settings').eq('slug', 'sm26').maybeSingle();
    const e = ev as { id: string; settings?: { architecture_closes_at?: string } } | null;
    const eid = e?.id || null;
    setEventId(eid);
    setDeadline(e?.settings?.architecture_closes_at || '');
    setSavedDeadline(e?.settings?.architecture_closes_at || '');
    if (!eid) { setLoading(false); return; }
    const [{ data: rs }, { data: en }, { data: fk }, { data: ae }] = await Promise.all([
      supabase.rpc('sm_architecture_resources', { p_event_id: eid }),
      supabase.rpc('sm_architecture_admin_entries', { p_event_id: eid }),
      // Staff-readable directly (policy sm_architecture_file_staff_read), so one
      // round trip gives the panel/notice breakdown for every row — something
      // file_count alone cannot express.
      supabase.from('sm_architecture_file').select('role_assignment_id,kind').eq('event_id', eid),
      // Registration portfolio, counted separately and never mixed into the above.
      supabase.from('sm_architecture_entry').select('role_assignment_id,project_renders').eq('event_id', eid),
      // External jury links, fetched in the same round as everything else.
      loadReviewers(eid),
    ]);
    setResources((rs || []) as Resource[]);
    setEntries((en || []) as Entry[]);
    const km: Record<string, Kinds> = {};
    for (const r of (fk || []) as { role_assignment_id: string; kind: string }[]) {
      if (!km[r.role_assignment_id]) km[r.role_assignment_id] = { panel: 0, notice: 0, animation: 0 };
      const k = km[r.role_assignment_id];
      if (r.kind === 'panel') k.panel++; else if (r.kind === 'notice') k.notice++; else if (r.kind === 'animation') k.animation++;
    }
    setKinds(km);
    const rm: Record<string, number> = {};
    for (const r of (ae || []) as { role_assignment_id: string; project_renders: string[] | null }[]) rm[r.role_assignment_id] = (r.project_renders || []).length;
    setRenders(rm);
    // Drop the lazy per-entry cache so Refresh really refreshes.
    setEntryFiles({});
    setFilesBusy({});
    setFilesError({});
    setEntryAssets({});
    setExpanded(null);
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const saveDeadline = async () => {
    if (!eventId) return;
    setBusy(true);
    const { error } = await supabase.rpc('sm_set_architecture_deadline', { p_event_id: eventId, p_date: deadline || '' });
    setBusy(false);
    if (error) { toast({ title: 'Could not save', description: error.message, variant: 'destructive' }); return; }
    setSavedDeadline(deadline);
    toast({ title: deadline ? 'Deadline saved' : 'Deadline cleared' });
  };

  const upload = async (file: File) => {
    if (!eventId) return;
    setBusy(true);
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `architecture-pack/${Date.now()}-${safe}`;
    const { error: upErr } = await supabase.storage.from('event-media').upload(path, file, { upsert: false, contentType: file.type || 'application/octet-stream' });
    if (upErr) { setBusy(false); toast({ title: 'Upload failed', description: upErr.message, variant: 'destructive' }); return; }
    const { error } = await supabase.rpc('sm_architecture_resource_add', { p_event_id: eventId, p_label: label.trim() || file.name, p_path: path, p_content_type: file.type || null, p_size: file.size, p_folder: folder.trim() || null });
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

  // Open in a new tab. Surfacing the error matters: a button that silently does
  // nothing on a signing failure reads as a dead page.
  const download = async (path: string) => {
    const { data, error } = await supabase.storage.from('event-media').createSignedUrl(path, 300);
    if (error || !data) { toast({ title: 'Could not open that file', description: error?.message, variant: 'destructive' }); return; }
    window.open(data.signedUrl, '_blank');
  };

  // Save to disk. The signed URLs live on the Supabase origin, where the HTML
  // download attribute is ignored cross-origin — fetch to a blob and save that.
  // Falls back to opening the tab, as the e-catalogue helper does, so a CORS or
  // network failure still puts the file in front of the admin.
  const saveBlob = async (url: string, filename: string) => {
    try {
      const b = await (await fetch(url)).blob();
      const o = URL.createObjectURL(b);
      const a = document.createElement('a'); a.href = o; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(o), 1500);
      return true;
    } catch { window.open(url, '_blank'); return false; }
  };

  const saveStored = async (path: string, filename: string) => {
    const { data, error } = await supabase.storage.from('event-media').createSignedUrl(path, 300);
    if (error || !data) return false;
    return saveBlob(data.signedUrl, filename);
  };

  const saveOne = async (e: Entry, f: SubFile, label: string) => {
    if (!(await saveStored(f.file_path, dlName(e, label, nameOf(f))))) toast({ title: 'Could not download that file', variant: 'destructive' });
  };

  // A full entry is 8 panels + a notice, ~40 MB. Sequential blob saves, no zip
  // dependency: a window.open loop is popup-blocked after the first file. Chrome
  // and Edge still ask once to allow multiple downloads, and an anchor click
  // cannot observe that answer — hence "started", never "downloaded".
  const downloadAll = async (e: Entry) => {
    const files = labelled(entryFiles[e.role_assignment_id] || []);
    if (files.length === 0) return;
    setDlBusy(e.role_assignment_id);
    let failed = 0;
    for (const { f, label } of files) {
      if (!(await saveStored(f.file_path, dlName(e, label, nameOf(f))))) failed++;
      await new Promise(r => setTimeout(r, 400));
    }
    setDlBusy(null);
    if (failed) toast({ title: `${failed} of ${files.length} files could not be downloaded`, variant: 'destructive' });
    else toast({ title: `Started ${files.length} download${files.length > 1 ? 's' : ''}`, description: 'If your browser asks to allow multiple downloads, accept it or only the first file is saved.' });
  };

  // The registration renders are the only material on the platform for most
  // entries, so they need the same bulk save. The gallery's own control uses a
  // cross-origin download attribute, which browsers ignore.
  const downloadImages = async (e: Entry) => {
    const assets = entryAssets[e.role_assignment_id] || [];
    if (assets.length === 0) return;
    setDlBusy(e.role_assignment_id);
    let failed = 0, i = 0;
    for (const a of assets) {
      i++;
      const ext = (a.filename?.split('.').pop() || 'jpg').toLowerCase();
      if (!(await saveBlob(a.url, dlName(e, `image-${i}`, a.filename || `image-${i}.${ext}`)))) failed++;
      await new Promise(r => setTimeout(r, 400));
    }
    setDlBusy(null);
    if (failed) toast({ title: `${failed} of ${assets.length} images could not be downloaded`, variant: 'destructive' });
    else toast({ title: `Started ${assets.length} download${assets.length > 1 ? 's' : ''}`, description: 'If your browser asks to allow multiple downloads, accept it or only the first file is saved.' });
  };

  // Expand a row and fetch its files once. sm_architecture_my_files is the same
  // staff-authorized RPC the architect's own page uses, so nothing new is needed.
  const loadFiles = async (id: string) => {
    setFilesBusy(prev => ({ ...prev, [id]: true }));
    setFilesError(prev => ({ ...prev, [id]: false }));
    const { data, error } = await supabase.rpc('sm_architecture_my_files', { p_role_assignment_id: id });
    setFilesBusy(prev => ({ ...prev, [id]: false }));
    if (error) {
      setFilesError(prev => ({ ...prev, [id]: true }));
      toast({ title: 'Could not load the files', description: error.message, variant: 'destructive' });
      return;
    }
    setEntryFiles(prev => ({ ...prev, [id]: (data || []) as SubFile[] }));
  };

  const toggle = async (e: Entry) => {
    const id = e.role_assignment_id;
    if (expanded === id) { setExpanded(null); return; }
    setExpanded(id);
    if (!entryFiles[id]) await loadFiles(id);
  };

  // Upload a board on an architect's behalf. Entrants are held to the brief's
  // 10 MB in their own form; staff are not, because the reason to be here is
  // precisely the file that would not go through — the bucket takes 50 MB.
  // sm_architecture_file_add already accepts staff for any entry and skips the
  // deadline, so a late fix does not need the deadline moved for everyone.
  const staffUpload = async (e: Entry, file: File, kind: string) => {
    if (!user) return;
    if (file.size > STAFF_MAX_BYTES) {
      toast({ title: 'Too large even for staff', description: `${fmtSize(file.size)} — the store accepts 50 MB. Compress it first.`, variant: 'destructive' });
      return;
    }
    const id = e.role_assignment_id;
    setUploadBusy(id);
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `${user.id}/architecture/${id}/${kind}-${Date.now()}-${safe}`;
    const { error: upErr } = await supabase.storage.from('event-media').upload(path, file, { upsert: false });
    if (upErr) { setUploadBusy(null); toast({ title: 'Upload failed', description: upErr.message, variant: 'destructive' }); return; }
    const { error } = await supabase.rpc('sm_architecture_file_add', {
      p_role_assignment_id: id, p_path: path, p_filename: file.name,
      p_content_type: file.type || null, p_size: file.size, p_kind: kind,
    });
    setUploadBusy(null);
    if (error) { toast({ title: 'Could not record the file', description: error.message, variant: 'destructive' }); return; }
    toast({ title: `Added on behalf of ${e.company}`, description: 'It is now in front of the jury.' });
    await loadFiles(id);
    load();
  };

  const reviewerLink = (r: Reviewer) => `${window.location.origin}/sm26/jury/architecture?token=${r.token}`;

  // The link is the deliverable, so it goes straight to the clipboard: a token
  // shown once in a toast and nowhere else is a token someone retypes by hand.
  const addReviewer = async () => {
    if (!eventId || !revName.trim()) return;
    setRevBusy(true);
    const { data, error } = await supabase.rpc('sm_architecture_reviewer_add', { p_event_id: eventId, p_name: revName.trim(), p_email: revEmail.trim() || null });
    setRevBusy(false);
    if (error) { toast({ title: 'Could not create the link', description: error.message, variant: 'destructive' }); return; }
    const res = data as { ok?: boolean; error?: string; token?: string; name?: string } | null;
    if (!res?.ok || !res.token) { toast({ title: 'Could not create the link', description: res?.error, variant: 'destructive' }); return; }
    const link = `${window.location.origin}/sm26/jury/architecture?token=${res.token}`;
    navigator.clipboard?.writeText(link).catch(() => {});
    setRevName(''); setRevEmail('');
    toast({ title: `Link created for ${res.name || revName.trim()}`, description: 'Copied to the clipboard — email it to that person and nobody else.' });
    loadReviewers(eventId);
  };

  const copyLink = (r: Reviewer) => {
    const link = reviewerLink(r);
    navigator.clipboard?.writeText(link).catch(() => {});
    toast({ title: `Link copied for ${r.name}`, description: link });
  };

  // Revoking shuts the door, it does not undo the scoring: the reviews already
  // submitted keep their jury assignments and keep counting in the ranking.
  const setRevoked = async (r: Reviewer, revoked: boolean) => {
    if (!eventId) return;
    if (revoked && !confirm(`Block ${r.name}'s link? Scores they have already submitted stay and keep counting.`)) return;
    setRevBusy(true);
    const { error } = await supabase.rpc('sm_architecture_reviewer_revoke', { p_id: r.id, p_revoked: revoked });
    setRevBusy(false);
    if (error) { toast({ title: 'Could not update the link', description: error.message, variant: 'destructive' }); return; }
    loadReviewers(eventId);
  };

  if (loading) return <div className="flex items-center justify-center h-[60vh]"><RefreshCw className="h-7 w-7 animate-spin text-primary" /></div>;

  const submitted = entries.filter(e => e.file_count > 0).length;
  const portfolioOnly = entries.filter(e => e.file_count === 0 && (renders[e.role_assignment_id] || 0) > 0).length;
  const existingFolders = [...new Set(resources.map(r => r.folder).filter(Boolean))] as string[];
  const packGroups = (() => {
    const m = new Map<string, Resource[]>();
    for (const r of resources) { const k = (r.folder || '').trim(); if (!m.has(k)) m.set(k, []); m.get(k)!.push(r); }
    return [...m.entries()].sort((a, b) => (a[0] === '' ? -1 : b[0] === '' ? 1 : a[0].localeCompare(b[0])));
  })();

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
          <CardDescription>Pick the last day architects may upload — the whole of that day stays open and uploads close at midnight Monaco time at the end of it. Leave empty for no deadline. This is separate from the general participant editing deadline.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center gap-2">
            <Input type="date" value={deadline} onChange={e => setDeadline(e.target.value)} className="h-9 w-48" />
            <Button size="sm" onClick={saveDeadline} disabled={busy} className="gap-1.5"><Save className="h-4 w-4" /> Save</Button>
          </div>
          {/* The picker has no time field, so spell out the cutoff the gate applies. */}
          <p className="text-xs text-gray-500">
            {savedDeadline
              ? <>Currently closing <strong>{prettyDate(savedDeadline)}</strong> — the last upload is accepted at <strong>23:59 Monaco time</strong> that day, and uploads are refused from 00:00 the next morning. Staff are never blocked by this.</>
              : 'No deadline set — architects can upload at any time.'}
          </p>
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><FileText className="h-4 w-4 text-primary" /> Competition files ({resources.length})</CardTitle>
          <CardDescription>The shared pack every registered architect downloads. Add a folder name when uploading (e.g. Brief, Site files, Templates) to group the files; leave it blank for ungrouped.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {resources.length === 0 ? <p className="text-sm text-gray-400">No files yet.</p> : packGroups.map(([fname, items]) => (
            <div key={fname || '_root'} className="space-y-1.5">
              {fname
                ? <div className="text-[11px] font-medium uppercase tracking-wide text-gray-500 flex items-center gap-1.5"><Folder className="h-3.5 w-3.5 text-gray-400" /> {fname}</div>
                : (packGroups.length > 1 && <div className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Ungrouped</div>)}
              {items.map(r => (
                <div key={r.id} className="flex items-center justify-between gap-2 rounded-lg border border-gray-100 px-3 py-2">
                  <button onClick={() => download(r.file_path)} className="flex items-center gap-2 min-w-0 text-left">
                    <Download className="h-4 w-4 text-primary shrink-0" />
                    <span className="text-sm text-gray-800 truncate">{r.label}</span>
                    {r.size_bytes != null && <span className="text-xs text-gray-400 shrink-0">{fmtSize(r.size_bytes)}</span>}
                  </button>
                  <button onClick={() => removeResource(r)} disabled={busy} className="text-gray-400 hover:text-red-600 p-1 shrink-0"><Trash2 className="h-4 w-4" /></button>
                </div>
              ))}
            </div>
          ))}
          <div className="flex items-center gap-2 pt-2 border-t border-gray-100 flex-wrap">
            <Input value={folder} onChange={e => setFolder(e.target.value)} placeholder="Folder (optional)" className="h-9 w-40" list="arch-folders" />
            <datalist id="arch-folders">{existingFolders.map(f => <option key={f} value={f} />)}</datalist>
            <Input value={label} onChange={e => setLabel(e.target.value)} placeholder="Label (optional)" className="h-9 flex-1 min-w-[140px]" />
            <input ref={fileRef} type="file" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} />
            {/* Staff uploads on an architect's behalf — retargeted at whichever row is open. */}
            <input ref={staffPanelRef} type="file" accept="application/pdf,image/*" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f && uploadFor) staffUpload(uploadFor, f, 'panel'); e.target.value = ''; }} />
            <input ref={staffNoticeRef} type="file" accept="application/pdf,image/*" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f && uploadFor) staffUpload(uploadFor, f, 'notice'); e.target.value = ''; }} />
            <Button size="sm" variant="outline" className="gap-1.5 shrink-0" disabled={busy} onClick={() => fileRef.current?.click()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Add file
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-primary" /> Competition submissions ({submitted}/{entries.length})</CardTitle>
          <CardDescription>Counted here: the competition submission only — the 8 A2 panels and the A3 notice from the brief, which is what the deadline governs. "Portfolio images" are the past-work images collected at sign-up for the e-catalogue; they are not a submission and have no deadline. Open a row to view and download the files.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {entries.length === 0 ? <p className="text-sm text-gray-400 p-4">No architecture entries registered yet.</p> : (
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead><tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
                <th className="px-4 py-2">Entry</th><th className="px-4 py-2">Category</th><th className="px-4 py-2">Competition submission</th><th className="px-4 py-2">Portfolio images</th><th className="px-4 py-2">Last upload</th>
              </tr></thead>
              <tbody>{entries.map(e => {
                const isOpen = expanded === e.role_assignment_id;
                const shape = shapeOf(kinds[e.role_assignment_id]);
                const nRenders = renders[e.role_assignment_id] || 0;
                const files = entryFiles[e.role_assignment_id] || [];
                const rows = labelled(files);
                const loaded = !!entryFiles[e.role_assignment_id];
                const assets = entryAssets[e.role_assignment_id] || [];
                return [
                  <tr key={e.role_assignment_id} className={`border-b border-gray-50 hover:bg-gray-50 cursor-pointer ${isOpen ? 'bg-primary/5' : ''}`} onClick={() => toggle(e)}>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <ChevronRight className={`h-4 w-4 text-gray-300 shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                        <div><span className="font-medium">{e.company}</span>{e.anon_code && <span className="text-xs text-gray-400 ml-1.5">#{e.anon_code}</span>}</div>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-gray-500">{catLabel(e.category)}</td>
                    <td className="px-4 py-2.5">{shape
                      ? <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border ${shape.cls}`}>{shape.complete ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />} {shape.label}</span>
                      : <span className="text-xs text-gray-400">not submitted</span>}</td>
                    {/* Deliberately grey: portfolio images must never read as progress. */}
                    <td className="px-4 py-2.5">{nRenders > 0
                      ? <span className="inline-flex items-center gap-1 text-xs text-gray-400"><ImageIcon className="h-3 w-3" /> {nRenders}</span>
                      : <span className="text-xs text-gray-300">—</span>}</td>
                    <td className="px-4 py-2.5 text-gray-400 text-xs">{e.last_upload ? new Date(e.last_upload).toLocaleString() : '—'}</td>
                  </tr>,
                  isOpen ? (
                    <tr key={`${e.role_assignment_id}-panel`} className="bg-gray-50/60 border-b border-gray-100">
                      <td colSpan={5} className="px-4 py-4">
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <div className="text-[11px] font-medium uppercase tracking-wide text-gray-500 flex items-center gap-1.5">
                              <FileText className="h-3.5 w-3.5 text-primary" /> Competition submission{savedDeadline ? ` · closes ${prettyDate(savedDeadline)}, 23:59 Monaco` : ''}
                            </div>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {/* For the file an architect could not get through: their
                                  own form stops at the brief's 10 MB, this does not. */}
                              <Button size="sm" variant="outline" className="h-8 gap-1.5" disabled={uploadBusy === e.role_assignment_id}
                                onClick={ev => { ev.stopPropagation(); setUploadFor(e); staffPanelRef.current?.click(); }}>
                                {uploadBusy === e.role_assignment_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Add a panel
                              </Button>
                              <Button size="sm" variant="ghost" className="h-8 gap-1.5 text-gray-500" disabled={uploadBusy === e.role_assignment_id}
                                onClick={ev => { ev.stopPropagation(); setUploadFor(e); staffNoticeRef.current?.click(); }}>
                                <Upload className="h-3.5 w-3.5" /> Notice
                              </Button>
                              {files.length > 0 && (
                                <Button size="sm" variant="outline" className="h-8 gap-1.5" disabled={dlBusy === e.role_assignment_id}
                                  onClick={ev => { ev.stopPropagation(); downloadAll(e); }}>
                                  {dlBusy === e.role_assignment_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} Download all ({files.length})
                                </Button>
                              )}
                            </div>
                          </div>
                          {/* "Nothing submitted" is only ever said about a list that
                              actually came back — never about one still loading or failed. */}
                          {filesError[e.role_assignment_id]
                            ? <button onClick={ev => { ev.stopPropagation(); loadFiles(e.role_assignment_id); }} className="text-sm text-amber-700 inline-flex items-center gap-1.5 py-2">
                                <AlertTriangle className="h-4 w-4" /> Could not load the files — retry
                              </button>
                            : filesBusy[e.role_assignment_id] || !loaded
                              ? <div className="flex items-center gap-2 text-sm text-gray-400 py-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading files…</div>
                              : rows.length === 0
                                ? <p className="text-sm text-gray-400">Nothing submitted yet — no panels and no notice.</p>
                                : rows.map(({ f, label: fl }) => (
                                <div key={f.id} className="flex items-center justify-between gap-2 rounded-lg border border-gray-100 bg-white px-3 py-2">
                                  <button onClick={ev => { ev.stopPropagation(); download(f.file_path); }} className="flex items-center gap-2 min-w-0 flex-1 text-left">
                                    <FileText className="h-4 w-4 text-gray-400 shrink-0" />
                                    <span className="text-sm text-gray-800 shrink-0">{fl}</span>
                                    <span className="text-xs text-gray-400 truncate">{nameOf(f)}</span>
                                    {f.size_bytes != null && <span className="text-xs text-gray-400 shrink-0">{fmtSize(f.size_bytes)}</span>}
                                  </button>
                                  <button onClick={ev => { ev.stopPropagation(); saveOne(e, f, fl); }} title="Download this file" className="text-gray-400 hover:text-primary p-1 shrink-0"><Download className="h-4 w-4" /></button>
                                </div>
                              ))}
                        </div>
                        {/* Secondary on purpose. The sm26-assets resolver signs these
                            server-side and returns everything for staff — the blind
                            filter is the jury's, and it stays the jury's. */}
                        <div className="space-y-1 border-t border-gray-200 mt-4 pt-3">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <div className="text-[11px] font-medium uppercase tracking-wide text-gray-400 flex items-center gap-1.5"><ImageIcon className="h-3.5 w-3.5" /> Registration portfolio</div>
                            {assets.length > 0 && (
                              <Button size="sm" variant="ghost" className="h-8 gap-1.5 text-gray-500" disabled={dlBusy === e.role_assignment_id}
                                onClick={ev => { ev.stopPropagation(); downloadImages(e); }}>
                                {dlBusy === e.role_assignment_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} Download images ({assets.length})
                              </Button>
                            )}
                          </div>
                          <p className="text-[11px] text-gray-400">Everything supplied at registration for the e-catalogue — logo, company image, past-work images, and any document a student attached. Not the competition entry, and not covered by the submission deadline.</p>
                          <SM26AssetGallery roleAssignmentId={e.role_assignment_id} title="" emptyText="No registration images." compact
                            onLoaded={list => setEntryAssets(prev => prev[e.role_assignment_id] ? prev : { ...prev, [e.role_assignment_id]: list })} />
                        </div>
                      </td>
                    </tr>
                  ) : null,
                ];
              })}</tbody>
            </table></div>
          )}
          {/* The gap the count cannot show: registered, has files on the platform, still has not submitted. */}
          {portfolioOnly > 0 && (
            <p className="px-4 py-2.5 text-xs text-gray-400 border-t border-gray-50">
              {portfolioOnly} {portfolioOnly > 1 ? 'entries have' : 'entry has'} registration images on the platform but no competition submission yet — chase them before the deadline.
            </p>
          )}
        </CardContent>
      </Card>

      {/* The outside jury. Nobody here signs up: the token is the whole
          credential, so one link per named person and never a shared one.
          Some will print the sheet, circle the grades in ink and post it
          back — staff then open that same link and key it in under them. */}
      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Users className="h-4 w-4 text-primary" /> External jury (no account needed)</CardTitle>
          <CardDescription>A private scoring link for an architect who is not on the platform — no sign-up, no password. Anyone holding the link scores as that person, so send it to one named address and nowhere else.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {reviewers.length === 0 ? <p className="text-sm text-gray-400">No external jury members yet.</p> : reviewers.map(r => {
            const revoked = !!r.revoked_at;
            const done = r.total > 0 && r.submitted >= r.total;
            return (
              <div key={r.id} className={`flex items-center justify-between gap-2 flex-wrap rounded-lg border border-gray-100 px-3 py-2 ${revoked ? 'bg-gray-50/60' : ''}`}>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-sm font-medium ${revoked ? 'text-gray-400' : 'text-gray-800'}`}>{r.name}</span>
                    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border ${done ? 'bg-green-50 text-green-700 border-green-200' : 'bg-gray-50 text-gray-500 border-gray-200'}`}>
                      {done && <CheckCircle2 className="h-3 w-3" />}{r.submitted}/{r.total} scored{r.drafted > 0 ? ` · ${r.drafted} draft${r.drafted > 1 ? 's' : ''}` : ''}
                    </span>
                    {revoked && <span className="text-xs text-amber-700">link blocked</span>}
                  </div>
                  {r.email && <div className="text-xs text-gray-400 truncate">{r.email}</div>}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button size="sm" variant="outline" className="h-8 gap-1.5" disabled={revoked} onClick={() => copyLink(r)}><Copy className="h-3.5 w-3.5" /> Copy link</Button>
                  {/* Staff open it themselves to key in a sheet posted back on paper. */}
                  <Button size="sm" variant="ghost" className="h-8 gap-1.5 text-gray-500" disabled={revoked} onClick={() => window.open(reviewerLink(r), '_blank')} title="Open their scoring page — use this to key in a paper sheet"><ExternalLink className="h-3.5 w-3.5" /> Open</Button>
                  <Button size="sm" variant="ghost" className={`h-8 gap-1.5 ${revoked ? 'text-gray-500' : 'text-gray-400 hover:text-red-600'}`} disabled={revBusy} onClick={() => setRevoked(r, !revoked)}>
                    {revoked ? <><RotateCcw className="h-3.5 w-3.5" /> Restore</> : <><Ban className="h-3.5 w-3.5" /> Revoke</>}
                  </Button>
                </div>
              </div>
            );
          })}
          <div className="flex items-center gap-2 pt-2 border-t border-gray-100 flex-wrap">
            <Input value={revName} onChange={e => setRevName(e.target.value)} placeholder="Full name" className="h-9 flex-1 min-w-[140px]" />
            <Input value={revEmail} onChange={e => setRevEmail(e.target.value)} type="email" placeholder="Email (optional)" className="h-9 flex-1 min-w-[160px]" />
            <Button size="sm" className="gap-1.5 shrink-0" disabled={revBusy || !revName.trim()} onClick={addReviewer}>
              {revBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />} Create link
            </Button>
          </div>
          <p className="text-xs text-gray-500">
            Entries stay anonymous on that page — code and category only, never a company, a name or a filename. The reviewer can score on screen, or use <strong>Print scoresheet</strong> on their own link to print the grids, circle the grades and post them back; open their link yourself to key a posted sheet in under their name. <strong>Revoke</strong> blocks the link only — scores already submitted stay and keep counting towards the award.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
