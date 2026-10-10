import { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import QRCode from 'qrcode';
import {
  CalendarPlus, Link2, Link2Off, Loader2, LogIn, Mail, Maximize2, MessageSquare, Pencil, Play,
  Sun, Video, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { AuthDialog } from '@/components/auth/AuthDialog';
import { LoginForm } from '@/components/auth/LoginForm';
import { AuthLabel, AuthNotice, AuthTextarea, FieldError } from '@/components/auth/fields';
import { CardShell } from '@/components/brand/CardShell';
import { ContactCard } from '@/components/brand/ContactCard';
import { Eyebrow } from '@/components/brand/Eyebrow';
import { AddToCalendarButtons } from '@/components/events/AddToCalendarButtons';
import { IdentityBlock, identityErrors, ruleOf, type IdentityKey, type IdentityValues } from '@/components/registration/IdentityBlock';
import { QuestionField, answerError, isAnswered, type AnswerValue } from '@/components/registration/QuestionField';
import { ResendLinksForm } from '@/components/registration/ResendLinksForm';
import { StatusTimeline } from '@/components/registration/StatusTimeline';
import {
  ConfirmInline, EventBand, NoteLine, PaymentPill, RegStatusPill, regLocale, whenLine,
} from '@/components/registration/RegistrationUI';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/hooks/use-toast';
import { accountHref } from '@/lib/accountNav';
import { openSignup } from '@/lib/authModal';
import {
  attachRegistration, cancelRegistration, getRegistrationStatus, questionOptions, questionsFor,
  registrationErrorText, respondToInvitation, updateRegistration, useReviewSla,
  type RegFailure, type RegStatusView, type StandardFieldKey,
} from '@/lib/registration';
import { withSiteSuffix } from '@/lib/seoText';
import { Seo } from '@/components/seo/Seo';

/**
 * /registration?t=<personal link> — a registration seen from the link in its
 * e-mails, with no account (spec §6): where it stands (a short timeline), the
 * answers (changeable while the event allows it), the reply when M3 asks for a
 * detail, accept or decline an invitation, cancel, the calendar, the joining
 * link of a confirmed webinar, the entry pass of a confirmed on-site event
 * (full screen, with a brightness tip), and "Add this to my account" when signed
 * in. Once the registration is linked to an account, the link only shows it:
 * the account manages it.
 *
 * Every change is a POST made on a click, never on opening the page: mail
 * scanners open links on their own. The token is never shown, logged or sent
 * on (no referrer). An unknown or expired link offers new links by e-mail.
 */
export function RegistrationStatusPage() {
  const [params] = useSearchParams();
  const token = (params.get('t') || '').trim();
  return token ? <StatusContent token={token} /> : <FindMyLinks />;
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
              {t('reg.status.signedInHint', 'Signed in? Your registrations are also in')}{' '}
              <Link to={accountHref('registrations')} className="font-semibold text-navy underline underline-offset-4">{t('reg.myEvents', 'My events')}</Link>.
            </p>
          )}
        </CardShell>
        <ContactCard line={t('reg.status.contact', 'A question about your registration? Write to the M3 team.')} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ the registration */

function StatusContent({ token }: { token: string }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const locale = regLocale(i18n.language);
  const sla = useReviewSla();
  const [view, setView] = useState<RegStatusView | null>(null);
  const [failure, setFailure] = useState<RegFailure | null>(null);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [reply, setReply] = useState('');
  const [replyError, setReplyError] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [passOpen, setPassOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const target = useMemo(() => ({ token }), [token]);

  useEffect(() => {
    let alive = true;
    getRegistrationStatus(target).then((res) => {
      if (!alive) return;
      if (res.ok) { setView(res); setFailure(null); } else { setFailure(res); }
      setLoading(false);
    });
    return () => { alive = false; };
  }, [target, version]);

  const checkinUrl = view?.registration.checkin_url ?? null;
  useEffect(() => {
    if (!checkinUrl) { setQr(null); return; }
    QRCode.toDataURL(checkinUrl, { margin: 2, width: 560, errorCorrectionLevel: 'M' }).then(setQr).catch(() => setQr(null));
  }, [checkinUrl]);

  if (loading) {
    return (
      <div role="status" className="flex min-h-[60vh] items-center justify-center bg-page">
        {NO_REFERRER}
        <Loader2 className="h-8 w-8 animate-spin text-navy" aria-hidden="true" />
        <span className="sr-only">{t('reg.status.loading', 'Loading your registration')}</span>
      </div>
    );
  }

  if (!view) {
    const invalid = !failure || ['not_found', 'expired', 'wrong_engine', 'bad_input', 'forbidden'].includes(failure.error ?? '');
    if (invalid) return <FindMyLinks invalid />;
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
  const ended = !!ev.ends_at && new Date(ev.ends_at).getTime() < now;
  const live = !!ev.starts_at && new Date(ev.starts_at).getTime() <= now && !ended;
  const readOnly = !!reg.read_only;
  const active = !['cancelled', 'declined', 'rejected'].includes(reg.status);
  const when = whenLine(ev.starts_at, ev.ends_at, locale, t('reg.dateTbd', 'Date to be announced'));
  const where = isWebinar ? t('reg.online', 'Online') : ev.location || t('reg.venueTbd', 'Venue to be announced');
  const eventHref = ev.event_id ? `/events/${ev.event_id}` : null;
  const questions = questionsFor(view.questions, reg.ticket_key ?? null);

  const run = async (fn: () => Promise<{ ok: boolean }>, success: string) => {
    setBusy(true);
    setActionError(null);
    const res = await fn();
    setBusy(false);
    if (res.ok) {
      toast({ title: success });
      setEditing(false);
      setVersion((v) => v + 1);
      return true;
    }
    setActionError(registrationErrorText(t, res as RegFailure));
    return false;
  };

  const sendReply = () => {
    if (!reply.trim()) { setReplyError(t('reg.field.required', 'Please fill this in.')); return; }
    setReplyError(null);
    void run(() => updateRegistration(target, { info_reply: reply.trim() }), t('reg.toast.replied', 'Thank you. M3 has your answer.')).then((ok) => { if (ok) setReply(''); });
  };

  const attach = () => void run(() => attachRegistration(token), t('reg.toast.attached', 'Added to your account. You find it in My events.'));

  const calendar = reg.status === 'confirmed' && ev.starts_at && !ended ? {
    title: ev.title, description: ev.description ?? null, date_time: ev.starts_at, end_date_time: ev.ends_at, location: ev.location ?? null, url: reg.meeting_url ?? null,
  } : null;

  // The answers, as shown (and as edited).
  const answers = reg.answers ?? {};
  const answerText = (key: string, v: unknown): string => {
    const q = (view.questions ?? []).find((x) => x.key === key);
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

  const canEdit = !!reg.can_edit && !readOnly && active && !ended;

  return (
    <div className="min-h-screen bg-page">
      <Seo title={withSiteSuffix(t('reg.status.seoTitleEvent', { title: ev.title, defaultValue: 'Your registration: {{title}}' }))} noindex />
      {NO_REFERRER}
      <EventBand
        back={eventHref ? { to: eventHref, label: t('reg.page.eventPage', 'Event page') } : null}
        eyebrow={t('reg.status.eyebrow', 'Your registration')}
        title={ev.title}
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
              <RegStatusPill display={reg.status_display ?? null} status={reg.status} />
              <PaymentPill payment={reg.payment_display ?? null} />
            </div>
          </div>
          {reg.first_name && (
            <p className="mt-4 text-[17px] font-semibold leading-6 text-navy">{t('reg.status.hello', { name: reg.first_name, defaultValue: 'Hello {{name}},' })}</p>
          )}

          <div className="mt-5">
            <StatusTimeline
              status={reg.status}
              mode={ev.mode}
              kind={ev.kind}
              createdAt={reg.created_at}
              decidedAt={reg.decided_at}
              infoRequestedAt={reg.info_requested_at}
              cancelledAt={reg.cancelled_at}
              eventStart={ev.starts_at}
              sla={sla}
              locale={locale}
            />
          </div>

          <div className="mt-6 space-y-4">
            {/* M3 needs a detail. */}
            {reg.status === 'needs_info' && !readOnly && (
              <div className="space-y-3 rounded-field border border-gold/60 bg-gold/10 p-4">
                <p className="flex items-center gap-2 text-[15px] font-semibold text-navy">
                  <MessageSquare className="h-4 w-4" aria-hidden="true" />{t('reg.block.infoAsked', 'The M3 team needs one more detail before deciding:')}
                </p>
                {reg.info_request && <blockquote className="rounded-field bg-white px-4 py-3 text-[15px] leading-6 text-navy [overflow-wrap:anywhere]">{reg.info_request}</blockquote>}
                <div className="space-y-2">
                  <AuthLabel htmlFor="st-reply">{t('reg.block.yourAnswer', 'Your answer')}</AuthLabel>
                  <AuthTextarea id="st-reply" rows={3} value={reply} onChange={(e) => { setReply(e.target.value.slice(0, 2000)); setReplyError(null); }}
                    aria-invalid={!!replyError} aria-describedby={replyError ? 'st-reply-err' : undefined} />
                  {replyError && <FieldError id="st-reply-err">{replyError}</FieldError>}
                </div>
                <Button variant="cta" className="w-full justify-between sm:w-auto" onClick={sendReply} disabled={busy} arrow={!busy} roll={!busy}>
                  {busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />{t('reg.sending', 'Sending…')}</> : t('reg.block.sendAnswer', 'Send my answer')}
                </Button>
              </div>
            )}

            {/* An invitation: the answer, on a click only. */}
            {reg.status === 'invited' && !readOnly && (
              <div className="space-y-3">
                <p className="text-[15px] leading-6 text-ink">{t('reg.block.invitedBody', 'The organisers have invited you. Will you take part?')}</p>
                <Button variant="cta" className="w-full justify-between" onClick={() => void run(() => respondToInvitation(target, 'accept'), t('reg.toast.accepted', 'Thank you. Your place is confirmed.'))} disabled={busy} arrow={!busy} roll={!busy}>
                  {t('reg.block.accept', 'Yes, I will take part')}
                </Button>
                <ConfirmInline
                  label={t('reg.block.decline', 'I cannot take part')}
                  question={t('reg.block.declineQuestion', 'Decline this invitation?')}
                  confirmLabel={t('reg.block.declineYes', 'Yes, decline')}
                  keepLabel={t('reg.block.declineKeep', 'Not now')}
                  onConfirm={() => void run(() => respondToInvitation(target, 'decline'), t('reg.toast.declined', 'Thank you for letting us know.'))}
                  busy={busy}
                  tone="neutral"
                />
              </div>
            )}

            {/* Confirmed webinar: the link and the calendar. */}
            {reg.status === 'confirmed' && isWebinar && !ended && (
              reg.meeting_url ? (
                <Button asChild variant="cta" className="w-full justify-between">
                  <a href={reg.meeting_url} target="_blank" rel="noopener noreferrer">
                    {live ? t('eventsPage.joinNow', 'Join now') : t('eventsPage.joinWebinar', 'Join the webinar')}
                  </a>
                </Button>
              ) : (
                <NoteLine icon={Video}>{t('reg.status.joinLater', 'The joining link will appear here, and in a reminder e-mail, before the webinar starts.')}</NoteLine>
              )
            )}
            {ended && reg.replay_url && (
              <Button asChild variant="cta" className="w-full justify-between">
                <a href={reg.replay_url} target="_blank" rel="noopener noreferrer"><Play className="mr-2 h-4 w-4" aria-hidden="true" />{t('events.watchReplay', 'Watch the replay')}</a>
              </Button>
            )}
            {calendar && (
              <div className="space-y-2">
                <p className="flex items-center gap-1.5 text-meta-caps"><CalendarPlus className="h-3.5 w-3.5" aria-hidden="true" />{t('events.addToCalendar', 'Add to calendar')}</p>
                <AddToCalendarButtons event={calendar} />
              </div>
            )}

            {/* Confirmed on site, no pass to draw here: it is in the e-mail. */}
            {reg.status === 'confirmed' && !isWebinar && !checkinUrl && !ended && (
              <NoteLine icon={Mail}>{t('reg.block.passByEmail', 'Your entry pass is in your confirmation e-mail. Show it at the entrance.')}</NoteLine>
            )}

            {actionError && <AuthNotice tone="error" role="alert"><p>{actionError}</p></AuthNotice>}
          </div>

          {/* Confirmed on site: the entry pass. */}
          {reg.status === 'confirmed' && !isWebinar && qr && !ended && (
            <div className="mt-6 border-t border-dashed border-rule pt-6 text-center">
              <p className="text-meta-caps">{t('reg.status.passLabel', 'Entry pass')}</p>
              <button
                type="button"
                onClick={() => setPassOpen(true)}
                className="mx-auto mt-4 block w-fit max-w-full rounded-card bg-white p-3 ring-1 ring-inset ring-rule focus:outline-none focus-visible:shadow-focus"
                aria-label={t('reg.status.passOpen', 'Show my entry pass full screen')}
              >
                <img src={qr} alt={t('reg.status.qrAlt', 'Your entry QR code')} className="mx-auto h-auto w-[240px] max-w-full" />
              </button>
              <Button variant="ctaOutline" size="sm" arrow={false} className="mt-4" onClick={() => setPassOpen(true)}>
                <Maximize2 className="mr-2 h-4 w-4" aria-hidden="true" />{t('reg.status.passFull', 'Show full screen')}
              </Button>
              <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-meta">{t('reg.status.passHelp', 'Show this QR code at the entrance. No QR? Just give your name at the desk.')}</p>
            </div>
          )}
        </CardShell>

        {/* Linked to an account: shown here, managed there. */}
        {readOnly ? (
          <CardShell as="section" className="p-6 sm:p-8">
            <div className="flex items-start gap-3">
              <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-foam text-teal-text"><Link2 className="h-5 w-5" /></span>
              <div className="min-w-0">
                <h2 className="text-card-title text-navy">{t('reg.status.linkedTitle', 'Linked to an account')}</h2>
                <p className="mt-1 text-sm leading-6 text-ink">{t('reg.status.linkedBody', 'This registration belongs to a Smart Marina Connect account. Sign in to change or cancel it.')}</p>
                <div className="mt-4">
                  {user ? (
                    <Button variant="cta" size="sm" onClick={() => navigate(accountHref('registrations'))}>{t('reg.status.toMyEvents', 'Go to My events')}</Button>
                  ) : (
                    <Button variant="cta" size="sm" onClick={() => setLoginOpen(true)}>
                      <LogIn className="mr-2 h-4 w-4" aria-hidden="true" />{t('reg.status.signInToManage', 'Sign in to manage')}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </CardShell>
        ) : user && active ? (
          // Signed in, a registration made without the account (or with another address): one click to keep it there.
          <CardShell as="section" className="p-6 sm:p-8">
            <h2 className="text-card-title text-navy">{t('reg.status.attachTitle', 'Keep it in your account')}</h2>
            <p className="mt-1 text-sm leading-6 text-ink">{t('reg.status.attachBody', 'Add this registration to the account you are signed in with, to find it in My events.')}</p>
            <Button variant="ctaNavy" size="sm" className="mt-4" onClick={attach} disabled={busy} arrow={!busy} roll={!busy}>
              {busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />{t('reg.sending', 'Sending…')}</> : t('reg.status.attach', 'Add this to my account')}
            </Button>
          </CardShell>
        ) : null}

        {/* What was sent, and changing it. */}
        {detailRows.length > 0 && (
          <CardShell as="section" aria-labelledby="reg-st-details" className="p-6 sm:p-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="reg-st-details" className="text-card-title text-navy">{t('reg.status.detailsTitle', 'Your details')}</h2>
              {canEdit && !editing && (
                <Button variant="outline" size="sm" className="h-10 rounded-pill border-navy/25 px-4 text-navy" onClick={() => setEditing(true)}>
                  <Pencil className="mr-1.5 h-4 w-4" aria-hidden="true" />{t('reg.change', 'Change')}
                </Button>
              )}
            </div>
            {editing ? (
              <EditAnswers
                view={view}
                busy={busy}
                onCancel={() => { setEditing(false); setActionError(null); }}
                onSave={(fields, ans) => void run(() => updateRegistration(target, { fields, answers: ans }), t('reg.toast.saved', 'Your changes are saved.'))}
              />
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
            {!canEdit && active && !readOnly && reg.edit_locks_at && new Date(reg.edit_locks_at).getTime() < now && (
              <p className="mt-3 text-sm text-meta">{t('reg.error.locked', 'Your answers can no longer be changed for this event.')}</p>
            )}
          </CardShell>
        )}

        {/* Cancel, at the bottom, asked twice. */}
        {reg.can_cancel && !readOnly && active && !ended && (
          <ConfirmInline
            label={reg.status === 'requested' || reg.status === 'needs_info' ? t('reg.block.cancelRequest', 'Cancel my request') : t('eventsPage.cancelMine', 'Cancel my registration')}
            question={t('reg.block.cancelQuestion', 'Cancel your registration for this event?')}
            confirmLabel={t('reg.block.cancelYes', 'Yes, cancel')}
            keepLabel={t('reg.block.cancelKeep', 'No, keep it')}
            onConfirm={() => void run(() => cancelRegistration(target), t('reg.toast.cancelled', 'Your registration is cancelled.'))}
            busy={busy}
            icon={X}
            className="bg-white"
          />
        )}

        {!user && !readOnly && (
          <p className="text-center text-sm leading-6 text-meta">
            {t('reg.status.accountHint', 'Want all your events in one place?')}{' '}
            <button type="button" onClick={() => openSignup()} className="font-semibold text-navy underline underline-offset-4 focus:outline-none focus-visible:shadow-focus">
              {t('reg.quick.createAccount', 'Create my account')}
            </button>
          </p>
        )}

        <ContactCard line={t('reg.status.contact', 'A question about your registration? Write to the M3 team.')} />
      </div>

      {/* The pass, full screen: white, as large as the screen allows. */}
      <Dialog open={passOpen} onOpenChange={setPassOpen}>
        <DialogContent className="left-0 top-0 flex h-[100dvh] max-h-[100dvh] w-full max-w-none translate-x-0 translate-y-0 flex-col items-center justify-center gap-5 rounded-none border-0 bg-white p-6 sm:rounded-none">
          <DialogTitle className="text-center text-h3 text-navy">{[reg.first_name, reg.last_name].filter(Boolean).join(' ') || t('reg.status.passLabel', 'Entry pass')}</DialogTitle>
          <DialogDescription className="text-center text-[15px] leading-6 text-meta">{ev.title}</DialogDescription>
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
        <LoginForm onSuccess={() => setLoginOpen(false)} next={`${location.pathname}${location.search}`} />
      </AuthDialog>

    </div>
  );
}

/* ------------------------------------------------------------------ changing the answers */

function EditAnswers({
  view,
  busy,
  onCancel,
  onSave,
}: {
  view: RegStatusView;
  busy: boolean;
  onCancel: () => void;
  onSave: (fields: Partial<Record<StandardFieldKey, string>>, answers: Record<string, AnswerValue>) => void;
}) {
  const { t } = useTranslation();
  const reg = view.registration;
  const std = view.standard_fields;
  const editableQs = questionsFor(view.questions, reg.ticket_key ?? null).filter((q) => q.editable_after_submit !== false);
  const [values, setValues] = useState<IdentityValues>({
    first_name: reg.first_name ?? '',
    last_name: reg.last_name ?? '',
    email: reg.email_masked ?? '',
    company: reg.company ?? '',
    job_title: reg.job_title ?? '',
    phone: reg.phone ?? '',
    country: reg.country ?? '',
  });
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

  const save = () => {
    // Names and e-mail are not changed through the link: only the event's fields and answers.
    const idErrs = identityErrors({ ...values, first_name: 'x', last_name: 'x', email: 'x@x.xx' }, std, t);
    const qe: Record<string, string> = {};
    for (const q of editableQs) { const e = answerError(q, answers[q.key], t); if (e) qe[q.key] = e; }
    setErrors(idErrs);
    setQErrors(qe);
    if (Object.keys(idErrs).length > 0 || Object.keys(qe).length > 0) return;
    const fields: Partial<Record<StandardFieldKey, string>> = {};
    for (const k of ['company', 'job_title', 'phone', 'country'] as const) if (ruleOf(std, k) !== 'hidden') fields[k] = values[k].trim();
    onSave(fields, answers);
  };

  const shownStd = (['company', 'job_title', 'phone', 'country'] as const).some((k) => ruleOf(std, k) !== 'hidden');

  return (
    <div className="mt-5 space-y-6">
      {shownStd && (
        <IdentityBlock
          values={values}
          onChange={(k, v) => { setValues((cur) => ({ ...cur, [k]: v })); setErrors((e) => ({ ...e, [k]: undefined })); }}
          errors={errors}
          standardFields={std}
          emailLocked
          standardOnly
          idPrefix="st"
        />
      )}
      {editableQs.map((q) => (
        <QuestionField
          key={q.key}
          question={q}
          value={answers[q.key]}
          onChange={(v) => { setAnswers((cur) => ({ ...cur, [q.key]: v })); setQErrors((e) => { const n = { ...e }; delete n[q.key]; return n; }); }}
          error={qErrors[q.key]}
          idPrefix="stq"
        />
      ))}
      <p className="text-[13px] leading-5 text-meta">{t('reg.status.namesFixed', 'Your name and e-mail stay as registered. To change them, write to the M3 team.')}</p>
      <div className="flex flex-wrap gap-3">
        <Button variant="cta" size="sm" onClick={save} disabled={busy} arrow={!busy} roll={!busy}>
          {busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />{t('reg.sending', 'Sending…')}</> : t('reg.save', 'Save')}
        </Button>
        <Button variant="ghost" size="sm" className="h-11 rounded-pill px-4 text-navy hover:bg-chip" onClick={onCancel} disabled={busy}>
          {t('reg.cancelEdit', 'Cancel')}
        </Button>
      </div>
    </div>
  );
}
