import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  Check, CheckCheck, CheckCircle2, Clock, Download, HelpCircle, ListChecks, Mail, RefreshCw, Undo2, UserCheck, Users, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { EditDialog } from '@/components/home/dashboard/EditKit';
import { toast } from '@/hooks/use-toast';
import {
  ADMIN_BTN, AdminEmpty, AdminFilterBar, AdminKpiCard, AdminLoading, AdminStatusPill,
} from '../AdminUI';
import { Field, Note, TEXTAREA, ToggleRow } from './editorUi';
import {
  EditorError, STATUS_TONE, downloadCsv, editorErrorText, formatInZone, loadGuests,
  registrationStaff, setAttended, sourceText, staffErrorText, statusWord,
  type EventKind, type GuestRow, type GuestStatus, type QuestionRow,
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
  attendanceRecorded,
  onAttendanceRecorded,
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
  /** gl_event.settings.attendance_recorded: registration-cron then e-mails the absentees. */
  attendanceRecorded: boolean;
  /** Saves attendance_recorded. Absent for a test event without an event page. */
  onAttendanceRecorded?: (value: boolean) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<GuestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<View>('all');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  // The dialogs keep their content while they fade out: open flags apart from the data.
  const [decision, setDecision] = useState<{ kind: Decision; people: { id: string; name: string }[] } | null>(null);
  const [decisionOpen, setDecisionOpen] = useState(false);
  const [notifyReject, setNotifyReject] = useState(true);
  const [infoText, setInfoText] = useState('');
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [overCapacity, setOverCapacity] = useState<{ held: number; capacity: number; adding: number } | null>(null);
  const [detail, setDetail] = useState<GuestRow | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteResult, setPasteResult] = useState<{ marked: number; already: number; notConfirmed: string[]; unknown: string[] } | null>(null);
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

  const allVisibleSelected = visible.length > 0 && visible.every((g) => selected.has(g.id));
  const toggleAll = () => setSelected(allVisibleSelected ? new Set() : new Set(visible.map((g) => g.id)));
  const toggle = (id: string) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const chosen = rows.filter((g) => selected.has(g.id));
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
    setDecision({ kind: kindOf, people });
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
        setDecision({ ...decision, people: people.slice(i) });
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

  const markAttended = async (list: GuestRow[], undo = false) => {
    const targets = list.filter((g) => g.status === 'confirmed' && (undo ? !!g.checked_in_at : !g.checked_in_at));
    if (!targets.length) {
      toast({ title: undo ? t('adminEvents.regs.noUndo', 'Nobody to change') : t('adminEvents.regs.noAttend', 'Only confirmed people who are not marked yet can be marked as attended') });
      return;
    }
    setBusy(true);
    let ok = 0;
    let failed = 0;
    for (const g of targets) {
      try {
        const r = await setAttended(glEventId, g.id, undo);
        if (r.ok) ok++; else failed++;
      } catch (e) {
        failed++;
        if (e instanceof EditorError && e.code === 'not_installed') break;
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

  const runPaste = async () => {
    const found = Array.from(new Set((pasteText.toLowerCase().match(/[^\s@,;<>"'()]+@[^\s@,;<>"'()]+\.[a-z]{2,}/g) || [])));
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
    let marked = 0;
    for (const g of toMark) {
      try {
        const r = await setAttended(glEventId, g.id, false);
        if (r.ok) marked++;
      } catch { /* counted as not marked */ }
    }
    setBusy(false);
    setPasteResult({ marked, already, notConfirmed, unknown });
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
          ? t('adminEvents.regs.completeDoneBody', 'People not marked as attended get "Sorry we missed you" within the hour (one hour after the end at the earliest).')
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
      g.created_at ? new Date(g.created_at).toISOString().slice(0, 16).replace('T', ' ') : '',
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

  const decisionButtons = (list: GuestRow[], after?: () => void) => (
    <>
      {canDecide('approve', list) && (
        <Button type="button" size="sm" variant="outline" className={ADMIN_BTN} disabled={busy} onClick={() => { after?.(); openDecision('approve', list); }}>
          <Check className="mr-1.5 h-4 w-4" aria-hidden="true" /> {t('adminEvents.regs.approve', 'Confirm')}
        </Button>
      )}
      {canDecide('waitlist', list) && (
        <Button type="button" size="sm" variant="outline" className={ADMIN_BTN} disabled={busy} onClick={() => { after?.(); openDecision('waitlist', list); }}>
          <Clock className="mr-1.5 h-4 w-4" aria-hidden="true" /> {t('adminEvents.regs.waitlist', 'Waiting list')}
        </Button>
      )}
      {canDecide('request_info', list) && (
        <Button type="button" size="sm" variant="outline" className={ADMIN_BTN} disabled={busy} onClick={() => { after?.(); openDecision('request_info', list); }}>
          <HelpCircle className="mr-1.5 h-4 w-4" aria-hidden="true" /> {t('adminEvents.regs.askMore', 'Ask for more information')}
        </Button>
      )}
      {canDecide('reject', list) && (
        <Button type="button" size="sm" variant="outline" className={ADMIN_BTN} disabled={busy} onClick={() => { after?.(); openDecision('reject', list); }}>
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

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <AdminKpiCard
          label={capacity ? t('adminEvents.regs.kpiConfirmedOf', 'Confirmed, out of {{n}}', { n: capacity }) : t('adminEvents.regs.kpiConfirmed', 'Confirmed')}
          value={counts.confirmed}
          icon={UserCheck}
          onClick={() => setView(view === 'confirmed' ? 'all' : 'confirmed')}
          selected={view === 'confirmed'}
        />
        <AdminKpiCard
          label={t('adminEvents.regs.kpiReview', 'To review')}
          value={counts.review}
          icon={HelpCircle}
          tone={counts.review ? 'attention' : 'default'}
          onClick={() => setView(view === 'review' ? 'all' : 'review')}
          selected={view === 'review'}
        />
        <AdminKpiCard
          label={t('adminEvents.regs.kpiWaitlist', 'Waiting list')}
          value={counts.waitlisted}
          icon={Clock}
          onClick={() => setView(view === 'waitlisted' ? 'all' : 'waitlisted')}
          selected={view === 'waitlisted'}
        />
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
            <Button type="button" variant="outline" size="sm" className={ADMIN_BTN} onClick={() => { setLoading(true); void load(); }} aria-label={t('adminEvents.regs.refresh', 'Refresh')}>
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button type="button" variant="outline" size="sm" className={ADMIN_BTN} onClick={exportCsv} disabled={!rows.length}>
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
              <span>{t('adminEvents.regs.completeState', 'Attendance is complete: {{n}} of {{total}} confirmed people attended. The others get "Sorry we missed you" with the replay.', { n: counts.confirmedAttended, total: counts.confirmed })}</span>
            </p>
          ) : (
            <p className="text-[14px] leading-5 text-meta">
              {t('adminEvents.regs.attendTip2', 'After the webinar, mark who attended (paste the list from Zoom or Teams). Then press "Attendance is complete": only then do the others get the "Sorry we missed you" e-mail.')}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" className={ADMIN_BTN} disabled={busy} onClick={() => { setPasteText(''); setPasteResult(null); setDialogError(null); setPasteOpen(true); }}>
              <ListChecks className="mr-1.5 h-4 w-4" aria-hidden="true" /> {t('adminEvents.regs.paste', 'Mark attendance from a list')}
            </Button>
            {onAttendanceRecorded && (attendanceRecorded ? (
              <Button type="button" variant="outline" size="sm" className={ADMIN_BTN} disabled={busy} onClick={() => void saveComplete(false)}>
                <Undo2 className="mr-1.5 h-4 w-4" aria-hidden="true" /> {t('adminEvents.regs.reopen', 'Reopen attendance')}
              </Button>
            ) : (
              <Button type="button" variant="outline" size="sm" className={ADMIN_BTN} disabled={busy} onClick={() => { setCompleteError(null); setCompleteOpen(true); }}>
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
            <Button type="button" size="sm" variant="outline" className={ADMIN_BTN} disabled={busy} onClick={() => void markAttended(chosen)}>
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
              <span className="text-meta-caps">{t('adminEvents.regs.people', '{{n}} people', { n: visible.length })}</span>
            </div>
            <ul className="divide-y divide-rule">
              {visible.map((g) => (
                <li key={g.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <RowCheckbox checked={selected.has(g.id)} onChange={() => toggle(g.id)} label={t('adminEvents.regs.select', 'Select {{name}}', { name: fullName(g) })} />
                    <button type="button" onClick={() => { setDetail(g); setDetailOpen(true); }} className="min-w-0 rounded-sm text-left focus:outline-none focus-visible:shadow-focus">
                      <span className="block text-[15px] font-semibold leading-5 text-navy [overflow-wrap:anywhere]">{fullName(g)}</span>
                      <span className="block text-[13px] leading-[18px] text-meta [overflow-wrap:anywhere]">
                        {g.email}{g.company ? ` · ${g.company}` : ''}{g.job_title ? `, ${g.job_title}` : ''}
                      </span>
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 pl-8 sm:pl-0">
                    <AdminStatusPill tone={STATUS_TONE[g.status] ?? 'neutral'}>{statusWord(g.status, t)}</AdminStatusPill>
                    {g.checked_in_at && <AdminStatusPill tone="success" icon={CheckCheck}>{t('adminEvents.regs.wasThere', 'Attended')}</AdminStatusPill>}
                    <span className="text-[12px] tabular-nums text-meta">
                      {new Date(g.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                    </span>
                    {decisionsAllowed && DECIDE_FROM.approve.includes(g.status) ? (
                      <Button type="button" size="sm" variant="outline" className={ADMIN_BTN} disabled={busy} onClick={() => openDecision('approve', [g])}>
                        <Check className="mr-1 h-4 w-4" aria-hidden="true" /> {t('adminEvents.regs.approve', 'Confirm')}
                      </Button>
                    ) : attendanceAllowed && g.status === 'confirmed' ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className={ADMIN_BTN}
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
        description={t('adminEvents.regs.completeBody', '{{n}} of {{total}} confirmed people are marked as attended. The other {{others}} get the "Sorry we missed you" e-mail, from one hour after the end. It cannot be taken back once sent.', { n: counts.confirmedAttended, total: counts.confirmed, others })}
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
        onSave={pasteResult ? undefined : runPaste}
        saveLabel={pasteResult ? t('adminEvents.done', 'Done') : t('adminEvents.regs.pasteGo', 'Mark them as attended')}
        saving={busy}
        error={dialogError}
        wide
      >
        {pasteResult ? (
          <div className="space-y-2 text-[15px] leading-6 text-navy">
            <p>{t('adminEvents.regs.pasteMarked', '{{n}} marked as attended.', { n: pasteResult.marked })}</p>
            {pasteResult.already > 0 && <p className="text-meta">{t('adminEvents.regs.pasteAlready', 'Already marked before: {{n}}.', { n: pasteResult.already })}</p>}
            {pasteResult.notConfirmed.length > 0 && (
              <p className="text-meta [overflow-wrap:anywhere]">{t('adminEvents.regs.pasteNotConfirmed', 'Not confirmed, left as is:')} {pasteResult.notConfirmed.join(', ')}</p>
            )}
            {pasteResult.unknown.length > 0 && (
              <p className="text-meta [overflow-wrap:anywhere]">{t('adminEvents.regs.pasteUnknown', 'Not registered with this address:')} {pasteResult.unknown.join(', ')}</p>
            )}
            {!attendanceRecorded && onAttendanceRecorded && (
              <p className="text-meta">{t('adminEvents.regs.pasteNext', 'If this list has everyone who attended, press "Attendance is complete" next.')}</p>
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
              {detail.checked_in_at && <AdminStatusPill tone="success" icon={CheckCheck}>{t('adminEvents.regs.wasThere', 'Attended')}</AdminStatusPill>}
              {detail.user_id && <AdminStatusPill tone="info">{t('adminEvents.regs.hasAccount', 'Has an account')}</AdminStatusPill>}
            </div>
            <dl className="grid gap-x-4 gap-y-2 text-[14px] leading-5 sm:grid-cols-[10rem_minmax(0,1fr)]">
              {([
                [t('adminEvents.reg.company', 'Company'), detail.company],
                [t('adminEvents.reg.jobTitle', 'Job title'), detail.job_title],
                [t('adminEvents.reg.phone', 'Phone'), detail.phone],
                [t('adminEvents.reg.country', 'Country'), detail.country],
                [t('adminEvents.regs.registeredOn', 'Registered on'), formatInZone(detail.created_at, timezone)],
                [t('adminEvents.regs.decidedOn', 'Decided on'), detail.decided_at ? formatInZone(detail.decided_at, timezone) : ''],
                [t('adminEvents.regs.asked2', 'Information asked'), detail.info_request],
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
            <div className="flex flex-wrap gap-2 border-t border-rule pt-4">
              {decisionButtons([detail], () => setDetailOpen(false))}
              <Button type="button" size="sm" variant="outline" className={ADMIN_BTN} disabled={busy} onClick={() => void sendLink(detail)}>
                <Mail className="mr-1.5 h-4 w-4" aria-hidden="true" /> {t('adminEvents.regs.sendLink', 'Send their personal link again')}
              </Button>
            </div>
          </div>
        )}
      </EditDialog>
    </div>
  );
}
