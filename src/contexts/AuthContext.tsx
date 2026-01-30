import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

interface Profile {
  id: string;
  user_id: string;
  first_name: string;
  last_name: string;
  email: string;
  job_title: string | null;
  phone: string | null;
  linkedin_url: string | null;
  bio: string | null;
  avatar_url: string | null;
  organization_type: string;
  organization_name: string;
  country: string;
  website: string | null;
  capacity: string | null;
  partnership_tier: 'Main Sponsor' | 'Premium Sponsor' | 'Partner' | 'Associate Partner' | 'Innovation Partner' | 'Media Partner' | null;
  partnership_starts_at: string | null;
  partnership_expires_at: string | null;
  solution_categories: string[];
  company_logo: string | null;
  company_description: string | null;
  is_public: boolean;
  status: 'pending' | 'verified' | 'rejected';
  role: 'user' | 'marina' | 'partner' | 'admin';
  created_at: string;
  updated_at: string;
}

interface AuthContextType {
  user: User | null;
  profile: Profile | null;
  session: Session | null;
  loading: boolean;
  signUp: (email: string, password: string, profileData: Partial<Profile>) => Promise<{ error: Error | null }>;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  updateProfile: (data: Partial<Profile>) => Promise<{ error: Error | null }>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const isResetPasswordPage = () => window.location.pathname === '/reset-password';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = async (userId: string): Promise<Profile | null> => {
    try {
      console.log('Fetching profile for:', userId);
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (error) {
        console.error('Error fetching profile:', error);
        return null;
      }
      console.log('Profile fetched:', data);
      return data as Profile;
    } catch (err) {
      console.error('Exception fetching profile:', err);
      return null;
    }
  };

  const refreshProfile = async () => {
    if (user) {
      const profileData = await fetchProfile(user.id);
      setProfile(profileData);
    }
  };

  useEffect(() => {
    console.log('AuthProvider useEffect running, pathname:', window.location.pathname);
    
    if (isResetPasswordPage()) {
      console.log('On reset password page, skipping auth');
      setLoading(false);
      return;
    }

    const initAuth = async () => {
      try {
        console.log('Getting session...');
        const { data: { session }, error } = await supabase.auth.getSession();
        
        if (error) {
          console.error('Error getting session:', error);
          setLoading(false);
          return;
        }

        console.log('Session:', session ? 'exists' : 'null');
        setSession(session);
        setUser(session?.user ?? null);
        
        if (session?.user) {
          const profileData = await fetchProfile(session.user.id);
          setProfile(profileData);
        }
        
        console.log('Setting loading to false');
        setLoading(false);
      } catch (err) {
        console.error('Exception in initAuth:', err);
        setLoading(false);
      }
    };

    initAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log('Auth state changed:', event);
      
      if (isResetPasswordPage()) {
        return;
      }

      setSession(session);
      setUser(session?.user ?? null);
      
      if (session?.user) {
        const profileData = await fetchProfile(session.user.id);
        setProfile(profileData);
      } else {
        setProfile(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const signUp = async (email: string, password: string, profileData: Partial<Profile>) => {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return { error };

    if (data.user) {
      const role = profileData.organization_type === 'Marina / Port' ? 'marina' : 'user';
      
      const { error: profileError } = await supabase.from('profiles').insert({
        user_id: data.user.id,
        email,
        first_name: profileData.first_name || '',
        last_name: profileData.last_name || '',
        job_title: profileData.job_title || null,
        organization_type: profileData.organization_type || 'Other',
        organization_name: profileData.organization_name || '',
        country: profileData.country || '',
        website: profileData.website || null,
        capacity: profileData.capacity || null,
        role,
        status: 'pending',
        is_public: false,
        solution_categories: [],
      });
      if (profileError) return { error: profileError };
    }
    return { error: null };
  };

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  };

  const signOut = async () => {
    console.log('SignOut called');
    try {
      await supabase.auth.signOut();
      console.log('Supabase signOut completed');
    } catch (err) {
      console.error('SignOut error:', err);
    }
    setUser(null);
    setProfile(null);
    setSession(null);
    window.location.href = '/';
  };

  const updateProfile = async (data: Partial<Profile>) => {
    if (!user) return { error: new Error('No user logged in') };
    const { error } = await supabase.from('profiles').update(data).eq('user_id', user.id);
    if (!error) await refreshProfile();
    return { error };
  };

  console.log('AuthProvider render - loading:', loading, 'user:', !!user, 'profile:', !!profile);

  return (
    <AuthContext.Provider value={{ user, profile, session, loading, signUp, signIn, signOut, updateProfile, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}
