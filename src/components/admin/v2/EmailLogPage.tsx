import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Mail, RefreshCw, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import {
  ADMIN_BTN, AdminEmpty, AdminFilterBar, AdminLoading, AdminPageHeader, AdminPanel, AdminSegmented, AdminStatusPill,
  AdminTableCard, statusLabel, type AdminTone,
} from '@/components/admin/AdminUI';
import { INBOX_PATHS, formatAgo, formatWhen } from './inboxApi';

/**
 * Admin > E-mail log (admin refonte, 21 Oct 2026, Victor's idea): every e-mail the site sent,
 * gathered from its 8 logs by the staff-only functions admin_email_log() and
 * admin_email_log_top() (migration 20261021151000_admin_email_log). Read only: nothing is sent
 * or changed from here. "Automatic" e-mails are the ones the person did not ask for; the site
 * monitor warns when someone gets more than 5 of them in 24 hours (check email.automatic_volume).
 * Password reset, magic link and sign-up confirmation e-mails are logged nowhere: never listed.
 */

export interface EmailLogRow {
  sent_at: string;
  source: string;
  kind: string;
  origin: 'automatic' | 'asked' | 'staff';
  status: 'sent' | 'failed' | 'pending' | 'skipped';
  recipient_user_id: string | null;
  recipient_email: string | null;
  recipient_name: string | null;
  related_label: string | null;
  related_kind: string | null;
  related_id: string | null;
  actor_name: string | null;
}

export interface EmailTopRow {
  recipient_key: string;
  recipient_user_id: string | null;
  recipient_email: string | null;
  recipient_name: string | null;
  automatic_24h: number;
  automatic_7d: number;
  all_7d: number;
  last_sent_at: string;
}

/** Over this many automatic e-mails in 24 h, the monitor warns (same figure as the database check). */
export const AUTOMATIC_LIMIT_24H = 5;

const SOURCES: Record<string, string> = {
  profile_reminders: 'Profile reminders',
  sm26: 'Smart Marina 2026',
  guest_list: 'Guest lists (WYS)',
  invitations: 'Invitation campaigns',
  payments: 'Payment receipts',
  digest: 'Friday digest',
  outbox: 'Sign-up and team notices',
  notifications: 'Other notifications',
};

const KINDS: Record<string, string> = {
  profile_reminder_onboarding_incomplete: 'Reminder: finish the profile',
  profile_reminder_pending_review_followup: 'Reminder: account still under review',
  profile_reminder_signup_stalled: 'Reminder: finish signing up',
  profile_reminder_verified_but_thin: 'Reminder: complete the company page',
  registration_received: 'Registration received',
  confirmed: 'Registration confirmed',
  paid: 'Payment received',
  payment_reminder: 'Payment reminder',
  invoice_available: 'Invoice available',
  entry_qr: 'Entry QR code',
  info_requested: 'Information requested',
  attendees_requested: 'Attendee names requested',
  ecat_review: 'E-catalogue page to check',
  ecat_review_reminder: 'E-catalogue reminder',
  media_kit_ready: 'Media kit ready',
  feedback: 'Feedback request',
  feedback_reminder: 'Feedback reminder',
  invitation: 'Invitation',
  pass: 'Entry pass',
  request_ack: 'Request received',
  reject: 'Request declined',
  staff_notify: 'New request (to M3)',
  account_under_review: 'Account under review',
  team_join_request: 'Request to join a company',
  comment_mention: 'Tagged in a comment',
  comment_report: 'Comment reported (to M3)',
  messages: 'Friday digest of messages',
  payment_paid: 'Payment receipt',
  'notify-admins:signup': 'New sign-up (to M3)',
  'notify-admins:member': 'Message from a member (to M3)',
};

/** A log's kind in plain words: "send-notification:request_accepted:…" → "Notification: request accepted". */
export function kindLabel(kind: string): string {
  if (KINDS[kind]) return KINDS[kind];
  const m = /^(send-notification|resolved):([a-z_]+)/.exec(kind);
  if (m) return `Notification: ${statusLabel(m[2]).toLowerCase()}`;
  if (kind.startsWith('org-email:')) return 'Company invitation';
  return statusLabel(kind);
}

const STATUS: Record<EmailLogRow['status'], { tone: AdminTone; label: string }> = {
  sent: { tone: 'success', label: 'Sent' },
  failed: { tone: 'danger', label: 'Failed' },
  pending: { tone: 'warning', label: 'Waiting' },
  skipped: { tone: 'neutral', label: 'Not sent' },
};

const ORIGIN: Record<EmailLogRow['origin'], { tone: AdminTone; label: string; title: string }> = {
  automatic: { tone: 'neutral', label: 'Automatic', title: 'The person did not ask for it: it counts towards the limit of 5 a day.' },
  asked: { tone: 'info', label: 'Asked by them', title: 'An answer to something the person just did (a request, a payment): it does not count.' },
  staff: { tone: 'navy', label: 'To M3', title: 'A notice to the M3 team.' },
};

type Period = '1' | '7' | '30' | '90';
const ALL = 'all';
const LIMIT = 300;

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return v;
}

type LoadState<T> = { rows: T[] } | { error: 'missing' | 'forbidden' | 'other'; message?: string } | undefined;

function errorKind(e: { code?: string; message?: string }): 'missing' | 'forbidden' | 'other' {
  if (e.code === '42501' || /forbidden/i.test(e.message ?? '')) return 'forbidden';
  if (e.code === 'PGRST202' || e.code === '42883' || /could not find the function/i.test(e.message ?? '')) return 'missing';
  return 'other';
}

export function EmailLogPage() {
  const { t } = useTranslation();
  const { isAdmin } = useAuth();
  const [period, setPeriod] = useState<Period>('7');
  const [source, setSource] = useState<string>(ALL);
  const [status, setStatus] = useState<string>(ALL);
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim(), 300);
  const [log, setLog] = useState<LoadState<EmailLogRow>>(undefined);
  const [top, setTop] = useState<LoadState<EmailTopRow>>(undefined);

  const loadTop = useCallback(async () => {
    setTop(undefined);
    const { data, error } = await supabase.rpc('admin_email_log_top', { p_limit: 15 });
    setTop(error ? { error: errorKind(error), message: error.message } : { rows: (data ?? []) as EmailTopRow[] });
  }, []);

  const loadLog = useCallback(async () => {
    setLog(undefined);
    const { data, error } = await supabase.rpc('admin_email_log', {
      p_days: Number(period),
      p_source: source === ALL ? null : source,
      p_status: status === ALL ? null : status,
      p_query: q || null,
      p_limit: LIMIT,
    });
    setLog(error ? { error: errorKind(error), message: error.message } : { rows: (data ?? []) as EmailLogRow[] });
  }, [period, source, status, q]);

  useEffect(() => { void loadTop(); }, [loadTop]);
  useEffect(() => { void loadLog(); }, [loadLog]);

  const blocked = log && 'error' in log && log.error !== 'other' ? log.error : null;
  if (blocked) {
    return (
      <div>
        <AdminPageHeader title={t('adminEmailLog.title', 'E-mail log')} />
        <AdminPanel padded={false}>
          <AdminEmpty
            icon={Mail}
            title={blocked === 'missing' ? t('adminEmailLog.missing', 'The e-mail log is not installed yet') : t('adminEmailLog.forbidden', 'Only the M3 team can see the e-mail log')}
            body={blocked === 'missing'
              ? t('adminEmailLog.missingBody', 'Its database part waits for approval (migration 20261021151000_admin_email_log).')
              : t('adminEmailLog.forbiddenBody', 'Sign in with a validated admin or moderator account.')}
          />
        </AdminPanel>
      </div>
    );
  }

  const person = (r: { recipient_user_id: string | null; recipient_name: string | null; recipient_email: string | null }) => {
    const name = r.recipient_name || r.recipient_email || t('adminEmailLog.unknown', 'Not recorded');
    const sub = r.recipient_name && r.recipient_email ? r.recipient_email : null;
    const body = (
      <>
        <span className="block font-semibold text-navy [overflow-wrap:anywhere]">{name}</span>
        {sub && <span className="block text-[12px] leading-4 text-meta [overflow-wrap:anywhere]">{sub}</span>}
      </>
    );
    return isAdmin && r.recipient_user_id
      ? <Link to={INBOX_PATHS.person(r.recipient_user_id)} className="group block rounded-field underline decoration-navy/30 underline-offset-[3px] hover:decoration-navy focus:outline-none focus-visible:shadow-focus">{body}</Link>
      : <span className="block">{body}</span>;
  };

  return (
    <div>
      <AdminPageHeader
        title={t('adminEmailLog.title', 'E-mail log')}
        description={t('adminEmailLog.desc', 'Every e-mail the site sent, from all its logs. Read only: nothing is sent from here. M3 team only.')}
        actions={(
          <Button type="button" variant="outline" size="sm" className={cn(ADMIN_BTN, 'gap-1.5')} onClick={() => { void loadTop(); void loadLog(); }}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" /> {t('adminEmailLog.refresh', 'Refresh')}
          </Button>
        )}
      />

      {/* Who gets the most e-mails: the monitor warns over 5 automatic ones in 24 h. */}
      <AdminPanel
        className="mb-6"
        icon={Users}
        padded={false}
        title={t('adminEmailLog.top.title', 'Who received the most e-mails')}
        description={t('adminEmailLog.top.desc', {
          n: AUTOMATIC_LIMIT_24H,
          defaultValue: 'Automatic e-mails are the ones the person did not ask for. Over {{n}} in 24 hours, the site monitor sends M3 a warning.',
        })}
      >
        {top === undefined ? <AdminLoading className="h-32" /> : 'error' in top ? (
          <AdminEmpty icon={AlertTriangle} title={t('adminEmailLog.loadFailed', 'Could not load')} body={top.message} className="py-8" />
        ) : top.rows.length === 0 ? (
          <AdminEmpty icon={Mail} title={t('adminEmailLog.top.none', 'Nobody received an e-mail in the last 7 days')} className="py-8" />
        ) : (
          <div className="admin-table-scroll">
            <table className="w-full min-w-[640px] text-left text-[14px]">
              <thead>
                <tr>
                  <th className="px-4 py-2.5">{t('adminEmailLog.col.person', 'Person')}</th>
                  <th className="px-4 py-2.5 text-right">{t('adminEmailLog.col.auto24', 'Automatic, 24 h')}</th>
                  <th className="px-4 py-2.5 text-right">{t('adminEmailLog.col.auto7', 'Automatic, 7 days')}</th>
                  <th className="px-4 py-2.5 text-right">{t('adminEmailLog.col.all7', 'All, 7 days')}</th>
                  <th className="px-4 py-2.5">{t('adminEmailLog.col.last', 'Last one')}</th>
                </tr>
              </thead>
              <tbody>
                {top.rows.map((r) => {
                  const over = r.automatic_24h > AUTOMATIC_LIMIT_24H;
                  return (
                    <tr key={r.recipient_key} className={cn(over && 'bg-amber-50')}>
                      <td className="px-4 py-2.5">{person(r)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        <span className="inline-flex items-center justify-end gap-2">
                          {over && <AdminStatusPill tone="warning" icon={AlertTriangle}>{t('adminEmailLog.top.over', { n: AUTOMATIC_LIMIT_24H, defaultValue: 'Over {{n}}' })}</AdminStatusPill>}
                          <span className={cn('font-semibold', over ? 'text-amber-900' : 'text-navy')}>{r.automatic_24h}</span>
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-navy">{r.automatic_7d}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-meta">{r.all_7d}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-meta">{formatAgo(r.last_sent_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </AdminPanel>

      <AdminFilterBar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder={t('adminEmailLog.search', 'Search an address, a name, an event')}
        trailing={(
          <AdminSegmented<Period>
            label={t('adminEmailLog.period', 'Period')}
            value={period}
            onChange={setPeriod}
            options={[
              { value: '1', label: t('adminEmailLog.p1', '24 h') },
              { value: '7', label: t('adminEmailLog.p7', '7 days') },
              { value: '30', label: t('adminEmailLog.p30', '30 days') },
              { value: '90', label: t('adminEmailLog.p90', '90 days') },
            ]}
          />
        )}
      >
        <Select value={source} onValueChange={setSource}>
          <SelectTrigger className="w-56" aria-label={t('adminEmailLog.sourceLabel', 'Which e-mails')}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('adminEmailLog.allSources', 'All e-mails')}</SelectItem>
            {Object.entries(SOURCES).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-44" aria-label={t('adminEmailLog.statusLabel', 'Status')}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('adminEmailLog.allStatuses', 'Every status')}</SelectItem>
            {Object.entries(STATUS).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </AdminFilterBar>

      {log === undefined ? <AdminLoading /> : 'error' in log ? (
        <AdminPanel padded={false}><AdminEmpty icon={AlertTriangle} title={t('adminEmailLog.loadFailed', 'Could not load')} body={log.message} /></AdminPanel>
      ) : log.rows.length === 0 ? (
        <AdminPanel padded={false}><AdminEmpty icon={Mail} title={t('adminEmailLog.none', 'No e-mail for these filters')} body={t('adminEmailLog.noneBody', 'Try a longer period or "All e-mails".')} /></AdminPanel>
      ) : (
        <AdminTableCard
          footer={log.rows.length >= LIMIT
            ? t('adminEmailLog.capped', { n: LIMIT, defaultValue: 'The latest {{n}} e-mails. Narrow the filters to see older ones.' })
            : t('adminEmailLog.count', { count: log.rows.length, defaultValue_one: '{{count}} e-mail', defaultValue_other: '{{count}} e-mails' })}
        >
          <table className="w-full min-w-[860px] text-left text-[14px]">
            <thead>
              <tr>
                <th className="px-4 py-2.5">{t('adminEmailLog.col.date', 'Date')}</th>
                <th className="px-4 py-2.5">{t('adminEmailLog.col.to', 'To')}</th>
                <th className="px-4 py-2.5">{t('adminEmailLog.col.what', 'E-mail')}</th>
                <th className="px-4 py-2.5">{t('adminEmailLog.col.about', 'About')}</th>
                <th className="px-4 py-2.5">{t('adminEmailLog.col.status', 'Status')}</th>
              </tr>
            </thead>
            <tbody>
              {log.rows.map((r, i) => (
                <tr key={`${r.sent_at}-${i}`}>
                  <td className="whitespace-nowrap px-4 py-2.5 align-top text-meta">
                    <span className="block text-navy">{formatWhen(r.sent_at)}</span>
                    <span className="block text-[12px] leading-4">{formatAgo(r.sent_at)}</span>
                  </td>
                  <td className="px-4 py-2.5 align-top">{person(r)}</td>
                  <td className="px-4 py-2.5 align-top">
                    <span className="block text-navy">{kindLabel(r.kind)}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-1.5">
                      <AdminStatusPill tone={ORIGIN[r.origin]?.tone ?? 'neutral'} title={ORIGIN[r.origin]?.title}>{ORIGIN[r.origin]?.label ?? r.origin}</AdminStatusPill>
                      <span className="text-[12px] text-meta">{SOURCES[r.source] ?? r.source}</span>
                    </span>
                  </td>
                  <td className="px-4 py-2.5 align-top text-ink">
                    {r.related_label ?? <span className="text-meta">—</span>}
                    {r.actor_name && <span className="block text-[12px] leading-4 text-meta">{t('adminEmailLog.by', 'Started by')} {r.actor_name}</span>}
                  </td>
                  <td className="px-4 py-2.5 align-top">
                    <AdminStatusPill tone={STATUS[r.status]?.tone ?? 'neutral'}>{STATUS[r.status]?.label ?? r.status}</AdminStatusPill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </AdminTableCard>
      )}
    </div>
  );
}

export default EmailLogPage;
