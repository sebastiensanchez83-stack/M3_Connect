import { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import QRCode from 'qrcode';
import {
  BellOff, BellRing, CalendarPlus, Link2, Link2Off, Loader2, LogIn, Mail, Maximize2, MessageSquare, Pencil, Play,
  Sun, UserPlus, Video, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { AuthDialog } from '@/components/auth/AuthDialog';
import { LoginForm } from '@/components/auth/LoginForm';
import { CardShell } from '@/components/brand/CardShell';
import { ContactCard, M3_PUBLIC_EMAIL } from '@/components/brand/ContactCard';
import { Eyebrow } from '@/components/brand/Eyebrow';
import { UnderlineLink } from '@/components/brand/UnderlineLink';
import { AddToCalendarButtons } from '@/components/events/AddToCalendarButtons';
import { IdentityBlock, identityErrors, ruleOf, type IdentityKey, type IdentityValues } from '@/components/registration/IdentityBlock';
import { AuthLabel, AuthNotice, AuthTextarea, FieldError, FieldHint } from '@/components/auth/fields';
import { QuestionField, answerError, isAnswered, type AnswerValue } from '@/components/registration/QuestionField';
import { ResendLinksForm } from '@/components/registration/ResendLinksForm';
import { StatusTimeline } from '@/components/registration/StatusTimeline';
import {
  ConfirmInline, EventBand, NoteLine, PaymentPill, RegStatusPill, eventZone, regLocale, whenLine,
} from '@/components/registration/RegistrationUI';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/hooks/use-toast';
import { accountHref } from '@/lib/accountNav';
import { openSignup } from '@/lib/authModal';
import {
  INFO_ANSWER_MAX, attachRegistration, cancelRegistration, displayOf, getRegistrationStatus,
  questionOptions, registrationErrorText, setRegistrationReminders, updateRegistration, useReviewSla,
  type RegChanges, type RegFailure, type RegStatusView, type RegTarget,
} from '@/lib/registration';
import { useRegistrationFlags } from '@/lib/flags';
import { withSiteSuffix } from '@/lib/seoText';
import { cn } from '@/lib/utils';
import { Seo } from '@/components/seo/Seo';

/**
 * /registration — one registration, in two ways (spec §6):
 *
 *   ?t=<personal link>  from its e-mails, with no account: where it stands (a
 *       short timeline), the details (changeable while the event allows it),
 *       the reply when M3 asks for a detail, cancel, the calendar, the joining
 *       link of a confirmed webinar, the entry pass of a confirmed on-site
 *       event (full screen, with a brightness tip), the reminder e-mails on or
 *       off, and "Add this to my account" when signed in. Once the
 *       registration is linked to an account, the link only shows it: the
 *       account manages it.
 *   ?id=<registration id>  the same page for its signed-in owner (My events and
 *       the event page link here: a new registration has no other page).
 *
 * Every change is a POST made on a click, never on opening the page: mail
 * scanners open links on their own (`&reminders=off` only offers the button).
 * The token is never shown, logged or sent on (no referrer). An unknown or
 * expired link offers new links by e-mail.
 */
export function RegistrationStatusPage() {
  const [params] = useSearchParams();
  const token = (params.get('t') || '').trim();
  const id = (params.get('id') || '').trim();
  const remindersOff = params.get('reminders') === 'off';
  // One object per link: the page reads the registration again only when the link (or the account) changes.
  const tokenTarget = useMemo(() => ({ token }), [token]);
  if (token) return <StatusContent target={tokenTarget} remindersOff={remindersOff} />;
  if (id) return <OwnerStatus id={id} />;
  return <FindMyLinks />;
}

/**
 * Where a sign-in started here comes back to. It travels inside the e-mailed
 * sign-in and password links (?next=), so never with the personal link's token
 * ("never shown, logged or sent on"): from a personal link, My events.
 */
function signInNext(pathname: string, search: string): string {
  return new URLSearchParams(search).has('t') ? accountHref('registrations') : `${pathname}${search}`;
}

const NO_REFERRER = (
  <Helmet>
    <meta name="referrer" content="no-referrer" />
    <meta name="robots" content="noindex, nofollow" />
  </Helmet>
);

/* ------------------------------------------------------------------ no link */

function FindMyLinks({ invalid = false }: { invalid?: boolean }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  return (
    <div className="min-h-screen bg-page">
      <Seo title={withSiteSuffix(t('reg.status.seoTitle', 'Your registration'))} noindex />
      {NO_REFERRER}
      <EventBand eyebrow={t('reg.status.eyebrow', 'Your registration')} title={invalid ? t('reg.status.invalidTitle', 'This link cannot be opened') : t('reg.status.findTitle', 'Find my registrations')} webinar={false} seed="registration" />
      <div className="relative z-10 mx-auto -mt-10 w-full max-w-xl space-y-6 px-4 pb-14 sm:px-6">
        <CardShell className="p-6 sm:p-8">
          {invalid && (
            <div className="mb-6 flex items-start gap-3">
              <span aria-hidden="true" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-page text-meta"><Link2Off className="h-5 w-5" /></span>
              <p className="text-[15px] leading-6 text-ink">
                {t('reg.status.invalidBody', 'The link may be incomplete, expired, or replaced by a newer one. Ask for new links below: they arrive in a minute.')}
              </p>
            </div>
          )}
          <ResendLinksForm defaultEmail={user?.email ?? ''} />
          {user && (
            <p className="mt-6 border-t border-rule pt-5 text-sm leading-6 text-meta">
              {t('reg.status.signedInHint', 'Your registrations are also in')}{' '}
              <Link to={accountHref('registrations')} className="font-semibold text-navy underline underline-offset-4">{t('reg.myEvents', 'My events')}</Link>.
            </p>
          )}
        </CardShell>
        <ContactCard line={t('reg.status.contact', 'A question about your registration? Write to the M3 team.')} />
      </div>
    </div>
  );
}

/**
 * A signed-in owner opened ?id=… (My events, a to-do) and the registration is not
 * found for this account: cancelled and gone, moved, or opened from another account.
 * Not a broken e-mail link, so not the "this link cannot be opened" words.
 */
function NotInAccount() {
  const { t } = useTranslation();
  return (
    <div className="min-h-screen bg-page">
      <Seo title={withSiteSuffix(t('reg.status.seoTitle', 'Your registration'))} noindex />
      {NO_REFERRER}
      <EventBand eyebrow={t('reg.status.eyebrow', 'Your registration')} title={t('reg.status.notInAccountTitle', 'This registration is no longer in your account')} webinar={false} seed="registration" />
      <div className="relative z-10 mx-auto -mt-10 w-full max-w-xl space-y-6 px-4 pb-14 sm:px-6">
        <CardShell className="p-6 sm:p-8">
          <div className="flex items-start gap-3">
            <span aria-hidden="true" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-page text-meta"><Link2Off className="h-5 w-5" /></span>
            <p className="text-[15px] leading-6 text-ink">
              {t('reg.status.notInAccountBody', 'We could not find this registration in your account. It may have been cancelled, or it was made with another e-mail address. Your registrations are listed in My events.')}
            </p>
          </div>
          <Button asChild variant="cta" className="mt-6">
            <Link to={accountHref('registrations')}>{t('reg.status.openMyEvents', 'Open My events')}</Link>
          </Button>
          <p className="mt-6 border-t border-rule pt-5 text-sm leading-6 text-meta">
            {t('reg.status.notInAccountLinks', 'Registered with another address? Ask for your personal links: they arrive by e-mail in a minute.')}
          </p>
          <div className="mt-3"><ResendLinksForm compact idPrefix="notmine-resend" /></div>
        </CardShell>
        <ContactCard line={t('reg.status.contact', 'A question about your registration? Write to the M3 team.')} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ signed-in owner */

function OwnerStatus({ id }: { id: string }) {
  const { user, loading } = useAuth();
  const target = useMemo(() => ({ registration_id: id }), [id]);
  if (loading) return <PageSpinner />;
  if (user) return <StatusContent target={target} remindersOff={false} />;
  return <SignInPrompt />;
}

/** The owner's page, signed out (or with an expired session): sign in, or ask for the e-mail links. */
function SignInPrompt() {
  const { t } = useTranslation();
  const location = useLocation();
  const [loginOpen, setLoginOpen] = useState(false);
  return (
    <div className="min-h-screen bg-page">
      <Seo title={withSiteSuffix(t('reg.status.seoTitle', 'Your registration'))} noindex />
      {NO_REFERRER}
      <EventBand eyebrow={t('reg.status.eyebrow', 'Your registration')} title={t('reg.status.signInTitle', 'Sign in to see your registration')} webinar={false} seed="registration" />
      <div className="relative z-10 mx-auto -mt-10 w-full max-w-xl space-y-6 px-4 pb-14 sm:px-6">
        <CardShell className="p-6 sm:p-8">
          <p className="text-[15px] leading-6 text-ink">{t('reg.status.signInBody', 'This page shows a registration of your account. Sign in to see it, or open the personal link in your confirmation e-mail.')}</p>
          <Button variant="cta" className="mt-5" onClick={() => setLoginOpen(true)}>
            <LogIn className="mr-2 h-4 w-4" aria-hidden="true" />{t('reg.signIn', 'Sign in')}
          </Button>
        </CardShell>
        <CardShell className="p-6 sm:p-8">
          <h2 className="text-card-title text-navy">{t('reg.status.lostLink', 'Lost the e-mail?')}</h2>
          <div className="mt-3"><ResendLinksForm compact idPrefix="owner-resend" /></div>
        </CardShell>
      </div>
      <AuthDialog
        mode="login"
        open={loginOpen}
        onOpenChange={setLoginOpen}
        description={t('reg.status.signInDesc', 'Sign in to manage your registrations.')}
        switchTo={{ onClick: () => { setLoginOpen(false); openSignup(); } }}
      >
        <LoginForm onSuccess={() => setLoginOpen(false)} next={signInNext(location.pathname, location.search)} />
      </AuthDialog>
    </div>
  );
}

function PageSpinner() {
  const { t } = useTranslation();
  return (
    <div role="status" className="flex min-h-[60vh] items-center justify-center bg-page">
      {NO_REFERRER}
      <Loader2 className="h-8 w-8 animate-spin text-navy" aria-hidden="true" />
      <span className="sr-only">{t('reg.status.loading', 'Loading your registration')}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ the registration */

function StatusContent({ target, remindersOff }: { target: RegTarget; remindersOff: boolean }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const locale = regLocale(i18n.language);
  const sla = useReviewSla();
  // M3 creates on-site accounts at confirmation only while its account creation runs (the `provisioning` switch).
  const { flags } = useRegistrationFlags();
  const [view, setView] = useState<RegStatusView | null>(null);
  const [failure, setFailure] = useState<RegFailure | null>(null);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [passOpen, setPassOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  // Answering M3: the details form is open under the answer (then the "Your details" card steps aside).
  const [replyDetailsOpen, setReplyDetailsOpen] = useState(false);
  const token = 'token' in target ? target.token : null;

  // Read again when the account changes (signing in here may make the page the owner's).
  useEffect(() => {
    let alive = true;
    getRegistrationStatus(target).then((res) => {
      if (!alive) return;
      if (res.ok) { setView(res); setFailure(null); } else { setFailure(res); }
      setLoading(false);
    });
    return () => { alive = false; };
  }, [target, version, userId]);

  // Signed in, opened from a personal link of a registration linked to an account: is it this one?
  // The function says so (linked_to_me). An account that has not confirmed its e-mail keeps the link editable.
  const linkedToMe = view ? view.registration.linked_to_me === true : null;

  const qrText = view?.pass?.qr_text ?? null;
  useEffect(() => {
    if (!qrText) { setQr(null); return; }
    QRCode.toDataURL(qrText, { margin: 2, width: 560, errorCorrectionLevel: 'M' }).then(setQr).catch(() => setQr(null));
  }, [qrText]);

  if (loading) return <PageSpinner />;

  if (!view) {
    const err = failure?.error ?? '';
    if (!failure || ['not_found', 'wrong_engine', 'bad_input', 'forbidden'].includes(err)) {
      // Opened from My events or a to-do (signed in, ?id=): not a broken e-mail link.
      return 'registration_id' in target ? <NotInAccount /> : <FindMyLinks invalid />;
    }
    if (err === 'sign_in_required' || err === 'session_expired') return <SignInPrompt />;
    return (
      <div className="min-h-[60vh] bg-page px-4 py-16">
        {NO_REFERRER}
        <CardShell className="mx-auto max-w-md items-center p-8 text-center">
          <h1 className="mb-2 text-h3 text-navy">{t('common.loadFailedTitle', 'This page could not be loaded')}</h1>
          <p className="mb-6 text-sm text-meta">{registrationErrorText(t, failure)}</p>
          <Button variant="cta" size="sm" arrow={false} onClick={() => { setLoading(true); setVersion((v) => v + 1); }}>
            {t('common.retry', 'Try again')}
          </Button>
        </CardShell>
      </div>
    );
  }

  const { event: ev, registration: reg } = view;
  const isWebinar = ev.kind === 'webinar';
  const now = Date.now();
  const ended = ev.ended === true || (!!ev.ends_at && new Date(ev.ends_at).getTime() < now);
  const live = !!ev.starts_at && new Date(ev.starts_at).getTime() <= now && !ended;
  const readOnly = view.read_only;
  const active = !['cancelled', 'declined', 'rejected'].includes(reg.status);
  const when = whenLine(ev.starts_at, ev.ends_at, locale, t('reg.dateTbd', 'Date to be announced'), false, eventZone(ev));
  const where = isWebinar ? t('reg.online', 'Online') : ev.location || t('reg.venueTbd', 'Venue to be announced');
  const eventHref = ev.event_id ? `/events/${ev.event_id}` : null;
  const title = ev.title ?? t('reg.status.eyebrow', 'Your registration');
  const needsInfo = reg.status === 'needs_info' && !readOnly;

  const run = async (fn: () => Promise<{ ok: boolean }>, success: string): Promise<boolean> => {
    setBusy(true);
    setActionError(null);
    const res = await fn();
    setBusy(false);
    if (res.ok) {
      toast({ title: success });
      setEditing(false);
      setReplyDetailsOpen(false);
      if ((res as unknown as RegStatusView).registration) setView(res as unknown as RegStatusView);
      else setVersion((v) => v + 1);
      return true;
    }
    const f = res as unknown as RegFailure;
    setActionError(registrationErrorText(t, f));
    if (f.error === 'changed' || f.error === 'locked') setVersion((v) => v + 1);
    return false;
  };

  const attach = () => token && void run(() => attachRegistration(token), t('reg.toast.attached', 'Added to your account. You find it in My events.'));
  const save = (changes: RegChanges) => void run(
    () => updateRegistration(target, changes),
    needsInfo ? t('reg.toast.replied', 'Thank you. The M3 team has your answer.') : t('reg.toast.saved', 'Your changes are saved.'),
  );
  const reminders = (on: boolean) => void run(
    () => setRegistrationReminders(target, on),
    on ? t('reg.toast.remindersOn', 'Reminder e-mails are back on.') : t('reg.toast.remindersOff', 'We will not send you more e-mails about this event.'),
  );

  const calendar = reg.status === 'confirmed' && view.calendar && !ended ? {
    title: view.calendar.title,
    description: null,
    date_time: view.calendar.starts_at,
    end_date_time: view.calendar.ends_at,
    location: view.calendar.location ?? null,
    url: view.meeting_url ?? view.calendar.url ?? null,
  } : null;

  // The details, as shown.
  const answers = reg.answers ?? {};
  const questions = view.questions ?? [];
  const answerText = (key: string, v: unknown): string => {
    const q = questions.find((x) => x.key === key);
    if (typeof v === 'boolean') return v ? t('reg.summary.yes', 'Yes') : t('reg.summary.no', 'No');
    const opts = q ? questionOptions(q) : [];
    const label = (x: string) => opts.find((o) => o.value === x)?.label ?? x;
    if (Array.isArray(v)) return v.map((x) => label(String(x))).join(', ');
    return v === null || v === undefined ? '' : label(String(v));
  };
  const detailRows: { label: string; value: string }[] = [
    { label: t('reg.field.name', 'Name'), value: [reg.first_name, reg.last_name].filter(Boolean).join(' ') },
    ...(reg.email_masked ? [{ label: t('reg.field.email', 'E-mail'), value: reg.email_masked }] : []),
    ...(reg.company ? [{ label: t('reg.field.company', 'Company'), value: reg.company }] : []),
    ...(reg.job_title ? [{ label: t('reg.field.jobTitle', 'Job title'), value: reg.job_title }] : []),
    ...(reg.phone ? [{ label: t('reg.field.phone', 'Phone'), value: reg.phone }] : []),
    ...(reg.country ? [{ label: t('reg.field.country', 'Country'), value: reg.country }] : []),
    ...(reg.ticket_label ? [{ label: t('reg.summary.participation', 'Participation'), value: reg.ticket_label }] : []),
    ...questions.filter((q) => isAnswered(answers[q.key] as AnswerValue)).map((q) => ({ label: q.label, value: answerText(q.key, answers[q.key]) })),
  ].filter((r) => r.value);

  const canEdit = view.can_edit && !readOnly;
  // M3's question can be answered from here until the event ends, even once the details are
  // locked (then the answer only). An older answer of the function has no can_answer_info.
  const canAnswer = needsInfo && (view.can_answer_info ?? canEdit);
  const display = displayOf(reg.status_display ?? reg.status);

  return (
    <div className="min-h-screen bg-page">
      <Seo title={withSiteSuffix(t('reg.status.seoTitleEvent', { title, defaultValue: 'Your registration: {{title}}' }))} noindex />
      {NO_REFERRER}
      <EventBand
        back={view.via === 'session'
          ? { to: accountHref('registrations'), label: t('reg.status.backToMyEvents', 'My events') }
          : eventHref ? { to: eventHref, label: t('reg.page.eventPage', 'Event page') } : null}
        eyebrow={t('reg.status.eyebrow', 'Your registration')}
        title={title}
        when={when}
        where={where}
        webinar={isWebinar}
        image={ev.image_url}
        seed={ev.slug}
      />

      <div className="relative z-10 mx-auto -mt-10 w-full max-w-xl space-y-6 px-4 pb-14 sm:px-6">
        {/* Where it stands. */}
        <CardShell as="section" aria-labelledby="reg-st-title" className="p-6 sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <Eyebrow as="h2"><span id="reg-st-title">{t('reg.status.whereTitle', 'Where it stands')}</span></Eyebrow>
            <div className="flex flex-wrap gap-1.5">
              <RegStatusPill display={display} status={reg.status} />
              <PaymentPill payment={reg.payment_display ?? null} />
            </div>
          </div>
          {reg.first_name && (
            <p className="mt-4 text-[17px] font-semibold leading-6 text-navy">{t('reg.status.hello', { name: reg.first_name, defaultValue: 'Hello {{name}},' })}</p>
          )}

          {/* Confirmed on site: the entry pass first, the one thing needed on the day (on a phone, in the first screen). */}
          {reg.status === 'confirmed' && !isWebinar && qr && !ended && (
            <div className="mt-5 border-b border-dashed border-rule pb-6 text-center">
              <p className="text-meta-caps">{t('reg.status.passLabel', 'Entry pass')}</p>
              <button
                type="button"
                onClick={() => setPassOpen(true)}
                className="mx-auto mt-3 block w-fit max-w-full rounded-card bg-white p-3 ring-1 ring-inset ring-rule focus:outline-none focus-visible:shadow-focus"
                aria-label={t('reg.status.passOpen', 'Show my entry pass full screen')}
              >
                <img src={qr} alt={t('reg.status.qrAlt', 'Your entry QR code')} className="mx-auto h-auto w-[220px] max-w-full" />
              </button>
              <Button variant="ctaOutline" size="sm" arrow={false} className="mt-4" onClick={() => setPassOpen(true)}>
                <Maximize2 className="mr-2 h-4 w-4" aria-hidden="true" />{t('reg.status.passFull', 'Show full screen')}
              </Button>
              <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-meta">{t('reg.status.passHelp', 'Show this QR code at the entrance. No QR? Just give your name at the desk.')}</p>
            </div>
          )}

          <div className="mt-5">
            <StatusTimeline
              status={reg.status}
              mode={ev.mode}
              kind={ev.kind}
              timeline={view.timeline ?? []}
              eventStart={ev.starts_at}
              sla={sla}
              locale={locale}
            />
          </div>

          <div className="mt-6 space-y-4">
            {/* M3 needs a detail: the question, a box for the answer, the details only if asked for. */}
            {needsInfo && (
              <div className="space-y-4 rounded-field border border-gold/60 bg-gold/10 p-4">
                <p className="flex items-center gap-2 text-[15px] font-semibold text-navy">
                  <MessageSquare className="h-4 w-4 shrink-0" aria-hidden="true" />{t('reg.block.infoAsked', 'The M3 team needs one more detail before deciding:')}
                </p>
                {reg.info_request && <blockquote className="rounded-field bg-white px-4 py-3 text-[15px] leading-6 text-navy [overflow-wrap:anywhere]">{reg.info_request}</blockquote>}
                {canAnswer ? (
                  <EditDetails view={view} busy={busy} reply answerOnly={!canEdit} onSave={save} onDetailsToggle={setReplyDetailsOpen} />
                ) : (
                  <p className="text-sm leading-6 text-ink">{t('reg.status.infoByEmail', 'Please reply to the M3 team by e-mail.')}</p>
                )}
                <p className="text-sm leading-6 text-meta">
                  {t('reg.status.infoOrEmail', 'You can also answer by e-mail:')}{' '}
                  <UnderlineLink href={`mailto:${M3_PUBLIC_EMAIL}`} arrow={false} className="!text-sm">{M3_PUBLIC_EMAIL}</UnderlineLink>
                </p>
              </div>
            )}

            {reg.status === 'invited' && !readOnly && (
              <NoteLine icon={Mail}>{t('reg.status.invitedNote', 'The organisers have invited you. The M3 team will contact you to confirm your place.')}</NoteLine>
            )}

            {/* Confirmed webinar: the link. */}
            {reg.status === 'confirmed' && isWebinar && !ended && (
              view.meeting_url ? (
                <Button asChild variant="cta" className="w-full justify-between">
                  <a href={view.meeting_url} target="_blank" rel="noopener noreferrer">
                    {live ? t('eventsPage.joinNow', 'Join now') : t('eventsPage.joinWebinar', 'Join the webinar')}
                  </a>
                </Button>
              ) : (
                <NoteLine icon={Video}>{t('reg.status.joinLater', 'The joining link will appear here, and in a reminder e-mail, before the webinar starts.')}</NoteLine>
              )
            )}
            {ended && view.replay_url && (
              <Button asChild variant="cta" className="w-full justify-between">
                <a href={view.replay_url} target="_blank" rel="noopener noreferrer"><Play className="mr-2 h-4 w-4" aria-hidden="true" />{t('events.watchReplay', 'Watch the replay')}</a>
              </Button>
            )}
            {calendar && (
              <div className="space-y-2">
                <p className="flex items-center gap-1.5 text-meta-caps"><CalendarPlus className="h-3.5 w-3.5" aria-hidden="true" />{t('events.addToCalendar', 'Add to calendar')}</p>
                <AddToCalendarButtons event={calendar} />
              </div>
            )}

            {/* Confirmed on site, no pass to draw here (an account whose e-mail is not confirmed yet): it is in the e-mail. */}
            {reg.status === 'confirmed' && !isWebinar && !qrText && !ended && (
              <div className="space-y-3">
                <NoteLine icon={Mail}>{t('reg.block.passByEmail', 'Your entry pass is in your confirmation e-mail. Show it at the entrance.')}</NoteLine>
                {user?.email && <ResendLinksForm compact lockedEmail={user.email} idPrefix="pass-resend" />}
              </div>
            )}

            {actionError && <AuthNotice tone="error" role="alert"><p>{actionError}</p></AuthNotice>}
          </div>

        </CardShell>

        {/* Linked to an account: shown here, managed there. */}
        {readOnly ? (
          <CardShell as="section" className="p-6 sm:p-8">
            <div className="flex items-start gap-3">
              <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-foam text-teal-text"><Link2 className="h-5 w-5" /></span>
              <div className="min-w-0">
                <h2 className="text-card-title text-navy">{t('reg.status.linkedTitle', 'Linked to an account')}</h2>
                {user ? (
                  <p className="mt-1 text-sm leading-6 text-ink">{t('reg.status.linkedOther', 'This registration belongs to another Smart Marina Connect account. Sign in with that account to change or cancel it.')}</p>
                ) : (
                  <>
                    <p className="mt-1 text-sm leading-6 text-ink">{t('reg.status.linkedBody', 'This registration belongs to a Smart Marina Connect account. Sign in to change or cancel it.')}</p>
                    <Button variant="cta" size="sm" className="mt-4" onClick={() => setLoginOpen(true)}>
                      <LogIn className="mr-2 h-4 w-4" aria-hidden="true" />{t('reg.status.signInToManage', 'Sign in to manage')}
                    </Button>
                  </>
                )}
              </div>
            </div>
          </CardShell>
        ) : user && token && active && !reg.linked ? (
          // Signed in, a registration made without the account (or with another address): one click to keep it there.
          <CardShell as="section" className="p-6 sm:p-8">
            <h2 className="text-card-title text-navy">{t('reg.status.attachTitle', 'Keep it in your account')}</h2>
            <p className="mt-1 text-sm leading-6 text-ink">{t('reg.status.attachBody', 'Add this registration to the account you are signed in with, to find it in My events.')}</p>
            <Button variant="ctaNavy" size="sm" className="mt-4" onClick={attach} disabled={busy} arrow={!busy} roll={!busy}>
              {busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />{t('reg.sending', 'Sending…')}</> : t('reg.status.attach', 'Add this to my account')}
            </Button>
          </CardShell>
        ) : user && reg.linked && view.via === 'token' && linkedToMe === true ? (
          <p className="flex flex-wrap items-center justify-center gap-x-2 text-center text-sm leading-6 text-meta">
            <Link2 className="h-4 w-4 shrink-0" aria-hidden="true" />
            {t('reg.status.inAccount', 'This registration is in your account.')}{' '}
            <Link to={accountHref('registrations')} className="inline-flex min-h-11 items-center font-semibold text-navy underline underline-offset-4">{t('reg.myEvents', 'My events')}</Link>
          </p>
        ) : user && reg.linked && view.via === 'token' && linkedToMe === false ? (
          // Linked to another account that has not confirmed its e-mail yet: this link still manages it.
          <p className="flex items-start justify-center gap-2 text-center text-sm leading-6 text-meta">
            <Link2 className="mt-1 h-4 w-4 shrink-0" aria-hidden="true" />
            {t('reg.status.linkedOtherEditable', 'This registration is linked to another Smart Marina Connect account. You can still manage it from this link.')}
          </p>
        ) : null}

        {/* What was sent, and changing it. */}
        {detailRows.length > 0 && !(needsInfo && replyDetailsOpen) && (
          <CardShell as="section" aria-labelledby="reg-st-details" className="p-6 sm:p-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="reg-st-details" className="text-card-title text-navy">{t('reg.status.detailsTitle', 'Your details')}</h2>
              {canEdit && !editing && !needsInfo && (
                <Button variant="outline" size="sm" className="h-11 rounded-pill border-navy/25 px-4 text-navy" onClick={() => setEditing(true)}>
                  <Pencil className="mr-1.5 h-4 w-4" aria-hidden="true" />{t('reg.change', 'Change')}
                </Button>
              )}
            </div>
            {editing && !needsInfo ? (
              <EditDetails view={view} busy={busy} onCancel={() => { setEditing(false); setActionError(null); }} onSave={save} />
            ) : (
              <dl className="mt-4 divide-y divide-rule rounded-field ring-1 ring-inset ring-rule">
                {detailRows.map((row, i) => (
                  <div key={`${row.label}-${i}`} className="px-4 py-3 sm:flex sm:gap-6">
                    <dt className="text-meta-caps sm:w-32 sm:shrink-0 sm:pt-0.5">{row.label}</dt>
                    <dd className="mt-0.5 text-[15px] leading-6 text-navy [overflow-wrap:anywhere] sm:mt-0">{row.value}</dd>
                  </div>
                ))}
              </dl>
            )}
            {!canEdit && active && !readOnly && !ended && (
              <p className="mt-3 text-sm text-meta">{t('reg.status.noMoreChanges', 'Your details can no longer be changed for this event. A correction? Write to the M3 team.')}</p>
            )}
          </CardShell>
        )}

        {/* Reminder e-mails about this event: offered from the reminder's own link, or when they are off. */}
        {!readOnly && active && !ended && (remindersOff || !view.reminders_on) && (
          <CardShell as="section" className="p-6 sm:p-8">
            <div className="flex items-start gap-3">
              <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-page text-navy">
                {view.reminders_on ? <BellRing className="h-5 w-5" /> : <BellOff className="h-5 w-5" />}
              </span>
              <div className="min-w-0">
                <h2 className="text-card-title text-navy">{t('reg.status.remindersTitle', 'E-mails about this event')}</h2>
                <p className="mt-1 text-sm leading-6 text-ink">
                  {view.reminders_on
                    ? t('reg.status.remindersOnBody', 'We send a reminder before the event, with the practical details.')
                    : t('reg.status.remindersOffBody', 'You will not receive reminders about this event. Your registration stays as it is.')}
                </p>
                <Button
                  variant={view.reminders_on ? 'ctaNavy' : 'ctaOutline'}
                  size="sm"
                  arrow={false}
                  className="mt-4"
                  onClick={() => reminders(!view.reminders_on)}
                  disabled={busy}
                >
                  {view.reminders_on ? t('reg.status.remindersStop', 'Stop e-mails about this event') : t('reg.status.remindersStart', 'Send me reminders again')}
                </Button>
              </div>
            </div>
          </CardShell>
        )}

        {/* Cancel, at the bottom, asked twice. */}
        {view.can_cancel && !readOnly && (
          <ConfirmInline
            label={reg.status === 'requested' || reg.status === 'needs_info' ? t('reg.block.cancelRequest', 'Cancel my request')
              : reg.status === 'waitlisted' ? t('reg.block.leaveWaitlist', 'Leave the waiting list') : t('eventsPage.cancelMine', 'Cancel my registration')}
            question={t('reg.block.cancelQuestion', 'Cancel your registration for this event?')}
            confirmLabel={t('reg.block.cancelYes', 'Yes, cancel')}
            keepLabel={t('reg.block.cancelKeep', 'No, keep it')}
            onConfirm={() => void run(() => cancelRegistration(target), t('reg.toast.cancelled', 'Your registration is cancelled.'))}
            busy={busy}
            icon={X}
            className="bg-white"
          />
        )}

        {/* An account: on request for a webinar. For an on-site event M3 creates it once the place is
            confirmed (Victor, 6 Oct 2026): one opened now would not get M3's choices and would wait to be linked. */}
        {!user && !readOnly && isWebinar && (
          <p className="text-center text-sm leading-6 text-meta">
            {t('reg.status.accountHint', 'Want all your events in one place?')}{' '}
            <button type="button" onClick={() => openSignup()} className="inline-flex min-h-11 items-center rounded px-1 font-semibold text-navy underline underline-offset-4 focus:outline-none focus-visible:shadow-focus">
              {t('reg.quick.createAccount', 'Create my account')}
            </button>
          </p>
        )}
        {!user && !readOnly && !isWebinar && flags.provisioning && ['requested', 'needs_info', 'waitlisted', 'invited', 'approved'].includes(reg.status) && (
          <NoteLine icon={UserPlus} className="text-meta">
            {t('reg.status.accountOnsite', 'Once M3 confirms your place, we create your Smart Marina Connect account and e-mail you a link to set your password.')}
          </NoteLine>
        )}

        <ContactCard line={t('reg.status.contact', 'A question about your registration? Write to the M3 team.')} />
      </div>

      {/* The pass, full screen: white, as large as the screen allows. */}
      <Dialog open={passOpen} onOpenChange={setPassOpen}>
        <DialogContent className="left-0 top-0 flex h-[100dvh] max-h-[100dvh] w-full max-w-none translate-x-0 translate-y-0 flex-col items-center justify-center gap-5 rounded-none border-0 bg-white p-6 sm:rounded-none">
          <DialogTitle className="text-center text-h3 text-navy">{[reg.first_name, reg.last_name].filter(Boolean).join(' ') || t('reg.status.passLabel', 'Entry pass')}</DialogTitle>
          <DialogDescription className="text-center text-[15px] leading-6 text-meta">{title}</DialogDescription>
          {qr && <img src={qr} alt={t('reg.status.qrAlt', 'Your entry QR code')} className="h-auto w-full max-w-[min(88vw,70vh)]" />}
          <p className="flex items-center gap-2 text-center text-sm leading-5 text-ink">
            <Sun className="h-4 w-4 shrink-0 text-gold-text" aria-hidden="true" />
            {t('reg.status.brightness', 'Turn your screen brightness up: the scanner reads it faster.')}
          </p>
          <Button variant="ctaNavy" arrow={false} onClick={() => setPassOpen(false)}>{t('reg.close', 'Close')}</Button>
        </DialogContent>
      </Dialog>

      <AuthDialog
        mode="login"
        open={loginOpen}
        onOpenChange={setLoginOpen}
        description={t('reg.status.signInDesc', 'Sign in to manage your registrations.')}
        switchTo={{ onClick: () => { setLoginOpen(false); openSignup(); } }}
      >
        <LoginForm onSuccess={() => { setLoginOpen(false); navigate(`${location.pathname}${location.search}`, { replace: true }); }} next={signInNext(location.pathname, location.search)} />
      </AuthDialog>
    </div>
  );
}

/* ------------------------------------------------------------------ changing the details */

const STD = ['company', 'job_title', 'phone', 'country'] as const;

/**
 * Changing the details, or answering M3's question (`reply`).
 *
 * Reply: a box for the answer first (sent as `info_answer`, kept in the
 * registration's history and e-mailed to the M3 team), then, only if the
 * person opens it, the details to correct. Sending needs an answer or a
 * corrected detail: an empty "answer" would go back to M3 with nothing in it.
 */
function EditDetails({
  view,
  busy,
  reply = false,
  answerOnly = false,
  onCancel,
  onSave,
  onDetailsToggle,
}: {
  view: RegStatusView;
  busy: boolean;
  /** Answering an information request: always open, one "Send my answer" button. */
  reply?: boolean;
  /** Reply only: the details are locked (edit lock, event started), so only the answer is sent. */
  answerOnly?: boolean;
  onCancel?: () => void;
  onSave: (changes: RegChanges) => void;
  /** Reply only: the details under the answer were opened or closed. */
  onDetailsToggle?: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const reg = view.registration;
  const std = view.fields;
  const names = view.can_edit_names;
  const editableQs = (view.questions ?? []).filter((q) => q.editable !== false);
  const initial: IdentityValues = {
    first_name: reg.first_name ?? '',
    last_name: reg.last_name ?? '',
    email: reg.email_masked ?? '',
    company: reg.company ?? '',
    job_title: reg.job_title ?? '',
    phone: reg.phone ?? '',
    country: reg.country ?? '',
  };
  const [values, setValues] = useState<IdentityValues>(initial);
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>(() => {
    const out: Record<string, AnswerValue> = {};
    for (const q of editableQs) {
      const v = reg.answers?.[q.key];
      if (typeof v === 'string' || typeof v === 'boolean' || Array.isArray(v)) out[q.key] = v as AnswerValue;
    }
    return out;
  });
  const [errors, setErrors] = useState<Partial<Record<IdentityKey, string>>>({});
  const [qErrors, setQErrors] = useState<Record<string, string>>({});
  const [infoAnswer, setInfoAnswer] = useState('');
  const [infoError, setInfoError] = useState<string | null>(null);
  // Reply: the details stay folded until the person asks for them (the question is often about something else).
  const [detailsOpen, setDetailsOpen] = useState(!reply);
  const toggleDetails = () => {
    const next = !detailsOpen;
    setDetailsOpen(next);
    onDetailsToggle?.(next);
  };

  const shownStd = STD.some((k) => ruleOf(std, k) !== 'hidden');
  const hasDetails = !answerOnly && (names || shownStd || editableQs.length > 0);

  const save = () => {
    const changes: RegChanges = {};
    if (detailsOpen) {
      // The e-mail never changes here; the names only while the registration is not decided.
      const idErrs = identityErrors({ ...values, ...(names ? {} : { first_name: 'x', last_name: 'x' }), email: 'x@x.xx' }, std, t);
      const qe: Record<string, string> = {};
      for (const q of editableQs) { const e = answerError(q, answers[q.key], t); if (e) qe[q.key] = e; }
      setErrors(idErrs);
      setQErrors(qe);
      if (Object.keys(idErrs).length > 0 || Object.keys(qe).length > 0) return;
      // Only the keys that changed.
      if (names) {
        if (values.first_name.trim() !== initial.first_name) changes.first_name = values.first_name.trim();
        if (values.last_name.trim() !== initial.last_name) changes.last_name = values.last_name.trim();
      }
      for (const k of STD) if (ruleOf(std, k) !== 'hidden' && values[k].trim() !== initial[k]) changes[k] = values[k].trim();
      const changedAnswers: Record<string, unknown> = {};
      for (const q of editableQs) {
        const before = JSON.stringify(reg.answers?.[q.key] ?? null);
        const now = answers[q.key];
        const after = JSON.stringify(isAnswered(now) ? now : null);
        if (before !== after) changedAnswers[q.key] = isAnswered(now) ? now : null;
      }
      if (Object.keys(changedAnswers).length > 0) changes.answers = changedAnswers;
    }
    if (reply) {
      const text = infoAnswer.trim();
      if (!text && Object.keys(changes).length === 0) {
        setInfoError(hasDetails
          ? t('reg.status.infoAnswerNeeded', 'Please type your answer, or correct your details below.')
          : t('reg.status.infoAnswerNeededOnly', 'Please type your answer.'));
        document.getElementById('sti-answer')?.focus();
        return;
      }
      if (text) changes.info_answer = text.slice(0, INFO_ANSWER_MAX);
    }
    onSave(changes);
  };

  const detailsForm = (
    <>
      {(names || shownStd) && (
        <IdentityBlock
          values={values}
          onChange={(k, v) => { setValues((cur) => ({ ...cur, [k]: v })); setErrors((e) => ({ ...e, [k]: undefined })); setInfoError(null); }}
          errors={errors}
          standardFields={std}
          emailLocked
          hideEmail
          standardOnly={!names}
          idPrefix={reply ? 'sti' : 'st'}
        />
      )}
      {editableQs.map((q) => (
        <QuestionField
          key={q.key}
          question={q}
          value={answers[q.key]}
          onChange={(v) => { setAnswers((cur) => ({ ...cur, [q.key]: v })); setQErrors((e) => { const n = { ...e }; delete n[q.key]; return n; }); setInfoError(null); }}
          error={qErrors[q.key]}
          idPrefix={reply ? 'stiq' : 'stq'}
        />
      ))}
    </>
  );

  return (
    <div className={reply ? 'space-y-5' : 'mt-5 space-y-6'}>
      {reply && (
        <div className="space-y-2">
          <AuthLabel htmlFor="sti-answer">
            {t('reg.status.infoAnswerLabel', 'Your answer to the M3 team')}
          </AuthLabel>
          <AuthTextarea
            id="sti-answer"
            rows={4}
            value={infoAnswer}
            maxLength={INFO_ANSWER_MAX}
            onChange={(e) => { setInfoAnswer(e.target.value.slice(0, INFO_ANSWER_MAX)); setInfoError(null); }}
            aria-invalid={!!infoError}
            aria-describedby={infoError ? 'sti-answer-err' : 'sti-answer-help'}
            className={cn('bg-white', infoError && 'border-red-700')}
          />
          {infoError
            ? <FieldError id="sti-answer-err">{infoError}</FieldError>
            : <FieldHint><span id="sti-answer-help">{t('reg.status.infoAnswerHelp', 'In a few words. The M3 team receives it with your registration.')}</span></FieldHint>}
        </div>
      )}

      {reply && hasDetails && (
        <button
          type="button"
          onClick={toggleDetails}
          aria-expanded={detailsOpen}
          aria-controls="sti-details"
          className="inline-flex min-h-11 items-center gap-1.5 rounded px-1 text-sm font-semibold text-navy underline decoration-navy/30 underline-offset-4 hover:decoration-gold focus:outline-none focus-visible:shadow-focus"
        >
          <Pencil className="h-4 w-4" aria-hidden="true" />
          {detailsOpen ? t('reg.status.hideDetails', 'Keep my details as they are') : t('reg.status.alsoDetails', 'Also correct my details')}
        </button>
      )}

      {reply ? (detailsOpen && <div id="sti-details" className="space-y-6">{detailsForm}</div>) : detailsForm}

      {!reply && (
        <p className="text-[13px] leading-5 text-meta">
          {names
            ? t('reg.status.emailFixed', 'Your e-mail stays as registered. To change it, write to the M3 team.')
            : t('reg.status.namesFixed', 'Your name and e-mail stay as registered. To change them, write to the M3 team.')}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <Button variant="cta" size="sm" onClick={save} disabled={busy} arrow={!busy} roll={!busy}>
          {busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />{t('reg.sending', 'Sending…')}</>
            : reply ? t('reg.block.sendAnswer', 'Send my answer') : t('reg.save', 'Save')}
        </Button>
        {onCancel && (
          <Button variant="ghost" size="sm" className="h-11 rounded-pill px-4 text-navy hover:bg-chip" onClick={onCancel} disabled={busy}>
            {t('reg.cancelEdit', 'Cancel')}
          </Button>
        )}
      </div>
    </div>
  );
}
