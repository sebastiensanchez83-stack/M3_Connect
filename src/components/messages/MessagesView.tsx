import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Check, Clock, Flag, Inbox, MessageSquare, RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CardShell } from '@/components/brand/CardShell';
import { Eyebrow } from '@/components/brand/Eyebrow';
import { LogoTile } from '@/components/brand/OrgCard';
import { MemberEmpty, RowSkeleton, StatusPill } from '@/components/member/MemberUI';
import { useAuth } from '@/contexts/AuthContext';
import { useInboxCount } from '@/hooks/useInboxCount';
import { requireFreshSession } from '@/lib/session';
import { displayCase } from '@/lib/displayCase';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { answerConnectionRequest, type OrgRef } from '@/components/inbox/inboxActions';
import { ReportDialog, ThreadView } from './ThreadView';
import {
  loadConversations, loadRequests, markThreadRead, shortWhen,
  type Conversation, type ConnectionRequest,
} from './messagesApi';

/**
 * Messages (Oct 2026): what used to be the inbox, now real conversations between
 * companies (Victor's decisions of 9 Oct 2026). Shown in the home dashboard's
 * Messages tile and at /inbox.
 *
 *   Requests waiting for your answer
 *                             first messages sent to my company (anyone in it may
 *                             accept or decline; the first answer counts; any of
 *                             them can also report one to M3)
 *   Conversations             one per company I am connected with: its logo and
 *                             name, the last message, an unread dot, the time
 *   Sent                      what my company wrote that is still waiting (or was
 *                             not accepted)
 *
 * People asking to join the company are not here: they are answered in My team
 * (and the dashboard's to-do), so the Messages count holds only what Messages shows.
 *
 * Opening a conversation shows it beside the list on wide screens, in place of the
 * list on phones (with a way back). /?open=inbox&thread=<id> opens one directly
 * (the company page's "Open the conversation"); the address parameter is then
 * dropped, so closing and reopening the tile starts from the list.
 *
 * Wording is plain and every target is at least 44 px: the members are marina and
 * maritime business people, often not at ease with technology.
 */

const BTN44 = 'h-11 rounded-pill px-4';
const BTN44_OUTLINE = 'h-11 rounded-pill border-navy/25 bg-white px-4 text-navy hover:border-navy hover:bg-chip hover:text-navy';

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
  const [searchParams, setSearchParams] = useSearchParams();

  // Keyed on ids, never on the auth objects (replaced on every tab refocus).
  const uid = user?.id ?? null;
  const orgId = organization?.id ?? null;
  const myOrgName = organization?.name ?? '';

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
  const rootRef = useRef<HTMLDivElement>(null);
  const lastLoad = useRef(0);

  const load = useCallback(async () => {
    if (!uid) return;
    lastLoad.current = Date.now();
    const [conv, reqs] = await Promise.all([
      loadConversations(),
      loadRequests(uid, orgId).catch(() => null),
    ]);
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

  // Back on the tab: read the list again (at most every 15 s).
  useEffect(() => {
    const onFocus = () => { if (Date.now() - lastLoad.current > 15_000) void load(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  // /?open=inbox&thread=<id>: open that conversation once, then drop the parameter.
  const wantedThread = searchParams.get('thread');
  useEffect(() => {
    if (!wantedThread) return;
    setSelectedId(wantedThread);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('thread');
      return next;
    }, { replace: true });
  }, [wantedThread, setSearchParams]);

  const selected = conversations?.find((c) => c.id === selectedId) ?? null;
  // A conversation asked for in the address but not (or not yet) in the list.
  const selectedMissing = loaded && !!selectedId && !selected;

  // On a phone the thread replaces the list: start at its top, its header (Back, the
  // company, Report) in view. scrollIntoView keeps clear of the sticky site header
  // (the page's scroll-padding-top, src/index.css), which stays put on working
  // screens such as this one. Done right after React has shown the thread.
  const [scrollToThread, setScrollToThread] = useState(0);
  useLayoutEffect(() => {
    if (!scrollToThread) return;
    const el = rootRef.current;
    if (el && window.matchMedia('(max-width: 1023px)').matches) el.scrollIntoView({ block: 'start' });
  }, [scrollToThread]);

  const open = (id: string) => {
    setSelectedId(id);
    setScrollToThread((n) => n + 1);
  };

  const back = () => {
    setSelectedId(null);
    void load();
  };

  // The thread was read: its unread dot and the counts go.
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
    setReceived((prev) => prev.filter((r) => r.data.id !== item.data.id));
    refreshCount();
    if (status === 'accepted') {
      toast({
        title: t('messages.acceptedTitle', 'You are connected'),
        description: t('messages.acceptedBody', 'You can now write to {{name}} here. M3 also introduced you both by e-mail.', { name: company }),
      });
      await markThreadRead(item.data.id).catch(() => {});
      await load();
      open(item.data.id);
    } else {
      toast({ title: t('messages.declinedTitle', 'Declined'), description: t('messages.declinedBody', '{{name}} is not told by e-mail.', { name: company }) });
    }
  };

  /* ---------------------------------------------------------- render */

  if (!uid) return null;

  if (!loaded) {
    return <CardShell><RowSkeleton rows={3} /></CardShell>;
  }

  const waitingCount = received.length;
  const sentWaiting = sent.filter((s) => s.data.status === 'pending');
  const sentDeclined = sent.filter((s) => s.data.status === 'rejected');
  const nothing = waitingCount === 0 && (conversations?.length ?? 0) === 0 && sent.length === 0;

  // The panel and the page already say what Messages is (their own heading and
  // description): here, only the way to read again.
  const list = (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button size="sm" variant="ghost" className={cn(BTN44, 'gap-1.5 text-navy hover:bg-chip')} onClick={refresh} disabled={refreshing}>
          <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin motion-reduce:animate-none')} aria-hidden="true" />
          {t('messages.refresh', 'Refresh')}
        </Button>
      </div>

      {loadFailed && (
        <p role="alert" className="rounded-field border border-amber-200 bg-amber-50 px-4 py-3 text-[15px] text-amber-950">
          {t('messages.loadFailed', 'We could not load your messages. Check your connection, then press Refresh.')}
        </p>
      )}

      {/* ── Requests waiting for your answer ── */}
      {waitingCount > 0 && (
        <section aria-labelledby="msg-waiting">
          <SectionTitle id="msg-waiting" count={waitingCount}>{t('messages.requestsTitle', 'Requests waiting for your answer')}</SectionTitle>
          <ul className="space-y-3">
            {received.map((item) => (
              <RequestCard
                key={item.data.id}
                item={item}
                acting={acting === item.data.id}
                confirming={confirmDecline === item.data.id}
                onAccept={() => answer(item, 'accepted')}
                onDecline={() => setConfirmDecline(item.data.id)}
                onConfirmDecline={() => answer(item, 'rejected')}
                onCancelDecline={() => setConfirmDecline(null)}
                onReport={() => setReporting(item)}
              />
            ))}
          </ul>
        </section>
      )}

      {/* ── Conversations ── */}
      {(conversations?.length ?? 0) > 0 && (
        <section aria-labelledby="msg-conversations">
          <SectionTitle id="msg-conversations" count={conversations!.length}>{t('messages.conversationsTitle', 'Conversations')}</SectionTitle>
          <CardShell as="div">
            <ul className="divide-y divide-rule">
              {conversations!.map((c) => (
                <ConversationRow key={c.id} conversation={c} selected={c.id === selectedId} onOpen={() => open(c.id)} />
              ))}
            </ul>
          </CardShell>
        </section>
      )}
      {!conversationsOk && !loadFailed && (
        <p className="rounded-field bg-page px-4 py-3 text-[14px] leading-5 text-meta">
          {t('messages.conversationsSoon', 'Your conversations will appear here.')}
        </p>
      )}

      {/* ── Sent ── */}
      {sent.length > 0 && (
        <section aria-labelledby="msg-sent">
          <SectionTitle id="msg-sent" count={sent.length}>{t('messages.sentTitle', 'Sent')}</SectionTitle>
          <CardShell as="div">
            <ul className="divide-y divide-rule">
              {[...sentWaiting, ...sentDeclined].map((s) => <SentRow key={s.data.id} item={s} />)}
            </ul>
          </CardShell>
        </section>
      )}

      {nothing && !loadFailed && (
        <CardShell>
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
        </CardShell>
      )}
    </div>
  );

  const pane: ReactNode = selected ? (
    <ThreadView conversation={selected} onBack={back} onRead={onRead} />
  ) : selectedMissing ? (
    <CardShell>
      <MemberEmpty
        icon={MessageSquare}
        title={t('messages.notFoundTitle', 'This conversation is not available')}
        body={t('messages.notFoundBody', 'It may still be waiting for an answer, or you are not part of it.')}
        action={<Button variant="outline" className={BTN44_OUTLINE} onClick={() => setSelectedId(null)}>{t('messages.backToList', 'Back to all messages')}</Button>}
      />
    </CardShell>
  ) : (
    <CardShell className="hidden lg:flex">
      <MemberEmpty
        icon={MessageSquare}
        title={t('messages.pickTitle', 'Choose a conversation')}
        body={(conversations?.length ?? 0) > 0
          ? t('messages.pickBody', 'Its messages will show here, with the name of each person who wrote.')
          : t('messages.pickBodyNone', 'When a company accepts your message, or answers yours, the conversation shows here.')}
      />
    </CardShell>
  );

  const threadOpen = !!selectedId;
  // contain: inline-size: the dashboard panel sizes itself to its content's narrowest
  // width (an auto grid column), and a long company name would otherwise widen it past
  // a phone's screen; this block now always takes the panel's width.
  return (
    <div ref={rootRef} className="min-w-0 [contain:inline-size] lg:grid lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)] lg:items-start lg:gap-6">
      <div className={cn('min-w-0', threadOpen && 'hidden lg:block')}>{list}</div>
      <div className={cn('min-w-0', !threadOpen && 'hidden lg:block')}>{pane}</div>
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

/* ------------------------------------------------------------------ pieces */

function SectionTitle({ id, count, children }: { id: string; count: number; children: ReactNode }) {
  return (
    <Eyebrow as="h3" className="mb-3">
      <span id={id}>{children}</span>
      <span className="rounded-pill bg-chip px-2 py-0.5 text-[12px] font-semibold normal-case leading-4 tracking-normal tabular-nums text-navy">{count}</span>
    </Eyebrow>
  );
}

/** A company I am connected with: logo, name, the last message, the time, the unread count. */
function ConversationRow({ conversation: c, selected, onOpen }: { conversation: Conversation; selected: boolean; onOpen: () => void }) {
  const { t } = useTranslation();
  const name = orgName(c.otherOrg) || c.otherPersonName || t('messages.aCompany', 'A company');
  const author = firstNameOf(c.lastAuthorName);
  const unread = c.unread > 0;
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        aria-current={selected ? 'true' : undefined}
        className={cn(
          'flex min-h-[72px] w-full items-center gap-3 px-4 py-3 text-left transition-colors focus:outline-none focus-visible:[box-shadow:inset_0_0_0_2px_#0b2653]',
          selected ? 'bg-foam' : 'hover:bg-page',
        )}
      >
        {c.otherOrg
          ? <LogoTile src={c.otherOrg.logo_url} name={name} type={c.otherOrg.organization_type} size={44} />
          : <span aria-hidden="true" className="grid h-11 w-11 shrink-0 place-items-center rounded-field bg-chip text-[15px] font-semibold text-navy">{name.slice(0, 1).toUpperCase()}</span>}
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className={cn('truncate text-[15px] leading-5 text-navy', unread ? 'font-bold' : 'font-semibold')}>{name}</span>
            <span className={cn('shrink-0 text-[12px] tabular-nums', unread ? 'font-semibold text-navy' : 'text-meta')}>{shortWhen(c.lastMessageAt)}</span>
          </span>
          <span className="mt-0.5 flex items-center justify-between gap-2">
            <span className={cn('line-clamp-1 text-[14px] leading-5', unread ? 'text-ink' : 'text-meta')}>
              {author && <span className="font-medium">{author}: </span>}
              {c.lastPreview}
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

/** A first message to decide: who wrote it (name, job title, company), the message, Accept / Decline. */
function RequestCard({
  item, acting, confirming, onAccept, onDecline, onConfirmDecline, onCancelDecline, onReport,
}: {
  item: ConnectionRequest;
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
  const person = item.person?.name || '';
  const company = orgName(item.org);
  const visual = item.person?.avatar_url ? (
    <img src={item.person.avatar_url} alt="" className="h-12 w-12 shrink-0 rounded-pill object-cover ring-1 ring-rule" />
  ) : item.org ? (
    <LogoTile src={item.org.logo_url} name={company} type={item.org.organization_type} size={48} />
  ) : (
    <span aria-hidden="true" className="grid h-12 w-12 shrink-0 place-items-center rounded-pill bg-chip text-[15px] font-semibold text-navy">{(person || '?').slice(0, 1).toUpperCase()}</span>
  );
  return (
    <li>
      <CardShell className="border-gold/60">
        <div className="flex gap-3 p-4 sm:gap-4 sm:p-5">
          {visual}
          <div className="min-w-0 flex-1">
            <p className="text-[16px] font-semibold leading-6 text-navy [overflow-wrap:anywhere]">
              {person || company || t('messages.aMember', 'A member')}
            </p>
            <p className="text-[14px] leading-5 text-meta [overflow-wrap:anywhere]">
              {item.person?.job_title && <>{item.person.job_title}{person && company ? ' · ' : ''}</>}
              {person && company && (item.org?.slug ? (
                <Link to={`/organizations/${item.org.slug}`} className="rounded-sm text-navy underline decoration-navy/30 underline-offset-[3px] hover:decoration-gold focus:outline-none focus-visible:shadow-focus">
                  {company}
                </Link>
              ) : company)}
            </p>
            <p className="mt-1 text-[13px] leading-[18px] text-meta">{shortWhen(item.data.created_at)}</p>
            {item.data.message && (
              <p className="mt-3 whitespace-pre-wrap border-l-2 border-gold pl-3 text-[15px] leading-6 text-ink [overflow-wrap:anywhere]">{item.data.message}</p>
            )}
            {confirming ? (
              <div className="mt-4 rounded-field bg-page p-3">
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
                <Button size="sm" variant="ghost" className={cn(BTN44, 'gap-1.5 px-3 text-meta hover:bg-chip hover:text-navy')} onClick={onReport} disabled={acting}>
                  <Flag className="h-4 w-4" aria-hidden="true" /> {t('messages.report.button', 'Report')}
                </Button>
              </div>
            )}
          </div>
        </div>
      </CardShell>
    </li>
  );
}

/** A first message my company sent: to whom, by whom, when, and where it stands. */
function SentRow({ item }: { item: ConnectionRequest }) {
  const { t } = useTranslation();
  const company = orgName(item.org) || t('messages.aCompany', 'A company');
  const by = item.person?.name ? t('messages.sentBy', { name: item.person.name, defaultValue: 'Sent by {{name}}' }) : t('messages.sentByYou', 'Sent by you');
  const waiting = item.data.status === 'pending';
  return (
    <li className="flex items-start gap-3 px-4 py-3.5">
      {item.org
        ? <LogoTile src={item.org.logo_url} name={company} type={item.org.organization_type} size={40} />
        : <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-field bg-chip text-navy"><MessageSquare className="h-4 w-4" /></span>}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <p className="min-w-0 text-[15px] font-semibold leading-5 text-navy [overflow-wrap:anywhere]">
            {item.org?.slug ? (
              <Link to={`/organizations/${item.org.slug}`} className="rounded-sm hover:underline focus:outline-none focus-visible:shadow-focus">{company}</Link>
            ) : company}
          </p>
          {waiting
            ? <StatusPill tone="warning" icon={Clock}>{t('messages.waitingPill', 'Waiting for their answer')}</StatusPill>
            : <StatusPill tone="neutral">{t('messages.notAcceptedPill', 'Not accepted')}</StatusPill>}
        </div>
        <p className="mt-0.5 text-[13px] leading-[18px] text-meta">{by} · {shortWhen(item.data.created_at)}</p>
        {item.data.message && <p className="mt-1.5 line-clamp-2 text-[14px] leading-5 text-ink [overflow-wrap:anywhere]">{item.data.message}</p>}
      </div>
    </li>
  );
}
