import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react'
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

/** Clear all auth state (used on expired sessions and sign-out) */
function clearAuthState(
  setUser: (u: User | null) => void,
  setSession: (s: Session | null) => void,
  setProfile: (p: Profile | null) => void,
  setUserDetails: (d: UserDetails | null) => void,
) {
  setUser(null)
  setSession(null)
  setProfile(null)
  setUserDetails(null)
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [userDetails, setUserDetails] = useState<UserDetails | null>(null)
  const [loading, setLoading] = useState(true)

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

  useEffect(() => {
    if (isResetPasswordPage()) {
      setLoading(false)
      return
    }

    let mounted = true

    const init = async () => {
      try {
        const { data, error } = await supabase.auth.getSession()

        if (!mounted) return

        // If getSession fails or returns no session, clear state and stop loading
        if (error || !data.session) {
          if (error) {
            console.warn('[AuthContext] getSession error — clearing stale session:', error.message)
            // Force clear any stale token from storage
            try { await supabase.auth.signOut({ scope: 'local' }) } catch { /* ignore */ }
          }
          clearAuthState(setUser, setSession, setProfile, setUserDetails)
          setLoading(false)
          return
        }

        const sess = data.session
        setSession(sess)
        setUser(sess.user)

        // Fetch profile with a timeout to avoid infinite loading
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Profile fetch timeout')), 10000)
        )

        try {
          const { profile: p, details } = await Promise.race([
            fetchUserData(sess.user.id),
            timeoutPromise,
          ])
          if (!mounted) return
          setProfile(p)
          setUserDetails(details)
        } catch (fetchErr) {
          console.warn('[AuthContext] Profile fetch failed or timed out:', fetchErr)
          // Session exists but profile fetch failed — still set user, just no profile
          if (!mounted) return
          setProfile(null)
          setUserDetails(null)
        }
      } catch (e: unknown) {
        if (e instanceof Error && e.name === 'AbortError') return
        console.error('[AuthContext] init error:', e)
        if (mounted) clearAuthState(setUser, setSession, setProfile, setUserDetails)
      } finally {
        if (mounted) setLoading(false)
      }
    }

    init()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event: AuthChangeEvent, newSession) => {
      if (!mounted) return

      // Handle sign-out and token expiry explicitly
      if (event === 'SIGNED_OUT' || (!newSession && event !== 'INITIAL_SESSION')) {
        clearAuthState(setUser, setSession, setProfile, setUserDetails)
        setLoading(false)
        return
      }

      // Handle token refresh failure — the session is gone
      if (event === 'TOKEN_REFRESHED' && !newSession) {
        console.warn('[AuthContext] Token refresh returned no session — signing out')
        clearAuthState(setUser, setSession, setProfile, setUserDetails)
        setLoading(false)
        return
      }

      if (newSession?.user) {
        setSession(newSession)
        setUser(newSession.user)

        try {
          const { profile: p, details } = await fetchUserData(newSession.user.id)
          if (!mounted) return
          setProfile(p)
          setUserDetails(details)
        } catch (e: unknown) {
          if (e instanceof Error && e.name === 'AbortError') return
          console.error('[AuthContext] onAuthStateChange fetch error:', e)
          // Don't clear user/session — just profile fetch failed
        }
      }
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [fetchUserData])

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

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error: error ?? null }
  }

  const signOut = async () => {
    // Clear state immediately, then attempt server-side sign out
    clearAuthState(setUser, setSession, setProfile, setUserDetails)
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
