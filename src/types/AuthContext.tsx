import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import {
  Profile, MarinaProfile, PartnerProfile, MediaPartnerProfile,
  UserDetails, PersonaType,
} from '@/types/database';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  profile: Profile | null;
  userDetails: UserDetails | null;
  isVerified: boolean;
  isModerator: boolean;
  signUp: (email: string, password: string, persona: PersonaType) => Promise<{ error: Error | null }>;
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

  const fetchUserData = async (userId: string): Promise<{ profile: Profile | null; details: UserDetails | null }> => {
    try {
      const { data: profileData, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (error || !profileData) return { profile: null, details: null };

      let details: UserDetails | null = null;
      if (profileData.persona === 'marina') {
        const { data } = await supabase.from('marina_profiles').select('*').eq('user_id', userId).maybeSingle();
        details = data as MarinaProfile | null;
      } else if (profileData.persona === 'partner') {
        const { data } = await supabase.from('partner_profiles').select('*').eq('user_id', userId).maybeSingle();
        details = data as PartnerProfile | null;
      } else if (profileData.persona === 'media_partner') {
        const { data } = await supabase.from('media_partner_profiles').select('*').eq('user_id', userId).maybeSingle();
        details = data as MediaPartnerProfile | null;
      }

      return { profile: profileData as Profile, details };
    } catch {
      return { profile: null, details: null };
    }
  };

  const refreshProfile = async () => {
    if (user) {
      const { profile: p, details } = await fetchUserData(user.id);
      setProfile(p);
      setUserDetails(details);
    }
  };

  useEffect(() => {
    if (isResetPasswordPage()) { setLoading(false); return; }

    let isMounted = true;

    const initAuth = async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        if (error || !isMounted) { setLoading(false); return; }
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          const { profile: p, details } = await fetchUserData(session.user.id);
          if (isMounted) { setProfile(p); setUserDetails(details); }
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    initAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_, session) => {
      if (!isMounted || isResetPasswordPage()) return;
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        const { profile: p, details } = await fetchUserData(session.user.id);
        if (isMounted) { setProfile(p); setUserDetails(details); }
      } else {
        setProfile(null); setUserDetails(null);
      }
      if (isMounted) setLoading(false);
    });

    return () => { isMounted = false; subscription.unsubscribe(); };
  }, []);

  const signUp = async (email: string, password: string, persona: PersonaType): Promise<{ error: Error | null }> => {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return { error };
    if (!data.user) return { error: new Error('No user returned') };

    const { error: profileError } = await supabase.from('profiles').insert({
      user_id: data.user.id, persona, access_status: 'pending', onboarding_status: 'draft',
    });
    if (profileError) return { error: profileError };

    if (persona === 'marina') {
      await supabase.from('marina_profiles').insert({ user_id: data.user.id, marina_name: '' });
    } else if (persona === 'partner') {
      await supabase.from('partner_profiles').insert({ user_id: data.user.id, company_name: '' });
    } else if (persona === 'media_partner') {
      await supabase.from('media_partner_profiles').insert({ user_id: data.user.id, media_name: '' });
    }

    return { error: null };
  };

  const signIn = async (email: string, password: string): Promise<{ error: Error | null }> => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null); setProfile(null); setUserDetails(null); setSession(null);
    window.location.href = '/';
  };

  return (
    <AuthContext.Provider value={{
      user, session, loading, profile, userDetails, isVerified, isModerator,
      signUp, signIn, signOut, refreshProfile,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}
