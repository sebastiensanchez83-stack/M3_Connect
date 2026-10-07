import { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Seo } from '@/components/seo/Seo';
import type { LucideIcon } from 'lucide-react';
import {
  ArrowRight, BookOpen, CalendarDays, CalendarPlus, CheckCircle2, Clock, Loader2, Lock,
  MapPin, Mic2, Play, Radio, Users, Video, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { LoadingSkeleton } from '@/components/LoadingSkeleton';
import { AdBanner } from '@/components/ui/AdBanner';
import { PageHero } from '@/components/ui/PageHero';
import { FilterBar, FilterChip } from '@/components/ui/FilterChip';
import { CoverImage } from '@/components/ui/CoverImage';
import { AddToCalendarButtons } from '@/components/events/AddToCalendarButtons';
import { WysInvitationCard, isWys26Event, wys26Upcoming } from '@/components/events/WysInvitationCard';
import { toast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
import { SM26_ENABLED } from '@/lib/featureFlags';
import { requireFreshSession } from '@/lib/session';
import { SITE_IMAGES, eventCover } from '@/lib/siteMedia';
import { THEMES, getTheme, themesForSectors, type ThemeKey } from '@/lib/themes';
import { accountHref } from '@/lib/accountNav';
import { canCreate } from '@/lib/nav';
import { cn, downloadICS } from '@/lib/utils';
import { withSiteSuffix } from '@/lib/seoText';
import { scrollTopUnderBars } from '@/lib/scrollTarget';

/**
 * Events and webinars.
 *
 * Before: two tabs (upcoming / past) of identical rows, a strip of 17 raw
 * sector labels as filters, and buttons nested inside the card's link — so
 * "Register" or "Add to calendar" also navigated away to the event page.
 *
 * Now: the next event is featured large, the rest of the programme follows in
 * cards, and past events (with their replays) sit below on the same page.
 * Filters are the platform's six themes, the event format (only when both
 * webinars and on-site events exist) and "My events" for members — all in the
 * URL (?type=&theme=&mine=1), so a filtered view can be shared and Back undoes
 * the last choice. Cards use a stretched title link, so the action buttons are
 * real siblings of the link rather than buttons inside an anchor.
 *
 * Registration logic is unchanged: SM-managed events (SM26) route to their own
 * intake page, invitation-only events go to the event page (which knows about
 * guest lists and invitation requests), and the quick "Register" still writes
 * the same event_registrations row as before.
 */

interface Event {
  id: string;
  title: string;
  description: string | null;
  date_time: string | null;
  end_date_time: string | null;
  location: string | null;
  language: string;
  access_level: string;
  event_type: 'webinar' | 'on_site';
  is_full_day: boolean;
  invitation_only: boolean;
  published: boolean;
  speakers: { name: string; title: string }[] | null;
  replay_url: string | null;
  meeting_url: string | null;
  /** Uploaded cover; null falls back to the built-in photo or a gradient (eventCover). */
  image_url: string | null;
}

type Phase = 'tbd' | 'upcoming' | 'live' | 'ended';
type EventKind = Event['event_type'];

/** The sticky navbar above the filter bar. */
const NAVBAR_HEIGHT = 64;

/** When an event has no end time, it is treated as a one-hour slot — as the calendar links do. */
const DEFAULT_DURATION_MS = 60 * 60 * 1000;

/**
 * Where an event stands. "Ended" means it has finished, not merely started:
 * a two-day conference stays in the programme on day two, and a webinar that
 * began ten minutes ago still offers its join link to registered attendees.
 */
function phaseOf(e: Event, now: number): Phase {
  if (!e.date_time) return 'tbd';
  const start = new Date(e.date_time).getTime();
  const end = e.end_date_time ? new Date(e.end_date_time).getTime() : start + DEFAULT_DURATION_MS;
  if (now < start) return 'upcoming';
  if (now < end) return 'live';
  return 'ended';
}

function kindIcon(kind: EventKind): LucideIcon {
  return kind === 'webinar' ? Video : CalendarDays;
}

export function EventsPage() {
  const { t, i18n } = useTranslation();
  const { user, profile, organization, isVerified, isModerator } = useAuth();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();

  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [registeredEvents, setRegisteredEvents] = useState<string[]>([]);
  const [sectorSlugsByEvent, setSectorSlugsByEvent] = useState<Record<string, string[]>>({});
  const [smPaths, setSmPaths] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  // Fixed for the visit: re-sorting the page under the reader's eyes would be worse than a stale minute.
  const [now] = useState(() => Date.now());

  // Primitives only: auth-js hands over a new user object on every tab refocus,
  // and an effect keyed on it would reload (and blank) the page each time.
  const userId = user?.id ?? null;
  const signedIn = !!userId;

  const locale = i18n.language?.startsWith('fr') ? 'fr-FR' : 'en-GB';

  // ---------------------------------------------------------------- data
  useEffect(() => {
    let alive = true;
    (async () => {
      const { data, error } = await supabase
        .from('events')
        .select('*')
        .order('date_time', { ascending: true, nullsFirst: false });
      if (!alive) return;

      if (error) {
        toast({ title: t('eventsPage.errorLoading', 'Error loading events'), variant: 'destructive' });
        setLoading(false);
        return;
      }

      // Unpublished events stay hidden unless the viewer is an admin/moderator.
      const allEvents = (data || []) as Event[];
      const visible = isModerator ? allEvents : allEvents.filter((e) => e.published !== false);
      setEvents(visible);

      // Sector tags for the visible events, as slugs (stable, unlike labels) so
      // they can be grouped into the platform's themes.
      const eventIds = visible.map((e) => e.id);
      if (eventIds.length > 0) {
        const { data: esData } = await supabase
          .from('event_sectors')
          .select('event_id, sectors(slug, label)')
          .in('event_id', eventIds);
        if (!alive) return;
        if (esData) {
          const map: Record<string, string[]> = {};
          for (const row of esData as { event_id: string; sectors: { slug: string | null } | { slug: string | null }[] | null }[]) {
            const sector = Array.isArray(row.sectors) ? row.sectors[0] : row.sectors;
            if (!sector?.slug) continue;
            (map[row.event_id] ??= []).push(sector.slug);
          }
          setSectorSlugsByEvent(map);
        }
      }
      // Only the very first load shows a skeleton; later refreshes swap data in place.
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [isModerator]); // eslint-disable-line react-hooks/exhaustive-deps

  // The member's own registrations (and exhibition requests), for the
  // "Registered" badge, the join link and the "My events" filter.
  useEffect(() => {
    if (!userId) { setRegisteredEvents([]); return; }
    let alive = true;
    Promise.all([
      supabase.from('event_registrations').select('event_id').eq('user_id', userId),
      supabase.from('exposition_requests').select('event_id').eq('requested_by', userId),
    ]).then(([{ data: regData }, { data: expoData }]) => {
      if (!alive) return;
      const regIds = ((regData || []) as { event_id: string }[]).map((r) => r.event_id);
      const expoIds = ((expoData || []) as { event_id: string }[]).map((r) => r.event_id);
      setRegisteredEvents([...new Set([...regIds, ...expoIds])]);
    });
    return () => { alive = false; };
  }, [userId]);

  // SM-managed events (e.g. SM26) route registration to their own intake page.
  useEffect(() => {
    if (!SM26_ENABLED) return;
    supabase.from('sm_event').select('legacy_event_id, slug').not('legacy_event_id', 'is', null)
      .then(({ data }) => {
        if (!data) return;
        const m: Record<string, string> = {};
        for (const row of data as { legacy_event_id: string | null; slug: string }[]) {
          if (row.legacy_event_id) m[row.legacy_event_id] = `/${row.slug}/register`;
        }
        setSmPaths(m);
      });
  }, []);

  // ---------------------------------------------------------------- access + actions (unchanged rules)
  const canAccess = (level: string) => {
    if (level === 'public') return true;
    if (!user) return false;
    if (level === 'members') return isVerified;
    if (level === 'marina') {
      const isInterestSide = profile?.persona === 'marina' || profile?.persona === 'developer' || profile?.persona === 'investor';
      return (isInterestSide && isVerified) || isModerator;
    }
    return false;
  };

  const profileComplete = profile?.access_status === 'verified' && profile?.onboarding_status === 'completed';

  const handleRegister = async (eventId: string) => {
    if (!user) {
      toast({ title: t('eventsPage.loginToRegisterToast', 'Please log in to register'), variant: 'destructive' });
      return;
    }
    if (!profileComplete) {
      toast({
        title: t('eventsPage.profileRequired', 'Complete your profile'),
        description: t('eventsPage.profileRequiredDesc', 'You need to complete and verify your profile before registering for events.'),
        variant: 'destructive',
      });
      return;
    }
    const uid = await requireFreshSession();
    if (!uid) return;
    setBusyId(eventId);
    const { error } = await supabase.from('event_registrations').insert({
      event_id: eventId,
      user_id: user.id,
    });
    setBusyId(null);
    if (error) {
      if (error.code === '23505') {
        toast({ title: t('eventsPage.alreadyRegistered', 'Already registered'), variant: 'destructive' });
      } else {
        toast({ title: t('eventsPage.registrationFailed', 'Registration failed'), variant: 'destructive' });
      }
    } else {
      setRegisteredEvents((prev) => [...prev, eventId]);
      toast({ title: t('events.registrationSuccess') });
    }
  };

  const handleAddToCalendar = (event: Event) => {
    if (!event.date_time) return;
    downloadICS({
      title: event.title,
      description: event.description,
      date_time: event.date_time,
      end_date_time: event.end_date_time,
      location: event.location,
    });
    toast({ title: t('eventsPage.calendarDownloaded', 'Calendar file downloaded') });
  };

  // ---------------------------------------------------------------- derived
  const registeredSet = useMemo(() => new Set(registeredEvents), [registeredEvents]);

  const themesByEvent = useMemo(() => {
    const m: Record<string, ThemeKey[]> = {};
    for (const e of events) m[e.id] = themesForSectors(sectorSlugsByEvent[e.id] ?? []);
    return m;
  }, [events, sectorSlugsByEvent]);

  const kinds = useMemo(() => new Set(events.map((e) => e.event_type)), [events]);

  const themeCounts = useMemo(() => {
    const counts = {} as Record<ThemeKey, number>;
    for (const th of THEMES) counts[th.key] = 0;
    for (const e of events) for (const k of themesByEvent[e.id] ?? []) counts[k] += 1;
    return counts;
  }, [events, themesByEvent]);
  const presentThemes = THEMES.filter((th) => themeCounts[th.key] > 0);

  // URL state. A value with no chip on screen to show it — a format when only
  // one exists, a theme no event carries, "mine" before the member's
  // registrations are known — is ignored rather than applied invisibly.
  const typeParam = params.get('type');
  const activeType: EventKind | null =
    kinds.size > 1 && (typeParam === 'webinar' || typeParam === 'on_site') && kinds.has(typeParam) ? typeParam : null;
  const themeParam = getTheme(params.get('theme'));
  const activeTheme = themeParam && presentThemes.length > 1 && themeCounts[themeParam.key] > 0 ? themeParam : null;
  const showMine = signedIn && registeredSet.size > 0;
  const activeMine = params.get('mine') === '1' && showMine;
  const anyFilter = !!(activeType || activeTheme || activeMine);

  /** Clicks push a history entry, so Back undoes the last filter. */
  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
    }
    setParams(next);
  };

  const filtered = useMemo(() => events.filter((e) =>
    (!activeType || e.event_type === activeType) &&
    (!activeTheme || (themesByEvent[e.id] ?? []).includes(activeTheme.key)) &&
    (!activeMine || registeredSet.has(e.id)),
  ), [events, activeType, activeTheme, activeMine, themesByEvent, registeredSet]);

  // Programme in date order, undated ("to be announced") events last; past
  // events most recent first.
  const upcoming = filtered
    .filter((e) => phaseOf(e, now) !== 'ended')
    .sort((a, b) =>
      (a.date_time ? new Date(a.date_time).getTime() : Infinity) - (b.date_time ? new Date(b.date_time).getTime() : Infinity));
  const past = filtered
    .filter((e) => phaseOf(e, now) === 'ended')
    .sort((a, b) => new Date(b.date_time!).getTime() - new Date(a.date_time!).getTime());
  const featured = upcoming[0] ?? null;
  const moreUpcoming = upcoming.slice(1);
  // The World Yachting Summit lives on the guest list, not in the events table:
  // listed here by hand until it is over, unless a filter it cannot match is on
  // or an events row already carries it.
  const showWys = wys26Upcoming(now) && !activeMine && !activeTheme && activeType !== 'webinar'
    && !events.some((e) => isWys26Event(e.title) && phaseOf(e, now) !== 'ended');

  const myUpcomingCount = events.filter((e) => registeredSet.has(e.id) && phaseOf(e, now) !== 'ended').length;
  const canPropose = canCreate('request_webinar', {
    isVerified,
    orgVerified: organization?.access_status === 'verified',
    persona: profile?.persona,
    isFeatureEnabled: () => false,
  });

  /**
   * Where an element should land when scrolled to: just under the navbar and
   * the sticky filter bar, which grows to two rows on desktop when there are
   * many chips — so it is measured, not assumed.
   */
  const filterBarRef = useRef<HTMLDivElement>(null);
  const scrollTargetTop = (el: HTMLElement) => {
    const bar = filterBarRef.current?.nextElementSibling as HTMLElement | null;
    // The header (NAVBAR_HEIGHT) only counts on the way up: it tucks away on the way down.
    return scrollTopUnderBars(el, bar?.getBoundingClientRect().height ?? 61, 8);
  };

  const pastRef = useRef<HTMLElement>(null);
  const scrollToPast = () => {
    const el = pastRef.current;
    if (el) window.scrollTo({ top: scrollTargetTop(el), behavior: 'smooth' });
  };

  // A filter changed from the sticky bar deep in the page would leave the
  // reader in the middle of the new results: bring the top of the list back
  // under the bar — only when they are below it, never on load.
  const listRef = useRef<HTMLDivElement>(null);
  const filterKey = `${activeType ?? ''}|${activeTheme?.key ?? ''}|${activeMine}`;
  const lastFilterKey = useRef(filterKey);
  useEffect(() => {
    if (filterKey === lastFilterKey.current) return;
    lastFilterKey.current = filterKey;
    const el = listRef.current;
    if (!el) return;
    const top = scrollTargetTop(el);
    if (window.scrollY > top) window.scrollTo({ top, behavior: 'smooth' });
  }, [filterKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------- formatting
  const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const fmtDay = (iso: string, withYear: boolean) =>
    new Date(iso).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) });

  /** "Wed 13 May · 15:00 – 16:00", "Sun 20 Sept – Mon 21 Sept · All day", or "Date to be announced". */
  const whenText = (e: Event): string => {
    if (!e.date_time) return t('eventsPage.dateTbd', 'Date to be announced');
    const start = new Date(e.date_time);
    const end = e.end_date_time ? new Date(e.end_date_time) : null;
    const withYear = start.getFullYear() !== new Date(now).getFullYear();
    const multiDay = !!end && end.toDateString() !== start.toDateString();
    const days = multiDay ? `${fmtDay(e.date_time, withYear)} – ${fmtDay(e.end_date_time!, withYear)}` : fmtDay(e.date_time, withYear);
    if (e.is_full_day) return multiDay ? days : `${days} · ${t('eventsPage.allDay', 'All day')}`;
    const times = end && !multiDay ? `${fmtTime(e.date_time)} – ${fmtTime(e.end_date_time!)}` : fmtTime(e.date_time);
    return `${days} · ${times}`;
  };

  const kindLabel = (kind: EventKind) =>
    kind === 'webinar' ? t('eventsPage.webinar', 'Webinar') : t('eventsPage.onSite', 'On-site event');

  const whereText = (e: Event) =>
    e.event_type === 'webinar' ? t('eventsPage.online', 'Online') : (e.location || t('eventsPage.venueTbd', 'Venue to be announced'));

  const accessLabel = (level: string) => {
    if (level === 'members') return t('eventsPage.access.members', 'Members only');
    if (level === 'marina') return t('eventsPage.access.marina', 'Marinas only');
    return null;
  };

  // ---------------------------------------------------------------- actions
  /**
   * The one thing to do with an event right now, as the old list offered it:
   * replay, join, register (or go to the SM intake page), request an invitation.
   */
  const primaryAction = (e: Event, size: 'sm' | 'default' = 'sm') => {
    const phase = phaseOf(e, now);
    const isRegistered = registeredSet.has(e.id);
    const hasAccess = canAccess(e.access_level);
    const smPath = smPaths[e.id];
    const detail = `/events/${e.id}`;
    const btn = size === 'sm' ? 'h-10 rounded-xl' : 'h-11 rounded-xl px-5';

    if (phase === 'ended') {
      if (e.replay_url) {
        return hasAccess ? (
          <Button asChild size={size} className={btn}>
            <a href={e.replay_url} target="_blank" rel="noopener noreferrer">
              <Play className="mr-2 h-4 w-4" aria-hidden="true" />{t('events.watchReplay')}
            </a>
          </Button>
        ) : (
          <span className="inline-flex min-h-10 items-center gap-1.5 text-sm text-gray-600">
            <Lock className="h-4 w-4" aria-hidden="true" />{t('eventsPage.replayForMembers', 'Replay for members')}
          </span>
        );
      }
      return <span className="inline-flex min-h-10 items-center text-sm text-gray-600">{t('eventsPage.ended', 'Ended')}</span>;
    }

    if (phase === 'live') {
      if (isRegistered && e.event_type === 'webinar' && e.meeting_url) {
        return (
          <Button asChild size={size} className={btn}>
            <a href={e.meeting_url} target="_blank" rel="noopener noreferrer">
              <Video className="mr-2 h-4 w-4" aria-hidden="true" />{t('eventsPage.joinNow', 'Join now')}
            </a>
          </Button>
        );
      }
      // Registration closed when it started. The featured card already has a
      // "See details" link of its own, so only the small cards need one here.
      return size === 'sm' ? (
        <Button asChild size={size} variant="outline" className={btn}>
          <Link to={detail}>{t('eventsPage.seeDetails', 'See details')}</Link>
        </Button>
      ) : null;
    }

    // Upcoming, or date still to be announced.
    if (e.invitation_only) {
      // The event page knows whether invitations run on a guest list, on a
      // request, or are included in the member's sponsorship.
      return (
        <Button asChild size={size} variant="outline" className={btn}>
          <Link to={detail}><Lock className="mr-2 h-4 w-4" aria-hidden="true" />{t('eventsPage.requestInvitation', 'Request an invitation')}</Link>
        </Button>
      );
    }
    if (isRegistered && e.event_type === 'webinar' && e.meeting_url) {
      return (
        <Button asChild size={size} className={btn}>
          <a href={e.meeting_url} target="_blank" rel="noopener noreferrer">
            <Video className="mr-2 h-4 w-4" aria-hidden="true" />{t('eventsPage.joinWebinar', 'Join the webinar')}
          </a>
        </Button>
      );
    }
    if (smPath && hasAccess) {
      return (
        <Button size={size} className={btn} onClick={() => navigate(smPath)}>
          {t('events.register')}<ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
        </Button>
      );
    }
    if (isRegistered) {
      return (
        <Button asChild size={size} variant="outline" className={btn}>
          <Link to={detail}><CheckCircle2 className="mr-2 h-4 w-4 text-emerald-700" aria-hidden="true" />{t('eventsPage.viewRegistration', 'View my registration')}</Link>
        </Button>
      );
    }
    if (!signedIn) {
      // Logging in, or the no-account webinar signup, happen on the event page.
      return (
        <Button asChild size={size} className={btn}>
          <Link to={detail}>{t('events.register')}<ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" /></Link>
        </Button>
      );
    }
    if (!hasAccess) {
      return (
        <span className="inline-flex min-h-10 items-center gap-1.5 text-sm text-gray-600">
          <Lock className="h-4 w-4" aria-hidden="true" />
          {e.access_level === 'marina' ? t('eventsPage.access.marina', 'Marinas only') : t('eventsPage.access.members', 'Members only')}
        </span>
      );
    }
    return (
      <Button size={size} className={btn} disabled={busyId === e.id} onClick={() => handleRegister(e.id)}>
        {busyId === e.id && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
        {t('events.register')}
      </Button>
    );
  };

  /** One-tap .ics download for an upcoming event — the compact form of AddToCalendarButtons. */
  const calendarButton = (e: Event, className?: string) => {
    if (!e.date_time || phaseOf(e, now) !== 'upcoming') return null;
    return (
      <Button
        variant="outline"
        size="icon"
        className={cn('h-10 w-10 shrink-0 rounded-xl', className)}
        onClick={() => handleAddToCalendar(e)}
        aria-label={t('eventsPage.addToCalendarFor', { title: e.title, defaultValue: 'Add “{{title}}” to your calendar' })}
        title={t('events.addToCalendar')}
      >
        <CalendarPlus className="h-4 w-4" aria-hidden="true" />
      </Button>
    );
  };

  const themeLabel = (key: ThemeKey) => {
    const th = getTheme(key)!;
    return t(th.labelKey, th.fallback);
  };

  const seoTitle = withSiteSuffix(t('seo.events.title', 'Marina industry events in Monaco, Dubai and online'));
  const seoDescription = t('seo.events.description', 'The Monaco Smart & Sustainable Marina Rendezvous, the World Yachting Summit in Dubai and our webinars: industry events organised by M3 Monaco.');

  // ---------------------------------------------------------------- render
  return (
    <div className="min-h-screen bg-gray-50">
      <Seo title={seoTitle} description={seoDescription} path="/events" />

      <PageHero
        image={SITE_IMAGES.eventsHero}
        seed="events-hero"
        icon={CalendarDays}
        eyebrow={t('eventsPage.heroTag', 'Conferences & webinars')}
        title={t('events.title', 'Marina industry events in Monaco, Dubai and online')}
        subtitle={t('events.subtitle', 'The Monaco Smart & Sustainable Marina Rendezvous, the World Yachting Summit in Dubai (by invitation) and our webinars. Signed-in members register for webinars in one click.')}
      >
        {(signedIn && myUpcomingCount > 0) || canPropose ? (
          <div className="flex flex-wrap items-center gap-3">
            {signedIn && myUpcomingCount > 0 && (
              <Button asChild className="h-11 rounded-full bg-secondary px-5 text-primary hover:bg-secondary/90">
                <Link to={accountHref('registrations')}>
                  <CheckCircle2 className="mr-2 h-4 w-4" aria-hidden="true" />
                  {t('eventsPage.myUpcoming', { count: myUpcomingCount, defaultValue_one: 'My events ({{count}} upcoming)', defaultValue_other: 'My events ({{count}} upcoming)' })}
                </Link>
              </Button>
            )}
            {canPropose && (
              <Button asChild variant="ghost" className="h-11 rounded-full bg-white/10 px-5 text-white ring-1 ring-white/30 hover:bg-white/20 hover:text-white">
                <Link to="/request-webinar">
                  <Mic2 className="mr-2 h-4 w-4" aria-hidden="true" />
                  {t('eventsPage.proposeWebinar', 'Propose a webinar')}
                </Link>
              </Button>
            )}
          </div>
        ) : null}
      </PageHero>

      {/* ── Filters: sticky under the 64 px navbar. The empty marker lets the page measure the bar. ── */}
      <div ref={filterBarRef} aria-hidden="true" />
      <FilterBar sticky>
        <span className="shrink-0 text-sm font-medium text-gray-900" aria-live="polite">
          {loading ? '…' : t('eventsPage.results', { count: filtered.length, defaultValue_one: '{{count}} event', defaultValue_other: '{{count}} events' })}
        </span>

        {anyFilter && (
          <button
            type="button"
            onClick={() => update({ type: null, theme: null, mine: null })}
            className="inline-flex min-h-10 shrink-0 items-center gap-1 rounded-full px-3 text-sm text-gray-600 hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            {t('eventsPage.clearFilters', 'Clear filters')}
          </button>
        )}

        {(kinds.size > 1 || presentThemes.length > 1 || showMine) && (
          <span className="mx-1 h-5 w-px shrink-0 bg-gray-200" aria-hidden="true" />
        )}

        {showMine && (
          <FilterChip active={activeMine} icon={CheckCircle2} onClick={() => update({ mine: activeMine ? null : '1' })}>
            {t('eventsPage.myEventsFilter', 'My events')}
          </FilterChip>
        )}

        {/* Format: only when there is a choice to make. */}
        {kinds.size > 1 && (['webinar', 'on_site'] as const).map((k) => (
          <FilterChip
            key={k}
            active={activeType === k}
            icon={kindIcon(k)}
            count={events.filter((e) => e.event_type === k).length}
            onClick={() => update({ type: activeType === k ? null : k })}
          >
            {k === 'webinar' ? t('eventsPage.webinars', 'Webinars') : t('eventsPage.onSiteEvents', 'On-site events')}
          </FilterChip>
        ))}

        {presentThemes.length > 1 && presentThemes.map((th) => (
          <FilterChip
            key={th.key}
            active={activeTheme?.key === th.key}
            icon={th.icon}
            count={themeCounts[th.key]}
            onClick={() => update({ theme: activeTheme?.key === th.key ? null : th.key })}
          >
            {t(th.labelKey, th.fallback)}
          </FilterChip>
        ))}
      </FilterBar>

      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 pt-6">
        <AdBanner placement="events" className="mb-2" />
      </div>

      <div ref={listRef} className="mx-auto w-full max-w-7xl px-4 sm:px-6 space-y-12 pb-16 pt-6">
        {loading ? (
          <LoadingSkeleton variant="card" count={3} />
        ) : anyFilter && filtered.length === 0 && !showWys ? (
          <div className="rounded-2xl bg-white px-6 py-16 text-center shadow-sm ring-1 ring-gray-100">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100">
              <CalendarDays className="h-8 w-8 text-gray-400" aria-hidden="true" />
            </div>
            <p className="mb-4 text-gray-600">{t('eventsPage.noMatch', 'No event matches these filters.')}</p>
            <Button variant="outline" className="h-10 rounded-xl" onClick={() => update({ type: null, theme: null, mine: null })}>
              {t('eventsPage.clearFilters', 'Clear filters')}
            </Button>
          </div>
        ) : (
          <>
            {/* ── What's coming ── */}
            <section aria-labelledby="upcoming-heading">
              <SectionHeading id="upcoming-heading" icon={CalendarDays} title={t('eventsPage.upcomingTitle', 'Upcoming events')} count={upcoming.length + (showWys ? 1 : 0)} />

              {featured ? (
                <FeaturedEvent
                  event={featured}
                  phase={phaseOf(featured, now)}
                  registered={registeredSet.has(featured.id)}
                  themes={themesByEvent[featured.id] ?? []}
                  themeLabel={themeLabel}
                  kindLabel={kindLabel}
                  whenText={whenText}
                  whereText={whereText}
                  accessLabel={accessLabel}
                  locale={locale}
                  isModerator={isModerator}
                  action={primaryAction(featured, 'default')}
                  extra={calendarButton(featured, 'sm:hidden')}
                />
              ) : showWys ? (
                <>
                  <WysInvitationCard />
                  <p className="mt-3 text-sm text-gray-600">
                    {t('eventsPage.wys.moreSoon', 'New webinars are announced here first.')}
                  </p>
                </>
              ) : (
                <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-gray-100">
                  <div className="grid sm:grid-cols-5">
                    <CoverImage src={null} alt="" seed="events-empty" icon={CalendarDays} aspect="fill" tone="sea" className="h-28 sm:col-span-2 sm:h-auto" />
                    <div className="p-6 sm:col-span-3 lg:p-8">
                      <h3 className="text-lg font-semibold text-gray-900">
                        {anyFilter
                          ? t('eventsPage.noUpcomingFiltered', 'No upcoming event matches these filters')
                          : t('eventsPage.noUpcomingTitle', 'No upcoming event announced yet')}
                      </h3>
                      <p className="mt-2 text-sm leading-relaxed text-gray-600">
                        {/* Only point to the replays "just below" when there are some. */}
                        {past.length > 0
                          ? t('eventsPage.noUpcomingBody', 'New webinars and conferences are announced here first. In the meantime, past sessions and their replays are just below.')
                          : t('eventsPage.noUpcomingBodyNoPast', 'New webinars and conferences are announced here first.')}
                      </p>
                      <div className="mt-5 flex flex-wrap gap-2">
                        {past.length > 0 && (
                          <Button className="h-10 rounded-xl" onClick={scrollToPast}>
                            <Play className="mr-2 h-4 w-4" aria-hidden="true" />{t('eventsPage.browsePast', 'Browse past events')}
                          </Button>
                        )}
                        {canPropose && (
                          <Button asChild variant="outline" className="h-10 rounded-xl">
                            <Link to="/request-webinar"><Mic2 className="mr-2 h-4 w-4" aria-hidden="true" />{t('eventsPage.proposeWebinar', 'Propose a webinar')}</Link>
                          </Button>
                        )}
                        <Button asChild variant="ghost" className="h-10 rounded-xl text-primary">
                          <Link to="/resources"><BookOpen className="mr-2 h-4 w-4" aria-hidden="true" />{t('eventsPage.exploreLibrary', 'Explore the library')}</Link>
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {featured && showWys && <WysInvitationCard className="mt-6" />}

              {moreUpcoming.length > 0 && (
                <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                  {moreUpcoming.map((e) => (
                    <EventCard
                      key={e.id}
                      event={e}
                      phase={phaseOf(e, now)}
                      registered={registeredSet.has(e.id)}
                      themes={themesByEvent[e.id] ?? []}
                      themeLabel={themeLabel}
                      kindLabel={kindLabel}
                      whenText={whenText}
                      whereText={whereText}
                      accessLabel={accessLabel}
                      locale={locale}
                      isModerator={isModerator}
                      action={primaryAction(e)}
                      extra={calendarButton(e)}
                    />
                  ))}
                </div>
              )}
            </section>

            {/* ── Past events and replays ── */}
            {past.length > 0 && (
              <section ref={pastRef} aria-labelledby="past-heading">
                <SectionHeading id="past-heading" icon={Play} title={t('eventsPage.pastTitle', 'Past events & replays')} count={past.length} />
                <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                  {past.map((e) => (
                    <EventCard
                      key={e.id}
                      event={e}
                      phase="ended"
                      registered={registeredSet.has(e.id)}
                      themes={themesByEvent[e.id] ?? []}
                      themeLabel={themeLabel}
                      kindLabel={kindLabel}
                      whenText={whenText}
                      whereText={whereText}
                      accessLabel={accessLabel}
                      locale={locale}
                      isModerator={isModerator}
                      action={primaryAction(e)}
                    />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ─── Pieces ─────────────────────────────────────────────────────── */

function SectionHeading({ id, icon: Icon, title, count }: { id: string; icon: LucideIcon; title: string; count: number }) {
  return (
    <div className="mb-4 flex items-center gap-2">
      <Icon className="h-5 w-5 text-primary" aria-hidden="true" />
      <h2 id={id} className="text-xl font-bold text-gray-900">{title}</h2>
      <span className="rounded-full bg-gray-200/70 px-2 py-0.5 text-xs font-semibold tabular-nums text-gray-700">{count}</span>
    </div>
  );
}

/** The calendar-page chip laid over a cover: day number, month, and the year when it is not this one. */
function DateChip({ iso, endIso, locale, large = false, showYear = false }: {
  iso: string | null; endIso: string | null; locale: string; large?: boolean; showYear?: boolean;
}) {
  const { t } = useTranslation();
  if (!iso) {
    return (
      <div className={cn('rounded-xl bg-white/95 px-3 py-2 text-center shadow-sm', large && 'px-4 py-3')}>
        <span className="block text-xs font-bold uppercase tracking-wide text-primary">{t('eventsPage.tbdShort', 'TBA')}</span>
      </div>
    );
  }
  const start = new Date(iso);
  const end = endIso ? new Date(endIso) : null;
  // "20–21" for a conference over consecutive days of one month.
  const sameMonthSpan = !!end && end.toDateString() !== start.toDateString()
    && end.getMonth() === start.getMonth() && end.getFullYear() === start.getFullYear();
  const day = sameMonthSpan ? `${start.getDate()}–${end!.getDate()}` : String(start.getDate());
  return (
    <div className={cn('min-w-[3.5rem] rounded-xl bg-white/95 px-2.5 py-1.5 text-center shadow-sm backdrop-blur-sm', large && 'min-w-[4.5rem] px-3 py-2')}>
      <span className={cn('block text-[11px] font-semibold uppercase tracking-wide text-gray-600', large && 'text-xs')}>
        {start.toLocaleDateString(locale, { month: 'short' })}
      </span>
      <span className={cn('block font-bold leading-none tabular-nums text-primary', large ? 'text-3xl' : 'text-xl')}>{day}</span>
      {showYear && <span className="mt-0.5 block text-[11px] font-medium tabular-nums text-gray-600">{start.getFullYear()}</span>}
    </div>
  );
}

function StatusBadges({ phase, registered }: { phase: Phase; registered: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="absolute right-3 top-3 flex flex-col items-end gap-1.5">
      {phase === 'live' && (
        <span className="inline-flex items-center gap-1 rounded-full bg-red-600 px-2.5 py-1 text-xs font-semibold text-white shadow-sm">
          <Radio className="h-3 w-3" aria-hidden="true" />{t('eventsPage.liveNow', 'Live now')}
        </span>
      )}
      {registered && (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-700 px-2.5 py-1 text-xs font-semibold text-white shadow-sm">
          <CheckCircle2 className="h-3 w-3" aria-hidden="true" />{t('eventsPage.registered', 'Registered')}
        </span>
      )}
    </div>
  );
}

function KindChip({ kind, label }: { kind: EventKind; label: string }) {
  const Icon = kindIcon(kind);
  return (
    <span className={cn(
      'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold',
      kind === 'webinar' ? 'bg-primary/10 text-primary' : 'bg-secondary/20 text-[#5c4510]',
    )}>
      <Icon className="h-3 w-3" aria-hidden="true" />{label}
    </span>
  );
}

function ThemeChips({ themes, themeLabel, max }: { themes: ThemeKey[]; themeLabel: (k: ThemeKey) => string; max: number }) {
  if (themes.length === 0) return null;
  const shown = themes.slice(0, max);
  const rest = themes.length - shown.length;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {shown.map((k) => {
        const Icon = getTheme(k)!.icon;
        return (
          <li key={k} className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700">
            <Icon className="h-3 w-3" aria-hidden="true" />{themeLabel(k)}
          </li>
        );
      })}
      {rest > 0 && (
        <li className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium tabular-nums text-gray-700">+{rest}</li>
      )}
    </ul>
  );
}

interface CardProps {
  event: Event;
  phase: Phase;
  registered: boolean;
  themes: ThemeKey[];
  themeLabel: (k: ThemeKey) => string;
  kindLabel: (k: EventKind) => string;
  whenText: (e: Event) => string;
  whereText: (e: Event) => string;
  accessLabel: (level: string) => string | null;
  locale: string;
  isModerator: boolean;
  action: React.ReactNode;
  extra?: React.ReactNode;
}

/** Small flags shown next to the format: access restriction, invitation, draft. */
function Flags({ event, accessLabel, isModerator }: Pick<CardProps, 'event' | 'accessLabel' | 'isModerator'>) {
  const { t } = useTranslation();
  const access = accessLabel(event.access_level);
  return (
    <>
      {access && (
        <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700">
          <Lock className="h-3 w-3" aria-hidden="true" />{access}
        </span>
      )}
      {event.invitation_only && (
        <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700">
          <Lock className="h-3 w-3" aria-hidden="true" />{t('eventsPage.invitationOnly', 'By invitation')}
        </span>
      )}
      {!event.published && isModerator && (
        <span className="inline-flex items-center rounded-full border border-dashed border-gray-400 px-2.5 py-0.5 text-xs font-medium text-gray-600">
          {t('eventsPage.draft', 'Draft')}
        </span>
      )}
    </>
  );
}

/** Stretched link: the whole card opens the event, while the buttons stay separate, real buttons. */
const STRETCHED_LINK =
  'after:absolute after:inset-0 after:z-0 after:rounded-2xl after:content-[""] focus:outline-none focus-visible:after:ring-2 focus-visible:after:ring-primary focus-visible:after:ring-offset-2';

function FeaturedEvent(props: CardProps) {
  const { event, phase, registered, themes, themeLabel, kindLabel, whenText, whereText, locale, action, extra } = props;
  const { t } = useTranslation();
  const isWebinar = event.event_type === 'webinar';
  const speakers = (event.speakers ?? []).map((s) => s.name).filter(Boolean);
  return (
    <article className="group relative overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-gray-100 transition-shadow duration-300 hover:shadow-lg">
      <div className="grid lg:grid-cols-5">
        <CoverImage
          src={eventCover(event)?.src ?? null}
          focusY={eventCover(event)?.focusY}
          alt=""
          seed={event.id}
          icon={kindIcon(event.event_type)}
          aspect="fill"
          tone="sea"
          eager
          className="h-52 sm:h-60 lg:col-span-2 lg:h-auto lg:min-h-[20rem]"
          imageClassName="transition-transform duration-500 group-hover:scale-105"
        >
          {phase === 'live' ? (
            <span className="absolute left-4 top-4 inline-flex items-center gap-1 rounded-full bg-red-600 px-3 py-1 text-xs font-bold uppercase tracking-wide text-white">
              <Radio className="h-3.5 w-3.5" aria-hidden="true" />{t('eventsPage.happeningNow', 'Happening now')}
            </span>
          ) : (
            <span className="absolute left-4 top-4 rounded-full bg-secondary px-3 py-1 text-xs font-bold uppercase tracking-wide text-primary">
              {t('eventsPage.nextEvent', 'Next event')}
            </span>
          )}
          <div className="absolute bottom-4 left-4">
            <DateChip iso={event.date_time} endIso={event.end_date_time} locale={locale} large />
          </div>
          {/* The live state is already the label on the left. */}
          <StatusBadges phase={phase === 'live' ? 'upcoming' : phase} registered={registered} />
        </CoverImage>

        <div className="flex flex-col p-6 lg:col-span-3 lg:p-8">
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            <KindChip kind={event.event_type} label={kindLabel(event.event_type)} />
            <Flags {...props} />
          </div>
          <h3 className="text-xl font-bold leading-tight text-gray-900 transition-colors group-hover:text-primary lg:text-2xl">
            <Link to={`/events/${event.id}`} className={STRETCHED_LINK}>{event.title}</Link>
          </h3>
          <ul className="mt-3 space-y-1.5 text-sm text-gray-700">
            <li className="flex items-start gap-2">
              <Clock className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              <span>{whenText(event)}</span>
            </li>
            <li className="flex items-start gap-2">
              {isWebinar
                ? <Video className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                : <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />}
              <span>{whereText(event)}</span>
            </li>
            {speakers.length > 0 && (
              <li className="flex items-start gap-2">
                <Users className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <span>
                  <span className="sr-only">{t('events.speakers')}: </span>
                  {speakers.slice(0, 4).join(', ')}
                  {speakers.length > 4 && ` ${t('eventsPage.andMore', { count: speakers.length - 4, defaultValue_one: '+{{count}} more', defaultValue_other: '+{{count}} more' })}`}
                </span>
              </li>
            )}
          </ul>
          {event.description && (
            <p className="mt-4 line-clamp-3 text-sm leading-relaxed text-gray-600">{event.description}</p>
          )}
          {themes.length > 0 && (
            <div className="mt-4">
              <ThemeChips themes={themes} themeLabel={themeLabel} max={4} />
            </div>
          )}
          <div className="relative z-10 mt-6 flex flex-wrap items-center gap-2">
            {action}
            {extra}
            <Button asChild variant="ghost" className="h-11 rounded-xl text-primary">
              <Link to={`/events/${event.id}`}>
                {t('eventsPage.seeDetails', 'See details')}<ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
          </div>
          {/* Three calendar buttons on wider screens; phones get the compact .ics button next to the action. */}
          {phase === 'upcoming' && event.date_time && (
            <div className="relative z-10 mt-4 hidden border-t border-gray-100 pt-4 sm:block">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-600">{t('events.addToCalendar')}</p>
              <AddToCalendarButtons
                event={{
                  title: event.title,
                  description: event.description,
                  date_time: event.date_time,
                  end_date_time: event.end_date_time,
                  location: event.location,
                  // The join link only goes into the calendar of someone registered.
                  url: registered ? event.meeting_url : null,
                }}
              />
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

function EventCard(props: CardProps) {
  const { event, phase, registered, themes, themeLabel, kindLabel, whenText, whereText, locale, action, extra } = props;
  const { t } = useTranslation();
  const isPast = phase === 'ended';
  const speakers = (event.speakers ?? []).map((s) => s.name).filter(Boolean);
  const SHOWN_SPEAKERS = 3;
  return (
    <article className="group relative flex flex-col overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-gray-100 transition duration-300 hover:-translate-y-0.5 hover:shadow-md">
      <CoverImage
        src={eventCover(event)?.src ?? null}
        focusY={eventCover(event)?.focusY}
        alt=""
        seed={event.id}
        icon={kindIcon(event.event_type)}
        aspect="video"
        imageClassName="transition-transform duration-500 group-hover:scale-105"
      >
        <div className="absolute left-3 top-3">
          <DateChip iso={event.date_time} endIso={event.end_date_time} locale={locale} showYear={isPast} />
        </div>
        <StatusBadges phase={phase} registered={registered && !isPast} />
        {isPast && event.replay_url && (
          <span className="absolute bottom-3 left-3 inline-flex items-center gap-1 rounded-full bg-white/95 px-2.5 py-1 text-xs font-semibold text-primary shadow-sm">
            <Play className="h-3 w-3" aria-hidden="true" />{t('eventsPage.replayAvailable', 'Replay available')}
          </span>
        )}
      </CoverImage>
      <div className="flex flex-1 flex-col p-4">
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <KindChip kind={event.event_type} label={kindLabel(event.event_type)} />
          <Flags {...props} />
        </div>
        <h3 className="line-clamp-2 font-semibold leading-snug text-gray-900 transition-colors group-hover:text-primary">
          <Link to={`/events/${event.id}`} className={STRETCHED_LINK}>{event.title}</Link>
        </h3>
        <p className="mt-2 flex items-start gap-1.5 text-sm text-gray-600">
          <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{whenText(event)}</span>
        </p>
        <p className="mt-1 flex items-start gap-1.5 text-sm text-gray-600">
          {event.event_type === 'webinar'
            ? <Video className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            : <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
          <span className="line-clamp-1">{whereText(event)}</span>
        </p>
        {speakers.length > 0 && (
          <p className="mt-1 flex items-start gap-1.5 text-sm text-gray-600">
            <Users className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="line-clamp-2">
              <span className="sr-only">{t('events.speakers')}: </span>
              {speakers.slice(0, SHOWN_SPEAKERS).join(', ')}
              {speakers.length > SHOWN_SPEAKERS && ` ${t('eventsPage.andMore', { count: speakers.length - SHOWN_SPEAKERS, defaultValue_one: '+{{count}} more', defaultValue_other: '+{{count}} more' })}`}
            </span>
          </p>
        )}
        {event.description && (
          <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-gray-600">{event.description}</p>
        )}
        {themes.length > 0 && (
          <div className="mt-3">
            <ThemeChips themes={themes} themeLabel={themeLabel} max={2} />
          </div>
        )}
        <div className="relative z-10 mt-auto flex items-center gap-2 pt-4">
          {action}
          {extra}
        </div>
      </div>
    </article>
  );
}
