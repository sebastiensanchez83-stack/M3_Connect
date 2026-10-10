import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, MailCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AuthInput, AuthLabel, AuthNotice, FieldError } from '@/components/auth/fields';
import { Turnstile, useTurnstile } from '@/components/security/Turnstile';
import { registrationErrorText, resendRegistrationLinks } from '@/lib/registration';
import { EMAIL_RE } from './IdentityBlock';

/**
 * "Send me my links again": an e-mail address, and the registration function
 * mails a fresh personal link for every upcoming registration made with it.
 * The answer is the same whether the address is known or not, so nobody can
 * use this to find out who registered.
 */
export function ResendLinksForm({ defaultEmail = '', idPrefix = 'resend', compact = false }: { defaultEmail?: string; idPrefix?: string; compact?: boolean }) {
  const { t } = useTranslation();
  const [email, setEmail] = useState(defaultEmail);
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const captcha = useTurnstile();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const clean = email.trim().toLowerCase();
    if (!EMAIL_RE.test(clean)) {
      setError(t('reg.field.emailInvalid', 'Please enter a valid e-mail address, like name@company.com.'));
      return;
    }
    setSending(true);
    const res = await resendRegistrationLinks(clean, captcha.token);
    setSending(false);
    captcha.reset();
    // Only a refusal of the request itself (too many, the check) is said: never "unknown address".
    if (!res.ok && (res.error === 'rate_limited' || res.error === 'captcha' || res.error === 'network')) {
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
          {t('reg.resend.intro', 'Type the e-mail address you registered with. We send you a new personal link for each of your upcoming events.')}
        </p>
      )}
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
        {error && <FieldError id={`${idPrefix}-err`}>{error}</FieldError>}
      </div>
      <Turnstile captcha={captcha} action="registration-links" />
      <Button type="submit" variant="ctaNavy" disabled={sending || captcha.waiting} arrow={!sending} roll={!sending} className="w-full justify-between sm:w-auto">
        {sending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />{t('reg.sending', 'Sending…')}</> : t('reg.resend.send', 'Send me my links')}
      </Button>
    </form>
  );
}
