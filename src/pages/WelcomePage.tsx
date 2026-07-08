import { useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle, Loader2, Lock, Mail, RefreshCw, Ship, ArrowRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';

// First-arrival welcome step for event registrants. The access email's
// magic link lands here (and AuthRedirector routes any pw_pending account
// here) so the password is set BEFORE they reach their event hub.
// Logged-out visitors (expired / already-used link) get a clean
// "resend my access link" path instead of a dead end.

export function WelcomePage() {
  const { user, profile, loading: authLoading, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next') || '/sm26/me';

  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [resendEmail, setResendEmail] = useState('');
  const [resent, setResent] = useState(false);

  const finish = async () => {
    navigate(next, { replace: true });
  };

  const setPassword = async () => {
    if (pw.length < 8) { toast({ title: 'Password too short', description: 'Use at least 8 characters.', variant: 'destructive' }); return; }
    if (pw !== pw2) { toast({ title: "Passwords don't match", variant: 'destructive' }); return; }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw, data: { pw_pending: false } });
    setBusy(false);
    if (error) { toast({ title: 'Could not set your password', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Password set — welcome aboard!' });
    void refreshProfile().catch(() => {});
    finish();
  };

  const skipHasPassword = async () => {
    setBusy(true);
    await supabase.auth.updateUser({ data: { pw_pending: false } }).catch(() => {});
    setBusy(false);
    finish();
  };

  const resend = async () => {
    if (!resendEmail.trim()) return;
    setBusy(true);
    // Sends a fresh magic link to an EXISTING account only (no signup here).
    const { error } = await supabase.auth.signInWithOtp({
      email: resendEmail.trim().toLowerCase(),
      options: { shouldCreateUser: false, emailRedirectTo: `${window.location.origin}/welcome` },
    });
    setBusy(false);
    if (error) { toast({ title: 'Could not send the link', description: error.message, variant: 'destructive' }); return; }
    setResent(true);
  };

  if (authLoading) return (
    <div className="flex items-center justify-center h-[60vh]"><RefreshCw className="h-8 w-8 animate-spin text-primary" /></div>
  );

  const Shell = ({ children }: { children: React.ReactNode }) => (
    <div className="min-h-screen bg-gray-50">
      <Helmet><title>Welcome — Smart Marina Connect</title></Helmet>
      <section className="bg-gradient-to-br from-[#0b2653] to-[#143a6b] text-white">
        <div className="container mx-auto px-4 py-10 text-center">
          <Ship className="h-8 w-8 mx-auto mb-2 text-white/70" />
          <h1 className="text-2xl lg:text-3xl font-bold">Welcome to Smart Marina Connect</h1>
          <p className="text-white/80 mt-1">Smart &amp; Sustainable Marina Rendezvous 2026 · 20–21 Sep · Yacht Club de Monaco</p>
        </div>
      </section>
      <div className="container mx-auto px-4 py-10 max-w-md">{children}</div>
    </div>
  );

  // ── Logged out: expired or already-used link → resend path ──
  if (!user) {
    return (
      <Shell>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Mail className="h-5 w-5 text-primary" /> Get your access link</CardTitle>
            <CardDescription>
              Access links are single-use and expire quickly. Enter the email you registered with and we'll send you a fresh one.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {resent ? (
              <div className="text-center py-4">
                <CheckCircle className="h-8 w-8 text-green-600 mx-auto mb-2" />
                <p className="text-sm text-gray-700">If an account exists for <strong>{resendEmail}</strong>, a new access link is on its way. Check your inbox (and spam).</p>
              </div>
            ) : (
              <>
                <div className="space-y-1">
                  <Label>Email</Label>
                  <Input type="email" value={resendEmail} onChange={e => setResendEmail(e.target.value)} placeholder="you@company.com" />
                </div>
                <Button className="w-full gap-1.5" onClick={resend} disabled={busy || !resendEmail.trim()}>
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />} Email me a new access link
                </Button>
                <p className="text-[11px] text-gray-400 text-center">Already have a password? Use <strong>Log in</strong> (top-right) instead.</p>
              </>
            )}
          </CardContent>
        </Card>
      </Shell>
    );
  }

  // ── Logged in: set the password, then continue to the hub ──
  const firstName = profile?.first_name || (user.user_metadata?.first_name as string | undefined) || '';
  return (
    <Shell>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Lock className="h-5 w-5 text-primary" /> {firstName ? `${firstName}, secure` : 'Secure'} your account</CardTitle>
          <CardDescription>
            Your Smart Marina Connect account is ready. Choose a password so you can sign back in anytime — then head to your event hub to complete your participation.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label>Password</Label>
            <Input type="password" value={pw} onChange={e => setPw(e.target.value)} placeholder="At least 8 characters" autoComplete="new-password" />
          </div>
          <div className="space-y-1">
            <Label>Confirm password</Label>
            <Input type="password" value={pw2} onChange={e => setPw2(e.target.value)} autoComplete="new-password" />
          </div>
          <Button className="w-full gap-1.5" onClick={setPassword} disabled={busy || !pw || !pw2}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />} Set password &amp; open my event hub
          </Button>
          <button type="button" onClick={skipHasPassword} disabled={busy} className="w-full text-center text-xs text-gray-400 hover:text-gray-600 pt-1">
            I already have a password — take me to my event hub
          </button>
        </CardContent>
      </Card>
    </Shell>
  );
}
