import { useState, useEffect, useRef, useCallback } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import { RefreshCw, Vote, Check, Loader2, Trophy, Search, Clock, Lock, WifiOff } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { getVoteDevice, readVoteName, storeVoteName } from '@/lib/voteDevice';

// The SM26 audience vote. Its address (smartmarinaconnect.com/sm26/vote) is a
// STATIC QR in the event presentation: public, no account. A voter types their
// first and last name, which must be on the attendee list; one vote per name per
// prize, one person per phone, changeable until staff close voting. The server
// (sm_public_cast_votes) decides all of that — this page never learns whether a
// name exists until a vote is actually cast. Results stay with staff until the
// ceremony; confirmed winners are shown here afterwards.

interface Entry { id: string; title: string; subtitle: string }
interface Competition { key: string; label: string | null; my_vote: string | null; entries: Entry[] }
interface Ballot { competitions: Competition[]; had_votes: boolean }
interface Winner { award_key: string; award_label: string; competition: string; type: string; winner_title: string; winner_subtitle: string }

const ERRORS: Record<string, string> = {
  not_found: "We couldn't find this name on the attendee list. Check the spelling as registered, or see the welcome desk.",
  ambiguous: 'More than one person on the list matches this name. Please see the welcome desk.',
  name_already_voted: 'This name has already voted from another phone or browser. If that wasn’t you, please see the welcome desk.',
  device_already_voted: 'Someone else has already voted from this phone. Each person votes from their own phone — the welcome desk can help.',
  device_blocked: 'Voting from this phone has been stopped. Please see the welcome desk.',
  rate_limited: 'Too many attempts from this phone. Please wait 10 minutes, or see the welcome desk.',
  network_limited: 'Too many attempts from this network. Try again on mobile data, or see the welcome desk.',
  closed: 'Voting has just closed.',
  invalid_choice: 'The ballot has just changed. Please check your choice and send again.',
  no_choice: 'Choose at least one entry.',
};
const RESULT_NOTE: Record<string, string> = {
  closed: 'voting has closed',
  invalid_entry: 'that entry is no longer on the ballot — choose again',
  retry: 'not recorded — please send again',
};

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

async function fetchBallot(): Promise<Ballot | null> {
  const { data, error } = await supabase.rpc('sm_public_ballot', { p_device: getVoteDevice() });
  if (error || !data) return null;
  const b = data as Ballot;
  return { competitions: b.competitions || [], had_votes: !!b.had_votes };
}

async function fetchWinners(): Promise<Winner[] | null> {
  const { data: ev, error: evErr } = await supabase.from('sm_event').select('id').eq('slug', 'sm26').maybeSingle();
  if (evErr) return null;
  if (!ev) return [];
  const { data, error } = await supabase.rpc('sm_award_results', { p_event_id: (ev as { id: string }).id });
  if (error) return null;
  return (data || []) as Winner[];
}

function WinnersCard({ winners }: { winners: Winner[] }) {
  return (
    <Card className="border border-amber-100 shadow-sm bg-gradient-to-br from-amber-50 to-white">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-amber-800"><Trophy className="h-5 w-5" /> Award winners</CardTitle>
        <CardDescription>Congratulations to the Smart &amp; Sustainable Marina Rendezvous 2026 winners.</CardDescription>
      </CardHeader>
      <CardContent className="grid sm:grid-cols-2 gap-3">
        {winners.map(w => (
          <div key={w.award_key} className="rounded-xl border border-amber-100 bg-white p-3">
            <div className="text-[11px] uppercase tracking-wide text-amber-600">{w.award_label}</div>
            <div className="font-semibold text-gray-900 mt-0.5">{w.winner_title}</div>
            {w.winner_subtitle && <div className="text-xs text-gray-500">{w.winner_subtitle}</div>}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function SM26VotePage({ embedded = false }: { embedded?: boolean } = {}) {
  const [ballot, setBallot] = useState<Ballot | null>(null);
  const [winners, setWinners] = useState<Winner[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [first, setFirst] = useState(() => readVoteName().first);
  const [last, setLast] = useState(() => readVoteName().last);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [search, setSearch] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [thanks, setThanks] = useState(false);
  const touched = useRef<Set<string>>(new Set());
  // Each load takes a number; only the newest may write. A minute-poll that
  // started before a vote must not put the old choice back after it.
  const loadGen = useRef(0);
  const loaded = useRef(false);

  const load = useCallback(async () => {
    const gen = ++loadGen.current;
    const [b, w] = await Promise.all([fetchBallot(), fetchWinners()]);
    if (gen !== loadGen.current) return;
    if (b) {
      loaded.current = true;
      setBallot(b);
      setChoice(prev => {
        const next = { ...prev };
        for (const c of b.competitions) if (!touched.current.has(c.key) && c.my_vote) next[c.key] = c.my_vote;
        return next;
      });
      setLoadFailed(false);
    } else if (!loaded.current) {
      setLoadFailed(true);   // a later failed poll keeps showing the last ballot
    }
    if (w) setWinners(w);
    setLoading(false);
  }, []);

  // Load once, then quietly every minute so opening/closing reaches open pages.
  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => { loadGen.current++; clearInterval(t); };
  }, [load]);

  const competitions = ballot?.competitions || [];
  const open = competitions.length > 0;

  if (embedded) {
    // Inside the account's Event tab: winners once confirmed, otherwise a pointer while voting is open.
    if (loading) return null;
    if (winners.length > 0) return <WinnersCard winners={winners} />;
    if (!open) return null;
    return (
      <Card className="border-0 shadow-sm">
        <CardContent className="p-5 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <span className="h-10 w-10 rounded-xl bg-primary text-white flex items-center justify-center"><Vote className="h-5 w-5" /></span>
            <div>
              <p className="font-semibold text-gray-900">The audience vote is open</p>
              <p className="text-sm text-gray-500">Choose your favourites — no sign-in needed.</p>
            </div>
          </div>
          <Button asChild><Link to="/sm26/vote">Vote now</Link></Button>
        </CardContent>
      </Card>
    );
  }

  const pick = (comp: string, entryId: string) => {
    touched.current.add(comp);
    setChoice(prev => ({ ...prev, [comp]: entryId }));
    setThanks(false);
    setProblem(null);
  };

  const pending = competitions.filter(c => choice[c.key] && choice[c.key] !== c.my_vote);
  const hasVoted = competitions.some(c => c.my_vote);
  const labelOf = (key: string) => competitions.find(c => c.key === key)?.label || key;

  const submit = async () => {
    if (!first.trim() || !last.trim()) { setProblem('Please type your first and last name, as registered.'); return; }
    const choices: Record<string, string> = {};
    for (const c of competitions) if (choice[c.key]) choices[c.key] = choice[c.key];
    if (Object.keys(choices).length === 0) { setProblem(ERRORS.no_choice); return; }
    setBusy(true); setProblem(null); setThanks(false);
    loadGen.current++;   // anything already loading is now out of date
    const { data, error } = await supabase.rpc('sm_public_cast_votes', {
      p_device: getVoteDevice(), p_first: first.trim(), p_last: last.trim(), p_choices: choices,
    });
    if (error || !data) {
      setBusy(false);
      setProblem('We couldn’t reach the server. Check your connection and try again.');
      return;
    }
    const r = data as { ok: boolean; error?: string; results?: Record<string, string> };
    if (r.error) {
      setBusy(false);
      setProblem(ERRORS[r.error] || 'Your vote could not be recorded. Please try again.');
      if (r.error === 'closed' || r.error === 'invalid_choice') load();
      return;
    }
    const results = r.results || {};
    const failed = Object.entries(results).filter(([, v]) => !['voted', 'changed', 'unchanged'].includes(v));
    if (r.ok) {
      storeVoteName(first.trim(), last.trim());
      touched.current.clear();
    }
    await load();
    setBusy(false);
    if (failed.length > 0) {
      const notes = failed.map(([k, v]) => `${labelOf(k)}: ${RESULT_NOTE[v] || 'not recorded — please send again'}.`).join(' ');
      setProblem(r.ok ? `The rest of your vote is recorded. ${notes}` : notes);
    }
    if (r.ok && failed.length === 0) { setThanks(true); toast({ title: 'Vote recorded — thank you!' }); }
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-28">
      <Helmet><title>Vote — Smart &amp; Sustainable Marina Rendezvous 2026</title></Helmet>
      <section className="bg-gradient-to-br from-[#0b2653] to-[#143a6b] text-white">
        <div className="container mx-auto px-4 py-10 max-w-2xl">
          <p className="uppercase tracking-wide text-white/60 text-sm mb-2">SM26 · Audience vote</p>
          <h1 className="text-3xl lg:text-4xl font-bold">Vote for your favourites</h1>
          <p className="text-white/80 mt-2">One vote per prize, from your own phone. Type your name as registered — no account needed. You can change your vote until voting closes.</p>
        </div>
      </section>

      <div className="container mx-auto px-4 py-6 max-w-2xl space-y-5">
        {loading ? (
          <div className="flex items-center justify-center h-40"><RefreshCw className="h-7 w-7 animate-spin text-primary" /></div>
        ) : loadFailed ? (
          <Card>
            <CardContent className="py-10 text-center">
              <WifiOff className="h-9 w-9 text-gray-300 mx-auto mb-3" />
              <p className="font-semibold text-gray-800">We couldn’t load the ballot</p>
              <p className="text-sm text-gray-500 mt-1">Check your connection (Wi-Fi or mobile data) and try again.</p>
              <Button className="mt-4 gap-1.5" onClick={() => { setLoading(true); load(); }}><RefreshCw className="h-4 w-4" /> Try again</Button>
            </CardContent>
          </Card>
        ) : !open ? (
          <>
            {winners.length > 0 && <WinnersCard winners={winners} />}
            {winners.length === 0 && (
              <Card>
                <CardContent className="py-10 text-center">
                  {ballot?.had_votes
                    ? <><Lock className="h-9 w-9 text-gray-300 mx-auto mb-3" /><p className="font-semibold text-gray-800">Voting is closed</p>
                        <p className="text-sm text-gray-500 mt-1">Thank you for voting. The winners are announced at the award ceremony.</p></>
                    : <><Clock className="h-9 w-9 text-gray-300 mx-auto mb-3" /><p className="font-semibold text-gray-800">Voting hasn’t opened yet</p>
                        <p className="text-sm text-gray-500 mt-1">It opens during the event. Keep this page — the same QR code will take you to the ballot.</p></>}
                </CardContent>
              </Card>
            )}
            <div className="text-center"><Link to="/sm26" className="text-sm text-primary hover:underline">Event info</Link></div>
          </>
        ) : (
          <>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Your name</CardTitle>
                <CardDescription>As it appears on your registration. We use it only to make sure everyone votes once.</CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-3">
                <div><Label className="text-xs">First name</Label><Input value={first} onChange={e => { setFirst(e.target.value); setProblem(null); }} autoComplete="given-name" className="mt-1 h-11" /></div>
                <div><Label className="text-xs">Last name</Label><Input value={last} onChange={e => { setLast(e.target.value); setProblem(null); }} autoComplete="family-name" className="mt-1 h-11" /></div>
              </CardContent>
            </Card>

            {competitions.map(c => {
              const q = fold(search[c.key] || '');
              const shown = q ? c.entries.filter(e => fold(`${e.title} ${e.subtitle}`).includes(q)) : c.entries;
              const selectedTitle = c.entries.find(e => e.id === choice[c.key])?.title;
              return (
                <Card key={c.key}>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base"><Vote className="h-5 w-5 text-primary" /> {c.label || c.key}</CardTitle>
                    <CardDescription>
                      {selectedTitle ? <>Your choice: <span className="font-medium text-gray-800">{selectedTitle}</span>{c.my_vote === choice[c.key] ? ' · recorded' : ' · not sent yet'}</> : `Choose one of ${c.entries.length}.`}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {c.entries.length > 8 && (
                      <div className="relative">
                        <Search className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                        <Input value={search[c.key] || ''} onChange={e => setSearch(prev => ({ ...prev, [c.key]: e.target.value }))} placeholder="Search by name" className="pl-9 h-10" />
                      </div>
                    )}
                    <div className="grid gap-2">
                      {shown.map(e => {
                        const selected = choice[c.key] === e.id;
                        return (
                          <button key={e.id} type="button" onClick={() => pick(c.key, e.id)}
                            className={`text-left rounded-xl border p-3 flex items-center justify-between gap-3 transition-all ${selected ? 'border-primary ring-2 ring-primary/30 bg-primary/5' : 'border-gray-200 bg-white hover:border-primary/40'}`}>
                            <span className="min-w-0">
                              <span className="block font-semibold text-gray-900">{e.title}</span>
                              {e.subtitle && <span className="block text-[11px] uppercase tracking-wide text-gray-400">{e.subtitle}</span>}
                            </span>
                            {selected && <Check className="h-5 w-5 text-primary shrink-0" />}
                          </button>
                        );
                      })}
                      {shown.length === 0 && <p className="text-sm text-gray-400 text-center py-3">No entry matches “{search[c.key]}”.</p>}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </>
        )}
      </div>

      {open && !loading && !loadFailed && (
        <div className="fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur border-t border-gray-200">
          <div className="container mx-auto px-4 py-3 max-w-2xl">
            {problem && <p className="text-sm text-red-600 mb-2">{problem}</p>}
            {thanks && !problem && <p className="text-sm text-green-700 mb-2 flex items-center gap-1.5"><Check className="h-4 w-4" /> Thank you — your vote is recorded.</p>}
            <Button className="w-full h-12 text-base" onClick={submit} disabled={busy || (hasVoted && pending.length === 0)}>
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : hasVoted ? (pending.length ? 'Update my vote' : 'Vote recorded') : 'Submit my vote'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
