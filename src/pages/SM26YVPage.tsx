import { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Input } from '@/components/ui/input';
import { RefreshCw, Lightbulb, Scale, Lock, Video, Plus, X, Calendar } from 'lucide-react';
import { SM26BackLink } from '@/components/sm26/SM26BackLink';
import { toast } from '@/hooks/use-toast';

// Yachting Ventures (Gabriella) console: the innovation pipeline + innovation
// jury, with registration / confirmation / payment status for follow-ups.
// Access is enforced server-side by sm_yv_innovations / sm_yv_jurors (staff or
// a kind='yachting_ventures' event partner); this page just reflects it.

interface Innovation {
  registration_id: string; role_assignment_id: string; company: string; contact: string | null; email: string;
  reg_status: string; role_status: string; payment_status: string; stage: string | null; categories: string[] | null;
}
interface Juror {
  registration_id: string; name: string | null; email: string; company: string | null;
  role_status: string; innovation_assignments: number;
}
interface JurySession {
  id: string; title: string; entry_role_assignment_id: string | null; entry_company: string | null;
  scheduled_at: string; duration_minutes: number; status: string; zoom_join_url: string | null;
}
interface AssignableJuror { user_id: string; name: string | null }
interface JuryAssignment { id: string; entry_role_assignment_id: string; juror_user_id: string; juror_name: string }

const regBadge = (s: string) => {
  if (s === 'confirmed') return 'bg-green-50 text-green-700 border-green-200';
  if (s === 'declined') return 'bg-red-50 text-red-600 border-red-200';
  if (s === 'cancelled') return 'bg-gray-50 text-gray-500 border-gray-200';
  return 'bg-blue-50 text-blue-700 border-blue-200';
};
const payBadge = (s: string) =>
  s === 'paid' || s === 'waived' ? 'bg-green-50 text-green-700 border-green-200'
  : s === 'invoiced' ? 'bg-amber-50 text-amber-700 border-amber-200'
  : 'bg-gray-50 text-gray-500 border-gray-200';
const Pill = ({ s, cls }: { s: string; cls: string }) => (
  <span className={`text-xs px-2 py-0.5 rounded-full border whitespace-nowrap ${cls}`}>{s}</span>
);

export function SM26YVPage() {
  const { user } = useAuth();
  const [innovations, setInnovations] = useState<Innovation[]>([]);
  const [jurors, setJurors] = useState<Juror[]>([]);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [sessions, setSessions] = useState<JurySession[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [sTitle, setSTitle] = useState('');
  const [sEntry, setSEntry] = useState('');
  const [sWhen, setSWhen] = useState('');
  const [sDur, setSDur] = useState('30');
  const [sTest, setSTest] = useState(false);
  const [busy, setBusy] = useState(false);
  const [eventId, setEventId] = useState<string | null>(null);
  const [assignable, setAssignable] = useState<AssignableJuror[]>([]);
  const [assignments, setAssignments] = useState<JuryAssignment[]>([]);

  const load = async () => {
    setLoading(true);
    const { data: ev } = await supabase.from('sm_event').select('id').eq('slug', 'sm26').maybeSingle();
    if (!ev) { setLoading(false); return; }
    const evId = (ev as { id: string }).id;
    setEventId(evId);
    const [inn, jur, ses, asg, asn] = await Promise.all([
      supabase.rpc('sm_yv_innovations', { p_event_id: evId }),
      supabase.rpc('sm_yv_jurors', { p_event_id: evId }),
      supabase.rpc('sm_jury_sessions_list', { p_event_id: evId }),
      supabase.rpc('sm_yv_assignable_jurors', { p_event_id: evId }),
      supabase.rpc('sm_yv_assignments', { p_event_id: evId }),
    ]);
    if (inn.error || jur.error) { setDenied(true); setLoading(false); return; }
    setInnovations((inn.data || []) as Innovation[]);
    setJurors((jur.data || []) as Juror[]);
    setSessions((ses.data || []) as JurySession[]);
    setAssignable((asg.data || []) as AssignableJuror[]);
    setAssignments((asn.data || []) as JuryAssignment[]);
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const createSession = async () => {
    if (!sWhen) { toast({ title: 'Pick a date & time', variant: 'destructive' }); return; }
    if (sTest && !user?.email) { toast({ title: 'No email on your account for the test run', variant: 'destructive' }); return; }
    setBusy(true);
    const { data, error } = await supabase.functions.invoke('sm26-jury-session', {
      body: {
        action: 'create', title: sTitle.trim() || undefined,
        entry_role_assignment_id: sEntry || undefined,
        scheduled_at: new Date(sWhen).toISOString(), duration_minutes: Number(sDur) || 30,
        test_email: sTest ? user?.email : undefined,
      },
    });
    setBusy(false);
    const err = error || (data as { error?: string })?.error;
    if (err) { toast({ title: 'Could not schedule', description: typeof err === 'string' ? err : 'Please try again.', variant: 'destructive' }); return; }
    const r = data as { invited?: number; test?: boolean };
    toast({
      title: r?.test ? 'Test session created' : 'Session scheduled',
      description: r?.test
        ? `Real Zoom created · invite sent only to you (${user?.email}). No emails to jurors or startups.`
        : `Zoom created · invitations sent to ${r?.invited ?? 0} people.`,
    });
    setShowCreate(false); setSTitle(''); setSEntry(''); setSWhen(''); setSDur('30'); setSTest(false);
    load();
  };
  const cancelSession = async (s: JurySession) => {
    if (!confirm(`Cancel "${s.title}"? The Zoom meeting will be deleted and attendees notified.`)) return;
    setBusy(true);
    const { error } = await supabase.functions.invoke('sm26-jury-session', { body: { action: 'cancel', session_id: s.id } });
    setBusy(false);
    if (error) { toast({ title: 'Could not cancel', variant: 'destructive' }); return; }
    toast({ title: 'Session cancelled' });
    load();
  };

  const reloadAssignments = async () => {
    if (!eventId) return;
    const { data } = await supabase.rpc('sm_yv_assignments', { p_event_id: eventId });
    setAssignments((data || []) as JuryAssignment[]);
  };
  const assignJuror = async (entryRaId: string, jurorUserId: string) => {
    if (!jurorUserId) return;
    setBusy(true);
    const { error } = await supabase.rpc('sm_yv_assign', { p_entry: entryRaId, p_juror: jurorUserId });
    setBusy(false);
    if (error) { toast({ title: 'Could not assign', description: error.message, variant: 'destructive' }); return; }
    reloadAssignments();
  };
  const unassignJuror = async (id: string) => {
    setBusy(true);
    const { error } = await supabase.rpc('sm_yv_unassign', { p_id: id });
    setBusy(false);
    if (error) { toast({ title: 'Could not remove', description: error.message, variant: 'destructive' }); return; }
    reloadAssignments();
  };

  if (loading) return (
    <div className="flex items-center justify-center h-[60vh]"><RefreshCw className="h-6 w-6 animate-spin text-gray-300" /></div>
  );
  if (denied) return (
    <div className="container mx-auto px-4 py-16 max-w-lg text-center">
      <Lock className="h-8 w-8 mx-auto text-gray-300 mb-3" />
      <h1 className="text-xl font-bold mb-1">Yachting Ventures access only</h1>
      <p className="text-gray-500 text-sm">This console is reserved for the Yachting Ventures team. If you should have access, contact M3.</p>
    </div>
  );

  const paid = innovations.filter(i => i.payment_status === 'paid' || i.payment_status === 'waived').length;
  const confirmed = innovations.filter(i => i.reg_status === 'confirmed').length;
  const stats: [string, number][] = [
    ['Innovations', innovations.length], ['Confirmed', confirmed], ['Paid', paid], ['Jurors', jurors.length],
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <Helmet><title>Yachting Ventures — Smart Marina Rendezvous 2026</title></Helmet>

      <section className="bg-gradient-to-br from-[#0b2653] to-[#143a6b] text-white">
        <div className="container mx-auto px-4 py-10">
          <div className="mb-4"><SM26BackLink to="/account" label="Back" light /></div>
          <p className="uppercase tracking-wide text-white/60 text-sm mb-1">Yachting Ventures · Innovation scouting</p>
          <h1 className="text-3xl font-bold">Innovation pipeline &amp; jury</h1>
          <p className="text-white/80 mt-2 max-w-2xl">Every innovation entry and juror — registration, confirmation and payment status, so you can chase follow-ups.</p>
        </div>
      </section>

      <div className="container mx-auto px-4 py-8 max-w-5xl space-y-6">
        <div className="flex items-center justify-between">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 flex-1 mr-4">
            {stats.map(([l, v]) => (
              <div key={l} className="rounded-xl bg-white border border-gray-200 p-4">
                <div className="text-[11px] uppercase tracking-wide text-gray-400">{l}</div>
                <div className="text-2xl font-semibold mt-0.5">{v}</div>
              </div>
            ))}
          </div>
          <Button size="sm" variant="outline" className="gap-1.5 shrink-0" onClick={load}><RefreshCw className="h-3.5 w-3.5" /> Refresh</Button>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-base"><Video className="h-4 w-4 text-primary" /> Jury sessions ({sessions.filter(s => s.status !== 'cancelled').length})</CardTitle>
              <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setShowCreate(o => !o)}><Plus className="h-4 w-4" /> Schedule</Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {showCreate && (
              <div className="rounded-lg border border-gray-200 p-3 space-y-2 bg-gray-50">
                <Input value={sTitle} onChange={e => setSTitle(e.target.value)} placeholder="Title (default: Innovation jury session)" className="h-9 bg-white" />
                <div className="grid sm:grid-cols-2 gap-2">
                  <select value={sEntry} onChange={e => setSEntry(e.target.value)} className="h-9 rounded-md border border-gray-200 px-2 text-sm bg-white">
                    <option value="">All innovation jurors (no specific entry)</option>
                    {innovations.map(i => <option key={i.role_assignment_id} value={i.role_assignment_id}>{i.company}</option>)}
                  </select>
                  <div className="flex gap-2">
                    <Input type="datetime-local" value={sWhen} onChange={e => setSWhen(e.target.value)} className="h-9 bg-white" />
                    <Input type="number" min={10} max={240} value={sDur} onChange={e => setSDur(e.target.value)} className="h-9 w-20 bg-white" title="Minutes" />
                  </div>
                </div>
                <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
                  <input type="checkbox" checked={sTest} onChange={e => setSTest(e.target.checked)} className="rounded border-gray-300" />
                  <span>Test run — send only to me{user?.email ? ` (${user.email})` : ''}, no emails to jurors or startups</span>
                </label>
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
                  <Button size="sm" onClick={createSession} disabled={busy || !sWhen}>{busy ? 'Scheduling…' : sTest ? 'Create test (only me)' : 'Create Zoom + send invites'}</Button>
                </div>
                <p className="text-[11px] text-gray-400">{sTest
                  ? 'Creates a real Zoom meeting and sends the calendar invite only to you — nothing to jurors or startups. Cancel it afterwards to delete the test meeting.'
                  : 'Creates a Zoom meeting and emails an .ics calendar invite to the entry, its jurors, Yachting Ventures and Victor.'}</p>
              </div>
            )}
            {sessions.length === 0 && !showCreate && <p className="text-sm text-gray-400">No sessions scheduled yet.</p>}
            {sessions.map(s => (
              <div key={s.id} className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 ${s.status === 'cancelled' ? 'border-gray-100 opacity-50' : 'border-gray-200'}`}>
                <div className="min-w-0">
                  <div className="text-sm font-medium flex items-center gap-2">{s.title}{s.status === 'cancelled' && <span className="text-xs text-red-500">cancelled</span>}</div>
                  <div className="text-xs text-gray-400 flex items-center gap-x-2 gap-y-0.5 flex-wrap">
                    <span className="inline-flex items-center gap-1"><Calendar className="h-3 w-3" /> {new Date(s.scheduled_at).toLocaleString()}</span>
                    {s.entry_company && <span>· {s.entry_company}</span>}
                    <span>· {s.duration_minutes} min</span>
                    {s.zoom_join_url && s.status !== 'cancelled' && <a href={s.zoom_join_url} target="_blank" rel="noreferrer" className="text-primary inline-flex items-center gap-0.5"><Video className="h-3 w-3" /> Zoom</a>}
                  </div>
                </div>
                {s.status !== 'cancelled' && <Button size="icon" variant="ghost" className="h-7 w-7 text-gray-400 hover:text-red-600 shrink-0" onClick={() => cancelSession(s)} disabled={busy}><X className="h-4 w-4" /></Button>}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Scale className="h-4 w-4 text-primary" /> Jury assignments</CardTitle>
            <p className="text-xs text-gray-500 mt-1">Allocate jurors to each innovation. A juror appears in the list once they've signed up and been confirmed.</p>
          </CardHeader>
          <CardContent className="space-y-2">
            {innovations.length === 0 ? (
              <p className="text-sm text-gray-400">No innovation entries yet.</p>
            ) : innovations.map(i => {
              const mine = assignments.filter(a => a.entry_role_assignment_id === i.role_assignment_id);
              const assignedIds = new Set(mine.map(a => a.juror_user_id));
              const available = assignable.filter(j => !assignedIds.has(j.user_id));
              return (
                <div key={i.role_assignment_id} className="rounded-lg border border-gray-200 p-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="text-sm font-medium">{i.company}</div>
                    <select value="" disabled={busy || available.length === 0}
                      onChange={e => { const v = e.target.value; e.target.value = ''; if (v) assignJuror(i.role_assignment_id, v); }}
                      className="h-8 rounded-md border border-gray-200 px-2 text-sm bg-white disabled:opacity-50">
                      <option value="">{available.length ? 'Assign juror…' : (assignable.length ? 'All assigned' : 'No jurors available')}</option>
                      {available.map(j => <option key={j.user_id} value={j.user_id}>{j.name || 'Juror'}</option>)}
                    </select>
                  </div>
                  {mine.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {mine.map(a => (
                        <span key={a.id} className="inline-flex items-center gap-1 text-xs bg-primary/5 text-primary border border-primary/20 rounded-full pl-2.5 pr-1 py-0.5">
                          {a.juror_name}
                          <button onClick={() => unassignJuror(a.id)} disabled={busy} className="hover:bg-primary/10 rounded-full p-0.5" title="Remove"><X className="h-3 w-3" /></button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {assignable.length === 0 && innovations.length > 0 && (
              <p className="text-xs text-amber-600">No jurors are assignable yet — a juror becomes available here once they create their account and are confirmed.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Lightbulb className="h-4 w-4 text-primary" /> Innovation entries ({innovations.length})</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
                  <th className="px-4 py-2">Company</th><th className="px-4 py-2">Contact</th><th className="px-4 py-2">Registration</th><th className="px-4 py-2">Payment</th><th className="px-4 py-2">Stage</th>
                </tr></thead>
                <tbody>
                  {innovations.map(i => (
                    <tr key={i.registration_id} className="border-b border-gray-50 align-top">
                      <td className="px-4 py-2.5 font-medium">{i.company}</td>
                      <td className="px-4 py-2.5 text-gray-500"><div>{i.contact || '—'}</div><div className="text-xs text-gray-400">{i.email}</div></td>
                      <td className="px-4 py-2.5"><Pill s={i.reg_status} cls={regBadge(i.reg_status)} /></td>
                      <td className="px-4 py-2.5"><Pill s={i.payment_status} cls={payBadge(i.payment_status)} /></td>
                      <td className="px-4 py-2.5 text-gray-500">{i.stage || '—'}</td>
                    </tr>
                  ))}
                  {innovations.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-400">No innovation entries yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Scale className="h-4 w-4 text-primary" /> Innovation jury ({jurors.length})</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
                  <th className="px-4 py-2">Juror</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Innovation assignments</th>
                </tr></thead>
                <tbody>
                  {jurors.map(j => (
                    <tr key={j.registration_id} className="border-b border-gray-50">
                      <td className="px-4 py-2.5"><div className="font-medium">{j.name || '—'}</div><div className="text-xs text-gray-400">{j.email}{j.company ? ` · ${j.company}` : ''}</div></td>
                      <td className="px-4 py-2.5"><Pill s={j.role_status} cls={regBadge(j.role_status === 'confirmed' ? 'confirmed' : j.role_status === 'declined' ? 'declined' : 'submitted')} /></td>
                      <td className="px-4 py-2.5 text-gray-500">{j.innovation_assignments}</td>
                    </tr>
                  ))}
                  {jurors.length === 0 && <tr><td colSpan={3} className="px-4 py-6 text-center text-gray-400">No jurors yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
