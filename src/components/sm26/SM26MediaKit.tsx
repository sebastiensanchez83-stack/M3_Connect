import { useState, useEffect, useRef } from 'react';
import { Loader2, Upload, Trash2, Download, Send, CheckCircle2, Copy, Megaphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';

// Per-participant media kit: social visuals (LinkedIn/Instagram/…) the Yacht Club
// or M3 make for a participant to post about their SM26 participation, plus a
// copy-paste caption. Server (sm26-media-kit) gates + signs; can_edit decides
// whether this renders as the editor (staff/YCM) or the participant's read-only
// downloader. Renders nothing for a participant with no kit yet.

interface KitFile { id: string; filename: string; url: string; is_image: boolean; mime: string | null; storage_path?: string }

// Ready-to-post default caption, so a caption is always pre-written (the Yacht
// Club/M3 can tweak per participant before saving). The company name is filled
// in when we have it.
export function defaultMediaKitCaption(company?: string | null): string {
  const who = (company || '').trim();
  const lead = who
    ? `Proud to announce that ${who} will take part in the Smart & Sustainable Marina Rendezvous 2026! 🌊`
    : `Proud to take part in the Smart & Sustainable Marina Rendezvous 2026! 🌊`;
  return `${lead}

Join us on 20–21 September at the Yacht Club de Monaco for two days shaping the future of smart, sustainable marinas — come and meet us there.

#SmartMarina2026 #SustainableMarinas #YachtClubDeMonaco #M3Monaco`;
}

export function SM26MediaKit({ registrationId, eventId, companyName }: { registrationId: string; eventId: string; companyName?: string | null }) {
  const { user } = useAuth();
  const [files, setFiles] = useState<KitFile[]>([]);
  const [caption, setCaption] = useState('');
  const [savedCaption, setSavedCaption] = useState('');
  const [notifiedAt, setNotifiedAt] = useState<string | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [savingCap, setSavingCap] = useState(false);
  const [notifying, setNotifying] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    const { data } = await supabase.functions.invoke('sm26-media-kit', { body: { action: 'get', registration_id: registrationId } });
    const d = data as { caption?: string; notified_at?: string | null; files?: KitFile[]; can_edit?: boolean } | null;
    setFiles(d?.files || []);
    setCaption(d?.caption || defaultMediaKitCaption(companyName)); setSavedCaption(d?.caption || '');
    setNotifiedAt(d?.notified_at || null); setCanEdit(!!d?.can_edit);
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [registrationId]);

  const upload = async (fl: FileList) => {
    if (!user || !fl.length) return;
    setBusy(true);
    try {
      for (const file of Array.from(fl)) {
        const safe = file.name.replace(/[^\w.\-]+/g, '_').slice(-80);
        const path = `${user.id}/media-kits/${registrationId}/${Date.now()}-${safe}`;
        const { error: upErr } = await supabase.storage.from('event-media').upload(path, file, { upsert: false });
        if (upErr) { toast({ title: 'Upload failed', description: upErr.message, variant: 'destructive' }); continue; }
        const { error: insErr } = await supabase.from('sm_media_kit_file').insert({
          registration_id: registrationId, event_id: eventId, storage_path: path,
          filename: file.name, mime: file.type || null, size_bytes: file.size, created_by: user.id,
        });
        if (insErr) { await supabase.storage.from('event-media').remove([path]).catch(() => {}); toast({ title: 'Could not save file', description: insErr.message, variant: 'destructive' }); }
      }
      await load();
    } finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  const removeFile = async (f: KitFile) => {
    if (!window.confirm('Remove this file from the media kit?')) return;
    setBusy(true);
    const { error } = await supabase.from('sm_media_kit_file').delete().eq('id', f.id);
    if (error) { toast({ title: 'Could not remove', description: error.message, variant: 'destructive' }); setBusy(false); return; }
    if (f.storage_path) await supabase.storage.from('event-media').remove([f.storage_path]).catch(() => {});
    await load(); setBusy(false);
  };

  const saveCaption = async () => {
    setSavingCap(true);
    const { error } = await supabase.from('sm_media_kit').upsert(
      { registration_id: registrationId, event_id: eventId, caption: caption.trim() || null, created_by: user?.id, updated_at: new Date().toISOString() },
      { onConflict: 'registration_id' },
    );
    setSavingCap(false);
    if (error) { toast({ title: 'Could not save caption', description: error.message, variant: 'destructive' }); return; }
    setSavedCaption(caption.trim());
    toast({ title: 'Caption saved' });
  };

  const notify = async () => {
    setNotifying(true);
    const { data, error } = await supabase.functions.invoke('sm26-media-kit', { body: { action: 'notify', registration_id: registrationId } });
    setNotifying(false);
    if (error) { toast({ title: 'Could not notify the participant', variant: 'destructive' }); return; }
    const d = data as { ok?: boolean; skipped?: string } | null;
    if (d?.skipped) { toast({ title: 'Not sent', description: d.skipped === 'no files' ? 'Add at least one file first.' : 'No email on file for this participant.', variant: 'destructive' }); return; }
    setNotifiedAt(new Date().toISOString());
    toast({ title: 'Participant notified', description: 'They were emailed that their media kit is ready.' });
  };

  const download = async (f: KitFile) => {
    try {
      const b = await (await fetch(f.url)).blob();
      const o = URL.createObjectURL(b);
      const a = document.createElement('a'); a.href = o; a.download = f.filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(o), 1500);
    } catch { window.open(f.url, '_blank'); }
  };

  const displayCaption = savedCaption || defaultMediaKitCaption(companyName);
  const copyCaption = async () => { try { await navigator.clipboard.writeText(displayCaption); toast({ title: 'Caption copied' }); } catch { /* ignore */ } };

  if (loading) return <div className="flex items-center gap-2 text-sm text-gray-400 py-3"><Loader2 className="h-4 w-4 animate-spin" /> Loading media kit…</div>;
  // Participant with no visuals yet: render nothing (a kit is its images + caption).
  if (!canEdit && files.length === 0) return null;

  return (
    <div className="rounded-lg border border-gray-100 p-3 space-y-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
        <Megaphone className="h-4 w-4 text-primary" /> Media kit
        {!canEdit && <span className="text-xs font-normal text-gray-500">— visuals to announce your participation</span>}
      </div>

      {files.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {files.map(f => (
            <div key={f.id} className="relative">
              {f.is_image ? (
                <button onClick={() => download(f)} title={`Download ${f.filename}`} className="block h-20 w-20 rounded-md border border-gray-200 overflow-hidden bg-white hover:ring-2 hover:ring-primary/30">
                  <img src={f.url} alt={f.filename} className="h-full w-full object-contain" />
                </button>
              ) : (
                <button onClick={() => download(f)} title={`Download ${f.filename}`} className="h-20 w-20 rounded-md border border-gray-200 flex flex-col items-center justify-center gap-1 text-[10px] text-gray-600 hover:bg-gray-50 p-1">
                  <Download className="h-4 w-4 text-gray-400" /><span className="truncate w-full text-center">{f.filename}</span>
                </button>
              )}
              {canEdit && (
                <button onClick={() => removeFile(f)} disabled={busy} title="Remove" className="absolute -top-1.5 -right-1.5 bg-white border border-gray-200 rounded-full p-0.5 text-gray-400 hover:text-red-600 shadow-sm">
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      ) : canEdit ? <p className="text-xs text-gray-400">No visuals yet — upload the images this participant can share.</p> : null}

      {canEdit && (
        <div>
          <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={e => e.target.files && upload(e.target.files)} />
          <Button size="sm" variant="outline" className="gap-1.5" disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Upload visuals
          </Button>
        </div>
      )}

      {canEdit ? (
        <div className="space-y-1.5">
          <div className="text-[11px] uppercase tracking-wide text-gray-400">Suggested caption</div>
          <textarea value={caption} onChange={e => setCaption(e.target.value)} rows={3}
            placeholder="e.g. Proud to take part in the Smart & Sustainable Marina Rendezvous 2026 at the Yacht Club de Monaco… #SmartMarina2026"
            className="w-full text-sm rounded-md border border-gray-200 p-2 focus:outline-none focus:ring-2 focus:ring-primary/30" />
          <Button size="sm" variant="outline" disabled={savingCap || caption.trim() === savedCaption} onClick={saveCaption}>
            {savingCap && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />} Save caption
          </Button>
        </div>
      ) : (
        <div className="space-y-1.5">
          <div className="text-[11px] uppercase tracking-wide text-gray-400">Suggested caption</div>
          <div className="text-sm text-gray-700 whitespace-pre-wrap bg-gray-50 rounded-md p-2 border border-gray-100">{displayCaption}</div>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={copyCaption}><Copy className="h-3.5 w-3.5" /> Copy caption</Button>
        </div>
      )}

      {canEdit && files.length > 0 && (
        <div className="flex items-center gap-2 pt-1 border-t border-gray-100">
          <Button size="sm" className="gap-1.5" disabled={notifying} onClick={notify}>
            {notifying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} {notifiedAt ? 'Re-notify participant' : 'Notify participant'}
          </Button>
          {notifiedAt && <span className="text-[11px] text-green-600 inline-flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" /> Notified {new Date(notifiedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</span>}
        </div>
      )}
    </div>
  );
}
