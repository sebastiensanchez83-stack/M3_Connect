import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { useRegistrationFlagsOnce } from '@/lib/flags';
import { ScreenLoader } from '@/components/LoadingSkeleton';
import { Button } from '@/components/ui/button';
import { SIGNUP_PATH } from '@/lib/authModal';
import { isV2Signup } from '@/lib/accountSignup';

/**
 * The registration switches could not be read (src/lib/flags.ts gives up after a few
 * seconds): with them unknown, "off" would be a guess (a 404, the form of before), so
 * the page says so and offers to try again. The row is also read again when the tab
 * regains focus, and the page then opens on its own.
 */
export function FlagsUnavailable({ retry }: { retry: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-[100svh] flex-col items-center justify-center gap-4 px-4 text-center">
      <p role="alert" className="max-w-sm text-sm leading-6 text-meta">
        {t('flags.pageFailed', 'This page could not be loaded. Check your connection and try again.')}
      </p>
      <Button type="button" variant="ctaOutline" arrow={false} roll={false} onClick={retry}>{t('reg.tryAgain', 'Try again')}</Button>
    </div>
  );
}

/**
 * The redirects of the front door (flag front_door; spec regspec-en.md §6
 * "Redirects", adjusted by Victor on 8 Oct 2026: /join stays the presentation page,
 * /become-partner already goes there). With the flag off each route renders
 * `fallback`, i.e. exactly what it rendered before. While the switches are being
 * read (one short request, cached) a loader holds the place; a failed read offers
 * to try again.
 */
export function FrontDoorOnly({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const { flags, known, failed, retry } = useRegistrationFlagsOnce();
  if (!known) return failed ? <FlagsUnavailable retry={retry} /> : <ScreenLoader />;
  return <>{flags.front_door ? children : fallback}</>;
}

/**
 * /onboarding: the redirect below with front_door on, and for a signed-in sign-up v2
 * account even while front_door is off (its company goes to M3 as a request; the old
 * wizard would make a company row with create_organization). Anyone else with the
 * flag off: the wizard of before (`legacy`). Decided on the switches as first read,
 * so a switch moved while the wizard is open does not take it away.
 */
export function OnboardingRoute({ legacy }: { legacy: ReactNode }) {
  const { flags, known, failed, retry } = useRegistrationFlagsOnce();
  const { profile } = useAuth();
  if (!known) return failed ? <FlagsUnavailable retry={retry} /> : <ScreenLoader />;
  if (flags.front_door || isV2Signup(profile)) return <OnboardingRedirect legacy={legacy} signupV2={flags.account_signup_v2} />;
  return <>{legacy}</>;
}

/**
 * /onboarding (the company wizard) with front_door on: no wizard any more.
 *  - ?code=<claim code> signed out: the sign-up page with the code (and ?email=);
 *  - ?code= signed in: "Add my company" on the dashboard, with the code;
 *  - anything else: the dashboard (signed out, its sign-in form first).
 * A claim code needs the sign-up v2 (account_signup_v2) to be read: without it the
 * code keeps going to the wizard of before (`legacy`).
 * The code travels on as ?claim=, never ?code=: supabase-js (PKCE, detectSessionInUrl)
 * reads ?code= as a sign-in code when the page loads, and a failed exchange (a stale
 * code verifier in this browser) would sign the person out.
 */
export function OnboardingRedirect({ legacy, signupV2 }: { legacy: ReactNode; signupV2: boolean }) {
  const { user, loading } = useAuth();
  const { search } = useLocation();
  if (loading) return <ScreenLoader />;
  const params = new URLSearchParams(search);
  const code = (params.get('code') || '').trim().slice(0, 40);
  if (code) {
    if (!signupV2) return <>{legacy}</>;
    if (user) return <Navigate to={`/?claim=${encodeURIComponent(code)}#dashboard`} replace />;
    const keep = new URLSearchParams({ claim: code });
    const email = params.get('email');
    if (email) keep.set('email', email);
    return <Navigate to={`${SIGNUP_PATH}?${keep.toString()}`} replace />;
  }
  return <Navigate to="/dashboard" replace />;
}
