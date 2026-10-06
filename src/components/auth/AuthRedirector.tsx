import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { getStoredInvite } from '@/lib/invite-store'
import { toast } from '@/hooks/use-toast'
// The i18next instance rather than useTranslation(): `t` would have to join the
// redirect effect's dependencies and re-run it on every language switch.
import i18n from '@/i18n'

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

// The SM26 on-site page (its URL is printed on the badges), the programme it
// links to, and the networking landing (printed on exhibitor tables). Public, so
// they stay reachable mid-onboarding — a redirect would drop the scanned ?c=.
// React Router matches case-insensitively and ignores a trailing slash; so do we.
const onsiteInfoPaths = new Set<string>(['/sm26', '/sm26/agenda', '/sm26/connect', '/sm26/vote', '/sm26/feedback'])
const isOnsiteInfoPage = (pathname: string) => onsiteInfoPaths.has(pathname.toLowerCase().replace(/\/+$/, ''))

export type AuthLanding = 'confirmed' | 'link-error'

/**
 * Arrival from a sign-up confirmation link — every one carries ?email_confirmed=true
 * (see AuthContext.signUp). Only meaningful while signed out: with PKCE the link
 * signs in only the browser that signed up, so opened on another device or
 * browser it confirms the address but leaves nobody logged in ('confirmed').
 * GoTrue reports a failed link (expired, already used) as error_code /
 * error_description in the query and/or the #hash ('link-error').
 */
export function readAuthLanding(): AuthLanding | null {
  const query = new URLSearchParams(window.location.search)
  if (query.get('email_confirmed') !== 'true') return null
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const failed = ['error_code', 'error_description'].some((k) => query.has(k) || hash.has(k))
  return failed ? 'link-error' : 'confirmed'
}

/**
 * Strip what such a landing left in the URL that no longer serves: an auth code
 * this browser cannot exchange (OnboardingPage and SignupForm would read ?code=
 * as a claim code), and tokens in the #hash (a re-sent link arrives
 * implicit-style, which the PKCE client refuses). Call only once auth has
 * settled signed out — supabase-js reads the URL at start-up.
 */
export function scrubAuthLandingUrl() {
  const url = new URL(window.location.href)
  const hash = new URLSearchParams(url.hash.replace(/^#/, ''))
  const hasTokens = hash.has('access_token') || hash.has('refresh_token')
  if (!url.searchParams.has('code') && !hasTokens) return
  url.searchParams.delete('code')
  if (hasTokens) url.hash = ''
  window.history.replaceState(window.history.state, '', url.toString())
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
        // A confirmation link that could not sign in here: ProtectedRoute explains
        // it and offers the login in place, rather than an unexplained bounce home.
        if (readAuthLanding()) return
        toast({ title: i18n.t('auth.loginRequired', 'Please log in to access this page.'), variant: 'destructive' })
        navigate('/', { replace: true })
      }
      // showLocked routes (/submit-project, /submit-rfp, etc.) are handled by ProtectedRoute
      return
    }

    // Event-provisioned accounts finish the welcome step (set password) first.
    // Exempt: the welcome page itself, claim links (auto-claim then hub),
    // password-recovery, and the on-site event info — everything else routes
    // to /welcome until done.
    if (
      user.user_metadata?.pw_pending === true &&
      pathname !== '/welcome' &&
      pathname !== '/sm26/claim' &&
      !isOnsiteInfoPage(pathname) &&
      !pathname.startsWith('/reset-password')
    ) {
      navigate('/welcome', { replace: true })
      return
    }

    // Admin: only verified moderators
    if (isAdminRoute && !isModerator) {
      toast({ title: i18n.t('auth.adminRequired', 'Admin access required.'), variant: 'destructive' })
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
