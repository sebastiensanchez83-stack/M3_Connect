import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Seo } from '@/components/seo/Seo';
import { useSeoTr } from '@/components/seo/useSeoTr';
import { withSiteSuffix } from '@/lib/seoText';
import { CalendarDays, MapPin, Loader2, CheckCircle, Lock, Mic, Wine } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { guestList, type PublicGuestEvent } from '@/lib/guestList';

// Public page of an invitation-only guest-list event (first: /wys26). Nobody
// registers here — they ask to be invited, with no account. M3 reviews each
// request in /admin/guest-list/<slug>; accepted guests get their entry QR by
// email. The server never says whether an email is already on the list.

const ERRORS: Record<string, string> = {
  missing_fields: 'Please fill in every required field with a valid email address.',
  no_part: 'Choose the conference, the gala dinner, or both.',
  closed: 'Invitation requests are not open at the moment.',
  busy: 'We are receiving many requests right now — please try again in a few minutes.',
};

const EMPTY = { first_name: '', last_name: '', email: '', phone: '', company: '', job_title: '', country: '', motivation: '', website: '' };

export function GuestEventPage({ slug }: { slug: string }) {
  const { i18n } = useTranslation();
  const seoTr = useSeoTr();
  const [event, setEvent] = useState<PublicGuestEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY);
  const [wantsConference, setWantsConference] = useState(true);
  const [wantsGala, setWantsGala] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    guestList<{ event: PublicGuestEvent }>({ action: 'event', slug }).then(r => {
      if (r.event) setEvent(r.event);
      setLoading(false);
    });
  }, [slug]);

  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!wantsConference && !wantsGala) { setError(ERRORS.no_part); return; }
    setSending(true);
    const r = await guestList({ action: 'request', slug, ...form, wants_conference: wantsConference, wants_gala: wantsGala });
    setSending(false);
    if (r.error) { setError(ERRORS[r.error] || 'Something went wrong. Please try again.'); return; }
    setDone(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (loading) return <div className="flex justify-center py-32"><Loader2 className="h-8 w-8 animate-spin text-gray-400" /></div>;
  if (!event) return <div className="max-w-xl mx-auto py-32 text-center text-gray-500">This event could not be found.</div>;

  const s = event.settings || {};
  const parts = s.parts || [];

  return (
    <div className="bg-gray-50 min-h-screen">
      {/* /wys26 has its own words in src/i18n/seo.ts, the ones the edge function writes into the
          HTML for share previews of the invitation link; another guest-list event uses its own. */}
      <Seo
        title={withSiteSuffix(i18n.exists(`seo.${slug}.title`) ? seoTr(`${slug}.title`) : `${event.title} — Request an invitation`)}
        description={i18n.exists(`seo.${slug}.description`) ? seoTr(`${slug}.description`) : (s.tagline || event.title)}
        path={`/${slug}`}
      />

      <section className="bg-[#18182D] text-white">
        <div className="max-w-5xl mx-auto px-4 py-14 md:py-20">
          {s.logo_white_url
            ? <img src={s.logo_white_url} alt={event.title} className="h-14 md:h-20 w-auto" />
            : <h1 className="text-3xl md:text-5xl font-bold">{event.title}</h1>}
          {s.tagline && <p className="mt-6 text-xl md:text-2xl font-light text-white/90">{s.tagline}</p>}
          <div className="mt-6 flex flex-col sm:flex-row gap-3 sm:gap-8 text-white/80">
            {s.date_label && <span className="flex items-center gap-2"><CalendarDays className="h-5 w-5" />{s.date_label}</span>}
            {s.venue && <span className="flex items-center gap-2"><MapPin className="h-5 w-5" />{s.venue}{s.city ? `, ${s.city}` : ''}</span>}
          </div>
          <div className="mt-6 inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-1.5 text-sm">
            <Lock className="h-4 w-4" /> By invitation only
          </div>
        </div>
      </section>

      <div className="max-w-5xl mx-auto px-4 py-10 grid lg:grid-cols-5 gap-8">
        <div className="lg:col-span-3 space-y-8">
          {s.intro && <p className="text-gray-700 leading-relaxed text-lg">{s.intro}</p>}

          {parts.length > 0 && (
            <div className="grid sm:grid-cols-2 gap-4">
              {parts.map(p => (
                <div key={p.key} className="rounded-2xl bg-white border border-gray-100 shadow-sm p-5">
                  {p.key === 'gala' ? <Wine className="h-6 w-6 text-[#18182D]" /> : <Mic className="h-6 w-6 text-[#18182D]" />}
                  <div className="mt-3 font-semibold text-gray-900">{p.label}</div>
                  {p.when && <div className="text-sm text-gray-500">{p.when}</div>}
                </div>
              ))}
            </div>
          )}

          {s.themes && s.themes.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold text-gray-900 mb-3">Conference themes</h2>
              <ul className="space-y-2">
                {s.themes.map((t, i) => (
                  <li key={i} className="flex gap-3 text-gray-700">
                    <span className="mt-2 h-1.5 w-1.5 rounded-full bg-[#18182D] shrink-0" />{t}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {s.programme_note && <p className="text-sm text-gray-500 italic">{s.programme_note}</p>}
        </div>

        <div className="lg:col-span-2">
          <Card className="rounded-2xl shadow-md border-0 lg:sticky lg:top-20">
            <CardContent className="pt-6">
              {done ? (
                <div className="text-center py-6">
                  <CheckCircle className="h-12 w-12 text-green-600 mx-auto" />
                  <h2 className="mt-4 text-xl font-semibold">Thank you</h2>
                  <p className="mt-2 text-gray-600">Your request has been received. Our team reviews every request and will come back to you by email.</p>
                </div>
              ) : !event.requests_open ? (
                <div className="text-center py-6">
                  <Lock className="h-10 w-10 text-gray-400 mx-auto" />
                  <h2 className="mt-4 text-lg font-semibold">Invitation requests are not open yet</h2>
                  {s.contact_email && <p className="mt-2 text-sm text-gray-600">For any enquiry: <a className="underline" href={`mailto:${s.contact_email}`}>{s.contact_email}</a></p>}
                </div>
              ) : (
                <form onSubmit={submit} className="space-y-4">
                  <div>
                    <h2 className="text-lg font-semibold">Request an invitation</h2>
                    <p className="text-sm text-gray-500 mt-1">Attendance is by invitation only. Tell us who you are and we will come back to you.</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label htmlFor="fn">First name *</Label><Input id="fn" required value={form.first_name} onChange={set('first_name')} autoComplete="given-name" /></div>
                    <div><Label htmlFor="ln">Last name *</Label><Input id="ln" required value={form.last_name} onChange={set('last_name')} autoComplete="family-name" /></div>
                  </div>
                  <div><Label htmlFor="em">Email *</Label><Input id="em" type="email" required value={form.email} onChange={set('email')} autoComplete="email" /></div>
                  <div><Label htmlFor="ph">Phone</Label><Input id="ph" type="tel" value={form.phone} onChange={set('phone')} autoComplete="tel" /></div>
                  <div><Label htmlFor="co">Company *</Label><Input id="co" required value={form.company} onChange={set('company')} autoComplete="organization" /></div>
                  <div><Label htmlFor="jt">Job title *</Label><Input id="jt" required value={form.job_title} onChange={set('job_title')} autoComplete="organization-title" /></div>
                  <div><Label htmlFor="ct">Country</Label><Input id="ct" value={form.country} onChange={set('country')} autoComplete="country-name" /></div>
                  <div>
                    <Label>I would like to attend *</Label>
                    <div className="mt-2 space-y-2">
                      <label className="flex items-center gap-2 text-sm"><Checkbox checked={wantsConference} onCheckedChange={v => setWantsConference(v === true)} /> Conference</label>
                      <label className="flex items-center gap-2 text-sm"><Checkbox checked={wantsGala} onCheckedChange={v => setWantsGala(v === true)} /> Gala dinner</label>
                    </div>
                  </div>
                  <div><Label htmlFor="mo">Why would you like to attend?</Label><Textarea id="mo" rows={3} value={form.motivation} onChange={set('motivation')} /></div>
                  {/* Honeypot — invisible to people, filled by bots. */}
                  <input type="text" tabIndex={-1} autoComplete="off" value={form.website} onChange={set('website')}
                    className="absolute -left-[9999px] h-0 w-0 opacity-0" aria-hidden="true" />
                  {error && <p className="text-sm text-red-600">{error}</p>}
                  <Button type="submit" disabled={sending} className="w-full bg-[#18182D] hover:bg-[#18182D]/90">
                    {sending && <Loader2 className="h-4 w-4 animate-spin mr-2" />} Send my request
                  </Button>
                  <p className="text-xs text-gray-400">Your details are used only to process your request for this event.</p>
                </form>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
