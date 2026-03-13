import { createContext, useContext, useEffect, useState, useCallback, useRef, ReactNode } from 'react'
import { User, Session, AuthChangeEvent } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { Profile, MarinaProfile, PartnerProfile, MediaPartnerProfile, UserDetails, Organization, OrgMemberRole, SPONSOR_TIERS } from '@/types/database'

interface AuthContextType {
  user: User | null
  session: Session | null
  loading: boolean
  profile: Profile | null
  userDetails: UserDetails | null
  organization: Organization | null
  orgRole: OrgMemberRole | null
  hasOrganization: boolean
  isVerified: boolean
  isModerator: boolean
  isSponsor: boolean
  signUp: (email: string, password: string, persona?: string, firstName?: string, lastName?: string, companyName?: string, companyWebsite?: string, detectedOrgId?: string, jobTitle?: string) => Promise<{ error: Error | null }>
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

const isResetPasswordPage = () => window.location.pathname === '/reset-password'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [userDetails, setUserDetails] = useState<UserDetails | null>(null)
  const [organization, setOrganization] = useState<Organization | null>(null)
  const [orgRole, setOrgRole] = useState<OrgMemberRole | null>(null)
  const [loading, setLoading] = useState(true)

  // Ref to track mount status across async operations
  const mountedRef = useRef(true)

  const isVerified = profile?.access_status === 'verified'
  const isModerator = (profile?.persona === 'moderator' || profile?.persona === 'admin') && isVerified
  const hasOrganization = organization !== null
  const isSponsor = hasOrganization && SPONSOR_TIERS.includes(organization!.tier)

  const fetchUserData = useCallback(async (userId: string) => {
    // Step 1: Fetch profile first (needed to determine persona detail table)
    const { data: profileData, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle()

    if (error || !profileData) return { profile: null as Profile | null, details: null as UserDetails | null, org: null as Organization | null, role: null as OrgMemberRole | null }

    const p = profileData as Profile

    // Step 2: Fetch persona details + org membership IN PARALLEL (they're independent)
    const detailsPromise = (async (): Promise<UserDetails | null> => {
      if (p.persona === 'marina') {
        const { data } = await supabase.from('marina_profiles').select('*').eq('user_id', userId).maybeSingle()
        return (data as MarinaProfile) ?? null
      } else if (p.persona === 'partner') {
        const { data } = await supabase.from('partner_profiles').select('*').eq('user_id', userId).maybeSingle()
        return (data as PartnerProfile) ?? null
      } else if (p.persona === 'media_partner') {
        const { data } = await supabase.from('media_partner_profiles').select('*').eq('user_id', userId).maybeSingle()
        return (data as MediaPartnerProfile) ?? null
      }
      return null
    })()

    const membershipPromise = supabase
      .from('organization_members')
      .select('organization_id, role')
      .eq('user_id', userId)
      .maybeSingle()

    const [details, { data: membership }] = await Promise.all([detailsPromise, membershipPromise])

    // Step 3: If membership found, fetch org data
    let org: Organization | null = null
    let role: OrgMemberRole | null = null
    if (membership) {
      const { data: orgData } = await supabase
        .from('organizations')
        .select('*')
        .eq('id', membership.organization_id)
        .single()
      org = (orgData as Organization) ?? null
      role = membership.role as OrgMemberRole
    }

    return { profile: p, details, org, role }
  }, [])

  const refreshProfile = useCallback(async () => {
    if (!user) return
    const { profile: p, details, org, role } = await fetchUserData(user.id)
    setProfile(p)
    setUserDetails(details)
    setOrganization(org)
    setOrgRole(role)
  }, [user, fetchUserData])

  // Track whether initial session has been handled to differentiate
  // a fresh sign-in from Supabase re-firing SIGNED_IN on tab focus
  const initializedRef = useRef(false)
  // Track current user ID to detect genuine user changes
  const currentUserIdRef = useRef<string | null>(null)

  // ─── Core auth effect ───────────────────────────────────────────────
  // Uses ONLY onAuthStateChange as the single source of truth.
  //
  // Key insight: Supabase fires SIGNED_IN not only after signIn() but
  // also when the tab regains focus and the token is auto-refreshed.
  // We must NOT set loading=true on these "background" re-fires or the
  // user sees a loading flash / redirect every time they switch tabs.
  //
  // Strategy:
  //   - Track whether we've initialized (initializedRef)
  //   - On SIGNED_IN: only set loading=true if it's a NEW user (fresh login)
  //   - On TOKEN_REFRESHED: silently update session, no loading change
  //   - On visibilitychange: proactively tell Supabase to refresh
  // ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (isResetPasswordPage()) {
      setLoading(false)
      return
    }

    mountedRef.current = true
    initializedRef.current = false

    // Safety timeout: if loading doesn't resolve in 12s, force it false.
    // (Allows for 2 fetch attempts × 5s each + buffer)
    const safetyTimer = setTimeout(() => {
      if (mountedRef.current) {
        setLoading((prev) => {
          if (prev) {
            console.warn('[AuthContext] Safety timeout — forcing loading to false after 12s')
            return false
          }
          return prev
        })
      }
    }, 12000)

    /**
     * Handles a session: sets user/session, fetches profile, then sets loading=false.
     * If session is null/expired, clears everything.
     */
    const handleSession = async (sess: Session | null, shouldSetLoading: boolean) => {
      if (!mountedRef.current) return

      if (!sess?.user) {
        setUser(null)
        setSession(null)
        setProfile(null)
        setUserDetails(null)
        setOrganization(null)
        setOrgRole(null)
        currentUserIdRef.current = null
        if (shouldSetLoading) setLoading(false)
        return
      }

      // Set user + session FIRST so components know auth exists
      setSession(sess)
      setUser(sess.user)
      currentUserIdRef.current = sess.user.id

      // Fetch profile with timeout protection + retry
      const attemptFetch = async (timeoutMs: number) => {
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Profile fetch timeout')), timeoutMs)
        )
        return Promise.race([fetchUserData(sess.user.id), timeoutPromise])
      }

      try {
        let result: Awaited<ReturnType<typeof fetchUserData>>
        try {
          result = await attemptFetch(5000)
        } catch (firstErr) {
          console.warn('[AuthContext] First profile fetch attempt failed, retrying...', firstErr)
          if (!mountedRef.current) return
          result = await attemptFetch(5000)
        }
        if (!mountedRef.current) return
        setProfile(result.profile)
        setUserDetails(result.details)
        setOrganization(result.org)
        setOrgRole(result.role)
      } catch (err) {
        console.warn('[AuthContext] Profile fetch failed after retry:', err)
        if (!mountedRef.current) return
        // User/session are valid, just no profile data
        setProfile(null)
        setUserDetails(null)
        setOrganization(null)
        setOrgRole(null)
      }

      if (shouldSetLoading) setLoading(false)
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event: AuthChangeEvent, newSession) => {
        if (!mountedRef.current) return

        // ── INITIAL_SESSION ──────────────────────────────────────
        // First event on page load. Replaces the old init()/getSession().
        if (event === 'INITIAL_SESSION') {
          initializedRef.current = true
          await handleSession(newSession, true)
          return
        }

        // ── SIGNED_IN ────────────────────────────────────────────
        // Fires after signIn() BUT ALSO when Supabase auto-refreshes
        // the token on tab focus. We must distinguish the two:
        //  - Fresh login (new user) → set loading=true, fetch profile
        //  - Same user re-fire → silently update session, no loading
        if (event === 'SIGNED_IN') {
          const isSameUser = newSession?.user?.id === currentUserIdRef.current
          const isRefire = initializedRef.current && isSameUser

          if (isRefire) {
            // Same user, just token refresh disguised as SIGNED_IN.
            // Silently update session without loading flash.
            if (newSession?.user) {
              setSession(newSession)
              setUser(newSession.user)
            }
            return
          }

          // Genuine new sign-in: set loading=true so pages wait
          initializedRef.current = true
          setLoading(true)
          await handleSession(newSession, true)
          return
        }

        // ── SIGNED_OUT ───────────────────────────────────────────
        if (event === 'SIGNED_OUT') {
          setUser(null)
          setSession(null)
          setProfile(null)
          setUserDetails(null)
          setOrganization(null)
          setOrgRole(null)
          currentUserIdRef.current = null
          setLoading(false)
          return
        }

        // ── TOKEN_REFRESHED ──────────────────────────────────────
        // Session token was refreshed. Update session/user silently.
        // If we have no profile yet (e.g. interrupted load), fetch it.
        if (event === 'TOKEN_REFRESHED') {
          if (newSession?.user) {
            setSession(newSession)
            setUser(newSession.user)
            currentUserIdRef.current = newSession.user.id
          } else {
            // Token refresh returned no session — session is truly expired
            console.warn('[AuthContext] Token refresh failed — clearing session')
            setUser(null)
            setSession(null)
            setProfile(null)
            setUserDetails(null)
            currentUserIdRef.current = null
            setLoading(false)
          }
          return
        }

        // ── PASSWORD_RECOVERY / USER_UPDATED / other events ──────
        if (newSession?.user) {
          setSession(newSession)
          setUser(newSession.user)
        }
      }
    )

    // ── Visibility change handler ──────────────────────────────────
    // When the user returns to this tab, proactively tell Supabase to
    // check the session. This ensures the access token is refreshed
    // before it expires, rather than discovering it's expired lazily.
    // Supabase's getSession() will auto-refresh if needed, triggering
    // TOKEN_REFRESHED which we handle silently above.
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && currentUserIdRef.current) {
        // getSession() triggers auto-refresh if the access token is close
        // to expiry. This fires TOKEN_REFRESHED which we handle above.
        supabase.auth.getSession().catch((err) => {
          console.warn('[AuthContext] Visibility session check failed:', err)
        })
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      mountedRef.current = false
      initializedRef.current = false
      clearTimeout(safetyTimer)
      subscription.unsubscribe()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [fetchUserData])

  // ─── signUp ─────────────────────────────────────────────────────────
  const signUp = async (email: string, password: string, persona?: string, firstName?: string, lastName?: string, companyName?: string, companyWebsite?: string, detectedOrgId?: string, jobTitle?: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/account`,
        data: {
          persona: persona || 'individual',
          first_name: firstName || '',
          last_name: lastName || '',
          company_name: companyName || '',
          company_website: companyWebsite || '',
          detected_org_id: detectedOrgId || '',
          job_title: jobTitle || '',
        },
      },
    })
    return { error: error ?? null }
  }

  // ─── signIn ─────────────────────────────────────────────────────────
  // Sets loading=true SYNCHRONOUSLY before the API call. This ensures
  // that if the calling component navigates after signIn returns,
  // every page sees authLoading=true and waits for profile to load.
  const signIn = async (email: string, password: string) => {
    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      // Sign-in failed — restore loading to false
      setLoading(false)
    }
    // On success, loading stays true until onAuthStateChange SIGNED_IN handler
    // fetches the profile and sets loading=false
    return { error: error ?? null }
  }

  // ─── signOut ────────────────────────────────────────────────────────
  const signOut = async () => {
    // Clear state immediately so UI updates instantly
    setUser(null)
    setSession(null)
    setProfile(null)
    setUserDetails(null)
    setOrganization(null)
    setOrgRole(null)
    try {
      await supabase.auth.signOut()
    } catch (e) {
      // If signOut fails (e.g. token already expired), force local cleanup
      console.warn('[AuthContext] signOut API error (session cleared locally):', e)
      try { await supabase.auth.signOut({ scope: 'local' }) } catch { /* ignore */ }
    }
  }

  return (
    <AuthContext.Provider value={{
      user, session, loading, profile, userDetails, organization, orgRole, hasOrganization,
      isVerified, isModerator, isSponsor, signUp, signIn, signOut, refreshProfile
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
