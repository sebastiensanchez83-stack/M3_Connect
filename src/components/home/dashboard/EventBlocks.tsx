import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight, CalendarDays, CheckCircle2, MapPin, Video } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CardShell } from '@/components/brand/CardShell';
import { Eyebrow } from '@/components/brand/Eyebrow';
import { UnderlineLink } from '@/components/brand/UnderlineLink';
import { AddToCalendarButtons } from '@/components/events/AddToCalendarButtons';
import { CoverImage } from '@/components/ui/CoverImage';
import { FOCUS, StatusPill } from '@/components/member/MemberUI';
import { WYS26_PATH } from '@/components/events/WysInvitationCard';
import { useHomeAgenda } from '@/components/home/useHomeAgenda';
import { eventCover } from '@/lib/siteMedia';
import { cn, type CalendarEventInput } from '@/lib/utils';
import { DEFAULT_DURATION_MS, type DashEvent } from './useDashboardData';

/** Small date tile: day and month, in the signage face. */
function DateTile({ start, lang }: { start: Date; lang: string }) {
  return (
    <div className="flex shrink-0 flex-col items-center justify-center rounded-field bg-white px-3 py-2 text-center shadow-hover">
      <span className="font-signage text-[26px] font-semibold leading-none tabular-nums text-navy">{start.getDate()}</span>
      <span className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-meta">
        {start.toLocaleDateString(lang, { month: 'short' })}
      </span>
    </div>
  );
}

/**
 * The next event I'm registered for, with everything needed to actually be
 * there: a countdown, the calendar buttons and — for a webinar — the joining
 * link, shown to registered attendees exactly as the event page does.
 */
export function NextEventCard({ event, lang, onOpenEvents }: { event: DashEvent; lang: string; onOpenEvents: () => void }) {
  const { t } = useTranslation();
  // Its own clock: a tick re-renders this card only, never the page.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const start = new Date(event.date_time);
  const end = event.end_date_time ? new Date(event.end_date_time) : null;
  const startMs = start.getTime();
  const endMs = end ? end.getTime() : startMs + DEFAULT_DURATION_MS;
  const hasEnded = endMs <= now;
  const isLive = startMs <= now && !hasEnded;
  const isWebinar = event.event_type === 'webinar';
  const multiDay = !!end && end.toDateString() !== start.toDateString();

  const fmtDay = (d: Date) => d.toLocaleDateString(lang, { weekday: 'short', day: 'numeric', month: 'short' });
  const fmtTime = (d: Date) => d.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' });
  const when = multiDay && end
    ? `${fmtDay(start)} – ${fmtDay(end)}`
    : `${fmtDay(start)} · ${event.is_full_day ? t('dashboard.allDay', 'All day') : end ? `${fmtTime(start)}–${fmtTime(end)}` : fmtTime(start)}`;
  const where = isWebinar ? t('dashboard.webinarOnline', 'Webinar · online') : (event.location || t('dashboard.onSite'));

  // Countdown parts: days only while there are any, minutes always.
  const left = Math.max(0, startMs - now);
  const days = Math.floor(left / 86_400_000);
  const hours = Math.floor((left % 86_400_000) / 3_600_000);
  const minutes = Math.floor((left % 3_600_000) / 60_000);
  const parts = [
    ...(days > 0 ? [{ key: 'd', value: days, label: t('dashboard.unitDays', { count: days, defaultValue_one: 'day', defaultValue_other: 'days' }) }] : []),
    { key: 'h', value: hours, label: t('dashboard.unitHours', { count: hours, defaultValue_one: 'hour', defaultValue_other: 'hours' }) },
    { key: 'm', value: minutes, label: t('dashboard.unitMinutes', { count: minutes, defaultValue_one: 'min', defaultValue_other: 'min' }) },
  ];
  const startsIn = t('dashboard.startsIn', 'Starts in');
  const cover = eventCover(event);

  const calendarEvent: CalendarEventInput = {
    title: event.title,
    description: event.description,
    date_time: event.date_time,
    end_date_time: event.end_date_time,
    location: event.location,
    url: event.meeting_url,
  };

  return (
    <CardShell as="section" className="h-full">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-rule px-5 py-4">
        <Eyebrow as="h3">{t('dashboard.nextEventTitle')}</Eyebrow>
        <UnderlineLink onClick={onOpenEvents} className="!text-[14px] !leading-5">
          {t('memberHome.sections.registrations', 'My events')}
        </UnderlineLink>
      </header>

      <div className="md:grid md:flex-1 md:grid-cols-5">
        {/* The picture repeats the title link below, so it stays out of the tab order. */}
        <Link to={`/events/${event.id}`} tabIndex={-1} aria-hidden="true" className="block md:col-span-2">
          <CoverImage
            src={cover?.src ?? null}
            focusY={cover?.focusY}
            alt=""
            seed={event.id}
            icon={isWebinar ? Video : CalendarDays}
            aspect="fill"
            tone="sea"
            className="h-40 md:h-full md:min-h-[15rem]"
          >
            <div className="absolute left-3 top-3"><DateTile start={start} lang={lang} /></div>
            <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-pill bg-emerald-700 px-2.5 py-0.5 text-[12px] font-semibold text-white">
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> {t('dashboard.registered')}
            </span>
          </CoverImage>
        </Link>

        <div className="space-y-4 p-5 md:col-span-3">
          <div className="group">
            <h4 className="text-card-title text-navy [overflow-wrap:anywhere]">
              <Link to={`/events/${event.id}`} className={cn('rounded', FOCUS)}>
                <span className="card-ul">{event.title}</span>
                <ArrowRight className="card-arrow" strokeWidth={2.25} aria-hidden="true" />
              </Link>
            </h4>
            <p className="mt-2 flex items-center gap-2 text-[15px] leading-6 text-meta">
              <CalendarDays className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{when}</span>
            </p>
            <p className="mt-1 flex items-center gap-2 text-[15px] leading-6 text-meta">
              {isWebinar ? <Video className="h-4 w-4 shrink-0" aria-hidden="true" /> : <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />}
              <span className="truncate">{where}</span>
            </p>
          </div>

          {isLive ? (
            <p className="inline-flex items-center gap-2 rounded-pill bg-red-50 px-3 py-1 text-[14px] font-semibold text-red-700 ring-1 ring-inset ring-red-200">
              <span className="relative flex h-2 w-2" aria-hidden="true">
                <span className="absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75 motion-safe:animate-ping" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-red-600" />
              </span>
              {t('dashboard.happeningNow', 'Happening now')}
            </p>
          ) : !hasEnded ? (
            <div>
              <p className="text-meta-caps" aria-hidden="true">{startsIn}</p>
              <div className="mt-2 flex gap-2" aria-hidden="true">
                {parts.map((p) => (
                  <div key={p.key} className="min-w-[4.5rem] rounded-field bg-navy px-3 py-2 text-center text-white">
                    <span className="block font-signage text-[28px] font-semibold leading-none tabular-nums">{p.value}</span>
                    <span className="mt-1 block text-[11px] font-semibold uppercase tracking-wide text-white/80">{p.label}</span>
                  </div>
                ))}
              </div>
              <p className="sr-only">{`${startsIn} ${parts.map((p) => `${p.value} ${p.label}`).join(', ')}`}</p>
            </div>
          ) : null}

          {/* Webinar: registered attendees get the joining link, as on the event page. */}
          {isWebinar && !hasEnded && (
            event.meeting_url ? (
              <Button asChild variant="cta" size="sm" className="w-full justify-between sm:w-auto">
                <a href={event.meeting_url} target="_blank" rel="noopener noreferrer">
                  {t('dashboard.joinWebinar', 'Join the webinar')}
                  <span className="sr-only"> {t('dashboard.opensNewTab', '(opens in a new tab)')}</span>
                </a>
              </Button>
            ) : (
              <p className="flex items-start gap-2 rounded-field bg-foam p-3 text-[14px] leading-5 text-navy">
                <Video className="mt-0.5 h-4 w-4 shrink-0 text-teal" aria-hidden="true" />
                {t('dashboard.joinLater', 'The joining link will appear here before the webinar starts.')}
              </p>
            )
          )}

          {!hasEnded && (
            <div>
              <p className="text-meta-caps mb-2">{t('dashboard.addToCalendar', 'Add to your calendar')}</p>
              <AddToCalendarButtons event={calendarEvent} />
            </div>
          )}
        </div>
      </div>
    </CardShell>
  );
}

/**
 * What is coming up, from the same source as the public home page's agenda
 * (useHomeAgenda): the next published events and the World Yachting Summit
 * (Dubai, 27 Nov 2026, by invitation) while it is ahead — it runs on the guest
 * list, not in the events table, so a list read from that table alone said
 * "no upcoming event" under a home page announcing it.
 */
export function ComingUpList({ registeredIds }: { registeredIds: Set<string> }) {
  const { t } = useTranslation();
  const { entries, loading } = useHomeAgenda(8);
  // The agenda closes on the Rendezvous' finished edition: not "coming up".
  const ahead = entries.filter((e) => e.id !== 'rendezvous-6');
  // The next three, and the World Yachting Summit always among them while it is ahead.
  const wysEntry = ahead.find((e) => e.href === WYS26_PATH);
  let upcoming = ahead.slice(0, 3);
  if (wysEntry && !upcoming.includes(wysEntry)) upcoming = [...upcoming.slice(0, 2), wysEntry];

  if (loading) {
    return (
      <ul className="space-y-2" aria-hidden="true">
        {[0, 1, 2].map((i) => <li key={i} className="h-12 animate-pulse rounded-field bg-chip motion-reduce:animate-none" />)}
      </ul>
    );
  }
  if (upcoming.length === 0) {
    return <p className="py-2 text-meta">{t('dashboard.noEvents')}</p>;
  }
  return (
    <ul className="space-y-1">
      {upcoming.map((e) => {
        const wys = e.href === WYS26_PATH;
        const registered = e.id.startsWith('event-') && registeredIds.has(e.id.slice('event-'.length));
        return (
          <li key={e.id} className="flex flex-col gap-2 rounded-field py-1.5 sm:flex-row sm:items-center">
            <Link to={e.href} className="group flex min-w-0 flex-1 items-center gap-3 rounded-field focus:outline-none focus-visible:shadow-focus">
              <span className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-field bg-chip text-center" aria-hidden="true">
                <span className="font-signage text-[19px] font-semibold leading-none tabular-nums text-navy">{e.day}</span>
                <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-meta">{e.month}</span>
              </span>
              <span className="min-w-0">
                <span className="sr-only">{e.spoken}: </span>
                <span className="block text-[14px] font-semibold leading-5 text-navy [overflow-wrap:anywhere]"><span className="card-ul">{e.title}</span></span>
                <span className="block text-[12px] leading-4 text-meta">{e.sub}</span>
              </span>
            </Link>
            {wys ? (
              <Button asChild variant="ctaNavy" size="sm" arrow={false} className="shrink-0 self-start sm:self-center">
                <Link to={WYS26_PATH}>{t('homePage.events.wysRequest', 'Request an invitation')}</Link>
              </Button>
            ) : registered ? (
              <StatusPill tone="success" icon={CheckCircle2} className="self-start sm:self-center">{t('dashboard.registered')}</StatusPill>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

