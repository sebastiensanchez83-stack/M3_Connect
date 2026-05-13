import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { LoadingSkeleton } from '@/components/LoadingSkeleton';
import {
  TrendingUp, TrendingDown, Users, FileText, Link2,
  RefreshCw, Anchor, HardHat, Building2, Newspaper,
  AlertTriangle, Globe, Layers, ExternalLink,
} from 'lucide-react';
import { formatCapitalRange } from '@/components/capital/InvestmentThesisSection';

interface PulseTotals {
  total_users: number;
  verified: number;
  pending: number;
  rejected: number;
  marinas: number;
  partners: number;
  media_partners: number;
  developers: number;
  investors: number;
  admins: number;
}

interface PulseThisWeek {
  new_users: number;
  prev_week_users: number;
  new_rfps: number;
  prev_week_rfps: number;
  new_consultations: number;
  new_b2b_requests: number;
}

interface PulseThisMonth {
  new_users: number;
  new_rfps: number;
  new_consultations: number;
  new_b2b_requests: number;
}

interface PulseFunnel {
  signups: number;
  submitted: number;
  verified: number;
}

interface PulseSector {
  sector_id: string;
  label: string;
  rfp_count: number;
  partner_count: number;
  marina_interest_count: number;
  supply_gap: boolean;
}

interface PulseGeo {
  country: string;
  marinas: number;
  partners: number;
  developers: number;
  investors: number;
  total: number;
}

interface PulseCapitalSeeker {
  id: string;
  name: string;
  slug: string;
  type: string;
  country: string | null;
  capital_type: string | null;
  amount_min: number | null;
  amount_max: number | null;
  stage: string | null;
  use_of_funds: string | null;
  updated_at: string;
}

interface PulseStuck {
  signup_stalled: number;
  pending_over_7d: number;
}

interface PulseData {
  totals: PulseTotals;
  this_week: PulseThisWeek;
  this_month: PulseThisMonth;
  funnel: PulseFunnel;
  sectors: PulseSector[];
  geo: PulseGeo[];
  capital_seekers: { total: number; items: PulseCapitalSeeker[] };
  stuck: PulseStuck;
  generated_at: string;
}

export function AdminPulse() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [snapshotDate, setSnapshotDate] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [data, setData] = useState<PulseData | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: rows, error } = await supabase
      .from('pulse_snapshots')
      .select('snapshot_date, generated_at, snapshot_data')
      .order('snapshot_date', { ascending: false })
      .limit(1);
    if (error) {
      toast({ title: 'Could not load Pulse', description: error.message, variant: 'destructive' });
    } else if (rows && rows.length > 0) {
      setSnapshotDate(rows[0].snapshot_date as string);
      setGeneratedAt(rows[0].generated_at as string);
      setData(rows[0].snapshot_data as unknown as PulseData);
    }
    setLoading(false);
  }, []);

  const refresh = async () => {
    setRefreshing(true);
    const { error } = await supabase.rpc('refresh_pulse_snapshot');
    if (error) {
      toast({ title: 'Refresh failed', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Snapshot refreshed' });
      await load();
    }
    setRefreshing(false);
  };

  useEffect(() => { load(); }, [load]);

  if (loading) return <LoadingSkeleton variant="page" />;

  if (!data) {
    return (
      <Card>
        <CardContent className="py-16 text-center">
          <TrendingUp className="h-10 w-10 text-gray-300 mx-auto mb-3" />
          <h3 className="font-medium text-gray-800 mb-1">No snapshot yet</h3>
          <p className="text-sm text-gray-500 mb-5">Generate the first one to see the dashboard.</p>
          <Button onClick={refresh} disabled={refreshing}>
            <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
            Generate snapshot
          </Button>
        </CardContent>
      </Card>
    );
  }

  const weekDelta = data.this_week.new_users - data.this_week.prev_week_users;
  const weekDeltaPct = data.this_week.prev_week_users > 0
    ? Math.round(((data.this_week.new_users - data.this_week.prev_week_users) / data.this_week.prev_week_users) * 100)
    : null;

  const rfpsWeekDelta = data.this_week.new_rfps - data.this_week.prev_week_rfps;

  const funnel = data.funnel;
  const submitRate = funnel.signups > 0 ? Math.round((funnel.submitted / funnel.signups) * 100) : 0;
  const verifyRate = funnel.submitted > 0 ? Math.round((funnel.verified / funnel.submitted) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Industry Pulse</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Strategic snapshot of the platform — generated nightly at 07:00 UTC.
            {snapshotDate && <> Last snapshot: <strong>{snapshotDate}</strong></>}
            {generatedAt && <span className="text-gray-400"> · {new Date(generatedAt).toLocaleTimeString()}</span>}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing}>
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh now
        </Button>
      </div>

      {/* Stuck warnings (operational, but worth seeing here) */}
      {(data.stuck.signup_stalled > 0 || data.stuck.pending_over_7d > 0) && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="text-sm text-amber-900 space-y-1">
                {data.stuck.signup_stalled > 0 && (
                  <p><strong>{data.stuck.signup_stalled}</strong> user{data.stuck.signup_stalled > 1 ? 's' : ''} signed up but never finished onboarding (3+ days).</p>
                )}
                {data.stuck.pending_over_7d > 0 && (
                  <p><strong>{data.stuck.pending_over_7d}</strong> profile{data.stuck.pending_over_7d > 1 ? 's' : ''} have been pending review for over 7 days.</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Top KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          icon={<Users className="h-5 w-5 text-blue-500" />}
          label="Total users"
          value={data.totals.total_users}
          sub={`${data.totals.verified} verified · ${data.totals.pending} pending`}
        />
        <KpiCard
          icon={<TrendingUp className="h-5 w-5 text-emerald-500" />}
          label="New users (week)"
          value={data.this_week.new_users}
          sub={
            weekDeltaPct !== null
              ? `${weekDelta >= 0 ? '▲' : '▼'} ${Math.abs(weekDeltaPct)}% vs prev week`
              : `${data.this_week.prev_week_users} prev week`
          }
          deltaPositive={weekDelta >= 0}
        />
        <KpiCard
          icon={<FileText className="h-5 w-5 text-violet-500" />}
          label="New RFPs (week)"
          value={data.this_week.new_rfps}
          sub={`${data.this_month.new_rfps} this month`}
          deltaPositive={rfpsWeekDelta >= 0}
        />
        <KpiCard
          icon={<Link2 className="h-5 w-5 text-cyan-500" />}
          label="B2B requests (week)"
          value={data.this_week.new_b2b_requests}
          sub={`${data.this_month.new_b2b_requests} this month`}
        />
      </div>

      {/* Persona breakdown */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4 text-gray-400" />
            By persona
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <PersonaCount icon={<Anchor className="h-4 w-4 text-blue-500" />} label="Marinas" count={data.totals.marinas} />
            <PersonaCount icon={<Building2 className="h-4 w-4 text-orange-500" />} label="Partners" count={data.totals.partners} />
            <PersonaCount icon={<Newspaper className="h-4 w-4 text-purple-500" />} label="Media" count={data.totals.media_partners} />
            <PersonaCount icon={<HardHat className="h-4 w-4 text-amber-600" />} label="Developers" count={data.totals.developers} />
            <PersonaCount icon={<TrendingUp className="h-4 w-4 text-emerald-600" />} label="Investors" count={data.totals.investors} />
          </div>
        </CardContent>
      </Card>

      {/* Funnel */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Layers className="h-4 w-4 text-gray-400" />
            Onboarding funnel
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-3">
            <FunnelStep label="Signups" value={funnel.signups} pct={null} />
            <FunnelStep label="Profile submitted" value={funnel.submitted} pct={submitRate} />
            <FunnelStep label="Verified" value={funnel.verified} pct={verifyRate} />
          </div>
        </CardContent>
      </Card>

      {/* Sector heat-map */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Layers className="h-4 w-4 text-gray-400" />
            Sector heat-map
            <Badge variant="outline" className="text-[10px] ml-1">RFP demand vs partner supply</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400 uppercase tracking-wide border-b">
                  <th className="text-left py-2 px-2 font-medium">Sector</th>
                  <th className="text-right py-2 px-2 font-medium">RFPs</th>
                  <th className="text-right py-2 px-2 font-medium">Partners</th>
                  <th className="text-right py-2 px-2 font-medium">Marina interest</th>
                  <th className="text-right py-2 px-2 font-medium">Signal</th>
                </tr>
              </thead>
              <tbody>
                {data.sectors.map((s) => (
                  <tr key={s.sector_id} className="border-b last:border-b-0">
                    <td className="py-2 px-2 text-gray-900">{s.label}</td>
                    <td className="py-2 px-2 text-right tabular-nums text-gray-700">{s.rfp_count}</td>
                    <td className="py-2 px-2 text-right tabular-nums text-gray-700">{s.partner_count}</td>
                    <td className="py-2 px-2 text-right tabular-nums text-gray-700">{s.marina_interest_count}</td>
                    <td className="py-2 px-2 text-right">
                      {s.supply_gap ? (
                        <Badge className="bg-red-100 text-red-700 border-red-200 text-[10px]">supply gap</Badge>
                      ) : s.rfp_count === 0 && s.partner_count === 0 ? (
                        <span className="text-[10px] text-gray-300">—</span>
                      ) : s.partner_count > s.rfp_count + 2 ? (
                        <Badge variant="outline" className="text-[10px] text-amber-700 border-amber-200">oversupplied</Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] text-emerald-700 border-emerald-200">balanced</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Geographic distribution */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Globe className="h-4 w-4 text-gray-400" />
            Geographic distribution
            <Badge variant="outline" className="text-[10px] ml-1">Top {data.geo.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400 uppercase tracking-wide border-b">
                  <th className="text-left py-2 px-2 font-medium">Country</th>
                  <th className="text-right py-2 px-2 font-medium">Marinas</th>
                  <th className="text-right py-2 px-2 font-medium">Partners</th>
                  <th className="text-right py-2 px-2 font-medium">Developers</th>
                  <th className="text-right py-2 px-2 font-medium">Investors</th>
                  <th className="text-right py-2 px-2 font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.geo.map((g) => (
                  <tr key={g.country} className="border-b last:border-b-0">
                    <td className="py-2 px-2 text-gray-900">{g.country}</td>
                    <td className="py-2 px-2 text-right tabular-nums text-gray-700">{g.marinas}</td>
                    <td className="py-2 px-2 text-right tabular-nums text-gray-700">{g.partners}</td>
                    <td className="py-2 px-2 text-right tabular-nums text-gray-700">{g.developers}</td>
                    <td className="py-2 px-2 text-right tabular-nums text-gray-700">{g.investors}</td>
                    <td className="py-2 px-2 text-right tabular-nums font-medium text-gray-900">{g.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Capital seekers */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-emerald-500" />
            Capital-seeking organizations
            <Badge variant="outline" className="text-[10px] ml-1">{data.capital_seekers.total} active</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.capital_seekers.items.length === 0 ? (
            <p className="text-sm text-gray-500 py-2">No orgs are flagged as seeking capital yet.</p>
          ) : (
            <div className="divide-y">
              {data.capital_seekers.items.slice(0, 10).map((s) => (
                <div key={s.id} className="py-3 flex items-center justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <Link to={`/organizations/${s.slug}`} className="font-medium text-gray-900 hover:text-primary inline-flex items-center gap-1">
                      {s.name}
                      <ExternalLink className="h-3 w-3 text-gray-400" />
                    </Link>
                    <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-500 flex-wrap">
                      <Badge variant="outline" className="text-[10px] capitalize">{s.type}</Badge>
                      {s.country && <span>· {s.country}</span>}
                      {s.stage && <span className="capitalize">· {s.stage.replace('_', ' ')}</span>}
                      {s.capital_type && <span className="capitalize">· {s.capital_type.replace('_', ' ')}</span>}
                    </div>
                    {s.use_of_funds && (
                      <p className="text-xs text-gray-500 mt-1 line-clamp-1">{s.use_of_funds}</p>
                    )}
                  </div>
                  <div className="text-right text-sm">
                    <p className="font-medium text-emerald-700">{formatCapitalRange(s.amount_min, s.amount_max)}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">Updated {new Date(s.updated_at).toLocaleDateString()}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCard({ icon, label, value, sub, deltaPositive }: {
  icon: React.ReactNode;
  label: string;
  value: number;
  sub?: string;
  deltaPositive?: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          {icon}
          {deltaPositive !== undefined && (
            deltaPositive
              ? <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />
              : <TrendingDown className="h-3.5 w-3.5 text-red-500" />
          )}
        </div>
        <p className="text-2xl font-bold text-gray-900">{value.toLocaleString()}</p>
        <p className="text-xs text-gray-500 mt-0.5">{label}</p>
        {sub && <p className="text-[10px] text-gray-400 mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function PersonaCount({ icon, label, count }: { icon: React.ReactNode; label: string; count: number }) {
  return (
    <div className="p-3 rounded-lg bg-gray-50 border">
      <div className="flex items-center gap-2 mb-1.5">
        {icon}
        <span className="text-xs text-gray-500">{label}</span>
      </div>
      <p className="text-xl font-bold text-gray-900">{count.toLocaleString()}</p>
    </div>
  );
}

function FunnelStep({ label, value, pct }: { label: string; value: number; pct: number | null }) {
  return (
    <div className="p-3 rounded-lg bg-gray-50 border">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-2xl font-bold text-gray-900 mt-1">{value.toLocaleString()}</p>
      {pct !== null && (
        <p className="text-[10px] text-gray-400 mt-1">{pct}% of previous step</p>
      )}
    </div>
  );
}

