import { useTranslation } from 'react-i18next';
import { QrCode, UserPlus } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { AdminStatusPill } from '../AdminUI';
import { Block, ChoiceCards, Field, INPUT, Note, PillChoice, ToggleRow } from './editorUi';
import { STANDARD_FIELDS, formatInZone, wallToIso, type EventKind, type FieldRule, type RegistrationMode, type StandardField } from './eventAdmin';
import type { FormIssue, RegistrationForm } from './editorModel';

/**
 * Registration: how people sign up, who may, how many, and what the form asks besides
 * name and e-mail (always asked). Webinars since Phase 1; on-site events in the on-site
 * editor (Phase 3): On request or Invitation only (M3 checks everyone, never "Open"),
 * the timing of the account e-mail, and the door pass (always each person's own code).
 */
export function RegistrationTab({
  value,
  onChange,
  issues,
  timezone,
  eventStart,
  invitationAllowed,
  kind = 'webinar',
  ticketCount = 0,
}: {
  value: RegistrationForm;
  onChange: (next: RegistrationForm) => void;
  issues: FormIssue[];
  timezone: string;
  /** The event's start (wall clock), to explain the default closing time. */
  eventStart: string;
  /** "By invitation" stays selectable only for an event already saved that way (webinars: sending invitations comes later). */
  invitationAllowed: boolean;
  kind?: EventKind;
  /** On-site: active participation types (each may have its own limit). */
  ticketCount?: number;
}) {
  const { t } = useTranslation();
  const v = value;
  const onsite = kind === 'onsite';
  const set = <K extends keyof RegistrationForm>(k: K, val: RegistrationForm[K]) => onChange({ ...v, [k]: val });
  const err = (field: string) => issues.find((i) => i.tab === 'registration' && i.field === field)?.message;

  const fieldWords: Record<StandardField, string> = {
    company: t('adminEvents.reg.company', 'Company'),
    job_title: t('adminEvents.reg.jobTitle', 'Job title'),
    phone: t('adminEvents.reg.phone', 'Phone'),
    country: t('adminEvents.reg.country', 'Country'),
  };
  const ruleOptions: { value: FieldRule; label: string }[] = [
    { value: 'required', label: t('adminEvents.reg.required', 'Required') },
    { value: 'optional', label: t('adminEvents.reg.optional', 'Optional') },
    { value: 'hidden', label: t('adminEvents.reg.notAsked', 'Not asked') },
  ];
  const zoneNote = (wall: string) => {
    const iso = wall ? wallToIso(wall, timezone) : null;
    return iso ? formatInZone(iso, timezone) : '';
  };

  const modeOptions: { value: RegistrationMode; title: string; body: string; disabled?: boolean }[] = onsite
    ? [
      { value: 'review', title: t('adminEvents.reg.review', 'On request'), body: t('adminEvents.reg.reviewBodyOnsite', 'Anyone can register. M3 checks each person in People registered and confirms them by e-mail, with their entry QR code.') },
      { value: 'invitation', title: t('adminEvents.reg.invitationOnly', 'Invitation only'), body: t('adminEvents.reg.invitationBodyOnsite', 'M3 invites people from People registered. You can also let others ask for an invitation.') },
    ]
    : [
      { value: 'instant', title: t('adminEvents.reg.instant', 'Open'), body: t('adminEvents.reg.instantBody', 'Registration is confirmed at once. They get the e-mail with the calendar file straight away.') },
      { value: 'review', title: t('adminEvents.reg.review', 'On request'), body: t('adminEvents.reg.reviewBody', 'M3 accepts each person in People registered. They are told by e-mail.') },
      {
        value: 'invitation',
        title: t('adminEvents.reg.invitation', 'By invitation'),
        body: invitationAllowed
          ? t('adminEvents.reg.invitationBody', 'Only for people M3 invites, or who ask for an invitation.')
          : t('adminEvents.reg.invitationLater', 'Comes with invitations, in a later update.'),
        disabled: !invitationAllowed,
      },
    ];

  return (
    <div className="space-y-6">
      <Block
        title={t('adminEvents.reg.modeTitle', 'How people register')}
        description={onsite
          ? t('adminEvents.reg.modeBodyOnsite', 'M3 checks every person who registers for an on-site event. Signed-in members never retype what their profile already says.')
          : t('adminEvents.reg.modeBody', 'Signed-in members register in one click. Others fill in a short form, without creating an account.')}
      >
        <ChoiceCards
          label={t('adminEvents.reg.modeTitle', 'How people register')}
          columns={onsite ? 2 : 3}
          value={v.mode}
          onChange={(mode) => set('mode', mode)}
          options={modeOptions}
        />
        {err('mode') && <p role="alert" className="text-[13px] font-medium text-red-700">{err('mode')}</p>}
        {v.mode === 'invitation' && (
          <>
            <ToggleRow
              checked={v.publicRequests}
              onChange={(on) => set('publicRequests', on)}
              title={t('adminEvents.reg.publicRequests', 'People can ask for an invitation')}
              body={t('adminEvents.reg.publicRequestsBody', 'The event page shows "Request an invitation". You accept each request in People registered.')}
            />
            {onsite ? (
              <Note>
                {v.publicRequests
                  ? t('adminEvents.reg.inviteHowOnsite', 'Invite people from People registered > Invite people (paste up to 500 addresses). They reply from their e-mail.')
                  : t('adminEvents.reg.inviteOnlyOnsite', 'Only the people you invite can register: invite them from People registered > Invite people.')}
              </Note>
            ) : (
              <Note tone="warning">
                {v.publicRequests
                  ? t('adminEvents.reg.inviteLater', 'Sending invitations from this page comes in a later update. Until then, people ask for an invitation and you accept them.')
                  : t('adminEvents.reg.inviteNobody', 'Sending invitations from this page comes in a later update. With requests off, nobody can register for now: turn requests on above.')}
              </Note>
            )}
          </>
        )}
      </Block>

      <Block title={t('adminEvents.reg.whoTitle', 'Who can register')}>
        <ChoiceCards
          label={t('adminEvents.reg.whoTitle', 'Who can register')}
          columns={2}
          value={v.access}
          onChange={(access) => set('access', access)}
          options={[
            { value: 'public', title: t('adminEvents.reg.everyone', 'Everyone'), body: t('adminEvents.reg.everyoneBody', 'Members and people without an account.') },
            { value: 'members', title: t('adminEvents.reg.members', 'Validated members only'), body: t('adminEvents.reg.membersBody', 'People whose account M3 has validated. The event page stays visible to everyone.') },
          ]}
        />
      </Block>

      <Block title={t('adminEvents.reg.placesTitle', 'Places')}>
        <Field
          label={t('adminEvents.reg.capacity', 'Number of places')}
          htmlFor="reg-capacity"
          error={err('capacity')}
          hint={onsite
            ? t('adminEvents.reg.capacityHintOnsite', 'For the whole event. Leave empty for no limit. Each participation type can also have its own limit.')
            : t('adminEvents.reg.capacityHint', 'Leave empty for no limit.')}
        >
          <Input
            id="reg-capacity"
            inputMode="numeric"
            value={v.capacity}
            onChange={(e) => set('capacity', e.target.value.replace(/[^\d]/g, '').slice(0, 6))}
            placeholder={t('adminEvents.reg.noLimit', 'No limit')}
            className={`${INPUT} max-w-[12rem]`}
          />
        </Field>
        <ToggleRow
          checked={v.waitlist}
          onChange={(on) => set('waitlist', on)}
          title={t('adminEvents.reg.waitlist', 'Waiting list when full')}
          body={onsite
            ? t('adminEvents.reg.waitlistBodyOnsite', 'When places run out, M3 can put people on a waiting list and confirm them later, from People registered. Nobody is moved up automatically.')
            : t('adminEvents.reg.waitlistBody2', 'Once all places are taken, new people join a waiting list. Nobody is moved up automatically: when a place frees up, press Confirm next to them in People registered.')}
        />
        {onsite && (
          <div className="flex flex-col gap-2 rounded-card border border-dashed border-rule bg-page p-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <UserPlus className="mt-0.5 h-5 w-5 shrink-0 text-meta" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-[15px] font-semibold leading-5 text-meta">{t('adminEvents.reg.plusOnes', 'Bringing a guest (plus-one)')}</p>
                <p className="mt-1 text-[13px] leading-[18px] text-meta">
                  {v.plusOnes > 0
                    ? t('adminEvents.reg.plusOnesOn', 'Allowed for this event (set outside this editor). Plus-ones are handled in the new system from December.')
                    : t('adminEvents.reg.plusOnesLater', 'Not offered. Plus-ones come to the new system in December; WYS keeps its own.')}
                </p>
              </div>
            </div>
            <AdminStatusPill className="self-start">{t('adminEvents.reg.december', 'December')}</AdminStatusPill>
          </div>
        )}
        {onsite && ticketCount > 1 && (
          <p className="text-[13px] leading-[18px] text-meta">{t('adminEvents.reg.ticketLimits', 'Limits per participation type: in the Participation types tab.')}</p>
        )}
      </Block>

      <Block
        title={t('adminEvents.reg.datesTitle', 'Dates')}
        description={t('adminEvents.reg.datesBody', 'All optional. Times are in the event\'s time zone.')}
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            label={t('adminEvents.reg.opensAt', 'Registration opens')}
            htmlFor="reg-opens"
            error={err('opensAt')}
            hint={zoneNote(v.opensAt) || t('adminEvents.reg.opensHint', 'Empty: open as soon as the event is published.')}
          >
            <Input id="reg-opens" type="datetime-local" value={v.opensAt} onChange={(e) => set('opensAt', e.target.value)} className={INPUT} />
          </Field>
          <Field
            label={t('adminEvents.reg.closesAt', 'Registration closes')}
            htmlFor="reg-closes"
            error={err('closesAt')}
            hint={zoneNote(v.closesAt) || (eventStart
              ? t('adminEvents.reg.closesHint', 'Empty: closes when the event ends.')
              : t('adminEvents.reg.closesHintNoDate', 'Empty: closes when the event ends (set the event date in Basics).'))}
          >
            <Input id="reg-closes" type="datetime-local" value={v.closesAt} onChange={(e) => set('closesAt', e.target.value)} className={INPUT} />
          </Field>
          <Field
            label={t('adminEvents.reg.editLocks', 'Answers can be changed until')}
            htmlFor="reg-locks"
            error={err('editLocksAt')}
            hint={zoneNote(v.editLocksAt) || t('adminEvents.reg.editLocksHint', 'Empty: until the event starts.')}
          >
            <Input id="reg-locks" type="datetime-local" value={v.editLocksAt} onChange={(e) => set('editLocksAt', e.target.value)} className={INPUT} />
          </Field>
        </div>
      </Block>

      <Block
        title={t('adminEvents.reg.formTitle', 'The registration form')}
        description={t('adminEvents.reg.formBody', 'First name, last name and e-mail are always asked. Members signed in never type what their profile already says.')}
      >
        <ul className="divide-y divide-rule rounded-card border border-rule">
          {STANDARD_FIELDS.map((f) => (
            <li key={f} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <span className="text-[15px] font-semibold text-navy">{fieldWords[f]}</span>
              <PillChoice
                label={fieldWords[f]}
                value={v.fields[f]}
                onChange={(rule) => set('fields', { ...v.fields, [f]: rule })}
                options={ruleOptions}
              />
            </li>
          ))}
        </ul>
        <p className="text-[13px] leading-[18px] text-meta">
          {t('adminEvents.reg.moreQuestions', 'Need more? Add your own questions in the Questions tab.')}
        </p>
      </Block>

      {onsite && (
        <Block
          title={t('adminEvents.reg.accountTitle', 'Their Smart Marina Connect account')}
          description={t('adminEvents.reg.accountBody', 'Everyone M3 confirms gets an account (or the event is added to the account they already have). A second e-mail, after the confirmation with the QR code, lets them choose their password.')}
        >
          <ChoiceCards
            label={t('adminEvents.reg.accountWhen', 'When the "choose your password" e-mail goes')}
            columns={2}
            value={v.accountEmailTiming}
            onChange={(timing) => set('accountEmailTiming', timing)}
            options={[
              { value: 'with_confirmation', title: t('adminEvents.reg.accountWith', 'With the confirmation'), body: t('adminEvents.reg.accountWithBody', 'A few minutes after the e-mail with their QR code.') },
              { value: 'after_event', title: t('adminEvents.reg.accountAfter', 'After the event'), body: t('adminEvents.reg.accountAfterBody', 'One e-mail to everyone confirmed, on the date you choose, so nothing distracts from the event itself.') },
            ]}
          />
          {v.accountEmailTiming === 'after_event' && (
            <Field
              label={t('adminEvents.reg.accountDate', 'Send it on')}
              htmlFor="reg-account-at"
              error={err('accountEmailSendAt')}
              hint={zoneNote(v.accountEmailSendAt) || t('adminEvents.reg.accountDateHint', 'Empty: the day after the event ends.')}
            >
              <Input
                id="reg-account-at"
                type="datetime-local"
                value={v.accountEmailSendAt}
                onChange={(e) => set('accountEmailSendAt', e.target.value)}
                className={`${INPUT} max-w-xs`}
              />
            </Field>
          )}
          <p className="text-[13px] leading-[18px] text-meta">
            {t('adminEvents.reg.accountLater', 'A change applies to people confirmed from now on. You can always send waiting account e-mails at once from People registered.')}
          </p>
        </Block>
      )}

      {onsite && (
        <Block title={t('adminEvents.reg.doorTitle', 'Entry pass')}>
          <div className="flex items-start gap-3">
            <QrCode className="mt-0.5 h-5 w-5 shrink-0 text-navy" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-[15px] font-semibold leading-5 text-navy">{t('adminEvents.reg.doorSeparate', 'Each person gets their own QR code')}</p>
              <p className="mt-1 text-[13px] leading-[18px] text-meta">
                {t('adminEvents.reg.doorBody', 'Made when M3 confirms them, separate from their personal link: forwarding the link never hands over the pass. Scanned at the door with the check-in page (People registered > Door check-in).')}
              </p>
            </div>
          </div>
        </Block>
      )}
    </div>
  );
}
