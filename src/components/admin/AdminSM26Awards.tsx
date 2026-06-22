import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { RefreshCw, ArrowLeft, Trophy, Vote, Lock, Unlock, Check, Wand2, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';

// Admin awards & voting (Area 8): open/close the public vote per competition,
// watch live tallies, and record + confirm the 6 award winners.

interface Award {
  id: string; key: string; label: string; competition: string; type: string;
  winner_role_assignment_id: string | null; confirmed: boolean; sort: number;
}
interface TallyRow { entry_id: string; title: string; subtitle: string; votes: number; }
interface Candidate { entry_id: string; title: string; subtitle: string; description: string; votes: number; }

const VOTE_COMPS = [
  { key: 'innovation', label: 'Innovation' },
  { key: 'architecture_pro', label: 'Architecture · Pro' },
  { key: 'architecture_student', label: 'Architecture · Student' },
];

export function AdminSM26Awards() {
  const navigate = useNavigate();
  const [eventId, setEventId] = useState<string | null>(null);
  const [awards, setAwards] = useState<Award[]>([]);
  const [configs, setConfigs] = useState<Record<string, boolean>>({});
  const [tallies, setTallies] = useState<Record<string, TallyRow[]>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pickerAward, setPickerAward] = useState<Award | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loadingCands, setLoadingCands] = useState(false);

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    const { data: ev } = await supabase.from('sm_event').select('id').eq('slug', 'sm26').maybeSingle();
    if (!ev) { setLoading(false); return; }
    const eid = (ev as { id: string }).id;
    setEventId(eid);
    const [{ data: aw }, { data: cfg }, ...tallyRes] = await Promise.all([
      supabase.from('sm_award').select('*').eq('event_id', eid).order('sort'),
      supabase.from('sm_vote_config').select('competition,is_open').eq('event_id', eid),
      ...VOTE_COMPS.map(c => supabase.rpc('sm_vote_tally', { p_event_id: eid, p_competition: c.key })),
    ]);
    setAwards((aw || []) as Award[]);
    const cmap: Record<string, boolean> = {};
    for (const c of (cfg || []) as { competition: string; is_open: boolean }[]) cmap[c.competition] = c.is_open;
    setConfigs(cmap);
    const tmap: Record<string, TallyRow[]> = {};
    VOTE_COMPS.forEach((c, i) => { tmap[c.key] = (tallyRes[i].data || []) as TallyRow[]; });
    setTallies(tmap);
    setLoading(false);
  };

  const toggleVote = async (comp: string) => {
    if (!eventId) return;
    setBusy(true);
    const next = !configs[comp];
    const { error } = await supabase.from('sm_vote_config').upsert({ event_id: eventId, competition: comp, is_open: next }, { onConflict: 'event_id,competition' });
    setBusy(false);
    if (error) { toast({ title: 'Failed', description: error.message, variant: 'destructive' }); return; }
    setConfigs(prev => ({ ...prev, [comp]: next }));
  };

  const setWinner = async (award: Award, entryId: string) => {
    setBusy(true);
    const { error } = await supabase.from('sm_award').update({ winner_role_assignment_id: entryId || null }).eq('id', award.id);
    setBusy(false);
    if (error) { toast({ title: 'Failed', description: error.message, variant: 'destructive' }); return; }
    setAwards(prev => prev.map(a => a.id === award.id ? { ...a, winner_role_assignment_id: entryId || null } : a));
  };
  const toggleConfirm = async (award: Award) => {
    setBusy(true);
    const { error } = await supabase.from('sm_award').update({ confirmed: !award.confirmed }).eq('id', award.id);
    setBusy(false);
    if (error) { toast({ title: 'Failed', description: error.message, variant: 'destructive' }); return; }
    setAwards(prev => prev.map(a => a.id === award.id ? { ...a, confirmed: !a.confirmed } : a));
  };

  const openPicker = async (a: Award) => {
    if (!eventId) return;
    setPickerAward(a); setCandidates([]); setLoadingCands(true);
    const { data } = await supabase.rpc('sm_award_candidates', { p_event_id: eventId, p_competition: a.competition });
    setCandidates((data || []) as Candidate[]);
    setLoadingCands(false);
  };
  const pickWinner = async (entryId: string) => {
    if (!pickerAward) return;
    await setWinner(pickerAward, entryId);
    setPickerAward(null);
  };

  if (loading) return <div className="flex items-center justify-center h-64"><RefreshCw className="h-8 w-8 animate-spin text-gray-400" /></div>;

  const entriesFor = (comp: string) => tallies[comp] || [];
  const titleOf = (comp: string, id: string | null) => id ? (entriesFor(comp).find(e => e.entry_id === id)?.title || '—') : null;
  const confirmedCount = awards.filter(a => a.confirmed).length;
  const voteLeader = (comp: string) => { const r = entriesFor(comp); return r.length && r[0].votes > 0 ? r[0] : null; };

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={() => navigate('/admin/sm26')} className="gap-1.5"><ArrowLeft className="h-4 w-4" /> Back to registrations</Button>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Trophy className="h-6 w-6 text-primary" /> Awards &amp; voting</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {confirmedCount} of {awards.length} winners confirmed · confirmed winners appear publicly on the <Link to="/sm26/vote" className="text-primary hover:underline">vote &amp; results page</Link>.
          </p>
        </div>
        <Button variant="outline" size="icon" className="h-9 w-9" onClick={load} title="Refresh live tallies"><RefreshCw className="h-4 w-4" /></Button>
      </div>

      {/* Vote control + live tallies */}
      <div className="grid md:grid-cols-3 gap-3">
        {VOTE_COMPS.map(c => {
          const open = configs[c.key];
          const rows = entriesFor(c.key);
          const totalVotes = rows.reduce((s, r) => s + r.votes, 0);
          return (
            <Card key={c.key} className="border-0 shadow-sm">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-sm flex items-center gap-1.5"><Vote className="h-4 w-4 text-primary" /> {c.label}</CardTitle>
                  <Button size="sm" variant={open ? 'default' : 'outline'} className="h-7 gap-1.5" disabled={busy} onClick={() => toggleVote(c.key)}>
                    {open ? <><Unlock className="h-3.5 w-3.5" /> Open</> : <><Lock className="h-3.5 w-3.5" /> Closed</>}
                  </Button>
                </div>
                <div className="text-[11px] text-gray-400">{totalVotes} vote{totalVotes !== 1 ? 's' : ''} cast{open ? ' · live' : ''}</div>
              </CardHeader>
              <CardContent>
                {rows.length === 0 ? <p className="text-xs text-gray-400">No entries.</p> : (
                  <div className="space-y-1.5">
                    {rows.map((r, i) => (
                      <div key={r.entry_id} className="flex items-center justify-between text-sm">
                        <span className="flex items-center gap-1.5 truncate">
                          {i === 0 && r.votes > 0 && <Trophy className="h-3.5 w-3.5 text-amber-500 shrink-0" />}
                          <span className="truncate">{r.title}</span>
                        </span>
                        <span className="font-semibold text-gray-700 tabular-nums">{r.votes}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Awards */}
      <h2 className="text-sm font-semibold text-gray-700 pt-2">The 6 awards</h2>
      <div className="space-y-2">
        {awards.map(a => (
          <Card key={a.id} className="border-0 shadow-sm">
            <CardContent className="p-4 flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-gray-900">{a.label}</span>
                  <Badge variant="secondary" className="text-[10px] capitalize">{a.type}</Badge>
                  {a.confirmed && <Badge className="bg-green-50 text-green-700 border-green-200 text-[10px]"><Check className="h-3 w-3 mr-0.5" /> Confirmed</Badge>}
                </div>
                {a.winner_role_assignment_id && <div className="text-xs text-gray-500 mt-0.5">Winner: {titleOf(a.competition, a.winner_role_assignment_id)}</div>}
              </div>
              <div className="flex items-center gap-2">
                {a.type === 'public' && voteLeader(a.competition) && a.winner_role_assignment_id !== voteLeader(a.competition)!.entry_id && (
                  <Button size="sm" variant="ghost" className="h-9 gap-1.5 text-gray-500" disabled={busy} onClick={() => setWinner(a, voteLeader(a.competition)!.entry_id)} title={`Set vote leader (${voteLeader(a.competition)!.title}) as winner`}>
                    <Wand2 className="h-3.5 w-3.5" /> Use leader
                  </Button>
                )}
                <Button size="sm" variant="outline" className="h-9" disabled={busy} onClick={() => openPicker(a)}>
                  {a.winner_role_assignment_id ? 'Change winner' : 'Choose winner'}
                </Button>
                <Button size="sm" variant={a.confirmed ? 'outline' : 'default'} disabled={busy || !a.winner_role_assignment_id} onClick={() => toggleConfirm(a)}>
                  {a.confirmed ? 'Unconfirm' : 'Confirm'}
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Winner picker — click a company card */}
      <Dialog open={!!pickerAward} onOpenChange={o => !o && setPickerAward(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{pickerAward?.label} — choose the winner</DialogTitle></DialogHeader>
          {loadingCands ? (
            <div className="py-10 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-gray-300" /></div>
          ) : candidates.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-400">No eligible entries for this competition yet.</p>
          ) : (
            <div className="grid sm:grid-cols-2 gap-2">
              {candidates.map(c => {
                const selected = pickerAward?.winner_role_assignment_id === c.entry_id;
                return (
                  <button key={c.entry_id} type="button" onClick={() => pickWinner(c.entry_id)}
                    className={`text-left rounded-xl border p-3 transition-all ${selected ? 'border-primary ring-2 ring-primary/30 bg-primary/5' : 'border-gray-200 hover:border-primary/40 hover:bg-gray-50'}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-gray-900 text-sm truncate">{c.title}</span>
                      {selected ? <Check className="h-4 w-4 text-primary shrink-0" />
                        : pickerAward?.type === 'public' && <Badge variant="secondary" className="text-[10px] shrink-0">{c.votes} vote{c.votes !== 1 ? 's' : ''}</Badge>}
                    </div>
                    {c.subtitle && <div className="text-[11px] uppercase tracking-wide text-gray-400 mt-0.5">{c.subtitle}</div>}
                    {c.description && <p className="text-xs text-gray-600 mt-1 line-clamp-3">{c.description}</p>}
                  </button>
                );
              })}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
