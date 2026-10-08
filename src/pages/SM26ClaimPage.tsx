import { useState, useEffect, useRef, type ReactNode } from 'react';
import { Helmet } from 'react-helmet-async';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { CheckCircle2, Loader2, KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CardShell } from '@/components/brand/CardShell';
import { Eyebrow } from '@/components/brand/Eyebrow';
import { AuthInput, AuthLabel, AuthNotice, FieldError } from '@/components/auth/fields';
import { AuthDialog } from '@/components/auth/AuthDialog';
import { LoginForm } from '@/components/auth/LoginForm';
import { AuthLoading } from '@/components/auth/AuthShell';
import { SM26_DATES, SM26_EDITION_OVER } from '@/components/sm26/sm26Edition';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';

// Claim a pre-created SM26 registration (imported from Jotform) by code. The
// code links the registration to the signed-in account. New users sign in /
// sign up via the navbar first — the code is preserved across that round-trip.
//
// Since the edition is over (SM26_EDITION_OVER) claiming only gives access to the
// read-only record (participation, invoices, documents): the event hub it leads to
// offers no way to change the registration. Same light look as /sm26.

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-[70vh] bg-page px-4 py-12 sm:py-20">
      <Helmet>
        <title>Claim your SM26 registration</title>
        <meta name="robots" content="noindex" />
      </Helmet>
      <div className="mx-auto w-full max-w-md">{children}</div>
    </div>
  );
}

export function SM26ClaimPage() {
  const { user, loading: authLoading } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [code, setCode] = useState(params.get('code') || '');
  const [status, setStatus] = useState<'idle' | 'claiming' | 'done' | 'error'>('idle');
  const [msg, setMsg] = useState('');
  const [loginOpen, setLoginOpen] = useState(false);
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

  if (authLoading) return <AuthLoading />;

  if (status === 'done') return (
    <Shell>
      <CardShell className="p-7 text-center sm:p-9">
        <div className="flex justify-center"><Eyebrow>SM26 · {SM26_DATES}</Eyebrow></div>
        <span aria-hidden="true" className="mx-auto mt-6 grid h-14 w-14 place-items-center rounded-full bg-foam text-teal-text">
          <CheckCircle2 className="h-6 w-6" />
        </span>
        <h1 className="mt-5 text-h2-sm text-navy">Registration claimed</h1>
        <p className="mt-3 text-[15px] leading-6 text-meta" role="status">
          {SM26_EDITION_OVER ? 'Taking you to your 2026 participation…' : 'Taking you to your SM26 participation…'}
        </p>
      </CardShell>
    </Shell>
  );

  return (
    <Shell>
      <CardShell className="p-7 sm:p-9">
        <Eyebrow>SM26 · {SM26_DATES}</Eyebrow>
        <div className="mt-5 flex items-center gap-3">
          <span aria-hidden="true" className="grid h-11 w-11 shrink-0 place-items-center rounded-field bg-chip text-navy">
            <KeyRound className="h-5 w-5" />
          </span>
          <h1 className="text-h2-sm text-navy">Claim your registration</h1>
        </div>
        <p className="mt-4 text-[15px] leading-6 text-meta">
          {user
            ? 'Enter the code from your invitation to link your SM26 registration to this account.'
            : 'You already have an SM26 registration waiting. Sign in, or create your account with Sign up at the top of the page, to claim it: your code is saved.'}
        </p>
        {SM26_EDITION_OVER && (
          <p className="mt-3 text-[14px] leading-6 text-meta">
            The edition took place on {SM26_DATES}. Claiming links the record of your participation to your account; the registration itself can no longer be changed.
          </p>
        )}

        <div className="mt-6 space-y-2">
          <AuthLabel htmlFor="sm26-claim-code">Invitation code</AuthLabel>
          <AuthInput
            id="sm26-claim-code"
            value={code}
            onChange={e => setCode(e.target.value.toUpperCase())}
            placeholder="SM26-XXXXXX"
            className="font-mono tracking-[0.06em]"
            autoComplete="off"
            disabled={!user || status === 'claiming'}
            aria-invalid={status === 'error' || undefined}
            aria-describedby={status === 'error' ? 'sm26-claim-error' : undefined}
          />
          {status === 'error' && <FieldError id="sm26-claim-error">{msg}</FieldError>}
        </div>

        <div className="mt-6">
          {user ? (
            <Button type="button" variant="cta" className="w-full justify-between" onClick={() => claim(code)} disabled={!code.trim() || status === 'claiming'}>
              {status === 'claiming' && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />} Claim registration
            </Button>
          ) : (
            <div className="space-y-4">
              <AuthNotice tone="info">
                <p>Once you're signed in, this page will link your registration automatically.</p>
              </AuthNotice>
              <Button type="button" variant="cta" className="w-full justify-between" onClick={() => setLoginOpen(true)}>
                Sign in
              </Button>
            </div>
          )}
        </div>
      </CardShell>

      <AuthDialog mode="login" open={loginOpen} onOpenChange={setLoginOpen} description="Use the email address your invitation was sent to.">
        <LoginForm onSuccess={() => setLoginOpen(false)} />
      </AuthDialog>
    </Shell>
  );
}
