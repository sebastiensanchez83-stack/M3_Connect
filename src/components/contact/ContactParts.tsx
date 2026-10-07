import { AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { M3_PUBLIC_EMAIL } from '@/components/brand/ContactCard';
import type { ContactResult } from '@/lib/contactSubmit';
import { registerFlowsStrings } from '@/i18n/refonte-flows';
import { cn } from '@/lib/utils';

registerFlowsStrings();

/**
 * What every form that writes to the M3 team (contact, claim, sponsorship deck)
 * shows when a message did not go: the reason, in words, and the public address
 * as a visible mailto link. Nothing opens by itself and nothing says "sent".
 */
export function ContactFailure({
  reason,
  id,
  className,
}: {
  reason: Exclude<ContactResult, { ok: true }>['reason'];
  id?: string;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <div
      id={id}
      role="alert"
      className={cn('flex items-start gap-3 rounded-field border border-red-700/40 bg-red-50 px-4 py-3 text-sm leading-6 text-ink', className)}
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-700" aria-hidden="true" />
      <p>
        {t(`flows.contact.failure.${reason}`)}{' '}
        {t('flows.contact.failure.mailLead')}{' '}
        <a
          href={`mailto:${M3_PUBLIC_EMAIL}`}
          className="font-semibold text-navy underline underline-offset-2 hover:text-navy-deep"
        >
          {M3_PUBLIC_EMAIL}
        </a>
        .
      </p>
    </div>
  );
}

/**
 * The anti-robot field of the contact function (`website`, which must stay
 * empty). Out of sight, out of the tab order and hidden from screen readers: a
 * person never meets it, a script that fills every input does.
 */
export function Honeypot({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { t } = useTranslation();
  return (
    <div aria-hidden="true" className="absolute left-[-10000px] top-auto h-px w-px overflow-hidden">
      <label>
        {t('flows.contact.honeypot')}
        <input
          type="text"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </label>
    </div>
  );
}
