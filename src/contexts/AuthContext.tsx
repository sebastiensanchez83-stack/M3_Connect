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
  // New partnership fields
  partnership_tier: 'Main Sponsor' | 'Premium Sponsor' | 'Partner' | 'Associate Partner' | 'Innovation Partner' | 'Media Partner' | null;
  partnership_starts_at: string | null;
  partnership_expires_at: string | null;
  solution_categories: string[];
  company_logo: string | null;
  company_description: string | null;
  is_public: boolean;
  // New validation system
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

  const fetchProfile = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (error) {
        console.error('Error fetching profile:', error);
        return null;
      }
      return data as Profile;
    } catch {
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
    if (isResetPasswordPage()) {
      setLoading(false);
      return;
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user.id).then(setProfile);
      }
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
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
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signUp = async (email: string, password: string, profileData: Partial<Profile>) => {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return { error };

    if (data.user) {
      // Determine role based on organization type
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
        status: 'pending', // All new users need admin approval
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
    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        console.error('SignOut error:', error);
      }
      setUser(null);
      setProfile(null);
      setSession(null);
      window.location.href = '/';
    } catch (err) {
      console.error('SignOut exception:', err);
      window.location.href = '/';
    }
  };

  const updateProfile = async (data: Partial<Profile>) => {
    if (!user) return { error: new Error('No user logged in') };
    const { error } = await supabase.from('profiles').update(data).eq('user_id', user.id);
    if (!error) await refreshProfile();
    return { error };
  };

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
