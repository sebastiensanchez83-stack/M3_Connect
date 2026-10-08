import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { LucideIcon } from 'lucide-react';
import {
  AlertCircle, ArrowRight, CalendarClock, CalendarDays, CheckCircle2, Clock, MapPin, Radio, Ticket, Video, X, XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AddToCalendarButtons } from '@/components/events/AddToCalendarButtons';
import { BTN, BTN_OUTLINE, FOCUS, MemberEmpty, MemberPanel, RowSkeleton, StatusPill, type PillTone } from '@/components/member/MemberUI';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { cn, type CalendarEventInput } from '@/lib/utils';
import { humanize, uiLocale } from './format';

/**
 * The member's own participation: what is coming (with the calendar and, for a
 * webinar, the joining link) and what is over (with the replay), payments
 * included. Moved from the old /account?tab=registrations, reads and writes
 * unchanged. The Smart Marina 2026 participation is no longer managed here: the
 * event is over, the dashboard only marks it (SM26TookPart).
 */

interface RegisteredEvent {
  id: string;
  title: string;
  description: string | null;
  date_time: string | null;
  end_date_time: string | null;
  is_full_day: boolean | null;
  location: string | null;
  event_type: string | null;
  replay_url: string | null;
  meeting_url: string | null;
  published: boolean | null;
}

interface EventRegistration {
  id: string;
  event_id: string;
  created_at: string;
  payment_status: string;
  registration_type: string;
  amount_due_cents: number | null;
  events: RegisteredEvent | null;
}

const REGISTRATION_TYPE_LABELS: Record<string, { key: string; fallback: string }> = {
  visitor: { key: 'accountArea.events.regType.visitor', fallback: 'Visitor' },
  sponsor_included: { key: 'accountArea.events.regType.sponsor_included', fallback: 'Sponsor seat' },
  member_discount: { key: 'accountArea.events.regType.member_discount', fallback: 'Member rate' },
  package: { key: 'accountArea.events.regType.package', fallback: 'Package' },
  marina_package: { key: 'accountArea.events.regType.marina_package', fallback: 'Marina package' },
  invitation_request: { key: 'accountArea.events.regType.invitation_request', fallback: 'Invitation request' },
  exhibitor: { key: 'accountArea.events.regType.exhibitor', fallback: 'Exhibitor' },
};

/** As the calendar links assume: an event without an end time lasts an hour. */
const DEFAULT_DURATION_MS = 60 * 60 * 1000;

/** When an event starts and ends, in ms. A full day without an end runs 24 h. */
function eventWindow(e: Pick<RegisteredEvent, 'date_time' | 'end_date_time' | 'is_full_day'>): { start: number; end: number } | null {
  if (!e.date_time) return null;
  const start = new Date(e.date_time).getTime();
  const end = e.end_date_time
    ? new Date(e.end_date_time).getTime()
    : start + (e.is_full_day ? 24 * 3600 * 1000 : DEFAULT_DURATION_MS);
  return { start, end };
}

export function MyEvents() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const uid = user?.id;
  const locale = uiLocale(i18n.language);
  const [registrations, setRegistrations] = useState<EventRegistration[]>([]);
  const [loading, setLoading] = useState(true);
  const firstLoad = useRef(true);

  // Keyed on the id, never on the user object (a tab refocus hands a new one).
  useEffect(() => {
    if (!uid) return;
    let alive = true;
    if (firstLoad.current) setLoading(true);
    (async () => {
      try {
        const { data } = await supabase
          .from('event_registrations')
          .select('id, event_id, created_at, payment_status, registration_type, amount_due_cents, events(id, title, description, date_time, end_date_time, is_full_day, location, event_type, replay_url, meeting_url, published)')
          .eq('user_id', uid)
          .order('created_at', { ascending: false });
        if (alive && data) setRegistrations(data as unknown as EventRegistration[]);
      } catch (err) {
        if (import.meta.env.DEV) console.error('My events failed:', err);
      } finally {
        if (alive) {
          firstLoad.current = false;
          setLoading(false);
        }
      }
    })();
    return () => { alive = false; };
  }, [uid]);

  // Self-cancel for everything except registrations that were actually paid
  // for (those need a refund flow) — the condition lives on the card.
  const handleUnregister = async (reg: EventRegistration) => {
    if (!confirm(t('accountArea.events.unregisterConfirm', 'Are you sure you want to unregister from this event?'))) return;
    const { error } = await supabase.from('event_registrations').delete().eq('id', reg.id);
    if (error) {
      toast({ title: t('accountArea.events.unregisterFailed', 'Failed to unregister'), description: error.message, variant: 'destructive' });
    } else {
      toast({ title: t('accountArea.events.unregistered', 'Unregistered from event') });
      setRegistrations((prev) => prev.filter((r) => r.id !== reg.id));
    }
  };

  const now = Date.now();
  const FAR = 8.64e15;
  const upcoming: EventRegistration[] = [];
  const past: EventRegistration[] = [];
  for (const reg of registrations) {
    const w = reg.events ? eventWindow(reg.events) : null;
    // No date (or the event can't be read) stays with "upcoming": it isn't over.
    if (w && w.end < now) past.push(reg); else upcoming.push(reg);
  }
  const startOf = (r: EventRegistration) => (r.events?.date_time ? new Date(r.events.date_time).getTime() : FAR);
  upcoming.sort((a, b) => startOf(a) - startOf(b));
  past.sort((a, b) => startOf(b) - startOf(a));

  const browse = (
    <Button asChild variant="outline" className={cn(BTN_OUTLINE, 'gap-2')}>
      <Link to="/events">
        <CalendarDays className="h-4 w-4" aria-hidden="true" />
        {t('accountArea.events.browse', 'Browse events')}
      </Link>
    </Button>
  );

  return (
    <div className="space-y-6">
      <p className="sr-only" aria-live="polite">
        {loading ? '' : t('accountArea.events.summary', {
          upcoming: upcoming.length,
          past: past.length,
          defaultValue: '{{upcoming}} upcoming, {{past}} past',
        })}
      </p>

      {loading ? (
        <MemberPanel><RowSkeleton rows={2} /></MemberPanel>
      ) : registrations.length === 0 ? (
        <MemberPanel>
          <MemberEmpty
            icon={CalendarDays}
            title={t('accountArea.events.emptyTitle', 'No registrations yet.')}
            body={t('accountArea.events.emptyBody', 'Browse upcoming events and register to attend.')}
            action={(
              <Button asChild variant="ctaNavy" size="sm">
                <Link to="/events">{t('accountArea.events.browse', 'Browse events')}</Link>
              </Button>
            )}
          />
        </MemberPanel>
      ) : (
        <>
          <MemberPanel title={t('accountArea.events.upcomingTitle', 'Upcoming')} count={upcoming.length} actions={browse}>
            {upcoming.length === 0 ? (
              <div className="flex flex-wrap items-center gap-x-2 px-5 py-6 text-sm text-meta">
                <span>{t('accountArea.events.noUpcoming', 'You have no upcoming events.')}</span>
                <Link to="/events" className="inline-flex min-h-10 items-center font-medium text-navy underline-offset-2 hover:underline">
                  {t('accountArea.events.browse', 'Browse events')}
                </Link>
              </div>
            ) : (
              <ul className="divide-y divide-rule">
                {upcoming.map((reg) => (
                  <RegistrationCard key={reg.id} reg={reg} past={false} now={now} locale={locale} onUnregister={handleUnregister} />
                ))}
              </ul>
            )}
          </MemberPanel>

          {past.length > 0 && (
            <MemberPanel title={t('accountArea.events.pastTitle', 'Past events')} count={past.length}>
              <ul className="divide-y divide-rule">
                {past.map((reg) => (
                  <RegistrationCard key={reg.id} reg={reg} past now={now} locale={locale} onUnregister={handleUnregister} />
                ))}
              </ul>
            </MemberPanel>
          )}
        </>
      )}
    </div>
  );
}

function formatWhen(ev: RegisteredEvent, locale: string, allDay: string, tbc: string): string {
  if (!ev.date_time) return tbc;
  const start = new Date(ev.date_time);
  const end = ev.end_date_time ? new Date(ev.end_date_time) : null;
  const multiDay = !!end && end.toDateString() !== start.toDateString();
  const day = (d: Date) => d.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const time = (d: Date, zone = false) => d.toLocaleTimeString(locale, {
    hour: '2-digit', minute: '2-digit', ...(zone ? { timeZoneName: 'short' as const } : {}),
  });
  if (multiDay && end) return `${day(start)} – ${day(end)}${ev.is_full_day ? '' : ` · ${time(start, true)}`}`;
  // A full-day event has no meaningful start time — "00:00" would read as midnight.
  if (ev.is_full_day) return `${day(start)} · ${allDay}`;
  return end ? `${day(start)} · ${time(start)} – ${time(end, true)}` : `${day(start)} · ${time(start, true)}`;
}

/** The date as a tile: navy while the event is ahead, grey once it is over. */
function DateChip({ ev, locale, past }: { ev: RegisteredEvent | null; locale: string; past: boolean }) {
  if (!ev?.date_time) {
    return (
      <span aria-hidden="true" className="flex h-16 w-16 shrink-0 items-center justify-center rounded-card bg-chip text-meta">
        <CalendarClock className="h-6 w-6" />
      </span>
    );
  }
  const start = new Date(ev.date_time);
  const end = ev.end_date_time ? new Date(ev.end_date_time) : null;
  const multi = !!end && end.toDateString() !== start.toDateString();
  const sameMonth = !!end && end.getMonth() === start.getMonth() && end.getFullYear() === start.getFullYear();
  const day = multi && sameMonth && end ? `${start.getDate()}–${end.getDate()}` : String(start.getDate());
  const month = start.toLocaleDateString(locale, { month: 'short' }).replace('.', '');
  return (
    <span
      aria-hidden="true"
      className={cn('flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-card text-center', past ? 'bg-chip text-meta' : 'bg-navy text-white')}
    >
      <span className="text-[11px] font-semibold uppercase tracking-wide">{month}</span>
      <span className={cn('font-signage font-semibold leading-tight tabular-nums', day.length > 2 ? 'text-lg' : 'text-2xl')}>{day}</span>
    </span>
  );
}

function PaymentStatusPill({ status }: { status: string }) {
  const { t } = useTranslation();
  const map: Record<string, { label: string; tone: PillTone; icon: LucideIcon }> = {
    free: { label: t('accountArea.events.payment.free', 'Confirmed'), tone: 'success', icon: CheckCircle2 },
    paid: { label: t('accountArea.events.payment.paid', 'Confirmed · paid'), tone: 'success', icon: CheckCircle2 },
    pending_approval: { label: t('accountArea.events.payment.pending_approval', 'Pending approval'), tone: 'warning', icon: Clock },
    pending_payment: { label: t('accountArea.events.payment.pending_payment', 'Payment due'), tone: 'warning', icon: AlertCircle },
    rejected: { label: t('accountArea.events.payment.rejected', 'Declined'), tone: 'danger', icon: XCircle },
  };
  const s = map[status] ?? { label: humanize(status || ''), tone: 'neutral' as PillTone, icon: Ticket };
  if (!s.label) return null;
  return <StatusPill tone={s.tone} icon={s.icon}>{s.label}</StatusPill>;
}

function RegistrationCard({
  reg,
  past,
  now,
  locale,
  onUnregister,
}: {
  reg: EventRegistration;
  past: boolean;
  now: number;
  locale: string;
  onUnregister: (reg: EventRegistration) => void;
}) {
  const { t } = useTranslation();
  const ev = reg.events;
  const w = ev ? eventWindow(ev) : null;
  const live = !!w && w.start <= now && now <= w.end;
  const isWebinar = ev?.event_type === 'webinar';
  const declined = reg.payment_status === 'rejected';
  const needsPayment = reg.payment_status === 'pending_payment';
  // Same rule as the event page: a registered attendee sees the joining link
  // of a webinar that hasn't ended. (A declined registration is not one.)
  const joinUrl = !past && isWebinar && !declined ? ev?.meeting_url ?? null : null;
  const calendarEvent: CalendarEventInput | null = !past && !declined && ev?.date_time ? {
    title: ev.title,
    description: ev.description,
    date_time: ev.date_time,
    end_date_time: ev.end_date_time,
    location: ev.location,
    url: ev.meeting_url,
  } : null;

  const typeInfo = REGISTRATION_TYPE_LABELS[reg.registration_type];
  const typeLabel = typeInfo
    ? t(typeInfo.key, typeInfo.fallback)
    : reg.registration_type ? humanize(reg.registration_type) : t('accountArea.events.regType.standard', 'Standard');
  const amountDue = (reg.payment_status === 'pending_payment' || reg.payment_status === 'pending_approval') && (reg.amount_due_cents ?? 0) > 0
    ? new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format((reg.amount_due_cents ?? 0) / 100)
    : null;

  const title = ev?.title ?? t('accountArea.events.untitled', 'Event details unavailable');

  return (
    <li className={cn('p-4 sm:p-5', needsPayment && 'bg-amber-50/40')}>
      <div className="flex gap-4">
        <DateChip ev={ev} locale={locale} past={past} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {ev && (
              <StatusPill tone="neutral" icon={isWebinar ? Video : MapPin}>
                {isWebinar ? t('accountArea.events.typeWebinar', 'Webinar') : t('accountArea.events.typeOnSite', 'On-site')}
              </StatusPill>
            )}
            {live && (
              <span className="inline-flex items-center gap-1 rounded-pill bg-red-600 px-2.5 py-0.5 text-[12px] font-semibold leading-5 text-white">
                <Radio className="h-3.5 w-3.5" aria-hidden="true" />
                {t('accountArea.events.live', 'Happening now')}
              </span>
            )}
            <PaymentStatusPill status={reg.payment_status} />
          </div>
          <h4 className="group mt-1.5 text-[17px] font-semibold leading-6 text-navy">
            <Link to={`/events/${reg.event_id}`} className={cn('rounded', FOCUS)}>
              <span className="card-ul">{title}</span>
            </Link>
          </h4>
          <ul className="mt-1.5 space-y-1 text-sm text-meta">
            {ev && (
              <li className="flex items-start gap-1.5">
                <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>{formatWhen(ev, locale, t('accountArea.events.allDay', 'All day'), t('accountArea.events.dateTbc', 'Date to be announced'))}</span>
              </li>
            )}
            {ev && (
              <li className="flex items-start gap-1.5">
                {isWebinar
                  ? <Video className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  : <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
                <span>{isWebinar ? t('accountArea.events.online', 'Online') : (ev.location || t('accountArea.events.venueTbc', 'Venue to be confirmed'))}</span>
              </li>
            )}
            <li className="flex items-start gap-1.5">
              <Ticket className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>
                {t('accountArea.events.registeredAs', { type: typeLabel, defaultValue: 'Registered as {{type}}' })}
                {amountDue && ` · ${t('accountArea.events.amountDue', { amount: amountDue, defaultValue: '{{amount}} due' })}`}
              </span>
            </li>
          </ul>
        </div>
      </div>

      <div className="mt-4 space-y-3 sm:pl-20">
        {joinUrl && (
          <Button asChild variant="cta" size="sm" className="w-full justify-between sm:w-auto">
            <a href={joinUrl} target="_blank" rel="noopener noreferrer">
              {live ? t('accountArea.events.joinNow', 'Join now') : t('accountArea.events.joinWebinar', 'Join the webinar')}
            </a>
          </Button>
        )}
        {!past && isWebinar && !declined && !ev?.meeting_url && (
          <p className="text-xs text-meta">{t('accountArea.events.joinLater', 'The joining link will appear here before the webinar starts.')}</p>
        )}

        {calendarEvent && !live && (
          <div className="space-y-1.5">
            <p className="text-meta-caps">{t('events.addToCalendar', 'Add to calendar')}</p>
            <AddToCalendarButtons event={calendarEvent} />
          </div>
        )}

        {past && (ev?.replay_url ? (
          <Button asChild variant="ctaNavy" size="sm" className="w-full justify-between sm:w-auto">
            <a href={ev.replay_url} target="_blank" rel="noopener noreferrer">
              {t('events.watchReplay', 'Watch replay')}
            </a>
          </Button>
        ) : isWebinar ? (
          <p className="text-xs text-meta">{t('accountArea.events.noReplay', 'No replay has been published for this webinar yet.')}</p>
        ) : null)}

        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm" className={BTN_OUTLINE}>
            <Link to={`/events/${reg.event_id}`}>
              {t('accountArea.events.eventPage', 'Event page')}
              <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
          {reg.payment_status !== 'paid' && !past && (
            <Button
              variant="ghost"
              size="sm"
              className={cn(BTN, 'text-red-600 hover:bg-red-50 hover:text-red-700')}
              onClick={() => onUnregister(reg)}
            >
              <X className="mr-1 h-4 w-4" aria-hidden="true" />
              {t('accountArea.events.unregister', 'Unregister')}
            </Button>
          )}
        </div>
      </div>
    </li>
  );
}
