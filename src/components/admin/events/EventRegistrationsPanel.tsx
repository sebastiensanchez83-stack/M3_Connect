import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Check, CheckCheck, Clock, Download, HelpCircle, ListChecks, Mail, RefreshCw, Undo2, UserCheck, Users, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { EditDialog } from '@/components/home/dashboard/EditKit';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  ADMIN_BTN, AdminEmpty, AdminFilterBar, AdminKpiCard, AdminLoading, AdminStatusPill,
} from '../AdminUI';
import { Field, Note, TEXTAREA, ToggleRow } from './editorUi';
import {
  EditorError, STATUS_TONE, STATUS_WORDS, downloadCsv, editorErrorText, formatInZone, loadGuests,
  registrationStaff, setAttended, sourceText, staffErrorText,
  type EventKind, type GuestRow, type GuestStatus, type QuestionRow, type RegistrationMode,
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
function answerText(q: QuestionRow | undefined, v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  const label = (x: string) => q?.options?.find((o) => o.value === x)?.label ?? x;
  if (Array.isArray(v)) return v.map((x) => label(String(x))).join('; ');
  return label(String(v));
}

/**
 * The registrations of a core_v2 event: the list, decisions (through the
 * `registration` function, which e-mails the people concerned), attendance
 * (gl_checkin_v2) and the CSV export. Rows are read from gl_guest (staff RLS);
 * no token is read or shown.
 */
export function EventRegistrationsPanel({
  glEventId,
  kind,
  mode,
  capacity,
  slug,
  timezone,
  questions,
  onCount,
}: {
  glEventId: string;
  kind: EventKind;
  mode: RegistrationMode;
  capacity: number | null;
  slug: string;
  timezone: string;
  questions: QuestionRow[];
  onCount?: (n: number) => void;
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
  const [decision, setDecision] = useState<{ kind: Decision; ids: string[] } | null>(null);
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

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const list = await loadGuests(glEventId);
      setRows(list);
      onCount?.(list.length);
      setSelected((s) => new Set([...s].filter((id) => list.some((g) => g.id === id))));
    } catch (e) {
      setLoadError(editorErrorText(e));
    }
    setLoading(false);
  }, [glEventId, onCount]);
  useEffect(() => { void load(); }, [load]);

  const byKey = useMemo(() => new Map(questions.map((x) => [x.key, x])), [questions]);
  const counts = useMemo(() => ({
    confirmed: rows.filter((g) => g.status === 'confirmed').length,
    review: rows.filter((g) => inView(g, 'review')).length,
    waitlisted: rows.filter((g) => g.status === 'waitlisted').length,
    attended: rows.filter((g) => !!g.checked_in_at).length,
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

  /* ---------------------------------------------------------- decisions */

  const openDecision = (kindOf: Decision, list: GuestRow[]) => {
    const ids = list.filter((g) => DECIDE_FROM[kindOf].includes(g.status)).map((g) => g.id);
    if (!ids.length) {
      toast({ title: t('adminEvents.regs.nobody', 'Nobody in the selection can get this decision'), description: t('adminEvents.regs.nobodyBody', 'Look at their status: someone already confirmed or cancelled is left as is.') });
      return;
    }
    setDialogError(null);
    setInfoText('');
    setNotifyReject(true);
    setDecision({ kind: kindOf, ids });
    setDecisionOpen(true);
  };

  const runDecision = async (force = false) => {
    if (!decision) return;
    if (decision.kind === 'request_info' && !infoText.trim()) {
      setDialogError(t('adminEvents.regs.infoNeeded', 'Write what you need to know.'));
      return;
    }
    setBusy(true);
    setDialogError(null);
    const res = await registrationStaff<{ ok?: boolean; changed?: string[]; skipped?: string[]; sent?: number; failed?: number; held?: number; capacity?: number; adding?: number }>({
      action: 'decide',
      gl_event_id: glEventId,
      guest_ids: decision.ids,
      decision: decision.kind,
      info_request: decision.kind === 'request_info' ? infoText.trim() : undefined,
      notify: decision.kind === 'reject' ? notifyReject : true,
      force: force || undefined,
    });
    setBusy(false);
    if (res.error === 'capacity' || res.error === 'ticket_capacity') {
      setOverCapacity({ held: Number(res.held ?? 0), capacity: Number(res.capacity ?? 0), adding: Number(res.adding ?? 0) });
      return;
    }
    if (res.error || res.ok !== true) {
      setDialogError(staffErrorText(res.error));
      return;
    }
    const changed = res.changed?.length ?? 0;
    const done: Record<Decision, string> = {
      approve: t('adminEvents.regs.doneApprove', '{{n}} confirmed', { n: changed }),
      reject: t('adminEvents.regs.doneReject', '{{n}} not accepted', { n: changed }),
      waitlist: t('adminEvents.regs.doneWaitlist', '{{n}} on the waiting list', { n: changed }),
      request_info: t('adminEvents.regs.doneInfo', '{{n}} asked for a detail', { n: changed }),
    };
    const mails = typeof res.sent === 'number'
      ? t('adminEvents.regs.mailsSent', '{{n}} e-mail(s) sent.', { n: res.sent }) + (res.failed ? ' ' + t('adminEvents.regs.mailsFailed', '{{n}} could not be sent.', { n: res.failed }) : '')
      : '';
    toast({ title: done[decision.kind], description: mails || undefined, variant: res.failed ? 'destructive' : undefined });
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

  /* ---------------------------------------------------------- other actions */

  const sendLink = async (g: GuestRow) => {
    setBusy(true);
    const res = await registrationStaff<{ ok?: boolean }>({ action: 'send_status_link', guest_id: g.id });
    setBusy(false);
    if (res.error || res.ok !== true) toast({ title: t('adminEvents.regs.linkFailed', 'The link could not be sent'), description: staffErrorText(res.error), variant: 'destructive' });
    else toast({ title: t('adminEvents.regs.linkSent', 'Personal link sent to {{email}}', { email: g.email }) });
  };

  const exportCsv = () => {
    const head = [
      'First name', 'Last name', 'E-mail', 'Company', 'Job title', 'Phone', 'Country', 'Status', 'Registered on',
      'Attended', 'Has an account', 'News by e-mail', 'Came from',
      ...questions.map((x) => x.label),
    ];
    const lines = rows.map((g) => [
      g.first_name, g.last_name, g.email, g.company, g.job_title, g.phone, g.country,
      STATUS_WORDS[g.status] ?? g.status,
      g.created_at ? new Date(g.created_at).toISOString().slice(0, 16).replace('T', ' ') : '',
      g.checked_in_at ? 'Yes' : '',
      g.user_id ? 'Yes' : '',
      g.consents && g.consents.marketing_at ? 'Yes' : '',
      sourceText(g.source_detail),
      ...questions.map((x) => answerText(x, g.answers?.[x.key])),
    ]);
    downloadCsv(`${slug || 'event'}-registrations-${new Date().toISOString().slice(0, 10)}.csv`, [head, ...lines]);
  };

  /* ---------------------------------------------------------- render */

  if (loading) return <AdminLoading />;
  if (loadError) return <Note tone="danger">{loadError}</Note>;

  const reviewMode = mode !== 'instant';
  const statusFilterWords: Record<View, string> = {
    all: t('adminEvents.regs.viewAll', 'Everyone'),
    review: t('adminEvents.regs.viewReview', 'To review'),
    confirmed: t('adminEvents.regs.viewConfirmed', 'Confirmed'),
    waitlisted: t('adminEvents.regs.viewWaitlist', 'Waiting list'),
    attended: t('adminEvents.regs.viewAttended', 'Attended'),
    closed: t('adminEvents.regs.viewClosed', 'Not accepted or cancelled'),
  };
  const dialogTitle: Record<Decision, string> = {
    approve: t('adminEvents.regs.approveTitle', 'Confirm {{n}} registration(s)?', { n: decision?.ids.length ?? 0 }),
    reject: t('adminEvents.regs.rejectTitle', 'Turn down {{n}} registration(s)?', { n: decision?.ids.length ?? 0 }),
    waitlist: t('adminEvents.regs.waitlistTitle', 'Put {{n}} on the waiting list?', { n: decision?.ids.length ?? 0 }),
    request_info: t('adminEvents.regs.infoTitle', 'Ask {{n}} person(s) for a detail', { n: decision?.ids.length ?? 0 }),
  };
  const dialogBody: Record<Decision, string> = {
    approve: kind === 'webinar'
      ? t('adminEvents.regs.approveBodyWebinar', 'Each person gets a confirmation e-mail with the calendar file and the join link (when it is set).')
      : t('adminEvents.regs.approveBody', 'Each person gets a confirmation e-mail with their entry pass.'),
    reject: t('adminEvents.regs.rejectBody', 'Their registration is closed. You choose whether they are told.'),
    waitlist: t('adminEvents.regs.waitlistBody', 'Each person is told they are on the waiting list.'),
    request_info: t('adminEvents.regs.infoBody', 'They get an e-mail with your question and a link to answer. Their registration comes back to "To review" when they answer.'),
  };
  const saveWord: Record<Decision, string> = {
    approve: t('adminEvents.regs.approve', 'Confirm'),
    reject: t('adminEvents.regs.reject', 'Turn down'),
    waitlist: t('adminEvents.regs.waitlist', 'Waiting list'),
    request_info: t('adminEvents.regs.ask', 'Send the question'),
  };

  return (
    <div className="space-y-5">
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

      {kind === 'webinar' && counts.confirmed > 0 && (
        <div className="flex flex-col gap-3 rounded-card border border-rule bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[14px] leading-5 text-meta">
            {t('adminEvents.regs.attendTip', 'After the webinar, mark who attended: the others get the "Sorry we missed you" e-mail with the replay.')}
          </p>
          <Button type="button" variant="outline" size="sm" className={cn(ADMIN_BTN, 'shrink-0')} onClick={() => { setPasteText(''); setPasteResult(null); setDialogError(null); setPasteOpen(true); }}>
            <ListChecks className="mr-1.5 h-4 w-4" aria-hidden="true" /> {t('adminEvents.regs.paste', 'Mark attendance from a list')}
          </Button>
        </div>
      )}

      {chosen.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-card border border-navy/30 bg-foam p-3" role="region" aria-label={t('adminEvents.regs.selection', 'Selection')}>
          <span className="mr-1 text-[14px] font-semibold text-navy">{t('adminEvents.regs.selected', '{{n}} selected', { n: chosen.length })}</span>
          {(reviewMode || chosen.some((g) => g.status === 'waitlisted')) && (
            <>
              <Button type="button" size="sm" variant="outline" className={ADMIN_BTN} disabled={busy} onClick={() => openDecision('approve', chosen)}>
                <Check className="mr-1.5 h-4 w-4" aria-hidden="true" /> {t('adminEvents.regs.approve', 'Confirm')}
              </Button>
              {reviewMode && (
                <Button type="button" size="sm" variant="outline" className={ADMIN_BTN} disabled={busy} onClick={() => openDecision('waitlist', chosen)}>
                  <Clock className="mr-1.5 h-4 w-4" aria-hidden="true" /> {t('adminEvents.regs.waitlist', 'Waiting list')}
                </Button>
              )}
              <Button type="button" size="sm" variant="outline" className={ADMIN_BTN} disabled={busy} onClick={() => openDecision('request_info', chosen)}>
                <HelpCircle className="mr-1.5 h-4 w-4" aria-hidden="true" /> {t('adminEvents.regs.askShort', 'Ask a detail')}
              </Button>
              <Button type="button" size="sm" variant="outline" className={ADMIN_BTN} disabled={busy} onClick={() => openDecision('reject', chosen)}>
                <X className="mr-1.5 h-4 w-4" aria-hidden="true" /> {t('adminEvents.regs.reject', 'Turn down')}
              </Button>
            </>
          )}
          <Button type="button" size="sm" variant="outline" className={ADMIN_BTN} disabled={busy} onClick={() => void markAttended(chosen)}>
            <UserCheck className="mr-1.5 h-4 w-4" aria-hidden="true" /> {t('adminEvents.regs.markAttended', 'Mark attended')}
          </Button>
          <button type="button" onClick={() => setSelected(new Set())} className="ml-auto rounded-pill px-3 py-1.5 text-[13px] font-semibold text-navy hover:bg-white focus:outline-none focus-visible:shadow-focus">
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
              <Checkbox
                checked={allVisibleSelected}
                onCheckedChange={toggleAll}
                aria-label={t('adminEvents.regs.selectAll', 'Select everyone shown')}
                className="h-5 w-5 rounded-[6px] border-navy/40 data-[state=checked]:bg-navy"
              />
              <span className="text-meta-caps">{t('adminEvents.regs.people', '{{n}} people', { n: visible.length })}</span>
            </div>
            <ul className="divide-y divide-rule">
              {visible.map((g) => (
                <li key={g.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <Checkbox
                      checked={selected.has(g.id)}
                      onCheckedChange={() => toggle(g.id)}
                      aria-label={t('adminEvents.regs.select', 'Select {{name}}', { name: fullName(g) })}
                      className="mt-0.5 h-5 w-5 rounded-[6px] border-navy/40 data-[state=checked]:bg-navy"
                    />
                    <button type="button" onClick={() => { setDetail(g); setDetailOpen(true); }} className="min-w-0 rounded-sm text-left focus:outline-none focus-visible:shadow-focus">
                      <span className="block text-[15px] font-semibold leading-5 text-navy [overflow-wrap:anywhere]">{fullName(g)}</span>
                      <span className="block text-[13px] leading-[18px] text-meta [overflow-wrap:anywhere]">
                        {g.email}{g.company ? ` · ${g.company}` : ''}{g.job_title ? `, ${g.job_title}` : ''}
                      </span>
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 pl-8 sm:pl-0">
                    <AdminStatusPill tone={STATUS_TONE[g.status] ?? 'neutral'}>{STATUS_WORDS[g.status] ?? g.status}</AdminStatusPill>
                    {g.checked_in_at && <AdminStatusPill tone="success" icon={CheckCheck}>{t('adminEvents.regs.wasThere', 'Attended')}</AdminStatusPill>}
                    <span className="text-[12px] tabular-nums text-meta">
                      {new Date(g.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                    </span>
                    {DECIDE_FROM.approve.includes(g.status) ? (
                      <Button type="button" size="sm" variant="outline" className={cn(ADMIN_BTN, 'h-9')} disabled={busy} onClick={() => openDecision('approve', [g])}>
                        <Check className="mr-1 h-4 w-4" aria-hidden="true" /> {t('adminEvents.regs.approve', 'Confirm')}
                      </Button>
                    ) : g.status === 'confirmed' ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className={cn(ADMIN_BTN, 'h-9')}
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
              <AdminStatusPill tone={STATUS_TONE[detail.status] ?? 'neutral'}>{STATUS_WORDS[detail.status] ?? detail.status}</AdminStatusPill>
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
                [t('adminEvents.regs.asked', 'Detail asked'), detail.info_request],
                [t('adminEvents.regs.linkOpened', 'Opened their link'), detail.link_opened_at ? formatInZone(detail.link_opened_at, timezone) : ''],
                [t('adminEvents.regs.news', 'News by e-mail'), detail.consents?.marketing_at ? t('adminEvents.yes', 'Yes') : ''],
                [t('adminEvents.regs.cameFrom', 'Came from'), sourceText(detail.source_detail)],
                ...questions.map((x) => [x.label, answerText(byKey.get(x.key), detail.answers?.[x.key])] as [string, string]),
              ] as [string, unknown][]).filter(([, val]) => val !== null && val !== undefined && val !== '').map(([k, val]) => (
                <div key={k} className="contents">
                  <dt className="font-semibold text-navy">{k}</dt>
                  <dd className="text-ink [overflow-wrap:anywhere]">{String(val)}</dd>
                </div>
              ))}
            </dl>
            <div className="flex flex-wrap gap-2 border-t border-rule pt-4">
              <Button type="button" size="sm" variant="outline" className={ADMIN_BTN} disabled={busy} onClick={() => void sendLink(detail)}>
                <Mail className="mr-1.5 h-4 w-4" aria-hidden="true" /> {t('adminEvents.regs.sendLink', 'Send their personal link again')}
              </Button>
              {DECIDE_FROM.approve.includes(detail.status) && (
                <Button type="button" size="sm" variant="outline" className={ADMIN_BTN} disabled={busy} onClick={() => { setDetailOpen(false); openDecision('approve', [detail]); }}>
                  <Check className="mr-1.5 h-4 w-4" aria-hidden="true" /> {t('adminEvents.regs.approve', 'Confirm')}
                </Button>
              )}
              {DECIDE_FROM.request_info.includes(detail.status) && (
                <Button type="button" size="sm" variant="outline" className={ADMIN_BTN} disabled={busy} onClick={() => { setDetailOpen(false); openDecision('request_info', [detail]); }}>
                  <HelpCircle className="mr-1.5 h-4 w-4" aria-hidden="true" /> {t('adminEvents.regs.askShort', 'Ask a detail')}
                </Button>
              )}
              {DECIDE_FROM.reject.includes(detail.status) && (
                <Button type="button" size="sm" variant="outline" className={ADMIN_BTN} disabled={busy} onClick={() => { setDetailOpen(false); openDecision('reject', [detail]); }}>
                  <X className="mr-1.5 h-4 w-4" aria-hidden="true" /> {t('adminEvents.regs.reject', 'Turn down')}
                </Button>
              )}
            </div>
          </div>
        )}
      </EditDialog>
    </div>
  );
}
