import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react'
import { User, Session } from '@supabase/supabase-js'
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
  signUp: (email: string, password: string) => Promise<{ error: Error | null }>
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

  const isVerified = profile?.access_status === 'verified'
  const isModerator = profile?.persona === 'moderator' && isVerified

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
        if (error) console.warn('[AuthContext] getSession error:', error)
        if (!mounted) return

        const sess = data.session ?? null
        setSession(sess)
        setUser(sess?.user ?? null)

        if (sess?.user) {
          const { profile: p, details } = await fetchUserData(sess.user.id)
          if (!mounted) return
          setProfile(p)
          setUserDetails(details)
        } else {
          setProfile(null)
          setUserDetails(null)
        }
      } catch (e) {
        console.error('[AuthContext] init error:', e)
      } finally {
        if (mounted) setLoading(false)
      }
    }

    init()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      if (!mounted) return

      setSession(newSession)
      setUser(newSession?.user ?? null)

      if (newSession?.user) {
        const { profile: p, details } = await fetchUserData(newSession.user.id)
        if (!mounted) return
        setProfile(p)
        setUserDetails(details)
      } else {
        setProfile(null)
        setUserDetails(null)
      }
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [fetchUserData])

  const signUp = async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({ email, password })
    return { error: error ?? null }
  }

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error: error ?? null }
  }

  const signOut = async () => {
    try { await supabase.auth.signOut() } catch (e) { console.error('[AuthContext] signOut error:', e) }
    setUser(null); setSession(null); setProfile(null); setUserDetails(null)
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
