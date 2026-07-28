import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  RefreshCw, ArrowLeft, Mail, Plus, Trash2, Download, Eye, FileText, Image as ImageIcon,
  Upload, RotateCcw, ChevronUp, ChevronDown, Check, X, Loader2,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { Pill } from '@/components/sm26/SM26ConsoleUI';
import {
  REGISTERS, bodyParagraphs, complimentaryCloseFor, letterDateLong, salutationFor, subjectFor,
  SENDER_DEFAULT, SIGNATORY_DEFAULT, FOOTER_DEFAULT,
  type EventFacts, type Lang, type Register,
} from '@/lib/invitationTemplates';
import { downloadInvitationPdf, invitationPdfBlobUrl, toDataUrl, type LetterAssets, type LetterData } from '@/lib/invitationPdf';

// Official invitation letters for institutional guests (ambassadors, ministers).
// Fill the form, pick French or English, and the platform draws the M3
// letterhead PDF. Every letter is stored, so we know who was invited and can
// re-issue an identical copy months later.

interface Invitation {
  id: string;
  event_id: string;
  language: Lang;
  register: Register;
  recipient_name: string | null;
  recipient_role: string | null;
  recipient_org: string | null;
  address_block: string;
  salutation: string;
  letter_place: string;
  letter_date: string;
  subject: string;
  paragraphs: string[];
  complimentary_close: string;
  signatory_name: string;
  signatory_title: string;
  signatory_org: string;
  status: string;
  sent_at: string | null;
  notes: string | null;
  updated_at: string;
}

// Images plus the two bits of fixed text that belong to the company, not to a
// given letter: the sender block and the legal footer line.
type Letterhead = {
  banner?: string; logo?: string; signature?: string; stamp?: string;
  sender?: string; footer?: string;
};
type AssetSlot = 'banner' | 'logo' | 'signature' | 'stamp';
const ASSET_SLOTS: { key: AssetSlot; label: string; hint: string }[] = [
  { key: 'banner', label: 'Header strip', hint: 'The full-width banner across the top of the page.' },
  { key: 'logo', label: 'Sender logo', hint: 'Sits next to the M3 address block.' },
  { key: 'signature', label: 'Signature', hint: 'Drawn under the signatory’s name.' },
  { key: 'stamp', label: 'Company stamp', hint: 'Drawn beside the signature.' },
];

const statusMeta = (s: string) =>
  s === 'sent' ? { label: 'Sent', cls: 'bg-green-50 text-green-700 border-green-200' }
  : s === 'ready' ? { label: 'Ready to send', cls: 'bg-blue-50 text-blue-700 border-blue-200' }
  : { label: 'Draft', cls: 'bg-gray-50 text-gray-600 border-gray-200' };

const sameBody = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

export function AdminSM26Invitations() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [event, setEvent] = useState<EventFacts & { id: string } | null>(null);
  const [letterhead, setLetterhead] = useState<Letterhead>({});
  const [assets, setAssets] = useState<LetterAssets>({});
  const [rows, setRows] = useState<Invitation[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Invitation | null>(null);
  const [showAssets, setShowAssets] = useState(false);
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // ---- load ---------------------------------------------------------------
  const load = useCallback(async () => {
    setLoading(true);
    const { data: ev } = await supabase.from('sm_event')
      .select('id, name, venue, start_date, end_date, settings').eq('slug', 'sm26').maybeSingle();
    if (!ev) { setLoading(false); return; }
    const e = ev as { id: string; name: string; venue: string | null; start_date: string | null; end_date: string | null; settings: Record<string, unknown> | null };
    const settings = (e.settings || {}) as Record<string, unknown>;
    setEvent({
      id: e.id, name: e.name, venue: e.venue,
      startDate: e.start_date, endDate: e.end_date,
      editionLabel: typeof settings.edition_label === 'string' ? settings.edition_label : null,
    });
    const lh = (settings.letterhead || {}) as Letterhead;
    setLetterhead(lh);
    const { data: list } = await supabase.from('sm_invitation')
      .select('*').eq('event_id', e.id).order('updated_at', { ascending: false });
    setRows((list || []) as Invitation[]);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  // Sign the letterhead images once and keep them as data URLs for jsPDF.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Only the four image slots are storage paths; sender/footer are text.
      const paths = ASSET_SLOTS.map(s => [s.key, letterhead[s.key]] as const).filter(([, v]) => !!v) as [AssetSlot, string][];
      if (!paths.length) { setAssets({}); return; }
      const out: LetterAssets = {};
      for (const [k, p] of paths) {
        const { data } = await supabase.storage.from('event-media').createSignedUrl(p, 600);
        if (data?.signedUrl) out[k] = await toDataUrl(data.signedUrl);
      }
      if (!cancelled) setAssets(out);
    })();
    return () => { cancelled = true; };
  }, [letterhead]);

  const facts: EventFacts = event || { name: '', venue: null, startDate: null, endDate: null, editionLabel: null };

  // ---- create / edit ------------------------------------------------------
  const blank = (): Invitation => {
    const lang: Lang = 'fr';
    const register: Register = 'excellency';
    return {
      id: '', event_id: event?.id || '', language: lang, register,
      recipient_name: '', recipient_role: '', recipient_org: '',
      address_block: '', salutation: salutationFor(lang, register),
      letter_place: 'Monaco', letter_date: new Date().toISOString().slice(0, 10),
      subject: subjectFor(lang, facts),
      paragraphs: bodyParagraphs(lang, register, facts, { rsvpEmail: 'info@m3monaco.com' }),
      complimentary_close: complimentaryCloseFor(lang, register),
      signatory_name: SIGNATORY_DEFAULT.name, signatory_title: SIGNATORY_DEFAULT.title, signatory_org: SIGNATORY_DEFAULT.org,
      status: 'draft', sent_at: null, notes: '', updated_at: '',
    };
  };

  const openNew = () => { setDraft(blank()); setOpenId('new'); };
  const openRow = (r: Invitation) => { setDraft({ ...r }); setOpenId(r.id); };
  const close = () => { setDraft(null); setOpenId(null); };

  const set = <K extends keyof Invitation>(k: K, v: Invitation[K]) =>
    setDraft(d => (d ? { ...d, [k]: v } : d));

  /** Standard body for the draft's current language + register. */
  const templateBody = (d: Invitation) => bodyParagraphs(d.language, d.register, facts, {});

  // Changing language (or register) rewrites the standard wording — but only
  // when the body is still untouched, so a bespoke letter is never destroyed.
  const switchLanguage = (lang: Lang) => {
    setDraft(d => {
      if (!d) return d;
      const wasTemplate = sameBody(d.paragraphs, templateBody(d));
      const next: Invitation = { ...d, language: lang };
      next.salutation = salutationFor(lang, d.register);
      next.complimentary_close = complimentaryCloseFor(lang, d.register);
      next.subject = subjectFor(lang, facts);
      if (wasTemplate) next.paragraphs = bodyParagraphs(lang, d.register, facts, {});
      return next;
    });
  };
  const switchRegister = (register: Register) => {
    setDraft(d => {
      if (!d) return d;
      const wasTemplate = sameBody(d.paragraphs, templateBody(d));
      const next: Invitation = { ...d, register };
      next.salutation = salutationFor(d.language, register);
      next.complimentary_close = complimentaryCloseFor(d.language, register);
      if (wasTemplate) next.paragraphs = bodyParagraphs(d.language, register, facts, {});
      return next;
    });
  };
  const reloadTemplate = () => {
    if (!draft) return;
    if (!confirm('Replace the body with the standard wording? Anything you typed in the paragraphs is lost.')) return;
    setDraft(d => (d ? {
      ...d,
      subject: subjectFor(d.language, facts),
      salutation: salutationFor(d.language, d.register),
      paragraphs: bodyParagraphs(d.language, d.register, facts, {}),
      complimentary_close: complimentaryCloseFor(d.language, d.register),
    } : d));
  };

  const setPara = (i: number, v: string) =>
    setDraft(d => (d ? { ...d, paragraphs: d.paragraphs.map((p, j) => (j === i ? v : p)) } : d));
  const addPara = (at: number) =>
    setDraft(d => (d ? { ...d, paragraphs: [...d.paragraphs.slice(0, at), '', ...d.paragraphs.slice(at)] } : d));
  const removePara = (i: number) =>
    setDraft(d => (d ? { ...d, paragraphs: d.paragraphs.filter((_, j) => j !== i) } : d));
  const movePara = (i: number, dir: -1 | 1) =>
    setDraft(d => {
      if (!d) return d;
      const j = i + dir;
      if (j < 0 || j >= d.paragraphs.length) return d;
      const p = [...d.paragraphs];
      [p[i], p[j]] = [p[j], p[i]];
      return { ...d, paragraphs: p };
    });

  // ---- persist ------------------------------------------------------------
  const save = async (): Promise<string | null> => {
    if (!draft || !event) return null;
    const payload = {
      event_id: event.id,
      language: draft.language, register: draft.register,
      recipient_name: draft.recipient_name || null,
      recipient_role: draft.recipient_role || null,
      recipient_org: draft.recipient_org || null,
      address_block: draft.address_block,
      salutation: draft.salutation,
      letter_place: draft.letter_place,
      letter_date: draft.letter_date,
      subject: draft.subject,
      paragraphs: draft.paragraphs,
      complimentary_close: draft.complimentary_close,
      signatory_name: draft.signatory_name,
      signatory_title: draft.signatory_title,
      signatory_org: draft.signatory_org,
      status: draft.status,
      sent_at: draft.status === 'sent' ? (draft.sent_at || new Date().toISOString()) : null,
      notes: draft.notes || null,
    };
    setBusy('save');
    const q = draft.id
      ? supabase.from('sm_invitation').update(payload).eq('id', draft.id).select('id').single()
      : supabase.from('sm_invitation').insert(payload).select('id').single();
    const { data, error } = await q;
    setBusy(null);
    if (error) { toast({ title: 'Could not save', description: error.message, variant: 'destructive' }); return null; }
    const id = (data as { id: string }).id;
    toast({ title: draft.id ? 'Invitation saved' : 'Invitation created' });
    await load();
    setDraft(d => (d ? { ...d, id } : d));
    setOpenId(id);
    return id;
  };

  const remove = async (r: Invitation) => {
    if (!confirm(`Delete the invitation for ${r.recipient_name || 'this recipient'}? This cannot be undone.`)) return;
    setBusy(`del:${r.id}`);
    const { error } = await supabase.from('sm_invitation').delete().eq('id', r.id);
    setBusy(null);
    if (error) { toast({ title: 'Could not delete', description: error.message, variant: 'destructive' }); return; }
    if (openId === r.id) close();
    load();
  };

  // ---- letterhead assets --------------------------------------------------
  /** Persist the whole letterhead object (images + sender + footer). */
  const saveLetterhead = async (next: Letterhead, note?: string) => {
    if (!event) return false;
    const { error } = await supabase.rpc('sm_set_letterhead', { p_event_id: event.id, p_letterhead: next });
    if (error) { toast({ title: 'Could not save the letterhead', description: error.message, variant: 'destructive' }); return false; }
    setLetterhead(next);
    if (note) toast({ title: note });
    return true;
  };

  const uploadAsset = async (slot: AssetSlot, file: File) => {
    if (!event) return;
    setBusy(`asset:${slot}`);
    const ext = (file.name.split('.').pop() || 'png').toLowerCase();
    const path = `letterhead/sm26/${slot}-${Date.now()}.${ext}`;
    const up = await supabase.storage.from('event-media').upload(path, file, { upsert: true, contentType: file.type || undefined });
    if (up.error) { setBusy(null); toast({ title: 'Upload failed', description: up.error.message, variant: 'destructive' }); return; }
    await saveLetterhead({ ...letterhead, [slot]: path }, 'Letterhead updated');
    setBusy(null);
  };
  const clearAsset = async (slot: AssetSlot) => {
    const next = { ...letterhead };
    delete next[slot];
    setBusy(`asset:${slot}`);
    await saveLetterhead(next);
    setBusy(null);
  };

  // ---- render the PDF -----------------------------------------------------
  const letterData = (d: Invitation): LetterData => ({
    senderLines: (letterhead.sender || SENDER_DEFAULT.join('\n')).split(/\r?\n/),
    addressBlock: d.address_block,
    place: d.letter_place,
    dateLine: letterDateLong(d.language, d.letter_date),
    subjectLabel: d.language === 'fr' ? 'Objet' : 'Subject',
    subject: d.subject,
    salutation: d.salutation,
    paragraphs: d.paragraphs,
    complimentaryClose: d.complimentary_close,
    signatoryName: d.signatory_name,
    signatoryTitle: d.signatory_title,
    signatoryOrg: d.signatory_org,
    footer: letterhead.footer ?? FOOTER_DEFAULT,
  });

  const preview = async (d: Invitation) => {
    setBusy('preview');
    try {
      const url = await invitationPdfBlobUrl(letterData(d), assets);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      toast({ title: 'Could not build the preview', description: String((e as Error).message || e), variant: 'destructive' });
    } finally { setBusy(null); }
  };
  const download = async (d: Invitation) => {
    setBusy('pdf');
    try {
      const who = d.recipient_name || d.recipient_org || 'invitation';
      await downloadInvitationPdf(letterData(d), assets, `invitation-sm26-${who}`);
    } catch (e) {
      toast({ title: 'Could not build the PDF', description: String((e as Error).message || e), variant: 'destructive' });
    } finally { setBusy(null); }
  };

  const missingAssets = useMemo(() => ASSET_SLOTS.filter(s => !letterhead[s.key]).map(s => s.label), [letterhead]);

  if (loading) return <div className="flex items-center justify-center h-64"><RefreshCw className="h-8 w-8 animate-spin text-gray-400" /></div>;

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={() => navigate('/admin/sm26')} className="gap-1.5"><ArrowLeft className="h-4 w-4" /> Back to registrations</Button>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Mail className="h-6 w-6 text-primary" /> Official invitations</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" className="h-9 w-9" onClick={load} title="Refresh"><RefreshCw className="h-4 w-4" /></Button>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setShowAssets(o => !o)}><ImageIcon className="h-4 w-4" /> Letterhead</Button>
          <Button size="sm" className="gap-1.5" onClick={openNew}><Plus className="h-4 w-4" /> New invitation</Button>
        </div>
      </div>

      <p className="text-sm text-gray-500 -mt-1 max-w-3xl">
        Fill the form, choose French or English, and the platform draws the letter on the M3 letterhead.
        The standard wording is loaded for you — edit any paragraph, and add your own where the letter needs to be personal.
      </p>

      {missingAssets.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          The letter will print without {missingAssets.join(', ').toLowerCase()} until you upload {missingAssets.length > 1 ? 'them' : 'it'} under <b>Letterhead</b>.
          Everything else already works.
        </div>
      )}

      {/* ---- letterhead assets ---- */}
      {showAssets && (
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><ImageIcon className="h-4 w-4 text-primary" /> Letterhead</CardTitle>
            <p className="text-xs text-gray-500">Uploaded once and reused by every letter. Swap an image here and all future letters follow — no code change.</p>
          </CardHeader>
          <CardContent className="grid sm:grid-cols-2 gap-3">
            {ASSET_SLOTS.map(s => (
              <div key={s.key} className="rounded-lg border border-gray-200 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{s.label}</div>
                    <div className="text-[11px] text-gray-400">{s.hint}</div>
                  </div>
                  {letterhead[s.key]
                    ? <Pill label="uploaded" cls="bg-green-50 text-green-700 border-green-200" />
                    : <Pill label="missing" cls="bg-amber-50 text-amber-700 border-amber-200" />}
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <input ref={el => { fileRefs.current[s.key] = el; }} type="file" accept="image/*" className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; e.currentTarget.value = ''; if (f) uploadAsset(s.key, f); }} />
                  <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" disabled={busy === `asset:${s.key}`}
                    onClick={() => fileRefs.current[s.key]?.click()}>
                    {busy === `asset:${s.key}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                    {letterhead[s.key] ? 'Replace' : 'Upload'}
                  </Button>
                  {letterhead[s.key] && (
                    <Button size="sm" variant="ghost" className="h-8 text-xs text-gray-400 hover:text-red-600" onClick={() => clearAsset(s.key)}>Remove</Button>
                  )}
                  {assets[s.key] && <img src={assets[s.key] as string} alt="" className="h-8 ml-auto object-contain rounded border border-gray-100" />}
                </div>
              </div>
            ))}

            <div className="sm:col-span-2 grid sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-gray-500">Sender block — one line per line</Label>
                <Textarea rows={4} className="mt-1 text-xs font-mono"
                  value={letterhead.sender ?? SENDER_DEFAULT.join('\n')}
                  onChange={e => setLetterhead(l => ({ ...l, sender: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs text-gray-500">Legal footer — printed small at the bottom of every page</Label>
                <Textarea rows={4} className="mt-1 text-xs"
                  value={letterhead.footer ?? FOOTER_DEFAULT}
                  onChange={e => setLetterhead(l => ({ ...l, footer: e.target.value }))}
                  placeholder="M3 S.A.M. — Monte Carlo Palace, 3/7 Boulevard des Moulins — 98 000 Monaco — R.C.I. … — N.I.S. …" />
                <p className="text-[11px] text-gray-400 mt-1">
                  Copy the exact line from your existing letterhead, including the R.C.I. and N.I.S. numbers.
                </p>
              </div>
              <div className="sm:col-span-2 flex justify-end">
                <Button size="sm" className="gap-1.5" disabled={busy === 'lh'}
                  onClick={async () => { setBusy('lh'); await saveLetterhead(letterhead, 'Letterhead saved'); setBusy(null); }}>
                  {busy === 'lh' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save sender &amp; footer
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ---- editor ---- */}
      {draft && (
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" />
                {draft.id ? 'Edit invitation' : 'New invitation'}
              </CardTitle>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="ghost" onClick={close}>Close</Button>
                <Button size="sm" variant="outline" className="gap-1.5" disabled={!!busy} onClick={() => preview(draft)}><Eye className="h-4 w-4" /> Preview</Button>
                <Button size="sm" variant="outline" className="gap-1.5" disabled={!!busy} onClick={() => download(draft)}><Download className="h-4 w-4" /> PDF</Button>
                <Button size="sm" className="gap-1.5" disabled={busy === 'save'} onClick={save}>
                  {busy === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* language + register + status */}
            <div className="grid sm:grid-cols-3 gap-3">
              <div>
                <Label className="text-xs text-gray-500">Language</Label>
                <div className="flex rounded-lg border border-gray-200 overflow-hidden mt-1 w-fit">
                  {(['fr', 'en'] as Lang[]).map(l => (
                    <button key={l} type="button" onClick={() => switchLanguage(l)}
                      className={`px-4 h-9 text-sm ${draft.language === l ? 'bg-primary text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                      {l === 'fr' ? 'Français' : 'English'}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <Label className="text-xs text-gray-500">Form of address</Label>
                <Select value={draft.register} onValueChange={v => switchRegister(v as Register)}>
                  <SelectTrigger className="h-9 mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {REGISTERS.map(r => <SelectItem key={r.key} value={r.key}>{draft.language === 'fr' ? r.fr : r.en}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-gray-500">Status</Label>
                <Select value={draft.status} onValueChange={v => set('status', v)}>
                  <SelectTrigger className="h-9 mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="ready">Ready to send</SelectItem>
                    <SelectItem value="sent">Sent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* recipient */}
            <div className="grid sm:grid-cols-3 gap-3">
              <div><Label className="text-xs text-gray-500">Recipient name</Label>
                <Input className="h-9 mt-1" value={draft.recipient_name || ''} onChange={e => set('recipient_name', e.target.value)} placeholder="Dr. Tarek Dahroug" /></div>
              <div><Label className="text-xs text-gray-500">Title / role</Label>
                <Input className="h-9 mt-1" value={draft.recipient_role || ''} onChange={e => set('recipient_role', e.target.value)} placeholder="Ambassador" /></div>
              <div><Label className="text-xs text-gray-500">Organisation</Label>
                <Input className="h-9 mt-1" value={draft.recipient_org || ''} onChange={e => set('recipient_org', e.target.value)} placeholder="Embassy of Egypt in France" /></div>
            </div>

            <div>
              <Label className="text-xs text-gray-500">Address block — printed as typed, one line per line</Label>
              <Textarea rows={5} className="mt-1 font-mono text-xs" value={draft.address_block} onChange={e => set('address_block', e.target.value)}
                placeholder={'À Son Excellence\nMonsieur l’Ambassadeur de la\nRépublique Arabe d’Égypte\nDr. Tarek Dahroug\nAmbassade d’Égypte en France\n56 Avenue d’Iéna, 75 116 Paris'} />
            </div>

            <div className="grid sm:grid-cols-3 gap-3">
              <div><Label className="text-xs text-gray-500">Place</Label>
                <Input className="h-9 mt-1" value={draft.letter_place} onChange={e => set('letter_place', e.target.value)} /></div>
              <div><Label className="text-xs text-gray-500">Date</Label>
                <Input type="date" className="h-9 mt-1" value={draft.letter_date} onChange={e => set('letter_date', e.target.value)} /></div>
              <div><Label className="text-xs text-gray-500">Salutation</Label>
                <Input className="h-9 mt-1" value={draft.salutation} onChange={e => set('salutation', e.target.value)} /></div>
            </div>

            <div>
              <Label className="text-xs text-gray-500">Subject</Label>
              <Input className="h-9 mt-1" value={draft.subject} onChange={e => set('subject', e.target.value)} />
            </div>

            {/* body */}
            <div>
              <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
                <Label className="text-xs text-gray-500">
                  Body — wrap text in **double asterisks** to print it in bold
                </Label>
                <Button size="sm" variant="ghost" className="h-7 text-xs gap-1.5 text-gray-500" onClick={reloadTemplate}>
                  <RotateCcw className="h-3.5 w-3.5" /> Reload the {draft.language === 'fr' ? 'French' : 'English'} template
                </Button>
              </div>
              <div className="space-y-2">
                {draft.paragraphs.map((p, i) => (
                  <div key={i} className="flex gap-2">
                    <Textarea rows={3} className="text-sm" value={p} onChange={e => setPara(i, e.target.value)}
                      placeholder="Write a paragraph specific to this guest…" />
                    <div className="flex flex-col gap-1 shrink-0">
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-gray-300 hover:text-gray-700" title="Move up" onClick={() => movePara(i, -1)}><ChevronUp className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-gray-300 hover:text-gray-700" title="Move down" onClick={() => movePara(i, 1)}><ChevronDown className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-gray-300 hover:text-red-600" title="Remove" onClick={() => removePara(i)}><Trash2 className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-gray-300 hover:text-primary" title="Add a paragraph below" onClick={() => addPara(i + 1)}><Plus className="h-4 w-4" /></Button>
                    </div>
                  </div>
                ))}
                {draft.paragraphs.length === 0 && (
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={() => addPara(0)}><Plus className="h-4 w-4" /> Add a paragraph</Button>
                )}
              </div>
            </div>

            <div>
              <Label className="text-xs text-gray-500">Complimentary close</Label>
              <Textarea rows={2} className="mt-1 text-sm" value={draft.complimentary_close} onChange={e => set('complimentary_close', e.target.value)} />
            </div>

            <div className="grid sm:grid-cols-3 gap-3">
              <div><Label className="text-xs text-gray-500">Signatory</Label>
                <Input className="h-9 mt-1" value={draft.signatory_name} onChange={e => set('signatory_name', e.target.value)} /></div>
              <div><Label className="text-xs text-gray-500">Title</Label>
                <Input className="h-9 mt-1" value={draft.signatory_title} onChange={e => set('signatory_title', e.target.value)} /></div>
              <div><Label className="text-xs text-gray-500">Company</Label>
                <Input className="h-9 mt-1" value={draft.signatory_org} onChange={e => set('signatory_org', e.target.value)} /></div>
            </div>

            <div>
              <Label className="text-xs text-gray-500">Internal note — never printed</Label>
              <Input className="h-9 mt-1" value={draft.notes || ''} onChange={e => set('notes', e.target.value)} placeholder="Hand-delivered by the Embassy, follow up on 5 Sep…" />
            </div>
          </CardContent>
        </Card>
      )}

      {/* ---- list ---- */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <div className="py-12 text-center text-gray-400 text-sm">
              No invitation yet. Click <b>New invitation</b> — the French letter is pre-written, you only add the recipient.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
                  <th className="px-4 py-2">Recipient</th><th className="px-4 py-2">Language</th>
                  <th className="px-4 py-2">Date</th><th className="px-4 py-2">Status</th><th className="px-4 py-2" />
                </tr></thead>
                <tbody>
                  {rows.map(r => {
                    const m = statusMeta(r.status);
                    return (
                      <tr key={r.id} className={`border-b border-gray-50 hover:bg-gray-50 ${openId === r.id ? 'bg-primary/5' : ''}`}>
                        <td className="px-4 py-2.5 cursor-pointer" onClick={() => openRow(r)}>
                          <div className="font-medium">{r.recipient_name || '—'}</div>
                          <div className="text-xs text-gray-400">{[r.recipient_role, r.recipient_org].filter(Boolean).join(' · ') || r.subject}</div>
                        </td>
                        <td className="px-4 py-2.5"><Pill label={r.language.toUpperCase()} cls="bg-gray-50 text-gray-600 border-gray-200" /></td>
                        <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap">{r.letter_date}</td>
                        <td className="px-4 py-2.5"><Pill label={m.label} cls={m.cls} /></td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center justify-end gap-1">
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-gray-400 hover:text-primary" title="Download the PDF"
                              disabled={!!busy} onClick={() => download(r)}><Download className="h-4 w-4" /></Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-gray-400 hover:text-red-600" title="Delete"
                              disabled={busy === `del:${r.id}`} onClick={() => remove(r)}><X className="h-4 w-4" /></Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
