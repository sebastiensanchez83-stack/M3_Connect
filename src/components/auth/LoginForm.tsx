import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { getStoredInvite } from '@/lib/invite-store';
import { Button } from '@/components/ui/button';
import { UnderlineLink } from '@/components/brand/UnderlineLink';
import { AuthInput, AuthLabel, AuthNotice, PasswordInput } from '@/components/auth/fields';
import { throughWelcome } from '@/lib/confirmationLink';
import { type AuthErrorLike, isInvalidCredentials, isNetworkError, isRateLimited, signInErrorMessage } from '@/lib/authErrors';
import { toast } from '@/hooks/use-toast';
import { Loader2, MailWarning } from 'lucide-react';

interface LoginFormProps {
  onSuccess?: () => void;
  defaultEmail?: string;
  showConfirmedBanner?: boolean;
  /** Arrived from a confirmation link that failed (expired, already used): say so and offer a new one. */
  linkError?: boolean;
  /**
   * Where the visitor was heading (a path on this site, already through safeNext): it rides on the
   * e-mailed sign-in and password-reset links as ?next=, which /welcome and /reset-password follow.
   */
  next?: string | null;
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
function withNext(url: string, next: string | null | undefined): string {
  if (!next) return url;
  try {
    const target = new URL(url, window.location.origin);
    target.searchParams.set('next', next);
    return target.toString();
  } catch {
    return url;
  }
}

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
 * The link always goes through /welcome (see throughWelcome), whatever
 * `redirectTo` says: an activation ends with the mailbox owner's own password.
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
      toast({ title: t('common.error'), description: t('auth.enterEmailFirst', 'Please enter your e-mail address'), variant: 'destructive' });
      return;
    }
    setSending(true);
    setFeedback(null);
    let sent = false;
    try {
      // GoTrue answers 200 without sending for an unknown or already-confirmed
      // address (no enumeration), so "sent" means "asked for", not "delivered".
      const { error } = await supabase.auth.resend({ type: 'signup', email: address, options: { emailRedirectTo: withMailLang(throughWelcome(redirectTo), i18n.language) } });
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

export function LoginForm({ onSuccess, defaultEmail, showConfirmedBanner, linkError, next }: LoginFormProps) {
  const { t, i18n } = useTranslation();
  const { signIn } = useAuth();
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState(defaultEmail || '');
  const [password, setPassword] = useState('');
  const [forgotMode, setForgotMode] = useState(false);
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);
  const [forgotError, setForgotError] = useState<string | null>(null);
  // Why the last sign-in was refused, in plain words (cleared as soon as they edit).
  const [signInError, setSignInError] = useState<string | null>(null);
  // That refusal was a wrong address or password: the notice offers a new password.
  const [wrongCredentials, setWrongCredentials] = useState(false);
  // The address a sign-in was refused for because it is not confirmed yet.
  const [unconfirmedEmail, setUnconfirmedEmail] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setSignInError(null);

    let error: AuthErrorLike | null = null;
    try {
      ({ error } = await signIn(email.trim(), password));
    } catch (err) {
      error = err instanceof Error ? err : { message: String(err) };
    }

    if (isEmailNotConfirmed(error)) {
      // Explain it and offer the link again, rather than GoTrue's bare "Email not confirmed".
      setUnconfirmedEmail(email);
    } else if (error) {
      setSignInError(signInErrorMessage(error, t));
      setWrongCredentials(isInvalidCredentials(error));
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
      toast({ title: t('common.error'), description: t('auth.enterEmailFirst', 'Please enter your e-mail address'), variant: 'destructive' });
      return;
    }
    setForgotLoading(true);
    setForgotError(null);
    // Passwords are mandatory (Victor, 6 Oct 2026): the only e-mailed way in from
    // here is this link, which ends with choosing a password on /reset-password.
    // It also serves accounts that never had one (created for an event: pw_pending).
    let error: AuthErrorLike | null = null;
    try {
      ({ error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: withMailLang(withNext(`${window.location.origin}/reset-password`, next), i18n.language),
      }));
    } catch (err) {
      error = err instanceof Error ? err : { message: String(err) };
    }
    setForgotLoading(false);
    if (error) {
      if (import.meta.env.DEV) console.error('Password link could not be sent:', error);
      setForgotError(isRateLimited(error)
        ? t('auth.passwordLink.tooSoon', 'Please wait a minute before asking for another link.')
        : isNetworkError(error)
          ? t('auth.signInError.network', "We couldn't reach the server. Check your internet connection and try again.")
          : t('auth.passwordLink.failed', "We couldn't send the link just now. Please try again in a moment."));
    } else {
      // Said the same way whether or not the address has an account (GoTrue answers both alike).
      setForgotSent(true);
    }
  };

  if (forgotMode) {
    return (
      <form onSubmit={handleForgotPassword} className="space-y-5">
        <h3 className="text-h3 text-navy">{t('auth.passwordLink.title', 'Get a link to set your password')}</h3>
        <p className="text-sm leading-6 text-meta">
          {t('auth.passwordLink.desc', "Enter your e-mail address. We'll send you a link to choose a new password. It also works if you have never set one, for example when your account was created for an event.")}
        </p>
        <div className="space-y-2">
          <AuthLabel htmlFor="forgot-email">{t('auth.email')}</AuthLabel>
          <AuthInput
            id="forgot-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setForgotError(null); }}
            required
          />
        </div>
        {forgotSent ? (
          <div className="space-y-3 text-center">
            <AuthNotice tone="success" role="status" className="text-left">
              <p className="font-semibold text-navy">
                {t('auth.passwordLink.sentTitle', 'Check your inbox')}
              </p>
              <p className="text-[13px] text-meta">
                {t('auth.passwordLink.sentHint', 'If an account exists for this address, the link is on its way. It opens on any device, phone or computer. Nothing after a few minutes? Check your spam folder.')}
              </p>
            </AuthNotice>
            <UnderlineLink arrow={false} className="min-h-11" onClick={() => { setForgotMode(false); setForgotSent(false); }}>
              {t('auth.backToSignIn', 'Back to sign in')}
            </UnderlineLink>
          </div>
        ) : (
          <div className="space-y-4">
            {forgotError && (
              <AuthNotice tone="error" role="alert">
                <p>{forgotError}</p>
              </AuthNotice>
            )}
            <Button type="submit" variant="cta" className="w-full justify-between" disabled={forgotLoading}>
              {forgotLoading ? <><Loader2 className="h-4 w-4 animate-spin" />{t('common.loading')}</> : t('auth.passwordLink.send', 'Send me the link')}
            </Button>
            <div className="text-center">
              <UnderlineLink arrow={false} className="min-h-11" onClick={() => { setForgotMode(false); setForgotError(null); }}>
                {t('auth.backToSignIn', 'Back to sign in')}
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
          <p>{t('auth.emailConfirmedSignIn', 'Your e-mail is confirmed. Sign in to continue.')}</p>
        </AuthNotice>
      )}
      {linkError && (
        <AuthNotice tone="warning" title={t('auth.linkInvalidTitle', 'This link no longer works')}>
          <p>
            {t('auth.linkInvalidSignInDesc', 'It may have expired, or it was already used (some mail filters open links before you do). Try signing in first: if your address is confirmed, that is all you need. Otherwise, enter your e-mail below and ask for a new link.')}
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
          onChange={(e) => { setEmail(e.target.value); setSignInError(null); setWrongCredentials(false); }}
          required
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <AuthLabel htmlFor="password">{t('auth.password')}</AuthLabel>
          <UnderlineLink arrow={false} onClick={() => { setForgotMode(true); setSignInError(null); }} className="-my-2.5 min-h-11 !text-[13px] !font-medium">
            {t('auth.forgotPassword')}
          </UnderlineLink>
        </div>
        <PasswordInput
          id="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => { setPassword(e.target.value); setSignInError(null); setWrongCredentials(false); }}
          required
        />
      </div>

      {signInError && (
        <AuthNotice tone="error" role="alert">
          <p>{signInError}</p>
          {wrongCredentials && (
            <UnderlineLink
              arrow={false}
              className="min-h-11 !text-sm !font-medium"
              onClick={() => { setForgotMode(true); setSignInError(null); setWrongCredentials(false); }}
            >
              {t('auth.signInError.setPassword', 'Set a new password')}
            </UnderlineLink>
          )}
        </AuthNotice>
      )}

      <Button type="submit" variant="cta" className="w-full justify-between" disabled={loading}>
        {loading ? t('common.loading') : t('auth.login')}
      </Button>

      {unconfirmedEmail !== null && unconfirmedEmail === email && (
        <AuthNotice tone="warning" role="alert" icon={<MailWarning className="h-4 w-4" />}>
          <p>
            {t('auth.emailNotConfirmedSignIn', 'This e-mail address is not confirmed yet. Open the activation link we sent you, then sign in. Nothing in your inbox or spam folder? Send it again.')}
          </p>
          <div className="pt-1.5">
            <ResendConfirmationButton email={unconfirmedEmail} redirectTo={confirmationRedirectTo()} />
          </div>
        </AuthNotice>
      )}
    </form>
  );
}
