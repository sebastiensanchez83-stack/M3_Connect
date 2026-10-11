import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Block, ChoiceCards, Field, INPUT, Note, PillChoice, ToggleRow } from './editorUi';
import { STANDARD_FIELDS, formatInZone, wallToIso, type FieldRule, type StandardField } from './eventAdmin';
import type { FormIssue, RegistrationForm } from './editorModel';

/**
 * Registration: how people sign up for a webinar, who may, how many, and what the form
 * asks besides name and e-mail (always asked). On-site events get this tab in Phase 3.
 */
export function RegistrationTab({
  value,
  onChange,
  issues,
  timezone,
  eventStart,
  invitationAllowed,
}: {
  value: RegistrationForm;
  onChange: (next: RegistrationForm) => void;
  issues: FormIssue[];
  timezone: string;
  /** The event's start (wall clock), to explain the default closing time. */
  eventStart: string;
  /** "By invitation" stays selectable only for an event already saved that way (sending invitations comes later). */
  invitationAllowed: boolean;
}) {
  const { t } = useTranslation();
  const v = value;
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

  return (
    <div className="space-y-6">
      <Block
        title={t('adminEvents.reg.modeTitle', 'How people register')}
        description={t('adminEvents.reg.modeBody', 'Signed-in members register in one click. Others fill in a short form, without creating an account.')}
      >
        <ChoiceCards
          label={t('adminEvents.reg.modeTitle', 'How people register')}
          value={v.mode}
          onChange={(mode) => set('mode', mode)}
          options={[
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
          ]}
        />
        {v.mode === 'invitation' && (
          <>
            <ToggleRow
              checked={v.publicRequests}
              onChange={(on) => set('publicRequests', on)}
              title={t('adminEvents.reg.publicRequests', 'People can ask for an invitation')}
              body={t('adminEvents.reg.publicRequestsBody', 'The event page shows "Request an invitation". You accept each request in People registered.')}
            />
            <Note tone="warning">
              {v.publicRequests
                ? t('adminEvents.reg.inviteLater', 'Sending invitations from this page comes in a later update. Until then, people ask for an invitation and you accept them.')
                : t('adminEvents.reg.inviteNobody', 'Sending invitations from this page comes in a later update. With requests off, nobody can register for now: turn requests on above.')}
            </Note>
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
          hint={t('adminEvents.reg.capacityHint', 'Leave empty for no limit.')}
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
          body={t('adminEvents.reg.waitlistBody2', 'Once all places are taken, new people join a waiting list. Nobody is moved up automatically: when a place frees up, press Confirm next to them in People registered.')}
        />
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
    </div>
  );
}
