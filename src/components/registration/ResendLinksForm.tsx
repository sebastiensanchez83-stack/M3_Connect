import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, MailCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AuthInput, AuthLabel, AuthNotice, FieldError } from '@/components/auth/fields';
import { registrationErrorText, resendRegistrationLinks } from '@/lib/registration';
import { EMAIL_RE } from './IdentityBlock';

/**
 * "Send me my links again": an e-mail address, and the registration function
 * mails a fresh personal link for every upcoming registration made with it.
 * The answer is the same whether the address is known or not, so nobody can
 * use this to find out who registered (the function limits how often).
 *
 * Signed in, `lockedEmail` sends to the account's address in one click.
 */
export function ResendLinksForm({
  defaultEmail = '',
  lockedEmail,
  idPrefix = 'resend',
  compact = false,
}: {
  defaultEmail?: string;
  /** The account's address: no field, one button. */
  lockedEmail?: string | null;
  idPrefix?: string;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const [email, setEmail] = useState(lockedEmail ?? defaultEmail);
  const [honeypot, setHoneypot] = useState('');
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const clean = (lockedEmail ?? email).trim().toLowerCase();
    if (!EMAIL_RE.test(clean)) {
      setError(t('reg.field.emailInvalid', 'Please enter a valid e-mail address, like name@company.com.'));
      return;
    }
    setSending(true);
    const res = await resendRegistrationLinks(clean, honeypot);
    setSending(false);
    // Only a refusal of the request itself is said: never "unknown address".
    if (!res.ok && (res.error === 'invalid_email' || res.error === 'rate_limited' || res.error === 'network')) {
      setError(registrationErrorText(t, res));
      return;
    }
    setSentTo(clean);
  };

  if (sentTo) {
    return (
      <AuthNotice tone="success" role="status" icon={<MailCheck className="h-4 w-4" />} title={t('reg.resend.doneTitle', 'Check your inbox')}>
        <p>{t('reg.resend.done', { email: sentTo, defaultValue: 'If {{email}} has registrations for upcoming events, we have just sent the links to it. Nothing after 10 minutes? Look in your spam folder.' })}</p>
      </AuthNotice>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      {!compact && (
        <p className="text-sm leading-6 text-ink">
          {lockedEmail
            ? t('reg.resend.introLocked', { email: lockedEmail, defaultValue: 'We send a new personal link for each of your upcoming events to {{email}}.' })
            : t('reg.resend.intro', 'Type the e-mail address you registered with. We send you a new personal link for each of your upcoming events.')}
        </p>
      )}
      {!lockedEmail && (
        <div className="space-y-2">
          <AuthLabel htmlFor={`${idPrefix}-email`}>{t('reg.field.email', 'E-mail')}</AuthLabel>
          <AuthInput
            id={`${idPrefix}-email`}
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setError(null); }}
            aria-invalid={!!error}
            aria-describedby={error ? `${idPrefix}-err` : undefined}
          />
        </div>
      )}
      {error && <FieldError id={`${idPrefix}-err`}>{error}</FieldError>}
      {/* Honeypot: invisible to people, filled by bots. */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        value={honeypot}
        onChange={(e) => setHoneypot(e.target.value)}
        className="absolute -left-[9999px] h-0 w-0 opacity-0"
        aria-hidden="true"
      />
      <Button type="submit" variant="ctaNavy" disabled={sending} arrow={!sending} roll={!sending} className="w-full justify-between sm:w-auto">
        {sending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />{t('reg.sending', 'Sending…')}</> : t('reg.resend.send', 'Send me my links')}
      </Button>
    </form>
  );
}
