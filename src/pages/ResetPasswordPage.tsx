import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/lib/supabase';
import { Loader2, CheckCircle, AlertCircle } from 'lucide-react';

export function ResetPasswordPage() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    // The user arrives here after clicking a recovery link.
    // Supabase's /auth/v1/verify endpoint processes the token and redirects
    // here with a PKCE code (or hash fragment). The Supabase client
    // automatically exchanges the code for a session.
    //
    // We listen for auth state changes to detect when the recovery session
    // is ready, then show the password form.

    let mounted = true;

    // Explicitly try to exchange the PKCE code from the URL
    const url = new URL(window.location.href);
    const code = url.searchParams.get('code');
    if (code) {
      supabase.auth.exchangeCodeForSession(code).then(({ data, error: exchangeError }) => {
        if (!mounted) return;
        if (data?.session) {
          setSessionReady(true);
          setChecking(false);
        } else if (exchangeError) {
          console.error('Code exchange failed:', exchangeError.message);
          // Don't give up yet — the onAuthStateChange might still fire
        }
      });
    }

    // Also check for hash fragments (non-PKCE flow)
    if (window.location.hash.includes('access_token') || window.location.hash.includes('type=recovery')) {
      // The Supabase client will auto-detect hash fragments
      // Just wait for the auth state change
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (!mounted) return;

        if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') {
          if (session) {
            setSessionReady(true);
            setChecking(false);
          }
        }
      }
    );

    // Also check if there's already an active session
    // (e.g., the code was already exchanged before this listener was set up)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return;
      if (session) {
        setSessionReady(true);
      }
      // After initial check, if still no session, wait longer then give up
      setTimeout(() => {
        if (mounted) setChecking(false);
      }, 15000);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

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
      // Session is already established (from PKCE code exchange)
      // Just update the password directly. Clearing pw_pending matters: an
      // event-provisioned account that resets its password here has done the
      // welcome step's job, and AuthRedirector would otherwise keep bouncing
      // it back to /welcome to "set a password" on every navigation.
      const { error: updateError } = await supabase.auth.updateUser({
        password,
        data: { pw_pending: false },
      });

      if (updateError) {
        setError(updateError.message);
        setLoading(false);
        return;
      }

      // Success
      setSuccess(true);

      // Sign out and redirect home
      await supabase.auth.signOut();
      setTimeout(() => {
        window.location.href = '/';
      }, 2000);
    } catch (err) {
      setError('An error occurred. Please try again.');
      setLoading(false);
    }
  };

  // Still checking for session
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

  // No session found — invalid or expired link
  if (!sessionReady) {
    return (
      <div className="container mx-auto px-4 py-16 max-w-md">
        <Card>
          <CardContent className="pt-6 text-center">
            <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">Invalid Link</h2>
            <p className="text-gray-600 mb-4">This reset link has expired or is invalid. Please request a new password reset.</p>
            <Button onClick={() => window.location.href = '/'}>Return Home</Button>
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
            <p className="text-gray-600">Redirecting to homepage...</p>
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
