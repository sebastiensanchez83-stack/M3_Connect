import { useState, useEffect, useCallback } from 'react';
import { Loader2, UserCheck, Trash2, Inbox } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';

// Scores that came in through the open link (/sm26/score) under a name we could
// not resolve to a confirmed juror — a typo, a nickname, someone never
// registered. They are held whole rather than counted or dropped, and this is
// where M3 decides. Attributing one writes a normal review and it joins the
// awards score like any other.

interface OpenScore {
  id: string; juror_name: string; company: string; entry_id: string;
  total_score: number | null; confidence: number | null; created_at: string;
}
interface Juror { user_id: string; name: string }

export function AdminSM26OpenScores({ eventId, jurors, onChanged }: {
  eventId: string; jurors: Juror[]; onChanged?: () => void;
}) {
  const [rows, setRows] = useState<OpenScore[]>([]);
  const [loading, setLoading] = useState(true);
  const [pick, setPick] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!eventId) return;
    setLoading(true);
    const { data, error } = await supabase.rpc('sm_admin_open_scores', { p_event_id: eventId });
    if (error) toast({ title: 'Could not load open-link scores', description: error.message, variant: 'destructive' });
    setRows((data || []) as OpenScore[]);
    setLoading(false);
  }, [eventId]);
  useEffect(() => { load(); }, [load]);

  const attribute = async (r: OpenScore) => {
    const juror = pick[r.id];
    if (!juror) { toast({ title: 'Choose which juror this is', variant: 'destructive' }); return; }
    const who = jurors.find(j => j.user_id === juror)?.name || 'this juror';
    if (!window.confirm(`Record "${r.juror_name}" score of ${r.total_score}/100 on ${r.company} as ${who}? It will count in the awards score.`)) return;
    setBusy(r.id);
    const { data, error } = await supabase.rpc('sm_admin_open_score_attribute', { p_id: r.id, p_juror_user_id: juror });
    setBusy(null);
    const res = (data || {}) as { ok?: boolean; error?: string };
    if (error || !res.ok) {
      toast({ title: 'Could not attribute', description: error?.message || res.error, variant: 'destructive' });
      return;
    }
    toast({ title: `Attributed to ${who}` });
    load(); onChanged?.();
  };

  const discard = async (r: OpenScore) => {
    if (!window.confirm(`Delete the score "${r.juror_name}" left on ${r.company}? This cannot be undone.`)) return;
    setBusy(r.id);
    const { error } = await supabase.rpc('sm_admin_open_score_discard', { p_id: r.id });
    setBusy(null);
    if (error) { toast({ title: 'Could not delete', description: error.message, variant: 'destructive' }); return; }
    load();
  };

  if (loading) return <div className="py-6 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gray-300" /></div>;

  return (
    <div className="space-y-3">
      <div>
        <div className="text-sm font-semibold text-gray-900 flex items-center gap-2">
          <Inbox className="h-4 w-4 text-primary" /> Open-link scores awaiting a name ({rows.length})
        </div>
        <p className="text-xs text-gray-500 mt-0.5 max-w-prose">
          Left through the no-account scorecard under a name we could not match to a confirmed juror.
          They count for nothing until you attribute them.
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-gray-400">Nothing waiting. Every open-link score so far matched a juror.</p>
      ) : rows.map(r => (
        <div key={r.id} className="rounded-lg border border-amber-200 bg-amber-50/50 px-3 py-2.5">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <div className="text-sm font-medium text-gray-900">
                “{r.juror_name}” · {r.company}
              </div>
              <div className="text-xs text-gray-500 mt-0.5">
                {r.total_score != null ? `${r.total_score}/100` : 'no total'}
                {r.confidence != null ? ` · confidence ${r.confidence}/3` : ''}
                {' · '}{new Date(r.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
              <select
                className="text-xs rounded-md border border-gray-200 px-2 py-1.5 bg-white max-w-[200px]"
                value={pick[r.id] || ''}
                onChange={e => setPick(p => ({ ...p, [r.id]: e.target.value }))}
              >
                <option value="">This is…</option>
                {jurors.map(j => <option key={j.user_id} value={j.user_id}>{j.name}</option>)}
              </select>
              <Button size="sm" className="gap-1" disabled={busy === r.id} onClick={() => attribute(r)}>
                {busy === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserCheck className="h-3.5 w-3.5" />} Attribute
              </Button>
              <Button size="sm" variant="ghost" className="gap-1 text-gray-500" disabled={busy === r.id} onClick={() => discard(r)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
