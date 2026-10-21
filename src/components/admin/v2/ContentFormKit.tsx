import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ActionCue } from '@/components/home/dashboard/DashboardKit';
import { cn } from '@/lib/utils';

/**
 * Form pieces of the admin screens moved to the refonte style in wave 2 (Site content and
 * Sponsors: articles, banners, sponsorship and exhibition requests). Presentation only: they take
 * values and callbacks, they never read or write data. Same register as the wave-1 screens
 * (CompanyAdminPage): a 14 px navy label over a 44 px white field, a quiet hint under it.
 */

/** Text inputs, selects and date fields of these screens: 44 px, white. */
export const ADMIN_INPUT = 'h-11 bg-white';

/** A label over its field, with an optional hint under it ("Comma-separated…"). */
export function FormField({
  label,
  htmlFor,
  hint,
  required,
  optional,
  className,
  children,
}: {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  /** Shows a star: the screen refuses to save without it. */
  required?: boolean;
  /** Shows "(optional)" after the label. */
  optional?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <label htmlFor={htmlFor} className="block text-[14px] font-semibold leading-5 text-navy">
        {label}
        {required && <span aria-hidden="true" className="text-red-700"> *</span>}
        {optional && <span className="font-normal text-meta"> (optional)</span>}
      </label>
      <div className="mt-1.5">{children}</div>
      {hint && <p className="mt-1.5 text-[13px] leading-[18px] text-meta">{hint}</p>}
    </div>
  );
}

/**
 * One choice of a set of check boxes, as a card that is pressed as a whole (44 px or more):
 * navy edge while ticked.
 */
export function CheckCard({
  checked,
  onToggle,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onToggle: () => void;
  label: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label
      className={cn(
        'flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border bg-white px-3.5 py-2.5 transition-colors',
        checked ? 'border-navy ring-1 ring-navy/15' : 'border-rule hover:border-navy/40',
        disabled && 'cursor-not-allowed opacity-60',
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        disabled={disabled}
        className="mt-0.5 h-[18px] w-[18px] shrink-0 accent-navy"
      />
      <span className="min-w-0">
        <span className="block text-[15px] font-semibold leading-5 text-navy">{label}</span>
        {hint && <span className="mt-0.5 block text-[13px] leading-[18px] text-meta">{hint}</span>}
      </span>
    </label>
  );
}

/**
 * The same card around a control that brings its own handler (the shadcn Checkbox of a form):
 * the control on the left, its label filling the rest of the card, so the whole card can be
 * pressed.
 */
export function CheckField({
  id,
  control,
  checked,
  label,
  hint,
  className,
}: {
  id: string;
  control: ReactNode;
  checked: boolean;
  label: ReactNode;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex min-h-11 items-start gap-3 rounded-xl border bg-white px-3.5 transition-colors',
        checked ? 'border-navy ring-1 ring-navy/15' : 'border-rule hover:border-navy/40',
        className,
      )}
    >
      <div className="shrink-0 pt-3">{control}</div>
      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer py-2.5">
        <span className="block text-[15px] font-semibold leading-5 text-navy">{label}</span>
        {hint && <span className="mt-0.5 block text-[13px] leading-[18px] text-meta">{hint}</span>}
      </label>
    </div>
  );
}

/** A read-only block of label / value pairs (Field from MembersKit inside). */
export function DetailList({ children, className }: { children: ReactNode; className?: string }) {
  return <dl className={cn('grid gap-x-6 gap-y-4 sm:grid-cols-2', className)}>{children}</dl>;
}

/**
 * A list row on a phone, or a card in a grid: the whole card is the link, the pill at its
 * bottom says where it leads ("Open the request").
 */
export function LinkCard({
  to,
  cue,
  className,
  children,
}: {
  to: string;
  cue: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link
      to={to}
      className={cn(
        'group flex h-full flex-col rounded-card border border-rule bg-white p-4 transition-[box-shadow,border-color] duration-200 hover:border-navy/30 hover:shadow-hover focus:outline-none focus-visible:shadow-focus motion-reduce:transition-none',
        className,
      )}
    >
      <div className="min-w-0 flex-1">{children}</div>
      <div className="mt-3 flex justify-end">
        <ActionCue size="sm">{cue}</ActionCue>
      </div>
    </Link>
  );
}
