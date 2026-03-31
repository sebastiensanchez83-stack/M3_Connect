import { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { PersonaType } from '@/types/database';
import { RefreshCw, Lock } from 'lucide-react';

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
}: ProtectedRouteProps) {
  const { user, loading, profile, isVerified, isAdmin, isModerator } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <RefreshCw className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Check auth
  if (requireAuth && !user) {
    return showLocked ? <LockedState message={lockedMessage || 'Please log in to access this page.'} /> : <Navigate to={redirectTo} replace />;
  }

  // Check verified
  if (requireVerified && !isVerified) {
    return showLocked ? <LockedState message={lockedMessage || 'Your account must be verified to access this feature.'} /> : <Navigate to="/account" replace />;
  }

  // Check persona
  if (requirePersona && profile && !requirePersona.includes(profile.persona)) {
    return showLocked ? <LockedState message={lockedMessage || 'This feature is not available for your account type.'} /> : <Navigate to={redirectTo} replace />;
  }

  // Check admin
  if (requireAdmin && !isAdmin) {
    return showLocked ? <LockedState message={lockedMessage || 'Admin access required.'} /> : <Navigate to={redirectTo} replace />;
  }

  // Check moderator
  if (requireModerator && !isModerator) {
    return showLocked ? <LockedState message={lockedMessage || 'Access denied.'} /> : <Navigate to={redirectTo} replace />;
  }

  return <>{children}</>;
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
