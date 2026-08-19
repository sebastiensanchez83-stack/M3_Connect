import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, ArrowLeft, Scale, X, Trophy, AlertTriangle, Users, Check, CalendarDays, Layers, ExternalLink, Video } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { Pill } from '@/components/sm26/SM26ConsoleUI';
import { cellState, fmtDay, slotRange, type Cell } from '@/components/sm26/SM26YVTimetable';

// Admin jury management: assign jurors to entries, see the panels/batches/
// timetable Yachting Ventures built, and read the official rankings.
// Awards Score (mandatory, non-COI, submitted) is computed in sm_admin_rankings.

type Comp = 'innovation' | 'architecture_pro' | 'architecture_student';
interface Juror { user_id: string; name: string; scope: string | null; }
interface JuryRole {
  id: string; status: string; user_id: string | null; name: string; email: string | null; scope: string | null;
  juryType: string | null; juryOwner: string | null;
}
interface GroupRow { id: string; code: string; name: string | null; members: Record<string, unknown>[] }
interface Entry { id: string; competition: Comp; title: string; subtitle: string; }
interface Assignment { id: string; juror_user_id: string; entry_role_assignment_id: string; mandatory: boolean; }
interface Ranking {
  entry_id: string; title: string; subtitle: string; reviews: number;
  awards_score: number | null; score_min: number | null; score_max: number | null; score_stddev: number | null;
  avg_confidence: number | null; coi_count: number; assigned: number; submitted: number;
}

const COMPETITIONS: { key: Comp; label: string }[] = [
  { key: 'innovation', label: 'Innovation' },
  { key: 'architecture_pro', label: 'Architecture · Pro' },
  { key: 'architecture_student', label: 'Architecture · Student' },
];

export function AdminSM26Jury({ embedded = false }: { embedded?: boolean } = {}) {
  const navigate = useNavigate();
  const [eventId, setEventId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'assign' | 'panels' | 'rankings'>('assign');
  const [competition, setCompetition] = useState<Comp>('innovation');

  const [jurors, setJurors] = useState<Juror[]>([]);
  const [juryRoles, setJuryRoles] = useState<JuryRole[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  // synthetic juror_user_id -> external reviewer name
  const [externals, setExternals] = useState<Record<string, string>>({});
  const [rankings, setRankings] = useState<Ranking[]>([]);
  const [panels, setPanels] = useState<GroupRow[]>([]);
  const [batches, setBatches] = useState<GroupRow[]>([]);
  const [cells, setCells] = useState<Cell[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => { load(); }, []);
  useEffect(() => { if (eventId && tab === 'rankings') loadRankings(); }, [eventId, tab, competition]);

  const load = async () => {
    setLoading(true);
    const { data: ev } = await supabase.from('sm_event').select('id').eq('slug', 'sm26').maybeSingle();
    if (!ev) { setLoading(false); return; }
    const eid = (ev as { id: string }).id;
    setEventId(eid);

    // Staff pass sm_is_yv(), so the panel / batch / timetable RPCs are readable here too.
    supabase.rpc('sm_yv_jury_groups', { p_event_id: eid }).then(r => setPanels((r.data || []) as GroupRow[]));
    supabase.rpc('sm_yv_startup_groups', { p_event_id: eid }).then(r => setBatches((r.data || []) as GroupRow[]));
    supabase.rpc('sm_yv_timetable', { p_event_id: eid }).then(r => setCells((r.data || []) as Cell[]));

    const [{ data: ents }, { data: jur }, { data: asg }, { data: ext }] = await Promise.all([
      supabase.from('sm_role_assignment')
        .select('id, role, status, registration:sm_registration(company_name,first_name,last_name,status), startup:sm_startup_profile(stage), arch:sm_architecture_entry(category,anon_code)')
        .eq('event_id', eid).in('role', ['startup', 'architect_pro', 'architect_student']).neq('status', 'declined'),
      supabase.from('sm_role_assignment')
        .select('id, status, module_data, registration:sm_registration(user_id,first_name,last_name,email,status)')
        .eq('event_id', eid).eq('role', 'jury').neq('status', 'declined'),
      supabase.from('sm_jury_assignment').select('id, juror_user_id, entry_role_assignment_id, mandatory').eq('event_id', eid),
      // External architecture reviewers score under a synthetic juror_user_id with
      // no profile behind it. Without this they show up as anonymous "Juror" chips
      // that look like junk — and removing one silently drops their score out of
      // the Awards Score, which joins sm_review to sm_jury_assignment on that id.
      supabase.from('sm_architecture_reviewer').select('juror_user_id, name').eq('event_id', eid),
    ]);

    const mapEntry = (r: Record<string, unknown>): Entry => {
      const reg = (r.registration || {}) as { company_name?: string; first_name?: string; last_name?: string };
      const startup = (r.startup || {}) as { stage?: string };
      const arch = (r.arch || {}) as { category?: string; anon_code?: string };
      const isInnovation = r.role === 'startup';
      const comp: Comp = isInnovation ? 'innovation' : r.role === 'architect_pro' ? 'architecture_pro' : 'architecture_student';
      return {
        id: r.id as string,
        competition: comp,
        title: isInnovation
          ? (reg.company_name || `${reg.first_name || ''} ${reg.last_name || ''}`.trim() || 'Entry')
          : `Entry ${arch.anon_code || (r.id as string).slice(0, 8)}`,
        subtitle: isInnovation ? (startup.stage || '') : (arch.category || ''),
      };
    };
    // A withdrawn registration is excluded from the rankings just like a declined
    // one, so it must not be assignable here either — otherwise you can spend
    // jury time on an entry that will never be ranked. Same for a juror who
    // withdrew: they can no longer score.
    const regHidden = (r: Record<string, unknown>) =>
      ['declined', 'cancelled'].includes(String(((r.registration || {}) as { status?: string }).status || ''));

    setEntries(((ents || []) as Record<string, unknown>[]).filter(r => !regHidden(r)).map(mapEntry));

    const jr: JuryRole[] = ((jur || []) as Record<string, unknown>[]).filter(r => !regHidden(r)).map(row => {
      const reg = (row.registration || {}) as { user_id?: string; first_name?: string; last_name?: string; email?: string };
      const md = (row.module_data || {}) as Record<string, unknown>;
      return {
        id: row.id as string,
        status: row.status as string,
        user_id: reg.user_id || null,
        name: `${reg.first_name || ''} ${reg.last_name || ''}`.trim() || reg.email || 'Juror',
        email: reg.email || null,
        scope: typeof md.jury_scope === 'string' ? md.jury_scope : null,
        juryType: typeof md.jury_type === 'string' ? md.jury_type : null,
        juryOwner: typeof md.jury_owner === 'string' ? md.jury_owner : null,
      };
    });
    setJuryRoles(jr);
    // Only confirmed jurors WITH an account can be assigned (they log in to score).
    const jmap = new Map<string, Juror>();
    for (const j of jr) if (j.status === 'confirmed' && j.user_id) jmap.set(j.user_id, { user_id: j.user_id, name: j.name, scope: j.scope });
    setJurors([...jmap.values()]);
    setAssignments((asg || []) as Assignment[]);
    setExternals(Object.fromEntries(((ext || []) as { juror_user_id: string; name: string }[])
      .map(r => [r.juror_user_id, `${r.name} (external)`])));
    setLoading(false);
  };

  const setJuryStatus = async (id: string, status: string) => {
    setBusy(true);
    const { error } = await supabase.from('sm_role_assignment').update({ status }).eq('id', id);
    setBusy(false);
    if (error) { toast({ title: 'Could not update', description: error.message, variant: 'destructive' }); return; }
    await load();
  };

  // Which competition(s) this juror judges. Innovation jurors are assigned per
  // entry; architecture jurors evaluate all architecture entries.
  const setScope = async (id: string, scope: string) => {
    setBusy(true);
    const { error } = await supabase.rpc('sm_set_jury_scope', { p_role_assignment_id: id, p_scope: scope || null });
    setBusy(false);
    if (error) { toast({ title: 'Could not set competition', description: error.message, variant: 'destructive' }); return; }
    await load();
  };

  // Juror Type / relationship owner — the same fields Yachting Ventures use to
  // balance a panel, editable here so staff can do everything YV can.
  const setJurorMeta = async (id: string, type: string | null, owner: string | null) => {
    setBusy(true);
    const { error } = await supabase.rpc('sm_yv_set_juror_meta', { p_role_assignment_id: id, p_type: type, p_owner: owner });
    setBusy(false);
    if (error) { toast({ title: 'Could not update', description: error.message, variant: 'destructive' }); return; }
    await load();
  };

  const confirmAllPending = async () => {
    const pending = juryRoles.filter(j => j.status !== 'confirmed');
    if (!pending.length) return;
    setBusy(true);
    const { error } = await supabase.from('sm_role_assignment').update({ status: 'confirmed' }).in('id', pending.map(j => j.id));
    setBusy(false);
    if (error) { toast({ title: 'Could not confirm', description: error.message, variant: 'destructive' }); return; }
    toast({ title: `Confirmed ${pending.length} juror${pending.length > 1 ? 's' : ''}` });
    await load();
  };

  const loadRankings = async () => {
    if (!eventId) return;
    const { data } = await supabase.rpc('sm_admin_rankings', { p_event_id: eventId, p_competition: competition });
    setRankings((data || []) as Ranking[]);
  };

  const jurorName = (uid: string) =>
    jurors.find(j => j.user_id === uid)?.name || externals[uid] || 'Juror';
  const entryAssignments = (entryId: string) => assignments.filter(a => a.entry_role_assignment_id === entryId);

  const assign = async (entry: Entry, jurorId: string) => {
    if (!eventId || !jurorId) return;
    setBusy(true);
    const { data, error } = await supabase.from('sm_jury_assignment').insert({
      event_id: eventId, juror_user_id: jurorId, entry_role_assignment_id: entry.id,
      competition: entry.competition, mandatory: true,
    }).select('id, juror_user_id, entry_role_assignment_id, mandatory').single();
    setBusy(false);
    if (error) {
      // 23505 = the UNIQUE(juror, entry): Yachting Ventures assigned them from
      // their own console, or this tab has gone stale. Say that, not the raw
      // constraint name, and pull the current list in.
      const duplicate = (error as { code?: string }).code === '23505';
      toast({
        title: duplicate ? 'Already assigned' : 'Could not assign',
        description: duplicate
          ? 'This juror is already on that entry — refreshing to show the current assignments.'
          : error.message,
        variant: 'destructive',
      });
      if (duplicate) load();
      return;
    }
    setAssignments(prev => [...prev, data as Assignment]);
  };

  const unassign = async (a: Assignment) => {
    setBusy(true);
    const { error } = await supabase.from('sm_jury_assignment').delete().eq('id', a.id);
    setBusy(false);
    if (error) { toast({ title: 'Could not remove', description: error.message, variant: 'destructive' }); return; }
    setAssignments(prev => prev.filter(x => x.id !== a.id));
  };

  if (loading) return <div className="flex items-center justify-center h-64"><RefreshCw className="h-8 w-8 animate-spin text-gray-400" /></div>;

  const compEntries = entries.filter(e => e.competition === competition);
  const pendingCount = juryRoles.filter(j => j.status !== 'confirmed').length;

  return (
    <div className="space-y-4">
      {!embedded && <Button variant="ghost" size="sm" onClick={() => navigate('/admin/sm26')} className="gap-1.5"><ArrowLeft className="h-4 w-4" /> Back to registrations</Button>}

      <div className="flex items-center justify-between gap-3 flex-wrap">
        {embedded ? <span /> : <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Scale className="h-6 w-6 text-primary" /> Jury &amp; evaluation</h1>}
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => { load(); if (tab === 'rankings') loadRankings(); }} title="Refresh"><RefreshCw className="h-4 w-4" /></Button>
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            <button onClick={() => setTab('assign')} className={`px-3 h-9 text-sm ${tab === 'assign' ? 'bg-primary text-white' : 'bg-white text-gray-600'}`}>Assignments</button>
            <button onClick={() => setTab('panels')} className={`px-3 h-9 text-sm ${tab === 'panels' ? 'bg-primary text-white' : 'bg-white text-gray-600'}`}>Panels &amp; timetable</button>
            <button onClick={() => setTab('rankings')} className={`px-3 h-9 text-sm ${tab === 'rankings' ? 'bg-primary text-white' : 'bg-white text-gray-600'}`}>Rankings</button>
          </div>
          <Select value={competition} onValueChange={v => setCompetition(v as Comp)}>
            <SelectTrigger className="w-40 h-9"><SelectValue /></SelectTrigger>
            <SelectContent>{COMPETITIONS.map(c => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      {/* Jurors panel — confirm jurors so they enter the assignment pool */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-4">
          <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
            <div className="text-sm font-semibold text-gray-800 flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" /> Jurors
              <span className="text-xs font-normal text-gray-400">{jurors.length} ready · {pendingCount} pending</span>
            </div>
            {pendingCount > 0 && <Button size="sm" onClick={confirmAllPending} disabled={busy} className="gap-1.5"><Check className="h-4 w-4" /> Confirm all pending</Button>}
          </div>
          <p className="text-xs text-gray-400 mb-3">A juror joins the scoring pool once <b>confirmed</b> and they have an account. Set each juror's <b>competition</b>: Innovation jurors are assigned per entry (below, or by Yachting Ventures); Architecture jurors evaluate all architecture entries.</p>
          {juryRoles.length === 0 ? (
            <p className="text-sm text-gray-400">No jury-role participants yet. Add a "Jury" role to a registration first.</p>
          ) : (
            <div className="space-y-1.5">
              {juryRoles.map(j => {
                const confirmed = j.status === 'confirmed';
                return (
                  <div key={j.id} className="flex items-center justify-between gap-2 rounded-lg border border-gray-100 px-3 py-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-gray-800 truncate">{j.name}</div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <Badge className={`text-[10px] ${confirmed ? 'bg-green-50 text-green-700 border-green-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>{confirmed ? 'Confirmed' : 'Pending'}</Badge>
                        {!j.user_id && <span className="text-[10px] text-gray-400">no account yet — can't score until they claim their registration</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                      <Select value={j.scope || 'none'} onValueChange={v => setScope(j.id, v === 'none' ? '' : v)} disabled={busy}>
                        <SelectTrigger className="w-36 h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Competition: unset</SelectItem>
                          <SelectItem value="innovation">Innovation</SelectItem>
                          <SelectItem value="architecture">Architecture</SelectItem>
                          <SelectItem value="both">Both</SelectItem>
                        </SelectContent>
                      </Select>
                      <Select value={j.juryType || 'none'} onValueChange={v => setJurorMeta(j.id, v === 'none' ? null : v, j.juryOwner)} disabled={busy}>
                        <SelectTrigger className="w-32 h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Type: unset</SelectItem>
                          <SelectItem value="angel">Angel</SelectItem>
                          <SelectItem value="vc">VC</SelectItem>
                          <SelectItem value="corporate">Corporate</SelectItem>
                        </SelectContent>
                      </Select>
                      <Select value={j.juryOwner || 'none'} onValueChange={v => setJurorMeta(j.id, j.juryType, v === 'none' ? null : v)} disabled={busy}>
                        <SelectTrigger className="w-28 h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Owner: unset</SelectItem>
                          <SelectItem value="yv">YV</SelectItem>
                          <SelectItem value="m3">M3</SelectItem>
                        </SelectContent>
                      </Select>
                      {confirmed
                        ? <Button size="sm" variant="ghost" className="h-8 text-gray-400 hover:text-amber-700" disabled={busy} onClick={() => setJuryStatus(j.id, 'self_submitted')}>Unconfirm</Button>
                        : <Button size="sm" variant="outline" className="h-8 gap-1.5" disabled={busy} onClick={() => setJuryStatus(j.id, 'confirmed')}><Check className="h-3.5 w-3.5" /> Confirm</Button>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {tab === 'panels' ? (
        <div className="space-y-4">
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4 flex items-start justify-between gap-3 flex-wrap">
              <p className="text-xs text-gray-500 max-w-2xl">
                Yachting Ventures build the panels, the startup batches and the rotation here below. Pairing a panel with a
                batch is what creates the assignments on the left. To edit them, or to send an availability request or a Zoom
                invitation, open the full console — staff have the same rights there as YV.
              </p>
              <Button size="sm" variant="outline" className="gap-1.5 shrink-0" onClick={() => window.open('/sm26/yv', '_blank')}>
                <ExternalLink className="h-4 w-4" /> Open the YV console
              </Button>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardContent className="p-4">
              <div className="text-sm font-semibold text-gray-800 flex items-center gap-2 mb-3">
                <CalendarDays className="h-4 w-4 text-primary" /> Timetable
                <span className="text-xs font-normal text-gray-400">{cells.filter(c => c.status !== 'cancelled').length} slot(s)</span>
              </div>
              {cells.length === 0 ? <p className="text-sm text-gray-400">No jury session scheduled yet.</p> : (
                <div className="space-y-1.5">
                  {cells.map(c => {
                    const yes = c.jurors.filter(j => j.rsvp === 'available' || j.rsvp === 'confirmed').length;
                    return (
                      <div key={c.id} className={`rounded-lg border border-gray-100 px-3 py-2 ${c.status === 'cancelled' ? 'opacity-50' : ''}`}>
                        <div className="flex items-center gap-2 flex-wrap text-sm">
                          <span className="font-medium">{c.jury_group_code || '—'} × {c.startup_group_code || '—'}</span>
                          <span className="text-gray-400 text-xs">{fmtDay(c.scheduled_at)} · {c.slot_label || slotRange(c.scheduled_at, c.duration_minutes)}</span>
                          {c.is_test && <Pill label="TEST" cls="bg-purple-50 text-purple-700 border-purple-200" />}
                          <Pill label={cellState(c) === 'cancelled' ? 'cancelled' : cellState(c) === 'draft' ? 'draft' : cellState(c) === 'asked' ? 'availability requested' : cellState(c) === 'invited' ? 'Zoom sent' : 'all scores in'}
                            cls={cellState(c) === 'scored' ? 'bg-green-50 text-green-700 border-green-200' : cellState(c) === 'invited' ? 'bg-blue-50 text-blue-700 border-blue-200' : cellState(c) === 'asked' ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-gray-50 text-gray-600 border-gray-200'} />
                          {c.zoom_sent && c.zoom_join_url && c.status !== 'cancelled' && (
                            <a href={c.zoom_join_url} target="_blank" rel="noreferrer" className="text-primary text-xs inline-flex items-center gap-0.5"><Video className="h-3 w-3" /> Zoom</a>
                          )}
                        </div>
                        <div className="text-xs text-gray-400 mt-0.5">
                          {yes}/{c.jurors.length} jurors available · {c.entries.length} startups · {c.submitted}/{c.assigned} scored
                        </div>
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {c.jurors.map(j => (
                            <span key={j.user_id} className={`text-[11px] rounded-full border px-2 py-0.5 ${j.rsvp === 'unavailable' ? 'bg-red-50 text-red-600 border-red-200' : j.rsvp === 'invited' ? 'bg-gray-50 text-gray-500 border-gray-200' : 'bg-green-50 text-green-700 border-green-200'}`}>{j.name}</span>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid lg:grid-cols-2 gap-4">
            {([['Jury panels', Scale, panels], ['Startup batches', Layers, batches]] as const).map(([title, Icon, rows]) => (
              <Card key={title} className="border-0 shadow-sm">
                <CardContent className="p-4">
                  <div className="text-sm font-semibold text-gray-800 flex items-center gap-2 mb-3">
                    <Icon className="h-4 w-4 text-primary" /> {title}
                    <span className="text-xs font-normal text-gray-400">{rows.length}</span>
                  </div>
                  {rows.length === 0 ? <p className="text-sm text-gray-400">None yet.</p> : (
                    <div className="space-y-1.5">
                      {rows.map(g => (
                        <div key={g.id} className="rounded-lg border border-gray-100 px-3 py-2">
                          <div className="text-sm font-medium">{g.code}{g.name ? <span className="text-gray-500 font-normal"> · {g.name}</span> : ''}
                            <span className="text-xs text-gray-400 font-normal"> — {g.members.length} member{g.members.length === 1 ? '' : 's'}</span>
                          </div>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {g.members.map((m, i) => (
                              <span key={i} className="text-[11px] bg-gray-100 text-gray-600 rounded-full px-2 py-0.5">
                                {String(m.name || m.company || '—')}
                                {m.jury_type ? <span className="text-gray-400"> · {String(m.jury_type)}</span> : null}
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ) : tab === 'assign' ? (
        compEntries.length === 0 ? (
          <Card className="border-0 shadow-sm"><CardContent className="py-12 text-center text-gray-400">No {competition} entries yet.</CardContent></Card>
        ) : (
          <div className="space-y-2">
            {compEntries.map(entry => {
              const ents = entryAssignments(entry.id);
              const assignedIds = new Set(ents.map(a => a.juror_user_id));
              const eligibleScope = (s: string | null) => competition === 'innovation'
                ? (s === 'innovation' || s === 'both')
                : (s === 'architecture' || s === 'both');
              const available = jurors.filter(j => !assignedIds.has(j.user_id) && eligibleScope(j.scope));
              return (
                <Card key={entry.id} className="border-0 shadow-sm">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div>
                        <div className="text-sm font-semibold text-gray-900">{entry.title}</div>
                        {entry.subtitle && <div className="text-xs text-gray-500">{entry.subtitle}</div>}
                      </div>
                      <Select value="" onValueChange={v => assign(entry, v)} disabled={busy || available.length === 0}>
                        <SelectTrigger className="w-48 h-9"><SelectValue placeholder={available.length ? 'Assign juror…' : 'All jurors assigned'} /></SelectTrigger>
                        <SelectContent>{available.map(j => <SelectItem key={j.user_id} value={j.user_id}>{j.name}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    {ents.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-3">
                        {ents.map(a => (
                          <span key={a.id} className="inline-flex items-center gap-1 text-xs bg-primary/5 text-primary border border-primary/20 rounded-full pl-2.5 pr-1 py-0.5">
                            {jurorName(a.juror_user_id)}
                            <button onClick={() => unassign(a)} className="hover:bg-primary/10 rounded-full p-0.5" title="Remove"><X className="h-3 w-3" /></button>
                          </span>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )
      ) : (
        rankings.length === 0 ? (
          <Card className="border-0 shadow-sm"><CardContent className="py-12 text-center text-gray-400">No reviews yet for {competition}.</CardContent></Card>
        ) : (
          <Card className="border-0 shadow-sm">
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-400 border-b">
                    <th className="px-4 py-3 font-medium">#</th>
                    <th className="px-4 py-3 font-medium">Entry</th>
                    <th className="px-4 py-3 font-medium">Awards Score</th>
                    <th className="px-4 py-3 font-medium">Reviews</th>
                    <th className="px-4 py-3 font-medium">Dispersion</th>
                    <th className="px-4 py-3 font-medium">Confidence</th>
                    <th className="px-4 py-3 font-medium">Flags</th>
                  </tr>
                </thead>
                <tbody>
                  {rankings.map((r, i) => {
                    const wideSpread = r.score_stddev != null && r.score_stddev >= 15;
                    return (
                      <tr key={r.entry_id} className="border-b last:border-0 hover:bg-gray-50">
                        <td className="px-4 py-3">{i === 0 ? <Trophy className="h-4 w-4 text-amber-500" /> : i + 1}</td>
                        <td className="px-4 py-3"><div className="font-medium text-gray-900">{r.title}</div>{r.subtitle && <div className="text-xs text-gray-500">{r.subtitle}</div>}</td>
                        <td className="px-4 py-3 font-semibold text-primary">{r.awards_score != null ? `${r.awards_score.toFixed(1)}` : '—'}</td>
                        <td className="px-4 py-3 text-gray-600">{r.submitted}/{r.assigned}</td>
                        <td className="px-4 py-3 text-gray-600">
                          {r.reviews > 1 ? (
                            <span className={wideSpread ? 'text-amber-600 font-medium' : ''}>
                              {r.score_min?.toFixed(0)}–{r.score_max?.toFixed(0)} · σ{r.score_stddev?.toFixed(1)}
                            </span>
                          ) : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-4 py-3 text-gray-600">{r.avg_confidence != null ? r.avg_confidence.toFixed(1) : '—'}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {r.coi_count > 0 && <Badge className="text-[10px] bg-red-50 text-red-700 border-red-200">{r.coi_count} COI</Badge>}
                            {wideSpread && <span title="High dispersion — consensus needed"><AlertTriangle className="h-4 w-4 text-amber-500" /></span>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )
      )}
    </div>
  );
}
