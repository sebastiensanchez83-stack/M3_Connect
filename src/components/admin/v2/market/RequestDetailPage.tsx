import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ClipboardList, History, Loader2, Mail, MessageSquare, Pencil, Send, StickyNote, User,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CardLink } from '@/components/home/dashboard/DashboardKit';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { externalUrl } from '@/lib/externalUrl';
import {
  AdminDetailHeader, AdminEmpty, AdminLoading, AdminPanel, AdminStatusPill, ADMIN_BTN, ADMIN_BTN_PRIMARY, statusTone, type AdminTone,
} from '../../AdminUI';
import { Field, Note } from '../MembersKit';
import { fmtDate } from '../membersApi';
import {
  actionErrorText, addRequestNote, editRequest, loadRequest, setRequestStatus,
  type HistoryEntry, type OutboxEntry, type RequestRecord,
} from './marketApi';
import { marketRequestWords, statusSendsEmail } from './marketEmail';
import {
  codeLabel, isRequestKind, isWaiting, KIND_LABEL, KIND_SHORT, KIND_STATUSES, LEAD_ENGAGEMENT, PROJECT_BUDGETS, PROJECT_TIMELINES,
  PROJECT_TYPES, statusHint, statusName, type RequestKind,
} from './marketKinds';

/**
 * Admin > Marina requests > one request (lane "market", 21 Oct 2026). The ONE place where M3
 * acts on a marina request: change its status (with a message, or the reason when it is turned
 * down, and the e-mail to the requester, shown before it goes), correct what they wrote, keep
 * internal notes. Each action is one staff-only database function that also writes the history
 * (review_log) and queues the e-mail (notification_outbox, while the e-mail sender is on).
 * Phone: the answer block comes first, then what they wrote, who sent it, the history.
 */

const FIELD_LABEL: Record<string, string> = {
  title: 'Title', scope: 'What they need', deadline_date: 'Deadline', description: 'Description',
  project_type: 'Type of project', budget_range: 'Budget', timeline: 'Timeline',
  company: 'Company', first_name: 'First name', last_name: 'Last name', email: 'E-mail', phone: 'Phone',
  website: 'Website', country: 'Country', actor_type: 'Type of company', solutions: 'What they offer',
  goals: 'What they are looking for', engagement_level: 'What they would like',
};

type FieldSpec = { key: string; kind: 'text' | 'long' | 'date' | 'choice'; options?: Record<string, string>; required?: boolean };

const FIELDS: Record<RequestKind, FieldSpec[]> = {
  rfp: [
    { key: 'title', kind: 'text', required: true },
    { key: 'scope', kind: 'long', required: true },
    { key: 'deadline_date', kind: 'date' },
  ],
  consultation: [
    { key: 'title', kind: 'text', required: true },
    { key: 'description', kind: 'long', required: true },
  ],
  project: [
    { key: 'project_type', kind: 'choice', options: PROJECT_TYPES, required: true },
    { key: 'budget_range', kind: 'choice', options: PROJECT_BUDGETS },
    { key: 'timeline', kind: 'choice', options: PROJECT_TIMELINES },
    { key: 'description', kind: 'long' },
  ],
  lead: [
    { key: 'company', kind: 'text', required: true },
    { key: 'first_name', kind: 'text', required: true },
    { key: 'last_name', kind: 'text', required: true },
    { key: 'email', kind: 'text', required: true },
    { key: 'phone', kind: 'text' },
    { key: 'website', kind: 'text' },
    { key: 'country', kind: 'text' },
    { key: 'actor_type', kind: 'text' },
    { key: 'solutions', kind: 'long' },
    { key: 'goals', kind: 'long' },
    { key: 'engagement_level', kind: 'choice', options: LEAD_ENGAGEMENT },
  ],
};

const fmtWhen = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

function shown(spec: FieldSpec, value: unknown): string {
  const v = value === null || value === undefined ? '' : String(value);
  if (!v) return '';
  if (spec.kind === 'date') return fmtDate(v);
  if (spec.kind === 'choice' && spec.options) return codeLabel(spec.options, v);
  return v;
}

export function RequestDetailPage() {
  const { kind: kindParam = '', id = '' } = useParams<{ kind: string; id: string }>();
  const { t } = useTranslation();
  const [record, setRecord] = useState<RequestRecord | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const kind = isRequestKind(kindParam) ? kindParam : null;

  const reload = useCallback(() => {
    if (!kind) return;
    loadRequest(kind, id).then(r => { setRecord(r); setError(null); }, (e: unknown) => setError(e instanceof Error ? e.message : 'Could not load.'));
  }, [kind, id]);
  useEffect(() => { setRecord(undefined); reload(); }, [reload]);

  if (!kind) return <Navigate to="/admin/requests" replace />;
  if (error) return <div className="mx-auto max-w-3xl"><Note tone="warning">{error}</Note></div>;
  if (record === undefined) return <AdminLoading />;
  if (record === null) {
    return (
      <div className="mx-auto max-w-3xl rounded-card border border-rule bg-white">
        <AdminEmpty
          icon={ClipboardList}
          title={t('adminMarket.detail.notFound', 'This request was not found')}
          body={t('adminMarket.detail.notFoundBody', 'Its author may have deleted it.')}
          action={<CardLink to="/admin/requests">{t('adminMarket.detail.back', 'Back to Marina requests')}</CardLink>}
        />
      </div>
    );
  }

  const status = String(record.row.status ?? '');
  const waiting = isWaiting(kind, status);
  const sentBy = kind === 'lead'
    ? [record.row.first_name, record.row.last_name].filter(Boolean).join(' ') || record.row.email
    : record.author?.name;

  return (
    <div className="mx-auto max-w-6xl">
      <AdminDetailHeader
        back={{ to: '/admin/requests', label: t('adminMarket.detail.back', 'Back to Marina requests') }}
        title={record.title}
        badges={
          <>
            <AdminStatusPill tone="info">{KIND_LABEL[kind]}</AdminStatusPill>
            <AdminStatusPill tone={statusTone(status)}>{statusName(kind, status)}</AdminStatusPill>
          </>
        }
        subtitle={[
          sentBy ? t('adminMarket.detail.sentBy', 'Sent by {{name}}', { name: sentBy }) : null,
          record.org?.name ?? (kind === 'lead' ? null : t('adminMarket.detail.noCompanyShort', 'no company')),
          t('adminMarket.detail.on', 'on {{date}}', { date: fmtDate(record.row.created_at) }),
        ].filter(Boolean).join(' · ')}
      />

      {record.problems.map(p => <div key={p} className="mb-4"><Note tone="warning">{p}</Note></div>)}

      {waiting && (
        <div className="mb-6 rounded-card border border-gold/70 bg-white px-5 py-4">
          <p className="text-[15px] font-semibold leading-6 text-navy">
            {kind === 'lead'
              ? t('adminMarket.detail.waitingLead', 'Nobody at M3 has contacted this company yet.')
              : t('adminMarket.detail.waiting', 'This request waits for M3’s answer. Choose its new status in “Answer this request”.')}
          </p>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-5">
        {/* Right column on a computer, first on a phone: where M3 acts. */}
        <div className="space-y-6 lg:col-span-2 lg:col-start-4 lg:row-start-1">
          <AnswerPanel record={record} onDone={reload} />
          <NotesPanel record={record} onDone={reload} />
        </div>
        <div className="min-w-0 space-y-6 lg:col-span-3 lg:col-start-1 lg:row-start-1">
          <WrittenPanel record={record} onDone={reload} />
          <SenderPanel record={record} />
          <HistoryPanel record={record} />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ answer */

/**
 * The choices of the status picker. A marina project has two codes that both mean "waiting for
 * M3" (new from the form, submitted on older rows): only one is offered, the current one when
 * it is one of them.
 */
function pickerStatuses(kind: RequestKind, current: string): string[] {
  if (kind !== 'project') return KIND_STATUSES[kind];
  const waitingCode = current === 'submitted' ? 'submitted' : 'new';
  return KIND_STATUSES.project.filter(s => (s === 'new' || s === 'submitted' ? s === waitingCode : true));
}

function AnswerPanel({ record, onDone }: { record: RequestRecord; onDone: () => void }) {
  const { t } = useTranslation();
  const kind = record.kind;
  const current = String(record.row.status ?? '');
  const [choice, setChoice] = useState(current);
  const [message, setMessage] = useState('');
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setChoice(current); setMessage(''); setNotify(true); }, [current, record.row.id]);

  const changed = choice !== current;
  const needReason = choice === 'rejected' && kind !== 'lead';
  const mails = statusSendsEmail(kind, choice);
  const authorOk = !!record.author && record.author.accessStatus !== 'suspended';
  const willEmail = changed && mails && notify && authorOk && record.emailsOn;
  const words = useMemo(
    () => (mails ? marketRequestWords(kind, choice, record.title, message.trim(), record.author?.firstName ?? '') : null),
    [mails, kind, choice, record.title, message, record.author?.firstName],
  );
  const canSave = changed && !busy && (!needReason || !!message.trim());

  const messageLabel = needReason
    ? kind === 'project'
      ? willEmail
        ? t('adminMarket.answer.reasonProject', 'Reason (required): they will read it in the e-mail')
        : t('adminMarket.answer.reasonProjectNoMail', 'Reason (required): kept in the history (they are not e-mailed)')
      : t('adminMarket.answer.reasonPublic', 'Reason (required): they read it on their account page{{mail}}. Other members can read it too: write nothing confidential', { mail: willEmail ? ' and in the e-mail' : '' })
    : willEmail
      ? t('adminMarket.answer.message', 'Message to them (optional): added to the e-mail')
      : t('adminMarket.answer.note', 'Note for the history (optional): only the M3 team sees it');

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    try {
      // Never ask for an e-mail this page did not announce: while the sender looked off when the
      // page opened, the text above was labelled a note for the history only.
      const res = await setRequestStatus(kind, String(record.row.id), choice, message, notify && record.emailsOn);
      const how: Record<string, string> = {
        queued: t('adminMarket.answer.queued', 'The e-mail is on its way to the requester.'),
        sender_off: t('adminMarket.answer.senderOff', 'No e-mail: e-mails to members start at go-live.'),
        not_asked: t('adminMarket.answer.notAsked', 'No e-mail, as you chose.'),
        not_for_this_status: t('adminMarket.answer.noMailStatus', 'No e-mail for this status.'),
        not_for_leads: t('adminMarket.answer.noMailLead', 'No e-mail: partner leads are answered in person.'),
        no_author: t('adminMarket.answer.noAuthor', 'No e-mail: the requester’s account no longer exists.'),
        author_suspended: t('adminMarket.answer.suspended', 'No e-mail: the requester’s account is suspended.'),
      };
      toast({ title: t('adminMarket.answer.saved', 'Status saved: {{status}}', { status: statusName(kind, choice) }), description: how[res?.email] ?? undefined });
      onDone();
    } catch (e) {
      toast({ title: t('adminMarket.answer.failed', 'The status was not changed'), description: actionErrorText(e), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminPanel
      title={kind === 'lead' ? t('adminMarket.answer.titleLead', 'Where is this lead?') : t('adminMarket.answer.title', 'Answer this request')}
      icon={Send}
      description={t('adminMarket.answer.desc', 'Now: {{status}}. Choose the new status, then save.', { status: statusName(kind, current) })}
    >
      <fieldset>
        <legend className="sr-only">{t('adminMarket.answer.legend', 'New status')}</legend>
        <div className="space-y-2">
          {pickerStatuses(kind, current).map(s => {
            const isCurrent = s === current;
            const on = s === choice;
            return (
              <label
                key={s}
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-2.5 transition-colors',
                  on ? 'border-navy bg-chip' : 'border-rule bg-white hover:border-navy/50',
                  isCurrent && !on && 'opacity-70',
                )}
              >
                <input
                  type="radio"
                  name={`status-${record.row.id}`}
                  value={s}
                  checked={on}
                  onChange={() => setChoice(s)}
                  className="mt-1 h-4 w-4 shrink-0 accent-[#0b2653]"
                />
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2 text-[15px] font-semibold leading-5 text-navy">
                    {statusName(kind, s)}
                    {isCurrent && <span className="rounded-pill bg-white px-2 text-[11px] font-bold uppercase tracking-[0.06em] text-meta ring-1 ring-rule">{t('adminMarket.answer.now', 'now')}</span>}
                    {statusSendsEmail(kind, s) && !isCurrent && <Mail className="h-3.5 w-3.5 text-teal" aria-label={t('adminMarket.answer.mailIcon', 'e-mails the requester')} />}
                  </span>
                  <span className="mt-0.5 block text-[13px] leading-[18px] text-meta">{statusHint(kind, s)}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {changed && (
        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="text-[13px] font-semibold leading-5 text-navy">{messageLabel}</span>
            <Textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              rows={needReason ? 4 : 3}
              maxLength={2000}
              className="mt-1.5"
              placeholder={needReason ? t('adminMarket.answer.reasonPlaceholder', 'For example: the scope is too short for service providers to quote. Please add…') : ''}
            />
          </label>

          {kind === 'lead' ? (
            <Note>
              {t('adminMarket.answer.leadNote', 'Partner leads get no automatic e-mail: they have no account. Write to them yourself.')}
            </Note>
          ) : !mails ? (
            <p className="text-[13px] leading-5 text-meta">{t('adminMarket.answer.noMail', 'No e-mail goes out for this status.')}</p>
          ) : !record.author ? (
            <Note tone="warning">{t('adminMarket.answer.noAuthorNote', 'No e-mail: the requester’s account no longer exists.')}</Note>
          ) : record.author.accessStatus === 'suspended' ? (
            <Note tone="warning">{t('adminMarket.answer.suspendedNote', 'No e-mail: the requester’s account is suspended.')}</Note>
          ) : (
            <>
              <label className="flex cursor-pointer items-center gap-2.5 text-[14px] font-semibold leading-5 text-navy">
                <Checkbox checked={notify} onCheckedChange={v => setNotify(v === true)} />
                {t('adminMarket.answer.notify', 'Tell them by e-mail')}
              </label>
              {!record.emailsOn && notify && (
                <Note tone="warning">
                  {t('adminMarket.answer.senderOffNote', 'E-mails to members start at go-live: this change will NOT be e-mailed, now or later. The status still changes on the site.')}
                </Note>
              )}
              {notify && words && (
                <div className="rounded-xl border border-rule bg-page p-3.5">
                  <p className="text-meta-caps">{record.emailsOn ? t('adminMarket.answer.preview', 'What they will receive') : t('adminMarket.answer.previewOff', 'What this e-mail looks like once e-mails are on')}</p>
                  <p className="mt-1.5 text-[13px] leading-5 text-meta">
                    {t('adminMarket.answer.to', 'To: {{who}}', { who: record.author.email || record.author.name || '—' })}
                  </p>
                  <p className="mt-0.5 text-[14px] font-semibold leading-5 text-navy [overflow-wrap:anywhere]">{words.subject}</p>
                  <div className="mt-2 whitespace-pre-wrap text-[13px] leading-5 text-ink [overflow-wrap:anywhere]">
                    {`${words.greeting}\n\n${words.body}`}
                  </div>
                  <p className="mt-2 text-[12px] leading-4 text-meta">{t('adminMarket.answer.button', 'Button in the e-mail: “{{label}}”, to their requests on the site.', { label: words.buttonText })}</p>
                </div>
              )}
            </>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            <Button type="button" className={ADMIN_BTN_PRIMARY} onClick={() => void save()} disabled={!canSave}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Send className="mr-2 h-4 w-4" aria-hidden="true" />}
              {willEmail ? t('adminMarket.answer.saveSend', 'Save and send the e-mail') : t('adminMarket.answer.save', 'Save the new status')}
            </Button>
            <Button type="button" variant="outline" className={ADMIN_BTN} onClick={() => { setChoice(current); setMessage(''); }} disabled={busy}>
              {t('adminMarket.answer.cancel', 'Cancel')}
            </Button>
          </div>
          {needReason && !message.trim() && (
            <p className="text-[13px] leading-5 text-meta">{t('adminMarket.answer.reasonFirst', 'Write the reason first: the button then works.')}</p>
          )}
        </div>
      )}
    </AdminPanel>
  );
}

/* ------------------------------------------------------------------ what they wrote */

function WrittenPanel({ record, onDone }: { record: RequestRecord; onDone: () => void }) {
  const { t } = useTranslation();
  const kind = record.kind;
  const specs = FIELDS[kind];
  const initial = useMemo(() => Object.fromEntries(specs.map(s => [s.key, record.row[s.key] == null ? '' : String(record.row[s.key])])), [specs, record.row]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>(initial);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setDraft(initial); setEditing(false); }, [initial]);

  const changes = Object.fromEntries(
    specs.filter(s => (draft[s.key] ?? '').trim() !== (initial[s.key] ?? '').trim()).map(s => [s.key, (draft[s.key] ?? '').trim() || null]),
  );
  const missing = specs.filter(s => s.required && !(draft[s.key] ?? '').trim()).map(s => FIELD_LABEL[s.key]);

  const save = async () => {
    if (!Object.keys(changes).length || missing.length) return;
    setBusy(true);
    try {
      const n = await editRequest(kind, String(record.row.id), changes);
      toast({
        title: n ? t('adminMarket.edit.saved', 'Corrections saved') : t('adminMarket.edit.same', 'Nothing was different'),
        description: n ? t('adminMarket.edit.savedBody', 'The old text is kept in the history. The requester was not e-mailed.') : undefined,
      });
      setEditing(false);
      onDone();
    } catch (e) {
      toast({ title: t('adminMarket.edit.failed', 'The corrections were not saved'), description: actionErrorText(e), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const status = String(record.row.status ?? '');

  return (
    <AdminPanel
      title={kind === 'lead' ? t('adminMarket.written.titleLead', 'What they told us') : t('adminMarket.written.title', 'What they wrote')}
      icon={MessageSquare}
      actions={!editing ? (
        <Button type="button" variant="outline" className={ADMIN_BTN} onClick={() => setEditing(true)}>
          <Pencil className="mr-2 h-4 w-4" aria-hidden="true" />
          {t('adminMarket.written.correct', 'Correct the text')}
        </Button>
      ) : undefined}
    >
      {!editing ? (
        <dl className="grid gap-4 sm:grid-cols-2">
          {specs.map(s => (
            <div key={s.key} className={s.kind === 'long' || s.key === 'title' ? 'sm:col-span-2' : undefined}>
              <Field label={FIELD_LABEL[s.key]}>
                {s.key === 'email' && record.row.email
                  ? <a href={`mailto:${record.row.email}`} className="font-semibold text-navy underline decoration-navy/40 underline-offset-2 hover:decoration-navy">{record.row.email}</a>
                  : s.key === 'website' && externalUrl(record.row.website)
                    ? (
                      <a href={externalUrl(record.row.website) ?? undefined} target="_blank" rel="noopener noreferrer" className="font-semibold text-navy underline decoration-navy/40 underline-offset-2 [overflow-wrap:anywhere] hover:decoration-navy">
                        {String(record.row.website)}
                        <span className="sr-only"> {t('adminMarket.written.newTab', '(opens their website in a new tab)')}</span>
                      </a>
                    )
                  : s.kind === 'long'
                    ? <span className="block whitespace-pre-wrap">{shown(s, record.row[s.key])}</span>
                    : shown(s, record.row[s.key])}
              </Field>
            </div>
          ))}
          {record.sectors.length > 0 && <Field label={t('adminMarket.written.sectors', 'Sectors')}>{record.sectors.join(', ')}</Field>}
          {status === 'rejected' && record.row.rejection_reason && (
            <div className="sm:col-span-2">
              <Field label={kind === 'project'
                ? t('adminMarket.written.reasonProject', 'Reason given when it was turned down (only they and M3 can read it)')
                : t('adminMarket.written.reasonPublic', 'Reason they were given (on their account page; other members can read it too)')}>
                <span className="block whitespace-pre-wrap">{record.row.rejection_reason}</span>
              </Field>
            </div>
          )}
          {record.row.attachments_path && (
            <Field label={t('adminMarket.written.attachment', 'Attachment')}>{t('adminMarket.written.attachmentBody', 'A file was attached (not shown here).')}</Field>
          )}
        </dl>
      ) : (
        <div className="space-y-4">
          <Note>{t('adminMarket.edit.note', 'Correct a typo or a missing detail. The old text is kept in the history, and the requester is not e-mailed.')}</Note>
          {specs.map(s => (
            <label key={s.key} className="block">
              <span className="text-[13px] font-semibold leading-5 text-navy">
                {FIELD_LABEL[s.key]}{s.required ? ' *' : ''}
              </span>
              {s.kind === 'long' ? (
                <Textarea value={draft[s.key] ?? ''} onChange={e => setDraft(d => ({ ...d, [s.key]: e.target.value }))} rows={6} className="mt-1.5" />
              ) : s.kind === 'date' ? (
                <Input type="date" value={draft[s.key] ?? ''} onChange={e => setDraft(d => ({ ...d, [s.key]: e.target.value }))} className="mt-1.5 w-full sm:w-56" />
              ) : s.kind === 'choice' && s.options ? (
                <Select value={draft[s.key] || '__none'} onValueChange={v => setDraft(d => ({ ...d, [s.key]: v === '__none' ? '' : v }))}>
                  <SelectTrigger className="mt-1.5 w-full sm:w-72"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {!s.required && <SelectItem value="__none">{t('adminMarket.edit.none', 'Not given')}</SelectItem>}
                    {Object.entries(s.options).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                    {draft[s.key] && !(draft[s.key] in s.options) && <SelectItem value={draft[s.key]}>{codeLabel(s.options, draft[s.key])}</SelectItem>}
                  </SelectContent>
                </Select>
              ) : (
                <Input value={draft[s.key] ?? ''} onChange={e => setDraft(d => ({ ...d, [s.key]: e.target.value }))} className="mt-1.5" />
              )}
            </label>
          ))}
          {missing.length > 0 && (
            <p className="text-[13px] leading-5 text-red-700">{t('adminMarket.edit.missing', 'Cannot be empty: {{fields}}.', { fields: missing.join(', ') })}</p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="button" className={ADMIN_BTN_PRIMARY} onClick={() => void save()} disabled={busy || !Object.keys(changes).length || missing.length > 0}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
              {t('adminMarket.edit.save', 'Save the corrections')}
            </Button>
            <Button type="button" variant="outline" className={ADMIN_BTN} onClick={() => { setDraft(initial); setEditing(false); }} disabled={busy}>
              {t('adminMarket.edit.cancel', 'Cancel')}
            </Button>
          </div>
        </div>
      )}
    </AdminPanel>
  );
}

/* ------------------------------------------------------------------ who sent it */

function SenderPanel({ record }: { record: RequestRecord }) {
  const { t } = useTranslation();
  if (record.kind === 'lead') {
    const r = record.row;
    const name = [r.first_name, r.last_name].filter(Boolean).join(' ');
    return (
      <AdminPanel title={t('adminMarket.sender.titleLead', 'Who to contact')} icon={User}>
        <dl className="grid gap-4 sm:grid-cols-2">
          <Field label={t('adminMarket.sender.person', 'Person')}>{name}</Field>
          <Field label={t('adminMarket.sender.phone', 'Phone')}>{r.phone}</Field>
        </dl>
        <p className="mt-4 text-[14px] leading-5 text-meta">
          {t('adminMarket.sender.leadBody', 'They have no account: they filled the public partner form. Answer them yourself, by e-mail or by phone.')}
        </p>
        {r.email && (
          <div className="mt-3 flex flex-wrap gap-2">
            <CardLink to={`mailto:${r.email}`} external>{t('adminMarket.sender.write', 'Write to {{name}}', { name: name || r.email })}</CardLink>
          </div>
        )}
      </AdminPanel>
    );
  }
  const a = record.author;
  return (
    <AdminPanel title={t('adminMarket.sender.title', 'Who sent it')} icon={User}>
      <dl className="grid gap-4 sm:grid-cols-2">
        <Field label={t('adminMarket.sender.person', 'Person')}>
          {a?.name ?? t('adminMarket.sender.gone', 'This account no longer exists')}
          {a?.accessStatus === 'suspended' && <> <AdminStatusPill tone="danger">{t('adminMarket.sender.suspended', 'Suspended')}</AdminStatusPill></>}
        </Field>
        <Field label={t('adminMarket.sender.email', 'E-mail')}>{a?.email}</Field>
        <div className="sm:col-span-2">
          <Field label={t('adminMarket.sender.company', 'Company')}>
            {record.org?.name ?? t('adminMarket.sender.noCompany', 'No company on the platform')}
          </Field>
        </div>
      </dl>
      <div className="mt-4 flex flex-wrap gap-2">
        {a && <CardLink to={`/admin/people/${a.id}`}>{t('adminMarket.sender.openPerson', 'Open their page')}</CardLink>}
        {record.org && <CardLink to={`/admin/companies/${record.org.id}`}>{t('adminMarket.sender.openCompany', 'Open the company page')}</CardLink>}
        {a?.email && <CardLink to={`mailto:${a.email}`} external>{t('adminMarket.sender.writeShort', 'Write to them')}</CardLink>}
      </div>
    </AdminPanel>
  );
}

/* ------------------------------------------------------------------ notes */

function NotesPanel({ record, onDone }: { record: RequestRecord; onDone: () => void }) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const notes = record.history.filter(h => h.action === 'request_note').slice().reverse();
  const old = record.row.admin_notes ? String(record.row.admin_notes) : '';

  const add = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await addRequestNote(record.kind, String(record.row.id), text.trim());
      setText('');
      toast({ title: t('adminMarket.notes.saved', 'Note added') });
      onDone();
    } catch (e) {
      toast({ title: t('adminMarket.notes.failed', 'The note was not added'), description: actionErrorText(e), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminPanel title={t('adminMarket.notes.title', 'M3 notes')} icon={StickyNote} description={t('adminMarket.notes.desc', 'The notes you add here: only the M3 team sees them.')}>
      <label className="block">
        <span className="sr-only">{t('adminMarket.notes.new', 'New note')}</span>
        <Textarea value={text} onChange={e => setText(e.target.value)} rows={3} maxLength={4000} placeholder={t('adminMarket.notes.placeholder', 'For example: called them on Monday, they will send the plans.')} />
      </label>
      <div className="mt-2">
        <Button type="button" variant="outline" className={ADMIN_BTN} onClick={() => void add()} disabled={busy || !text.trim()}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
          {t('adminMarket.notes.add', 'Add the note')}
        </Button>
      </div>
      {(notes.length > 0 || old) && (
        <ul className="mt-4 space-y-3 border-t border-rule pt-4">
          {notes.map(n => (
            <li key={n.id}>
              <p className="whitespace-pre-wrap text-[14px] leading-5 text-ink [overflow-wrap:anywhere]">{n.note}</p>
              <p className="mt-0.5 text-[12px] leading-4 text-meta">{[n.actorName, fmtWhen(n.createdAt)].filter(Boolean).join(' · ')}</p>
            </li>
          ))}
          {old && (
            <li>
              <p className="whitespace-pre-wrap text-[14px] leading-5 text-ink [overflow-wrap:anywhere]">{old}</p>
              <p className="mt-0.5 text-[12px] leading-4 text-meta">
                {record.kind === 'lead'
                  ? t('adminMarket.notes.old', 'Written on the previous admin screen')
                  : record.kind === 'project'
                    ? t('adminMarket.notes.oldProject', 'Old note from the previous admin screen. NOT private: the requester can read it')
                    : t('adminMarket.notes.oldPublic', 'Old note from the previous admin screen. NOT private: members can read it')}
              </p>
            </li>
          )}
        </ul>
      )}
    </AdminPanel>
  );
}

/* ------------------------------------------------------------------ history */

function emailLine(h: HistoryEntry, outbox: Map<number, OutboxEntry>): { tone: AdminTone; text: string } | null {
  const how = String(h.details.email ?? '');
  if (how === 'queued') {
    const o = outbox.get(Number(h.details.outbox_id));
    if (!o) return { tone: 'info', text: 'E-mail queued.' };
    const err = o.lastError ?? '';
    if (o.sentAt && !err) return { tone: 'success', text: `E-mail sent ${fmtWhen(o.sentAt)}.` };
    if (o.sentAt) return { tone: 'neutral', text: `E-mail not sent: ${err.replace(/^not sent:\s*/i, '')}.` };
    if (err.startsWith('gave up')) return { tone: 'danger', text: 'The e-mail could not be sent (it gave up after 5 tries).' };
    if (err.startsWith('held')) return { tone: 'info', text: 'E-mail waiting: the new e-mail service is not online yet.' };
    if (err) return { tone: 'warning', text: 'E-mail not sent yet: it will be tried again.' };
    return { tone: 'info', text: 'E-mail waiting to be sent.' };
  }
  const plain: Record<string, string> = {
    sender_off: 'No e-mail: e-mails to members start at go-live.',
    not_asked: 'No e-mail (M3 chose not to send one).',
    no_author: 'No e-mail: the requester’s account no longer exists.',
    author_suspended: 'No e-mail: the requester’s account is suspended.',
  };
  return plain[how] ? { tone: 'neutral', text: plain[how] } : null;
}

function HistoryPanel({ record }: { record: RequestRecord }) {
  const { t } = useTranslation();
  const kind = record.kind;
  const items = record.history.slice().reverse();
  const sender = kind === 'lead'
    ? [record.row.first_name, record.row.last_name].filter(Boolean).join(' ') || t('adminMarket.history.someone', 'Someone')
    : record.author?.name ?? t('adminMarket.history.member', 'A member');

  const entry = (h: HistoryEntry): { title: ReactNode; body?: ReactNode } => {
    const who = h.actorName ?? t('adminMarket.history.staff', 'M3');
    if (h.action === 'request_status') {
      const to = String(h.details.to ?? '');
      const from = h.details.from == null ? '' : String(h.details.from);
      const mail = emailLine(h, record.outbox);
      const noteLabel = to === 'rejected' && kind !== 'lead' ? 'Reason' : h.details.email === 'queued' ? 'Message in the e-mail' : 'Note';
      return {
        title: <>{t('adminMarket.history.status', '{{who}} changed the status', { who })}: <strong className="font-semibold">{statusName(kind, from)}</strong> → <strong className="font-semibold">{statusName(kind, to)}</strong></>,
        body: (
          <>
            {h.note && <p className="whitespace-pre-wrap [overflow-wrap:anywhere]"><span className="font-semibold text-navy">{noteLabel}: </span>{h.note}</p>}
            {mail && <p className="mt-1"><AdminStatusPill tone={mail.tone} icon={Mail}>{mail.text}</AdminStatusPill></p>}
          </>
        ),
      };
    }
    if (h.action === 'request_edited') {
      const fields = (h.details.fields ?? {}) as Record<string, { from: unknown; to: unknown }>;
      const names = Object.keys(fields).map(k => FIELD_LABEL[k] ?? k);
      return {
        title: t('adminMarket.history.edited', '{{who}} corrected the text: {{fields}}', { who, fields: names.join(', ') }),
        body: (
          <details className="group/d mt-1">
            <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-pill border border-navy/55 bg-white px-3 py-1 text-[13px] font-semibold text-navy hover:bg-chip [&::-webkit-details-marker]:hidden">
              {t('adminMarket.history.seeChanges', 'See what changed')}
              <span aria-hidden="true" className="transition-transform group-open/d:rotate-180">⌄</span>
            </summary>
            <ul className="mt-2 space-y-2">
              {Object.entries(fields).map(([k, v]) => (
                <li key={k} className="rounded-lg border border-rule bg-page p-2.5">
                  <p className="text-[12px] font-semibold uppercase tracking-[0.06em] text-meta">{FIELD_LABEL[k] ?? k}</p>
                  <p className="mt-1 whitespace-pre-wrap text-[13px] leading-5 text-meta line-through decoration-meta/50 [overflow-wrap:anywhere]">{v.from == null || v.from === '' ? t('adminMarket.history.empty', '(empty)') : String(v.from)}</p>
                  <p className="mt-1 whitespace-pre-wrap text-[13px] leading-5 text-ink [overflow-wrap:anywhere]">{v.to == null || v.to === '' ? t('adminMarket.history.empty', '(empty)') : String(v.to)}</p>
                </li>
              ))}
            </ul>
          </details>
        ),
      };
    }
    if (h.action === 'request_note') {
      return { title: t('adminMarket.history.note', '{{who}} added a note', { who }), body: <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{h.note}</p> };
    }
    return { title: `${who}: ${h.action}` };
  };

  return (
    <AdminPanel title={t('adminMarket.history.title', 'History')} icon={History} description={t('adminMarket.history.desc', 'Every change made here, newest first.')}>
      <ol className="space-y-4">
        {items.map(h => {
          const e = entry(h);
          return (
            <li key={h.id} className="border-l-2 border-rule pl-3.5">
              <p className="text-[12px] leading-4 text-meta">{fmtWhen(h.createdAt)}</p>
              <p className="mt-0.5 text-[14px] leading-5 text-ink">{e.title}</p>
              {e.body && <div className="mt-1 text-[14px] leading-5 text-ink">{e.body}</div>}
            </li>
          );
        })}
        <li className="border-l-2 border-gold pl-3.5">
          <p className="text-[12px] leading-4 text-meta">{fmtWhen(record.row.created_at)}</p>
          <p className="mt-0.5 text-[14px] leading-5 text-ink">
            {t('adminMarket.history.sent', '{{who}} sent this {{what}}', { who: sender, what: KIND_SHORT[kind] === 'RFP' ? 'request for proposals' : KIND_LABEL[kind].toLowerCase() })}
          </p>
        </li>
      </ol>
    </AdminPanel>
  );
}
