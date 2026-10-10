import { useCallback, useEffect, useState, type ReactNode, type Ref } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { LucideIcon } from 'lucide-react';
import {
  AlertCircle, CalendarClock, CalendarDays, CalendarPlus, CheckCircle2, Clock, CreditCard, Hourglass, ListChecks,
  Loader2, Lock, LogIn, Mail, MapPin, MessageSquare, PauseCircle, Play, Radio, RefreshCw, Ticket, Video, X, XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AuthNotice } from '@/components/auth/fields';
import { UnderlineLink } from '@/components/brand/UnderlineLink';
import { M3_PUBLIC_EMAIL } from '@/components/brand/ContactCard';
import { AddToCalendarButtons } from '@/components/events/AddToCalendarButtons';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/hooks/use-toast';
import { accountHref } from '@/lib/accountNav';
import {
  GUEST_LIST_PAGES, cancelRegistration, fetchMyEventAccess, getRegistrationForm, isShownRegistration, noOpenTicket, questionsFor,
  registerForEvent, registerOutcomeText, registrationErrorText, resendRegistrationLinks, statusPagePath, ticketOpen, useReviewSla,
  type RegForm, type RegStatus, type RegTarget, type RegisterDone,
} from '@/lib/registration';
import { cn, downloadICS, type CalendarEventInput } from '@/lib/utils';
import { ruleOf } from './IdentityBlock';
import { QuickWebinarSheet } from './QuickWebinarSheet';
import { ConfirmInline, NoteLine, longDate, regLocale } from './RegistrationUI';

/**
 * Taking part in an event, in ONE block, whatever the situation (spec §6):
 * save my seat in one tap, register, request an invitation, by invitation only,
 * you're registered (join link, calendar, cancel), under review, information
 * needed, invited (accept / decline), waiting list, full, closed, members only,
 * not open yet, event ended (replay).
 *
 * It reads the event through the registration function (`form`), which says
 * how this event takes registrations and, for a signed-in member, where their
 * own registration stands. Only events with a registration engine get here:
 * the page asks the database first (gl_event_slug_for) and an old event keeps
 * the page's own card, without ever calling the function, so an outage of the
 * function never blocks the old events. An event the function still does not
 * know comes back as `legacy` (the page's card). The World Yachting Summit
 * (the guest list) keeps its own page, /wys26.
 *
 * Used on /events/:id when the new event pages are switched on
 * (registration_flags.webinar_v2 or onsite_v2). The page calls
 * useParticipation() once and gives the model to the block and to the phone's
 * bottom bar (ParticipateBarAction), so both always say the same thing.
 */

export interface ParticipateEvent {
  id: string;
  title: string;
  description: string | null;
  date_time: string | null;
  end_date_time: string | null;
  is_full_day?: boolean | null;
  location: string | null;
  event_type: string;
  replay_url: string | null;
}

export type Phase = 'upcoming' | 'live' | 'ended' | 'tbd';

export interface ParticipationModel {
  event: ParticipateEvent | null;
  enabled: boolean;
  loading: boolean;
  failed: boolean;
  form: RegForm | null;
  /** The registration function knows no registration for this event: the page keeps its own path. */
  noEngine: boolean;
  /** Join link, handed only to a confirmed registrant (get_my_event_access). */
  meetingUrl: string | null;
  replayUrl: string | null;
  /** get_my_event_access says registered (any engine). */
  accessRegistered: boolean;
  phase: Phase;
  reload: () => void;
}

/** As the calendar links assume: an event without an end time lasts an hour. */
const DEFAULT_DURATION_MS = 60 * 60 * 1000;

export function phaseOf(e: Pick<ParticipateEvent, 'date_time' | 'end_date_time' | 'is_full_day'> | null, now: number): Phase {
  if (!e?.date_time) return 'tbd';
  const start = new Date(e.date_time).getTime();
  const end = e.end_date_time ? new Date(e.end_date_time).getTime() : start + (e.is_full_day ? 24 * 3600 * 1000 : DEFAULT_DURATION_MS);
  if (now < start) return 'upcoming';
  if (now < end) return 'live';
  return 'ended';
}

/**
 * The event page's model: the function's view of the event (`form`) and, signed
 * in, the member's links. Keyed on ids, never on the auth objects (a tab
 * refocus hands new ones).
 */
export function useParticipation(event: ParticipateEvent | null, enabled: boolean): ParticipationModel {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const eventId = event?.id ?? null;
  const [version, setVersion] = useState(0);
  const [form, setForm] = useState<RegForm | null>(null);
  const [noEngine, setNoEngine] = useState(false);
  const [failed, setFailed] = useState(false);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [access, setAccess] = useState<{ registered: boolean; meeting: string | null; replay: string | null }>({ registered: false, meeting: null, replay: null });
  const [now, setNow] = useState(() => Date.now());

  // The phase moves on its own (a webinar starts while the page is open).
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  // An event that is over takes no registration: only the member's links are read.
  const ended = phaseOf(event, now) === 'ended';
  const key = enabled && eventId ? `${eventId}|${userId ?? ''}|${version}|${ended}` : null;

  useEffect(() => {
    if (!key || !eventId) return;
    let alive = true;
    (async () => {
      const [res, rows] = await Promise.all([
        ended ? Promise.resolve(null) : getRegistrationForm({ event_id: eventId }),
        userId ? fetchMyEventAccess([eventId]) : Promise.resolve([]),
      ]);
      if (!alive) return;
      const row = rows.find((r) => r.event_id === eventId);
      setAccess({ registered: !!row?.is_registered, meeting: row?.meeting_url ?? null, replay: row?.replay_url ?? null });
      if (res === null) {
        setFailed(false);
      } else if (res.ok) {
        setForm(res);
        setNoEngine(false);
        setFailed(false);
      } else if (res.error === 'not_found' || res.state === 'not_found') {
        setForm(null);
        setNoEngine(true);
        setFailed(false);
      } else {
        // A failed read keeps what is on screen (a refresh after a change); a first read says so.
        setFailed(true);
      }
      setLoadedKey(key);
    })();
    return () => { alive = false; };
  }, [key, eventId, userId, ended]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const loading = !!key && loadedKey === null;

  return {
    event,
    enabled,
    loading,
    failed: failed && !form && !noEngine,
    form,
    noEngine,
    meetingUrl: access.meeting,
    replayUrl: access.replay ?? event?.replay_url ?? null,
    accessRegistered: access.registered,
    phase: phaseOf(event, now),
    reload,
  };
}

/* ------------------------------------------------------------------ the situation */

export type ParticipateView =
  | { k: 'loading' }
  | { k: 'error' }
  | { k: 'legacy' }
  | { k: 'ended' }
  | { k: 'guest_list'; path: string | null }
  | { k: 'mine'; status: RegStatus; id: string | null }
  | { k: 'one_tap'; waitlist: boolean }
  | { k: 'quick'; waitlist: boolean }
  | { k: 'form'; waitlist: boolean }
  | { k: 'members_only' }
  | { k: 'not_yet_open' }
  | { k: 'paused' }
  | { k: 'closed' }
  | { k: 'full' }
  | { k: 'invitation_only' }
  /** Every participation type is by invitation, or kept for company types the person is not (yet) known for. */
  | { k: 'no_ticket' }
  | { k: 'not_published' };

/** A participation type to choose, or a question to answer, before a registration can go: the form is needed. */
function needsChoices(form: RegForm): boolean {
  const tickets = form.tickets ?? [];
  if (tickets.length > 1) return true;
  const only = tickets[0] ?? null;
  if (only && !ticketOpen(only)) return true;
  return questionsFor(form.questions, only?.key ?? null).some((q) => q.required);
}

/**
 * Signed out, a webinar: nothing more to ask than the four quick fields (no
 * choice of participation type, no required question, no required job title,
 * phone or country).
 */
export function quickEligible(form: RegForm): boolean {
  if (form.event.mode === 'invitation' || needsChoices(form)) return false;
  return (['job_title', 'phone', 'country'] as const).every((k) => ruleOf(form.fields, k) !== 'required');
}

/** Signed in, a webinar: one tap when the account already holds everything the event requires. */
export function oneTapEligible(form: RegForm): boolean {
  if (form.event.kind !== 'webinar' || form.event.mode === 'invitation' || needsChoices(form)) return false;
  const p = form.prefill ?? {};
  if (!p.first_name?.trim() || !p.last_name?.trim()) return false;
  return (['company', 'job_title', 'phone', 'country'] as const).every((k) => ruleOf(form.fields, k) !== 'required' || !!p[k]?.trim());
}

export function participationView(model: ParticipationModel, signedIn: boolean): ParticipateView {
  if (model.phase === 'ended') return { k: 'ended' };
  if (model.loading) return { k: 'loading' };
  if (model.noEngine) return { k: 'legacy' };
  if (!model.form) return model.failed ? { k: 'error' } : { k: 'loading' };
  const form = model.form;
  if (form.engine === 'guest_list_v1') return { k: 'guest_list', path: GUEST_LIST_PAGES[form.event.slug] ?? null };
  const mine = form.mine;
  if (mine && isShownRegistration(mine.status)) return { k: 'mine', status: mine.status, id: mine.registration_id ?? null };
  if (form.paused) return { k: 'paused' };
  switch (form.state) {
    case 'open':
    case 'waitlist': {
      // Nothing this person can choose: say so here, not at the last step of the form.
      if (noOpenTicket(form)) return { k: 'no_ticket' };
      const waitlist = form.state === 'waitlist';
      if (signedIn) return oneTapEligible(form) ? { k: 'one_tap', waitlist } : { k: 'form', waitlist };
      return form.event.kind === 'webinar' && quickEligible(form) ? { k: 'quick', waitlist } : { k: 'form', waitlist };
    }
    case 'registered':
      // The function said registered without the details: what the member's links say.
      return { k: 'mine', status: model.accessRegistered ? 'confirmed' : 'requested', id: null };
    case 'members_only': return { k: 'members_only' };
    case 'not_yet_open': return { k: 'not_yet_open' };
    case 'closed': return { k: 'closed' };
    case 'full': return { k: 'full' };
    case 'invitation_only': return { k: 'invitation_only' };
    case 'not_published': return { k: 'not_published' };
    default: return { k: 'closed' };
  }
}

type Tone = 'navy' | 'green' | 'red' | 'gray' | 'gold';
const TONE: Record<Tone, string> = {
  navy: 'bg-navy text-white',
  green: 'bg-teal text-white',
  red: 'bg-red-600 text-white',
  gray: 'bg-chip text-navy',
  gold: 'bg-gold text-navy',
};

const MAIN_BTN = 'w-full justify-between';

/* ------------------------------------------------------------------ the block */

export function ParticipateBlock({
  model,
  onSignIn,
  onSignUp,
  onChanged,
  headingRef,
  legacy,
}: {
  model: ParticipationModel;
  onSignIn: () => void;
  onSignUp: () => void;
  /** After a registration, a cancellation or an answer: the page refreshes its own reads. */
  onChanged?: () => void;
  headingRef?: Ref<HTMLHeadingElement>;
  /** The page's own card, for an event the registration function does not know. */
  legacy?: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const signedIn = !!user;
  const locale = regLocale(i18n.language);
  const sla = useReviewSla(model.form?.review_sla_text);
  const [busy, setBusy] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  // Signed out, after a quick registration: where it was sent, so the block says it (and does not invite a second one).
  const [sentTo, setSentTo] = useState<string | null>(null);

  const view = participationView(model, signedIn);
  if (view.k === 'legacy') return <>{legacy ?? null}</>;

  const ev = model.event;
  const form = model.form;
  const isWebinar = form?.event.kind ? form.event.kind === 'webinar' : ev?.event_type === 'webinar';
  const slug = form?.event.slug ?? null;
  const registerPath = slug ? `/register/${slug}?from=event` : null;
  const eventTarget = ev ? { event_id: ev.id } : null;
  // The member's own registration: by its id when the function gave it, else by the event.
  const mineId = view.k === 'mine' ? view.id : null;
  const mineTarget: RegTarget | null = mineId ? { registration_id: mineId } : eventTarget;
  const minePage = mineId ? statusPagePath(mineId) : null;

  const calendarEvent: CalendarEventInput | null = ev?.date_time ? {
    title: ev.title,
    description: ev.description,
    date_time: ev.date_time,
    end_date_time: ev.end_date_time,
    location: ev.location,
    url: model.meetingUrl,
  } : null;

  const changed = () => { model.reload(); onChanged?.(); };

  /** `success`: the words for the answer (a string, or read from the answer itself). */
  const run = async <R extends { ok: boolean }>(fn: () => Promise<R>, success: string | ((res: R) => string), failureFallback?: (res: unknown) => boolean) => {
    setBusy(true);
    setInlineError(null);
    const res = await fn();
    setBusy(false);
    if (res.ok) {
      toast({ title: typeof success === 'function' ? success(res) : success });
      changed();
      return;
    }
    if (failureFallback?.(res)) return;
    setInlineError(registrationErrorText(t, res as never));
  };

  const oneTap = () => {
    if (!eventTarget) return;
    void run(
      () => registerForEvent(eventTarget, { source_detail: { entry: 'event_page' } }),
      // What the function says happened (a seat, the waiting list, a request, already registered).
      (res) => registerOutcomeText(t, res as RegisterDone),
      (res) => {
        // Something to fill in after all: the full form, with what the account knows.
        const err = (res as { error?: string }).error ?? '';
        if (registerPath && ['missing_fields', 'invalid_answers', 'ticket_required', 'unknown_ticket'].includes(err)) {
          navigate(registerPath);
          return true;
        }
        return false;
      },
    );
  };

  const cancel = () => mineTarget && void run(
    () => cancelRegistration(mineTarget),
    t('reg.toast.cancelled', 'Your registration is cancelled.'),
    (res) => {
      // A registration found through the e-mail but not linked to the account yet: its e-mail link manages it.
      if ((res as { error?: string }).error === 'not_found') {
        setInlineError(t('reg.block.cancelByLink', 'Please cancel from the personal link in your confirmation e-mail. Lost it? Open My events and choose "Send me my links".'));
        return true;
      }
      return false;
    },
  );
  const resendLinks = () => {
    const email = user?.email;
    if (!email) return;
    void run(() => resendRegistrationLinks(email), t('reg.toast.linksSent', 'We have e-mailed your links again.'));
  };

  // The member's registration in full (answers, timeline, pass): its own page, else My events.
  const viewMine = minePage ? (
    <Button asChild variant="ctaOutline" size="sm" className={MAIN_BTN}>
      <Link to={minePage}>{t('reg.block.viewMine', 'See my registration')}</Link>
    </Button>
  ) : (
    <Button variant="ctaOutline" size="sm" className={MAIN_BTN} onClick={() => navigate(accountHref('registrations'))}>
      {t('eventsPage.viewMyRegistrations', 'View my registrations')}
    </Button>
  );
  const signInLine = (
    <p className="text-center text-sm text-meta">
      {t('reg.block.haveAccount', 'Have an account?')}{' '}
      <button
        type="button"
        className="inline-flex min-h-11 items-center rounded px-1 font-medium text-navy underline underline-offset-4 hover:text-teal-text focus:outline-none focus-visible:shadow-focus"
        onClick={onSignIn}
      >
        {t('reg.signIn', 'Sign in')}
      </button>
    </p>
  );
  const errorLine = inlineError ? <AuthNotice tone="error" role="alert"><p>{inlineError}</p></AuthNotice> : null;

  let title: string;
  let icon: LucideIcon;
  let tone: Tone;
  let body: ReactNode;

  switch (view.k) {
    case 'loading':
      title = t('reg.block.title', 'Registration');
      icon = Ticket;
      tone = 'navy';
      body = (
        <div role="status" className="space-y-3" aria-label={t('reg.loading', 'Loading')}>
          <div className="h-4 w-3/4 animate-pulse rounded bg-chip motion-reduce:animate-none" />
          <div className="h-12 animate-pulse rounded-pill bg-chip motion-reduce:animate-none" />
        </div>
      );
      break;

    case 'error':
      title = t('reg.block.title', 'Registration');
      icon = AlertCircle;
      tone = 'gray';
      body = (
        <div className="space-y-4">
          <p className="text-sm leading-[22px] text-meta">{t('reg.block.loadFailed', 'The registration could not be loaded. The connection may be slow.')}</p>
          <Button variant="ctaOutline" size="sm" arrow={false} className={MAIN_BTN} onClick={model.reload}>
            <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />{t('common.retry', 'Try again')}
          </Button>
        </div>
      );
      break;

    case 'ended': {
      const registered = model.accessRegistered || form?.mine?.status === 'confirmed';
      title = t('eventsPage.endedTitle', 'This event has ended');
      icon = model.replayUrl ? Play : CalendarDays;
      tone = 'gray';
      body = (
        <div className="space-y-4">
          {registered && (
            <p className="flex items-center gap-2 text-sm text-ink">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-teal" aria-hidden="true" />
              {t('eventsPage.youWereRegistered', 'You were registered for this event.')}
            </p>
          )}
          {model.replayUrl ? (
            <>
              <p className="text-sm leading-[22px] text-meta">{t('eventsPage.replayIntro', 'Missed it, or want to see it again? The full session is online.')}</p>
              <Button asChild variant="cta" className={MAIN_BTN}>
                <a href={model.replayUrl} target="_blank" rel="noopener noreferrer">{t('events.watchReplay', 'Watch the replay')}</a>
              </Button>
            </>
          ) : (
            <p className="text-sm leading-[22px] text-meta">{t('eventsPage.noReplay', 'No replay has been published for this event.')}</p>
          )}
          <UnderlineLink to="/events">{t('eventsPage.seeUpcoming', 'See upcoming events')}</UnderlineLink>
        </div>
      );
      break;
    }

    case 'guest_list':
      title = t('eventsPage.requestInvitation', 'Request an invitation');
      icon = Lock;
      tone = 'navy';
      body = (
        <div className="space-y-4">
          <p className="text-sm leading-[22px] text-meta">{t('eventsPage.guestListIntro', 'Places are by invitation. Send a request and the organisers will come back to you.')}</p>
          {view.path ? (
            <Button asChild variant="cta" className={MAIN_BTN}>
              <Link to={view.path}>{t('eventsPage.requestInvitation', 'Request an invitation')}</Link>
            </Button>
          ) : (
            <p className="text-sm leading-[22px] text-ink">
              {t('reg.block.contactUs', 'To take part, write to')}{' '}
              <UnderlineLink href={`mailto:${M3_PUBLIC_EMAIL}`} arrow={false} className="!text-sm">{M3_PUBLIC_EMAIL}</UnderlineLink>
            </p>
          )}
        </div>
      );
      break;

    case 'mine': {
      const s = view.status;
      const live = model.phase === 'live';
      // Cancelling stops at the start (the function refuses it once the event is over).
      const canCancel = !live && ['requested', 'needs_info', 'waitlisted', 'invited', 'approved', 'confirmed'].includes(s);
      const cancelBlock = canCancel ? (
        <ConfirmInline
          label={s === 'requested' || s === 'needs_info' ? t('reg.block.cancelRequest', 'Cancel my request')
            : s === 'waitlisted' ? t('reg.block.leaveWaitlist', 'Leave the waiting list') : t('eventsPage.cancelMine', 'Cancel my registration')}
          question={t('reg.block.cancelQuestion', 'Cancel your registration for this event?')}
          confirmLabel={t('reg.block.cancelYes', 'Yes, cancel')}
          keepLabel={t('reg.block.cancelKeep', 'No, keep it')}
          onConfirm={cancel}
          busy={busy}
          icon={X}
        />
      ) : null;

      if (s === 'confirmed') {
        title = live ? t('eventsPage.happeningNow', 'Happening now') : t('eventsPage.youreRegistered', "You're registered");
        icon = live ? Radio : CheckCircle2;
        tone = live ? 'red' : 'green';
        body = (
          <div className="space-y-5">
            <ol className="space-y-2.5">
              {calendarEvent && !live && <li><NoteLine icon={CalendarPlus}>{t('eventsPage.nextCalendar', 'Save the date in your calendar.')}</NoteLine></li>}
              {isWebinar ? (
                <li>
                  <NoteLine icon={Video}>
                    {model.meetingUrl
                      ? t('eventsPage.nextJoinReady', 'At the start time, join from this page with the button below.')
                      : t('reg.block.joinLater', 'The joining link will appear on this page before the webinar starts. We also send it by e-mail.')}
                  </NoteLine>
                </li>
              ) : (
                <>
                  {/* The pass reaches a session only once its e-mail is confirmed: the e-mail is the sure place. */}
                  <li><NoteLine icon={Ticket}>{t('reg.block.passByEmail', 'Your entry pass is in your confirmation e-mail. Show it at the entrance.')}</NoteLine></li>
                  <li><NoteLine icon={MapPin}>{t('eventsPage.nextVenue', 'On the day, come to the venue — the address and map are on this page.')}</NoteLine></li>
                </>
              )}
              <li><NoteLine icon={ListChecks}>{t('eventsPage.nextManage', 'All your registrations are in My events, in your account.')}</NoteLine></li>
            </ol>
            {isWebinar && model.meetingUrl && (
              <Button asChild variant="cta" className={MAIN_BTN}>
                <a href={model.meetingUrl} target="_blank" rel="noopener noreferrer">{live ? t('eventsPage.joinNow', 'Join now') : t('eventsPage.joinWebinar', 'Join the webinar')}</a>
              </Button>
            )}
            {!isWebinar && minePage && (
              <Button asChild variant="cta" className={MAIN_BTN}>
                <Link to={minePage}>{t('reg.block.viewMine', 'See my registration')}</Link>
              </Button>
            )}
            {calendarEvent && !live && (
              <div className="space-y-2">
                <p className="text-meta-caps">{t('events.addToCalendar', 'Add to calendar')}</p>
                <AddToCalendarButtons event={calendarEvent} />
              </div>
            )}
            {!isWebinar && (
              <Button variant="ctaOutline" size="sm" arrow={false} className={MAIN_BTN} onClick={resendLinks} disabled={busy}>
                <Mail className="mr-2 h-4 w-4" aria-hidden="true" />{t('reg.block.resendLinks', 'E-mail me my link again')}
              </Button>
            )}
            {(isWebinar || !minePage) && viewMine}
            {errorLine}
            {cancelBlock}
          </div>
        );
      } else if (s === 'requested') {
        title = t('reg.status.underReview', 'Received, under review');
        icon = Clock;
        tone = 'gold';
        body = (
          <div className="space-y-4">
            <p className="text-sm leading-[22px] text-ink">
              {form?.event.mode === 'invitation'
                ? t('reg.block.requestReceived', { sla, defaultValue: 'Your request is with the M3 team. They reply {{sla}}, by e-mail.' })
                : t('reg.block.reviewReceived', { sla, defaultValue: 'Your registration is with the M3 team. They reply {{sla}}, by e-mail.' })}
            </p>
            <NoteLine icon={Mail}>{t('reg.block.followLink', 'You can follow it, or change your answers, from your registration page or the link in our e-mail.')}</NoteLine>
            {viewMine}
            {errorLine}
            {cancelBlock}
          </div>
        );
      } else if (s === 'needs_info') {
        title = t('reg.status.needsInfo', 'Information needed');
        icon = MessageSquare;
        tone = 'gold';
        body = (
          <div className="space-y-4">
            <p className="text-sm leading-[22px] text-ink">{t('reg.block.infoAskedShort', 'The M3 team needs one more detail before deciding. Their question is on your registration page.')}</p>
            {minePage ? (
              <Button asChild variant="cta" className={MAIN_BTN}>
                <Link to={minePage}>{t('reg.block.answerM3', 'Answer the M3 team')}</Link>
              </Button>
            ) : (
              <NoteLine icon={Mail}>{t('reg.block.answerByLink', 'Open the link in the e-mail we sent you to answer.')}</NoteLine>
            )}
            {errorLine}
            {cancelBlock}
          </div>
        );
      } else if (s === 'waitlisted') {
        title = t('reg.block.waitlistTitle', 'On the waiting list');
        icon = Hourglass;
        tone = 'gray';
        body = (
          <div className="space-y-4">
            <p className="text-sm leading-[22px] text-ink">{t('reg.block.waitlistBody', 'The event is full for now. We e-mail you as soon as a place frees up.')}</p>
            {viewMine}
            {errorLine}
            {cancelBlock}
          </div>
        );
      } else if (s === 'invited') {
        title = t('reg.block.invitedTitle', "You're invited");
        icon = Mail;
        tone = 'gold';
        body = (
          <div className="space-y-4">
            <p className="text-sm leading-[22px] text-ink">{t('reg.block.invitedByEmail', 'The organisers have invited you. Please reply from your invitation e-mail.')}</p>
            {viewMine}
            {errorLine}
          </div>
        );
      } else if (s === 'approved') {
        title = t('reg.status.paymentDue', 'Approved, payment due');
        icon = CreditCard;
        tone = 'gold';
        body = (
          <div className="space-y-4">
            <p className="text-sm leading-[22px] text-ink">{t('reg.block.paymentDue', 'The M3 team has approved your registration. They send you the payment details by e-mail.')}</p>
            {viewMine}
            {errorLine}
            {cancelBlock}
          </div>
        );
      } else {
        // rejected
        title = t('reg.status.notAccepted', 'Not accepted');
        icon = XCircle;
        tone = 'gray';
        body = (
          <div className="space-y-4">
            <p className="text-sm leading-[22px] text-ink">{t('reg.block.notAccepted', 'The organisers could not offer you a place at this event.')}</p>
            <p className="text-sm leading-[22px] text-meta">
              {t('reg.block.questions', 'A question? Write to')}{' '}
              <UnderlineLink href={`mailto:${M3_PUBLIC_EMAIL}`} arrow={false} className="!text-sm">{M3_PUBLIC_EMAIL}</UnderlineLink>
            </p>
          </div>
        );
      }
      break;
    }

    case 'one_tap': {
      const p = form?.prefill ?? {};
      const name = [p.first_name, p.last_name].filter(Boolean).join(' ') || [profile?.first_name, profile?.last_name].filter(Boolean).join(' ');
      const email = p.email || user?.email || '';
      title = view.waitlist ? t('reg.block.fullWaitlist', 'Full: waiting list open') : t('eventsPage.registerWebinar', 'Register for this webinar');
      icon = view.waitlist ? Hourglass : Ticket;
      tone = 'navy';
      body = (
        <div className="space-y-4">
          {view.waitlist && <p className="text-sm leading-[22px] text-ink">{t('reg.block.waitlistIntro', 'All places are taken. Join the waiting list: we e-mail you if one frees up.')}</p>}
          <Button variant="cta" className={MAIN_BTN} onClick={oneTap} disabled={busy} arrow={!busy} roll={!busy}>
            {busy
              ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />{t('reg.sending', 'Sending…')}</>
              : view.waitlist ? t('reg.submit.waitlist', 'Join the waiting list')
                : form?.event.mode === 'review' ? t('reg.submit.review', 'Send my registration') : t('reg.block.saveSeat', 'Save my seat')}
          </Button>
          {(name || email) && (
            <p className="text-[13px] leading-5 text-meta [overflow-wrap:anywhere]">
              {t('reg.block.asWho', { who: [name, email && `(${email})`].filter(Boolean).join(' '), defaultValue: 'One tap, with your account: {{who}}. The details come by e-mail.' })}
            </p>
          )}
          {errorLine}
        </div>
      );
      break;
    }

    case 'quick': {
      const reviewed = form?.event.mode === 'review';
      // "Free" only when the event says so: no participation type, or its only one at no cost.
      const tickets = form?.tickets ?? [];
      const free = tickets.length === 0 || (tickets.length === 1 && tickets[0].price_cents === 0);
      title = view.waitlist ? t('reg.block.fullWaitlist', 'Full: waiting list open')
        : reviewed ? t('reg.quick.titleReview', 'Ask for a seat at this webinar') : t('eventsPage.registerWebinar', 'Register for this webinar');
      icon = view.waitlist ? Hourglass : Ticket;
      tone = 'navy';
      body = (
        <div className="space-y-4">
          {sentTo ? (
            <AuthNotice tone="success" role="status" icon={<Mail className="h-4 w-4" />}>
              <p className="[overflow-wrap:anywhere]">{t('reg.block.sentTo', { email: sentTo, defaultValue: 'Sent to {{email}}: please check your inbox.' })}</p>
            </AuthNotice>
          ) : (
            <p className="text-sm leading-[22px] text-ink">
              {view.waitlist
                ? t('reg.block.waitlistIntro', 'All places are taken. Join the waiting list: we e-mail you if one frees up.')
                : reviewed
                  ? t('reg.block.quickReviewIntro', { sla, defaultValue: 'No account needed. The M3 team reviews every registration and replies {{sla}}.' })
                  : free
                    ? t('reg.block.quickIntro', 'Free. No account needed: your name and e-mail are enough.')
                    : t('reg.block.quickIntroNoAccount', 'No account needed: your name and e-mail are enough.')}
            </p>
          )}
          <Button variant={sentTo ? 'ctaOutline' : 'cta'} className={MAIN_BTN} onClick={() => setSheetOpen(true)}>
            {sentTo ? t('reg.block.registerSomeoneElse', 'Register someone else')
              : view.waitlist ? t('reg.submit.waitlist', 'Join the waiting list') : t('reg.block.register', 'Register')}
          </Button>
          {signInLine}
          {form && (
            <QuickWebinarSheet
              open={sheetOpen}
              onOpenChange={setSheetOpen}
              form={form}
              waitlist={view.waitlist}
              sla={sla}
              onSignIn={onSignIn}
              onSignUp={onSignUp}
              onRegistered={setSentTo}
            />
          )}
        </div>
      );
      break;
    }

    case 'form': {
      const mode = form?.event.mode;
      const request = mode === 'invitation';
      title = view.waitlist ? t('reg.block.fullWaitlist', 'Full: waiting list open')
        : request ? t('eventsPage.requestInvitation', 'Request an invitation')
          : isWebinar ? t('eventsPage.registerWebinar', 'Register for this webinar') : t('reg.block.registerTitle', 'Register');
      icon = request ? Lock : view.waitlist ? Hourglass : Ticket;
      tone = 'navy';
      body = (
        <div className="space-y-4">
          <p className="text-sm leading-[22px] text-ink">
            {view.waitlist ? t('reg.block.waitlistIntro', 'All places are taken. Join the waiting list: we e-mail you if one frees up.')
              : request ? t('reg.block.requestIntro', { sla, defaultValue: 'Places are by invitation. Send a short request: the M3 team replies {{sla}}.' })
                : mode === 'review' ? t('reg.block.reviewIntro', { sla, defaultValue: 'A short form. The M3 team reviews every registration and replies {{sla}}.' })
                  : t('reg.block.formIntro', 'A short form, and you are registered.')}
          </p>
          {!signedIn && (
            <p className="text-[13px] leading-5 text-meta">{t('reg.block.noAccountNeeded', 'No account needed: you receive a personal link by e-mail to follow your registration.')}</p>
          )}
          {registerPath && (
            <Button asChild variant="cta" className={MAIN_BTN}>
              <Link to={registerPath}>
                {view.waitlist ? t('reg.submit.waitlist', 'Join the waiting list') : request ? t('eventsPage.requestInvitation', 'Request an invitation') : t('reg.block.register', 'Register')}
              </Link>
            </Button>
          )}
          {!signedIn && signInLine}
        </div>
      );
      break;
    }

    case 'members_only': {
      const pending = signedIn && (form?.prefill ? form.prefill.verified !== true : profile?.access_status !== 'verified');
      title = t('reg.block.membersTitle', 'For validated members');
      icon = Lock;
      tone = 'navy';
      body = pending ? (
        <div className="space-y-4">
          <AuthNotice tone="warning">
            <p>{t('reg.block.membersPending', 'Your account is being reviewed by the M3 team. You can register as soon as it is validated.')}</p>
          </AuthNotice>
          <Button variant="ctaOutline" size="sm" className={MAIN_BTN} onClick={() => navigate('/')}>
            {t('eventsPage.checkAccountStatus', 'Check my account status')}
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm leading-[22px] text-ink">{t('reg.block.membersBody', 'This event is for members validated by M3. Sign in with your account to register.')}</p>
          <Button variant="cta" className={MAIN_BTN} onClick={onSignIn}>
            {t('reg.block.signInToRegister', 'Sign in to register')}
          </Button>
          <p className="text-center text-sm text-meta">
            {t('eventsPage.noAccount', 'New here?')}{' '}
            <button
              type="button"
              className="inline-flex min-h-11 items-center rounded px-1 font-medium text-navy underline underline-offset-4 hover:text-teal-text focus:outline-none focus-visible:shadow-focus"
              onClick={onSignUp}
            >
              {t('reg.quick.createAccount', 'Create my account')}
            </button>
          </p>
        </div>
      );
      break;
    }

    case 'not_yet_open':
      title = t('reg.block.notYetTitle', 'Registration opens soon');
      icon = CalendarClock;
      tone = 'gray';
      body = (
        <div className="space-y-4">
          <p className="text-sm leading-[22px] text-ink">
            {form?.event.opens_at
              ? t('reg.block.opensOn', { date: longDate(form.event.opens_at, locale), defaultValue: 'Registration opens on {{date}}.' })
              : t('reg.block.opensLater', 'Registration is not open yet.')}
          </p>
          {calendarEvent && (
            <div className="space-y-2">
              <p className="text-meta-caps">{t('reg.block.saveDate', 'Save the date')}</p>
              <AddToCalendarButtons event={calendarEvent} />
            </div>
          )}
        </div>
      );
      break;

    case 'paused':
      title = t('reg.block.pausedTitle', 'Registration closed for now');
      icon = PauseCircle;
      tone = 'gray';
      body = (
        <div className="space-y-3">
          <p className="text-sm leading-[22px] text-ink">{t('reg.block.pausedBody', 'Registration for this event is paused for a short while. Please come back later.')}</p>
          <p className="text-sm leading-[22px] text-meta">
            {t('reg.block.questions', 'A question? Write to')}{' '}
            <UnderlineLink href={`mailto:${M3_PUBLIC_EMAIL}`} arrow={false} className="!text-sm">{M3_PUBLIC_EMAIL}</UnderlineLink>
          </p>
        </div>
      );
      break;

    case 'closed':
      title = t('reg.block.closedTitle', 'Registration closed');
      icon = Lock;
      tone = 'gray';
      body = <p className="text-sm leading-[22px] text-meta">{t('reg.error.closed', 'Registration for this event is closed.')}</p>;
      break;

    case 'full':
      title = t('eventsPage.fullTitle', 'Fully booked');
      icon = AlertCircle;
      tone = 'gray';
      body = (
        <div className="flex items-center gap-2 rounded-field bg-amber-50 p-3 text-amber-800 ring-1 ring-amber-200">
          <AlertCircle className="h-5 w-5 shrink-0" aria-hidden="true" />
          <span className="font-medium">{t('eventsPage.eventFull', 'This event is full')}</span>
        </div>
      );
      break;

    case 'invitation_only':
      title = t('reg.block.byInvitation', 'By invitation only');
      icon = Lock;
      tone = 'gray';
      body = (
        <div className="space-y-3">
          <p className="text-sm leading-[22px] text-ink">{t('reg.block.byInvitationBody', 'Places at this event are given by invitation from the organisers.')}</p>
          <p className="text-sm leading-[22px] text-meta">
            {t('reg.block.questions', 'A question? Write to')}{' '}
            <UnderlineLink href={`mailto:${M3_PUBLIC_EMAIL}`} arrow={false} className="!text-sm">{M3_PUBLIC_EMAIL}</UnderlineLink>
          </p>
        </div>
      );
      break;

    case 'no_ticket':
      title = t('reg.block.byInvitation', 'By invitation only');
      icon = Lock;
      tone = 'gray';
      body = (
        <div className="space-y-4">
          <p className="text-sm leading-[22px] text-ink">{t('reg.block.noTicketBody', 'Places at this event are given by invitation, or kept for some companies validated by M3.')}</p>
          {!signedIn && (
            <>
              <p className="text-sm leading-[22px] text-meta">{t('reg.block.noTicketSignIn', 'Your company is validated by M3? Sign in to see the places it can take.')}</p>
              <Button variant="ctaOutline" size="sm" className={MAIN_BTN} onClick={onSignIn}>
                {t('reg.signIn', 'Sign in')}
              </Button>
            </>
          )}
          <p className="text-sm leading-[22px] text-meta">
            {t('reg.block.questions', 'A question? Write to')}{' '}
            <UnderlineLink href={`mailto:${M3_PUBLIC_EMAIL}`} arrow={false} className="!text-sm">{M3_PUBLIC_EMAIL}</UnderlineLink>
          </p>
        </div>
      );
      break;

    case 'not_published':
    default:
      title = t('reg.block.draftTitle', 'Registration not open yet');
      icon = CalendarClock;
      tone = 'gray';
      body = <p className="text-sm leading-[22px] text-meta">{t('reg.block.draftBody', 'This event is a draft: registration opens once it is published.')}</p>;
      break;
  }

  const Icon = icon;
  return (
    <div className="rounded-card border border-rule bg-white p-5 sm:p-6">
      <div className="flex items-center gap-3">
        <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-full', TONE[tone])}>
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <h2 ref={headingRef} tabIndex={-1} className="text-card-title text-navy focus:outline-none">{title}</h2>
      </div>
      <div className="mt-5 space-y-4">{body}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ the phone's bottom bar */

/**
 * The one action of the bottom bar on phones, from the same model as the block:
 * join, add to calendar, replay, or a button that brings the block into view.
 * Null when there is nothing to put there, or when the page keeps its own path
 * (an event without the engine): the page then hides the bar.
 */
export function participateBarAction(view: ParticipateView, model: ParticipationModel, t: TFunction, onShowBlock: () => void): ReactNode {
  const ev = model.event;
  const quiet = 'shrink-0 text-sm font-medium text-meta';
  const btn = 'shrink-0';
  switch (view.k) {
    case 'legacy':
    case 'loading':
    case 'error':
      return null;
    case 'ended':
      return model.replayUrl ? (
        <Button asChild variant="cta" size="sm" arrow={false} className={btn}>
          <a href={model.replayUrl} target="_blank" rel="noopener noreferrer">{t('eventsPage.replayShort', 'Replay')}</a>
        </Button>
      ) : null;
    case 'mine':
      if (view.status === 'confirmed') {
        if (model.meetingUrl && ev?.event_type === 'webinar') {
          return (
            <Button asChild variant="cta" size="sm" arrow={false} className={btn}>
              <a href={model.meetingUrl} target="_blank" rel="noopener noreferrer">{model.phase === 'live' ? t('eventsPage.joinNow', 'Join now') : t('eventsPage.joinShort', 'Join')}</a>
            </Button>
          );
        }
        if (ev?.date_time && model.phase !== 'live') {
          const cal: CalendarEventInput = { title: ev.title, description: ev.description, date_time: ev.date_time, end_date_time: ev.end_date_time, location: ev.location };
          return (
            <Button variant="cta" size="sm" arrow={false} className={btn} onClick={() => downloadICS(cal)}>
              <CalendarPlus className="mr-1.5 h-4 w-4" aria-hidden="true" />{t('eventsPage.addToCalendarShort', 'Add to calendar')}
            </Button>
          );
        }
        return null;
      }
      return (
        <Button variant="ctaOutline" size="sm" arrow={false} className={btn} onClick={onShowBlock}>
          {t('eventsPage.yourRegistration', 'Your registration')}
        </Button>
      );
    case 'one_tap':
    case 'quick':
    case 'form':
      return (
        <Button variant="cta" size="sm" arrow={false} className={btn} onClick={onShowBlock}>
          {view.waitlist ? t('reg.bar.waitlist', 'Waiting list')
            : view.k === 'form' && model.form?.event.mode === 'invitation' ? t('eventsPage.requestShort', 'Request') : t('events.register', 'Register')}
        </Button>
      );
    case 'guest_list':
      return (
        <Button variant="cta" size="sm" arrow={false} className={btn} onClick={onShowBlock}>{t('eventsPage.requestShort', 'Request')}</Button>
      );
    case 'members_only':
      return (
        <Button variant="ctaOutline" size="sm" arrow={false} className={btn} onClick={onShowBlock}>
          <LogIn className="mr-1.5 h-4 w-4" aria-hidden="true" />{t('reg.bar.members', 'Members')}
        </Button>
      );
    case 'full':
      return <span className="shrink-0 text-sm font-medium text-amber-800">{t('eventsPage.fullTitle', 'Fully booked')}</span>;
    case 'closed':
    case 'paused':
      return <span className={quiet}>{t('reg.bar.closed', 'Closed')}</span>;
    case 'invitation_only':
    case 'no_ticket':
      return <span className={quiet}>{t('eventsPage.invitationOnly', 'By invitation')}</span>;
    case 'not_yet_open':
    case 'not_published':
      return <span className={quiet}>{t('reg.bar.soon', 'Opens soon')}</span>;
    default:
      return null;
  }
}

