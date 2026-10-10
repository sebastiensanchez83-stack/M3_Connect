import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Lock } from 'lucide-react';
import { AuthInput, AuthLabel, FieldError, FieldHint } from '@/components/auth/fields';
import { COUNTRIES } from '@/lib/countries';
import type { FieldRule, StandardFieldKey, StandardFields } from '@/lib/registration';
import { cn } from '@/lib/utils';

/**
 * "You": first name, last name and e-mail (always asked), then the event's
 * standard fields (company, job title, phone, country), each required,
 * optional or hidden as the event says (gl_event.standard_fields; a missing
 * key is optional). Signed in, the e-mail is the account's and cannot be
 * changed here: the registration is always made with it.
 *
 * Every field has its autocomplete hint, so a phone fills the form in one tap.
 */

export interface IdentityValues {
  first_name: string;
  last_name: string;
  email: string;
  company: string;
  job_title: string;
  phone: string;
  country: string;
}

export type IdentityKey = keyof IdentityValues;

export const EMPTY_IDENTITY: IdentityValues = {
  first_name: '', last_name: '', email: '', company: '', job_title: '', phone: '', country: '',
};

export function ruleOf(fields: StandardFields | undefined, key: StandardFieldKey): FieldRule {
  const r = fields?.[key];
  return r === 'required' || r === 'hidden' ? r : 'optional';
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@.]{2,}$/;

/** The identity block's own checks, field by field (the server checks again). */
export function identityErrors(
  v: IdentityValues,
  fields: StandardFields | undefined,
  t: TFunction,
): Partial<Record<IdentityKey, string>> {
  const errors: Partial<Record<IdentityKey, string>> = {};
  const need = t('reg.field.required', 'Please fill this in.');
  if (!v.first_name.trim()) errors.first_name = need;
  if (!v.last_name.trim()) errors.last_name = need;
  if (!EMAIL_RE.test(v.email.trim())) errors.email = t('reg.field.emailInvalid', 'Please enter a valid e-mail address, like name@company.com.');
  for (const key of ['company', 'job_title', 'phone', 'country'] as const) {
    if (ruleOf(fields, key) === 'required' && !v[key].trim()) errors[key] = need;
  }
  return errors;
}

const STAR = <span aria-hidden="true" className="text-red-700"> *</span>;

export function IdentityBlock({
  values,
  onChange,
  errors,
  standardFields,
  emailLocked,
  standardOnly = false,
  idPrefix = 'reg',
}: {
  values: IdentityValues;
  onChange: (key: IdentityKey, value: string) => void;
  errors: Partial<Record<IdentityKey, string>>;
  standardFields: StandardFields | undefined;
  /** Signed in: the account's address, shown but not editable. */
  emailLocked: boolean;
  /** Only the event's fields (company, job title, phone, country): names and e-mail are not shown. */
  standardOnly?: boolean;
  idPrefix?: string;
}) {
  const { t } = useTranslation();
  const id = (k: string) => `${idPrefix}-${k}`;
  const err = (k: IdentityKey) => (errors[k] ? `${id(k)}-err` : undefined);

  const text = (
    key: IdentityKey,
    label: string,
    required: boolean,
    props: { type?: string; autoComplete: string; inputMode?: 'email' | 'tel' | 'text'; list?: string; maxLength?: number },
  ) => (
    <div className="space-y-2">
      <AuthLabel htmlFor={id(key)}>
        {label}
        {required ? STAR : <span className="font-normal text-meta"> {t('reg.field.optional', '(optional)')}</span>}
      </AuthLabel>
      <AuthInput
        id={id(key)}
        name={key}
        value={values[key]}
        onChange={(e) => onChange(key, e.target.value)}
        required={required}
        aria-invalid={!!errors[key]}
        aria-describedby={err(key)}
        className={cn(errors[key] && 'border-red-700')}
        type={props.type ?? 'text'}
        autoComplete={props.autoComplete}
        inputMode={props.inputMode}
        list={props.list}
        maxLength={props.maxLength ?? 160}
      />
      {errors[key] && <FieldError id={err(key)}>{errors[key]}</FieldError>}
    </div>
  );

  const shown = (key: StandardFieldKey) => ruleOf(standardFields, key) !== 'hidden';
  const req = (key: StandardFieldKey) => ruleOf(standardFields, key) === 'required';

  return (
    <div className="space-y-5">
      {!standardOnly && (
        <>
          <div className="grid gap-5 sm:grid-cols-2">
            {text('first_name', t('reg.field.firstName', 'First name'), true, { autoComplete: 'given-name', maxLength: 80 })}
            {text('last_name', t('reg.field.lastName', 'Last name'), true, { autoComplete: 'family-name', maxLength: 80 })}
          </div>

          {emailLocked ? (
            <div className="space-y-2">
              <AuthLabel htmlFor={id('email')}>{t('reg.field.email', 'E-mail')}</AuthLabel>
              <div className="relative">
                <AuthInput id={id('email')} value={values.email} readOnly aria-readonly="true" className="bg-page pr-11 text-ink" autoComplete="email" />
                <Lock className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-meta" aria-hidden="true" />
              </div>
              <FieldHint>{t('reg.field.emailLocked', 'You are signed in: we register you with your account e-mail.')}</FieldHint>
            </div>
          ) : (
            text('email', t('reg.field.email', 'E-mail'), true, { type: 'email', autoComplete: 'email', inputMode: 'email', maxLength: 200 })
          )}
        </>
      )}

      {(shown('company') || shown('job_title')) && (
        <div className="grid gap-5 sm:grid-cols-2">
          {shown('company') && text('company', t('reg.field.company', 'Company'), req('company'), { autoComplete: 'organization' })}
          {shown('job_title') && text('job_title', t('reg.field.jobTitle', 'Job title'), req('job_title'), { autoComplete: 'organization-title' })}
        </div>
      )}

      {(shown('phone') || shown('country')) && (
        <div className="grid gap-5 sm:grid-cols-2">
          {shown('phone') && text('phone', t('reg.field.phone', 'Phone'), req('phone'), { type: 'tel', autoComplete: 'tel', inputMode: 'tel', maxLength: 40 })}
          {shown('country') && text('country', t('reg.field.country', 'Country'), req('country'), { autoComplete: 'country-name', list: `${idPrefix}-countries`, maxLength: 80 })}
        </div>
      )}
      {shown('country') && (
        <datalist id={`${idPrefix}-countries`}>
          {COUNTRIES.filter((c) => c !== 'Other').map((c) => <option key={c} value={c} />)}
        </datalist>
      )}
    </div>
  );
}
