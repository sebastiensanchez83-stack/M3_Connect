import { createContext, useContext, useEffect, useState, useCallback, useRef, ReactNode } from 'react'
import { User, Session, AuthChangeEvent } from '@supabase/supabase-js'
import { supabase, setAuthListener } from '@/lib/supabase'
import { Profile, Organization, OrgMemberRole, SPONSOR_TIERS } from '@/types/database'
import { getStoredInvite } from '@/lib/invite-store'

interface AuthContextType {
  user: User | null
  session: Session | null
  loading: boolean
  profileTimedOut: boolean
  profile: Profile | null
  organization: Organization | null
  orgRole: OrgMemberRole | null
  hasOrganization: boolean
  isVerified: boolean
  isAdmin: boolean
  isModerator: boolean
  isPending: boolean
  isPaymentPending: boolean
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
  const [organization, setOrganization] = useState<Organization | null>(null)
  const [orgRole, setOrgRole] = useState<OrgMemberRole | null>(null)
  const [loading, setLoading] = useState(true)
  const [profileTimedOut, setProfileTimedOut] = useState(false)

  const mountedRef = useRef(true)

  const isVerified = profile?.access_status === 'verified'
  const isAdmin = profile?.persona === 'admin' && isVerified
  // isModerator grants access to admin/moderator panel (both admin and moderator personas)
  const isModerator = (profile?.persona === 'moderator' || profile?.persona === 'admin') && isVerified
  const isPending = profile?.access_status === 'pending'
  const isPaymentPending = profile?.access_status === 'payment_pending'
  const hasOrganization = organization !== null
  const isSponsor = hasOrganization && SPONSOR_TIERS.includes(organization!.tier)

  // ─── Data fetching ────────────────────────────────────────────────
  const fetchUserData = useCallback(async (userId: string) => {
    const { data: profileData, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle()

    if (error || !profileData) return { profile: null as Profile | null, org: null as Organization | null, role: null as OrgMemberRole | null }

    const p = profileData as Profile

    // Organization data is the single source of truth (legacy per-persona profile tables removed)
    const { data: membership } = await supabase
      .from('organization_members')
      .select('organization_id, role')
      .eq('user_id', userId)
      .maybeSingle()

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

    return { profile: p, org, role }
  }, [])

  const refreshProfile = useCallback(async () => {
    if (!user) return
    const { profile: p, org, role } = await fetchUserData(user.id)
    setProfile(p)
    setOrganization(org)
    setOrgRole(role)
    if (p) {
      profileLoadedRef.current = true
      setProfileTimedOut(false)
    }
  }, [user, fetchUserData])

  // ─── Refs for deduplication ───────────────────────────────────────
  const initializedRef = useRef(false)
  const currentUserIdRef = useRef<string | null>(null)
  const isFetchingRef = useRef(false)
  // Only true when profile was ACTUALLY loaded (not just attempted).
  // Allows TOKEN_REFRESHED to retry if the initial fetch failed.
  const profileLoadedRef = useRef(false)

  // ─── Core auth effect ─────────────────────────────────────────────
  //
  // Uses setAuthListener() from supabase.ts instead of calling
  // supabase.auth.onAuthStateChange() directly. The actual subscription
  // lives at module level — this prevents the Web Locks API deadlock
  // that occurs when React StrictMode double-mounts and causes
  // onAuthStateChange to be called twice.
  //
  // See supabase.ts for the full explanation.
  // ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true
    initializedRef.current = false

    // Safety timeout: if loading doesn't resolve in 15s, force it false.
    // The profile fetch continues in background — when it completes,
    // setProfile() triggers a re-render with the real data.
    const safetyTimer = setTimeout(() => {
      if (mountedRef.current) {
        setLoading((prev) => {
          if (prev) {
            if (import.meta.env.DEV) console.warn('[AuthContext] Safety timeout — forcing loading=false after 15s (fetch continues in background)')
            setProfileTimedOut(true)
            return false
          }
          return prev
        })
      }
    }, 15000)

    /**
     * Handles a session: sets user/session, fetches profile, then sets loading=false.
     * NO timeout wrapper on the fetch — let it complete naturally.
     */
    const handleSession = async (sess: Session | null, shouldSetLoading: boolean) => {
      if (!mountedRef.current) return

      if (!sess?.user) {
        setUser(null)
        setSession(null)
        setProfile(null)
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
      if (isFetchingRef.current && isSameUser) {
        setSession(sess)
        setUser(sess.user)
        return
      }

      // Guard: if profile already loaded for this user, just update session.
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

      try {
        const result = await fetchUserData(sess.user.id)
        if (!mountedRef.current) return
        setProfile(result.profile)
        setOrganization(result.org)
        setOrgRole(result.role)
        if (result.profile) {
          profileLoadedRef.current = true
          setProfileTimedOut(false)
        }
      } catch (err) {
        if (import.meta.env.DEV) console.debug('[AuthContext] Profile fetch error:', err)
      } finally {
        isFetchingRef.current = false
        if (shouldSetLoading && mountedRef.current) setLoading(false)
      }
    }

    // ── Register with the module-level auth subscription ────────────
    // This replaces the old supabase.auth.onAuthStateChange() call.
    // The actual subscription was created once at module load time.
    // Events that fired before this listener registered (INITIAL_SESSION)
    // are buffered and replayed.
    const removeListener = setAuthListener(
      async (event: AuthChangeEvent, newSession: Session | null) => {
        if (!mountedRef.current) return

        // ── INITIAL_SESSION ──────────────────────────────────────
        if (event === 'INITIAL_SESSION') {
          initializedRef.current = true
          if (!newSession) {
            const storageKey = `sb-${new URL(import.meta.env.VITE_SUPABASE_URL || '').hostname.split('.')[0]}-auth-token`
            const stored = localStorage.getItem(storageKey)
            if (stored) {
              if (import.meta.env.DEV) console.warn('[AuthContext] INITIAL_SESSION null but token in storage — retrying in 2s')
              setTimeout(async () => {
                if (!mountedRef.current) return
                const { data: { session: retrySession } } = await supabase.auth.getSession()
                if (retrySession && mountedRef.current) {
                  await handleSession(retrySession, true)
                } else if (mountedRef.current) {
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
        if (event === 'SIGNED_IN') {
          const isSameUser = newSession?.user?.id === currentUserIdRef.current
          const isRefire = initializedRef.current && isSameUser

          if (isRefire) {
            if (newSession?.user) {
              setSession(newSession)
              setUser(newSession.user)
            }
            return
          }

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
          setOrganization(null)
          setOrgRole(null)
          currentUserIdRef.current = null
          profileLoadedRef.current = false
          setProfileTimedOut(false)
          setLoading(false)
          return
        }

        // ── TOKEN_REFRESHED ──────────────────────────────────────
        if (event === 'TOKEN_REFRESHED') {
          if (newSession?.user) {
            setSession(newSession)
            setUser(newSession.user)
            currentUserIdRef.current = newSession.user.id
            // Recovery: if profile never loaded, retry the fetch
            if (!profileLoadedRef.current && !isFetchingRef.current) {
              handleSession(newSession, false)
            }
          } else {
            if (import.meta.env.DEV) console.warn('[AuthContext] Token refresh failed — clearing session')
            setUser(null)
            setSession(null)
            setProfile(null)
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
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && currentUserIdRef.current) {
        supabase.auth.getSession().catch((err) => {
          if (import.meta.env.DEV) console.warn('[AuthContext] Visibility session check failed:', err)
        })
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      mountedRef.current = false
      initializedRef.current = false
      clearTimeout(safetyTimer)
      removeListener()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [fetchUserData])

  // ─── signUp ─────────────────────────────────────────────────────────
  const signUp = async (email: string, password: string, persona?: string, firstName?: string, lastName?: string, companyName?: string, companyWebsite?: string, detectedOrgId?: string, jobTitle?: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: getStoredInvite()
          ? `${window.location.origin}/join/${getStoredInvite()}?email_confirmed=true`
          : `${window.location.origin}/?email_confirmed=true`,
        data: {
          persona: persona || 'marina',
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
  const signIn = async (email: string, password: string) => {
    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setLoading(false)
    }
    return { error: error ?? null }
  }

  // ─── signOut ────────────────────────────────────────────────────────
  const signOut = async () => {
    profileLoadedRef.current = false
    setProfileTimedOut(false)
    setUser(null)
    setSession(null)
    setProfile(null)
    setOrganization(null)
    setOrgRole(null)
    try {
      await supabase.auth.signOut({ scope: 'local' })
    } catch (e) {
      if (import.meta.env.DEV) console.warn('[AuthContext] signOut error:', e)
    }
  }

  return (
    <AuthContext.Provider value={{
      user, session, loading, profileTimedOut, profile, organization, orgRole, hasOrganization,
      isVerified, isAdmin, isModerator, isPending, isPaymentPending, isSponsor, signUp, signIn, signOut, refreshProfile
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
