import { useState, useEffect } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import { RefreshCw, Vote, Check, Lock, QrCode, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';

// Public vote (Area 8). Any checked-in attendee gets one vote per competition.
// Architecture is de-anonymised for the public vote (non-blind by design).

interface Entry { id: string; title: string; subtitle: string; }
interface Ballot { open: boolean; eligible: boolean; my_vote: string | null; entries: Entry[]; }

const COMPS = [
  { key: 'innovation', label: 'Innovation — Audience Choice' },
  { key: 'architecture_pro', label: 'Architecture — Public Prize (Pro)' },
  { key: 'architecture_student', label: 'Architecture — Public Prize (Student)' },
];

export function SM26VotePage() {
  const { user, loading: authLoading } = useAuth();
  const [eventId, setEventId] = useState<string | null>(null);
  const [ballots, setBallots] = useState<Record<string, Ballot>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => { load(); }, [user]);

  const load = async () => {
    setLoading(true);
    const { data: ev } = await supabase.from('sm_event').select('id').eq('slug', 'sm26').maybeSingle();
    if (!ev) { setLoading(false); return; }
    const eid = (ev as { id: string }).id;
    setEventId(eid);
    const results = await Promise.all(COMPS.map(c => supabase.rpc('sm_vote_ballot', { p_event_id: eid, p_competition: c.key })));
    const map: Record<string, Ballot> = {};
    results.forEach((r, i) => { map[COMPS[i].key] = (r.data || { open: false, eligible: false, my_vote: null, entries: [] }) as Ballot; });
    setBallots(map);
    setLoading(false);
  };

  const vote = async (comp: string, entryId: string) => {
    if (!eventId) return;
    setBusy(comp + entryId);
    const { error } = await supabase.rpc('sm_cast_vote', { p_event_id: eventId, p_competition: comp, p_entry_id: entryId });
    setBusy(null);
    if (error) { toast({ title: 'Could not vote', description: error.message, variant: 'destructive' }); return; }
    setBallots(prev => ({ ...prev, [comp]: { ...prev[comp], my_vote: entryId } }));
    toast({ title: 'Vote recorded' });
  };

  if (authLoading || loading) return <div className="flex items-center justify-center h-[60vh]"><RefreshCw className="h-8 w-8 animate-spin text-primary" /></div>;

  const anyEligible = Object.values(ballots).some(b => b.eligible);
  const activeComps = COMPS.filter(c => (ballots[c.key]?.entries.length || 0) > 0);

  return (
    <div className="min-h-screen bg-gray-50">
      <Helmet><title>Vote — Smart &amp; Sustainable Marina Rendezvous 2026</title></Helmet>
      <section className="bg-gradient-to-br from-[#0b2653] to-[#143a6b] text-white">
        <div className="container mx-auto px-4 py-12">
          <p className="uppercase tracking-wide text-white/60 text-sm mb-2">SM26 · Audience vote</p>
          <h1 className="text-3xl lg:text-4xl font-bold">Cast your vote</h1>
          <p className="text-white/80 mt-2 max-w-2xl">One vote per competition. You can change it until voting closes.</p>
        </div>
      </section>

      <div className="container mx-auto px-4 py-8 max-w-2xl space-y-6">
        {!user ? (
          <Card><CardContent className="py-10 text-center text-gray-500">Please sign in to vote.</CardContent></Card>
        ) : !anyEligible ? (
          <Card>
            <CardContent className="py-10 text-center">
              <QrCode className="h-10 w-10 text-gray-300 mx-auto mb-3" />
              <p className="font-medium text-gray-700">Check in to vote</p>
              <p className="text-sm text-gray-500 mt-1">Voting is open to checked-in attendees only. Please check in at the entrance, then come back.</p>
            </CardContent>
          </Card>
        ) : activeComps.length === 0 ? (
          <Card><CardContent className="py-10 text-center text-gray-400">No entries to vote on yet.</CardContent></Card>
        ) : (
          activeComps.map(c => {
            const b = ballots[c.key];
            return (
              <Card key={c.key}>
                <CardHeader>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <CardTitle className="flex items-center gap-2"><Vote className="h-5 w-5 text-primary" /> {c.label}</CardTitle>
                    {!b.open && <span className="text-xs text-gray-500 inline-flex items-center gap-1"><Lock className="h-3 w-3" /> Voting closed</span>}
                  </div>
                  <CardDescription>{b.my_vote ? 'Your vote is recorded — tap another entry to change it.' : 'Tap an entry to vote.'}</CardDescription>
                </CardHeader>
                <CardContent className="grid sm:grid-cols-2 gap-2">
                  {b.entries.map(e => {
                    const selected = b.my_vote === e.id;
                    return (
                      <button key={e.id} type="button" disabled={!b.open || busy === c.key + e.id}
                        onClick={() => vote(c.key, e.id)}
                        className={`text-left rounded-xl border p-3 transition-all ${selected ? 'border-primary ring-2 ring-primary/30 bg-primary/5' : 'border-gray-200 hover:border-primary/40'} ${!b.open ? 'opacity-60 cursor-not-allowed' : ''}`}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-gray-900">{e.title}</span>
                          {busy === c.key + e.id ? <Loader2 className="h-4 w-4 animate-spin text-primary" /> : selected && <Check className="h-4 w-4 text-primary" />}
                        </div>
                        {e.subtitle && <div className="text-xs text-gray-500">{e.subtitle}</div>}
                      </button>
                    );
                  })}
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
