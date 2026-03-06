import { createContext, useContext, useEffect, useState, useCallback, useRef, ReactNode } from 'react'
import { User, Session, AuthChangeEvent } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { Profile, MarinaProfile, PartnerProfile, MediaPartnerProfile, UserDetails } from '@/types/database'

interface AuthContextType {
  user: User | null
  session: Session | null
  loading: boolean
  profile: Profile | null
  userDetails: UserDetails | null
  isVerified: boolean
  isModerator: boolean
  signUp: (email: string, password: string, persona?: string, firstName?: string, lastName?: string) => Promise<{ error: Error | null }>
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
  const [loading, setLoading] = useState(true)

  // Ref to track mount status across async operations
  const mountedRef = useRef(true)

  const isVerified = profile?.access_status === 'verified'
  const isModerator = (profile?.persona === 'moderator' || profile?.persona === 'admin') && isVerified

  const fetchUserData = useCallback(async (userId: string) => {
    const { data: profileData, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle()

    if (error || !profileData) return { profile: null as Profile | null, details: null as UserDetails | null }

    const p = profileData as Profile

    let details: UserDetails | null = null
    if (p.persona === 'marina') {
      const { data } = await supabase.from('marina_profiles').select('*').eq('user_id', userId).maybeSingle()
      details = (data as MarinaProfile) ?? null
    } else if (p.persona === 'partner') {
      const { data } = await supabase.from('partner_profiles').select('*').eq('user_id', userId).maybeSingle()
      details = (data as PartnerProfile) ?? null
    } else if (p.persona === 'media_partner') {
      const { data } = await supabase.from('media_partner_profiles').select('*').eq('user_id', userId).maybeSingle()
      details = (data as MediaPartnerProfile) ?? null
    }

    return { profile: p, details }
  }, [])

  const refreshProfile = useCallback(async () => {
    if (!user) return
    const { profile: p, details } = await fetchUserData(user.id)
    setProfile(p)
    setUserDetails(details)
  }, [user, fetchUserData])

  // ─── Core auth effect ───────────────────────────────────────────────
  // Uses ONLY onAuthStateChange as the single source of truth.
  // NO getSession() call — avoids race condition between init() and the
  // INITIAL_SESSION event that caused the infinite loading bug.
  //
  // Flow:
  //   INITIAL_SESSION → first event on page load, replaces old init()
  //   SIGNED_IN       → after signIn(), loading=true → fetch profile → loading=false
  //   SIGNED_OUT      → clear everything, loading=false
  //   TOKEN_REFRESHED → update session only (no profile refetch needed)
  //   PASSWORD_RECOVERY / USER_UPDATED → update session if present
  // ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (isResetPasswordPage()) {
      setLoading(false)
      return
    }

    mountedRef.current = true

    // Safety timeout: if loading doesn't resolve in 15s, force it false.
    // This prevents infinite loading if something truly unexpected happens.
    const safetyTimer = setTimeout(() => {
      if (mountedRef.current) {
        setLoading((prev) => {
          if (prev) {
            console.warn('[AuthContext] Safety timeout — forcing loading to false after 15s')
            return false
          }
          return prev
        })
      }
    }, 15000)

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
        if (shouldSetLoading) setLoading(false)
        return
      }

      // Set user + session FIRST so components know auth exists
      setSession(sess)
      setUser(sess.user)

      // Fetch profile with timeout protection
      try {
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Profile fetch timeout')), 10000)
        )
        const { profile: p, details } = await Promise.race([
          fetchUserData(sess.user.id),
          timeoutPromise,
        ])
        if (!mountedRef.current) return
        setProfile(p)
        setUserDetails(details)
      } catch (err) {
        console.warn('[AuthContext] Profile fetch failed or timed out:', err)
        if (!mountedRef.current) return
        // User/session are valid, just no profile data
        setProfile(null)
        setUserDetails(null)
      }

      if (shouldSetLoading) setLoading(false)
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event: AuthChangeEvent, newSession) => {
        if (!mountedRef.current) return

        // ── INITIAL_SESSION ──────────────────────────────────────
        // First event on page load. Replaces the old init()/getSession().
        // If there's a valid session in storage, we get it here.
        // If the stored session is expired, Supabase auto-refreshes it
        // before firing this event (or gives us null if refresh fails).
        if (event === 'INITIAL_SESSION') {
          await handleSession(newSession, true)
          return
        }

        // ── SIGNED_IN ────────────────────────────────────────────
        // Fires after signIn(). CRITICAL: set loading=true FIRST so that
        // pages like AccountPage see authLoading=true and DON'T redirect
        // to /onboarding while we're still fetching the profile.
        if (event === 'SIGNED_IN') {
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
          setLoading(false)
          return
        }

        // ── TOKEN_REFRESHED ──────────────────────────────────────
        // Session token was refreshed. Update session/user but don't
        // re-fetch profile (it hasn't changed, saves a DB round-trip).
        if (event === 'TOKEN_REFRESHED') {
          if (newSession?.user) {
            setSession(newSession)
            setUser(newSession.user)
          } else {
            // Token refresh returned no session — session is truly expired
            console.warn('[AuthContext] Token refresh failed — clearing session')
            setUser(null)
            setSession(null)
            setProfile(null)
            setUserDetails(null)
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

    return () => {
      mountedRef.current = false
      clearTimeout(safetyTimer)
      subscription.unsubscribe()
    }
  }, [fetchUserData])

  // ─── signUp ─────────────────────────────────────────────────────────
  const signUp = async (email: string, password: string, persona?: string, firstName?: string, lastName?: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          persona: persona || 'individual',
          first_name: firstName || '',
          last_name: lastName || '',
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
      user, session, loading, profile, userDetails, isVerified, isModerator,
      signUp, signIn, signOut, refreshProfile
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
