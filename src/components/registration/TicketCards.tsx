import { useTranslation } from 'react-i18next';
import { CheckCircle2, Lock } from 'lucide-react';
import { FieldError } from '@/components/auth/fields';
import type { RegTicket } from '@/lib/registration';
import { cn } from '@/lib/utils';
import { companyTypeLabel } from './RegistrationUI';

/**
 * "How will you take part?": one big card per participation type (gl_ticket),
 * with its description and its price or note (display only: nothing is paid on
 * the platform yet). A type given by invitation, or one that is full, is shown
 * but cannot be chosen, with the reason in words.
 */

export function ticketPrice(tk: RegTicket, locale: string, freeLabel: string): string | null {
  if (tk.price_note) return tk.price_note;
  if (tk.price_cents === null || tk.price_cents === undefined) return null;
  if (tk.price_cents === 0) return freeLabel;
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: tk.currency || 'EUR', maximumFractionDigits: tk.price_cents % 100 ? 2 : 0 }).format(tk.price_cents / 100);
  } catch {
    return `${(tk.price_cents / 100).toFixed(2)} ${tk.currency || 'EUR'}`;
  }
}

export function TicketCards({
  tickets,
  value,
  onChange,
  error,
  locale,
  name = 'ticket',
}: {
  tickets: RegTicket[];
  value: string | null;
  onChange: (key: string) => void;
  error?: string | null;
  locale: string;
  name?: string;
}) {
  const { t } = useTranslation();
  const errId = error ? `${name}-err` : undefined;
  return (
    <fieldset aria-describedby={errId}>
      <legend className="mb-3 text-sm font-semibold leading-5 text-navy">
        {t('reg.ticket.legend', 'How will you take part?')}<span aria-hidden="true" className="text-red-700"> *</span>
      </legend>
      <div className="grid gap-3 sm:grid-cols-2">
        {tickets.map((tk) => {
          const on = value === tk.key;
          const blocked = !!tk.invite_only || !!tk.full;
          const price = ticketPrice(tk, locale, t('reg.ticket.free', 'Free'));
          const types = (tk.allowed_company_types ?? []).map((ty) => companyTypeLabel(t, ty));
          return (
            <label
              key={tk.key}
              className={cn(
                'relative flex min-h-[88px] flex-col rounded-card border-2 p-4 transition-colors focus-within:shadow-focus',
                blocked ? 'cursor-not-allowed border-rule bg-page text-meta'
                  : on ? 'cursor-pointer border-navy bg-foam' : error ? 'cursor-pointer border-red-700 bg-white' : 'cursor-pointer border-rule bg-white hover:border-navy',
              )}
            >
              <input
                type="radio"
                name={name}
                value={tk.key}
                checked={on}
                disabled={blocked}
                onChange={() => onChange(tk.key)}
                className="sr-only"
              />
              <span className="flex items-start justify-between gap-3">
                <span className={cn('text-[16px] font-semibold leading-6', blocked ? 'text-meta' : 'text-navy')}>{tk.label}</span>
                {on && !blocked && <CheckCircle2 className="h-5 w-5 shrink-0 text-teal" aria-hidden="true" />}
                {blocked && <Lock className="h-4 w-4 shrink-0" aria-hidden="true" />}
              </span>
              {tk.description && <span className="mt-1 text-sm leading-5 text-meta">{tk.description}</span>}
              <span className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-2 text-sm">
                {price && <span className={cn('font-semibold tabular-nums', blocked ? 'text-meta' : 'text-navy')}>{price}</span>}
                {tk.invite_only && <span>{t('reg.ticket.inviteOnly', 'By invitation only')}</span>}
                {!tk.invite_only && tk.full && <span>{t('reg.ticket.full', 'Full')}</span>}
                {!blocked && types.length > 0 && (
                  <span className="text-meta">{t('reg.ticket.forTypes', { types: types.join(', '), defaultValue: 'For validated companies: {{types}}' })}</span>
                )}
              </span>
            </label>
          );
        })}
      </div>
      {error && <FieldError id={errId} className="mt-2">{error}</FieldError>}
    </fieldset>
  );
}
