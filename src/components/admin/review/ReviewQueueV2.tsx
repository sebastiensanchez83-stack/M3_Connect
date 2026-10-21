import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  AlertTriangle, Archive, Check, CheckCircle2, Clock, EyeOff, HelpCircle, History, Inbox, Keyboard, ListPlus, RefreshCw,
  ShieldCheck, UserCheck, UserMinus, UserRound, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { ToastAction } from '@/components/ui/toast';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/hooks/use-toast';
import { useRegistrationFlags } from '@/lib/flags';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { REVIEW_QUEUE_EVENT, needsDecision } from '../reviewQueueCount';
import { readSlaDays, toTime, workingDaysSince } from '../AdminReviewQueue';
import {
  ADMIN_BTN, ADMIN_BTN_DANGER, ADMIN_BTN_PRIMARY, AdminEmpty, AdminLoading, AdminPageHeader, AdminSegmented,
} from '../AdminUI';
import { ValidatePersonDialog } from '../ValidatePersonDialog';
import { CompanyChoice, companyPickToOrg, type CompanyPick } from './CompanyChoice';
import {
  QUEUE_TABS, ReviewError, addOrgMemberBack, archiveOrg, closeReport, decideClaim, decideGuestList, decideRegistrationV2,
  decisionMailText, dismissCard, fStr, loadEventKinds, loadGuestIdentity, loadQueueV2, markDuplicateOrg, reviewErrorText,
  revokeTeamJoin, rowKey, useOutboxSender, validatePerson,
  type OrgAction, type PersonAction, type QueueRow, type QueueTab, type RegDecisionResult,
} from './reviewApi';
import { QueueCard, describeRow, hasPart, partsText, type CardAction, type CardLink } from './reviewCards';
import { UndoBar, useDeferredActions } from './useDeferredActions';

/**
 * /admin/review, queue v2 (spec §8.1; registration_flags.review_queue on).
 *
 * Tabs with counts: People & companies · Event registrations · Team joins · Duplicates ·
 * Retro-review · Other (reports, needs, proposals, drafts: queue v1's cards). Each card says
 * who and what, the signals M3 checks, and has ONE main action in gold. Keys: J / K move,
 * A = the card's main action, R = refuse / not accepted, X = select (registrations), U = undo.
 *
 * Where a decision goes (the server logs every one in review_log):
 *   person          admin_validate_person (ValidatePersonDialog, or "Participant only")
 *   claim           admin_decide_claim
 *   join_request,   admin_review_dismiss (seen) / admin_revoke_team_join (remove; "Add back"
 *   team_join       = admin_add_org_member)
 *   duplicates      admin_review_dismiss (not a duplicate) / admin_mark_duplicate_org (hide;
 *                   "Show it again" = the same call with null)
 *   retro           admin_review_dismiss (keep) / admin_validate_person (review again)
 *   registrations   core_v2: the registration function's decide (gl_decide_v2);
 *                   guest_list_v1 (wys26): guest-list decide, the unchanged call of the guest
 *                   list page (force after a yes on capacity), then review_log_add
 *   report          the same staff update as queue v1 (conversation_reports)
 * One-click decisions wait a few seconds with an Undo (useDeferredActions); decisions taken
 * in a window are sent at once.
 */

type SortMode = 'urgent' | 'newest';

interface CapGroup {
  label: string;
  /** A guest-list event (wys26): its approval e-mails the entry pass. */
  v1: boolean;
  held: number;
  capacity: number;
  adding: number;
  /** The registrations not decided yet (those the yes would send). */
  remaining: string[];
  retry: () => Promise<RegDecisionResult>;
}

type DialogState =
  | { mode: 'validate'; row: QueueRow | null; userId: string; action: PersonAction }
  | { mode: 'claimDecline'; row: QueueRow; note: string }
  | { mode: 'regReject'; rows: QueueRow[]; notify: boolean }
  | { mode: 'regInfo'; rows: QueueRow[]; text: string }
  | { mode: 'regApprove'; row: QueueRow; pick: CompanyPick; validate: boolean; lookup: { name: string | null; email: string | null; country: string | null } | null }
  | { mode: 'bulkApprove'; rows: QueueRow[] }
  | { mode: 'capacity'; groups: CapGroup[] }
  | { mode: 'teamRemove'; row: QueueRow; reset: boolean; note: string }
  | { mode: 'orgArchive'; row: QueueRow; note: string };

const TAB_ORDER: QueueTab[] = QUEUE_TABS;

function tabLabel(tab: QueueTab, t: TFunction): string {
  switch (tab) {
    case 'people': return t('adminReview.v2.tab.people', 'People & companies');
    case 'registrations': return t('adminReview.v2.tab.registrations', 'Event registrations');
    case 'team_joins': return t('adminReview.v2.tab.teamJoins', 'Team joins');
    case 'duplicates': return t('adminReview.v2.tab.duplicates', 'Duplicates');
    case 'retro': return t('adminReview.v2.tab.retro', 'Retro-review');
    case 'content': return t('adminReview.v2.tab.content', 'Reports & content');
  }
}

function tabIntro(tab: QueueTab, t: TFunction): string {
  switch (tab) {
    case 'people': return t('adminReview.v2.intro.people', 'New accounts, the companies they declared, and requests to manage a company. M3 decides each one, except requests to join a company, which its owner decides.');
    case 'registrations': return t('adminReview.v2.intro.registrations', 'Requests to attend events that M3 checks, the World Yachting Summit included. Tick several to approve them together.');
    case 'team_joins': return t('adminReview.v2.intro.teamJoins', 'People who joined a validated company through its team. Nothing to do unless something looks wrong.');
    case 'duplicates': return t('adminReview.v2.intro.duplicates', 'Companies or accounts that may be the same. Say they are different, or mark which company is the duplicate: it then leaves sign-up search and company matching (merging comes later).');
    case 'retro': return t('adminReview.v2.intro.retro', 'People validated before M3 reviewed every account. Keep them as they are, or review them again. Each appears once.');
    case 'content': return t('adminReview.v2.intro.content', 'Reported conversations, needs, webinar proposals and article drafts.');
  }
}

function tabEmpty(tab: QueueTab, t: TFunction): { title: string; body: string } {
  switch (tab) {
    case 'people': return { title: t('adminReview.v2.empty.people', 'No one is waiting'), body: t('adminReview.v2.empty.peopleBody', 'New sign-ups and company claims appear here as soon as their e-mail address is confirmed.') };
    case 'registrations': return { title: t('adminReview.v2.empty.registrations', 'No registration to check'), body: t('adminReview.v2.empty.registrationsBody', 'Requests for events that M3 validates appear here.') };
    case 'team_joins': return { title: t('adminReview.v2.empty.teamJoins', 'No new team member'), body: t('adminReview.v2.empty.teamJoinsBody', 'When someone joins a company through its team, you see it here.') };
    case 'duplicates': return { title: t('adminReview.v2.empty.duplicates', 'No possible duplicate'), body: t('adminReview.v2.empty.duplicatesBody', 'Companies or accounts that look alike appear here.') };
    case 'retro': return { title: t('adminReview.v2.empty.retro', 'Retro-review done'), body: t('adminReview.v2.empty.retroBody', 'Everyone validated without a review has been looked at.') };
    case 'content': return { title: t('adminReview.v2.empty.content', 'Nothing to moderate'), body: t('adminReview.v2.empty.contentBody', 'Reported conversations, needs, webinar proposals and article drafts appear here.') };
  }
}

const OVERDUE_KINDS = new Set(['person', 'company', 'claim', 'event_request']);

function isOverdue(row: QueueRow, slaDays: number): boolean {
  if (!OVERDUE_KINDS.has(row.kind)) return false;
  const start = toTime(row.waiting_since);
  return start !== null && workingDaysSince(start) >= slaDays;
}

const urgency = (row: QueueRow, slaDays: number) => (row.kind === 'report' ? 0 : isOverdue(row, slaDays) ? 1 : 2);

/** Dialogs: a near full-screen sheet on a phone, a centred window on a desktop. */
const SHEET = cn(
  'max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-lg overflow-y-auto rounded-card p-4 sm:p-6',
  '[&>button:last-child]:right-2 [&>button:last-child]:top-2 [&>button:last-child]:grid [&>button:last-child]:h-11 [&>button:last-child]:w-11 [&>button:last-child]:place-items-center [&>button:last-child]:rounded-full [&>button:last-child]:hover:bg-chip',
);
const TALL = 'h-11';

export function ReviewQueueV2() {
  const { t } = useTranslation();
  const { user, isAdmin } = useAuth();
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [refreshing, setRefreshing] = useState(false);
  const [slaDays, setSlaDays] = useState(2);
  const [eventKinds, setEventKinds] = useState<Record<string, { kind: string | null; hidden: boolean; engine: string | null }>>({});
  const [sort, setSort] = useState<SortMode>('urgent');
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [focusIndex, setFocusIndex] = useState(0);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  const loadedOnce = useRef(false);
  const cardRefs = useRef<(HTMLLIElement | null)[]>([]);
  const deferred = useDeferredActions();
  const lastWindow = useRef<Exclude<DialogState, { mode: 'validate' }> | null>(null);
  // Decision e-mails leave only while outbox_sender is on: the toasts say where they wait.
  const senderOn = useOutboxSender();
  // provisioning on: a confirmed WYS guest with no account yet gets a second e-mail (their new
  // account) after the QR; someone who already has an account gets the event added, no e-mail.
  const { flags: regFlags } = useRegistrationFlags();
  const accountMailNote = regFlags.provisioning
    ? t('adminReview.v2.wysAccountMail2', 'If they have no Smart Marina Connect account yet, a minute or two later they get a second e-mail to choose its password.')
    : '';

  /* ─── loading ─── */

  const load = useCallback(async () => {
    if (loadedOnce.current) setRefreshing(true);
    const [res, sla] = await Promise.all([
      loadQueueV2().then(r => ({ rows: r, error: null as ReviewError | null }), (e: unknown) => ({ rows: null, error: e instanceof ReviewError ? e : new ReviewError('unknown') })),
      supabase.from('platform_settings').select('value').eq('key', 'review_sla_text').maybeSingle(),
    ]);
    setSlaDays(sla.error ? 2 : readSlaDays((sla.data as { value?: unknown } | null)?.value));
    if (res.error || !res.rows) {
      if (res.error?.code === 'not_installed') setState('missing');
      else if (loadedOnce.current) toast({ title: t('adminReview.toast.reloadFailed', 'The list could not be refreshed'), description: reviewErrorText(res.error, t), variant: 'destructive' });
      else setState('error');
    } else {
      const list = res.rows;
      setRows(list);
      setState('ready');
      // The badge counts what waits for a decision (not the FYI topics), as the sidebar does.
      window.dispatchEvent(new CustomEvent(REVIEW_QUEUE_EVENT, { detail: { count: list.filter(needsDecision).length } }));
      // Which core_v2 events are webinars (their approval creates no account). Until this is
      // known, a core_v2 approval opens the company window (isOnsiteV2 fails safe).
      const ids = [...new Set(list.filter(r => r.kind === 'event_request' && fStr(r.facts, 'engine') === 'core_v2').map(r => fStr(r.facts, 'event_id')).filter((x): x is string => !!x))];
      if (ids.length) loadEventKinds(ids).then(k => setEventKinds(prev => ({ ...prev, ...k })), () => undefined);
      // Selections of rows that left the list are dropped.
      setSelected(sel => {
        const keep = new Set(list.map(r => r.id));
        const next = new Set([...sel].filter(id => keep.has(id)));
        return next.size === sel.size ? sel : next;
      });
    }
    loadedOnce.current = true;
    setRefreshing(false);
  }, [t]);

  const uid = user?.id;
  useEffect(() => { if (uid) void load(); }, [uid, load]);

  /* ─── tabs, filter, order ─── */

  const { hidden: isHidden, waiting: waitingDecisions } = deferred;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const live = useMemo(() => rows.filter(r => !isHidden(rowKey(r))), [rows, isHidden, waitingDecisions]);

  const counts = useMemo(() => {
    const c = Object.fromEntries(TAB_ORDER.map(k => [k, 0])) as Record<QueueTab, number>;
    for (const r of live) c[r.tab] += 1;
    return c;
  }, [live]);

  const visibleTabs = isAdmin ? TAB_ORDER : TAB_ORDER.filter(k => k === 'content');
  const tabParam = params.get('tab') as QueueTab | null;
  const tab: QueueTab = tabParam && visibleTabs.includes(tabParam)
    ? tabParam
    : visibleTabs.find(k => counts[k] > 0) ?? visibleTabs[0];
  const eventFilter = tab === 'registrations' ? params.get('event') ?? 'all' : 'all';

  const setTab = (next: QueueTab) => {
    const p = new URLSearchParams(params);
    p.set('tab', next);
    p.delete('event');
    setParams(p, { replace: true });
    setFocusIndex(0);
  };
  const setEventFilter = (next: string) => {
    const p = new URLSearchParams(params);
    if (next === 'all') p.delete('event'); else p.set('event', next);
    setParams(p, { replace: true });
    setFocusIndex(0);
  };

  const events = useMemo(() => {
    const m = new Map<string, { id: string; title: string; n: number }>();
    for (const r of live) {
      if (r.kind !== 'event_request') continue;
      const id = fStr(r.facts, 'event_id');
      if (!id) continue;
      const e = m.get(id) ?? { id, title: fStr(r.facts, 'event_title') ?? fStr(r.facts, 'event_slug') ?? id, n: 0 };
      e.n += 1;
      m.set(id, e);
    }
    return [...m.values()].sort((a, b) => a.title.localeCompare(b.title));
  }, [live]);

  const tabRows = useMemo(() => {
    let list = live.filter(r => r.tab === tab);
    if (tab === 'registrations' && eventFilter !== 'all') list = list.filter(r => fStr(r.facts, 'event_id') === eventFilter);
    if (sort === 'urgent') return [...list].sort((a, b) => urgency(a, slaDays) - urgency(b, slaDays));
    return [...list].sort((a, b) => (toTime(b.waiting_since) ?? 0) - (toTime(a.waiting_since) ?? 0));
  }, [live, tab, eventFilter, sort, slaDays]);

  // The first topic with items is chosen once, then kept in the address: deciding the last
  // card of a topic shows its empty state instead of jumping to another topic.
  useEffect(() => {
    if (state !== 'ready' || tabParam) return;
    const p = new URLSearchParams(params);
    p.set('tab', tab);
    setParams(p, { replace: true });
  }, [state, tabParam, tab, params, setParams]);

  // On a phone the topics scroll sideways: keep the chosen one in view (sideways only).
  const tablistRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const list = tablistRef.current;
    const active = list?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!list || !active || list.scrollWidth <= list.clientWidth) return;
    const left = active.offsetLeft - list.offsetLeft;
    if (left < list.scrollLeft || left + active.offsetWidth > list.scrollLeft + list.clientWidth) {
      list.scrollLeft = Math.max(0, left - 16);
    }
  }, [tab, state]);

  // Keep the keyboard focus inside the list when it shrinks.
  useEffect(() => {
    if (focusIndex > 0 && focusIndex >= tabRows.length) setFocusIndex(Math.max(0, tabRows.length - 1));
  }, [tabRows.length, focusIndex]);

  /* ─── shared outcome messages ─── */

  const failToast = (e: unknown) => toast({ title: t('adminReview.toast.notDone', 'Not done'), description: reviewErrorText(e, t), variant: 'destructive' });

  const regOutcome = (res: RegDecisionResult, decision: 'approve' | 'reject' | 'waitlist' | 'request_info', count: number, engineV1: boolean) => {
    if (res.changed === 0) {
      toast({ title: t('adminReview.toast.alreadyDecided', 'Already decided'), description: t('adminReview.toast.alreadyDecidedBody', 'Someone else decided this request. The list is now up to date.') });
      return;
    }
    const title = (() => {
      switch (decision) {
        case 'approve': return t('adminReview.v2.done.approved', { count: res.changed, defaultValue_one: 'Approved', defaultValue_other: '{{count}} approved' });
        case 'reject': return t('adminReview.v2.done.rejected', { count: res.changed, defaultValue_one: 'Not accepted', defaultValue_other: '{{count}} not accepted' });
        case 'waitlist': return t('adminReview.v2.done.waitlisted', 'On the waiting list');
        default: return t('adminReview.v2.done.asked', 'Question sent');
      }
    })();
    if (res.failed) {
      toast({
        title,
        description: engineV1
          ? t('adminReview.v2.done.mailFailedV1', 'Some e-mails could not be sent. Send the entry pass again from the guest list.')
          : t('adminReview.v2.done.mailFailedV2', 'Some e-mails could not be sent. Send the link again from the event\'s registrations.'),
        variant: 'destructive',
      });
      return;
    }
    toast({
      title,
      description: res.changed < count
        ? t('adminReview.v2.done.partly', 'The others were already decided by someone else.')
        : decision === 'approve'
          ? (engineV1 ? [t('adminReview.toast.approvedBody', 'The entry pass was e-mailed.'), accountMailNote].filter(Boolean).join(' ') : t('adminReview.v2.done.approvedV2', 'Their confirmation was e-mailed.'))
          : res.sent ? t('adminReview.v2.done.mailed', 'They were e-mailed.') : undefined,
    });
  };

  /* ─── registrations ─── */

  const isV1 = (r: QueueRow) => fStr(r.facts, 'engine') !== 'core_v2';
  /**
   * A core_v2 registration whose approval makes an account (on-site): M3 chooses its company in
   * a window. Fails safe: while the event's kind is not known (not read yet, or the read
   * failed) it counts as on-site; only a known webinar is approved in one click.
   */
  const isOnsiteV2 = (r: QueueRow) => !isV1(r) && eventKinds[fStr(r.facts, 'event_id') ?? '']?.kind !== 'webinar';
  /** A WYS guest who asked for neither part cannot be approved here (the guest list chooses). */
  const canApprove = (r: QueueRow) => !isV1(r) || hasPart(r);

  /** One decision on registrations of ONE event (one engine). */
  const decideRegs = async (
    group: QueueRow[],
    decision: 'approve' | 'reject' | 'waitlist' | 'request_info',
    opts: { force?: boolean; notify?: boolean; infoRequest?: string; orgAction?: OrgAction; validatePerson?: boolean } = {},
  ): Promise<RegDecisionResult> => {
    const first = group[0];
    const ids = group.map(r => r.id);
    if (isV1(first)) {
      const slug = fStr(first.facts, 'event_slug');
      if (!slug) throw new ReviewError('bad_input');
      if (decision !== 'approve' && decision !== 'reject') throw new ReviewError('wrong_engine');
      return decideGuestList(slug, ids, decision, { force: opts.force, notify: opts.notify, glEventId: fStr(first.facts, 'event_id'), actorId: user?.id ?? null });
    }
    const glEventId = fStr(first.facts, 'event_id');
    if (!glEventId) throw new ReviewError('bad_input');
    return decideRegistrationV2(glEventId, ids, decision, {
      force: opts.force, notify: opts.notify, infoRequest: opts.infoRequest, orgAction: opts.orgAction, validatePerson: opts.validatePerson,
    });
  };

  const eventLabel = (r: QueueRow) => fStr(r.facts, 'event_title') ?? fStr(r.facts, 'event_slug') ?? t('adminReview.fact.anEvent', 'an event');

  /** Approve one registration: held a few seconds with Undo; over capacity asks first. */
  const approveOne = (row: QueueRow) => {
    if (isV1(row) && !hasPart(row)) {
      toast({ title: t('adminReview.toast.notDone', 'Not done'), description: reviewErrorText('no_part', t), variant: 'destructive' });
      return;
    }
    if (isOnsiteV2(row)) {
      openRegApprove(row);
      return;
    }
    deferred.schedule(rowKey(row), t('adminReview.v2.undo.approve', 'Approving {{name}} for {{event}}', { name: row.title, event: eventLabel(row) }), async () => {
      try {
        const res = await decideRegs([row], 'approve');
        if (res.capacity) {
          setDialog({ mode: 'capacity', groups: [{ label: eventLabel(row), v1: isV1(row), ...res.capacity, retry: () => decideRegs([row], 'approve', { force: true }) }] });
        } else regOutcome(res, 'approve', 1, isV1(row));
      } catch (e) { failToast(e); }
      await load();
    });
  };

  /** The rows of `group` still to send after a capacity stop. */
  const remainingOf = (group: QueueRow[], remaining: string[]) => {
    const keep = new Set(remaining);
    return group.filter(r => keep.has(r.id));
  };

  const openRegApprove = (row: QueueRow) => {
    setDialogError(null);
    setDialog({ mode: 'regApprove', row, pick: { mode: 'none' }, validate: true, lookup: null });
    void loadGuestIdentity(row.id).then(g => {
      setDialog(d => (d && d.mode === 'regApprove' && d.row.id === row.id
        ? { ...d, lookup: { name: g?.company ?? null, email: g?.email ?? fStr(row.facts, 'email') ?? null, country: g?.country ?? fStr(row.facts, 'country') ?? null } }
        : d));
    });
  };

  const waitlistOne = (row: QueueRow) => {
    deferred.schedule(rowKey(row), t('adminReview.v2.undo.waitlist', 'Putting {{name}} on the waiting list', { name: row.title }), async () => {
      try { regOutcome(await decideRegs([row], 'waitlist'), 'waitlist', 1, false); } catch (e) { failToast(e); }
      await load();
    });
  };

  /** Runs one decision for many rows, one call per event; full events are asked about at the end. */
  const runGrouped = async (list: QueueRow[], decision: 'approve' | 'reject' | 'request_info', opts: { notify?: boolean; infoRequest?: string } = {}) => {
    const groups = new Map<string, QueueRow[]>();
    for (const r of list) {
      const k = `${isV1(r) ? 'v1' : 'v2'}:${fStr(r.facts, 'event_id') ?? fStr(r.facts, 'event_slug')}`;
      groups.set(k, [...(groups.get(k) ?? []), r]);
    }
    let changed = 0;
    let failed = 0;
    let sent = 0;
    const full: CapGroup[] = [];
    const errors: string[] = [];
    for (const g of groups.values()) {
      const notify = opts.notify ?? (decision === 'reject' ? !isV1(g[0]) : undefined);
      try {
        const res = await decideRegs(g, decision, { notify, infoRequest: opts.infoRequest });
        if (res.capacity) {
          const rest = remainingOf(g, res.capacity.remaining);
          full.push({ label: eventLabel(g[0]), v1: isV1(g[0]), ...res.capacity, retry: () => decideRegs(rest, decision, { force: true, notify }) });
        }
        if (res.stopped) errors.push(`${eventLabel(g[0])}: ${t('adminReview.v2.done.stopped', 'stopped part-way ({{count}} done).', { count: res.changed })} ${reviewErrorText(res.stopped, t)}`);
        changed += res.changed;
        failed += res.failed;
        sent += res.sent;
      } catch (e) {
        errors.push(`${eventLabel(g[0])}: ${reviewErrorText(e, t)}`);
      }
    }
    // Only the rows actually sent count as "expected" (those waiting for the capacity answer do not).
    const waitingForCapacity = full.reduce((n, g) => n + g.remaining.length, 0);
    if (changed || (!full.length && !errors.length)) regOutcome({ changed, failed, sent }, decision, list.length - waitingForCapacity, list.every(isV1));
    if (errors.length) toast({ title: t('adminReview.toast.notDone', 'Not done'), description: errors.join(' '), variant: 'destructive' });
    if (full.length) setDialog({ mode: 'capacity', groups: full });
    else setDialog(null);
  };

  /* ─── people, claims, teams, duplicates, retro, reports ─── */

  const openValidate = (row: QueueRow | null, userId: string, action: PersonAction) => setDialog({ mode: 'validate', row, userId, action });

  const participantOne = (row: QueueRow) => {
    deferred.schedule(rowKey(row), t('adminReview.v2.undo.participant', 'Validating {{name}} as a participant', { name: row.title }), async () => {
      try {
        await validatePerson(row.id, { action: 'participant', notify: true });
        toast({ title: t('adminValidate.done.participantTitle', '{{name}} is validated as a participant', { name: row.title }), description: decisionMailText(t, senderOn) });
      } catch (e) { failToast(e); }
      await load();
    });
  };

  const claimApprove = (row: QueueRow) => {
    const org = fStr(row.facts, 'org_name') ?? '';
    deferred.schedule(rowKey(row), t('adminReview.v2.undo.claim', 'Making {{name}} the owner of {{org}}', { name: row.title, org }), async () => {
      try {
        await decideClaim(fStr(row.facts, 'invitation_id') ?? row.id, true);
        toast({ title: t('adminReview.v2.done.claimApproved', '{{name}} now manages {{org}}', { name: row.title, org }), description: decisionMailText(t, senderOn) });
      } catch (e) { failToast(e); }
      await load();
    });
  };

  const markSeen = (row: QueueRow) => {
    deferred.schedule(rowKey(row), t('adminReview.v2.undo.seen', 'Marking {{name}} as seen', { name: row.title }), async () => {
      try { await dismissCard('team_join', row.id); } catch (e) { failToast(e); }
      await load();
    });
  };

  const notDuplicate = (row: QueueRow) => {
    const a = fStr(row.facts, 'a_id');
    const b = fStr(row.facts, 'b_id');
    if (!a || !b) return;
    deferred.schedule(rowKey(row), t('adminReview.v2.undo.notDuplicate', 'Marking them as different'), async () => {
      try { await dismissCard(row.kind === 'duplicate_org' ? 'duplicate_org' : 'duplicate_person', a, b); } catch (e) { failToast(e); }
      await load();
    });
  };

  const hideDuplicate = (row: QueueRow, hide: 'a' | 'b') => {
    const keep = hide === 'a' ? 'b' : 'a';
    const hideId = fStr(row.facts, `${hide}_id`);
    const keepId = fStr(row.facts, `${keep}_id`);
    const hideName = fStr(row.facts, `${hide}_name`) ?? '?';
    const keepName = fStr(row.facts, `${keep}_name`) ?? '?';
    if (!hideId || !keepId) return;
    deferred.schedule(rowKey(row), t('adminReview.v2.undo.markDuplicate', 'Marking {{hide}} as a duplicate of {{keep}}', { hide: hideName, keep: keepName }), async () => {
      try {
        await markDuplicateOrg(hideId, keepId);
        // The public directories do not filter duplicates yet (contract §11.6): say what it does today.
        toast({
          title: t('adminReview.v2.done.markedDuplicate', '{{hide}} is marked as a duplicate of {{keep}}', { hide: hideName, keep: keepName }),
          description: t('adminReview.v2.done.markedDuplicateBody', 'It no longer appears in sign-up search or company matching, and nobody can be linked to it. The public directory still lists it until the directory update; its people and links stay as they are.'),
          action: (
            <ToastAction altText={t('adminReview.v2.done.unmark', 'Undo: not a duplicate')} onClick={() => {
              markDuplicateOrg(hideId, null).then(() => { toast({ title: t('adminReview.v2.done.unmarked', '{{hide}} is no longer marked as a duplicate', { hide: hideName }) }); void load(); }, failToast);
            }}>
              {t('adminReview.v2.done.undo', 'Undo')}
            </ToastAction>
          ),
        });
      } catch (e) { failToast(e); }
      await load();
    });
  };

  const retroKeep = (row: QueueRow) => {
    deferred.schedule(rowKey(row), t('adminReview.v2.undo.keep', 'Keeping {{name}} as validated', { name: row.title }), async () => {
      try { await dismissCard('retro', row.id); } catch (e) { failToast(e); }
      await load();
    });
  };

  const reportClose = (row: QueueRow) => {
    deferred.schedule(rowKey(row), t('adminReview.v2.undo.closeReport', 'Closing the report about {{name}}', { name: row.title }), async () => {
      try {
        const done = await closeReport(row.id);
        toast(done
          ? { title: t('adminReview.toast.closed', 'Report closed'), description: t('adminReview.toast.closedBody', 'Nobody is told. An administrator can reopen it under B2B requests in the menu.') }
          : { title: t('adminReview.toast.alreadyClosed', 'Already closed'), description: t('adminReview.toast.alreadyClosedBody', 'Someone else closed this report. The list is now up to date.') });
      } catch (e) { failToast(e); }
      await load();
    });
  };

  /* ─── each card's actions ─── */

  const canOpenContent = (r: QueueRow) => isAdmin || r.kind === 'webinar' || r.kind === 'resource_draft';

  const cardActions = (row: QueueRow): { actions: CardAction[]; links: CardLink[]; primary?: CardAction; refuse?: CardAction } => {
    const f = row.facts;
    const actions: CardAction[] = [];
    const links: CardLink[] = [];
    let primary: CardAction | undefined;
    let refuse: CardAction | undefined;
    const add = (a: CardAction, role?: 'primary' | 'refuse') => {
      actions.push(a);
      if (role === 'primary') primary = a;
      if (role === 'refuse') refuse = a;
    };
    const userLink = (id?: string, label?: string): CardLink | null => (id ? { to: `/admin/users/${id}`, label: label ?? t('adminReview.v2.open.profile', 'Open the profile') } : null);
    const orgLink = (id?: string, label?: string): CardLink | null => (id ? { to: `/admin/organizations/${id}`, label: label ?? t('adminReview.open.company', 'Open the company') } : null);
    const push = (l: CardLink | null) => { if (l) links.push(l); };

    switch (row.kind) {
      case 'person': {
        add({ key: 'validate', label: t('adminReview.v2.act.validate', 'Validate…'), icon: UserCheck, tone: 'primary', run: () => openValidate(row, row.id, 'validate') }, 'primary');
        add({ key: 'participant', label: t('adminReview.v2.act.participant', 'Participant only'), icon: UserRound, tone: 'outline', run: () => participantOne(row) });
        add({ key: 'ask', label: t('adminReview.v2.act.ask', 'Ask for a detail'), icon: HelpCircle, tone: 'outline', run: () => openValidate(row, row.id, 'ask') });
        add({ key: 'reject', label: t('adminReview.v2.act.reject', 'Not accepted…'), icon: X, tone: 'danger', run: () => openValidate(row, row.id, 'reject') }, 'refuse');
        push(userLink(row.id));
        break;
      }
      case 'company':
        // A stray company (often an unfinished draft of the old sign-up): open it to type and
        // validate it, or archive it (spec §12).
        add({
          key: 'archive', label: t('adminReview.v2.act.archive', 'Archive…'), icon: Archive, tone: 'outline',
          run: () => { setDialogError(null); setDialog({ mode: 'orgArchive', row, note: '' }); },
          ariaLabel: t('adminReview.v2.act.archiveAria', 'Archive {{name}}', { name: row.title }),
        });
        push({ to: row.url, label: t('adminReview.open.company', 'Open the company') });
        break;
      case 'claim': {
        const hasOwner = f.org_has_owner === true;
        add({
          key: 'approve', label: t('adminReview.v2.act.approveClaim', 'Approve: they manage it'), icon: Check, tone: 'primary',
          run: () => claimApprove(row), disabled: hasOwner || f.org_status !== 'verified',
          hint: hasOwner ? t('adminReview.v2.hint.claimOwnerNA', 'The company has an owner now: mark the claim as not accepted.') : f.org_status !== 'verified' ? t('adminReview.v2.hint.claimPending', 'Approve the company first, then the claim.') : undefined,
        }, 'primary');
        add({ key: 'decline', label: t('adminReview.v2.act.reject', 'Not accepted…'), icon: X, tone: 'danger', run: () => { setDialogError(null); setDialog({ mode: 'claimDecline', row, note: '' }); } }, 'refuse');
        push(orgLink(fStr(f, 'organization_id')));
        push(userLink(fStr(f, 'user_id')));
        break;
      }
      case 'join_request':
        add({ key: 'seen', label: t('adminReview.v2.act.seen', 'Looks right'), icon: Check, tone: 'primary', run: () => markSeen(row) }, 'primary');
        push(orgLink(fStr(f, 'organization_id')));
        push(userLink(fStr(f, 'user_id')));
        break;
      case 'team_join':
        add({ key: 'seen', label: t('adminReview.v2.act.seen', 'Looks right'), icon: Check, tone: 'primary', run: () => markSeen(row) }, 'primary');
        add({
          key: 'remove', label: t('adminReview.v2.act.remove', 'Remove from the company…'), icon: UserMinus, tone: 'danger',
          run: () => { setDialogError(null); setDialog({ mode: 'teamRemove', row, reset: false, note: '' }); },
          disabled: f.role === 'owner',
        }, 'refuse');
        push(orgLink(fStr(f, 'organization_id')));
        push(userLink(fStr(f, 'user_id')));
        break;
      case 'duplicate_org': {
        add({ key: 'different', label: t('adminReview.v2.act.different', 'Not the same company'), icon: Check, tone: 'primary', run: () => notDuplicate(row) }, 'primary');
        for (const side of ['b', 'a'] as const) {
          const other = side === 'a' ? 'b' : 'a';
          const sm26 = f[`${side}_sm26`] === true;
          add({
            key: `hide-${side}`,
            label: t('adminReview.v2.act.markDuplicate', '{{name}} is the duplicate', { name: fStr(f, `${side}_name`) ?? '?' }),
            icon: EyeOff,
            tone: 'outline',
            run: () => hideDuplicate(row, side),
            disabled: sm26,
            ariaLabel: t('adminReview.v2.act.markDuplicateAria', 'Mark {{name}} as a duplicate of {{keep}}', { name: fStr(f, `${side}_name`) ?? '?', keep: fStr(f, `${other}_name`) ?? '?' }),
          });
        }
        push(orgLink(fStr(f, 'a_id'), t('adminReview.v2.open.named', 'Open {{name}}', { name: fStr(f, 'a_name') ?? '?' })));
        push(orgLink(fStr(f, 'b_id'), t('adminReview.v2.open.named', 'Open {{name}}', { name: fStr(f, 'b_name') ?? '?' })));
        break;
      }
      case 'duplicate_person':
        add({ key: 'different', label: t('adminReview.v2.act.differentPeople', 'Not the same person'), icon: Check, tone: 'primary', run: () => notDuplicate(row) }, 'primary');
        push(userLink(fStr(f, 'a_id'), t('adminReview.v2.open.named', 'Open {{name}}', { name: fStr(f, 'a_email') ?? '?' })));
        push(userLink(fStr(f, 'b_id'), t('adminReview.v2.open.named', 'Open {{name}}', { name: fStr(f, 'b_email') ?? '?' })));
        break;
      case 'retro':
        add({ key: 'keep', label: t('adminReview.v2.act.keep', 'Keep as is'), icon: ShieldCheck, tone: 'primary', run: () => retroKeep(row) }, 'primary');
        add({ key: 'review', label: t('adminReview.v2.act.reviewAgain', 'Review again…'), icon: History, tone: 'outline', run: () => openValidate(row, row.id, 'validate') });
        push(userLink(row.id));
        break;
      case 'event_request': {
        const v1 = isV1(row);
        const noPart = v1 && !hasPart(row);
        add({
          key: 'approve',
          label: isOnsiteV2(row) ? t('adminReview.v2.act.approveDialog', 'Approve…') : t('adminReview.approve.button', 'Approve'),
          icon: Check, tone: 'primary', run: () => approveOne(row), disabled: noPart,
          hint: noPart ? t('adminReview.approve.needPart', 'Choose conference or gala dinner in the guest list first.') : undefined,
          ariaLabel: t('adminReview.approve.aria', 'Approve {{name}}', { name: row.title }),
        }, 'primary');
        if (!v1) {
          add({ key: 'waitlist', label: t('adminReview.v2.act.waitlist', 'Waiting list'), icon: ListPlus, tone: 'outline', run: () => waitlistOne(row) });
          add({ key: 'info', label: t('adminReview.v2.act.ask', 'Ask for a detail'), icon: HelpCircle, tone: 'outline', run: () => { setDialogError(null); setDialog({ mode: 'regInfo', rows: [row], text: '' }); } });
        }
        add({
          key: 'reject', label: t('adminReview.v2.act.reject', 'Not accepted…'), icon: X, tone: 'danger',
          run: () => { setDialogError(null); setDialog({ mode: 'regReject', rows: [row], notify: !v1 }); },
          ariaLabel: t('adminReview.v2.regReject.aria', 'Mark the request from {{name}} as not accepted', { name: row.title }),
        }, 'refuse');
        links.push({ to: row.url, label: v1 ? t('adminReview.open.eventRequest', 'Open the guest list') : t('adminReview.open.event', 'Open the event') });
        break;
      }
      case 'report':
        if (row.facts.unreadable !== true) add({ key: 'close', label: t('adminReview.close.button', 'Close the report'), icon: Check, tone: 'primary', run: () => reportClose(row) }, 'primary');
        if (isAdmin) links.push({ to: row.url, label: t('adminReview.open.report', 'See all reports') });
        break;
      default:
        if (canOpenContent(row)) links.push({ to: row.url, label: t('adminReview.v2.open.it', 'Open it') });
    }
    return { actions, links, primary, refuse };
  };

  /* ─── keyboard: J / K / A / R / X / U ─── */

  const keyState = useRef({ tabRows, focusIndex, dialog, cardActions, tab, selected, canApprove });
  keyState.current = { tabRows, focusIndex, dialog, cardActions, tab, selected, canApprove };

  const moveFocus = (to: number) => {
    const n = keyState.current.tabRows.length;
    if (!n) return;
    const i = Math.max(0, Math.min(n - 1, to));
    setFocusIndex(i);
    const el = cardRefs.current[i];
    if (el) {
      el.focus({ preventScroll: true });
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  };

  const toggleSelect = (id: string, on: boolean) => setSelected(s => {
    const n = new Set(s);
    if (on) n.add(id); else n.delete(id);
    return n;
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = keyState.current;
      if (s.dialog || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="combobox"], [role="listbox"], [role="dialog"], [role="menu"]')) return;
      const key = e.key.toLowerCase();
      const row = s.tabRows[s.focusIndex];
      if (key === 'j') { e.preventDefault(); moveFocus(s.focusIndex + 1); }
      else if (key === 'k') { e.preventDefault(); moveFocus(s.focusIndex - 1); }
      else if (key === 'u') { if (deferred.undoLast()) e.preventDefault(); }
      else if (row && key === 'a') {
        const p = s.cardActions(row).primary;
        if (p && !p.disabled) { e.preventDefault(); p.run(); }
      } else if (row && key === 'r') {
        const r = s.cardActions(row).refuse;
        if (r && !r.disabled) { e.preventDefault(); r.run(); }
      } else if (row && key === 'x' && s.tab === 'registrations' && s.canApprove(row)) {
        // Same rule as the card's tick box: a WYS guest with no part cannot be ticked.
        e.preventDefault();
        toggleSelect(row.id, !s.selected.has(row.id));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deferred.undoLast]);

  /* ─── render ─── */

  if (state === 'loading') return <AdminLoading />;

  const refreshButton = (
    <Button variant="outline" size="sm" className={cn(ADMIN_BTN, TALL)} onClick={() => load()} disabled={refreshing}>
      <RefreshCw className={cn('mr-2 h-4 w-4', refreshing && 'animate-spin motion-reduce:animate-none')} aria-hidden="true" />
      {t('adminUi.refresh', 'Refresh')}
    </Button>
  );

  const header = (
    <AdminPageHeader
      title={t('adminReview.title', 'To validate')}
      count={state === 'ready' ? live.filter(needsDecision).length : undefined}
      description={t('adminReview.v2.description', 'Everything waiting for a decision from the M3 team, by topic. The gold button on a card is the usual decision.')}
      meta={
        isAdmin ? (
          <span className="hidden items-center gap-1.5 md:inline-flex">
            <Keyboard className="h-4 w-4" aria-hidden="true" />
            {t('adminReview.v2.keysNA', 'Keys: J and K to move, A for the gold action, R for not accepted, X to tick, U to undo.')}
          </span>
        ) : <span>{t('adminReview.moderatorNote', 'As a moderator, you see reported conversations, webinar proposals and article drafts. People, companies and event requests are reviewed by the administrators.')}</span>
      }
      actions={refreshButton}
    />
  );

  if (state === 'missing' || state === 'error') {
    return (
      <div>
        {header}
        <div className="rounded-card border border-rule bg-white">
          {state === 'missing' ? (
            <AdminEmpty icon={Inbox} title={t('adminReview.missing.title', 'The review list is not available yet')} body={t('adminReview.v2.missingBody', 'The new review list needs a database update that is not live yet. Turn off "Review queue v2" in Platform settings to use the previous list meanwhile.')} />
          ) : (
            <AdminEmpty
              icon={AlertTriangle}
              title={t('adminReview.error.title', 'The list could not be loaded')}
              body={t('adminReview.error.body', 'Check your connection, then try again.')}
              action={<Button variant="outline" size="sm" className={cn(ADMIN_BTN, TALL)} onClick={() => load()}>{t('adminReview.error.retry', 'Try again')}</Button>}
            />
          )}
        </div>
      </div>
    );
  }

  // The window keeps its content while it closes (no empty box during the fade-out).
  const windowShown = dialog && dialog.mode !== 'validate' ? dialog : null;
  if (windowShown) lastWindow.current = windowShown;
  const shown = windowShown ?? lastWindow.current;

  const regSelectable = tab === 'registrations';
  // Never a row that cannot be approved, however it was ticked (second guard after the tick box and X).
  const selectedRows = regSelectable ? tabRows.filter(r => selected.has(r.id) && canApprove(r)) : [];
  const selectableRows = tabRows.filter(canApprove);
  const allSelected = regSelectable && selectableRows.length > 0 && selectableRows.every(r => selected.has(r.id));

  return (
    // Room under the last card for the Undo bars (about 76 px each), so none hides a button.
    <div className="pb-28" style={deferred.waiting.length ? { paddingBottom: `${112 + deferred.waiting.length * 76}px` } : undefined}>
      {header}

      {/* Tabs: one line that scrolls sideways on a phone. */}
      <div
        ref={tablistRef}
        role="tablist"
        aria-label={t('adminReview.v2.tabsLabel', 'Topics')}
        className="-mx-4 mb-4 flex min-w-0 flex-nowrap gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0"
      >
        {visibleTabs.map(k => {
          const active = k === tab;
          return (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(k)}
              className={cn(
                'inline-flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-pill border px-3.5 text-[13px] font-semibold transition-colors focus:outline-none focus-visible:shadow-focus',
                active ? 'border-navy bg-navy text-white' : 'border-rule bg-white text-navy hover:border-navy/30 hover:bg-chip',
              )}
            >
              {tabLabel(k, t)}
              <span className={cn('rounded-pill px-1.5 text-[11px] font-bold leading-5 tabular-nums', active ? 'bg-white/20 text-white' : counts[k] ? 'bg-gold/40 text-navy' : 'bg-chip text-meta')}>
                {counts[k]}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <p className="max-w-2xl text-[14px] leading-5 text-meta">{tabIntro(tab, t)}</p>
        <div className="flex flex-wrap items-center gap-2">
          {tab === 'registrations' && (events.length > 1 || eventFilter !== 'all') && (
            <Select value={eventFilter} onValueChange={setEventFilter}>
              <SelectTrigger className="h-11 w-full rounded-pill bg-white px-4 sm:w-64" aria-label={t('adminReview.v2.eventFilter', 'Event')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('adminReview.v2.allEvents', 'All events')}</SelectItem>
                {events.map(e => <SelectItem key={e.id} value={e.id}>{`${e.title} (${e.n})`}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          {tabRows.length > 1 && (
            <AdminSegmented
              label={t('adminReview.sortLabel', 'Order')}
              value={sort}
              onChange={setSort}
              className="shrink-0 whitespace-nowrap [&>button]:h-9"
              options={[
                { value: 'urgent', label: t('adminReview.sort.urgent', 'Most urgent first') },
                { value: 'newest', label: t('adminReview.sort.newest', 'Newest first') },
              ]}
            />
          )}
        </div>
      </div>

      {regSelectable && tabRows.length > 0 && (
        <div className="sticky top-28 z-20 -mx-4 mb-3 flex flex-wrap items-center gap-2 border-y border-rule bg-page/95 px-4 py-2 backdrop-blur sm:mx-0 sm:rounded-card sm:border md:top-16">
          <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-[14px] font-semibold text-navy">
            <Checkbox
              checked={allSelected}
              onCheckedChange={v => setSelected(v === true ? new Set(selectableRows.map(r => r.id)) : new Set())}
            />
            {t('adminReview.v2.selectAll', 'Select all')}
          </label>
          <span className="text-[13px] text-meta">
            {t('adminReview.v2.selectedCount', { count: selectedRows.length, defaultValue_one: '{{count}} selected', defaultValue_other: '{{count}} selected' })}
          </span>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button
              size="sm"
              className={cn(ADMIN_BTN_PRIMARY, TALL)}
              disabled={!selectedRows.length || busy}
              onClick={() => { setDialogError(null); setDialog({ mode: 'bulkApprove', rows: selectedRows }); }}
            >
              <Check className="mr-1.5 h-4 w-4" aria-hidden="true" />
              {t('adminReview.v2.bulkApprove', { count: selectedRows.length, defaultValue_one: 'Approve {{count}}', defaultValue_other: 'Approve {{count}}' })}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className={cn(ADMIN_BTN_DANGER, TALL)}
              disabled={!selectedRows.length || busy}
              onClick={() => { setDialogError(null); setDialog({ mode: 'regReject', rows: selectedRows, notify: !selectedRows.every(isV1) }); }}
            >
              <X className="mr-1.5 h-4 w-4" aria-hidden="true" />
              {t('adminReview.v2.bulkReject', 'Not accepted…')}
            </Button>
          </div>
        </div>
      )}

      {tabRows.length === 0 ? (
        <div className="rounded-card border border-rule bg-white">
          <AdminEmpty icon={CheckCircle2} title={tabEmpty(tab, t).title} body={tabEmpty(tab, t).body} />
        </div>
      ) : (
        <ul className="space-y-3" aria-label={tabLabel(tab, t)}>
          {tabRows.map((row, i) => {
            const { actions, links } = cardActions(row);
            const model = describeRow(row, t, canOpenContent(row));
            const selectable = regSelectable && canApprove(row);
            return (
              <QueueCard
                key={rowKey(row)}
                ref={el => { cardRefs.current[i] = el; }}
                row={row}
                model={model}
                actions={actions}
                links={links}
                focused={i === focusIndex}
                overdue={isOverdue(row, slaDays)}
                slaDays={slaDays}
                selectable={selectable}
                selected={selected.has(row.id)}
                onSelect={on => toggleSelect(row.id, on)}
                onFocusCard={() => setFocusIndex(i)}
                busy={busy}
                footer={row.kind === 'event_request' && isV1(row) && hasPart(row)
                  ? <p className="mt-2 text-[13px] leading-5 text-meta">{[t('adminReview.v2.wysPass', 'Approving e-mails the entry pass for {{parts}} at once.', { parts: partsText(row) }), accountMailNote].filter(Boolean).join(' ')}</p>
                  : undefined}
              />
            );
          })}
        </ul>
      )}

      <UndoBar waiting={deferred.waiting} onUndo={deferred.undo} onSendNow={deferred.sendNow} />

      {/* ─── windows ─── */}

      {dialog?.mode === 'validate' && (
        <ValidatePersonDialog
          open
          onOpenChange={o => { if (!o) setDialog(null); }}
          userId={dialog.userId}
          initialAction={dialog.action}
          signals={dialog.row?.signals}
          loginEmail={dialog.row ? fStr(dialog.row.facts, 'email') ?? null : null}
          onDone={() => { void load(); }}
        />
      )}

      <Dialog open={!!windowShown} onOpenChange={o => { if (!o && !busy) setDialog(null); }}>
        <DialogContent className={SHEET}>
          {shown?.mode === 'claimDecline' && (
            <WindowBody
              title={t('adminReview.v2.claimDecline.titleNA', 'Mark the claim of {{name}} as not accepted?', { name: shown.row.title })}
              description={t('adminReview.v2.claimDecline.bodyNA', '{{name}} will not manage {{org}}. Their account stays as it is (decide on it separately), and they are e-mailed. Add a note if it helps them.', { name: shown.row.title, org: fStr(shown.row.facts, 'org_name') ?? '' })}
              error={dialogError}
              busy={busy}
              onCancel={() => setDialog(null)}
              confirm={{ label: t('adminReview.v2.markNotAccepted', 'Mark as not accepted'), danger: true, run: async () => {
                setBusy(true);
                try {
                  await decideClaim(fStr(shown.row.facts, 'invitation_id') ?? shown.row.id, false, shown.note);
                  toast({ title: t('adminReview.v2.done.claimNotAccepted', 'Claim not accepted'), description: decisionMailText(t, senderOn) });
                  setDialog(null);
                  void load();
                } catch (e) { setDialogError(reviewErrorText(e, t)); }
                setBusy(false);
              } }}
            >
              <Textarea
                value={shown.note}
                onChange={e => setDialog(d => (d && d.mode === 'claimDecline' ? { ...d, note: e.target.value } : d))}
                rows={3}
                maxLength={2000}
                placeholder={t('adminReview.v2.claimDecline.placeholder', 'Optional: for example, "The marina already has a manager on the platform. Ask them to invite you."')}
                aria-label={t('adminReview.v2.claimDecline.note', 'Note for them (optional)')}
              />
            </WindowBody>
          )}

          {shown?.mode === 'regReject' && (
            <WindowBody
              title={shown.rows.length === 1
                ? t('adminReview.v2.regReject.title1', 'Mark the request from {{name}} as not accepted?', { name: shown.rows[0].title })
                : t('adminReview.v2.regReject.titleNA', 'Mark {{count}} requests as not accepted?', { count: shown.rows.length })}
              description={t('adminReview.v2.regReject.body', 'The request is marked as not accepted. They are not told unless you tick the box below.')}
              error={dialogError}
              busy={busy}
              onCancel={() => setDialog(null)}
              confirm={{ label: t('adminReview.v2.markNotAccepted', 'Mark as not accepted'), danger: true, run: async () => {
                setBusy(true);
                setDialogError(null);
                try { await runGrouped(shown.rows, 'reject', { notify: shown.notify }); setSelected(new Set()); } catch (e) { setDialogError(reviewErrorText(e, t)); }
                setBusy(false);
                void load();
              } }}
            >
              <label htmlFor="v2-refuse-notify" className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-rule bg-white px-3 py-2.5 text-[14px] leading-5 text-navy">
                <Checkbox id="v2-refuse-notify" checked={shown.notify} onCheckedChange={v => setDialog(d => (d && d.mode === 'regReject' ? { ...d, notify: v === true } : d))} />
                <span>{t('adminReview.v2.regReject.notify', 'Send them a polite e-mail saying the request was not accepted')}</span>
              </label>
            </WindowBody>
          )}

          {shown?.mode === 'regInfo' && (
            <WindowBody
              title={t('adminReview.v2.regInfo.title', 'Ask {{name}} for a detail', { name: shown.rows[0]?.title ?? '' })}
              description={t('adminReview.v2.regInfo.body', 'They get your question by e-mail and answer on their registration page. The request comes back here when they answer.')}
              error={dialogError}
              busy={busy}
              onCancel={() => setDialog(null)}
              confirm={{ label: t('adminValidate.confirm.ask', 'Send the question'), run: async () => {
                if (!shown.text.trim()) { setDialogError(t('adminEvents.regs.infoNeeded', 'Write what you need to know.')); return; }
                setBusy(true);
                setDialogError(null);
                try { await runGrouped(shown.rows, 'request_info', { infoRequest: shown.text }); } catch (e) { setDialogError(reviewErrorText(e, t)); }
                setBusy(false);
                void load();
              } }}
            >
              <Textarea
                value={shown.text}
                onChange={e => setDialog(d => (d && d.mode === 'regInfo' ? { ...d, text: e.target.value } : d))}
                rows={3}
                maxLength={2000}
                aria-label={t('adminReview.v2.regInfo.label', 'Your question')}
              />
            </WindowBody>
          )}

          {shown?.mode === 'regApprove' && (
            <WindowBody
              title={t('adminReview.approve.title', 'Approve {{name}}?', { name: shown.row.title })}
              description={t('adminReview.v2.regApprove.body', 'Their confirmation and entry pass are e-mailed. A Smart Marina Connect account is then made for them (or their account is linked), and you choose its company here.')}
              error={dialogError}
              busy={busy}
              onCancel={() => setDialog(null)}
              confirm={{ label: t('adminReview.v2.regApprove.confirm', 'Approve and e-mail the pass'), run: async () => {
                const r = companyPickToOrg(shown.pick, []);
                if (!r.ok) { setDialogError(reviewErrorText(r.code, t)); return; }
                setBusy(true);
                setDialogError(null);
                const row = shown.row;
                const orgAction = r.org;
                const validate = shown.validate;
                try {
                  const res = await decideRegs([row], 'approve', { orgAction, validatePerson: validate });
                  if (res.capacity) {
                    setDialog({ mode: 'capacity', groups: [{ label: eventLabel(row), v1: false, ...res.capacity, retry: () => decideRegs([row], 'approve', { force: true, orgAction, validatePerson: validate }) }] });
                  } else {
                    regOutcome(res, 'approve', 1, false);
                    setDialog(null);
                  }
                } catch (e) { setDialogError(reviewErrorText(e, t)); }
                setBusy(false);
                void load();
              } }}
            >
              <div className="space-y-3">
                {!eventKinds[fStr(shown.row.facts, 'event_id') ?? ''] && (
                  <p className="text-[13px] leading-5 text-meta">{t('adminReview.v2.regApprove.kindUnknown', 'The type of this event could not be checked yet. If it is a webinar, no account is made and the company below is not used.')}</p>
                )}
                <p className="text-[14px] font-semibold text-navy">{t('adminReview.v2.regApprove.company', 'Their company on the platform')}</p>
                {shown.lookup ? (
                  <CompanyChoice
                    value={shown.pick}
                    onChange={p => setDialog(d => (d && d.mode === 'regApprove' ? { ...d, pick: p } : d))}
                    lookup={shown.lookup}
                    noneLabel={t('adminReview.v2.regApprove.none', 'No company for now (participant)')}
                    noneHint={t('adminReview.v2.regApprove.noneHint', 'They can add their company later; M3 checks it then.')}
                    disabled={busy}
                  />
                ) : (
                  <p className="flex items-center gap-2 text-[13px] text-meta"><Clock className="h-4 w-4" aria-hidden="true" />{t('adminValidate.loading', 'Loading the person…')}</p>
                )}
                <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-rule bg-white px-3 py-2.5 text-[14px] leading-5 text-navy">
                  <Checkbox checked={shown.validate} onCheckedChange={v => setDialog(d => (d && d.mode === 'regApprove' ? { ...d, validate: v === true } : d))} />
                  <span>{t('adminReview.v2.regApprove.validate', 'Also validate their account (M3 has just checked them)')}</span>
                </label>
              </div>
            </WindowBody>
          )}

          {shown?.mode === 'bulkApprove' && (
            <WindowBody
              title={t('adminReview.v2.bulk.title', { count: shown.rows.length, defaultValue_one: 'Approve {{count}} registration?', defaultValue_other: 'Approve {{count}} registrations?' })}
              description={t('adminReview.v2.bulk.body', 'Each person gets a confirmed seat and their e-mail (entry pass or confirmation) at once. This cannot be undone from here.')}
              error={dialogError}
              busy={busy}
              onCancel={() => setDialog(null)}
              confirm={{ label: t('adminReview.v2.bulk.confirm', 'Approve and e-mail them'), run: async () => {
                setBusy(true);
                setDialogError(null);
                try { await runGrouped(shown.rows, 'approve'); setSelected(new Set()); } catch (e) { setDialogError(reviewErrorText(e, t)); }
                setBusy(false);
                void load();
              } }}
            >
              <ul className="space-y-1 text-[14px] leading-5 text-navy">
                {[...new Set(shown.rows.map(eventLabel))].map(ev => (
                  <li key={ev}>{t('adminReview.v2.bulk.line', '{{event}}: {{count}}', { event: ev, count: shown.rows.filter(r => eventLabel(r) === ev).length })}</li>
                ))}
              </ul>
              {shown.rows.some(isOnsiteV2) && (
                <p className="text-[13px] leading-5 text-meta">{t('adminReview.v2.bulk.onsite', 'On-site events: their accounts are made with no company; M3 can link the company later from the person\'s page.')}</p>
              )}
              {accountMailNote && shown.rows.some(isV1) && (
                <p className="text-[13px] leading-5 text-meta">{t('adminReview.v2.bulk.wysAccount2', 'World Yachting Summit guests with no Smart Marina Connect account yet: a minute or two after their entry pass, they get a second e-mail to choose its password.')}</p>
              )}
            </WindowBody>
          )}

          {shown?.mode === 'capacity' && (
            <WindowBody
              title={t('adminReview.capacity.title', 'The event is full')}
              description={t('adminReview.v2.capacity.body', 'Approving would go over the number of places (confirmed guests plus invitations awaiting an answer). Go over anyway?')}
              error={dialogError}
              busy={busy}
              onCancel={() => setDialog(null)}
              cancelLabel={t('adminReview.capacity.no', 'No, keep the limit')}
              confirm={{ label: t('adminReview.capacity.yes', 'Approve over capacity'), run: async () => {
                setBusy(true);
                setDialogError(null);
                let changed = 0; let failed = 0; let sent = 0;
                try {
                  for (const g of shown.groups) {
                    const r = await g.retry();
                    changed += r.changed; failed += r.failed; sent += r.sent;
                  }
                  regOutcome({ changed, failed, sent }, 'approve', changed || 1, shown.groups.every(g => g.v1));
                  setDialog(null);
                } catch (e) { setDialogError(reviewErrorText(e, t)); }
                setBusy(false);
                void load();
              } }}
            >
              <ul className="space-y-1 text-[14px] leading-5 text-navy">
                {shown.groups.map(g => (
                  <li key={g.label}>{t('adminReview.v2.capacity.line', '{{event}}: {{total}} for {{capacity}} places', { event: g.label, total: g.held + g.adding, capacity: g.capacity })}</li>
                ))}
              </ul>
            </WindowBody>
          )}

          {shown?.mode === 'orgArchive' && (
            <WindowBody
              title={t('adminReview.v2.archive.title', 'Archive {{name}}?', { name: shown.row.title })}
              description={t('adminReview.v2.archive.body', 'The company leaves this list, sign-up search and company matching. Nothing is deleted and nobody is e-mailed. Undo, right after, brings it back; later, only the developers can (no screen for it yet).')}
              error={dialogError}
              busy={busy}
              onCancel={() => setDialog(null)}
              confirm={{ label: t('adminReview.v2.archive.confirm', 'Archive the company'), danger: true, run: async () => {
                setBusy(true);
                setDialogError(null);
                const row = shown.row;
                try {
                  await archiveOrg(row.id, true, shown.note);
                  toast({
                    title: t('adminReview.v2.done.archived', '{{name}} is archived', { name: row.title }),
                    action: (
                      <ToastAction altText={t('adminReview.v2.done.unarchive', 'Undo: bring it back')} onClick={() => {
                        archiveOrg(row.id, false).then(() => { toast({ title: t('adminReview.v2.done.unarchived', '{{name}} is back', { name: row.title }) }); void load(); }, failToast);
                      }}>
                        {t('adminReview.v2.done.undo', 'Undo')}
                      </ToastAction>
                    ),
                  });
                  setDialog(null);
                } catch (e) { setDialogError(reviewErrorText(e, t)); }
                setBusy(false);
                void load();
              } }}
            >
              <Textarea
                value={shown.note}
                onChange={e => setDialog(d => (d && d.mode === 'orgArchive' ? { ...d, note: e.target.value } : d))}
                rows={2}
                maxLength={2000}
                placeholder={t('adminReview.v2.archive.notePlaceholder', 'Internal note (optional, only M3 sees it): why it is archived')}
                aria-label={t('adminReview.v2.remove.note', 'Internal note')}
              />
            </WindowBody>
          )}

          {shown?.mode === 'teamRemove' && (
            <WindowBody
              title={t('adminReview.v2.remove.title', 'Remove {{name}} from {{org}}?', { name: shown.row.title, org: fStr(shown.row.facts, 'org_name') ?? '' })}
              description={t('adminReview.v2.remove.body', 'They stop being a member of the company. Nobody is e-mailed. You can add them back right after.')}
              error={dialogError}
              busy={busy}
              onCancel={() => setDialog(null)}
              confirm={{ label: t('adminReview.v2.remove.confirm', 'Remove from the company'), danger: true, run: async () => {
                setBusy(true);
                setDialogError(null);
                const row = shown.row;
                try {
                  const res = await revokeTeamJoin(row.id, shown.reset, shown.note);
                  const userId = res.user_id ?? fStr(row.facts, 'user_id');
                  const orgId = res.organization_id ?? fStr(row.facts, 'organization_id');
                  toast({
                    title: t('adminReview.v2.done.removed', '{{name}} was removed', { name: row.title }),
                    description: res.person_reset ? t('adminReview.v2.done.removedReset', 'Their account is back under review.') : undefined,
                    action: !res.person_reset && userId && orgId ? (
                      <ToastAction altText={t('adminReview.v2.done.addBack', 'Add back')} onClick={() => {
                        addOrgMemberBack(userId, orgId, row.id).then(() => { toast({ title: t('adminReview.v2.done.addedBack', '{{name}} is a member again', { name: row.title }) }); void load(); }, failToast);
                      }}>
                        {t('adminReview.v2.done.addBack', 'Add back')}
                      </ToastAction>
                    ) : undefined,
                  });
                  setDialog(null);
                } catch (e) { setDialogError(reviewErrorText(e, t)); }
                setBusy(false);
                void load();
              } }}
            >
              <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-rule bg-white px-3 py-2.5 text-[14px] leading-5 text-navy">
                <Checkbox className="mt-0.5" checked={shown.reset} onCheckedChange={v => setDialog(d => (d && d.mode === 'teamRemove' ? { ...d, reset: v === true } : d))} />
                <span>{t('adminReview.v2.remove.reset', 'Also send their account back to M3\'s review (when joining this company is what validated them)')}</span>
              </label>
              <Textarea
                value={shown.note}
                onChange={e => setDialog(d => (d && d.mode === 'teamRemove' ? { ...d, note: e.target.value } : d))}
                rows={2}
                maxLength={2000}
                placeholder={t('adminReview.v2.remove.notePlaceholder', 'Internal note (optional, only M3 sees it)')}
                aria-label={t('adminReview.v2.remove.note', 'Internal note')}
              />
            </WindowBody>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** A window's content: title, line, body, error, Cancel and ONE confirm button. */
function WindowBody({ title, description, children, error, busy, onCancel, cancelLabel, confirm }: {
  title: string;
  description?: string;
  children?: ReactNode;
  error: string | null;
  busy: boolean;
  onCancel: () => void;
  cancelLabel?: string;
  confirm: { label: string; run: () => void | Promise<void>; danger?: boolean };
}) {
  const { t } = useTranslation();
  return (
    <>
      <DialogHeader className="pr-10 text-left">
        <DialogTitle className="text-[19px] leading-7 text-navy [overflow-wrap:anywhere]">{title}</DialogTitle>
        {description && <DialogDescription className="text-[14px] leading-5 text-meta">{description}</DialogDescription>}
      </DialogHeader>
      {children && <div className="space-y-3">{children}</div>}
      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-[14px] leading-5 text-red-900">{error}</p>}
      <DialogFooter className="gap-2 sm:gap-2">
        <Button type="button" variant="outline" size="sm" className={cn(ADMIN_BTN, TALL)} onClick={onCancel} disabled={busy}>
          {cancelLabel ?? t('adminReview.cancel', 'Cancel')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant={confirm.danger ? 'outline' : 'default'}
          className={cn(confirm.danger ? ADMIN_BTN_DANGER : ADMIN_BTN_PRIMARY, TALL)}
          onClick={() => { void confirm.run(); }}
          disabled={busy}
        >
          {confirm.danger ? <X className="mr-1.5 h-4 w-4" aria-hidden="true" /> : <Check className="mr-1.5 h-4 w-4" aria-hidden="true" />}
          {confirm.label}
        </Button>
      </DialogFooter>
    </>
  );
}
