import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { Block, ChoiceCards, Field, INPUT, Note, ToggleRow } from './editorUi';
import type { EventKind, RegistrationMode } from './eventAdmin';
import type { EmailsForm, FormIssue } from './editorModel';

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
 * here staff choose the reminders, the replay and who at M3 is told.
 */
export function EmailsTab({
  value,
  onChange,
  issues,
  kind,
  mode,
}: {
  value: EmailsForm;
  onChange: (next: EmailsForm) => void;
  issues: FormIssue[];
  kind: EventKind;
  /** How people register (the How to register tab, saved or not): what the first e-mail says. */
  mode: RegistrationMode;
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
          ? t('adminEvents.mail.alwaysOnsite', 'Every registrant gets an e-mail when they register and when M3 decides. Those cannot be switched off.')
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

      {webinar && (
        <Block
          title={t('adminEvents.mail.afterTitle', 'After the webinar')}
          description={t(
            'adminEvents.mail.afterBody2',
            'In People registered, mark who attended (paste the list from Zoom or Teams), then press "Attendance is complete". From one hour after the end, the others get a "Sorry we missed you" e-mail with the replay link (without a replay link, it waits two days). Until you press it, nobody gets "Sorry we missed you": once the replay link is here, everyone gets a simple "The replay is available" e-mail instead. So mark attendance first, then add the replay link.',
          )}
        >
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
          <ToggleRow
            checked={v.replayPublic}
            onChange={(on) => set('replayPublic', on)}
            disabled={!v.replayUrl.trim()}
            title={t('adminEvents.mail.replayPublic', 'Also show the replay on the public event page')}
            body={t('adminEvents.mail.replayPublicBody', 'Off: only registrants get it, by e-mail.')}
          />
        </Block>
      )}

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
    </div>
  );
}
