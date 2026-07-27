import { useEffect, useMemo, useState, type ComponentType } from 'react';
import { Helmet } from 'react-helmet-async';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import {
  RefreshCw, Lightbulb, Scale, Lock, Users, Plus, X, CheckCircle2, Clock, Search,
  Layers, CalendarDays, AlertTriangle, CreditCard, Pencil, Trash2, ExternalLink, ChevronRight, Mail,
} from 'lucide-react';
import { SM26BackLink } from '@/components/sm26/SM26BackLink';
import { toast } from '@/hooks/use-toast';
import { Pill, Funnel, ConsoleTile, ConsoleDrawer } from '@/components/sm26/SM26ConsoleUI';
import { SM26YVTimetable, type Cell, type GroupRef, fmtDay, slotRange } from '@/components/sm26/SM26YVTimetable';

// Yachting Ventures console. Gabbi does not assign one juror to one startup: she
// builds jury panels (balanced by juror type), startup batches, and a rotation
// timetable, then asks each panel for their availability BEFORE
// any Zoom invitation goes out. This console mirrors that, while every pairing
// still materializes into sm_jury_assignment so the scorecards, sm_review and
// the official Awards Score keep working untouched.
// Access is enforced server-side by the sm_yv_* RPCs (staff or a
// kind='yachting_ventures' event partner); this page just reflects it.

interface Innovation {
  registration_id: string; role_assignment_id: string; company: string; contact: string | null; email: string;
  reg_status: string; role_status: string; payment_status: string; stage: string | null; categories: string[] | null;
  group_id: string | null; group_code: string | null;
  jurors_assigned: number; jurors_submitted: number; jurors_draft: number;
}
interface Juror {
  registration_id: string; name: string | null; email: string; company: string | null;
  role_status: string; innovation_assignments: number; evaluated: number;
  user_id: string | null; role_assignment_id: string;
  jury_type: string | null; jury_owner: string | null; jury_scope: string | null; panels: string[];
}
interface PoolJuror {
  user_id: string; name: string | null; role_assignment_id: string; email: string; company: string | null;
  jury_type: string | null; jury_owner: string | null; jury_scope: string | null; panel_count: number;
}
interface PanelMember {
  user_id: string; role_assignment_id: string | null; name: string; email: string | null; company: string | null;
  jury_type: string | null; jury_owner: string | null; jury_scope: string | null; role_status: string | null;
}
interface BatchMember {
  role_assignment_id: string; company: string; stage: string | null; categories: string[] | null;
  reg_status: string; payment_status: string;
}
interface Panel { id: string; code: string; name: string | null; members: PanelMember[] }
interface Batch { id: string; code: string; name: string | null; members: BatchMember[] }
interface Assignment { id: string; entry_role_assignment_id: string; juror_user_id: string; juror_name: string; submitted: boolean }

const TYPE_LABEL: Record<string, string> = { angel: 'Angel', vc: 'VC', corporate: 'Corporate' };
const OWNER_LABEL: Record<string, string> = { yv: 'YV', m3: 'M3' };
const typeCls = (t: string | null) =>
  t === 'angel' ? 'bg-violet-50 text-violet-700 border-violet-200'
  : t === 'vc' ? 'bg-blue-50 text-blue-700 border-blue-200'
  : t === 'corporate' ? 'bg-teal-50 text-teal-700 border-teal-200'
  : 'bg-gray-50 text-gray-500 border-gray-200';
const regBadge = (s: string) =>
  s === 'confirmed' ? 'bg-green-50 text-green-700 border-green-200'
  : s === 'declined' ? 'bg-red-50 text-red-600 border-red-200'
  : s === 'cancelled' ? 'bg-gray-50 text-gray-500 border-gray-200'
  : 'bg-blue-50 text-blue-700 border-blue-200';
const payBadge = (s: string) =>
  s === 'paid' || s === 'waived' ? 'bg-green-50 text-green-700 border-green-200'
  : s === 'invoiced' ? 'bg-amber-50 text-amber-700 border-amber-200'
  : 'bg-gray-50 text-gray-500 border-gray-200';

// A panel is flagged when it has no jurors, when a member's Type is still unset,
// or when everyone on it is the same type. Panel SIZE is deliberately not
// checked — how many jurors sit on a panel is Yachting Ventures' call.
function panelMix(members: PanelMember[]) {
  const counts: Record<string, number> = { angel: 0, vc: 0, corporate: 0 };
  let unset = 0;
  for (const m of members) { if (m.jury_type && m.jury_type in counts) counts[m.jury_type]++; else unset++; }
  const kinds = Object.values(counts).filter(n => n > 0).length;
  const label = Object.entries(counts).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${TYPE_LABEL[k]}`).join(' · ')
    + (unset ? `${kinds ? ' · ' : ''}${unset} unset` : '');
  const balanced = members.length > 0 && unset === 0 && (members.length === 1 || kinds >= 2);
  return { counts, unset, kinds, label: label || 'no jurors yet', balanced };
}

type FilterKey = 'ungrouped' | 'nopanel' | 'unbalanced' | 'unscheduled' | 'outstanding' | 'payment';
type Tab = 'timetable' | 'panels' | 'batches' | 'innovations' | 'jurors';
const TILES: { key: FilterKey; tab: Tab; label: string; icon: ComponentType<{ className?: string }>; cls: string; num: string }[] = [
  { key: 'ungrouped', tab: 'innovations', label: 'Startups not in a batch', icon: Lightbulb, cls: 'border-amber-200 bg-amber-50', num: 'text-amber-700' },
  { key: 'nopanel', tab: 'jurors', label: 'Jurors not on a panel', icon: Users, cls: 'border-teal-200 bg-teal-50', num: 'text-teal-700' },
  { key: 'unbalanced', tab: 'panels', label: 'Panels to balance', icon: AlertTriangle, cls: 'border-violet-200 bg-violet-50', num: 'text-violet-700' },
  { key: 'unscheduled', tab: 'timetable', label: 'Slots not sent out', icon: CalendarDays, cls: 'border-blue-200 bg-blue-50', num: 'text-blue-700' },
  { key: 'outstanding', tab: 'jurors', label: 'Evaluations outstanding', icon: Clock, cls: 'border-orange-200 bg-orange-50', num: 'text-orange-700' },
  { key: 'payment', tab: 'innovations', label: 'Payment pending', icon: CreditCard, cls: 'border-rose-200 bg-rose-50', num: 'text-rose-700' },
];
const TABS: { key: Tab; label: string; icon: ComponentType<{ className?: string }> }[] = [
  { key: 'timetable', label: 'Timetable', icon: CalendarDays },
  { key: 'panels', label: 'Jury panels', icon: Scale },
  { key: 'batches', label: 'Startup batches', icon: Layers },
  { key: 'innovations', label: 'Innovations', icon: Lightbulb },
  { key: 'jurors', label: 'Jurors', icon: Users },
];

export function SM26YVPage() {
  const { user } = useAuth();
  const [eventId, setEventId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const [innovations, setInnovations] = useState<Innovation[]>([]);
  const [jurors, setJurors] = useState<Juror[]>([]);
  const [pool, setPool] = useState<PoolJuror[]>([]);
  const [panels, setPanels] = useState<Panel[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [cells, setCells] = useState<Cell[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);

  const [tab, setTab] = useState<Tab>('timetable');
  const [filter, setFilter] = useState<FilterKey | null>(null);
  const [q, setQ] = useState('');
  const [openEntry, setOpenEntry] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);

  const load = async (soft = false) => {
    if (soft) setRefreshing(true); else setLoading(true);
    const { data: ev } = await supabase.from('sm_event').select('id').eq('slug', 'sm26').maybeSingle();
    if (!ev) { setLoading(false); setRefreshing(false); return; }
    const evId = (ev as { id: string }).id;
    setEventId(evId);
    const [inn, jur, poolR, pan, bat, tt, asn] = await Promise.all([
      supabase.rpc('sm_yv_innovations', { p_event_id: evId }),
      supabase.rpc('sm_yv_jurors', { p_event_id: evId }),
      supabase.rpc('sm_yv_assignable_jurors', { p_event_id: evId }),
      supabase.rpc('sm_yv_jury_groups', { p_event_id: evId }),
      supabase.rpc('sm_yv_startup_groups', { p_event_id: evId }),
      supabase.rpc('sm_yv_timetable', { p_event_id: evId }),
      supabase.rpc('sm_yv_assignments', { p_event_id: evId }),
    ]);
    if (inn.error || jur.error) { setDenied(true); setLoading(false); setRefreshing(false); return; }
    setInnovations((inn.data || []) as Innovation[]);
    setJurors((jur.data || []) as Juror[]);
    setPool((poolR.data || []) as PoolJuror[]);
    setPanels((pan.data || []) as Panel[]);
    setBatches((bat.data || []) as Batch[]);
    setCells((tt.data || []) as Cell[]);
    setAssignments((asn.data || []) as Assignment[]);
    setLoading(false); setRefreshing(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // ---- derived ---------------------------------------------------------------
  const panelRefs: GroupRef[] = useMemo(() => panels.map(p => ({ id: p.id, code: p.code, name: p.name, size: p.members.length })), [panels]);
  const batchRefs: GroupRef[] = useMemo(() => batches.map(b => ({ id: b.id, code: b.code, name: b.name, size: b.members.length })), [batches]);

  const counts = useMemo((): Record<FilterKey, number> => ({
    ungrouped: innovations.filter(i => !i.group_id).length,
    nopanel: jurors.filter(j => j.panels.length === 0).length,
    unbalanced: panels.filter(p => !panelMix(p.members).balanced).length,
    unscheduled: cells.filter(c => c.status !== 'cancelled' && !c.zoom_sent).length,
    outstanding: jurors.filter(j => j.innovation_assignments > 0 && j.evaluated < j.innovation_assignments).length,
    payment: innovations.filter(i => i.payment_status !== 'paid' && i.payment_status !== 'waived').length,
  }), [innovations, jurors, panels, cells]);

  const regFunnel = useMemo(() => {
    const paid = innovations.filter(i => i.payment_status === 'paid' || i.payment_status === 'waived').length;
    const confirmed = innovations.filter(i => i.reg_status === 'confirmed').length;
    return { submitted: Math.max(innovations.length - confirmed, 0), confirmed: Math.max(confirmed - paid, 0), paid };
  }, [innovations]);
  const scoreFunnel = useMemo(() => {
    let assigned = 0, drafts = 0, submitted = 0;
    for (const i of innovations) {
      assigned += Math.max(i.jurors_assigned - i.jurors_submitted - i.jurors_draft, 0);
      drafts += i.jurors_draft;
      submitted += i.jurors_submitted;
    }
    return { assigned, drafts, submitted };
  }, [innovations]);

  const needle = q.trim().toLowerCase();
  const matches = (...parts: (string | null | undefined)[]) => !needle || parts.some(p => (p || '').toLowerCase().includes(needle));

  const shownInnovations = useMemo(() => innovations.filter(i => {
    if (filter === 'ungrouped' && i.group_id) return false;
    if (filter === 'payment' && (i.payment_status === 'paid' || i.payment_status === 'waived')) return false;
    return matches(i.company, i.contact, i.email, i.group_code, i.stage);
  }), [innovations, filter, needle]);
  const shownJurors = useMemo(() => jurors.filter(j => {
    if (filter === 'nopanel' && j.panels.length > 0) return false;
    if (filter === 'outstanding' && !(j.innovation_assignments > 0 && j.evaluated < j.innovation_assignments)) return false;
    return matches(j.name, j.email, j.company, j.panels.join(' '));
  }), [jurors, filter, needle]);
  const shownPanels = useMemo(() => panels.filter(p => {
    if (filter === 'unbalanced' && panelMix(p.members).balanced) return false;
    return matches(p.code, p.name, ...p.members.map(m => m.name));
  }), [panels, filter, needle]);
  const shownBatches = useMemo(() => batches.filter(b =>
    matches(b.code, b.name, ...b.members.map(m => m.company))), [batches, needle]);
  const shownCells = useMemo(() => cells.filter(c => {
    if (filter === 'unscheduled' && (c.status === 'cancelled' || c.zoom_sent)) return false;
    return matches(c.title, c.jury_group_code, c.startup_group_code, ...c.entries.map(e => e.company));
  }), [cells, filter, needle]);

  // ---- mutations -------------------------------------------------------------
  const run = async (key: string, fn: () => PromiseLike<{ error: { message: string } | null }>, ok?: string) => {
    setBusy(key);
    const { error } = await fn();
    setBusy(null);
    if (error) { toast({ title: 'That did not work', description: error.message, variant: 'destructive' }); return false; }
    if (ok) toast({ title: ok });
    await load(true);
    return true;
  };
  const createGroup = (kind: 'jury' | 'startup') =>
    run(`new:${kind}`, () => supabase.rpc('sm_yv_group_create', { p_event_id: eventId, p_kind: kind, p_code: null, p_name: null }));
  const renameGroup = (kind: 'jury' | 'startup', g: { id: string; code: string; name: string | null }) => {
    const code = prompt('Code', g.code); if (!code) return;
    const name = prompt('Name (optional)', g.name || '');
    run(`ren:${g.id}`, () => supabase.rpc('sm_yv_group_rename', { p_kind: kind, p_id: g.id, p_code: code, p_name: name }));
  };
  const deleteGroup = (kind: 'jury' | 'startup', g: { id: string; code: string }) => {
    if (!confirm(`Delete ${g.code}? Scores already submitted are never removed.`)) return;
    run(`del:${g.id}`, () => supabase.rpc('sm_yv_group_delete', { p_kind: kind, p_id: g.id }));
  };
  const addMember = (kind: 'jury' | 'startup', groupId: string, memberId: string) =>
    run(`add:${groupId}`, () => supabase.rpc('sm_yv_group_add_member', { p_kind: kind, p_group_id: groupId, p_member_id: memberId }));
  const removeMember = (kind: 'jury' | 'startup', groupId: string, memberId: string) =>
    run(`rm:${groupId}:${memberId}`, () => supabase.rpc('sm_yv_group_remove_member', { p_kind: kind, p_group_id: groupId, p_member_id: memberId }));
  const setJurorMeta = (ra: string, type: string | null, owner: string | null) =>
    run(`meta:${ra}`, () => supabase.rpc('sm_yv_set_juror_meta', { p_role_assignment_id: ra, p_type: type, p_owner: owner }));
  const assignJuror = (entry: string, juror: string) =>
    run(`asg:${entry}`, () => supabase.rpc('sm_yv_assign', { p_entry: entry, p_juror: juror }));
  const unassignJuror = (id: string) =>
    run(`unasg:${id}`, () => supabase.rpc('sm_yv_unassign', { p_id: id }));
  const emailSchedule = async (j: Juror) => {
    if (!j.user_id) return;
    if (!confirm(`Email ${j.name || 'this juror'} their full jury schedule?`)) return;
    setBusy(`sched:${j.user_id}`);
    const { data, error } = await supabase.functions.invoke('sm26-jury-session', { body: { action: 'notify_schedule', juror_user_id: j.user_id } });
    setBusy(null);
    const err = error || (data as { error?: string })?.error;
    if (err) { toast({ title: 'Could not send', description: typeof err === 'string' ? err : undefined, variant: 'destructive' }); return; }
    toast({ title: 'Schedule sent' });
  };

  // ---- drawer ---------------------------------------------------------------
  useEffect(() => {
    if (!openEntry) { setDetail(null); return; }
    let cancelled = false;
    supabase.rpc('sm_jury_entry_detail', { p_entry_id: openEntry }).then(({ data }) => {
      if (!cancelled) setDetail((data || null) as Record<string, unknown> | null);
    });
    return () => { cancelled = true; };
  }, [openEntry]);
  const drawerEntry = openEntry ? innovations.find(i => i.role_assignment_id === openEntry) || null : null;

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

  const allClear = TILES.every(t => counts[t.key] === 0);

  return (
    <div className="min-h-screen bg-gray-50">
      <Helmet><title>Yachting Ventures — Smart Marina Rendezvous 2026</title></Helmet>

      <section className="bg-gradient-to-br from-[#0b2653] to-[#143a6b] text-white">
        <div className="container mx-auto px-4 py-10">
          <div className="mb-4"><SM26BackLink to="/account" label="Back" light /></div>
          <p className="uppercase tracking-wide text-white/60 text-sm mb-1">Yachting Ventures · Innovation scouting</p>
          <h1 className="text-2xl lg:text-3xl font-bold">Jury panels, batches &amp; timetable</h1>
          <p className="text-white/80 mt-2 max-w-2xl">
            Build your panels and startup batches, drop them into time slots, ask each panel if the slot works, and only then
            send the Zoom invitation. Everything you pair here feeds the official scorecards automatically.
          </p>
        </div>
      </section>

      <div className="container mx-auto px-4 py-8 max-w-5xl space-y-6">
        {/* Dashboard */}
        <Card>
          <CardContent className="p-4 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-gray-900">Dashboard</span>
                <span className="text-xs text-gray-400">{innovations.length} innovations · {jurors.length} jurors</span>
              </div>
              <button onClick={() => load(true)} disabled={refreshing} title="Refresh"
                className="inline-flex items-center gap-1.5 text-xs text-gray-600 border border-gray-200 rounded-md px-2.5 py-1.5 hover:bg-gray-50 disabled:opacity-60">
                <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
              </button>
            </div>

            {allClear && (
              <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 shrink-0" /> Nothing outstanding — panels, batches, slots and scores are all up to date.
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
              {TILES.map(t => (
                <ConsoleTile key={t.key} label={t.label} icon={t.icon} cls={t.cls} num={t.num}
                  value={counts[t.key]} active={filter === t.key}
                  onClick={() => { const on = filter === t.key; setFilter(on ? null : t.key); if (!on) setTab(t.tab); }} />
              ))}
            </div>

            <div className="grid sm:grid-cols-2 gap-4 pt-1">
              <Funnel title="Innovation registrations" segments={[
                { label: 'Awaiting confirmation', value: regFunnel.submitted, bar: 'bg-blue-400', dot: 'bg-blue-400' },
                { label: 'Confirmed', value: regFunnel.confirmed, bar: 'bg-amber-400', dot: 'bg-amber-400' },
                { label: 'Paid', value: regFunnel.paid, bar: 'bg-green-500', dot: 'bg-green-500' },
              ]} />
              <Funnel title="Scoring" segments={[
                { label: 'Assigned', value: scoreFunnel.assigned, bar: 'bg-gray-300', dot: 'bg-gray-300' },
                { label: 'In progress', value: scoreFunnel.drafts, bar: 'bg-amber-400', dot: 'bg-amber-400' },
                { label: 'Submitted', value: scoreFunnel.submitted, bar: 'bg-green-500', dot: 'bg-green-500' },
              ]} />
            </div>
          </CardContent>
        </Card>

        {/* Toolbar */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex rounded-lg border border-gray-200 overflow-hidden bg-white">
            {TABS.map(t => {
              const Icon = t.icon;
              return (
                <button key={t.key} onClick={() => setTab(t.key)}
                  className={`px-3 h-9 text-sm inline-flex items-center gap-1.5 ${tab === t.key ? 'bg-primary text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
                  <Icon className="h-3.5 w-3.5" /> <span className="hidden sm:inline">{t.label}</span>
                </button>
              );
            })}
          </div>
          <div className="relative flex-1 min-w-[180px]">
            <Search className="h-4 w-4 text-gray-300 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search…"
              className="w-full text-sm rounded-md border border-gray-200 pl-8 pr-2 py-2 focus:outline-none focus:ring-1 focus:ring-primary" />
          </div>
          {filter && (
            <button onClick={() => setFilter(null)} className="text-xs text-gray-500 inline-flex items-center gap-1 border border-gray-200 rounded-md px-2 py-1.5 hover:bg-gray-50">
              <X className="h-3 w-3" /> Clear filter
            </button>
          )}
        </div>

        {/* ---- Timetable ---- */}
        {tab === 'timetable' && eventId && (
          <SM26YVTimetable eventId={eventId} cells={shownCells} panels={panelRefs} batches={batchRefs}
            testEmail={user?.email || null} onChanged={() => load(true)} />
        )}

        {/* ---- Jury panels ---- */}
        {tab === 'panels' && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="flex items-center gap-2 text-base"><Scale className="h-4 w-4 text-primary" /> Jury panels ({panels.length})</CardTitle>
                <Button size="sm" variant="outline" className="h-8 gap-1.5" disabled={busy === 'new:jury'} onClick={() => createGroup('jury')}><Plus className="h-4 w-4" /> New panel</Button>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Put as many jurors on a panel as you need — there is no fixed size. Set each juror's type on the Jurors tab:
                a panel is flagged until every member has one and, from two jurors up, at least two types are represented.
              </p>
            </CardHeader>
            <CardContent className="space-y-2">
              {panels.length === 0 && <p className="text-sm text-gray-400">No panels yet. Create one, then add jurors to it.</p>}
              {shownPanels.map(p => {
                const mix = panelMix(p.members);
                const taken = new Set(p.members.map(m => m.user_id));
                const available = pool.filter(j => !taken.has(j.user_id));
                return (
                  <div key={p.id} className="rounded-lg border border-gray-200 p-3">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2 flex-wrap min-w-0">
                        <span className="text-sm font-semibold">{p.code}</span>
                        {p.name && <span className="text-sm text-gray-500 truncate">{p.name}</span>}
                        <Pill label={`${p.members.length} juror${p.members.length === 1 ? '' : 's'}`} cls="bg-gray-50 text-gray-600 border-gray-200" />
                        <Pill label={mix.label} cls={mix.balanced ? 'bg-green-50 text-green-700 border-green-200' : 'bg-amber-50 text-amber-700 border-amber-200'} />
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-gray-400 hover:text-gray-700" title="Rename" onClick={() => renameGroup('jury', p)}><Pencil className="h-3.5 w-3.5" /></Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-gray-400 hover:text-red-600" title="Delete panel" onClick={() => deleteGroup('jury', p)}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {p.members.map(m => (
                        <span key={m.user_id} className={`inline-flex items-center gap-1 text-xs rounded-full pl-2 pr-1 py-0.5 border ${typeCls(m.jury_type)}`}>
                          {m.name}
                          <span className="opacity-70">· {m.jury_type ? TYPE_LABEL[m.jury_type] : 'type unset'}{m.jury_owner ? ` · ${OWNER_LABEL[m.jury_owner]}` : ''}</span>
                          <button onClick={() => removeMember('jury', p.id, m.user_id)} disabled={!!busy} className="hover:bg-black/10 rounded-full p-0.5" title="Remove"><X className="h-3 w-3" /></button>
                        </span>
                      ))}
                      {p.members.length === 0 && <span className="text-xs text-gray-400">No jurors yet.</span>}
                    </div>
                    <select value="" disabled={!!busy || available.length === 0}
                      onChange={e => { const v = e.target.value; e.target.value = ''; if (v) addMember('jury', p.id, v); }}
                      className="mt-2 h-8 rounded-md border border-gray-200 px-2 text-sm bg-white disabled:opacity-50 w-full sm:w-72">
                      <option value="">{available.length ? 'Add a juror…' : 'Every juror is already on this panel'}</option>
                      {available.map(j => (
                        <option key={j.user_id} value={j.user_id}>
                          {j.name || j.email}{j.jury_type ? ` — ${TYPE_LABEL[j.jury_type]}` : ' — type unset'}{j.jury_owner ? ` (${OWNER_LABEL[j.jury_owner]})` : ''}{j.panel_count ? ` · on ${j.panel_count} panel${j.panel_count > 1 ? 's' : ''}` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
              {pool.length === 0 && (
                <p className="text-xs text-amber-600">No jurors are assignable yet — a juror becomes available once they have an account and their jury role is confirmed.</p>
              )}
            </CardContent>
          </Card>
        )}

        {/* ---- Startup batches ---- */}
        {tab === 'batches' && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="flex items-center gap-2 text-base"><Layers className="h-4 w-4 text-primary" /> Startup batches ({batches.length})</CardTitle>
                <Button size="sm" variant="outline" className="h-8 gap-1.5" disabled={busy === 'new:startup'} onClick={() => createGroup('startup')}><Plus className="h-4 w-4" /> New batch</Button>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                A batch is the startups heard together in one session — put as many in it as you want.  {counts.ungrouped > 0
                  ? <span className="text-amber-700 font-medium">{counts.ungrouped} startup{counts.ungrouped === 1 ? ' is' : 's are'} not in a batch yet.</span>
                  : 'Every startup is in a batch.'}
              </p>
            </CardHeader>
            <CardContent className="space-y-2">
              {batches.length === 0 && <p className="text-sm text-gray-400">No batches yet. Create one, then add startups to it.</p>}
              {shownBatches.map(b => {
                const taken = new Set(b.members.map(m => m.role_assignment_id));
                const available = innovations.filter(i => !taken.has(i.role_assignment_id));
                return (
                  <div key={b.id} className="rounded-lg border border-gray-200 p-3">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2 flex-wrap min-w-0">
                        <span className="text-sm font-semibold">{b.code}</span>
                        {b.name && <span className="text-sm text-gray-500 truncate">{b.name}</span>}
                        <Pill label={`${b.members.length} startup${b.members.length === 1 ? '' : 's'}`}
                          cls={b.members.length > 0 ? 'bg-gray-50 text-gray-600 border-gray-200' : 'bg-amber-50 text-amber-700 border-amber-200'} />
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-gray-400 hover:text-gray-700" title="Rename" onClick={() => renameGroup('startup', b)}><Pencil className="h-3.5 w-3.5" /></Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-gray-400 hover:text-red-600" title="Delete batch" onClick={() => deleteGroup('startup', b)}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {b.members.map(m => (
                        <span key={m.role_assignment_id} className="inline-flex items-center gap-1 text-xs rounded-full pl-2 pr-1 py-0.5 border bg-white border-gray-200 text-gray-700">
                          <button className="hover:underline" onClick={() => setOpenEntry(m.role_assignment_id)}>{m.company}</button>
                          {m.stage && <span className="text-gray-400">· {m.stage}</span>}
                          {(m.payment_status !== 'paid' && m.payment_status !== 'waived') && <span className="text-rose-600">· {m.payment_status}</span>}
                          <button onClick={() => removeMember('startup', b.id, m.role_assignment_id)} disabled={!!busy} className="hover:bg-black/10 rounded-full p-0.5" title="Remove"><X className="h-3 w-3" /></button>
                        </span>
                      ))}
                      {b.members.length === 0 && <span className="text-xs text-gray-400">No startups yet.</span>}
                    </div>
                    <select value="" disabled={!!busy || available.length === 0}
                      onChange={e => { const v = e.target.value; e.target.value = ''; if (v) addMember('startup', b.id, v); }}
                      className="mt-2 h-8 rounded-md border border-gray-200 px-2 text-sm bg-white disabled:opacity-50 w-full sm:w-72">
                      <option value="">{available.length ? 'Add a startup…' : 'Every startup is already in this batch'}</option>
                      {available.map(i => (
                        <option key={i.role_assignment_id} value={i.role_assignment_id}>
                          {i.company}{i.stage ? ` — ${i.stage}` : ''}{i.group_code ? ` · already in ${i.group_code}` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}

        {/* ---- Innovations ---- */}
        {tab === 'innovations' && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><Lightbulb className="h-4 w-4 text-primary" /> Innovation entries ({shownInnovations.length})</CardTitle>
              <p className="text-xs text-gray-500 mt-1">Click a row to open its full entry, its batch, the panels reviewing it and each juror's status.</p>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
                    <th className="px-4 py-2">Company</th><th className="px-4 py-2">Batch</th><th className="px-4 py-2">Registration</th>
                    <th className="px-4 py-2">Payment</th><th className="px-4 py-2">Stage</th><th className="px-4 py-2">Scored</th><th className="px-4 py-2" />
                  </tr></thead>
                  <tbody>
                    {shownInnovations.map(i => (
                      <tr key={i.registration_id} className="border-b border-gray-50 align-top hover:bg-gray-50 cursor-pointer" onClick={() => setOpenEntry(i.role_assignment_id)}>
                        <td className="px-4 py-2.5"><div className="font-medium">{i.company}</div><div className="text-xs text-gray-400">{i.contact || i.email}</div></td>
                        <td className="px-4 py-2.5">{i.group_code ? <Pill label={i.group_code} cls="bg-blue-50 text-blue-700 border-blue-200" /> : <span className="text-xs text-amber-600">not grouped</span>}</td>
                        <td className="px-4 py-2.5"><Pill label={i.reg_status} cls={regBadge(i.reg_status)} /></td>
                        <td className="px-4 py-2.5"><Pill label={i.payment_status} cls={payBadge(i.payment_status)} /></td>
                        <td className="px-4 py-2.5 text-gray-500">{i.stage || '—'}</td>
                        <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">{i.jurors_assigned ? `${i.jurors_submitted}/${i.jurors_assigned}` : '—'}</td>
                        <td className="px-4 py-2.5 text-gray-300"><ChevronRight className="h-4 w-4" /></td>
                      </tr>
                    ))}
                    {shownInnovations.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-400">No innovation entries match.</td></tr>}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ---- Jurors ---- */}
        {tab === 'jurors' && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><Users className="h-4 w-4 text-primary" /> Jurors ({shownJurors.length})</CardTitle>
              <p className="text-xs text-gray-500 mt-1">
                Set each juror's <b>type</b> and <b>relationship owner</b> here — the panel builder uses them to flag an unbalanced mix.
                "Evaluations" counts how many of their assigned startups they have scored.
              </p>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
                    <th className="px-4 py-2">Juror</th><th className="px-4 py-2">Type</th><th className="px-4 py-2">Owner</th>
                    <th className="px-4 py-2">Panels</th><th className="px-4 py-2">Evaluations</th><th className="px-4 py-2" />
                  </tr></thead>
                  <tbody>
                    {shownJurors.map(j => (
                      <tr key={j.registration_id} className="border-b border-gray-50">
                        <td className="px-4 py-2.5">
                          <div className="font-medium">{j.name || '—'}</div>
                          <div className="text-xs text-gray-400">{j.email}{j.company ? ` · ${j.company}` : ''}</div>
                          <div className="flex items-center gap-1 mt-0.5">
                            <Pill label={j.role_status} cls={regBadge(j.role_status === 'confirmed' ? 'confirmed' : j.role_status === 'declined' ? 'declined' : 'submitted')} />
                            {!j.user_id && <Pill label="no account yet" cls="bg-amber-50 text-amber-700 border-amber-200" />}
                            {!j.jury_scope && <Pill label="competition unset" cls="bg-gray-50 text-gray-500 border-gray-200" />}
                          </div>
                        </td>
                        <td className="px-4 py-2.5">
                          <select value={j.jury_type || ''} disabled={!!busy}
                            onChange={e => setJurorMeta(j.role_assignment_id, e.target.value || null, j.jury_owner)}
                            className="h-8 rounded-md border border-gray-200 px-2 text-xs bg-white">
                            <option value="">unset</option>
                            <option value="angel">Angel</option>
                            <option value="vc">VC</option>
                            <option value="corporate">Corporate</option>
                          </select>
                        </td>
                        <td className="px-4 py-2.5">
                          <select value={j.jury_owner || ''} disabled={!!busy}
                            onChange={e => setJurorMeta(j.role_assignment_id, j.jury_type, e.target.value || null)}
                            className="h-8 rounded-md border border-gray-200 px-2 text-xs bg-white">
                            <option value="">unset</option>
                            <option value="yv">YV</option>
                            <option value="m3">M3</option>
                          </select>
                        </td>
                        <td className="px-4 py-2.5">
                          {j.panels.length
                            ? <div className="flex flex-wrap gap-1">{j.panels.map(c => <Pill key={c} label={c} cls="bg-blue-50 text-blue-700 border-blue-200" />)}</div>
                            : <span className="text-xs text-gray-400">none</span>}
                        </td>
                        <td className="px-4 py-2.5">
                          {j.innovation_assignments === 0
                            ? <span className="text-gray-400 text-xs">Not assigned</span>
                            : <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border whitespace-nowrap ${j.evaluated >= j.innovation_assignments ? 'bg-green-50 text-green-700 border-green-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
                                {j.evaluated >= j.innovation_assignments ? <CheckCircle2 className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
                                {j.evaluated}/{j.innovation_assignments}
                              </span>}
                        </td>
                        <td className="px-4 py-2.5">
                          {j.user_id && cells.some(c => c.status !== 'cancelled' && c.jurors.some(x => x.user_id === j.user_id)) && (
                            <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs text-gray-500" disabled={!!busy} onClick={() => emailSchedule(j)} title="Email this juror their full schedule">
                              <Mail className="h-3.5 w-3.5" /> Schedule
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                    {shownJurors.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-400">No jurors match.</td></tr>}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* ---- Drawer: one innovation ---- */}
      {openEntry && (
        <ConsoleDrawer onClose={() => setOpenEntry(null)}>
          <EntryDrawer
            entry={drawerEntry}
            detail={detail}
            cells={cells}
            assignments={assignments.filter(a => a.entry_role_assignment_id === openEntry)}
            pool={pool}
            busy={busy}
            onClose={() => setOpenEntry(null)}
            onAssign={j => assignJuror(openEntry, j)}
            onUnassign={unassignJuror}
          />
        </ConsoleDrawer>
      )}
    </div>
  );
}

// ---- Drawer body -------------------------------------------------------------
function EntryDrawer({ entry, detail, cells, assignments, pool, busy, onClose, onAssign, onUnassign }: {
  entry: Innovation | null;
  detail: Record<string, unknown> | null;
  cells: Cell[];
  assignments: Assignment[];
  pool: PoolJuror[];
  busy: string | null;
  onClose: () => void;
  onAssign: (jurorUserId: string) => void;
  onUnassign: (assignmentId: string) => void;
}) {
  if (!entry) return <div className="flex items-center justify-center h-40"><RefreshCw className="h-6 w-6 animate-spin text-gray-300" /></div>;
  const fields = (detail?.fields || {}) as Record<string, string>;
  const website = typeof detail?.website === 'string' ? detail.website : null;
  const mySessions = cells.filter(c => c.status !== 'cancelled' && c.entries.some(e => e.role_assignment_id === entry.role_assignment_id));
  const assignedIds = new Set(assignments.map(a => a.juror_user_id));
  const available = pool.filter(j => !assignedIds.has(j.user_id));

  return (
    <div>
      <div className="sticky top-0 bg-white border-b border-gray-100 px-4 py-3 flex items-start justify-between gap-2 z-10">
        <div className="min-w-0">
          <div className="font-semibold text-gray-900 truncate">{entry.company}</div>
          <div className="text-xs text-gray-400 truncate">{entry.contact ? `${entry.contact} · ` : ''}{entry.email}</div>
        </div>
        <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={onClose}><X className="h-4 w-4" /></Button>
      </div>

      <div className="p-4 space-y-4">
        <div className="flex flex-wrap gap-1.5">
          <Pill label={entry.reg_status} cls={regBadge(entry.reg_status)} />
          <Pill label={entry.payment_status} cls={payBadge(entry.payment_status)} />
          {entry.stage && <Pill label={entry.stage} cls="bg-gray-50 text-gray-600 border-gray-200" />}
          {entry.group_code
            ? <Pill label={`Batch ${entry.group_code}`} cls="bg-blue-50 text-blue-700 border-blue-200" />
            : <Pill label="not in a batch" cls="bg-amber-50 text-amber-700 border-amber-200" />}
        </div>
        {website && (
          <a href={website} target="_blank" rel="noreferrer" className="text-sm text-primary inline-flex items-center gap-1">{website} <ExternalLink className="h-3 w-3" /></a>
        )}

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><CalendarDays className="h-4 w-4 text-primary" /> Sessions reviewing this startup</CardTitle></CardHeader>
          <CardContent className="space-y-1.5">
            {mySessions.length === 0 && <p className="text-sm text-gray-400">Not scheduled yet — add its batch to a slot on the timetable.</p>}
            {mySessions.map(c => (
              <div key={c.id} className="rounded-lg border border-gray-100 px-3 py-2">
                <div className="text-sm font-medium">{c.jury_group_code} <span className="text-gray-300">×</span> {c.startup_group_code}</div>
                <div className="text-xs text-gray-400">{fmtDay(c.scheduled_at)} · {c.slot_label || slotRange(c.scheduled_at, c.duration_minutes)}</div>
                <div className="flex flex-wrap gap-1 mt-1">
                  {c.jurors.map(j => (
                    <span key={j.user_id} className={`text-[11px] rounded-full border px-2 py-0.5 ${j.rsvp === 'unavailable' ? 'bg-red-50 text-red-600 border-red-200' : j.rsvp === 'invited' ? 'bg-gray-50 text-gray-500 border-gray-200' : 'bg-green-50 text-green-700 border-green-200'}`}>{j.name}</span>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><Scale className="h-4 w-4 text-primary" /> Jurors &amp; scores ({entry.jurors_submitted}/{entry.jurors_assigned})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {assignments.length === 0 && <p className="text-sm text-gray-400">No juror assigned yet. Pairing a panel with this startup's batch assigns them automatically.</p>}
            <div className="flex flex-wrap gap-1.5">
              {assignments.map(a => (
                <span key={a.id} title={a.submitted ? 'Evaluation submitted' : 'Not evaluated yet'}
                  className={`inline-flex items-center gap-1 text-xs rounded-full pl-2 pr-1 py-0.5 border ${a.submitted ? 'bg-green-50 text-green-700 border-green-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
                  {a.submitted ? <CheckCircle2 className="h-3 w-3 shrink-0" /> : <Clock className="h-3 w-3 shrink-0" />}
                  {a.juror_name}
                  <button onClick={() => onUnassign(a.id)} disabled={!!busy} className="hover:bg-black/10 rounded-full p-0.5" title="Remove"><X className="h-3 w-3" /></button>
                </span>
              ))}
            </div>
            <select value="" disabled={!!busy || available.length === 0}
              onChange={e => { const v = e.target.value; e.target.value = ''; if (v) onAssign(v); }}
              className="h-8 rounded-md border border-gray-200 px-2 text-sm bg-white disabled:opacity-50 w-full">
              <option value="">{available.length ? 'Assign an extra juror (exception)…' : 'Every juror is assigned'}</option>
              {available.map(j => <option key={j.user_id} value={j.user_id}>{j.name || j.email}</option>)}
            </select>
            <p className="text-[11px] text-gray-400">Use this only for one-offs — normal assignment happens when a panel is paired with a batch.</p>
          </CardContent>
        </Card>

        {Object.keys(fields).length > 0 && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Lightbulb className="h-4 w-4 text-primary" /> Entry</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {Object.entries(fields).map(([k, v]) => (
                <div key={k}>
                  <div className="text-[11px] uppercase tracking-wide text-gray-400">{k}</div>
                  <div className="text-sm text-gray-800 whitespace-pre-wrap">{v}</div>
                </div>
              ))}
              {entry.categories && entry.categories.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {entry.categories.map(c => <Pill key={c} label={c} cls="bg-gray-50 text-gray-600 border-gray-200" />)}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
