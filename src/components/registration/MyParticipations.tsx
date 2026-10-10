import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowRight, CalendarClock, CalendarDays, Clock, Inbox, Link2, MapPin, MessageSquare, Radio, RefreshCw, Ticket, Video, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AddToCalendarButtons } from '@/components/events/AddToCalendarButtons';
import { BTN_OUTLINE, FOCUS, MemberEmpty, MemberPanel, RowSkeleton, StatusPill } from '@/components/member/MemberUI';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
import { RENDEZVOUS_2026_PATH } from '@/components/brand/m3Events';
import { humanize } from '@/components/account/format';
import {
  GUEST_LIST_PAGES, cancelRegistration, fetchMyEventAccess, fetchMyParticipations, registrationErrorText, statusPagePath,
  type Participation,
} from '@/lib/registration';
import { cn, type CalendarEventInput } from '@/lib/utils';
import { ConfirmInline, PaymentPill, RegStatusPill, regLocale, whenLine } from './RegistrationUI';
import { ResendLinksForm } from './ResendLinksForm';

/**
 * My events, every registration in one list whatever the way it was made
 * (my_participations): the new registrations (webinars and on-site events),
 * the World Yachting Summit guest list, the old member registrations, and the
 * Smart Marina 2026 archive (read-only). Coming first, then past. Each says
 * where it stands in the shared words, with what can be done now: join the
 * webinar, add to the calendar, open the personal page, reply, cancel, watch
 * the replay.
 *
 * Registrations made with the member's e-mail before they had an account show
 * once that e-mail is proven (the database decides: my_participations).
 */

/** The old member registrations' types, in words (as the old My events said them). */
export const REGISTRATION_TYPE_LABELS: Record<string, { key: string; fallback: string }> = {
  visitor: { key: 'accountArea.events.regType.visitor', fallback: 'Visitor' },
  sponsor_included: { key: 'accountArea.events.regType.sponsor_included', fallback: 'Sponsor seat' },
  member_discount: { key: 'accountArea.events.regType.member_discount', fallback: 'Member rate' },
  package: { key: 'accountArea.events.regType.package', fallback: 'Package' },
  marina_package: { key: 'accountArea.events.regType.marina_package', fallback: 'Marina package' },
  invitation_request: { key: 'accountArea.events.regType.invitation_request', fallback: 'Invitation request' },
  exhibitor: { key: 'accountArea.events.regType.exhibitor', fallback: 'Exhibitor' },
};

/** "Registered as …": a participation type is shown as it is; old and SM26 database values in words. */
function roleText(p: Participation, t: (key: string, fallback: string) => string): string | null {
  const raw = p.role_or_ticket?.trim();
  if (!raw) return null;
  if (p.engine === 'legacy') {
    const known = REGISTRATION_TYPE_LABELS[raw];
    return known ? t(known.key, known.fallback) : humanize(raw);
  }
  if (p.engine === 'sm26') return raw.split(',').map((x) => humanize(x.trim())).filter(Boolean).join(', ');
  return raw;
}

interface EventExtra {
  id: string;
  description: string | null;
  replay_url: string | null;
  is_full_day: boolean | null;
}

/** The date as a tile: navy while the event is ahead, grey once it is over. */
function DateTile({ iso, endIso, locale, past }: { iso: string | null; endIso: string | null; locale: string; past: boolean }) {
  if (!iso) {
    return (
      <span aria-hidden="true" className="flex h-16 w-16 shrink-0 items-center justify-center rounded-card bg-chip text-meta">
        <CalendarClock className="h-6 w-6" />
      </span>
    );
  }
  const start = new Date(iso);
  let end = endIso ? new Date(endIso) : null;
  if (end && end.getHours() === 0 && end.getMinutes() === 0 && end > start) end = new Date(end.getTime() - 1);
  const multi = !!end && end.toDateString() !== start.toDateString();
  const sameMonth = !!end && end.getMonth() === start.getMonth() && end.getFullYear() === start.getFullYear();
  const day = multi && sameMonth && end ? `${start.getDate()}–${end.getDate()}` : String(start.getDate());
  const month = start.toLocaleDateString(locale, { month: 'short' }).replace('.', '');
  return (
    <span aria-hidden="true" className={cn('flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-card text-center', past ? 'bg-chip text-meta' : 'bg-navy text-white')}>
      <span className="text-[11px] font-semibold uppercase tracking-wide">{month}</span>
      <span className={cn('font-signage font-semibold leading-tight tabular-nums', day.length > 2 ? 'text-lg' : 'text-2xl')}>{day}</span>
    </span>
  );
}

/** Where a row's title leads: the event page, or the event's own page (the World Yachting Summit). */
function eventHref(p: Participation): string | null {
  if (p.event_id) return `/events/${p.event_id}`;
  if (p.engine === 'sm26') return RENDEZVOUS_2026_PATH;
  if (p.slug && GUEST_LIST_PAGES[p.slug]) return GUEST_LIST_PAGES[p.slug];
  return null;
}

export function MyParticipations({ hideSm26 = false, onUnavailable }: {
  /** The Smart Marina 2026 mark is shown above the list already (EventsPanel). */
  hideSm26?: boolean;
  /** The list cannot be read (the server function is missing): the old list takes over. */
  onUnavailable?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const uid = user?.id;
  const locale = regLocale(i18n.language);
  const [rows, setRows] = useState<Participation[]>([]);
  const [links, setLinks] = useState<Map<string, { meeting: string | null; replay: string | null }>>(new Map());
  const [extras, setExtras] = useState<Map<string, EventExtra>>(new Map());
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [version, setVersion] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const firstLoad = useRef(true);

  // Keyed on the id, never on the user object (a tab refocus hands a new one).
  useEffect(() => {
    if (!uid) return;
    let alive = true;
    if (firstLoad.current) setLoading(true);
    (async () => {
      const [{ rows: list, failed: bad }, access] = await Promise.all([fetchMyParticipations(), fetchMyEventAccess(null)]);
      if (!alive) return;
      if (bad && firstLoad.current) {
        setFailed(true);
        setLoading(false);
        onUnavailable?.();
        return;
      }
      const ids = [...new Set(list.map((r) => r.event_id).filter((x): x is string => !!x))];
      let extraMap = new Map<string, EventExtra>();
      if (ids.length > 0) {
        const { data } = await supabase.from('events').select('id, description, replay_url, is_full_day').in('id', ids);
        if (!alive) return;
        extraMap = new Map(((data ?? []) as EventExtra[]).map((e) => [e.id, e]));
      }
      setRows(list);
      setLinks(new Map(access.filter((a) => a.is_registered).map((a) => [a.event_id, { meeting: a.meeting_url, replay: a.replay_url ?? null }])));
      setExtras(extraMap);
      setFailed(false);
      firstLoad.current = false;
      setLoading(false);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);

  const cancel = async (p: Participation) => {
    setBusyId(p.registration_id);
    if (p.engine === 'legacy') {
      // An old member registration (event_registrations): removed as the old My events did
      // (the database lets a member remove their own row only).
      const { error } = await supabase.from('event_registrations').delete().eq('id', p.registration_id);
      setBusyId(null);
      if (error) {
        toast({ title: t('accountArea.events.unregisterFailed', 'Failed to unregister'), description: t('common.loadFailedBody', 'The connection may be slow or interrupted. Please try again.'), variant: 'destructive' });
      } else {
        toast({ title: t('accountArea.events.unregistered', 'Unregistered from event') });
        reload();
      }
      return;
    }
    const res = await cancelRegistration({ registration_id: p.registration_id });
    setBusyId(null);
    if (res.ok) {
      toast({ title: t('reg.toast.cancelled', 'Your registration is cancelled.') });
      reload();
    } else {
      toast({ title: t('reg.my.cancelFailed', 'The registration could not be cancelled'), description: registrationErrorText(t, res), variant: 'destructive' });
    }
  };

  // Smart Marina 2026: the mark above says it (hideSm26); a cancelled or refused SM26 registration
  // is history, not a participation.
  const shown = rows.filter((r) => !(r.engine === 'sm26' && (hideSm26 || r.status_display === 'cancelled' || r.status_display === 'not_accepted')));
  const upcoming = shown.filter((r) => !r.is_past).sort((a, b) => (a.starts_at ?? '9999').localeCompare(b.starts_at ?? '9999'));
  const past = shown.filter((r) => r.is_past).sort((a, b) => (b.starts_at ?? '').localeCompare(a.starts_at ?? ''));

  const browse = (
    <Button asChild variant="outline" className={cn(BTN_OUTLINE, 'gap-2')}>
      <Link to="/events">
        <CalendarDays className="h-4 w-4" aria-hidden="true" />
        {t('accountArea.events.browse', 'Browse events')}
      </Link>
    </Button>
  );

  if (loading) return <MemberPanel><RowSkeleton rows={2} /></MemberPanel>;

  if (failed) {
    return (
      <MemberPanel>
        <MemberEmpty
          icon={RefreshCw}
          title={t('reg.my.loadFailed', 'Your events could not be loaded.')}
          body={t('common.loadFailedBody', 'The connection may be slow or interrupted. Please try again.')}
          action={<Button variant="ctaNavy" size="sm" arrow={false} onClick={reload}>{t('common.retry', 'Try again')}</Button>}
        />
      </MemberPanel>
    );
  }

  const hint = (
    <div className="space-y-3 rounded-card border border-rule bg-white p-4 sm:p-5">
      <p className="flex items-start gap-2 text-[13px] leading-5 text-meta">
        <Inbox className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{t('reg.my.missingHint', 'Registered with another address, or without an account? Open the link in your confirmation e-mail and choose "Add this to my account".')}</span>
      </p>
      {user?.email && <ResendLinksForm compact lockedEmail={user.email} idPrefix="my-resend" />}
    </div>
  );

  if (shown.length === 0) {
    return (
      <div className="space-y-3">
        <MemberPanel>
          <MemberEmpty
            icon={CalendarDays}
            title={t('accountArea.events.emptyTitle', 'No registrations yet.')}
            body={t('accountArea.events.emptyBody', 'Browse upcoming events and register to attend.')}
            action={<Button asChild variant="ctaNavy" size="sm"><Link to="/events">{t('accountArea.events.browse', 'Browse events')}</Link></Button>}
          />
        </MemberPanel>
        {hint}
      </div>
    );
  }

  const card = (p: Participation, isPast: boolean) => (
    <ParticipationCard
      key={`${p.engine}:${p.registration_id}`}
      p={p}
      past={isPast}
      locale={locale}
      link={p.event_id ? links.get(p.event_id) ?? null : null}
      extra={p.event_id ? extras.get(p.event_id) ?? null : null}
      busy={busyId === p.registration_id}
      onCancel={() => void cancel(p)}
    />
  );

  return (
    <div className="space-y-6">
      <p className="sr-only" aria-live="polite">
        {t('accountArea.events.summary', { upcoming: upcoming.length, past: past.length, defaultValue: '{{upcoming}} upcoming, {{past}} past' })}
      </p>
      <MemberPanel title={t('accountArea.events.upcomingTitle', 'Upcoming')} count={upcoming.length} actions={browse}>
        {upcoming.length === 0 ? (
          <div className="flex flex-wrap items-center gap-x-2 px-5 py-6 text-sm text-meta">
            <span>{t('accountArea.events.noUpcoming', 'You have no upcoming events.')}</span>
            <Link to="/events" className="inline-flex min-h-11 items-center font-medium text-navy underline-offset-2 hover:underline">
              {t('accountArea.events.browse', 'Browse events')}
            </Link>
          </div>
        ) : (
          <ul className="divide-y divide-rule">{upcoming.map((p) => card(p, false))}</ul>
        )}
      </MemberPanel>
      {past.length > 0 && (
        <MemberPanel title={t('accountArea.events.pastTitle', 'Past events')} count={past.length}>
          <ul className="divide-y divide-rule">{past.map((p) => card(p, true))}</ul>
        </MemberPanel>
      )}
      {hint}
    </div>
  );
}

function ParticipationCard({
  p,
  past,
  locale,
  link,
  extra,
  busy,
  onCancel,
}: {
  p: Participation;
  past: boolean;
  locale: string;
  link: { meeting: string | null; replay: string | null } | null;
  extra: EventExtra | null;
  busy: boolean;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const now = Date.now();
  const isWebinar = p.kind === 'webinar';
  const live = !!p.starts_at && new Date(p.starts_at).getTime() <= now && !!p.ends_at && now < new Date(p.ends_at).getTime();
  // As the database says it (an SM26 submission never finished reads "Event ended" there already).
  const display = p.status_display;
  const confirmed = display === 'confirmed';
  const closed = display === 'cancelled' || display === 'declined' || display === 'not_accepted';
  const href = eventHref(p);
  const title = p.title ?? t('accountArea.events.untitled', 'Event details unavailable');
  const meeting = !past && isWebinar && confirmed ? link?.meeting ?? null : null;
  const replay = past ? link?.replay ?? extra?.replay_url ?? null : null;
  const calendar: CalendarEventInput | null = !past && confirmed && p.starts_at ? {
    title, description: extra?.description ?? null, date_time: p.starts_at, end_date_time: p.ends_at, location: p.location, url: meeting,
  } : null;
  const v1 = p.engine === 'guest_list_v1';
  const v2 = p.engine === 'core_v2';
  // The personal page of the World Yachting Summit: only for a proven address (the database decides).
  const personal = v1 && p.status_url ? p.status_url : null;
  // A new registration linked to the account: its own page, managed with the session.
  const mine = v2 && p.linked;
  // An old member registration of the account, still ahead and not paid for: unregistering stays
  // possible here, as in the old My events (a paid one needs a refund: the M3 team).
  const legacyCancel = p.engine === 'legacy' && p.linked && !past && p.status !== 'paid';
  const role = roleText(p, (key, fallback) => t(key, fallback));

  return (
    <li className={cn('p-4 sm:p-5', (display === 'needs_info' || display === 'invited' || display === 'payment_due') && !past && 'bg-amber-50/40')}>
      <div className="flex gap-4">
        <DateTile iso={p.starts_at} endIso={p.ends_at} locale={locale} past={past} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusPill tone="neutral" icon={isWebinar ? Video : MapPin}>
              {isWebinar ? t('accountArea.events.typeWebinar', 'Webinar') : t('accountArea.events.typeOnSite', 'On-site')}
            </StatusPill>
            {live && confirmed && (
              <span className="inline-flex items-center gap-1 rounded-pill bg-red-600 px-2.5 py-0.5 text-[12px] font-semibold leading-5 text-white">
                <Radio className="h-3.5 w-3.5" aria-hidden="true" />{t('accountArea.events.live', 'Happening now')}
              </span>
            )}
            <RegStatusPill display={display} status={p.status} />
            <PaymentPill payment={p.payment_display} />
          </div>
          <h4 className="group mt-1.5 text-[17px] font-semibold leading-6 text-navy [overflow-wrap:anywhere]">
            {href ? (
              <Link to={href} className={cn('rounded', FOCUS)}><span className="card-ul">{title}</span></Link>
            ) : title}
          </h4>
          <ul className="mt-1.5 space-y-1 text-sm text-meta">
            <li className="flex items-start gap-1.5">
              <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{whenLine(p.starts_at, p.ends_at, locale, t('accountArea.events.dateTbc', 'Date to be announced'), !!extra?.is_full_day)}</span>
            </li>
            <li className="flex items-start gap-1.5">
              {isWebinar ? <Video className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
              <span>{isWebinar ? t('accountArea.events.online', 'Online') : (p.location || t('accountArea.events.venueTbc', 'Venue to be confirmed'))}</span>
            </li>
            {role && (
              <li className="flex items-start gap-1.5">
                <Ticket className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>{t('accountArea.events.registeredAs', { type: role, defaultValue: 'Registered as {{type}}' })}</span>
              </li>
            )}
          </ul>
        </div>
      </div>

      <div className="mt-4 space-y-3 sm:pl-20">
        {meeting && (
          <Button asChild variant="cta" size="sm" className="w-full justify-between sm:w-auto">
            <a href={meeting} target="_blank" rel="noopener noreferrer">
              {live ? t('accountArea.events.joinNow', 'Join now') : t('accountArea.events.joinWebinar', 'Join the webinar')}
            </a>
          </Button>
        )}
        {!past && isWebinar && confirmed && !meeting && (
          <p className="text-xs text-meta">{t('accountArea.events.joinLater', 'The joining link will appear here before the webinar starts.')}</p>
        )}
        {calendar && !live && (
          <div className="space-y-1.5">
            <p className="text-meta-caps">{t('events.addToCalendar', 'Add to calendar')}</p>
            <AddToCalendarButtons event={calendar} />
          </div>
        )}
        {replay && (
          <Button asChild variant="ctaNavy" size="sm" className="w-full justify-between sm:w-auto">
            <a href={replay} target="_blank" rel="noopener noreferrer">{t('events.watchReplay', 'Watch the replay')}</a>
          </Button>
        )}

        {/* What is waiting for the member, in words. */}
        {!past && v2 && (display === 'needs_info' || display === 'invited') && (
          <p className="flex items-start gap-2 text-sm leading-5 text-ink">
            <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
            {display === 'invited'
              ? t('reg.my.answerInvite', 'You are invited: the M3 team will contact you to confirm.')
              : t('reg.my.answerInfo', 'M3 needs a detail from you: open your registration to answer.')}
          </p>
        )}
        {!past && v1 && !personal && !closed && (
          <p className="flex items-start gap-2 text-xs leading-5 text-meta">
            <Link2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {t('reg.my.v1Link', 'Your personal invitation page is in the e-mails we sent you.')}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {personal && (
            <Button asChild variant="outline" size="sm" className={BTN_OUTLINE}>
              <Link to={personal}>
                {t('reg.my.openInvitation', 'Open my invitation')}
                <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
          )}
          {mine && (
            <Button asChild variant="outline" size="sm" className={BTN_OUTLINE}>
              <Link to={statusPagePath(p.registration_id)}>
                {!past && !closed ? t('reg.my.manage', 'See or change') : t('reg.block.viewMine', 'See my registration')}
                <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
          )}
          {href && !personal && p.engine !== 'sm26' && (
            <Button asChild variant="outline" size="sm" className={BTN_OUTLINE}>
              <Link to={href}>
                {t('accountArea.events.eventPage', 'Event page')}
                <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
          )}
        </div>
        {v2 && !p.linked && !past && !closed && (
          <p className="flex items-start gap-2 text-xs leading-5 text-meta">
            <Link2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {t('reg.my.v2Link', 'Made before you had an account: change or cancel it from the link in your confirmation e-mail.')}
          </p>
        )}

        {((mine && p.can_cancel) || legacyCancel) && !past && !closed && (
          <div className="max-w-sm">
          <ConfirmInline
            label={display === 'under_review' || display === 'needs_info' ? t('reg.block.cancelRequest', 'Cancel my request')
              : display === 'waitlisted' ? t('reg.block.leaveWaitlist', 'Leave the waiting list') : t('accountArea.events.unregister', 'Unregister')}
            question={t('reg.block.cancelQuestion', 'Cancel your registration for this event?')}
            confirmLabel={t('reg.block.cancelYes', 'Yes, cancel')}
            keepLabel={t('reg.block.cancelKeep', 'No, keep it')}
            onConfirm={onCancel}
            busy={busy}
            icon={X}
            buttonClassName="justify-start px-3 sm:w-auto"
          />
          </div>
        )}
      </div>
    </li>
  );
}
