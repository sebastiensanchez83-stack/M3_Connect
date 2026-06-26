import { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Loader2, CheckCircle2, UserPlus, AlertTriangle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';

// Public landing for a badge's networking QR (smartmarinaconnect.com/sm26/connect?c=<token>).
// Opening it records a connection REQUEST; organizers introduce both sides by email
// after the event (nothing is shared on the spot). A logged-in attendee is recorded
// straight away; anyone else fills a quick name + email form (lead capture for all).

type View =
  | { kind: 'loading' }
  | { kind: 'need_contact'; company: string }
  | { kind: 'done'; company: string; loggedIn: boolean }
  | { kind: 'self' }
  | { kind: 'error' };

export function SM26ConnectPage() {
  const [params] = useSearchParams();
  const token = params.get('c') || '';
  const { user, loading: authLoading } = useAuth();
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [noteSaved, setNoteSaved] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!token) { setView({ kind: 'error' }); return; }
    (async () => {
      const { data, error } = await supabase.rpc('sm_connect_scan', { p_token: token });
      const r = (data || {}) as { ok?: boolean; error?: string; to_company?: string };
      if (error) { setView({ kind: 'error' }); return; }
      if (r.ok) { setView({ kind: 'done', company: r.to_company || 'this participant', loggedIn: !!user }); return; }
      if (r.error === 'need_contact') { setView({ kind: 'need_contact', company: r.to_company || 'this participant' }); return; }
      if (r.error === 'self') { setView({ kind: 'self' }); return; }
      setView({ kind: 'error' });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, token]);

  const submitLead = async () => {
    if (!name.trim() || !email.trim() || !email.includes('@')) { toast({ title: 'Please add your name and a valid email', variant: 'destructive' }); return; }
    setSubmitting(true);
    const { data, error } = await supabase.rpc('sm_connect_scan', { p_token: token, p_note: note.trim() || null, p_name: name.trim(), p_email: email.trim() });
    setSubmitting(false);
    const r = (data || {}) as { ok?: boolean; to_company?: string };
    if (error || !r.ok) { toast({ title: 'Could not save', description: 'Please try again.', variant: 'destructive' }); return; }
    setView({ kind: 'done', company: r.to_company || (view.kind === 'need_contact' ? view.company : 'this participant'), loggedIn: false });
  };

  const saveNote = async () => {
    setSubmitting(true);
    await supabase.rpc('sm_connect_scan', { p_token: token, p_note: note.trim() || null });
    setSubmitting(false);
    setNoteSaved(true);
    toast({ title: 'Note saved' });
  };

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
              <p className="text-gray-600 mt-2 text-sm">The Smart Marina Rendezvous organizers will introduce you both by email after the event. Nothing is shared right now.</p>

              {view.loggedIn ? (
                noteSaved ? (
                  <p className="text-xs text-green-600 mt-4">Your note was saved.</p>
                ) : (
                  <div className="mt-5 text-left">
                    <Label className="text-xs text-gray-500">Add a note for yourself (optional)</Label>
                    <Textarea rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. met at the sustainability panel — discuss pontoon retrofit" className="mt-1" />
                    <div className="flex justify-end mt-2">
                      <Button size="sm" variant="outline" onClick={saveNote} disabled={submitting}>{submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save note'}</Button>
                    </div>
                  </div>
                )
              ) : (
                <p className="text-xs text-gray-400 mt-4">Have a Smart Marina Connect account? <Link to="/login" className="text-primary hover:underline">Sign in</Link> to see all your connections in one place.</p>
              )}
              <div className="mt-6"><Link to="/sm26/me" className="text-sm text-primary hover:underline">Go to my event hub</Link></div>
            </div>
          )}

          {view.kind === 'need_contact' && (
            <div>
              <div className="h-12 w-12 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto mb-3"><UserPlus className="h-6 w-6" /></div>
              <h1 className="text-lg font-bold text-gray-900 text-center">Connect with {view.company}</h1>
              <p className="text-gray-600 mt-1.5 text-sm text-center">Leave your details and the organizers will introduce you both by email after the event.</p>
              <div className="space-y-3 mt-5">
                <div><Label className="text-xs">Your name</Label><Input value={name} onChange={e => setName(e.target.value)} className="mt-1 h-10" placeholder="Full name" /></div>
                <div><Label className="text-xs">Your email</Label><Input type="email" value={email} onChange={e => setEmail(e.target.value)} className="mt-1 h-10" placeholder="you@company.com" /></div>
                <div><Label className="text-xs">Note (optional)</Label><Textarea rows={2} value={note} onChange={e => setNote(e.target.value)} className="mt-1" placeholder="What would you like to talk about?" /></div>
                <Button className="w-full h-11" onClick={submitLead} disabled={submitting}>
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null} Request an introduction
                </Button>
                <p className="text-[11px] text-gray-400 text-center">We'll only use your email to make this introduction for the event.</p>
              </div>
            </div>
          )}

          {view.kind === 'self' && (
            <div className="text-center py-6">
              <AlertTriangle className="h-8 w-8 text-amber-400 mx-auto mb-3" />
              <h1 className="text-lg font-bold text-gray-900">That's your own badge</h1>
              <p className="text-gray-600 mt-1.5 text-sm">Share it with people you meet so they can connect with you.</p>
              <div className="mt-5"><Link to="/sm26/me" className="text-sm text-primary hover:underline">Go to my event hub</Link></div>
            </div>
          )}

          {view.kind === 'error' && (
            <div className="text-center py-6">
              <AlertTriangle className="h-8 w-8 text-gray-300 mx-auto mb-3" />
              <h1 className="text-lg font-bold text-gray-900">This connection link isn't valid</h1>
              <p className="text-gray-600 mt-1.5 text-sm">Check that you scanned a Smart Marina Rendezvous 2026 badge, or ask the person to show their badge QR again.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
