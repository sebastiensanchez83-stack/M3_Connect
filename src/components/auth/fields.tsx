import * as React from 'react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle2, Eye, EyeOff, Info, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input, type InputProps } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea, type TextareaProps } from '@/components/ui/textarea';
import { SelectTrigger } from '@/components/ui/select';
import { SectionNo } from '@/components/brand/Eyebrow';
import { registerAuthRefonteStrings } from '@/i18n/refonte-auth';

registerAuthRefonteStrings();

/**
 * The field kit of the sign-in, sign-up, invitation, password and onboarding
 * screens, the same grammar as the contact form: 48 px high, 12 px radius, a
 * #6b7588 edge (3:1 on white), 16 px text (no zoom on iOS), the navy double ring
 * on keyboard focus (from the shadcn ring utilities), semibold navy labels.
 *
 * The components wrap the shadcn ones and pass every prop through, so a screen
 * adopts the look by changing one import:
 *   import { AuthInput as Input, AuthLabel as Label } from '@/components/auth/fields';
 * Presentation only: ids, names, handlers and validation stay on the screen.
 */
export const AUTH_FIELD = 'h-12 md:h-12 rounded-field border-checkbox bg-white px-4 text-base';
/**
 * For a rolling CTA whose label can be long (an organization's name, a whole
 * sentence): the label wraps and the button grows instead of cutting it off.
 * Use with roll={false}: a label that wraps cannot roll.
 */
export const CTA_WRAP = 'h-auto md:h-auto min-h-[52px] py-2.5 [&_.cta-l]:h-auto [&_.cta-t]:whitespace-normal [&_.cta-t]:text-left';
/** The same edge on a field in error. */
export const AUTH_FIELD_ERROR = 'border-red-700';

export const AuthInput = React.forwardRef<HTMLInputElement, InputProps>(function AuthInput({ className, ...props }, ref) {
  return <Input ref={ref} className={cn(AUTH_FIELD, className)} {...props} />;
});

export const AuthTextarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function AuthTextarea({ className, ...props }, ref) {
  return <Textarea ref={ref} className={cn('min-h-[96px] rounded-field border-checkbox bg-white px-4 py-3 text-base', className)} {...props} />;
});

export const AuthLabel = React.forwardRef<React.ElementRef<typeof Label>, React.ComponentPropsWithoutRef<typeof Label>>(function AuthLabel(
  { className, ...props },
  ref,
) {
  return <Label ref={ref} className={cn('text-sm font-semibold leading-5 text-navy', className)} {...props} />;
});

/** A select's button, in the same box as the inputs. */
export const AuthSelectTrigger = React.forwardRef<React.ElementRef<typeof SelectTrigger>, React.ComponentPropsWithoutRef<typeof SelectTrigger>>(
  function AuthSelectTrigger({ className, ...props }, ref) {
    return <SelectTrigger ref={ref} className={cn('h-12 rounded-field border-checkbox bg-white px-4 text-base', className)} {...props} />;
  },
);

/**
 * A password field with its show / hide button. Which state it is in is the
 * field's own business (a view toggle); the value, name, id and handlers come
 * from the screen.
 */
export const PasswordInput = React.forwardRef<HTMLInputElement, Omit<InputProps, 'type'>>(function PasswordInput({ className, ...props }, ref) {
  const { t } = useTranslation();
  const [shown, setShown] = useState(false);
  const label = shown
    ? t('authRefonte.field.hidePassword', 'Hide password')
    : t('authRefonte.field.showPassword', 'Show password');
  return (
    <div className="relative">
      <AuthInput ref={ref} {...props} type={shown ? 'text' : 'password'} className={cn('pr-12', className)} />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-label={label}
        aria-pressed={shown}
        className="absolute right-1.5 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full text-meta transition-colors hover:text-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {shown ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
      </button>
    </div>
  );
});

/** The line under a field that failed: red, read out with the field. */
export function FieldError({ children, id, className }: { children: ReactNode; id?: string; className?: string }) {
  return (
    <p id={id} role="alert" className={cn('text-sm leading-5 text-red-700', className)}>
      {children}
    </p>
  );
}

/** The quiet line under a field: what it expects. */
export function FieldHint({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('text-[13px] leading-5 text-meta', className)}>{children}</p>;
}

type NoticeTone = 'success' | 'warning' | 'error' | 'info';

const NOTICE_TONE: Record<NoticeTone, { box: string; icon: string; Icon: typeof Info }> = {
  success: { box: 'border-teal/30 bg-foam', icon: 'text-teal-text', Icon: CheckCircle2 },
  warning: { box: 'border-amber-300 bg-amber-50', icon: 'text-amber-700', Icon: AlertTriangle },
  error: { box: 'border-red-300 bg-red-50', icon: 'text-red-700', Icon: XCircle },
  info: { box: 'border-rule bg-page', icon: 'text-meta', Icon: Info },
};

/**
 * A message block inside a form or a card: 12 px radius, a tinted background, an
 * icon, an optional bold title. `role="alert"` (warnings and errors) is read out
 * when it appears; success and info stay silent unless the screen sets a role.
 */
export function AuthNotice({
  tone = 'info',
  title,
  icon,
  role,
  className,
  children,
}: {
  tone?: NoticeTone;
  title?: ReactNode;
  /** Replaces the tone's icon. */
  icon?: ReactNode;
  role?: 'alert' | 'status';
  className?: string;
  children?: ReactNode;
}) {
  const { box, icon: iconCls, Icon } = NOTICE_TONE[tone];
  return (
    <div role={role} className={cn('flex items-start gap-3 rounded-field border p-3.5 text-sm leading-5 text-ink', box, className)}>
      <span className={cn('mt-0.5 shrink-0', iconCls)} aria-hidden="true">
        {icon ?? <Icon className="h-4 w-4" />}
      </span>
      <div className="min-w-0 flex-1 space-y-1.5">
        {title && <p className="font-semibold text-navy">{title}</p>}
        {children}
      </div>
    </div>
  );
}

/** "or" between two ways of doing the same thing: a hairline with the word on it. */
export function OrDivider({ children }: { children: ReactNode }) {
  return (
    <div className="relative py-1 text-center" aria-hidden="true">
      <span className="absolute inset-x-0 top-1/2 border-t border-rule" />
      <span className="relative bg-white px-3 text-[12px] font-semibold uppercase tracking-[0.08em] text-meta">{children}</span>
    </div>
  );
}

/**
 * One block of a long form (the organization profile): a white card, 16 px
 * radius, a hairline border, a gold section number ("01"), the title and a
 * line of help, a rule, then the fields (the children).
 */
export function AuthSection({
  number,
  title,
  description,
  contentClassName,
  className,
  children,
}: {
  number?: string;
  title: ReactNode;
  description?: ReactNode;
  contentClassName?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn('rounded-card border border-rule bg-white p-6 sm:p-8', className)}>
      <header className="mb-6 border-b border-rule pb-5">
        {number && <SectionNo number={number} className="mb-2 text-[13px]" />}
        <h2 className="text-h3 text-navy">{title}</h2>
        {description && <p className="mt-1.5 text-sm leading-6 text-meta">{description}</p>}
      </header>
      <div className={contentClassName}>{children}</div>
    </section>
  );
}
