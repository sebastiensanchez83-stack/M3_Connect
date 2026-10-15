import { useEffect, useRef, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle2, KeyRound, Loader2, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AuthLoading, AuthShell, AuthStatus } from '@/components/auth/AuthShell';
import { AuthNotice, CTA_WRAP } from '@/components/auth/fields';
import { LoginForm } from '@/components/auth/LoginForm';
import { useAuth } from '@/contexts/AuthContext';
import { confirmEmailProof, sendEmailProof, sendSignupNotices } from '@/lib/accountSignup';
import { useRegistrationFlagsOnce } from '@/lib/flags';
import { FlagsUnavailable } from '@/components/auth/FrontDoorRoutes';
import { MEMBER_HOME } from '@/lib/signInDestination';
import { cn } from '@/lib/utils';
import { NotFoundPage } from '@/pages/NotFoundPage';

/**
 * /verify-email?t=<token>: the link of the "Confirm your e-mail address" banner
 * (account-signup send_email_proof). Signed in on the account it was sent for, the
 * page calls confirm_email_proof: the address counts as proven, the registrations
 * made with it join the account, and the sign-up's company request goes to M3.
 *
 * It never signs anyone in: holding the link AND the account's password is the
 * proof. Signed out, the sign-in form stands in place, then the link is used.
 * The token leaves the address bar at once (kept in memory only).
 *
 * confirm_email_proof wants a session opened with the account's PASSWORD (a link
 * session proves the inbox, not that the password is the person's): with another
 * session it answers password_session_required, and the page asks the person to
 * sign in again with the password, then uses the same link.
 *
 * With flags front_door and account_signup_v2 both off the address is the 404 it was
 * before, token or not: nothing new runs with every flag off. Switches that could not
 * be read are not taken for "off": the page offers to try again (the token stays in
 * the address until the page opens).
 */

type Phase = 'idle' | 'checking' | 'done' | 'failed';

export function VerifyEmailPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, profile, loading, refreshProfile, signOut } = useAuth();
  const { flags, known: ready, failed: flagsFailed, retry: retryFlags } = useRegistrationFlagsOnce();
  const [token] = useState(() => {
    try { return new URLSearchParams(window.location.search).get('t') || ''; } catch { return ''; }
  });
  const [phase, setPhase] = useState<Phase>('idle');
  const [reason, setReason] = useState<string | null>(null);
  const [newLink, setNewLink] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const tried = useRef<string | null>(null);
  const enabled = ready && (flags.front_door || flags.account_signup_v2);

  // The token is a one-time secret: out of the address bar (and of any copied link) at once.
  useEffect(() => {
    if (!token || !enabled) return;
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('t');
      window.history.replaceState(window.history.state, '', url.pathname + (url.search || ''));
    } catch { /* ignore */ }
  }, [token, enabled]);

  // Signed out (e.g. to sign in again with the password): the link is tried again afterwards.
  useEffect(() => {
    if (!loading && !user) tried.current = null;
  }, [loading, user]);

  useEffect(() => {
    if (!token || !enabled || loading || !user || tried.current === user.id) return;
    tried.current = user.id;
    setPhase('checking');
    void (async () => {
      const res = await confirmEmailProof(token);
      if (res.ok && res.proven) {
        // The sign-up's e-mails (under review; the owner's join request), once, now.
        void sendSignupNotices(res.signup);
        await refreshProfile().catch(() => {});
        setPhase('done');
        return;
      }
      setReason(res.ok ? res.reason ?? 'invalid_token' : res.error);
      setPhase('failed');
    })();
  }, [token, enabled, loading, user, refreshProfile]);

  const askNewLink = async () => {
    setNewLink('sending');
    const res = await sendEmailProof();
    if (res.ok && res.already_proven) {
      await refreshProfile().catch(() => {});
      setPhase('done');
      return;
    }
    setNewLink(res.ok ? 'sent' : 'error');
  };

  const signInAgain = async () => {
    setPhase('idle');
    setReason(null);
    await signOut().catch(() => {});
  };

  if (!ready && flagsFailed) return <FlagsUnavailable retry={retryFlags} />;
  if (!ready || loading) return <AuthLoading />;
  if (!enabled) return <NotFoundPage />;

  const title = phase === 'done' ? t('verifyEmail.titleDone', 'E-mail address confirmed') : t('verifyEmail.title', 'Confirm your e-mail address');
  const head = <Helmet><title>{`${title} — Smart Marina Connect`}</title><meta name="referrer" content="no-referrer" /></Helmet>;

  if (!token) {
    return (
      <>
        {head}
        <AuthShell title={title} lead={null} points={false}>
          <AuthStatus icon={<Mail className="h-6 w-6" />} title={t('verifyEmail.noLinkTitle', 'Open the link from the e-mail')}>
            <p className="text-sm leading-6 text-meta">{t('verifyEmail.noLink', 'This page works with the link in the e-mail we sent you. Ask for a new one from your dashboard.')}</p>
            <Button variant="cta" className="w-full justify-between" onClick={() => navigate(MEMBER_HOME)}>{t('memberHome.backToDashboard', 'My dashboard')}</Button>
          </AuthStatus>
        </AuthShell>
      </>
    );
  }

  // Signed out: sign in first (the proof needs the account's password), then the link is used.
  if (!user) {
    return (
      <>
        {head}
        <AuthShell title={title} lead={t('verifyEmail.signInLead', 'Sign in to the account this link was sent for: your address is then confirmed.')} points={false}>
          <LoginForm />
        </AuthShell>
      </>
    );
  }

  if (phase === 'done') {
    // The review line only for an account M3 still has to review.
    const underReview = profile?.access_status === 'pending';
    return (
      <>
        {head}
        <AuthShell title={title} lead={null} points={false}>
          <AuthStatus icon={<CheckCircle2 className="h-6 w-6" />} title={t('verifyEmail.doneTitle', 'Your e-mail address is confirmed')}>
            <p className="text-sm leading-6 text-meta">
              {underReview
                ? t('verifyEmail.done', 'Thank you. The registrations made with this address are now in your account, and the M3 team can review your sign-up.')
                : t('verifyEmail.doneMember', 'Thank you. The registrations made with this address are now in your account.')}
            </p>
            <Button variant="cta" className={cn('w-full justify-between', CTA_WRAP)} roll={false} onClick={() => navigate(MEMBER_HOME, { replace: true })} data-help-avoid>
              {t('verifyEmail.continue', 'Go to my dashboard')}
            </Button>
          </AuthStatus>
        </AuthShell>
      </>
    );
  }

  if (phase === 'failed' && reason === 'password_session_required') {
    return (
      <>
        {head}
        <AuthShell title={title} lead={null} points={false}>
          <AuthStatus icon={<KeyRound className="h-6 w-6" />} title={t('verifyEmail.passwordTitle', 'Sign in with your password')}>
            <p className="text-sm leading-6 text-meta">
              {t('verifyEmail.passwordBody', 'For your security, this link works once you are signed in with your password. Sign in again: this page then confirms your address. Forgot your password? The sign-in form sends you a link to choose one.')}
            </p>
            <Button type="button" variant="cta" roll={false} className={cn('w-full justify-between', CTA_WRAP)} onClick={() => void signInAgain()} data-help-avoid>
              {t('verifyEmail.signInAgain', 'Sign in again')}
            </Button>
          </AuthStatus>
        </AuthShell>
      </>
    );
  }

  if (phase === 'failed') {
    const wrongAccount = reason === 'wrong_account';
    const message = wrongAccount
      ? t('verifyEmail.wrongAccount', { email: user.email ?? '', defaultValue: 'This link was sent for another account. You are signed in as {{email}}: sign out, then open the link again and sign in with the account it was sent to.' })
      : reason === 'impersonation'
        ? t('verifyEmail.impersonation', 'This session is a "view as user" session: nothing was confirmed.')
        : reason === 'network' || reason === 'server' || reason === 'unavailable' || reason === 'session_expired'
          ? t('verifyEmail.server', "We couldn't confirm your address just now. Please open the link again in a moment.")
          : t('verifyEmail.dead', 'This link no longer works: it was already used, it has expired, or your address changed since. Ask for a new one.');
    return (
      <>
        {head}
        <AuthShell title={title} lead={null} points={false}>
          <AuthStatus tone="warning" icon={<AlertTriangle className="h-6 w-6" />} title={t('verifyEmail.failedTitle', "This link can't be used")}>
            <p className="text-sm leading-6 text-meta">{message}</p>
            {!wrongAccount && reason !== 'impersonation' && (
              newLink === 'sent' ? (
                <AuthNotice tone="success" role="status">
                  <p className="break-words">{t('verifyEmail.newSent', { email: user.email ?? '', defaultValue: 'A new link is on its way to {{email}}.' })}</p>
                </AuthNotice>
              ) : (
                <div className="space-y-2">
                  <Button type="button" variant="cta" roll={false} className={cn('w-full justify-between', CTA_WRAP)} disabled={newLink === 'sending'} onClick={() => void askNewLink()} data-help-avoid>
                    {newLink === 'sending' && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                    {t('verifyEmail.newLink', 'Send me a new link')}
                  </Button>
                  {newLink === 'error' && <p role="alert" className="text-sm text-red-700">{t('verifyEmail.newError', "We couldn't send the link just now. Please wait a minute and try again.")}</p>}
                </div>
              )
            )}
            <Button variant="ctaOutline" arrow={false} roll={false} className="w-full" onClick={() => navigate(MEMBER_HOME)}>
              {t('memberHome.backToDashboard', 'My dashboard')}
            </Button>
          </AuthStatus>
        </AuthShell>
      </>
    );
  }

  return <AuthLoading label={t('verifyEmail.checking', 'Confirming your address…')} />;
}
