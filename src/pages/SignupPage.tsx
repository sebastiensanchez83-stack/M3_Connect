import { useEffect, useRef, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Navigate, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AuthLoading, AuthShell } from '@/components/auth/AuthShell';
import { AuthDialog } from '@/components/auth/AuthDialog';
import { AccountSignup } from '@/components/auth/AccountSignup';
import { LoginForm } from '@/components/auth/LoginForm';
import { SignupForm } from '@/components/auth/SignupForm';
import { UnderlineLink } from '@/components/brand/UnderlineLink';
import { useAuth } from '@/contexts/AuthContext';
import { useRegistrationFlags } from '@/lib/flags';
import { safeNext } from '@/lib/safeNext';
import { MEMBER_HOME } from '@/lib/signInDestination';
import { NotFoundPage } from '@/pages/NotFoundPage';

/**
 * /signup (flag front_door): the account sign-up as a full page, the same form as
 * the sign-up window that "Sign up" opens (Victor, 8 Oct 2026: no chooser page in
 * front of it). Deep links:
 *
 *   /signup?then=/register/<slug>     the event to continue to once the account exists
 *   /signup?email=…&code=…            a company claim e-mail (/?signup=true&… is sent here)
 *
 * One discreet line sends people who only want an event to /events. Signed in,
 * the page has nothing to do: the destination, else the dashboard (a claim code
 * goes to "Add my company" there). With front_door off the address is the 404 it
 * was before. With account_signup_v2 off the page shows the current form.
 */
export function SignupPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const { flags, ready } = useRegistrationFlags();
  const [params] = useState(() => new URLSearchParams(window.location.search));
  const then = safeNext(params.get('then'), { deny: ['/signup', '/welcome', '/reset-password', '/verify-email'] });
  const email = (params.get('email') || '').trim().slice(0, 254);
  // ?claim= (the front door's own redirects: a name supabase-js never reads as a sign-in
  // code) or the claim e-mail's ?code=.
  const code = (params.get('claim') || params.get('code') || '').trim().slice(0, 40);
  const [loginOpen, setLoginOpen] = useState(false);
  // Signed in when the page opened, not by the sign-up made here: with Confirm email off,
  // signUp signs the new account in at once, and its "Confirm your e-mail" step must stay
  // on screen until the person presses Continue.
  const arrivedSignedIn = useRef<boolean | null>(null);
  if (!loading && arrivedSignedIn.current === null) arrivedSignedIn.current = !!user;

  // The claim code leaves the address bar once the sign-up v2 holds it (a copied or shared
  // link must not carry it). The form of before reads it from the address itself: kept then.
  const showForm = ready && flags.front_door && flags.account_signup_v2 && !(user && arrivedSignedIn.current);
  useEffect(() => {
    if (!showForm || !code) return;
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('claim');
      url.searchParams.delete('code');
      window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    } catch { /* ignore */ }
  }, [showForm, code]);

  // The loader only while the page first opens: the account loading again after the
  // sign-up must not unmount the form (its "Confirm your e-mail" step would be lost).
  if (!ready || (loading && arrivedSignedIn.current === null)) return <AuthLoading className="min-h-[100svh]" />;
  if (!flags.front_door) return <NotFoundPage />;
  if (user && arrivedSignedIn.current) {
    // A claim code: "Add my company" on the dashboard (sign-up v2), else the wizard of before.
    if (code) return <Navigate to={flags.account_signup_v2 ? `/?claim=${encodeURIComponent(code)}#dashboard` : `/onboarding?code=${encodeURIComponent(code)}`} replace />;
    return <Navigate to={then ?? MEMBER_HOME} replace />;
  }

  const title = t('signupPage.title', 'Create your account');
  return (
    <>
      <Helmet>
        <title>{`${title} — Smart Marina Connect`}</title>
        <meta name="robots" content="noindex" />
      </Helmet>
      <AuthShell
        stickyActions={flags.account_signup_v2}
        title={title}
        lead={t('signupPage.lead', 'Free. Marinas, service providers, investors, developers and media meet here, and the M3 team checks every member.')}
      >
        {flags.account_signup_v2 ? (
          <AccountSignup
            variant="page"
            then={then}
            initialEmail={email}
            initialCode={code}
            onFinished={(dest) => navigate(dest, { replace: true })}
          />
        ) : (
          <SignupForm onSuccess={() => navigate('/onboarding')} />
        )}
        {!user && (
          <div className="mt-6 space-y-2 border-t border-rule pt-5 text-center text-sm leading-6 text-meta">
            <p>
              {t('auth.haveAccount', 'Already have an account?')}{' '}
              <UnderlineLink arrow={false} onClick={() => setLoginOpen(true)} className="min-h-11 !text-sm">{t('auth.login', 'Sign in')}</UnderlineLink>
            </p>
            <p>
              {t('signupPage.eventOnly', 'Only here for an event?')}{' '}
              <UnderlineLink to="/events" arrow={false} className="min-h-11 !text-sm">{t('signupPage.openEvents', 'See open events')}</UnderlineLink>
            </p>
          </div>
        )}
      </AuthShell>
      <AuthDialog mode="login" open={loginOpen} onOpenChange={setLoginOpen} sheet={flags.password_only_login}>
        <LoginForm
          next={then}
          defaultEmail={email || undefined}
          onSuccess={() => { setLoginOpen(false); navigate(then ?? MEMBER_HOME, { replace: true }); }}
        />
      </AuthDialog>
    </>
  );
}
