import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { ADMIN_BTN, ADMIN_BTN_PRIMARY } from '../AdminUI';

/**
 * Small building blocks of the event editor, in the admin kit's register (AdminUI):
 * white cards with a hairline, navy labels, meta hints, one error line under the field.
 * No overflow-hidden here: the editor's header is sticky (sticky-header trap).
 */

export const INPUT = 'h-11 rounded-field border-rule bg-white text-[15px] md:h-11 md:text-[15px]';
export const TEXTAREA = 'rounded-field border-rule bg-white text-[15px] leading-6 md:text-[15px]';

/** The admin kit's buttons, 44 px tall on phones (touch), 40 px from sm up. */
export const EDITOR_BTN = cn(ADMIN_BTN, 'h-11 sm:h-10');
export const EDITOR_BTN_PRIMARY = cn(ADMIN_BTN_PRIMARY, 'h-11 sm:h-10');

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
  optional,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
  htmlFor?: string;
  optional?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={htmlFor} className="block text-[14px] font-semibold leading-5 text-navy">
        {label}
        {optional && <span className="ml-1.5 font-normal text-meta">{t('adminEvents.optional', '(optional)')}</span>}
      </label>
      {children}
      {hint && !error && <p className="text-[13px] leading-[18px] text-meta">{hint}</p>}
      {error && <p role="alert" className="text-[13px] font-medium leading-[18px] text-red-700">{error}</p>}
    </div>
  );
}

/** A titled block inside a tab (no card frame: the tab already sits in one). */
export function Block({ title, description, children, className }: { title: ReactNode; description?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-card border border-rule bg-white p-5 sm:p-6', className)}>
      <h2 className="text-[17px] font-semibold leading-6 text-navy">{title}</h2>
      {description && <p className="mt-1 max-w-2xl text-[14px] leading-5 text-meta">{description}</p>}
      <div className="mt-5 space-y-5">{children}</div>
    </section>
  );
}

/** Big radio cards: one choice, said in plain words. */
export function ChoiceCards<T extends string>({
  value,
  onChange,
  options,
  label,
  columns = 3,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; title: string; body?: ReactNode; disabled?: boolean }[];
  label: string;
  columns?: 2 | 3;
}) {
  const name = useId();
  return (
    <div role="radiogroup" aria-label={label} className={cn('grid gap-3', columns === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <label
            key={o.value}
            className={cn(
              'relative flex cursor-pointer flex-col rounded-card border bg-white p-4 transition-colors focus-within:shadow-focus',
              active ? 'border-navy ring-1 ring-navy/20' : 'border-rule hover:border-navy/30',
              o.disabled && 'cursor-not-allowed opacity-50',
            )}
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={active}
              disabled={o.disabled}
              onChange={() => onChange(o.value)}
              className="sr-only"
            />
            <span className="flex items-start justify-between gap-3">
              <span className="text-[15px] font-semibold leading-5 text-navy">{o.title}</span>
              <span
                aria-hidden="true"
                className={cn(
                  'grid h-5 w-5 shrink-0 place-items-center rounded-full border',
                  active ? 'border-navy bg-navy text-white' : 'border-rule bg-white',
                )}
              >
                {active && <Check className="h-3 w-3" strokeWidth={3} />}
              </span>
            </span>
            {o.body && <span className="mt-1.5 text-[13px] leading-[18px] text-meta">{o.body}</span>}
          </label>
        );
      })}
    </div>
  );
}

/** A switch with its sentence. */
export function ToggleRow({
  checked,
  onChange,
  title,
  body,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  title: ReactNode;
  body?: ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4 rounded-card border border-rule bg-white p-4">
      <label htmlFor={id} className="min-w-0 cursor-pointer">
        <span className="block text-[15px] font-semibold leading-5 text-navy">{title}</span>
        {body && <span className="mt-1 block text-[13px] leading-[18px] text-meta">{body}</span>}
      </label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} className="mt-0.5 shrink-0" />
    </div>
  );
}

/** A quiet information box (what happens, why something is greyed out). */
export function Note({ children, tone = 'info', className }: { children: ReactNode; tone?: 'info' | 'warning' | 'danger'; className?: string }) {
  return (
    <div
      className={cn(
        'rounded-field border px-4 py-3 text-[14px] leading-5',
        tone === 'info' && 'border-teal/25 bg-foam text-navy',
        tone === 'warning' && 'border-amber-200 bg-amber-50 text-amber-900',
        tone === 'danger' && 'border-red-200 bg-red-50 text-red-900',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Three-way pill choice in a row (Required / Optional / Not asked). */
export function PillChoice<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap rounded-pill border border-rule bg-white p-1">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              'h-11 rounded-pill px-3 text-[13px] font-semibold transition-colors focus:outline-none focus-visible:shadow-focus sm:h-8',
              active ? 'bg-navy text-white' : 'text-meta hover:bg-chip hover:text-navy',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
