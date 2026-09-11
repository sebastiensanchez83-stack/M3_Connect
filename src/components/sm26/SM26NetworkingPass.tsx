import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { readStoredPass, storePass, clearStoredPass, connectUrl } from '@/lib/networkingPass';

// "My networking QR": the code other people scan to ask for an introduction.
// Signed in → the member's own pass (issued once by sm_my_networking_pass).
// No account → a guest pass: name, company and email typed once, kept on this
// phone. Either way nothing is shared on the spot; M3 introduces both sides by
// email after the event.

type Shown = { token: string; name: string | null; company: string | null; guest: boolean };

export function SM26NetworkingPass() {
  const { user } = useAuth();
  const [shown, setShown] = useState<Shown | null>(null);
  const [loading, setLoading] = useState(true);
  const [qr, setQr] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  // Keyed on the id, not the user object, so returning to the tab doesn't refetch.
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setFailed(false);
      if (user?.id) {
        // A signed-in person always gets their own code; if it can't load, say so
        // rather than offering the no-account form.
        const { data, error } = await supabase.rpc('sm_my_networking_pass');
        const r = (data || {}) as { ok?: boolean; token?: string; name?: string | null; company?: string | null };
        if (!alive) return;
        if (!error && r.ok && r.token) setShown({ token: r.token, name: r.name ?? null, company: r.company ?? null, guest: false });
        else setFailed(true);
        setLoading(false);
        return;
      }
      const stored = readStoredPass();
      if (!alive) return;
      setShown(stored ? { token: stored.token, name: stored.name, company: stored.company, guest: true } : null);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [user?.id, attempt]);

  useEffect(() => {
    if (!shown) { setQr(null); return; }
    let alive = true;
    QRCode.toDataURL(connectUrl(shown.token), { margin: 2, width: 560, errorCorrectionLevel: 'M' })
      .then(url => { if (alive) setQr(url); })
      .catch(() => { if (alive) setQr(null); });
    return () => { alive = false; };
  }, [shown]);

  const create = async () => {
    if (!name.trim() || !email.trim()) { toast({ title: 'Please add your name and email', variant: 'destructive' }); return; }
    setBusy(true);
    const { data, error } = await supabase.rpc('sm_networking_pass_create', { p_name: name.trim(), p_company: company.trim() || null, p_email: email.trim() });
    setBusy(false);
    const r = (data || {}) as { ok?: boolean; token?: string; error?: string };
    if (error || !r.ok || !r.token) {
      const description = r.error === 'bad_email' ? 'Please check your email address.'
        : r.error === 'rate_limited' ? 'Too many attempts — please wait a few minutes.'
        : 'Please try again.';
      toast({ title: 'Could not create your QR', description, variant: 'destructive' });
      return;
    }
    const pass = { token: r.token, name: name.trim(), company: company.trim() || null };
    storePass(pass);
    setShown({ ...pass, guest: true });
  };

  if (loading) return <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  if (failed) {
    return (
      <div className="text-center py-6">
        <p className="text-sm text-gray-600">We couldn't load your networking QR. Check your connection and try again.</p>
        <Button variant="outline" className="mt-4" onClick={() => setAttempt(a => a + 1)}>Try again</Button>
      </div>
    );
  }

  if (!shown) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-gray-600">No account needed. Type your details once — they stay on this phone for the event.</p>
        <div><Label className="text-xs">Your name</Label><Input value={name} onChange={e => setName(e.target.value)} className="mt-1 h-10" autoComplete="name" /></div>
        <div><Label className="text-xs">Your company (optional)</Label><Input value={company} onChange={e => setCompany(e.target.value)} className="mt-1 h-10" autoComplete="organization" /></div>
        <div><Label className="text-xs">Your email</Label><Input type="email" inputMode="email" value={email} onChange={e => setEmail(e.target.value)} className="mt-1 h-10" autoComplete="email" /></div>
        <Button className="w-full h-11" onClick={create} disabled={busy}>
          {busy && <Loader2 className="h-4 w-4 animate-spin mr-2" />} Get my networking QR
        </Button>
        <p className="text-[11px] text-gray-400 text-center">We only use your details to introduce you, by email after the event, to the people you connect with.</p>
      </div>
    );
  }

  return (
    <div className="text-center">
      {qr
        ? <img src={qr} alt="My networking QR code" className="mx-auto w-64 h-64" />
        : <div className="mx-auto w-64 h-64 flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>}
      <p className="font-semibold text-gray-900 mt-2">{shown.name || 'You'}</p>
      {shown.company && <p className="text-sm text-gray-500">{shown.company}</p>}
      <p className="text-sm text-gray-600 mt-3">Let people scan this with their phone camera. To connect with someone, scan theirs — or the QR on an exhibitor's table.</p>
      <p className="text-xs text-gray-400 mt-2">We introduce you both by email after the event. Nothing is shared right now.</p>
      {shown.guest && (
        <button type="button" onClick={() => { clearStoredPass(); setShown(null); }} className="text-xs text-gray-400 hover:text-primary underline mt-3">
          Not you? Start again
        </button>
      )}
    </div>
  );
}
