import { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Seo } from '@/components/seo/Seo';
import { CalendarDays, CalendarPlus, CheckCircle2, Loader2, Lock, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { LoadingSkeleton } from '@/components/LoadingSkeleton';
import { AdBanner } from '@/components/ui/AdBanner';
import { PageHero } from '@/components/ui/PageHero';
import { CardShell } from '@/components/brand/CardShell';
import { ContactCard } from '@/components/brand/ContactCard';
import { Reveal } from '@/components/motion/Reveal';
import { WysInvitationCard, isWys26Event, wys26Upcoming } from '@/components/events/WysInvitationCard';
import {
  EventFilterChip, EventListCard, FeaturedEventPanel, ListHead, kindIcon,
  type EventKind, type ListEvent, type Phase,
} from '@/components/events/EventListParts';
import { toast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
import { SM26_ENABLED } from '@/lib/featureFlags';
import { requireFreshSession } from '@/lib/session';
import { SITE_IMAGES } from '@/lib/siteMedia';
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
 * Now (refonte v2, Oct 2026): a compact PageHero, a sticky toolbar of pill filters,
 * the next event featured on a marine panel (the World Yachting Summit's own panel
 * when it is the only one ahead), the rest of the programme in the shared card
 * grammar (lift, picture zoom, gold title line, no round disc), and past events with
 * their replays below on the same page, then the one public contact. The pieces
 * that draw live in components/events/EventListParts.tsx.
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

interface Event extends ListEvent {
  end_date_time: string | null;
  language: string;
  is_full_day: boolean;
}

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
   * On a card the main action is navy (gold on hover) and the others outlines;
   * on the marine "next event" panel the main action is the page's gold.
   */
  const primaryAction = (e: Event, mode: 'card' | 'featured' = 'card') => {
    const phase = phaseOf(e, now);
    const isRegistered = registeredSet.has(e.id);
    const hasAccess = canAccess(e.access_level);
    const smPath = smPaths[e.id];
    const detail = `/events/${e.id}`;
    const onNavy = mode === 'featured';
    const size = onNavy ? 'default' : 'sm';
    const main = onNavy ? 'ctaOnDark' : 'ctaNavy';
    const second = onNavy ? 'ctaLight' : 'ctaOutline';
    const quiet = cn('inline-flex min-h-11 items-center gap-1.5 text-sm', onNavy ? 'text-white/85' : 'text-meta');

    if (phase === 'ended') {
      if (e.replay_url) {
        return hasAccess ? (
          <Button asChild size={size} variant={main}>
            <a href={e.replay_url} target="_blank" rel="noopener noreferrer">{t('events.watchReplay')}</a>
          </Button>
        ) : (
          <span className={quiet}>
            <Lock className="h-4 w-4" aria-hidden="true" />{t('eventsPage.replayForMembers', 'Replay for members')}
          </span>
        );
      }
      return <span className={quiet}>{t('eventsPage.ended', 'Ended')}</span>;
    }

    if (phase === 'live') {
      if (isRegistered && e.event_type === 'webinar' && e.meeting_url) {
        return (
          <Button asChild size={size} variant={main}>
            <a href={e.meeting_url} target="_blank" rel="noopener noreferrer">{t('eventsPage.joinNow', 'Join now')}</a>
          </Button>
        );
      }
      // Registration closed when it started. The featured panel already has a
      // "See details" link of its own, so only the small cards need one here.
      return onNavy ? null : (
        <Button asChild size={size} variant={second}>
          <Link to={detail}>{t('eventsPage.seeDetails', 'See details')}</Link>
        </Button>
      );
    }

    // Upcoming, or date still to be announced.
    if (e.invitation_only) {
      // The event page knows whether invitations run on a guest list, on a
      // request, or are included in the member's sponsorship.
      return (
        <Button asChild size={size} variant={onNavy ? main : second}>
          <Link to={detail}>{t('eventsPage.requestInvitation', 'Request an invitation')}</Link>
        </Button>
      );
    }
    if (isRegistered && e.event_type === 'webinar' && e.meeting_url) {
      return (
        <Button asChild size={size} variant={main}>
          <a href={e.meeting_url} target="_blank" rel="noopener noreferrer">{t('eventsPage.joinWebinar', 'Join the webinar')}</a>
        </Button>
      );
    }
    if (smPath && hasAccess) {
      return (
        <Button size={size} variant={main} onClick={() => navigate(smPath)}>
          {t('events.register')}
        </Button>
      );
    }
    if (isRegistered) {
      return (
        <Button asChild size={size} variant={second}>
          <Link to={detail}>{t('eventsPage.viewRegistration', 'View my registration')}</Link>
        </Button>
      );
    }
    if (!signedIn) {
      // Logging in, or the no-account webinar signup, happen on the event page.
      return (
        <Button asChild size={size} variant={main}>
          <Link to={detail}>{t('events.register')}</Link>
        </Button>
      );
    }
    if (!hasAccess) {
      return (
        <span className={quiet}>
          <Lock className="h-4 w-4" aria-hidden="true" />
          {e.access_level === 'marina' ? t('eventsPage.access.marina', 'Marinas only') : t('eventsPage.access.members', 'Members only')}
        </span>
      );
    }
    return (
      <Button size={size} variant={main} disabled={busyId === e.id} onClick={() => handleRegister(e.id)}>
        {busyId === e.id && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
        {t('events.register')}
      </Button>
    );
  };

  /** One-tap .ics download for an upcoming event — the compact form of AddToCalendarButtons. */
  const calendarButton = (e: Event, onNavy = false, className?: string) => {
    if (!e.date_time || phaseOf(e, now) !== 'upcoming') return null;
    return (
      <Button
        variant={onNavy ? 'ctaLight' : 'ctaOutline'}
        size="icon"
        className={cn('h-11 w-11 shrink-0 md:h-11 md:w-11', className)}
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

  /** What every card is given: the same texts and rules, whatever the card. */
  const viewProps = (e: Event, phase: Phase) => ({
    event: e,
    phase,
    registered: registeredSet.has(e.id),
    themes: themesByEvent[e.id] ?? [],
    themeLabel,
    kindLabel,
    whenText: whenText as (ev: ListEvent) => string,
    whereText: whereText as (ev: ListEvent) => string,
    accessLabel,
    locale,
    isModerator,
  });

  const noMatch = anyFilter && filtered.length === 0 && !showWys;
  const upcomingCount = upcoming.length + (showWys ? 1 : 0);

  // ---------------------------------------------------------------- render
  return (
    <div className="min-h-screen bg-page">
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
              <Button asChild variant="ctaOnDark">
                <Link to={accountHref('registrations')}>
                  {t('eventsPage.myUpcoming', { count: myUpcomingCount, defaultValue_one: 'My events ({{count}} upcoming)', defaultValue_other: 'My events ({{count}} upcoming)' })}
                </Link>
              </Button>
            )}
            {canPropose && (
              <Button asChild variant="ctaLight">
                <Link to="/request-webinar">{t('eventsPage.proposeWebinar', 'Propose a webinar')}</Link>
              </Button>
            )}
          </div>
        ) : null}
      </PageHero>

      {/* ── Filters: sticky under the header. The empty marker lets the page measure the bar. ── */}
      <div ref={filterBarRef} aria-hidden="true" />
      <div
        role="region"
        aria-label={t('eventsPage.toolbarLabel', 'Filter the events')}
        className="sticky top-16 z-30 border-b border-rule bg-page/95 backdrop-blur-md"
      >
        <div className="no-scrollbar mx-auto flex w-full max-w-7xl items-center gap-2 overflow-x-auto px-4 py-3 sm:px-6 md:flex-wrap md:overflow-visible">
          <span className="shrink-0 pr-1 text-sm font-semibold text-navy" aria-live="polite">
            {loading ? '…' : t('eventsPage.results', { count: filtered.length, defaultValue_one: '{{count}} event', defaultValue_other: '{{count}} events' })}
          </span>

          {anyFilter && (
            <button
              type="button"
              onClick={() => update({ type: null, theme: null, mine: null })}
              className="inline-flex h-10 shrink-0 items-center gap-1 rounded-pill px-3 text-sm font-medium text-navy underline decoration-navy/30 underline-offset-4 transition-colors hover:decoration-navy focus-visible:shadow-focus focus-visible:outline-none"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
              {t('eventsPage.clearFilters', 'Clear filters')}
            </button>
          )}

          {(kinds.size > 1 || presentThemes.length > 1 || showMine) && (
            <span className="mx-1 h-5 w-px shrink-0 bg-rule" aria-hidden="true" />
          )}

          {showMine && (
            <EventFilterChip active={activeMine} icon={CheckCircle2} onClick={() => update({ mine: activeMine ? null : '1' })}>
              {t('eventsPage.myEventsFilter', 'My events')}
            </EventFilterChip>
          )}

          {/* Format: only when there is a choice to make. */}
          {kinds.size > 1 && (['webinar', 'on_site'] as const).map((k) => (
            <EventFilterChip
              key={k}
              active={activeType === k}
              icon={kindIcon(k)}
              count={events.filter((e) => e.event_type === k).length}
              onClick={() => update({ type: activeType === k ? null : k })}
            >
              {k === 'webinar' ? t('eventsPage.webinars', 'Webinars') : t('eventsPage.onSiteEvents', 'On-site events')}
            </EventFilterChip>
          ))}

          {presentThemes.length > 1 && presentThemes.map((th) => (
            <EventFilterChip
              key={th.key}
              active={activeTheme?.key === th.key}
              icon={th.icon}
              count={themeCounts[th.key]}
              onClick={() => update({ theme: activeTheme?.key === th.key ? null : th.key })}
            >
              {t(th.labelKey, th.fallback)}
            </EventFilterChip>
          ))}
        </div>
      </div>

      <div className="mx-auto w-full max-w-7xl px-4 pt-8 sm:px-6">
        <AdBanner placement="events" className="mb-2" />
      </div>

      <div ref={listRef} className="mx-auto w-full max-w-7xl space-y-16 px-4 pb-16 pt-8 sm:px-6 md:space-y-24 md:pb-24 md:pt-12">
        {loading ? (
          <LoadingSkeleton variant="card" count={3} />
        ) : noMatch ? (
          <CardShell className="items-center px-6 py-16 text-center">
            <span className="mb-4 grid h-14 w-14 place-items-center rounded-full bg-chip text-navy">
              <CalendarDays className="h-7 w-7" aria-hidden="true" />
            </span>
            <p className="mb-6 text-body text-ink">{t('eventsPage.noMatch', 'No event matches these filters.')}</p>
            <Button variant="ctaOutline" size="sm" onClick={() => update({ type: null, theme: null, mine: null })}>
              {t('eventsPage.clearFilters', 'Clear filters')}
            </Button>
          </CardShell>
        ) : (
          <>
            {/* ── What is coming ── */}
            <section aria-labelledby="upcoming-heading">
              <ListHead
                id="upcoming-heading"
                no="01"
                eyebrow={t('eventsPage.upcomingEyebrow', 'Programme')}
                title={t('eventsPage.upcomingTitle', 'Upcoming events')}
                count={upcomingCount}
              />

              {featured ? (
                <FeaturedEventPanel
                  {...viewProps(featured, phaseOf(featured, now))}
                  action={primaryAction(featured, 'featured')}
                  extra={calendarButton(featured, true, 'sm:hidden')}
                  calendarUrl={registeredSet.has(featured.id) ? featured.meeting_url : null}
                />
              ) : showWys ? (
                <>
                  <WysInvitationCard variant="panel" />
                  <p className="mt-4 text-sm text-meta">
                    {t('eventsPage.wys.moreSoon', 'New webinars are announced here first.')}
                  </p>
                </>
              ) : (
                <CardShell>
                  <div className="p-6 sm:p-8 lg:p-10">
                    <h3 className="text-h3 text-navy">
                      {anyFilter
                        ? t('eventsPage.noUpcomingFiltered', 'No upcoming event matches these filters')
                        : t('eventsPage.noUpcomingTitle', 'No upcoming event announced yet')}
                    </h3>
                    <p className="mt-2 max-w-[640px] text-body text-ink/80">
                      {/* Only point to the replays "just below" when there are some. */}
                      {past.length > 0
                        ? t('eventsPage.noUpcomingBody', 'New webinars and conferences are announced here first. In the meantime, past sessions and their replays are just below.')
                        : t('eventsPage.noUpcomingBodyNoPast', 'New webinars and conferences are announced here first.')}
                    </p>
                    <div className="mt-6 flex flex-wrap items-center gap-3">
                      {past.length > 0 && (
                        <Button variant="cta" size="sm" onClick={scrollToPast}>
                          {t('eventsPage.browsePast', 'Browse past events')}
                        </Button>
                      )}
                      {canPropose && (
                        <Button asChild variant="ctaOutline" size="sm">
                          <Link to="/request-webinar">{t('eventsPage.proposeWebinar', 'Propose a webinar')}</Link>
                        </Button>
                      )}
                      <Button asChild variant="ctaOutline" size="sm">
                        <Link to="/resources">{t('eventsPage.exploreLibrary', 'Explore the library')}</Link>
                      </Button>
                    </div>
                  </div>
                </CardShell>
              )}

              {featured && showWys && <WysInvitationCard className="mt-6" />}

              {moreUpcoming.length > 0 && (
                <ul className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                  {moreUpcoming.map((e, i) => (
                    <Reveal as="li" key={e.id} delay={(i % 3) * 80} className="flex min-w-0">
                      <EventListCard
                        {...viewProps(e, phaseOf(e, now))}
                        action={primaryAction(e)}
                        extra={calendarButton(e)}
                      />
                    </Reveal>
                  ))}
                </ul>
              )}
            </section>

            {/* ── Past events and replays ── */}
            {past.length > 0 && (
              <section ref={pastRef} aria-labelledby="past-heading">
                <ListHead
                  id="past-heading"
                  no="02"
                  eyebrow={t('eventsPage.pastEyebrow', 'Archive')}
                  title={t('eventsPage.pastTitle', 'Past events & replays')}
                  count={past.length}
                />
                <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                  {past.map((e, i) => (
                    <Reveal as="li" key={e.id} delay={(i % 3) * 80} className="flex min-w-0">
                      <EventListCard {...viewProps(e, 'ended')} action={primaryAction(e)} />
                    </Reveal>
                  ))}
                </ul>
              </section>
            )}

            {/* ── Questions: the one public address ── */}
            <Reveal>
              <ContactCard
                variant="panel"
                title={t('eventsPage.contact.title', 'A question about an event?')}
                line={t('eventsPage.contact.line', 'Programme, registration or sponsoring: write to the M3 team.')}
                className="lg:mx-auto lg:max-w-3xl"
              />
            </Reveal>
          </>
        )}
      </div>
    </div>
  );
}
