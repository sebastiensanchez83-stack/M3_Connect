import { useState, useEffect, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Scale, LayoutDashboard, Vote, ClipboardList, Trophy, AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { supabase } from '@/lib/supabase';
import { AdminSM26Jury } from '@/components/admin/AdminSM26Jury';
import { AdminSM26Awards } from '@/components/admin/AdminSM26Awards';
import { AdminSM26Evaluations } from '@/components/admin/AdminSM26Evaluations';

// Merged "Evaluation & Awards" console: one home for jury scoring, the full
// evaluation drill-down, the public vote and the award winners — with an
// overview dashboard on top. Each tab reuses the existing consoles (embedded),
// so nothing about how scoring / voting / awards work changes.

type Tab = 'overview' | 'jury' | 'evaluations' | 'awards';
const TABS: { key: Tab; label: string; icon: typeof Scale }[] = [
  { key: 'overview', label: 'Overview', icon: LayoutDashboard },
  { key: 'jury', label: 'Jury scoring', icon: Scale },
  { key: 'evaluations', label: 'Evaluations', icon: ClipboardList },
  { key: 'awards', label: 'Awards & voting', icon: Trophy },
];

export function AdminSM26Evaluation() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('overview');

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={() => navigate('/admin/sm26')} className="gap-1.5"><ArrowLeft className="h-4 w-4" /> Back to registrations</Button>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Scale className="h-6 w-6 text-primary" /> Evaluation &amp; Awards</h1>
        <div className="flex rounded-lg border border-gray-200 overflow-hidden flex-wrap">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-3 h-9 text-sm inline-flex items-center gap-1.5 ${tab === t.key ? 'bg-primary text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
              <t.icon className="h-4 w-4" /> {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'overview' && <Overview onGo={setTab} />}
      {tab === 'jury' && <AdminSM26Jury embedded />}
      {tab === 'evaluations' && <AdminSM26Evaluations />}
      {tab === 'awards' && <AdminSM26Awards embedded />}
    </div>
  );
}

interface RankRow { assigned: number; submitted: number; score_stddev: number | null; coi_count: number; title: string; subtitle: string; }
interface EvalRow { juror_user_id: string; status: string; }

function Overview({ onGo }: { onGo: (t: Tab) => void }) {
  const [loading, setLoading] = useState(true);
  const [ranks, setRanks] = useState<RankRow[]>([]);
  const [evals, setEvals] = useState<EvalRow[]>([]);
  const [votes, setVotes] = useState(0);
  const [openComps, setOpenComps] = useState(0);
  const [awards, setAwards] = useState<{ confirmed: boolean }[]>([]);

  useEffect(() => { load(); }, []);
  const load = async () => {
    setLoading(true);
    const { data: ev } = await supabase.from('sm_event').select('id').eq('slug', 'sm26').maybeSingle();
    if (!ev) { setLoading(false); return; }
    const eid = (ev as { id: string }).id;
    const comps = ['innovation', 'architecture_pro', 'architecture_student'];
    const [rk, ev2, aw, cfg, ...tallies] = await Promise.all([
      supabase.rpc('sm_admin_rankings', { p_event_id: eid, p_competition: 'innovation' }),
      supabase.rpc('sm_admin_evaluations', { p_event_id: eid, p_competition: 'innovation' }),
      supabase.from('sm_award').select('confirmed').eq('event_id', eid),
      supabase.from('sm_vote_config').select('competition,is_open').eq('event_id', eid),
      ...comps.map(c => supabase.rpc('sm_vote_tally', { p_event_id: eid, p_competition: c })),
    ]);
    setRanks((rk.data || []) as RankRow[]);
    setEvals((ev2.data || []) as EvalRow[]);
    setAwards((aw.data || []) as { confirmed: boolean }[]);
    setOpenComps(((cfg.data || []) as { is_open: boolean }[]).filter(c => c.is_open).length);
    setVotes(tallies.reduce((s, t) => s + ((t.data || []) as { votes: number }[]).reduce((a, r) => a + (r.votes || 0), 0), 0));
    setLoading(false);
  };

  if (loading) return <div className="flex items-center justify-center h-48"><RefreshCw className="h-7 w-7 animate-spin text-gray-300" /></div>;

  const submittedEvals = evals.filter(e => e.status === 'submitted').length;
  const jurors = new Set(evals.map(e => e.juror_user_id));
  const jurorsScoring = new Set(evals.filter(e => e.status === 'submitted').map(e => e.juror_user_id));
  const fullyReviewed = ranks.filter(r => r.assigned > 0 && r.submitted >= r.assigned).length;
  const belowQuorum = ranks.filter(r => r.assigned > 0 && r.submitted < 2);
  const highDispersion = ranks.filter(r => r.score_stddev != null && r.score_stddev >= 15);
  const coiEntries = ranks.filter(r => r.coi_count > 0);
  const confirmedWins = awards.filter(a => a.confirmed).length;

  const kpis: { k: string; v: string; sub?: string; go?: Tab; tone?: 'g' | 'a' }[] = [
    { k: 'Evaluations submitted', v: `${submittedEvals}`, sub: `of ${evals.length} assigned`, go: 'evaluations' },
    { k: 'Entries fully reviewed', v: `${fullyReviewed}`, sub: `of ${ranks.length}`, go: 'jury', tone: fullyReviewed < ranks.length ? 'a' : 'g' },
    { k: 'Jurors scoring', v: `${jurorsScoring.size}`, sub: `of ${jurors.size}`, go: 'evaluations' },
    { k: 'Public votes', v: `${votes}`, sub: openComps ? `${openComps} vote(s) open` : 'votes closed', go: 'awards' },
    { k: 'Winners confirmed', v: `${confirmedWins}`, sub: `of ${awards.length}`, go: 'awards', tone: confirmedWins < awards.length ? 'a' : 'g' },
  ];

  const Attn = ({ color, children }: { color: string; children: ReactNode }) => (
    <li className="flex items-start gap-2.5 text-sm text-gray-600 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">
      <span className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ background: color }} />
      <span>{children}</span>
    </li>
  );
  const names = (rows: RankRow[]) => rows.slice(0, 6).map(r => r.title).join(', ') + (rows.length > 6 ? '…' : '');

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {kpis.map(t => (
          <button key={t.k} onClick={() => t.go && onGo(t.go)}
            className="text-left rounded-xl bg-white border border-gray-200 border-l-[3px] border-l-primary p-4 hover:shadow-sm transition-shadow">
            <div className="text-[11px] uppercase tracking-wide text-gray-400">{t.k}</div>
            <div className={`text-2xl font-bold mt-0.5 tabular-nums ${t.tone === 'g' ? 'text-green-600' : t.tone === 'a' ? 'text-amber-600' : 'text-gray-900'}`}>{t.v}</div>
            {t.sub && <div className="text-[11px] text-gray-400">{t.sub}</div>}
          </button>
        ))}
      </div>

      <Card className="border-0 shadow-sm">
        <CardContent className="p-4">
          <div className="text-sm font-semibold text-gray-800 flex items-center gap-2 mb-3"><AlertTriangle className="h-4 w-4 text-amber-500" /> Needs attention before awards</div>
          {belowQuorum.length + highDispersion.length + coiEntries.length === 0 ? (
            <p className="text-sm text-gray-400">Nothing flagged — scoring looks clean.</p>
          ) : (
            <ul className="space-y-2">
              {belowQuorum.length > 0 && <Attn color="#dc2626"><b>{belowQuorum.length} entr{belowQuorum.length === 1 ? 'y' : 'ies'} below quorum</b> — fewer than 2 submitted reviews ({names(belowQuorum)})</Attn>}
              {highDispersion.length > 0 && <Attn color="#d97706"><b>{highDispersion.length} high-dispersion entr{highDispersion.length === 1 ? 'y' : 'ies'}</b> — jurors disagree by more than 15 pts ({names(highDispersion)}) → consensus may be needed</Attn>}
              {coiEntries.length > 0 && <Attn color="#dc2626"><b>{coiEntries.length} conflict-of-interest flag(s)</b> — those reviews are excluded from the score ({names(coiEntries)})</Attn>}
              {openComps > 0 && <Attn color="#0d7f8f"><b>Public vote still open</b> for {openComps} competition(s) — close it before finalising winners</Attn>}
            </ul>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-gray-400">Tip: open <button onClick={() => onGo('evaluations')} className="text-primary hover:underline">Evaluations</button> to see exactly who scored each innovation and read the grades they gave; open <button onClick={() => onGo('awards')} className="text-primary hover:underline">Awards &amp; voting</button> and click a vote count to see who voted.</p>
    </div>
  );
}
