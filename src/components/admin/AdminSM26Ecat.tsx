import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  RefreshCw, ArrowLeft, BookOpen, Upload, FileText, ExternalLink, CheckCircle, Loader2, Send,
  CreditCard, MessageSquare, Eye, EyeOff, LayoutGrid, ListChecks, Palette, Plus, Trash2,
  Image as ImageIcon, Download,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';

// Admin e-catalogue console. Each marina & startup gets a catalogue page; this
// drives it through: prepare → send to designer → design → participant review →
// publish (gated on payment). The board view shows where every page sits; the
// "Browse published" view shows the catalogue as attendees will see it.

export const ECAT_STATUS_LABEL: Record<string, string> = {
  awaiting_export: 'To prepare',
  exported: 'Sent to designer',
  in_design: 'Designing',
  uploaded: 'Awaiting review',
  changes_requested: 'Changes requested',
  approved: 'Approved',
  published: 'Published',
};
export function ecatStatusClass(s: string): string {
  switch (s) {
    case 'published': return 'bg-green-50 text-green-700 border-green-200';
    case 'approved': return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'changes_requested': return 'bg-red-50 text-red-700 border-red-200';
    case 'uploaded': return 'bg-blue-50 text-blue-700 border-blue-200';
    case 'in_design': return 'bg-violet-50 text-violet-700 border-violet-200';
    case 'exported': return 'bg-amber-50 text-amber-700 border-amber-200';
    default: return 'bg-gray-50 text-gray-600 border-gray-200';
  }
}
const payClass = (s?: string) =>
  s === 'paid' ? 'bg-green-50 text-green-700 border-green-200'
  : s === 'invoiced' ? 'bg-amber-50 text-amber-700 border-amber-200'
  : 'bg-gray-100 text-gray-500 border-gray-200';

// The pipeline, in order. changes_requested folds back into "Designing".
const PIPELINE = [
  { key: 'awaiting_export', short: 'Prepare', statuses: ['awaiting_export'] },
  { key: 'exported', short: 'To designer', statuses: ['exported'] },
  { key: 'in_design', short: 'Designing', statuses: ['in_design', 'changes_requested'] },
  { key: 'uploaded', short: 'Review', statuses: ['uploaded'] },
  { key: 'approved', short: 'Approved', statuses: ['approved'] },
  { key: 'published', short: 'Published', statuses: ['published'] },
];
const stageIndexOf = (status: string) => Math.max(0, PIPELINE.findIndex(s => s.statuses.includes(status)));

interface Payment { status: string; amount_cents: number | null; paid_at: string | null; invoice_ref: string | null; }
interface Reg { id: string; company_name: string | null; first_name: string | null; last_name: string | null; user_id: string | null; payment?: Payment | Payment[]; }
interface Page {
  id: string; event_id: string; registration_id: string; kind: string; status: string;
  designed_file_path: string | null; published_file_path: string | null;
  registration: Reg;
}
interface Comment { id: string; ecat_page_id: string; author_role: string | null; body: string; created_at: string; }
interface ChangeImg { path: string; url: string | null; filename: string; is_image: boolean }
interface Addable { role_assignment_id: string; role: string; name: string; }

const firstOf = <T,>(x: T | T[] | undefined): T | undefined => Array.isArray(x) ? x[0] : x;

// Compact horizontal stage indicator for one page.
function MiniPipeline({ status }: { status: string }) {
  const current = stageIndexOf(status);
  const changes = status === 'changes_requested';
  return (
    <div className="flex items-center gap-1">
      {PIPELINE.map((s, i) => {
        const done = i < current;
        const isCurrent = i === current;
        return (
          <div key={s.key} className="flex items-center gap-1">
            <div className={`h-1.5 w-1.5 rounded-full ${done ? 'bg-primary' : isCurrent ? (changes ? 'bg-red-500' : 'bg-primary ring-2 ring-primary/20') : 'bg-gray-200'}`} />
            {i < PIPELINE.length - 1 && <div className={`h-px w-4 ${i < current ? 'bg-primary' : 'bg-gray-200'}`} />}
          </div>
        );
      })}
      <span className="text-[11px] text-gray-400 ml-1">{PIPELINE[current].short}</span>
    </div>
  );
}

export function AdminSM26Ecat() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [eventId, setEventId] = useState<string | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [comments, setComments] = useState<Record<string, Comment[]>>({});
  const [changeImgs, setChangeImgs] = useState<Record<string, ChangeImg[]>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('all');
  const [view, setView] = useState<'board' | 'browse'>('board');
  const [preview, setPreview] = useState<{ id: string; url: string } | null>(null);
  const [browseUrls, setBrowseUrls] = useState<Record<string, string>>({});
  const [addable, setAddable] = useState<Addable[]>([]);
  const [addSel, setAddSel] = useState('');
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    const { data: ev } = await supabase.from('sm_event').select('id').eq('slug', 'sm26').maybeSingle();
    if (!ev) { setLoading(false); return; }
    const eid = (ev as { id: string }).id;
    setEventId(eid);
    await supabase.rpc('sm_ecat_ensure_pages', { p_event_id: eid }); // backfill missing pages
    const { data } = await supabase
      .from('sm_ecat_page')
      .select('*, registration:sm_registration(id,company_name,first_name,last_name,user_id,status, payment:sm_payment(status,amount_cents,paid_at,invoice_ref))')
      .eq('event_id', eid)
      .order('created_at', { ascending: true });
    // Declined registrations never appear in the catalogue.
    const pgs = ((data || []) as Page[]).filter(p => (p.registration as { status?: string })?.status !== 'declined');
    setPages(pgs);
    if (pgs.length) {
      const { data: cms } = await supabase.from('sm_ecat_comment').select('*').in('ecat_page_id', pgs.map(p => p.id)).order('created_at', { ascending: true });
      const byPage: Record<string, Comment[]> = {};
      for (const c of (cms || []) as Comment[]) (byPage[c.ecat_page_id] ||= []).push(c);
      setComments(byPage);
    }
    // Sign any reference images participants attached to change requests.
    if (pgs.some(p => p.status === 'changes_requested')) {
      const { data: ci } = await supabase.functions.invoke('sm26-ecat-change-files', { body: { event_id: eid } });
      setChangeImgs(((ci as { byPage?: Record<string, ChangeImg[]> } | null)?.byPage) || {});
    }
    const { data: add } = await supabase.rpc('sm_ecat_addable', { p_event_id: eid });
    setAddable((add || []) as Addable[]);
    setLoading(false);
  };

  const title = (p: Page) => {
    const r = p.registration;
    return r.company_name || `${r.first_name || ''} ${r.last_name || ''}`.trim() || 'Entry';
  };

  // The signed URLs live on the Supabase origin; the HTML download attribute is
  // ignored cross-origin, so fetch to a blob and download that.
  const downloadChangeImg = async (img: ChangeImg) => {
    if (!img.url) return;
    try {
      const b = await (await fetch(img.url)).blob();
      const o = URL.createObjectURL(b);
      const a = document.createElement('a'); a.href = o; a.download = img.filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(o), 1500);
    } catch { window.open(img.url, '_blank'); }
  };

  const patch = async (p: Page, fields: Record<string, unknown>) => {
    setBusy(p.id);
    const { error } = await supabase.from('sm_ecat_page').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', p.id);
    setBusy(null);
    if (error) { toast({ title: 'Update failed', description: error.message, variant: 'destructive' }); return false; }
    setPages(prev => prev.map(x => x.id === p.id ? { ...x, ...fields } as Page : x));
    return true;
  };

  // Send a page to the designer + email the Yacht Club designer(s) that there
  // are pages waiting to be designed.
  const sendToDesigner = async (p: Page) => {
    const ok = await patch(p, { status: 'exported' });
    if (!ok) return;
    void supabase.functions.invoke('sm26-ecat-designer', { body: { registration_id: p.registration_id } }).catch(() => {});
    toast({ title: 'Sent to the designer', description: 'The Yacht Club has been emailed that a page is ready to design.' });
  };

  const uploadDesigned = async (p: Page, file: File) => {
    if (!user) return;
    setBusy(p.id);
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `${user.id}/ecat/${p.id}/${safe}`;
    const { error } = await supabase.storage.from('event-media').upload(path, file, { upsert: true });
    if (error) { setBusy(null); toast({ title: 'Upload failed', description: error.message, variant: 'destructive' }); return; }
    setBusy(null);
    await patch(p, { designed_file_path: path, status: 'uploaded' });
    void supabase.functions.invoke('sm26-email', { body: { registration_id: p.registration_id, kind: 'ecat_review' } }).catch(() => {});
    toast({ title: 'Designed page uploaded — participant can now review' });
  };

  const publish = async (p: Page, canPublish: boolean) => {
    if (!canPublish) { toast({ title: 'Awaiting payment', description: 'This entry must be marked paid before publishing.', variant: 'destructive' }); return; }
    const ok = await patch(p, { status: 'published', published_file_path: p.designed_file_path, published_at: new Date().toISOString() });
    if (ok) {
      toast({ title: 'E-catalogue page published' });
      void supabase.functions.invoke('sm26-email', { body: { registration_id: p.registration_id, kind: 'ecat_published' } }).catch(() => {});
    }
  };

  const setPayment = async (p: Page, status: string) => {
    if (!eventId) return;
    setBusy(p.id);
    const { error } = await supabase.from('sm_payment').upsert({
      registration_id: p.registration_id, event_id: eventId, status,
      paid_at: status === 'paid' ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'registration_id' });
    setBusy(null);
    if (error) { toast({ title: 'Could not update payment', description: error.message, variant: 'destructive' }); return; }
    setPages(prev => prev.map(x => x.id === p.id ? { ...x, registration: { ...x.registration, payment: { status, amount_cents: null, paid_at: null, invoice_ref: null } } } : x));
  };

  const addPage = async () => {
    if (!addSel) return;
    setBusy('add');
    const { error } = await supabase.rpc('sm_ecat_add_page', { p_role_assignment_id: addSel });
    setBusy(null);
    if (error) { toast({ title: 'Could not add', description: error.message, variant: 'destructive' }); return; }
    setAddSel('');
    toast({ title: 'Added to the e-catalogue' });
    load();
  };

  const removePage = async (p: Page) => {
    if (!confirm(`Remove ${title(p)} from the e-catalogue?`)) return;
    setBusy(p.id);
    const { error } = await supabase.rpc('sm_ecat_remove_page', { p_page_id: p.id });
    setBusy(null);
    if (error) { toast({ title: 'Could not remove', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Removed from the e-catalogue' });
    load();
  };

  const signedUrl = async (path: string) => {
    const { data } = await supabase.storage.from('event-media').createSignedUrl(path, 600);
    return data?.signedUrl || null;
  };

  const viewFile = async (path: string) => {
    const url = await signedUrl(path);
    if (!url) { toast({ title: 'Could not open file', variant: 'destructive' }); return; }
    window.open(url, '_blank');
  };

  const togglePreview = async (p: Page) => {
    const path = p.designed_file_path || p.published_file_path;
    if (!path) return;
    if (preview?.id === p.id) { setPreview(null); return; }
    const url = await signedUrl(path);
    if (url) setPreview({ id: p.id, url });
  };

  // Remove a wrongly-uploaded designed page: clear the file + back to "Designing".
  const removeDesigned = async (p: Page) => {
    if (!window.confirm('Remove the uploaded designed page? This clears the file and returns the page to “Designing” so the right one can be uploaded.')) return;
    const oldPath = p.designed_file_path;
    const ok = await patch(p, { designed_file_path: null, status: 'in_design' });
    if (!ok) return;
    if (oldPath) supabase.storage.from('event-media').remove([oldPath]).catch(() => {});
    if (preview?.id === p.id) setPreview(null);
    toast({ title: 'File removed', description: 'The page is back to “Designing”.' });
  };

  // Load signed URLs for all published pages when entering Browse view.
  const enterBrowse = async () => {
    setView('browse');
    const pub = pages.filter(p => p.status === 'published' && (p.published_file_path || p.designed_file_path));
    const entries = await Promise.all(pub.map(async p => [p.id, await signedUrl((p.published_file_path || p.designed_file_path)!)] as const));
    setBrowseUrls(Object.fromEntries(entries.filter(([, u]) => u) as [string, string][]));
  };

  if (loading) return <div className="flex items-center justify-center h-64"><RefreshCw className="h-8 w-8 animate-spin text-gray-400" /></div>;

  // Pipeline summary counts
  const counts = (statuses: string[]) => pages.filter(p => statuses.includes(p.status)).length;
  const publishedCount = counts(['published']);
  const filtered = filter === 'all' ? pages : pages.filter(p => (PIPELINE.find(s => s.key === filter)?.statuses || []).includes(p.status));

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={() => navigate('/admin/sm26')} className="gap-1.5"><ArrowLeft className="h-4 w-4" /> Back to registrations</Button>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><BookOpen className="h-6 w-6 text-primary" /> E-catalogue ({pages.length})</h1>
          <p className="text-sm text-gray-500 mt-0.5">Each marina &amp; startup gets a designed catalogue page. Move it through prepare → design → the participant's review → publish (after payment).</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => load()} title="Refresh"><RefreshCw className="h-4 w-4" /></Button>
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            <button onClick={() => setView('board')} className={`px-3 h-9 text-sm flex items-center gap-1.5 ${view === 'board' ? 'bg-primary text-white' : 'bg-white text-gray-600'}`}><ListChecks className="h-4 w-4" /> Board</button>
            <button onClick={enterBrowse} className={`px-3 h-9 text-sm flex items-center gap-1.5 ${view === 'browse' ? 'bg-primary text-white' : 'bg-white text-gray-600'}`}><LayoutGrid className="h-4 w-4" /> Browse published ({publishedCount})</button>
          </div>
        </div>
      </div>

      {addable.length > 0 && (
        <Card className="border-0 shadow-sm">
          <CardContent className="p-3 flex items-center gap-2 flex-wrap">
            <span className="text-sm text-gray-600 inline-flex items-center gap-1.5"><Plus className="h-4 w-4 text-primary" /> Add a sponsor or speaker to the e-catalogue</span>
            <Select value={addSel} onValueChange={setAddSel}>
              <SelectTrigger className="w-64 h-8 text-xs"><SelectValue placeholder="Choose an entry…" /></SelectTrigger>
              <SelectContent>{addable.map(a => <SelectItem key={a.role_assignment_id} value={a.role_assignment_id}>{a.name} · {a.role}</SelectItem>)}</SelectContent>
            </Select>
            <Button size="sm" disabled={!addSel || busy === 'add'} onClick={addPage}>{busy === 'add' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add page'}</Button>
          </CardContent>
        </Card>
      )}

      {pages.length === 0 ? (
        <Card className="border-0 shadow-sm"><CardContent className="py-12 text-center text-gray-400">No marina or startup entries yet — e-catalogue pages are created automatically for them.</CardContent></Card>
      ) : view === 'browse' ? (
        /* ---- Browse published catalogue ---- */
        publishedCount === 0 ? (
          <Card className="border-0 shadow-sm"><CardContent className="py-12 text-center text-gray-400">Nothing published yet. Publish approved pages from the Board.</CardContent></Card>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {pages.filter(p => p.status === 'published').map(p => (
              <Card key={p.id} className="border-0 shadow-sm overflow-hidden">
                <div className="aspect-[3/4] bg-gray-50 border-b border-gray-100">
                  {browseUrls[p.id]
                    ? <iframe title={title(p)} src={browseUrls[p.id]} className="w-full h-full" />
                    : <div className="w-full h-full flex items-center justify-center text-gray-300"><Loader2 className="h-5 w-5 animate-spin" /></div>}
                </div>
                <CardContent className="p-3 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-gray-900 truncate">{title(p)}</div>
                    <Badge variant="outline" className="text-[10px] capitalize mt-0.5">{p.kind}</Badge>
                  </div>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-primary shrink-0" onClick={() => viewFile((p.published_file_path || p.designed_file_path)!)} title="Open full page"><ExternalLink className="h-4 w-4" /></Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )
      ) : (
        /* ---- Board ---- */
        <>
          {/* Pipeline summary — click to filter */}
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => setFilter('all')} className={`text-xs px-2.5 py-1 rounded-full border transition-all ${filter === 'all' ? 'bg-primary text-white border-primary' : 'bg-white text-gray-600 border-gray-200 hover:border-primary/40'}`}>
              All · {pages.length}
            </button>
            {PIPELINE.map(s => {
              const n = counts(s.statuses);
              return (
                <button key={s.key} onClick={() => setFilter(filter === s.key ? 'all' : s.key)} disabled={n === 0}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-all disabled:opacity-40 ${filter === s.key ? 'ring-2 ring-primary/30' : ''} ${ecatStatusClass(s.statuses[0])}`}>
                  {s.short} · {n}
                </button>
              );
            })}
          </div>

          <div className="space-y-2">
            {filtered.map(p => {
              const pay = firstOf(p.registration.payment);
              const paid = pay?.status === 'paid';
              // Only the fee-paying catalogue roles (startup/marina, via sm_payment)
              // are payment-gated for publishing. Architecture (free entry),
              // speakers, sponsors (billed in the sp_* system) etc. publish freely.
              const publishable = paid || !['startup', 'marina'].includes(p.kind);
              const isBusy = busy === p.id;
              const pageComments = comments[p.id] || [];
              const canUpload = ['exported', 'in_design', 'changes_requested', 'uploaded'].includes(p.status);
              return (
                <Card key={p.id} className="border-0 shadow-sm">
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-gray-900">{title(p)}</span>
                          <Badge variant="outline" className="text-[10px] capitalize">{p.kind}</Badge>
                          <Badge className={`text-[10px] ${ecatStatusClass(p.status)}`}>{ECAT_STATUS_LABEL[p.status] || p.status}</Badge>
                        </div>
                        <MiniPipeline status={p.status} />
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge className={`text-[10px] ${payClass(pay?.status)}`}><CreditCard className="h-3 w-3 mr-1" />{pay?.status || 'unpaid'}</Badge>
                        <Select value={pay?.status || 'unpaid'} onValueChange={v => setPayment(p, v)} disabled={isBusy}>
                          <SelectTrigger className="w-28 h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="unpaid">Unpaid</SelectItem>
                            <SelectItem value="invoiced">Invoiced</SelectItem>
                            <SelectItem value="paid">Paid</SelectItem>
                            <SelectItem value="waived">Waived</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    {/* Change-request comments from the participant */}
                    {p.status === 'changes_requested' && pageComments.length > 0 && (
                      <div className="rounded-lg bg-red-50/60 border border-red-100 p-3 space-y-1.5">
                        <div className="text-[11px] uppercase tracking-wide text-red-400">Participant asked for changes</div>
                        {pageComments.filter(c => c.author_role === 'participant').slice(-3).map(c => (
                          <div key={c.id} className="text-sm text-gray-700 flex gap-2"><MessageSquare className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" /> {c.body}</div>
                        ))}
                      </div>
                    )}

                    {/* Reference images the participant attached to the change request */}
                    {p.status === 'changes_requested' && (changeImgs[p.id]?.length ?? 0) > 0 && (
                      <div className="rounded-lg bg-amber-50 border border-amber-100 p-3">
                        <div className="text-[11px] uppercase tracking-wide text-amber-500 mb-1.5 flex items-center gap-1.5"><ImageIcon className="h-3.5 w-3.5" /> Images the participant attached</div>
                        <div className="flex flex-wrap gap-2">
                          {changeImgs[p.id].map(img => (
                            <div key={img.path} className="relative">
                              {img.is_image && img.url ? (
                                <button onClick={() => img.url && window.open(img.url, '_blank')} title={`Open ${img.filename}`} className="block h-16 w-16 rounded-md border border-amber-200 overflow-hidden bg-white hover:ring-2 hover:ring-primary/30">
                                  <img src={img.url} alt={img.filename} className="h-full w-full object-contain" />
                                </button>
                              ) : (
                                <button onClick={() => img.url && window.open(img.url, '_blank')} title={img.filename} className="h-16 w-16 rounded-md border border-amber-200 flex flex-col items-center justify-center gap-1 text-[9px] text-gray-600 hover:bg-white p-1">
                                  <Download className="h-3.5 w-3.5 text-gray-400" /><span className="truncate w-full text-center">{img.filename}</span>
                                </button>
                              )}
                              <button onClick={() => downloadChangeImg(img)} title="Download" className="absolute -bottom-1.5 -right-1.5 bg-white border border-gray-200 rounded-full p-0.5 text-gray-500 hover:text-primary shadow-sm">
                                <Download className="h-3 w-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Inline preview */}
                    {preview?.id === p.id && (
                      <div className="rounded-lg border border-gray-200 overflow-hidden bg-gray-50">
                        <iframe title={`Preview ${title(p)}`} src={preview.url} className="w-full h-[28rem]" />
                      </div>
                    )}

                    {/* Actions: one clear primary per stage + utilities */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <input ref={el => { fileRefs.current[p.id] = el; }} type="file" className="hidden"
                        onChange={e => { const f = e.target.files?.[0]; if (f) uploadDesigned(p, f); e.target.value = ''; }} />

                      {p.status === 'awaiting_export' && (
                        <Button size="sm" className="gap-1.5" onClick={() => sendToDesigner(p)} disabled={isBusy}>
                          <Send className="h-3.5 w-3.5" /> Send to designer
                        </Button>
                      )}
                      {p.status === 'exported' && (
                        <Button size="sm" className="gap-1.5" onClick={() => patch(p, { status: 'in_design' })} disabled={isBusy}><Palette className="h-3.5 w-3.5" /> Start design</Button>
                      )}
                      {(p.status === 'in_design' || p.status === 'changes_requested') && (
                        <Button size="sm" className="gap-1.5" onClick={() => fileRefs.current[p.id]?.click()} disabled={isBusy}>
                          {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                          {p.status === 'changes_requested' ? 'Upload revised page' : 'Upload designed page'}
                        </Button>
                      )}
                      {p.status === 'uploaded' && <span className="text-xs text-blue-600 inline-flex items-center gap-1"><Loader2 className="h-3 w-3" /> Awaiting participant approval</span>}
                      {p.status === 'approved' && (
                        <Button size="sm" className="gap-1.5" onClick={() => publish(p, publishable)} disabled={isBusy || !publishable} title={publishable ? 'Publish' : 'Awaiting payment'}>
                          <CheckCircle className="h-3.5 w-3.5" /> {publishable ? 'Publish' : 'Publish (needs payment)'}
                        </Button>
                      )}
                      {p.status === 'published' && <span className="text-xs text-green-600 inline-flex items-center gap-1"><CheckCircle className="h-3.5 w-3.5" /> Live in the e-catalogue</span>}

                      {/* utilities */}
                      <div className="flex items-center gap-1 ml-auto">
                        {!['startup', 'marina', 'architecture'].includes(p.kind) && p.status !== 'published' && (
                          <Button variant="ghost" size="sm" className="gap-1.5 text-gray-400 hover:text-red-600" onClick={() => removePage(p)} disabled={isBusy} title="Remove from the e-catalogue">
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" className="gap-1.5 text-gray-500" onClick={() => navigate(`/admin/sm26/ecat/${p.id}/dossier`)} title="The participant's profile data used to design the page">
                          <FileText className="h-3.5 w-3.5" /> Dossier
                        </Button>
                        {(p.designed_file_path || p.published_file_path) && (
                          <Button variant="ghost" size="sm" className="gap-1.5 text-gray-500" onClick={() => togglePreview(p)}>
                            {preview?.id === p.id ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />} Preview
                          </Button>
                        )}
                        {canUpload && p.designed_file_path && (
                          <Button variant="ghost" size="sm" className="gap-1.5 text-gray-500" onClick={() => fileRefs.current[p.id]?.click()} disabled={isBusy} title="Replace the designed page">
                            <Upload className="h-3.5 w-3.5" /> Re-upload
                          </Button>
                        )}
                        {canUpload && p.designed_file_path && (
                          <Button variant="ghost" size="sm" className="gap-1.5 text-gray-500 hover:text-red-600" onClick={() => removeDesigned(p)} disabled={isBusy} title="Remove the uploaded file">
                            <Trash2 className="h-3.5 w-3.5" /> Remove
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
