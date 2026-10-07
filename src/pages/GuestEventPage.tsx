import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Seo } from '@/components/seo/Seo';
import { useSeoTr } from '@/components/seo/useSeoTr';
import { withSiteSuffix } from '@/lib/seoText';
import { CalendarDays, MapPin, Loader2, CheckCircle, Lock, Mic, Wine, Check, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { AuthInput as Input, AuthLabel as Label, AuthTextarea as Textarea, FieldError } from '@/components/auth/fields';
import { Eyebrow } from '@/components/brand/Eyebrow';
import { ContactCard, M3_PUBLIC_EMAIL } from '@/components/brand/ContactCard';
import { HeroIn } from '@/components/brand/SplitHero';
import { UnderlineLink } from '@/components/brand/UnderlineLink';
import { BathyPattern } from '@/components/motion/BathyPattern';
import { LineReveal } from '@/components/motion/LineReveal';
import { Reveal } from '@/components/motion/Reveal';
import { prefersReducedMotion } from '@/components/motion/useReducedMotion';
import { useRegisterHeaderHero } from '@/components/layout/headerOverlay';
import { guestList, type PublicGuestEvent } from '@/lib/guestList';
import { registerWysRefonteStrings } from '@/i18n/refonte-wys';
import { cn } from '@/lib/utils';

registerWysRefonteStrings();

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

/** "Friday 27 November 2026" → the day on its own, for the big date; null when the label has another shape. */
function splitDate(label: string | undefined) {
  const m = label?.trim().match(/^(?:([A-Za-z]+),?\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{4})$/);
  return m ? { weekday: m[1] ?? '', day: m[2], month: m[3], year: m[4] } : null;
}

/** The marine opening: the event on the left, its invitation card on the right (no photo of the venue: the card is the picture). */
function WysHero({ event, canRequest, done, onRequest }: { event: PublicGuestEvent; canRequest: boolean; done: boolean; onRequest: () => void }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLElement>(null);
  const overlaid = useRegisterHeaderHero(ref);
  const s = event.settings || {};
  const parts = s.parts || [];
  const date = splitDate(s.date_label);
  const place = [s.venue, s.city].filter(Boolean);

  const trust = [
    t('wysPage.hero.trust.review', 'Every request is reviewed by the M3 team'),
    t('wysPage.hero.trust.noAccount', 'No account needed'),
    t('wysPage.hero.trust.answer', 'Our answer comes to you by e-mail'),
  ];

  return (
    <section ref={ref} aria-labelledby="wys-title" className="relative isolate overflow-hidden bg-navy text-white">
      <BathyPattern seed={4} drift className="absolute inset-0 -z-10" />
      <div
        className={cn(
          'mx-auto grid w-full max-w-7xl gap-10 px-4 pb-14 sm:px-6 lg:grid-cols-12 lg:items-center lg:gap-14 lg:pb-20',
          overlaid ? 'pt-[92px] md:pt-[104px] lg:pt-[116px]' : 'pt-12 lg:pt-16',
        )}
      >
        <div className="min-w-0 lg:col-span-7">
          <HeroIn>
            <Eyebrow tone="onDark">{t('wysPage.hero.eyebrow', 'By invitation · Organised by M3 Monaco')}</Eyebrow>
          </HeroIn>
          <LineReveal
            as="h1"
            id="wys-title"
            trigger="mount"
            delay={160}
            className="mt-5 text-balance text-[34px] font-semibold leading-[40px] tracking-[-0.025em] text-white sm:text-[42px] sm:leading-[48px] xl:text-[52px] xl:leading-[58px]"
          >
            {event.title}
          </LineReveal>
          {s.tagline && (
            <HeroIn as="p" delay={260} className="mt-5 max-w-[560px] text-[19px] leading-[30px] text-white/90">
              {s.tagline}
            </HeroIn>
          )}

          {done ? (
            <HeroIn delay={340} className="mt-7 flex max-w-[560px] items-start gap-3 rounded-field bg-white/10 p-4 text-[15px] leading-6 text-white">
              <CheckCircle className="mt-0.5 h-5 w-5 shrink-0 text-gold" aria-hidden="true" />
              <span>{t('wysPage.done.text', 'Your request has been received. Our team reviews every request and will come back to you by e-mail.')}</span>
            </HeroIn>
          ) : canRequest ? (
            <HeroIn delay={340} className="mt-7">
              <Button type="button" variant="ctaOnDark" size="lg" onClick={onRequest}>
                {t('wysPage.hero.cta', 'Request an invitation')}
              </Button>
            </HeroIn>
          ) : null}

          <HeroIn as="ul" delay={420} aria-label={t('wysPage.hero.trustLabel', 'How it works')} className="mt-7 grid gap-2.5 text-[14px] leading-5 text-white/85">
            {trust.map((line) => (
              <li key={line} className="flex gap-2.5">
                <Check className="mt-px h-[18px] w-[18px] shrink-0 text-gold" strokeWidth={2.5} aria-hidden="true" />
                {line}
              </li>
            ))}
          </HeroIn>
        </div>

        <HeroIn delay={200} className="min-w-0 lg:col-span-5">
          <div className="rounded-[24px] bg-navy-deep p-6 ring-1 ring-inset ring-white/15 sm:p-8">
            {s.logo_white_url && <img src={s.logo_white_url} alt="" className="h-14 w-auto max-w-full sm:h-16" />}

            {s.date_label && (
              <p className={cn(s.logo_white_url && 'mt-8')}>
                <span className="sr-only">{s.date_label}</span>
                {date ? (
                  <span aria-hidden="true" className="flex items-end gap-4">
                    <span className="font-signage text-[76px] font-semibold leading-[0.9] tabular-nums text-white">{date.day}</span>
                    <span className="pb-1">
                      {date.weekday && <span className="block text-[13px] font-semibold uppercase leading-4 tracking-[0.08em] text-white/70">{date.weekday}</span>}
                      <span className="mt-1 block text-h3 text-white">{date.month} {date.year}</span>
                    </span>
                  </span>
                ) : (
                  <span aria-hidden="true" className="flex items-center gap-3 text-h3 text-white">
                    <CalendarDays className="h-6 w-6 shrink-0 text-gold" />
                    {s.date_label}
                  </span>
                )}
              </p>
            )}

            <div className="my-6 h-px bg-white/15" />

            <ul className="grid gap-4 text-[15px] leading-6">
              {place.length > 0 && (
                <li className="flex gap-3">
                  <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-gold" aria-hidden="true" />
                  <div>
                    <span className="sr-only">{t('wysPage.card.venue', 'Venue')}: </span>
                    <span className="block font-semibold text-white">{place[0]}</span>
                    {place[1] && <span className="block text-white/75">{place[1]}</span>}
                  </div>
                </li>
              )}
              {parts.map((p) => (
                <li key={p.key} className="flex gap-3">
                  {p.key === 'gala' ? <Wine className="mt-0.5 h-5 w-5 shrink-0 text-gold" aria-hidden="true" /> : <Mic className="mt-0.5 h-5 w-5 shrink-0 text-gold" aria-hidden="true" />}
                  <div>
                    <span className="font-semibold text-white">{p.label}</span>
                    {p.when && <span className="text-white/75"> · {p.when}</span>}
                  </div>
                </li>
              ))}
              <li className="flex gap-3">
                <Lock className="mt-0.5 h-5 w-5 shrink-0 text-gold" aria-hidden="true" />
                <span className="font-semibold text-white">{t('wysPage.card.invitationOnly', 'By invitation only')}</span>
              </li>
            </ul>

            <p className="mt-6 border-t border-white/15 pt-5 text-[13px] font-semibold uppercase leading-4 tracking-[0.08em] text-white/70">
              {t('wysPage.card.organiser', 'Organised by M3 Monaco')}
            </p>
          </div>
        </HeroIn>
      </div>
    </section>
  );
}

/** A checkbox row as a tile: navy edge and foam fill once ticked. */
const tile = (on: boolean) =>
  cn(
    'flex min-h-12 cursor-pointer items-center gap-3 rounded-field border px-4 text-[15px] font-medium text-navy transition-colors focus-within:shadow-focus',
    on ? 'border-navy bg-foam' : 'border-checkbox bg-white hover:border-navy',
  );

export function GuestEventPage({ slug }: { slug: string }) {
  const { i18n, t } = useTranslation();
  const seoTr = useSeoTr();
  const [event, setEvent] = useState<PublicGuestEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY);
  const [wantsConference, setWantsConference] = useState(true);
  const [wantsGala, setWantsGala] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);

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

  /** The hero's button: bring the request form into view (and focus it for keyboard and screen reader users). */
  const goToForm = () => {
    const el = formRef.current;
    if (!el) return;
    el.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
    el.focus({ preventScroll: true });
  };

  if (loading) {
    return (
      <div role="status" className="flex min-h-[60vh] items-center justify-center bg-page">
        <Loader2 className="h-8 w-8 animate-spin text-navy" aria-hidden="true" />
        <span className="sr-only">{t('wysPage.loading', 'Loading the event')}</span>
      </div>
    );
  }
  if (!event) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 bg-page px-4 py-24 text-center">
        <p className="text-body-lg text-ink">{t('wysPage.notFound', 'This event could not be found.')}</p>
        <UnderlineLink to="/events">{t('wysPage.allEvents', 'See all events')}</UnderlineLink>
      </div>
    );
  }

  const s = event.settings || {};
  const parts = s.parts || [];
  const themes = s.themes || [];

  // The left column, section by section, numbered in the order they appear.
  const blocks: { id: string; render: (no: string) => ReactNode }[] = [];
  if (s.intro) {
    blocks.push({
      id: 'about',
      render: (no) => (
        <section aria-labelledby="wys-about">
          <Eyebrow number={no}>{t('wysPage.about.eyebrow', 'The event')}</Eyebrow>
          <h2 id="wys-about" className="mt-3 text-h2-sm text-navy md:text-h2">{t('wysPage.about.title', 'About the event')}</h2>
          <p className="mt-4 text-body-lg text-ink">{s.intro}</p>
          {s.website && (
            <p className="mt-5">
              <UnderlineLink href={s.website} external>{t('wysPage.about.website', 'Official website')}</UnderlineLink>
            </p>
          )}
        </section>
      ),
    });
  }
  if (parts.length > 0) {
    blocks.push({
      id: 'format',
      render: (no) => (
        <section aria-labelledby="wys-format">
          <Eyebrow number={no}>{t('wysPage.format.eyebrow', 'Format')}</Eyebrow>
          <h2 id="wys-format" className="mt-3 text-h2-sm text-navy md:text-h2">{t('wysPage.format.title', 'On the day')}</h2>
          <ul className="mt-6 grid gap-4 sm:grid-cols-2">
            {parts.map(p => (
              <li key={p.key} className="rounded-card bg-white p-5 ring-1 ring-inset ring-rule sm:p-6">
                <span aria-hidden="true" className="grid h-11 w-11 place-items-center rounded-full bg-foam text-teal-text">
                  {p.key === 'gala' ? <Wine className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                </span>
                <p className="mt-4 text-card-title text-navy">{p.label}</p>
                {p.when && <p className="mt-1 text-sm text-meta">{p.when}</p>}
              </li>
            ))}
          </ul>
        </section>
      ),
    });
  }
  if (themes.length > 0) {
    blocks.push({
      id: 'themes',
      render: (no) => (
        <section aria-labelledby="wys-themes">
          <Eyebrow number={no}>{t('wysPage.themes.eyebrow', 'Conference')}</Eyebrow>
          <h2 id="wys-themes" className="mt-3 text-h2-sm text-navy md:text-h2">{t('wysPage.themes.title', 'Conference themes')}</h2>
          <ol className="mt-6 divide-y divide-rule border-y border-rule">
            {themes.map((theme, i) => (
              <li key={i} className="flex gap-5 py-4 text-body text-ink">
                <span aria-hidden="true" className="w-7 shrink-0 font-semibold tabular-nums text-gold-text">{String(i + 1).padStart(2, '0')}</span>
                <span>{theme}</span>
              </li>
            ))}
          </ol>
        </section>
      ),
    });
  }

  const attend = (
    <fieldset className="space-y-2">
      <legend className="text-sm font-semibold leading-5 text-navy">
        {t('wysPage.form.attend', 'I would like to attend')} <span aria-hidden="true" className="text-red-700">*</span>
      </legend>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className={tile(wantsConference)}>
          <Checkbox checked={wantsConference} onCheckedChange={v => setWantsConference(v === true)} className="h-5 w-5 border-checkbox" /> {t('wysPage.form.conference', 'Conference')}
        </label>
        <label className={tile(wantsGala)}>
          <Checkbox checked={wantsGala} onCheckedChange={v => setWantsGala(v === true)} className="h-5 w-5 border-checkbox" /> {t('wysPage.form.gala', 'Gala dinner')}
        </label>
      </div>
    </fieldset>
  );
  const star = <span aria-hidden="true" className="text-red-700">*</span>;

  return (
    <div className="min-h-screen bg-page">
      {/* /wys26 has its own words in src/i18n/seo.ts, the ones the edge function writes into the
          HTML for share previews of the invitation link; another guest-list event uses its own. */}
      <Seo
        title={withSiteSuffix(i18n.exists(`seo.${slug}.title`) ? seoTr(`${slug}.title`) : `${event.title} — Request an invitation`)}
        description={i18n.exists(`seo.${slug}.description`) ? seoTr(`${slug}.description`) : (s.tagline || event.title)}
        path={`/${slug}`}
      />

      <WysHero event={event} canRequest={event.requests_open} done={done} onRequest={goToForm} />

      <div className="mx-auto grid w-full max-w-7xl gap-10 px-4 py-12 sm:px-6 md:py-16 lg:grid-cols-12 lg:gap-14">
        <div className="min-w-0 space-y-12 md:space-y-14 lg:col-span-7">
          {blocks.map((b, i) => (
            <Reveal key={b.id}>{b.render(String(i + 1).padStart(2, '0'))}</Reveal>
          ))}
          {s.programme_note && (
            <Reveal>
              <p className="flex items-start gap-3 rounded-field bg-foam p-4 text-sm leading-6 text-ink">
                <Clock className="mt-0.5 h-4 w-4 shrink-0 text-teal-text" aria-hidden="true" />
                {s.programme_note}
              </p>
            </Reveal>
          )}
        </div>

        <div className="min-w-0 lg:col-span-5">
          <div
            id="request"
            ref={formRef}
            tabIndex={-1}
            className="scroll-mt-24 rounded-card bg-white p-6 ring-1 ring-inset ring-rule focus:outline-none sm:p-8"
          >
            {done ? (
              <div role="status" className="py-6 text-center">
                <span aria-hidden="true" className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-pill bg-foam text-teal-text">
                  <CheckCircle className="h-8 w-8" />
                </span>
                <h2 className="text-h2-sm text-navy">{t('wysPage.done.title', 'Thank you')}</h2>
                <p className="mx-auto mt-3 max-w-sm text-body text-ink">{t('wysPage.done.text', 'Your request has been received. Our team reviews every request and will come back to you by e-mail.')}</p>
              </div>
            ) : !event.requests_open ? (
              <div className="py-6 text-center">
                <span aria-hidden="true" className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-pill bg-page text-meta">
                  <Lock className="h-6 w-6" />
                </span>
                <h2 className="text-h3 text-navy">{t('wysPage.closed.title', 'Invitation requests are not open yet')}</h2>
                <p className="mt-3 text-sm text-ink">
                  {t('wysPage.closed.enquiry', 'For any enquiry:')}{' '}
                  <UnderlineLink href={`mailto:${M3_PUBLIC_EMAIL}`} arrow={false} className="!text-sm">{M3_PUBLIC_EMAIL}</UnderlineLink>
                </p>
              </div>
            ) : (
              <form onSubmit={submit} className="space-y-5">
                <div>
                  <Eyebrow>{t('wysPage.form.eyebrow', 'Invitation request')}</Eyebrow>
                  <h2 className="mt-3 text-h2-sm text-navy">{t('wysPage.form.title', 'Request an invitation')}</h2>
                  <p className="mt-2 text-sm leading-6 text-ink">{t('wysPage.form.intro', 'Attendance is by invitation only. Tell us who you are and we will come back to you.')}</p>
                  <p className="mt-1 text-sm text-meta">{t('wysPage.form.required', 'Fields marked * are required.')}</p>
                </div>
                <div className="grid gap-5 sm:grid-cols-2">
                  <div className="space-y-2"><Label htmlFor="fn">{t('wysPage.form.firstName', 'First name')} {star}</Label><Input id="fn" required value={form.first_name} onChange={set('first_name')} autoComplete="given-name" /></div>
                  <div className="space-y-2"><Label htmlFor="ln">{t('wysPage.form.lastName', 'Last name')} {star}</Label><Input id="ln" required value={form.last_name} onChange={set('last_name')} autoComplete="family-name" /></div>
                </div>
                <div className="space-y-2"><Label htmlFor="em">{t('wysPage.form.email', 'E-mail')} {star}</Label><Input id="em" type="email" required value={form.email} onChange={set('email')} autoComplete="email" /></div>
                <div className="space-y-2"><Label htmlFor="ph">{t('wysPage.form.phone', 'Phone')}</Label><Input id="ph" type="tel" value={form.phone} onChange={set('phone')} autoComplete="tel" /></div>
                <div className="space-y-2"><Label htmlFor="co">{t('wysPage.form.company', 'Company')} {star}</Label><Input id="co" required value={form.company} onChange={set('company')} autoComplete="organization" /></div>
                <div className="space-y-2"><Label htmlFor="jt">{t('wysPage.form.jobTitle', 'Job title')} {star}</Label><Input id="jt" required value={form.job_title} onChange={set('job_title')} autoComplete="organization-title" /></div>
                <div className="space-y-2"><Label htmlFor="ct">{t('wysPage.form.country', 'Country')}</Label><Input id="ct" value={form.country} onChange={set('country')} autoComplete="country-name" /></div>
                {attend}
                <div className="space-y-2"><Label htmlFor="mo">{t('wysPage.form.motivation', 'Why would you like to attend?')}</Label><Textarea id="mo" rows={3} value={form.motivation} onChange={set('motivation')} /></div>
                {/* Honeypot — invisible to people, filled by bots. */}
                <input type="text" tabIndex={-1} autoComplete="off" value={form.website} onChange={set('website')}
                  className="absolute -left-[9999px] h-0 w-0 opacity-0" aria-hidden="true" />
                {error && <FieldError>{error}</FieldError>}
                <Button type="submit" variant="cta" disabled={sending} arrow={!sending} roll={!sending} className="w-full justify-between">
                  {sending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />{t('wysPage.form.sending', 'Sending…')}</> : t('wysPage.form.send', 'Send my request')}
                </Button>
                <p className="text-[13px] leading-5 text-meta">{t('wysPage.form.privacy', 'Your details are used only to process your request for this event.')}</p>
              </form>
            )}
          </div>
        </div>

      </div>

      <div className="mx-auto w-full max-w-7xl px-4 pb-14 sm:px-6 md:pb-20">
        <div className="grid lg:grid-cols-12">
          <Reveal className="lg:col-span-6 lg:col-start-4">
            <ContactCard
              variant="panel"
              title={t('wysPage.contact.title', 'A question about the event?')}
              line={t('wysPage.contact.line', 'Programme, venue or your invitation: write to the M3 team.')}
            />
          </Reveal>
        </div>
      </div>
    </div>
  );
}
