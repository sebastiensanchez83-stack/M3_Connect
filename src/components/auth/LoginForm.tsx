import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { getStoredInvite } from '@/lib/invite-store';
import { Button } from '@/components/ui/button';
import { UnderlineLink } from '@/components/brand/UnderlineLink';
import { AuthInput, AuthLabel, AuthNotice, FieldHint, OrDivider, PasswordInput } from '@/components/auth/fields';
import { toast } from '@/hooks/use-toast';
import { Loader2, MailWarning } from 'lucide-react';

interface LoginFormProps {
  onSuccess?: () => void;
  defaultEmail?: string;
  showConfirmedBanner?: boolean;
  /** Arrived from a confirmation link that failed (expired, already used): say so and offer a new one. */
  linkError?: boolean;
}

// GoTrue refuses a second confirmation mail to the same address within ~60 s.
const RESEND_COOLDOWN_S = 60;

/** Where a confirmation link lands: the same place AuthContext.signUp points it to. */
export function confirmationRedirectTo(): string {
  const inviteId = getStoredInvite();
  return inviteId
    ? `${window.location.origin}/join/${inviteId}?email_confirmed=true`
    : `${window.location.origin}/onboarding?email_confirmed=true`;
}

/**
 * `url` with lang=fr|en added, keeping the query it already has. The send-email
 * hook writes the e-mail in that language when the account has none stored
 * (claim-code, SM26 and invited accounts, and every account older than that).
 */
function withMailLang(url: string, language: string | undefined): string {
  try {
    const target = new URL(url, window.location.origin);
    target.searchParams.set('lang', language?.startsWith('fr') ? 'fr' : 'en');
    return target.toString();
  } catch {
    return url;
  }
}

/** A sign-in refused only because the address has not been confirmed yet ("Confirm email" ON). */
export function isEmailNotConfirmed(error: { message?: string; code?: string } | null | undefined): boolean {
  return !!error && (error.code === 'email_not_confirmed' || /email not confirmed/i.test(error.message || ''));
}

/**
 * Sends the sign-up activation link again (supabase.auth.resend), with GoTrue's
 * cooldown and a line of feedback. `justSent` starts the cooldown at once, for
 * a screen that shows up right after the first mail went out.
 */
export function ResendConfirmationButton({ email, redirectTo, label, justSent = false }: {
  email: string;
  redirectTo: string;
  label?: string;
  justSent?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const [cooldown, setCooldown] = useState(justSent ? RESEND_COOLDOWN_S : 0);
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<'sent' | 'error' | null>(null);

  // Count the cooldown down, one second at a time.
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const handleResend = async () => {
    if (sending || cooldown > 0) return;
    const address = email.trim();
    if (!address) {
      toast({ title: t('common.error'), description: t('auth.enterEmailFirst', 'Please enter your email address'), variant: 'destructive' });
      return;
    }
    setSending(true);
    setFeedback(null);
    let sent = false;
    try {
      // GoTrue answers 200 without sending for an unknown or already-confirmed
      // address (no enumeration), so "sent" means "asked for", not "delivered".
      const { error } = await supabase.auth.resend({ type: 'signup', email: address, options: { emailRedirectTo: withMailLang(redirectTo, i18n.language) } });
      if (error) console.error('Confirmation resend error:', error.message);
      else sent = true;
    } catch (err) {
      console.error('Confirmation resend error:', err);
    }
    setSending(false);
    setFeedback(sent ? 'sent' : 'error');
    if (sent) setCooldown(RESEND_COOLDOWN_S);
  };

  return (
    <div className="space-y-2">
      <Button type="button" variant="ctaOutline" size="sm" arrow={false} roll={false} className="w-full bg-white" disabled={sending || cooldown > 0} onClick={handleResend}>
        {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {cooldown > 0
          ? t('auth.resendEmailIn', 'Resend the e-mail ({{seconds}} s)', { seconds: cooldown })
          : label ?? t('auth.resendConfirmation', 'Resend the confirmation e-mail')}
      </Button>
      {feedback === 'sent' && (
        <p className="text-center text-[13px] leading-5 text-teal-text" role="status">{t('auth.resendEmailSent', 'A new e-mail is on its way.')}</p>
      )}
      {feedback === 'error' && (
        <p className="text-center text-[13px] leading-5 text-red-700" role="alert">{t('auth.resendEmailError', "We couldn't send the e-mail just now. Please wait a minute and try again.")}</p>
      )}
    </div>
  );
}

export function LoginForm({ onSuccess, defaultEmail, showConfirmedBanner, linkError }: LoginFormProps) {
  const { t, i18n } = useTranslation();
  const { signIn } = useAuth();
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState(defaultEmail || '');
  const [password, setPassword] = useState('');
  const [forgotMode, setForgotMode] = useState(false);
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);
  const [magicLoading, setMagicLoading] = useState(false);
  const [magicSent, setMagicSent] = useState(false);
  // The address a sign-in was refused for because it is not confirmed yet.
  const [unconfirmedEmail, setUnconfirmedEmail] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const { error } = await signIn(email, password);

    if (isEmailNotConfirmed(error)) {
      // Explain it and offer the link again, rather than GoTrue's bare "Email not confirmed".
      setUnconfirmedEmail(email);
    } else if (error) {
      toast({
        title: t('common.error'),
        description: error.message,
        variant: 'destructive',
      });
    } else {
      toast({
        title: t('auth.loginSuccess'),
      });
      onSuccess?.();
    }

    setLoading(false);
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      toast({ title: t('common.error'), description: t('auth.enterEmailFirst', 'Please enter your email address'), variant: 'destructive' });
      return;
    }
    setForgotLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: withMailLang(`${window.location.origin}/reset-password`, i18n.language),
    });
    setForgotLoading(false);
    if (error) {
      toast({ title: t('common.error'), description: error.message, variant: 'destructive' });
    } else {
      setForgotSent(true);
      toast({ title: t('auth.resetEmailSent', 'Reset email sent'), description: t('auth.checkEmailForReset', 'Check your email for a password reset link.') });
    }
  };

  // Sign in with a one-time link instead of a password. Same email machinery as
  // the reset, but it drops you straight in — no password to choose, remember or
  // get wrong — which is what most people stuck at this screen actually want.
  const handleMagicLink = async () => {
    if (!email) {
      toast({ title: t('common.error'), description: t('auth.enterEmailFirst', 'Please enter your email address'), variant: 'destructive' });
      return;
    }
    setMagicLoading(true);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false, emailRedirectTo: withMailLang(`${window.location.origin}/welcome`, i18n.language) },
    });
    setMagicLoading(false);
    if (error) {
      toast({ title: t('common.error'), description: error.message, variant: 'destructive' });
      return;
    }
    setMagicSent(true);
  };

  if (forgotMode) {
    return (
      <form onSubmit={handleForgotPassword} className="space-y-5">
        <p className="text-sm leading-6 text-meta">{t('auth.forgotPasswordDesc', 'Enter your email and we\'ll send you a link to reset your password.')}</p>
        <div className="space-y-2">
          <AuthLabel htmlFor="forgot-email">{t('auth.email')}</AuthLabel>
          <AuthInput
            id="forgot-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        {forgotSent || magicSent ? (
          <div className="space-y-3 text-center">
            <AuthNotice tone="success" role="status" className="text-left">
              <p className="font-semibold text-navy">
                {magicSent
                  ? t('auth.signInLinkSent', 'Sign-in link sent — check your inbox.')
                  : t('auth.resetEmailSent', 'Reset email sent! Check your inbox.')}
              </p>
              <p className="text-[13px] text-meta">
                {t('auth.linkAnyDevice', 'The link opens on any device — phone or computer. If it is not there in a minute, check your spam folder.')}
              </p>
            </AuthNotice>
            <UnderlineLink arrow={false} onClick={() => { setForgotMode(false); setForgotSent(false); setMagicSent(false); }}>
              {t('auth.backToLogin', 'Back to login')}
            </UnderlineLink>
          </div>
        ) : (
          <div className="space-y-4">
            <Button type="submit" variant="cta" className="w-full justify-between" disabled={forgotLoading || magicLoading}>
              {forgotLoading ? <><Loader2 className="h-4 w-4 animate-spin" />{t('common.loading')}</> : t('auth.sendResetLink', 'Send reset link')}
            </Button>
            {/* The way out for anyone who has already fought the password twice. */}
            <OrDivider>{t('auth.or', 'or')}</OrDivider>
            <Button type="button" variant="ctaOutline" className="w-full justify-between" disabled={forgotLoading || magicLoading} onClick={handleMagicLink}>
              {magicLoading ? <><Loader2 className="h-4 w-4 animate-spin" />{t('common.loading')}</> : t('auth.emailSignInLink', 'Email me a sign-in link instead')}
            </Button>
            <FieldHint className="text-center">
              {t('auth.signInLinkHint', 'Signs you straight in — no password needed.')}
            </FieldHint>
            <div className="text-center">
              <UnderlineLink arrow={false} onClick={() => setForgotMode(false)}>
                {t('auth.backToLogin', 'Back to login')}
              </UnderlineLink>
            </div>
          </div>
        )}
      </form>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {showConfirmedBanner && !linkError && (
        <AuthNotice tone="success" className="items-center">
          <p>{t('auth.emailConfirmedLogin', 'Your e-mail is confirmed. Log in to continue.')}</p>
        </AuthNotice>
      )}
      {linkError && (
        <AuthNotice tone="warning" title={t('auth.linkInvalidTitle', 'This link no longer works')}>
          <p>
            {t('auth.linkInvalidDesc', 'It may have expired, or it was already used (some mail filters open links before you do). Try logging in first: if your address is confirmed, that is all you need. Otherwise, enter your e-mail below and ask for a new link.')}
          </p>
          <div className="pt-1.5">
            <ResendConfirmationButton email={email} redirectTo={confirmationRedirectTo()} label={t('auth.sendNewLink', 'Send me a new link')} />
          </div>
        </AuthNotice>
      )}
      <div className="space-y-2">
        <AuthLabel htmlFor="email">{t('auth.email')}</AuthLabel>
        <AuthInput
          id="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <AuthLabel htmlFor="password">{t('auth.password')}</AuthLabel>
          <UnderlineLink arrow={false} onClick={() => setForgotMode(true)} className="!text-[13px] !font-medium">
            {t('auth.forgotPassword')}
          </UnderlineLink>
        </div>
        <PasswordInput
          id="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>

      <Button type="submit" variant="cta" className="w-full justify-between" disabled={loading}>
        {loading ? t('common.loading') : t('auth.login')}
      </Button>

      {unconfirmedEmail !== null && unconfirmedEmail === email && (
        <AuthNotice tone="warning" role="alert" icon={<MailWarning className="h-4 w-4" />}>
          <p>
            {t('auth.emailNotConfirmed', 'This e-mail address is not confirmed yet. Open the activation link we sent you, then log in. Nothing in your inbox or spam folder? Send it again.')}
          </p>
          <div className="pt-1.5">
            <ResendConfirmationButton email={unconfirmedEmail} redirectTo={confirmationRedirectTo()} />
          </div>
        </AuthNotice>
      )}
    </form>
  );
}
