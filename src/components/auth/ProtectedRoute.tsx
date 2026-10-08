import { ReactNode, useEffect, useRef } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { useEntitlements } from '@/hooks/useEntitlements';
import { PersonaType } from '@/types/database';
import { Lock } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { LoginForm } from '@/components/auth/LoginForm';
import { UnderlineLink } from '@/components/brand/UnderlineLink';
import { signInDestination } from '@/lib/signInDestination';
import { registerFlowsStrings } from '@/i18n/refonte-flows';
import { AuthLoading, AuthShell } from '@/components/auth/AuthShell';
import { readAuthLanding, scrubAuthLandingUrl, type AuthLanding } from '@/components/auth/AuthRedirector';

registerFlowsStrings();

/** Show a toast once per redirect reason */
function RedirectWithToast({ to, message }: { to: string; message: string }) {
  const shown = useRef(false);
  useEffect(() => {
    if (!shown.current) {
      shown.current = true;
      toast({ title: message, variant: 'destructive' });
    }
  }, [message]);
  return <Navigate to={to} replace />;
}

interface ProtectedRouteProps {
  children: ReactNode;
  /** Require authenticated user */
  requireAuth?: boolean;
  /** Require verified access_status */
  requireVerified?: boolean;
  /** Require specific persona(s) */
  requirePersona?: PersonaType[];
  /** Require admin persona */
  requireAdmin?: boolean;
  /** Require moderator or admin (isModerator) */
  requireModerator?: boolean;
  /** Redirect path when access denied (default: '/') */
  redirectTo?: string;
  /** Show a locked message instead of redirecting */
  showLocked?: boolean;
  /** Custom locked message */
  lockedMessage?: string;
  /**
   * Feature entitlement key that bypasses the persona check.
   * If the user's organization has this entitlement enabled (granted by an admin
   * via the entitlements table), they can access the route even if their persona
   * isn't in `requirePersona`. Admin & moderator users are always bypassed.
   */
  bypassEntitlement?: string;
}

export function ProtectedRoute({
  children,
  requireAuth = true,
  requireVerified = false,
  requirePersona,
  requireAdmin = false,
  requireModerator = false,
  redirectTo = '/',
  showLocked = false,
  lockedMessage,
  bypassEntitlement,
}: ProtectedRouteProps) {
  const { user, loading, profile, isVerified, isAdmin, isModerator } = useAuth();
  const { isFeatureEnabled, isLoading: entitlementsLoading } = useEntitlements();

  // Signed out, back from a confirmation link that could not sign in here.
  const landing = user ? null : readAuthLanding();
  // A sign-in from the in-place form flips `loading` on; keep the form mounted
  // through it, or a failed attempt would come back as an empty form.
  const formShown = useRef(false);

  // Full-screen height, not the 60vh default: the sign-in hero that replaces this (or the page itself) is taller,
  // and a shorter loader would push the footer down when it arrives (CLS).
  if ((loading || (bypassEntitlement && entitlementsLoading)) && !(formShown.current && !user)) {
    return <AuthLoading className="min-h-[100svh]" />;
  }

  // Check auth. A visitor who follows a link to a members' page (an e-mail
  // button, a bookmark) is not thrown to the home page with a red toast: the
  // sign-in form stands where the page would be, and the page itself appears
  // as soon as the session exists. `showLocked` pages do the same: signing in
  // is the way forward, whatever they say to someone who is signed in.
  if (requireAuth && !user) {
    formShown.current = true;
    return <SignInInPlace landing={landing} />;
  }

  // Check verified
  if (requireVerified && !isVerified) {
    return showLocked ? <LockedState message={lockedMessage || 'Your account must be verified to access this feature.'} /> : <RedirectWithToast to="/account" message="Your account must be verified to access this feature." />;
  }

  // Check persona (with admin/moderator & entitlement bypass)
  if (requirePersona && profile && !requirePersona.includes(profile.persona)) {
    const hasEntitlementBypass = bypassEntitlement ? isFeatureEnabled(bypassEntitlement) : false;
    const canBypass = isAdmin || isModerator || hasEntitlementBypass;
    if (!canBypass) {
      return showLocked ? <LockedState message={lockedMessage || 'This feature is not available for your account type.'} /> : <RedirectWithToast to={redirectTo} message="This feature is not available for your account type." />;
    }
  }

  // Check admin
  if (requireAdmin && !isAdmin) {
    return showLocked ? <LockedState message={lockedMessage || 'Admin access required.'} /> : <RedirectWithToast to={redirectTo} message="Admin access required." />;
  }

  // Check moderator
  if (requireModerator && !isModerator) {
    return showLocked ? <LockedState message={lockedMessage || 'Access denied.'} /> : <RedirectWithToast to={redirectTo} message="Access denied." />;
  }

  return <>{children}</>;
}

/**
 * The sign-in form in place of a members' page, for a visitor who is signed out:
 * the page they asked for (kept in `?next=` of the e-mailed links, see
 * signInDestination) shows as soon as they are in.
 *
 * Also what a sign-up confirmation link opened where it cannot sign in shows —
 * another browser or device (PKCE: no code verifier there), or expired / already
 * used: it says what happened and offers the login in place.
 */
function SignInInPlace({ landing }: { landing: AuthLanding | null }) {
  const { t } = useTranslation();
  useEffect(() => { scrubAuthLandingUrl(); }, []);
  return (
    <AuthShell title={t('auth.login')} lead={landing ? undefined : t('flows.signIn.lead')}>
      <LoginForm
        showConfirmedBanner={landing === 'confirmed'}
        linkError={landing === 'link-error'}
        next={signInDestination()}
      />
      <p className="mt-6 text-center text-sm text-meta">
        {t('flows.signIn.noAccount')}{' '}
        <UnderlineLink to="/become-partner" arrow={false}>{t('nav.becomePartner', 'Join the network')}</UnderlineLink>
      </p>
    </AuthShell>
  );
}

function LockedState({ message }: { message: string }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  // A signed-in member who lands here is usually waiting for a review: the dashboard is the page that says where it
  // stands, and the home page (which sent many of them here) would only loop. Visitors go back to the home page.
  return (
    <AuthShell layout="centered" icon={<Lock className="h-6 w-6" />} title={t('authRefonte.gate.title', 'Access restricted')} lead={message}>
      <Button asChild variant="ctaOnDark">
        {user
          ? <Link to="/#dashboard">{t('authRefonte.gate.dashboard', 'Back to the dashboard')}</Link>
          : <Link to="/">{t('common.goHome', 'Go to Homepage')}</Link>}
      </Button>
    </AuthShell>
  );
}
