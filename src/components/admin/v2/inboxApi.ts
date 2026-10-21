import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';

/**
 * The admin Inbox's data (admin refonte, 21 Oct 2026): what arrives from the site and waits
 * for someone at M3. Four kinds, each read with the staff's own rights (RLS, is_moderator()):
 *   - contact form messages: contact_submissions, status new / handled / spam;
 *   - reported conversations: conversation_reports, open / closed (moved here from B2B requests);
 *   - reported comments: admin_resource_comment_reports() of the article comments (branch
 *     rf-comments). Until that is merged and applied the function does not exist: the section
 *     and its count stay hidden (null), nothing else changes;
 *   - health alerts: ops_health_alert rows still in warn or fail (cleared_at null), written by
 *     the ops-health monitor.
 * A count is null when its source cannot be read (not applied yet, not staff): no badge for it.
 */

/** Where things are handled. The routes are wired by the admin shell; change them here only. */
export const INBOX_PATHS = {
  inbox: '/admin/inbox',
  emailLog: '/admin/email-log',
  siteHealth: '/admin/site-health',
  person: (userId: string) => `/admin/people/${userId}`,
  company: (orgId: string) => `/admin/companies/${orgId}`,
  article: (resourceId: string) => `/admin/resources/${resourceId}`,
  request: (requestId: string) => `/admin/partner-requests/${requestId}`,
} as const;

export const INBOX_EVENT = 'smc:inbox-changed';

/** Tell the badge that an item was handled (it reads the counts again). */
export function announceInboxChange(): void {
  window.dispatchEvent(new CustomEvent(INBOX_EVENT));
}

export type ContactStatus = 'new' | 'handled' | 'spam';

export interface ContactMessage {
  id: string;
  created_at: string;
  name: string;
  email: string;
  company: string | null;
  subject: string;
  message: string;
  status: ContactStatus;
  handled_at: string | null;
}

export interface ReportedComment {
  comment_id: string;
  resource_id: string;
  resource_title: string;
  body: string;
  author_name: string;
  author_org_name: string | null;
  hidden: boolean;
  deleted: boolean;
  open_reports: number;
  total_reports: number;
  last_reported_at: string;
  reports: { reporter_name: string; reason: string | null; created_at: string }[] | null;
}

export interface HealthAlert {
  check_id: string;
  status: 'warn' | 'fail';
  summary: string;
  first_seen_at: string;
  last_seen_at: string;
}

export interface InboxCounts {
  contact: number | null;
  conversations: number | null;
  comments: number | null;
  alerts: number | null;
}

const EMPTY: InboxCounts = { contact: null, conversations: null, comments: null, alerts: null };

/** The sum of what can be read (the sidebar badge); null when nothing can. */
export function inboxTotal(c: InboxCounts): number | null {
  const parts = [c.contact, c.conversations, c.comments, c.alerts].filter((n): n is number => typeof n === 'number');
  return parts.length ? parts.reduce((a, b) => a + b, 0) : null;
}

export async function fetchContactMessages(status: ContactStatus): Promise<ContactMessage[] | null> {
  const { data, error } = await supabase
    .from('contact_submissions')
    .select('id, created_at, name, email, company, subject, message, status, handled_at')
    .eq('status', status)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) return null;
  return (data ?? []) as ContactMessage[];
}

/** Marks a contact message handled, spam, or new again. Returns the error text, or null. */
export async function setContactStatus(id: string, status: ContactStatus, userId: string | undefined): Promise<string | null> {
  const done = status !== 'new';
  const { error } = await supabase
    .from('contact_submissions')
    .update({ status, handled_at: done ? new Date().toISOString() : null, handled_by: done ? userId ?? null : null })
    .eq('id', id);
  if (error) return error.message;
  announceInboxChange();
  return null;
}

/** The comments with an open report, or null when the comments feature is not installed. */
export async function fetchReportedComments(): Promise<ReportedComment[] | null> {
  const { data, error } = await supabase.rpc('admin_resource_comment_reports', { p_open_only: true });
  if (error || !Array.isArray(data)) return null;
  return data as ReportedComment[];
}

/** Health checks still failing or warning, worst first; null when the monitor cannot be read. */
export async function fetchHealthAlerts(): Promise<{ alerts: HealthAlert[]; lastRun: string | null } | null> {
  const [alerts, run] = await Promise.all([
    supabase
      .from('ops_health_alert')
      .select('check_id, status, summary, first_seen_at, last_seen_at')
      .is('cleared_at', null)
      .in('status', ['warn', 'fail'])
      .order('last_seen_at', { ascending: false }),
    supabase.from('ops_health_run').select('run_at').order('run_at', { ascending: false }).limit(1),
  ]);
  if (alerts.error) return null;
  const rows = ((alerts.data ?? []) as HealthAlert[]).sort((a, b) => (a.status === b.status ? 0 : a.status === 'fail' ? -1 : 1));
  const last = !run.error && Array.isArray(run.data) && run.data[0] ? (run.data[0] as { run_at: string }).run_at : null;
  return { alerts: rows, lastRun: last };
}

const countOf = (r: { count: number | null; error: unknown }) => (r.error || typeof r.count !== 'number' ? null : r.count);

export async function fetchInboxCounts(): Promise<InboxCounts> {
  const head = { count: 'exact' as const, head: true };
  const [contact, conversations, comments, alerts] = await Promise.all([
    supabase.from('contact_submissions').select('id', head).eq('status', 'new').then(countOf),
    supabase.from('conversation_reports').select('id', head).eq('status', 'open').then(countOf),
    fetchReportedComments().then((rows) => (rows ? rows.length : null)),
    supabase.from('ops_health_alert').select('check_id', head).is('cleared_at', null).in('status', ['warn', 'fail']).then(countOf),
  ]);
  return { contact, conversations, comments, alerts };
}

const MIN_GAP_MS = 30_000;

/**
 * The Inbox's counts for the sidebar badge and the phone bar (the shell mounts it once, like
 * useReviewCountSource): read on mount, when an item is handled (INBOX_EVENT), when the tab
 * comes back into view or the admin opens another screen (at most once every 30 seconds).
 * Keyed on the user id: auth re-emits the user on every refocus.
 */
export function useInboxCounts(enabled: boolean, uid: string | undefined, pathname?: string) {
  const [counts, setCounts] = useState<InboxCounts>(EMPTY);
  const last = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const refresh = useCallback(() => {
    last.current = Date.now();
    void fetchInboxCounts().then((c) => { if (mounted.current) setCounts(c); });
  }, []);

  const active = enabled && !!uid;
  useEffect(() => {
    if (!active) return;
    refresh();
    const onChange = () => refresh();
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - last.current > MIN_GAP_MS) refresh();
    };
    window.addEventListener(INBOX_EVENT, onChange);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener(INBOX_EVENT, onChange);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [active, uid, refresh]);

  useEffect(() => {
    if (active && Date.now() - last.current > MIN_GAP_MS) refresh();
  }, [active, pathname, refresh]);

  return useMemo(() => ({ counts, total: inboxTotal(counts), refresh }), [counts, refresh]);
}

export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** "3 hours ago", "2 days ago": how long something has waited. */
export function formatAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const ms = now - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return '';
  const min = Math.max(0, Math.round(ms / 60000));
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}
