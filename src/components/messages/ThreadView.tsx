import { Fragment, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Flag, Loader2, RefreshCw, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { CardShell } from '@/components/brand/CardShell';
import { LogoTile } from '@/components/brand/OrgCard';
import { useAuth } from '@/contexts/AuthContext';
import { requireFreshSession } from '@/lib/session';
import { displayCase } from '@/lib/displayCase';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  THREAD_MESSAGE_MAX, dayLabel, loadThread, markThreadRead, reportConversation, sendThreadMessage, timeOf,
  type Conversation, type ThreadMessage,
} from './messagesApi';

/**
 * One conversation between two companies. Every message says who wrote it, for
 * which company and when (Victor: "the name of the team member who replies").
 * Mine and my colleagues' messages sit on the right (navy), the other company's on
 * the left (white). The first message is the one that started the connection.
 *
 * It reads again every 15 seconds while it is on screen (and when the window gets
 * the focus back): polling, not Realtime, so nothing depends on a live socket and
 * only the database's own access rules decide what is read (msg_thread).
 * Opening it, or receiving a new message while it is open, marks it read.
 *
 * The composer: with a keyboard and mouse, Enter sends and Shift + Enter starts a
 * new line (as in most chat tools); on a phone or tablet (no Shift key) Enter
 * starts a new line and the Send button sends. 4,000 characters at most. "Report"
 * tells the M3 team, never the other company.
 */

const POLL_MS = 15_000;

export function ThreadView({
  conversation,
  onBack,
  onRead,
}: {
  conversation: Conversation;
  /** Back to the list (phones; the list stays beside the thread on wide screens). */
  onBack: () => void;
  /** After the conversation was marked read (counts to refresh). */
  onRead: () => void;
}) {
  const { t } = useTranslation();
  const { profile, organization } = useAuth();
  const id = conversation.id;
  const [messages, setMessages] = useState<ThreadMessage[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  // Set before any await: a second Enter while the first send starts must not send the text twice.
  const sendingRef = useRef(false);
  const [reportOpen, setReportOpen] = useState(false);
  // Touch-only devices (phones, tablets without a mouse or trackpad) have no Shift
  // key: there Enter makes a new line and the button sends.
  const [touchKeyboard] = useState(() => typeof window !== 'undefined' && !!window.matchMedia && !window.matchMedia('(any-pointer: fine)').matches);
  const logRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const lastSeen = useRef<string | null>(null);
  const composerId = useId();
  // The parent's callback may change on every render: the polling must not restart for it.
  const onReadRef = useRef(onRead);
  onReadRef.current = onRead;
  const hintId = useId();

  const otherName = conversation.otherOrg
    ? displayCase(conversation.otherOrg.name) || conversation.otherOrg.name
    : conversation.otherPersonName || t('messages.aCompany', 'A company');

  // Read the thread; mark it read when something new from the other side arrived.
  const load = useCallback(async (first: boolean) => {
    try {
      const rows = await loadThread(id);
      setFailed(false);
      setMessages((prev) => {
        // Keep a message still being sent at the bottom until the server has it.
        const pending = (prev ?? []).filter((m) => m.pending);
        return pending.length ? [...rows, ...pending] : rows;
      });
      const newest = rows.length ? rows[rows.length - 1] : null;
      const newestOther = [...rows].reverse().find((m) => !m.fromMySide) ?? null;
      const key = newestOther ? `${newestOther.id}` : '';
      if (first || (newestOther && key !== lastSeen.current)) {
        lastSeen.current = key;
        // Read up to the newest message shown: one that arrives meanwhile stays unread.
        await markThreadRead(id, newest?.createdAt ?? null).catch(() => {});
        onReadRef.current();
      }
      if (first && newest) stickToBottom.current = true;
    } catch {
      if (first) setFailed(true);
    }
  }, [id]);

  // Open: first read, then every 15 s while the page is visible, and on focus.
  useEffect(() => {
    let alive = true;
    setMessages(null);
    setFailed(false);
    lastSeen.current = null;
    stickToBottom.current = true;
    void load(true);
    const tick = () => {
      if (alive && document.visibilityState === 'visible') void load(false);
    };
    const timer = window.setInterval(tick, POLL_MS);
    window.addEventListener('focus', tick);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', tick);
    };
  }, [load]);

  // Follow the conversation down when the reader is at the bottom (not while they read older messages).
  useLayoutEffect(() => {
    const el = logRef.current;
    if (!el || !messages) return;
    if (stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const onScroll = () => {
    const el = logRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const send = async (e?: FormEvent) => {
    e?.preventDefault();
    const text = draft.trim();
    if (!text || sendingRef.current) return;
    sendingRef.current = true;
    try {
      await sendNow(text);
    } finally {
      sendingRef.current = false;
    }
  };

  const sendNow = async (text: string) => {
    const fresh = await requireFreshSession();
    if (!fresh) return;
    setSending(true);
    const temp: ThreadMessage = {
      id: `pending-${Date.now()}`,
      authorUserId: profile?.user_id ?? null,
      authorName: [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || null,
      authorJobTitle: profile?.job_title ?? null,
      authorAvatarUrl: profile?.avatar_url ?? null,
      authorOrgId: conversation.myOrgId,
      authorOrgName: organization?.id === conversation.myOrgId ? organization?.name ?? null : null,
      body: text,
      createdAt: new Date().toISOString(),
      isFirst: false,
      fromMySide: true,
      isDeleted: false,
      pending: true,
    };
    stickToBottom.current = true;
    setMessages((prev) => [...(prev ?? []), temp]);
    setDraft('');
    const result = await sendThreadMessage(id, text);
    setSending(false);
    if (!result.ok) {
      setMessages((prev) => (prev ?? []).filter((m) => m.id !== temp.id));
      setDraft((d) => d || text);
      toast({ title: t('messages.sendFailed', 'Not sent'), description: result.message, variant: 'destructive' });
      return;
    }
    setMessages((prev) => (prev ?? []).filter((m) => m.id !== temp.id).concat({ ...temp, pending: false }));
    void load(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !touchKeyboard && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  };

  const connectedLine = conversation.autoConnected
    ? t('messages.thread.autoConnected', 'Connected automatically: your activities match.')
    : t('messages.thread.connectedOn', { date: new Date(conversation.connectedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }), defaultValue: 'Connected on {{date}}.' });

  return (
    <section className="min-w-0" aria-label={t('messages.thread.label', { name: otherName, defaultValue: 'Conversation with {{name}}' })}>
    <CardShell as="div" className="min-w-0">
      {/* Header: back (phones), the other company, Report. */}
      <div className="flex items-center gap-3 border-b border-rule px-3 py-3 sm:px-4">
        <button
          type="button"
          onClick={onBack}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-pill text-navy transition-colors hover:bg-chip focus:outline-none focus-visible:shadow-focus lg:hidden"
          aria-label={t('messages.backToList', 'Back to all messages')}
        >
          <ArrowLeft className="h-5 w-5" aria-hidden="true" />
        </button>
        {conversation.otherOrg
          ? <span className="hidden shrink-0 sm:block"><LogoTile src={conversation.otherOrg.logo_url} name={otherName} type={conversation.otherOrg.organization_type} size={44} /></span>
          : <span aria-hidden="true" className="hidden h-11 w-11 shrink-0 place-items-center rounded-field bg-chip text-[15px] font-semibold text-navy sm:grid">{otherName.slice(0, 1).toUpperCase()}</span>}
        <div className="min-w-0 flex-1">
          {/* Two lines for a long name: on a phone the reader must see whom they talk to. */}
          <h3 className="line-clamp-2 text-[16px] font-semibold leading-6 text-navy [overflow-wrap:anywhere]">
            {conversation.otherOrg?.slug ? (
              <Link to={`/organizations/${conversation.otherOrg.slug}`} className="rounded-sm underline decoration-navy/25 underline-offset-[3px] hover:decoration-gold focus:outline-none focus-visible:shadow-focus">
                {otherName}
              </Link>
            ) : otherName}
          </h3>
          <p className="text-[13px] leading-[18px] text-meta">{connectedLine}</p>
        </div>
        {/* On a phone, the flag alone (44 px): the company's name needs the room. */}
        <Button
          type="button"
          variant="ghost"
          onClick={() => setReportOpen(true)}
          className="h-11 w-11 shrink-0 gap-1.5 rounded-pill px-0 text-meta hover:bg-chip hover:text-navy sm:w-auto sm:px-3"
          title={t('messages.report.buttonSr', 'Report this conversation to M3')}
          aria-label={t('messages.report.buttonSr', 'Report this conversation to M3')}
        >
          <Flag className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">{t('messages.report.button', 'Report')}</span>
        </Button>
      </div>

      {/* The messages */}
      <div
        ref={logRef}
        onScroll={onScroll}
        role="log"
        aria-label={t('messages.thread.logLabel', 'Messages')}
        className="h-[min(60vh,560px)] overflow-y-auto bg-page/60 px-3 py-4 sm:px-5"
      >
        {failed ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <p className="text-[15px] text-ink">{t('messages.thread.loadFailed', 'We could not load this conversation.')}</p>
            <Button type="button" variant="outline" onClick={() => { setFailed(false); void load(true); }} className="h-11 gap-1.5 rounded-pill border-navy/25 px-4 text-navy">
              <RefreshCw className="h-4 w-4" aria-hidden="true" /> {t('messages.tryAgain', 'Try again')}
            </Button>
          </div>
        ) : !messages ? (
          <div className="flex h-full items-center justify-center text-meta" role="status">
            <Loader2 className="mr-2 h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            {t('messages.loading', 'Loading…')}
          </div>
        ) : messages.length === 0 ? (
          <p className="flex h-full items-center justify-center px-6 text-center text-[15px] text-meta">
            {t('messages.thread.empty', 'No message yet. Write the first one below.')}
          </p>
        ) : (
          <ol className="space-y-4">
            {messages.map((m, i) => {
              const day = dayLabel(m.createdAt);
              const newDay = i === 0 || dayLabel(messages[i - 1].createdAt) !== day;
              return (
                <Fragment key={m.id}>
                  {newDay && (
                    <li aria-hidden="true" className="flex items-center gap-3 py-1 text-[12px] font-semibold uppercase tracking-[0.06em] text-meta">
                      <span className="h-px flex-1 bg-rule" />
                      {day}
                      <span className="h-px flex-1 bg-rule" />
                    </li>
                  )}
                  <MessageBubble message={m} />
                </Fragment>
              );
            })}
          </ol>
        )}
      </div>

      {/* The composer */}
      <form onSubmit={send} className="border-t border-rule bg-white px-3 py-3 sm:px-4">
        <label htmlFor={composerId} className="sr-only">{t('messages.composer.label', 'Write a message')}</label>
        <div className="flex items-end gap-2">
          <textarea
            id={composerId}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            rows={2}
            maxLength={THREAD_MESSAGE_MAX}
            enterKeyHint={touchKeyboard ? 'enter' : 'send'}
            aria-describedby={hintId}
            placeholder={t('messages.composer.placeholder', 'Write a message…')}
            className="block max-h-40 min-h-11 w-full min-w-0 flex-1 resize-y rounded-field border border-rule bg-white px-3.5 py-2.5 text-[16px] leading-6 text-ink placeholder:text-meta focus:outline-none focus-visible:shadow-focus"
          />
          <Button
            type="submit"
            disabled={!draft.trim() || sending}
            className="h-11 shrink-0 gap-1.5 rounded-pill bg-navy px-4 text-white hover:bg-navy/90"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
            {t('messages.composer.send', 'Send')}
          </Button>
        </div>
        <p id={hintId} className="mt-2 text-[12px] leading-[17px] text-meta">
          {touchKeyboard
            ? t('messages.composer.hintTouch', 'Everyone in both companies can read this conversation.')
            : t('messages.composer.hint', 'Enter sends, Shift + Enter starts a new line. Everyone in both companies can read this conversation.')}
          {draft.length > THREAD_MESSAGE_MAX - 300 && (
            <span className="ml-1 tabular-nums">({THREAD_MESSAGE_MAX - draft.length} {t('messages.composer.left', 'characters left')})</span>
          )}
        </p>
      </form>

      <ReportDialog open={reportOpen} onOpenChange={setReportOpen} requestId={id} otherName={otherName} />
    </CardShell>
    </section>
  );
}

/** One message: who wrote it (name, company, time) above the bubble. */
function MessageBubble({ message: m }: { message: ThreadMessage }) {
  const { t } = useTranslation();
  const mine = m.fromMySide;
  const company = m.authorOrgName ? displayCase(m.authorOrgName) || m.authorOrgName : '';
  // No name: an account without one ("A member", then its company), or one deleted since.
  const name = m.authorName
    ? displayCase(m.authorName) || m.authorName
    : m.authorUserId
    ? t('messages.aMember', 'A member')
    : t('messages.formerMember', 'Former member');
  return (
    <li className={cn('flex flex-col', mine ? 'items-end' : 'items-start')}>
      <p className={cn('mb-1 max-w-[90%] text-[13px] leading-[18px] text-meta [overflow-wrap:anywhere]', mine && 'text-right')}>
        <span className="font-semibold text-navy">{name}</span>
        {company && <> · {company}</>}
        {' · '}
        <time dateTime={m.createdAt}>{m.pending ? t('messages.sending', 'Sending…') : timeOf(m.createdAt)}</time>
      </p>
      <div
        className={cn(
          'max-w-[90%] whitespace-pre-wrap rounded-[18px] px-4 py-2.5 text-[15px] leading-6 [overflow-wrap:anywhere] sm:max-w-[80%]',
          mine ? 'rounded-br-[6px] bg-navy text-white' : 'rounded-bl-[6px] border border-rule bg-white text-ink',
          m.pending && 'opacity-70',
          m.isDeleted && 'italic',
        )}
      >
        {m.isDeleted || m.body === null ? t('messages.removed', 'This message was removed.') : m.body}
      </div>
      {m.isFirst && (
        <span className="mt-1 text-[12px] leading-4 text-meta">{t('messages.firstMessage', 'First message')}</span>
      )}
    </li>
  );
}

/**
 * "Report to M3": a reason, sent to the M3 team only (they see it on the admin's
 * B2B requests page). For a conversation, or for a first message still waiting
 * (`firstMessage`).
 */
export function ReportDialog({
  open, onOpenChange, requestId, otherName, firstMessage = false,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  requestId: string;
  otherName: string;
  firstMessage?: boolean;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const fieldId = useId();

  useEffect(() => { if (open) setReason(''); }, [open]);

  const submit = async () => {
    if (!reason.trim() || sendingRef.current) return;
    sendingRef.current = true;
    try {
      const fresh = await requireFreshSession();
      if (!fresh) return;
      setSending(true);
      const r = await reportConversation(requestId, reason);
      setSending(false);
      if (!r.ok) {
        toast({ title: t('messages.report.failed', 'Not sent'), description: r.message, variant: 'destructive' });
        return;
      }
      onOpenChange(false);
      toast({
        title: t('messages.report.done', 'Thank you'),
        description: firstMessage
          ? t('messages.report.doneBodyFirst', 'The M3 team will look at this message.')
          : t('messages.report.doneBody', 'The M3 team will look at this conversation.'),
      });
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-card">
        <DialogHeader>
          <DialogTitle className="text-navy">
            {firstMessage
              ? t('messages.report.titleFirst', 'Report this message to M3')
              : t('messages.report.title', 'Report this conversation to M3')}
          </DialogTitle>
          <DialogDescription className="text-[15px] leading-6">
            {t('messages.report.introReview', 'Tell us what is wrong (spam, rude messages, someone pretending to be someone else). The M3 team will review it. {{name}} is not told.', { name: otherName })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <label htmlFor={fieldId} className="text-[15px] font-semibold text-navy">{t('messages.report.label', 'What is wrong?')}</label>
          <textarea
            id={fieldId}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={4}
            maxLength={1000}
            className="block w-full resize-y rounded-field border border-rule bg-white px-3.5 py-3 text-[16px] leading-6 text-ink focus:outline-none focus-visible:shadow-focus"
          />
        </div>
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button variant="ctaOutline" size="sm" arrow={false} className="min-h-11" onClick={() => onOpenChange(false)}>{t('common.cancel', 'Cancel')}</Button>
          <Button variant="cta" size="sm" roll={!sending} arrow={!sending} className="min-h-11" onClick={submit} disabled={!reason.trim() || sending}>
            {sending && <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
            {t('messages.report.send', 'Send to M3')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
