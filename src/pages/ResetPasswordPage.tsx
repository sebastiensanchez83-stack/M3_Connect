import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { UnderlineLink } from '@/components/brand/UnderlineLink';
import { AuthLoading, AuthShell } from '@/components/auth/AuthShell';
import { AUTH_FIELD_ERROR, AuthInput, AuthLabel, AuthNotice, FieldError, PasswordInput } from '@/components/auth/fields';
import { supabase } from '@/lib/supabase';
import { safeNext } from '@/lib/safeNext';
import type { EmailOtpType } from '@supabase/supabase-js';
import { Loader2, CheckCircle } from 'lucide-react';

const OTP_TYPES = ['recovery', 'invite', 'magiclink', 'signup', 'email_change'];

type AuthErrorLike = { code?: string; status?: number; name?: string; message?: string };

/** GoTrue's own (English) wording never reaches the page; in development it goes to the console. */
function logAuthError(context: string, error: unknown) {
  if (import.meta.env.DEV) console.error(context, error);
}

function isRateLimited(error: AuthErrorLike): boolean {
  return error.status === 429 || error.code === 'over_email_send_rate_limit' || error.code === 'over_request_rate_limit';
}

// This session can no longer save a password: the link's session has expired
// or been revoked, or ("Secure password change" ON) it is too old. Retrying
// cannot help — a fresh link can.
const SESSION_GONE_CODES = new Set([
  'otp_expired', 'reauthentication_needed', 'session_not_found', 'session_expired',
  'bad_jwt', 'refresh_token_not_found', 'refresh_token_already_used',
]);
function isSessionGone(error: AuthErrorLike): boolean {
  return error.name === 'AuthSessionMissingError' || SESSION_GONE_CODES.has(error.code ?? '') || error.status === 401;
}

export function ResetPasswordPage() {
  const { t, i18n } = useTranslation();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [checking, setChecking] = useState(true);
  // Only set when the link came from an in-app flow that wants the user back on
  // a particular page (the account page's "change my password" button, the
  // welcome step's e-mailed fallback). Read once, before the address bar is
  // scrubbed, and only ever a path on this site — see safeNext.
  const [next] = useState(() =>
    safeNext(new URLSearchParams(window.location.search).get('next'), { deny: ['/reset-password'] }),
  );
  const [resendEmail, setResendEmail] = useState('');
  const [resendBusy, setResendBusy] = useState(false);
  const [resent, setResent] = useState(false);
  const [resendError, setResendError] = useState<string | null>(null);
  // The session went stale between opening the link and saving the password.
  const [sessionLost, setSessionLost] = useState(false);
  const lost = useRef(false);
  // The account the link signed in, to pre-fill the request for a fresh one.
  const accountEmail = useRef('');
  const redirectTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(redirectTimer.current), []);

  useEffect(() => {
    let mounted = true;

    const url = new URL(window.location.href);
    const tokenHash = url.searchParams.get('token_hash');
    const typeParam = url.searchParams.get('type');
    const code = url.searchParams.get('code');
    // GoTrue reports a link it refused (expired, already used) as error params
    // in the query and/or the #hash; an implicit-flow link carries its tokens there.
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const linkError = ['error', 'error_code', 'error_description'].some((k) => url.searchParams.has(k) || hash.has(k));
    const hashLink = hash.has('access_token') || hash.get('type') === 'recovery';
    // Whether this visit came from an e-mailed link at all, good or bad.
    const fromLink = !!tokenHash || !!code || linkError || hashLink;

    // Once the credential is spent, take it out of the address bar so a
    // copied or bookmarked URL carries nothing usable.
    const scrubUrl = () => window.history.replaceState({}, '', window.location.pathname);

    const ready = (email?: string | null) => {
      if (!mounted || lost.current) return;
      if (email) accountEmail.current = email;
      setSessionReady(true);
      setChecking(false);
      scrubUrl();
    };

    // supabase-js re-announces a session that was already here as SIGNED_IN
    // whenever the tab regains focus. After a link, that must never stand in
    // for the link: only the calls below (or a recovery event) decide.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted || !session) return;
      if (event === 'PASSWORD_RECOVERY' || (event === 'SIGNED_IN' && !fromLink)) ready(session.user?.email);
    });

    void (async () => {
      // 1. token_hash — the recovery email's own path. It is verified server-side,
      // so it resolves in ANY browser on ANY device. This is what makes a link an
      // admin sent, or one requested on a laptop and opened on a phone, work at all.
      if (tokenHash) {
        const type: EmailOtpType =
          typeParam && OTP_TYPES.includes(typeParam) ? (typeParam as EmailOtpType) : 'recovery';
        const { data, error: otpError } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
        if (!mounted) return;
        if (data?.session) { ready(data.session.user?.email); return; }
        if (otpError) logAuthError('verifyOtp failed:', otpError);
      }

      // 2. PKCE code — resolvable ONLY in the browser that requested the link,
      // because the code verifier never leaves that browser's storage. Kept so
      // links already in flight, and any flow still using redirectTo, still land.
      if (code) {
        const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (!mounted) return;
        if (data?.session) { ready(data.session.user?.email); return; }
        if (exchangeError) logAuthError('Code exchange failed:', exchangeError);
        // supabase-js may have redeemed the code itself at start-up
        // (detectSessionInUrl), which spends it before the call above and only
        // announces SIGNED_IN — ignored here after a link. It deletes `code` from
        // the address bar only once that exchange succeeded (the call above waits
        // for start-up to finish), so a code that is gone means the session now
        // stored is the link's own, not whoever was signed in before.
        if (!new URLSearchParams(window.location.search).has('code')) {
          const { data: { session } } = await supabase.auth.getSession();
          if (!mounted) return;
          if (session) { ready(session.user?.email); return; }
        }
      }

      // 3. An implicit-flow hash fragment needs no call here: detectSessionInUrl
      // consumes it and the session arrives through onAuthStateChange above.

      // 4. Already signed in and no link at all — e.g. changing the password from
      // the account page. Deliberately NOT a fallback for a link that failed
      // (GoTrue's error report included): an admin who sends a link from their
      // own browser and then clicks it would otherwise be handed a form that
      // changes THEIR password. A link that does not verify must fail, whoever
      // happens to be signed in.
      if (!fromLink) {
        const { data: { session } } = await supabase.auth.getSession();
        if (!mounted) return;
        if (session) { ready(session.user?.email); return; }
      }

      // Nothing resolved outright. Give the hash-fragment listener a moment if a
      // fragment is actually present; otherwise fail fast rather than making
      // someone watch a spinner for fifteen seconds to be told no.
      const hasHash =
        hashLink || window.location.hash.includes('access_token') || window.location.hash.includes('type=recovery');
      setTimeout(() => { if (mounted) setChecking(false); }, hasHash ? 6000 : 1200);
    })();

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const requestNewLink = async () => {
    const email = resendEmail.trim().toLowerCase();
    if (!email || resendBusy) return;
    setResendBusy(true);
    setResendError(null);
    // Back here, on to the same destination as the link that failed. lang= sets
    // the e-mail's language for accounts that have none stored (send-email hook).
    const redirect = new URL('/reset-password', window.location.origin);
    if (next) redirect.searchParams.set('next', next);
    redirect.searchParams.set('lang', i18n.language?.startsWith('fr') ? 'fr' : 'en');
    let failure: AuthErrorLike | null = null;
    try {
      const { error: sendError } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: redirect.toString() });
      failure = sendError;
    } catch (err) {
      failure = err instanceof Error ? err : { message: String(err) };
    }
    setResendBusy(false);
    if (failure) {
      logAuthError('Password link could not be sent:', failure);
      setResendError(isRateLimited(failure)
        ? t('resetPassword.resendTooSoon', 'Please wait a minute before asking for another link.')
        : t('resetPassword.resendFailed', "We couldn't send the link just now. Please try again in a moment."));
      return;
    }
    // Reported the same way whether or not the address has an account — which
    // addresses are registered is not ours to disclose (GoTrue answers both alike).
    setResent(true);
  };

  /** A translated reason for a refused update; GoTrue's own text stays in the console. */
  const updateErrorMessage = (err: AuthErrorLike): string => {
    if (err.code === 'weak_password') {
      return t('resetPassword.weakPassword', 'This password is too weak or too common. Choose a longer, less predictable one.');
    }
    if (err.code === 'same_password' || /different from the old password/i.test(err.message || '')) {
      return t('resetPassword.samePassword', 'This is already your password. Choose a different one.');
    }
    if (isRateLimited(err)) {
      return t('resetPassword.tooManyAttempts', 'Too many attempts. Please wait a minute and try again.');
    }
    return t('resetPassword.updateFailed', "Your password couldn't be updated. Please try again in a moment.");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password !== confirmPassword) {
      setError(t('auth.passwordMismatch', 'Passwords do not match.'));
      return;
    }

    if (password.length < 8) {
      setError(t('auth.passwordTooShort', 'Password too short (min. 8 characters).'));
      return;
    }

    // GoTrue refuses more than 72 bytes (bcrypt); say so before the round trip.
    if (new TextEncoder().encode(password).length > 72) {
      setError(t('resetPassword.passwordTooLong', 'Password too long (max. 72 characters).'));
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // The recovery session is established by now. Clearing pw_pending matters:
      // an event-provisioned account that resets its password here has done the
      // welcome step's job, and AuthRedirector would otherwise keep bouncing it
      // back to /welcome to "set a password" on every navigation.
      const { error: updateError } = await supabase.auth.updateUser({
        password,
        data: { pw_pending: false, pw_pending_reason: null, pw_pending_next: null },
      });

      if (updateError) {
        logAuthError('Password could not be updated:', updateError);
        setLoading(false);
        if (isSessionGone(updateError)) {
          // Nothing to retry from here: offer a fresh link instead.
          lost.current = true;
          setResendEmail(accountEmail.current);
          setSessionLost(true);
          setSessionReady(false);
          setChecking(false);
          return;
        }
        setError(updateErrorMessage(updateError));
        return;
      }

      setSuccess(true);

      if (next) {
        // In-app change: keep them signed in and put them back where they started.
        // A full page load, not a router navigation: the link's session arrives as
        // PASSWORD_RECOVERY, which AuthContext only records — it never loads that
        // account's profile and organisations. Opened on another device, or with
        // someone else signed in here, an in-app jump would land on a page with no
        // profile (or the previous account's). The reload starts from the stored
        // session. `next` is already a path on this site (safeNext).
        redirectTimer.current = window.setTimeout(() => window.location.replace(next), 1500);
      } else {
        // Recovery from an email link: sign out so the new password gets used once,
        // which confirms to them that it works.
        await supabase.auth.signOut();
        redirectTimer.current = window.setTimeout(() => { window.location.href = '/'; }, 2000);
      }
    } catch (err) {
      logAuthError('Password update failed:', err);
      setError(t('resetPassword.updateFailed', "Your password couldn't be updated. Please try again in a moment."));
      setLoading(false);
    }
  };

  // Still working out whether the link carried a usable session
  if (checking && !sessionReady) {
    return <AuthLoading label={t('resetPassword.verifying', 'Verifying your reset link...')} />;
  }

  // No session — the link was already used, has expired, or was opened after a
  // newer one replaced it (or the session behind it went stale). Let them fix it
  // here instead of sending them away.
  if (!sessionReady) {
    if (resent) {
      return (
        <AuthShell
          layout="centered"
          icon={<CheckCircle className="h-6 w-6" />}
          title={t('resetPassword.checkInboxTitle', 'Check your inbox')}
          lead={<span className="break-words">{t('resetPassword.newLinkSent', 'If {{email}} has an account, a new link is on its way. It works once, on any device. Nothing after a few minutes? Check your spam folder.', { email: resendEmail.trim().toLowerCase() })}</span>}
        >
          <Button variant="ctaOnDark" onClick={() => (window.location.href = '/')}>{t('common.goHome', 'Go to Homepage')}</Button>
        </AuthShell>
      );
    }
    return (
      <AuthShell
        title={sessionLost
          ? t('resetPassword.sessionExpiredTitle', 'Your reset session has expired')
          : t('resetPassword.linkInvalidTitle', "This link can't be used")}
        lead={sessionLost
          ? t('resetPassword.sessionExpiredDesc', "For your security, your password can no longer be changed from this session. Enter your e-mail address and we'll send you a fresh link.")
          : t('resetPassword.linkInvalidDesc', "Password links work once and expire. This one has already been used, has run out, or was replaced by a newer link. Enter your e-mail address and we'll send you a fresh one.")}
        points={false}
      >
        <form
          className="space-y-5"
          onSubmit={(e) => { e.preventDefault(); void requestNewLink(); }}
        >
          <div className="space-y-2">
            <AuthLabel htmlFor="resendEmail">{t('auth.email', 'E-mail')}</AuthLabel>
            <AuthInput
              id="resendEmail"
              type="email"
              autoComplete="email"
              value={resendEmail}
              onChange={(e) => setResendEmail(e.target.value)}
              placeholder={t('auth.emailPlaceholder', 'you@example.com')}
              required
              disabled={resendBusy}
              className={resendError ? AUTH_FIELD_ERROR : undefined}
            />
          </div>
          {resendError && (
            <FieldError>{resendError}</FieldError>
          )}
          <Button type="submit" variant="cta" className="w-full justify-between" disabled={resendBusy}>
            {resendBusy ? (
              <><Loader2 className="h-4 w-4 animate-spin" />{t('resetPassword.sending', 'Sending...')}</>
            ) : (
              t('auth.sendNewLink', 'Send me a new link')
            )}
          </Button>
          <div className="text-center">
            <UnderlineLink arrow={false} onClick={() => (window.location.href = '/')}>
              {t('common.goHome', 'Go to Homepage')}
            </UnderlineLink>
          </div>
        </form>
      </AuthShell>
    );
  }

  if (success) {
    return (
      <AuthShell
        layout="centered"
        icon={<CheckCircle className="h-6 w-6" />}
        title={t('resetPassword.successTitle', 'Password updated!')}
        lead={next
          ? t('resetPassword.takingYouBack', 'Taking you back...')
          : t('resetPassword.signInAgain', 'Sign in with your new password — redirecting...')}
      />
    );
  }

  return (
    <AuthShell title={t('resetPassword.title', 'Reset your password')} points={false}>
      <div className="space-y-5">
        {error && (
          <AuthNotice tone="error" role="alert">
            <p>{error}</p>
          </AuthNotice>
        )}
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <AuthLabel htmlFor="password">{t('resetPassword.newPassword', 'New password')}</AuthLabel>
            <PasswordInput
              id="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('auth.passwordPlaceholder', 'Min. 8 characters')}
              required
              disabled={loading}
            />
          </div>
          <div className="space-y-2">
            <AuthLabel htmlFor="confirmPassword">{t('auth.confirmPassword', 'Confirm Password')}</AuthLabel>
            <PasswordInput
              id="confirmPassword"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder={t('resetPassword.confirmPlaceholder', 'Confirm new password')}
              required
              disabled={loading}
            />
          </div>
          <Button type="submit" variant="cta" className="w-full justify-between" disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('resetPassword.updating', 'Updating...')}
              </>
            ) : (
              t('resetPassword.submit', 'Update password')
            )}
          </Button>
        </form>
      </div>
    </AuthShell>
  );
}
