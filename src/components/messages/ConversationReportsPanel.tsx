import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Download, FileText, Flag, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ADMIN_BTN, AdminEmpty, AdminPanel, AdminStatusPill } from '@/components/admin/AdminUI';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { downloadOrTell } from './Attachments';
import { ATTACHMENT_BUCKET, formatBytes, type Attachment } from './messagesApi';

/**
 * Admin: what members reported with "Report to M3" in Messages (table
 * conversation_reports, migration 20261009190000_company_messaging.sql). Verified
 * moderators read every report and close it; the other company is never told.
 * Each report keeps the last 30 messages of the conversation at the time of the
 * report (M3 cannot read conversations otherwise).
 *
 * Shown at the top of the admin's B2B requests page. Until the migration is
 * applied the table does not exist and the panel shows nothing. A report outlives
 * its conversation (deleted with an account): it then has no request, but keeps
 * its excerpt.
 *
 * Files (messaging v2, 10 Oct 2026): the excerpt names them ("[files: a.pdf]"), and,
 * while the report is OPEN, "See the files" lists the photos and PDFs the report
 * covers (sent up to the time of the report) to download. The storage policy lets
 * verified moderators open those and only those: the folder listing below is
 * filtered by it, so a file sent after the report, or never sent, does not show.
 */

interface OrgName { name: string | null }

interface ReportRow {
  id: string;
  partner_request_id: string | null;
  reason: string;
  excerpt: string | null;
  status: 'open' | 'closed';
  created_at: string;
  handled_at: string | null;
  reporter: { first_name: string | null; last_name: string | null; email: string | null } | null;
  reporter_org: OrgName | null;
  request: {
    status: string;
    partner_org: OrgName | null;
    marina_org: OrgName | null;
  } | null;
}

const SELECT = `
  id, partner_request_id, reason, excerpt, status, created_at, handled_at,
  reporter:profiles!conversation_reports_reporter_user_id_fkey (first_name, last_name, email),
  reporter_org:organizations!conversation_reports_reporter_org_id_fkey (name),
  request:partner_requests!conversation_reports_partner_request_id_fkey (
    status,
    partner_org:organizations!partner_requests_partner_organization_id_fkey (name),
    marina_org:organizations!partner_requests_marina_organization_id_fkey (name)
  )`;

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function ConversationReportsPanel() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<ReportRow[] | null>(null);
  const [available, setAvailable] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(async () => {
    let q = supabase.from('conversation_reports').select(SELECT).order('created_at', { ascending: false }).limit(100);
    if (!showAll) q = q.eq('status', 'open');
    const { data, error } = await q;
    if (error) {
      // Before the messaging migration: no table, nothing to show.
      setAvailable(false);
      return;
    }
    setAvailable(true);
    setRows((data ?? []) as unknown as ReportRow[]);
  }, [showAll]);

  useEffect(() => { void load(); }, [load]);

  const setStatus = async (r: ReportRow, status: 'open' | 'closed') => {
    setActing(r.id);
    const { error } = await supabase.from('conversation_reports').update({ status }).eq('id', r.id);
    setActing(null);
    if (error) {
      toast({ title: t('adminReports.saveFailed', 'Not saved'), description: error.message, variant: 'destructive' });
      return;
    }
    await load();
  };

  if (!available || rows === null) return null;
  const openCount = rows.filter((r) => r.status === 'open').length;

  return (
    <AdminPanel
      className="mb-6"
      icon={Flag}
      padded={false}
      title={showAll
        ? t('adminReports.titleAll', 'Reported conversations')
        : t('adminReports.titleOpen', { count: openCount, defaultValue: 'Reported conversations: {{count}} open' })}
      description={t('adminReports.desc', 'Sent by members with "Report to M3" in Messages. The other company is never told.')}
      actions={(
        <Button type="button" variant="outline" size="sm" className={ADMIN_BTN} onClick={() => setShowAll((v) => !v)}>
          {showAll ? t('adminReports.showOpen', 'Open only') : t('adminReports.showAll', 'Show closed too')}
        </Button>
      )}
    >
      {rows.length === 0 ? (
        <AdminEmpty icon={Flag} title={t('adminReports.none', 'No open report')} className="py-8" />
      ) : (
        <ul className="divide-y divide-rule">
          {rows.map((r) => {
            const who = [r.reporter?.first_name, r.reporter?.last_name].filter(Boolean).join(' ') || r.reporter?.email || t('adminReports.someone', 'A member');
            const between = [r.request?.partner_org?.name, r.request?.marina_org?.name].filter(Boolean).join(' → ');
            return (
              <li key={r.id} className="px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[15px] font-semibold leading-5 text-navy [overflow-wrap:anywhere]">
                      {who}{r.reporter_org?.name ? ` · ${r.reporter_org.name}` : ''}
                    </p>
                    <p className="mt-0.5 text-[13px] leading-[18px] text-meta [overflow-wrap:anywhere]">
                      {when(r.created_at)}
                      {between && <> · {between}</>}
                      {r.request?.status && r.request.status !== 'accepted' && <> · {t('adminReports.requestStatus', { status: r.request.status, defaultValue: 'first message {{status}}' })}</>}
                      {!r.partner_request_id && <> · {t('adminReports.requestGone', 'conversation deleted since (an account was removed)')}</>}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <AdminStatusPill tone={r.status === 'open' ? 'warning' : 'neutral'}>
                      {r.status === 'open' ? t('adminReports.open', 'Open') : t('adminReports.closed', 'Closed')}
                    </AdminStatusPill>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className={ADMIN_BTN}
                      disabled={acting === r.id}
                      onClick={() => setStatus(r, r.status === 'open' ? 'closed' : 'open')}
                    >
                      {acting === r.id && <Loader2 className="mr-1.5 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                      {r.status === 'open' ? t('adminReports.close', 'Close') : t('adminReports.reopen', 'Reopen')}
                    </Button>
                  </div>
                </div>
                <p className="mt-3 whitespace-pre-wrap border-l-2 border-gold pl-3 text-[14px] leading-5 text-ink [overflow-wrap:anywhere]">{r.reason}</p>
                {r.excerpt && (
                  <details className="mt-3">
                    <summary className={cn('inline-flex min-h-11 cursor-pointer items-center text-[14px] font-semibold text-navy underline decoration-navy/30 underline-offset-[3px]')}>
                      {t('adminReports.excerpt', 'The last messages at the time of the report')}
                    </summary>
                    <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-field bg-page p-3 font-sans text-[13px] leading-5 text-ink [overflow-wrap:anywhere]">{r.excerpt}</pre>
                  </details>
                )}
                {r.partner_request_id && r.status === 'open' && r.excerpt?.includes('[files: ') && <ReportFiles requestId={r.partner_request_id} />}
                {r.partner_request_id && (
                  <p className="mt-2 text-[13px]">
                    <Link to={`/admin/partner-requests/${r.partner_request_id}`} className="text-navy underline decoration-navy/30 underline-offset-[3px] hover:decoration-gold">
                      {t('adminReports.openRequest', 'Open the request')}
                    </Link>
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </AdminPanel>
  );
}

/** The files of a reported conversation, listed on demand (two folder levels: <request>/<uuid>/<name>). */
function ReportFiles({ requestId }: { requestId: string }) {
  const { t } = useTranslation();
  const [files, setFiles] = useState<Attachment[] | null>(null);
  const [loading, setLoading] = useState(false);

  const list = async () => {
    setLoading(true);
    const bucket = supabase.storage.from(ATTACHMENT_BUCKET);
    const { data: folders } = await bucket.list(requestId, { limit: 200 });
    const found: Attachment[] = [];
    for (const folder of folders ?? []) {
      const { data: inside } = await bucket.list(`${requestId}/${folder.name}`, { limit: 10 });
      for (const f of inside ?? []) {
        if (!f.id) continue;
        const meta = (f.metadata ?? {}) as { size?: number; mimetype?: string };
        found.push({ path: `${requestId}/${folder.name}/${f.name}`, name: f.name, size: Number(meta.size) || 0, mime: meta.mimetype || '' });
      }
    }
    setFiles(found);
    setLoading(false);
  };

  if (files === null) {
    return (
      <p className="mt-2">
        <button
          type="button"
          onClick={list}
          disabled={loading}
          className="inline-flex min-h-11 items-center gap-1.5 text-[14px] font-semibold text-navy underline decoration-navy/30 underline-offset-[3px] hover:decoration-gold disabled:opacity-60"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <FileText className="h-4 w-4" aria-hidden="true" />}
          {t('adminReports.filesCovered', 'See the files of this report')}
        </button>
      </p>
    );
  }
  if (files.length === 0) {
    return <p className="mt-2 text-[13px] text-meta">{t('adminReports.noFilesCovered', 'No file to show: the files of this report may have been removed.')}</p>;
  }
  return (
    <ul className="mt-2 space-y-1.5">
      {files.map((f) => (
        <li key={f.path} className="flex flex-wrap items-center gap-2 text-[14px]">
          <FileText className="h-4 w-4 text-meta" aria-hidden="true" />
          <span className="min-w-0 [overflow-wrap:anywhere]">{f.name}</span>
          <span className="text-[12px] text-meta">{formatBytes(f.size)}</span>
          <Button type="button" variant="outline" size="sm" className={cn(ADMIN_BTN, 'gap-1.5')} onClick={() => void downloadOrTell(f, t)}>
            <Download className="h-4 w-4" aria-hidden="true" /> {t('messages.files.download', 'Download')}
          </Button>
        </li>
      ))}
    </ul>
  );
}
