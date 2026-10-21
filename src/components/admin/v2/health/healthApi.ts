import { supabase } from '@/lib/supabase';
import { WEB_CHECK_IDS } from './checkHelp';

/**
 * What the Site health page and the admin home read about the site monitor. Read only: nothing
 * here writes, e-mails or calls the monitor's edge function.
 *
 *   live checks  ops_health_report(): every check of ops_health_checks(), run now, worst first.
 *                Already in production since 15 Oct (migration 20261016120000): SECURITY
 *                DEFINER, verified staff (is_moderator()) or the service role, anyone else 42501;
 *                EXECUTE granted to authenticated only. No new database object is needed.
 *   runs         ops_health_run, one row per automatic run (kept 30 days), staff read (RLS).
 *   alerts       ops_health_alert, one row per problem the monitor saw; cleared_at null = open.
 *   settings     platform_settings 'ops_health': only `enabled` and `interval_minutes` are read
 *                (JSON paths: the recipients' addresses never reach the browser). Staff only.
 */

export type HealthStatus = 'ok' | 'warn' | 'fail';

export interface HealthCheck {
  check_id: string;
  area: string;
  status: HealthStatus;
  summary: string;
  /** live: ops_health_report() just now; run: the last automatic run (the web probes). */
  from: 'live' | 'run';
}

export interface HealthRun {
  id: number;
  run_at: string;
  worst: HealthStatus;
  n_ok: number;
  n_warn: number;
  n_fail: number;
  emailed: number;
  problems: { check_id: string; status: HealthStatus }[];
  error: string | null;
}

export interface OpenAlert {
  check_id: string;
  status: 'warn' | 'fail';
  summary: string | null;
  first_seen_at: string;
  last_seen_at: string;
  last_alert_at: string | null;
}

export interface MonitorSettings {
  /** null: not readable (the page then says nothing about it). */
  enabled: boolean | null;
  intervalMinutes: number;
  /** Hours before the monitor e-mails again about the same problem; null when not readable. */
  realertHours: number | null;
}

export type ReadError = 'missing' | 'forbidden' | 'other';

export type LiveResult = { rows: HealthCheck[]; at: string } | { error: ReadError; message: string };

export const SITE_HEALTH_PATH = '/admin/site-health';

export function errorKind(e: { code?: string; message?: string } | null | undefined): ReadError {
  if (!e) return 'other';
  if (e.code === '42501' || /forbidden|permission denied/i.test(e.message ?? '')) return 'forbidden';
  if (e.code === 'PGRST202' || e.code === '42883' || e.code === 'PGRST205' || e.code === '42P01' || /could not find the (function|table)/i.test(e.message ?? '')) return 'missing';
  return 'other';
}

const STATUSES: HealthStatus[] = ['ok', 'warn', 'fail'];
const asStatus = (s: unknown): HealthStatus => (STATUSES.includes(s as HealthStatus) ? (s as HealthStatus) : 'warn');
const rank = (s: HealthStatus) => (s === 'fail' ? 0 : s === 'warn' ? 1 : 2);

/** Runs every check now (about a tenth of a second on production). */
export async function fetchLiveChecks(): Promise<LiveResult> {
  const { data, error } = await supabase.rpc('ops_health_report');
  if (error) return { error: errorKind(error), message: error.message };
  if (!Array.isArray(data)) return { error: 'other', message: 'Unexpected answer' };
  const rows = (data as { check_id: string; area: string | null; status: string; summary: string | null }[])
    .filter((r) => r && typeof r.check_id === 'string')
    .map<HealthCheck>((r) => ({ check_id: r.check_id, area: r.area || 'other', status: asStatus(r.status), summary: r.summary ?? '', from: 'live' }))
    .sort((a, b) => rank(a.status) - rank(b.status) || a.check_id.localeCompare(b.check_id));
  return { rows, at: new Date().toISOString() };
}

/** The latest automatic runs, newest first; null when they cannot be read. */
export async function fetchRuns(limit = 14): Promise<HealthRun[] | null> {
  const { data, error } = await supabase
    .from('ops_health_run')
    .select('id, run_at, worst, n_ok, n_warn, n_fail, emailed, problems, error')
    .order('run_at', { ascending: false })
    .limit(limit);
  if (error || !Array.isArray(data)) return null;
  return (data as Record<string, unknown>[])
    .map((r) => ({
      id: Number(r.id),
      run_at: String(r.run_at),
      worst: asStatus(r.worst),
      n_ok: Number(r.n_ok) || 0,
      n_warn: Number(r.n_warn) || 0,
      n_fail: Number(r.n_fail) || 0,
      emailed: Number(r.emailed) || 0,
      problems: Array.isArray(r.problems)
        ? (r.problems as { check_id?: unknown; status?: unknown }[])
          .filter((p) => p && typeof p.check_id === 'string')
          .map((p) => ({ check_id: p.check_id as string, status: asStatus(p.status) }))
        : [],
      error: typeof r.error === 'string' && r.error ? r.error : null,
    }))
    .sort((a, b) => b.run_at.localeCompare(a.run_at))
    .slice(0, limit);
}

/** Problems the automatic monitor still sees (not cleared), worst first. */
export async function fetchOpenAlerts(): Promise<OpenAlert[] | null> {
  const { data, error } = await supabase
    .from('ops_health_alert')
    .select('check_id, status, summary, first_seen_at, last_seen_at, last_alert_at')
    .is('cleared_at', null)
    .in('status', ['warn', 'fail'])
    .order('first_seen_at', { ascending: true });
  if (error || !Array.isArray(data)) return null;
  return (data as OpenAlert[])
    .filter((a) => a.status === 'warn' || a.status === 'fail')
    .sort((a, b) => rank(a.status) - rank(b.status) || a.first_seen_at.localeCompare(b.first_seen_at));
}

/** Whether the automatic monitor is on and how often it runs. */
export async function fetchMonitorSettings(): Promise<MonitorSettings> {
  const { data, error } = await supabase
    .from('platform_settings')
    .select('enabled:value->enabled, interval:value->interval_minutes, realert:value->realert_hours')
    .eq('key', 'ops_health')
    .maybeSingle();
  if (error || !data) return { enabled: null, intervalMinutes: 60, realertHours: null };
  const row = data as { enabled?: unknown; interval?: unknown; realert?: unknown };
  const n = Number(row.interval);
  const h = Number(row.realert);
  return {
    enabled: typeof row.enabled === 'boolean' ? row.enabled : null,
    // The invoker clamps the interval to 15-300 minutes, as here.
    intervalMinutes: Number.isFinite(n) && n > 0 ? Math.min(Math.max(n, 15), 300) : 60,
    realertHours: typeof row.realert === 'number' && Number.isFinite(h) && h > 0 ? h : null,
  };
}

/**
 * The automatic monitor looks stopped: no run for twice its interval plus a quarter of an
 * hour (the cron wakes every 15 minutes). It cannot e-mail about its own failure.
 */
export function monitorLate(lastRunAt: string | null | undefined, intervalMinutes: number, now = Date.now()): boolean {
  if (!lastRunAt) return true;
  const t = new Date(lastRunAt).getTime();
  return !Number.isFinite(t) || now - t > (2 * intervalMinutes + 15) * 60_000;
}

/**
 * The web probes of the last automatic run: they only exist there (the edge function checks the
 * site, the feed and sign-in from outside). A run records ok / warn / fail counts over every
 * check; when it counted more checks than the database has now, the web probes ran, and the
 * ones not listed in its problems were fine. When it did not (web checks switched off), none.
 */
export function webChecksFromRun(run: HealthRun | null | undefined, liveCount: number, alerts: OpenAlert[] | null): HealthCheck[] {
  if (!run) return [];
  const total = run.n_ok + run.n_warn + run.n_fail;
  if (total < liveCount + WEB_CHECK_IDS.length) return [];
  return WEB_CHECK_IDS.map((id) => {
    const p = run.problems.find((x) => x.check_id === id);
    const alert = alerts?.find((a) => a.check_id === id);
    return {
      check_id: id,
      area: 'website',
      status: p ? p.status : 'ok',
      summary: p ? alert?.summary || 'Found at the last automatic run.' : 'Fine at the last automatic run.',
      from: 'run' as const,
    };
  });
}

/** The admin home's one line: what the last automatic run found. */
export interface HealthLine {
  total: number;
  ok: number;
  warn: number;
  fail: number;
  runAt: string;
  late: boolean;
}

export async function fetchHealthLine(): Promise<HealthLine | null> {
  const [runs, settings] = await Promise.all([fetchRuns(1), fetchMonitorSettings()]);
  const last = runs?.[0];
  if (!last) return null;
  return {
    total: last.n_ok + last.n_warn + last.n_fail,
    ok: last.n_ok,
    warn: last.n_warn,
    fail: last.n_fail,
    runAt: last.run_at,
    late: monitorLate(last.run_at, settings.intervalMinutes),
  };
}
