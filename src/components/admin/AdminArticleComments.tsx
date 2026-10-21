import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Check, EyeOff, Flag, Loader2, MessageCircle, RefreshCw, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/hooks/use-toast';
import { useRegistrationFlags } from '@/lib/flags';
import { resourcePath } from '@/lib/seoMeta';
import { cn } from '@/lib/utils';
import {
  commentAnchor, commentErrorText, fetchComments, fetchReportedComments, moderateComment, plainBody,
  type ArticleComment, type ReportedComment,
} from '@/lib/articleComments';
import { ADMIN_BTN, ADMIN_BTN_DANGER, AdminEmpty, AdminLoading, AdminPanel, AdminStatusPill } from './AdminUI';

/**
 * M3's side of the article comments (switch registration_flags.article_comments; nothing shows
 * while it is off, though the staff functions work whatever the switch):
 *  - AdminArticleComments, on the article's admin page: every comment, hidden ones included,
 *    with its open reports; Hide (with a reason its author sees), Show again, Keep (close the
 *    reports and leave the comment).
 *  - AdminCommentReports, Admin > Resources > "Reported comments": the reported comments of
 *    every article, open reports first. Each report also e-mailed the M3 team.
 */

function fmt(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Hide / Show again / Keep, with the optional reason for hiding typed in place. */
function ModerateActions({
  commentId,
  hidden,
  deleted = false,
  openReports,
  onDone,
}: {
  commentId: string;
  hidden: boolean;
  deleted?: boolean;
  openReports: number;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (action: 'hide' | 'unhide' | 'keep') => {
    setBusy(action);
    try {
      await moderateComment(commentId, action, action === 'hide' ? reason.trim() : undefined);
      toast({
        title: action === 'hide'
          ? t('adminComments.hiddenToast', 'Comment hidden')
          : action === 'unhide' ? t('adminComments.unhiddenToast', 'Comment shown again') : t('adminComments.keptToast', 'Reports closed, comment kept'),
      });
      setAsking(false);
      setReason('');
      onDone();
    } catch (err) {
      toast({ title: commentErrorText(err, t), variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  if (asking) {
    return (
      <div className="flex w-full flex-wrap items-center gap-2">
        <Input
          value={reason}
          maxLength={500}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t('adminComments.reasonPlaceholder', 'Reason shown to its author (optional)')}
          className="h-10 min-w-[16rem] flex-1"
          aria-label={t('adminComments.reasonLabel', 'Reason shown to its author')}
        />
        <Button variant="outline" size="sm" className={ADMIN_BTN_DANGER} disabled={!!busy} onClick={() => void run('hide')}>
          {busy === 'hide' ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <EyeOff className="mr-1.5 h-4 w-4" />}
          {t('adminComments.hideNow', 'Hide it')}
        </Button>
        <Button variant="outline" size="sm" className={ADMIN_BTN} disabled={!!busy} onClick={() => setAsking(false)}>
          {t('common.cancel', 'Cancel')}
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {!deleted && (hidden ? (
        <Button variant="outline" size="sm" className={ADMIN_BTN} disabled={!!busy} onClick={() => void run('unhide')}>
          {busy === 'unhide' ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-1.5 h-4 w-4" />}
          {t('adminComments.unhide', 'Show it again')}
        </Button>
      ) : (
        <Button variant="outline" size="sm" className={ADMIN_BTN_DANGER} disabled={!!busy} onClick={() => setAsking(true)}>
          <EyeOff className="mr-1.5 h-4 w-4" />
          {t('adminComments.hide', 'Hide…')}
        </Button>
      ))}
      {openReports > 0 && !hidden && (
        <Button variant="outline" size="sm" className={ADMIN_BTN} disabled={!!busy} onClick={() => void run('keep')}>
          {busy === 'keep' ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />}
          {t('adminComments.keep', 'Keep it, close the reports')}
        </Button>
      )}
    </div>
  );
}

/** Every comment of one article (its admin page). */
export function AdminArticleComments({ resourceId, slug }: { resourceId: string | null; slug?: string | null }) {
  const { t } = useTranslation();
  const { flags, ready } = useRegistrationFlags();
  const [rows, setRows] = useState<ArticleComment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const refresh = useCallback(() => setReload((n) => n + 1), []);
  const on = ready && flags.article_comments;

  useEffect(() => {
    if (!on || !resourceId) return;
    let alive = true;
    setError(null);
    fetchComments(resourceId)
      .then((r) => { if (alive) setRows(r); })
      .catch((err) => { if (alive) { setRows([]); setError(commentErrorText(err, t)); } });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, resourceId, reload]);

  if (!on || !resourceId) return null;
  const hiddenN = (rows ?? []).filter((c) => c.hidden).length;
  const reported = (rows ?? []).reduce((n, c) => n + (c.open_reports ?? 0), 0);

  return (
    <AdminPanel
      title={t('adminComments.title', { n: rows?.length ?? 0, defaultValue: 'Comments ({{n}})' })}
      description={t('adminComments.desc', 'Published at once by validated members. Hide a comment to take it off the page; its author still sees it, marked hidden.')}
      icon={MessageCircle}
      padded={false}
      actions={
        <>
          {reported > 0 && <AdminStatusPill tone="danger">{t('adminComments.openReports', { count: reported, defaultValue_one: '{{count}} open report', defaultValue_other: '{{count}} open reports' })}</AdminStatusPill>}
          {hiddenN > 0 && <AdminStatusPill tone="neutral">{t('adminComments.hiddenCount', { n: hiddenN, defaultValue: '{{n}} hidden' })}</AdminStatusPill>}
          <Button variant="ghost" size="sm" className="h-10 w-10 rounded-pill p-0 text-meta hover:text-navy" onClick={refresh} aria-label={t('adminComments.refresh', 'Refresh')}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </>
      }
    >
      {rows === null ? (
        <AdminLoading className="h-32" />
      ) : error ? (
        <p role="alert" className="px-5 py-4 text-[14px] text-red-800">{error}</p>
      ) : rows.length === 0 ? (
        <AdminEmpty icon={MessageCircle} title={t('adminComments.none', 'No comment yet')} />
      ) : (
        <ul className="divide-y divide-rule">
          {rows.map((c) => (
            <li key={c.id} className={cn('space-y-2 px-5 py-4', c.hidden && 'bg-page')}>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px]">
                <span className="font-semibold text-navy">{c.author_name}</span>
                {c.author_org_name && <span className="text-meta">· {c.author_org_name}</span>}
                <span className="text-meta">· {fmt(c.created_at)}{c.edited_at ? ` · ${t('comments.edited', 'edited')}` : ''}</span>
                {c.hidden && <AdminStatusPill tone="neutral">{t('adminComments.hiddenPill', 'Hidden')}</AdminStatusPill>}
                {(c.open_reports ?? 0) > 0 && (
                  <AdminStatusPill tone="danger">
                    <Flag className="mr-1 h-3 w-3" />
                    {t('adminComments.reports', { count: c.open_reports ?? 0, defaultValue_one: '{{count}} report', defaultValue_other: '{{count}} reports' })}
                  </AdminStatusPill>
                )}
              </div>
              <p className="whitespace-pre-line text-[14px] leading-6 text-ink [overflow-wrap:anywhere]">{plainBody(c.body)}</p>
              {c.hidden && c.hidden_reason && (
                <p className="text-[13px] text-meta">{t('adminComments.reasonShown', { r: c.hidden_reason, defaultValue: 'Reason shown to its author: {{r}}' })}</p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <ModerateActions commentId={c.id} hidden={c.hidden} openReports={c.open_reports ?? 0} onDone={refresh} />
                <Link to={`${resourcePath({ id: resourceId, slug: slug ?? null })}#${commentAnchor(c.id)}`} className="text-[13px] font-semibold text-navy underline underline-offset-2">
                  {t('adminComments.openOnPage', 'See it on the article page')}
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </AdminPanel>
  );
}

/** Admin > Resources > Reported comments. */
export function AdminCommentReports() {
  const { t } = useTranslation();
  const [openOnly, setOpenOnly] = useState(true);
  const [rows, setRows] = useState<ReportedComment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const refresh = useCallback(() => setReload((n) => n + 1), []);

  useEffect(() => {
    let alive = true;
    setError(null);
    fetchReportedComments(openOnly)
      .then((r) => { if (alive) setRows(r); })
      .catch((err) => { if (alive) { setRows([]); setError(commentErrorText(err, t)); } });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openOnly, reload]);

  return (
    <AdminPanel
      title={t('adminComments.reportsTitle', 'Reported comments')}
      description={t('adminComments.reportsDesc', 'Members reported these comments; the M3 team got an e-mail for each report. Hide the comment, or keep it and close the reports.')}
      icon={Flag}
      padded={false}
      actions={
        <>
          <Button variant="outline" size="sm" className={ADMIN_BTN} onClick={() => setOpenOnly((v) => !v)}>
            {openOnly ? t('adminComments.showAll', 'Show the closed ones too') : t('adminComments.showOpen', 'Open reports only')}
          </Button>
          <Button variant="ghost" size="sm" className="h-10 w-10 rounded-pill p-0 text-meta hover:text-navy" onClick={refresh} aria-label={t('adminComments.refresh', 'Refresh')}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </>
      }
    >
      {rows === null ? (
        <AdminLoading className="h-32" />
      ) : error ? (
        <p role="alert" className="px-5 py-4 text-[14px] text-red-800">{error}</p>
      ) : rows.length === 0 ? (
        <AdminEmpty icon={Flag} title={openOnly ? t('adminComments.noOpen', 'No open report') : t('adminComments.noReports', 'No report yet')} />
      ) : (
        <ul className="divide-y divide-rule">
          {rows.map((r) => (
            <li key={r.comment_id} className="space-y-2 px-5 py-4">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px]">
                <Link to={`${resourcePath({ id: r.resource_id, slug: r.resource_slug })}#${commentAnchor(r.comment_id)}`} className="font-semibold text-navy underline underline-offset-2">
                  {r.resource_title}
                </Link>
                <span className="text-meta">· {t('adminComments.by', { name: r.author_name, defaultValue: 'by {{name}}' })}{r.author_org_name ? ` (${r.author_org_name})` : ''} · {fmt(r.comment_created_at)}</span>
                {r.open_reports > 0
                  ? <AdminStatusPill tone="danger">{t('adminComments.openReports', { count: r.open_reports, defaultValue_one: '{{count}} open report', defaultValue_other: '{{count}} open reports' })}</AdminStatusPill>
                  : <AdminStatusPill tone="success">{t('adminComments.closed', 'Closed')}</AdminStatusPill>}
                {r.hidden && <AdminStatusPill tone="neutral">{t('adminComments.hiddenPill', 'Hidden')}</AdminStatusPill>}
                {r.deleted && <AdminStatusPill tone="neutral">{t('adminComments.deletedPill', 'Deleted by its author')}</AdminStatusPill>}
              </div>
              {!r.deleted && <p className="whitespace-pre-line rounded-field bg-page px-3 py-2 text-[14px] leading-6 text-ink [overflow-wrap:anywhere]">{plainBody(r.body)}</p>}
              <ul className="space-y-1 text-[13px] leading-5 text-meta">
                {r.reports.map((rep, i) => (
                  <li key={i}>
                    <span className="font-semibold text-navy">{rep.reporter_name}</span>, {fmt(rep.created_at)}
                    {rep.reason ? <>: “{rep.reason}”</> : <> {t('adminComments.noReason', '(no reason given)')}</>}
                    {rep.resolution && <> · {t(`adminComments.resolution.${rep.resolution}`, rep.resolution === 'hidden' ? 'hidden' : rep.resolution === 'kept' ? 'kept' : 'deleted by its author')}</>}
                  </li>
                ))}
              </ul>
              {(r.open_reports > 0 || r.hidden) && (
                <ModerateActions commentId={r.comment_id} hidden={r.hidden} deleted={r.deleted} openReports={r.open_reports} onDone={refresh} />
              )}
            </li>
          ))}
        </ul>
      )}
    </AdminPanel>
  );
}
