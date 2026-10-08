import { useState, useEffect, useRef, type ReactNode } from 'react';
import { externalUrl } from '@/lib/externalUrl';
import { useParams, Link, Navigate, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Seo } from '@/components/seo/Seo';
import { useSeoTr } from '@/components/seo/useSeoTr';
import { eventMeta } from '@/lib/seoMeta';
import type { LucideIcon } from 'lucide-react';
import {
  AlertCircle, CalendarDays, CalendarPlus, CheckCircle2, Clock, Download,
  ExternalLink, FileDown, Globe, Languages, ListChecks, Loader2, Lock, MapPin,
  Play, Radio, Ticket, Users, Video, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { LoginForm } from '@/components/auth/LoginForm';
import { SignupForm } from '@/components/auth/SignupForm';
import { LoadingSkeleton } from '@/components/LoadingSkeleton';
import { CardShell } from '@/components/brand/CardShell';
import { ContactCard } from '@/components/brand/ContactCard';
import { Eyebrow } from '@/components/brand/Eyebrow';
import { UnderlineLink } from '@/components/brand/UnderlineLink';
import { LogoTile } from '@/components/brand/OrgCard';
import { featuredEventItems, RENDEZVOUS_2026_PATH } from '@/components/brand/m3Events';
import { Reveal, RevealGroup } from '@/components/motion/Reveal';
import { SponsorsBand } from '@/components/home/SponsorsBand';
import {
  DetailSection, EventHeader, HeaderChip, HeaderFact, OtherEventCard, RendezvousFigures, SectionNav,
  useEventSponsors, type NavItem,
} from '@/components/events/EventDetailParts';
import { coverFor } from '@/components/events/EventListParts';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
import { SM26_ENABLED } from '@/lib/featureFlags';
import { getTheme, themesForSectors } from '@/lib/themes';
import { accountHref } from '@/lib/accountNav';
import { cn, downloadICS, type CalendarEventInput } from '@/lib/utils';
import { withSiteSuffix } from '@/lib/seoText';
import { EventRegistrationFlow } from '@/components/events/EventRegistrationFlow';
import { LightweightWebinarSignup } from '@/components/events/LightweightWebinarSignup';
import { AddToCalendarButtons } from '@/components/events/AddToCalendarButtons';
import { SM26Agenda } from '@/components/sm26/SM26Agenda';
// The World Yachting Summit's events row redirects to its one page (/wys26).
import { WYS26_EVENT_ID } from '@/components/brand/m3Events';
import { WYS26_PATH } from '@/components/events/WysInvitationCard';

/** The Monaco Smart & Sustainable Marina Rendezvous, 6th edition: the page that carries the figures and the sponsors. */
const RENDEZVOUS_2026_ID = RENDEZVOUS_2026_PATH.split('/').pop();
/** The edition's public site, as linked from the home page. */
const RENDEZVOUS_SITE = 'https://sustainablesmartmarina.com';

/**
 * One event, and where the visitor stands with it.
 *
 * Refonte v2 (Oct 2026): a header in the spirit of the home split hero (text on
 * marine, status pill, rounded photo frame with the date block), a sticky section
 * nav that follows what the page really shows, white section cards, a sticky
 * participation card on the side, and, for the Monaco Smart & Sustainable Marina
 * Rendezvous (6th edition), the figures and the event sponsors by tier. Every
 * event ends on the other M3 events and the one public contact. The pieces that
 * draw live in components/events/EventDetailParts.tsx.
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

/** A row of get_event_participants: member registrants the viewer may see, safe columns only. */
interface EventParticipant {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
  job_title: string | null;
  org_name: string | null;
  org_logo_url: string | null;
}

/** A row of get_my_event_access: the join link is only ever handed to a registrant or to staff. */
interface EventAccess {
  event_id: string;
  is_registered: boolean;
  meeting_url: string | null;
}

/**
 * Every column the page shows. Not select('*'): the webinar join link
 * (meeting_url) is read through get_my_event_access, never with the event.
 */
const EVENT_COLUMNS = 'id, title, description, date_time, end_date_time, is_full_day, location, language, access_level, event_type, invitation_only, published, speakers, replay_url, pdf_url, brochure_url, event_website_url, event_partners, location_details, fees, max_attendance, created_at, image_url';

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
  // The World Yachting Summit 2026 has one page, /wys26 (Victor, 8 Oct 2026):
  // its events row (a draft) is never shown here.
  if (id === WYS26_EVENT_ID) return <Navigate to={WYS26_PATH} replace />;
  return <EventDetailContent />;
}

function EventDetailContent() {
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
  const locale = i18n.language?.startsWith('fr') ? 'fr-FR' : 'en-GB';
  const seoTr = useSeoTr();

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

  // Whether the logged-in user holds a registration for this event (their own
  // row, or a guest row made with their confirmed e-mail before they had an
  // account), and the webinar join link — which the server hands only to a
  // registrant or to staff. An invitation request still waiting for the
  // organisers is not a registration: the member flow below shows it as such.
  const [meetingUrl, setMeetingUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!id || !userId) {
      setIsUserRegistered(false);
      setMeetingUrl(null);
      return;
    }
    let alive = true;
    supabase
      .rpc('get_my_event_access', { p_event_ids: [id] })
      .then(({ data }) => {
        if (!alive) return;
        const access = ((data ?? []) as EventAccess[])[0];
        setIsUserRegistered(!!access?.is_registered);
        setMeetingUrl(access?.meeting_url ?? null);
      });
    return () => { alive = false; };
  }, [id, userId]);

  // After registering or cancelling on this page, fetch the link again. Only
  // the link: the panel keeps showing the flow (and its confirmation) until reload.
  const refreshMeetingUrl = () => {
    if (!id || !userId) return;
    supabase
      .rpc('get_my_event_access', { p_event_ids: [id] })
      .then(({ data }) => setMeetingUrl(((data ?? []) as EventAccess[])[0]?.meeting_url ?? null));
  };

  // The event itself. Only the first load of a given event shows the skeleton.
  // A failed read (network, timeout, server error) is not "no such event": it
  // shows a Retry screen without noindex, so Google never drops a real page
  // because one request failed while it was rendering it.
  const loadedIdRef = useRef<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  useEffect(() => {
    if (!id) return;
    let alive = true;
    if (loadedIdRef.current !== id) setLoading(true);
    (async () => {
      const { data, error } = await supabase
        .from('events')
        .select(EVENT_COLUMNS)
        .eq('id', id)
        .single();
      if (!alive) return;

      if (error) {
        if (import.meta.env.DEV) console.error('Error fetching event:', error);
        // PGRST116: no row for this reader; 22P02: the id is not a UUID. Both
        // mean the event does not exist. Anything else is a failed read: a
        // page already on screen stays, a first load shows Retry.
        const missing = error.code === 'PGRST116' || error.code === '22P02';
        if (missing) {
          setEvent(null);
          setLoadFailed(false);
          loadedIdRef.current = id;
        } else if (loadedIdRef.current !== id) {
          setEvent(null);
          setLoadFailed(true);
        }
      } else {
        const ev = data as EventDetail;
        // Hide unpublished events from non-admins
        setEvent(ev.published === false && !isModerator ? null : ev);
        setLoadFailed(false);
        loadedIdRef.current = id;
      }
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [id, isModerator, loadAttempt]);

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

  // Registration count (members + guests). Registrations are private rows, so
  // the number comes from the server, for signed-in visitors as before.
  useEffect(() => {
    if (!id || !userId) { setRegistrationCount(0); return; }
    let alive = true;
    supabase
      .rpc('get_event_registration_counts', { p_event_id: id })
      .maybeSingle()
      .then(({ data }) => {
        if (alive) setRegistrationCount((data as { total: number | null } | null)?.total ?? 0);
      });
    return () => { alive = false; };
  }, [id, userId]);

  // Participants for logged-in users: names, titles and companies of the
  // member registrants they may see — never guest contact details.
  useEffect(() => {
    if (!id || !userId) return;
    let alive = true;
    supabase
      .rpc('get_event_participants', { p_event_id: id })
      .then(({ data, error }) => {
        if (!alive) return;
        if (!error && data) setParticipants(data as EventParticipant[]);
        setParticipantsLoaded(true);
      });
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
        refreshMeetingUrl();
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

  // The Rendezvous page also shows the event sponsors, by tier (the home page's read).
  const isRendezvous = !!id && id === RENDEZVOUS_2026_ID;
  const { sponsors, loading: sponsorsLoading } = useEventSponsors(isRendezvous);

  // ---------------------------------------------------------------- render
  // A whole screen tall (same loader as the lazy routes): the footer stays below the fold, so the page arriving does not shift.
  if (loading) return <LoadingSkeleton variant="screen" />;

  if (!event && loadFailed) {
    // No <Seo> here: the head the edge function wrote stays as it is.
    return (
      <div className="min-h-[60vh] bg-page px-4 py-16">
        <CardShell className="mx-auto max-w-md items-center p-8 text-center">
          <span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-chip text-navy">
            <CalendarDays className="h-7 w-7" aria-hidden="true" />
          </span>
          <h1 className="mb-2 text-h3 text-navy">{t('common.loadFailedTitle', 'This page could not be loaded')}</h1>
          <p className="mb-6 text-sm text-meta">{t('common.loadFailedBody', 'The connection may be slow or interrupted. Please try again.')}</p>
          <div className="flex flex-wrap justify-center gap-3">
            <Button asChild variant="ctaOutline" size="sm" arrow={false}>
              <Link to="/events">{t('eventsPage.backToEvents', 'Back to events')}</Link>
            </Button>
            <Button variant="cta" size="sm" arrow={false} onClick={() => setLoadAttempt((n) => n + 1)}>
              {t('common.retry', 'Try again')}
            </Button>
          </div>
        </CardShell>
      </div>
    );
  }

  if (!event) {
    return (
      <div className="min-h-[60vh] bg-page px-4 py-16">
        <Seo title={withSiteSuffix(t('eventsPage.notFound', 'Event not found'))} noindex />
        <CardShell className="mx-auto max-w-md items-center p-8 text-center">
          <span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-chip text-navy">
            <CalendarDays className="h-7 w-7" aria-hidden="true" />
          </span>
          <h1 className="mb-2 text-h3 text-navy">{t('eventsPage.notFound', 'Event not found')}</h1>
          <p className="mb-6 text-sm text-meta">{t('eventsPage.notFoundBody', 'This event may have been removed, or it is not published yet.')}</p>
          <Button asChild variant="cta" size="sm">
            <Link to="/events">{t('eventsPage.backToEvents', 'Back to events')}</Link>
          </Button>
        </CardShell>
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

  // The Rendezvous record's own text still carries a patronage line and counts that are not
  // cleared as published figures: its page prints the curated About text instead (SEO,
  // calendar entry and registration included). Every other event prints its record as before.
  const eventText = isRendezvous ? t('eventDetail.rendezvousAbout') : event.description;

  const calendarEvent: CalendarEventInput | null = event.date_time ? {
    title: event.title,
    description: eventText,
    date_time: event.date_time,
    end_date_time: event.end_date_time,
    location: event.location,
    url: meetingUrl,
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

  // Title and meta description: the event's own name, then "when, where" before the summary —
  // what someone searching for the event wants to read first. Canonical URL, share card and
  // JSON-LD come with them, from the builder the edge function also uses (src/lib/seoMeta.ts).
  const seo = eventMeta(isRendezvous ? { ...event, description: eventText } : event, seoTr, locale);

  // ---------------------------------------------------------------- participation card
  let panelTitle: string;
  let panelIcon: LucideIcon;
  let panelTone: 'navy' | 'green' | 'red' | 'gray';
  let panelBody: React.ReactNode;

  // Buttons of the participation card: the main action is the page's gold pill,
  // the others navy outlines (the dense registration forms keep their own buttons).
  const MAIN_BTN = 'w-full justify-between';

  const viewMyEvents = (
    <Button variant="ctaOutline" size="sm" className={MAIN_BTN} onClick={() => navigate(accountHref('registrations'))}>
      {t('eventsPage.viewMyRegistrations', 'View my registrations')}
    </Button>
  );

  const joinButton = isWebinar && meetingUrl ? (
    <Button asChild variant="cta" className={MAIN_BTN}>
      <a href={meetingUrl} target="_blank" rel="noopener noreferrer">{t('eventsPage.joinWebinar', 'Join the webinar')}</a>
    </Button>
  ) : null;

  if (hasEnded) {
    panelTitle = t('eventsPage.endedTitle', 'This event has ended');
    panelIcon = event.replay_url ? Play : CalendarDays;
    panelTone = 'gray';
    panelBody = (
      <div className="space-y-4">
        {isUserRegistered && (
          <p className="flex items-center gap-2 text-sm text-ink">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-teal" aria-hidden="true" />
            {t('eventsPage.youWereRegistered', 'You were registered for this event.')}
          </p>
        )}
        {event.replay_url ? (
          <>
            <p className="text-sm leading-[22px] text-meta">{t('eventsPage.replayIntro', 'Missed it, or want to see it again? The full session is online.')}</p>
            <Button asChild variant="cta" className={MAIN_BTN}>
              <a href={event.replay_url} target="_blank" rel="noopener noreferrer">{t('events.watchReplay')}</a>
            </Button>
          </>
        ) : (
          <p className="text-sm leading-[22px] text-meta">{t('eventsPage.noReplay', 'No replay has been published for this event.')}</p>
        )}
        <UnderlineLink to="/events">{t('eventsPage.seeUpcoming', 'See upcoming events')}</UnderlineLink>
      </div>
    );
  } else if (isLive) {
    panelTitle = t('eventsPage.happeningNow', 'Happening now');
    panelIcon = Radio;
    panelTone = 'red';
    panelBody = isUserRegistered ? (
      <div className="space-y-3">
        <p className="flex items-center gap-2 text-sm font-medium text-navy">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-teal" aria-hidden="true" />
          {t('eventsPage.youreRegistered', "You're registered")}
        </p>
        {joinButton}
        {viewMyEvents}
      </div>
    ) : (
      <p className="text-sm leading-[22px] text-meta">{t('eventsPage.registrationClosedLive', 'This event is under way — registration closed when it started.')}</p>
    );
  } else if (smRegisterPath) {
    panelTitle = t('events.register');
    panelIcon = Ticket;
    panelTone = 'navy';
    panelBody = (
      <Button variant="cta" className={MAIN_BTN} onClick={() => navigate(smRegisterPath)}>
        {t('events.register')}
      </Button>
    );
  } else if (guestListPath) {
    panelTitle = t('eventsPage.requestInvitation', 'Request an invitation');
    panelIcon = Lock;
    panelTone = 'navy';
    panelBody = (
      <div className="space-y-4">
        <p className="text-sm leading-[22px] text-meta">{t('eventsPage.guestListIntro', 'Places are by invitation. Send a request and the organisers will come back to you.')}</p>
        <Button variant="cta" className={MAIN_BTN} onClick={() => navigate(guestListPath)}>
          {t('eventsPage.requestInvitation', 'Request an invitation')}
        </Button>
      </div>
    );
  } else if (isFull && !isUserRegistered) {
    panelTitle = t('eventsPage.fullTitle', 'Fully booked');
    panelIcon = AlertCircle;
    panelTone = 'gray';
    panelBody = (
      <div className="flex items-center gap-2 rounded-field bg-amber-50 p-3 text-amber-800 ring-1 ring-amber-200">
        <AlertCircle className="h-5 w-5 shrink-0" aria-hidden="true" />
        <span className="font-medium">{t('eventsPage.eventFull', 'This event is full')}</span>
      </div>
    );
  } else if (user && isUserRegistered) {
    panelTitle = t('eventsPage.youreRegistered', "You're registered");
    panelIcon = CheckCircle2;
    panelTone = 'green';
    panelBody = (
      <div className="space-y-5">
        <div>
          <p className="text-meta-caps mb-2.5">{t('eventsPage.whatNext', 'What happens next')}</p>
          <ol className="space-y-2.5 text-sm leading-[22px] text-ink">
            {calendarEvent && (
              <li className="flex gap-2.5">
                <CalendarPlus className="mt-0.5 h-4 w-4 shrink-0 text-teal" aria-hidden="true" />
                <span>{t('eventsPage.nextCalendar', 'Save the date in your calendar.')}</span>
              </li>
            )}
            {isWebinar ? (
              <li className="flex gap-2.5">
                <Video className="mt-0.5 h-4 w-4 shrink-0 text-teal" aria-hidden="true" />
                <span>
                  {meetingUrl
                    ? t('eventsPage.nextJoinReady', 'At the start time, join from this page with the button below.')
                    : t('eventsPage.nextJoinLater', 'The joining link will appear on this page before the webinar starts.')}
                </span>
              </li>
            ) : (
              <li className="flex gap-2.5">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-teal" aria-hidden="true" />
                <span>{t('eventsPage.nextVenue', 'On the day, come to the venue — the address and map are on this page.')}</span>
              </li>
            )}
            <li className="flex gap-2.5">
              <ListChecks className="mt-0.5 h-4 w-4 shrink-0 text-teal" aria-hidden="true" />
              <span>{t('eventsPage.nextManage', 'All your registrations are in My events, in your account.')}</span>
            </li>
          </ol>
        </div>
        {joinButton}
        {calendarEvent && (
          <div className="space-y-2">
            <p className="text-meta-caps">{t('events.addToCalendar')}</p>
            <AddToCalendarButtons event={calendarEvent} />
          </div>
        )}
        {viewMyEvents}
        <Button
          variant="ghost"
          className="h-11 w-full rounded-pill text-red-700 hover:bg-red-50 hover:text-red-800"
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
      <div className="space-y-4">
        <div className="flex items-start gap-2 rounded-field bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <span>
            {profile?.onboarding_status === 'draft'
              ? t('eventsPage.completeProfileFirst', 'Please complete your profile to register for events.')
              : t('eventsPage.accountUnderReview', 'Your account is being reviewed by the M3 team. You can register as soon as it is verified.')}
          </span>
        </div>
        {profile?.onboarding_status === 'draft' ? (
          <Button variant="cta" className={MAIN_BTN} onClick={() => navigate('/onboarding')}>
            {t('eventsPage.completeProfile', 'Complete my profile')}
          </Button>
        ) : (
          // The profile is already complete: /onboarding would only bounce back to the dashboard, which shows the review status.
          <Button variant="cta" className={MAIN_BTN} onClick={() => navigate('/dashboard')}>
            {t('eventsPage.checkAccountStatus', 'Check my account status')}
          </Button>
        )}
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
        eventDescription={eventText}
        eventDateTime={event.date_time}
        eventEndDateTime={event.end_date_time}
        eventLocation={event.location}
        eventMeetingUrl={meetingUrl}
        onRegistrationChange={(reg, count) => {
          setRegistrationCount(count);
          setJustSignedUp(reg);
          // The join link is handed out once registered (and withdrawn on cancel).
          refreshMeetingUrl();
        }}
      />
    );
  } else if (isWebinar && event.access_level === 'public' && !event.invitation_only) {
    panelTitle = justSignedUp ? t('eventsPage.yourRegistration', 'Your registration') : t('eventsPage.registerWebinar', 'Register for this webinar');
    panelIcon = justSignedUp ? CheckCircle2 : Ticket;
    panelTone = justSignedUp ? 'green' : 'navy';
    panelBody = (
      <div className="space-y-4">
        <LightweightWebinarSignup
          eventId={event.id}
          eventTitle={event.title}
          onRegistered={() => {
            setRegistrationCount((c) => c + 1);
            setJustSignedUp(true);
          }}
        />
        <div className="border-t border-rule pt-4 text-center text-sm text-meta">
          {t('auth.haveAccount')}{' '}
          <button
            type="button"
            className="rounded font-medium text-navy underline underline-offset-4 hover:text-teal-text focus:outline-none focus-visible:shadow-focus"
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
      <div className="space-y-4">
        <p className="text-sm leading-[22px] text-meta">
          {event.access_level === 'public'
            ? t('eventsPage.loginIntro', 'Log in with your Smart Marina Connect account to register.')
            : t('eventsPage.loginIntroRestricted', 'This event is reserved for verified members. Log in to register.')}
        </p>
        <Button variant="cta" className={MAIN_BTN} onClick={() => setLoginOpen(true)}>
          {event.invitation_only
            ? t('eventsPage.loginToRequestInvitation', 'Log in to request an invitation')
            : t('eventsPage.loginToRegister', 'Log in to register')}
        </Button>
        <p className="text-center text-sm text-meta">
          {t('eventsPage.noAccount', 'New here?')}{' '}
          <button
            type="button"
            className="rounded font-medium text-navy underline underline-offset-4 hover:text-teal-text focus:outline-none focus-visible:shadow-focus"
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
  const barBtn = 'shrink-0';
  if (hasEnded) {
    if (event.replay_url) {
      barAction = (
        <Button asChild variant="cta" size="sm" arrow={false} className={barBtn}>
          <a href={event.replay_url} target="_blank" rel="noopener noreferrer">{t('eventsPage.replayShort', 'Replay')}</a>
        </Button>
      );
    }
  } else if (isLive) {
    if (isUserRegistered && joinButton) {
      barAction = (
        <Button asChild variant="cta" size="sm" arrow={false} className={barBtn}>
          <a href={meetingUrl ?? undefined} target="_blank" rel="noopener noreferrer">{t('eventsPage.joinNow', 'Join now')}</a>
        </Button>
      );
    }
  } else if (smRegisterPath) {
    barAction = <Button variant="cta" size="sm" arrow={false} className={barBtn} onClick={() => navigate(smRegisterPath)}>{t('events.register')}</Button>;
  } else if (guestListPath) {
    barAction = <Button variant="cta" size="sm" arrow={false} className={barBtn} onClick={() => navigate(guestListPath)}>{t('eventsPage.requestShort', 'Request')}</Button>;
  } else if (isFull && !isUserRegistered) {
    barAction = <span className="shrink-0 text-sm font-medium text-amber-800">{t('eventsPage.fullTitle', 'Fully booked')}</span>;
  } else if (user && isUserRegistered) {
    barAction = isWebinar && meetingUrl ? (
      <Button asChild variant="cta" size="sm" arrow={false} className={barBtn}>
        <a href={meetingUrl} target="_blank" rel="noopener noreferrer">{t('eventsPage.joinShort', 'Join')}</a>
      </Button>
    ) : calendarEvent ? (
      <Button variant="cta" size="sm" arrow={false} className={barBtn} onClick={() => downloadICS(calendarEvent)}>
        {t('eventsPage.addToCalendarShort', 'Add to calendar')}
      </Button>
    ) : null;
  } else if (justSignedUp) {
    barAction = <Button variant="ctaOutline" size="sm" arrow={false} className={barBtn} onClick={scrollToPanel}>{t('eventsPage.yourRegistration', 'Your registration')}</Button>;
  } else {
    barAction = (
      <Button variant="cta" size="sm" arrow={false} className={barBtn} onClick={scrollToPanel}>
        {event.invitation_only ? t('eventsPage.requestShort', 'Request') : t('events.register')}
      </Button>
    );
  }
  const showBar = !!barAction && !panelInView && !endInView;

  const PanelIcon = panelIcon;
  const toneClasses: Record<typeof panelTone, string> = {
    navy: 'bg-navy text-white',
    green: 'bg-teal text-white',
    red: 'bg-red-600 text-white',
    gray: 'bg-chip text-navy',
  };

  // ---------------------------------------------------------------- header
  const KindIcon = isWebinar ? Video : CalendarDays;
  const rendezvousKicker = isRendezvous ? t('brand.notch.rendezvousKicker', 'Monaco · 6th edition') : null;
  const headerChips = (
    <>
      {isLive ? (
        <span className="inline-flex h-8 items-center gap-1.5 rounded-pill bg-red-600 px-3.5 text-[13px] font-semibold text-white">
          <Radio className="h-3.5 w-3.5" aria-hidden="true" />{t('eventsPage.liveNow', 'Live now')}
        </span>
      ) : hasEnded ? (
        <HeaderChip dot="white">{t('eventsPage.ended', 'Ended')}</HeaderChip>
      ) : (
        <HeaderChip dot="gold">{t('eventDetail.status.upcoming', 'Upcoming')}</HeaderChip>
      )}
      {rendezvousKicker && <HeaderChip>{rendezvousKicker}</HeaderChip>}
      <HeaderChip>
        <KindIcon className="h-3.5 w-3.5" aria-hidden="true" />
        {isWebinar ? t('eventsPage.webinar', 'Webinar') : t('eventsPage.onSite', 'On-site event')}
      </HeaderChip>
      <HeaderChip>
        {event.access_level === 'public' ? <Users className="h-3.5 w-3.5" aria-hidden="true" /> : <Lock className="h-3.5 w-3.5" aria-hidden="true" />}
        {accessText}
      </HeaderChip>
      {event.invitation_only && <HeaderChip><Lock className="h-3.5 w-3.5" aria-hidden="true" />{t('eventsPage.invitationOnly', 'By invitation')}</HeaderChip>}
      {registeredNow && !hasEnded && (
        <span className="inline-flex h-8 items-center gap-1.5 rounded-pill bg-white px-3.5 text-[13px] font-semibold text-navy">
          <CheckCircle2 className="h-3.5 w-3.5 text-teal" aria-hidden="true" />{t('eventsPage.youreRegistered', "You're registered")}
        </span>
      )}
      {!event.published && isModerator && (
        <HeaderChip className="border-dashed bg-transparent">{t('eventsPage.draft', 'Draft')}</HeaderChip>
      )}
    </>
  );

  const headerFacts = (
    <>
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
                className="mt-1 inline-flex min-h-8 items-center gap-1 rounded font-medium text-gold underline-offset-4 hover:underline focus:outline-none focus-visible:shadow-focus"
              >
                {t('eventsPage.openMap', 'Open in Maps')}<ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="sr-only"> {t('eventDetail.newTab', '(opens in a new tab)')}</span>
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
    </>
  );

  const headerTopics = themes.length > 0 ? (
    <ul className="mt-6 flex flex-wrap gap-2" aria-label={t('eventsPage.topics', 'Topics')}>
      {themes.map((k) => {
        const th = getTheme(k)!;
        return (
          <li key={k}>
            <Link
              to={`/events?theme=${k}`}
              className="inline-flex min-h-8 items-center gap-1.5 rounded-pill bg-white/[.12] px-3 py-1 text-[12px] font-medium text-white transition-colors hover:bg-white hover:text-navy focus:outline-none focus-visible:shadow-focus"
            >
              <th.icon className="h-3.5 w-3.5" aria-hidden="true" />{t(th.labelKey, th.fallback)}
            </Link>
          </li>
        );
      })}
    </ul>
  ) : undefined;

  // ---------------------------------------------------------------- the sections of the page
  // Built as a list so the section nav and the numbering follow what is really shown.
  type Block = { id: string; label: string; eyebrow?: string; render: (no: string) => ReactNode };
  const blocks: Block[] = [];

  if (eventText || isRendezvous) {
    blocks.push({
      id: 'about',
      label: t('eventDetail.nav.about', 'About'),
      render: (no) => (
        <DetailSection id="about" no={no} eyebrow={t('eventDetail.eyebrow.about', 'Presentation')} title={t('eventsPage.about', 'About this event')}>
          {eventText && (
            <div className="whitespace-pre-wrap break-words text-body text-ink [overflow-wrap:anywhere]">{eventText}</div>
          )}
          {isRendezvous && (
            <>
              <p className="text-meta-caps mt-6">{t('eventDetail.whatsOn.title', 'On the programme')}</p>
              <ul className="mt-3 flex flex-wrap gap-2">
                {[
                  t('eventDetail.whatsOn.conferences', 'Conferences'),
                  t('eventDetail.whatsOn.workshops', 'Workshops'),
                  t('eventDetail.whatsOn.exhibition', 'Exhibition'),
                  t('eventDetail.whatsOn.pitches', 'Innovation pitches'),
                  t('eventDetail.whatsOn.architects', 'Architect presentations'),
                  t('eventDetail.whatsOn.awards', 'Monaco Smart & Sustainable Marina Awards ceremony'),
                ].map((label) => (
                  <li key={label} className="inline-flex items-center gap-2 rounded-pill bg-chip px-3.5 py-1.5 text-sm font-medium text-navy">
                    <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-teal" />
                    {label}
                  </li>
                ))}
              </ul>
              <div className="mt-6">
                <UnderlineLink href={RENDEZVOUS_SITE} external>{t('homePage.events.officialSite', 'Official site')}</UnderlineLink>
              </div>
            </>
          )}
        </DetailSection>
      ),
    });
  }

  if (isRendezvous) {
    blocks.push({
      id: 'figures',
      label: t('eventDetail.nav.figures', 'In figures'),
      render: (no) => <RendezvousFigures id="figures" no={no} />,
    });
  }

  // SM26 programme — shown for the Smart Marina event (its own component, as before). For an event
  // still ahead it follows the presentation; once it is over, the long archive of sessions moves
  // below the practical information and the documents, so it never buries them.
  const programmeBlock: Block | null = !smEventId ? null : {
      id: 'programme',
      label: t('eventDetail.nav.programme', 'Programme'),
      render: (no) => (
        <DetailSection id="programme" no={no} eyebrow={t('eventDetail.eyebrow.programme', 'Agenda')} title={t('eventsPage.programme', 'Programme')}>
          <SM26Agenda eventId={smEventId} ended={hasEnded} />
        </DetailSection>
      ),
    };
  if (programmeBlock && !hasEnded) blocks.push(programmeBlock);

  if (speakers.length > 0) {
    blocks.push({
      id: 'speakers',
      label: t('eventDetail.nav.speakers', 'Speakers'),
      render: (no) => (
        <DetailSection id="speakers" no={no} eyebrow={t('eventDetail.eyebrow.speakers', 'On stage')} title={t('events.speakers', 'Speakers')} aside={String(speakers.length)}>
          <ul className="grid gap-3 sm:grid-cols-2">
            {speakers.map((speaker, idx) => {
              const initials = speaker.name.split(/\s+/).filter(Boolean).map((n) => n[0]).join('').slice(0, 2).toUpperCase();
              const inner = (
                <>
                  <span aria-hidden="true" className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-teal text-[15px] font-semibold tracking-[0.02em] text-white">
                    {initials}
                  </span>
                  <span className="min-w-0">
                    <span className="block font-semibold text-navy [overflow-wrap:anywhere]">{speaker.name}</span>
                    {speaker.title && <span className="block text-sm leading-5 text-meta [overflow-wrap:anywhere]">{speaker.title}</span>}
                  </span>
                </>
              );
              return (
                <li key={idx}>
                  {speaker.profile_id ? (
                    <Link
                      to={`/users/${speaker.profile_id}`}
                      className="flex items-center gap-3.5 rounded-field border border-rule bg-white p-3.5 transition-colors hover:border-navy focus:outline-none focus-visible:shadow-focus"
                    >
                      {inner}
                    </Link>
                  ) : (
                    <div className="flex items-center gap-3.5 rounded-field border border-rule bg-white p-3.5">{inner}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </DetailSection>
      ),
    });
  }

  // Practical information (on-site): the venue, how to find it, who may come.
  if (!isWebinar && (venueLine || addressLine || embedMap || mapLink)) {
    blocks.push({
      id: 'practical',
      label: t('eventDetail.nav.practical', 'Practical info'),
      render: (no) => (
        <DetailSection id="practical" no={no} eyebrow={t('eventDetail.eyebrow.practical', 'Getting there')} title={t('eventDetail.practical.title', 'Practical information')}>
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <dl className="grid gap-x-10 gap-y-4 text-[15px] leading-6 text-ink sm:grid-cols-2">
              {(venueLine || addressLine) && (
                <div>
                  <dt className="text-meta-caps">{t('eventsPage.location', 'Location')}</dt>
                  <dd className="mt-1">
                    {venueLine && <span className="block font-semibold text-navy">{venueLine}</span>}
                    {addressLine && addressLine !== venueLine && <span className="block">{addressLine}</span>}
                  </dd>
                </div>
              )}
              <div>
                <dt className="text-meta-caps">{t('eventDetail.practical.access', 'Who can attend')}</dt>
                <dd className="mt-1">{accessText}{event.invitation_only ? ` · ${t('eventsPage.invitationOnly', 'By invitation')}` : ''}</dd>
              </div>
              {language && (
                <div>
                  <dt className="text-meta-caps">{t('eventsPage.factLanguage', 'Language')}</dt>
                  <dd className="mt-1">{language}</dd>
                </div>
              )}
              {event.fees && (
                <div>
                  <dt className="text-meta-caps">{t('eventsPage.factFees', 'Fees')}</dt>
                  <dd className="mt-1">{event.fees}</dd>
                </div>
              )}
            </dl>
            {mapLink && (
              <Button asChild variant="ctaOutline" size="sm" className="shrink-0">
                <a href={mapLink} target="_blank" rel="noopener noreferrer">
                  {t('eventsPage.openMap', 'Open in Maps')}
                  <span className="sr-only"> {t('eventDetail.newTab', '(opens in a new tab)')}</span>
                </a>
              </Button>
            )}
          </div>
          {embedMap && (
            <div className="mt-6 h-64 overflow-hidden rounded-field border border-rule">
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
        </DetailSection>
      ),
    });
  }

  // Packages (on-site events)
  if (!isWebinar && packages.length > 0) {
    blocks.push({
      id: 'packages',
      label: t('eventDetail.nav.packages', 'Packages'),
      render: (no) => (
        <DetailSection id="packages" no={no} eyebrow={t('eventDetail.eyebrow.packages', 'Registration')} title={t('eventsPage.packages', 'Registration packages')}>
          <ul className="grid gap-4 sm:grid-cols-2">
            {packages.map((pkg) => (
              <li key={pkg.id} className="rounded-field border border-rule p-5">
                <h3 className="text-card-title text-navy">{pkg.name}</h3>
                {pkg.description && <p className="mt-1.5 text-sm leading-[22px] text-meta">{pkg.description}</p>}
                <div className="mt-4 flex items-baseline gap-1.5">
                  <span className="tabular text-[28px] font-semibold leading-8 tracking-[-0.02em] text-navy">{formatPrice(pkg.price_cents)}</span>
                  {pkg.price_cents > 0 && <span className="text-sm text-meta">{t('eventsPage.perPerson', '/ person')}</span>}
                </div>
                {pkg.max_seats != null && (
                  <p className="mt-1 text-sm text-meta">{t('eventsPage.seatsAvailable', { count: pkg.max_seats, defaultValue_one: '{{count}} seat available', defaultValue_other: '{{count}} seats available' })}</p>
                )}
              </li>
            ))}
          </ul>
        </DetailSection>
      ),
    });
  }

  // The event's own list of partners (names and logos entered by the team).
  if (partners.length > 0) {
    blocks.push({
      id: 'partners',
      label: t('eventDetail.nav.partners', 'Partners'),
      render: (no) => (
        <DetailSection id="partners" no={no} eyebrow={t('eventDetail.eyebrow.partners', 'Behind the event')} title={t('eventsPage.partners', 'Event partners')}>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {partners.map((partner, idx) => (
              <li key={idx} className="flex items-center gap-3 rounded-field border border-rule p-3">
                <LogoTile src={partner.logo_url} name={partner.name} size={48} />
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-navy">{partner.name}</div>
                  {partner.website && (
                    <a
                      href={externalUrl(partner.website) ?? undefined}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-8 items-center gap-1 rounded text-[13px] font-medium text-navy underline underline-offset-4 hover:text-teal-text focus:outline-none focus-visible:shadow-focus"
                    >
                      <Globe className="h-3 w-3" aria-hidden="true" /> {t('eventsPage.website', 'Website')}
                      <span className="sr-only"> {t('eventDetail.newTab', '(opens in a new tab)')}</span>
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </DetailSection>
      ),
    });
  }

  if (event.pdf_url || event.brochure_url || event.event_website_url) {
    blocks.push({
      id: 'documents',
      label: t('eventDetail.nav.documents', 'Documents'),
      render: (no) => (
        <DetailSection id="documents" no={no} eyebrow={t('eventDetail.eyebrow.documents', 'Download')} title={t('eventsPage.documents', 'Documents & links')}>
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
        </DetailSection>
      ),
    });
  }

  if (programmeBlock && hasEnded) blocks.push(programmeBlock);

  // Participants
  if (registrationCount > 0) {
    blocks.push({
      id: 'participants',
      label: t('eventDetail.nav.participants', 'Participants'),
      render: (no) => (
        <DetailSection
          id="participants"
          no={no}
          eyebrow={t('eventDetail.eyebrow.participants', 'Attendees')}
          title={t('eventsPage.participants', 'Participants')}
          aside={t('eventsPage.registeredCount', { count: registrationCount, defaultValue_one: '{{count}} registered', defaultValue_other: '{{count}} registered' })}
        >
          {user ? (
            participants.length > 0 ? (
              <ul className="grid gap-3 sm:grid-cols-2">
                {participants.map((p) => {
                  const name = [p.first_name, p.last_name].filter(Boolean).join(' ') || t('eventsPage.member', 'Member');
                  return (
                    <li key={p.user_id}>
                      <Link
                        to={`/users/${p.user_id}`}
                        className="flex items-center gap-3 rounded-field border border-rule bg-white p-3 transition-colors hover:border-navy focus:outline-none focus-visible:shadow-focus"
                      >
                        {p.avatar_url ? (
                          <img src={p.avatar_url} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />
                        ) : (
                          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-teal text-sm font-semibold text-white" aria-hidden="true">
                            {((p.first_name?.[0] || '') + (p.last_name?.[0] || '')).toUpperCase() || '?'}
                          </span>
                        )}
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-navy">{name}</div>
                          {p.job_title && <div className="truncate text-xs text-meta">{p.job_title}</div>}
                          {p.org_name && <div className="truncate text-xs text-meta">{p.org_name}</div>}
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-meta">
                {participantsLoaded
                  ? t('eventsPage.participantsHidden', 'The list of attendees is not visible to you.')
                  : t('eventsPage.loadingParticipants', 'Loading participants…')}
              </p>
            )
          ) : (
            <div className="flex items-center gap-3 rounded-field bg-chip p-4 text-ink">
              <Lock className="h-5 w-5 shrink-0 text-meta" aria-hidden="true" />
              <span className="text-sm">
                {t('eventsPage.participantsLocked', { count: registrationCount, defaultValue_one: '{{count}} participant registered.', defaultValue_other: '{{count}} participants registered.' })}{' '}
                <button
                  type="button"
                  className="rounded font-medium text-navy underline underline-offset-4 hover:text-teal-text focus:outline-none focus-visible:shadow-focus"
                  onClick={() => setLoginOpen(true)}
                >
                  {t('eventsPage.logInToSee', "Log in to see who's attending.")}
                </button>
              </span>
            </div>
          )}
        </DetailSection>
      ),
    });
  }

  const showSponsors = isRendezvous && (sponsorsLoading || sponsors.length > 0);
  const navItems: NavItem[] = [
    ...blocks.map((b) => ({ id: b.id, label: b.label })),
    ...(showSponsors && !sponsorsLoading ? [{ id: 'sponsors', label: t('eventDetail.nav.sponsors', 'Sponsors') }] : []),
  ];

  // The M3 events other than this one: the home page's three meeting points.
  const otherEvents = featuredEventItems(t).filter((item) =>
    item.href !== `/events/${event.id}` && !(isWebinar && item.id === 'webinars'));

  const participation = (
    <div
      ref={panelRef}
      id="participate"
      className="scroll-mt-24 transition-[top] duration-300 lg:sticky"
      style={{ top: 'calc(var(--header-h, 64px) + var(--sticky-offset, 0px) + 16px)' }}
    >
      <div className="rounded-card border border-rule bg-white p-5 sm:p-6">
        <div className="flex items-center gap-3">
          <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-full', toneClasses[panelTone])}>
            <PanelIcon className="h-5 w-5" aria-hidden="true" />
          </span>
          <h2 ref={panelHeadingRef} tabIndex={-1} className="text-card-title text-navy focus:outline-none">{panelTitle}</h2>
        </div>
        <div className="mt-5 space-y-4">
          {!hasStarted && event.invitation_only && !guestListPath && !smRegisterPath && !isUserRegistered && (
            <div className="flex items-center gap-2 rounded-field bg-chip p-3 text-sm text-ink">
              <Lock className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{t('eventsPage.invitationOnlyNote', 'This is an invitation-only event.')}</span>
            </div>
          )}
          {panelBody}
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-page">
      {/* An unpublished event (visible to staff only) must not reach a search index. */}
      <Seo {...seo} noindex={event.published === false} />

      {/* ── Header: what, when, where, which language, for whom ── */}
      <EventHeader
        title={event.title}
        image={coverFor(event, themes)}
        seed={event.id}
        icon={KindIcon}
        iso={event.date_time}
        endIso={event.end_date_time}
        locale={locale}
        chips={headerChips}
        facts={headerFacts}
        topics={headerTopics}
      />

      {/* ── Sticky section nav ── */}
      {navItems.length >= 3 && <SectionNav items={navItems} label={t('eventDetail.nav.label', 'On this page')} />}

      {/* ── Content ── */}
      <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:py-12">
        <div className="grid gap-6 lg:grid-cols-12 lg:gap-10">
          {/* Participation: first on phones, sticky sidebar on desktop. */}
          <aside className="lg:col-span-4 lg:col-start-9 lg:row-start-1">{participation}</aside>

          {/* Main column */}
          <div className="min-w-0 space-y-6 lg:col-span-8 lg:col-start-1 lg:row-start-1">
            {blocks.map((b, i) => (
              <div key={b.id}>{b.render(String(i + 1).padStart(2, '0'))}</div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Event sponsors, by tier (the Rendezvous) ── */}
      {showSponsors && (
        <div id="sponsors">
          <SponsorsBand sponsors={sponsors} loading={sponsorsLoading} />
        </div>
      )}

      {/* ── Our other events, and the one public address ── */}
      <section aria-labelledby="other-events-h" className="mx-auto w-full max-w-7xl px-4 pb-16 pt-12 sm:px-6 md:pb-24 md:pt-16">
        <div className="grid gap-10 lg:grid-cols-12 lg:gap-12">
          {otherEvents.length > 0 && (
            <div className="lg:col-span-8">
              <Reveal>
                <Eyebrow>{t('eventDetail.other.eyebrow', 'Our other events')}</Eyebrow>
              </Reveal>
              <h2 id="other-events-h" className="mt-3 text-h2-sm text-navy md:text-h2">
                {t('eventDetail.other.title', 'Meet us at our other events')}
              </h2>
              <RevealGroup as="ul" className="mt-8 grid gap-4 sm:grid-cols-2">
                {otherEvents.map((item) => (
                  <li key={item.id} className="flex">
                    <OtherEventCard item={item} />
                  </li>
                ))}
              </RevealGroup>
              <UnderlineLink to="/events" className="mt-6">{t('homePage.events.all', 'All events')}</UnderlineLink>
            </div>
          )}
          <div className={cn(otherEvents.length > 0 ? 'lg:col-span-4' : 'lg:col-span-5 lg:col-start-4')}>
            <ContactCard
              variant="panel"
              title={t('eventDetail.contact.title', 'A question about this event?')}
              line={t('eventDetail.contact.line', 'Programme, registration or sponsoring: write to the M3 team.')}
            />
          </div>
        </div>
        {/*
          The mobile bar stays up until this marker reaches the screen, then steps
          aside for the footer. The spacer above it is the bar's height, so the
          last lines of content are never left hidden underneath it.
        */}
        <div aria-hidden="true" className="h-16 lg:hidden" />
        <div ref={endRef} aria-hidden="true" className="h-px" />
      </section>

      {/* ── Mobile action bar ── */}
      {showBar && (
        <div
          className="fixed inset-x-0 bottom-0 z-40 border-t border-rule bg-white/95 shadow-[0_-4px_16px_rgba(11,38,83,0.08)] backdrop-blur lg:hidden"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          <div className="mx-auto flex w-full max-w-7xl items-center gap-3 px-4 py-3 sm:px-6">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-navy">{event.title}</p>
              <p className="flex items-center gap-1 truncate text-xs text-meta">
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
          <SignupForm onSuccess={() => { setSignupOpen(false); navigate('/onboarding'); }} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ─── Pieces ─────────────────────────────────────────────────────── */

function DocLink({ href, icon: Icon, label, hint }: { href: string; icon: LucideIcon; label: string; hint: string }) {
  return (
    <li>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="group flex items-center gap-3.5 rounded-field border border-rule p-3.5 transition-colors hover:border-navy focus:outline-none focus-visible:shadow-focus"
      >
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-field bg-chip text-navy">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <span className="block truncate font-semibold text-navy">{label}</span>
          <span className="block truncate text-sm text-meta">{hint}</span>
        </span>
      </a>
    </li>
  );
}
