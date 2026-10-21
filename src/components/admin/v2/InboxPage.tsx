import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, CheckCircle2, Flag, Loader2, Mail, MessageCircle, RefreshCw, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  ADMIN_BTN, ADMIN_BTN_PRIMARY, AdminEmpty, AdminLoading, AdminPageHeader, AdminPanel, AdminSegmented, AdminStatusPill,
} from '@/components/admin/AdminUI';
import { ActionCue, CardButton, CardLink } from '@/components/home/dashboard/DashboardKit';
import { ConversationReportsPanel } from '@/components/messages/ConversationReportsPanel';
import {
  INBOX_EVENT, INBOX_PATHS, announceInboxChange, fetchContactMessages, fetchHealthAlerts, fetchInboxCounts,
  fetchReportedComments, formatAgo, formatWhen, setContactStatus,
  type ContactMessage, type ContactStatus, type HealthAlert, type InboxCounts, type ReportedComment,
} from './inboxApi';

/**
 * Admin > Today > Inbox (admin refonte, 21 Oct 2026): ONE place for what arrives from the
 * site and waits for M3. Each item says what it is, who sent it, when, and ONE clear action:
 *   - Contact form messages: read, reply by e-mail (opens the mail app), mark handled or spam.
 *   - Reported conversations: moved here from B2B requests; closed here (the only place).
 *   - Reported comments: listed here; decided on the article's page, where the comment is
 *     (view everywhere, act in one place). Hidden while the comments feature is not installed.
 *   - Site health alerts: what the monitor finds failing; fixed and followed on Site health.
 * Every pressable thing looks pressable at rest and says where it leads (Victor, 21 Oct).
 */

const SECTION = {
  contact: 'contact-messages',
  conversations: 'reported-conversations',
  comments: 'reported-comments',
  health: 'health-alerts',
} as const;

function jumpTo(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  const heading = el.querySelector<HTMLElement>('h2');
  if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
}

export function InboxPage() {
  const { t } = useTranslation();
  const [counts, setCounts] = useState<InboxCounts | null>(null);

  const loadCounts = useCallback(() => { void fetchInboxCounts().then(setCounts); }, []);
  useEffect(() => {
    loadCounts();
    window.addEventListener(INBOX_EVENT, loadCounts);
    return () => window.removeEventListener(INBOX_EVENT, loadCounts);
  }, [loadCounts]);

  // A link from elsewhere (B2B requests) may ask for a section: #reported-conversations.
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (counts && id) window.setTimeout(() => jumpTo(id), 300);
  }, [counts]);

  if (!counts) return <AdminLoading />;

  const jumps: { id: string; label: string; n: number | null; icon: LucideIcon }[] = [
    { id: SECTION.contact, label: t('adminInbox.jump.contact', 'Contact messages'), n: counts.contact, icon: Mail },
    { id: SECTION.conversations, label: t('adminInbox.jump.conversations', 'Reported conversations'), n: counts.conversations, icon: Flag },
    { id: SECTION.comments, label: t('adminInbox.jump.comments', 'Reported comments'), n: counts.comments, icon: MessageCircle },
    { id: SECTION.health, label: t('adminInbox.jump.health', 'Health alerts'), n: counts.alerts, icon: Activity },
  ];
  const waiting = jumps.reduce((a, j) => a + (j.n ?? 0), 0);

  return (
    <div>
      <AdminPageHeader
        title={t('adminInbox.title', 'Inbox')}
        count={waiting}
        description={t('adminInbox.desc', 'What arrives from the site and waits for the M3 team: contact messages, reports from members and health alerts. Each item says what to do.')}
        actions={(
          <Button type="button" variant="outline" size="sm" className={cn(ADMIN_BTN, 'gap-1.5')} onClick={() => { loadCounts(); announceInboxChange(); }}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" /> {t('adminInbox.refresh', 'Refresh')}
          </Button>
        )}
      />

      {/* What waits, at a glance: each line jumps to its section further down. */}
      <ul className="mb-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
        {jumps.filter((j) => j.n !== null).map((j) => (
          <li key={j.id}>
            <button
              type="button"
              onClick={() => jumpTo(j.id)}
              className="group flex h-full w-full cursor-pointer flex-col items-start gap-3 rounded-card border border-rule bg-white p-4 text-left transition-[box-shadow,border-color] duration-200 hover:border-navy/40 hover:shadow-hover focus:outline-none focus-visible:shadow-focus motion-reduce:transition-none"
            >
              <span className="flex w-full flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-3">
                <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-xl', j.n ? 'bg-gold text-navy' : 'bg-chip text-meta')}>
                  <j.icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[24px] font-semibold leading-7 tabular-nums text-navy">{j.n}</span>
                  <span className="block text-[14px] leading-5 text-meta">{j.label}</span>
                </span>
              </span>
              <ActionCue icon="down" size="sm">
                {j.n ? t('adminInbox.jump.see', 'See them') : t('adminInbox.jump.none', 'Nothing waits')}
              </ActionCue>
            </button>
          </li>
        ))}
      </ul>

      {waiting === 0 && (
        <p className="mb-6 flex items-center gap-2 rounded-card border border-rule bg-foam px-4 py-3 text-[15px] font-semibold text-navy">
          <CheckCircle2 className="h-5 w-5 text-teal" aria-hidden="true" />
          {t('adminInbox.allClear', 'Nothing waits for you. Everything below is already handled.')}
        </p>
      )}

      <div className="space-y-6">
        <section id={SECTION.contact} className="scroll-mt-32"><ContactSection /></section>
        {counts.conversations !== null && (
          <section id={SECTION.conversations} className="scroll-mt-32 [&>section]:mb-0">
            <ConversationReportsPanel onChange={announceInboxChange} />
          </section>
        )}
        {counts.comments !== null && <section id={SECTION.comments} className="scroll-mt-32"><CommentsSection /></section>}
        <section id={SECTION.health} className="scroll-mt-32"><HealthSection /></section>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ contact form */

function ContactSection() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [view, setView] = useState<ContactStatus>('new');
  const [rows, setRows] = useState<ContactMessage[] | null | undefined>(undefined);
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRows(undefined);
    setRows(await fetchContactMessages(view));
  }, [view]);
  useEffect(() => { void load(); }, [load]);

  const act = async (m: ContactMessage, status: ContactStatus) => {
    setActing(m.id);
    const err = await setContactStatus(m.id, status, user?.id);
    setActing(null);
    if (err) {
      toast({ title: t('adminInbox.notSaved', 'Not saved'), description: err, variant: 'destructive' });
      return;
    }
    toast({
      title: status === 'handled' ? t('adminInbox.contact.doneToast', 'Marked as handled')
        : status === 'spam' ? t('adminInbox.contact.spamToast', 'Moved to Spam')
        : t('adminInbox.contact.backToast', 'Back in New'),
    });
    await load();
  };

  return (
    <AdminPanel
      icon={Mail}
      padded={false}
      title={t('adminInbox.contact.title', 'Contact form messages')}
      description={t('adminInbox.contact.desc', 'Sent with the form on the Contact page. Reply by e-mail, then mark the message as handled.')}
      actions={(
        <AdminSegmented<ContactStatus>
          label={t('adminInbox.contact.views', 'Which messages')}
          value={view}
          onChange={setView}
          options={[
            { value: 'new', label: t('adminInbox.contact.new', 'New') },
            { value: 'handled', label: t('adminInbox.contact.handled', 'Handled') },
            { value: 'spam', label: t('adminInbox.contact.spam', 'Spam') },
          ]}
        />
      )}
    >
      {rows === undefined ? (
        <AdminLoading className="h-40" />
      ) : rows === null ? (
        <AdminEmpty icon={Mail} title={t('adminInbox.contact.unreadable', 'The contact messages cannot be read')} body={t('adminInbox.contact.unreadableBody', 'Only the M3 team can read them. Try Refresh, or sign in again.')} />
      ) : rows.length === 0 ? (
        <AdminEmpty
          icon={CheckCircle2}
          title={view === 'new' ? t('adminInbox.contact.noneNew', 'No new message') : t('adminInbox.contact.none', 'No message here')}
          className="py-8"
        />
      ) : (
        <ul className="divide-y divide-rule">
          {rows.map((m) => <ContactItem key={m.id} m={m} busy={acting === m.id} onAct={(s) => void act(m, s)} />)}
        </ul>
      )}
    </AdminPanel>
  );
}

function ContactItem({ m, busy, onAct }: { m: ContactMessage; busy: boolean; onAct: (s: ContactStatus) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  // "Read the whole message" only when the four lines really cut it.
  const text = useRef<HTMLParagraphElement>(null);
  const [long, setLong] = useState(false);
  useLayoutEffect(() => {
    const el = text.current;
    if (!el || open) return;
    const check = () => setLong(el.scrollHeight > el.clientHeight + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, m.message]);
  const mailto = `mailto:${encodeURIComponent(m.email)}?subject=${encodeURIComponent(`Re: ${m.subject}`)}`;
  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="text-[16px] font-semibold leading-6 text-navy [overflow-wrap:anywhere]">
            {m.name}{m.company ? <span className="font-normal text-meta"> · {m.company}</span> : null}
          </p>
          <p className="text-[13px] leading-5 text-meta [overflow-wrap:anywhere]">
            {m.email} · {t('adminInbox.received', 'received')} {formatAgo(m.created_at)} ({formatWhen(m.created_at)})
          </p>
        </div>
        <AdminStatusPill tone="info">{m.subject}</AdminStatusPill>
      </div>
      <p ref={text} className={cn('mt-3 whitespace-pre-wrap border-l-2 border-gold pl-3 text-[15px] leading-6 text-ink [overflow-wrap:anywhere]', !open && 'line-clamp-4')}>
        {m.message}
      </p>
      {(long || open) && (
        <div className="mt-2">
          <CardButton icon="expand" onClick={() => setOpen((o) => !o)}>
            {open ? t('adminInbox.contact.less', 'Show less') : t('adminInbox.contact.more', 'Read the whole message')}
          </CardButton>
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {m.status === 'new' ? (
          <>
            <Button type="button" size="sm" className={cn(ADMIN_BTN_PRIMARY, 'gap-1.5')} disabled={busy} onClick={() => onAct('handled')}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
              {t('adminInbox.contact.markHandled', 'Mark as handled')}
            </Button>
            <CardLink to={mailto} external>{t('adminInbox.contact.reply', 'Reply by e-mail')}</CardLink>
            <Button type="button" variant="outline" size="sm" className={ADMIN_BTN} disabled={busy} onClick={() => onAct('spam')}>
              {t('adminInbox.contact.markSpam', 'It is spam')}
            </Button>
          </>
        ) : (
          <>
            <span className="text-[13px] text-meta">
              {m.status === 'handled' ? t('adminInbox.contact.handledOn', 'Handled') : t('adminInbox.contact.spamOn', 'Marked as spam')}
              {m.handled_at ? ` ${formatAgo(m.handled_at)}` : ''}
            </span>
            <Button type="button" variant="outline" size="sm" className={ADMIN_BTN} disabled={busy} onClick={() => onAct('new')}>
              {t('adminInbox.contact.putBack', 'Put back in New')}
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ reported comments */

function CommentsSection() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<ReportedComment[] | null | undefined>(undefined);
  useEffect(() => { void fetchReportedComments().then(setRows); }, []);
  if (rows === null) return null;
  return (
    <AdminPanel
      icon={MessageCircle}
      padded={false}
      title={t('adminInbox.comments.title', 'Reported comments')}
      description={t('adminInbox.comments.desc', 'Members reported these comments under articles. Decide on the article\'s page: hide the comment or keep it.')}
    >
      {rows === undefined ? (
        <AdminLoading className="h-40" />
      ) : rows.length === 0 ? (
        <AdminEmpty icon={CheckCircle2} title={t('adminInbox.comments.none', 'No reported comment')} className="py-8" />
      ) : (
        <ul className="divide-y divide-rule">
          {rows.map((c) => {
            const first = c.reports?.[0];
            return (
              <li key={c.comment_id} className="px-5 py-4">
                <p className="text-[16px] font-semibold leading-6 text-navy [overflow-wrap:anywhere]">{c.resource_title}</p>
                <p className="text-[13px] leading-5 text-meta [overflow-wrap:anywhere]">
                  {t('adminInbox.comments.by', 'Comment by')} {c.author_name}{c.author_org_name ? ` · ${c.author_org_name}` : ''}
                  {' · '}
                  {t('adminInbox.comments.reports', { count: c.open_reports, defaultValue_one: '{{count}} open report', defaultValue_other: '{{count}} open reports' })}
                  {', '}{t('adminInbox.comments.last', 'last')} {formatAgo(c.last_reported_at)}
                </p>
                <p className="mt-3 line-clamp-3 whitespace-pre-wrap border-l-2 border-gold pl-3 text-[15px] leading-6 text-ink [overflow-wrap:anywhere]">
                  {c.deleted ? t('adminInbox.comments.deleted', '(deleted by its author since)') : c.body}
                </p>
                {first?.reason && (
                  <p className="mt-2 text-[14px] leading-5 text-meta [overflow-wrap:anywhere]">
                    {t('adminInbox.comments.why', 'Why')} ({first.reporter_name}): {first.reason}
                  </p>
                )}
                <div className="mt-3">
                  <CardLink to={INBOX_PATHS.article(c.resource_id)}>{t('adminInbox.comments.decide', 'Decide on the article page')}</CardLink>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </AdminPanel>
  );
}

/* ------------------------------------------------------------------ health alerts */

function HealthSection() {
  const { t } = useTranslation();
  const [data, setData] = useState<Awaited<ReturnType<typeof fetchHealthAlerts>> | undefined>(undefined);
  useEffect(() => { void fetchHealthAlerts().then(setData); }, []);
  return (
    <AdminPanel
      icon={Activity}
      padded={false}
      title={t('adminInbox.health.title', 'Site health alerts')}
      description={t('adminInbox.health.desc', 'What the site monitor finds failing or worth a look. An alert goes away by itself once the problem is fixed.')}
    >
      {data === undefined ? (
        <AdminLoading className="h-40" />
      ) : data === null ? (
        <AdminEmpty icon={Activity} title={t('adminInbox.health.unreadable', 'The alerts cannot be read here')} body={t('adminInbox.health.unreadableBody', 'Try again in a few minutes.')} />
      ) : (
        <>
          {data.alerts.length === 0 ? (
            <AdminEmpty icon={CheckCircle2} title={t('adminInbox.health.none', 'No alert: every check is fine')} className="py-8" />
          ) : (
            <ul className="divide-y divide-rule">
              {data.alerts.map((a) => <AlertItem key={a.check_id} a={a} />)}
            </ul>
          )}
          <Footer>
            <span>{data.lastRun ? `${t('adminInbox.health.lastRun', 'Last check')} ${formatAgo(data.lastRun)}` : t('adminInbox.health.noRun', 'No check recorded yet')}</span>
          </Footer>
        </>
      )}
    </AdminPanel>
  );
}

function AlertItem({ a }: { a: HealthAlert }) {
  const { t } = useTranslation();
  return (
    <li className="flex flex-wrap items-start gap-3 px-5 py-4">
      <AdminStatusPill tone={a.status === 'fail' ? 'danger' : 'warning'}>
        {a.status === 'fail' ? t('adminInbox.health.fail', 'Failing') : t('adminInbox.health.warn', 'Warning')}
      </AdminStatusPill>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-semibold leading-6 text-navy [overflow-wrap:anywhere]">{a.summary}</p>
        <p className="text-[13px] leading-5 text-meta">
          {t('adminInbox.health.since', 'since')} {formatAgo(a.first_seen_at)} · <span className="font-mono text-[12px]">{a.check_id}</span>
        </p>
      </div>
    </li>
  );
}

function Footer({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center justify-between gap-3 border-t border-rule px-5 py-3 text-[13px] text-meta">{children}</div>;
}

export default InboxPage;
