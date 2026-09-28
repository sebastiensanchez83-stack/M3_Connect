import { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { useSearchParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { CalendarDays, MapPin, Loader2, CheckCircle, XCircle, Clock, UserPlus } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { guestList, partsLabel, type GuestView } from '@/lib/guestList';

// A guest's personal page, reached from the link in every email
// (/<slug>/guest?t=<token>). The token is the only credential: it shows the
// invitation, lets an invitee accept or decline, shows the entry QR once
// confirmed, and lets a confirmed guest ask for a plus-one.
//
// The email's Accept / Decline buttons land here with ?answer=…, but nothing
// is recorded until the guest clicks: mail scanners open links on their own,
// and an invitation must not be answered by a robot.

const ERRORS: Record<string, string> = {
  not_found: 'This link is not valid. Please use the link from your email, or contact us.',
  full: 'We are sorry — the event is now full.',
  not_allowed: 'This action is not available for your invitation.',
  already: 'You have already asked for a plus-one.',
  missing_fields: 'Please give your guest’s first name, last name and a valid email address.',
  same_email: 'Your guest needs their own email address.',
  email_taken: 'This person is already on our list — no need to ask again.',
};

export function GuestInvitationPage() {
  const [params] = useSearchParams();
  const token = params.get('t') || '';
  const suggested = params.get('answer');
  const [view, setView] = useState<GuestView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [plusOpen, setPlusOpen] = useState(false);
  const [plus, setPlus] = useState({ first_name: '', last_name: '', email: '', company: '', job_title: '' });

  useEffect(() => {
    guestList<GuestView>({ action: 'guest', token }).then(r => {
      if (r.error) setError(ERRORS[r.error] || ERRORS.not_found); else setView(r);
      setLoading(false);
    });
  }, [token]);

  useEffect(() => {
    const url = view?.guest.checkin_url;
    if (!url) { setQr(null); return; }
    QRCode.toDataURL(url, { margin: 2, width: 480, errorCorrectionLevel: 'M' }).then(setQr).catch(() => setQr(null));
  }, [view?.guest.checkin_url]);

  const answer = async (a: 'accept' | 'decline') => {
    setBusy(true); setError(null);
    const r = await guestList<GuestView>({ action: 'rsvp', token, answer: a });
    setBusy(false);
    if (r.error) setError(ERRORS[r.error] || 'Something went wrong. Please try again.'); else setView(r);
  };

  const askPlusOne = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    const r = await guestList<GuestView>({ action: 'plus_one', token, ...plus });
    setBusy(false);
    if (r.error) setError(ERRORS[r.error] || 'Something went wrong. Please try again.');
    else { setView(r); setPlusOpen(false); }
  };

  if (loading) return <div className="flex justify-center py-32"><Loader2 className="h-8 w-8 animate-spin text-gray-400" /></div>;
  if (!view) return <div className="max-w-xl mx-auto py-32 px-4 text-center text-gray-600">{error}</div>;

  const { event, guest } = view;
  const s = event.settings || {};

  return (
    <div className="bg-gray-50 min-h-screen">
      <Helmet><title>{`Your invitation — ${event.title}`}</title><meta name="robots" content="noindex" /></Helmet>
      <section className="bg-[#18182D] text-white">
        <div className="max-w-xl mx-auto px-4 py-10">
          {s.logo_white_url ? <img src={s.logo_white_url} alt={event.title} className="h-12 w-auto" /> : <h1 className="text-2xl font-bold">{event.title}</h1>}
          <div className="mt-4 flex flex-col gap-1 text-white/80 text-sm">
            {s.date_label && <span className="flex items-center gap-2"><CalendarDays className="h-4 w-4" />{s.date_label}</span>}
            {s.venue && <span className="flex items-center gap-2"><MapPin className="h-4 w-4" />{s.venue}{s.city ? `, ${s.city}` : ''}</span>}
          </div>
        </div>
      </section>

      <div className="max-w-xl mx-auto px-4 py-8 space-y-6">
        <Card className="rounded-2xl shadow-md border-0">
          <CardContent className="pt-6 space-y-4">
            <p className="text-lg">Dear {guest.first_name},</p>

            {guest.status === 'invited' && (
              <>
                <p className="text-gray-700">You are invited to <strong>{event.title}</strong> for the <strong>{partsLabel(guest).toLowerCase()}</strong>. Will you join us?</p>
                {suggested && <p className="text-sm text-gray-500">Please confirm your answer below.</p>}
                <div className="flex gap-3">
                  <Button disabled={busy} onClick={() => answer('accept')}
                    className={`flex-1 bg-green-700 hover:bg-green-800 ${suggested === 'accept' ? 'ring-4 ring-green-200' : ''}`}>
                    {busy && <Loader2 className="h-4 w-4 animate-spin mr-2" />} I accept
                  </Button>
                  <Button disabled={busy} variant="outline" onClick={() => answer('decline')}
                    className={`flex-1 ${suggested === 'decline' ? 'ring-4 ring-gray-200' : ''}`}>
                    I cannot attend
                  </Button>
                </div>
              </>
            )}

            {guest.status === 'requested' && (
              <div className="flex gap-3 items-start text-gray-700"><Clock className="h-5 w-5 mt-0.5 text-amber-500" />
                <p>{guest.is_plus_one ? 'Your plus-one request' : 'Your request'} is being reviewed. We will come back to you by email.</p></div>
            )}

            {guest.status === 'confirmed' && (
              <>
                <div className="flex gap-3 items-start"><CheckCircle className="h-5 w-5 mt-0.5 text-green-600" />
                  <p className="text-gray-700">Your place is confirmed for the <strong>{partsLabel(guest).toLowerCase()}</strong>
                    {guest.host ? <> as the guest of {guest.host.first_name} {guest.host.last_name}</> : null}.</p></div>
                {qr && (
                  <div className="text-center">
                    <img src={qr} alt="Your entry QR code" className="mx-auto w-60 h-60 border rounded-xl p-2 bg-white" />
                    <p className="mt-2 text-sm text-gray-500">Show this QR code at the entrance. No QR? Just give your name at the desk.</p>
                  </div>
                )}
                <button onClick={() => answer('decline')} disabled={busy} className="text-sm text-gray-500 underline">
                  I can no longer attend
                </button>
              </>
            )}

            {guest.status === 'declined' && (
              <>
                <div className="flex gap-3 items-start text-gray-700"><XCircle className="h-5 w-5 mt-0.5 text-gray-400" />
                  <p>You have let us know you cannot attend. Thank you for your answer.</p></div>
                {guest.source !== 'request' && !guest.is_plus_one && (
                  <Button variant="outline" disabled={busy} onClick={() => answer('accept')}>Changed your mind? Accept the invitation</Button>
                )}
              </>
            )}

            {(guest.status === 'rejected' || guest.status === 'cancelled') && (
              <p className="text-gray-700">This invitation is no longer active. For any question, contact {s.contact_email || 'us'}.</p>
            )}

            {error && <p className="text-sm text-red-600">{error}</p>}
          </CardContent>
        </Card>

        {guest.status === 'confirmed' && !guest.is_plus_one && (
          <Card className="rounded-2xl shadow-sm border-0">
            <CardContent className="pt-6 space-y-3">
              <div className="flex items-center gap-2 font-semibold"><UserPlus className="h-5 w-5" /> Plus-one</div>
              {guest.plus_one ? (
                <p className="text-sm text-gray-700">
                  {guest.plus_one.first_name} {guest.plus_one.last_name} —{' '}
                  {guest.plus_one.status === 'confirmed' ? 'confirmed; they have received their own entry pass by email.' : 'request under review.'}
                </p>
              ) : !plusOpen ? (
                <>
                  <p className="text-sm text-gray-600">Would you like to bring someone? Tell us who — each plus-one is reviewed by our team and receives their own entry pass.</p>
                  <Button variant="outline" onClick={() => setPlusOpen(true)}>Request a plus-one</Button>
                </>
              ) : (
                <form onSubmit={askPlusOne} className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>First name *</Label><Input required value={plus.first_name} onChange={e => setPlus({ ...plus, first_name: e.target.value })} /></div>
                    <div><Label>Last name *</Label><Input required value={plus.last_name} onChange={e => setPlus({ ...plus, last_name: e.target.value })} /></div>
                  </div>
                  <div><Label>Their email *</Label><Input type="email" required value={plus.email} onChange={e => setPlus({ ...plus, email: e.target.value })} /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Company</Label><Input value={plus.company} onChange={e => setPlus({ ...plus, company: e.target.value })} /></div>
                    <div><Label>Job title</Label><Input value={plus.job_title} onChange={e => setPlus({ ...plus, job_title: e.target.value })} /></div>
                  </div>
                  <div className="flex gap-2">
                    <Button type="submit" disabled={busy} className="bg-[#18182D] hover:bg-[#18182D]/90">{busy && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Send request</Button>
                    <Button type="button" variant="ghost" onClick={() => setPlusOpen(false)}>Cancel</Button>
                  </div>
                </form>
              )}
            </CardContent>
          </Card>
        )}

        {s.programme_note && <p className="text-sm text-gray-500 text-center">{s.programme_note}</p>}
      </div>
    </div>
  );
}
