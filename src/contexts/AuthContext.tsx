import { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef, ReactNode } from 'react'
import { User, Session, AuthChangeEvent } from '@supabase/supabase-js'
import { supabase, setAuthListener } from '@/lib/supabase'
import { Profile, Organization, OrgMemberRole, SPONSOR_TIERS } from '@/types/database'
import { getStoredInvite } from '@/lib/invite-store'
import { throughWelcome } from '@/lib/confirmationLink'
import { notifyAdmin } from '@/lib/notifications'
import {
  type Capability,
  type CapabilitySnapshot,
  capabilityAllows,
  fetchMyCapabilities,
  setCapabilityGate,
} from '@/lib/capabilities'
import { loadRegistrationFlags, onRegistrationFlagsChange, readRegistrationFlags } from '@/lib/flags'
import { completeMySignupOnce, stripClaimCodeFromMetadata } from '@/lib/accountSignup'

/**
 * attach_my_records (registration core): once per browser tab session and account,
 * the registrations made with the account's PROVEN address that are not linked yet
 * join the account (event guests, legacy webinar guests; never SM26). A no-op in
 * the database while the address is not proven. Behind flag front_door: with the
 * flags off nothing new is called (the provider calls it once a read of the switch
 * said on, then checks again here). Fire-and-forget, never blocks the page.
 */
const ATTACHED_KEY = 'smc_attached:'
async function attachMyRecordsOnce(userId: string): Promise<boolean> {
  try {
    if (sessionStorage.getItem(ATTACHED_KEY + userId)) return false
  } catch { /* storage blocked: the in-memory guard of the caller still applies */ }
  const flags = await loadRegistrationFlags()
  if (!flags.front_door) return false
  try {
    const { error } = await supabase.rpc('attach_my_records')
    if (error) {
      if (import.meta.env.DEV) console.warn('[AuthContext] attach_my_records:', error.message)
      return false
    }
    try { sessionStorage.setItem(ATTACHED_KEY + userId, String(Date.now())) } catch { /* ignore */ }
    return true
  } catch {
    return false
  }
}

interface AuthContextType {
  user: User | null
  session: Session | null
  loading: boolean
  profileTimedOut: boolean
  profile: Profile | null
  organization: Organization | null
  orgRole: OrgMemberRole | null
  organizations: { organization: Organization; role: OrgMemberRole }[]
  setActiveOrganization: (orgId: string) => void
  hasOrganization: boolean
  isVerified: boolean
  isAdmin: boolean
  isModerator: boolean
  isPending: boolean
  isSponsor: boolean
  /**
   * Rights per company type (src/lib/capabilities.ts). While
   * `capabilitiesEnforced` is false (registration_flags.capabilities_enforced off),
   * screens keep today's checks and can() is not consulted. `orgId`: through that
   * one company of the person's (the company a need is published for, the company
   * a message is sent from). Verified staff: always true.
   */
  can: (cap: Capability, orgId?: string | null) => boolean
  capabilitiesEnforced: boolean
  /** The switch is known and, when it is on, so are the person's rights. */
  capabilitiesReady: boolean
  capabilities: CapabilitySnapshot | null
  /** The switch is on but the person's rights could not be read (can() is false meanwhile). */
  capabilitiesUnavailable: boolean
  /** Reads the switch and the rights again (also done on its own when the tab regains focus). */
  retryCapabilities: () => void
  // needsConfirmation: account created but no session until the e-mailed link is
  // opened ("Confirm email" ON). emailRedirectTo: where that link lands — reuse it
  // for supabase.auth.resend so a re-sent link goes to the same place.
  // captchaToken: the Cloudflare Turnstile token, passed to GoTrue only when the
  // form has one (harmless while the Auth CAPTCHA setting is off).
  signUp: (email: string, password: string, persona?: string, firstName?: string, lastName?: string, companyName?: string, companyWebsite?: string, detectedOrgId?: string, jobTitle?: string, captchaToken?: string | null) => Promise<{ error: Error | null; needsConfirmation: boolean; emailRedirectTo: string }>
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

// A user can belong to multiple companies (admin-managed). We keep ONE active
// company in `organization`/`orgRole` (so all existing org-scoped code is
// unchanged) and expose the full list + a setter for the switcher.
type Membership = { organization: Organization; role: OrgMemberRole }
const ACTIVE_ORG_KEY = 'm3_active_org'

function pickActiveMembership(memberships: Membership[]): Membership | null {
  if (memberships.length === 0) return null
  let storedId: string | null = null
  try { storedId = localStorage.getItem(ACTIVE_ORG_KEY) } catch { /* ignore */ }
  return memberships.find(m => m.organization.id === storedId)
    || memberships.find(m => m.role === 'owner')
    || memberships[0]
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [organization, setOrganization] = useState<Organization | null>(null)
  const [orgRole, setOrgRole] = useState<OrgMemberRole | null>(null)
  const [organizations, setOrganizations] = useState<Membership[]>([])
  const [loading, setLoading] = useState(true)
  const [profileTimedOut, setProfileTimedOut] = useState(false)

  const mountedRef = useRef(true)

  const isVerified = profile?.access_status === 'verified'
  const isAdmin = profile?.persona === 'admin' && isVerified
  // isModerator grants access to admin/moderator panel (both admin and moderator personas)
  const isModerator = (profile?.persona === 'moderator' || profile?.persona === 'admin') && isVerified
  const isPending = profile?.access_status === 'pending'
  const hasOrganization = organization !== null
  const isSponsor = hasOrganization && SPONSOR_TIERS.includes(organization!.tier)

  // ─── Data fetching ────────────────────────────────────────────────
  const fetchUserData = useCallback(async (userId: string) => {
    // Fetch profile + ALL memberships in parallel for faster load
    const [{ data: profileData, error }, { data: memberRows }] = await Promise.all([
      supabase.from('profiles').select('*').eq('user_id', userId).maybeSingle(),
      supabase.from('organization_members').select('organization_id, role').eq('user_id', userId),
    ])

    if (error || !profileData) return { profile: null as Profile | null, memberships: [] as Membership[] }

    const p = profileData as Profile
    const rows = (memberRows || []) as { organization_id: string; role: OrgMemberRole }[]

    let memberships: Membership[] = []
    if (rows.length > 0) {
      // Explicit columns, never '*': claim_code is not readable by signed-in
      // users (audit S2), and select=* on organizations then fails as a whole.
      const { data: orgs } = await supabase
        .from('organizations')
        .select('id, name, slug, primary_domain, organization_type, tier, max_seats, created_by_user_id, owner_user_id, logo_url, description, website, country, city, created_at, updated_at, access_status, onboarding_status, rejection_reason, audience_description, headquarters_country, social_media_links, marina_subtype, auto_approve_domain_joins, banner_url, investment_geographies, investment_size_min, investment_size_max, investment_hold_period, investment_thesis, featured_partner, gallery, is_event_media_partner')
        .in('id', rows.map(r => r.organization_id))
      const orgMap = new Map(((orgs as Organization[] | null) || []).map(o => [o.id, o]))
      memberships = rows
        .map(r => { const o = orgMap.get(r.organization_id); return o ? { organization: o, role: r.role } : null })
        .filter((m): m is Membership => m !== null)
    }

    return { profile: p, memberships }
  }, [])

  // Set the membership list and resolve the active company (persisted choice,
  // else the owned org, else the first). Keeps organization/orgRole = active.
  const applyMemberships = useCallback((memberships: Membership[]) => {
    setOrganizations(memberships)
    const active = pickActiveMembership(memberships)
    setOrganization(active?.organization ?? null)
    setOrgRole(active?.role ?? null)
  }, [])

  const refreshProfile = useCallback(async () => {
    if (!user) return
    const { profile: p, memberships } = await fetchUserData(user.id)
    setProfile(p)
    applyMemberships(memberships)
    if (p) {
      profileLoadedRef.current = true
      setProfileTimedOut(false)
    }
  }, [user, fetchUserData, applyMemberships])

  const setActiveOrganization = useCallback((orgId: string) => {
    const m = organizations.find(x => x.organization.id === orgId)
    if (!m) return
    setOrganization(m.organization)
    setOrgRole(m.role)
    try { localStorage.setItem(ACTIVE_ORG_KEY, orgId) } catch { /* ignore */ }
  }, [organizations])

  // ─── Refs for deduplication ───────────────────────────────────────
  const initializedRef = useRef(false)
  const currentUserIdRef = useRef<string | null>(null)
  const isFetchingRef = useRef(false)
  // Only true when profile was ACTUALLY loaded (not just attempted).
  // Allows TOKEN_REFRESHED to retry if the initial fetch failed.
  const profileLoadedRef = useRef(false)

  // ─── The two switches the once-per-session calls below wait for ───────
  // As the last successful read of registration_flags said (off until one has). A read
  // that failed or gave up decides nothing: the calls wait for the next one that answers
  // (a late answer, the tab regaining focus), and a switch turned on while the tab is
  // open counts from the next read (src/lib/flags.ts tells every subscriber of each).
  const [frontDoorOn, setFrontDoorOn] = useState(false)
  const [signupV2On, setSignupV2On] = useState(false)
  useEffect(() => {
    let alive = true
    const apply = (flags: { front_door: boolean; account_signup_v2: boolean }) => {
      if (!alive) return
      setFrontDoorOn(flags.front_door)
      setSignupV2On(flags.account_signup_v2)
    }
    const off = onRegistrationFlagsChange(apply)
    // A read answered before this subscribed (the cache) is not announced again.
    void readRegistrationFlags().then((flags) => { if (flags) apply(flags) })
    return () => { alive = false; off() }
  }, [])

  // ─── Attach registrations once per session (flag front_door) ─────────
  // Once the account's profile is here: unlinked registrations made with its proven
  // address join it (My events reads them through my_participations, by e-mail too).
  // Only once a read of the switch said on: tried for this account from then on only.
  const attachTriedRef = useRef<string | null>(null)
  const profileUserId = profile?.user_id ?? null
  useEffect(() => {
    if (!profileUserId || !frontDoorOn || attachTriedRef.current === profileUserId) return
    attachTriedRef.current = profileUserId
    void attachMyRecordsOnce(profileUserId)
  }, [profileUserId, frontDoorOn])

  // ─── A sign-up kept for later (flag account_signup_v2) ────────────
  // A proven account whose sign-up intent the database kept while the flag was off runs
  // it once the flag is on (complete_my_signup, registration contract §10.3), once per
  // session; nothing is called for any other account. The profile is then re-read.
  // Same wait as above: only once a read of the switch said on.
  const signupTriedRef = useRef<string | null>(null)
  const authEmail = user?.email ?? null
  useEffect(() => {
    if (!profile || !signupV2On || signupTriedRef.current === profile.user_id) return
    signupTriedRef.current = profile.user_id
    void completeMySignupOnce(profile, authEmail, profile.user_id).then((ran) => {
      if (ran) void refreshProfile().catch(() => {})
    })
  }, [profile, authEmail, refreshProfile, signupV2On])

  // ─── A claim code left in the account's own metadata (sign-up v2) ──────────
  // The database took it at sign-up (signup_claim_code); the copy every access token
  // carries goes, once per session. Only an account whose metadata holds one: nothing is
  // called for any other.
  const codeStripRef = useRef<string | null>(null)
  useEffect(() => {
    const meta = user?.user_metadata as Record<string, unknown> | undefined
    const intent = meta?.signup_intent
    if (!user || codeStripRef.current === user.id || !intent || typeof intent !== 'object' || !('code' in intent)) return
    codeStripRef.current = user.id
    void stripClaimCodeFromMetadata(meta)
  }, [user])

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
        setOrganizations([])
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
        setOrganizations(result.memberships)
        const active = pickActiveMembership(result.memberships)
        setOrganization(active?.organization ?? null)
        setOrgRole(active?.role ?? null)
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
          setOrganizations([])
          currentUserIdRef.current = null
          profileLoadedRef.current = false
          setProfileTimedOut(false)
          setLoading(false)
          // Don't leave per-user selections for the next account on a shared browser.
          try { localStorage.removeItem(ACTIVE_ORG_KEY); localStorage.removeItem('m3_pending_invite'); localStorage.removeItem('sm26_claim_code') } catch { /* ignore */ }
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

  // ─── Rights per company type (src/lib/capabilities.ts) ──────────────
  // The switch (registration_flags.capabilities_enforced) is read for everyone;
  // my_capabilities() only once it is on. Keyed on ids and statuses, never on the
  // user/profile objects: auth-js hands over a new user object on every tab
  // refocus. Re-read when the person's status or companies change (refreshProfile
  // after M3 validates or types a company).
  // Both reads give up after a few seconds (src/lib/flags.ts, src/lib/capabilities.ts), so a page
  // waiting on capabilitiesReady never stays on its loader. A failed read is tried
  // again when the person comes back to the tab (focus), without blanking the page:
  // capabilitiesReady stays true and the rights already known are kept meanwhile.
  const [capSnapshot, setCapSnapshot] = useState<CapabilitySnapshot | null>(null)
  const [capsEnforced, setCapsEnforced] = useState(false)
  const [capsReady, setCapsReady] = useState(false)
  const [capsFailed, setCapsFailed] = useState(false)
  const [capsRetry, setCapsRetry] = useState(0)
  const capsUidRef = useRef<string | null | undefined>(undefined)
  const capsEnforcedRef = useRef(false)
  // A run of the effect below is under way (it applies the flag value it reads).
  const capsLoadingRef = useRef(false)
  // The switch as the last successful read of the row said it (null: none yet).
  const capsLatestFlagRef = useRef<boolean | null>(null)
  const capsUid = user?.id ?? null
  const capsPersonKey = profile ? `${profile.access_status}:${profile.persona}` : ''
  const capsCompaniesKey = organizations
    .map(m => `${m.organization.id}:${m.organization.access_status}:${m.organization.organization_type ?? ''}`)
    .sort()
    .join('|')
  // Signed in, the profile and companies still loading: the rights are read once they are
  // here (one my_capabilities call per page load, not one before and one after).
  const capsWaitAccount = !!capsUid && loading

  useEffect(() => {
    let alive = true
    // Another person (or signed out): nothing of the previous one's rights survives.
    if (capsUidRef.current !== capsUid) {
      capsUidRef.current = capsUid
      setCapsReady(false)
      setCapSnapshot(null)
      setCapsFailed(false)
    }
    if (capsWaitAccount) return
    capsLoadingRef.current = true
    ;(async () => {
      // The one reader of registration_flags (src/lib/flags.ts): null = could not be read.
      const flags = await readRegistrationFlags()
      const flag = flags ? flags.capabilities_enforced : null
      // A failed read of the switch keeps what was known (off, at first).
      const enforced = flag ?? capsEnforcedRef.current
      const snapshot = enforced && capsUid ? await fetchMyCapabilities() : null
      if (!alive) return
      capsLoadingRef.current = false
      capsEnforcedRef.current = enforced
      setCapsEnforced(enforced)
      const snapshotFailed = enforced && !!capsUid && !snapshot
      // A failed read of the rights keeps the ones already known for this person.
      if (!snapshotFailed) setCapSnapshot(snapshot)
      setCapsFailed(flag === null || snapshotFailed)
      setCapsReady(true)
      // The switch moved while this run was reading the rights: once more.
      if (capsLatestFlagRef.current !== null && capsLatestFlagRef.current !== enforced) setCapsRetry(n => n + 1)
    })()
    return () => { alive = false }
  }, [capsUid, capsPersonKey, capsCompaniesKey, capsRetry, capsWaitAccount])

  useEffect(() => {
    if (!capsFailed) return
    const retry = () => setCapsRetry(n => n + 1)
    window.addEventListener('focus', retry)
    return () => window.removeEventListener('focus', retry)
  }, [capsFailed])

  // An open tab follows the switch without a reload. Every successful read of the
  // row, whoever made it, says whether it is on; when that differs from what this
  // tab applies, the rights are read again. The row is read again whenever the
  // person comes back to the tab (focus, or the tab shown again): at most one
  // request per five minutes (the cache of src/lib/flags.ts). So a tab follows the
  // switch, or its rollback, the first time it is used again five minutes or more
  // after the last read; a reload follows at once.
  useEffect(() => {
    const off = onRegistrationFlagsChange((flags) => {
      capsLatestFlagRef.current = flags.capabilities_enforced
      if (!capsLoadingRef.current && flags.capabilities_enforced !== capsEnforcedRef.current) {
        setCapsRetry(n => n + 1)
      }
    })
    const reread = () => { void readRegistrationFlags() }
    const onVisible = () => { if (document.visibilityState === 'visible') reread() }
    window.addEventListener('focus', reread)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      off()
      window.removeEventListener('focus', reread)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])
  const retryCapabilities = useCallback(() => setCapsRetry(n => n + 1), [])

  const can = useCallback(
    (cap: Capability, orgId?: string | null) => isModerator || capabilityAllows(capSnapshot, cap, orgId),
    [isModerator, capSnapshot],
  )
  // The switch is on but this person's rights could not be read: can() says no to
  // everything, so screens say "could not load" rather than "you may not".
  const capabilitiesUnavailable = capsReady && capsEnforced && !!capsUid && !capSnapshot && !isModerator
  const capabilityGateValue = useMemo(
    () => ({ enforced: capsEnforced, ready: capsReady, can }),
    [capsEnforced, capsReady, can],
  )
  // Set while rendering, before the children render: canCreate (src/lib/nav.ts) reads
  // it in the same pass as the useAuth() values its callers already re-render on.
  setCapabilityGate(capabilityGateValue)

  // ─── signUp ─────────────────────────────────────────────────────────
  const signUp = async (email: string, password: string, persona?: string, firstName?: string, lastName?: string, companyName?: string, companyWebsite?: string, detectedOrgId?: string, jobTitle?: string, captchaToken?: string | null) => {
    // The activation link lands on /welcome first (forced password step), then goes
    // on there. The send-email hook enforces the same for every caller (see
    // src/lib/confirmationLink.ts); this keeps the app's own request consistent.
    const emailRedirectTo = throughWelcome(getStoredInvite()
      ? `${window.location.origin}/join/${getStoredInvite()}?email_confirmed=true`
      : `${window.location.origin}/onboarding?email_confirmed=true`)
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo,
        // Only with a token: with no site key the options stay exactly as before.
        ...(captchaToken ? { captchaToken } : {}),
        data: {
          persona: persona || 'marina',
          first_name: firstName || '',
          last_name: lastName || '',
          company_name: companyName || '',
          company_website: companyWebsite || '',
          detected_org_id: detectedOrgId || '',
          job_title: jobTitle || '',
          // Language of the auth e-mails (send-email hook), re-sends included: English only.
          lang: 'en',
        },
      },
    })

    // With "Confirm email" ON, an address that is already registered comes back
    // without an error, as a placeholder user with no identities (GoTrue hides
    // which addresses exist). That is not a new signup, so admins are not told.
    const isExistingAccount = !error && data.user?.identities?.length === 0

    // Fire-and-forget admin notification for any new signup (does not block or affect auth result)
    if (!error && !isExistingAccount) {
      const fullName = [firstName, lastName].filter(Boolean).join(' ').trim() || email;
      const details = [
        `Email: ${email}`,
        `Persona: ${persona || 'marina'}`,
        jobTitle ? `Job title: ${jobTitle}` : '',
        companyName ? `Company: ${companyName}` : '',
        companyWebsite ? `Website: ${companyWebsite}` : '',
      ].filter(Boolean).join('\n');
      notifyAdmin('new user signup', fullName, details).catch(() => { /* swallow */ });
    }

    // "Confirm email" OFF: GoTrue returns a session at once. ON: no session until
    // the link is opened, so the caller must not route into protected pages.
    return { error: error ?? null, needsConfirmation: !error && !data.session, emailRedirectTo }
  }

  // ─── signIn ─────────────────────────────────────────────────────────
  // The app-wide `loading` flag is NOT turned on here: several pages show a spinner
  // instead of their content while it is on (WelcomePage, /sm26/claim, /sm26/feedback),
  // which unmounted the sign-in form during the attempt and brought it back empty, its
  // error message lost. A successful sign-in still turns it on: supabase-js announces
  // SIGNED_IN (the listener above sets loading and loads the profile) before
  // signInWithPassword returns.
  // Supabase Auth CAPTCHA must stay OFF: only the sign-up form sends a Turnstile
  // token. Sign-in, every password link (resetPasswordForEmail) and every resend
  // send none, so turning CAPTCHA on would lock everyone out (captcha_failed).
  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error: error ?? null }
  }

  // ─── signOut ────────────────────────────────────────────────────────
  const signOut = async () => {
    // Clear per-user selections so nothing carries to the next account.
    try { localStorage.removeItem('m3_pending_invite'); localStorage.removeItem(ACTIVE_ORG_KEY); localStorage.removeItem('sm26_claim_code') } catch (_) { /* ignore */ }
    profileLoadedRef.current = false
    setProfileTimedOut(false)
    setUser(null)
    setSession(null)
    setProfile(null)
    setOrganization(null)
    setOrgRole(null)
    setOrganizations([])
    try {
      await supabase.auth.signOut({ scope: 'local' })
    } catch (e) {
      if (import.meta.env.DEV) console.warn('[AuthContext] signOut error:', e)
    }
  }

  return (
    <AuthContext.Provider value={{
      user, session, loading, profileTimedOut, profile, organization, orgRole, organizations, setActiveOrganization, hasOrganization,
      isVerified, isAdmin, isModerator, isPending, isSponsor, signUp, signIn, signOut, refreshProfile,
      can, capabilitiesEnforced: capsEnforced, capabilitiesReady: capsReady, capabilities: capSnapshot,
      capabilitiesUnavailable, retryCapabilities
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
