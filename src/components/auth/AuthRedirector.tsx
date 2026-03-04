import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'

/**
 * Global redirector:
 * - If logged in AND no profile row yet -> force /onboarding
 * - If logged in AND onboarding not completed -> keep /onboarding (optional)
 * - If logged out AND trying to access protected pages -> send to /auth
 *
 * Adjust protectedRoutes list if needed.
 */
export function AuthRedirector() {
  const { user, loading, profile, isModerator } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const path = location.pathname

  // Routes that should remain accessible without auth
  const publicRoutes = new Set<string>([
    '/',
    '/auth',
    '/reset-password',
  ])

  // Routes where we should NOT force onboarding redirect
  const allowOnboardingRoutes = new Set<string>([
    '/onboarding',
  ])

  // Admin route (only moderators)
  const isAdminRoute = path.startsWith('/admin')

  useEffect(() => {
    if (loading) return

    // 1) Not logged in: block protected routes (anything not in publicRoutes)
    if (!user) {
      if (!publicRoutes.has(path)) {
        navigate('/auth', { replace: true })
      }
      return
    }

    // 2) Logged in: block /admin if not moderator
    if (isAdminRoute && !isModerator) {
      navigate('/account', { replace: true })
      return
    }

    // 3) Logged in but profile not created yet -> force onboarding
    // This happens with your new flow: generic signup -> login -> onboarding creates profiles row
    if (!profile) {
      if (!allowOnboardingRoutes.has(path)) {
        navigate('/onboarding', { replace: true })
      }
      return
    }

    // 4) Optional: if profile exists but onboarding not completed -> keep them on onboarding
    // If you only want to force onboarding when profile is missing, comment this block out.
    const onboardingDone = profile.onboarding_status === 'completed'
    if (!onboardingDone) {
      if (!allowOnboardingRoutes.has(path)) {
        navigate('/onboarding', { replace: true })
      }
      return
    }

    // 5) If onboarding done, prevent them from staying on /onboarding
    if (onboardingDone && path === '/onboarding') {
      navigate('/account', { replace: true })
    }
  }, [user, loading, profile, path, navigate, isModerator, isAdminRoute])

  return null
}
