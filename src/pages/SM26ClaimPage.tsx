import { useState, useEffect, useRef } from 'react';
import { Helmet } from 'react-helmet-async';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { CheckCircle, Loader2, KeyRound, AlertCircle, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';

// Claim a pre-created SM26 registration (imported from Jotform) by code. The
// code links the registration to the signed-in account. New users sign in /
// sign up via the navbar first — the code is preserved across that round-trip.

export function SM26ClaimPage() {
  const { user, loading: authLoading } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [code, setCode] = useState(params.get('code') || '');
  const [status, setStatus] = useState<'idle' | 'claiming' | 'done' | 'error'>('idle');
  const [msg, setMsg] = useState('');
  const attempted = useRef(false);

  useEffect(() => {
    const c = params.get('code');
    if (c) localStorage.setItem('sm26_claim_code', c);
  }, [params]);

  const claim = async (c: string) => {
    setStatus('claiming');
    const { data, error } = await supabase.rpc('sm_claim_registration', { p_code: c.trim() });
    // The RPC raises (error) only for throttle/auth; an invalid code returns null.
    if (error) { setStatus('error'); attempted.current = false; setMsg(error.message || 'Could not claim this code.'); return; }
    if (!data) { setStatus('error'); attempted.current = false; setMsg('Invalid or already-claimed code. Check the code and try again.'); return; }
    localStorage.removeItem('sm26_claim_code');
    setStatus('done');
    setTimeout(() => navigate('/sm26/me'), 1600);
  };

  // Auto-claim once signed in with a code available
  useEffect(() => {
    if (authLoading || !user || attempted.current) return;
    const c = code || localStorage.getItem('sm26_claim_code') || '';
    if (c) { attempted.current = true; setCode(c); claim(c); }
  }, [authLoading, user]); // eslint-disable-line

  if (authLoading) return (
    <div className="flex items-center justify-center h-[60vh]"><RefreshCw className="h-8 w-8 animate-spin text-primary" /></div>
  );

  const Shell = ({ children }: { children: React.ReactNode }) => (
    <div className="min-h-screen bg-gray-50">
      <Helmet><title>Claim your SM26 registration</title></Helmet>
      <div className="container mx-auto px-4 py-16 max-w-md">{children}</div>
    </div>
  );

  if (status === 'done') return (
    <Shell>
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-green-100"><CheckCircle className="h-8 w-8 text-green-600" /></div>
        <h1 className="text-2xl font-bold mb-2">Registration claimed</h1>
        <p className="text-gray-600">Taking you to your SM26 participation…</p>
      </div>
    </Shell>
  );

  return (
    <Shell>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5 text-primary" /> Claim your registration</CardTitle>
          <CardDescription>
            {user
              ? 'Enter the code from your invitation to link your SM26 registration to this account.'
              : 'You already have an SM26 registration waiting. Sign in or create your account (button top-right) to claim it — your code is saved.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Input value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="SM26-XXXXXX" className="font-mono" disabled={!user || status === 'claiming'} />
          </div>
          {status === 'error' && (
            <p className="text-sm text-red-600 flex items-center gap-1.5"><AlertCircle className="h-4 w-4" /> {msg}</p>
          )}
          {user ? (
            <Button className="w-full gap-1.5" onClick={() => claim(code)} disabled={!code.trim() || status === 'claiming'}>
              {status === 'claiming' && <Loader2 className="h-4 w-4 animate-spin" />} Claim registration
            </Button>
          ) : (
            <p className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
              Once you're signed in, this page will link your registration automatically.
            </p>
          )}
        </CardContent>
      </Card>
    </Shell>
  );
}
