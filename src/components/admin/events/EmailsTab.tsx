import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Loader2, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Block, ChoiceCards, EDITOR_BTN, Field, INPUT, Note, TEXTAREA, ToggleRow } from './editorUi';
import { EmailPreview, type PreviewEvent } from './EmailPreview';
import { NO_CAPS, registrationStaff, staffErrorText, type EventKind, type RegistrationCaps, type RegistrationMode } from './eventAdmin';
import { INTRO_MAX, INTRO_TEMPLATES, type EditorTab, type EmailsForm, type FormIssue, type IntroTemplate } from './editorModel';

/**
 * The reminder times staff can tick (ISO-8601 durations before the start).
 * registration-cron runs once an hour (at :10) and sends a reminder up to 30 minutes
 * early, so nothing shorter than one hour can be promised: no "15 minutes before".
 * A duration stored by SQL still shows (see `extra`), so a save never drops it.
 */
const REMINDER_CHOICES: { value: string; kinds: EventKind[] }[] = [
  { value: 'P7D', kinds: ['webinar', 'onsite'] },
  { value: 'P1D', kinds: ['webinar', 'onsite'] },
  { value: 'PT1H', kinds: ['webinar'] },
];

/**
 * E-mails: the automatic messages around the event. Confirmation e-mails always go;
 * here staff choose the reminders, the replay and who at M3 is told. On-site events
 * (on-site editor) also get the practical information, M3's own opening paragraph per
 * e-mail with a preview, and "Send a test to me"; their M3 team fields sit in Basics.
 */
export function EmailsTab({
  value,
  onChange,
  issues,
  kind,
  mode,
  attendanceRecorded = false,
  onOpenRegistrations,
  preview,
  glEventId = null,
  caps = NO_CAPS,
}: {
  value: EmailsForm;
  onChange: (next: EmailsForm) => void;
  issues: FormIssue[];
  kind: EventKind;
  /** How people register (the How to register tab, saved or not): what the first e-mail says. */
  mode: RegistrationMode;
  /** Staff pressed "Attendance is complete" (gl_event.settings.attendance_recorded === true). */
  attendanceRecorded?: boolean;
  /** Opens the People registered tab (existing events only). */
  onOpenRegistrations?: () => void;
  /** On-site editor: the event as the e-mails show it (unsaved changes included). */
  preview?: PreviewEvent;
  /** Saved event (gl_event id): "Send a test to me" needs it. */
  glEventId?: string | null;
  /** What the deployed registration function can do: test e-mails, intros printed. */
  caps?: RegistrationCaps;
}) {
  const { t } = useTranslation();
  const v = value;
  const set = <K extends keyof EmailsForm>(k: K, val: EmailsForm[K]) => onChange({ ...v, [k]: val });
  const err = (field: string) => issues.find((i) => i.tab === 'emails' && i.field === field)?.message;
  const webinar = kind === 'webinar';

  const reminderWords: Record<string, string> = {
    P7D: t('adminEvents.mail.week', 'One week before'),
    P1D: t('adminEvents.mail.day', 'The day before'),
    PT1H: t('adminEvents.mail.hour', 'About one hour before, with the join link'),
    PT15M: t('adminEvents.mail.quarter', '15 minutes before (not reliable: better untick it)'),
  };
  const choices = REMINDER_CHOICES.filter((c) => c.kinds.includes(kind));
  // Durations set elsewhere (by SQL) stay listed so a save never drops them silently.
  const extra = v.reminders.filter((r) => !choices.some((c) => c.value === r));
  const toggle = (d: string) => {
    const on = v.reminders.includes(d);
    set('reminders', on ? v.reminders.filter((x) => x !== d) : [...v.reminders, d]);
  };

  return (
    <div className="space-y-6">
      <Note>
        {!webinar
          ? t('adminEvents.mail.alwaysOnsite2', 'Every registrant gets an e-mail when they register and when M3 decides. Those cannot be switched off. Once M3 confirms someone, a second e-mail lets them choose the password of their Smart Marina Connect account (when: How to register).')
          : mode === 'instant'
            ? t('adminEvents.mail.always', 'Every registrant gets a confirmation e-mail with a calendar file and their personal link. Those cannot be switched off.')
            : t('adminEvents.mail.alwaysReview', 'Every registrant first gets an e-mail saying their request was received, then one when M3 decides (with the calendar file and their personal link once confirmed). Those cannot be switched off.')}
      </Note>

      <Block
        title={t('adminEvents.mail.remindersTitle', 'Reminders')}
        description={t('adminEvents.mail.remindersBody', 'Sent to confirmed registrants only. Someone who registers late gets only the next one.')}
      >
        <ToggleRow
          checked={v.remindersOn}
          onChange={(on) => set('remindersOn', on)}
          title={t('adminEvents.mail.sendReminders', 'Send reminders')}
        />
        {v.remindersOn && (
          <div className="space-y-2" role="group" aria-label={t('adminEvents.mail.when', 'When')}>
            {[...choices.map((c) => c.value), ...extra].map((d) => {
              const on = v.reminders.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  onClick={() => toggle(d)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-card border bg-white px-4 py-3 text-left text-[15px] font-medium text-navy transition-colors focus:outline-none focus-visible:shadow-focus',
                    on ? 'border-navy' : 'border-rule hover:border-navy/30',
                  )}
                >
                  <span className={cn('grid h-5 w-5 shrink-0 place-items-center rounded-[6px] border', on ? 'border-navy bg-navy text-white' : 'border-rule')} aria-hidden="true">
                    {on && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                  </span>
                  {reminderWords[d] ?? d}
                </button>
              );
            })}
            {err('reminders') && <p role="alert" className="text-[13px] font-medium text-red-700">{err('reminders')}</p>}
          </div>
        )}
      </Block>

      {!webinar && (
        <Block
          title={t('adminEvents.mail.practicalTitle', 'Practical information')}
          description={t('adminEvents.mail.practicalBody', 'Printed in the confirmation with the entry QR code and in the reminders: access, parking, dress code, badge pick-up.')}
        >
          <Field label={t('adminEvents.mail.practical', 'Practical information')} htmlFor="mail-practical" optional>
            <Textarea
              id="mail-practical"
              rows={5}
              value={v.practicalInfo}
              onChange={(e) => set('practicalInfo', e.target.value.slice(0, 2000))}
              placeholder={t('adminEvents.mail.practicalPh', 'Doors open at 8:30. Bring a photo ID. Business attire.')}
              className={TEXTAREA}
            />
          </Field>
        </Block>
      )}

      {!webinar && preview && (
        <IntrosBlock
          value={v.intros}
          onChange={(intros) => set('intros', intros)}
          preview={{ ...preview, practicalInfo: v.practicalInfo }}
          glEventId={glEventId}
          testReady={caps.sendTest}
          introsLive={caps.intros}
        />
      )}

      {webinar && (
        <Block
          title={t('adminEvents.mail.afterTitle', 'After the webinar')}
          description={t('adminEvents.mail.afterBody3', 'People who did not attend get a "Sorry we missed you" e-mail. Do it in this order:')}
        >
          <ol className="space-y-2 text-[15px] leading-6 text-navy">
            {[
              t('adminEvents.mail.step1', 'Mark who attended, in People registered (paste the list from Zoom or Teams).'),
              t('adminEvents.mail.step2', 'Press "Attendance is complete".'),
              t('adminEvents.mail.step3', 'Add the replay link below and save.'),
            ].map((s, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-foam text-[13px] font-semibold tabular-nums text-navy" aria-hidden="true">{i + 1}</span>
                <span>{s}</span>
              </li>
            ))}
          </ol>
          <p className="text-[13px] leading-[18px] text-meta">
            {t('adminEvents.mail.afterTiming', 'The people not marked then get "Sorry we missed you" with the replay link, from one hour after the end. Without a replay link, it waits two days after the end.')}
          </p>
          {onOpenRegistrations && (
            <Button type="button" variant="outline" size="sm" className={EDITOR_BTN} onClick={onOpenRegistrations}>
              {t('adminEvents.mail.goPeople', 'Go to People registered')}
            </Button>
          )}
          <Field
            label={t('adminEvents.mail.replay', 'Replay link')}
            htmlFor="mail-replay"
            error={err('replayUrl')}
            optional
            hint={t('adminEvents.mail.replayHint', 'YouTube, Vimeo or any page with the recording.')}
          >
            <Input
              id="mail-replay"
              type="url"
              inputMode="url"
              value={v.replayUrl}
              onChange={(e) => set('replayUrl', e.target.value)}
              placeholder="https://"
              className={INPUT}
              autoCapitalize="none"
              spellCheck={false}
            />
          </Field>
          {v.replayUrl.trim() && !attendanceRecorded && (
            <Note tone="warning">
              <span role="status">
                {t('adminEvents.mail.replayFirst', 'Attendance is not complete yet. Once this link is saved, the replay e-mail goes from one hour after the end: if attendance is not complete by then, everyone confirmed gets "The replay is available" and nobody gets "Sorry we missed you". To send that e-mail, mark attendance and press "Attendance is complete" first.')}
              </span>
            </Note>
          )}
          <ToggleRow
            checked={v.replayPublic}
            onChange={(on) => set('replayPublic', on)}
            disabled={!v.replayUrl.trim()}
            title={t('adminEvents.mail.replayPublic', 'Also show the replay on the public event page')}
            body={t('adminEvents.mail.replayPublicBody', 'Off: only registrants get it, by e-mail.')}
          />
        </Block>
      )}

      {webinar && <StaffAlertBlock value={v} onChange={onChange} issues={issues} issueTab="emails" mode={mode} />}
    </div>
  );
}

/**
 * "M3 team": who at M3 hears about new registrations, how often, and where replies go.
 * In E-mails for webinars; in Basics for on-site events (spec §8.2 "staff alert address").
 */
export function StaffAlertBlock({
  value: v,
  onChange,
  issues,
  issueTab,
  mode,
}: {
  value: EmailsForm;
  onChange: (next: EmailsForm) => void;
  issues: FormIssue[];
  issueTab: EditorTab;
  mode: RegistrationMode;
}) {
  const { t } = useTranslation();
  const set = <K extends keyof EmailsForm>(k: K, val: EmailsForm[K]) => onChange({ ...v, [k]: val });
  const err = (field: string) => issues.find((i) => i.tab === issueTab && i.field === field)?.message;
  return (
    <Block
      title={t('adminEvents.mail.staffTitle', 'M3 team')}
      description={t('adminEvents.mail.staffBody', 'Who at M3 hears about new registrations, and where replies from registrants go.')}
    >
      <Field
        label={t('adminEvents.mail.notify', 'Tell this address about new registrations')}
        htmlFor="mail-notify"
        error={err('notifyEmail')}
        optional={mode === 'instant'}
        hint={mode === 'instant'
          ? t('adminEvents.mail.notifyHint', 'One e-mail address. A shared mailbox works best. Empty: nobody at M3 is told.')
          : t('adminEvents.mail.notifyHintReview', 'One e-mail address. A shared mailbox works best. Needed when M3 accepts each person, so requests never wait unseen.')}
      >
        <Input
          id="mail-notify"
          type="email"
          inputMode="email"
          value={v.notifyEmail}
          onChange={(e) => set('notifyEmail', e.target.value)}
          placeholder="events@m3monaco.com"
          className={INPUT}
          autoCapitalize="none"
          spellCheck={false}
        />
      </Field>
      <ChoiceCards
        label={t('adminEvents.mail.howOften', 'How often')}
        columns={2}
        value={v.staffAlertMode}
        onChange={(m) => set('staffAlertMode', m)}
        options={[
          { value: 'each', title: t('adminEvents.mail.each', 'One e-mail per registration'), body: t('adminEvents.mail.eachBody', 'Best when M3 accepts each person.') },
          { value: 'digest', title: t('adminEvents.mail.digest', 'One summary a day'), body: t('adminEvents.mail.digestBody', 'Sent in the morning, only when there is something new.') },
        ]}
      />
      <Field
        label={t('adminEvents.mail.replyTo', 'Replies from registrants go to')}
        htmlFor="mail-reply"
        error={err('contactEmail')}
        optional
        hint={t('adminEvents.mail.replyToHint', 'Empty: events@m3monaco.com.')}
      >
        <Input
          id="mail-reply"
          type="email"
          inputMode="email"
          value={v.contactEmail}
          onChange={(e) => set('contactEmail', e.target.value)}
          placeholder="events@m3monaco.com"
          className={INPUT}
          autoCapitalize="none"
          spellCheck={false}
        />
      </Field>
    </Block>
  );
}

/**
 * M3's own opening paragraph, one per e-mail (settings.email_intros), with the e-mail
 * drawn next to it and "Send a test to me": the registration function sends that test
 * to the signed-in staff member's own address only (the address is never typed here).
 * Until the deployed functions print the paragraph (RegistrationCaps.intros), it is saved
 * and the preview shows the e-mail as it goes today, without it; "Send a test to me"
 * appears with the function that sends tests.
 */
function IntrosBlock({
  value,
  onChange,
  preview,
  glEventId,
  testReady,
  introsLive,
}: {
  value: Partial<Record<IntroTemplate, string>>;
  onChange: (next: Partial<Record<IntroTemplate, string>>) => void;
  preview: PreviewEvent;
  glEventId: string | null;
  testReady: boolean;
  introsLive: boolean;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [template, setTemplate] = useState<IntroTemplate>('reg_confirmed');
  const [sending, setSending] = useState(false);
  const words: Record<IntroTemplate, string> = {
    reg_received: preview.mode === 'invitation'
      ? t('adminEvents.mail.tplRequest', 'Request received')
      : t('adminEvents.mail.tplReceived', 'Registration received'),
    reg_confirmed: t('adminEvents.mail.tplConfirmed', 'Place confirmed, with the QR code'),
    reg_waitlisted: t('adminEvents.mail.tplWaitlist', 'Waiting list'),
    reg_info_requested: t('adminEvents.mail.tplInfo', 'Information needed'),
    reg_not_accepted: t('adminEvents.mail.tplNotAccepted', 'Not accepted'),
    reg_invitation: t('adminEvents.mail.tplInvitation', 'Invitation'),
    reg_reminder: t('adminEvents.mail.tplReminder', 'Reminder'),
  };
  const text = value[template] || '';
  const setText = (s: string) => {
    const next = { ...value };
    if (s) next[template] = s.slice(0, INTRO_MAX); else delete next[template];
    onChange(next);
  };

  const sendTest = async () => {
    if (!glEventId) return;
    setSending(true);
    const res = await registrationStaff<{ ok?: boolean }>({ action: 'send_test', gl_event_id: glEventId, template, intro: text.trim() });
    setSending(false);
    if (res.error || res.ok !== true) {
      toast({ title: t('adminEvents.mail.testFailed', 'The test could not be sent'), description: staffErrorText(res.error, t), variant: 'destructive' });
    } else {
      toast({ title: t('adminEvents.mail.testSent', 'Test sent to {{email}}', { email: user?.email || t('adminEvents.mail.yourAddress', 'your address') }) });
    }
  };

  return (
    <Block
      title={t('adminEvents.mail.introsTitle', 'Your words in the e-mails')}
      description={t('adminEvents.mail.introsBody', 'Each e-mail keeps M3\'s standard text. Add a short paragraph of your own at the top: a welcome, a dress code, what to bring.')}
    >
      {!introsLive && (
        <Note tone="warning">
          {t('adminEvents.mail.introsLater', 'Your paragraphs are saved now and appear in the e-mails once the next e-mail update is installed. Until then the e-mails go without them, as the preview shows.')}
        </Note>
      )}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-4">
          <Field label={t('adminEvents.mail.which', 'E-mail')}>
            <Select value={template} onValueChange={(x) => setTemplate(x as IntroTemplate)}>
              <SelectTrigger className={INPUT} aria-label={t('adminEvents.mail.which', 'E-mail')}><SelectValue /></SelectTrigger>
              <SelectContent>
                {INTRO_TEMPLATES.map((k) => (
                  <SelectItem key={k} value={k}>
                    {words[k]}{value[k]?.trim() ? ` · ${t('adminEvents.mail.hasText', 'your text added')}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field
            label={t('adminEvents.mail.introLabel', 'Your paragraph')}
            htmlFor="mail-intro"
            optional
            hint={t('adminEvents.mail.introHint', '{{n}} characters left. Plain text: a blank line starts a new paragraph.', { n: INTRO_MAX - text.length })}
          >
            <Textarea
              id="mail-intro"
              rows={6}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t('adminEvents.mail.introPh', 'We look forward to welcoming you in Monaco.')}
              className={TEXTAREA}
              maxLength={INTRO_MAX}
            />
          </Field>
          {testReady && (
            <div className="space-y-1.5">
              <Button type="button" variant="outline" size="sm" className={EDITOR_BTN} onClick={() => void sendTest()} disabled={!glEventId || sending}>
                {sending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="mr-1.5 h-4 w-4" aria-hidden="true" />}
                {t('adminEvents.mail.sendTest', 'Send a test to me')}
              </Button>
              <p className="text-[13px] leading-[18px] text-meta [overflow-wrap:anywhere]">
                {glEventId
                  ? t('adminEvents.mail.sendTestHint', 'Goes to your own address ({{email}}) only, with sample details. Your paragraph is sent as written here, saved or not.', { email: user?.email || '…' })
                  : t('adminEvents.mail.sendTestNew', 'Create the event first: tests are sent for a saved event.')}
              </p>
            </div>
          )}
        </div>
        <EmailPreview template={template} event={preview} intro={introsLive ? text : ''} />
      </div>
    </Block>
  );
}
