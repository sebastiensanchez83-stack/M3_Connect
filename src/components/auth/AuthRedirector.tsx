import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'

// Known protected routes that require authentication
const protectedExactRoutes = new Set<string>([
  '/account', '/onboarding', '/submit-project', '/request-webinar',
  '/submit-rfp', '/submit-consultation',
])

const protectedPrefixes = ['/admin']

function isProtectedRoute(pathname: string): boolean {
  if (protectedExactRoutes.has(pathname)) return true
  if (pathname.startsWith('/account?')) return true
  return protectedPrefixes.some((prefix) => pathname.startsWith(prefix))
}

export function AuthRedirector() {
  const { user, loading, profile, profileTimedOut, isModerator } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()

  const isAdminRoute = pathname.startsWith('/admin')
  const isOnboardingRoute = pathname === '/onboarding'

  useEffect(() => {
    if (loading) return

    // Logged out: allow public routes only
    if (!user) {
      if (isProtectedRoute(pathname)) navigate('/', { replace: true })
      return
    }

    // Admin: only verified moderators
    if (isAdminRoute && !isModerator) {
      navigate('/account', { replace: true })
      return
    }

    // Logged in, no profile yet => onboarding (persona selection)
    // BUT: if the profile fetch timed out (Supabase cold start), don't redirect —
    // the user is authenticated; let them stay on the current page.
    if (!profile) {
      if (profileTimedOut) return // Cold start — don't redirect, profile will load eventually
      const isAccountRoute = pathname === '/account'
      if (!isOnboardingRoute && !isAccountRoute && isProtectedRoute(pathname)) {
        navigate('/onboarding', { replace: true })
      }
      return
    }

    // Phase 4 rules:
    // - draft => allow /account (user completes org info there), redirect other private pages
    // - rejected => allow /account + /onboarding (edit + resubmit)
    // - submitted/pending => allow /account (pending review screen)
    // - completed => allow /account (and block /onboarding)
    const isDraft = profile.onboarding_status === 'draft'
    const isRejected = profile.access_status === 'rejected'
    const isCompleted = profile.onboarding_status === 'completed'
    const isAccountRoute = pathname === '/account' || pathname.startsWith('/account?')

    if ((isDraft || isRejected) && !isOnboardingRoute && !isAccountRoute && isProtectedRoute(pathname)) {
      navigate('/account', { replace: true })
      return
    }

    if (isCompleted && isOnboardingRoute) {
      navigate('/account', { replace: true })
    }
  }, [user, loading, profile, profileTimedOut, pathname, navigate, isModerator, isAdminRoute, isOnboardingRoute])

  return null
}
