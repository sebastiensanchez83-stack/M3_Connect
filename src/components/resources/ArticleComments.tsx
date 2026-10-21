import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  AtSign, Building2, EyeOff, Flag, Loader2, MessageCircle, Pencil, RefreshCw, ShieldCheck, Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { ConfirmDialog, EditDialog } from '@/components/home/dashboard/EditKit';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/hooks/use-toast';
import { useRegistrationFlags } from '@/lib/flags';
import { mentionHref } from '@/lib/companyMentions';
import { cn } from '@/lib/utils';
import {
  commentAnchor, commentErrorText, deleteComment, editComment, fetchCommentCount, fetchComments, markNoticesSeen,
  moderateComment, postComment, reportComment, splitBody, toEditable, type ArticleComment, type CommentMention,
} from '@/lib/articleComments';
import { CommentComposer } from './CommentComposer';

/**
 * "Comments" under an article (Victor, 21 Oct 2026). Shown only while the switch
 * registration_flags.article_comments is on; nothing at all otherwise.
 *
 *  - Validated members (and M3 staff) read the comments with their authors' name, job and
 *    company, write one, tag people and companies with "@", edit or delete their own, and
 *    report someone else's to the M3 team.
 *  - A visitor, or an account M3 has not validated yet, sees how many comments there are and a
 *    plain way forward ("Sign in to read and join the discussion" / "Your account is being
 *    reviewed"): people's names are for members only, like the team lists.
 *  - M3 staff also see the hidden comments and the open reports, and hide or show again.
 *
 * Every button says what it does in words, at rest (members who are not at ease with
 * technology, Victor 21 Oct). A comment opened from an e-mail or the dashboard
 * (/resources/<slug>#comment-<id>) is scrolled to and outlined; the reader's "you were tagged"
 * notices on this page count as seen.
 */
export function ArticleComments({
  resourceId,
  onSignIn,
  onSignUp,
}: {
  resourceId: string;
  onSignIn: () => void;
  onSignUp: () => void;
}) {
  const { t } = useTranslation();
  const location = useLocation();
  const { user, isVerified, isModerator } = useAuth();
  const { flags, ready } = useRegistrationFlags();
  const on = ready && flags.article_comments;
  const member = !!user && isVerified;
  const uid = user?.id ?? null;

  const [count, setCount] = useState<number | null>(null);
  const [comments, setComments] = useState<ArticleComment[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState<string | null>(null);
  const [reporting, setReporting] = useState<ArticleComment | null>(null);
  const [deleting, setDeleting] = useState<ArticleComment | null>(null);
  const [hiding, setHiding] = useState<ArticleComment | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const scrolledFor = useRef<string | null>(null);

  // Visitors and accounts not validated yet: the number only.
  useEffect(() => {
    if (!on || member) return;
    let alive = true;
    fetchCommentCount(resourceId).then((n) => { if (alive) setCount(n); });
    return () => { alive = false; };
  }, [on, member, resourceId]);

  // Members: the comments themselves. Keyed on ids, never on the auth objects (refocus trap).
  useEffect(() => {
    if (!on || !member) return;
    let alive = true;
    setLoadError(null);
    fetchComments(resourceId)
      .then((rows) => { if (alive) setComments(rows); })
      .catch((err) => { if (alive) { setComments([]); setLoadError(commentErrorText(err, t)); } });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, member, uid, resourceId, reload]);

  // My "you were tagged" notices on this page are seen once the comments show.
  useEffect(() => {
    const ids = (comments ?? []).map((c) => c.my_notice_id).filter((n): n is number => n !== null);
    if (ids.length) void markNoticesSeen(ids).catch(() => undefined);
  }, [comments]);

  // Opened on a comment (#comment-<id>): scroll to it once, and outline it a moment.
  useEffect(() => {
    if (!comments?.length) return;
    const hash = location.hash.replace(/^#/, '');
    if (!hash.startsWith('comment-') || scrolledFor.current === hash) return;
    const el = document.getElementById(hash);
    if (!el) return;
    scrolledFor.current = hash;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setFlash(hash.slice('comment-'.length));
    const timer = window.setTimeout(() => setFlash(null), 4000);
    return () => window.clearTimeout(timer);
  }, [comments, location.hash]);

  const refresh = useCallback(() => setReload((n) => n + 1), []);

  if (!on) return null;

  const visible = (comments ?? []).filter((c) => !c.hidden);
  const shownCount = member ? (comments ? visible.length : null) : count;
  const heading = shownCount === null
    ? t('comments.title', 'Comments')
    : t('comments.titleCount', { n: shownCount, defaultValue: 'Comments ({{n}})' });

  const submitNew = async (body: string) => {
    try {
      await postComment(resourceId, body);
    } catch (err) {
      throw new Error(commentErrorText(err, t));
    }
    toast({ title: t('comments.posted', 'Your comment is published'), description: t('comments.postedDesc', 'The people you tagged are told on the site and by e-mail.') });
    refresh();
  };

  return (
    <section aria-labelledby="comments-heading" className="mt-10 max-w-[68ch] scroll-mt-24 border-t border-rule pt-8" id="comments">
      <h2 id="comments-heading" className="flex items-center gap-2.5 text-h3 text-navy">
        <MessageCircle className="h-6 w-6 text-gold-text" aria-hidden="true" />
        {heading}
      </h2>

      {!user ? (
        <Teaser
          title={t('comments.teaserSignIn', 'Sign in to read and join the discussion')}
          body={t('comments.teaserSignInBody', 'The comments, and who wrote them, are for Smart Marina Connect members. Members can also tag a person or a company in a comment.')}
        >
          <Button variant="cta" size="sm" onClick={onSignIn}>
            {t('comments.signIn', 'Sign in to read the comments')}
          </Button>
          <Button variant="ctaOutline" size="sm" onClick={onSignUp}>
            {t('comments.join', 'Become a member')}
          </Button>
        </Teaser>
      ) : !isVerified ? (
        <Teaser
          title={t('comments.teaserPending', 'Your account is being reviewed')}
          body={t('comments.teaserPendingBody', 'Once the M3 team has validated your account, you can read the comments and join the discussion.')}
        >
          <Button asChild variant="ctaNavy" size="sm">
            <Link to="/">{t('comments.seeAccount', 'See where my account stands')}</Link>
          </Button>
        </Teaser>
      ) : (
        <>
          {loadError && (
            <div role="alert" className="mt-5 flex flex-wrap items-center gap-3 rounded-field border border-red-200 bg-red-50 px-4 py-3 text-[15px] leading-6 text-red-900">
              <span className="flex-1">{loadError}</span>
              <button type="button" onClick={refresh} className={ACTION_BTN}>
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                {t('comments.retry', 'Try again')}
              </button>
            </div>
          )}

          {comments === null ? (
            <div className="mt-6 flex items-center gap-2 text-[15px] text-meta" role="status">
              <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              {t('comments.loading', 'Loading the comments…')}
            </div>
          ) : comments.length === 0 && !loadError ? (
            <p className="mt-5 rounded-field bg-page px-5 py-4 text-[16px] leading-6 text-meta">
              {t('comments.empty', 'No comment yet. Be the first to comment.')}
            </p>
          ) : (
            <ol className="mt-6 space-y-4">
              {comments.map((c) => (
                <li key={c.id}>
                  <CommentCard
                    comment={c}
                    staff={isModerator}
                    flash={flash === c.id}
                    editing={editing === c.id}
                    onEdit={() => setEditing(c.id)}
                    onCancelEdit={() => setEditing(null)}
                    onSaveEdit={async (body) => {
                      try {
                        await editComment(c.id, body);
                      } catch (err) {
                        throw new Error(commentErrorText(err, t));
                      }
                      setEditing(null);
                      toast({ title: t('comments.saved', 'Your comment is updated') });
                      refresh();
                    }}
                    onDelete={() => setDeleting(c)}
                    onReport={() => setReporting(c)}
                    onHide={() => setHiding(c)}
                    onUnhide={async () => {
                      try {
                        await moderateComment(c.id, 'unhide');
                        toast({ title: t('comments.unhidden', 'The comment shows again') });
                        refresh();
                      } catch (err) {
                        toast({ title: commentErrorText(err, t), variant: 'destructive' });
                      }
                    }}
                  />
                </li>
              ))}
            </ol>
          )}

          <div className="mt-8 rounded-card border border-rule bg-white p-5 sm:p-6">
            <CommentComposer
              label={t('comments.writeLabel', 'Write a comment')}
              submitLabel={t('comments.publish', 'Publish my comment')}
              busyLabel={t('comments.publishing', 'Publishing…')}
              onSubmit={submitNew}
            />
          </div>
        </>
      )}

      <ReportDialog
        comment={reporting}
        onClose={() => setReporting(null)}
        onSent={() => { setReporting(null); refresh(); }}
      />
      <HideDialog
        comment={hiding}
        onClose={() => setHiding(null)}
        onDone={() => { setHiding(null); refresh(); }}
      />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => { if (!o) setDeleting(null); }}
        title={t('comments.deleteTitle', 'Delete your comment?')}
        body={t('comments.deleteBody', 'It disappears for everyone. This cannot be undone.')}
        confirmLabel={t('comments.deleteConfirm', 'Delete my comment')}
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await deleteComment(deleting.id);
            toast({ title: t('comments.deleted', 'Your comment is deleted') });
            setDeleting(null);
            refresh();
          } catch (err) {
            toast({ title: commentErrorText(err, t), variant: 'destructive' });
          }
        }}
      />
    </section>
  );
}

/** A small action under a comment: a pill with an icon and words, 44 px tall to tap. */
const ACTION_BTN = cn(
  'inline-flex min-h-11 items-center gap-1.5 rounded-pill border border-navy/55 bg-white px-4 text-[15px] font-semibold text-navy',
  'transition-colors hover:border-navy hover:bg-chip active:bg-chip focus:outline-none focus-visible:shadow-focus',
);
const DANGER_BTN = cn(
  'inline-flex min-h-11 items-center gap-1.5 rounded-pill border border-red-300 bg-white px-4 text-[15px] font-semibold text-red-700',
  'transition-colors hover:border-red-500 hover:bg-red-50 focus:outline-none focus-visible:shadow-focus',
);

function Teaser({ title, body, children }: { title: string; body: string; children: ReactNode }) {
  return (
    <div className="mt-5 rounded-card border border-rule bg-page px-5 py-6 sm:px-7">
      <p className="text-[18px] font-semibold leading-7 text-navy">{title}</p>
      <p className="mt-1.5 max-w-prose text-[16px] leading-6 text-meta">{body}</p>
      <div className="mt-5 flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

const initials = (name: string) => name.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    + ', ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function CommentCard({
  comment: c,
  staff,
  flash,
  editing,
  onEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  onReport,
  onHide,
  onUnhide,
}: {
  comment: ArticleComment;
  staff: boolean;
  flash: boolean;
  editing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (body: string) => Promise<void>;
  onDelete: () => void;
  onReport: () => void;
  onHide: () => void;
  onUnhide: () => void;
}) {
  const { t } = useTranslation();
  const editable = useMemo(() => (editing ? toEditable(c.body) : null), [editing, c.body]);
  const companyHref = c.author_org_slug ? mentionHref(c.author_org_slug) : null;
  const tagged = c.my_notice_id !== null;

  return (
    <article
      id={commentAnchor(c.id)}
      aria-label={t('comments.byAuthor', { name: c.author_name, defaultValue: 'Comment by {{name}}' })}
      className={cn(
        'scroll-mt-28 rounded-card border bg-white p-4 transition-shadow duration-500 sm:p-5',
        c.hidden ? 'border-dashed border-navy/30 bg-page' : 'border-rule',
        (flash || tagged) && 'shadow-[0_0_0_3px_rgb(124_196_240)]',
      )}
    >
      <header className="flex items-start gap-3">
        {c.author_avatar_url ? (
          <img src={c.author_avatar_url} alt="" className="h-11 w-11 shrink-0 rounded-full object-cover" />
        ) : (
          <span aria-hidden="true" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-teal text-sm font-semibold text-white">
            {initials(c.author_name) || '?'}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[16px] font-semibold leading-6 text-navy [overflow-wrap:anywhere]">
            {c.author_name}
            {c.is_mine && <span className="ml-2 rounded-pill bg-chip px-2 py-0.5 text-[12px] font-semibold text-navy">{t('comments.you', 'You')}</span>}
          </p>
          {(c.author_job_title || c.author_org_name) && (
            <p className="text-[14px] leading-5 text-meta [overflow-wrap:anywhere]">
              {c.author_job_title}
              {c.author_job_title && c.author_org_name && ' · '}
              {c.author_org_name && (companyHref ? (
                <Link to={companyHref} className="font-semibold text-navy underline decoration-navy/40 underline-offset-2 hover:decoration-navy">
                  {c.author_org_name}
                </Link>
              ) : c.author_org_name)}
            </p>
          )}
          <p className="mt-0.5 text-[13px] leading-5 text-meta">
            <time dateTime={c.created_at}>{formatWhen(c.created_at)}</time>
            {c.edited_at && <span> · {t('comments.edited', 'edited')}</span>}
          </p>
        </div>
      </header>

      {tagged && (
        <p className="mt-3 inline-flex items-center gap-1.5 rounded-pill bg-gold/20 px-3 py-1 text-[14px] font-semibold text-navy">
          <AtSign className="h-4 w-4" aria-hidden="true" />
          {t('comments.taggedHere', 'You were tagged in this comment')}
        </p>
      )}
      {c.hidden && (
        <p className="mt-3 flex items-start gap-2 rounded-field bg-chip px-3 py-2 text-[14px] leading-5 text-navy">
          <EyeOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            {staff && !c.is_mine
              ? t('comments.hiddenStaff', 'Hidden from members by the M3 team.')
              : t('comments.hiddenMine', 'Only you can see this comment: the M3 team hid it.')}
            {c.hidden_reason && <> {t('comments.hiddenReason', { reason: c.hidden_reason, defaultValue: 'Reason: {{reason}}' })}</>}
          </span>
        </p>
      )}

      {editing && editable ? (
        <div className="mt-4">
          <CommentComposer
            label={t('comments.editLabel', 'Change your comment')}
            initialText={editable.text}
            initialTags={editable.picked}
            submitLabel={t('comments.saveEdit', 'Save the change')}
            busyLabel={t('dash.saving', 'Saving…')}
            onSubmit={onSaveEdit}
            onCancel={onCancelEdit}
            autoFocus
          />
        </div>
      ) : (
        <CommentBody body={c.body} mentions={c.mentions} />
      )}

      {!editing && (
        <div className="mt-4 flex flex-wrap items-center gap-2.5">
          {c.is_mine ? (
            <>
              {!c.hidden && (
                <button type="button" onClick={onEdit} className={ACTION_BTN}>
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                  {t('comments.edit', 'Edit')}
                </button>
              )}
              <button type="button" onClick={onDelete} className={DANGER_BTN}>
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                {t('comments.delete', 'Delete')}
              </button>
            </>
          ) : c.reported_by_me ? (
            <span className="inline-flex min-h-11 items-center gap-1.5 px-1 text-[14px] text-meta">
              <Flag className="h-4 w-4" aria-hidden="true" />
              {t('comments.reportedByMe', 'You reported this comment to the M3 team')}
            </span>
          ) : !c.hidden && (
            <button type="button" onClick={onReport} className={ACTION_BTN}>
              <Flag className="h-4 w-4" aria-hidden="true" />
              {t('comments.report', 'Report to M3')}
            </button>
          )}
          {staff && (
            <>
              {c.hidden ? (
                <button type="button" onClick={onUnhide} className={ACTION_BTN}>
                  <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                  {t('comments.unhide', 'Show it again')}
                </button>
              ) : (
                <button type="button" onClick={onHide} className={DANGER_BTN}>
                  <EyeOff className="h-4 w-4" aria-hidden="true" />
                  {t('comments.hide', 'Hide (M3)')}
                </button>
              )}
              {(c.open_reports ?? 0) > 0 && (
                <span className="inline-flex items-center gap-1 rounded-pill bg-red-50 px-2.5 py-1 text-[13px] font-semibold text-red-800">
                  <Flag className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('comments.openReports', { count: c.open_reports ?? 0, defaultValue_one: '{{count}} report', defaultValue_other: '{{count}} reports' })}
                </span>
              )}
            </>
          )}
        </div>
      )}
    </article>
  );
}

/** The text with its tags as links (a company's page; a person's company page, or a plain chip). */
export function CommentBody({ body, mentions, className }: { body: string; mentions: CommentMention[]; className?: string }) {
  const { t } = useTranslation();
  const parts = useMemo(() => splitBody(body), [body]);
  const byId = useMemo(() => new Map(mentions.map((m) => [`${m.kind}:${m.id.toLowerCase()}`, m])), [mentions]);
  return (
    <p className={cn('mt-3 whitespace-pre-line text-[16px] leading-7 text-ink [overflow-wrap:anywhere]', className)}>
      {parts.map((p, i) => {
        if (p.type === 'text') return <Fragment key={i}>{p.text}</Fragment>;
        const m = byId.get(`${p.kind}:${p.id}`);
        const name = m?.name || p.label;
        if (!m) return <Fragment key={i}>@{p.label}</Fragment>;
        if (m.slug) {
          const where = m.kind === 'company'
            ? t('comments.openCompany', { name, defaultValue: 'Open the page of {{name}}' })
            : t('comments.openPersonCompany', { name, org: m.org_name ?? '', defaultValue: 'Open the page of {{org}}, the company of {{name}}' });
          return (
            <Link
              key={i}
              to={mentionHref(m.slug)}
              title={where}
              className="mx-0.5 inline-flex items-center gap-1 rounded-pill bg-foam px-2 py-0.5 align-baseline text-[15px] font-semibold leading-6 text-navy underline decoration-navy/40 underline-offset-2 transition-colors hover:bg-chip hover:decoration-navy focus:outline-none focus-visible:shadow-focus"
            >
              {m.kind === 'company' && <Building2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
              @{name}
            </Link>
          );
        }
        return (
          <span key={i} className="mx-0.5 inline-flex items-center rounded-pill bg-chip px-2 py-0.5 align-baseline text-[15px] font-semibold leading-6 text-navy">
            @{name}
          </span>
        );
      })}
    </p>
  );
}

function ReportDialog({ comment, onClose, onSent }: { comment: ArticleComment | null; onClose: () => void; onSent: () => void }) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (comment) { setReason(''); setError(null); } }, [comment]);
  return (
    <EditDialog
      open={!!comment}
      onOpenChange={(o) => { if (!o) onClose(); }}
      title={t('comments.reportTitle', 'Report this comment to the M3 team')}
      description={t('comments.reportDesc', 'The M3 team reads every report and can hide the comment. Its author is not told who reported it.')}
      saveLabel={t('comments.reportSend', 'Send the report')}
      saving={busy}
      error={error}
      onSave={async () => {
        if (!comment) return;
        setBusy(true);
        setError(null);
        try {
          const r = await reportComment(comment.id, reason.trim());
          toast({
            title: r.already ? t('comments.reportAlready', 'You had already reported this comment') : t('comments.reportThanks', 'Thank you. The M3 team will look at it.'),
          });
          onSent();
        } catch (err) {
          setError(commentErrorText(err, t));
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="comment-report-reason" className="text-[15px] font-semibold text-navy">
          {t('comments.reportReason', 'What is wrong?')} <span className="font-normal text-meta">{t('dash.optional', '(optional)')}</span>
        </Label>
        <Textarea
          id="comment-report-reason"
          value={reason}
          maxLength={500}
          rows={3}
          onChange={(e) => setReason(e.target.value)}
          className="text-[16px] leading-6"
          placeholder={t('comments.reportPlaceholder', 'For example: rude, advertising, false information…')}
        />
      </div>
    </EditDialog>
  );
}

function HideDialog({ comment, onClose, onDone }: { comment: ArticleComment | null; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (comment) { setReason(''); setError(null); } }, [comment]);
  return (
    <EditDialog
      open={!!comment}
      onOpenChange={(o) => { if (!o) onClose(); }}
      title={t('comments.hideTitle', 'Hide this comment')}
      description={t('comments.hideDesc', 'Members stop seeing it at once; its author still sees it, marked hidden. You can show it again at any time. Its open reports are closed.')}
      saveLabel={t('comments.hideConfirm', 'Hide the comment')}
      saving={busy}
      error={error}
      onSave={async () => {
        if (!comment) return;
        setBusy(true);
        setError(null);
        try {
          await moderateComment(comment.id, 'hide', reason.trim());
          toast({ title: t('comments.hidden', 'The comment is hidden') });
          onDone();
        } catch (err) {
          setError(commentErrorText(err, t));
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="comment-hide-reason" className="text-[15px] font-semibold text-navy">
          {t('comments.hideReason', 'Reason shown to its author')} <span className="font-normal text-meta">{t('dash.optional', '(optional)')}</span>
        </Label>
        <Textarea
          id="comment-hide-reason"
          value={reason}
          maxLength={500}
          rows={3}
          onChange={(e) => setReason(e.target.value)}
          className="text-[16px] leading-6"
        />
      </div>
    </EditDialog>
  );
}
