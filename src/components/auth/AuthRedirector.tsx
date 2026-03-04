import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'

export function AuthRedirector() {
  const { user, loading, profile, isModerator } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()

  const publicRoutes = new Set<string>(['/', '/reset-password'])

  const isAdminRoute = pathname.startsWith('/admin')
  const isOnboardingRoute = pathname === '/onboarding'

  useEffect(() => {
    if (loading) return

    // Logged out: allow public routes only
    if (!user) {
      if (!publicRoutes.has(pathname)) navigate('/', { replace: true })
      return
    }

    // Admin: only verified moderators
    if (isAdminRoute && !isModerator) {
      navigate('/account', { replace: true })
      return
    }

    // Logged in, no profile yet => onboarding (persona selection)
    if (!profile) {
      if (!isOnboardingRoute) navigate('/onboarding', { replace: true })
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

    if ((isDraft || isRejected) && !isOnboardingRoute) {
      navigate('/onboarding', { replace: true })
      return
    }

    if (isCompleted && isOnboardingRoute) {
      navigate('/account', { replace: true })
    }
  }, [user, loading, profile, pathname, navigate, isModerator, isAdminRoute, isOnboardingRoute])

  return null
}    if (!onboardingDone) {
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
