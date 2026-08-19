import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/lib/supabase';
import type { EmailOtpType } from '@supabase/supabase-js';
import { Loader2, CheckCircle, AlertCircle } from 'lucide-react';

const OTP_TYPES = ['recovery', 'invite', 'magiclink', 'signup', 'email_change'];

export function ResetPasswordPage() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [checking, setChecking] = useState(true);
  // Only set when the link came from an in-app flow that wants the user back on
  // a particular page (the account page's "change my password" button).
  const [next, setNext] = useState<string | null>(null);
  const [resendEmail, setResendEmail] = useState('');
  const [resendBusy, setResendBusy] = useState(false);
  const [resent, setResent] = useState(false);

  useEffect(() => {
    let mounted = true;

    const url = new URL(window.location.href);
    const tokenHash = url.searchParams.get('token_hash');
    const typeParam = url.searchParams.get('type');
    const code = url.searchParams.get('code');
    // Where to land afterwards. Supabase substitutes an absolute URL here, so
    // accept both forms — but resolve against our own origin and keep only the
    // path, so an email can never bounce someone off-site.
    const nextParam = url.searchParams.get('next');
    if (nextParam) {
      try {
        const target = new URL(nextParam, window.location.origin);
        if (target.origin === window.location.origin && target.pathname !== '/reset-password') {
          setNext(target.pathname + target.search);
        }
      } catch {
        /* unparseable — ignore and fall back to the default landing */
      }
    }

    // Once the credential is spent, take it out of the address bar so a
    // copied or bookmarked URL carries nothing usable.
    const scrubUrl = () => window.history.replaceState({}, '', window.location.pathname);

    const ready = () => {
      if (!mounted) return;
      setSessionReady(true);
      setChecking(false);
      scrubUrl();
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      if (session && (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN')) ready();
    });

    void (async () => {
      // 1. token_hash — the recovery email's own path. It is verified server-side,
      // so it resolves in ANY browser on ANY device. This is what makes a link an
      // admin sent, or one requested on a laptop and opened on a phone, work at all.
      if (tokenHash) {
        const type: EmailOtpType =
          typeParam && OTP_TYPES.includes(typeParam) ? (typeParam as EmailOtpType) : 'recovery';
        const { data, error: otpError } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
        if (!mounted) return;
        if (data?.session) { ready(); return; }
        if (otpError) console.error('verifyOtp failed:', otpError.message);
      }

      // 2. PKCE code — resolvable ONLY in the browser that requested the link,
      // because the code verifier never leaves that browser's storage. Kept so
      // links already in flight, and any flow still using redirectTo, still land.
      if (code) {
        const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (!mounted) return;
        if (data?.session) { ready(); return; }
        if (exchangeError) console.error('Code exchange failed:', exchangeError.message);
      }

      // 3. An implicit-flow hash fragment needs no call here: detectSessionInUrl
      // consumes it and the session arrives through onAuthStateChange above.

      // 4. Already signed in and no credential in the URL — e.g. changing the
      // password from the account page. Deliberately NOT a fallback for a link
      // that failed: an admin who sends a link from their own browser and then
      // clicks it would otherwise be handed a form that changes THEIR password.
      // A link that does not verify must fail, whoever happens to be signed in.
      if (!tokenHash && !code) {
        const { data: { session } } = await supabase.auth.getSession();
        if (!mounted) return;
        if (session) { ready(); return; }
      }

      // Nothing resolved outright. Give the hash-fragment listener a moment if a
      // fragment is actually present; otherwise fail fast rather than making
      // someone watch a spinner for fifteen seconds to be told no.
      const hasHash =
        window.location.hash.includes('access_token') || window.location.hash.includes('type=recovery');
      setTimeout(() => { if (mounted) setChecking(false); }, hasHash ? 6000 : 1200);
    })();

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const requestNewLink = async () => {
    const email = resendEmail.trim().toLowerCase();
    if (!email) return;
    setResendBusy(true);
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setResendBusy(false);
    // Reported the same way whether or not the address has an account — which
    // addresses are registered is not ours to disclose.
    setResent(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // The recovery session is established by now. Clearing pw_pending matters:
      // an event-provisioned account that resets its password here has done the
      // welcome step's job, and AuthRedirector would otherwise keep bouncing it
      // back to /welcome to "set a password" on every navigation.
      const { error: updateError } = await supabase.auth.updateUser({
        password,
        data: { pw_pending: false },
      });

      if (updateError) {
        setError(updateError.message);
        setLoading(false);
        return;
      }

      setSuccess(true);

      if (next) {
        // In-app change: they were already signed in, so keep them signed in and
        // put them back where they started.
        setTimeout(() => { window.location.href = next; }, 1500);
      } else {
        // Recovery from an email link: sign out so the new password gets used once,
        // which confirms to them that it works.
        await supabase.auth.signOut();
        setTimeout(() => { window.location.href = '/'; }, 2000);
      }
    } catch {
      setError('An error occurred. Please try again.');
      setLoading(false);
    }
  };

  // Still working out whether the link carried a usable session
  if (checking && !sessionReady) {
    return (
      <div className="container mx-auto px-4 py-16 max-w-md">
        <Card>
          <CardContent className="pt-6 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-4" />
            <p className="text-gray-600">Verifying your reset link...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // No session — the link was already used, has expired, or was opened after a
  // newer one replaced it. Let them fix it here instead of sending them away.
  if (!sessionReady) {
    return (
      <div className="container mx-auto px-4 py-16 max-w-md">
        <Card>
          <CardContent className="pt-6">
            {resent ? (
              <div className="text-center">
                <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
                <h2 className="text-xl font-semibold mb-2">Check your inbox</h2>
                <p className="text-gray-600 mb-4">
                  If {resendEmail.trim().toLowerCase()} has an account, a new link is on its way. It is
                  good for one use — open it on this device, and check your spam folder if it hasn't
                  arrived in a few minutes.
                </p>
                <Button variant="outline" onClick={() => (window.location.href = '/')}>Return Home</Button>
              </div>
            ) : (
              <>
                <div className="text-center">
                  <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
                  <h2 className="text-xl font-semibold mb-2">This link can't be used</h2>
                  <p className="text-gray-600 mb-5">
                    Password links work once and expire. This one has already been used, has run out, or
                    was replaced by a newer link. Enter your email and we'll send a fresh one.
                  </p>
                </div>
                <form
                  className="space-y-3"
                  onSubmit={(e) => { e.preventDefault(); void requestNewLink(); }}
                >
                  <div className="space-y-2">
                    <Label htmlFor="resendEmail">Email address</Label>
                    <Input
                      id="resendEmail"
                      type="email"
                      value={resendEmail}
                      onChange={(e) => setResendEmail(e.target.value)}
                      placeholder="you@company.com"
                      required
                      disabled={resendBusy}
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={resendBusy}>
                    {resendBusy ? (
                      <><Loader2 className="h-4 w-4 animate-spin mr-2" />Sending...</>
                    ) : (
                      'Send me a new link'
                    )}
                  </Button>
                  <Button type="button" variant="ghost" className="w-full" onClick={() => (window.location.href = '/')}>
                    Return Home
                  </Button>
                </form>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (success) {
    return (
      <div className="container mx-auto px-4 py-16 max-w-md">
        <Card>
          <CardContent className="pt-6 text-center">
            <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">Password Updated!</h2>
            <p className="text-gray-600">
              {next ? 'Taking you back...' : 'Sign in with your new password — redirecting...'}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-16 max-w-md">
      <Card>
        <CardHeader>
          <CardTitle>Reset Your Password</CardTitle>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-700 text-sm">{error}</p>
            </div>
          )}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">New Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter new password (min 8 characters)"
                required
                disabled={loading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm Password</Label>
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
                required
                disabled={loading}
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Updating...
                </>
              ) : (
                'Update Password'
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
