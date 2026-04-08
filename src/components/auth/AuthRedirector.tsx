import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { getStoredInvite } from '@/lib/invite-store'
import { toast } from '@/hooks/use-toast'

// Routes that should hard-redirect when logged out (no showLocked behavior)
const hardRedirectExactRoutes = new Set<string>([
  '/account', '/onboarding',
])

const hardRedirectPrefixes = ['/admin']

// Routes with showLocked — ProtectedRoute handles these, not AuthRedirector
const showLockedPrefixes = ['/submit-project', '/submit-rfp', '/submit-consultation', '/request-webinar']

function isHardRedirectRoute(pathname: string): boolean {
  if (hardRedirectExactRoutes.has(pathname)) return true
  if (pathname.startsWith('/account?')) return true
  return hardRedirectPrefixes.some((prefix) => pathname.startsWith(prefix))
}

function isProtectedRoute(pathname: string): boolean {
  if (isHardRedirectRoute(pathname)) return true
  return showLockedPrefixes.some((prefix) => pathname.startsWith(prefix))
}

export function AuthRedirector() {
  const { user, loading, profile, profileTimedOut, isModerator } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()

  const isAdminRoute = pathname.startsWith('/admin')
  const isOnboardingRoute = pathname === '/onboarding'
  const isJoinRoute = pathname.startsWith('/join/')

  useEffect(() => {
    if (loading) return

    // Never interfere with the /join/:inviteId page — it handles its own auth flow
    if (isJoinRoute) return

    // Logged out: hard-redirect protected routes (but let showLocked routes render their own locked state)
    if (!user) {
      if (isHardRedirectRoute(pathname)) {
        toast({ title: 'Please log in to access this page.', variant: 'destructive' })
        navigate('/', { replace: true })
      }
      // showLocked routes (/submit-project, /submit-rfp, etc.) are handled by ProtectedRoute
      return
    }

    // Admin: only verified moderators
    if (isAdminRoute && !isModerator) {
      toast({ title: 'Admin access required.', variant: 'destructive' })
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

    // If user has a pending invite token, send them to /join/:id page
    const pendingInviteId = getStoredInvite()

    const isDraft = profile.onboarding_status === 'draft'
    const isRejected = profile.access_status === 'rejected'
    const isCompleted = profile.onboarding_status === 'completed'
    const isAccountRoute = pathname === '/account' || pathname.startsWith('/account?')

    // Pending invite → route to the join page (handles accept flow)
    if (pendingInviteId && !isOnboardingRoute && !isJoinRoute) {
      navigate(`/join/${pendingInviteId}`, { replace: true })
      return
    }

    if ((isDraft || isRejected) && !isOnboardingRoute && !isAccountRoute && isProtectedRoute(pathname)) {
      navigate('/account', { replace: true })
      return
    }

    if (isCompleted && isOnboardingRoute && !pendingInviteId) {
      navigate('/account', { replace: true })
    }
  }, [user, loading, profile, profileTimedOut, pathname, navigate, isModerator, isAdminRoute, isOnboardingRoute])

  return null
}
