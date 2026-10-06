import { useState, useEffect, useRef } from 'react';
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
import { ResendConfirmationButton, isEmailNotConfirmed } from '@/components/auth/LoginForm';
import { readAuthLanding, scrubAuthLandingUrl } from '@/components/auth/AuthRedirector';
import {
  Building2, Loader2, CheckCircle, Eye, EyeOff, Mail, MailWarning, User, AlertTriangle,
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

// A per-browser marker that this person asked to join invitation <id> (sign-up
// or log-in on this page). localStorage, not sessionStorage: the confirmation
// link opens in a new tab of the same browser. Expires after 7 days.
const JOIN_INTENT_TTL_MS = 7 * 24 * 3600 * 1000;
const joinIntentKey = (id?: string) => `join_intent:${id ?? ''}`;
function markJoinIntent(id?: string) {
  try { localStorage.setItem(joinIntentKey(id), String(Date.now())); } catch { /* storage blocked: the invitee clicks Accept */ }
}
function hasJoinIntent(id?: string): boolean {
  try {
    const at = Number(localStorage.getItem(joinIntentKey(id)));
    return at > 0 && Date.now() - at < JOIN_INTENT_TTL_MS;
  } catch { return false; }
}
function clearJoinIntent(id?: string) {
  try { localStorage.removeItem(joinIntentKey(id)); } catch { /* ignore */ }
}

export function JoinPage() {
  const { inviteId } = useParams<{ inviteId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { user, profile, loading: authLoading, signUp, signIn, refreshProfile } = useAuth();

  const [pageState, setPageState] = useState<PageState>('loading');
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [loading, setLoading] = useState(false);

  // Back from the confirmation link (it lands on /join/<id>?email_confirmed=true).
  // In the browser that signed up, the link signs in; elsewhere it only confirms
  // the address, so the invitee logs in here. 'link-error': expired or used.
  const [landing] = useState(readAuthLanding);
  // The invitee already asked to join ("Create Account & Join", or the link that
  // followed it — even a spent one, e.g. opened first by a mail scanner): accept
  // as soon as the session is there, without a second click.
  // Only when THIS browser asked to join (a marker set by the sign-up / log-in
  // forms below): ?email_confirmed=true is plain text any link can carry, and an
  // owner must not be able to make a signed-in invitee join without a click.
  const [autoAccept, setAutoAccept] = useState(() => landing !== null && hasJoinIntent(inviteId));
  const autoAcceptTried = useRef(false);
  const authSettled = useRef(false);
  // Where a re-sent activation link should land: back here (as AuthContext.signUp sets it).
  const joinConfirmRedirect = `${window.location.origin}/join/${inviteId}?email_confirmed=true`;

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
  const [loginUnconfirmed, setLoginUnconfirmed] = useState(false);

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

      const orgName = data.organization_name || t('joinInvite.fallbackOrg', 'Organization');
      // The RPC fills a nameless inviter with the English 'A team member' itself:
      // treat that as missing so the fallback shows in the visitor's language.
      const inviterName = data.inviter_name && data.inviter_name !== 'A team member'
        ? data.inviter_name
        : t('joinInvite.fallbackInviter', 'A team member');

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
          toast({
            title: t('joinInvite.alreadyAcceptedTitle', 'Invitation already accepted'),
            description: t('joinInvite.alreadyAcceptedDesc', 'You have already joined this organization.'),
          });
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
            title: t('joinInvite.wrongAccountTitle', 'Wrong account'),
            description: t(
              'joinInvite.wrongAccountDesc',
              'This invitation is for {{inviteEmail}}. You are logged in as {{currentEmail}}. Please log out first or share the link with the right person.',
              { inviteEmail: info.email, currentEmail: userEmail },
            ),
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
        // with a "Already have an account? Log in" toggle.
        // Back from the confirmation link, the account exists: straight to login.
        setPageState(landing ? 'login' : 'signup');
      }
    };

    loadInvite();
  }, [inviteId]);

  // ── If user logs in while on this page, switch to accept state ──
  // Only from the sign-up / login forms: an invalid invitation stays an error.
  useEffect(() => {
    if (user && profile && invite && (pageState === 'signup' || pageState === 'login')) {
      setPageState('accept');
    }
  }, [user?.id, profile?.user_id, invite?.id, pageState]);

  // ── Confirmation link opened without a session here: tidy the URL it left ──
  useEffect(() => {
    if (landing && !authLoading && !user) scrubAuthLandingUrl();
  }, [authLoading, user?.id]);

  // ── Handle signup ──
  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invite) return;
    markJoinIntent(inviteId);
    if (!acceptTerms) {
      toast({
        title: t('joinInvite.termsRequired', 'Terms required'),
        description: t('auth.acceptTermsRequired', 'Please accept the Terms and Conditions'),
        variant: 'destructive',
      });
      return;
    }
    if (password !== confirmPassword) {
      toast({ title: t('auth.passwordMismatch', 'Passwords do not match'), variant: 'destructive' });
      return;
    }
    if (password.length < 8 || !/[A-Z]/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
      toast({
        title: t('joinInvite.weakPassword', 'Weak password'),
        description: t('auth.passwordWeak', 'Password must be at least 8 characters and include one uppercase letter and one symbol.'),
        variant: 'destructive',
      });
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

    const { error, needsConfirmation } = await signUp(
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
        toast({
          title: t('joinInvite.accountExists', 'Account exists'),
          description: t('auth.accountAlreadyExists', 'An account with this email already exists. Please log in instead.'),
          variant: 'destructive',
        });
        setPageState('login');
      } else {
        toast({ title: t('joinInvite.signupError', 'Signup error'), description: error.message, variant: 'destructive' });
      }
      return;
    }

    if (needsConfirmation) {
      // "Confirm email" ON: no session until the e-mailed link is opened. It
      // lands back on this page, which then finishes joining.
      setPageState('check-email');
      return;
    }

    // Signed in at once ("Confirm email" OFF): nothing to confirm, join now.
    setAutoAccept(true);
    setPageState('accept');
  };

  // ── Handle login (existing user) ──
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invite) return;
    markJoinIntent(inviteId);
    setLoading(true);

    const { error } = await signIn(invite.email, loginPassword);
    setLoading(false);

    if (isEmailNotConfirmed(error)) {
      // Explained under the form, with a way to get the activation link again.
      setLoginUnconfirmed(true);
      return;
    }
    if (error) {
      toast({ title: t('joinInvite.loginError', 'Login error'), description: error.message, variant: 'destructive' });
      return;
    }

    // Clicking "Log in & Join" is the invitee's own consent: join as soon as the
    // accept state is reached (same e-mail checks as before), no second click.
    setAutoAccept(true);
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
      toast({
        title: t('joinInvite.welcomeTitle', 'Welcome!'),
        description: t('org.joined', 'You have joined {{orgName}}!', { orgName: invite.organization_name }),
      });
      navigate('/account', { replace: true });
    } catch (err: unknown) {
      toast({
        title: t('joinInvite.joinError', 'Error joining'),
        description: err instanceof Error ? err.message : t('common.error', 'An error occurred'),
        variant: 'destructive',
      });
    }
    setAccepting(false);
  };

  // ── Auto-accept, once, when the invitee already asked to join (see autoAccept) ──
  useEffect(() => {
    if (!autoAccept || autoAcceptTried.current || pageState !== 'accept') return;
    if (!invite || !user || !profile) return;
    if (user.email?.toLowerCase() !== invite.email.toLowerCase()) return;
    autoAcceptTried.current = true;
    clearJoinIntent(inviteId);
    handleAccept();
  }, [autoAccept, pageState, invite?.id, user?.id, profile?.user_id]);

  // ── Org header card (shown in all states) ──
  const OrgHeader = () => (
    <div className="text-center mb-6">
      <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-4">
        <Building2 className="h-8 w-8 text-primary" />
      </div>
      <h1 className="text-2xl font-bold text-gray-900 mb-1">
        {t('joinInvite.title', 'Join {{org}}', { org: invite?.organization_name ?? '' })}
      </h1>
      <p className="text-gray-500 text-sm">
        {t('joinInvite.subtitle', '{{inviter}} invited you to join their organization on Smart Marina Connect', { inviter: invite?.inviter_name ?? '' })}
      </p>
    </div>
  );

  // ── Loading state ──
  // Back from the confirmation link, wait for auth to settle once: in the browser
  // that signed up the link brings a session, and the login form must not flash
  // first. Only the first time — a sign-in from the form flips `loading` again.
  // Signed in while a form is still up (the invite loaded before the session
  // did): the effect above switches to 'accept' right after this render, so don't
  // mount the form — or its autoFocus — for that one frame.
  if (!authLoading) authSettled.current = true;
  const switchingToAccept = (pageState === 'signup' || pageState === 'login') && !!user && !!profile && !!invite;
  if (pageState === 'loading' || (landing && !authSettled.current) || switchingToAccept) {
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
            <h2 className="text-xl font-bold text-gray-900">{t('joinInvite.invalidTitle', 'Invalid or Expired Invitation')}</h2>
            <p className="text-gray-500 text-sm">
              {t('joinInvite.invalidDesc', 'This invitation link is no longer valid. It may have expired or already been used. Please ask the organization owner to send a new invitation.')}
            </p>
            <Button onClick={() => navigate('/')} variant="outline">
              {t('common.goHome', 'Go to Homepage')}
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
            <h2 className="text-xl font-bold text-gray-900">{t('auth.checkInboxTitle', 'Check your inbox')}</h2>
            <div className="space-y-1">
              <p className="text-gray-500 text-sm">{t('auth.checkInboxSentTo', 'We sent an activation link to:')}</p>
              <p className="text-sm font-semibold text-gray-900 break-all">{invite?.email}</p>
            </div>
            <p className="text-gray-500 text-sm">
              {t('joinInvite.checkInboxOpenLink', 'Open the link in that e-mail to activate your account and join {{org}}.', { org: invite?.organization_name })}
            </p>
            <p className="text-xs text-gray-400">
              {t('auth.checkInboxSpam', 'Nothing after a few minutes? Check your spam or junk folder. If you already have an account with this address, log in instead.')}
            </p>
            {invite && (
              <ResendConfirmationButton email={invite.email} redirectTo={joinConfirmRedirect} justSent />
            )}
            <div className="pt-2">
              <Button variant="outline" size="sm" onClick={() => setPageState('login')}>
                {t('joinInvite.confirmedLogIn', "I've confirmed my e-mail — Log in")}
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
                <><Loader2 className="h-4 w-4 animate-spin mr-2" /> {t('joinInvite.joining', 'Joining...')}</>
              ) : (
                <><CheckCircle className="h-4 w-4 mr-2" /> {t('joinInvite.acceptAndJoin', 'Accept & Join {{org}}', { org: invite?.organization_name ?? '' })}</>
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
            {landing === 'confirmed' && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-green-50 border border-green-200 text-sm">
                <CheckCircle className="h-4 w-4 text-green-600 shrink-0" />
                <span className="text-green-800">{t('auth.emailConfirmedLogin', 'Your e-mail is confirmed. Log in to continue.')}</span>
              </div>
            )}
            {landing === 'link-error' && invite && (
              <div className="space-y-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="font-medium text-amber-900">{t('auth.linkInvalidTitle', 'This link no longer works')}</p>
                    <p className="text-amber-800">
                      {t('joinInvite.linkInvalidDesc', 'It may have expired, or it was already used (some mail filters open links before you do). Try logging in first: if your address is confirmed, that is all you need. Otherwise, ask for a new link.')}
                    </p>
                  </div>
                </div>
                <ResendConfirmationButton email={invite.email} redirectTo={joinConfirmRedirect} label={t('auth.sendNewLink', 'Send me a new link')} />
              </div>
            )}
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label>{t('auth.email', 'Email')}</Label>
                <Input value={invite?.email || ''} disabled className="bg-gray-50" />
              </div>
              <div className="space-y-2">
                <Label>{t('auth.password', 'Password')}</Label>
                <div className="relative">
                  <Input
                    type={showLoginPassword ? 'text' : 'password'}
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    required
                    placeholder={t('joinInvite.loginPasswordPlaceholder', 'Enter your password')}
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
                {t('joinInvite.loginAndJoin', 'Log in & Join')}
              </Button>
              {loginUnconfirmed && invite && (
                <div className="space-y-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm" role="alert">
                  <div className="flex items-start gap-2">
                    <MailWarning className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                    <span className="text-amber-900">
                      {t('auth.emailNotConfirmed', 'This e-mail address is not confirmed yet. Open the activation link we sent you, then log in. Nothing in your inbox or spam folder? Send it again.')}
                    </span>
                  </div>
                  <ResendConfirmationButton email={invite.email} redirectTo={joinConfirmRedirect} />
                </div>
              )}
            </form>
            <p className="text-center text-xs text-gray-400">
              {t('auth.noAccount', "Don't have an account?")}{' '}
              <button type="button" onClick={() => setPageState('signup')} className="text-primary hover:underline font-medium">
                {t('auth.signup', 'Sign Up')}
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
              <Label>{t('auth.email', 'Email')}</Label>
              <Input value={invite?.email || ''} disabled className="bg-gray-50" />
              <p className="text-xs text-gray-400">{t('joinInvite.emailHint', 'This is the email the invitation was sent to')}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>{t('auth.firstName', 'First Name')} *</Label>
                <Input
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  required
                  placeholder={t('auth.firstNamePlaceholder', 'John')}
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label>{t('auth.lastName', 'Last Name')} *</Label>
                <Input
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  required
                  placeholder={t('auth.lastNamePlaceholder', 'Doe')}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t('auth.password', 'Password')} *</Label>
              <div className="relative">
                <Input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  placeholder={t('joinInvite.createPasswordPlaceholder', 'Create a password')}
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
              <p className="text-xs text-gray-400">{t('auth.passwordRules', 'Min. 8 characters, 1 uppercase letter, 1 symbol')}</p>
            </div>
            <div className="space-y-2">
              <Label>{t('auth.confirmPassword', 'Confirm Password')} *</Label>
              <Input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                placeholder={t('auth.confirmPassword', 'Confirm Password')}
              />
              {confirmPassword && password !== confirmPassword && (
                <p className="text-xs text-red-600">{t('auth.passwordMismatch', 'Passwords do not match')}</p>
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
                {t('auth.acceptTerms', 'I accept the')}{' '}
                <a href="/terms" target="_blank" className="text-primary hover:underline font-medium">{t('auth.termsAndConditions', 'Terms and Conditions')}</a>
                {' '}{t('auth.andThe', 'and the')}{' '}
                <a href="/privacy" target="_blank" className="text-primary hover:underline font-medium">{t('auth.privacyPolicy', 'Privacy Policy')}</a>
              </label>
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading
                ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> {t('auth.creating', 'Creating...')}</>
                : t('joinInvite.createAndJoin', 'Create Account & Join')}
            </Button>
          </form>
          <p className="text-center text-xs text-gray-400">
            {t('auth.haveAccount', 'Already have an account?')}{' '}
            <button type="button" onClick={() => setPageState('login')} className="text-primary hover:underline font-medium">
              {t('auth.login', 'Login')}
            </button>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
