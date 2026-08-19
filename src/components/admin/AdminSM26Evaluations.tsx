import { useState, useEffect, useMemo } from 'react';
import { RefreshCw, Scale, AlertTriangle, Search, Check, Clock, X } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/lib/supabase';

// Evaluations drill-down: exactly who scored which entry, and — on click — the
// full scorecard they filled in (every criterion grade + comment, confidence,
// COI). Admin-only (sm_admin_* RPCs are sm_is_staff gated); individual scores
// are never exposed to jurors or startups, so blind judging is unaffected.

type Comp = 'innovation' | 'architecture_pro' | 'architecture_student';
const COMPETITIONS: { key: Comp; label: string }[] = [
  { key: 'innovation', label: 'Innovation' },
  { key: 'architecture_pro', label: 'Architecture · Pro' },
  { key: 'architecture_student', label: 'Architecture · Student' },
];

interface EvalRow {
  entry_id: string; entry_title: string; entry_subtitle: string;
  juror_user_id: string; juror_name: string; juror_type: string | null;
  review_id: string | null; status: string; total_score: number | null;
  confidence: number | null; coi_flag: boolean | null; submitted_at: string | null;
}
interface Criterion { label: string; description: string | null; weight: number; critical: boolean; score: number | null; comment: string | null; }
interface Detail {
  juror_name: string; entry_title: string; template_name: string | null; scale_max: number;
  status: string; total_score: number | null; confidence: number | null; coi_flag: boolean;
  submitted_at: string | null; competition: string; criteria: Criterion[];
}

const CONFIDENCE = ['—', 'Low', 'Medium', 'High'];
const num = (v: number | null | undefined) => (v == null ? null : Number(v));

export function AdminSM26Evaluations() {
  const [eventId, setEventId] = useState<string | null>(null);
  const [competition, setCompetition] = useState<Comp>('innovation');
  const [rows, setRows] = useState<EvalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'entry' | 'juror'>('entry');
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'submitted' | 'draft' | 'not_started'>('all');
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  useEffect(() => {
    supabase.from('sm_event').select('id').eq('slug', 'sm26').maybeSingle()
      .then(({ data }) => setEventId(data ? (data as { id: string }).id : null));
  }, []);
  useEffect(() => { if (eventId) load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [eventId, competition]);

  const load = async () => {
    if (!eventId) return;
    setLoading(true);
    const { data } = await supabase.rpc('sm_admin_evaluations', { p_event_id: eventId, p_competition: competition });
    setRows((data || []) as EvalRow[]);
    setLoading(false);
  };

  const openDetail = async (reviewId: string) => {
    setLoadingDetail(true); setDetail({} as Detail);
    const { data } = await supabase.rpc('sm_admin_evaluation_detail', { p_review_id: reviewId });
    setDetail((data || null) as Detail | null);
    setLoadingDetail(false);
  };

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter(r => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (needle && !r.entry_title.toLowerCase().includes(needle) && !r.juror_name.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [rows, q, statusFilter]);

  const groups = useMemo(() => {
    const m = new Map<string, { title: string; sub: string; rows: EvalRow[] }>();
    for (const r of filtered) {
      const key = view === 'entry' ? r.entry_id : r.juror_user_id;
      const title = view === 'entry' ? r.entry_title : r.juror_name;
      const sub = view === 'entry' ? r.entry_subtitle : (r.juror_type || '');
      if (!m.has(key)) m.set(key, { title, sub, rows: [] });
      m.get(key)!.rows.push(r);
    }
    return [...m.values()].sort((a, b) => a.title.localeCompare(b.title));
  }, [filtered, view]);

  const totals = useMemo(() => ({
    submitted: rows.filter(r => r.status === 'submitted').length,
    total: rows.length,
    jurors: new Set(rows.map(r => r.juror_user_id)).size,
  }), [rows]);

  const chipCls = (r: EvalRow) =>
    r.coi_flag ? 'bg-red-50 text-red-600 border-red-200'
      : r.status === 'submitted' ? 'bg-green-50 text-green-700 border-green-200'
        : r.status === 'draft' ? 'bg-amber-50 text-amber-700 border-amber-200'
          : 'bg-gray-50 text-gray-400 border-gray-200';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-sm text-gray-500">
          <span className="font-semibold text-gray-800">{totals.submitted}</span> of {totals.total} evaluations submitted · {totals.jurors} juror{totals.jurors === 1 ? '' : 's'}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            <button onClick={() => setView('entry')} className={`px-3 h-9 text-sm ${view === 'entry' ? 'bg-primary text-white' : 'bg-white text-gray-600'}`}>By innovation</button>
            <button onClick={() => setView('juror')} className={`px-3 h-9 text-sm ${view === 'juror' ? 'bg-primary text-white' : 'bg-white text-gray-600'}`}>By juror</button>
          </div>
          <Select value={competition} onValueChange={v => setCompetition(v as Comp)}>
            <SelectTrigger className="w-40 h-9"><SelectValue /></SelectTrigger>
            <SelectContent>{COMPETITIONS.map(c => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}</SelectContent>
          </Select>
          <button onClick={load} className="h-9 w-9 grid place-items-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50" title="Refresh"><RefreshCw className="h-4 w-4" /></button>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="h-4 w-4 text-gray-400 absolute left-2.5 top-2.5" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter by innovation or juror…"
            className="w-full h-9 pl-8 pr-3 rounded-lg border border-gray-200 text-sm" />
        </div>
        {(['all', 'submitted', 'draft', 'not_started'] as const).map(s => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={`h-9 px-3 rounded-lg border text-sm ${statusFilter === s ? 'bg-primary text-white border-primary' : 'bg-white text-gray-600 border-gray-200'}`}>
            {s === 'all' ? 'All' : s === 'submitted' ? 'Submitted' : s === 'draft' ? 'In progress' : 'Not started'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48"><RefreshCw className="h-7 w-7 animate-spin text-gray-300" /></div>
      ) : groups.length === 0 ? (
        <Card className="border-0 shadow-sm"><CardContent className="py-12 text-center text-gray-400">No evaluations to show.</CardContent></Card>
      ) : (
        <div className="space-y-2">
          {groups.map(g => {
            const done = g.rows.filter(r => r.status === 'submitted').length;
            return (
              <Card key={g.title} className="border-0 shadow-sm">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="min-w-0">
                      <span className="text-sm font-semibold text-gray-900">{g.title}</span>
                      {g.sub && <span className="text-xs text-gray-500 ml-2 capitalize">{g.sub}</span>}
                    </div>
                    <Badge className={`text-[10px] ${done === g.rows.length ? 'bg-green-50 text-green-700 border-green-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>{done}/{g.rows.length} scored</Badge>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {g.rows.map(r => {
                      const clickable = !!r.review_id && (r.status === 'submitted' || r.status === 'draft');
                      const label = view === 'entry' ? r.juror_name : r.entry_title;
                      const score = num(r.total_score);
                      return (
                        <button key={r.juror_user_id + r.entry_id} type="button" disabled={!clickable}
                          onClick={() => r.review_id && openDetail(r.review_id)}
                          title={clickable ? 'Open the full evaluation' : 'Not scored yet'}
                          className={`inline-flex items-center gap-1.5 text-xs rounded-full border px-2.5 py-1 transition-colors ${chipCls(r)} ${clickable ? 'hover:brightness-95 cursor-pointer' : 'cursor-default'}`}>
                          {r.status === 'submitted' ? <Check className="h-3 w-3 shrink-0" /> : r.status === 'draft' ? <Clock className="h-3 w-3 shrink-0" /> : null}
                          <span className="truncate max-w-[180px]">{label}</span>
                          {r.coi_flag ? <span className="font-semibold">COI</span>
                            : r.status === 'submitted' && score != null ? <span className="font-bold tabular-nums">{score.toFixed(0)}</span>
                              : r.status === 'draft' ? <span className="opacity-70">draft</span> : null}
                        </button>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Full filled scorecard */}
      <Dialog open={!!detail} onOpenChange={o => !o && setDetail(null)}>
        <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto">
          {loadingDetail || !detail?.criteria ? (
            <div className="py-12 flex justify-center"><RefreshCw className="h-6 w-6 animate-spin text-gray-300" /></div>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 flex-wrap">
                  <Scale className="h-5 w-5 text-primary" /> {detail.juror_name}
                  <span className="text-gray-400 font-normal">·</span>
                  <span className="text-gray-700">{detail.entry_title}</span>
                </DialogTitle>
              </DialogHeader>
              <div className="flex items-center gap-2 flex-wrap text-xs text-gray-500 -mt-1">
                {detail.template_name && <Badge variant="secondary" className="text-[10px]">{detail.template_name}</Badge>}
                <Badge className={`text-[10px] ${detail.status === 'submitted' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>{detail.status}</Badge>
                <span>Confidence: <b>{CONFIDENCE[detail.confidence || 0]}</b></span>
                {detail.coi_flag && <Badge className="text-[10px] bg-red-50 text-red-700 border-red-200">Conflict of interest — excluded from score</Badge>}
                {detail.submitted_at && <span>· {new Date(detail.submitted_at).toLocaleString()}</span>}
                <span className="ml-auto text-base font-bold text-primary tabular-nums">{num(detail.total_score) != null ? `${num(detail.total_score)!.toFixed(1)}/100` : '—'}</span>
              </div>
              <div className="space-y-3 mt-2">
                {detail.criteria.map((c, i) => {
                  const s = num(c.score);
                  const low = c.critical && s != null && s < 0.4 * detail.scale_max;
                  return (
                    <div key={i} className="rounded-lg border border-gray-100 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-medium text-gray-800 flex items-center gap-1.5">
                          {c.label}
                          {c.critical && <span title="Critical criterion" className="text-amber-500"><AlertTriangle className="h-3.5 w-3.5" /></span>}
                        </div>
                        <span className="text-[11px] text-gray-400">weight {num(c.weight)}</span>
                      </div>
                      <div className="flex flex-wrap gap-1 mt-2">
                        {Array.from({ length: detail.scale_max + 1 }, (_, n) => n).map(n => (
                          <span key={n} className={`h-7 w-7 grid place-items-center rounded-md text-xs font-medium border ${s === n ? (low ? 'bg-red-500 border-red-500 text-white' : 'bg-primary border-primary text-white') : 'border-gray-200 text-gray-400'}`}>{n}</span>
                        ))}
                      </div>
                      {c.comment && <div className="text-xs text-gray-600 mt-2 italic">“{c.comment}”</div>}
                    </div>
                  );
                })}
              </div>
              <button onClick={() => setDetail(null)} className="mt-2 self-end inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800"><X className="h-4 w-4" /> Close</button>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
