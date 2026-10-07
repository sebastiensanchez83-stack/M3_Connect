import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Check, Crosshair } from 'lucide-react';
import { cn } from '@/lib/utils';
import { buttonVariants } from '@/components/ui/button';
import { WaveEdge } from '@/components/motion/WaveEdge';
import { M3_PUBLIC_EMAIL } from './ContactCard';

/**
 * Pieces of the "horizon" footer: the waterline its top edge rises on, the two
 * harbour coordinates, and the newsletter field. No giant wordmark.
 */

/**
 * Two wave layers in the footer's own navy, drifting slowly in opposite
 * directions (14 s and 19 s), rising from the footer into the section above.
 * `above` is that section's background (the band behind the crests).
 */
export function HorizonEdge({ above, className }: { above?: string; className?: string }) {
  return (
    <WaveEdge
      className={cn('h-14 md:h-20', className)}
      style={above ? { backgroundColor: above } : undefined}
      layers={[
        { color: 'rgb(11 38 83)', opacity: 1, amp: 30, halfWaves: 6, baseline: 52, period: 19, reverse: true, phase: 0.4 },
        { color: 'rgb(8 29 64)', opacity: 1, amp: 24, halfWaves: 4, baseline: 70, period: 14 },
      ]}
    />
  );
}

/** "43°44′ N · 7°25′ E — Monaco" and "25°16′ N · 55°18′ E — Dubai". */
export function HarbourCoordinates({ className }: { className?: string }) {
  const { t } = useTranslation();
  const places = [
    { coords: '43°44′ N · 7°25′ E', name: t('brand.route.monaco', 'Monaco') },
    { coords: '25°16′ N · 55°18′ E', name: t('brand.route.dubai', 'Dubai') },
  ];
  return (
    <ul className={cn('space-y-1.5 text-[12px] font-medium uppercase tracking-[0.08em] text-white/60', className)}>
      {places.map((p) => (
        <li key={p.name} className="flex items-center gap-2 tabular">
          <Crosshair className="h-3.5 w-3.5 shrink-0 text-white/40" aria-hidden="true" />
          <span>
            {p.coords} — <span className="text-white/85">{p.name}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Newsletter sign-up: an e-mail field and an UNTICKED consent box (required).
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
  className,
}: {
  /** The real subscription, once decided. Throw to show the error message. */
  onSubscribe?: (email: string) => Promise<void> | void;
  tone?: 'dark' | 'light';
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
        <Check className={cn('mt-0.5 h-4 w-4 shrink-0', dark ? 'text-[#7fc8d4]' : 'text-teal')} aria-hidden="true" />
        {onSubscribe
          ? t('brand.newsletter.done', 'Thank you. Check your inbox to confirm.')
          : t('brand.newsletter.doneMail', 'Your e-mail app has opened with the request: send it and we add you.')}
      </p>
    );
  }

  return (
    <form onSubmit={submit} noValidate className={cn('space-y-3', className)} aria-describedby={error ? `${id}-err` : undefined}>
      <label htmlFor={`${id}-email`} className={cn('block text-sm font-semibold', dark ? 'text-white' : 'text-navy')}>
        {t('brand.newsletter.label', 'Newsletter: M3 events and new resources')}
      </label>
      {/* A field (12 px corners) and a labelled button beside it. */}
      <div className="flex flex-wrap gap-2">
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
            'h-12 min-w-[12rem] flex-1 rounded-field px-4 text-[15px] outline-none',
            // Edges at 3:1 or more: white 60 % on the footer navy, #6b7588 on white.
            dark
              ? 'bg-white/10 text-white ring-1 ring-inset ring-white/60 placeholder:text-white/65 focus:ring-2 focus:ring-white'
              : 'border border-checkbox bg-white text-ink placeholder:text-meta focus:border-navy focus:shadow-focus',
          )}
        />
        <button
          type="submit"
          disabled={state === 'sending'}
          className={cn(buttonVariants({ variant: dark ? 'tideOnDark' : 'tide' }), 'shrink-0')}
        >
          {t('brand.newsletter.submit', 'Subscribe')}
        </button>
      </div>
      <label className={cn('flex cursor-pointer items-start gap-2.5 text-xs leading-5', dark ? 'text-white/75' : 'text-meta')}>
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className={cn(
            'mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded-[4px] accent-[#d7a647]',
            dark ? 'border-white/60' : 'border-checkbox',
          )}
        />
        <span>
          {t('brand.newsletter.consent', 'I agree to receive the Smart Marina Connect newsletter from M3 Monaco. I can unsubscribe at any time.')}{' '}
          <Link to="/privacy" className={cn('underline underline-offset-2', dark ? 'hover:text-white' : 'hover:text-navy')}>
            {t('brand.newsletter.privacy', 'Privacy policy')}
          </Link>
        </span>
      </label>
      {error && (
        <p id={`${id}-err`} role="alert" className={cn('text-xs font-medium', dark ? 'text-[#ffd3a1]' : 'text-red-700')}>
          {error}
        </p>
      )}
    </form>
  );
}
