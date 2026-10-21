import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  Activity, AlertTriangle, Bell, CheckCircle2, History, Info, Loader2, RefreshCw, XCircle, type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  ADMIN_BTN_PRIMARY, AdminEmpty, AdminLoading, AdminPageHeader, AdminPanel, AdminSectionLabel, AdminStatusPill,
  type AdminTone,
} from '@/components/admin/AdminUI';
import { ActionCue } from '@/components/home/dashboard/DashboardKit';
import { formatAgo, formatWhen } from './inboxApi';
import { areaLabel, areaRank, helpFor } from './health/checkHelp';
import {
  fetchLiveChecks, fetchMonitorSettings, fetchOpenAlerts, fetchRuns, monitorLate, webChecksFromRun,
  type HealthCheck, type HealthRun, type HealthStatus, type LiveResult, type MonitorSettings, type OpenAlert,
} from './health/healthApi';

/**
 * Admin > Settings > Site health (admin refonte, wave 2, 21 Oct 2026). The site monitor in
 * plain words, for the M3 team:
 *   - every check now, grouped by area, green / orange / red with its summary and, when it is
 *     not green, one line saying what to do (and the admin screen where that happens);
 *   - the open alerts of the automatic monitor and since when;
 *   - the last 14 automatic runs (result, counts, e-mails sent);
 *   - "Check again now": runs every check at once (ops_health_report(), staff only). It sends
 *     no e-mail and changes nothing.
 * When the live check cannot run (not installed, or not staff), the page shows what the last
 * automatic run and the open alerts say. View only: the fixes happen elsewhere.
 */

const RUNS_SHOWN = 14;

const TONE: Record<HealthStatus, AdminTone> = { ok: 'success', warn: 'warning', fail: 'danger' };
const ICON: Record<HealthStatus, LucideIcon> = { ok: CheckCircle2, warn: AlertTriangle, fail: XCircle };
const ICON_COLOR: Record<HealthStatus, string> = { ok: 'text-teal', warn: 'text-amber-600', fail: 'text-red-600' };
const rank = (s: HealthStatus) => (s === 'fail' ? 0 : s === 'warn' ? 1 : 2);

function statusWord(s: HealthStatus, t: TFunction): string {
  return s === 'ok' ? t('adminHealth.status.ok', 'Fine') : s === 'warn' ? t('adminHealth.status.warn', 'Worth a look') : t('adminHealth.status.fail', 'Failing');
}

function StatusPill({ status }: { status: HealthStatus }) {
  const { t } = useTranslation();
  return <AdminStatusPill tone={TONE[status]} icon={ICON[status]}>{statusWord(status, t)}</AdminStatusPill>;
}

/** A pressable pill that says where it leads (the "press here" look of the dashboard). */
function GoLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="group inline-flex rounded-pill focus:outline-none focus-visible:shadow-focus">
      <ActionCue size="sm">{children}</ActionCue>
    </Link>
  );
}

/** A problem, from the live check or (when it cannot run) from the last automatic run. */
interface Problem {
  check_id: string;
  status: HealthStatus;
  summary: string;
  from: 'live' | 'run';
}

export function SiteHealthPage() {
  const { t } = useTranslation();
  const [live, setLive] = useState<LiveResult | undefined>(undefined);
  const [runs, setRuns] = useState<HealthRun[] | null | undefined>(undefined);
  const [alerts, setAlerts] = useState<OpenAlert[] | null | undefined>(undefined);
  const [settings, setSettings] = useState<MonitorSettings | null>(null);
  const [checking, setChecking] = useState(false);

  const load = useCallback(async (announce: boolean) => {
    setChecking(true);
    const [l, r, a, s] = await Promise.all([
      fetchLiveChecks(),
      fetchRuns(RUNS_SHOWN),
      fetchOpenAlerts(),
      fetchMonitorSettings(),
    ]);
    setLive(l);
    setRuns(r);
    setAlerts(a);
    setSettings(s);
    setChecking(false);
    if (!announce) return;
    if ('rows' in l) {
      // The same count as the page: the live checks plus the web probes of the last run.
      const every = [...l.rows, ...webChecksFromRun(r?.[0], l.rows.length, a)];
      const bad = every.filter((c) => c.status !== 'ok').length;
      toast({
        title: t('adminHealth.toast.title', 'Checked again'),
        description: bad
          ? t('adminHealth.toast.bad', { count: bad, defaultValue_one: '{{count}} check needs attention. See what to do on this page.', defaultValue_other: '{{count}} checks need attention. See what to do on this page.' })
          : t('adminHealth.toast.good', { n: every.length, defaultValue: 'All {{n}} checks are fine.' }),
      });
    } else {
      toast({ title: t('adminHealth.toast.failed', 'The check could not run'), description: l.message, variant: 'destructive' });
    }
  }, [t]);

  useEffect(() => { void load(false); }, [load]);

  const liveRows = live && 'rows' in live ? live.rows : null;
  const lastRun = runs?.[0] ?? null;

  // Every check: the live ones plus the web probes of the last automatic run.
  const all = useMemo<HealthCheck[] | null>(() => {
    if (!liveRows) return null;
    return [...liveRows, ...webChecksFromRun(lastRun, liveRows.length, alerts ?? null)];
  }, [liveRows, lastRun, alerts]);

  const problems = useMemo<Problem[]>(() => {
    if (all) return all.filter((c) => c.status !== 'ok').sort((a, b) => rank(a.status) - rank(b.status));
    // No live check: what the last automatic run found, with the alert's summary when there is one.
    if (!lastRun) return [];
    return lastRun.problems
      .map((p) => ({
        check_id: p.check_id,
        status: p.status,
        summary: alerts?.find((a) => a.check_id === p.check_id)?.summary ?? '',
        from: 'run' as const,
      }))
      .sort((a, b) => rank(a.status) - rank(b.status));
  }, [all, lastRun, alerts]);

  if (live === undefined || runs === undefined || alerts === undefined) return <AdminLoading />;

  const liveError = live && 'error' in live ? live : null;

  const checkNow = (
    <Button type="button" size="sm" className={cn(ADMIN_BTN_PRIMARY, 'gap-1.5')} disabled={checking} onClick={() => void load(true)}>
      {checking
        ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
      {checking ? t('adminHealth.checking', 'Checking…') : t('adminHealth.checkNow', 'Check again now')}
    </Button>
  );

  if (liveError && runs === null && alerts === null) {
    // Nothing could be read. Refused by the database: not staff. Anything else (network,
    // outage): say so and keep "Check again now".
    const refused = liveError.error === 'forbidden';
    return (
      <div>
        <AdminPageHeader title={t('adminHealth.title', 'Site health')} actions={refused ? undefined : checkNow} />
        <AdminPanel padded={false}>
          {refused ? (
            <AdminEmpty
              icon={Activity}
              title={t('adminHealth.forbidden', 'Only the M3 team can see the site health')}
              body={t('adminHealth.forbiddenBody', 'Sign in with a validated admin or moderator account, then open this page again.')}
            />
          ) : (
            <AdminEmpty
              icon={Activity}
              title={t('adminHealth.unreadable', 'Site health cannot be read right now')}
              body={t('adminHealth.unreadableBody', 'Nothing could be read from the database just now. Press "Check again now" in a minute. If it keeps failing, tell the technical contact.')}
            />
          )}
        </AdminPanel>
      </div>
    );
  }

  const interval = settings?.intervalMinutes ?? 60;
  const late = !!runs && monitorLate(lastRun?.run_at, interval);
  const total = all ? all.length : lastRun ? lastRun.n_ok + lastRun.n_warn + lastRun.n_fail : 0;
  const nFail = problems.filter((p) => p.status === 'fail').length;
  const nWarn = problems.filter((p) => p.status === 'warn').length;

  return (
    <div>
      <AdminPageHeader
        title={t('adminHealth.title', 'Site health')}
        description={t('adminHealth.desc', 'The site checks itself automatically: the database, scheduled jobs, e-mails, payments and the WYS guest list. Green is fine, orange is worth a look, red needs action now.')}
        actions={checkNow}
        meta={(
          <>
            <span className="w-full sm:w-auto">
              {lastRun
                ? t('adminHealth.lastRun', 'Last automatic run {{ago}} ({{when}})', { ago: formatAgo(lastRun.run_at), when: formatWhen(lastRun.run_at) })
                : t('adminHealth.noRun', 'No automatic run recorded yet')}
              {lastRun && settings?.enabled !== false && `, ${t('adminHealth.every', { n: interval, defaultValue: 'every {{n}} minutes' })}`}
            </span>
            <span aria-hidden="true" className="hidden sm:inline">•</span>
            <span className="w-full sm:w-auto">{t('adminHealth.noMail', '"Check again now" sends no e-mail and changes nothing.')}</span>
          </>
        )}
      />

      {/* The automatic monitor cannot warn about its own stop: the page does. */}
      {settings?.enabled === false && (
        <Note tone="warning" icon={AlertTriangle}>
          {t('adminHealth.off', 'The automatic monitor is switched off: nobody gets an e-mail when something breaks. Ask the technical contact to switch it back on.')}
        </Note>
      )}
      {settings?.enabled !== false && late && (
        <Note tone="warning" icon={AlertTriangle}>
          {lastRun
            ? t('adminHealth.late', 'The automatic monitor has not run since {{when}}. It cannot e-mail about its own stop: tell the technical contact.', { when: formatWhen(lastRun.run_at) })
            : t('adminHealth.never', 'The automatic monitor has never run. Tell the technical contact.')}
        </Note>
      )}
      {liveError && (
        <Note tone="info" icon={Info}>
          {liveError.error === 'missing'
            ? t('adminHealth.liveMissing', 'The live check is not installed on this site. Below: what the last automatic run found.')
            : liveError.error === 'forbidden'
              ? t('adminHealth.liveForbidden', 'Only a validated M3 admin or moderator can run the live check. Below: what the last automatic run found.')
              : t('adminHealth.liveFailed', 'The live check could not run ({{msg}}). Below: what the last automatic run found. Try "Check again now" in a minute.', { msg: liveError.message })}
        </Note>
      )}

      <Summary total={total} fail={nFail} warn={nWarn} fromLive={!!all} hasData={!!all || !!lastRun} />

      <div className="mt-6 space-y-6">
        {problems.length > 0 && (
          <AdminPanel
            icon={AlertTriangle}
            padded={false}
            title={t('adminHealth.attention.title', { count: problems.length, defaultValue_one: 'What needs attention ({{count}})', defaultValue_other: 'What needs attention ({{count}})' })}
            description={all
              ? t('adminHealth.attention.desc', 'Found just now. Each line says what to do first.')
              : t('adminHealth.attention.descRun', 'Found by the last automatic run. Each line says what to do first.')}
          >
            <ul className="divide-y divide-rule">
              {problems.map((p) => <CheckRow key={p.check_id} c={p} />)}
            </ul>
          </AdminPanel>
        )}

        <AlertsPanel alerts={alerts} all={all} />

        {all && <AreasSection all={all} />}

        <RunsSection runs={runs} realertHours={settings?.realertHours ?? null} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ pieces */

function Note({ tone, icon: Icon, children }: { tone: 'warning' | 'info'; icon: LucideIcon; children: ReactNode }) {
  return (
    <p
      className={cn(
        'mb-4 flex items-start gap-2.5 rounded-card border px-4 py-3 text-[15px] leading-6',
        tone === 'warning' ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-rule bg-foam text-navy',
      )}
    >
      <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/** The one-glance answer: is everything fine? */
function Summary({ total, fail, warn, fromLive, hasData }: { total: number; fail: number; warn: number; fromLive: boolean; hasData: boolean }) {
  const { t } = useTranslation();
  if (!hasData) return null;
  const status: HealthStatus = fail ? 'fail' : warn ? 'warn' : 'ok';
  const Icon = ICON[status];
  const head = status === 'ok'
    ? t('adminHealth.sum.ok', { n: total, defaultValue: 'All {{n}} checks are fine' })
    : status === 'fail'
      ? t('adminHealth.sum.fail', { count: fail, defaultValue_one: '{{count}} check is failing', defaultValue_other: '{{count}} checks are failing' })
      : t('adminHealth.sum.warn', { count: warn, n: total, defaultValue_one: '{{count}} of {{n}} checks is worth a look', defaultValue_other: '{{count}} of {{n}} checks are worth a look' });
  const sub = status === 'ok'
    ? (fromLive ? t('adminHealth.sum.okSub', 'Checked just now. Nothing to do.') : t('adminHealth.sum.okSubRun', 'At the last automatic run. Nothing to do.'))
    : status === 'fail'
      ? (warn
        ? t('adminHealth.sum.failSubWarn', { count: warn, defaultValue_one: 'And {{count}} worth a look. Act now: what to do is just below.', defaultValue_other: 'And {{count}} worth a look. Act now: what to do is just below.' })
        : t('adminHealth.sum.failSub', 'Act now: what to do is just below.'))
      : t('adminHealth.sum.warnSub', 'Nothing is broken. What to do is just below.');
  return (
    <div
      role="status"
      className={cn(
        'flex items-center gap-4 rounded-card border p-4 sm:p-5',
        status === 'ok' ? 'border-rule bg-foam' : status === 'warn' ? 'border-amber-200 bg-amber-50' : 'border-red-200 bg-red-50',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'grid h-12 w-12 shrink-0 place-items-center rounded-[14px]',
          status === 'ok' ? 'bg-teal text-white' : status === 'warn' ? 'bg-amber-500 text-white' : 'bg-red-600 text-white',
        )}
      >
        <Icon className="h-6 w-6" />
      </span>
      <span className="min-w-0">
        <span className="block text-[20px] font-semibold leading-7 text-navy [overflow-wrap:anywhere]">{head}</span>
        <span className="block text-[15px] leading-6 text-meta">{sub}</span>
      </span>
    </div>
  );
}

/** One check: its status, what it watches, what it found and, when not green, what to do. */
function CheckRow({ c }: { c: Problem | HealthCheck }) {
  const { t } = useTranslation();
  const { isAdmin } = useAuth();
  const help = helpFor(c.check_id);
  const bad = c.status !== 'ok';
  const Icon = ICON[c.status];
  return (
    <li className="flex items-start gap-3 px-5 py-3.5">
      <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', ICON_COLOR[c.status])} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <span className="text-[15px] font-semibold leading-6 text-navy [overflow-wrap:anywhere]">{help.title}</span>
          {bad ? <StatusPill status={c.status} /> : <span className="sr-only">{statusWord(c.status, t)}</span>}
        </div>
        {c.summary && <p className="text-[14px] leading-5 text-meta [overflow-wrap:anywhere]">{c.summary}</p>}
        {bad && (
          <p className="mt-1.5 text-[14px] leading-5 text-ink [overflow-wrap:anywhere]">
            <span className="font-semibold text-navy">{t('adminHealth.todo', 'What to do:')}</span> {help.todo}
          </p>
        )}
        {bad && help.link && (isAdmin || !help.link.adminOnly) && <div className="mt-2"><GoLink to={help.link.to}>{help.link.label}</GoLink></div>}
        <p className="mt-0.5 font-mono text-[11px] leading-4 text-meta/80 [overflow-wrap:anywhere]">
          {c.check_id}{c.from === 'run' ? ` · ${t('adminHealth.fromRun', 'seen by the automatic run')}` : ''}
        </p>
      </div>
    </li>
  );
}

function AlertsPanel({ alerts, all }: { alerts: OpenAlert[] | null; all: HealthCheck[] | null }) {
  const { t } = useTranslation();
  return (
    <AdminPanel
      icon={Bell}
      padded={false}
      title={t('adminHealth.alerts.title', 'Open alerts')}
      description={t('adminHealth.alerts.desc', 'Problems the automatic monitor found and has not seen fixed yet. An alert closes by itself at the first automatic run that finds its check fine.')}
    >
      {alerts === null ? (
        <AdminEmpty icon={Bell} title={t('adminHealth.alerts.unreadable', 'The alerts cannot be read')} body={t('adminHealth.alerts.unreadableBody', 'Press "Check again now" in a minute.')} className="py-8" />
      ) : alerts.length === 0 ? (
        <AdminEmpty icon={CheckCircle2} title={t('adminHealth.alerts.none', 'No open alert')} className="py-8" />
      ) : (
        <ul className="divide-y divide-rule">
          {alerts.map((a) => {
            const help = helpFor(a.check_id);
            const now = all?.find((c) => c.check_id === a.check_id);
            const fixed = now?.status === 'ok' && now.from === 'live';
            return (
              <li key={a.check_id} className="flex items-start gap-3 px-5 py-3.5">
                {(() => { const I = ICON[a.status]; return <I className={cn('mt-0.5 h-5 w-5 shrink-0', ICON_COLOR[a.status])} aria-hidden="true" />; })()}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                    <span className="text-[15px] font-semibold leading-6 text-navy [overflow-wrap:anywhere]">{help.title}</span>
                    <StatusPill status={a.status} />
                    {fixed && (
                      <AdminStatusPill tone="success" icon={CheckCircle2} title={t('adminHealth.alerts.fixedTitle', 'The check is fine now; the alert closes at the next automatic run.')}>
                        {t('adminHealth.alerts.fixed', 'Fine now')}
                      </AdminStatusPill>
                    )}
                  </div>
                  {a.summary && <p className="text-[14px] leading-5 text-meta [overflow-wrap:anywhere]">{a.summary}</p>}
                  <p className="mt-1 text-[13px] leading-5 text-meta">
                    {t('adminHealth.alerts.since', 'Found {{ago}} ({{when}})', { ago: formatAgo(a.first_seen_at), when: formatWhen(a.first_seen_at) })}
                    {' · '}
                    {a.last_alert_at
                      ? t('adminHealth.alerts.mailed', 'last e-mailed to M3 {{ago}}', { ago: formatAgo(a.last_alert_at) })
                      : t('adminHealth.alerts.notMailed', 'no e-mail sent about it')}
                  </p>
                  {fixed && (
                    <p className="mt-1 text-[13px] leading-5 text-teal-text">{t('adminHealth.alerts.fixedLine', 'Fine when checked just now: this alert closes at the next automatic run.')}</p>
                  )}
                  <p className="mt-0.5 font-mono text-[11px] leading-4 text-meta/80">{a.check_id}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </AdminPanel>
  );
}

function AreasSection({ all }: { all: HealthCheck[] }) {
  const { t } = useTranslation();
  const groups = useMemo(() => {
    const map = new Map<string, HealthCheck[]>();
    for (const c of all) map.set(c.area, [...(map.get(c.area) ?? []), c]);
    return [...map.entries()]
      .sort(([a], [b]) => areaRank(a) - areaRank(b) || a.localeCompare(b))
      .map(([area, rows]) => ({
        area,
        rows: rows.sort((a, b) => rank(a.status) - rank(b.status) || helpFor(a.check_id).title.localeCompare(helpFor(b.check_id).title)),
      }));
  }, [all]);
  return (
    <section>
      <AdminSectionLabel icon={Activity}>{t('adminHealth.areas', { n: all.length, defaultValue: 'Every check, by area ({{n}})' })}</AdminSectionLabel>
      <p className="-mt-1 mb-3 text-[14px] leading-5 text-meta">
        {t('adminHealth.areasHint', 'An area with a problem is open. Press an area to see or hide its checks.')}
      </p>
      <div className="grid items-start gap-3 lg:grid-cols-2">
        {/* Keyed on its problems too: an area that gets a new problem after "Check again now" opens. */}
        {groups.map(({ area, rows }) => (
          <AreaCard key={`${area}:${rows.filter((r) => r.status !== 'ok').map((r) => r.check_id).join(',')}`} area={area} rows={rows} />
        ))}
      </div>
    </section>
  );
}

/** One area: its name and how it stands; its checks open in place (open at first when one is not green). */
function AreaCard({ area, rows }: { area: string; rows: HealthCheck[] }) {
  const { t } = useTranslation();
  const fail = rows.filter((r) => r.status === 'fail').length;
  const warn = rows.filter((r) => r.status === 'warn').length;
  const ok = rows.length - fail - warn;
  const [open, setOpen] = useState(fail + warn > 0);
  const listId = `health-area-${area.replace(/[^a-z0-9]+/gi, '-')}`;
  return (
    <section className="overflow-hidden rounded-card border border-rule bg-white">
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          onClick={() => setOpen((o) => !o)}
          className="group flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3.5 text-left transition-colors hover:bg-page focus:outline-none focus-visible:shadow-focus"
        >
          <span className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
            <span className="text-[15px] font-semibold leading-5 text-navy [overflow-wrap:anywhere]">{areaLabel(area)}</span>
            {fail
              ? <AdminStatusPill tone="danger" icon={XCircle}>{t('adminHealth.area.fail', { count: fail, defaultValue: '{{count}} failing' })}</AdminStatusPill>
              : warn
                ? <AdminStatusPill tone="warning" icon={AlertTriangle}>{t('adminHealth.area.warn', { count: warn, defaultValue: '{{count}} worth a look' })}</AdminStatusPill>
                : <AdminStatusPill tone="success" icon={CheckCircle2}>{t('adminHealth.area.ok', { ok, n: rows.length, defaultValue: '{{ok}} of {{n}} fine' })}</AdminStatusPill>}
          </span>
          <ActionCue size="sm" icon={open ? 'collapse' : 'expand'}>
            {open
              ? t('adminHealth.area.hide', 'Hide')
              : t('adminHealth.area.show', { count: rows.length, defaultValue_one: 'Show the check', defaultValue_other: 'Show the {{count}} checks' })}
          </ActionCue>
        </button>
      </h3>
      {open && (
        <ul id={listId} className="divide-y divide-rule border-t border-rule">
          {rows.map((c) => <CheckRow key={c.check_id} c={c} />)}
        </ul>
      )}
    </section>
  );
}

function ProblemsText({ run }: { run: HealthRun }) {
  const { t } = useTranslation();
  if (!run.problems.length && !run.error) return <span className="text-meta">{t('adminHealth.runs.none', 'None')}</span>;
  return (
    <span className="block min-w-0">
      {run.problems.length > 0 && (
        <span className="block text-ink [overflow-wrap:anywhere]">
          {run.problems.map((p) => helpFor(p.check_id).title).join(', ')}
        </span>
      )}
      {run.error && <span className="block text-[13px] leading-5 text-red-700 [overflow-wrap:anywhere]">{t('adminHealth.runs.error', 'Error:')} {run.error}</span>}
    </span>
  );
}

function RunsSection({ runs, realertHours }: { runs: HealthRun[] | null; realertHours: number | null }) {
  const { t } = useTranslation();
  const resultWord = (s: HealthStatus) => (s === 'ok' ? t('adminHealth.runs.allFine', 'All fine') : statusWord(s, t));
  return (
    <section>
      <AdminSectionLabel icon={History}>{t('adminHealth.runs.title', { n: RUNS_SHOWN, defaultValue: 'The last {{n}} automatic runs' })}</AdminSectionLabel>
      {runs === null ? (
        <AdminPanel padded={false}><AdminEmpty icon={History} title={t('adminHealth.runs.unreadable', 'The runs cannot be read')} className="py-8" /></AdminPanel>
      ) : runs.length === 0 ? (
        <AdminPanel padded={false}><AdminEmpty icon={History} title={t('adminHealth.runs.empty', 'No automatic run recorded yet')} className="py-8" /></AdminPanel>
      ) : (
        <>
          {/* Phone: one card per run */}
          <ul className="space-y-3 md:hidden">
            {runs.map((r) => (
              <li key={r.id} className="rounded-card border border-rule bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[15px] font-semibold leading-6 text-navy">{formatWhen(r.run_at)}</span>
                  <AdminStatusPill tone={TONE[r.worst]} icon={ICON[r.worst]}>{resultWord(r.worst)}</AdminStatusPill>
                </div>
                <p className="text-[13px] leading-5 text-meta">{formatAgo(r.run_at)}</p>
                <p className="mt-2 text-[14px] leading-5 tabular-nums text-ink">
                  {t('adminHealth.runs.counts', '{{ok}} fine · {{warn}} worth a look · {{fail}} failing', { ok: r.n_ok, warn: r.n_warn, fail: r.n_fail })}
                </p>
                <p className="text-[14px] leading-5 text-ink">
                  {t('adminHealth.runs.mails', { count: r.emailed, defaultValue_one: '{{count}} e-mail sent', defaultValue_other: '{{count}} e-mails sent' })}
                </p>
                {(r.problems.length > 0 || r.error) && (
                  <p className="mt-2 text-[14px] leading-5">
                    <span className="font-semibold text-navy">{t('adminHealth.runs.found', 'Found:')} </span>
                    <ProblemsText run={r} />
                  </p>
                )}
              </li>
            ))}
          </ul>

          {/* Desktop: the table, whole (14 rows: no inner scroll box) */}
          <div className="hidden overflow-hidden rounded-card border border-rule bg-white md:block">
            <table className="w-full text-left text-[14px]">
              <thead>
                <tr>
                  <th className="px-4 py-2.5">{t('adminHealth.runs.colWhen', 'When')}</th>
                  <th className="px-4 py-2.5">{t('adminHealth.runs.colResult', 'Result')}</th>
                  <th className="px-4 py-2.5 text-right">{t('adminHealth.runs.colOk', 'Fine')}</th>
                  <th className="px-4 py-2.5 text-right">{t('adminHealth.runs.colWarn', 'Worth a look')}</th>
                  <th className="px-4 py-2.5 text-right">{t('adminHealth.runs.colFail', 'Failing')}</th>
                  <th className="px-4 py-2.5 text-right">{t('adminHealth.runs.colMails', 'E-mails sent')}</th>
                  <th className="px-4 py-2.5">{t('adminHealth.runs.colFound', 'Problems found')}</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap px-4 py-2.5 align-top">
                      <span className="block text-navy">{formatWhen(r.run_at)}</span>
                      <span className="block text-[12px] leading-4 text-meta">{formatAgo(r.run_at)}</span>
                    </td>
                    <td className="px-4 py-2.5 align-top"><AdminStatusPill tone={TONE[r.worst]} icon={ICON[r.worst]}>{resultWord(r.worst)}</AdminStatusPill></td>
                    <td className="px-4 py-2.5 text-right align-top tabular-nums text-navy">{r.n_ok}</td>
                    <td className={cn('px-4 py-2.5 text-right align-top tabular-nums', r.n_warn ? 'font-semibold text-amber-900' : 'text-meta')}>{r.n_warn}</td>
                    <td className={cn('px-4 py-2.5 text-right align-top tabular-nums', r.n_fail ? 'font-semibold text-red-700' : 'text-meta')}>{r.n_fail}</td>
                    <td className="px-4 py-2.5 text-right align-top tabular-nums text-navy">{r.emailed}</td>
                    <td className="px-4 py-2.5 align-top"><ProblemsText run={r} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[13px] leading-5 text-meta">
            {realertHours
              ? t('adminHealth.runs.footer', { count: realertHours, defaultValue_one: 'The runs are kept 30 days. An e-mail goes to M3 only for a new problem, or again after {{count}} hour if it is still there.', defaultValue_other: 'The runs are kept 30 days. An e-mail goes to M3 only for a new problem, or again after {{count}} hours if it is still there.' })
              : t('adminHealth.runs.footerPlain', 'The runs are kept 30 days. An e-mail goes to M3 only for a new problem, or again later if it is still there.')}
          </p>
        </>
      )}
    </section>
  );
}

export default SiteHealthPage;
