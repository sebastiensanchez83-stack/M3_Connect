import { useState } from 'react';
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
  const code = (params.get('code') || '').trim().slice(0, 40);
  const [loginOpen, setLoginOpen] = useState(false);

  if (!ready || loading) return <AuthLoading className="min-h-[100svh]" />;
  if (!flags.front_door) return <NotFoundPage />;
  if (user) {
    if (code) return <Navigate to={`/?code=${encodeURIComponent(code)}#dashboard`} replace />;
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
