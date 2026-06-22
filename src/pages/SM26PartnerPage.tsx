import { useState, useEffect } from 'react';
import { Helmet } from 'react-helmet-async';
import {
  RefreshCw, Download, FileText, ExternalLink, Building2, Mic, BookOpen, CalendarDays, Lock, MapPin,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { SM26BackLink } from '@/components/sm26/SM26BackLink';
import { ECAT_STATUS_LABEL, ecatStatusClass } from '@/components/admin/AdminSM26Ecat';

// Yacht Club / event-partner scoped view. Read sponsor & speaker dossiers (with
// documents), see the programme read-only, and change e-catalogue page status.
// No attendee list, no edits to registrations or the programme.

interface DossierRow {
  reg_id: string; role: string; name: string | null; company: string | null;
  email: string | null; phone: string | null; country: string | null;
  status: string; module_data: Record<string, unknown> | null;
}
interface EcatRow { id: string; kind: string; status: string; title: string }
interface Session { id: string; title: string; type: string; starts_at: string | null; ends_at: string | null; room: string | null; speakers: string | null }

const TZ = 'Europe/Monaco';
const fmtTime = (s: string | null) => s ? new Date(s).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: TZ }) : '';
const dayKey = (s: string | null) => s ? new Date(s).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ }) : 'TBD';
const isPath = (v: unknown): v is string => typeof v === 'string' && v.includes('/') && !v.startsWith('http');
const prettyKey = (k: string) => k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
const ECAT_STATUSES = ['awaiting_export', 'exported', 'in_design', 'uploaded', 'changes_requested', 'approved', 'published'];

export function SM26PartnerPage() {
  const { user, loading: authLoading } = useAuth();
  const [eventId, setEventId] = useState<string | null>(null);
  const [access, setAccess] = useState<'loading' | 'ok' | 'denied'>('loading');
  const [dossier, setDossier] = useState<DossierRow[]>([]);
  const [ecat, setEcat] = useState<EcatRow[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => { if (!authLoading) load(); /* eslint-disable-next-line */ }, [authLoading, user]);

  const load = async () => {
    const { data: ev } = await supabase.from('sm_event').select('id').eq('slug', 'sm26').maybeSingle();
    if (!ev) { setAccess('denied'); return; }
    const eid = (ev as { id: string }).id;
    setEventId(eid);
    const { data: dos, error } = await supabase.rpc('sm_partner_dossier', { p_event_id: eid });
    if (error) { setAccess('denied'); return; }
    setAccess('ok');
    setDossier((dos || []) as DossierRow[]);
    const [{ data: ec }, { data: ag }] = await Promise.all([
      supabase.rpc('sm_partner_ecat', { p_event_id: eid }),
      supabase.rpc('sm_agenda', { p_event_id: eid }),
    ]);
    setEcat((ec || []) as EcatRow[]);
    setSessions((ag || []) as Session[]);
  };

  const viewDoc = async (path: string) => {
    const { data, error } = await supabase.storage.from('event-media').createSignedUrl(path, 300);
    if (error || !data) { toast({ title: 'Could not open document', variant: 'destructive' }); return; }
    window.open(data.signedUrl, '_blank');
  };

  const setEcatStatus = async (id: string, status: string) => {
    setBusy(id);
    const { error } = await supabase.rpc('sm_partner_ecat_status', { p_page_id: id, p_status: status });
    setBusy(null);
    if (error) { toast({ title: 'Could not update', description: error.message, variant: 'destructive' }); return; }
    setEcat(prev => prev.map(p => p.id === id ? { ...p, status } : p));
    toast({ title: 'E-catalogue status updated' });
  };

  const exportCsv = (role: string) => {
    const rows = dossier.filter(d => d.role === role);
    const head = ['Name', 'Company', 'Email', 'Phone', 'Country', 'Status'];
    const body = rows.map(r => [r.name || '', r.company || '', r.email || '', r.phone || '', r.country || '', r.status]);
    const esc = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
    const csv = [head, ...body].map(r => r.map(esc).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a'); a.href = url; a.download = `sm26-${role}s.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  if (authLoading || access === 'loading') return <div className="flex items-center justify-center h-[60vh]"><RefreshCw className="h-8 w-8 animate-spin text-primary" /></div>;
  if (access === 'denied') return (
    <div className="container mx-auto px-4 py-16 max-w-md text-center">
      <Lock className="h-10 w-10 text-gray-300 mx-auto mb-3" />
      <h1 className="text-2xl font-bold mb-2">Partner access only</h1>
      <p className="text-gray-600">This area is for the event's partner organisations. If you should have access, contact <a href="mailto:events@m3monaco.com" className="text-primary">events@m3monaco.com</a>.</p>
    </div>
  );

  const sponsors = dossier.filter(d => d.role === 'sponsor');
  const speakers = dossier.filter(d => d.role === 'speaker');
  const days: { key: string; items: Session[] }[] = [];
  for (const s of sessions) { const k = dayKey(s.starts_at); let d = days.find(x => x.key === k); if (!d) { d = { key: k, items: [] }; days.push(d); } d.items.push(s); }

  const PersonCard = ({ d }: { d: DossierRow }) => {
    const docs = Object.entries(d.module_data || {}).filter(([k, v]) => isPath(v) && !k.startsWith('_'));
    return (
      <div className="rounded-lg border border-gray-100 p-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-gray-900">{d.company || d.name || 'Entry'}</div>
            <div className="text-xs text-gray-500">{d.name}{d.country ? ` · ${d.country}` : ''}</div>
          </div>
          <div className="flex items-center gap-3 text-xs text-gray-500">
            {d.email && <a href={`mailto:${d.email}`} className="hover:text-primary">{d.email}</a>}
            {d.phone && <span>{d.phone}</span>}
          </div>
        </div>
        {docs.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {docs.map(([k, v]) => (
              <Button key={k} size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={() => viewDoc(v as string)}>
                <FileText className="h-3.5 w-3.5" /> {prettyKey(k)}
              </Button>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Helmet><title>Partner area — SM26</title></Helmet>
      <section className="bg-gradient-to-br from-[#0b2653] to-[#143a6b] text-white">
        <div className="container mx-auto px-4 py-10">
          <div className="mb-3"><SM26BackLink light /></div>
          <p className="uppercase tracking-wide text-white/60 text-sm mb-2">SM26 · Partner area</p>
          <h1 className="text-2xl lg:text-3xl font-bold">Yacht Club &amp; partners</h1>
          <p className="text-white/80 mt-2 max-w-2xl">Sponsor &amp; speaker dossiers, the programme, and e-catalogue status.</p>
        </div>
      </section>

      <div className="container mx-auto px-4 py-8 max-w-3xl space-y-6">
        {/* Sponsors */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <CardTitle className="flex items-center gap-2"><Building2 className="h-5 w-5 text-primary" /> Sponsors ({sponsors.length})</CardTitle>
              {sponsors.length > 0 && <Button size="sm" variant="outline" className="gap-1.5" onClick={() => exportCsv('sponsor')}><Download className="h-4 w-4" /> Download CSV</Button>}
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {sponsors.length === 0 ? <p className="text-sm text-gray-400">No sponsors yet.</p> : sponsors.map(d => <PersonCard key={d.reg_id} d={d} />)}
          </CardContent>
        </Card>

        {/* Speakers */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <CardTitle className="flex items-center gap-2"><Mic className="h-5 w-5 text-primary" /> Speakers ({speakers.length})</CardTitle>
              {speakers.length > 0 && <Button size="sm" variant="outline" className="gap-1.5" onClick={() => exportCsv('speaker')}><Download className="h-4 w-4" /> Download CSV</Button>}
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {speakers.length === 0 ? <p className="text-sm text-gray-400">No speakers yet.</p> : speakers.map(d => <PersonCard key={d.reg_id} d={d} />)}
          </CardContent>
        </Card>

        {/* Programme (read-only) */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><CalendarDays className="h-5 w-5 text-primary" /> Programme</CardTitle>
            <CardDescription>Read-only — the schedule is managed by M3.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {days.length === 0 ? <p className="text-sm text-gray-400">The programme will be published soon.</p> : days.map(day => (
              <div key={day.key}>
                <div className="text-sm font-semibold text-gray-700 mb-2">{day.key}</div>
                <div className="space-y-1.5">
                  {day.items.map(s => (
                    <div key={s.id} className="flex gap-3 text-sm">
                      <span className="w-14 shrink-0 text-gray-500">{fmtTime(s.starts_at)}</span>
                      <div className="min-w-0">
                        <span className="font-medium text-gray-900">{s.title}</span>
                        <div className="text-xs text-gray-500 flex items-center gap-2 flex-wrap">
                          <Badge variant="secondary" className="text-[10px] capitalize">{s.type}</Badge>
                          {s.room && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {s.room}</span>}
                          {s.speakers && <span>{s.speakers}</span>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* E-catalogue status (editable) */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><BookOpen className="h-5 w-5 text-primary" /> E-catalogue status</CardTitle>
            <CardDescription>You can update the status of each catalogue page.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {ecat.length === 0 ? <p className="text-sm text-gray-400">No catalogue pages yet.</p> : ecat.map(p => (
              <div key={p.id} className="flex items-center justify-between gap-2 rounded-lg border border-gray-100 px-3 py-2 flex-wrap">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm font-medium text-gray-800 truncate">{p.title}</span>
                  <Badge variant="outline" className="text-[10px] capitalize">{p.kind}</Badge>
                  <Badge className={`text-[10px] ${ecatStatusClass(p.status)}`}>{ECAT_STATUS_LABEL[p.status] || p.status}</Badge>
                </div>
                <Select value={p.status} onValueChange={v => setEcatStatus(p.id, v)} disabled={busy === p.id}>
                  <SelectTrigger className="w-44 h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{ECAT_STATUSES.map(s => <SelectItem key={s} value={s}>{ECAT_STATUS_LABEL[s] || s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            ))}
          </CardContent>
        </Card>

        <p className="text-xs text-gray-400 text-center">
          <ExternalLink className="h-3 w-3 inline mr-1" /> The full attendee list isn't shown here. For anything else, contact events@m3monaco.com.
        </p>
      </div>
    </div>
  );
}
