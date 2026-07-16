import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Loader2, Upload, Trash2, Send, CheckCircle2, Megaphone, Search, Eye, Download,
  ChevronDown, ChevronUp, RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useFileDrop } from '@/hooks/useFileDrop';
import { defaultMediaKitCaption } from './SM26MediaKit';

// Flat media-kit workspace: one row per participant, inline drag-and-drop upload,
// caption, notify and a live status pill — modelled on the e-catalogue list so
// the Yacht Club (or M3) never has to drill into each profile to hand out visuals.
// Also the "who has / hasn't received" overview: To upload -> To send -> Sent ->
// Opened -> Downloaded. Server (sm26-media-kit) gates + signs and stamps the
// opened/downloaded events; uploads/deletes/caption run client-side via RLS.

interface KitFile { id: string; filename: string; url: string | null; is_image: boolean; mime: string | null; storage_path?: string }
interface Participant { reg_id: string; name: string | null; company: string | null; thumb: string | null; roles: string[] }
interface KitData { caption: string; notified_at: string | null; first_viewed_at: string | null; first_downloaded_at: string | null; files: KitFile[] }
type Status = 'none' | 'ready' | 'sent' | 'opened' | 'downloaded';

const EMPTY: KitData = { caption: '', notified_at: null, first_viewed_at: null, first_downloaded_at: null, files: [] };
const isHttp = (s: string) => /^https?:\/\//i.test(s);
const isImgName = (s: string) => /\.(png|jpe?g|webp|gif|svg|avif|bmp)$/i.test(s.split('?')[0]);
const fmtDate = (s: string | null) => s ? new Date(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '';

const STATUS_META: Record<Status, { label: string; cls: string }> = {
  none: { label: 'No kit', cls: 'bg-gray-50 text-gray-500 border-gray-200' },
  ready: { label: 'To send', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  sent: { label: 'Sent', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  opened: { label: 'Opened', cls: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  downloaded: { label: 'Downloaded', cls: 'bg-green-50 text-green-700 border-green-200' },
};
const FILTER_ORDER: Status[] = ['ready', 'sent', 'opened', 'downloaded', 'none'];

function statusOf(k: Pick<KitData, 'files' | 'notified_at' | 'first_viewed_at' | 'first_downloaded_at'>): Status {
  if (!k.files.length) return 'none';
  if (k.first_downloaded_at) return 'downloaded';
  if (k.first_viewed_at) return 'opened';
  if (k.notified_at) return 'sent';
  return 'ready';
}

function MediaKitRow({ p, eventId, uid, initial, onStatus }: {
  p: Participant; eventId: string; uid: string; initial: KitData; onStatus: (regId: string, s: Status) => void;
}) {
  const [files, setFiles] = useState<KitFile[]>(initial.files);
  const [caption, setCaption] = useState(initial.caption || defaultMediaKitCaption(p.company));
  const [savedCaption, setSavedCaption] = useState(initial.caption || '');
  const [notifiedAt, setNotifiedAt] = useState(initial.notified_at);
  const [busy, setBusy] = useState(false);
  const [notifying, setNotifying] = useState(false);
  const [savingCap, setSavingCap] = useState(false);
  const [showCaption, setShowCaption] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const viewedAt = initial.first_viewed_at;
  const downloadedAt = initial.first_downloaded_at;

  const status = statusOf({ files, notified_at: notifiedAt, first_viewed_at: viewedAt, first_downloaded_at: downloadedAt });
  useEffect(() => { onStatus(p.reg_id, status); }, [status, p.reg_id, onStatus]);

  const upload = async (fl: FileList | File[]) => {
    const arr = Array.from(fl); if (!arr.length) return;
    setBusy(true);
    try {
      const added: KitFile[] = [];
      for (const file of arr) {
        const safe = file.name.replace(/[^\w.\-]+/g, '_').slice(-80);
        const path = `${uid}/media-kits/${p.reg_id}/${Date.now()}-${safe}`;
        const { error: upErr } = await supabase.storage.from('event-media').upload(path, file, { upsert: false });
        if (upErr) { toast({ title: 'Upload failed', description: upErr.message, variant: 'destructive' }); continue; }
        const { data: ins, error: insErr } = await supabase.from('sm_media_kit_file').insert({
          registration_id: p.reg_id, event_id: eventId, storage_path: path,
          filename: file.name, mime: file.type || null, size_bytes: file.size, created_by: uid,
        }).select('id').maybeSingle();
        if (insErr || !ins) { await supabase.storage.from('event-media').remove([path]).catch(() => {}); toast({ title: 'Could not save file', description: insErr?.message, variant: 'destructive' }); continue; }
        const { data: signed } = await supabase.storage.from('event-media').createSignedUrl(path, 3600);
        added.push({ id: (ins as { id: string }).id, filename: file.name, url: signed?.signedUrl || null, is_image: (file.type || '').startsWith('image/') || isImgName(file.name), mime: file.type || null, storage_path: path });
      }
      if (added.length) setFiles(f => [...f, ...added]);
    } finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  };
  const { isDragging, dropHandlers } = useFileDrop((fl) => upload(fl), busy);

  const removeFile = async (f: KitFile) => {
    if (!window.confirm('Remove this visual from the media kit?')) return;
    setBusy(true);
    const { error } = await supabase.from('sm_media_kit_file').delete().eq('id', f.id);
    if (error) { toast({ title: 'Could not remove', description: error.message, variant: 'destructive' }); setBusy(false); return; }
    if (f.storage_path) await supabase.storage.from('event-media').remove([f.storage_path]).catch(() => {});
    setFiles(prev => prev.filter(x => x.id !== f.id)); setBusy(false);
  };

  const saveCaption = async () => {
    setSavingCap(true);
    const { error } = await supabase.from('sm_media_kit').upsert(
      { registration_id: p.reg_id, event_id: eventId, caption: caption.trim() || null, created_by: uid, updated_at: new Date().toISOString() },
      { onConflict: 'registration_id' });
    setSavingCap(false);
    if (error) { toast({ title: 'Could not save caption', description: error.message, variant: 'destructive' }); return; }
    setSavedCaption(caption.trim()); toast({ title: 'Caption saved' });
  };

  const notify = async () => {
    setNotifying(true);
    const { data, error } = await supabase.functions.invoke('sm26-media-kit', { body: { action: 'notify', registration_id: p.reg_id } });
    setNotifying(false);
    if (error) { toast({ title: 'Could not notify the participant', variant: 'destructive' }); return; }
    const d = data as { skipped?: string } | null;
    if (d?.skipped) { toast({ title: 'Not sent', description: d.skipped === 'no files' ? 'Upload at least one visual first.' : 'No email on file for this participant.', variant: 'destructive' }); return; }
    setNotifiedAt(new Date().toISOString());
    toast({ title: 'Participant notified', description: 'They were emailed that their media kit is ready.' });
  };

  return (
    <div className="rounded-lg border border-gray-100 p-3">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-white border border-gray-100 flex items-center justify-center shrink-0 overflow-hidden">
          {p.thumb ? <img src={p.thumb} alt="" className="w-full h-full object-contain p-0.5" /> : <Megaphone className="h-4 w-4 text-gray-300" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-gray-900 truncate">{p.company || p.name || 'Participant'}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${STATUS_META[status].cls}`}>{STATUS_META[status].label}</span>
          </div>
          {p.company && p.name && <div className="text-xs text-gray-500 truncate">{p.name}</div>}
          {(notifiedAt || viewedAt || downloadedAt) && (
            <div className="text-[11px] text-gray-400 flex flex-wrap gap-x-3 mt-0.5">
              {notifiedAt && <span className="inline-flex items-center gap-1"><Send className="h-3 w-3" /> Sent {fmtDate(notifiedAt)}</span>}
              {viewedAt && <span className="inline-flex items-center gap-1"><Eye className="h-3 w-3" /> Opened {fmtDate(viewedAt)}</span>}
              {downloadedAt && <span className="inline-flex items-center gap-1 text-green-600"><Download className="h-3 w-3" /> Downloaded {fmtDate(downloadedAt)}</span>}
            </div>
          )}
        </div>
      </div>

      {files.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-2">
          {files.map(f => (
            <div key={f.id} className="relative">
              {f.is_image && f.url ? (
                <img src={f.url} alt={f.filename} title={f.filename} className="h-16 w-16 rounded-md border border-gray-200 object-contain bg-white" />
              ) : (
                <div title={f.filename} className="h-16 w-16 rounded-md border border-gray-200 flex flex-col items-center justify-center gap-1 text-[9px] text-gray-500 p-1 text-center">
                  <Download className="h-3.5 w-3.5 text-gray-300" /><span className="truncate w-full">{f.filename}</span>
                </div>
              )}
              <button onClick={() => removeFile(f)} disabled={busy} title="Remove" className="absolute -top-1.5 -right-1.5 bg-white border border-gray-200 rounded-full p-0.5 text-gray-400 hover:text-red-600 shadow-sm">
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 mt-2 flex-wrap">
        <div {...dropHandlers} className={`inline-flex items-center rounded-md border border-dashed px-2 py-1 transition-colors ${isDragging ? 'border-primary bg-primary/5' : 'border-gray-200'}`}>
          <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={e => e.target.files && upload(e.target.files)} />
          <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-700 disabled:opacity-60">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} {files.length ? 'Add visuals' : 'Upload visuals'}
          </button>
          <span className="text-[10px] text-gray-400 ml-2 hidden sm:inline">or drop here</span>
        </div>

        <button type="button" onClick={() => setShowCaption(s => !s)} className="inline-flex items-center gap-1 text-xs text-gray-600 border border-gray-200 rounded-md px-2 py-1 hover:bg-gray-50">
          Caption {savedCaption ? <CheckCircle2 className="h-3 w-3 text-green-500" /> : null} {showCaption ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>

        {files.length > 0 && (
          <Button size="sm" className="gap-1.5 h-7" disabled={notifying} onClick={notify}>
            {notifying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} {notifiedAt ? 'Re-notify' : 'Notify'}
          </Button>
        )}
      </div>

      {showCaption && (
        <div className="mt-2 space-y-1.5">
          <textarea value={caption} onChange={e => setCaption(e.target.value)} rows={4}
            className="w-full text-sm rounded-md border border-gray-200 p-2 focus:outline-none focus:ring-2 focus:ring-primary/30" />
          <Button size="sm" variant="outline" className="h-7" disabled={savingCap || caption.trim() === savedCaption} onClick={saveCaption}>
            {savingCap && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />} Save caption
          </Button>
        </div>
      )}
    </div>
  );
}

export function SM26MediaKitBoard({ eventId }: { eventId: string }) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [kits, setKits] = useState<Map<string, KitData>>(new Map());
  const [statusMap, setStatusMap] = useState<Map<string, Status>>(new Map());
  const [nonce, setNonce] = useState(0);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Status | ''>('');

  const reportStatus = useCallback((regId: string, s: Status) => {
    setStatusMap(m => { if (m.get(regId) === s) return m; const n = new Map(m); n.set(regId, s); return n; });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: ent, error } = await supabase.rpc('sm_partner_entries', { p_event_id: eventId });
    if (error) { setLoading(false); toast({ title: 'Could not load participants', description: error.message, variant: 'destructive' }); return; }
    const byReg = new Map<string, Participant>();
    for (const e of (ent || []) as { reg_id: string; role: string; name: string | null; company: string | null; thumb: string | null }[]) {
      const cur = byReg.get(e.reg_id);
      if (cur) { if (e.role && !cur.roles.includes(e.role)) cur.roles.push(e.role); if (!cur.thumb && e.thumb) cur.thumb = e.thumb; }
      else byReg.set(e.reg_id, { reg_id: e.reg_id, name: e.name, company: e.company, thumb: e.thumb, roles: e.role ? [e.role] : [] });
    }
    const list = [...byReg.values()];
    // sign storage-path logo thumbnails (http thumbs render directly)
    const toSign = list.filter(p => p.thumb && !isHttp(p.thumb)).map(p => p.thumb as string);
    if (toSign.length) {
      const signed = new Map<string, string>();
      await Promise.all([...new Set(toSign)].map(async t => { const { data: s } = await supabase.storage.from('event-media').createSignedUrl(t, 1800); if (s) signed.set(t, s.signedUrl); }));
      for (const p of list) {
        if (p.thumb && !isHttp(p.thumb)) p.thumb = signed.get(p.thumb) || null;
      }
    }
    list.sort((a, b) => (a.company || a.name || '').localeCompare(b.company || b.name || ''));
    setParticipants(list);

    const { data: kd } = await supabase.functions.invoke('sm26-media-kit', { body: { action: 'list', event_id: eventId } });
    const km = new Map<string, KitData>();
    for (const k of ((kd as { kits?: Array<KitData & { registration_id: string }> })?.kits || [])) {
      km.set(k.registration_id, { caption: k.caption || '', notified_at: k.notified_at, first_viewed_at: k.first_viewed_at, first_downloaded_at: k.first_downloaded_at, files: k.files || [] });
    }
    const sm = new Map<string, Status>();
    for (const p of list) { const kit = km.get(p.reg_id); sm.set(p.reg_id, kit ? statusOf(kit) : 'none'); }
    setKits(km); setStatusMap(sm); setNonce(n => n + 1); setLoading(false);
  }, [eventId]);

  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => {
    const c: Record<Status, number> = { none: 0, ready: 0, sent: 0, opened: 0, downloaded: 0 };
    for (const p of participants) c[statusMap.get(p.reg_id) || 'none']++;
    return c;
  }, [participants, statusMap]);

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    return participants.filter(p => {
      if (filter && (statusMap.get(p.reg_id) || 'none') !== filter) return false;
      if (term && !`${p.company || ''} ${p.name || ''}`.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [participants, statusMap, q, filter]);

  if (loading) return <div className="flex items-center gap-2 text-sm text-gray-400 py-8 justify-center"><Loader2 className="h-4 w-4 animate-spin" /> Loading media kits…</div>;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="h-4 w-4 text-gray-300 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search participant…"
            className="w-full text-sm rounded-md border border-gray-200 pl-8 pr-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
        <button onClick={load} title="Refresh" className="inline-flex items-center gap-1.5 text-xs text-gray-600 border border-gray-200 rounded-md px-2.5 py-1.5 hover:bg-gray-50">
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>

      {/* Status funnel — click to filter */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {FILTER_ORDER.map(s => counts[s] > 0 && (
          <button key={s} onClick={() => setFilter(f => f === s ? '' : s)}
            className={`text-xs px-2.5 py-1 rounded-full border transition-all ${STATUS_META[s].cls} ${filter === s ? 'ring-2 ring-primary/30' : ''}`}>
            {STATUS_META[s].label} · {counts[s]}
          </button>
        ))}
        {filter && <button onClick={() => setFilter('')} className="text-xs text-gray-400 underline px-1">clear</button>}
      </div>

      {visible.length === 0 ? (
        <p className="text-sm text-gray-400 py-6 text-center">No participants match.</p>
      ) : (
        <div className="space-y-2">
          {visible.map(p => (
            <MediaKitRow key={`${p.reg_id}:${nonce}`} p={p} eventId={eventId} uid={user?.id || ''} initial={kits.get(p.reg_id) || EMPTY} onStatus={reportStatus} />
          ))}
        </div>
      )}

      <p className="text-[11px] text-gray-400">
        “Opened” means the participant loaded their media-kit page; “Downloaded” means they saved a file. Neither confirms they actually posted it.
      </p>
    </div>
  );
}
