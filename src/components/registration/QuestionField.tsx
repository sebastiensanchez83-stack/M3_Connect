import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Checkbox } from '@/components/ui/checkbox';
import { AuthInput, AuthLabel, AuthTextarea, FieldError, FieldHint, AUTH_FIELD } from '@/components/auth/fields';
import { COUNTRIES } from '@/lib/countries';
import { supabase } from '@/lib/supabase';
import { questionOptions, type QuestionOption, type RegQuestion } from '@/lib/registration';
import { cn } from '@/lib/utils';

/**
 * One of the event's own questions (gl_question), drawn for its kind. Answers
 * keep the shapes the database checks: checkbox and consent are booleans;
 * multiselect, sectors and parts are lists of strings; everything else is a
 * string, cut to the question's maximum length.
 *
 * Choices are big tiles (a whole row to tap), never tiny boxes: a list of up
 * to six options shows as tiles, a longer one as the phone's own picker.
 */

export type AnswerValue = string | string[] | boolean;

const tile = (on: boolean, invalid?: boolean) =>
  cn(
    'flex min-h-12 cursor-pointer items-center gap-3 rounded-field border px-4 py-2.5 text-[15px] font-medium leading-5 text-navy transition-colors focus-within:shadow-focus',
    on ? 'border-navy bg-foam' : invalid ? 'border-red-700 bg-white' : 'border-checkbox bg-white hover:border-navy',
  );

/** Whether a value counts as an answer (the server's rule: empty strings, empty lists and false do not). */
export function isAnswered(v: AnswerValue | undefined): boolean {
  if (v === undefined || v === false) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'string') return v.trim().length > 0;
  return true;
}

/** The answer's own checks (the server checks again). */
export function answerError(q: RegQuestion, v: AnswerValue | undefined, t: TFunction): string | null {
  if (!isAnswered(v)) {
    if (!q.required) return null;
    return q.kind === 'consent' || q.kind === 'checkbox'
      ? t('reg.q.tick', 'Please tick this box to continue.')
      : q.kind === 'multiselect' || q.kind === 'parts' || q.kind === 'sectors'
        ? t('reg.q.pickOne', 'Please choose at least one.')
        : t('reg.field.required', 'Please fill this in.');
  }
  if (q.kind === 'url' && typeof v === 'string' && !/^(https?:\/\/)?[^\s.]+\.[^\s]{2,}$/i.test(v.trim())) {
    return t('reg.q.url', 'Please enter a web address, like www.example.com.');
  }
  return null;
}

/** Sector options for a "sectors" question without options of its own: the platform's sector list. */
function useSectorOptions(enabled: boolean): QuestionOption[] {
  const [opts, setOpts] = useState<QuestionOption[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    supabase.from('sectors').select('id, label').eq('is_active', true).order('label').then(({ data }) => {
      if (alive && data) setOpts((data as { id: string; label: string }[]).map((s) => ({ value: s.id, label: s.label })));
    });
    return () => { alive = false; };
  }, [enabled]);
  return opts;
}

export function QuestionField({
  question: q,
  value,
  onChange,
  error,
  idPrefix = 'q',
}: {
  question: RegQuestion;
  value: AnswerValue | undefined;
  onChange: (value: AnswerValue) => void;
  error?: string | null;
  idPrefix?: string;
}) {
  const { t } = useTranslation();
  const id = `${idPrefix}-${q.key}`;
  const errId = error ? `${id}-err` : undefined;
  const helpId = q.help ? `${id}-help` : undefined;
  const describedBy = [helpId, errId].filter(Boolean).join(' ') || undefined;
  const own = questionOptions(q);
  const sectorOpts = useSectorOptions(q.kind === 'sectors' && own.length === 0);
  const options = q.kind === 'sectors' && own.length === 0 ? sectorOpts : own;
  const max = q.max_length ?? (q.kind === 'textarea' ? 4000 : 500);
  const star = q.required ? <span aria-hidden="true" className="text-red-700"> *</span> : null;
  const optional = !q.required && q.kind !== 'checkbox' && q.kind !== 'consent'
    ? <span className="font-normal text-meta"> {t('reg.field.optional', '(optional)')}</span>
    : null;

  // A single box to tick: the label is the sentence next to it.
  if (q.kind === 'checkbox' || q.kind === 'consent') {
    const on = value === true;
    return (
      <div className="space-y-2">
        <label htmlFor={id} className={tile(on, !!error)}>
          <Checkbox
            id={id}
            checked={on}
            onCheckedChange={(c) => onChange(c === true)}
            aria-invalid={!!error}
            aria-describedby={describedBy}
            className="h-5 w-5 border-checkbox"
          />
          <span className="min-w-0">{q.label}{star}</span>
        </label>
        {q.help && <FieldHint className="pl-1"><span id={helpId}>{q.help}</span></FieldHint>}
        {error && <FieldError id={errId}>{error}</FieldError>}
      </div>
    );
  }

  // Several choices (multiselect, sectors, parts): tiles to tick.
  if (q.kind === 'multiselect' || q.kind === 'sectors' || q.kind === 'parts') {
    const picked = Array.isArray(value) ? value : [];
    const toggle = (v: string) => onChange(picked.includes(v) ? picked.filter((x) => x !== v) : [...picked, v]);
    return (
      <fieldset className="space-y-2" aria-describedby={describedBy}>
        <legend className="mb-2 text-sm font-semibold leading-5 text-navy">{q.label}{star}{optional}</legend>
        {q.help && <FieldHint><span id={helpId}>{q.help}</span></FieldHint>}
        <div className="grid gap-2 sm:grid-cols-2">
          {options.map((o) => {
            const on = picked.includes(o.value);
            return (
              <label key={o.value} className={tile(on, !!error)}>
                <Checkbox checked={on} onCheckedChange={() => toggle(o.value)} className="h-5 w-5 border-checkbox" />
                <span className="min-w-0 [overflow-wrap:anywhere]">{o.label}</span>
              </label>
            );
          })}
        </div>
        {error && <FieldError id={errId}>{error}</FieldError>}
      </fieldset>
    );
  }

  // One choice: tiles up to six options, the native picker beyond.
  if (q.kind === 'select') {
    const current = typeof value === 'string' ? value : '';
    if (options.length <= 6) {
      return (
        <fieldset className="space-y-2" aria-describedby={describedBy}>
          <legend className="mb-2 text-sm font-semibold leading-5 text-navy">{q.label}{star}{optional}</legend>
          {q.help && <FieldHint><span id={helpId}>{q.help}</span></FieldHint>}
          <div role="radiogroup" className="grid gap-2 sm:grid-cols-2">
            {options.map((o) => {
              const on = current === o.value;
              return (
                <label key={o.value} className={tile(on, !!error)}>
                  <input
                    type="radio"
                    name={id}
                    value={o.value}
                    checked={on}
                    onChange={() => onChange(o.value)}
                    className="h-5 w-5 shrink-0 accent-navy"
                  />
                  <span className="min-w-0 [overflow-wrap:anywhere]">{o.label}</span>
                </label>
              );
            })}
          </div>
          {error && <FieldError id={errId}>{error}</FieldError>}
        </fieldset>
      );
    }
    return (
      <div className="space-y-2">
        <AuthLabel htmlFor={id}>{q.label}{star}{optional}</AuthLabel>
        {q.help && <FieldHint><span id={helpId}>{q.help}</span></FieldHint>}
        <select
          id={id}
          value={current}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={!!error}
          aria-describedby={describedBy}
          className={cn(AUTH_FIELD, 'w-full appearance-auto border text-navy', error && 'border-red-700')}
        >
          <option value="">{t('reg.q.choose', 'Choose…')}</option>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {error && <FieldError id={errId}>{error}</FieldError>}
      </div>
    );
  }

  // Free text, in the right keyboard.
  const str = typeof value === 'string' ? value : '';
  const common = {
    id,
    value: str,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(e.target.value.slice(0, max)),
    'aria-invalid': !!error,
    'aria-describedby': describedBy,
    maxLength: max,
  };
  return (
    <div className="space-y-2">
      <AuthLabel htmlFor={id}>{q.label}{star}{optional}</AuthLabel>
      {q.help && <FieldHint><span id={helpId}>{q.help}</span></FieldHint>}
      {q.kind === 'textarea' ? (
        <AuthTextarea {...common} rows={4} className={cn(error && 'border-red-700')} />
      ) : (
        <AuthInput
          {...common}
          className={cn(error && 'border-red-700')}
          type={q.kind === 'url' ? 'url' : q.kind === 'phone' ? 'tel' : 'text'}
          inputMode={q.kind === 'url' ? 'url' : q.kind === 'phone' ? 'tel' : undefined}
          autoComplete={q.kind === 'phone' || q.profile_field === 'phone' ? 'tel'
            : q.kind === 'country' || q.profile_field === 'country' ? 'country-name'
              : q.profile_field === 'job_title' ? 'organization-title'
                : q.kind === 'url' ? 'url' : 'off'}
          placeholder={q.kind === 'url' ? 'https://' : undefined}
          list={q.kind === 'country' ? `${id}-countries` : undefined}
        />
      )}
      {q.kind === 'country' && (
        <datalist id={`${id}-countries`}>
          {COUNTRIES.filter((c) => c !== 'Other').map((c) => <option key={c} value={c} />)}
        </datalist>
      )}
      {error && <FieldError id={errId}>{error}</FieldError>}
    </div>
  );
}
