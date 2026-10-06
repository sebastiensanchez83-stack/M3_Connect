import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { getStoredInvite } from '@/lib/invite-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/use-toast';
import { Eye, EyeOff, Loader2, CheckCircle, AlertTriangle, MailWarning } from 'lucide-react';

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
    <div className="space-y-1.5">
      <Button type="button" variant="outline" size="sm" className="w-full bg-white" disabled={sending || cooldown > 0} onClick={handleResend}>
        {sending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
        {cooldown > 0
          ? t('auth.resendEmailIn', 'Resend the e-mail ({{seconds}} s)', { seconds: cooldown })
          : label ?? t('auth.resendConfirmation', 'Resend the confirmation e-mail')}
      </Button>
      {feedback === 'sent' && (
        <p className="text-xs text-green-700 text-center" role="status">{t('auth.resendEmailSent', 'A new e-mail is on its way.')}</p>
      )}
      {feedback === 'error' && (
        <p className="text-xs text-red-600 text-center" role="alert">{t('auth.resendEmailError', "We couldn't send the e-mail just now. Please wait a minute and try again.")}</p>
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
  const [showPassword, setShowPassword] = useState(false);
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
      <form onSubmit={handleForgotPassword} className="space-y-4">
        <p className="text-sm text-gray-600">{t('auth.forgotPasswordDesc', 'Enter your email and we\'ll send you a link to reset your password.')}</p>
        <div className="space-y-2">
          <Label htmlFor="forgot-email">{t('auth.email')}</Label>
          <Input
            id="forgot-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        {forgotSent || magicSent ? (
          <div className="space-y-2 text-center">
            <p className="text-sm text-green-600 font-medium">
              {magicSent
                ? t('auth.signInLinkSent', 'Sign-in link sent — check your inbox.')
                : t('auth.resetEmailSent', 'Reset email sent! Check your inbox.')}
            </p>
            <p className="text-xs text-gray-500">
              {t('auth.linkAnyDevice', 'The link opens on any device — phone or computer. If it is not there in a minute, check your spam folder.')}
            </p>
            <Button type="button" variant="ghost" size="sm" onClick={() => { setForgotMode(false); setForgotSent(false); setMagicSent(false); }}>
              {t('auth.backToLogin', 'Back to login')}
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            <Button type="submit" className="w-full" disabled={forgotLoading || magicLoading}>
              {forgotLoading ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />{t('common.loading')}</> : t('auth.sendResetLink', 'Send reset link')}
            </Button>
            {/* The way out for anyone who has already fought the password twice. */}
            <div className="relative py-1 text-center">
              <span className="text-[11px] uppercase tracking-wide text-gray-400 bg-white px-2 relative z-10">{t('auth.or', 'or')}</span>
              <span className="absolute left-0 right-0 top-1/2 border-t border-gray-100" />
            </div>
            <Button type="button" variant="outline" className="w-full" disabled={forgotLoading || magicLoading} onClick={handleMagicLink}>
              {magicLoading ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />{t('common.loading')}</> : t('auth.emailSignInLink', 'Email me a sign-in link instead')}
            </Button>
            <p className="text-[11px] text-gray-500 text-center">
              {t('auth.signInLinkHint', 'Signs you straight in — no password needed.')}
            </p>
            <Button type="button" variant="ghost" className="w-full" size="sm" onClick={() => setForgotMode(false)}>
              {t('auth.backToLogin', 'Back to login')}
            </Button>
          </div>
        )}
      </form>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {showConfirmedBanner && !linkError && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-green-50 border border-green-200 text-sm">
          <CheckCircle className="h-4 w-4 text-green-600 shrink-0" />
          <span className="text-green-800">{t('auth.emailConfirmedLogin', 'Your e-mail is confirmed. Log in to continue.')}</span>
        </div>
      )}
      {linkError && (
        <div className="space-y-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-medium text-amber-900">{t('auth.linkInvalidTitle', 'This link no longer works')}</p>
              <p className="text-amber-800">
                {t('auth.linkInvalidDesc', 'It may have expired, or it was already used (some mail filters open links before you do). Try logging in first: if your address is confirmed, that is all you need. Otherwise, enter your e-mail below and ask for a new link.')}
              </p>
            </div>
          </div>
          <ResendConfirmationButton email={email} redirectTo={confirmationRedirectTo()} label={t('auth.sendNewLink', 'Send me a new link')} />
        </div>
      )}
      <div className="space-y-2">
        <Label htmlFor="email">{t('auth.email')}</Label>
        <Input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="password">{t('auth.password')}</Label>
          <button
            type="button"
            onClick={() => setForgotMode(true)}
            className="text-xs text-primary hover:underline"
          >
            {t('auth.forgotPassword')}
          </button>
        </div>
        <div className="relative">
          <Input
            id="password"
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="pr-10"
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
            tabIndex={-1}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? t('common.loading') : t('auth.login')}
      </Button>

      {unconfirmedEmail !== null && unconfirmedEmail === email && (
        <div className="space-y-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm" role="alert">
          <div className="flex items-start gap-2">
            <MailWarning className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
            <span className="text-amber-900">
              {t('auth.emailNotConfirmed', 'This e-mail address is not confirmed yet. Open the activation link we sent you, then log in. Nothing in your inbox or spam folder? Send it again.')}
            </span>
          </div>
          <ResendConfirmationButton email={unconfirmedEmail} redirectTo={confirmationRedirectTo()} />
        </div>
      )}
    </form>
  );
}
