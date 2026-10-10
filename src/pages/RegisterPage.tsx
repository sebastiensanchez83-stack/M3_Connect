import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle, CheckCircle2, Clock, Hourglass, ListChecks, Lock, MailCheck,
  ShieldCheck, Ticket, UserPlus, Video,
} from 'lucide-react';
import { Seo } from '@/components/seo/Seo';
import { Button } from '@/components/ui/button';
import { AuthDialog } from '@/components/auth/AuthDialog';
import { LoginForm } from '@/components/auth/LoginForm';
import { AuthNotice } from '@/components/auth/fields';
import { CardShell } from '@/components/brand/CardShell';
import { ContactCard } from '@/components/brand/ContactCard';
import { UnderlineLink } from '@/components/brand/UnderlineLink';
import { AddToCalendarButtons } from '@/components/events/AddToCalendarButtons';
import { RegistrationForm, type RegistrationDone } from '@/components/registration/RegistrationForm';
import { EventBand, NoteLine, regLocale, whenLine } from '@/components/registration/RegistrationUI';
import { useAuth } from '@/contexts/AuthContext';
import { accountHref } from '@/lib/accountNav';
import { openSignup } from '@/lib/authModal';
import {
  GUEST_LIST_PAGES, getRegistrationForm, registrationErrorText, sourceFromUrl, statusPagePath, useReviewSla,
  type RegFailure, type RegForm,
} from '@/lib/registration';
import { withSiteSuffix } from '@/lib/seoText';
import { cn } from '@/lib/utils';

/**
 * /register/:slug — registering for one event, with that event's own questions
 * (spec §6; Victor, 6 Oct 2026: "the event branch expands that event's own
 * questions"). No account needed: the confirmation e-mail carries a personal
 * link to follow the registration. Signed in, the form is filled with what the
 * platform knows and the account's e-mail.
 *
 * The page says the M3 rule when the event is reviewed or by invitation. The
 * World Yachting Summit keeps its own page: /register/wys26 goes to /wys26.
 *
 * Not behind the registration switches: nothing links here until they are on,
 * and the hidden test events (canaries) are reached by their link only.
 */
export function RegisterPage() {
  const { slug = '' } = useParams<{ slug: string }>();
  const location = useLocation();
  const own = GUEST_LIST_PAGES[slug];
  if (own) return <Navigate to={`${own}${location.search}`} replace />;
  return <RegisterContent slug={slug} />;
}

function RegisterContent({ slug }: { slug: string }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const locale = regLocale(i18n.language);
  const [form, setForm] = useState<RegForm | null>(null);
  const sla = useReviewSla(form?.review_sla_text);
  const [failure, setFailure] = useState<RegFailure | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [done, setDone] = useState<RegistrationDone | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const source = useMemo(() => sourceFromUrl(location.search, 'deep_link'), [location.search]);

  // Keyed on the account id: signing in on this page fills the form in.
  useEffect(() => {
    let alive = true;
    setLoading((l) => l || form === null);
    getRegistrationForm({ slug }).then((res) => {
      if (!alive) return;
      if (res.ok) { setForm(res); setFailure(null); } else { setFailure(res); }
      setLoading(false);
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, userId, attempt]);

  // A guest-list event reached by its slug: its own page when it has one.
  useEffect(() => {
    if (form?.engine === 'guest_list_v1') {
      const page = GUEST_LIST_PAGES[form.event.slug];
      if (page) navigate(page, { replace: true });
    }
  }, [form, navigate]);

  const ev = form?.event ?? null;
  const eventHref = ev?.event_id ? `/events/${ev.event_id}` : null;
  const isWebinar = ev?.kind === 'webinar';
  const when = ev ? whenLine(ev.starts_at, ev.ends_at, locale, t('reg.dateTbd', 'Date to be announced')) : '';
  const where = ev ? (isWebinar ? t('reg.online', 'Online') : ev.location || t('reg.venueTbd', 'Venue to be announced')) : '';
  const titleText = ev?.title ?? t('reg.page.title', 'Registration');

  /* ------------------------------------------------------------ the states */

  let main: React.ReactNode;
  if (loading && !form) {
    main = (
      <div role="status" className="space-y-4" aria-label={t('reg.loading', 'Loading')}>
        <div className="h-6 w-1/3 animate-pulse rounded bg-chip motion-reduce:animate-none" />
        <div className="h-12 animate-pulse rounded-field bg-chip motion-reduce:animate-none" />
        <div className="h-12 animate-pulse rounded-field bg-chip motion-reduce:animate-none" />
        <div className="h-12 animate-pulse rounded-field bg-chip motion-reduce:animate-none" />
      </div>
    );
  } else if (!form) {
    const missing = failure?.error === 'not_found' || failure?.state === 'not_found' || failure?.error === 'wrong_engine';
    main = (
      <div className="py-4 text-center">
        <span aria-hidden="true" className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-chip text-navy">
          <AlertCircle className="h-7 w-7" />
        </span>
        <h2 className="text-h3 text-navy">
          {missing ? t('reg.page.notFoundTitle', 'This registration page does not exist') : t('reg.page.loadFailedTitle', 'This page could not be loaded')}
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-meta">
          {missing
            ? t('reg.page.notFoundBody', 'The link may be incomplete, or the event is no longer taking registrations.')
            : registrationErrorText(t, failure)}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Button asChild variant="ctaOutline" size="sm" arrow={false}><Link to="/events">{t('reg.page.allEvents', 'See all events')}</Link></Button>
          {!missing && <Button variant="cta" size="sm" arrow={false} onClick={() => setAttempt((n) => n + 1)}>{t('common.retry', 'Try again')}</Button>}
        </div>
      </div>
    );
  } else if (done) {
    main = <DoneView form={form} done={done} signedIn={!!user} sla={sla} eventHref={eventHref} />;
  } else if (form.mine && !['cancelled', 'declined'].includes(form.mine.status)) {
    const mineId = form.mine.registration_id;
    main = (
      <div className="space-y-5">
        <AuthNotice tone="success" icon={<CheckCircle2 className="h-4 w-4" />} title={t('reg.page.alreadyTitle', 'You are already registered')}>
          <p>{t('reg.page.alreadyBody', 'Your registration for this event is in My events, with where it stands.')}</p>
        </AuthNotice>
        <div className="flex flex-wrap gap-3">
          {mineId ? (
            <Button asChild variant="cta" size="sm"><Link to={statusPagePath(mineId)}>{t('reg.block.viewMine', 'See my registration')}</Link></Button>
          ) : (
            <Button variant="cta" size="sm" onClick={() => navigate(accountHref('registrations'))}>{t('eventsPage.viewMyRegistrations', 'View my registrations')}</Button>
          )}
          {eventHref && <Button asChild variant="ctaOutline" size="sm" arrow={false}><Link to={eventHref}>{t('reg.page.eventPage', 'Event page')}</Link></Button>}
        </div>
      </div>
    );
  } else if (form.engine === 'core_v2' && !form.paused && (form.state === 'open' || form.state === 'waitlist')) {
    main = (
      <RegistrationForm
        form={form}
        signedIn={!!user}
        onSignIn={() => setLoginOpen(true)}
        source={source}
        onDone={(d) => { setDone(d); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
      />
    );
  } else {
    main = <ClosedView form={form} signedIn={!!user} onSignIn={() => setLoginOpen(true)} locale={locale} />;
  }

  const mode = ev?.mode;

  return (
    <div className="min-h-screen bg-page">
      {/* Never in a search index, and the address (which may carry campaign tags) not sent on. */}
      <Seo title={withSiteSuffix(ev ? t('reg.page.seoTitle', { title: ev.title, defaultValue: 'Register: {{title}}' }) : t('reg.page.title', 'Registration'))} noindex />

      {/* The event, in a compact marine band. */}
      <EventBand
        back={eventHref ? { to: eventHref, label: t('reg.page.backToEvent', 'Back to the event') } : { to: '/events', label: t('reg.page.allEvents', 'See all events') }}
        eyebrow={mode === 'invitation' ? t('reg.page.eyebrowRequest', 'Invitation request') : t('reg.page.eyebrow', 'Registration')}
        title={titleText}
        when={ev ? when : null}
        where={ev ? where : null}
        webinar={isWebinar}
        image={ev?.image_url}
        seed={slug}
      />

      <div className="relative z-10 mx-auto -mt-10 grid w-full max-w-5xl gap-6 px-4 pb-14 sm:px-6 lg:grid-cols-12 lg:gap-8">
        <CardShell as="section" className="p-5 sm:p-8 lg:col-span-8">
          {main}
        </CardShell>

        {/* What happens after: the rule of this event, in plain words. */}
        {ev && (
          <aside className="space-y-4 lg:col-span-4">
            <CardShell className="p-5">
              <p className="text-meta-caps">{t('reg.page.howTitle', 'How it works')}</p>
              <ul className="mt-3 space-y-3">
                {mode === 'instant' ? (
                  <li><NoteLine icon={CheckCircle2}>{form?.state === 'waitlist'
                    ? t('reg.page.howWaitlist', 'The event is full: you join the waiting list and we e-mail you if a place frees up.')
                    : t('reg.page.howInstant', 'You are registered as soon as you send the form.')}</NoteLine></li>
                ) : (
                  <li><NoteLine icon={ShieldCheck}>{mode === 'invitation'
                    ? t('reg.page.howInvitation', { sla, defaultValue: 'Places are by invitation. The M3 team reviews every request and replies {{sla}}.' })
                    : t('reg.page.howReview', { sla, defaultValue: 'The M3 team reviews every registration and replies {{sla}}.' })}</NoteLine></li>
                )}
                <li><NoteLine icon={MailCheck}>{t('reg.page.howEmail', 'You receive an e-mail with a personal link to follow your registration, change your answers or cancel.')}</NoteLine></li>
                {isWebinar
                  ? <li><NoteLine icon={Video}>{t('reg.page.howJoin', 'The joining link comes by e-mail, and with a reminder before the start.')}</NoteLine></li>
                  : <li><NoteLine icon={Ticket}>{t('reg.page.howPass', 'Once confirmed, your entry pass comes by e-mail.')}</NoteLine></li>}
                {!user && <li><NoteLine icon={UserPlus}>{t('reg.page.howAccount', 'No account needed. M3 creates your account once your place is confirmed at an on-site event.')}</NoteLine></li>}
              </ul>
            </CardShell>
            <ContactCard line={t('reg.page.contact', 'A question about this event? Write to the M3 team.')} />
          </aside>
        )}
      </div>

      <AuthDialog
        mode="login"
        open={loginOpen}
        onOpenChange={setLoginOpen}
        description={t('reg.page.signInDesc', 'Sign in: we fill the form in with your details.')}
        switchTo={{ onClick: () => { setLoginOpen(false); openSignup(); } }}
      >
        <LoginForm onSuccess={() => setLoginOpen(false)} next={`${location.pathname}${location.search}`} />
      </AuthDialog>
    </div>
  );
}

/* ------------------------------------------------------------------ after sending */

function DoneView({ form, done, signedIn, sla, eventHref }: { form: RegForm; done: RegistrationDone; signedIn: boolean; sla: string; eventHref: string | null }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const ev = form.event;
  const reviewed = ev.mode !== 'instant';
  // Signed in, the function may say where the registration landed; otherwise the event's rule says it.
  const status = done.status ?? null;
  const waitlist = status === 'waitlisted' || (!status && done.waitlist);
  const confirmed = status === 'confirmed' || (!status && !reviewed && !waitlist);

  const title = waitlist
    ? t('reg.done.waitlistTitle', 'You are on the waiting list')
    : reviewed
      ? (ev.mode === 'invitation' ? t('reg.done.requestTitle', 'Thank you, your request is sent') : t('reg.done.reviewTitle', 'Thank you, your registration is sent'))
      : t('reg.done.instantTitle', 'Thank you, you are registered');

  const calendar = confirmed && ev.starts_at ? {
    title: ev.title ?? '', description: null, date_time: ev.starts_at, end_date_time: ev.ends_at, location: ev.location ?? null,
  } : null;

  return (
    <div role="status" className="space-y-6">
      <div className="flex items-start gap-4">
        <span aria-hidden="true" className={cn('grid h-12 w-12 shrink-0 place-items-center rounded-full', waitlist ? 'bg-chip text-navy' : reviewed ? 'bg-gold text-navy' : 'bg-teal text-white')}>
          {waitlist ? <Hourglass className="h-6 w-6" /> : reviewed ? <Clock className="h-6 w-6" /> : <CheckCircle2 className="h-6 w-6" />}
        </span>
        <div className="min-w-0">
          <h2 className="text-h3 text-navy">{title}</h2>
          <p className="mt-2 text-[15px] leading-6 text-ink">
            {t('reg.done.emailed', { email: done.email, defaultValue: 'We have sent a confirmation to {{email}}, with your personal link to follow your registration, change your answers or cancel.' })}
          </p>
        </div>
      </div>

      <ul className="space-y-3">
        {reviewed && !waitlist && (
          <li><NoteLine icon={ShieldCheck}>{t('reg.done.reviewNext', { sla, defaultValue: 'The M3 team reviews it and replies {{sla}}, by e-mail.' })}</NoteLine></li>
        )}
        {waitlist && <li><NoteLine icon={Hourglass}>{t('reg.done.waitlistNext', 'We e-mail you as soon as a place frees up.')}</NoteLine></li>}
        {confirmed && ev.kind === 'webinar' && <li><NoteLine icon={Video}>{t('reg.done.joinNext', 'The joining link is in the e-mail, and comes again in a reminder before the start.')}</NoteLine></li>}
        <li><NoteLine icon={MailCheck}>{t('reg.done.spam', 'Nothing after 10 minutes? Look in your spam folder.')}</NoteLine></li>
        {signedIn && <li><NoteLine icon={ListChecks}>{t('reg.done.myEvents', 'You also find it in My events, in your account.')}</NoteLine></li>}
      </ul>

      {calendar && (
        <div className="space-y-2">
          <p className="text-meta-caps">{t('events.addToCalendar', 'Add to calendar')}</p>
          <AddToCalendarButtons event={calendar} />
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        {signedIn && <Button variant="cta" size="sm" onClick={() => navigate(accountHref('registrations'))}>{t('eventsPage.viewMyRegistrations', 'View my registrations')}</Button>}
        {eventHref && <Button asChild variant="ctaOutline" size="sm" arrow={false}><Link to={eventHref}>{t('reg.page.backToEvent', 'Back to the event')}</Link></Button>}
        {!eventHref && <Button asChild variant="ctaOutline" size="sm" arrow={false}><Link to="/events">{t('reg.page.allEvents', 'See all events')}</Link></Button>}
      </div>

      {!signedIn && (
        <div className="rounded-field border border-rule bg-page p-4">
          <p className="text-sm font-semibold leading-5 text-navy">{t('reg.quick.accountTitle', 'Find all your events in one place')}</p>
          <p className="mt-1 text-sm leading-5 text-meta">{t('reg.quick.accountBody', 'A free account keeps your registrations, replays and contacts together. M3 checks every new member.')}</p>
          <Button type="button" variant="outline" className="mt-3 h-10 rounded-pill border-navy/25 px-4 text-navy" onClick={() => openSignup()}>
            <UserPlus className="mr-2 h-4 w-4" aria-hidden="true" />
            {t('reg.quick.createAccount', 'Create my account')}
          </Button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ not open */

function ClosedView({ form, signedIn, onSignIn, locale }: { form: RegForm; signedIn: boolean; onSignIn: () => void; locale: string }) {
  const { t } = useTranslation();
  const { profile } = useAuth();
  // A guest list without a page of its own takes no registration here: the organisers invite.
  const state = form.engine === 'guest_list_v1' ? 'invitation_only' : form.paused ? 'paused' : form.state;
  let title: string;
  let body: string;
  switch (state) {
    case 'members_only':
      title = t('reg.block.membersTitle', 'For validated members');
      body = signedIn && (form.prefill ? form.prefill.verified !== true : profile?.access_status !== 'verified')
        ? t('reg.block.membersPending', 'Your account is being reviewed by the M3 team. You can register as soon as it is validated.')
        : t('reg.block.membersBody', 'This event is for members validated by M3. Sign in with your account to register.');
      break;
    case 'paused':
      title = t('reg.block.pausedTitle', 'Registration closed for now');
      body = t('reg.block.pausedBody', 'Registration for this event is paused for a short while. Please come back later.');
      break;
    case 'not_yet_open':
      title = t('reg.block.notYetTitle', 'Registration opens soon');
      body = form.event.opens_at
        ? t('reg.block.opensOn', { date: new Date(form.event.opens_at).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }), defaultValue: 'Registration opens on {{date}}.' })
        : t('reg.block.opensLater', 'Registration is not open yet.');
      break;
    case 'full':
      title = t('eventsPage.fullTitle', 'Fully booked');
      body = t('reg.error.full', 'Sorry, this event is now full.');
      break;
    case 'invitation_only':
      title = t('reg.block.byInvitation', 'By invitation only');
      body = t('reg.block.byInvitationBody', 'Places at this event are given by invitation from the organisers.');
      break;
    case 'not_published':
      title = t('reg.block.draftTitle', 'Registration not open yet');
      body = t('reg.block.draftBody', 'This event is a draft: registration opens once it is published.');
      break;
    default:
      title = t('reg.block.closedTitle', 'Registration closed');
      body = t('reg.error.closed', 'Registration for this event is closed.');
  }
  return (
    <div className="py-2">
      <span aria-hidden="true" className="mb-4 grid h-12 w-12 place-items-center rounded-full bg-chip text-navy">
        <Lock className="h-6 w-6" />
      </span>
      <h2 className="text-h3 text-navy">{title}</h2>
      <p className="mt-2 text-[15px] leading-6 text-ink">{body}</p>
      <div className="mt-6 flex flex-wrap gap-3">
        {state === 'members_only' && !signedIn && <Button variant="cta" size="sm" onClick={onSignIn}>{t('reg.block.signInToRegister', 'Sign in to register')}</Button>}
        <UnderlineLink to="/events">{t('reg.page.allEvents', 'See all events')}</UnderlineLink>
      </div>
    </div>
  );
}
