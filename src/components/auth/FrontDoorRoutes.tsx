import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useRegistrationFlags } from '@/lib/flags';
import { ScreenLoader } from '@/components/LoadingSkeleton';
import { SIGNUP_PATH } from '@/lib/authModal';

/**
 * The redirects of the front door (flag front_door; spec regspec-en.md §6
 * "Redirects", adjusted by Victor on 8 Oct 2026: /join stays the presentation page,
 * /become-partner already goes there). With the flag off each route renders
 * `fallback`, i.e. exactly what it rendered before. While the switches are being
 * read (one short request, cached) a loader holds the place.
 */
export function FrontDoorOnly({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const { flags, ready } = useRegistrationFlags();
  if (!ready) return <ScreenLoader />;
  return <>{flags.front_door ? children : fallback}</>;
}

/**
 * /onboarding (the company wizard) with front_door on: no wizard any more.
 *  - ?code=<claim code> signed out: the sign-up page with the code (and ?email=);
 *  - ?code= signed in: "Add my company" on the dashboard, with the code;
 *  - anything else: the dashboard (signed out, its sign-in form first).
 */
export function OnboardingRedirect() {
  const { user, loading } = useAuth();
  const { search } = useLocation();
  if (loading) return <ScreenLoader />;
  const params = new URLSearchParams(search);
  const code = (params.get('code') || '').trim();
  if (code) {
    if (user) return <Navigate to={`/?code=${encodeURIComponent(code)}#dashboard`} replace />;
    const keep = new URLSearchParams({ code });
    const email = params.get('email');
    if (email) keep.set('email', email);
    return <Navigate to={`${SIGNUP_PATH}?${keep.toString()}`} replace />;
  }
  return <Navigate to="/dashboard" replace />;
}
