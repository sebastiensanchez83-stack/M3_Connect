import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  Check, CheckCheck, CheckCircle2, Clock, Copy, Download, HelpCircle, KeyRound, ListChecks, Mail, MailPlus, QrCode, RefreshCw, Reply,
  Send, Undo2, UserCheck, UserPlus, Users, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { EditDialog } from '@/components/home/dashboard/EditKit';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  AdminEmpty, AdminFilterBar, AdminKpiCard, AdminLoading, AdminStatusPill,
} from '../AdminUI';
import { EDITOR_BTN, Field, INPUT, Note, TEXTAREA, ToggleRow } from './editorUi';
import {
  ACCOUNT_TONE, EditorError, MAX_TEST_INVITES, NO_CAPS, STATUS_TONE, TEST_INVITE_DOMAINS, accountRunnable, accountSendable,
  accountState, accountWord, confirmationMailSent, downloadCsv, editorErrorText, formatInZone, historyWord, isEmail, isTestAddress,
  isoToWall, loadConfirmationMails, loadGuests, loadHistory, loadProvisionJobs, paymentWord, provisionStaff, registrationStaff,
  setAttended, sourceText, staffErrorText, statusWord,
  type EventKind, type GuestRow, type GuestStatus, type HistoryRow, type ProvisionJob, type QuestionRow, type RegistrationCaps,
  type RegistrationMode, type TicketRow,
} from './eventAdmin';
import { useAuth } from '@/contexts/AuthContext';

type Decision = 'approve' | 'reject' | 'waitlist' | 'request_info';
type View = 'all' | 'review' | 'invited' | 'confirmed' | 'waitlisted' | 'attended' | 'closed';

/** The payment states a filter can pick (gl_guest.payment_status; display only until December). */
const PAYMENTS = ['none', 'due', 'pending', 'invoiced', 'paid', 'waived', 'refunded'] as const;

/**
 * Up to 500 people per paste, sent to the registration function 100 at a time (its body
 * limit is 64 KiB: 500 people with names and companies are about 65 KB). provision-person
 * takes 100 jobs per call.
 */
const MAX_INVITES = 500;
const INVITE_CHUNK = 100;
const MAX_JOB_IDS = 100;
/** "Send the confirmation again" for many people: 25 per press (one e-mail with a QR code each). */
const MAX_RESEND = 25;

/** A person to invite, read from one pasted line. */
interface Invitee { email: string; first_name: string; last_name: string; company: string }

/** An address inside pasted text: no "mailto:", no trailing dot, bracket or parenthesis. */
const ADDRESS_RE = /[^\s<>"(),;:@[\]]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z0-9-]{2,}/g;
// An apostrophe may sit inside an address (o'brien@x.com), not before it ('jane@x.com').
const addressesIn = (s: string) => (s.match(ADDRESS_RE) || []).map((m) => m.replace(/^'+/, '')).filter((m) => !m.startsWith('@'));

/** One piece of text with exactly one address -> one person (the other cells: first name, last name, company). */
function personFrom(piece: string, email: string): Invitee {
  // Words only: brackets, quotes and stray dots around the address are not names.
  const clean = (s: string) => s.replace(/[<>"()[\]]/g, ' ').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).join(' ');
  let first = '';
  let last = '';
  let company = '';
  const bracket = piece.indexOf(`<${email}`);
  if (bracket >= 0) {
    // An e-mail program's "Display Name <address>" ("Doe, Jane <…>" is last name first).
    const name = clean(piece.slice(0, bracket).replace(/^[\s;,]+/, ''));
    const comma = name.indexOf(',');
    if (comma >= 0) {
      last = name.slice(0, comma).trim();
      first = name.slice(comma + 1).trim();
    } else {
      const words = name.split(' ').filter(Boolean);
      first = words[0] || '';
      last = words.slice(1).join(' ');
    }
  } else if (/[,;\t]/.test(piece)) {
    // A spreadsheet row: empty cells keep their place ("Jane,,jane@x.com,NewCo": no last name).
    const cells = piece.split(/[,;\t]/);
    const at = cells.findIndex((c) => c.includes(email));
    const own = at >= 0 ? clean(cells[at].replace(email, ' ')) : '';
    const others = cells.filter((_, i) => i !== at).map(clean);
    if (own) {
      // "Jane Doe <jane@x.com>, NewCo": the name sits with the address.
      const words = own.split(' ');
      first = words[0] || '';
      last = words.slice(1).join(' ');
      company = others.find(Boolean) || '';
    } else {
      [first = '', last = '', company = ''] = others;
    }
  } else {
    const words = clean(piece.replace(email, ' ')).split(' ').filter(Boolean);
    first = words[0] || '';
    last = words.slice(1).join(' ');
  }
  return { email: email.toLowerCase(), first_name: first.slice(0, 100), last_name: last.slice(0, 100), company: company.slice(0, 200) };
}

/**
 * Pasted text -> people to invite. One person per line, in any of these shapes:
 *   jane@example.com
 *   Jane Doe <jane@example.com>
 *   Jane, Doe, jane@example.com, NewCo        (commas, semicolons or tabs: a spreadsheet)
 * A line with several addresses (an Outlook "To:" line, "Jane <a@x.com>; John <b@y.com>")
 * is split into one person per address.
 */
function parseInvitees(text: string): { people: Invitee[]; invalid: string[]; repeated: number; multi: number } {
  const people: Invitee[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  let repeated = 0;
  let multi = 0;
  const add = (p: Invitee, raw: string) => {
    if (!isEmail(p.email)) { invalid.push(raw); return; }
    if (seen.has(p.email)) { repeated++; return; }
    seen.add(p.email);
    people.push(p);
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/mailto:/gi, ' ').trim();
    if (!line) continue;
    const found = addressesIn(line);
    if (!found.length) { invalid.push(raw.trim()); continue; }
    if (found.length === 1) { add(personFrom(line, found[0]), raw.trim()); continue; }
    multi++;
    // Several people on one line: split where each piece holds one address.
    let pieces: string[] | null = null;
    for (const sep of [/;/, /[,\t]/, /\s+/]) {
      const parts = line.split(sep).map((s) => s.trim()).filter((s) => addressesIn(s).length > 0);
      if (parts.length === found.length && parts.every((s) => addressesIn(s).length === 1)) { pieces = parts; break; }
    }
    if (pieces) for (const piece of pieces) add(personFrom(piece, addressesIn(piece)[0]), piece);
    else for (const email of found) add({ email: email.toLowerCase(), first_name: '', last_name: '', company: '' }, email);
  }
  return { people, invalid, repeated, multi };
}

/** Which statuses each staff decision applies to (gl_decide_v2 skips the others). */
const DECIDE_FROM: Record<Decision, GuestStatus[]> = {
  approve: ['requested', 'needs_info', 'waitlisted'],
  reject: ['requested', 'needs_info', 'waitlisted'],
  waitlist: ['requested', 'needs_info'],
  request_info: ['requested', 'waitlisted'],
};

/**
 * With a registration function that says decide_from_invited: staff can confirm an
 * invited person who answered by phone, or withdraw an invitation (gl_decide_v2 takes
 * 'invited' for approve and reject).
 */
const DECIDE_FROM_INVITED: Record<Decision, GuestStatus[]> = {
  ...DECIDE_FROM,
  approve: [...DECIDE_FROM.approve, 'invited'],
  reject: [...DECIDE_FROM.reject, 'invited'],
};

/**
 * The registration function takes 200 registrations per decision (gl_decide_v2): larger
 * selections go in turns. On-site confirmations go 25 at a time: each sends an e-mail
 * with a QR code, one after another, inside the call (200 could run past its time limit).
 */
const MAX_DECIDE_IDS = 200;
const MAX_ONSITE_CONFIRM_IDS = 25;

/** The statuses whose e-mail the registration function sends again (action resend). */
const RESENDABLE: GuestStatus[] = ['confirmed', 'waitlisted', 'requested', 'needs_info'];

const inView = (g: GuestRow, view: View): boolean => {
  switch (view) {
    case 'review': return g.status === 'requested' || g.status === 'needs_info';
    case 'invited': return g.status === 'invited';
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
 * Webinars: decisions and attendance. On-site events: the list only, until on-site
 * registration is live for this event (onsite_v2 on, or a saved hidden test): then
 * decisions (confirming one mints the door pass and queues the account), filters by
 * participation type and payment, invitations, personal links, and the account set-up of
 * each person (account_provision_job, provision-person "Send account e-mails now"). The
 * on-site editor opened with ?editor=new on a real event while onsite_v2 is off keeps
 * today's list: the registration function would e-mail links to a page the live site
 * does not have.
 * What the deployed registration function cannot do yet (invitations, copying a link) is
 * not shown: see RegistrationCaps.
 * The account e-mail never goes before the confirmation e-mail with the QR code: a
 * confirmed person whose confirmation is not logged (gl_email_log 'reg_confirmed') gets
 * "Send the confirmation again", never "Send their account e-mail now".
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
  onsiteEditor = false,
  tickets = [],
  accountTiming = 'with_confirmation',
  publicRequests = true,
  onsiteNotLive = false,
  hiddenTest = false,
  caps = NO_CAPS,
  onConfirmedCount,
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
  /** On-site registration is live for this event (onsite_v2 on, or a saved hidden test): decisions and the on-site tools. */
  onsiteEditor?: boolean;
  /** The on-site editor is open (?editor=new) on a real event while onsite_v2 is off: today's list, with a note. */
  onsiteNotLive?: boolean;
  /** Saved as a hidden test: invitations go to M3's own addresses only. */
  hiddenTest?: boolean;
  /** What the deployed registration function can do (invitations, status links). */
  caps?: RegistrationCaps;
  /** The number of confirmed people, each time the list is read. */
  onConfirmedCount?: (n: number) => void;
  /** Participation types as saved (labels, filter, invitations). */
  tickets?: TicketRow[];
  /** When the account e-mail goes (gl_event.account_email_timing as saved). */
  accountTiming?: 'with_confirmation' | 'after_event';
  /** Invitation mode: people can also ask for an invitation. */
  publicRequests?: boolean;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const onsite = kind === 'onsite' && onsiteEditor;
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
  const [decision, setDecision] = useState<{ kind: Decision; people: { id: string; name: string }[]; skipped: number; invitedOnly?: boolean } | null>(null);
  const [decisionOpen, setDecisionOpen] = useState(false);
  const [notifyReject, setNotifyReject] = useState(true);
  const [infoText, setInfoText] = useState('');
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [overCapacity, setOverCapacity] = useState<{ held: number; capacity: number; adding: number; ticket?: string | null } | null>(null);
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
  // On-site editor.
  const [ticketFilter, setTicketFilter] = useState<string>('all');
  const [payFilter, setPayFilter] = useState<string>('all');
  const [jobs, setJobs] = useState<Map<string, ProvisionJob> | null>(null);
  const [jobsFailed, setJobsFailed] = useState(false);
  // The latest confirmation e-mail with the QR code of each confirmed person (gl_email_log).
  const [mails, setMails] = useState<Map<string, string> | null>(null);
  const [validatePerson, setValidatePerson] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteText, setInviteText] = useState('');
  const [inviteTicket, setInviteTicket] = useState<string>('');
  const [inviteMessage, setInviteMessage] = useState('');
  const [inviteValidate, setInviteValidate] = useState(true);
  const [inviteResult, setInviteResult] = useState<{ invited: number; already: number; sent: number | null; failed: number } | null>(null);
  const [acct, setAcct] = useState<{ kind: 'send' | 'run'; jobIds: string[] } | null>(null);
  const [acctOpen, setAcctOpen] = useState(false);
  const [acctError, setAcctError] = useState<string | null>(null);
  const [link, setLink] = useState<{ id: string; url: string } | null>(null);

  const decisionsAllowed = kind === 'webinar' || onsite;
  const decideFrom = onsite && caps.decideInvited ? DECIDE_FROM_INVITED : DECIDE_FROM;
  const started = !!startIso && Date.now() >= Date.parse(startIso);
  const attendanceAllowed = kind === 'webinar' && started;
  const activeTickets = tickets.filter((x) => x.active);
  const ticketLabel = useCallback((key: string | null) => (key ? tickets.find((x) => x.key === key)?.label || key : ''), [tickets]);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const list = await loadGuests(glEventId);
      setRows(list);
      onCount?.(list.length);
      onConfirmedCount?.(list.filter((g) => g.status === 'confirmed').length);
      setSelected((s) => new Set([...s].filter((id) => list.some((g) => g.id === id))));
      if (onsite) {
        // The account set-up of each person, and their confirmation e-mail: a failed read
        // leaves the account column empty and offers no "send now", never hides the list.
        const confirmed = list.filter((g) => g.status === 'confirmed').map((g) => g.id);
        try {
          const [j, m] = await Promise.all([loadProvisionJobs(list.map((g) => g.id)), loadConfirmationMails(confirmed)]);
          setJobs(j);
          setMails(m);
          setJobsFailed(false);
        } catch {
          setJobs(null);
          setMails(null);
          setJobsFailed(true);
        }
      }
    } catch (e) {
      setLoadError(editorErrorText(e, t));
    }
    setLoading(false);
  }, [glEventId, onCount, onConfirmedCount, t, onsite]);
  useEffect(() => { void load(); }, [load]);

  /** Confirmed, and their confirmation e-mail with the QR code is logged (null: not known). */
  const passSent = useCallback((g: GuestRow): boolean | null => {
    if (g.status !== 'confirmed' || !mails) return null;
    return confirmationMailSent(g, mails.get(g.id));
  }, [mails]);

  const acctOf = useCallback((g: GuestRow) => {
    const job = jobs?.get(g.id);
    const state = accountState(g, job);
    // "Send now" only once the confirmation e-mail has gone (the account e-mail comes second).
    return { job, state, sendable: !!job && accountSendable(state) && passSent(g) === true };
  }, [jobs, passSent]);

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
    invited: rows.filter((g) => g.status === 'invited').length,
    waitlisted: rows.filter((g) => g.status === 'waitlisted').length,
    attended: rows.filter((g) => !!g.checked_in_at).length,
    confirmedAttended: rows.filter((g) => g.status === 'confirmed' && !!g.checked_in_at).length,
  }), [rows]);

  // Accounts of confirmed on-site registrations: what can be sent or run now.
  const acctCounts = useMemo(() => {
    const out = { sendable: [] as string[], runnable: [] as string[], failed: 0, sent: 0, waitingProof: 0, due: [] as string[], waitingPass: 0 };
    if (!onsite || !jobs) return out;
    for (const g of rows) {
      const { job, state, sendable } = acctOf(g);
      if (!job) continue;
      if (sendable) out.sendable.push(job.id);
      else if (accountSendable(state) && passSent(g) === false) out.waitingPass++;
      if (accountRunnable(state)) out.runnable.push(job.id);
      if (state === 'failed' || state === 'gave_up') out.failed++;
      if (state === 'email_sent') out.sent++;
      if (state === 'pending_link') out.waitingProof++;
      if (state === 'email_due' && job.email_due_at) out.due.push(job.email_due_at);
    }
    out.due.sort();
    return out;
  }, [rows, jobs, onsite, acctOf, passSent]);

  // Confirmed people whose confirmation e-mail with the QR code is not logged: sent again
  // from here (it carries their entry pass; their account e-mail waits for it).
  const passMissing = useMemo(
    () => (onsite && mails ? rows.filter((g) => passSent(g) === false) : []),
    [rows, onsite, mails, passSent],
  );

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((g) => inView(g, view)
      && (!onsite || ticketFilter === 'all' || (ticketFilter === '__none' ? !g.ticket_key : g.ticket_key === ticketFilter))
      && (!onsite || payFilter === 'all' || (g.payment_status || 'none') === payFilter)
      && (!needle || [g.first_name, g.last_name, g.email, g.company, g.job_title]
        .some((x) => (x || '').toLowerCase().includes(needle))));
  }, [rows, view, q, onsite, ticketFilter, payFilter]);

  // A selection is about the people on screen: a new filter or search starts a new one,
  // and a decision never reaches someone the list does not show.
  useEffect(() => { setSelected(new Set()); }, [view, q, ticketFilter, payFilter]);
  const allVisibleSelected = visible.length > 0 && visible.every((g) => selected.has(g.id));
  const toggleAll = () => setSelected(allVisibleSelected ? new Set() : new Set(visible.map((g) => g.id)));
  const toggle = (id: string) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const chosen = visible.filter((g) => selected.has(g.id));
  const canDecide = (d: Decision, list: GuestRow[]) => decisionsAllowed && list.some((g) => decideFrom[d].includes(g.status));
  /** Everyone concerned is an invited person: "Mark as accepted" / "Withdraw the invitation". */
  const allInvited = (d: Decision, list: GuestRow[]) => {
    const concerned = list.filter((g) => decideFrom[d].includes(g.status));
    return concerned.length > 0 && concerned.every((g) => g.status === 'invited');
  };
  const canMark = attendanceAllowed && chosen.some((g) => g.status === 'confirmed' && !g.checked_in_at);

  /* ---------------------------------------------------------- decisions */

  const openDecision = (kindOf: Decision, list: GuestRow[]) => {
    const people = list.filter((g) => decideFrom[kindOf].includes(g.status)).map((g) => ({ id: g.id, name: fullName(g) }));
    if (!people.length) {
      toast({ title: t('adminEvents.regs.nobody', 'Nobody in the selection can get this decision'), description: t('adminEvents.regs.nobodyBody', 'Look at their status: someone already confirmed or cancelled is left as is.') });
      return;
    }
    const invitedOnly = allInvited(kindOf, list);
    setDialogError(null);
    setInfoText('');
    // A withdrawn invitation is not announced by default (they never answered).
    setNotifyReject(!(kindOf === 'reject' && invitedOnly));
    setValidatePerson(true);
    setDecision({ kind: kindOf, people, skipped: list.length - people.length, invitedOnly });
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
    // In turns of 200 (the function keeps only the first 200 ids of one call); on-site
    // confirmations in turns of 25, each turn sending its e-mails with a QR code.
    const step = onsite && decision.kind === 'approve' ? MAX_ONSITE_CONFIRM_IDS : MAX_DECIDE_IDS;
    for (let i = 0; i < people.length; i += step) {
      const chunk = people.slice(i, i + step);
      const res = await registrationStaff<{ ok?: boolean; changed?: string[]; skipped?: string[]; sent?: number; failed?: number; held?: number; capacity?: number; adding?: number; ticket_key?: string }>({
        action: 'decide',
        gl_event_id: glEventId,
        guest_ids: chunk.map((p) => p.id),
        decision: decision.kind,
        info_request: decision.kind === 'request_info' ? infoText.trim() : undefined,
        notify: decision.kind === 'reject' ? notifyReject : true,
        force: force || undefined,
        // On-site: stored on the account job the confirmation queues (no company step: the
        // company they typed stays on their profile).
        ...(onsite && decision.kind === 'approve' ? { validate_person: validatePerson, org_action: { mode: 'none' } } : {}),
      });
      const stopped = res.error === 'capacity' || res.error === 'ticket_capacity' || !!res.error || res.ok !== true;
      if (stopped) {
        setBusy(false);
        // What is left to decide stays in the dialog; what was done is said.
        setDecision({ ...decision, people: people.slice(i), skipped: 0 });
        if (changed) {
          toast({ title: doneText(decision.kind, changed), description: [t('adminEvents.regs.partial', 'The others are not done yet.'), mailsKnown ? mailsText(sent, failed) : ''].filter(Boolean).join(' ') });
        }
        // A turn cut short (time limit, connection) may still have confirmed people: the list
        // then shows who did not get their confirmation e-mail.
        void load();
        if (res.error === 'capacity' || res.error === 'ticket_capacity') {
          setOverCapacity({
            held: Number(res.held ?? 0), capacity: Number(res.capacity ?? 0), adding: Number(res.adding ?? 0),
            ticket: res.error === 'ticket_capacity' ? ticketLabel(res.ticket_key ?? null) || null : null,
          });
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

  /** "Send the last e-mail again" (the confirmation with the QR code, the waiting-list e-mail…). */
  const resendStatus = async (g: GuestRow) => {
    setBusy(true);
    const res = await registrationStaff<{ ok?: boolean }>({ action: 'resend', guest_id: g.id });
    setBusy(false);
    if (res.error || res.ok !== true) toast({ title: t('adminEvents.regs.resendFailed', 'The e-mail could not be sent again'), description: staffErrorText(res.error, t), variant: 'destructive' });
    else toast({ title: t('adminEvents.regs.resent', 'E-mail sent again to {{email}}', { email: g.email }) });
    // A confirmation sent again is logged: their account e-mail can follow.
    if (onsite && g.status === 'confirmed') void load();
  };

  /** The confirmation with the QR code again, for confirmed people who did not get it (25 per press). */
  const resendPasses = async () => {
    const list = passMissing.slice(0, MAX_RESEND);
    if (!list.length) return;
    setBusy(true);
    let ok = 0;
    let bad = 0;
    let stop: string | undefined;
    for (const g of list) {
      const res = await registrationStaff<{ ok?: boolean }>({ action: 'resend', guest_id: g.id });
      if (!res.error && res.ok === true) ok++;
      else {
        bad++;
        // The session ended or the service is missing: the others would fail the same way.
        if (['forbidden', 'session_expired', 'sign_in_required', 'unavailable', 'NOT_FOUND', 'unknown_action'].includes(String(res.error))) { stop = res.error; break; }
      }
    }
    setBusy(false);
    toast({
      title: ok === 1 ? t('adminEvents.regs.passResentOne', 'One confirmation sent again') : t('adminEvents.regs.passResentN', '{{n}} confirmations sent again', { n: ok }),
      description: bad ? [t('adminEvents.regs.passResentFailed', '{{n}} could not be sent.', { n: bad }), stop ? staffErrorText(stop, t) : ''].filter(Boolean).join(' ') : undefined,
      variant: bad ? 'destructive' : undefined,
    });
    await load();
  };

  /**
   * "Copy their personal link": the registration function mints a fresh status link for
   * staff (action status_link). Shown in the window to copy: whoever holds it can manage
   * that registration, so it goes to that person only.
   */
  const copyLink = async (g: GuestRow) => {
    setBusy(true);
    const res = await registrationStaff<{ ok?: boolean; url?: string }>({ action: 'status_link', guest_id: g.id });
    setBusy(false);
    if (res.error || res.ok !== true || typeof res.url !== 'string') {
      toast({ title: t('adminEvents.regs.copyFailed', 'The link could not be made'), description: staffErrorText(res.error, t), variant: 'destructive' });
      return;
    }
    setLink({ id: g.id, url: res.url });
    try {
      await navigator.clipboard.writeText(res.url);
      toast({ title: t('adminEvents.regs.copied', 'Personal link copied'), description: t('adminEvents.regs.copiedBody', 'Give it to {{name}} only: it opens their registration.', { name: fullName(g) }) });
    } catch { /* the link stays shown in the window, to copy by hand */ }
  };

  /* ---------------------------------------------------------- accounts (on-site) */

  const openAcct = (kindOf: 'send' | 'run', jobIds: string[]) => {
    if (!jobIds.length) return;
    setAcctError(null);
    setAcct({ kind: kindOf, jobIds });
    setAcctOpen(true);
  };

  const runAcct = async () => {
    if (!acct) return;
    setBusy(true);
    setAcctError(null);
    const tally: Record<string, number> = {};
    for (let i = 0; i < acct.jobIds.length; i += MAX_JOB_IDS) {
      const res = await provisionStaff<{ ok?: boolean; results?: { id: string; result?: string; email?: string }[] }>({
        action: acct.kind === 'send' ? 'send_emails' : 'run',
        job_ids: acct.jobIds.slice(i, i + MAX_JOB_IDS),
      });
      if (res.error || res.ok !== true) {
        setBusy(false);
        setAcctError(staffErrorText(res.error, t));
        if (Object.keys(tally).length) void load();
        return;
      }
      for (const r of res.results || []) {
        const k = String((acct.kind === 'send' ? r.email : r.result) || 'other');
        tally[k] = (tally[k] || 0) + 1;
      }
    }
    setBusy(false);
    setAcctOpen(false);
    const ok = acct.kind === 'send' ? (tally.sent || 0) : (tally.created || 0) + (tally.linked || 0);
    const bad = (tally.failed || 0) + (tally.failed_gave_up || 0) + (tally.check_failed || 0);
    // provision-person keeps the order: the account e-mail waits for the confirmation e-mail.
    const waitingPass = (tally.waiting_for_confirmation_email || 0) + (tally.too_soon || 0) + (tally.gave_up_waiting || 0);
    toast({
      title: acct.kind === 'send'
        ? (ok === 1 ? t('adminEvents.acct.sentOne', 'One account e-mail sent') : t('adminEvents.acct.sentN', '{{n}} account e-mails sent', { n: ok }))
        : (ok === 1 ? t('adminEvents.acct.runOne', 'One account set up') : t('adminEvents.acct.runN', '{{n}} accounts set up', { n: ok })),
      description: [
        bad ? t('adminEvents.acct.failedN', '{{n}} failed: try again later.', { n: bad }) : '',
        waitingPass ? t('adminEvents.acct.waitPassN', '{{n}} go a minute after their confirmation e-mail with the QR code, never before.', { n: waitingPass }) : '',
        tally.pending_link ? t('adminEvents.acct.pendingN', '{{n}} wait for the person to confirm their e-mail address.', { n: tally.pending_link }) : '',
        tally.not_needed ? t('adminEvents.acct.notNeededN', '{{n}} had already chosen a password.', { n: tally.not_needed }) : '',
        tally.registration_not_confirmed ? t('adminEvents.acct.notConfirmedN', '{{n}} are no longer confirmed: nothing sent.', { n: tally.registration_not_confirmed }) : '',
      ].filter(Boolean).join(' ') || undefined,
      variant: bad ? 'destructive' : undefined,
    });
    setSelected(new Set());
    await load();
  };

  /* ---------------------------------------------------------- invitations (on-site) */

  const parsedInvites = useMemo(() => parseInvitees(inviteText), [inviteText]);
  const knownEmails = useMemo(() => new Set(rows.map((g) => g.email.toLowerCase())), [rows]);
  const newInvites = parsedInvites.people.filter((p) => !knownEmails.has(p.email));
  // A hidden test e-mails M3's own addresses only, 10 at most (the server refuses the rest).
  const notTestAddresses = hiddenTest ? newInvites.filter((p) => !isTestAddress(p.email, user?.email)) : [];
  const inviteCap = hiddenTest ? MAX_TEST_INVITES : MAX_INVITES;
  const inviteTicketKey = activeTickets.length === 1 ? activeTickets[0].key : inviteTicket;
  // Invitations: only where they are the way in (spec §4.1), and once the function sends them.
  const inviteOnlyTypes = activeTickets.some((x) => x.invite_only);
  const canInvite = onsite && caps.invite && (mode === 'invitation' || inviteOnlyTypes);

  const openInvite = () => {
    setInviteText('');
    setInviteMessage('');
    setInviteTicket('');
    setInviteValidate(true);
    setInviteResult(null);
    setDialogError(null);
    setInviteOpen(true);
  };

  const runInvite = async () => {
    if (!newInvites.length) {
      setDialogError(t('adminEvents.inv.nobody', 'No new address to invite. Paste one person per line.'));
      return;
    }
    if (notTestAddresses.length) {
      setDialogError(t('adminEvents.inv.testOnly', 'This is a hidden test: invite only addresses at {{domains}}, or your own. Remove the others.', { domains: TEST_INVITE_DOMAINS.map((d) => `@${d}`).join(', ') }));
      return;
    }
    if (newInvites.length > inviteCap) {
      setDialogError(t('adminEvents.inv.tooMany', 'At most {{n}} people at a time. Split the list.', { n: inviteCap }));
      return;
    }
    if (activeTickets.length > 1 && !inviteTicketKey) {
      setDialogError(t('adminEvents.inv.pickType', 'Choose the participation type they are invited as.'));
      return;
    }
    setBusy(true);
    setDialogError(null);
    const n = (v: unknown) => (Array.isArray(v) ? v.length : Number(v) || 0);
    const total = { invited: 0, already: 0, sent: null as number | null, failed: 0 };
    // 100 people per call (the function's body limit); what is left stays in the dialog if a turn fails.
    for (let i = 0; i < newInvites.length; i += INVITE_CHUNK) {
      const chunk = newInvites.slice(i, i + INVITE_CHUNK);
      const res = await registrationStaff<{ ok?: boolean; invited?: unknown; already?: unknown; sent?: number; failed?: number }>({
        action: 'invite',
        gl_event_id: glEventId,
        people: chunk,
        ticket_key: inviteTicketKey || undefined,
        message: inviteMessage.trim() || undefined,
        // M3's decision on each person, recorded now and applied when they accept.
        validate_person: inviteValidate,
        org_action: { mode: 'none' },
      });
      if (res.error || res.ok !== true) {
        setBusy(false);
        const done = i > 0;
        if (done) {
          // Keep only the people not sent yet; say what went.
          setInviteText(newInvites.slice(i).map((p) => [p.first_name, p.last_name, p.email, p.company].join(', ')).join('\n'));
          toast({ title: t('adminEvents.inv.doneN', '{{n}} invited.', { n: total.invited }), description: t('adminEvents.inv.partial', 'The people still in the list are not invited yet.') });
          void load();
        }
        setDialogError(staffErrorText(res.error, t));
        return;
      }
      total.invited += n(res.invited);
      total.already += n(res.already);
      if (typeof res.sent === 'number') total.sent = (total.sent ?? 0) + res.sent;
      total.failed += Number(res.failed) || 0;
    }
    setBusy(false);
    setInviteResult(total);
    void load();
  };

  const openDetail = (g: GuestRow) => {
    setDetail(g);
    setLink(null);
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
      ...(onsite ? [t('adminEvents.csv.ticket', 'Participation type'), t('adminEvents.csv.payment', 'Payment'), t('adminEvents.csv.accountSetup', 'Account set-up')] : []),
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
      ...(onsite ? [ticketLabel(g.ticket_key), paymentWord(g.payment_status, t), (() => { const a = acctOf(g); return accountWord(a.state, a.job, timezone, t); })()] : []),
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
    invited: t('adminEvents.regs.viewInvited', 'Invited, no reply yet'),
    confirmed: t('adminEvents.regs.viewConfirmed', 'Confirmed'),
    waitlisted: t('adminEvents.regs.viewWaitlist', 'Waiting list'),
    attended: t('adminEvents.regs.viewAttended', 'Attended'),
    closed: t('adminEvents.regs.viewClosed', 'Not accepted or cancelled'),
  };
  const showInvited = onsite && (mode === 'invitation' || counts.invited > 0);
  const viewOptions = (Object.keys(statusFilterWords) as View[]).filter((k) => k !== 'invited' || showInvited);
  const one = decision?.people.length === 1 ? decision.people[0].name : null;
  const n = decision?.people.length ?? 0;
  const invitedOnly = !!decision?.invitedOnly;
  const dialogTitle: Record<Decision, string> = {
    approve: invitedOnly
      ? (one ? t('adminEvents.regs.acceptForOne', 'Mark {{name}} as accepted?', { name: one }) : t('adminEvents.regs.acceptForMany', 'Mark {{n}} people as accepted?', { n }))
      : one ? t('adminEvents.regs.approveOne', 'Confirm {{name}}?', { name: one }) : t('adminEvents.regs.approveMany', 'Confirm {{n}} people?', { n }),
    reject: invitedOnly
      ? (one ? t('adminEvents.regs.withdrawOne', 'Withdraw the invitation of {{name}}?', { name: one }) : t('adminEvents.regs.withdrawMany', 'Withdraw {{n}} invitations?', { n }))
      : one ? t('adminEvents.regs.rejectOne', 'Turn down {{name}}?', { name: one }) : t('adminEvents.regs.rejectMany', 'Turn down {{n}} people?', { n }),
    waitlist: one ? t('adminEvents.regs.waitlistOne', 'Put {{name}} on the waiting list?', { name: one }) : t('adminEvents.regs.waitlistMany', 'Put {{n}} people on the waiting list?', { n }),
    request_info: one ? t('adminEvents.regs.infoOne', 'Ask {{name}} for more information', { name: one }) : t('adminEvents.regs.infoMany', 'Ask {{n}} people for more information', { n }),
  };
  const dialogBody: Record<Decision, string> = {
    approve: onsite && invitedOnly
      ? t('adminEvents.regs.acceptForBody', 'For someone who accepted by phone or e-mail. They get the confirmation e-mail with their entry QR code, as if they had accepted themselves.')
      : onsite
      ? (accountTiming === 'after_event'
        ? t('adminEvents.regs.approveBodyOnsiteAfter', 'They get a confirmation e-mail with their entry QR code. Their Smart Marina Connect account is prepared; the e-mail to choose its password goes after the event.')
        : t('adminEvents.regs.approveBodyOnsite', 'They get a confirmation e-mail with their entry QR code. A few minutes later, a second e-mail lets them choose the password of their Smart Marina Connect account.'))
      : t('adminEvents.regs.approveBodyWebinar2', 'They get a confirmation e-mail with the calendar file and the join link (when it is set).'),
    reject: invitedOnly
      ? t('adminEvents.regs.withdrawBody', 'Their invitation link stops working and their place is freed. You choose whether they are told.')
      : t('adminEvents.regs.rejectBody', 'Their registration is closed. You choose whether they are told.'),
    waitlist: t('adminEvents.regs.waitlistBody2', 'They are told by e-mail that they are on the waiting list.'),
    request_info: t('adminEvents.regs.infoBody', 'They get an e-mail with your question and a link to answer. Their registration comes back to "To review" when they answer.'),
  };
  const saveWord: Record<Decision, string> = {
    approve: invitedOnly ? t('adminEvents.regs.acceptFor', 'Mark as accepted') : t('adminEvents.regs.approve', 'Confirm'),
    reject: invitedOnly ? t('adminEvents.regs.withdraw', 'Withdraw the invitation') : t('adminEvents.regs.reject', 'Turn down'),
    waitlist: t('adminEvents.regs.waitlist', 'Waiting list'),
    request_info: t('adminEvents.regs.ask', 'Send the question'),
  };
  const others = Math.max(0, counts.confirmed - counts.confirmedAttended);

  // The tiles that can say something for this event: "To review" only when M3 accepts
  // people (or someone waits anyway), "Waiting list" only when there is one.
  const showReviewTile = mode !== 'instant' || counts.review > 0;
  const showWaitlistTile = waitlist || counts.waitlisted > 0;
  const tileCount = 2 + (showReviewTile ? 1 : 0) + (showWaitlistTile ? 1 : 0) + (showInvited ? 1 : 0);
  const chosenSendable = onsite && jobs
    ? visible.filter((g) => selected.has(g.id)).map((g) => acctOf(g)).filter((a) => a.sendable).map((a) => a.job!.id)
    : [];
  const nextDue = acctCounts.due.find((d) => Date.parse(d) > Date.now()) || null;

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
          <Check className="mr-1.5 h-4 w-4" aria-hidden="true" /> {allInvited('approve', list) ? t('adminEvents.regs.acceptFor', 'Mark as accepted') : t('adminEvents.regs.approve', 'Confirm')}
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
          <X className="mr-1.5 h-4 w-4" aria-hidden="true" /> {allInvited('reject', list) ? t('adminEvents.regs.withdraw', 'Withdraw the invitation') : t('adminEvents.regs.reject', 'Turn down')}
        </Button>
      )}
    </>
  );

  return (
    <div className="space-y-5">
      {!decisionsAllowed && (
        <Note>
          {onsiteNotLive
            ? t('adminEvents.regs.onsiteNotLiveNote', 'Decisions and invitations work on hidden test events until on-site registration is live on the site. Here, the people registered are listed only.')
            : t('adminEvents.regs.onsiteNote', 'On-site registrations are listed here. Confirming or turning them down arrives with the on-site editor, in a later update.')}
        </Note>
      )}

      <div className={cn('grid grid-cols-2 gap-3', tileCount === 3 && 'lg:grid-cols-3', tileCount === 4 && 'lg:grid-cols-4', tileCount === 5 && 'sm:grid-cols-3 lg:grid-cols-5')}>
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
        {showInvited && (
          <AdminKpiCard
            label={t('adminEvents.regs.kpiInvited', 'Invited, no reply yet')}
            value={counts.invited}
            icon={MailPlus}
            onClick={() => setView(view === 'invited' ? 'all' : 'invited')}
            selected={view === 'invited'}
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
            {viewOptions.map((k) => <SelectItem key={k} value={k}>{statusFilterWords[k]}</SelectItem>)}
          </SelectContent>
        </Select>
        {onsite && tickets.length > 0 && (
          <Select value={ticketFilter} onValueChange={setTicketFilter}>
            <SelectTrigger className="w-56" aria-label={t('adminEvents.regs.byTicket', 'Participation type')}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('adminEvents.regs.allTickets', 'Every participation type')}</SelectItem>
              {tickets.map((x) => <SelectItem key={x.key} value={x.key}>{x.label}{x.active ? '' : ` (${t('adminEvents.tk.offShort', 'off')})`}</SelectItem>)}
              <SelectItem value="__none">{t('adminEvents.regs.noTicket', 'No type')}</SelectItem>
            </SelectContent>
          </Select>
        )}
        {onsite && (
          <Select value={payFilter} onValueChange={setPayFilter}>
            <SelectTrigger className="w-48" aria-label={t('adminEvents.regs.byPayment', 'Payment')}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('adminEvents.regs.anyPayment', 'Any payment')}</SelectItem>
              {PAYMENTS.map((p) => <SelectItem key={p} value={p}>{paymentWord(p, t)}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </AdminFilterBar>

      {onsite && (canInvite || (slug && counts.confirmed > 0)) && (
        <div className="flex flex-wrap gap-2">
          {canInvite && (
            <Button type="button" variant="outline" size="sm" className={EDITOR_BTN} disabled={busy} onClick={openInvite}>
              <UserPlus className="mr-1.5 h-4 w-4" aria-hidden="true" /> {t('adminEvents.inv.open', 'Invite people')}
            </Button>
          )}
          {slug && counts.confirmed > 0 && (
            <Button asChild variant="outline" size="sm" className={EDITOR_BTN}>
              <Link to={`/admin/guest-list/${slug}/checkin`}>
                <QrCode className="mr-1.5 h-4 w-4" aria-hidden="true" /> {t('adminEvents.regs.door', 'Door check-in')}
              </Link>
            </Button>
          )}
        </div>
      )}
      {onsite && caps.checked && !caps.invite && (mode === 'invitation' || inviteOnlyTypes) && (
        <Note tone="warning">
          {t('adminEvents.inv.notYet', 'Sending invitations from this page comes in a later update. Until then, people ask for an invitation and you accept them here.')}
        </Note>
      )}

      {/* On-site: confirmed people whose confirmation e-mail with the QR code did not go. */}
      {passMissing.length > 0 && (
        <div className="space-y-3 rounded-card border border-red-200 bg-red-50 p-4" role="status">
          <p className="flex items-start gap-2 text-[14px] leading-5 text-navy">
            <QrCode className="mt-0.5 h-4 w-4 shrink-0 text-red-700" aria-hidden="true" />
            <span>
              {passMissing.length === 1
                ? t('adminEvents.regs.passMissingOne', 'One confirmed person has not received the confirmation e-mail with their QR code (or it is still being sent: refresh in a minute). Their account e-mail waits for it.')
                : t('adminEvents.regs.passMissingN', '{{n}} confirmed people have not received the confirmation e-mail with their QR code (or it is still being sent: refresh in a minute). Their account e-mails wait for it.', { n: passMissing.length })}
              {passMissing.length <= 5 && ` ${passMissing.map(fullName).join(', ')}.`}
            </span>
          </p>
          <Button type="button" variant="outline" size="sm" className={EDITOR_BTN} disabled={busy} onClick={() => void resendPasses()}>
            <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {passMissing.length > MAX_RESEND
              ? t('adminEvents.regs.passResendNext', 'Send the confirmation again to the next {{n}}', { n: MAX_RESEND })
              : t('adminEvents.regs.passResend', 'Send the confirmation again ({{n}})', { n: passMissing.length })}
          </Button>
        </div>
      )}

      {/* On-site: where the accounts of confirmed people stand, and what can be done now. */}
      {onsite && jobsFailed && (
        <Note tone="warning">{t('adminEvents.acct.loadFailed2', 'The account set-up and the confirmation e-mails of each person could not be loaded. Refresh to try again.')}</Note>
      )}
      {onsite && jobs && (acctCounts.sendable.length + acctCounts.runnable.length + acctCounts.failed + acctCounts.sent + acctCounts.waitingProof + acctCounts.waitingPass) > 0 && (
        <div className="space-y-3 rounded-card border border-rule bg-white p-4">
          <p className="flex items-start gap-2 text-[14px] leading-5 text-navy">
            <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-teal" aria-hidden="true" />
            <span>
              {[
                t('adminEvents.acct.sumSent', 'Account e-mails sent: {{n}}.', { n: acctCounts.sent }),
                acctCounts.sendable.length
                  ? (nextDue
                    ? t('adminEvents.acct.sumWaitingDue', 'Waiting to go: {{n}} (next on {{day}}).', { n: acctCounts.sendable.length, day: formatInZone(nextDue, timezone, false) })
                    : t('adminEvents.acct.sumWaiting', 'Waiting to go: {{n}}.', { n: acctCounts.sendable.length }))
                  : '',
                acctCounts.waitingPass ? t('adminEvents.acct.sumWaitingPass', 'Waiting for their confirmation e-mail first: {{n}}.', { n: acctCounts.waitingPass }) : '',
                acctCounts.runnable.length ? t('adminEvents.acct.sumRunnable', 'Accounts not set up yet: {{n}}.', { n: acctCounts.runnable.length }) : '',
                acctCounts.waitingProof ? t('adminEvents.acct.sumProof', 'Waiting for the person to confirm their e-mail: {{n}}.', { n: acctCounts.waitingProof }) : '',
                acctCounts.failed ? t('adminEvents.acct.sumFailed', 'Failed: {{n}}.', { n: acctCounts.failed }) : '',
              ].filter(Boolean).join(' ')}
            </span>
          </p>
          {(acctCounts.sendable.length > 0 || acctCounts.runnable.length > 0) && (
            <div className="flex flex-wrap gap-2">
              {acctCounts.sendable.length > 0 && (
                <Button type="button" variant="outline" size="sm" className={EDITOR_BTN} disabled={busy} onClick={() => openAcct('send', acctCounts.sendable)}>
                  <Send className="mr-1.5 h-4 w-4" aria-hidden="true" /> {t('adminEvents.acct.sendNow', 'Send account e-mails now ({{n}})', { n: acctCounts.sendable.length })}
                </Button>
              )}
              {acctCounts.runnable.length > 0 && (
                <Button type="button" variant="outline" size="sm" className={EDITOR_BTN} disabled={busy} onClick={() => openAcct('run', acctCounts.runnable)}>
                  <KeyRound className="mr-1.5 h-4 w-4" aria-hidden="true" /> {t('adminEvents.acct.runNow', 'Set up the accounts now ({{n}})', { n: acctCounts.runnable.length })}
                </Button>
              )}
            </div>
          )}
        </div>
      )}

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
          {chosenSendable.length > 0 && (
            <Button type="button" size="sm" variant="outline" className={EDITOR_BTN} disabled={busy} onClick={() => openAcct('send', chosenSendable)}>
              <Send className="mr-1.5 h-4 w-4" aria-hidden="true" /> {t('adminEvents.acct.sendSelected', 'Send account e-mails now ({{n}})', { n: chosenSendable.length })}
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
                    {onsite && g.ticket_key && <AdminStatusPill tone="navy">{ticketLabel(g.ticket_key)}</AdminStatusPill>}
                    {onsite && g.payment_status && g.payment_status !== 'none' && <AdminStatusPill>{paymentWord(g.payment_status, t)}</AdminStatusPill>}
                    {onsite && (() => {
                      const a = acctOf(g);
                      return a.state !== 'none' && a.state !== 'skipped'
                        ? <AdminStatusPill tone={ACCOUNT_TONE[a.state]} icon={KeyRound} title={accountWord(a.state, a.job, timezone, t)}><span className="max-w-[14rem] truncate">{accountWord(a.state, a.job, timezone, t)}</span></AdminStatusPill>
                        : null;
                    })()}
                    {onsite && passSent(g) === false && (
                      <AdminStatusPill tone="danger" icon={QrCode}>{t('adminEvents.regs.passNotSent', 'QR e-mail not sent')}</AdminStatusPill>
                    )}
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
        {decision?.kind === 'approve' && onsite && (
          <ToggleRow
            checked={validatePerson}
            onChange={setValidatePerson}
            title={t('adminEvents.regs.validatePerson', 'Their account is validated by M3')}
            body={validatePerson
              ? t('adminEvents.regs.validateOn2', 'You checked who they are. Their account starts validated, as a participant (an existing account waiting for M3 becomes validated). The company they typed stays on their profile: to attach them to a company page, open them in Users.')
              : t('adminEvents.regs.validateOff2', 'They come to the event, but their account waits in To review, where M3 validates them and their company together.')}
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
          ? (overCapacity.ticket
            ? t('adminEvents.regs.fullBodyTicket', '{{held}} of the {{cap}} places for "{{ticket}}" are taken and you are adding {{add}}. Confirm anyway?', { held: overCapacity.held, cap: overCapacity.capacity, add: overCapacity.adding, ticket: overCapacity.ticket })
            : t('adminEvents.regs.fullBody', '{{held}} of {{cap}} places are taken and you are adding {{add}}. Confirm anyway?', { held: overCapacity.held, cap: overCapacity.capacity, add: overCapacity.adding }))
          : undefined}
        onSave={() => runDecision(true)}
        saveLabel={t('adminEvents.regs.confirmAnyway', 'Confirm anyway')}
        saving={busy}
        error={dialogError}
      />

      {/* Accounts of confirmed on-site people: send their e-mails now, or set them up now. */}
      <EditDialog
        open={acctOpen}
        onOpenChange={(o) => { if (!o) setAcctOpen(false); }}
        title={acct?.kind === 'run'
          ? ((acct?.jobIds.length ?? 0) === 1 ? t('adminEvents.acct.runTitleOne', 'Set up this account now?') : t('adminEvents.acct.runTitle', 'Set up {{n}} accounts now?', { n: acct?.jobIds.length ?? 0 }))
          : ((acct?.jobIds.length ?? 0) === 1 ? t('adminEvents.acct.sendTitleOne', 'Send this account e-mail now?') : t('adminEvents.acct.sendTitle', 'Send {{n}} account e-mails now?', { n: acct?.jobIds.length ?? 0 }))}
        description={acct?.kind === 'run'
          ? t('adminEvents.acct.runBody', 'Their Smart Marina Connect account is created (or the event is added to the account they have). The "choose your password" e-mail then goes at its usual time.')
          : t('adminEvents.acct.sendBody', 'They get "Your Smart Marina Connect account is ready, choose your password" now, instead of on the planned date. Someone who already chose a password gets nothing.')}
        onSave={runAcct}
        saveLabel={acct?.kind === 'run' ? t('adminEvents.acct.runGo', 'Set them up') : t('adminEvents.acct.sendGo', 'Send now')}
        saving={busy}
        error={acctError}
      />

      {/* Invitations (on-site): paste up to 500 people (10 M3 addresses on a hidden test). */}
      <EditDialog
        open={inviteOpen}
        onOpenChange={(o) => { if (!o && !busy) setInviteOpen(false); }}
        title={t('adminEvents.inv.title', 'Invite people')}
        description={inviteResult ? undefined : t('adminEvents.inv.body', 'Each person gets an e-mail inviting them to the event, with a button to accept or decline. Paste one person per line: an e-mail address, "First Last <e-mail>", or rows copied from a spreadsheet (first name, last name, e-mail, company).')}
        onSave={inviteResult ? undefined : runInvite}
        quietClose={!!inviteResult}
        saveLabel={inviteResult ? t('adminEvents.done', 'Done') : newInvites.length
          ? (newInvites.length === 1 ? t('adminEvents.inv.goOne', 'Invite 1 person') : t('adminEvents.inv.go', 'Invite {{n}} people', { n: newInvites.length }))
          : t('adminEvents.inv.goNone', 'Invite')}
        saving={busy}
        error={dialogError}
        wide
      >
        {inviteResult ? (
          <div className="space-y-2 text-[15px] leading-6 text-navy" role="status">
            <p>{t('adminEvents.inv.doneN', '{{n}} invited.', { n: inviteResult.invited })}</p>
            {inviteResult.sent !== null && <p className="text-meta">{inviteResult.sent === 1 ? t('adminEvents.inv.sentOne', 'One invitation e-mail sent.') : t('adminEvents.inv.sentN', '{{n}} invitation e-mails sent.', { n: inviteResult.sent })}</p>}
            {inviteResult.failed > 0 && <Note tone="danger">{t('adminEvents.inv.failedN', '{{n}} e-mails could not be sent. Use "Send their personal link again" on those people.', { n: inviteResult.failed })}</Note>}
            {inviteResult.already > 0 && <p className="text-meta">{t('adminEvents.inv.alreadyN', 'Already on the list, left as they were: {{n}}.', { n: inviteResult.already })}</p>}
          </div>
        ) : (
          <div className="space-y-4">
            {hiddenTest && (
              <Note tone="warning">
                {t('adminEvents.inv.testNote', 'Hidden test event: invite only addresses at {{domains}}, or your own ({{own}}), {{n}} at most. Real people are invited from the real event.', {
                  domains: TEST_INVITE_DOMAINS.map((d) => `@${d}`).join(', '), own: user?.email || '…', n: MAX_TEST_INVITES,
                })}
              </Note>
            )}
            <Field label={t('adminEvents.inv.list', 'People to invite')} htmlFor="inv-list">
              <Textarea
                id="inv-list"
                rows={8}
                value={inviteText}
                onChange={(e) => { setInviteText(e.target.value.slice(0, 200000)); setDialogError(null); }}
                placeholder={'jane.doe@example.com\nJohn Smith <john@example.com>\nAnna, Rossi, anna@example.com, Porto Sereno'}
                className={TEXTAREA}
                spellCheck={false}
                autoCapitalize="none"
              />
            </Field>
            {inviteText.trim() && (
              <div className="space-y-1 text-[13px] leading-[18px]">
                <p className="font-semibold text-navy">
                  {parsedInvites.people.length === 1 ? t('adminEvents.inv.foundOne', '1 person found.') : t('adminEvents.inv.found', '{{n}} people found.', { n: parsedInvites.people.length })}
                  {parsedInvites.people.length - newInvites.length > 0 && ` ${t('adminEvents.inv.knownN', '{{n}} already on the list (left out).', { n: parsedInvites.people.length - newInvites.length })}`}
                  {parsedInvites.repeated > 0 && ` ${t('adminEvents.inv.repeatedN', '{{n}} repeated (counted once).', { n: parsedInvites.repeated })}`}
                </p>
                {parsedInvites.multi > 0 && (
                  <p className="text-meta">
                    {parsedInvites.multi === 1
                      ? t('adminEvents.inv.multiOne', 'One line had several addresses: each address is invited as its own person.')
                      : t('adminEvents.inv.multiN', '{{n}} lines had several addresses: each address is invited as its own person.', { n: parsedInvites.multi })}
                  </p>
                )}
                {newInvites.length > inviteCap && (
                  <p className="font-medium text-red-700">{t('adminEvents.inv.tooMany', 'At most {{n}} people at a time. Split the list.', { n: inviteCap })}</p>
                )}
                {notTestAddresses.length > 0 && (
                  <p className="font-medium text-red-700 [overflow-wrap:anywhere]">
                    {t('adminEvents.inv.notTest', 'Not an M3 address (remove them for a test):')} {notTestAddresses.slice(0, 5).map((p) => p.email).join(' · ')}{notTestAddresses.length > 5 ? ' …' : ''}
                  </p>
                )}
                {parsedInvites.invalid.length > 0 && (
                  <p className="text-red-700 [overflow-wrap:anywhere]">
                    {t('adminEvents.inv.invalid', 'No e-mail address on these lines (left out):')} {parsedInvites.invalid.slice(0, 5).join(' · ')}{parsedInvites.invalid.length > 5 ? ' …' : ''}
                  </p>
                )}
              </div>
            )}
            {activeTickets.length > 1 && (
              <Field label={t('adminEvents.inv.asType', 'Invited as')}>
                <Select value={inviteTicket} onValueChange={(v) => { setInviteTicket(v); setDialogError(null); }}>
                  <SelectTrigger className={INPUT} aria-label={t('adminEvents.inv.asType', 'Invited as')}><SelectValue placeholder={t('adminEvents.inv.pickTypePh', 'Choose a participation type')} /></SelectTrigger>
                  <SelectContent>
                    {activeTickets.map((x) => <SelectItem key={x.key} value={x.key}>{x.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
            )}
            <Field label={t('adminEvents.inv.message', 'A personal message')} htmlFor="inv-msg" optional hint={t('adminEvents.inv.messageHint', 'Added to the invitation e-mail, under the greeting.')}>
              <Textarea id="inv-msg" rows={3} value={inviteMessage} onChange={(e) => setInviteMessage(e.target.value.slice(0, 1000))} className={TEXTAREA} />
            </Field>
            <ToggleRow
              checked={inviteValidate}
              onChange={setInviteValidate}
              title={t('adminEvents.regs.validatePerson', 'Their account is validated by M3')}
              body={inviteValidate
                ? t('adminEvents.inv.validateOn', 'You know who they are. When they accept, their account starts validated, as a participant. The company they type stays on their profile.')
                : t('adminEvents.inv.validateOff', 'When they accept, they come to the event, but their account waits in To review, where M3 validates them and their company together.')}
            />
            {mode === 'invitation' && !publicRequests && (
              <p className="text-[13px] leading-[18px] text-meta">{t('adminEvents.inv.onlyThem', 'Invitation only: these people are the only ones who can take part.')}</p>
            )}
          </div>
        )}
      </EditDialog>

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
                ...(onsite ? [
                  [t('adminEvents.csv.ticket', 'Participation type'), ticketLabel(detail.ticket_key)],
                  [t('adminEvents.csv.payment', 'Payment'), detail.payment_status && detail.payment_status !== 'none' ? paymentWord(detail.payment_status, t) : ''],
                  [t('adminEvents.regs.account', 'Account'), (() => { const a = acctOf(detail); return accountWord(a.state, a.job, timezone, t); })()],
                ] as [string, string][] : []),
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

            {(() => {
              // On-site: ONE e-mail action. "Send the last e-mail again" carries their personal
              // link (and, once confirmed, the QR code); the bare link only where there is no
              // such e-mail (an invitation, a closed registration). Webinars as before.
              const resendable = onsite && RESENDABLE.includes(detail.status);
              const a = onsite ? acctOf(detail) : null;
              const pass = onsite ? passSent(detail) : null;
              return (
                <>
                  {detail.status === 'confirmed' && (
                    <p className="text-[13px] leading-[18px] text-meta">
                      {onsite
                        ? t('adminEvents.regs.removeHintOnsite', 'To take someone off the list, send them the last e-mail again: its link lets them cancel from their registration page.')
                        : t('adminEvents.regs.removeHint', 'To take someone off the list, send them their personal link: they can cancel from their registration page.')}
                    </p>
                  )}
                  {pass === false && (
                    <Note tone="danger">
                      {t('adminEvents.regs.passMissingDetail', 'Their confirmation e-mail with the QR code has not gone (or is still being sent). Send it again below; their account e-mail follows it, never before.')}
                    </Note>
                  )}
                  {a?.sendable && (
                    <Button type="button" size="sm" variant="outline" className={EDITOR_BTN} disabled={busy} onClick={() => { setDetailOpen(false); openAcct('send', [a.job!.id]); }}>
                      <Send className="mr-1.5 h-4 w-4" aria-hidden="true" /> {t('adminEvents.acct.sendOne', 'Send their account e-mail now')}
                    </Button>
                  )}
                  <div className="flex flex-wrap gap-2 border-t border-rule pt-4">
                    {decisionButtons([detail], () => setDetailOpen(false))}
                    {resendable ? (
                      <Button type="button" size="sm" variant="outline" className={EDITOR_BTN} disabled={busy} onClick={() => void resendStatus(detail)}>
                        <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden="true" />
                        {detail.status === 'confirmed'
                          ? t('adminEvents.regs.resendPass2', 'Send the confirmation again')
                          : t('adminEvents.regs.resendLast', 'Send the last e-mail again')}
                      </Button>
                    ) : (
                      <Button type="button" size="sm" variant="outline" className={EDITOR_BTN} disabled={busy} onClick={() => void sendLink(detail)}>
                        <Mail className="mr-1.5 h-4 w-4" aria-hidden="true" /> {t('adminEvents.regs.sendLink', 'Send their personal link again')}
                      </Button>
                    )}
                  </div>
                  {onsite && caps.statusLink && (
                    <details className="group text-[14px]">
                      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center rounded-pill px-2 font-semibold text-navy hover:bg-chip focus:outline-none focus-visible:shadow-focus [&::-webkit-details-marker]:hidden">
                        {t('adminEvents.regs.more', 'More')}
                      </summary>
                      <div className="pt-2">
                        <Button type="button" size="sm" variant="outline" className={EDITOR_BTN} disabled={busy} onClick={() => void copyLink(detail)}>
                          <Copy className="mr-1.5 h-4 w-4" aria-hidden="true" /> {t('adminEvents.regs.copyLink', 'Copy their personal link')}
                        </Button>
                      </div>
                    </details>
                  )}
                </>
              );
            })()}
            {onsite && link && link.id === detail.id && (
              <Field
                label={t('adminEvents.regs.linkLabel', 'Their personal link')}
                htmlFor="reg-link"
                hint={t('adminEvents.regs.linkHint', 'Give it to this person only: it opens and changes their registration, and shows their entry QR code once confirmed.')}
              >
                <Input id="reg-link" readOnly value={link.url} onFocus={(e) => e.currentTarget.select()} className={INPUT} spellCheck={false} />
              </Field>
            )}
          </div>
        )}
      </EditDialog>
    </div>
  );
}
