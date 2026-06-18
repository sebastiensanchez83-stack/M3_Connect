import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  RefreshCw, ArrowLeft, BookOpen, Upload, FileText, ExternalLink, CheckCircle, Loader2, Send, CreditCard, MessageSquare,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';

// Admin e-catalogue console — drives the round-trip: export dossier -> design ->
// upload designed page -> participant approves/requests changes -> publish
// (gated on payment). YCM-side steps are performed here by M3.

export const ECAT_STATUS_LABEL: Record<string, string> = {
  awaiting_export: 'Awaiting export',
  exported: 'Exported',
  in_design: 'In design',
  uploaded: 'Uploaded for approval',
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

interface Payment { status: string; amount_cents: number | null; paid_at: string | null; invoice_ref: string | null; }
interface Reg { id: string; company_name: string | null; first_name: string | null; last_name: string | null; user_id: string | null; payment?: Payment | Payment[]; }
interface Page {
  id: string; event_id: string; registration_id: string; kind: string; status: string;
  designed_file_path: string | null; published_file_path: string | null;
  registration: Reg;
}
interface Comment { id: string; ecat_page_id: string; author_role: string | null; body: string; created_at: string; }

const firstOf = <T,>(x: T | T[] | undefined): T | undefined => Array.isArray(x) ? x[0] : x;

export function AdminSM26Ecat() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [eventId, setEventId] = useState<string | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [comments, setComments] = useState<Record<string, Comment[]>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
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
      .select('*, registration:sm_registration(id,company_name,first_name,last_name,user_id, payment:sm_payment(status,amount_cents,paid_at,invoice_ref))')
      .eq('event_id', eid)
      .order('created_at', { ascending: true });
    const pgs = (data || []) as Page[];
    setPages(pgs);
    if (pgs.length) {
      const { data: cms } = await supabase.from('sm_ecat_comment').select('*').in('ecat_page_id', pgs.map(p => p.id)).order('created_at', { ascending: true });
      const byPage: Record<string, Comment[]> = {};
      for (const c of (cms || []) as Comment[]) (byPage[c.ecat_page_id] ||= []).push(c);
      setComments(byPage);
    }
    setLoading(false);
  };

  const title = (p: Page) => {
    const r = p.registration;
    return r.company_name || `${r.first_name || ''} ${r.last_name || ''}`.trim() || 'Entry';
  };

  const patch = async (p: Page, fields: Record<string, unknown>) => {
    setBusy(p.id);
    const { error } = await supabase.from('sm_ecat_page').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', p.id);
    setBusy(null);
    if (error) { toast({ title: 'Update failed', description: error.message, variant: 'destructive' }); return false; }
    setPages(prev => prev.map(x => x.id === p.id ? { ...x, ...fields } as Page : x));
    return true;
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
    toast({ title: 'Designed page uploaded — participant can now review' });
  };

  const publish = async (p: Page, paid: boolean) => {
    if (!paid) { toast({ title: 'Awaiting payment', description: 'This entry must be marked paid before publishing.', variant: 'destructive' }); return; }
    const ok = await patch(p, { status: 'published', published_file_path: p.designed_file_path, published_at: new Date().toISOString() });
    if (ok) toast({ title: 'E-catalogue page published' });
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

  const viewFile = async (path: string) => {
    const { data, error } = await supabase.storage.from('event-media').createSignedUrl(path, 300);
    if (error || !data) { toast({ title: 'Could not open file', variant: 'destructive' }); return; }
    window.open(data.signedUrl, '_blank');
  };

  if (loading) return <div className="flex items-center justify-center h-64"><RefreshCw className="h-8 w-8 animate-spin text-gray-400" /></div>;

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={() => navigate('/admin/sm26')} className="gap-1.5"><ArrowLeft className="h-4 w-4" /> Back to registrations</Button>
      <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><BookOpen className="h-6 w-6 text-primary" /> E-catalogue ({pages.length})</h1>

      {pages.length === 0 ? (
        <Card className="border-0 shadow-sm"><CardContent className="py-12 text-center text-gray-400">No marina or startup entries yet — e-catalogue pages are created automatically for them.</CardContent></Card>
      ) : (
        <div className="space-y-2">
          {pages.map(p => {
            const pay = firstOf(p.registration.payment);
            const paid = pay?.status === 'paid';
            const isBusy = busy === p.id;
            const pageComments = comments[p.id] || [];
            return (
              <Card key={p.id} className="border-0 shadow-sm">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-gray-900">{title(p)}</span>
                      <Badge variant="outline" className="text-[10px] capitalize">{p.kind}</Badge>
                      <Badge className={`text-[10px] ${ecatStatusClass(p.status)}`}>{ECAT_STATUS_LABEL[p.status] || p.status}</Badge>
                      <Badge className={`text-[10px] ${payClass(pay?.status)}`}><CreditCard className="h-3 w-3 mr-1" />{pay?.status || 'unpaid'}</Badge>
                    </div>
                    {/* Payment control */}
                    <Select value={pay?.status || 'unpaid'} onValueChange={v => setPayment(p, v)} disabled={isBusy}>
                      <SelectTrigger className="w-32 h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unpaid">Unpaid</SelectItem>
                        <SelectItem value="invoiced">Invoiced</SelectItem>
                        <SelectItem value="paid">Paid</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Change-request comments */}
                  {p.status === 'changes_requested' && pageComments.length > 0 && (
                    <div className="rounded-lg bg-red-50/60 border border-red-100 p-3 space-y-1.5">
                      {pageComments.filter(c => c.author_role === 'participant').slice(-3).map(c => (
                        <div key={c.id} className="text-sm text-gray-700 flex gap-2"><MessageSquare className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" /> {c.body}</div>
                      ))}
                    </div>
                  )}

                  {/* Contextual actions */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <input ref={el => { fileRefs.current[p.id] = el; }} type="file" className="hidden"
                      onChange={e => { const f = e.target.files?.[0]; if (f) uploadDesigned(p, f); e.target.value = ''; }} />

                    <Button variant="outline" size="sm" className="gap-1.5" onClick={() => navigate(`/admin/sm26/ecat/${p.id}/dossier`)}>
                      <FileText className="h-3.5 w-3.5" /> Dossier
                    </Button>

                    {p.status === 'awaiting_export' && (
                      <Button size="sm" className="gap-1.5" onClick={() => patch(p, { status: 'exported' })} disabled={isBusy}>
                        <Send className="h-3.5 w-3.5" /> Mark exported
                      </Button>
                    )}
                    {p.status === 'exported' && (
                      <Button variant="outline" size="sm" onClick={() => patch(p, { status: 'in_design' })} disabled={isBusy}>Start design</Button>
                    )}
                    {(p.status === 'exported' || p.status === 'in_design' || p.status === 'changes_requested' || p.status === 'uploaded') && (
                      <Button size="sm" className="gap-1.5" onClick={() => fileRefs.current[p.id]?.click()} disabled={isBusy}>
                        {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                        {p.designed_file_path ? 'Re-upload designed page' : 'Upload designed page'}
                      </Button>
                    )}
                    {p.designed_file_path && (
                      <Button variant="ghost" size="sm" className="gap-1.5 text-primary" onClick={() => viewFile(p.designed_file_path!)}>
                        <ExternalLink className="h-3.5 w-3.5" /> View page
                      </Button>
                    )}
                    {p.status === 'uploaded' && <span className="text-xs text-blue-600">Awaiting participant approval</span>}
                    {p.status === 'approved' && (
                      <Button size="sm" className="gap-1.5" onClick={() => publish(p, paid)} disabled={isBusy || !paid} title={paid ? 'Publish' : 'Awaiting payment'}>
                        <CheckCircle className="h-3.5 w-3.5" /> {paid ? 'Publish' : 'Publish (awaiting payment)'}
                      </Button>
                    )}
                    {p.status === 'published' && <span className="text-xs text-green-600 inline-flex items-center gap-1"><CheckCircle className="h-3.5 w-3.5" /> Live in the e-catalogue</span>}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
