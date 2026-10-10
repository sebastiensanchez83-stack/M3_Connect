import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { TFunction } from 'i18next';
import { createPortal } from 'react-dom';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Check, Clock, FileText, Flag, ImageIcon, Inbox, Loader2, MessageSquare, Paperclip, RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CardShell } from '@/components/brand/CardShell';
import { LogoTile } from '@/components/brand/OrgCard';
import { MemberEmpty, RowSkeleton, StatusPill } from '@/components/member/MemberUI';
import { useMediaQuery, useReducedMotion } from '@/components/motion/useReducedMotion';
import { useAuth } from '@/contexts/AuthContext';
import { useInboxCount } from '@/hooks/useInboxCount';
import { requireFreshSession } from '@/lib/session';
import { displayCase } from '@/lib/displayCase';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { answerConnectionRequest, type OrgRef } from '@/components/inbox/inboxActions';
import { ReportDialog, ThreadView } from './ThreadView';
import {
  setConversationScreenOpen, useLiveChannel, useLiveEvents, useOnLiveAgain, useOpenThreadRequests, useRealtimeStatus,
} from './messageEvents';
import {
  loadConversations, loadRequests, markThreadRead, shortWhen,
  type Conversation, type ConnectionRequest,
} from './messagesApi';

/**
 * Messages (Oct 2026): conversations between companies (Victor's decisions of 9 Oct
 * 2026), in the look of WhatsApp or LinkedIn (his choice of 10 Oct). Shown in the
 * home dashboard's Messages tile and at /inbox.
 *
 * Wide screens (1024 px and more): ONE card of a steady height, the list on the left,
 * the open conversation on the right (it scrolls inside; the composer stays at the
 * bottom). The list:
 *   Requests          first messages sent to my company, waiting for an answer (anyone
 *                     in it may accept or decline; the first answer counts). Opening
 *                     one shows the whole message with Accept and reply, Decline (asked
 *                     again before it is done) and Report. On wide screens the first
 *                     one opens by itself, so the buttons are in sight at once.
 *   Conversations     one per company I am connected with: logo, name, the last message
 *                     (or "Photo", a file's name), its time, the unread count. The list
 *                     re-orders itself when a message arrives (live, messageEvents.ts).
 *   Sent              what my company wrote that is still waiting (or was not accepted).
 * Phones and tablets: the list, then the conversation over the whole screen with a
 * back arrow; the phone's own Back button closes it too (a history entry is added).
 *
 * People asking to join the company are not here: they are answered in My team
 * (and the dashboard's to-do), so the Messages count holds only what Messages shows.
 *
 * /?open=inbox&thread=<id> (or /inbox?thread=<id>) opens one directly (a company
 * page's "Open the conversation", the alerts' "Reply"): a conversation, or a first
 * message still waiting. The parameter is then dropped, so closing and reopening the
 * tile starts from the list.
 *
 * Wording is plain and every target is at least 44 px: the members are marina and
 * maritime business people, often not at ease with technology.
 */

const BTN44 = 'h-11 rounded-pill px-4';
const BTN44_OUTLINE = 'h-11 rounded-pill border-navy/25 bg-white px-4 text-navy hover:border-navy hover:bg-chip hover:text-navy';
const ROW = 'flex w-full items-start gap-3 px-4 py-3 text-left transition-colors focus:outline-none focus-visible:[box-shadow:inset_0_0_0_2px_#0b2653]';
const LIST_POLL_MS = 30_000;
/** While live, the list is still read every 2 minutes: a safety net for anything missed. */
const LIST_POLL_LIVE_MS = 120_000;
/** The site's sticky header: a card brought into view must not slide under it. */
const HEADER_ROOM = 88;

function orgName(org: OrgRef | null | undefined): string {
  return org ? displayCase(org.name) || org.name : '';
}

function firstNameOf(full: string | null | undefined): string {
  return (full || '').trim().split(/\s+/)[0] || '';
}

export function MessagesView() {
  const { t } = useTranslation();
  const { user, profile, organization } = useAuth();
  const inbox = useInboxCount(true);
  const refreshCount = inbox.refresh;
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const wide = useMediaQuery('(min-width: 1024px)');

  // Keyed on ids, never on the auth objects (replaced on every tab refocus).
  const uid = user?.id ?? null;
  const orgId = organization?.id ?? null;
  const myOrgName = organization?.name ?? '';
  const myFullName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ').trim();

  useLiveChannel(uid);
  const live = useRealtimeStatus() === 'live';

  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [conversationsOk, setConversationsOk] = useState(true);
  const [received, setReceived] = useState<ConnectionRequest[]>([]);
  const [sent, setSent] = useState<ConnectionRequest[]>([]);
  const [reporting, setReporting] = useState<ConnectionRequest | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [confirmDecline, setConfirmDecline] = useState<string | null>(null);
  /** Opened to answer (Accept and reply, an alert's Reply): the cursor goes to its text box. */
  const [focusId, setFocusId] = useState<string | null>(null);
  /** Opened before the list knew it (a conversation accepted a moment ago): read again, no "not available" meanwhile. */
  const [lookingFor, setLookingFor] = useState<string | null>(null);
  const lastLoad = useRef(0);
  const loadSeq = useRef(0);
  const autoOpened = useRef(false);
  // A history entry was added for the phone's conversation screen: Back closes it.
  const pushed = useRef(false);
  // The address is being tidied (the ?thread= dropped) before the screen's entry is added.
  const settling = useRef(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  const load = useCallback(async () => {
    if (!uid) return;
    lastLoad.current = Date.now();
    const seq = ++loadSeq.current;
    const [conv, reqs] = await Promise.all([
      loadConversations(),
      loadRequests(uid, orgId).catch(() => null),
    ]);
    // Reads can overlap (a live event, the timer, the focus): only the latest one counts.
    if (seq !== loadSeq.current) return;
    setConversations(conv.items);
    setConversationsOk(conv.ok);
    if (reqs) {
      setReceived(reqs.received);
      setSent(reqs.sent);
    }
    setLoadFailed(!conv.ok && !reqs);
    setLoaded(true);
  }, [uid, orgId]);

  useEffect(() => {
    setLoaded(false);
    void load();
  }, [load]);

  // A message or a request arrived live: the list follows (one read for a burst).
  const timer = useRef<number | null>(null);
  const soon = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { timer.current = null; void load(); }, 400);
  }, [load]);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);
  useLiveEvents(() => soon());

  // Back on the tab: read the list again (at most every 15 s). Without the live
  // channel, every 30 s while the page is in sight; with it, every 2 minutes as a
  // safety net, and at once when it comes back after a break.
  useEffect(() => {
    const onFocus = () => { if (Date.now() - lastLoad.current > 15_000) void load(); };
    window.addEventListener('focus', onFocus);
    const every = live ? LIST_POLL_LIVE_MS : LIST_POLL_MS;
    const iv = window.setInterval(() => {
      if (document.visibilityState === 'visible' && Date.now() - lastLoad.current > every - 1000) void load();
    }, every);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.clearInterval(iv);
    };
  }, [load, live]);
  useOnLiveAgain(() => { soon(); refreshCount(); });

  const selectedConversation = conversations?.find((c) => c.id === selectedId) ?? null;
  const selectedRequest = selectedConversation ? null
    : received.find((r) => r.data.id === selectedId) ?? sent.find((r) => r.data.id === selectedId) ?? null;
  const selectedMissing = loaded && !!selectedId && !selectedConversation && !selectedRequest && lookingFor !== selectedId;

  // Wide screens: bring the whole two-pane card into sight (under the site's header)
  // when a conversation is opened on purpose, so its newest messages and the text box
  // are on screen, not below the fold of a page with a large title.
  // (Asked for at once, done once the list is loaded: a ?thread= address is read
  // before the card is drawn.)
  const [viewAsked, setViewAsked] = useState(0);
  const bringIntoView = useCallback(() => setViewAsked((n) => n + 1), []);
  useEffect(() => {
    if (!viewAsked || !loaded || !wide) return;
    const frame = requestAnimationFrame(() => {
      const el = cardRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const below = r.bottom - (window.innerHeight - 12);
      const above = r.top - HEADER_ROOM;
      // Down until its bottom shows, never so far that its top hides under the header.
      const by = below > 0 ? Math.min(below, Math.max(above, 0)) : above < 0 ? above : 0;
      if (Math.abs(by) > 4) window.scrollBy({ top: by, behavior: reduced ? 'auto' : 'smooth' });
    });
    return () => cancelAnimationFrame(frame);
  }, [viewAsked, loaded, wide, reduced]);

  /**
   * Shows one conversation (or first message). On a phone it fills the screen and gets
   * its own history entry, so the phone's Back button closes it; a conversation
   * already on screen is swapped for this one in the same entry.
   */
  const show = (id: string, opts: { answer?: boolean } = {}) => {
    setConfirmDecline(null);
    setSelectedId(id);
    setFocusId(opts.answer ? id : null);
    const known = conversations?.some((c) => c.id === id) || received.some((r) => r.data.id === id) || sent.some((r) => r.data.id === id);
    if (!known && loaded) {
      setLookingFor(id);
      void load().finally(() => setLookingFor((cur) => (cur === id ? null : cur)));
    }
    if (wide) {
      bringIntoView();
      return;
    }
    const state = (location.state && typeof location.state === 'object') ? location.state as Record<string, unknown> : {};
    const here = `${location.pathname}${location.search}`;
    if (pushed.current) navigate(here, { replace: true, state: { ...state, msgScreen: id } });
    else {
      pushed.current = true;
      navigate(here, { state: { ...state, msgScreen: id } });
    }
  };
  const open = (id: string) => show(id);

  // An alert's "Reply" while Messages is on screen: open it here, in place.
  useOpenThreadRequests((id) => show(id, { answer: true }));

  // /?open=inbox&thread=<id> (a company page, an alert from another page): open that
  // one and drop the parameter. On a phone the address is tidied first, then the
  // screen gets its own entry: Back returns to the list, as for a conversation tapped.
  const wantedThread = searchParams.get('thread');
  useEffect(() => {
    if (!wantedThread) return;
    autoOpened.current = true;
    const next = new URLSearchParams(searchParams);
    next.delete('thread');
    const rest = next.toString();
    const clean = `${location.pathname}${rest ? `?${rest}` : ''}`;
    setConfirmDecline(null);
    setSelectedId(wantedThread);
    setFocusId(wantedThread);
    if (wide) {
      navigate(clean, { replace: true, state: location.state });
      bringIntoView();
      return;
    }
    const state = (location.state && typeof location.state === 'object') ? location.state as Record<string, unknown> : {};
    if (pushed.current) {
      navigate(clean, { replace: true, state: { ...state, msgScreen: wantedThread } });
    } else {
      settling.current = true;
      navigate(clean, { replace: true, state });
      pushed.current = true;
      navigate(clean, { state: { ...state, msgScreen: wantedThread } });
    }
    // Only the parameter matters here: the rest is read as it is now.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantedThread]);

  // Wide screens: a first message waiting for an answer opens by itself.
  useEffect(() => {
    if (!loaded || !wide || autoOpened.current || selectedId) return;
    autoOpened.current = true;
    if (received.length > 0) setSelectedId(received[0].data.id);
  }, [loaded, wide, received, selectedId]);

  // The phone's Back button closes the conversation screen. (Not while the address is
  // being tidied, nor for an address that opens a conversation itself.)
  useEffect(() => {
    const state = location.state as { msgScreen?: string } | null;
    if (state?.msgScreen) {
      settling.current = false;
      return;
    }
    if (!pushed.current || settling.current || new URLSearchParams(location.search).get('thread')) return;
    pushed.current = false;
    setSelectedId(null);
  }, [location]);

  const close = () => {
    setConfirmDecline(null);
    if (pushed.current) {
      navigate(-1);
      return;
    }
    setSelectedId(null);
  };

  // The thread was read: its unread count and the totals go.
  const onRead = useCallback(() => {
    setConversations((prev) => prev?.map((c) => (c.id === selectedId ? { ...c, unread: 0 } : c)) ?? prev);
    refreshCount();
  }, [selectedId, refreshCount]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    refreshCount();
    setRefreshing(false);
  };

  /* ---------------------------------------------------------- answers */

  const answer = async (item: ConnectionRequest, status: 'accepted' | 'rejected') => {
    const fresh = await requireFreshSession();
    if (!fresh) return;
    setActing(item.data.id);
    setConfirmDecline(null);
    const result = await answerConnectionRequest(item.data, status, {
      email: user?.email, firstName: profile?.first_name, lastName: profile?.last_name, orgName: myOrgName,
    });
    setActing(null);
    const company = orgName(item.org) || t('messages.theCompany', 'the company');
    if (!result.ok) {
      toast(result.taken
        ? { title: t('messages.alreadyAnswered', 'Already answered'), description: t('messages.alreadyAnsweredBody', 'Someone in your team has already answered this message.') }
        : { title: t('messages.answerFailed', 'Your answer was not saved'), description: result.message, variant: 'destructive' });
      await load();
      refreshCount();
      return;
    }
    const rest = received.filter((r) => r.data.id !== item.data.id);
    // Accepted: the same screen goes on with the conversation (read again meanwhile:
    // never "not available" in between), the cursor in its text box.
    if (status === 'accepted') setLookingFor(item.data.id);
    setReceived(rest);
    refreshCount();
    if (status === 'accepted') {
      toast({
        title: t('messages.acceptedTitle', 'You are connected'),
        description: t('messages.acceptedBody', 'You can now write to {{name}} here. M3 also introduced you both by e-mail.', { name: company }),
      });
      setFocusId(item.data.id);
      await markThreadRead(item.data.id).catch(() => {});
      await load();
      setSelectedId(item.data.id);
      setLookingFor((cur) => (cur === item.data.id ? null : cur));
    } else {
      toast({ title: t('messages.declinedTitle', 'Declined'), description: t('messages.declinedBody', '{{name}} is not told by e-mail.', { name: company }) });
      if (wide && rest.length > 0) setSelectedId(rest[0].data.id);
      else close();
    }
  };

  /* ---------------------------------------------------------- render */

  if (!uid) return null;

  if (!loaded) {
    return <CardShell><RowSkeleton rows={3} /></CardShell>;
  }

  const sentWaiting = sent.filter((s) => s.data.status === 'pending');
  const sentDeclined = sent.filter((s) => s.data.status === 'rejected');
  const conversationCount = conversations?.length ?? 0;
  const nothing = received.length === 0 && conversationCount === 0 && sent.length === 0;
  const unreadConversations = (conversations ?? []).filter((c) => c.unread > 0).length;

  const list = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-rule py-1 pl-4 pr-1.5">
        <p className="min-w-0 truncate text-[13px] font-semibold leading-5 text-meta">
          {unreadConversations > 0
            ? t('messages.list.unreadSummary', { count: unreadConversations, defaultValue_one: '{{count}} conversation with new messages', defaultValue_other: '{{count}} conversations with new messages' })
            : conversationCount > 0
              ? t('messages.list.summary', { count: conversationCount, defaultValue_one: '{{count}} conversation', defaultValue_other: '{{count}} conversations' })
              : t('messages.list.summaryNone', 'Your messages')}
        </p>
        <Button
          size="sm"
          variant="ghost"
          className={cn(BTN44, 'gap-1.5 px-3 text-navy hover:bg-chip')}
          onClick={refresh}
          disabled={refreshing}
        >
          <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin motion-reduce:animate-none')} aria-hidden="true" />
          {t('messages.refresh', 'Refresh')}
        </Button>
      </div>

      <div className="min-h-0 flex-1 lg:overflow-y-auto">
        {loadFailed && (
          <p role="alert" className="m-3 rounded-field border border-amber-200 bg-amber-50 px-4 py-3 text-[15px] text-amber-950">
            {t('messages.loadFailed', 'We could not load your messages. Check your connection, then press Refresh.')}
          </p>
        )}

        {/* ── Requests waiting for your answer ── */}
        {received.length > 0 && (
          <section aria-labelledby="msg-waiting" className="border-b border-rule bg-gold/[0.06]">
            <ListTitle id="msg-waiting" count={received.length}>{t('messages.requestsTitleShort', 'Requests waiting for your answer')}</ListTitle>
            <ul>
              {received.map((item) => (
                <RequestRow key={item.data.id} item={item} selected={item.data.id === selectedId} onOpen={() => open(item.data.id)} />
              ))}
            </ul>
          </section>
        )}

        {/* ── Conversations ── */}
        {conversationCount > 0 && (
          <section aria-labelledby="msg-conversations">
            <ListTitle id="msg-conversations" count={conversationCount}>{t('messages.conversationsTitle', 'Conversations')}</ListTitle>
            <ul className="divide-y divide-rule">
              {conversations!.map((c) => (
                <ConversationRow key={c.id} conversation={c} myFullName={myFullName} selected={c.id === selectedId} onOpen={() => open(c.id)} />
              ))}
            </ul>
          </section>
        )}
        {!conversationsOk && !loadFailed && (
          <p className="m-3 rounded-field bg-page px-4 py-3 text-[14px] leading-5 text-meta">
            {t('messages.conversationsSoon', 'Your conversations will appear here.')}
          </p>
        )}

        {/* ── Sent ── */}
        {sent.length > 0 && (
          <section aria-labelledby="msg-sent" className="border-t border-rule">
            <ListTitle id="msg-sent" count={sent.length}>{t('messages.sentTitle', 'Sent')}</ListTitle>
            <ul className="divide-y divide-rule">
              {[...sentWaiting, ...sentDeclined].map((s) => (
                <SentRow key={s.data.id} item={s} selected={s.data.id === selectedId} onOpen={() => open(s.data.id)} />
              ))}
            </ul>
          </section>
        )}

        {nothing && !loadFailed && (
          <MemberEmpty
            icon={Inbox}
            title={t('messages.emptyTitle', 'No messages yet')}
            body={t('messages.emptyBody', 'Find a company in the directory, open its page and press "Send a message". Its answer will appear here.')}
            action={(
              <Button asChild variant="ctaNavy" size="sm">
                <Link to="/directory">{t('messages.emptyAction', 'Find a company')}</Link>
              </Button>
            )}
          />
        )}
      </div>
    </div>
  );

  const showBack = !wide;
  const pane: ReactNode = selectedConversation ? (
    <ThreadView key={selectedConversation.id} conversation={selectedConversation} onBack={close} onRead={onRead} showBack={showBack} focusComposer={focusId === selectedConversation.id} />
  ) : selectedRequest ? (
    <RequestView
      key={selectedRequest.data.id}
      item={selectedRequest}
      showBack={showBack}
      onBack={close}
      acting={acting === selectedRequest.data.id}
      confirming={confirmDecline === selectedRequest.data.id}
      onAccept={() => answer(selectedRequest, 'accepted')}
      onDecline={() => setConfirmDecline(selectedRequest.data.id)}
      onConfirmDecline={() => answer(selectedRequest, 'rejected')}
      onCancelDecline={() => setConfirmDecline(null)}
      onReport={() => setReporting(selectedRequest)}
    />
  ) : selectedId && lookingFor === selectedId ? (
    <PaneMessage showBack={showBack} onBack={close}>
      <p className="flex items-center gap-2 text-[15px] text-meta" role="status">
        <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        {t('messages.opening', 'Opening the conversation…')}
      </p>
    </PaneMessage>
  ) : selectedMissing ? (
    <PaneMessage showBack={showBack} onBack={close}>
      <MemberEmpty
        icon={MessageSquare}
        title={t('messages.notFoundTitle', 'This conversation is not available')}
        body={t('messages.notFoundBody', 'It may still be waiting for an answer, or you are not part of it.')}
        action={<Button variant="outline" className={BTN44_OUTLINE} onClick={close}>{t('messages.backToList', 'Back to all messages')}</Button>}
      />
    </PaneMessage>
  ) : (
    <PaneMessage>
      <MemberEmpty
        icon={MessageSquare}
        title={t('messages.pickTitle', 'Choose a conversation')}
        body={conversationCount > 0
          ? t('messages.pickBody', 'Its messages will show here, with the name of each person who wrote.')
          : t('messages.pickBodyNone', 'When a company accepts your message, or answers yours, the conversation shows here.')}
      />
    </PaneMessage>
  );

  const paneLabel = selectedConversation
    ? t('messages.thread.label', { name: orgName(selectedConversation.otherOrg) || selectedConversation.otherPersonName || t('messages.aCompany', 'A company'), defaultValue: 'Conversation with {{name}}' })
    : t('messages.requestLabel', 'Message');

  // contain: inline-size: the dashboard panel sizes itself to its content's narrowest
  // width (an auto grid column), and a long company name would otherwise widen it past
  // a phone's screen; this block now always takes the panel's width.
  return (
    <div ref={cardRef} className="min-w-0 [contain:inline-size]">
      <CardShell
        as="div"
        className="min-w-0 lg:grid lg:h-[min(78vh,760px,calc(100dvh-104px))] lg:min-h-[560px] lg:grid-cols-[minmax(300px,360px)_minmax(0,1fr)]"
      >
        <div className="flex min-h-0 min-w-0 flex-col lg:border-r lg:border-rule">{list}</div>
        {wide && <div className="flex min-h-0 min-w-0 flex-col">{pane}</div>}
      </CardShell>
      {!wide && selectedId && (
        <PhoneScreen label={paneLabel} onClose={close}>{pane}</PhoneScreen>
      )}
      {reporting && (
        <ReportDialog
          open
          onOpenChange={(o) => { if (!o) setReporting(null); }}
          requestId={reporting.data.id}
          otherName={orgName(reporting.org) || reporting.person?.name || t('messages.theCompany', 'the company')}
          firstMessage
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ the phone's full screen */

/** The visible part of the screen (it shrinks when the phone's keyboard opens). */
function useVisualViewport() {
  const read = () => {
    const v = typeof window !== 'undefined' ? window.visualViewport : null;
    return { height: v ? v.height : window.innerHeight, top: v ? v.offsetTop : 0 };
  };
  const [box, setBox] = useState(read);
  useEffect(() => {
    const v = window.visualViewport;
    const on = () => setBox(read());
    v?.addEventListener('resize', on);
    v?.addEventListener('scroll', on);
    window.addEventListener('resize', on);
    return () => {
      v?.removeEventListener('resize', on);
      v?.removeEventListener('scroll', on);
      window.removeEventListener('resize', on);
    };
  }, []);
  return box;
}

/**
 * A conversation over the whole phone screen, above the site header, kept to the
 * part of the screen the keyboard leaves free (so the composer stays in sight).
 * Rendered at the end of the page (a portal): no ancestor's transform or containment
 * can shrink it. Escape closes it.
 */
function PhoneScreen({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const box = useVisualViewport();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setConversationScreenOpen(true);
    const before = document.activeElement as HTMLElement | null;
    // Focus the screen's first control (the back arrow): keyboards and screen readers start there.
    requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>('button, a[href]')?.focus());
    return () => {
      setConversationScreenOpen(false);
      before?.focus?.();
    };
  }, []);
  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}
      className="fixed inset-x-0 top-0 z-50 flex flex-col bg-white"
      style={{ height: box.height, transform: `translateY(${box.top}px)` }}
    >
      {children}
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------------ list pieces */

function ListTitle({ id, count, children }: { id: string; count: number; children: ReactNode }) {
  return (
    <h3 className="flex items-center gap-2 px-4 pb-1.5 pt-3 text-[12px] font-semibold uppercase leading-4 tracking-[0.08em] text-meta">
      <span id={id}>{children}</span>
      <span className="rounded-pill bg-chip px-2 py-0.5 text-[12px] font-semibold normal-case leading-4 tracking-normal tabular-nums text-navy">{count}</span>
    </h3>
  );
}

function PersonVisual({ item, size }: { item: ConnectionRequest; size: number }) {
  const company = orgName(item.org);
  const person = item.person?.name || '';
  if (item.person?.avatar_url) {
    return <img src={item.person.avatar_url} alt="" style={{ width: size, height: size }} className="shrink-0 rounded-pill object-cover ring-1 ring-rule" />;
  }
  if (item.org) return <LogoTile src={item.org.logo_url} name={company} type={item.org.organization_type} size={size} />;
  return (
    <span aria-hidden="true" style={{ width: size, height: size }} className="grid shrink-0 place-items-center rounded-pill bg-chip text-[15px] font-semibold text-navy">
      {(person || '?').slice(0, 1).toUpperCase()}
    </span>
  );
}

/** A first message to decide, in the list: who, their company, the start of the message. */
function RequestRow({ item, selected, onOpen }: { item: ConnectionRequest; selected: boolean; onOpen: () => void }) {
  const { t } = useTranslation();
  const person = item.person?.name || '';
  const company = orgName(item.org);
  return (
    <li>
      <button type="button" onClick={onOpen} aria-current={selected ? 'true' : undefined} className={cn(ROW, 'min-h-[76px]', selected ? 'bg-foam' : 'hover:bg-white')}>
        <PersonVisual item={item} size={44} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[15px] font-bold leading-5 text-navy">{person || company || t('messages.aMember', 'A member')}</span>
            <span className="shrink-0 text-[12px] font-semibold tabular-nums text-navy">{shortWhen(item.data.created_at)}</span>
          </span>
          {person && company && <span className="block truncate text-[13px] leading-[18px] text-meta">{company}</span>}
          {item.data.message && <span className="mt-0.5 line-clamp-2 text-[14px] leading-5 text-ink [overflow-wrap:anywhere]">{item.data.message}</span>}
          <span className="mt-1.5 inline-flex"><StatusPill tone="warning" icon={Clock}>{t('messages.waitingYourAnswer', 'Waiting for your answer')}</StatusPill></span>
        </span>
      </button>
    </li>
  );
}

/** What the last message carries when it has a file: "Photo", "2 photos", the PDF's name. */
function filePreview(c: Conversation, t: TFunction): string {
  if (c.lastAttachmentCount <= 0) return '';
  const image = (c.lastAttachmentMime || '').startsWith('image/');
  if (c.lastAttachmentCount > 1) {
    return image
      ? t('messages.list.photos', { count: c.lastAttachmentCount, defaultValue: '{{count}} photos' })
      : t('messages.list.files', { count: c.lastAttachmentCount, defaultValue: '{{count}} files' });
  }
  return image ? t('messages.list.photo', { defaultValue: 'Photo' }) : c.lastAttachmentName || t('messages.list.file', { defaultValue: 'File' });
}

/** A company I am connected with: logo, name, the last message, the time, the unread count. */
function ConversationRow({ conversation: c, myFullName, selected, onOpen }: { conversation: Conversation; myFullName: string; selected: boolean; onOpen: () => void }) {
  const { t } = useTranslation();
  const name = orgName(c.otherOrg) || c.otherPersonName || t('messages.aCompany', 'A company');
  const author = c.lastFromMySide && c.lastAuthorName && myFullName && c.lastAuthorName.trim() === myFullName
    ? t('messages.list.you', 'You')
    : firstNameOf(c.lastAuthorName);
  const unread = c.unread > 0;
  const files = filePreview(c, t);
  const image = (c.lastAttachmentMime || '').startsWith('image/');
  const FileIcon = image ? ImageIcon : c.lastAttachmentCount > 0 && !c.lastPreview ? FileText : Paperclip;
  return (
    <li>
      <button type="button" onClick={onOpen} aria-current={selected ? 'true' : undefined} className={cn(ROW, 'min-h-[72px] items-center', selected ? 'bg-foam' : 'hover:bg-page')}>
        {c.otherOrg
          ? <LogoTile src={c.otherOrg.logo_url} name={name} type={c.otherOrg.organization_type} size={44} />
          : <span aria-hidden="true" className="grid h-11 w-11 shrink-0 place-items-center rounded-field bg-chip text-[15px] font-semibold text-navy">{name.slice(0, 1).toUpperCase()}</span>}
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className={cn('truncate text-[15px] leading-5 text-navy', unread ? 'font-bold' : 'font-semibold')}>{name}</span>
            <span className={cn('shrink-0 text-[12px] tabular-nums', unread ? 'font-semibold text-navy' : 'text-meta')}>{shortWhen(c.lastMessageAt)}</span>
          </span>
          <span className="mt-0.5 flex items-center justify-between gap-2">
            <span className={cn('flex min-w-0 items-center gap-1 text-[14px] leading-5', unread ? 'text-ink' : 'text-meta')}>
              {author && <span className="shrink-0 font-medium">{author}:</span>}
              {files && <FileIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
              <span className="truncate">{c.lastPreview || files}</span>
            </span>
            {unread && (
              <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-pill bg-gold px-1.5 text-[12px] font-bold leading-none tabular-nums text-navy">
                {c.unread}
                <span className="sr-only"> {t('messages.unreadSr', { count: c.unread, defaultValue_one: 'unread message', defaultValue_other: 'unread messages' })}</span>
              </span>
            )}
          </span>
        </span>
      </button>
    </li>
  );
}

/** A first message my company sent: to whom, when, and where it stands. */
function SentRow({ item, selected, onOpen }: { item: ConnectionRequest; selected: boolean; onOpen: () => void }) {
  const { t } = useTranslation();
  const company = orgName(item.org) || t('messages.aCompany', 'A company');
  const waiting = item.data.status === 'pending';
  return (
    <li>
      <button type="button" onClick={onOpen} aria-current={selected ? 'true' : undefined} className={cn(ROW, 'min-h-[64px]', selected ? 'bg-foam' : 'hover:bg-page')}>
        {item.org
          ? <LogoTile src={item.org.logo_url} name={company} type={item.org.organization_type} size={40} />
          : <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-field bg-chip text-navy"><MessageSquare className="h-4 w-4" /></span>}
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[15px] font-semibold leading-5 text-navy">{company}</span>
            <span className="shrink-0 text-[12px] tabular-nums text-meta">{shortWhen(item.data.created_at)}</span>
          </span>
          <span className="mt-1 inline-flex">
            {waiting
              ? <StatusPill tone="warning" icon={Clock}>{t('messages.waitingPill', 'Waiting for their answer')}</StatusPill>
              : <StatusPill tone="neutral">{t('messages.notAcceptedPill', 'Not accepted')}</StatusPill>}
          </span>
        </span>
      </button>
    </li>
  );
}

/* ------------------------------------------------------------------ the right pane */

/** A pane with nothing open, or a short message (with a back arrow on phones). */
function PaneMessage({ showBack = false, onBack, children }: { showBack?: boolean; onBack?: () => void; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="flex h-full min-h-0 flex-col">
      {showBack && onBack && (
        <div className="flex shrink-0 items-center border-b border-rule px-2 py-2">
          <button
            type="button"
            onClick={onBack}
            className="grid h-11 w-11 place-items-center rounded-pill text-navy transition-colors hover:bg-chip focus:outline-none focus-visible:shadow-focus"
            aria-label={t('messages.backToList', 'Back to all messages')}
          >
            <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      )}
      <div className="grid min-h-0 flex-1 place-items-center overflow-y-auto bg-page/60">{children}</div>
    </div>
  );
}

/**
 * A first message, opened: received (who wrote it, the whole message, Accept and
 * reply, Decline with a second question, Report), or sent by my company (where it
 * stands).
 */
function RequestView({
  item, showBack, onBack, acting, confirming, onAccept, onDecline, onConfirmDecline, onCancelDecline, onReport,
}: {
  item: ConnectionRequest;
  showBack: boolean;
  onBack: () => void;
  acting: boolean;
  confirming: boolean;
  onAccept: () => void;
  onDecline: () => void;
  onConfirmDecline: () => void;
  onCancelDecline: () => void;
  /** "Report to M3" (spam, rude, someone pretending to be someone else). */
  onReport: () => void;
}) {
  const { t } = useTranslation();
  const receivedOne = item.direction === 'received';
  const person = item.person?.name || '';
  const company = orgName(item.org);
  const waiting = item.data.status === 'pending';
  const title = receivedOne ? person || company || t('messages.aMember', 'A member') : company || t('messages.aCompany', 'A company');
  const subtitle = receivedOne
    ? [item.person?.job_title, person ? company : ''].filter(Boolean).join(' · ')
    : item.person?.name
      ? t('messages.sentBy', { name: item.person.name, defaultValue: 'Sent by {{name}}' })
      : t('messages.sentByYou', 'Sent by you');
  const companyLink = item.org?.slug ? (
    <Link to={`/organizations/${item.org.slug}`} className="rounded-sm text-navy underline decoration-navy/30 underline-offset-[3px] hover:decoration-gold focus:outline-none focus-visible:shadow-focus">
      {t('messages.request.seeCompany', { name: company, defaultValue: 'See the page of {{name}}' })}
    </Link>
  ) : null;

  return (
    <section className="flex h-full min-h-0 flex-col bg-white" aria-label={title}>
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
        <PersonVisual item={item} size={40} />
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 text-[16px] font-semibold leading-5 text-navy [overflow-wrap:anywhere]">{title}</h3>
          {subtitle && <p className="truncate text-[13px] leading-[18px] text-meta">{subtitle}</p>}
        </div>
        {receivedOne && (
          <Button
            type="button"
            variant="ghost"
            onClick={onReport}
            disabled={acting}
            className="h-11 w-11 shrink-0 gap-1.5 rounded-pill px-0 text-meta hover:bg-chip hover:text-navy sm:w-auto sm:px-3"
            title={t('messages.report.buttonFirstSr', 'Report this message to M3')}
            aria-label={t('messages.report.buttonFirstSr', 'Report this message to M3')}
          >
            <Flag className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">{t('messages.report.button', 'Report')}</span>
          </Button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-page/70 px-4 py-5 sm:px-6">
        <div className="mx-auto max-w-xl space-y-4">
          <p className="text-center text-[12px] font-semibold leading-4 text-meta">{shortWhen(item.data.created_at)}</p>
          {item.data.message && (
            <div className={cn('flex', receivedOne ? 'justify-start' : 'justify-end')}>
              <p className={cn(
                'max-w-[90%] whitespace-pre-wrap rounded-[18px] px-4 py-2.5 text-[15px] leading-6 [overflow-wrap:anywhere]',
                receivedOne ? 'rounded-tl-[6px] border border-rule bg-white text-ink' : 'rounded-tr-[6px] bg-navy text-white',
              )}>
                {item.data.message}
              </p>
            </div>
          )}

          {receivedOne ? (
            <div className="rounded-card border border-gold/60 bg-white p-4 sm:p-5">
              <p className="text-[16px] font-semibold leading-6 text-navy">
                {t('messages.request.question', { name: company || person || t('messages.theCompany', 'the company'), defaultValue: '{{name}} would like to connect with your company.' })}
              </p>
              <p className="mt-1 text-[14px] leading-5 text-meta">
                {t('messages.request.explain', 'Accept to start the conversation: everyone in your company can then read and answer. Decline if you are not interested: they are not told by e-mail.')}
              </p>
              {confirming ? (
                <div className="mt-4 rounded-field bg-page p-3" role="group" aria-label={t('messages.declineYes', 'Yes, decline')}>
                  <p className="text-[14px] leading-5 text-ink">
                    {t('messages.declineConfirm', 'Decline this message? {{name}} will not be told by e-mail, and you will not be connected.', { name: company || person || t('messages.theCompany', 'the company') })}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" className={cn(BTN44_OUTLINE, 'gap-1.5')} onClick={onConfirmDecline} disabled={acting}>
                      <X className="h-4 w-4" aria-hidden="true" /> {t('messages.declineYes', 'Yes, decline')}
                    </Button>
                    <Button size="sm" variant="ghost" className={cn(BTN44, 'text-navy hover:bg-chip')} onClick={onCancelDecline} disabled={acting}>
                      {t('messages.declineNo', 'Keep it')}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button size="sm" className={cn(BTN44, 'gap-1.5 bg-navy text-white hover:bg-navy/90')} onClick={onAccept} disabled={acting}>
                    <Check className="h-4 w-4" aria-hidden="true" /> {t('messages.accept', 'Accept and reply')}
                  </Button>
                  <Button size="sm" variant="outline" className={cn(BTN44_OUTLINE, 'gap-1.5')} onClick={onDecline} disabled={acting}>
                    <X className="h-4 w-4" aria-hidden="true" /> {t('messages.decline', 'Decline')}
                  </Button>
                </div>
              )}
              {companyLink && <p className="mt-4 text-[14px] leading-5">{companyLink}</p>}
            </div>
          ) : (
            <div className="rounded-card border border-rule bg-white p-4 text-center sm:p-5">
              <span className="inline-flex">
                {waiting
                  ? <StatusPill tone="warning" icon={Clock}>{t('messages.waitingPill', 'Waiting for their answer')}</StatusPill>
                  : <StatusPill tone="neutral">{t('messages.notAcceptedPill', 'Not accepted')}</StatusPill>}
              </span>
              <p className="mt-2 text-[14px] leading-5 text-meta">
                {waiting
                  ? t('messages.request.sentWaiting', { name: company || t('messages.theCompany', 'the company'), defaultValue: 'When {{name}} accepts, the conversation opens here and you can write to each other.' })
                  : t('messages.request.sentDeclined', { name: company || t('messages.theCompany', 'the company'), defaultValue: '{{name}} did not accept this message.' })}
              </p>
              {companyLink && <p className="mt-3 text-[14px] leading-5">{companyLink}</p>}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
