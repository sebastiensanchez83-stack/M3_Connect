import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarDays, CheckCircle2, Clock, Lock, MapPin, Play, Radio, Users, Video, type LucideIcon } from 'lucide-react';
import { CoverImage } from '@/components/ui/CoverImage';
import { CardMedia, CardShell, StretchedLink } from '@/components/brand/CardShell';
import { Eyebrow } from '@/components/brand/Eyebrow';
import { UnderlineLink } from '@/components/brand/UnderlineLink';
import { BathyPattern } from '@/components/motion/BathyPattern';
import { LineReveal } from '@/components/motion/LineReveal';
import { Reveal } from '@/components/motion/Reveal';
import { AddToCalendarButtons } from '@/components/events/AddToCalendarButtons';
import { eventCover, type SiteImage } from '@/lib/siteMedia';
import { getTheme, type ThemeKey } from '@/lib/themes';
import { cn } from '@/lib/utils';

/**
 * Pieces of the refonte events list (/events): the date block, the featured
 * "next event" panel on marine, the event card (the shared CardShell grammar:
 * lift 4 px, picture 1.05, gold title line and a small arrow, no round disc),
 * and the section heading. The page (EventsPage.tsx) owns the data and the
 * rules (access, registration, filters); these only draw.
 */

export interface ListEvent {
  id: string;
  title: string;
  description: string | null;
  date_time: string | null;
  end_date_time: string | null;
  location: string | null;
  access_level: string;
  event_type: 'webinar' | 'on_site';
  invitation_only: boolean;
  published: boolean;
  speakers: { name: string; title: string }[] | null;
  replay_url: string | null;
  meeting_url: string | null;
  image_url: string | null;
}

export type Phase = 'tbd' | 'upcoming' | 'live' | 'ended';
export type EventKind = ListEvent['event_type'];

export function kindIcon(kind: EventKind): LucideIcon {
  return kind === 'webinar' ? Video : CalendarDays;
}

/**
 * The picture of an event: its own cover, else the built-in photo, else the photo of
 * its first theme (it illustrates the topic), else null (CoverImage draws a gradient).
 */
export function coverFor(event: { id: string; image_url?: string | null }, themes: ThemeKey[]): SiteImage | null {
  const own = eventCover(event);
  if (own) return own;
  for (const k of themes) {
    const th = getTheme(k);
    if (th?.image) return { src: th.image, focusY: th.imageFocusY };
  }
  return null;
}

/** What a card needs from the page: the same texts and rules for every card. */
export interface EventViewProps {
  event: ListEvent;
  phase: Phase;
  registered: boolean;
  themes: ThemeKey[];
  themeLabel: (k: ThemeKey) => string;
  kindLabel: (k: EventKind) => string;
  whenText: (e: ListEvent) => string;
  whereText: (e: ListEvent) => string;
  accessLabel: (level: string) => string | null;
  locale: string;
  isModerator: boolean;
  /** The one thing to do with the event right now (register, join, replay…). */
  action: ReactNode;
  /** A compact calendar button, next to the action. */
  extra?: ReactNode;
}

/* ─── Date block ─────────────────────────────────────────────────── */

/**
 * The calendar block laid over a cover: month, day (or "20–21" over consecutive
 * days of one month) and, when asked, the year. White on the photo.
 */
export function DateBlock({ iso, endIso, locale, large = false, showYear = false, className }: {
  iso: string | null;
  endIso: string | null;
  locale: string;
  large?: boolean;
  showYear?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  if (!iso) {
    return (
      <div className={cn('rounded-field bg-white px-3 py-2 text-center', large && 'px-4 py-3', className)}>
        <span className="block text-[12px] font-semibold uppercase tracking-[0.08em] text-teal-text">{t('eventsPage.tbdShort', 'TBA')}</span>
      </div>
    );
  }
  const start = new Date(iso);
  const end = endIso ? new Date(endIso) : null;
  const sameMonthSpan = !!end && end.toDateString() !== start.toDateString()
    && end.getMonth() === start.getMonth() && end.getFullYear() === start.getFullYear();
  const day = sameMonthSpan ? `${start.getDate()}–${end!.getDate()}` : String(start.getDate());
  return (
    <div className={cn('min-w-[3.5rem] rounded-field bg-white px-2.5 py-1.5 text-center', large && 'min-w-[5rem] px-4 py-2.5', className)}>
      <span className={cn('block text-[11px] font-semibold uppercase leading-4 tracking-[0.08em] text-teal-text', large && 'text-[12px]')}>
        {start.toLocaleDateString(locale, { month: 'short' })}
      </span>
      <span className={cn('tabular block font-semibold leading-none text-navy', large ? 'mt-0.5 text-[34px] tracking-[-0.02em]' : 'text-[22px]')}>{day}</span>
      {showYear && <span className="tabular mt-1 block text-[11px] font-medium leading-none text-meta">{start.getFullYear()}</span>}
    </div>
  );
}

/* ─── Small marks ────────────────────────────────────────────────── */

/** Live and registered flags, top right of a cover. */
function StatusFlags({ phase, registered }: { phase: Phase; registered: boolean }) {
  const { t } = useTranslation();
  if (phase !== 'live' && !registered) return null;
  return (
    <div className="absolute right-3 top-3 flex flex-col items-end gap-1.5">
      {phase === 'live' && (
        <span className="inline-flex items-center gap-1.5 rounded-pill bg-red-600 px-3 py-1 text-[12px] font-semibold text-white">
          <Radio className="h-3 w-3" aria-hidden="true" />{t('eventsPage.liveNow', 'Live now')}
        </span>
      )}
      {registered && (
        <span className="inline-flex items-center gap-1.5 rounded-pill bg-white px-3 py-1 text-[12px] font-semibold text-navy">
          <CheckCircle2 className="h-3.5 w-3.5 text-teal" aria-hidden="true" />{t('eventsPage.registered', 'Registered')}
        </span>
      )}
    </div>
  );
}

const PILL = 'inline-flex items-center gap-1.5 rounded-pill bg-chip px-2.5 py-1 text-[12px] font-medium leading-none text-navy';

/** Format line over the title: a teal dot and the kind in capitals, as the eyebrows. */
function KindLine({ label }: { label: string }) {
  return <Eyebrow as="span" className="!text-[12px]">{label}</Eyebrow>;
}

/** Access restriction, invitation and draft flags. */
function Flags({ event, accessLabel, isModerator, tone = 'light' }: Pick<EventViewProps, 'event' | 'accessLabel' | 'isModerator'> & { tone?: 'light' | 'dark' }) {
  const { t } = useTranslation();
  const access = accessLabel(event.access_level);
  const cls = tone === 'dark' ? GLASS_CHIP : PILL;
  return (
    <>
      {access && <span className={cls}><Lock className="h-3 w-3" aria-hidden="true" />{access}</span>}
      {event.invitation_only && <span className={cls}><Lock className="h-3 w-3" aria-hidden="true" />{t('eventsPage.invitationOnly', 'By invitation')}</span>}
      {!event.published && isModerator && (
        <span className={cn(cls, 'border border-dashed', tone === 'dark' ? 'border-white/50 bg-transparent' : 'border-meta/50 bg-transparent')}>{t('eventsPage.draft', 'Draft')}</span>
      )}
    </>
  );
}

const GLASS_CHIP =
  'inline-flex h-8 items-center gap-2 rounded-pill border border-white/[.28] bg-white/[.14] px-3.5 text-[13px] font-semibold text-white backdrop-blur-[14px]';

function ThemePills({ themes, themeLabel, max, tone = 'light' }: { themes: ThemeKey[]; themeLabel: (k: ThemeKey) => string; max: number; tone?: 'light' | 'dark' }) {
  if (themes.length === 0) return null;
  const shown = themes.slice(0, max);
  const rest = themes.length - shown.length;
  const cls = tone === 'dark'
    ? 'inline-flex items-center gap-1.5 rounded-pill bg-white/[.12] px-2.5 py-1 text-[12px] font-medium leading-none text-white/90'
    : PILL;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {shown.map((k) => {
        const Icon = getTheme(k)!.icon;
        return (
          <li key={k} className={cls}>
            <Icon className="h-3 w-3" aria-hidden="true" />{themeLabel(k)}
          </li>
        );
      })}
      {rest > 0 && <li className={cn(cls, 'tabular')}>+{rest}</li>}
    </ul>
  );
}

function Speakers({ event, max, className, iconClass }: { event: ListEvent; max: number; className?: string; iconClass: string }) {
  const { t } = useTranslation();
  const speakers = (event.speakers ?? []).map((s) => s.name).filter(Boolean);
  if (speakers.length === 0) return null;
  return (
    <li className={cn('flex items-start gap-2', className)}>
      <Users className={cn('mt-0.5 h-4 w-4 shrink-0', iconClass)} aria-hidden="true" />
      <span className="line-clamp-2">
        <span className="sr-only">{t('events.speakers')}: </span>
        {speakers.slice(0, max).join(', ')}
        {speakers.length > max && ` ${t('eventsPage.andMore', { count: speakers.length - max, defaultValue_one: '+{{count}} more', defaultValue_other: '+{{count}} more' })}`}
      </span>
    </li>
  );
}

/* ─── Featured: the next event, on marine ────────────────────────── */

export function FeaturedEventPanel(props: EventViewProps & { calendarUrl: string | null }) {
  const { event, phase, registered, themes, themeLabel, kindLabel, whenText, whereText, locale, action, extra, calendarUrl } = props;
  const { t } = useTranslation();
  const isWebinar = event.event_type === 'webinar';
  const cover = coverFor(event, themes);
  return (
    <Reveal>
      <CardShell as="article" interactive tone="navy" className="rounded-[24px]">
        <BathyPattern seed={5} drift className="absolute inset-0" />
        <div className="relative grid lg:grid-cols-12">
          <div className="order-2 flex min-w-0 flex-col p-6 sm:p-8 lg:order-1 lg:col-span-7 lg:p-10">
            <div className="flex flex-wrap items-center gap-2">
              <span className={GLASS_CHIP}>
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-gold" />
                {phase === 'live' ? t('eventsPage.happeningNow', 'Happening now') : t('eventsPage.nextEvent', 'Next event')}
              </span>
              <span className={GLASS_CHIP}>{kindLabel(event.event_type)}</span>
              <Flags event={event} accessLabel={props.accessLabel} isModerator={props.isModerator} tone="dark" />
            </div>

            <h3 className="mt-5 text-[28px] font-semibold leading-[34px] tracking-[-0.02em] md:text-[34px] md:leading-[40px]">
              <StretchedLink to={`/events/${event.id}`} tone="light">{event.title}</StretchedLink>
            </h3>

            <ul className="mt-5 space-y-2.5 text-[15px] leading-6 text-white/90">
              <li className="flex items-start gap-2.5">
                <Clock className="mt-1 h-4 w-4 shrink-0 text-gold" aria-hidden="true" />
                <span>{whenText(event)}</span>
              </li>
              <li className="flex items-start gap-2.5">
                {isWebinar
                  ? <Video className="mt-1 h-4 w-4 shrink-0 text-gold" aria-hidden="true" />
                  : <MapPin className="mt-1 h-4 w-4 shrink-0 text-gold" aria-hidden="true" />}
                <span>{whereText(event)}</span>
              </li>
              <Speakers event={event} max={4} iconClass="mt-1 text-gold" className="gap-2.5" />
            </ul>

            {event.description && (
              <p className="mt-5 line-clamp-3 max-w-[560px] text-[15px] leading-6 text-white/80">{event.description}</p>
            )}
            {themes.length > 0 && (
              <div className="mt-5">
                <ThemePills themes={themes} themeLabel={themeLabel} max={4} tone="dark" />
              </div>
            )}

            <div className="relative z-10 mt-7 flex flex-wrap items-center gap-x-4 gap-y-3">
              {action}
              {extra}
              <UnderlineLink to={`/events/${event.id}`} tone="light">{t('eventsPage.seeDetails', 'See details')}</UnderlineLink>
            </div>

            {/* Three calendar buttons on wider screens; phones get the compact .ics button next to the action. */}
            {phase === 'upcoming' && event.date_time && (
              <div className="relative z-10 mt-7 hidden border-t border-white/15 pt-5 sm:block">
                <p className="mb-2.5 text-[12px] font-medium uppercase leading-4 tracking-[0.06em] text-white/70">{t('events.addToCalendar')}</p>
                <AddToCalendarButtons
                  tone="dark"
                  event={{
                    title: event.title,
                    description: event.description,
                    date_time: event.date_time,
                    end_date_time: event.end_date_time,
                    location: event.location,
                    // The join link only goes into the calendar of someone registered.
                    url: calendarUrl,
                  }}
                />
              </div>
            )}
          </div>

          <CardMedia className="order-1 h-60 sm:h-72 lg:order-2 lg:col-span-5 lg:h-auto lg:min-h-[420px]">
            <CoverImage
              src={cover?.src ?? null}
              focusY={cover?.focusY}
              alt=""
              seed={event.id}
              icon={kindIcon(event.event_type)}
              aspect="fill"
              tone="sea"
              eager
              className="absolute inset-0"
            />
            <span aria-hidden="true" className="absolute inset-0 bg-[linear-gradient(180deg,rgba(11,38,83,.2),rgba(11,38,83,0)_40%)] lg:bg-[linear-gradient(90deg,rgba(11,38,83,.55),rgba(11,38,83,0)_45%)]" />
            <div className="absolute left-4 top-4">
              <DateBlock iso={event.date_time} endIso={event.end_date_time} locale={locale} large showYear />
            </div>
            <StatusFlags phase={phase === 'live' ? 'upcoming' : phase} registered={registered} />
          </CardMedia>
        </div>
      </CardShell>
    </Reveal>
  );
}

/* ─── Event card ─────────────────────────────────────────────────── */

export function EventListCard(props: EventViewProps) {
  const { event, phase, registered, themes, themeLabel, kindLabel, whenText, whereText, locale, action, extra } = props;
  const { t } = useTranslation();
  const isPast = phase === 'ended';
  const isWebinar = event.event_type === 'webinar';
  const cover = coverFor(event, themes);
  return (
    <CardShell as="article" interactive className="h-full">
      <CardMedia>
        <CoverImage
          src={cover?.src ?? null}
          focusY={cover?.focusY}
          alt=""
          seed={event.id}
          icon={kindIcon(event.event_type)}
          aspect="wide"
          tone="sea"
        >
          <div className="absolute left-3 top-3">
            <DateBlock iso={event.date_time} endIso={event.end_date_time} locale={locale} showYear={isPast} />
          </div>
          <StatusFlags phase={phase} registered={registered && !isPast} />
          {isPast && event.replay_url && (
            <span className="absolute bottom-3 left-3 inline-flex items-center gap-1.5 rounded-pill bg-white px-3 py-1 text-[12px] font-semibold text-navy">
              <Play className="h-3 w-3 text-teal" aria-hidden="true" />{t('eventsPage.replayAvailable', 'Replay available')}
            </span>
          )}
        </CoverImage>
      </CardMedia>

      <div className="flex flex-1 flex-col p-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <KindLine label={kindLabel(event.event_type)} />
          <Flags event={event} accessLabel={props.accessLabel} isModerator={props.isModerator} />
        </div>
        <h3 className="mt-3 line-clamp-3 text-card-title text-navy">
          <StretchedLink to={`/events/${event.id}`}>{event.title}</StretchedLink>
        </h3>
        <ul className="mt-3 space-y-1.5 text-sm leading-5 text-meta">
          <li className="flex items-start gap-2">
            <Clock className="mt-0.5 h-4 w-4 shrink-0 text-teal" aria-hidden="true" />
            <span>{whenText(event)}</span>
          </li>
          <li className="flex items-start gap-2">
            {isWebinar
              ? <Video className="mt-0.5 h-4 w-4 shrink-0 text-teal" aria-hidden="true" />
              : <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-teal" aria-hidden="true" />}
            <span className="line-clamp-1">{whereText(event)}</span>
          </li>
          <Speakers event={event} max={3} iconClass="text-teal" />
        </ul>
        {event.description && (
          <p className="mt-3 line-clamp-2 text-sm leading-[22px] text-ink/80">{event.description}</p>
        )}
        {themes.length > 0 && (
          <div className="mt-4">
            <ThemePills themes={themes} themeLabel={themeLabel} max={2} />
          </div>
        )}
        <div className="relative z-10 mt-auto flex flex-wrap items-center gap-2 pt-5">
          {action}
          {extra}
        </div>
      </div>
    </CardShell>
  );
}

/* ─── Section heading ────────────────────────────────────────────── */

export function ListHead({ id, no, eyebrow, title, count, className }: {
  id: string;
  no: string;
  eyebrow: string;
  title: string;
  count: number;
  className?: string;
}) {
  return (
    <div className={cn('mb-8 md:mb-10', className)}>
      <Reveal>
        <Eyebrow number={no}>{eyebrow}</Eyebrow>
      </Reveal>
      <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <LineReveal as="h2" id={id} className="text-h2-sm text-navy md:text-h2">
          {title}
        </LineReveal>
        <span className="tabular rounded-pill bg-chip px-2.5 py-0.5 text-sm font-semibold text-navy">{count}</span>
      </div>
    </div>
  );
}

/* ─── Filter chip ────────────────────────────────────────────────── */

/** A toggle in the events toolbar: white pill with a hairline, navy when on. */
export function EventFilterChip({ active, onClick, icon: Icon, count, children }: {
  active: boolean;
  onClick: () => void;
  icon?: LucideIcon;
  count?: number;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-pill border px-4 text-sm font-medium transition-colors duration-300 focus-visible:shadow-focus focus-visible:outline-none',
        active ? 'border-navy bg-navy text-white' : 'border-rule bg-white text-ink hover:border-navy hover:text-navy',
      )}
    >
      {Icon && <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
      {children}
      {count !== undefined && <span className={cn('tabular text-[13px]', active ? 'text-white/75' : 'text-meta')}>{count}</span>}
    </button>
  );
}
