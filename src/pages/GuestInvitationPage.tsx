import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Helmet } from 'react-helmet-async';
import { useSearchParams } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import QRCode from 'qrcode';
import { CalendarDays, MapPin, Loader2, CheckCircle, XCircle, Clock, UserPlus, Link2Off } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AuthInput as Input, AuthLabel as Label, FieldError } from '@/components/auth/fields';
import { Eyebrow } from '@/components/brand/Eyebrow';
import { ContactCard, M3_PUBLIC_EMAIL } from '@/components/brand/ContactCard';
import { UnderlineLink } from '@/components/brand/UnderlineLink';
import { BathyPattern } from '@/components/motion/BathyPattern';
import { useRegisterHeaderHero } from '@/components/layout/headerOverlay';
import { guestList, partsLabel, type GuestStatus, type GuestView } from '@/lib/guestList';
import { registerWysRefonteStrings } from '@/i18n/refonte-wys';
import { cn } from '@/lib/utils';

registerWysRefonteStrings();

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

/** The invitation's navy header: the event's logo and its date and place. The site header overlaps it. */
function InvitationBand({ view }: { view: GuestView }) {
  const ref = useRef<HTMLElement>(null);
  const overlaid = useRegisterHeaderHero(ref);
  const { event } = view;
  const s = event.settings || {};
  return (
    <section ref={ref} className="relative isolate overflow-hidden bg-navy text-white">
      <BathyPattern seed={4} drift className="absolute inset-0 -z-10" />
      <div className={cn('mx-auto w-full max-w-xl px-4 pb-24 sm:px-6', overlaid ? 'pt-[92px] md:pt-[104px]' : 'pt-10')}>
        {s.logo_white_url
          ? <img src={s.logo_white_url} alt={event.title} className="h-12 w-auto max-w-full sm:h-14" />
          : <p className="text-h3 text-white">{event.title}</p>}
        <div className="mt-5 flex flex-col gap-2 text-[15px] leading-6 text-white/85">
          {s.date_label && <span className="flex items-center gap-2.5"><CalendarDays className="h-[18px] w-[18px] shrink-0 text-gold" aria-hidden="true" />{s.date_label}</span>}
          {s.venue && <span className="flex items-center gap-2.5"><MapPin className="h-[18px] w-[18px] shrink-0 text-gold" aria-hidden="true" />{s.venue}{s.city ? `, ${s.city}` : ''}</span>}
        </div>
      </div>
    </section>
  );
}

/** Where the invitation stands, in one word. */
function StatusPill({ status }: { status: GuestStatus }) {
  const { t } = useTranslation();
  const tone = {
    invited: { key: 'invited', label: 'Awaiting your answer', cls: 'bg-chip text-navy ring-navy/15', Icon: Clock },
    requested: { key: 'requested', label: 'Under review', cls: 'bg-amber-50 text-amber-800 ring-amber-200', Icon: Clock },
    confirmed: { key: 'confirmed', label: 'Confirmed', cls: 'bg-foam text-teal-text ring-teal/30', Icon: CheckCircle },
    declined: { key: 'declined', label: 'Declined', cls: 'bg-page text-meta ring-rule', Icon: XCircle },
    rejected: { key: 'closed', label: 'No longer active', cls: 'bg-page text-meta ring-rule', Icon: XCircle },
    cancelled: { key: 'closed', label: 'No longer active', cls: 'bg-page text-meta ring-rule', Icon: XCircle },
  }[status];
  const { Icon } = tone;
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-pill px-3 py-1 text-[13px] font-semibold leading-5 ring-1 ring-inset', tone.cls)}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {t(`wysGuest.status.${tone.key}`, tone.label)}
    </span>
  );
}

/** One line of the invitation's details: a small caps label and its value. */
function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="px-4 py-3 sm:flex sm:items-baseline sm:gap-6">
      <dt className="text-meta-caps sm:w-28 sm:shrink-0">{label}</dt>
      <dd className="mt-0.5 text-[15px] leading-6 text-navy sm:mt-0">{children}</dd>
    </div>
  );
}

export function GuestInvitationPage() {
  const { t } = useTranslation();
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

  if (loading) {
    return (
      <div role="status" className="flex min-h-[60vh] items-center justify-center bg-page">
        <Loader2 className="h-8 w-8 animate-spin text-navy" aria-hidden="true" />
        <span className="sr-only">{t('wysGuest.loading', 'Loading your invitation')}</span>
      </div>
    );
  }
  if (!view) {
    return (
      <div className="min-h-[60vh] bg-page px-4 py-16 sm:py-24">
        <Helmet><meta name="robots" content="noindex" /></Helmet>
        <div className="mx-auto w-full max-w-xl space-y-6">
          <div role="alert" className="rounded-card bg-white p-6 text-center ring-1 ring-inset ring-rule sm:p-8">
            <span aria-hidden="true" className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-pill bg-page text-meta">
              <Link2Off className="h-6 w-6" />
            </span>
            <h1 className="text-h3 text-navy">{t('wysGuest.invalid.title', 'This invitation link cannot be opened')}</h1>
            <p className="mt-3 text-balance text-body text-ink">{error}</p>
          </div>
          <ContactCard />
        </div>
      </div>
    );
  }

  const { event, guest } = view;
  const s = event.settings || {};
  const part = partsLabel(guest).toLowerCase();
  const guestName = [guest.first_name, guest.last_name].filter(Boolean).join(' ');
  const bold = { b: <strong className="font-semibold text-navy" /> };

  return (
    <div className="min-h-screen bg-page">
      <Helmet><title>{`Your invitation — ${event.title}`}</title><meta name="robots" content="noindex" /></Helmet>
      <InvitationBand view={view} />

      <div className="relative z-10 mx-auto -mt-14 w-full max-w-xl space-y-6 px-4 pb-14 sm:px-6 md:pb-20">
        {/* The invitation itself. */}
        <section aria-labelledby="inv-title" className="rounded-card bg-white p-6 ring-1 ring-inset ring-rule sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <Eyebrow>{t('wysGuest.eyebrow', 'Your invitation')}</Eyebrow>
            <StatusPill status={guest.status} />
          </div>
          <h1 id="inv-title" className="mt-4 text-h2-sm text-navy md:text-h2">{t('wysGuest.dear', { name: guest.first_name, defaultValue: 'Dear {{name}},' })}</h1>

          <div className="mt-5 space-y-5">
            {guest.status === 'invited' && (
              <>
                <p className="text-body-lg text-ink">
                  <Trans i18nKey="wysGuest.invited.text" values={{ event: event.title, part }} components={bold}
                    defaults="You are invited to <b>{{event}}</b> for the <b>{{part}}</b>. Will you join us?" />
                </p>
                {suggested && <p className="text-sm text-meta">{t('wysGuest.invited.confirmBelow', 'Please confirm your answer below.')}</p>}
                <div className="flex flex-col gap-3 sm:flex-row">
                  <Button variant="cta" disabled={busy} onClick={() => answer('accept')} arrow={!busy} roll={!busy}
                    className={cn('flex-1 justify-between', suggested === 'accept' && 'ring-4 ring-gold/40')}>
                    {busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />{t('wysGuest.invited.accept', 'I accept')}</> : t('wysGuest.invited.accept', 'I accept')}
                  </Button>
                  <Button variant="ctaOutline" disabled={busy} onClick={() => answer('decline')} arrow={false} roll={!busy}
                    className={cn('flex-1', suggested === 'decline' && 'ring-4 ring-navy/20')}>
                    {t('wysGuest.invited.decline', 'I cannot attend')}
                  </Button>
                </div>
              </>
            )}

            {guest.status === 'requested' && (
              <div className="flex items-start gap-3 text-body text-ink">
                <Clock className="mt-1 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
                <p>{t('wysGuest.requested.review', {
                  what: guest.is_plus_one ? t('wysGuest.requested.plusOne', 'Your plus-one request') : t('wysGuest.requested.yours', 'Your request'),
                  defaultValue: '{{what}} is being reviewed. We will come back to you by email.',
                })}</p>
              </div>
            )}

            {guest.status === 'confirmed' && (
              <div className="flex items-start gap-3 text-body-lg text-ink">
                <CheckCircle className="mt-1 h-5 w-5 shrink-0 text-teal-text" aria-hidden="true" />
                <p>
                  <Trans i18nKey="wysGuest.confirmed.text" values={{ part }} components={bold}
                    defaults="Your place is confirmed for the <b>{{part}}</b>" />
                  {guest.host ? t('wysGuest.confirmed.asGuestOf', { host: `${guest.host.first_name} ${guest.host.last_name}`, defaultValue: ' as the guest of {{host}}' }) : null}.
                </p>
              </div>
            )}

            {guest.status === 'declined' && (
              <>
                <div className="flex items-start gap-3 text-body text-ink">
                  <XCircle className="mt-1 h-5 w-5 shrink-0 text-meta" aria-hidden="true" />
                  <p>{t('wysGuest.declined.text', 'You have let us know you cannot attend. Thank you for your answer.')}</p>
                </div>
                {guest.source !== 'request' && !guest.is_plus_one && (
                  <Button variant="ctaOutline" disabled={busy} onClick={() => answer('accept')} arrow={false} roll={false} className="w-full sm:w-auto">
                    {t('wysGuest.declined.changed', 'Changed your mind? Accept the invitation')}
                  </Button>
                )}
              </>
            )}

            {(guest.status === 'rejected' || guest.status === 'cancelled') && (
              <p className="text-body text-ink">
                {t('wysGuest.closed.text', 'This invitation is no longer active. For any question, contact')}{' '}
                <UnderlineLink href={`mailto:${M3_PUBLIC_EMAIL}`} arrow={false}>{M3_PUBLIC_EMAIL}</UnderlineLink>.
              </p>
            )}

            {error && <FieldError>{error}</FieldError>}
          </div>

          {/* The ticket: who it is for and what it admits to. */}
          {guest.status !== 'rejected' && guest.status !== 'cancelled' && (
            <dl aria-label={t('wysGuest.details.label', 'Your invitation')} className="mt-6 divide-y divide-rule rounded-field ring-1 ring-inset ring-rule">
              <Detail label={t('wysGuest.details.guest', 'Guest')}>
                <span className="font-semibold">{guestName}</span>
                {guest.company && <span className="block text-ink">{guest.company}</span>}
              </Detail>
              <Detail label={t('wysGuest.details.admission', 'Admission')}>{partsLabel(guest)}</Detail>
              {guest.host && <Detail label={t('wysGuest.details.host', 'Guest of')}>{guest.host.first_name} {guest.host.last_name}</Detail>}
            </dl>
          )}

          {/* Confirmed: the entry pass, as large as the card allows, on white with room around it. */}
          {guest.status === 'confirmed' && qr && (
            <div className="mt-6 border-t border-dashed border-rule pt-6 text-center">
              <p className="text-meta-caps">{t('wysGuest.confirmed.passLabel', 'Entry pass')}</p>
              <div className="mx-auto mt-4 w-fit max-w-full rounded-card bg-white p-3 ring-1 ring-inset ring-rule">
                <img src={qr} alt={t('wysGuest.confirmed.qrAlt', 'Your entry QR code')} className="mx-auto h-auto w-[256px] max-w-full sm:w-[288px]" />
              </div>
              <p className="mx-auto mt-4 max-w-sm text-sm leading-6 text-meta">{t('wysGuest.confirmed.qrHelp', 'Show this QR code at the entrance. No QR? Just give your name at the desk.')}</p>
            </div>
          )}

          {guest.status === 'confirmed' && (
            <p className="mt-6 text-center">
              <UnderlineLink onClick={() => answer('decline')} disabled={busy} arrow={false} className="!text-sm">
                {t('wysGuest.confirmed.cancel', 'I can no longer attend')}
              </UnderlineLink>
            </p>
          )}
        </section>

        {guest.status === 'confirmed' && !guest.is_plus_one && (
          <section aria-labelledby="inv-plus" className="rounded-card bg-white p-6 ring-1 ring-inset ring-rule sm:p-8">
            <div className="flex items-center gap-3">
              <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-foam text-teal-text"><UserPlus className="h-5 w-5" /></span>
              <h2 id="inv-plus" className="text-card-title text-navy">{t('wysGuest.plusOne.title', 'Plus-one')}</h2>
            </div>
            <div className="mt-4 space-y-4">
              {guest.plus_one ? (
                <p className="text-sm leading-6 text-ink">
                  {guest.plus_one.first_name} {guest.plus_one.last_name} —{' '}
                  {guest.plus_one.status === 'confirmed'
                    ? t('wysGuest.plusOne.confirmed', 'confirmed; they have received their own entry pass by email.')
                    : t('wysGuest.plusOne.pending', 'request under review.')}
                </p>
              ) : !plusOpen ? (
                <>
                  <p className="text-sm leading-6 text-ink">{t('wysGuest.plusOne.ask', 'Would you like to bring someone? Tell us who — each plus-one is reviewed by our team and receives their own entry pass.')}</p>
                  <Button variant="ctaOutline" size="sm" arrow={false} roll={false} onClick={() => setPlusOpen(true)}>{t('wysGuest.plusOne.open', 'Request a plus-one')}</Button>
                </>
              ) : (
                <form onSubmit={askPlusOne} className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2"><Label htmlFor="po-fn">{t('wysGuest.plusOne.firstName', 'First name')} *</Label><Input id="po-fn" required value={plus.first_name} onChange={e => setPlus({ ...plus, first_name: e.target.value })} /></div>
                    <div className="space-y-2"><Label htmlFor="po-ln">{t('wysGuest.plusOne.lastName', 'Last name')} *</Label><Input id="po-ln" required value={plus.last_name} onChange={e => setPlus({ ...plus, last_name: e.target.value })} /></div>
                  </div>
                  <div className="space-y-2"><Label htmlFor="po-em">{t('wysGuest.plusOne.email', 'Their email')} *</Label><Input id="po-em" type="email" required value={plus.email} onChange={e => setPlus({ ...plus, email: e.target.value })} /></div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2"><Label htmlFor="po-co">{t('wysGuest.plusOne.company', 'Company')}</Label><Input id="po-co" value={plus.company} onChange={e => setPlus({ ...plus, company: e.target.value })} /></div>
                    <div className="space-y-2"><Label htmlFor="po-jt">{t('wysGuest.plusOne.jobTitle', 'Job title')}</Label><Input id="po-jt" value={plus.job_title} onChange={e => setPlus({ ...plus, job_title: e.target.value })} /></div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <Button type="submit" variant="ctaNavy" size="sm" disabled={busy} arrow={!busy} roll={!busy}>
                      {busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />{t('wysGuest.plusOne.send', 'Send request')}</> : t('wysGuest.plusOne.send', 'Send request')}
                    </Button>
                    <Button type="button" variant="ghost" onClick={() => setPlusOpen(false)}>{t('wysGuest.plusOne.cancel', 'Cancel')}</Button>
                  </div>
                </form>
              )}
            </div>
          </section>
        )}

        {s.programme_note && <p className="text-center text-sm leading-6 text-meta">{s.programme_note}</p>}

        <ContactCard line={t('wysGuest.contact.line', 'A question about your invitation? Write to the M3 team.')} />
      </div>
    </div>
  );
}
