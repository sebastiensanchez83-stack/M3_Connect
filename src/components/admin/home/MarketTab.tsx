import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe, Layers, RefreshCw, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { formatCapitalRange } from '@/components/capital/InvestmentThesisSection';
import { CardLink } from '@/components/home/dashboard/DashboardKit';
import { AdminEmpty, AdminLoading, AdminPanel, AdminStatusPill, ADMIN_BTN } from '../AdminUI';

/**
 * The "Market" tab of the admin home: what was Industry Pulse (/admin/pulse, now redirected
 * here), kept to the cards that say something about the market. The platform totals, the
 * persona split and the funnel are gone: the home's "This week" figures and the To validate
 * list already show them, from live data. Source: the latest pulse_snapshots row, computed
 * every night at 07:00 UTC (compute_pulse_snapshot); "Refresh now" recomputes it.
 */

interface PulseSector { sector_id: string; label: string; rfp_count: number; partner_count: number; marina_interest_count: number; supply_gap: boolean }
interface PulseGeo { country: string; marinas: number; partners: number; developers: number; investors: number; total: number }
interface PulseCapitalSeeker {
  id: string; name: string; slug: string; type: string; country: string | null; capital_type: string | null;
  amount_min: number | null; amount_max: number | null; stage: string | null; use_of_funds: string | null; updated_at: string;
}
interface PulseData {
  sectors?: PulseSector[];
  geo?: PulseGeo[];
  capital_seekers?: { total: number; items: PulseCapitalSeeker[] };
}

const signal = (s: PulseSector): { tone: 'danger' | 'warning' | 'success' | 'neutral'; label: string; rank: number } => {
  if (s.supply_gap) return { tone: 'danger', label: 'Not enough providers', rank: 0 };
  if (s.rfp_count === 0 && s.partner_count === 0) return { tone: 'neutral', label: 'No activity', rank: 3 };
  if (s.partner_count > s.rfp_count + 2) return { tone: 'warning', label: 'Many providers', rank: 2 };
  return { tone: 'success', label: 'Balanced', rank: 1 };
};

export function MarketTab() {
  const { t } = useTranslation();
  const [state, setState] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading');
  const [data, setData] = useState<PulseData | null>(null);
  const [snapshotDate, setSnapshotDate] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data: rows, error } = await supabase
      .from('pulse_snapshots')
      .select('snapshot_date, snapshot_data')
      .order('snapshot_date', { ascending: false })
      .limit(1);
    if (error) { setState('error'); return; }
    if (!rows || rows.length === 0) { setState('empty'); return; }
    setSnapshotDate(rows[0].snapshot_date as string);
    setData(rows[0].snapshot_data as PulseData);
    setState('ready');
  }, []);

  useEffect(() => { void load(); }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    const { error } = await supabase.rpc('refresh_pulse_snapshot');
    if (error) toast({ title: t('adminHome.market.refreshFailed', 'The market figures could not be recomputed'), description: error.message, variant: 'destructive' });
    else await load();
    setRefreshing(false);
  };

  const refreshButton = (
    <Button type="button" variant="outline" size="sm" className={ADMIN_BTN} onClick={refresh} disabled={refreshing}>
      <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden="true" />
      {t('adminHome.market.refresh', 'Recompute now')}
    </Button>
  );

  if (state === 'loading') return <AdminLoading />;
  if (state !== 'ready' || !data) {
    return (
      <AdminPanel>
        <AdminEmpty
          icon={TrendingUp}
          title={state === 'error' ? t('adminHome.market.error', 'The market figures could not be loaded') : t('adminHome.market.empty', 'No market figures yet')}
          body={t('adminHome.market.emptyBody', 'They are computed every night. You can also compute them now.')}
          action={refreshButton}
        />
      </AdminPanel>
    );
  }

  const sectors = [...(data.sectors ?? [])].sort((a, b) => signal(a).rank - signal(b).rank || b.rfp_count - a.rfp_count);
  const gaps = sectors.filter(s => s.supply_gap).length;
  const geo = data.geo ?? [];
  const seekers = data.capital_seekers?.items ?? [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[14px] leading-5 text-meta">
          {t('adminHome.market.asOf', 'Computed every night at 07:00 UTC. Last computed: {{date}}.', { date: snapshotDate ? new Date(snapshotDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '—' })}
        </p>
        {refreshButton}
      </div>

      <AdminPanel
        icon={Layers}
        title={t('adminHome.market.sectors', 'Supply gaps by sector')}
        description={gaps
          ? t('adminHome.market.sectorsGaps', { count: gaps, defaultValue_one: '{{count}} sector where marinas ask for more than the providers on the platform can offer.', defaultValue_other: '{{count}} sectors where marinas ask for more than the providers on the platform can offer.' })
          : t('adminHome.market.sectorsNoGap', 'Requests for proposals compared with the providers listed in each sector.')}
        padded={false}
      >
        {sectors.length === 0 ? (
          <AdminEmpty title={t('adminHome.market.noSectors', 'No sector figures in this snapshot.')} />
        ) : (
          <ul className="divide-y divide-rule">
            {sectors.map(s => {
              const sig = signal(s);
              return (
                <li key={s.sector_id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3">
                  <span className="min-w-0 flex-1 text-[14px] font-semibold leading-5 text-navy">{s.label}</span>
                  <span className="text-[13px] leading-5 tabular-nums text-meta">
                    {t('adminHome.market.sectorLine', '{{rfps}} RFPs · {{providers}} providers · {{marinas}} marinas interested', { rfps: s.rfp_count, providers: s.partner_count, marinas: s.marina_interest_count })}
                  </span>
                  <AdminStatusPill tone={sig.tone}>{sig.label}</AdminStatusPill>
                </li>
              );
            })}
          </ul>
        )}
      </AdminPanel>

      <div className="grid gap-5 lg:grid-cols-2">
        <AdminPanel icon={Globe} title={t('adminHome.market.geo', 'Where the members are')} description={t('adminHome.market.geoBody', 'Companies per country, the 15 largest (every company with a country, validated or not).')} padded={false}>
          {geo.length === 0 ? (
            <AdminEmpty title={t('adminHome.market.noGeo', 'No country figures in this snapshot.')} />
          ) : (
            <ul className="divide-y divide-rule">
              {geo.map(g => (
                <li key={g.country} className="flex flex-wrap items-center gap-x-4 gap-y-0.5 px-5 py-2.5">
                  <span className="min-w-0 flex-1 text-[14px] font-semibold leading-5 text-navy">{g.country}</span>
                  <span className="text-[13px] leading-5 tabular-nums text-meta">
                    {t('adminHome.market.geoLine', '{{marinas}} marinas · {{providers}} providers · {{developers}} developers · {{investors}} investors', { marinas: g.marinas, providers: g.partners, developers: g.developers, investors: g.investors })}
                  </span>
                  <span className="w-10 text-right text-[14px] font-semibold tabular-nums text-navy">{g.total}</span>
                </li>
              ))}
            </ul>
          )}
        </AdminPanel>

        <AdminPanel
          icon={TrendingUp}
          title={t('adminHome.market.capital', 'Companies looking for capital')}
          description={t('adminHome.market.capitalBody', { count: data.capital_seekers?.total ?? 0, defaultValue_one: '{{count}} company says it is raising money.', defaultValue_other: '{{count}} companies say they are raising money.' })}
          padded={false}
        >
          {seekers.length === 0 ? (
            <AdminEmpty title={t('adminHome.market.noCapital', 'No company says it is raising money yet.')} />
          ) : (
            <ul className="divide-y divide-rule">
              {seekers.slice(0, 8).map(s => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                  <span className="min-w-0">
                    <span className="block text-[14px] font-semibold leading-5 text-navy">{s.name}</span>
                    <span className="block text-[13px] leading-5 text-meta">
                      {[formatCapitalRange(s.amount_min, s.amount_max), s.country, s.stage?.replace(/_/g, ' ')].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <CardLink to={`/organizations/${s.slug}`}>{t('adminHome.market.openPage', 'Public page')}</CardLink>
                </li>
              ))}
            </ul>
          )}
        </AdminPanel>
      </div>
    </div>
  );
}
