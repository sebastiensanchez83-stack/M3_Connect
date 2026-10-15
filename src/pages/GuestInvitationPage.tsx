import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link, useSearchParams } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import QRCode from 'qrcode';
import { CalendarDays, MapPin, Loader2, CheckCircle, XCircle, Clock, UserPlus, Link2, Link2Off, Pencil, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { AuthInput as Input, AuthLabel as Label, AuthTextarea as Textarea, FieldError, FieldHint } from '@/components/auth/fields';
import { Eyebrow } from '@/components/brand/Eyebrow';
import { ContactCard, M3_PUBLIC_EMAIL } from '@/components/brand/ContactCard';
import { UnderlineLink } from '@/components/brand/UnderlineLink';
import { BathyPattern } from '@/components/motion/BathyPattern';
import { useRegisterHeaderHero } from '@/components/layout/headerOverlay';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/hooks/use-toast';
import { accountHref } from '@/lib/accountNav';
import { newEventPagesOn, useRegistrationFlags } from '@/lib/flags';
import {
  attachWysRequest, cancelWysRequest, getWysRequest, guestList, partsLabel, restoreWysRequest, updateWysRequest,
  type GuestStatus, type GuestView, type WysRequestChanges, type WysRequestView,
} from '@/lib/guestList';
import { registrationErrorText, type RegFailure } from '@/lib/registration';
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
//
// Switch wys_status_edit (registration_flags, off by default) adds, through the
// `registration` function: "Edit my request" and "Cancel my request" while a
// request is under review, "Send my request again" once its author cancelled it,
// and "Add to my account" when signed in. Everything else (the view, RSVP, the
// pass, the plus-one) stays on guest-list, and the statuses show exactly as
// before. Switch off: nothing of this is called, except on a hidden test event
// (slug canary-*), which the server serves with every switch off so the
// contract tests and the pre-switch check can use the real page.

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

/** A checkbox row as a tile, as on the request form: navy edge and foam fill once ticked. */
const tile = (on: boolean) =>
  cn(
    'flex min-h-12 cursor-pointer items-center gap-3 rounded-field border px-4 text-[15px] font-medium text-navy transition-colors focus-within:shadow-focus',
    on ? 'border-navy bg-foam' : 'border-checkbox bg-white hover:border-navy',
  );

type EditValues = Omit<NonNullable<WysRequestView['request']>, 'first_name' | 'last_name' | 'email_masked'>;
const EDIT_KEYS: (keyof EditValues)[] = ['phone', 'company', 'job_title', 'country', 'motivation', 'wants_conference', 'wants_gala'];

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

  // ── Switch wys_status_edit: edit / cancel a request, add it to the account (registration). ──
  const { user } = useAuth();
  const userId = user?.id;
  const { flags } = useRegistrationFlags();
  const canary = !!view?.event.slug?.startsWith('canary-');
  const statusEdit = flags.wys_status_edit || canary;
  // "My events" lists guest-list rows only with the new event pages on (MyEvents.tsx):
  // promise it, and offer "Add to my account", only then.
  const myEventsShowsIt = newEventPagesOn(flags) || canary;
  const [req, setReq] = useState<WysRequestView | null>(null);
  const [reqVersion, setReqVersion] = useState(0);
  const [editing, setEditing] = useState(false);
  const [edit, setEdit] = useState<EditValues | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [reqBusy, setReqBusy] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [reqError, setReqError] = useState<string | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);
  const guestStatus = view?.guest.status;

  // Asked only with the switch on, or on a canary (an answer of "not_available" just hides the buttons).
  useEffect(() => {
    if (!statusEdit || !token || !guestStatus) { setReq(null); return; }
    let alive = true;
    getWysRequest(token).then((r) => { if (alive) setReq(r.ok ? (r as WysRequestView) : null); });
    return () => { alive = false; };
  }, [statusEdit, token, guestStatus, userId, reqVersion]);

  /** The guest-list view again (status, company), after a change made through registration. */
  const reloadGuest = async () => {
    const r = await guestList<GuestView>({ action: 'guest', token });
    if (!r.error) setView(r);
  };

  const reqErrorText = (f: RegFailure) => {
    if (f.error === 'no_part') return t('wysGuest.edit.noPart', 'Choose the conference, the gala dinner, or both.');
    if (f.error === 'missing_fields') return t('wysGuest.edit.missing', 'Please give your company and your job title.');
    if (f.error === 'locked') return t('wysGuest.edit.locked', 'Your request can no longer be changed: our team has already answered it.');
    if (f.error === 'closed') return t('wysGuest.restore.closed', 'Invitation requests are not open at the moment.');
    if (f.error === 'use_invitation_email') return t('wysGuest.account.otherEmail', 'This invitation can only be added to the account that uses the address it was sent to.');
    return registrationErrorText(t, f);
  };

  /** After a tap that opens a block further down: bring it into view and give it the focus
   *  (once React has put it in the page). */
  const [focusTarget, setFocusTarget] = useState<string | null>(null);
  const focusSoon = (id: string) => setFocusTarget(id);
  useEffect(() => {
    if (!focusTarget) return;
    const el = document.getElementById(focusTarget);
    setFocusTarget(null);
    if (!el) return;
    const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' });
    el.focus({ preventScroll: true });
  }, [focusTarget]);

  const openEdit = () => {
    if (!req?.request) return;
    const r = req.request;
    setEdit({
      phone: r.phone, company: r.company, job_title: r.job_title, country: r.country, motivation: r.motivation,
      wants_conference: r.wants_conference, wants_gala: r.wants_gala,
    });
    setReqError(null);
    setConfirmCancel(false);
    setEditing(true);
    focusSoon('inv-edit');
  };

  const openCancel = () => {
    setReqError(null);
    setConfirmCancel(true);
    focusSoon('inv-cancel-title');
  };

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!edit || !req?.request) return;
    if (!edit.wants_conference && !edit.wants_gala) { setReqError(t('wysGuest.edit.noPart', 'Choose the conference, the gala dinner, or both.')); return; }
    if (!edit.company.trim() || !edit.job_title.trim()) { setReqError(t('wysGuest.edit.missing', 'Please give your company and your job title.')); return; }
    // Only what changed goes to the server.
    const before = req.request;
    const changes: WysRequestChanges = {};
    for (const k of EDIT_KEYS) {
      const v = edit[k];
      if (typeof v === 'string' ? v.trim() !== String(before[k] ?? '').trim() : v !== before[k]) {
        (changes as Record<string, unknown>)[k] = typeof v === 'string' ? v.trim() : v;
      }
    }
    setReqBusy(true); setReqError(null);
    const r = Object.keys(changes).length ? await updateWysRequest(token, changes) : ({ ...req } as WysRequestView);
    setReqBusy(false);
    if (r.ok) {
      setReq(r as WysRequestView);
      setEditing(false);
      toast({ title: t('wysGuest.edit.saved', 'Your request is updated.') });
      void reloadGuest();
      return;
    }
    const f = r as RegFailure;
    setReqError(reqErrorText(f));
    if (f.error === 'locked') { setEditing(false); void reloadGuest(); setReqVersion((v) => v + 1); }
  };

  const doCancel = async () => {
    setReqBusy(true); setReqError(null);
    const r = await cancelWysRequest(token);
    setReqBusy(false);
    if (r.ok) {
      setConfirmCancel(false);
      setEditing(false);
      toast({ title: t('wysGuest.cancel.done', 'Your request is cancelled.') });
      await reloadGuest();
      setReqVersion((v) => v + 1);
      return;
    }
    const f = r as RegFailure;
    setReqError(reqErrorText(f));
    if (f.error === 'locked') { setConfirmCancel(false); void reloadGuest(); setReqVersion((v) => v + 1); }
  };

  const doAttach = async () => {
    setReqBusy(true); setAttachError(null);
    const r = await attachWysRequest(token);
    setReqBusy(false);
    if (r.ok) {
      toast({ title: t('wysGuest.account.added', 'Added to your account. You’ll find it in My events.') });
      setReqVersion((v) => v + 1);
      return;
    }
    setAttachError(reqErrorText(r as RegFailure));
  };

  const doRestore = async () => {
    setReqBusy(true); setRestoreError(null);
    const r = await restoreWysRequest(token);
    setReqBusy(false);
    if (r.ok) {
      setReq(r as WysRequestView);
      toast({ title: t('wysGuest.restore.done', 'Your request is sent again. Our team will review it.') });
      await reloadGuest();
      return;
    }
    setRestoreError(reqErrorText(r as RegFailure));
    void reloadGuest();
    setReqVersion((v) => v + 1);
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
                  defaultValue: '{{what}} is being reviewed. We will come back to you by e-mail.',
                })}</p>
              </div>
            )}

            {/* wys_status_edit: change or withdraw a request still under review. */}
            {guest.status === 'requested' && req && req.status === 'requested' && (req.can_edit || req.can_cancel) && !editing && !confirmCancel && (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
                {req.can_edit && (
                  <Button variant="ctaOutline" size="sm" arrow={false} roll={false} onClick={openEdit} className="w-full sm:w-auto">
                    <Pencil className="mr-2 h-4 w-4" aria-hidden="true" />{t('wysGuest.edit.open', 'Edit my request')}
                  </Button>
                )}
                {req.can_cancel && (
                  <UnderlineLink onClick={openCancel} arrow={false} className="min-h-11 self-start !text-sm sm:self-auto">
                    {t('wysGuest.cancel.open', 'Cancel my request')}
                  </UnderlineLink>
                )}
              </div>
            )}

            {guest.status === 'requested' && confirmCancel && (
              <div role="group" aria-labelledby="inv-cancel-title" className="rounded-field bg-page p-4 ring-1 ring-inset ring-rule sm:p-5">
                <p id="inv-cancel-title" tabIndex={-1} className="scroll-mt-28 text-[15px] font-semibold leading-6 text-navy focus:outline-none">{t('wysGuest.cancel.title', 'Cancel your request?')}</p>
                <p className="mt-1 text-sm leading-6 text-ink">
                  {t('wysGuest.cancel.body', 'Our team will no longer review it.')}{' '}
                  {guest.source === 'request' && !guest.is_plus_one
                    ? t('wysGuest.cancel.again', 'If you change your mind, you can send it again from this page while requests are open.')
                    : t('wysGuest.cancel.againContact', 'If you change your mind, write to the M3 team.')}
                </p>
                <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                  <Button variant="ctaNavy" size="sm" disabled={reqBusy} arrow={false} roll={!reqBusy} onClick={() => void doCancel()} className="w-full sm:w-auto">
                    {reqBusy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />{t('wysGuest.cancel.confirm', 'Yes, cancel my request')}</> : t('wysGuest.cancel.confirm', 'Yes, cancel my request')}
                  </Button>
                  <Button variant="ghost" size="sm" disabled={reqBusy} onClick={() => setConfirmCancel(false)} className="w-full sm:w-auto">
                    {t('wysGuest.cancel.keep', 'Keep my request')}
                  </Button>
                </div>
              </div>
            )}

            {reqError && !editing && <FieldError>{reqError}</FieldError>}

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

            {/* wys_status_edit: a request its author cancelled from this page can be sent again. */}
            {guest.status === 'cancelled' && req && req.status === 'cancelled' && req.can_restore ? (
              <>
                <p className="text-body text-ink">{t('wysGuest.restore.text', 'You cancelled your request. Changed your mind? You can send it again: our team will review it as before.')}</p>
                <Button variant="ctaOutline" size="sm" disabled={reqBusy} arrow={false} roll={false} onClick={() => void doRestore()} className="w-full sm:w-auto">
                  {reqBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />}
                  {t('wysGuest.restore.open', 'Send my request again')}
                </Button>
                {restoreError && <FieldError>{restoreError}</FieldError>}
              </>
            ) : (guest.status === 'rejected' || guest.status === 'cancelled') && (
              <>
                <p className="text-body text-ink">
                  {t('wysGuest.closed.text', 'This invitation is no longer active. For any question, contact')}{' '}
                  <UnderlineLink href={`mailto:${M3_PUBLIC_EMAIL}`} arrow={false}>{M3_PUBLIC_EMAIL}</UnderlineLink>.
                </p>
                {restoreError && <FieldError>{restoreError}</FieldError>}
              </>
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

        {/* wys_status_edit: the request's details, while under review. Names and e-mail stay as sent. */}
        {editing && edit && req?.request && guest.status === 'requested' && (
          <section aria-labelledby="inv-edit" className="rounded-card bg-white p-6 ring-1 ring-inset ring-rule sm:p-8">
            <div className="flex items-center gap-3">
              <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-foam text-teal-text"><Pencil className="h-5 w-5" /></span>
              <h2 id="inv-edit" tabIndex={-1} className="scroll-mt-28 text-card-title text-navy focus:outline-none">{t('wysGuest.edit.title', 'Edit my request')}</h2>
            </div>
            <form onSubmit={saveEdit} className="mt-5 space-y-5">
              <div className="rounded-field bg-page px-4 py-3 text-sm leading-6 text-ink">
                <span className="font-semibold text-navy">{[req.request.first_name, req.request.last_name].filter(Boolean).join(' ')}</span>
                <span className="block break-all text-meta">{req.request.email_masked}</span>
                <span className="mt-1 block text-[13px] leading-5 text-meta">{t('wysGuest.edit.identity', 'Your name and e-mail cannot be changed here. For a change, write to the M3 team.')}</span>
              </div>
              <div className="space-y-2"><Label htmlFor="ed-ph">{t('wysPage.form.phone', 'Phone')}</Label><Input id="ed-ph" type="tel" value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} autoComplete="tel" maxLength={40} /></div>
              <div className="grid gap-5 sm:grid-cols-2">
                <div className="space-y-2"><Label htmlFor="ed-co">{t('wysPage.form.company', 'Company')} <span aria-hidden="true" className="text-red-700">*</span></Label><Input id="ed-co" required value={edit.company} onChange={(e) => setEdit({ ...edit, company: e.target.value })} autoComplete="organization" maxLength={160} /></div>
                <div className="space-y-2"><Label htmlFor="ed-jt">{t('wysPage.form.jobTitle', 'Job title')} <span aria-hidden="true" className="text-red-700">*</span></Label><Input id="ed-jt" required value={edit.job_title} onChange={(e) => setEdit({ ...edit, job_title: e.target.value })} autoComplete="organization-title" maxLength={160} /></div>
              </div>
              <div className="space-y-2"><Label htmlFor="ed-ct">{t('wysPage.form.country', 'Country')}</Label><Input id="ed-ct" value={edit.country} onChange={(e) => setEdit({ ...edit, country: e.target.value })} autoComplete="country-name" maxLength={80} /></div>
              <fieldset className="space-y-2">
                <legend className="text-sm font-semibold leading-5 text-navy">
                  {t('wysPage.form.attend', 'I would like to attend')} <span aria-hidden="true" className="text-red-700">*</span>
                </legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className={tile(edit.wants_conference)}>
                    <Checkbox checked={edit.wants_conference} onCheckedChange={(v) => setEdit({ ...edit, wants_conference: v === true })} className="h-5 w-5 border-checkbox" /> {t('wysPage.form.conference', 'Conference')}
                  </label>
                  <label className={tile(edit.wants_gala)}>
                    <Checkbox checked={edit.wants_gala} onCheckedChange={(v) => setEdit({ ...edit, wants_gala: v === true })} className="h-5 w-5 border-checkbox" /> {t('wysPage.form.gala', 'Gala dinner')}
                  </label>
                </div>
              </fieldset>
              <div className="space-y-2"><Label htmlFor="ed-mo">{t('wysPage.form.motivation', 'Why would you like to attend?')}</Label><Textarea id="ed-mo" rows={3} value={edit.motivation} onChange={(e) => setEdit({ ...edit, motivation: e.target.value })} maxLength={2000} /></div>
              <FieldHint>{t('wysGuest.edit.hint', 'Our team sees your changes straight away. Nothing is sent by e-mail.')}</FieldHint>
              {reqError && <FieldError>{reqError}</FieldError>}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <Button type="submit" variant="ctaNavy" size="sm" disabled={reqBusy} arrow={!reqBusy} roll={!reqBusy} className="w-full sm:w-auto">
                  {reqBusy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />{t('wysGuest.edit.save', 'Save my changes')}</> : t('wysGuest.edit.save', 'Save my changes')}
                </Button>
                <Button type="button" variant="ghost" size="sm" disabled={reqBusy} onClick={() => { setEditing(false); setReqError(null); }} className="w-full sm:w-auto">
                  {t('wysGuest.edit.close', 'Close without saving')}
                </Button>
              </div>
            </form>
          </section>
        )}

        {/* wys_status_edit, signed in: keep this invitation (or request) in the account. The server
            decides (can_attach): never a confirmed place for another address (its link is also the
            door QR), never someone else's row for a staff account. Another address: the card says
            where the link was sent and the button asks for the explicit go-ahead. */}
        {req && user && myEventsShowsIt && req.can_attach && !req.linked && ['requested', 'invited', 'confirmed'].includes(guest.status) && (
          <section aria-labelledby="inv-account" className="rounded-card bg-white p-6 ring-1 ring-inset ring-rule sm:p-8">
            <div className="flex items-center gap-3">
              <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-foam text-teal-text"><Link2 className="h-5 w-5" /></span>
              <h2 id="inv-account" className="text-card-title text-navy">{t('wysGuest.account.title', 'Keep it in your account')}</h2>
            </div>
            {req.same_email ? (
              <p className="mt-3 text-sm leading-6 text-ink">
                {guest.status === 'requested'
                  ? t('wysGuest.account.bodyRequest', 'Add this request to the account you are signed in with, to find it in My events.')
                  : t('wysGuest.account.body', 'Add this invitation to the account you are signed in with, to find it in My events.')}
              </p>
            ) : (
              <p className="mt-3 text-sm leading-6 text-ink [overflow-wrap:anywhere]">
                {guest.status === 'requested'
                  ? t('wysGuest.account.otherBodyRequest', {
                    sent: req.email_masked || '', account: user.email || '',
                    defaultValue: 'This request was made with the address {{sent}}. Add it to your account ({{account}}) anyway? It will then show in this account’s My events.',
                  })
                  : t('wysGuest.account.otherBody', {
                    sent: req.email_masked || '', account: user.email || '',
                    defaultValue: 'This invitation was sent to {{sent}}. Add it to your account ({{account}}) anyway? It will then show in this account’s My events.',
                  })}
              </p>
            )}
            {attachError && <FieldError className="mt-3">{attachError}</FieldError>}
            <Button variant="ctaNavy" size="sm" className="mt-4 w-full sm:w-auto" onClick={() => void doAttach()} disabled={reqBusy} arrow={!reqBusy} roll={!reqBusy}>
              {reqBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              {req.same_email ? t('wysGuest.account.add', 'Add to my account') : t('wysGuest.account.addAnyway', 'Yes, add it to my account')}
            </Button>
          </section>
        )}
        {req && user && myEventsShowsIt && req.linked_to_me && ['requested', 'invited', 'confirmed'].includes(guest.status) && (
          <p className="flex flex-wrap items-center justify-center gap-x-2 text-center text-sm leading-6 text-meta">
            <Link2 className="h-4 w-4 shrink-0" aria-hidden="true" />
            {guest.status === 'requested'
              ? t('wysGuest.account.inRequest', 'This request is in your account.')
              : t('wysGuest.account.in', 'This invitation is in your account.')}{' '}
            <Link to={accountHref('registrations')} className="inline-flex min-h-11 items-center font-semibold text-navy underline underline-offset-4">{t('wysGuest.account.myEvents', 'My events')}</Link>
          </p>
        )}

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
                    ? t('wysGuest.plusOne.confirmed', 'confirmed; they have received their own entry pass by e-mail.')
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
                  <div className="space-y-2"><Label htmlFor="po-em">{t('wysGuest.plusOne.email', 'Their e-mail')} *</Label><Input id="po-em" type="email" required value={plus.email} onChange={e => setPlus({ ...plus, email: e.target.value })} /></div>
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
