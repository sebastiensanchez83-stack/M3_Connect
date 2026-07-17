import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { clearStoredInvite } from '@/lib/invite-store';
import {
  Building2, Loader2, CheckCircle, Eye, EyeOff, Mail, User, AlertTriangle,
} from 'lucide-react';

type PageState = 'loading' | 'signup' | 'login' | 'accept' | 'check-email' | 'error';

interface InviteInfo {
  id: string;
  email: string;
  organization_id: string;
  organization_name: string;
  inviter_name: string;
  status: string;
}

export function JoinPage() {
  const { inviteId } = useParams<{ inviteId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { user, profile, signUp, signIn, refreshProfile } = useAuth();

  const [pageState, setPageState] = useState<PageState>('loading');
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [loading, setLoading] = useState(false);

  // Signup form
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(false);

  // Login form
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);

  // Accept state
  const [accepting, setAccepting] = useState(false);

  // ── Load invitation details ──
  useEffect(() => {
    if (!inviteId) { setPageState('error'); return; }

    const loadInvite = async () => {
      // This page is pre-auth, so it can't read organization_invitations directly
      // (that table is no longer world-readable). get_invitation_for_join returns
      // exactly this invite — keyed on the id from the emailed link, which acts as
      // the token — plus the org and inviter names, in one call.
      const { data: rows, error } = await supabase
        .rpc('get_invitation_for_join', { p_invitation_id: inviteId });
      const data = (Array.isArray(rows) ? rows[0] : rows) as {
        id: string; email: string; organization_id: string; organization_name: string | null;
        status: string; first_name: string | null; last_name: string | null; inviter_name: string | null;
      } | undefined;

      if (error || !data) {
        if (import.meta.env.DEV) console.error('[JoinPage] Invitation fetch error:', error);
        setPageState('error');
        return;
      }

      const orgName = data.organization_name || 'Organization';
      const inviterName = data.inviter_name || 'A team member';

      const info: InviteInfo = {
        id: data.id,
        email: data.email,
        organization_id: data.organization_id,
        organization_name: orgName,
        inviter_name: inviterName,
        status: data.status,
      };

      setInvite(info);

      if (info.status !== 'pending') {
        // Already accepted/expired/cancelled
        if (info.status === 'accepted') {
          toast({ title: 'Invitation already accepted', description: 'You have already joined this organization.' });
          navigate('/account', { replace: true });
        } else {
          setPageState('error');
        }
        return;
      }

      // Store invite in localStorage for persistence through auth flows
      // Uses same key as invite-store.ts ('m3_pending_invite')
      localStorage.setItem('m3_pending_invite', inviteId!);

      // Determine: is user logged in? do they need signup or login?
      if (user && profile) {
        // Check if logged-in user's email matches the invitation
        const userEmail = user.email?.toLowerCase();
        const inviteEmail = info.email.toLowerCase();
        if (userEmail && userEmail !== inviteEmail) {
          // Wrong account — clear invite and redirect to account
          clearStoredInvite();
          toast({
            title: 'Wrong account',
            description: `This invitation is for ${info.email}. You are logged in as ${userEmail}. Please log out first or share the link with the right person.`,
            variant: 'destructive',
          });
          navigate('/account', { replace: true });
          return;
        }
        // Correct account — show accept button
        setPageState('accept');
      } else {
        // Check if this email already has an account
        // We can't query auth.users from client, so we'll show signup by default
        // with a "Already have an account? Log in" toggle
        setPageState('signup');
      }
    };

    loadInvite();
  }, [inviteId]);

  // ── If user logs in while on this page, switch to accept state ──
  useEffect(() => {
    if (user && profile && invite && pageState !== 'accept' && pageState !== 'check-email') {
      setPageState('accept');
    }
  }, [user, profile, invite]);

  // ── Handle signup ──
  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invite) return;
    if (!acceptTerms) {
      toast({ title: 'Terms required', description: 'Please accept the Terms and Conditions.', variant: 'destructive' });
      return;
    }
    if (password !== confirmPassword) {
      toast({ title: 'Passwords don\'t match', variant: 'destructive' });
      return;
    }
    if (password.length < 8 || !/[A-Z]/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
      toast({ title: 'Weak password', description: 'At least 8 characters, one uppercase, one symbol.', variant: 'destructive' });
      return;
    }

    setLoading(true);

    // Determine persona from the organization type
    const { data: orgData } = await supabase
      .from('organizations')
      .select('organization_type')
      .eq('id', invite.organization_id)
      .single();
    const persona = orgData?.organization_type || 'marina';

    const { error } = await signUp(
      invite.email,
      password,
      persona,
      firstName.trim(),
      lastName.trim(),
      invite.organization_name,
      '',
      invite.organization_id,
    );

    setLoading(false);

    if (error) {
      if (error.message?.includes('already registered')) {
        toast({ title: 'Account exists', description: 'This email already has an account. Please log in.', variant: 'destructive' });
        setPageState('login');
      } else {
        toast({ title: 'Signup error', description: error.message, variant: 'destructive' });
      }
      return;
    }

    setPageState('check-email');
  };

  // ── Handle login (existing user) ──
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invite) return;
    setLoading(true);

    const { error } = await signIn(invite.email, loginPassword);
    setLoading(false);

    if (error) {
      toast({ title: 'Login error', description: error.message, variant: 'destructive' });
      return;
    }

    // After login, useEffect will switch to 'accept' state
  };

  // ── Handle accept invitation ──
  const handleAccept = async () => {
    if (!invite || !user) return;
    setAccepting(true);
    try {
      const { error } = await supabase.rpc('accept_org_invitation', {
        p_invitation_id: invite.id,
      });
      if (error) throw error;

      clearStoredInvite();
      await refreshProfile();
      toast({ title: 'Welcome!', description: `You've joined ${invite.organization_name}` });
      navigate('/account', { replace: true });
    } catch (err: unknown) {
      toast({
        title: 'Error joining',
        description: err instanceof Error ? err.message : 'Something went wrong.',
        variant: 'destructive',
      });
    }
    setAccepting(false);
  };

  // ── Org header card (shown in all states) ──
  const OrgHeader = () => (
    <div className="text-center mb-6">
      <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-4">
        <Building2 className="h-8 w-8 text-primary" />
      </div>
      <h1 className="text-2xl font-bold text-gray-900 mb-1">
        Join {invite?.organization_name}
      </h1>
      <p className="text-gray-500 text-sm">
        {invite?.inviter_name} invited you to join their organization on Smart Marina Connect
      </p>
    </div>
  );

  // ── Loading state ──
  if (pageState === 'loading') {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // ── Error state ──
  if (pageState === 'error') {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-8 text-center space-y-4">
            <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto" />
            <h2 className="text-xl font-bold text-gray-900">Invalid or Expired Invitation</h2>
            <p className="text-gray-500 text-sm">
              This invitation link is no longer valid. It may have expired or already been used.
              Please ask the organization owner to send a new invitation.
            </p>
            <Button onClick={() => navigate('/')} variant="outline">
              Go to Homepage
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Check email state (after signup) ──
  if (pageState === 'check-email') {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-8 text-center space-y-4">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-100 mx-auto">
              <Mail className="h-8 w-8 text-green-600" />
            </div>
            <h2 className="text-xl font-bold text-gray-900">Check Your Email</h2>
            <p className="text-gray-500 text-sm">
              We sent a confirmation link to <strong>{invite?.email}</strong>.
              Click the link in the email to verify your account, then come back and log in to join <strong>{invite?.organization_name}</strong>.
            </p>
            <div className="pt-2">
              <Button variant="outline" size="sm" onClick={() => setPageState('login')}>
                I've confirmed my email — Log in
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Accept state (logged in user) ──
  if (pageState === 'accept') {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-8 space-y-6">
            <OrgHeader />
            <div className="bg-gray-50 rounded-lg p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">
                {(profile?.first_name?.[0] || user?.email?.[0] || 'U').toUpperCase()}
              </div>
              <div>
                <div className="font-medium text-gray-900">
                  {profile?.first_name} {profile?.last_name}
                </div>
                <div className="text-xs text-gray-500">{user?.email}</div>
              </div>
            </div>
            <Button className="w-full" size="lg" onClick={handleAccept} disabled={accepting}>
              {accepting ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Joining...</>
              ) : (
                <><CheckCircle className="h-4 w-4 mr-2" /> Accept & Join {invite?.organization_name}</>
              )}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Login state (existing user) ──
  if (pageState === 'login') {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-8 space-y-6">
            <OrgHeader />
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label>Email</Label>
                <Input value={invite?.email || ''} disabled className="bg-gray-50" />
              </div>
              <div className="space-y-2">
                <Label>Password</Label>
                <div className="relative">
                  <Input
                    type={showLoginPassword ? 'text' : 'password'}
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    required
                    placeholder="Enter your password"
                    className="pr-10"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowLoginPassword(!showLoginPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    tabIndex={-1}
                  >
                    {showLoginPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Log in & Join
              </Button>
            </form>
            <p className="text-center text-xs text-gray-400">
              Don't have an account?{' '}
              <button type="button" onClick={() => setPageState('signup')} className="text-primary hover:underline font-medium">
                Sign up
              </button>
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Signup state (new user) ──
  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4 py-8">
      <Card className="w-full max-w-md">
        <CardContent className="pt-8 space-y-6">
          <OrgHeader />
          <form onSubmit={handleSignup} className="space-y-4">
            <div className="space-y-2">
              <Label>Email</Label>
              <Input value={invite?.email || ''} disabled className="bg-gray-50" />
              <p className="text-xs text-gray-400">This is the email the invitation was sent to</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>First Name *</Label>
                <Input
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  required
                  placeholder="John"
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label>Last Name *</Label>
                <Input
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  required
                  placeholder="Doe"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Password *</Label>
              <div className="relative">
                <Input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  placeholder="Create a password"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <p className="text-xs text-gray-400">Min. 8 characters, 1 uppercase, 1 symbol</p>
            </div>
            <div className="space-y-2">
              <Label>Confirm Password *</Label>
              <Input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                placeholder="Confirm password"
              />
              {confirmPassword && password !== confirmPassword && (
                <p className="text-xs text-red-600">Passwords don't match</p>
              )}
            </div>
            <div className="flex items-start gap-2.5">
              <Checkbox
                id="join-terms"
                checked={acceptTerms}
                onCheckedChange={(c) => setAcceptTerms(c === true)}
                className="mt-0.5"
              />
              <label htmlFor="join-terms" className="text-xs text-gray-600 leading-snug cursor-pointer">
                I accept the{' '}
                <a href="/terms" target="_blank" className="text-primary hover:underline font-medium">Terms</a>
                {' '}and{' '}
                <a href="/privacy" target="_blank" className="text-primary hover:underline font-medium">Privacy Policy</a>
              </label>
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Creating account...</> : 'Create Account & Join'}
            </Button>
          </form>
          <p className="text-center text-xs text-gray-400">
            Already have an account?{' '}
            <button type="button" onClick={() => setPageState('login')} className="text-primary hover:underline font-medium">
              Log in
            </button>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
