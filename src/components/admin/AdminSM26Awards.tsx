import { useState, useEffect, Fragment } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { RefreshCw, ArrowLeft, Trophy, Vote, Lock, Unlock, Check, Wand2, Loader2, UserPlus, Search, X, ListChecks, ShieldOff } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';

// Admin awards & voting (Area 8): open/close the public vote per competition,
// watch live tallies, and record + confirm the 6 award winners. The public vote
// has no accounts: voters type their name at /sm26/vote, matched against a
// frozen copy of the attendee list (sm_vote_voter) and a frozen ballot
// (sm_vote_entry) that staff re-sync here. The desk tools check a name, add a
// missing voter, cancel votes cast under someone else's name, and record a vote
// for someone without a phone.

interface Award {
  id: string; key: string; label: string; competition: string; type: string;
  winner_role_assignment_id: string | null; confirmed: boolean; sort: number; hidden: boolean;
}
interface TallyRow { entry_id: string; title: string; subtitle: string; votes: number; }
interface Candidate { entry_id: string; title: string; subtitle: string; description: string; votes: number; }
interface Voter {
  vote_id: string; voter_user_id: string | null; voter_name: string; email: string | null; company: string | null; persona: string | null; voted_at: string;
  how: string | null; device_tag: string | null; ip_tag: string | null; network_votes: number | null;
}
interface DeskVoter { id: string; first_name: string; last_name: string; note: string | null; created_at: string; voted: boolean; }
interface DeskMatch { status: string; name: string | null; source: string | null; voted: { competition: string; vote_id: string; at: string; at_desk: boolean }[] }
interface BallotComp { key: string; label: string | null; entries: { id: string; title: string; subtitle: string }[] }
interface SyncPreview {
  applied: boolean; voters: number; entries: Record<string, number> | null;
  voters_new: { attendee_id: string; name: string }[];
  voters_gone: { voter_id: string; name: string; has_votes: boolean }[];
  entries_new: { competition: string; title: string }[];
  entries_gone: { entry_id: string; competition: string; title: string; has_votes: boolean }[];
}
const COMP_LABEL: Record<string, string> = { innovation: 'Innovation', architecture_pro: 'Architecture', architecture_student: 'Architecture · Student' };
const DESK_ERRORS: Record<string, string> = {
  not_found: 'Not on the list. If they attend, add them as a voter first.',
  ambiguous: 'Several people on the list match this name — ask for the full name as registered.',
  name_already_voted: 'This name already voted from a phone. Cancel those votes first, then record here.',
};

const ALL_VOTE_COMPS = [
  { key: 'innovation', label: 'Innovation' },
  { key: 'architecture_pro', label: 'Architecture · Pro' },
  { key: 'architecture_student', label: 'Architecture · Student' },
];

export function AdminSM26Awards({ embedded = false }: { embedded?: boolean } = {}) {
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
  const [voterEntry, setVoterEntry] = useState<{ comp: string; entry_id: string; title: string } | null>(null);
  const [voters, setVoters] = useState<Voter[]>([]);
  const [loadingVoters, setLoadingVoters] = useState(false);
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [deskVoters, setDeskVoters] = useState<DeskVoter[]>([]);
  const [deskFirst, setDeskFirst] = useState('');
  const [deskLast, setDeskLast] = useState('');
  const [deskNote, setDeskNote] = useState('');
  const [deskResult, setDeskResult] = useState<string | null>(null);
  const [deskMatch, setDeskMatch] = useState<DeskMatch | null>(null);
  const [deskBallot, setDeskBallot] = useState<BallotComp[]>([]);
  const [castChoice, setCastChoice] = useState<Record<string, string>>({});
  const [deskBusy, setDeskBusy] = useState(false);
  const [sync, setSync] = useState<SyncPreview | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);

  useEffect(() => { load(); }, []);

  // quiet = refresh in place, without the full-page spinner.
  const load = async (quiet = false) => {
    if (!quiet) setLoading(true);
    const { data: ev } = await supabase.from('sm_event').select('id').eq('slug', 'sm26').maybeSingle();
    if (!ev) { setLoading(false); return; }
    const eid = (ev as { id: string }).id;
    setEventId(eid);
    const [{ data: aw }, { data: cfg }, { data: dv }, { data: sy }, ...tallyRes] = await Promise.all([
      supabase.from('sm_award').select('*').eq('event_id', eid).order('sort'),
      supabase.from('sm_vote_config').select('competition,is_open').eq('event_id', eid),
      supabase.rpc('sm_admin_vote_desk_list'),
      supabase.rpc('sm_admin_vote_sync', { p_apply: false }),
      ...ALL_VOTE_COMPS.map(c => supabase.rpc('sm_vote_tally', { p_event_id: eid, p_competition: c.key })),
    ]);
    setAwards((aw || []) as Award[]);
    const cmap: Record<string, boolean> = {};
    for (const c of (cfg || []) as { competition: string; is_open: boolean }[]) cmap[c.competition] = c.is_open;
    setConfigs(cmap);
    const tmap: Record<string, TallyRow[]> = {};
    ALL_VOTE_COMPS.forEach((c, i) => { tmap[c.key] = (tallyRes[i].data || []) as TallyRow[]; });
    setTallies(tmap);
    setDeskVoters((dv || []) as DeskVoter[]);
    if (sy) setSync(sy as SyncPreview);
    setLoading(false);
  };

  const toggleVote = async (comp: string) => {
    if (!eventId) return;
    const next = !configs[comp];
    const pendingSync = sync && (sync.voters_new.length + sync.entries_new.length + sync.voters_gone.length + sync.entries_gone.length) > 0;
    if (!window.confirm(next
      ? `Open public voting for this prize? Anyone on the voter list can vote from their phone by typing their name (smartmarinaconnect.com/sm26/vote).${pendingSync ? '\n\nNote: the voter list or ballot has changes waiting — see "Voter list & ballot".' : ''}`
      : 'Close public voting for this competition? No further votes will be accepted.')) return;
    setBusy(true);
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
    if (!window.confirm(award.confirmed
      ? 'Unconfirm this winner? It will be removed from the public winners showcase.'
      : 'Confirm this winner? It will be published on the public winners showcase.')) return;
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

  // Who voted for this entry — voter identity is stored on sm_public_vote; this
  // surfaces it (name · org · when · phone/network tags) via a staff-gated RPC.
  const openVoters = async (comp: string, entry_id: string, title: string) => {
    if (!eventId) return;
    setVoterEntry({ comp, entry_id, title }); setVoters([]); setVoidingId(null); setLoadingVoters(true);
    const { data, error } = await supabase.rpc('sm_admin_vote_voters', { p_event_id: eventId, p_competition: comp, p_entry_id: entry_id });
    if (error) toast({ title: 'Could not load voters', description: error.message, variant: 'destructive' });
    setVoters((data || []) as Voter[]);
    setLoadingVoters(false);
  };

  // Cancelling removes every vote of that person (all prizes) and frees the name;
  // blocking also stops the phone that cast them.
  const voidVote = async (voteId: string, block: boolean) => {
    const { data, error } = await supabase.rpc('sm_admin_vote_void', { p_vote_id: voteId, p_block_device: block });
    if (error) { toast({ title: 'Could not cancel', description: error.message, variant: 'destructive' }); return false; }
    const r = data as { cancelled: number; blocked: number };
    toast({ title: `${r.cancelled} vote${r.cancelled !== 1 ? 's' : ''} cancelled${r.blocked ? ' · phone blocked' : ''}` });
    load(true);
    return true;
  };
  const voidFromTally = async (v: Voter, block: boolean) => {
    if (await voidVote(v.vote_id, block)) {
      setVoidingId(null);
      setVoters(prev => prev.filter(x => x.vote_id !== v.vote_id));
    }
  };

  const deskName = () => ({ p_first: deskFirst.trim(), p_last: deskLast.trim() });
  const deskTyping = (set: (s: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    set(e.target.value); setDeskResult(null); setDeskMatch(null); setCastChoice({});
  };

  const deskCheck = async () => {
    if (!deskFirst.trim() || !deskLast.trim()) { setDeskResult('Type a first and last name.'); return; }
    setDeskBusy(true); setDeskMatch(null); setCastChoice({});
    const [{ data, error }, { data: bal }] = await Promise.all([
      supabase.rpc('sm_admin_vote_check_name', deskName()),
      supabase.rpc('sm_public_ballot', { p_device: '' }),
    ]);
    setDeskBusy(false);
    if (error) { setDeskResult(error.message); return; }
    setDeskBallot(((bal as { competitions?: BallotComp[] } | null)?.competitions) || []);
    const r = data as DeskMatch;
    if (r.status === 'ok') {
      setDeskMatch(r);
      const voted = (r.voted || []).map(v => `${COMP_LABEL[v.competition] || v.competition} (${v.at_desk ? 'at the desk' : 'from a phone'}, ${new Date(v.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`);
      setDeskResult(`On the list: ${r.name} (${r.source}). ${voted.length ? 'Has voted: ' + voted.join(', ') + '.' : 'Has not voted yet.'}`);
    } else {
      setDeskResult(DESK_ERRORS[r.status] || DESK_ERRORS.not_found);
    }
  };

  const deskAdd = async () => {
    if (!deskFirst.trim() || !deskLast.trim()) { setDeskResult('Type a first and last name.'); return; }
    setDeskBusy(true);
    const { data, error } = await supabase.rpc('sm_admin_vote_add_voter', { ...deskName(), p_note: deskNote.trim() || null });
    setDeskBusy(false);
    if (error) { setDeskResult(error.message); return; }
    const r = data as { ok: boolean; error?: string; name?: string };
    if (!r.ok) {
      setDeskResult(
        r.error === 'already_on_list' ? `Already on the list as ${r.name} — they can vote with that name.`
        : r.error === 'shared_name' ? 'Several people on the list match this name, so adding it again would not help. Ask for the full name as registered.'
        : 'Type both a first and a last name.');
      return;
    }
    setDeskResult(`Added — ${deskFirst.trim()} ${deskLast.trim()} can vote now, typing exactly this name.`);
    setDeskNote('');
    const { data: dv } = await supabase.rpc('sm_admin_vote_desk_list');
    setDeskVoters((dv || []) as DeskVoter[]);
  };

  const deskCancel = async (block: boolean) => {
    if (!deskMatch?.voted.length) return;
    if (!window.confirm(block
      ? `Cancel every vote cast as ${deskMatch.name} and block the phone that cast them? ${deskMatch.name} can then vote from their own phone.`
      : `Cancel every vote cast as ${deskMatch.name}? The name can then vote again.`)) return;
    setDeskBusy(true);
    const ok = await voidVote(deskMatch.voted[0].vote_id, block);
    setDeskBusy(false);
    if (ok) await deskCheck();
  };

  const deskRecord = async () => {
    const choices = Object.fromEntries(Object.entries(castChoice).filter(([, v]) => v));
    if (Object.keys(choices).length === 0) { setDeskResult('Choose at least one entry to record.'); return; }
    if (!window.confirm(`Record this vote for ${deskMatch?.name}? Only with the person in front of you.`)) return;
    setDeskBusy(true);
    const { data, error } = await supabase.rpc('sm_admin_vote_cast_for', { ...deskName(), p_choices: choices });
    setDeskBusy(false);
    if (error) { setDeskResult(error.message); return; }
    const r = data as { ok: boolean; error?: string; results?: Record<string, string> };
    if (!r.ok) { setDeskResult(DESK_ERRORS[r.error || ''] || 'The vote could not be recorded.'); return; }
    const missed = Object.entries(r.results || {}).filter(([, v]) => v !== 'voted' && v !== 'changed');
    toast({ title: 'Vote recorded', description: missed.length ? `Not recorded: ${missed.map(([k, v]) => `${COMP_LABEL[k] || k} (${v === 'closed' ? 'closed' : 'entry not on the ballot'})`).join(', ')}` : undefined });
    await deskCheck();
    load(true);
  };

  const removeDeskVoter = async (x: DeskVoter) => {
    if (!window.confirm(`Remove ${x.first_name} ${x.last_name} from the added voters?${x.voted ? ' Votes they already cast stay counted unless you cancel them.' : ''}`)) return;
    const { error } = await supabase.rpc('sm_admin_vote_remove_voter', { p_id: x.id });
    if (error) { toast({ title: 'Could not remove', description: error.message, variant: 'destructive' }); return; }
    setDeskVoters(prev => prev.filter(e => e.id !== x.id));
    load(true);
  };

  const resetLimits = async () => {
    if (!window.confirm('Clear all failed name attempts? Use this when phones or the venue Wi-Fi get "too many attempts".')) return;
    const { data, error } = await supabase.rpc('sm_admin_vote_reset_limits');
    if (error) { toast({ title: 'Failed', description: error.message, variant: 'destructive' }); return; }
    toast({ title: `Cleared ${data as number} failed attempt${data === 1 ? '' : 's'}` });
  };

  const applySync = async () => {
    if (!window.confirm('Apply these changes to the voter list and the ballot?')) return;
    setSyncBusy(true);
    const { error } = await supabase.rpc('sm_admin_vote_sync', { p_apply: true });
    if (error) { setSyncBusy(false); toast({ title: 'Failed', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Voter list and ballot updated' });
    await load(true);
    setSyncBusy(false);
  };

  if (loading) return <div className="flex items-center justify-center h-64"><RefreshCw className="h-8 w-8 animate-spin text-gray-400" /></div>;

  const entriesFor = (comp: string) => tallies[comp] || [];
  const titleOf = (comp: string, id: string | null) => id ? (entriesFor(comp).find(e => e.entry_id === id)?.title || '—') : null;
  // A parked award category disappears from here and from the public page until
  // someone decides its fate — nothing is deleted, so it comes straight back.
  const visibleAwards = awards.filter(a => !a.hidden);
  const hiddenCount = awards.length - visibleAwards.length;
  const VOTE_COMPS = ALL_VOTE_COMPS.filter(c => awards.some(a => a.competition === c.key && !a.hidden));
  const confirmedCount = visibleAwards.filter(a => a.confirmed).length;
  const voteLeader = (comp: string) => { const r = entriesFor(comp); return r.length && r[0].votes > 0 ? r[0] : null; };
  const syncApplicable = !!sync && (sync.voters_new.length + sync.entries_new.length
    + sync.voters_gone.filter(v => !v.has_votes).length + sync.entries_gone.filter(e => !e.has_votes).length) > 0;
  const phoneVoted = !!deskMatch?.voted.some(v => !v.at_desk);

  return (
    <div className="space-y-4">
      {!embedded && <Button variant="ghost" size="sm" onClick={() => navigate('/admin/sm26')} className="gap-1.5"><ArrowLeft className="h-4 w-4" /> Back to registrations</Button>}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          {!embedded && <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Trophy className="h-6 w-6 text-primary" /> Awards &amp; voting</h1>}
          <p className="text-sm text-gray-500 mt-0.5">
            {confirmedCount} of {visibleAwards.length} winners confirmed · confirmed winners appear publicly on the <Link to="/sm26/vote" className="text-primary hover:underline">vote &amp; results page</Link>. Tallies are visible to staff only.
          </p>
        </div>
        <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => load(true)} title="Refresh live tallies"><RefreshCw className="h-4 w-4" /></Button>
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
                  <div className="space-y-1.5 max-h-96 overflow-y-auto">
                    {rows.map((r, i) => (
                      <button key={r.entry_id} type="button" disabled={r.votes === 0}
                        onClick={() => openVoters(c.key, r.entry_id, r.title)}
                        className="w-full flex items-center justify-between text-sm rounded px-1 -mx-1 py-0.5 enabled:hover:bg-gray-50 disabled:cursor-default text-left">
                        <span className="flex items-center gap-1.5 truncate">
                          {i === 0 && r.votes > 0 && <Trophy className="h-3.5 w-3.5 text-amber-500 shrink-0" />}
                          <span className="truncate">{r.title}</span>
                        </span>
                        <span className="font-semibold text-gray-700 tabular-nums shrink-0">{r.votes}{r.votes > 0 && <span className="text-[10px] text-primary font-normal ml-1">who ▾</span>}</span>
                      </button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* The frozen lists the public vote reads. */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-sm flex items-center gap-1.5"><ListChecks className="h-4 w-4 text-primary" /> Voter list &amp; ballot</CardTitle>
            {syncApplicable && <Button size="sm" className="h-7" disabled={syncBusy} onClick={applySync}>{syncBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Apply changes'}</Button>}
          </div>
          <div className="text-[11px] text-gray-400">
            The vote uses a copy of the attending people on confirmed registrations, and of the entries. After importing or confirming attendees, review the changes below and apply them. Check new names: only people who really attend should be added.
          </div>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {!sync ? <p className="text-xs text-gray-400">Could not load the lists.</p> : (
            <>
              <p className="text-gray-700">
                <span className="font-semibold">{sync.voters}</span> voters
                {Object.entries(sync.entries || {}).map(([k, n]) => <span key={k}> · {COMP_LABEL[k] || k}: <span className="font-semibold">{n}</span> entries</span>)}
                {deskVoters.length > 0 && <span className="text-gray-400"> · {deskVoters.length} added at the desk</span>}
              </p>
              {sync.voters_new.length + sync.voters_gone.length + sync.entries_new.length + sync.entries_gone.length === 0 ? (
                <p className="text-xs text-green-700 flex items-center gap-1"><Check className="h-3.5 w-3.5" /> Up to date with the registrations.</p>
              ) : (
                <div className="grid md:grid-cols-2 gap-2">
                  {sync.voters_new.length > 0 && (
                    <div className="rounded-lg border border-gray-100 p-2">
                      <div className="text-[11px] uppercase tracking-wide text-gray-400 mb-1">New voters ({sync.voters_new.length})</div>
                      <div className="text-xs text-gray-700 max-h-40 overflow-y-auto">{sync.voters_new.map(v => v.name || '(no name)').join(' · ')}</div>
                    </div>
                  )}
                  {sync.voters_gone.length > 0 && (
                    <div className="rounded-lg border border-gray-100 p-2">
                      <div className="text-[11px] uppercase tracking-wide text-gray-400 mb-1">Leaving the voter list ({sync.voters_gone.length})</div>
                      <div className="text-xs text-gray-700 max-h-40 overflow-y-auto">{sync.voters_gone.map(v => `${v.name}${v.has_votes ? ' (has voted — stays until you cancel their votes)' : ''}`).join(' · ')}</div>
                    </div>
                  )}
                  {sync.entries_new.length > 0 && (
                    <div className="rounded-lg border border-gray-100 p-2">
                      <div className="text-[11px] uppercase tracking-wide text-gray-400 mb-1">New on the ballot ({sync.entries_new.length})</div>
                      <div className="text-xs text-gray-700 max-h-40 overflow-y-auto">{sync.entries_new.map(e => `${e.title} (${COMP_LABEL[e.competition] || e.competition})`).join(' · ')}</div>
                    </div>
                  )}
                  {sync.entries_gone.length > 0 && (
                    <div className="rounded-lg border border-gray-100 p-2">
                      <div className="text-[11px] uppercase tracking-wide text-gray-400 mb-1">Leaving the ballot ({sync.entries_gone.length})</div>
                      <div className="text-xs text-gray-700 max-h-40 overflow-y-auto">{sync.entries_gone.map(e => `${e.title} (${COMP_LABEL[e.competition] || e.competition})${e.has_votes ? ' — has votes, stays' : ''}`).join(' · ')}</div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Desk tools: the public page never says whether a name is on the list; staff can. */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-sm flex items-center gap-1.5"><UserPlus className="h-4 w-4 text-primary" /> Voter desk</CardTitle>
            <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-gray-500" onClick={resetLimits} title='For "too many attempts" on a phone or the venue Wi-Fi'><ShieldOff className="h-3.5 w-3.5" /> Clear attempt limits</Button>
          </div>
          <div className="text-[11px] text-gray-400">Someone can’t vote? Check their name. Add them if they attend but aren’t on the list; cancel votes someone else cast under their name; or record their vote here if they have no phone.</div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid sm:grid-cols-3 gap-2">
            <Input value={deskFirst} onChange={deskTyping(setDeskFirst)} placeholder="First name" className="h-9" />
            <Input value={deskLast} onChange={deskTyping(setDeskLast)} placeholder="Last name" className="h-9" />
            <Input value={deskNote} onChange={e => setDeskNote(e.target.value)} placeholder="Note when adding (e.g. company)" className="h-9" />
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" variant="outline" className="gap-1.5" disabled={deskBusy} onClick={deskCheck}><Search className="h-3.5 w-3.5" /> Check name</Button>
            <Button size="sm" className="gap-1.5" disabled={deskBusy} onClick={deskAdd}><UserPlus className="h-3.5 w-3.5" /> Add as voter</Button>
            {deskBusy && <Loader2 className="h-4 w-4 animate-spin text-gray-400 self-center" />}
          </div>
          {deskResult && <p className="text-sm text-gray-700">{deskResult}</p>}

          {deskMatch && deskMatch.voted.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              <Button size="sm" variant="outline" disabled={deskBusy} onClick={() => deskCancel(false)}>Cancel their votes</Button>
              {phoneVoted && <Button size="sm" variant="destructive" disabled={deskBusy} onClick={() => deskCancel(true)}>Cancel + block that phone</Button>}
            </div>
          )}

          {deskMatch && !phoneVoted && (
            deskBallot.length === 0 ? (
              <p className="text-xs text-gray-400">Voting is closed — open a prize to record a vote here.</p>
            ) : (
              <div className="rounded-lg border border-gray-100 p-2 space-y-2">
                <div className="text-[11px] uppercase tracking-wide text-gray-400">Record their vote (no phone)</div>
                <div className="grid sm:grid-cols-2 gap-2">
                  {deskBallot.map(c => (
                    <label key={c.key} className="text-xs text-gray-600 space-y-1">
                      <span>{c.label || COMP_LABEL[c.key] || c.key}</span>
                      <select value={castChoice[c.key] || ''} onChange={e => setCastChoice(prev => ({ ...prev, [c.key]: e.target.value }))}
                        className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm">
                        <option value="">— no vote —</option>
                        {c.entries.map(e => <option key={e.id} value={e.id}>{e.title}</option>)}
                      </select>
                    </label>
                  ))}
                </div>
                <Button size="sm" disabled={deskBusy} onClick={deskRecord}>Record vote</Button>
              </div>
            )
          )}

          {deskVoters.length > 0 && (
            <div className="border-t pt-2">
              <div className="text-[11px] uppercase tracking-wide text-gray-400 mb-1">Added at the desk ({deskVoters.length})</div>
              <div className="space-y-1">
                {deskVoters.map(x => (
                  <div key={x.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate">{x.first_name} {x.last_name}{x.note ? <span className="text-gray-400"> · {x.note}</span> : null}{x.voted && <span className="text-green-700 text-xs ml-1.5">voted</span>}</span>
                    <button type="button" onClick={() => removeDeskVoter(x)} className="text-gray-400 hover:text-red-600" title="Remove"><X className="h-4 w-4" /></button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Awards */}
      <h2 className="text-sm font-semibold text-gray-700 pt-2">The awards ({visibleAwards.length}){hiddenCount > 0 && <span className="font-normal text-gray-400"> · {hiddenCount} parked</span>}</h2>
      <div className="space-y-2">
        {visibleAwards.map(a => (
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

      {/* Who voted — the roster behind a tally */}
      <Dialog open={!!voterEntry} onOpenChange={o => !o && setVoterEntry(null)}>
        <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Voters — {voterEntry?.title}</DialogTitle></DialogHeader>
          {loadingVoters ? (
            <div className="py-10 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-gray-300" /></div>
          ) : voters.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-400">No voters recorded for this entry.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b">
                  <th className="px-2 py-2">Voter</th><th className="px-2 py-2">Organisation</th><th className="px-2 py-2">Voted</th><th className="px-2 py-2"></th>
                </tr></thead>
                <tbody>
                  {voters.map(v => (
                    <Fragment key={v.vote_id}>
                      <tr className="border-b border-gray-50 align-top">
                        <td className="px-2 py-2">
                          <div className="font-medium text-gray-800">{v.voter_name}</div>
                          <div className="text-[11px] text-gray-400">{[v.email, v.persona].filter(Boolean).join(' · ')}</div>
                          <div className="text-[10px] text-gray-300" title="Same phone tag = same phone. Same network tag = same Wi-Fi or mobile network (the venue Wi-Fi is shared by everyone).">phone {v.device_tag || '—'} · network {v.ip_tag || '—'}{v.network_votes ? ` (${v.network_votes})` : ''}</div>
                        </td>
                        <td className="px-2 py-2 text-gray-600">{v.company || '—'}</td>
                        <td className="px-2 py-2 text-gray-500 whitespace-nowrap">{new Date(v.voted_at).toLocaleString()}</td>
                        <td className="px-2 py-2">{voidingId !== v.vote_id && <Button size="sm" variant="ghost" className="h-7 text-red-600 hover:text-red-700" onClick={() => setVoidingId(v.vote_id)}>Cancel</Button>}</td>
                      </tr>
                      {voidingId === v.vote_id && (
                        <tr className="bg-red-50/60">
                          <td colSpan={4} className="px-2 py-2">
                            <p className="text-xs text-gray-700 mb-2">Cancel every vote cast as <span className="font-semibold">{v.voter_name}</span> (all prizes)? The name can then vote again.</p>
                            <div className="flex gap-2 flex-wrap">
                              <Button size="sm" variant="outline" className="h-7" onClick={() => voidFromTally(v, false)}>Cancel votes</Button>
                              {v.device_tag && <Button size="sm" variant="destructive" className="h-7" onClick={() => voidFromTally(v, true)}>Cancel + block this phone</Button>}
                              <Button size="sm" variant="ghost" className="h-7" onClick={() => setVoidingId(null)}>Keep</Button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
