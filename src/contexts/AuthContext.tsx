import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import {
  Profile,
  MarinaProfile,
  PartnerProfile,
  MediaPartnerProfile,
  UserDetails,
} from '@/types/database';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  profile: Profile | null;
  userDetails: UserDetails | null;
  isVerified: boolean;
  isModerator: boolean;

  // ✅ Generic signup now (no persona here)
  signUp: (email: string, password: string) => Promise<{ error: Error | null }>;

  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const isResetPasswordPage = () => window.location.pathname === '/reset-password';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [userDetails, setUserDetails] = useState<UserDetails | null>(null);
  const [loading, setLoading] = useState(true);

  const isVerified = profile?.access_status === 'verified';
  const isModerator = profile?.persona === 'moderator' && isVerified;

  const fetchUserData = useCallback(async (userId: string): Promise<{ profile: Profile | null; details: UserDetails | null }> => {
    try {
      const { data: profileData, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (error || !profileData) return { profile: null, details: null };

      const p = profileData as Profile;

      // Pull persona-specific details (optional)
      let details: UserDetails | null = null;

      if (p.persona === 'marina') {
        const { data } = await supabase.from('marina_profiles').select('*').eq('user_id', userId).maybeSingle();
        details = (data as MarinaProfile) ?? null;
      } else if (p.persona === 'partner') {
        const { data } = await supabase.from('partner_profiles').select('*').eq('user_id', userId).maybeSingle();
        details = (data as PartnerProfile) ?? null;
      } else if (p.persona === 'media_partner') {
        const { data } = await supabase.from('media_partner_profiles').select('*').eq('user_id', userId).maybeSingle();
        details = (data as MediaPartnerProfile) ?? null;
      } else {
        details = null;
      }

      return { profile: p, details };
    } catch (e) {
      console.error('[AuthContext] fetchUserData error:', e);
      return { profile: null, details: null };
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!user) return;

    const { profile: p, details } = await fetchUserData(user.id);
    setProfile(p);
    setUserDetails(details);
  }, [fetchUserData, user]);

  useEffect(() => {
    if (isResetPasswordPage()) { setLoading(false); return; }

    let isMounted = true;

    // Safety timeout: if Supabase auth hangs, force loading false after 5s
    const safetyTimeout = setTimeout(() => {
      if (isMounted) setLoading(false);
    }, 5000);

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      if (!isMounted) return;

      setSession(newSession);
      setUser(newSession?.user ?? null);

      if (newSession?.user) {
        const { profile: p, details } = await fetchUserData(newSession.user.id);
        if (isMounted) {
          setProfile(p);
          setUserDetails(details);
        }
      } else {
        setProfile(null);
        setUserDetails(null);
      }

      if (isMounted) setLoading(false);
    });

    return () => {
      isMounted = false;
      clearTimeout(safetyTimeout);
      subscription.unsubscribe();
    };
  }, [fetchUserData]);

  // ✅ Generic signup only (no DB inserts here)
  const signUp = async (email: string, password: string): Promise<{ error: Error | null }> => {
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) return { error };
    return { error: null };
  };

  const signIn = async (email: string, password: string): Promise<{ error: Error | null }> => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  };

  const signOut = async () => {
    try {
      await supabase.auth.signOut();
    } catch (error) {
      console.error('[AuthContext] signOut error:', error);
    }

    // Always clear local state
    setUser(null);
    setProfile(null);
    setUserDetails(null);
    setSession(null);
  };

  return (
    <AuthContext.Provider value={{
      user,
      session,
      loading,
      profile,
      userDetails,
      isVerified,
      isModerator,
      signUp,
      signIn,
      signOut,
      refreshProfile,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
