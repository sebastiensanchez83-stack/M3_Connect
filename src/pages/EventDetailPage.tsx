import { useState, useEffect, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Helmet } from 'react-helmet-async';
import type { LucideIcon } from 'lucide-react';
import {
  AlertCircle, ArrowRight, Building2, CalendarDays, CalendarPlus, CheckCircle2, ChevronLeft, Clock, Download,
  ExternalLink, FileDown, FileText, Globe, Languages, ListChecks, Loader2, Lock, MapPin,
  Mic2, Package, Play, Radio, Ticket, UserCheck, Users, Video, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { LoginForm } from '@/components/auth/LoginForm';
import { SignupForm } from '@/components/auth/SignupForm';
import { LoadingSkeleton } from '@/components/LoadingSkeleton';
import { CoverImage, LogoBadge } from '@/components/ui/CoverImage';
import { eventCover } from '@/lib/siteMedia';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
import { SM26_ENABLED } from '@/lib/featureFlags';
import { getTheme, themesForSectors } from '@/lib/themes';
import { accountHref } from '@/lib/accountNav';
import { cn, downloadICS, type CalendarEventInput } from '@/lib/utils';
import { EventRegistrationFlow } from '@/components/events/EventRegistrationFlow';
import { LightweightWebinarSignup } from '@/components/events/LightweightWebinarSignup';
import { AddToCalendarButtons } from '@/components/events/AddToCalendarButtons';
import { SM26Agenda } from '@/components/sm26/SM26Agenda';

/**
 * One event, and where the visitor stands with it.
 *
 * The header says what, when, where, in which language and for whom. The
 * participation card says, in one glance, which of three situations applies —
 * not registered yet (and how to register), registered (and what happens
 * next), or over (and where the replay is) — and keeps every route into
 * registration exactly as it was: SM-managed intake pages, guest lists for
 * invitation-only events, the member flow (EventRegistrationFlow: packages,
 * pricing, sponsorship seats, invitation requests), the no-account webinar
 * signup, self-cancel, and the login/signup dialogs.
 *
 * On phones the participation card comes straight after the header; once it
 * scrolls away, a bar pinned to the bottom of the screen keeps the primary
 * action (register / join / add to calendar / replay) one tap away.
 */

type EventType = 'webinar' | 'on_site';

interface EventPartner {
  name: string;
  logo_url?: string;
  website?: string;
}

interface EventPackage {
  id: string;
  name: string;
  description: string | null;
  price_cents: number;
  max_seats: number | null;
  display_order: number;
}

interface EventSector {
  id: string;
  label: string;
  slug: string | null;
}

interface LocationDetails {
  lat?: number;
  lng?: number;
  address?: string;
  map_url?: string;
  venue?: string;
  city?: string;
  country?: string;
}

interface EventDetail {
  id: string;
  title: string;
  description: string | null;
  date_time: string | null;
  end_date_time: string | null;
  is_full_day: boolean;
  location: string | null;
  language: string;
  access_level: string;
  event_type: EventType;
  invitation_only: boolean;
  published: boolean;
  speakers: { name: string; title: string; profile_id?: string }[] | null;
  replay_url: string | null;
  meeting_url: string | null;
  pdf_url: string | null;
  brochure_url: string | null;
  event_website_url: string | null;
  event_partners: EventPartner[] | null;
  location_details: LocationDetails | null;
  fees: string | null;
  max_attendance: number | null;
  created_at: string;
  /** Uploaded cover; null falls back to the built-in photo or a gradient (eventCover). */
  image_url: string | null;
}

interface EventParticipant {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
  job_title: string | null;
  org_name: string | null;
  org_logo_url: string | null;
}

/** As the calendar links assume: an event without an end time lasts an hour. */
const DEFAULT_DURATION_MS = 60 * 60 * 1000;

/** A map URL that can sit in an iframe. Share links (maps.app.goo.gl…) refuse to be framed. */
function isEmbeddableMap(url: string): boolean {
  return /google\.[a-z.]+\/maps\/embed|[?&]output=embed|openstreetmap\.org\/export\/embed/i.test(url);
}

/**
 * A link that opens the venue in a maps app. Coordinates or a written address
 * come first — a search on them always resolves — then the stored share link,
 * then the free-text location.
 */
function mapLinkFor(event: EventDetail): string | null {
  if (event.event_type !== 'on_site') return null;
  const d = event.location_details ?? {};
  const search = (q: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
  if (typeof d.lat === 'number' && typeof d.lng === 'number') return search(`${d.lat},${d.lng}`);
  const address = [d.venue, d.address || [d.city, d.country].filter(Boolean).join(', ')].filter(Boolean).join(', ');
  if (d.address) return search(address);
  if (d.map_url && !isEmbeddableMap(d.map_url)) return d.map_url;
  const q = address || event.location;
  return q ? search(q) : null;
}

/** "EN" → "English" / "Anglais"; "EN/FR" → "English, French". Unknown codes are shown as stored. */
function languageNames(codes: string | null | undefined, locale: string): string | null {
  if (!codes) return null;
  const parts = codes.split(/[\s,/|+]+/).filter(Boolean);
  if (parts.length === 0) return null;
  let names: Intl.DisplayNames | null = null;
  try { names = new Intl.DisplayNames([locale], { type: 'language' }); } catch { names = null; }
  return parts.map((code) => {
    try {
      const n = names?.of(code.toLowerCase());
      return n ? n.charAt(0).toUpperCase() + n.slice(1) : code;
    } catch {
      return code;
    }
  }).join(', ');
}

/** Whether an element is on screen. Starts as `initial` until the observer reports. */
function useInView(ref: React.RefObject<Element>, enabled: boolean, rootMargin: string, initial: boolean): boolean {
  const [inView, setInView] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { rootMargin });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, enabled, rootMargin]);
  return inView;
}

/**
 * Whether the page has been scrolled down to (or past) an element, give or take
 * `slack` px. A scroll listener rather than an observer: a fast fling can carry
 * the element from below the screen to above it without it ever intersecting.
 */
function useReached(ref: React.RefObject<Element>, enabled: boolean, slack: number): boolean {
  const [reached, setReached] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let frame = 0;
    const check = () => {
      frame = 0;
      const el = ref.current;
      if (el) setReached(el.getBoundingClientRect().top < window.innerHeight + slack);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(check); };
    check();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [ref, enabled, slack]);
  return reached;
}

export function EventDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { user, profile, isModerator } = useAuth();
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [registrationCount, setRegistrationCount] = useState(0);
  const [loginOpen, setLoginOpen] = useState(false);
  const [signupOpen, setSignupOpen] = useState(false);
  const [participants, setParticipants] = useState<EventParticipant[]>([]);
  const [participantsLoaded, setParticipantsLoaded] = useState(false);
  const [packages, setPackages] = useState<EventPackage[]>([]);
  const [sectors, setSectors] = useState<EventSector[]>([]);
  const [isUserRegistered, setIsUserRegistered] = useState(false);
  const [unregistering, setUnregistering] = useState(false);
  const [smRegisterPath, setSmRegisterPath] = useState<string | null>(null);
  const [smEventId, setSmEventId] = useState<string | null>(null);
  /** Set when a registration was just made on this page (member flow or guest signup). */
  const [justSignedUp, setJustSignedUp] = useState(false);
  const [now] = useState(() => Date.now());

  // Primitives only — auth-js hands a new user object on every tab refocus.
  const userId = user?.id ?? null;
  const userEmail = user?.email?.toLowerCase() ?? null;
  const locale = i18n.language?.startsWith('fr') ? 'fr-FR' : 'en-GB';

  const profileComplete = profile?.access_status === 'verified' && profile?.onboarding_status === 'completed';

  // If this event is managed by an SM module edition, route registration there.
  useEffect(() => {
    if (!id || !SM26_ENABLED) { setSmRegisterPath(null); setSmEventId(null); return; }
    supabase.from('sm_event').select('id, slug').eq('legacy_event_id', id).maybeSingle()
      .then(({ data }) => {
        setSmRegisterPath(data ? `/${(data as { slug: string }).slug}/register` : null);
        setSmEventId((data as { id: string } | null)?.id ?? null);
      });
  }, [id]);

  // Invitation-only events run on a guest list (e.g. /wys26) take requests there, with no account.
  const [guestListPath, setGuestListPath] = useState<string | null>(null);
  useEffect(() => {
    if (!id) { setGuestListPath(null); return; }
    supabase.rpc('gl_event_slug_for', { p_event_id: id })
      .then(({ data }) => setGuestListPath(typeof data === 'string' && data ? `/${data}` : null));
  }, [id]);

  // Check if the logged-in user already has a registration for this event
  // (covers both direct registrations and guest → account upgrades via email match)
  useEffect(() => {
    if (!id || !userId) {
      setIsUserRegistered(false);
      return;
    }
    let alive = true;
    const filter = userEmail
      ? `user_id.eq.${userId},guest_email.eq.${userEmail}`
      : `user_id.eq.${userId}`;
    supabase
      .from('event_registrations')
      .select('id')
      .eq('event_id', id)
      .or(filter)
      .limit(1)
      .then(({ data }) => { if (alive) setIsUserRegistered(!!(data && data.length > 0)); });
    return () => { alive = false; };
  }, [id, userId, userEmail]);

  // The event itself. Only the first load of a given event shows the skeleton.
  const loadedIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!id) return;
    let alive = true;
    if (loadedIdRef.current !== id) setLoading(true);
    (async () => {
      const { data, error } = await supabase
        .from('events')
        .select('*')
        .eq('id', id)
        .single();
      if (!alive) return;

      if (error) {
        if (import.meta.env.DEV) console.error('Error fetching event:', error);
        setEvent(null);
      } else {
        const ev = data as EventDetail;
        // Hide unpublished events from non-admins
        setEvent(ev.published === false && !isModerator ? null : ev);
      }
      loadedIdRef.current = id;
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [id, isModerator]);

  // Fetch packages for on-site events
  useEffect(() => {
    if (!id || !event || event.event_type !== 'on_site') return;
    supabase
      .from('event_packages')
      .select('*')
      .eq('event_id', id)
      .order('display_order')
      .then(({ data }) => { if (data) setPackages(data as EventPackage[]); });
  }, [id, event?.event_type]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch sectors (with slugs, so they can be shown as the platform's themes)
  useEffect(() => {
    if (!id) return;
    supabase
      .from('event_sectors')
      .select('sector_id, sectors(id, label, slug)')
      .eq('event_id', id)
      .then(({ data }) => {
        if (data) {
          type Row = { sector_id: string; sectors: { id: string; label: string; slug: string | null } | { id: string; label: string; slug: string | null }[] | null };
          const s = (data as Row[]).map((row) => {
            const sec = Array.isArray(row.sectors) ? row.sectors[0] : row.sectors;
            return { id: sec?.id || row.sector_id, label: sec?.label || '', slug: sec?.slug ?? null };
          }).filter((x) => x.label);
          setSectors(s);
        }
      });
  }, [id]);

  // Fetch registration count
  useEffect(() => {
    if (!id) return;
    supabase
      .from('event_registrations')
      .select('id', { count: 'exact' })
      .eq('event_id', id)
      .then(({ count }) => setRegistrationCount(count || 0));
  }, [id]);

  // Fetch participants for logged-in users
  useEffect(() => {
    if (!id || !userId) return;
    let alive = true;
    const fetchParticipants = async () => {
      const { data: regs, error: regsError } = await supabase
        .from('event_registrations')
        .select('user_id, profiles!inner(first_name, last_name, avatar_url, job_title, user_id)')
        .eq('event_id', id);

      if (!alive) return;
      if (regsError || !regs) { setParticipantsLoaded(true); return; }

      const userIds = regs.map((r: any) => r.user_id as string);
      const orgMap: Record<string, { name: string; logo_url: string | null }> = {};
      if (userIds.length > 0) {
        const { data: orgMembers } = await supabase
          .from('organization_members')
          .select('user_id, organizations(name, logo_url)')
          .in('user_id', userIds);
        if (orgMembers) {
          for (const om of orgMembers as any[]) {
            if (om.organizations) {
              orgMap[om.user_id] = { name: om.organizations.name, logo_url: om.organizations.logo_url };
            }
          }
        }
      }
      if (!alive) return;

      // One card per person, even if someone holds two registration rows.
      const seenUsers = new Set<string>();
      const uniqueRegs = (regs as any[]).filter((r) => !seenUsers.has(r.user_id) && !!seenUsers.add(r.user_id));
      setParticipants(uniqueRegs.map((r: any) => {
        const p = r.profiles;
        const org = orgMap[r.user_id];
        return {
          user_id: r.user_id,
          first_name: p?.first_name || null,
          last_name: p?.last_name || null,
          avatar_url: p?.avatar_url || null,
          job_title: p?.job_title || null,
          org_name: org?.name || null,
          org_logo_url: org?.logo_url || null,
        };
      }));
      setParticipantsLoaded(true);
    };
    fetchParticipants();
    return () => { alive = false; };
  }, [id, userId, profileComplete]);

  const formatPrice = (cents: number) => {
    if (cents === 0) return t('eventsPage.free', 'Free');
    return new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR' }).format(cents / 100);
  };

  const handleUnregister = async () => {
    if (!id || !user) return;
    if (!window.confirm(t('eventsPage.cancelConfirm', 'Are you sure you want to cancel your registration for this event?'))) return;
    setUnregistering(true);
    try {
      const email = user.email?.toLowerCase();
      // Remove the row owned by this user, or a guest row matching their email
      // (covers guest signups that were later upgraded to an account). RLS will
      // silently skip any row the user isn't allowed to delete.
      let query = supabase.from('event_registrations').delete().eq('event_id', id);
      query = email
        ? query.or(`user_id.eq.${user.id},guest_email.eq.${email}`)
        : query.eq('user_id', user.id);
      const { error } = await query;
      if (error) {
        toast({ title: t('eventsPage.cancelFailed', 'Failed to cancel registration'), description: error.message, variant: 'destructive' });
      } else {
        setIsUserRegistered(false);
        setJustSignedUp(false);
        setRegistrationCount((c) => Math.max(0, c - 1));
        toast({ title: t('eventsPage.cancelled', 'Registration cancelled') });
      }
    } catch (err) {
      toast({ title: t('eventsPage.cancelFailed', 'Failed to cancel registration'), description: t('eventsPage.unexpectedError', 'An unexpected error occurred.'), variant: 'destructive' });
    } finally {
      setUnregistering(false);
    }
  };

  // ---------------------------------------------------------------- sticky bar plumbing
  const panelRef = useRef<HTMLDivElement>(null);
  const panelHeadingRef = useRef<HTMLHeadingElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const ready = !loading && !!event;
  // The panel starts "in view" so the bar never flashes in before the observer
  // reports. The top margin discounts the 64 px navbar: a panel tucked under it
  // is out of sight.
  const panelInView = useInView(panelRef, ready, '-72px 0px 0px 0px', true);
  // Once the end of the content is reached the bar steps aside: it must never sit over the footer.
  const endInView = useReached(endRef, ready, 0);

  const scrollToPanel = () => {
    panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    panelHeadingRef.current?.focus({ preventScroll: true });
  };

  // ---------------------------------------------------------------- render
  if (loading) return <LoadingSkeleton variant="page" />;

  if (!event) {
    return (
      <div className="min-h-[60vh] bg-gray-50 px-4 py-16">
        <div className="mx-auto max-w-md rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-gray-100">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100">
            <CalendarDays className="h-8 w-8 text-gray-400" aria-hidden="true" />
          </div>
          <h1 className="mb-2 text-xl font-bold text-gray-900">{t('eventsPage.notFound', 'Event not found')}</h1>
          <p className="mb-6 text-sm text-gray-600">{t('eventsPage.notFoundBody', 'This event may have been removed, or it is not published yet.')}</p>
          <Button asChild className="h-11 rounded-xl">
            <Link to="/events">
              <ChevronLeft className="mr-2 h-4 w-4" aria-hidden="true" />
              {t('eventsPage.backToEvents', 'Back to events')}
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------- derived
  const isWebinar = event.event_type === 'webinar';
  const startMs = event.date_time ? new Date(event.date_time).getTime() : null;
  const endMs = startMs === null ? null : event.end_date_time ? new Date(event.end_date_time).getTime() : startMs + DEFAULT_DURATION_MS;
  // "Started" is the rule that has always closed registration; "ended" is when
  // the event is really over — a webinar under way still shows its join link.
  const hasStarted = startMs !== null && startMs <= now;
  const hasEnded = endMs !== null && endMs <= now;
  const isLive = hasStarted && !hasEnded;
  const isFull = event.max_attendance ? registrationCount >= event.max_attendance : false;
  const registeredNow = isUserRegistered || (justSignedUp && !event.invitation_only);

  const speakers = event.speakers ?? [];
  const partners = event.event_partners ?? [];
  const themes = themesForSectors(sectors.map((s) => s.slug));
  const details = event.location_details ?? {};
  const mapLink = mapLinkFor(event);
  const embedMap = details.map_url && isEmbeddableMap(details.map_url) ? details.map_url : null;
  const venueLine = isWebinar ? null : (details.venue || event.location);
  const addressLine = isWebinar ? null
    : details.address || [details.city, details.country].filter(Boolean).join(', ') || null;
  const language = languageNames(event.language, locale);

  const calendarEvent: CalendarEventInput | null = event.date_time ? {
    title: event.title,
    description: event.description,
    date_time: event.date_time,
    end_date_time: event.end_date_time,
    location: event.location,
    url: event.meeting_url,
  } : null;

  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(locale, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
  const fmtTime = (iso: string, zone = false) => new Date(iso).toLocaleTimeString(locale, {
    hour: '2-digit', minute: '2-digit', ...(zone ? { timeZoneName: 'short' as const } : {}),
  });
  const multiDay = !!event.date_time && !!event.end_date_time
    && new Date(event.end_date_time).toDateString() !== new Date(event.date_time).toDateString();

  const dateLine = event.date_time
    ? (multiDay ? `${fmtDate(event.date_time)} – ${fmtDate(event.end_date_time!)}` : fmtDate(event.date_time))
    : t('eventsPage.dateTbd', 'Date to be announced');
  const timeLine = !event.date_time ? null
    : event.is_full_day ? t('eventsPage.allDay', 'All day')
      : event.end_date_time && !multiDay
        ? `${fmtTime(event.date_time)} – ${fmtTime(event.end_date_time, true)}`
        : fmtTime(event.date_time, true);
  const fmtShort = (iso: string) => new Date(iso).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' });
  const shortWhen = event.date_time
    ? (multiDay
      ? `${fmtShort(event.date_time)} – ${fmtShort(event.end_date_time!)}`
      : fmtShort(event.date_time) + (event.is_full_day ? '' : ` · ${fmtTime(event.date_time)}`))
    : t('eventsPage.dateTbd', 'Date to be announced');

  const accessText = event.access_level === 'members'
    ? t('eventsPage.access.members', 'Members only')
    : event.access_level === 'marina'
      ? t('eventsPage.access.marina', 'Marinas only')
      : t('eventsPage.access.public', 'Open to everyone');

  // ---------------------------------------------------------------- participation card
  let panelTitle: string;
  let panelIcon: LucideIcon;
  let panelTone: 'navy' | 'green' | 'red' | 'gray';
  let panelBody: React.ReactNode;

  const viewMyEvents = (
    <Button variant="outline" className="h-11 w-full rounded-xl" onClick={() => navigate(accountHref('registrations'))}>
      <ListChecks className="mr-2 h-4 w-4" aria-hidden="true" />
      {t('eventsPage.viewMyRegistrations', 'View my registrations')}
    </Button>
  );

  const joinButton = isWebinar && event.meeting_url ? (
    <Button asChild className="h-11 w-full rounded-xl">
      <a href={event.meeting_url} target="_blank" rel="noopener noreferrer">
        <Video className="mr-2 h-4 w-4" aria-hidden="true" />
        {t('eventsPage.joinWebinar', 'Join the webinar')}
      </a>
    </Button>
  ) : null;

  if (hasEnded) {
    panelTitle = t('eventsPage.endedTitle', 'This event has ended');
    panelIcon = event.replay_url ? Play : CalendarDays;
    panelTone = 'gray';
    panelBody = (
      <div className="space-y-3">
        {isUserRegistered && (
          <p className="flex items-center gap-2 text-sm text-gray-700">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true" />
            {t('eventsPage.youWereRegistered', 'You were registered for this event.')}
          </p>
        )}
        {event.replay_url ? (
          <>
            <p className="text-sm text-gray-600">{t('eventsPage.replayIntro', 'Missed it, or want to see it again? The full session is online.')}</p>
            <Button asChild className="h-11 w-full rounded-xl">
              <a href={event.replay_url} target="_blank" rel="noopener noreferrer">
                <Play className="mr-2 h-4 w-4" aria-hidden="true" />
                {t('events.watchReplay')}
              </a>
            </Button>
          </>
        ) : (
          <p className="text-sm text-gray-600">{t('eventsPage.noReplay', 'No replay has been published for this event.')}</p>
        )}
        <Button asChild variant="ghost" className="h-11 w-full rounded-xl text-primary">
          <Link to="/events">{t('eventsPage.seeUpcoming', 'See upcoming events')}<ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" /></Link>
        </Button>
      </div>
    );
  } else if (isLive) {
    panelTitle = t('eventsPage.happeningNow', 'Happening now');
    panelIcon = Radio;
    panelTone = 'red';
    panelBody = isUserRegistered ? (
      <div className="space-y-3">
        <p className="flex items-center gap-2 text-sm font-medium text-emerald-800">
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
          {t('eventsPage.youreRegistered', "You're registered")}
        </p>
        {joinButton}
        {viewMyEvents}
      </div>
    ) : (
      <p className="text-sm text-gray-600">{t('eventsPage.registrationClosedLive', 'This event is under way — registration closed when it started.')}</p>
    );
  } else if (smRegisterPath) {
    panelTitle = t('events.register');
    panelIcon = Ticket;
    panelTone = 'navy';
    panelBody = (
      <Button className="h-11 w-full rounded-xl" onClick={() => navigate(smRegisterPath)}>
        {t('events.register')}<ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
      </Button>
    );
  } else if (guestListPath) {
    panelTitle = t('eventsPage.requestInvitation', 'Request an invitation');
    panelIcon = Lock;
    panelTone = 'navy';
    panelBody = (
      <div className="space-y-3">
        <p className="text-sm text-gray-600">{t('eventsPage.guestListIntro', 'Places are by invitation. Send a request and the organisers will come back to you.')}</p>
        <Button className="h-11 w-full rounded-xl" onClick={() => navigate(guestListPath)}>
          <Lock className="mr-2 h-4 w-4" aria-hidden="true" /> {t('eventsPage.requestInvitation', 'Request an invitation')}
        </Button>
      </div>
    );
  } else if (isFull && !isUserRegistered) {
    panelTitle = t('eventsPage.fullTitle', 'Fully booked');
    panelIcon = AlertCircle;
    panelTone = 'gray';
    panelBody = (
      <div className="flex items-center gap-2 rounded-xl bg-amber-50 p-3 text-amber-800 ring-1 ring-amber-200">
        <AlertCircle className="h-5 w-5 shrink-0" aria-hidden="true" />
        <span className="font-medium">{t('eventsPage.eventFull', 'This event is full')}</span>
      </div>
    );
  } else if (user && isUserRegistered) {
    panelTitle = t('eventsPage.youreRegistered', "You're registered");
    panelIcon = CheckCircle2;
    panelTone = 'green';
    panelBody = (
      <div className="space-y-4">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-600">{t('eventsPage.whatNext', 'What happens next')}</p>
          <ol className="space-y-2 text-sm text-gray-700">
            {calendarEvent && (
              <li className="flex gap-2">
                <CalendarPlus className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <span>{t('eventsPage.nextCalendar', 'Save the date in your calendar.')}</span>
              </li>
            )}
            {isWebinar ? (
              <li className="flex gap-2">
                <Video className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <span>
                  {event.meeting_url
                    ? t('eventsPage.nextJoinReady', 'At the start time, join from this page with the button below.')
                    : t('eventsPage.nextJoinLater', 'The joining link will appear on this page before the webinar starts.')}
                </span>
              </li>
            ) : (
              <li className="flex gap-2">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <span>{t('eventsPage.nextVenue', 'On the day, come to the venue — the address and map are on this page.')}</span>
              </li>
            )}
            <li className="flex gap-2">
              <ListChecks className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              <span>{t('eventsPage.nextManage', 'All your registrations are in My events, in your account.')}</span>
            </li>
          </ol>
        </div>
        {joinButton}
        {calendarEvent && (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">{t('events.addToCalendar')}</p>
            <AddToCalendarButtons event={calendarEvent} />
          </div>
        )}
        {viewMyEvents}
        <Button
          variant="ghost"
          className="h-11 w-full rounded-xl text-red-700 hover:bg-red-50 hover:text-red-800"
          onClick={handleUnregister}
          disabled={unregistering}
        >
          {unregistering ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <X className="mr-2 h-4 w-4" aria-hidden="true" />}
          {t('eventsPage.cancelMine', 'Cancel my registration')}
        </Button>
      </div>
    );
  } else if (user && !profileComplete) {
    panelTitle = event.invitation_only ? t('eventsPage.requestInvitation', 'Request an invitation') : t('events.register');
    panelIcon = Ticket;
    panelTone = 'navy';
    panelBody = (
      <div className="space-y-3">
        <div className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <span>{t('eventsPage.completeProfileFirst', 'Please complete your profile to register for events.')}</span>
        </div>
        <Button className="h-11 w-full rounded-xl" onClick={() => navigate('/onboarding')}>
          {t('eventsPage.completeProfile', 'Complete my profile')}
        </Button>
      </div>
    );
  } else if (user && profileComplete) {
    panelTitle = justSignedUp
      ? t('eventsPage.yourRegistration', 'Your registration')
      : event.invitation_only ? t('eventsPage.requestInvitation', 'Request an invitation') : t('events.register');
    panelIcon = justSignedUp ? CheckCircle2 : Ticket;
    panelTone = justSignedUp ? 'green' : 'navy';
    panelBody = (
      <EventRegistrationFlow
        eventId={event.id}
        eventType={event.event_type}
        invitationOnly={event.invitation_only}
        packages={packages}
        eventTitle={event.title}
        eventDescription={event.description}
        eventDateTime={event.date_time}
        eventEndDateTime={event.end_date_time}
        eventLocation={event.location}
        eventMeetingUrl={event.meeting_url}
        onRegistrationChange={(reg, count) => {
          setRegistrationCount(count);
          setJustSignedUp(reg);
        }}
      />
    );
  } else if (isWebinar && event.access_level === 'public' && !event.invitation_only) {
    panelTitle = justSignedUp ? t('eventsPage.yourRegistration', 'Your registration') : t('eventsPage.registerWebinar', 'Register for this webinar');
    panelIcon = justSignedUp ? CheckCircle2 : Ticket;
    panelTone = justSignedUp ? 'green' : 'navy';
    panelBody = (
      <div className="space-y-3">
        <LightweightWebinarSignup
          eventId={event.id}
          eventTitle={event.title}
          onRegistered={() => {
            setRegistrationCount((c) => c + 1);
            setJustSignedUp(true);
          }}
        />
        <div className="border-t pt-3 text-center text-sm text-gray-600">
          {t('auth.haveAccount')}{' '}
          <button
            type="button"
            className="rounded font-medium text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            onClick={() => setLoginOpen(true)}
          >
            {t('eventsPage.logIn', 'Log in')}
          </button>
        </div>
      </div>
    );
  } else {
    panelTitle = event.invitation_only ? t('eventsPage.requestInvitation', 'Request an invitation') : t('events.register');
    panelIcon = Ticket;
    panelTone = 'navy';
    panelBody = (
      <div className="space-y-3">
        <p className="text-sm text-gray-600">
          {event.access_level === 'public'
            ? t('eventsPage.loginIntro', 'Log in with your Smart Marina Connect account to register.')
            : t('eventsPage.loginIntroRestricted', 'This event is reserved for verified members. Log in to register.')}
        </p>
        <Button className="h-11 w-full rounded-xl" onClick={() => setLoginOpen(true)}>
          {event.invitation_only
            ? t('eventsPage.loginToRequestInvitation', 'Log in to request an invitation')
            : t('eventsPage.loginToRegister', 'Log in to register')}
        </Button>
        <p className="text-center text-sm text-gray-600">
          {t('eventsPage.noAccount', 'New here?')}{' '}
          <button
            type="button"
            className="rounded font-medium text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            onClick={() => setSignupOpen(true)}
          >
            {t('eventsPage.createAccount', 'Create an account')}
          </button>
        </p>
      </div>
    );
  }

  // ---------------------------------------------------------------- mobile action bar
  let barAction: React.ReactNode = null;
  const barBtn = 'h-11 shrink-0 rounded-xl px-4';
  if (hasEnded) {
    if (event.replay_url) {
      barAction = (
        <Button asChild className={barBtn}>
          <a href={event.replay_url} target="_blank" rel="noopener noreferrer"><Play className="mr-2 h-4 w-4" aria-hidden="true" />{t('eventsPage.replayShort', 'Replay')}</a>
        </Button>
      );
    }
  } else if (isLive) {
    if (isUserRegistered && joinButton) {
      barAction = (
        <Button asChild className={barBtn}>
          <a href={event.meeting_url!} target="_blank" rel="noopener noreferrer"><Video className="mr-2 h-4 w-4" aria-hidden="true" />{t('eventsPage.joinNow', 'Join now')}</a>
        </Button>
      );
    }
  } else if (smRegisterPath) {
    barAction = <Button className={barBtn} onClick={() => navigate(smRegisterPath)}>{t('events.register')}</Button>;
  } else if (guestListPath) {
    barAction = <Button className={barBtn} onClick={() => navigate(guestListPath)}><Lock className="mr-2 h-4 w-4" aria-hidden="true" />{t('eventsPage.requestShort', 'Request')}</Button>;
  } else if (isFull && !isUserRegistered) {
    barAction = <span className="shrink-0 text-sm font-medium text-amber-800">{t('eventsPage.fullTitle', 'Fully booked')}</span>;
  } else if (user && isUserRegistered) {
    barAction = isWebinar && event.meeting_url ? (
      <Button asChild className={barBtn}>
        <a href={event.meeting_url} target="_blank" rel="noopener noreferrer"><Video className="mr-2 h-4 w-4" aria-hidden="true" />{t('eventsPage.joinShort', 'Join')}</a>
      </Button>
    ) : calendarEvent ? (
      <Button className={barBtn} onClick={() => downloadICS(calendarEvent)}>
        <CalendarPlus className="mr-2 h-4 w-4" aria-hidden="true" />{t('eventsPage.addToCalendarShort', 'Add to calendar')}
      </Button>
    ) : null;
  } else if (justSignedUp) {
    barAction = <Button variant="outline" className={barBtn} onClick={scrollToPanel}>{t('eventsPage.yourRegistration', 'Your registration')}</Button>;
  } else {
    barAction = (
      <Button className={barBtn} onClick={scrollToPanel}>
        {event.invitation_only ? t('eventsPage.requestShort', 'Request') : t('events.register')}
      </Button>
    );
  }
  const showBar = !!barAction && !panelInView && !endInView;

  const PanelIcon = panelIcon;
  const toneClasses: Record<typeof panelTone, string> = {
    navy: 'bg-primary text-white',
    green: 'bg-emerald-700 text-white',
    red: 'bg-red-600 text-white',
    gray: 'bg-gray-800 text-white',
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Helmet>
        <title>{event.title} — Events — Smart Marina Connect</title>
        <meta name="description" content={event.description?.substring(0, 160) || `Join ${event.title} on Smart Marina Connect`} />
        <meta property="og:title" content={`${event.title} — Smart Marina Connect`} />
        <meta property="og:description" content={event.description?.substring(0, 160) || ''} />
        <meta property="og:type" content="event" />
      </Helmet>

      {/* ── Header: what, when, where, which language, for whom ── */}
      <section className="relative overflow-hidden text-white">
        <CoverImage
          src={eventCover(event)?.src ?? null}
          focusY={eventCover(event)?.focusY}
          alt=""
          seed={event.id}
          icon={isWebinar ? Video : CalendarDays}
          aspect="fill"
          tone="sea"
          eager
          className="absolute inset-0"
        />
        <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-[#0b2653]/95 via-[#0b2653]/80 to-[#0b2653]/55" />
        <div className="relative container mx-auto px-4 pb-10 pt-6 sm:pb-14">
          <Link
            to="/events"
            className="inline-flex min-h-10 items-center gap-1 rounded-lg pr-2 text-sm text-white/85 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            {t('eventsPage.backToEvents', 'Back to events')}
          </Link>

          <div className="mt-5 flex items-start gap-4 sm:gap-6">
            <HeaderDateChip iso={event.date_time} endIso={event.end_date_time} locale={locale} />
            <div className="min-w-0 flex-1">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <HeroChip icon={isWebinar ? Video : CalendarDays}>
                  {isWebinar ? t('eventsPage.webinar', 'Webinar') : t('eventsPage.onSite', 'On-site event')}
                </HeroChip>
                <HeroChip icon={event.access_level === 'public' ? Users : Lock}>{accessText}</HeroChip>
                {event.invitation_only && <HeroChip icon={Lock}>{t('eventsPage.invitationOnly', 'By invitation')}</HeroChip>}
                {isLive && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-red-600 px-3 py-1 text-xs font-semibold">
                    <Radio className="h-3.5 w-3.5" aria-hidden="true" />{t('eventsPage.liveNow', 'Live now')}
                  </span>
                )}
                {hasEnded && <HeroChip>{t('eventsPage.ended', 'Ended')}</HeroChip>}
                {registeredNow && !hasEnded && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-700 px-3 py-1 text-xs font-semibold">
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />{t('eventsPage.youreRegistered', "You're registered")}
                  </span>
                )}
                {!event.published && isModerator && (
                  <span className="inline-flex items-center rounded-full border border-dashed border-white/60 px-3 py-1 text-xs font-medium">
                    {t('eventsPage.draft', 'Draft')}
                  </span>
                )}
              </div>

              <h1 className="max-w-4xl text-2xl font-bold leading-tight tracking-tight drop-shadow-sm sm:text-3xl lg:text-4xl">{event.title}</h1>

              <dl className="mt-5 grid gap-x-8 gap-y-3 text-sm text-white/90 sm:grid-cols-2 lg:max-w-3xl">
                <HeaderFact icon={CalendarDays} label={t('eventsPage.factWhen', 'When')}>
                  <span className="block">{dateLine}</span>
                  {timeLine && <span className="block text-white/75">{timeLine}</span>}
                </HeaderFact>
                <HeaderFact icon={isWebinar ? Video : MapPin} label={t('eventsPage.factWhere', 'Where')}>
                  {isWebinar ? (
                    <span className="block">{t('eventsPage.onlineWebinar', 'Online — link given to registered attendees')}</span>
                  ) : (
                    <>
                      <span className="block">{venueLine || t('eventsPage.venueTbd', 'Venue to be announced')}</span>
                      {addressLine && addressLine !== venueLine && <span className="block text-white/75">{addressLine}</span>}
                      {mapLink && (
                        <a
                          href={mapLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-1 inline-flex min-h-8 items-center gap-1 rounded font-medium text-secondary underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
                        >
                          {t('eventsPage.openMap', 'Open in Maps')}<ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                        </a>
                      )}
                    </>
                  )}
                </HeaderFact>
                {language && (
                  <HeaderFact icon={Languages} label={t('eventsPage.factLanguage', 'Language')}>
                    <span className="block">{language}</span>
                  </HeaderFact>
                )}
                {event.fees && (
                  <HeaderFact icon={Ticket} label={t('eventsPage.factFees', 'Fees')}>
                    <span className="block">{event.fees}</span>
                  </HeaderFact>
                )}
              </dl>

              {themes.length > 0 && (
                <ul className="mt-5 flex flex-wrap gap-2" aria-label={t('eventsPage.topics', 'Topics')}>
                  {themes.map((k) => {
                    const th = getTheme(k)!;
                    return (
                      <li key={k}>
                        <Link
                          to={`/events?theme=${k}`}
                          className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-medium text-white backdrop-blur-sm hover:bg-white/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
                        >
                          <th.icon className="h-3.5 w-3.5" aria-hidden="true" />{t(th.labelKey, th.fallback)}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ── Content ── */}
      <div className="container mx-auto px-4 py-8 lg:py-12">
        <div className="grid gap-6 lg:grid-cols-3 lg:gap-8">
          {/* Participation: first on phones, sticky sidebar on desktop. */}
          <aside className="lg:col-start-3 lg:row-start-1">
            <div ref={panelRef} id="participate" className="scroll-mt-20 lg:sticky lg:top-20">
              <div className="overflow-hidden rounded-2xl bg-white shadow-md ring-1 ring-gray-100">
                <div className={cn('flex items-center gap-2.5 px-5 py-4', toneClasses[panelTone])}>
                  <PanelIcon className="h-5 w-5 shrink-0" aria-hidden="true" />
                  <h2 ref={panelHeadingRef} tabIndex={-1} className="text-base font-semibold focus:outline-none">{panelTitle}</h2>
                </div>
                <div className="space-y-4 p-5">
                  {!hasStarted && event.invitation_only && !guestListPath && !smRegisterPath && !isUserRegistered && (
                    <div className="flex items-center gap-2 rounded-xl bg-gray-50 p-3 text-sm text-gray-700 ring-1 ring-gray-200">
                      <Lock className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <span>{t('eventsPage.invitationOnlyNote', 'This is an invitation-only event.')}</span>
                    </div>
                  )}
                  {panelBody}
                </div>
              </div>
            </div>
          </aside>

          {/* Main column */}
          <div className="space-y-6 lg:col-span-2 lg:col-start-1 lg:row-start-1">
            {event.description && (
              <Section icon={FileText} title={t('eventsPage.about', 'About this event')}>
                <div className="whitespace-pre-wrap leading-relaxed text-gray-700">{event.description}</div>
              </Section>
            )}

            {/* SM26 programme — shown for the Smart Marina event */}
            {smEventId && (
              <Section icon={CalendarDays} title={t('eventsPage.programme', 'Programme')}>
                <SM26Agenda eventId={smEventId} />
              </Section>
            )}

            {speakers.length > 0 && (
              <Section icon={Mic2} title={t('events.speakers', 'Speakers')} aside={String(speakers.length)}>
                <ul className="grid gap-3 sm:grid-cols-2">
                  {speakers.map((speaker, idx) => {
                    const initials = speaker.name.split(/\s+/).filter(Boolean).map((n) => n[0]).join('').slice(0, 2).toUpperCase();
                    const inner = (
                      <>
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                          {initials}
                        </div>
                        <div className="min-w-0">
                          <div className={cn('font-medium', speaker.profile_id ? 'text-primary' : 'text-gray-900')}>{speaker.name}</div>
                          {speaker.title && <div className="text-sm text-gray-600">{speaker.title}</div>}
                        </div>
                      </>
                    );
                    return (
                      <li key={idx}>
                        {speaker.profile_id ? (
                          <Link
                            to={`/users/${speaker.profile_id}`}
                            className="flex items-center gap-3 rounded-xl bg-gray-50 p-3 transition-colors hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          >
                            {inner}
                          </Link>
                        ) : (
                          <div className="flex items-center gap-3 rounded-xl bg-gray-50 p-3">{inner}</div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </Section>
            )}

            {/* Location (on-site) */}
            {!isWebinar && (venueLine || addressLine || embedMap || mapLink) && (
              <Section icon={MapPin} title={t('eventsPage.location', 'Location')}>
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="text-gray-700">
                    {venueLine && <p className="font-medium text-gray-900">{venueLine}</p>}
                    {addressLine && addressLine !== venueLine && <p>{addressLine}</p>}
                  </div>
                  {mapLink && (
                    <Button asChild variant="outline" className="h-11 shrink-0 rounded-xl">
                      <a href={mapLink} target="_blank" rel="noopener noreferrer">
                        <MapPin className="mr-2 h-4 w-4" aria-hidden="true" />{t('eventsPage.openMap', 'Open in Maps')}
                      </a>
                    </Button>
                  )}
                </div>
                {embedMap && (
                  <div className="mt-4 h-64 overflow-hidden rounded-xl ring-1 ring-gray-200">
                    <iframe
                      src={embedMap}
                      width="100%"
                      height="100%"
                      style={{ border: 0 }}
                      allowFullScreen
                      loading="lazy"
                      referrerPolicy="no-referrer-when-downgrade"
                      title={t('eventsPage.mapTitle', 'Map of the venue')}
                    />
                  </div>
                )}
              </Section>
            )}

            {/* Packages (on-site events) */}
            {!isWebinar && packages.length > 0 && (
              <Section icon={Package} title={t('eventsPage.packages', 'Registration packages')}>
                <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {packages.map((pkg) => (
                    <li key={pkg.id} className="rounded-xl p-4 ring-1 ring-gray-200">
                      <h3 className="mb-1 font-semibold text-gray-900">{pkg.name}</h3>
                      {pkg.description && <p className="mb-3 text-sm text-gray-600">{pkg.description}</p>}
                      <div className="flex items-baseline gap-1">
                        <span className="text-2xl font-bold text-primary">{formatPrice(pkg.price_cents)}</span>
                        {pkg.price_cents > 0 && <span className="text-xs text-gray-600">{t('eventsPage.perPerson', '/ person')}</span>}
                      </div>
                      {pkg.max_seats != null && (
                        <p className="mt-1 text-xs text-gray-600">{t('eventsPage.seatsAvailable', { count: pkg.max_seats, defaultValue_one: '{{count}} seat available', defaultValue_other: '{{count}} seats available' })}</p>
                      )}
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {partners.length > 0 && (
              <Section icon={Building2} title={t('eventsPage.partners', 'Event partners')}>
                <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {partners.map((partner, idx) => (
                    <li key={idx} className="flex items-center gap-3 rounded-xl bg-gray-50 p-3">
                      <LogoBadge src={partner.logo_url} name={partner.name} />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-gray-900">{partner.name}</div>
                        {partner.website && (
                          <a
                            href={partner.website}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex min-h-8 items-center gap-1 rounded text-xs font-medium text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          >
                            <Globe className="h-3 w-3" aria-hidden="true" /> {t('eventsPage.website', 'Website')}
                          </a>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {(event.pdf_url || event.brochure_url || event.event_website_url) && (
              <Section icon={FileDown} title={t('eventsPage.documents', 'Documents & links')}>
                <ul className="grid gap-3 sm:grid-cols-2">
                  {event.pdf_url && (
                    <DocLink href={event.pdf_url} icon={Download} label={t('eventsPage.presentation', 'Presentation')} hint={t('eventsPage.downloadPdf', 'Download the PDF')} />
                  )}
                  {event.brochure_url && (
                    <DocLink href={event.brochure_url} icon={FileDown} label={t('eventsPage.brochure', 'Brochure')} hint={t('eventsPage.downloadBrochure', 'Download the brochure')} />
                  )}
                  {event.event_website_url && (
                    <DocLink href={event.event_website_url} icon={ExternalLink} label={t('eventsPage.eventWebsite', 'Event website & programme')} hint={t('eventsPage.opensNewTab', 'Opens in a new tab')} />
                  )}
                </ul>
              </Section>
            )}

            {/* Participants */}
            {registrationCount > 0 && (
              <Section
                icon={UserCheck}
                title={t('eventsPage.participants', 'Participants')}
                aside={t('eventsPage.registeredCount', { count: registrationCount, defaultValue_one: '{{count}} registered', defaultValue_other: '{{count}} registered' })}
              >
                {user ? (
                  participants.length > 0 ? (
                    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {participants.map((p) => {
                        const name = [p.first_name, p.last_name].filter(Boolean).join(' ') || t('eventsPage.member', 'Member');
                        return (
                          <li key={p.user_id}>
                            <Link
                              to={`/users/${p.user_id}`}
                              className="flex items-center gap-3 rounded-xl bg-gray-50 p-3 transition-colors hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                            >
                              {p.avatar_url ? (
                                <img src={p.avatar_url} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />
                              ) : (
                                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary" aria-hidden="true">
                                  {((p.first_name?.[0] || '') + (p.last_name?.[0] || '')).toUpperCase() || '?'}
                                </div>
                              )}
                              <div className="min-w-0">
                                <div className="truncate text-sm font-medium text-primary">{name}</div>
                                {p.job_title && <div className="truncate text-xs text-gray-600">{p.job_title}</div>}
                                {p.org_name && <div className="truncate text-xs text-gray-500">{p.org_name}</div>}
                              </div>
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="text-sm text-gray-600">
                      {participantsLoaded
                        ? t('eventsPage.participantsHidden', 'The list of attendees is not visible to you.')
                        : t('eventsPage.loadingParticipants', 'Loading participants…')}
                    </p>
                  )
                ) : (
                  <div className="flex items-center gap-3 rounded-xl bg-gray-50 p-4 text-gray-700">
                    <Lock className="h-5 w-5 shrink-0 text-gray-500" aria-hidden="true" />
                    <span className="text-sm">
                      {t('eventsPage.participantsLocked', { count: registrationCount, defaultValue_one: '{{count}} participant registered.', defaultValue_other: '{{count}} participants registered.' })}{' '}
                      <button
                        type="button"
                        className="rounded font-medium text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        onClick={() => setLoginOpen(true)}
                      >
                        {t('eventsPage.logInToSee', "Log in to see who's attending.")}
                      </button>
                    </span>
                  </div>
                )}
              </Section>
            )}
          </div>
        </div>
        {/*
          The mobile bar stays up until this marker reaches the screen, then steps
          aside for the footer. The spacer above it is the bar's height, so the
          last lines of content are never left hidden underneath it.
        */}
        <div aria-hidden="true" className="h-16 lg:hidden" />
        <div ref={endRef} aria-hidden="true" className="h-px" />
      </div>

      {/* ── Mobile action bar ── */}
      {showBar && (
        <div
          className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white/95 shadow-[0_-4px_16px_rgba(11,38,83,0.08)] backdrop-blur lg:hidden"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          <div className="container mx-auto flex items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-gray-900">{event.title}</p>
              <p className="flex items-center gap-1 truncate text-xs text-gray-600">
                <Clock className="h-3 w-3 shrink-0" aria-hidden="true" />
                {registeredNow && !hasEnded ? `${t('eventsPage.registered', 'Registered')} · ${shortWhen}` : shortWhen}
              </p>
            </div>
            {barAction}
          </div>
        </div>
      )}

      {/* Login Dialog */}
      <Dialog open={loginOpen} onOpenChange={setLoginOpen}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>{t('auth.login')}</DialogTitle>
            <DialogDescription>
              {t('eventsPage.loginToRegisterDesc', 'Log in to register for this event.')}{' '}
              <button className="text-primary hover:underline" onClick={() => { setLoginOpen(false); setSignupOpen(true); }}>
                {t('auth.signup')}
              </button>
            </DialogDescription>
          </DialogHeader>
          <LoginForm onSuccess={() => setLoginOpen(false)} />
        </DialogContent>
      </Dialog>

      {/* Signup Dialog */}
      <Dialog open={signupOpen} onOpenChange={setSignupOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto rounded-2xl">
          <DialogHeader>
            <DialogTitle>{t('auth.signup')}</DialogTitle>
            <DialogDescription>
              {t('auth.haveAccount')}{' '}
              <button className="text-primary hover:underline" onClick={() => { setSignupOpen(false); setLoginOpen(true); }}>
                {t('auth.login')}
              </button>
            </DialogDescription>
          </DialogHeader>
          <SignupForm onSuccess={() => setSignupOpen(false)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ─── Pieces ─────────────────────────────────────────────────────── */

function Section({ icon: Icon, title, aside, children }: {
  icon: LucideIcon; title: string; aside?: string; children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100 lg:p-8">
      <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-gray-900">
        <Icon className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
        <span>{title}</span>
        {aside && <span className="ml-auto text-sm font-normal tabular-nums text-gray-600">{aside}</span>}
      </h2>
      {children}
    </section>
  );
}

function HeroChip({ icon: Icon, children }: { icon?: LucideIcon; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-3 py-1 text-xs font-medium backdrop-blur-sm">
      {Icon && <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
      {children}
    </span>
  );
}

function HeaderFact({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2.5">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-secondary" aria-hidden="true" />
      <div className="min-w-0">
        <dt className="text-xs font-semibold uppercase tracking-wide text-white/70">{label}</dt>
        <dd className="mt-0.5">{children}</dd>
      </div>
    </div>
  );
}

/** The big calendar-page chip in the header: month, day (or "20–21"), weekday. */
function HeaderDateChip({ iso, endIso, locale }: { iso: string | null; endIso: string | null; locale: string }) {
  const { t } = useTranslation();
  if (!iso) {
    return (
      <div className="hidden w-20 shrink-0 rounded-2xl bg-white px-2 py-3 text-center text-primary shadow-lg sm:block">
        <span className="block text-xs font-bold uppercase tracking-wide">{t('eventsPage.tbdShort', 'TBA')}</span>
      </div>
    );
  }
  const start = new Date(iso);
  const end = endIso ? new Date(endIso) : null;
  const sameMonthSpan = !!end && end.toDateString() !== start.toDateString()
    && end.getMonth() === start.getMonth() && end.getFullYear() === start.getFullYear();
  return (
    <div className="w-16 shrink-0 overflow-hidden rounded-2xl bg-white text-center shadow-lg sm:w-20">
      <span className="block bg-secondary px-1 py-1 text-[11px] font-bold uppercase tracking-wide text-primary sm:text-xs">
        {start.toLocaleDateString(locale, { month: 'short' })}
      </span>
      <span className={cn('block px-1 pt-1.5 font-bold leading-none tabular-nums text-primary', sameMonthSpan ? 'text-xl sm:text-2xl' : 'text-3xl sm:text-4xl')}>
        {sameMonthSpan ? `${start.getDate()}–${end!.getDate()}` : start.getDate()}
      </span>
      <span className="block pb-2 pt-1 text-[11px] font-medium text-gray-600">
        {start.getFullYear()}
      </span>
    </div>
  );
}

function DocLink({ href, icon: Icon, label, hint }: { href: string; icon: LucideIcon; label: string; hint: string }) {
  return (
    <li>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="group flex items-center gap-3 rounded-xl p-3 ring-1 ring-gray-200 transition hover:bg-gray-50 hover:ring-primary/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <span className="block truncate font-medium text-gray-900 group-hover:text-primary">{label}</span>
          <span className="block truncate text-xs text-gray-600">{hint}</span>
        </span>
      </a>
    </li>
  );
}
