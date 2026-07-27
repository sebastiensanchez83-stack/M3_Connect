import { useState, useEffect, useCallback, useRef } from 'react';
import { Upload, Trash2, Loader2, FileText, Image as ImageIcon, ExternalLink, Save, Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';

// Press material for one event, shared by the Yacht Club console and the admin
// screen — both go through the same RPCs, which authorise the caller themselves.
// Two ways to publish: a LINK to your own site, or FILES hosted here (as many as
// you need, typically one per language).

interface Resource {
  id: string; kind: 'photos' | 'press_release'; mode: 'link' | 'hosted';
  url: string | null; storage_path: string | null; filename: string | null;
  title: string | null; language: string | null; created_at: string;
}

const T = {
  fr: {
    links: 'Liens vers votre site', linksHint: "Si vous hébergez photos et communiqués sur votre propre site, indiquez les pages ici.",
    photosLink: 'Lien photos', releaseLink: 'Lien communiqués', save: 'Enregistrer',
    files: 'Documents hébergés', filesHint: "Ou déposez les fichiers ici — vous pouvez en mettre plusieurs, par exemple une version par langue.",
    title: 'Titre', language: 'Langue', kind: 'Type', photos: 'Photos', release: 'Communiqué',
    add: 'Ajouter un document', none: 'Aucun document pour le moment.',
    saved: 'Liens presse enregistrés', uploaded: 'Document ajouté', removed: 'Document retiré',
    failed: 'Action impossible', confirmDel: 'Retirer ce document ?',
  },
  en: {
    links: 'Links to your site', linksHint: 'If you host photos and releases on your own site, point to those pages here.',
    photosLink: 'Photos link', releaseLink: 'Press releases link', save: 'Save',
    files: 'Hosted documents', filesHint: 'Or upload the files here — add as many as you need, typically one per language.',
    title: 'Title', language: 'Language', kind: 'Type', photos: 'Photos', release: 'Press release',
    add: 'Add a document', none: 'No document yet.',
    saved: 'Press links saved', uploaded: 'Document added', removed: 'Document removed',
    failed: 'Action failed', confirmDel: 'Remove this document?',
  },
};

export function PressResourcesEditor({ eventId, french = false }: { eventId: string; french?: boolean }) {
  const t = french ? T.fr : T.en;
  const { user } = useAuth();
  const [rows, setRows] = useState<Resource[]>([]);
  const [photosUrl, setPhotosUrl] = useState('');
  const [releaseUrl, setReleaseUrl] = useState('');
  const [savingLinks, setSavingLinks] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [kind, setKind] = useState<'press_release' | 'photos'>('press_release');
  const [title, setTitle] = useState('');
  const [language, setLanguage] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from('event_press_resource')
      .select('id, kind, mode, url, storage_path, filename, title, language, created_at')
      .eq('event_id', eventId).order('created_at', { ascending: false });
    const list = (data || []) as Resource[];
    setRows(list);
    setPhotosUrl(list.find(r => r.mode === 'link' && r.kind === 'photos')?.url || '');
    setReleaseUrl(list.find(r => r.mode === 'link' && r.kind === 'press_release')?.url || '');
  }, [eventId]);
  useEffect(() => { load(); }, [load]);

  const saveLinks = async () => {
    setSavingLinks(true);
    const res = await Promise.all([
      supabase.rpc('sm_partner_set_press_link', { p_event_id: eventId, p_kind: 'photos', p_url: photosUrl, p_title: t.photos }),
      supabase.rpc('sm_partner_set_press_link', { p_event_id: eventId, p_kind: 'press_release', p_url: releaseUrl, p_title: t.release }),
    ]);
    setSavingLinks(false);
    const bad = res.find(r => r.error);
    if (bad?.error) { toast({ title: t.failed, description: bad.error.message, variant: 'destructive' }); return; }
    toast({ title: t.saved });
    load();
  };

  const upload = async (file: File) => {
    if (!user) return;
    setUploading(true);
    try {
      // foldername[1] must be the caller's uid — the only path a non-staff
      // Yacht Club account is allowed to write to in event-media.
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `${user.id}/press/${eventId}/${Date.now()}-${safe}`;
      const { error: upErr } = await supabase.storage.from('event-media')
        .upload(path, file, { upsert: false, contentType: file.type || 'application/octet-stream' });
      if (upErr) { toast({ title: t.failed, description: upErr.message, variant: 'destructive' }); return; }

      const { error } = await supabase.rpc('sm_partner_add_press_file', {
        p_event_id: eventId, p_kind: kind, p_storage_path: path,
        p_filename: file.name, p_mime: file.type || null, p_size: file.size,
        p_title: title || null, p_language: language || null,
      });
      if (error) {
        await supabase.storage.from('event-media').remove([path]).catch(() => {});
        toast({ title: t.failed, description: error.message, variant: 'destructive' });
        return;
      }
      setTitle(''); setLanguage('');
      toast({ title: t.uploaded });
      load();
    } finally { setUploading(false); }
  };

  const remove = async (r: Resource) => {
    if (!confirm(t.confirmDel)) return;
    setBusy(r.id);
    const { data, error } = await supabase.rpc('sm_partner_delete_press_resource', { p_id: r.id });
    setBusy(null);
    if (error) { toast({ title: t.failed, description: error.message, variant: 'destructive' }); return; }
    const path = (data as { storage_path?: string } | null)?.storage_path;
    if (path) await supabase.storage.from('event-media').remove([path]).catch(() => {});
    toast({ title: t.removed });
    load();
  };

  const openFile = async (r: Resource) => {
    if (r.mode === 'link' && r.url) { window.open(r.url, '_blank'); return; }
    if (!r.storage_path) return;
    const { data } = await supabase.storage.from('event-media').createSignedUrl(r.storage_path, 300);
    if (data) window.open(data.signedUrl, '_blank');
  };

  const hosted = rows.filter(r => r.mode === 'hosted');

  return (
    <div className="space-y-4">
      {/* Mode 1 — link out */}
      <div className="space-y-2">
        <div className="text-xs font-semibold text-gray-600 flex items-center gap-1.5">
          <Link2 className="h-3.5 w-3.5 text-primary" /> {t.links}
        </div>
        <p className="text-[11px] text-gray-500 -mt-1">{t.linksHint}</p>
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">{t.photosLink}</Label>
            <Input value={photosUrl} onChange={e => setPhotosUrl(e.target.value)} placeholder="https://" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t.releaseLink}</Label>
            <Input value={releaseUrl} onChange={e => setReleaseUrl(e.target.value)} placeholder="https://" />
          </div>
        </div>
        <div className="flex justify-end">
          <Button size="sm" className="gap-1.5" disabled={savingLinks} onClick={saveLinks}>
            {savingLinks ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} {t.save}
          </Button>
        </div>
      </div>

      {/* Mode 2 — host the files here, as many as needed */}
      <div className="space-y-2 border-t border-gray-100 pt-3">
        <div className="text-xs font-semibold text-gray-600 flex items-center gap-1.5">
          <Upload className="h-3.5 w-3.5 text-primary" /> {t.files}
        </div>
        <p className="text-[11px] text-gray-500 -mt-1">{t.filesHint}</p>

        <div className="grid sm:grid-cols-3 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">{t.kind}</Label>
            <select value={kind} onChange={e => setKind(e.target.value as 'press_release' | 'photos')}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
              <option value="press_release">{t.release}</option>
              <option value="photos">{t.photos}</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t.title}</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t.language}</Label>
            <Input value={language} onChange={e => setLanguage(e.target.value)} placeholder="EN / FR" list="press-langs" />
            <datalist id="press-langs"><option value="EN" /><option value="FR" /><option value="IT" /><option value="ES" /></datalist>
          </div>
        </div>

        <input ref={fileRef} type="file" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} />
        <Button size="sm" variant="outline" className="gap-1.5" disabled={uploading} onClick={() => fileRef.current?.click()}>
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} {t.add}
        </Button>

        {hosted.length === 0 ? (
          <p className="text-xs text-gray-400 pt-1">{t.none}</p>
        ) : (
          <div className="space-y-1.5 pt-1">
            {hosted.map(r => (
              <div key={r.id} className="flex items-center gap-2 rounded-lg border border-gray-100 px-3 py-2">
                {r.kind === 'photos' ? <ImageIcon className="h-4 w-4 text-gray-400 shrink-0" /> : <FileText className="h-4 w-4 text-gray-400 shrink-0" />}
                <button type="button" onClick={() => openFile(r)} className="text-sm text-gray-800 truncate flex-1 text-left hover:text-primary">
                  {r.title || r.filename}
                </button>
                {r.language && <Badge variant="secondary" className="text-[10px] shrink-0">{r.language}</Badge>}
                <Badge variant="outline" className="text-[10px] shrink-0">{r.kind === 'photos' ? t.photos : t.release}</Badge>
                <button onClick={() => remove(r)} disabled={busy === r.id} className="text-gray-400 hover:text-red-600 p-1 shrink-0">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
