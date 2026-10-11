import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  Check, CheckCheck, CheckCircle2, Clock, Download, HelpCircle, ListChecks, Mail, RefreshCw, Reply, Undo2, UserCheck, Users, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { EditDialog } from '@/components/home/dashboard/EditKit';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  AdminEmpty, AdminFilterBar, AdminKpiCard, AdminLoading, AdminStatusPill,
} from '../AdminUI';
import { EDITOR_BTN, Field, Note, TEXTAREA, ToggleRow } from './editorUi';
import {
  EditorError, STATUS_TONE, downloadCsv, editorErrorText, formatInZone, historyWord, isoToWall, loadGuests,
  loadHistory, registrationStaff, setAttended, sourceText, staffErrorText, statusWord,
  type EventKind, type GuestRow, type GuestStatus, type HistoryRow, type QuestionRow, type RegistrationMode,
} from './eventAdmin';

type Decision = 'approve' | 'reject' | 'waitlist' | 'request_info';
type View = 'all' | 'review' | 'confirmed' | 'waitlisted' | 'attended' | 'closed';

/** Which statuses each staff decision applies to (gl_decide_v2 skips the others). */
const DECIDE_FROM: Record<Decision, GuestStatus[]> = {
  approve: ['requested', 'needs_info', 'waitlisted'],
  reject: ['requested', 'needs_info', 'waitlisted'],
  waitlist: ['requested', 'needs_info'],
  request_info: ['requested', 'waitlisted'],
};

/** The registration function takes 200 registrations per decision (gl_decide_v2): larger selections go in turns. */
const MAX_DECIDE_IDS = 200;

const inView = (g: GuestRow, view: View): boolean => {
  switch (view) {
    case 'review': return g.status === 'requested' || g.status === 'needs_info';
    case 'confirmed': return g.status === 'confirmed';
    case 'waitlisted': return g.status === 'waitlisted';
    case 'attended': return !!g.checked_in_at;
    case 'closed': return ['rejected', 'cancelled', 'declined'].includes(g.status);
    default: return true;
  }
};

const fullName = (g: GuestRow) => `${g.first_name || ''} ${g.last_name || ''}`.trim() || g.email;

/** Back to "To review" after "Ask for more information": the person answered (the answer is in review_log). */
const answeredInfo = (g: GuestRow) => g.status === 'requested' && !!g.info_requested_at;

/** An answer as plain words (lists joined, ticks as Yes). */
function answerText(q: QuestionRow | undefined, v: unknown, t: TFunction): string {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'boolean') return v ? t('adminEvents.yes', 'Yes') : t('adminEvents.no', 'No');
  const label = (x: string) => q?.options?.find((o) => o.value === x)?.label ?? x;
  if (Array.isArray(v)) return v.map((x) => label(String(x))).join('; ');
  if (typeof v === 'object') return JSON.stringify(v);
  return label(String(v));
}

/** A selection checkbox with a 44 px hit area around its 20 px box. */
function RowCheckbox({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  const id = useId();
  return (
    <label htmlFor={id} className="-m-3 grid shrink-0 cursor-pointer place-items-center p-3">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={onChange}
        aria-label={label}
        className="h-5 w-5 rounded-[6px] border-navy/40 data-[state=checked]:bg-navy"
      />
    </label>
  );
}

/**
 * The registrations of a core_v2 event: the list, decisions (through the
 * `registration` function, which e-mails the people concerned), attendance
 * (gl_checkin_v2) and the CSV export. Rows are read from gl_guest (staff RLS);
 * no token is read or shown.
 *
 * Phase 1: decisions for webinars only. On-site events show the list (no decision:
 * confirming one queues an account and a door pass the on-site editor must set up).
 */
export function EventRegistrationsPanel({
  glEventId,
  kind,
  capacity,
  slug,
  timezone,
  startIso,
  questions,
  onCount,
  attendanceSetting,
  onAttendanceRecorded,
  hasReplay = false,
  mode = 'instant',
  waitlist = false,
}: {
  glEventId: string;
  kind: EventKind;
  capacity: number | null;
  slug: string;
  timezone: string;
  /** The saved start of the event: attendance can be marked once it has begun. */
  startIso: string | null;
  questions: QuestionRow[];
  onCount?: (n: number) => void;
  /**
   * gl_event.settings.attendance_recorded as stored. true: registration-cron e-mails the
   * absentees; false: it never does; absent: it treats the marking as complete 30 minutes
   * after the last mark.
   */
  attendanceSetting: unknown;
  /** Saves attendance_recorded. Absent for a test event without an event page. */
  onAttendanceRecorded?: (value: boolean) => Promise<void>;
  /** A replay link is saved (gl_event or the event page): the absentee e-mail goes one hour after the end, else two days. */
  hasReplay?: boolean;
  mode?: RegistrationMode;
  waitlist?: boolean;
}) {
  const { t } = useTranslation();
  const attendanceRecorded = attendanceSetting === true;
  const attendanceUnset = attendanceSetting !== true && attendanceSetting !== false;
  const [rows, setRows] = useState<GuestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<View>('all');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  // The dialogs keep their content while they fade out: open flags apart from the data.
  const [decision, setDecision] = useState<{ kind: Decision; people: { id: string; name: string }[]; skipped: number } | null>(null);
  const [decisionOpen, setDecisionOpen] = useState(false);
  const [notifyReject, setNotifyReject] = useState(true);
  const [infoText, setInfoText] = useState('');
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [overCapacity, setOverCapacity] = useState<{ held: number; capacity: number; adding: number } | null>(null);
  const [detail, setDetail] = useState<GuestRow | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  // review_log of the open registration: decisions and the person's answers.
  const [history, setHistory] = useState<{ id: string; rows: HistoryRow[] | null; failed: boolean } | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteResult, setPasteResult] = useState<{
    marked: number; already: number; notConfirmed: string[]; unknown: string[];
    /** Could not be marked (network, session): can be tried again. */
    failed: string[];
    stopped: string | null;
  } | null>(null);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);

  const decisionsAllowed = kind === 'webinar';
  const started = !!startIso && Date.now() >= Date.parse(startIso);
  const attendanceAllowed = kind === 'webinar' && started;

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const list = await loadGuests(glEventId);
      setRows(list);
      onCount?.(list.length);
      setSelected((s) => new Set([...s].filter((id) => list.some((g) => g.id === id))));
    } catch (e) {
      setLoadError(editorErrorText(e, t));
    }
    setLoading(false);
  }, [glEventId, onCount, t]);
  useEffect(() => { void load(); }, [load]);

  const byKey = useMemo(() => new Map(questions.map((x) => [x.key, x])), [questions]);
  // Answers to a question removed since: still shown and exported, under their internal name.
  const extraKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const g of rows) for (const k of Object.keys(g.answers || {})) if (!byKey.has(k)) keys.add(k);
    return [...keys].sort();
  }, [rows, byKey]);
  const counts = useMemo(() => ({
    confirmed: rows.filter((g) => g.status === 'confirmed').length,
    review: rows.filter((g) => inView(g, 'review')).length,
    waitlisted: rows.filter((g) => g.status === 'waitlisted').length,
    attended: rows.filter((g) => !!g.checked_in_at).length,
    confirmedAttended: rows.filter((g) => g.status === 'confirmed' && !!g.checked_in_at).length,
  }), [rows]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((g) => inView(g, view) && (!needle || [g.first_name, g.last_name, g.email, g.company, g.job_title]
      .some((x) => (x || '').toLowerCase().includes(needle))));
  }, [rows, view, q]);

  // A selection is about the people on screen: a new filter or search starts a new one,
  // and a decision never reaches someone the list does not show.
  useEffect(() => { setSelected(new Set()); }, [view, q]);
  const allVisibleSelected = visible.length > 0 && visible.every((g) => selected.has(g.id));
  const toggleAll = () => setSelected(allVisibleSelected ? new Set() : new Set(visible.map((g) => g.id)));
  const toggle = (id: string) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const chosen = visible.filter((g) => selected.has(g.id));
  const canDecide = (d: Decision, list: GuestRow[]) => decisionsAllowed && list.some((g) => DECIDE_FROM[d].includes(g.status));
  const canMark = attendanceAllowed && chosen.some((g) => g.status === 'confirmed' && !g.checked_in_at);

  /* ---------------------------------------------------------- decisions */

  const openDecision = (kindOf: Decision, list: GuestRow[]) => {
    const people = list.filter((g) => DECIDE_FROM[kindOf].includes(g.status)).map((g) => ({ id: g.id, name: fullName(g) }));
    if (!people.length) {
      toast({ title: t('adminEvents.regs.nobody', 'Nobody in the selection can get this decision'), description: t('adminEvents.regs.nobodyBody', 'Look at their status: someone already confirmed or cancelled is left as is.') });
      return;
    }
    setDialogError(null);
    setInfoText('');
    setNotifyReject(true);
    setDecision({ kind: kindOf, people, skipped: list.length - people.length });
    setDecisionOpen(true);
  };

  const doneText = (d: Decision, n: number) => {
    switch (d) {
      case 'approve': return t('adminEvents.regs.doneApprove', '{{n}} confirmed', { n });
      case 'reject': return t('adminEvents.regs.doneReject', '{{n}} not accepted', { n });
      case 'waitlist': return t('adminEvents.regs.doneWaitlist', '{{n}} on the waiting list', { n });
      default: return t('adminEvents.regs.doneInfo2', '{{n}} asked for more information', { n });
    }
  };
  const mailsText = (sent: number, failed: number) => [
    sent === 1 ? t('adminEvents.regs.mailSentOne', 'One e-mail sent.') : t('adminEvents.regs.mailsSentN', '{{n}} e-mails sent.', { n: sent }),
    failed ? (failed === 1 ? t('adminEvents.regs.mailFailedOne', 'One could not be sent.') : t('adminEvents.regs.mailsFailedN', '{{n}} could not be sent.', { n: failed })) : '',
  ].filter(Boolean).join(' ');

  const runDecision = async (force = false) => {
    if (!decision) return;
    if (decision.kind === 'request_info' && !infoText.trim()) {
      setDialogError(t('adminEvents.regs.infoNeeded', 'Write what you need to know.'));
      return;
    }
    setBusy(true);
    setDialogError(null);
    const people = decision.people;
    let changed = 0;
    let sent = 0;
    let failed = 0;
    let mailsKnown = false;
    // In turns of 200: the function keeps only the first 200 ids of one call.
    for (let i = 0; i < people.length; i += MAX_DECIDE_IDS) {
      const chunk = people.slice(i, i + MAX_DECIDE_IDS);
      const res = await registrationStaff<{ ok?: boolean; changed?: string[]; skipped?: string[]; sent?: number; failed?: number; held?: number; capacity?: number; adding?: number }>({
        action: 'decide',
        gl_event_id: glEventId,
        guest_ids: chunk.map((p) => p.id),
        decision: decision.kind,
        info_request: decision.kind === 'request_info' ? infoText.trim() : undefined,
        notify: decision.kind === 'reject' ? notifyReject : true,
        force: force || undefined,
      });
      const stopped = res.error === 'capacity' || res.error === 'ticket_capacity' || !!res.error || res.ok !== true;
      if (stopped) {
        setBusy(false);
        // What is left to decide stays in the dialog; what was done is said.
        setDecision({ ...decision, people: people.slice(i), skipped: 0 });
        if (changed) {
          toast({ title: doneText(decision.kind, changed), description: [t('adminEvents.regs.partial', 'The others are not done yet.'), mailsKnown ? mailsText(sent, failed) : ''].filter(Boolean).join(' ') });
          void load();
        }
        if (res.error === 'capacity' || res.error === 'ticket_capacity') {
          setOverCapacity({ held: Number(res.held ?? 0), capacity: Number(res.capacity ?? 0), adding: Number(res.adding ?? 0) });
        } else {
          setDialogError(staffErrorText(res.error, t));
        }
        return;
      }
      changed += res.changed?.length ?? 0;
      if (typeof res.sent === 'number') { sent += res.sent; mailsKnown = true; }
      failed += Number(res.failed ?? 0);
    }
    setBusy(false);
    toast({ title: doneText(decision.kind, changed), description: mailsKnown ? mailsText(sent, failed) : undefined, variant: failed ? 'destructive' : undefined });
    setDecisionOpen(false);
    setOverCapacity(null);
    setSelected(new Set());
    await load();
  };

  /* ---------------------------------------------------------- attendance */

  /**
   * An event with no attendance_recorded value (made by SQL, or before the editor wrote it):
   * registration-cron would treat the marking as complete 30 minutes after the last mark and
   * e-mail everyone not marked yet. Record "not complete" before the first mark, so only
   * "Attendance is complete" sends "Sorry we missed you", as this page says.
   */
  const ensureAttendanceOpen = async (): Promise<boolean> => {
    if (!attendanceUnset || !onAttendanceRecorded) return true;
    try {
      await onAttendanceRecorded(false);
      return true;
    } catch (e) {
      toast({ title: t('adminEvents.regs.openFailed', 'Attendance could not be prepared'), description: editorErrorText(e, t), variant: 'destructive' });
      return false;
    }
  };

  const markAttended = async (list: GuestRow[], undo = false) => {
    const targets = list.filter((g) => g.status === 'confirmed' && (undo ? !!g.checked_in_at : !g.checked_in_at));
    if (!targets.length) {
      toast({ title: undo ? t('adminEvents.regs.noUndo', 'Nobody to change') : t('adminEvents.regs.noAttend', 'Only confirmed people who are not marked yet can be marked as attended') });
      return;
    }
    setBusy(true);
    if (!undo && !(await ensureAttendanceOpen())) {
      setBusy(false);
      return;
    }
    let ok = 0;
    let failed = 0;
    for (let i = 0; i < targets.length; i++) {
      try {
        const r = await setAttended(glEventId, targets[i].id, undo);
        if (r.ok) ok++; else failed++;
      } catch (e) {
        failed++;
        // The session ended or the system is missing: the others would fail the same way.
        if (e instanceof EditorError && (e.code === 'not_installed' || e.code === 'forbidden')) {
          failed += targets.length - i - 1;
          break;
        }
      }
    }
    setBusy(false);
    toast({
      title: undo ? t('adminEvents.regs.undone', '{{n}} no longer marked as attended', { n: ok }) : t('adminEvents.regs.attended', '{{n}} marked as attended', { n: ok }),
      description: failed ? t('adminEvents.regs.someFailed', '{{n}} could not be changed. Reload and try again.', { n: failed }) : undefined,
      variant: failed ? 'destructive' : undefined,
    });
    setSelected(new Set());
    await load();
  };

  /** Marks the addresses of a pasted list; `retry` = only the addresses that failed last time. */
  const runPaste = async (retry?: string[]) => {
    const found = retry ?? Array.from(new Set((pasteText.toLowerCase().match(/[^\s@,;<>"'()]+@[^\s@,;<>"'()]+\.[a-z]{2,}/g) || [])));
    if (!found.length) {
      setDialogError(t('adminEvents.regs.pasteNone', 'No e-mail address found in the text. Paste the list from your webinar tool.'));
      return;
    }
    setDialogError(null);
    const byEmail = new Map(rows.map((g) => [g.email.toLowerCase(), g]));
    const unknown: string[] = [];
    const notConfirmed: string[] = [];
    let already = 0;
    const toMark: GuestRow[] = [];
    for (const e of found) {
      const g = byEmail.get(e);
      if (!g) unknown.push(e);
      else if (g.status !== 'confirmed') notConfirmed.push(e);
      else if (g.checked_in_at) already++;
      else toMark.push(g);
    }
    setBusy(true);
    if (toMark.length && !(await ensureAttendanceOpen())) {
      setBusy(false);
      return;
    }
    let marked = 0;
    const failed: string[] = [];
    let stopped: string | null = null;
    for (const g of toMark) {
      // After a session or installation error the rest would fail too: list them to retry.
      if (stopped) { failed.push(g.email); continue; }
      try {
        const r = await setAttended(glEventId, g.id, false);
        if (r.ok) marked++;
        else if (typeof r.error === 'string' && r.error.startsWith('status_')) notConfirmed.push(g.email);
        else failed.push(g.email);
      } catch (e) {
        failed.push(g.email);
        if (e instanceof EditorError && (e.code === 'forbidden' || e.code === 'not_installed')) stopped = editorErrorText(e, t);
      }
    }
    setBusy(false);
    setPasteResult((prev) => (retry && prev
      ? { marked: prev.marked + marked, already: prev.already + already, notConfirmed: [...prev.notConfirmed, ...notConfirmed], unknown: prev.unknown, failed, stopped }
      : { marked, already, notConfirmed, unknown, failed, stopped }));
    await load();
  };

  const saveComplete = async (value: boolean) => {
    if (!onAttendanceRecorded) return;
    setBusy(true);
    setCompleteError(null);
    try {
      await onAttendanceRecorded(value);
      setCompleteOpen(false);
      toast({
        title: value
          ? t('adminEvents.regs.completeDone', 'Attendance is complete')
          : t('adminEvents.regs.reopenDone', 'Attendance is open again'),
        description: value
          ? (hasReplay
            ? t('adminEvents.regs.completeDoneReplay', 'People not marked as attended get "Sorry we missed you" with the replay link, from one hour after the end.')
            : t('adminEvents.regs.completeDoneNoReplay', 'People not marked as attended get "Sorry we missed you" two days after the end. Add the replay link in E-mails before then and it goes with it.'))
          : undefined,
      });
    } catch (e) {
      const msg = editorErrorText(e, t);
      if (value) setCompleteError(msg);
      else toast({ title: msg, variant: 'destructive' });
    }
    setBusy(false);
  };

  /* ---------------------------------------------------------- other actions */

  const sendLink = async (g: GuestRow) => {
    setBusy(true);
    const res = await registrationStaff<{ ok?: boolean }>({ action: 'send_status_link', guest_id: g.id });
    setBusy(false);
    if (res.error || res.ok !== true) toast({ title: t('adminEvents.regs.linkFailed', 'The link could not be sent'), description: staffErrorText(res.error, t), variant: 'destructive' });
    else toast({ title: t('adminEvents.regs.linkSent', 'Personal link sent to {{email}}', { email: g.email }) });
  };

  const openDetail = (g: GuestRow) => {
    setDetail(g);
    setDetailOpen(true);
    setHistory({ id: g.id, rows: null, failed: false });
    loadHistory(g.id)
      .then((list) => setHistory((h) => (h && h.id === g.id ? { id: g.id, rows: list, failed: false } : h)))
      .catch(() => setHistory((h) => (h && h.id === g.id ? { id: g.id, rows: [], failed: true } : h)));
  };

  const exportCsv = () => {
    const yes = t('adminEvents.yes', 'Yes');
    const head = [
      t('adminEvents.csv.firstName', 'First name'), t('adminEvents.csv.lastName', 'Last name'), t('adminEvents.csv.email', 'E-mail'),
      t('adminEvents.csv.company', 'Company'), t('adminEvents.csv.jobTitle', 'Job title'), t('adminEvents.csv.phone', 'Phone'),
      t('adminEvents.csv.country', 'Country'), t('adminEvents.csv.status', 'Status'), t('adminEvents.csv.registeredOn', 'Registered on'),
      t('adminEvents.csv.attended', 'Attended'), t('adminEvents.csv.account', 'Has an account'), t('adminEvents.csv.news', 'News by e-mail'),
      t('adminEvents.csv.cameFrom', 'Came from'),
      ...questions.map((x) => x.label),
      ...extraKeys,
    ];
    const lines = rows.map((g) => [
      g.first_name, g.last_name, g.email, g.company, g.job_title, g.phone, g.country,
      statusWord(g.status, t),
      // In the event's time zone, as on screen (not UTC).
      g.created_at ? isoToWall(g.created_at, timezone).replace('T', ' ') : '',
      g.checked_in_at ? yes : '',
      g.user_id ? yes : '',
      g.consents && g.consents.marketing_at ? yes : '',
      sourceText(g.source_detail, t),
      ...questions.map((x) => answerText(x, g.answers?.[x.key], t)),
      ...extraKeys.map((k) => answerText(undefined, g.answers?.[k], t)),
    ]);
    downloadCsv(`${slug || 'event'}-registrations-${new Date().toISOString().slice(0, 10)}.csv`, [head, ...lines]);
  };

  /* ---------------------------------------------------------- render */

  if (loading) return <AdminLoading />;
  if (loadError) return <Note tone="danger"><span role="alert">{loadError}</span></Note>;

  const statusFilterWords: Record<View, string> = {
    all: t('adminEvents.regs.viewAll', 'Everyone'),
    review: t('adminEvents.regs.viewReview', 'To review'),
    confirmed: t('adminEvents.regs.viewConfirmed', 'Confirmed'),
    waitlisted: t('adminEvents.regs.viewWaitlist', 'Waiting list'),
    attended: t('adminEvents.regs.viewAttended', 'Attended'),
    closed: t('adminEvents.regs.viewClosed', 'Not accepted or cancelled'),
  };
  const one = decision?.people.length === 1 ? decision.people[0].name : null;
  const n = decision?.people.length ?? 0;
  const dialogTitle: Record<Decision, string> = {
    approve: one ? t('adminEvents.regs.approveOne', 'Confirm {{name}}?', { name: one }) : t('adminEvents.regs.approveMany', 'Confirm {{n}} people?', { n }),
    reject: one ? t('adminEvents.regs.rejectOne', 'Turn down {{name}}?', { name: one }) : t('adminEvents.regs.rejectMany', 'Turn down {{n}} people?', { n }),
    waitlist: one ? t('adminEvents.regs.waitlistOne', 'Put {{name}} on the waiting list?', { name: one }) : t('adminEvents.regs.waitlistMany', 'Put {{n}} people on the waiting list?', { n }),
    request_info: one ? t('adminEvents.regs.infoOne', 'Ask {{name}} for more information', { name: one }) : t('adminEvents.regs.infoMany', 'Ask {{n}} people for more information', { n }),
  };
  const dialogBody: Record<Decision, string> = {
    approve: t('adminEvents.regs.approveBodyWebinar2', 'They get a confirmation e-mail with the calendar file and the join link (when it is set).'),
    reject: t('adminEvents.regs.rejectBody', 'Their registration is closed. You choose whether they are told.'),
    waitlist: t('adminEvents.regs.waitlistBody2', 'They are told by e-mail that they are on the waiting list.'),
    request_info: t('adminEvents.regs.infoBody', 'They get an e-mail with your question and a link to answer. Their registration comes back to "To review" when they answer.'),
  };
  const saveWord: Record<Decision, string> = {
    approve: t('adminEvents.regs.approve', 'Confirm'),
    reject: t('adminEvents.regs.reject', 'Turn down'),
    waitlist: t('adminEvents.regs.waitlist', 'Waiting list'),
    request_info: t('adminEvents.regs.ask', 'Send the question'),
  };
  const others = Math.max(0, counts.confirmed - counts.confirmedAttended);

  // The tiles that can say something for this event: "To review" only when M3 accepts
  // people (or someone waits anyway), "Waiting list" only when there is one.
  const showReviewTile = mode !== 'instant' || counts.review > 0;
  const showWaitlistTile = waitlist || counts.waitlisted > 0;
  const tileCount = 2 + (showReviewTile ? 1 : 0) + (showWaitlistTile ? 1 : 0);

  // The open registration's history: the person's latest answer to "Ask for more information".
  const detailHistory = detail && history?.id === detail.id ? history : null;
  const latestAnswer = (() => {
    if (!detail || !detailHistory?.rows) return null;
    const asked = detail.info_requested_at ? Date.parse(detail.info_requested_at) : null;
    const row = detailHistory.rows.find((h) => h.action === 'info_provided');
    if (!row) return null;
    // An answer older than the latest question belongs to an earlier round (see the history).
    if (asked !== null && Date.parse(row.created_at) < asked) return null;
    const changed = Array.isArray(row.details?.changed) ? (row.details!.changed as unknown[]).map(String).filter(Boolean) : [];
    return { note: row.note, changed, at: row.created_at };
  })();

  const decisionButtons = (list: GuestRow[], after?: () => void) => (
    <>
      {canDecide('approve', list) && (
        <Button type="button" size="sm" variant="outline" className={EDITOR_BTN} disabled={busy} onClick={() => { after?.(); openDecision('approve', list); }}>
          <Check className="mr-1.5 h-4 w-4" aria-hidden="true" /> {t('adminEvents.regs.approve', 'Confirm')}
        </Button>
      )}
      {canDecide('waitlist', list) && (
        <Button type="button" size="sm" variant="outline" className={EDITOR_BTN} disabled={busy} onClick={() => { after?.(); openDecision('waitlist', list); }}>
          <Clock className="mr-1.5 h-4 w-4" aria-hidden="true" /> {t('adminEvents.regs.waitlist', 'Waiting list')}
        </Button>
      )}
      {canDecide('request_info', list) && (
        <Button type="button" size="sm" variant="outline" className={EDITOR_BTN} disabled={busy} onClick={() => { after?.(); openDecision('request_info', list); }}>
          <HelpCircle className="mr-1.5 h-4 w-4" aria-hidden="true" /> {t('adminEvents.regs.askMore', 'Ask for more information')}
        </Button>
      )}
      {canDecide('reject', list) && (
        <Button type="button" size="sm" variant="outline" className={EDITOR_BTN} disabled={busy} onClick={() => { after?.(); openDecision('reject', list); }}>
          <X className="mr-1.5 h-4 w-4" aria-hidden="true" /> {t('adminEvents.regs.reject', 'Turn down')}
        </Button>
      )}
    </>
  );

  return (
    <div className="space-y-5">
      {!decisionsAllowed && (
        <Note>
          {t('adminEvents.regs.onsiteNote', 'On-site registrations are listed here. Confirming or turning them down arrives with the on-site editor, in a later update.')}
        </Note>
      )}

      <div className={cn('grid grid-cols-2 gap-3', tileCount === 3 && 'lg:grid-cols-3', tileCount === 4 && 'lg:grid-cols-4')}>
        <AdminKpiCard
          label={capacity ? t('adminEvents.regs.kpiConfirmedOf', 'Confirmed, out of {{n}}', { n: capacity }) : t('adminEvents.regs.kpiConfirmed', 'Confirmed')}
          value={counts.confirmed}
          icon={UserCheck}
          onClick={() => setView(view === 'confirmed' ? 'all' : 'confirmed')}
          selected={view === 'confirmed'}
        />
        {showReviewTile && (
          <AdminKpiCard
            label={t('adminEvents.regs.kpiReview', 'To review')}
            value={counts.review}
            icon={HelpCircle}
            tone={counts.review ? 'attention' : 'default'}
            onClick={() => setView(view === 'review' ? 'all' : 'review')}
            selected={view === 'review'}
          />
        )}
        {showWaitlistTile && (
          <AdminKpiCard
            label={t('adminEvents.regs.kpiWaitlist', 'Waiting list')}
            value={counts.waitlisted}
            icon={Clock}
            onClick={() => setView(view === 'waitlisted' ? 'all' : 'waitlisted')}
            selected={view === 'waitlisted'}
          />
        )}
        <AdminKpiCard
          label={t('adminEvents.regs.kpiAttended', 'Attended')}
          value={counts.attended}
          icon={CheckCheck}
          onClick={() => setView(view === 'attended' ? 'all' : 'attended')}
          selected={view === 'attended'}
        />
      </div>

      <AdminFilterBar
        search={q}
        onSearchChange={setQ}
        searchPlaceholder={t('adminEvents.regs.search', 'Search a name, e-mail or company')}
        trailing={(
          <>
            <Button type="button" variant="outline" size="sm" className={EDITOR_BTN} onClick={() => { setLoading(true); void load(); }} aria-label={t('adminEvents.regs.refresh', 'Refresh')}>
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button type="button" variant="outline" size="sm" className={EDITOR_BTN} onClick={exportCsv} disabled={!rows.length}>
              <Download className="mr-1.5 h-4 w-4" aria-hidden="true" /> {t('adminEvents.regs.export', 'Export (CSV)')}
            </Button>
          </>
        )}
      >
        <Select value={view} onValueChange={(x) => setView(x as View)}>
          <SelectTrigger className="w-56" aria-label={t('adminEvents.regs.show', 'Show')}><SelectValue /></SelectTrigger>
          <SelectContent>
            {(Object.keys(statusFilterWords) as View[]).map((k) => <SelectItem key={k} value={k}>{statusFilterWords[k]}</SelectItem>)}
          </SelectContent>
        </Select>
      </AdminFilterBar>

      {/* After the start of a webinar: mark who attended, then say the marking is complete. */}
      {attendanceAllowed && counts.confirmed > 0 && (
        <div className="space-y-3 rounded-card border border-rule bg-white p-4">
          {attendanceRecorded ? (
            <p className="flex items-start gap-2 text-[14px] leading-5 text-navy">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-teal" aria-hidden="true" />
              <span>
                {hasReplay
                  ? t('adminEvents.regs.completeStateReplay', 'Attendance is complete: {{n}} of {{total}} confirmed people attended. The others get "Sorry we missed you" with the replay link, from one hour after the end.', { n: counts.confirmedAttended, total: counts.confirmed })
                  : t('adminEvents.regs.completeStateNoReplay', 'Attendance is complete: {{n}} of {{total}} confirmed people attended. The others get "Sorry we missed you" two days after the end (add the replay link in E-mails before then and it goes with it).', { n: counts.confirmedAttended, total: counts.confirmed })}
              </span>
            </p>
          ) : onAttendanceRecorded ? (
            <p className="text-[14px] leading-5 text-meta">
              {t('adminEvents.regs.attendTip2', 'After the webinar, mark who attended (paste the list from Zoom or Teams). Then press "Attendance is complete": only then do the others get the "Sorry we missed you" e-mail.')}
            </p>
          ) : (
            <p className="text-[14px] leading-5 text-meta">
              {attendanceUnset
                ? t('adminEvents.regs.attendTipCanary', 'On this test event, people not marked get "Sorry we missed you" 30 minutes after the last mark.')
                : t('adminEvents.regs.attendTipCanaryOff', 'On this test event, nobody gets "Sorry we missed you": attendance is set as not complete (change it with the runbook).')}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" className={EDITOR_BTN} disabled={busy} onClick={() => { setPasteText(''); setPasteResult(null); setDialogError(null); setPasteOpen(true); }}>
              <ListChecks className="mr-1.5 h-4 w-4" aria-hidden="true" /> {t('adminEvents.regs.paste', 'Mark attendance from a list')}
            </Button>
            {onAttendanceRecorded && (attendanceRecorded ? (
              <Button type="button" variant="outline" size="sm" className={EDITOR_BTN} disabled={busy} onClick={() => void saveComplete(false)}>
                <Undo2 className="mr-1.5 h-4 w-4" aria-hidden="true" /> {t('adminEvents.regs.reopen', 'Reopen attendance')}
              </Button>
            ) : (
              <Button type="button" variant="outline" size="sm" className={EDITOR_BTN} disabled={busy} onClick={() => { setCompleteError(null); setCompleteOpen(true); }}>
                <CheckCircle2 className="mr-1.5 h-4 w-4" aria-hidden="true" /> {t('adminEvents.regs.complete', 'Attendance is complete')}
              </Button>
            ))}
          </div>
        </div>
      )}

      {chosen.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-card border border-navy/30 bg-foam p-3" role="region" aria-label={t('adminEvents.regs.selection', 'Selection')}>
          <span className="mr-1 text-[14px] font-semibold text-navy">{t('adminEvents.regs.selected', '{{n}} selected', { n: chosen.length })}</span>
          {decisionButtons(chosen)}
          {canMark && (
            <Button type="button" size="sm" variant="outline" className={EDITOR_BTN} disabled={busy} onClick={() => void markAttended(chosen)}>
              <UserCheck className="mr-1.5 h-4 w-4" aria-hidden="true" /> {t('adminEvents.regs.markAttended', 'Mark attended')}
            </Button>
          )}
          <button type="button" onClick={() => setSelected(new Set())} className="ml-auto inline-flex min-h-11 items-center rounded-pill px-3 text-[13px] font-semibold text-navy hover:bg-white focus:outline-none focus-visible:shadow-focus">
            {t('adminEvents.regs.clear', 'Clear')}
          </button>
        </div>
      )}

      <div className="rounded-card border border-rule bg-white">
        {rows.length === 0 ? (
          <AdminEmpty
            icon={Users}
            title={t('adminEvents.regs.emptyTitle', 'No registration yet')}
            body={t('adminEvents.regs.emptyBody', 'People who register appear here, newest first.')}
          />
        ) : visible.length === 0 ? (
          <AdminEmpty icon={Users} title={t('adminEvents.regs.noMatch', 'Nobody matches this filter')} />
        ) : (
          <>
            <div className="flex items-center gap-3 border-b border-rule px-4 py-2.5">
              <RowCheckbox checked={allVisibleSelected} onChange={toggleAll} label={t('adminEvents.regs.selectAll', 'Select everyone shown')} />
              <span className="text-meta-caps">
                {visible.length === 1 ? t('adminEvents.regs.onePerson', '1 person') : t('adminEvents.regs.people', '{{n}} people', { n: visible.length })}
              </span>
            </div>
            <ul className="divide-y divide-rule">
              {visible.map((g) => (
                <li key={g.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <RowCheckbox checked={selected.has(g.id)} onChange={() => toggle(g.id)} label={t('adminEvents.regs.select', 'Select {{name}}', { name: fullName(g) })} />
                    <button type="button" onClick={() => openDetail(g)} className="min-h-11 min-w-0 rounded-sm py-1 text-left focus:outline-none focus-visible:shadow-focus">
                      <span className="block text-[15px] font-semibold leading-5 text-navy [overflow-wrap:anywhere]">{fullName(g)}</span>
                      <span className="block text-[13px] leading-[18px] text-meta [overflow-wrap:anywhere]">
                        {g.email}{g.company ? ` · ${g.company}` : ''}{g.job_title ? `, ${g.job_title}` : ''}
                      </span>
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 pl-8 sm:pl-0">
                    <AdminStatusPill tone={STATUS_TONE[g.status] ?? 'neutral'}>{statusWord(g.status, t)}</AdminStatusPill>
                    {answeredInfo(g) && <AdminStatusPill tone="info" icon={Reply}>{t('adminEvents.regs.answered', 'Answered')}</AdminStatusPill>}
                    {g.checked_in_at && <AdminStatusPill tone="success" icon={CheckCheck}>{t('adminEvents.regs.wasThere', 'Attended')}</AdminStatusPill>}
                    <span className="text-[12px] tabular-nums text-meta">
                      {new Date(g.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                    </span>
                    {decisionsAllowed && DECIDE_FROM.approve.includes(g.status) ? (
                      <Button type="button" size="sm" variant="outline" className={EDITOR_BTN} disabled={busy} onClick={() => openDecision('approve', [g])}>
                        <Check className="mr-1 h-4 w-4" aria-hidden="true" /> {t('adminEvents.regs.approve', 'Confirm')}
                      </Button>
                    ) : attendanceAllowed && g.status === 'confirmed' ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className={EDITOR_BTN}
                        disabled={busy}
                        onClick={() => void markAttended([g], !!g.checked_in_at)}
                      >
                        {g.checked_in_at
                          ? <><Undo2 className="mr-1 h-4 w-4" aria-hidden="true" /> {t('adminEvents.regs.undoAttended', 'Undo attendance')}</>
                          : <><UserCheck className="mr-1 h-4 w-4" aria-hidden="true" /> {t('adminEvents.regs.markAttendedOne', 'Mark attended')}</>}
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {/* A decision: what happens, then one button. */}
      <EditDialog
        open={decisionOpen && !overCapacity}
        onOpenChange={(o) => { if (!o) setDecisionOpen(false); }}
        title={decision ? dialogTitle[decision.kind] : ''}
        description={decision ? dialogBody[decision.kind] : undefined}
        onSave={() => runDecision(false)}
        saveLabel={decision ? saveWord[decision.kind] : undefined}
        saving={busy}
        error={dialogError}
      >
        {decision?.kind === 'reject' && (
          <ToggleRow
            checked={notifyReject}
            onChange={setNotifyReject}
            title={t('adminEvents.regs.tellThem', 'Tell them by e-mail')}
            body={t('adminEvents.regs.tellThemBody', 'A short, polite message. Off: nothing is sent.')}
          />
        )}
        {decision?.kind === 'request_info' && (
          <Field label={t('adminEvents.regs.infoLabel', 'What do you need to know?')} htmlFor="info-text">
            <Textarea
              id="info-text"
              rows={4}
              value={infoText}
              onChange={(e) => setInfoText(e.target.value.slice(0, 1000))}
              placeholder={t('adminEvents.regs.infoPh', 'Could you tell us which company you work for?')}
              className={TEXTAREA}
            />
          </Field>
        )}
        {decision && decision.people.length > 1 && decision.people.length <= 8 && (
          <p className="text-[13px] leading-[18px] text-meta [overflow-wrap:anywhere]">{decision.people.map((p) => p.name).join(', ')}</p>
        )}
        {decision && decision.skipped > 0 && (
          <p className="text-[14px] leading-5 text-navy">
            {decision.skipped === 1
              ? t('adminEvents.regs.skippedOne', 'One other person in your selection is left as is (already decided, closed or not eligible for this).')
              : t('adminEvents.regs.skippedN', '{{n}} others in your selection are left as they are (already decided, closed or not eligible for this).', { n: decision.skipped })}
          </p>
        )}
      </EditDialog>

      {/* Over the number of places: say it, offer to go ahead. */}
      <EditDialog
        open={!!overCapacity}
        onOpenChange={(o) => { if (!o) { setOverCapacity(null); setDecisionOpen(false); } }}
        title={t('adminEvents.regs.fullTitle', 'This goes over the number of places')}
        description={overCapacity
          ? t('adminEvents.regs.fullBody', '{{held}} of {{cap}} places are taken and you are adding {{add}}. Confirm anyway?', { held: overCapacity.held, cap: overCapacity.capacity, add: overCapacity.adding })
          : undefined}
        onSave={() => runDecision(true)}
        saveLabel={t('adminEvents.regs.confirmAnyway', 'Confirm anyway')}
        saving={busy}
        error={dialogError}
      />

      {/* "Attendance is complete": the absentee e-mail depends on it. */}
      <EditDialog
        open={completeOpen}
        onOpenChange={setCompleteOpen}
        title={t('adminEvents.regs.completeTitle', 'Is attendance complete?')}
        description={[
          t('adminEvents.regs.completeMarked', '{{n}} of {{total}} confirmed people are marked as attended.', { n: counts.confirmedAttended, total: counts.confirmed }),
          others === 1
            ? (hasReplay
              ? t('adminEvents.regs.completeOtherReplay', 'The other person gets the "Sorry we missed you" e-mail with the replay link, from one hour after the end.')
              : t('adminEvents.regs.completeOtherNoReplay', 'The other person gets the "Sorry we missed you" e-mail two days after the end (add the replay link in E-mails before then and it goes with it).'))
            : (hasReplay
              ? t('adminEvents.regs.completeOthersReplay', 'The other {{others}} get the "Sorry we missed you" e-mail with the replay link, from one hour after the end.', { others })
              : t('adminEvents.regs.completeOthersNoReplay', 'The other {{others}} get the "Sorry we missed you" e-mail two days after the end (add the replay link in E-mails before then and it goes with it).', { others })),
          t('adminEvents.regs.completeFinal', 'It cannot be taken back once sent.'),
        ].join(' ')}
        onSave={() => saveComplete(true)}
        saveLabel={t('adminEvents.regs.completeGo', 'Yes, attendance is complete')}
        saving={busy}
        error={completeError}
      >
        {counts.confirmedAttended === 0 && (
          <Note tone="warning">
            {t('adminEvents.regs.completeNobody', 'Nobody is marked as attended yet: everyone confirmed would get "Sorry we missed you". Mark the attendees first.')}
          </Note>
        )}
      </EditDialog>

      {/* Attendance from a pasted list (Zoom, Teams attendee report). */}
      <EditDialog
        open={pasteOpen}
        onOpenChange={setPasteOpen}
        title={t('adminEvents.regs.pasteTitle', 'Mark attendance from a list')}
        description={t('adminEvents.regs.pasteBody', 'Paste the attendee report of your webinar tool, or any text with the e-mail addresses of the people who joined.')}
        onSave={pasteResult
          ? (pasteResult.failed.length ? () => runPaste(pasteResult.failed) : undefined)
          : () => runPaste()}
        saveLabel={pasteResult
          ? (pasteResult.failed.length ? t('adminEvents.regs.pasteRetry', 'Try again for these') : t('adminEvents.done', 'Done'))
          : t('adminEvents.regs.pasteGo', 'Mark them as attended')}
        saving={busy}
        error={dialogError}
        wide
      >
        {pasteResult ? (
          <div className="space-y-2 text-[15px] leading-6 text-navy">
            <p>{t('adminEvents.regs.pasteMarked', '{{n}} marked as attended.', { n: pasteResult.marked })}</p>
            {pasteResult.failed.length > 0 && (
              <Note tone="danger">
                <span role="alert" className="[overflow-wrap:anywhere]">
                  {pasteResult.stopped ? `${pasteResult.stopped} ` : ''}
                  {t('adminEvents.regs.pasteFailed', 'Could not be marked (try again):')} {pasteResult.failed.join(', ')}
                </span>
              </Note>
            )}
            {pasteResult.already > 0 && <p className="text-meta">{t('adminEvents.regs.pasteAlready', 'Already marked before: {{n}}.', { n: pasteResult.already })}</p>}
            {pasteResult.notConfirmed.length > 0 && (
              <p className="text-meta [overflow-wrap:anywhere]">{t('adminEvents.regs.pasteNotConfirmed', 'Not confirmed, left as is:')} {pasteResult.notConfirmed.join(', ')}</p>
            )}
            {pasteResult.unknown.length > 0 && (
              <p className="text-meta [overflow-wrap:anywhere]">{t('adminEvents.regs.pasteUnknown', 'Not registered with this address:')} {pasteResult.unknown.join(', ')}</p>
            )}
            {!attendanceRecorded && onAttendanceRecorded && pasteResult.failed.length === 0 && (
              <p className="text-meta">{t('adminEvents.regs.pasteNext', 'If this list has everyone who attended, press "Attendance is complete" next.')}</p>
            )}
            {pasteResult.failed.length > 0 && onAttendanceRecorded && (
              <p className="text-meta">{t('adminEvents.regs.pasteFailedNext', 'Do not press "Attendance is complete" while some attendees are not marked: they would get "Sorry we missed you".')}</p>
            )}
          </div>
        ) : (
          <Textarea rows={8} value={pasteText} onChange={(e) => setPasteText(e.target.value)} aria-label={t('adminEvents.regs.pasteTitle', 'Mark attendance from a list')} className={TEXTAREA} />
        )}
      </EditDialog>

      {/* One registration in full. */}
      <EditDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        title={detail ? fullName(detail) : ''}
        description={detail?.email}
        wide
        quietClose
        saveLabel={t('adminEvents.close', 'Close')}
      >
        {detail && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <AdminStatusPill tone={STATUS_TONE[detail.status] ?? 'neutral'}>{statusWord(detail.status, t)}</AdminStatusPill>
              {answeredInfo(detail) && <AdminStatusPill tone="info" icon={Reply}>{t('adminEvents.regs.answered', 'Answered')}</AdminStatusPill>}
              {detail.checked_in_at && <AdminStatusPill tone="success" icon={CheckCheck}>{t('adminEvents.regs.wasThere', 'Attended')}</AdminStatusPill>}
              {detail.user_id && <AdminStatusPill tone="info">{t('adminEvents.regs.hasAccount', 'Has an account')}</AdminStatusPill>}
            </div>

            {/* "Ask for more information": the question, then their answer (review_log). */}
            {detail.info_request && (
              <div className="space-y-2 rounded-card border border-rule bg-page p-4 text-[14px] leading-5">
                <p className="font-semibold text-navy">{t('adminEvents.regs.asked2', 'Information asked')}</p>
                <p className="text-ink [overflow-wrap:anywhere]">{detail.info_request}</p>
                {detail.status === 'needs_info' ? (
                  <p className="text-meta">{t('adminEvents.regs.waitingAnswer', 'Waiting for their answer.')}</p>
                ) : latestAnswer ? (
                  <>
                    <p className="pt-1 font-semibold text-navy">
                      {t('adminEvents.regs.theirAnswer', 'Their answer')}
                      <span className="ml-1.5 font-normal text-meta">{formatInZone(latestAnswer.at, timezone)}</span>
                    </p>
                    <p className="whitespace-pre-line text-ink [overflow-wrap:anywhere]">
                      {latestAnswer.note || t('adminEvents.regs.noMessage', 'No message: they confirmed their details.')}
                    </p>
                    {latestAnswer.changed.length > 0 && (
                      <p className="text-meta [overflow-wrap:anywhere]">
                        {t('adminEvents.regs.theyChanged', 'They changed: {{list}}.', { list: latestAnswer.changed.join(', ') })}
                      </p>
                    )}
                  </>
                ) : detailHistory?.rows === null ? (
                  <p className="text-meta">{t('adminEvents.regs.answerLoading', 'Loading their answer…')}</p>
                ) : detailHistory?.failed ? (
                  <p className="text-meta">{t('adminEvents.regs.answerFailed', 'Their answer could not be loaded. Close and open this window again.')}</p>
                ) : null}
              </div>
            )}

            <dl className="grid gap-x-4 gap-y-2 text-[14px] leading-5 sm:grid-cols-[10rem_minmax(0,1fr)]">
              {([
                [t('adminEvents.reg.company', 'Company'), detail.company],
                [t('adminEvents.reg.jobTitle', 'Job title'), detail.job_title],
                [t('adminEvents.reg.phone', 'Phone'), detail.phone],
                [t('adminEvents.reg.country', 'Country'), detail.country],
                [t('adminEvents.regs.registeredOn', 'Registered on'), formatInZone(detail.created_at, timezone)],
                [t('adminEvents.regs.decidedOn', 'Decided on'), detail.decided_at ? formatInZone(detail.decided_at, timezone) : ''],
                [t('adminEvents.regs.linkOpened', 'Opened their link'), detail.link_opened_at ? formatInZone(detail.link_opened_at, timezone) : ''],
                [t('adminEvents.regs.news', 'News by e-mail'), detail.consents?.marketing_at ? t('adminEvents.yes', 'Yes') : ''],
                [t('adminEvents.regs.cameFrom', 'Came from'), sourceText(detail.source_detail, t)],
                ...questions.map((x) => [x.label, answerText(byKey.get(x.key), detail.answers?.[x.key], t)] as [string, string]),
                ...extraKeys.map((k) => [k, answerText(undefined, detail.answers?.[k], t)] as [string, string]),
              ] as [string, unknown][]).filter(([, val]) => val !== null && val !== undefined && val !== '').map(([k, val], i) => (
                <div key={`${i}:${k}`} className="contents">
                  <dt className="font-semibold text-navy [overflow-wrap:anywhere]">{k}</dt>
                  <dd className="text-ink [overflow-wrap:anywhere]">{String(val)}</dd>
                </div>
              ))}
            </dl>

            {/* What happened, newest first (decisions by M3, their answers). */}
            {!!detailHistory?.rows?.length && (
              <div className="space-y-1.5">
                <p className="text-meta-caps">{t('adminEvents.regs.history', 'History')}</p>
                <ul className="space-y-1 text-[13px] leading-[18px]">
                  {detailHistory.rows.slice(0, 6).map((h, i) => (
                    <li key={`${h.created_at}:${i}`} className="flex flex-wrap gap-x-2 text-ink">
                      <span className="tabular-nums text-meta">{formatInZone(h.created_at, timezone)}</span>
                      <span className="font-semibold text-navy">{historyWord(h.action, t)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {detail.status === 'confirmed' && (
              <p className="text-[13px] leading-[18px] text-meta">
                {t('adminEvents.regs.removeHint', 'To take someone off the list, send them their personal link: they can cancel from their registration page.')}
              </p>
            )}
            <div className="flex flex-wrap gap-2 border-t border-rule pt-4">
              {decisionButtons([detail], () => setDetailOpen(false))}
              <Button type="button" size="sm" variant="outline" className={EDITOR_BTN} disabled={busy} onClick={() => void sendLink(detail)}>
                <Mail className="mr-1.5 h-4 w-4" aria-hidden="true" /> {t('adminEvents.regs.sendLink', 'Send their personal link again')}
              </Button>
            </div>
          </div>
        )}
      </EditDialog>
    </div>
  );
}
