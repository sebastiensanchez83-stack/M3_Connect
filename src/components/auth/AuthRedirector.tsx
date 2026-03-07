import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'

// Exact public routes (no auth required)
const publicExactRoutes = new Set<string>([
  '/', '/reset-password', '/about', '/contact', '/privacy', '/terms',
  '/resources', '/events', '/partners', '/become-partner', '/marketplace',
])

// Public route prefixes (dynamic routes accessible without auth)
const publicPrefixes = [
  '/resources/', '/events/', '/organizations/',
]

function isPublicRoute(pathname: string): boolean {
  if (publicExactRoutes.has(pathname)) return true
  return publicPrefixes.some((prefix) => pathname.startsWith(prefix))
}

export function AuthRedirector() {
  const { user, loading, profile, isModerator } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()

  const isAdminRoute = pathname.startsWith('/admin')
  const isOnboardingRoute = pathname === '/onboarding'

  useEffect(() => {
    if (loading) return

    // Logged out: allow public routes only
    if (!user) {
      if (!isPublicRoute(pathname)) navigate('/', { replace: true })
      return
    }

    // Admin: only verified moderators
    if (isAdminRoute && !isModerator) {
      navigate('/account', { replace: true })
      return
    }

    // Logged in, no profile yet => onboarding (persona selection)
    // BUT: allow /account so the user can see a retry/loading state
    // when profile is null due to a fetch timeout (not a new user).
    if (!profile) {
      const isAccountRoute = pathname === '/account'
      if (!isOnboardingRoute && !isAccountRoute && !isPublicRoute(pathname)) {
        navigate('/onboarding', { replace: true })
      }
      return
    }

    // Phase 4 rules:
    // - draft => onboarding
    // - rejected => onboarding (edit + resubmit)
    // - submitted/pending => allow /account (pending review screen)
    // - completed => allow /account (and block /onboarding)
    const isDraft = profile.onboarding_status === 'draft'
    const isRejected = profile.access_status === 'rejected'
    const isCompleted = profile.onboarding_status === 'completed'

    if ((isDraft || isRejected) && !isOnboardingRoute && !isPublicRoute(pathname)) {
      navigate('/onboarding', { replace: true })
      return
    }

    if (isCompleted && isOnboardingRoute) {
      navigate('/account', { replace: true })
    }
  }, [user, loading, profile, pathname, navigate, isModerator, isAdminRoute, isOnboardingRoute])

  return null
}
