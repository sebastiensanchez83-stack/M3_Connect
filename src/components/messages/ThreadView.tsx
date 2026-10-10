import {
  Fragment, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState,
  type ClipboardEvent, type DragEvent, type FormEvent, type KeyboardEvent, type ReactNode,
} from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertCircle, ArrowDown, ArrowLeft, Check, CheckCheck, Flag, Loader2, Paperclip, RefreshCw, Send, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { LogoTile } from '@/components/brand/OrgCard';
import { useAuth } from '@/contexts/AuthContext';
import { requireFreshSession } from '@/lib/session';
import { displayCase } from '@/lib/displayCase';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { AttachmentChip, ImageLightbox, MessageAttachments } from './Attachments';
import { setActiveThread, useLiveEvents, useRealtimeStatus } from './messageEvents';
import {
  ATTACHMENT_ACCEPT, ATTACHMENT_MAX_FILES, THREAD_MESSAGE_MAX,
  attachmentType, checkAttachment, checkAttachments, dayLabel, isImageAttachment, loadSeen, loadThread, markThreadRead,
  reportConversation, sameDay, sendThreadMessage, signAttachmentViews, timeOf,
  type Attachment, type Conversation, type SeenInfo, type ThreadMessage,
} from './messagesApi';

/**
 * One conversation between two companies, in the look of WhatsApp or LinkedIn
 * (Victor, 10 Oct 2026):
 *   - my messages on the right, in navy, without a name; my colleagues' on the right
 *     too, under their name (it is our company's side); the other company's on the
 *     left, with the person's photo (or initials), name and company above the first
 *     message of each run (Victor, 9 Oct: every message says who wrote it);
 *   - a day separator ("Today", "Yesterday", "Mon 6 Oct") and the time on each message;
 *   - under my side's last message: "Sent", or "Seen" once someone of the other
 *     company has opened the conversation since (tap or hover: "Seen by Jordan");
 *   - photos and PDFs: the paperclip, a drop on the conversation, or a paste; each
 *     file shows as a chip (name, size, remove) until it is sent.
 *
 * The thread fills the height it is given (the two-pane card on wide screens, the
 * whole screen on phones): the messages scroll inside, the composer stays at the
 * bottom. New messages arrive live (messageEvents.ts); while the live channel is
 * down it reads again every 15 seconds (every minute when live, as a safety net), and
 * when the window gets the focus back. Opening it, or a new message from the other
 * company arriving while it is on screen, marks it read.
 *
 * The composer: with a keyboard and mouse, Enter sends and Shift + Enter starts a
 * new line; on a phone or tablet (no Shift key) Enter starts a new line and the Send
 * button sends. 4,000 characters at most. "Report" tells the M3 team, never the
 * other company.
 */

const POLL_MS = 15_000;
const POLL_LIVE_MS = 60_000;
const SEEN_POLL_MS = 20_000;

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?';
}

function Avatar({ name, src, size = 32 }: { name: string; src: string | null; size?: number }) {
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size };
  if (src && !failed) {
    return <img src={src} alt="" style={style} onError={() => setFailed(true)} className="shrink-0 rounded-pill object-cover ring-1 ring-rule" />;
  }
  return (
    <span aria-hidden="true" style={style} className="grid shrink-0 place-items-center rounded-pill bg-chip text-[12px] font-semibold text-navy">
      {initialsOf(name)}
    </span>
  );
}

interface Run {
  key: string;
  day: string | null;
  mine: boolean;
  me: boolean;
  name: string;
  company: string;
  avatar: string | null;
  items: ThreadMessage[];
}

export function ThreadView({
  conversation,
  onBack,
  onRead,
  showBack = false,
}: {
  conversation: Conversation;
  /** Back to the list (the phone's full-screen conversation). */
  onBack: () => void;
  /** After the conversation was marked read (counts to refresh). */
  onRead: () => void;
  /** Show the back arrow (phones). */
  showBack?: boolean;
}) {
  const { t } = useTranslation();
  const { user, profile, organization } = useAuth();
  const uid = user?.id ?? null;
  const id = conversation.id;
  const live = useRealtimeStatus() === 'live';
  const [messages, setMessages] = useState<ThreadMessage[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [seen, setSeen] = useState<SeenInfo | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [lightbox, setLightbox] = useState<Attachment | null>(null);
  const [draft, setDraft] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [newBelow, setNewBelow] = useState(false);
  // Set before any await: a second Enter while the first send starts must not send twice.
  const sendingRef = useRef(false);
  const [reportOpen, setReportOpen] = useState(false);
  // Touch-only devices (phones, tablets without a mouse or trackpad) have no Shift
  // key: there Enter makes a new line and the button sends.
  const [touchKeyboard] = useState(() => typeof window !== 'undefined' && !!window.matchMedia && !window.matchMedia('(any-pointer: fine)').matches);
  const logRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const stickToBottom = useRef(true);
  const lastSeen = useRef<string | null>(null);
  const stale = useRef(false);
  const dragDepth = useRef(0);
  const prevCount = useRef(0);
  /** The log's scroll height when last seen: onScroll tells the browser's own scrolls from the reader's. */
  const lastHeight = useRef(0);
  const composerId = useId();
  const hintId = useId();
  // The parent's callback may change on every render: the reading must not restart for it.
  const onReadRef = useRef(onRead);
  onReadRef.current = onRead;

  const otherName = conversation.otherOrg
    ? displayCase(conversation.otherOrg.name) || conversation.otherOrg.name
    : conversation.otherPersonName || t('messages.aCompany', 'A company');
  const myOrgName = organization?.id && organization.id === conversation.myOrgId
    ? displayCase(organization.name) || organization.name
    : '';

  // The alerts stay quiet for the conversation on screen.
  useEffect(() => {
    setActiveThread(id);
    return () => setActiveThread(null);
  }, [id]);

  // Read the thread; mark it read when something new from the other side arrived
  // (only while it is on screen: a hidden tab marks it when it comes back).
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
      const key = newestOther ? newestOther.id : '';
      if ((first || key !== lastSeen.current) && document.visibilityState === 'visible') {
        lastSeen.current = key;
        stale.current = false;
        // Read up to the newest message shown: one that arrives meanwhile stays unread.
        await markThreadRead(id, newest?.createdAt ?? null).catch(() => {});
        onReadRef.current();
      }
      const s = await loadSeen(id).catch(() => null);
      setSeen(s);
    } catch {
      if (first) setFailed(true);
    }
  }, [id]);

  // Open: first read, then again on a live message, on a timer, on focus.
  useEffect(() => {
    setMessages(null);
    setFailed(false);
    setSeen(null);
    setDraft('');
    setFiles([]);
    setFileError(null);
    setNewBelow(false);
    lastSeen.current = null;
    stickToBottom.current = true;
    prevCount.current = 0;
    void load(true);
  }, [load]);

  const timer = useRef<number | null>(null);
  const soon = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { timer.current = null; void load(false); }, 150);
  }, [load]);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  useLiveEvents((e) => {
    if (e.kind !== 'message' || e.row.partner_request_id !== id) return;
    if (document.visibilityState !== 'visible') { stale.current = true; return; }
    soon();
  });

  useEffect(() => {
    let alive = true;
    const tick = () => { if (alive && document.visibilityState === 'visible') void load(false); };
    const iv = window.setInterval(tick, live ? POLL_LIVE_MS : POLL_MS);
    const onVisible = () => { if (document.visibilityState === 'visible' && (stale.current || !live)) tick(); };
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      window.clearInterval(iv);
      window.removeEventListener('focus', tick);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load, live]);

  /* ---------------------------------------------------------- "Seen" */

  // My side's last message (the first message too, when my company wrote it).
  const lastMine = useMemo(() => {
    if (!messages) return null;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i];
      if (m.pending) continue;
      if (m.fromMySide && !m.isDeleted) return m;
      if (!m.fromMySide) return null; // they answered after it: no "Seen" to show
    }
    return null;
  }, [messages]);
  const lastMineSeen = !!(lastMine && seen?.otherReadAt && new Date(seen.otherReadAt).getTime() >= new Date(lastMine.createdAt).getTime());

  // Waiting for them to read it: ask again every 20 seconds while on screen.
  useEffect(() => {
    if (!lastMine || lastMineSeen || seen === null) return;
    const iv = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadSeen(id).then((s) => { if (s) setSeen(s); }).catch(() => {});
    }, SEEN_POLL_MS);
    return () => window.clearInterval(iv);
  }, [id, lastMine, lastMineSeen, seen]);

  /* ---------------------------------------------------------- photos */

  useEffect(() => {
    if (!messages) return;
    const paths = messages.flatMap((m) => (m.pending ? [] : m.attachments.filter(isImageAttachment).map((a) => a.path))).filter((p) => p && !urls[p]);
    if (paths.length === 0) return;
    let alive = true;
    void signAttachmentViews(paths).then((got) => {
      if (alive && Object.keys(got).length) setUrls((prev) => ({ ...prev, ...got }));
    }).catch(() => {});
    return () => { alive = false; };
  }, [messages, urls]);

  /* ---------------------------------------------------------- scrolling */

  // Follow the conversation down when the reader is at the bottom; otherwise say
  // that something new arrived below.
  useLayoutEffect(() => {
    const el = logRef.current;
    if (!el || !messages) return;
    const grew = messages.length > prevCount.current;
    const last = messages[messages.length - 1];
    if (stickToBottom.current) el.scrollTop = el.scrollHeight;
    else if (grew && prevCount.current > 0 && last && !last.fromMySide) setNewBelow(true);
    prevCount.current = messages.length;
    lastHeight.current = el.scrollHeight;
  }, [messages]);

  // Photos that finish loading, "Seen" appearing: the reader at the bottom stays there.
  const listShown = messages !== null && !failed;
  useEffect(() => {
    const list = listRef.current;
    if (!listShown || !list || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      const el = logRef.current;
      if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
      if (el) lastHeight.current = el.scrollHeight;
    });
    ro.observe(list);
    return () => ro.disconnect();
  }, [listShown]);

  // A scroll the browser made itself because the content grew (a photo finished
  // loading) does not mean the reader scrolled up: when the height changed since the
  // last scroll and the reader was at the bottom, they stay there.
  const onScroll = () => {
    const el = logRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    const grew = el.scrollHeight !== lastHeight.current;
    lastHeight.current = el.scrollHeight;
    if (!atBottom && grew && stickToBottom.current) {
      el.scrollTop = el.scrollHeight;
      return;
    }
    stickToBottom.current = atBottom;
    if (atBottom) setNewBelow(false);
  };

  const toBottom = () => {
    const el = logRef.current;
    if (!el) return;
    stickToBottom.current = true;
    el.scrollTop = el.scrollHeight;
    setNewBelow(false);
  };

  /* ---------------------------------------------------------- composer */

  // The text box grows with what is typed, up to about six lines, then scrolls.
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = 'auto';
    // scrollHeight leaves the border out: without it the box would scroll by 2 px.
    el.style.height = `${Math.min(el.scrollHeight + (el.offsetHeight - el.clientHeight), 160)}px`;
  }, [draft]);

  const addFiles = (list: File[]) => {
    if (list.length === 0) return;
    // The files refused (type, size): one sentence each, the rule said once.
    const refused = list.filter((f) => checkAttachment(f) !== null);
    const errors: string[] = refused.length ? [checkAttachments(refused) ?? ''] : [];
    const next = [...files];
    for (const f of list) {
      if (refused.includes(f)) continue;
      if (next.some((x) => x.name === f.name && x.size === f.size && x.lastModified === f.lastModified)) continue;
      if (next.length >= ATTACHMENT_MAX_FILES) {
        errors.push(t('messages.files.tooMany', { max: ATTACHMENT_MAX_FILES, defaultValue: 'You can send up to {{max}} files at once.' }));
        break;
      }
      next.push(f);
    }
    setFiles(next);
    setFileError(errors.length ? errors.join(' ') : null);
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
    setFileError(null);
  };

  const send = async (e?: FormEvent) => {
    e?.preventDefault();
    const text = draft.trim();
    if ((!text && files.length === 0) || sendingRef.current) return;
    sendingRef.current = true;
    try {
      await sendNow(text, files);
    } finally {
      sendingRef.current = false;
    }
  };

  const sendNow = async (text: string, sendFiles: File[]) => {
    const fresh = await requireFreshSession();
    if (!fresh) return;
    setSending(true);
    const localUrls = sendFiles.map((f) => (attachmentType(f).startsWith('image/') ? URL.createObjectURL(f) : undefined));
    const temp: ThreadMessage = {
      id: `pending-${Date.now()}`,
      authorUserId: profile?.user_id ?? uid,
      authorName: [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || null,
      authorJobTitle: profile?.job_title ?? null,
      authorAvatarUrl: profile?.avatar_url ?? null,
      authorOrgId: conversation.myOrgId,
      authorOrgName: myOrgName || null,
      body: text,
      createdAt: new Date().toISOString(),
      isFirst: false,
      fromMySide: true,
      isDeleted: false,
      attachments: sendFiles.map((f, i) => ({ path: '', name: f.name, size: f.size, mime: attachmentType(f), localUrl: localUrls[i] })),
      pending: true,
    };
    stickToBottom.current = true;
    setMessages((prev) => [...(prev ?? []), temp]);
    setDraft('');
    setFiles([]);
    setFileError(null);
    const result = await sendThreadMessage(id, text, sendFiles);
    setSending(false);
    if (!result.ok) {
      setMessages((prev) => (prev ?? []).filter((m) => m.id !== temp.id));
      setDraft((d) => d || text);
      setFiles((f) => (f.length ? f : sendFiles));
      localUrls.forEach((u) => { if (u) URL.revokeObjectURL(u); });
      toast({ title: t('messages.sendFailed', 'Not sent'), description: result.message, variant: 'destructive' });
      return;
    }
    setMessages((prev) => (prev ?? []).filter((m) => m.id !== temp.id).concat({ ...temp, pending: false }));
    await load(false);
    window.setTimeout(() => localUrls.forEach((u) => { if (u) URL.revokeObjectURL(u); }), 30_000);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !touchKeyboard && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = Array.from(e.clipboardData?.files ?? []);
    if (pasted.length) {
      e.preventDefault();
      addFiles(pasted);
    }
  };

  // Drag and drop anywhere on the conversation (the counter ignores the children's enter/leave).
  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
  const dropHandlers = {
    onDragEnter: (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth.current += 1; setDragging(true); },
    onDragOver: (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; },
    onDragLeave: (e: DragEvent) => { if (!hasFiles(e)) return; dragDepth.current = Math.max(0, dragDepth.current - 1); if (dragDepth.current === 0) setDragging(false); },
    onDrop: (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      addFiles(Array.from(e.dataTransfer.files ?? []));
      textRef.current?.focus();
    },
  };

  /* ---------------------------------------------------------- runs of messages */

  const runs = useMemo<Run[]>(() => {
    const out: Run[] = [];
    for (const m of messages ?? []) {
      const prevRun = out[out.length - 1];
      const prev = prevRun?.items[prevRun.items.length - 1];
      const newDay = !prev || !sameDay(prev.createdAt, m.createdAt);
      const sameAuthor = !!prev && !newDay && prev.fromMySide === m.fromMySide
        && (prev.authorUserId ?? `org:${prev.authorOrgId}`) === (m.authorUserId ?? `org:${m.authorOrgId}`);
      if (sameAuthor && prevRun) {
        prevRun.items.push(m);
        continue;
      }
      const me = m.fromMySide && (m.pending || (!!uid && m.authorUserId === uid));
      // No name: an account without one ("A member"), or one deleted since.
      const name = m.authorName
        ? displayCase(m.authorName) || m.authorName
        : m.authorUserId ? t('messages.aMember', 'A member') : t('messages.formerMember', 'Former member');
      out.push({
        key: m.id,
        day: newDay ? dayLabel(m.createdAt) : null,
        mine: m.fromMySide,
        me,
        name,
        company: m.authorOrgName ? displayCase(m.authorOrgName) || m.authorOrgName : '',
        avatar: m.authorAvatarUrl,
        items: [m],
      });
    }
    return out;
  }, [messages, uid, t]);

  const connectedLine = conversation.autoConnected
    ? t('messages.thread.autoConnected', 'Connected automatically: your activities match.')
    : t('messages.thread.connectedOn', { date: new Date(conversation.connectedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }), defaultValue: 'Connected on {{date}}.' });

  const canSend = (!!draft.trim() || files.length > 0) && !sending;

  return (
    <section
      className="relative flex h-full min-h-0 min-w-0 flex-col bg-white"
      aria-label={t('messages.thread.label', { name: otherName, defaultValue: 'Conversation with {{name}}' })}
      {...dropHandlers}
    >
      {/* Header: back (phones), the other company, Report. */}
      <div className="flex shrink-0 items-center gap-2.5 border-b border-rule px-2 py-2 sm:gap-3 sm:px-4">
        {showBack && (
          <button
            type="button"
            onClick={onBack}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-pill text-navy transition-colors hover:bg-chip focus:outline-none focus-visible:shadow-focus"
            aria-label={t('messages.backToList', 'Back to all messages')}
          >
            <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
        {conversation.otherOrg
          ? <LogoTile src={conversation.otherOrg.logo_url} name={otherName} type={conversation.otherOrg.organization_type} size={40} />
          : <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-field bg-chip text-[15px] font-semibold text-navy">{otherName.slice(0, 1).toUpperCase()}</span>}
        <div className="min-w-0 flex-1">
          {/* Two lines for a long name: on a phone the reader must see whom they talk to. */}
          <h3 className="line-clamp-2 text-[16px] font-semibold leading-5 text-navy [overflow-wrap:anywhere]">
            {conversation.otherOrg?.slug ? (
              <Link to={`/organizations/${conversation.otherOrg.slug}`} className="rounded-sm hover:underline hover:decoration-gold hover:underline-offset-[3px] focus:outline-none focus-visible:shadow-focus">
                {otherName}
              </Link>
            ) : otherName}
          </h3>
          <p className="truncate text-[13px] leading-[18px] text-meta">{connectedLine}</p>
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
      <div className="relative min-h-0 flex-1">
        <div
          ref={logRef}
          onScroll={onScroll}
          role="log"
          aria-label={t('messages.thread.logLabel', 'Messages')}
          className="h-full overflow-y-auto overscroll-contain bg-page/70 px-3 py-4 [overflow-anchor:none] sm:px-5"
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
          ) : (
            <ol ref={listRef} className="space-y-3">
              {/* Who reads this: said once, at the top. */}
              <li className="mx-auto max-w-sm rounded-field bg-white/80 px-3 py-2 text-center text-[12px] leading-[17px] text-meta ring-1 ring-rule">
                {myOrgName
                  ? t('messages.thread.whoReads', { other: otherName, mine: myOrgName, defaultValue: 'Everyone at {{other}} and at {{mine}} can read this conversation.' })
                  : t('messages.thread.whoReadsShort', { other: otherName, defaultValue: 'Everyone at {{other}} and in your company can read this conversation.' })}
              </li>
              {messages.length === 0 && (
                <li className="px-6 py-8 text-center text-[15px] text-meta">{t('messages.thread.empty', 'No message yet. Write the first one below.')}</li>
              )}
              {runs.map((run) => (
                <Fragment key={run.key}>
                  {run.day && (
                    <li className="flex justify-center pt-1" aria-label={run.day}>
                      <span className="rounded-pill bg-white px-3 py-1 text-[12px] font-semibold leading-4 text-meta ring-1 ring-rule">{run.day}</span>
                    </li>
                  )}
                  <MessageRun
                    run={run}
                    urls={urls}
                    lastMineId={lastMine?.id ?? null}
                    seen={seen}
                    lastMineSeen={lastMineSeen}
                    onOpenImage={setLightbox}
                  />
                </Fragment>
              ))}
            </ol>
          )}
        </div>
        {newBelow && (
          <button
            type="button"
            onClick={toBottom}
            className="absolute bottom-3 left-1/2 inline-flex min-h-11 -translate-x-1/2 items-center gap-1.5 rounded-pill bg-navy px-4 text-[14px] font-semibold text-white shadow-hover focus:outline-none focus-visible:shadow-focus"
          >
            <ArrowDown className="h-4 w-4" aria-hidden="true" />
            {t('messages.thread.newBelow', 'New messages')}
          </button>
        )}
      </div>

      {/* The composer */}
      <form onSubmit={send} className="shrink-0 border-t border-rule bg-white px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 sm:px-3">
        {fileError && (
          <p role="alert" className="mb-2 flex items-start gap-2 rounded-field bg-red-50 px-3 py-2 text-[14px] leading-5 text-red-800">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="[overflow-wrap:anywhere]">{fileError}</span>
          </p>
        )}
        {files.length > 0 && (
          <ul className="mb-2 flex flex-wrap gap-2" aria-label={t('messages.files.toSend', 'Files to send')}>
            {files.map((f, i) => <AttachmentChip key={`${f.name}-${f.size}-${f.lastModified}`} file={f} disabled={sending} onRemove={() => removeFile(i)} />)}
          </ul>
        )}
        <div className="flex items-end gap-1.5">
          <input
            ref={fileRef}
            type="file"
            multiple
            accept={ATTACHMENT_ACCEPT}
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => { addFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={sending}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-pill text-navy transition-colors hover:bg-chip focus:outline-none focus-visible:shadow-focus disabled:opacity-50"
            aria-label={t('messages.files.attach', 'Attach a photo or a PDF')}
            title={t('messages.files.attachTitle', { rule: t('messages.files.rule', 'PDF, JPG, PNG or WebP, up to 10 MB.'), defaultValue: 'Attach a photo or a PDF ({{rule}})' })}
          >
            <Paperclip className="h-5 w-5" aria-hidden="true" />
          </button>
          <label htmlFor={composerId} className="sr-only">{t('messages.composer.label', 'Write a message')}</label>
          <textarea
            ref={textRef}
            id={composerId}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            rows={1}
            maxLength={THREAD_MESSAGE_MAX}
            enterKeyHint={touchKeyboard ? 'enter' : 'send'}
            aria-describedby={hintId}
            placeholder={t('messages.composer.placeholder', 'Write a message…')}
            className="block max-h-40 min-h-11 w-full min-w-0 flex-1 resize-none overflow-y-auto rounded-[22px] border border-rule bg-page px-4 py-2.5 text-[16px] leading-6 text-ink placeholder:text-meta focus:border-navy/40 focus:bg-white focus:outline-none focus-visible:shadow-focus"
          />
          <Button
            type="submit"
            disabled={!canSend}
            className="h-11 shrink-0 gap-1.5 rounded-pill bg-navy px-4 text-white hover:bg-navy/90"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
            {t('messages.composer.send', 'Send')}
          </Button>
        </div>
        <p id={hintId} className={cn('mt-1.5 px-1 text-[12px] leading-[17px] text-meta', touchKeyboard && draft.length <= THREAD_MESSAGE_MAX - 300 && 'sr-only')}>
          {touchKeyboard
            ? t('messages.composer.hintTouchShort', 'The Send button sends your message.')
            : t('messages.composer.hintKeys', 'Enter sends, Shift + Enter starts a new line.')}
          {draft.length > THREAD_MESSAGE_MAX - 300 && (
            <span className="ml-1 tabular-nums">({THREAD_MESSAGE_MAX - draft.length} {t('messages.composer.left', 'characters left')})</span>
          )}
        </p>
      </form>

      {/* Dropping files on the conversation */}
      {dragging && (
        <div className="pointer-events-none absolute inset-2 z-10 grid place-items-center rounded-card border-2 border-dashed border-teal bg-foam/95 text-center">
          <div>
            <Upload className="mx-auto h-7 w-7 text-teal" aria-hidden="true" />
            <p className="mt-2 text-[16px] font-semibold text-navy">{t('messages.files.dropHere', 'Drop your photos or PDFs here')}</p>
            <p className="mt-1 text-[14px] text-meta">{t('messages.files.rule', 'PDF, JPG, PNG or WebP, up to 10 MB.')}</p>
          </div>
        </div>
      )}

      <ImageLightbox attachment={lightbox} url={lightbox ? lightbox.localUrl ?? urls[lightbox.path] ?? null : null} onClose={() => setLightbox(null)} />
      <ReportDialog open={reportOpen} onOpenChange={setReportOpen} requestId={id} otherName={otherName} />
    </section>
  );
}

/** A run of messages by one person: their name above (not for my own), then the bubbles. */
function MessageRun({
  run, urls, lastMineId, seen, lastMineSeen, onOpenImage,
}: {
  run: Run;
  urls: Record<string, string>;
  lastMineId: string | null;
  seen: SeenInfo | null;
  lastMineSeen: boolean;
  onOpenImage: (a: Attachment) => void;
}) {
  const header: ReactNode = run.me ? null : (
    <p className={cn('mb-1 max-w-[85%] text-[13px] leading-[18px] text-meta [overflow-wrap:anywhere]', run.mine && 'text-right')}>
      <span className="font-semibold text-navy">{run.name}</span>
      {run.company && <> · {run.company}</>}
    </p>
  );
  const bubbles = run.items.map((m, i) => (
    <Bubble
      key={m.id}
      message={m}
      mine={run.mine}
      first={i === 0}
      urls={urls}
      onOpenImage={onOpenImage}
      footer={m.id === lastMineId && seen ? <SeenMark seen={seen} isSeen={lastMineSeen} /> : null}
    />
  ));
  if (run.mine) {
    return (
      <li className="flex flex-col items-end">
        {header}
        <div className="flex w-full flex-col items-end gap-1">{bubbles}</div>
      </li>
    );
  }
  return (
    <li className="flex items-start gap-2">
      <span className="mt-[22px]"><Avatar name={run.name} src={run.avatar} /></span>
      <div className="flex min-w-0 flex-1 flex-col items-start">
        {header}
        <div className="flex w-full flex-col items-start gap-1">{bubbles}</div>
      </div>
    </li>
  );
}

function Bubble({
  message: m, mine, first, urls, onOpenImage, footer,
}: {
  message: ThreadMessage;
  mine: boolean;
  first: boolean;
  urls: Record<string, string>;
  onOpenImage: (a: Attachment) => void;
  footer: ReactNode;
}) {
  const { t } = useTranslation();
  const removed = m.isDeleted || m.body === null;
  const hasText = !removed && !!m.body;
  const hasFiles = !removed && m.attachments.length > 0;
  return (
    <div className={cn('flex max-w-[85%] flex-col sm:max-w-[75%]', mine ? 'items-end' : 'items-start')}>
      <div
        className={cn(
          'min-w-[84px] max-w-full rounded-[18px] px-3 py-2 text-[15px] leading-6',
          mine ? 'bg-navy text-white' : 'border border-rule bg-white text-ink',
          first && (mine ? 'rounded-tr-[6px]' : 'rounded-tl-[6px]'),
          m.pending && 'opacity-75',
          removed && 'italic',
        )}
      >
        {hasFiles && (
          <div className={cn(hasText && 'mb-1.5')}>
            <MessageAttachments attachments={m.attachments} mine={mine} urls={urls} pending={m.pending} onOpenImage={onOpenImage} />
          </div>
        )}
        {removed
          ? <p>{t('messages.removed', 'This message was removed.')}</p>
          : hasText && <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{m.body}</p>}
        <p className={cn('mt-0.5 text-right text-[11px] leading-4 tabular-nums', mine ? 'text-white/70' : 'text-meta')}>
          <time dateTime={m.createdAt}>{m.pending ? t('messages.sending', 'Sending…') : timeOf(m.createdAt)}</time>
        </p>
      </div>
      {m.isFirst && (
        <span className="mt-0.5 text-[12px] leading-4 text-meta">{t('messages.firstMessage', 'First message')}</span>
      )}
      {footer}
    </div>
  );
}

/** Under my side's last message: "Sent", or "Seen" (tap or hover: by whom, when). */
function SeenMark({ seen, isSeen }: { seen: SeenInfo; isSeen: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  if (!isSeen) {
    return (
      <span className="mt-0.5 inline-flex items-center gap-1 text-[12px] leading-4 text-meta">
        <Check className="h-3.5 w-3.5" aria-hidden="true" />
        {t('messages.seen.sent', 'Sent')}
      </span>
    );
  }
  const who = seen.otherFirstName || seen.otherName || '';
  const when = seen.otherReadAt ? `${dayLabel(seen.otherReadAt)} ${timeOf(seen.otherReadAt)}` : '';
  const detail = who
    ? t('messages.seen.by', { name: who, when, defaultValue: 'Seen by {{name}} · {{when}}' })
    : t('messages.seen.at', { when, defaultValue: 'Seen · {{when}}' });
  return (
    <button
      type="button"
      onClick={() => setOpen((o) => !o)}
      title={detail}
      aria-expanded={open}
      className="-my-2.5 inline-flex min-h-11 items-center gap-1 rounded-pill px-1 text-[12px] leading-4 text-meta focus:outline-none focus-visible:shadow-focus"
    >
      <CheckCheck className="h-3.5 w-3.5 text-teal" aria-hidden="true" />
      <span>{open ? detail : t('messages.seen.seen', 'Seen')}</span>
      {!open && <span className="sr-only">{detail}</span>}
    </button>
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
