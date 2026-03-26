import { createContext, useContext, useEffect, useState, useCallback, useRef, ReactNode } from 'react'
import { User, Session, AuthChangeEvent } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { Profile, MarinaProfile, PartnerProfile, MediaPartnerProfile, UserDetails, Organization, OrgMemberRole, SPONSOR_TIERS } from '@/types/database'

interface AuthContextType {
  user: User | null
  session: Session | null
  loading: boolean
  profileTimedOut: boolean
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [userDetails, setUserDetails] = useState<UserDetails | null>(null)
  const [organization, setOrganization] = useState<Organization | null>(null)
  const [orgRole, setOrgRole] = useState<OrgMemberRole | null>(null)
  const [loading, setLoading] = useState(true)
  const [profileTimedOut, setProfileTimedOut] = useState(false)

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
    if (p) {
      profileLoadedRef.current = true
      setProfileTimedOut(false)
    }
  }, [user, fetchUserData])

  // Track whether initial session has been handled to differentiate
  // a fresh sign-in from Supabase re-firing SIGNED_IN on tab focus
  const initializedRef = useRef(false)
  // Track current user ID to detect genuine user changes
  const currentUserIdRef = useRef<string | null>(null)
  // Prevent concurrent profile fetches
  const isFetchingRef = useRef(false)
  // Track whether profile data was actually loaded (NOT just attempted)
  // Unlike the old profileAttemptedRef, this is only true when we have real data.
  // This allows TOKEN_REFRESHED to retry if the initial fetch returned null.
  const profileLoadedRef = useRef(false)

  // ─── Core auth effect ───────────────────────────────────────────────
  // Uses ONLY onAuthStateChange as the single source of truth.
  //
  // Key changes from previous version:
  //   - NO Promise.race timeout on profile fetch — let it complete naturally
  //   - profileLoadedRef replaces profileAttemptedRef — only blocks re-fetch
  //     when we actually have data, allowing recovery after failures
  //   - Safety timeout (20s) forces loading=false but does NOT cancel fetch;
  //     when fetch eventually completes, state updates re-render the UI
  //   - TOKEN_REFRESHED can re-fetch if profile is null (recovery path)
  // ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true
    initializedRef.current = false

    // Safety timeout: if loading doesn't resolve in 20s, force it false.
    // The profile fetch continues in background — when it completes,
    // setProfile() will trigger a re-render with the real data.
    const safetyTimer = setTimeout(() => {
      if (mountedRef.current) {
        setLoading((prev) => {
          if (prev) {
            console.warn('[AuthContext] Safety timeout — forcing loading to false after 20s (fetch continues in background)')
            setProfileTimedOut(true)
            return false
          }
          return prev
        })
      }
    }, 20000)

    /**
     * Handles a session: sets user/session, fetches profile, then sets loading=false.
     * If session is null/expired, clears everything.
     *
     * Key design: NO timeout on fetchUserData. The fetch runs to completion.
     * If the safety timeout fires first, it sets loading=false so the UI renders.
     * When the fetch eventually completes, state updates cause a re-render.
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
        isFetchingRef.current = false
        profileLoadedRef.current = false
        setProfileTimedOut(false)
        if (shouldSetLoading) setLoading(false)
        return
      }

      const isSameUser = currentUserIdRef.current === sess.user.id

      // Guard: if a fetch is already in progress for the same user, skip.
      // DON'T set loading=false here — let the in-progress fetch handle it.
      if (isFetchingRef.current && isSameUser) {
        setSession(sess)
        setUser(sess.user)
        return
      }

      // Guard: if profile already loaded for this user, just update session.
      // Unlike the old profileAttemptedRef, this only blocks when we HAVE data.
      if (profileLoadedRef.current && isSameUser) {
        setSession(sess)
        setUser(sess.user)
        if (shouldSetLoading) setLoading(false)
        return
      }

      // Set user + session FIRST so components know auth exists
      setSession(sess)
      setUser(sess.user)
      currentUserIdRef.current = sess.user.id
      isFetchingRef.current = true

      // Fetch profile data — NO timeout wrapper
      // Let Supabase handle its own request timeouts.
      // The 20s safety timer above handles the loading state.
      try {
        const result = await fetchUserData(sess.user.id)
        if (!mountedRef.current) return
        setProfile(result.profile)
        setUserDetails(result.details)
        setOrganization(result.org)
        setOrgRole(result.role)
        if (result.profile) {
          profileLoadedRef.current = true
          setProfileTimedOut(false) // Clear timeout flag on successful load
        }
      } catch (err) {
        if (import.meta.env.DEV) console.debug('[AuthContext] Profile fetch error:', err)
      } finally {
        isFetchingRef.current = false
        if (shouldSetLoading && mountedRef.current) setLoading(false)
      }
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event: AuthChangeEvent, newSession) => {
        if (!mountedRef.current) return

        // ── INITIAL_SESSION ──────────────────────────────────────
        // First event on page load. Replaces the old init()/getSession().
        if (event === 'INITIAL_SESSION') {
          initializedRef.current = true
          if (!newSession) {
            // Session is null — could be genuinely logged out, or the auth
            // lock timed out (multi-tab). Check localStorage for a token
            // and retry after a short delay if one exists.
            const storageKey = `sb-${new URL(import.meta.env.VITE_SUPABASE_URL || '').hostname.split('.')[0]}-auth-token`
            const stored = localStorage.getItem(storageKey)
            if (stored) {
              // Token exists in storage — lock contention likely. Retry.
              console.warn('[AuthContext] INITIAL_SESSION null but token in storage — retrying in 2s')
              setTimeout(async () => {
                if (!mountedRef.current) return
                const { data: { session: retrySession } } = await supabase.auth.getSession()
                if (retrySession && mountedRef.current) {
                  await handleSession(retrySession, true)
                } else if (mountedRef.current) {
                  // Genuinely no session
                  await handleSession(null, true)
                }
              }, 2000)
              return
            }
          }
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
          profileLoadedRef.current = false
          setProfileTimedOut(false)
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
          profileLoadedRef.current = false
          setProfileTimedOut(false)
          setLoading(false)
          return
        }

        // ── TOKEN_REFRESHED ──────────────────────────────────────
        // Session token was refreshed. Update session/user silently.
        // KEY FIX: If profile is null (e.g. initial fetch was slow),
        // retry the fetch. profileLoadedRef (not profileAttemptedRef)
        // means we only skip if we actually HAVE the data.
        if (event === 'TOKEN_REFRESHED') {
          if (newSession?.user) {
            setSession(newSession)
            setUser(newSession.user)
            currentUserIdRef.current = newSession.user.id
            // If profile never loaded, retry (recovery path)
            if (!profileLoadedRef.current && !isFetchingRef.current) {
              handleSession(newSession, false)
            }
          } else {
            // Token refresh returned no session — session is truly expired
            console.warn('[AuthContext] Token refresh failed — clearing session')
            setUser(null)
            setSession(null)
            setProfile(null)
            setUserDetails(null)
            currentUserIdRef.current = null
            profileLoadedRef.current = false
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
        emailRedirectTo: `${window.location.origin}/`,
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
    profileLoadedRef.current = false
    setProfileTimedOut(false)
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
      user, session, loading, profileTimedOut, profile, userDetails, organization, orgRole, hasOrganization,
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
