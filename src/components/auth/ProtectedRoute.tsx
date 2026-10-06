import { ReactNode, useEffect, useRef } from 'react';
import { Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { useEntitlements } from '@/hooks/useEntitlements';
import { PersonaType } from '@/types/database';
import { RefreshCw, Lock } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { Card, CardContent } from '@/components/ui/card';
import { LoginForm } from '@/components/auth/LoginForm';
import { readAuthLanding, scrubAuthLandingUrl, type AuthLanding } from '@/components/auth/AuthRedirector';

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
  // A sign-in from the notice's form flips `loading` on; keep the form mounted
  // through it, or a failed attempt would come back as an empty form.
  const landingShown = useRef(false);

  if ((loading || (bypassEntitlement && entitlementsLoading)) && !(landing && landingShown.current)) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <RefreshCw className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Check auth
  if (requireAuth && !user) {
    if (landing) {
      landingShown.current = true;
      return <AuthLandingNotice landing={landing} />;
    }
    return showLocked ? <LockedState message={lockedMessage || 'Please log in to access this page.'} /> : <RedirectWithToast to={redirectTo} message="Please log in to access this page." />;
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
 * A sign-up confirmation link opened where it cannot sign in — another browser
 * or device (PKCE: no code verifier there), or expired / already used. Say what
 * happened and offer the login in place; once signed in, the page itself renders.
 */
function AuthLandingNotice({ landing }: { landing: AuthLanding }) {
  const { t } = useTranslation();
  useEffect(() => { scrubAuthLandingUrl(); }, []);
  return (
    <div className="flex items-center justify-center min-h-[60vh] px-4 py-8">
      <Card className="w-full max-w-md">
        <CardContent className="pt-6 space-y-4">
          <h1 className="text-xl font-semibold text-gray-900">{t('auth.login')}</h1>
          <LoginForm showConfirmedBanner={landing === 'confirmed'} linkError={landing === 'link-error'} />
        </CardContent>
      </Card>
    </div>
  );
}

function LockedState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-[60vh] text-center px-4">
      <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mb-4">
        <Lock className="h-8 w-8 text-gray-400" />
      </div>
      <h2 className="text-xl font-semibold text-gray-900 mb-2">Access Restricted</h2>
      <p className="text-gray-500 max-w-md">{message}</p>
    </div>
  );
}
