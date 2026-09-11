import { useState, useEffect, useRef } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Loader2, CheckCircle2, UserPlus, AlertTriangle, QrCode, WifiOff } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { readStoredPass, storePass, clearStoredPass } from '@/lib/networkingPass';

// Landing for every SM26 networking code (smartmarinaconnect.com/sm26/connect?c=<token>):
// an exhibitor's table code, someone's networking pass on their phone, or a badge.
// These URLs are PRINTED on exhibitor tables — keep the path and the ?c= param.
// Opening it records a connection REQUEST; organizers introduce both sides by email
// after the event (nothing is shared on the spot). A logged-in attendee is recorded
// straight away; so is a guest whose networking pass is on this phone. Anyone else
// types name + email once, which also gives them a pass of their own.

type View =
  | { kind: 'loading' }
  | { kind: 'need_contact'; company: string }
  | { kind: 'done'; company: string; as: 'user' | 'pass' | 'typed' }
  | { kind: 'self' }
  | { kind: 'offline' }   // couldn't reach the server — not the same as a bad code
  | { kind: 'error' };

type ScanResult = { ok?: boolean; error?: string; to_company?: string };

export function SM26ConnectPage() {
  const [params] = useSearchParams();
  const token = params.get('c') || '';
  const { user, loading: authLoading } = useAuth();
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [noteSaved, setNoteSaved] = useState(false);
  const [pass, setPass] = useState<{ token: string; name: string } | null>(null);
  // One recording per code per visit: a sign-in in another tab flips authLoading
  // and must not quietly record the scan a second time as the account.
  const scannedFor = useRef<string | null>(null);

  const scan = async (extra: Record<string, unknown> = {}) => {
    const { data, error } = await supabase.rpc('sm_connect_scan', { p_token: token, ...extra });
    return { r: (data || {}) as ScanResult, error };
  };

  const run = async () => {
    setView({ kind: 'loading' });
    // Signed out with a pass on this phone: connect as that pass, no typing.
    const stored = user ? null : readStoredPass();
    let { r, error } = await scan(stored ? { p_pass: stored.token } : {});
    let usedPass = !!stored;
    if (!error && r.error === 'bad_pass') {
      clearStoredPass();
      usedPass = false;
      ({ r, error } = await scan());
    }
    if (error) { scannedFor.current = null; setView({ kind: 'offline' }); return; }
    setPass(usedPass && stored ? { token: stored.token, name: stored.name } : null);
    const company = r.to_company || 'this participant';
    if (r.ok) { setView({ kind: 'done', company, as: user ? 'user' : usedPass ? 'pass' : 'typed' }); return; }
    if (r.error === 'need_contact') { setView({ kind: 'need_contact', company }); return; }
    if (r.error === 'self') { setView({ kind: 'self' }); return; }
    setView({ kind: 'error' });
  };

  useEffect(() => {
    if (authLoading) return;
    if (!token) { setView({ kind: 'error' }); return; }
    if (scannedFor.current === token) return;
    scannedFor.current = token;
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, token]);

  const notMe = () => {
    clearStoredPass();
    setPass(null);
    setNoteSaved(false);
    setView({ kind: 'need_contact', company: view.kind === 'done' ? view.company : 'this participant' });
  };

  const submitLead = async () => {
    if (!name.trim() || !email.trim() || !email.includes('@')) { toast({ title: 'Please add your name and a valid email', variant: 'destructive' }); return; }
    setSubmitting(true);
    const company0 = view.kind === 'need_contact' ? view.company : 'this participant';
    // Details typed once become a networking pass on this phone, so the next
    // table is one scan and others can scan them back.
    const { data: created } = await supabase.rpc('sm_networking_pass_create', { p_name: name.trim(), p_company: company.trim() || null, p_email: email.trim() });
    const made = (created || {}) as { ok?: boolean; token?: string; error?: string };
    if (made.error === 'bad_email') { setSubmitting(false); toast({ title: 'Please check your email address', variant: 'destructive' }); return; }
    let res: { r: ScanResult; error: unknown };
    if (made.ok && made.token) {
      storePass({ token: made.token, name: name.trim(), company: company.trim() || null });
      setPass({ token: made.token, name: name.trim() });
      res = await scan({ p_pass: made.token, p_note: note.trim() || null });
    } else {
      // No pass (e.g. throttled): still record the request from the typed details.
      res = await scan({ p_note: note.trim() || null, p_name: name.trim(), p_email: email.trim(), p_company: company.trim() || null });
    }
    setSubmitting(false);
    if (res.error || !res.r.ok) {
      if (res.r.error === 'self') { setView({ kind: 'self' }); return; }
      toast({ title: 'Could not save', description: 'Please try again.', variant: 'destructive' });
      return;
    }
    setView({ kind: 'done', company: res.r.to_company || company0, as: made.ok ? 'pass' : 'typed' });
  };

  const saveNote = async () => {
    if (!note.trim()) return;
    setSubmitting(true);
    const { r, error } = await scan({ p_note: note.trim(), ...(pass && !user ? { p_pass: pass.token } : {}) });
    setSubmitting(false);
    if (error || !r.ok) { toast({ title: 'Your note was not saved', description: 'Please check your connection and try again.', variant: 'destructive' }); return; }
    setNoteSaved(true);
    toast({ title: 'Note saved' });
  };

  const hubLink = user ? '/sm26/me' : '/sm26';
  const hubLabel = user ? 'Go to my event hub' : 'Event info';

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0b2653] to-[#143a6b] flex items-center justify-center px-4 py-10">
      <Helmet><title>Connect — Smart Marina Rendezvous 2026</title></Helmet>
      <Card className="w-full max-w-md border-0 shadow-xl">
        <CardContent className="p-6">
          {view.kind === 'loading' && (
            <div className="flex flex-col items-center py-8 text-gray-500">
              <Loader2 className="h-7 w-7 animate-spin text-primary mb-3" /> Recording your connection…
            </div>
          )}

          {view.kind === 'done' && (
            <div className="text-center">
              <div className="h-14 w-14 rounded-full bg-green-50 text-green-600 flex items-center justify-center mx-auto mb-4"><CheckCircle2 className="h-8 w-8" /></div>
              <h1 className="text-xl font-bold text-gray-900">You're connected with {view.company}</h1>
              {view.as === 'pass' && pass && (
                <p className="text-xs text-gray-500 mt-1">
                  as {pass.name} · <button type="button" onClick={notMe} className="underline hover:text-primary">Not you?</button>
                </p>
              )}
              <p className="text-gray-600 mt-2 text-sm">The Smart Marina Rendezvous organizers will introduce you both by email after the event. Nothing is shared right now.</p>

              {view.as !== 'typed' && (
                noteSaved ? (
                  <p className="text-xs text-green-600 mt-4">Your note was saved.</p>
                ) : (
                  <div className="mt-5 text-left">
                    <Label className="text-xs text-gray-500">Add a note for the introduction (optional)</Label>
                    <Textarea rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. met at the sustainability panel — discuss pontoon retrofit" className="mt-1" />
                    <div className="flex justify-end mt-2">
                      <Button size="sm" variant="outline" onClick={saveNote} disabled={submitting}>{submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save note'}</Button>
                    </div>
                  </div>
                )
              )}

              {view.as === 'pass' && (
                <div className="mt-5 rounded-xl bg-gray-50 p-4 text-left">
                  <p className="text-sm font-medium text-gray-900">Your networking QR is ready</p>
                  <p className="text-xs text-gray-500 mt-0.5">Next scans are one tap, and people you meet can scan you back.</p>
                  <Link to="/sm26?pass=1" className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline mt-2">
                    <QrCode className="h-4 w-4" /> Show my networking QR
                  </Link>
                </div>
              )}
              <div className="mt-6"><Link to={hubLink} className="text-sm text-primary hover:underline">{hubLabel}</Link></div>
            </div>
          )}

          {view.kind === 'need_contact' && (
            <div>
              <div className="h-12 w-12 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto mb-3"><UserPlus className="h-6 w-6" /></div>
              <h1 className="text-lg font-bold text-gray-900 text-center">Connect with {view.company}</h1>
              <p className="text-gray-600 mt-1.5 text-sm text-center">Leave your details once and the organizers will introduce you both by email after the event. No account needed.</p>
              <div className="space-y-3 mt-5">
                <div><Label className="text-xs">Your name</Label><Input value={name} onChange={e => setName(e.target.value)} className="mt-1 h-10" placeholder="Full name" autoComplete="name" /></div>
                <div><Label className="text-xs">Your company (optional)</Label><Input value={company} onChange={e => setCompany(e.target.value)} className="mt-1 h-10" placeholder="Company name" autoComplete="organization" /></div>
                <div><Label className="text-xs">Your email</Label><Input type="email" inputMode="email" value={email} onChange={e => setEmail(e.target.value)} className="mt-1 h-10" placeholder="you@company.com" autoComplete="email" /></div>
                <div><Label className="text-xs">Note (optional)</Label><Textarea rows={2} value={note} onChange={e => setNote(e.target.value)} className="mt-1" placeholder="What would you like to talk about?" /></div>
                <Button className="w-full h-11" onClick={submitLead} disabled={submitting}>
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null} Request an introduction
                </Button>
                <p className="text-[11px] text-gray-400 text-center">We only use your details to make introductions for the event. They stay on this phone so you don't retype them.</p>
              </div>
              <p className="text-xs text-gray-500 text-center mt-4 border-t pt-3">
                Registered for the event? <Link to="/sm26" className="text-primary hover:underline">Sign in from the event page</Link>, then scan again to connect as yourself.
              </p>
            </div>
          )}

          {view.kind === 'self' && (
            <div className="text-center py-6">
              <AlertTriangle className="h-8 w-8 text-amber-400 mx-auto mb-3" />
              <h1 className="text-lg font-bold text-gray-900">That's your own code</h1>
              <p className="text-gray-600 mt-1.5 text-sm">Show it to the people you meet so they can connect with you.</p>
              <div className="mt-5"><Link to={hubLink} className="text-sm text-primary hover:underline">{hubLabel}</Link></div>
            </div>
          )}

          {view.kind === 'offline' && (
            <div className="text-center py-6">
              <WifiOff className="h-8 w-8 text-gray-300 mx-auto mb-3" />
              <h1 className="text-lg font-bold text-gray-900">No connection right now</h1>
              <p className="text-gray-600 mt-1.5 text-sm">We couldn't reach the server, so nothing was recorded yet. Check your Wi-Fi or mobile data and try again.</p>
              <Button className="mt-5" onClick={() => { scannedFor.current = token; run(); }}>Try again</Button>
            </div>
          )}

          {view.kind === 'error' && (
            <div className="text-center py-6">
              <AlertTriangle className="h-8 w-8 text-gray-300 mx-auto mb-3" />
              <h1 className="text-lg font-bold text-gray-900">This connection link isn't valid</h1>
              <p className="text-gray-600 mt-1.5 text-sm">Check that you scanned a Smart Marina Rendezvous 2026 networking code, or ask the person to show it again.</p>
              <div className="mt-5"><Link to="/sm26" className="text-sm text-primary hover:underline">Event info</Link></div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
