import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { M3_PUBLIC_EMAIL } from './ContactCard';

/**
 * Newsletter sign-up, as in the footer: an e-mail pill (58 px) with a rolling
 * gold button at its right end (a round arrow on phones), and an UNTICKED
 * consent box (required) under it.
 *
 * Where the consent lives (Mailchimp double opt-in, or SMC read by the CRM) is
 * still to be decided with Sébastien, so there is no subscription backend yet.
 * Until `onSubscribe` is wired, submitting opens a prepared e-mail to the M3
 * team (events@m3monaco.com) with the address and the consent sentence: honest,
 * and nothing is stored by the site.
 */
export function NewsletterField({
  onSubscribe,
  tone = 'dark',
  hideLabel = false,
  className,
}: {
  /** The real subscription, once decided. Throw to show the error message. */
  onSubscribe?: (email: string) => Promise<void> | void;
  tone?: 'dark' | 'light';
  /** Keep the label for screen readers only (the page shows its own heading). */
  hideLabel?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [email, setEmail] = useState('');
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle');
  const dark = tone === 'dark';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setError(t('brand.newsletter.errorEmail', 'Enter a valid e-mail address.'));
      return;
    }
    if (!consent) {
      setError(t('brand.newsletter.errorConsent', 'Tick the box to agree to receive the newsletter.'));
      return;
    }
    setError(null);
    if (onSubscribe) {
      setState('sending');
      try {
        await onSubscribe(value);
        setState('done');
      } catch {
        setState('idle');
        setError(t('brand.newsletter.errorSend', 'That did not work. Please try again in a moment.'));
      }
      return;
    }
    const subject = t('brand.newsletter.mailSubject', 'Newsletter subscription');
    const body = t('brand.newsletter.mailBody', {
      email: value,
      defaultValue: 'Please add {{email}} to the Smart Marina Connect newsletter. I agree to receive it and can unsubscribe at any time.',
    });
    window.location.href = `mailto:${M3_PUBLIC_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    setState('done');
  };

  if (state === 'done') {
    return (
      <p role="status" className={cn('flex items-start gap-2 text-sm', dark ? 'text-white/85' : 'text-ink', className)}>
        <Check className={cn('mt-0.5 h-4 w-4 shrink-0', dark ? 'text-gold' : 'text-teal')} aria-hidden="true" />
        {onSubscribe
          ? t('brand.newsletter.done', 'Thank you. Check your inbox to confirm.')
          : t('brand.newsletter.doneMail', 'Your e-mail app has opened with the request: send it and we add you.')}
      </p>
    );
  }

  return (
    <form onSubmit={submit} noValidate className={cn('min-w-0', className)} aria-describedby={error ? `${id}-err` : undefined}>
      <label
        htmlFor={`${id}-email`}
        className={cn(hideLabel ? 'sr-only' : 'mb-3 block text-sm font-semibold', !hideLabel && (dark ? 'text-white' : 'text-navy'))}
      >
        {t('brand.newsletter.label', 'Newsletter: M3 events and new resources')}
      </label>
      <div
        className={cn(
          'flex h-[58px] items-center gap-2 rounded-full pl-5 pr-[5px] transition-colors duration-300',
          // Edges at 3:1 or more: white 25 % is decoration, so the field also has a fill; gold ring on focus.
          dark
            ? 'border border-white/25 bg-white/[.08] focus-within:border-gold'
            : 'border border-checkbox bg-white focus-within:border-navy focus-within:shadow-focus',
        )}
      >
        <input
          id={`${id}-email`}
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t('brand.newsletter.placeholder', 'Your work e-mail')}
          aria-invalid={!!error && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())}
          className={cn(
            'h-full w-full min-w-0 flex-1 bg-transparent text-base outline-none',
            dark ? 'text-white placeholder:text-white/65' : 'text-ink placeholder:text-meta',
          )}
        />
        <Button
          type="submit"
          variant={dark ? 'ctaOnDark' : 'cta'}
          size="sm"
          disabled={state === 'sending'}
          aria-label={t('brand.newsletter.submit', 'Subscribe')}
          // A round arrow only on phones, so the field keeps the whole width.
          className="h-[46px] shrink-0 max-sm:w-[46px] max-sm:justify-center max-sm:gap-0 max-sm:p-0 max-sm:[&_.cta-l]:hidden"
        >
          {t('brand.newsletter.submit', 'Subscribe')}
        </Button>
      </div>
      <label className={cn('mt-4 flex cursor-pointer items-start gap-3 text-sm leading-[22px]', dark ? 'text-white/80' : 'text-meta')}>
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="peer sr-only" />
        <span
          aria-hidden="true"
          className={cn(
            'mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border-[1.5px] text-navy transition-colors duration-200',
            'peer-checked:border-gold peer-checked:bg-gold peer-focus-visible:shadow-[0_0_0_2px_#081d40,0_0_0_4px_#ffffff]',
            dark ? 'border-white/70' : 'border-checkbox peer-focus-visible:shadow-focus',
            '[&>svg]:opacity-0 peer-checked:[&>svg]:opacity-100',
          )}
        >
          <Check className="h-3.5 w-3.5" strokeWidth={3} />
        </span>
        <span>
          {t('brand.newsletter.consent', 'I agree to receive the Smart Marina Connect newsletter from M3 Monaco. I can unsubscribe at any time.')}{' '}
          <Link to="/privacy" className={cn('underline underline-offset-2', dark ? 'text-white' : 'text-navy hover:text-navy')}>
            {t('brand.newsletter.privacy', 'Privacy policy')}
          </Link>
        </span>
      </label>
      {error && (
        <p id={`${id}-err`} role="alert" className={cn('mt-3 text-sm font-medium', dark ? 'text-[#ffd3a1]' : 'text-red-700')}>
          {error}
        </p>
      )}
    </form>
  );
}
