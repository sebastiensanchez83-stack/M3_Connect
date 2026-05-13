import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Helmet } from 'react-helmet-async';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { LoginForm } from '@/components/auth/LoginForm';
import { SignupForm } from '@/components/auth/SignupForm';
import {
  ChevronLeft, Calendar, Clock, MapPin, Users, Play,
  Download, DollarSign, UserCheck, AlertCircle, Loader2,
  Video, Building2, ExternalLink, FileDown, Globe, Users as UsersIcon, Lock,
  Tag, Package,
} from 'lucide-react';
import { LoadingSkeleton } from '@/components/LoadingSkeleton';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
import { EventRegistrationFlow } from '@/components/events/EventRegistrationFlow';
import { LightweightWebinarSignup } from '@/components/events/LightweightWebinarSignup';

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
  speakers: { name: string; title: string; profile_id?: string }[];
  replay_url: string | null;
  meeting_url: string | null;
  pdf_url: string | null;
  brochure_url: string | null;
  event_website_url: string | null;
  event_partners: EventPartner[];
  location_details: { lat?: number; lng?: number; address?: string; map_url?: string } | null;
  fees: string | null;
  max_attendance: number | null;
  created_at: string;
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

export function EventDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, profile, isVerified, isModerator } = useAuth();
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [registrationCount, setRegistrationCount] = useState(0);
  const [loginOpen, setLoginOpen] = useState(false);
  const [signupOpen, setSignupOpen] = useState(false);
  const [participants, setParticipants] = useState<EventParticipant[]>([]);
  const [packages, setPackages] = useState<EventPackage[]>([]);
  const [sectors, setSectors] = useState<EventSector[]>([]);
  const [isUserRegistered, setIsUserRegistered] = useState(false);

  const profileComplete = profile?.access_status === 'verified' && profile?.onboarding_status === 'completed';

  // Check if the logged-in user already has a registration for this event
  // (covers both direct registrations and guest → account upgrades via email match)
  useEffect(() => {
    if (!id || !user) {
      setIsUserRegistered(false);
      return;
    }
    const checkRegistration = async () => {
      const email = user.email?.toLowerCase();
      const filter = email
        ? `user_id.eq.${user.id},guest_email.eq.${email}`
        : `user_id.eq.${user.id}`;
      const { data } = await supabase
        .from('event_registrations')
        .select('id')
        .eq('event_id', id)
        .or(filter)
        .limit(1);
      setIsUserRegistered(!!(data && data.length > 0));
    };
    checkRegistration();
  }, [id, user]);

  useEffect(() => {
    if (!id) return;
    const fetchEvent = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('events')
        .select('*')
        .eq('id', id)
        .single();

      if (error) {
        if (import.meta.env.DEV) console.error('Error fetching event:', error);
      } else {
        const ev = data as EventDetail;
        // Hide unpublished events from non-admins
        if (ev.published === false && !isModerator) {
          setEvent(null);
          setLoading(false);
          return;
        }
        setEvent(ev);
      }
      setLoading(false);
    };
    fetchEvent();
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
  }, [id, event?.event_type]);

  // Fetch sectors
  useEffect(() => {
    if (!id) return;
    supabase
      .from('event_sectors')
      .select('sector_id, sectors(id, label)')
      .eq('event_id', id)
      .then(({ data }) => {
        if (data) {
          const s = (data as any[]).map(row => ({
            id: row.sectors?.id || row.sector_id,
            label: row.sectors?.label || '',
          })).filter(s => s.label);
          setSectors(s);
        }
      });
  }, [id]);

  // Fetch registration count
  useEffect(() => {
    if (!id) return;
    const fetchCount = async () => {
      const { count } = await supabase
        .from('event_registrations')
        .select('id', { count: 'exact' })
        .eq('event_id', id);
      setRegistrationCount(count || 0);
    };
    fetchCount();
  }, [id]);

  // Fetch participants for logged-in verified users
  useEffect(() => {
    if (!id || !user) return;
    const fetchParticipants = async () => {
      const { data: regs, error: regsError } = await supabase
        .from('event_registrations')
        .select('user_id, profiles!inner(first_name, last_name, avatar_url, job_title, user_id)')
        .eq('event_id', id);

      if (regsError || !regs) return;

      const userIds = regs.map((r: any) => r.user_id as string);
      let orgMap: Record<string, { name: string; logo_url: string | null }> = {};
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

      setParticipants(regs.map((r: any) => {
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
    };
    fetchParticipants();
  }, [id, user, profileComplete]);

  const getAccessBadge = (level: string) => {
    switch (level) {
      case 'public':
        return <Badge variant="success">{t('resources.accessLevels.public')}</Badge>;
      case 'members':
        return <Badge variant="info">{t('resources.accessLevels.members')}</Badge>;
      case 'marina':
        return <Badge variant="purple">{t('resources.accessLevels.marina')}</Badge>;
      default:
        return null;
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString(undefined, {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
  };

  const formatTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleTimeString(undefined, {
      hour: '2-digit', minute: '2-digit',
    });
  };

  const formatPrice = (cents: number) => {
    if (cents === 0) return 'Free';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EUR' }).format(cents / 100);
  };

  if (loading) return <LoadingSkeleton variant="page" />;

  if (!event) {
    return (
      <div className="container mx-auto px-4 py-16 text-center">
        <h1 className="text-2xl font-bold text-gray-900 mb-4">{t('events.notFound', 'Event not found')}</h1>
        <Button asChild>
          <Link to="/events">
            <ChevronLeft className="h-4 w-4 mr-2" />
            {t('events.backToEvents', 'Back to Events')}
          </Link>
        </Button>
      </div>
    );
  }

  const isPast = event.date_time ? new Date(event.date_time) <= new Date() : false;
  const isFull = event.max_attendance ? registrationCount >= event.max_attendance : false;

  return (
    <div className="min-h-screen bg-gray-50">
      <Helmet>
        <title>{event.title} — Events — Smart Marina Connect</title>
        <meta name="description" content={event.description?.substring(0, 160) || `Join ${event.title} on Smart Marina Connect`} />
        <meta property="og:title" content={`${event.title} — Smart Marina Connect`} />
        <meta property="og:description" content={event.description?.substring(0, 160) || ''} />
        <meta property="og:type" content="event" />
      </Helmet>

      {/* Hero */}
      <section className="bg-gradient-to-br from-[#0b2653] to-[#143a6b] text-white">
        <div className="container mx-auto px-4 py-12 lg:py-16">
          <Link to="/events" className="inline-flex items-center gap-1 text-white/70 hover:text-white mb-6 text-sm">
            <ChevronLeft className="h-4 w-4" />
            {t('events.backToEvents', 'Back to Events')}
          </Link>
          <div className="max-w-3xl">
            <div className="flex items-center gap-3 mb-4 flex-wrap">
              <Badge className={event.event_type === 'webinar'
                ? 'bg-violet-500/90 text-white border-0'
                : 'bg-amber-500/90 text-white border-0'
              }>
                {event.event_type === 'webinar' ? (
                  <><Video className="h-3 w-3 mr-1" /> Webinar</>
                ) : (
                  <><Building2 className="h-3 w-3 mr-1" /> On-site Event</>
                )}
              </Badge>
              {getAccessBadge(event.access_level)}
              {event.invitation_only && (
                <Badge className="bg-purple-500/90 text-white border-0">
                  <Lock className="h-3 w-3 mr-1" /> Invitation Only
                </Badge>
              )}
              {isPast && (
                <Badge variant="outline" className="border-white/30 text-white">
                  {t('events.past', 'Past Event')}
                </Badge>
              )}
              {!event.published && isModerator && (
                <Badge className="bg-gray-500/90 text-white border-0">Draft</Badge>
              )}
            </div>
            <h1 className="text-3xl lg:text-4xl font-bold mb-4">{event.title}</h1>
            <div className="flex flex-wrap gap-6 text-white/80">
              {event.date_time ? (
                <>
                  <div className="flex items-center gap-2">
                    <Calendar className="h-5 w-5" />
                    <span>
                      {formatDate(event.date_time)}
                      {event.end_date_time && event.end_date_time !== event.date_time && (
                        <> — {formatDate(event.end_date_time)}</>
                      )}
                    </span>
                  </div>
                  {!event.is_full_day && (
                    <div className="flex items-center gap-2">
                      <Clock className="h-5 w-5" />
                      <span>
                        {formatTime(event.date_time)}
                        {event.end_date_time && <> — {formatTime(event.end_date_time)}</>}
                      </span>
                    </div>
                  )}
                  {event.is_full_day && (
                    <div className="flex items-center gap-2">
                      <Clock className="h-5 w-5" />
                      <span>All day</span>
                    </div>
                  )}
                </>
              ) : (
                <div className="flex items-center gap-2">
                  <Calendar className="h-5 w-5" />
                  <span>Date to be announced</span>
                </div>
              )}
              {event.location && (
                <div className="flex items-center gap-2">
                  <MapPin className="h-5 w-5" />
                  <span>{event.location}</span>
                </div>
              )}
            </div>

            {/* Sector tags in hero */}
            {sectors.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-4">
                {sectors.map(s => (
                  <span key={s.id} className="inline-flex items-center gap-1 text-xs bg-white/15 text-white/90 rounded-full px-3 py-1">
                    <Tag className="h-3 w-3" />{s.label}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Content */}
      <div className="container mx-auto px-4 py-8 lg:py-12">
        <div className="grid lg:grid-cols-3 gap-8">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Description */}
            {event.description && (
              <div className="bg-white rounded-xl shadow-sm border p-6 lg:p-8">
                <h2 className="text-xl font-semibold text-gray-900 mb-4">{t('events.description', 'Description')}</h2>
                <div className="prose prose-gray max-w-none text-gray-600 leading-relaxed whitespace-pre-wrap">
                  {event.description}
                </div>
              </div>
            )}

            {/* Packages (on-site events) */}
            {event.event_type === 'on_site' && packages.length > 0 && (
              <div className="bg-white rounded-xl shadow-sm border p-6 lg:p-8">
                <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <Package className="h-5 w-5 text-primary" />
                  Registration Packages
                </h2>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {packages.map(pkg => (
                    <div key={pkg.id} className="rounded-xl border border-gray-200 p-4 hover:border-primary/30 hover:shadow-sm transition-all">
                      <h3 className="font-semibold text-gray-900 mb-1">{pkg.name}</h3>
                      {pkg.description && (
                        <p className="text-sm text-gray-500 mb-3">{pkg.description}</p>
                      )}
                      <div className="flex items-baseline gap-1">
                        <span className="text-2xl font-bold text-primary">{formatPrice(pkg.price_cents)}</span>
                        {pkg.price_cents > 0 && <span className="text-xs text-gray-400">/ person</span>}
                      </div>
                      {pkg.max_seats != null && (
                        <p className="text-xs text-gray-400 mt-1">{pkg.max_seats} seats available</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Participants */}
            {registrationCount > 0 && (
              <div className="bg-white rounded-xl shadow-sm border p-6 lg:p-8">
                <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <UserCheck className="h-5 w-5 text-primary" />
                  Participants
                  <span className="ml-auto text-sm font-normal text-gray-500">
                    {registrationCount} registered
                  </span>
                </h2>
                {user ? (
                  participants.length > 0 ? (
                    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {participants.map((p) => (
                        <Link
                          key={p.user_id}
                          to={`/users/${p.user_id}`}
                          className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors"
                        >
                          {p.avatar_url ? (
                            <img src={p.avatar_url} alt={`${p.first_name || ''} ${p.last_name || ''}`} className="w-10 h-10 rounded-full object-cover" />
                          ) : (
                            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm">
                              {((p.first_name?.[0] || '') + (p.last_name?.[0] || '')).toUpperCase() || '?'}
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className="font-medium text-primary text-sm truncate">
                              {[p.first_name, p.last_name].filter(Boolean).join(' ') || 'Member'}
                            </div>
                            {p.job_title && <div className="text-xs text-gray-500 truncate">{p.job_title}</div>}
                            {p.org_name && <div className="text-xs text-gray-400 truncate">{p.org_name}</div>}
                          </div>
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <div className="text-sm text-gray-500">Loading participants...</div>
                  )
                ) : (
                  <div className="flex items-center gap-3 p-4 rounded-lg bg-gray-50 text-gray-600">
                    <Lock className="h-5 w-5 text-gray-400 shrink-0" />
                    <span className="text-sm">
                      {registrationCount} participant{registrationCount !== 1 ? 's' : ''} registered &mdash;{' '}
                      <button className="text-primary hover:underline font-medium" onClick={() => setLoginOpen(true)}>
                        Log in
                      </button>{' '}
                      to see who's attending.
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Speakers — webinars */}
            {event.event_type === 'webinar' && event.speakers && event.speakers.length > 0 && (
              <div className="bg-white rounded-xl shadow-sm border p-6 lg:p-8">
                <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <Users className="h-5 w-5 text-primary" />
                  {t('events.speakers', 'Speakers')}
                </h2>
                <div className="grid sm:grid-cols-2 gap-4">
                  {event.speakers.map((speaker, idx) => {
                    const inner = (
                      <>
                        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm">
                          {speaker.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <div className={`font-medium ${speaker.profile_id ? 'text-primary' : 'text-gray-900'}`}>{speaker.name}</div>
                          {speaker.title && <div className="text-sm text-gray-500">{speaker.title}</div>}
                        </div>
                      </>
                    );
                    return speaker.profile_id ? (
                      <Link key={idx} to={`/users/${speaker.profile_id}`} className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors">
                        {inner}
                      </Link>
                    ) : (
                      <div key={idx} className="flex items-center gap-3 p-3 rounded-lg bg-gray-50">
                        {inner}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* On-site extras: partners, brochure, website, map */}
            {event.event_type === 'on_site' && (
              <>
                {event.event_partners && event.event_partners.length > 0 && (
                  <div className="bg-white rounded-xl shadow-sm border p-6 lg:p-8">
                    <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center gap-2">
                      <UsersIcon className="h-5 w-5 text-primary" />
                      Event Partners
                    </h2>
                    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                      {event.event_partners.map((partner, idx) => (
                        <div key={idx} className="flex items-center gap-3 p-3 rounded-xl bg-gray-50">
                          {partner.logo_url ? (
                            <img src={partner.logo_url} alt={partner.name} className="w-10 h-10 rounded-lg object-cover" />
                          ) : (
                            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary font-bold text-xs">
                              {partner.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                            </div>
                          )}
                          <div>
                            <div className="font-medium text-gray-900 text-sm">{partner.name}</div>
                            {partner.website && (
                              <a href={partner.website} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline flex items-center gap-1">
                                <Globe className="h-3 w-3" /> Website
                              </a>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {(event.brochure_url || event.event_website_url) && (
                  <div className="bg-white rounded-xl shadow-sm border p-6 lg:p-8">
                    <h2 className="text-xl font-semibold text-gray-900 mb-4">Event Resources</h2>
                    <div className="flex flex-wrap gap-3">
                      {event.brochure_url && (
                        <Button variant="outline" className="rounded-xl" asChild>
                          <a href={event.brochure_url} target="_blank" rel="noopener noreferrer">
                            <FileDown className="h-4 w-4 mr-2" />
                            Download Brochure
                          </a>
                        </Button>
                      )}
                      {event.event_website_url && (
                        <Button variant="outline" className="rounded-xl" asChild>
                          <a href={event.event_website_url} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="h-4 w-4 mr-2" />
                            Event Website & Program
                          </a>
                        </Button>
                      )}
                    </div>
                  </div>
                )}

                {event.location_details && (event.location_details.map_url || event.location_details.address) && (
                  <div className="bg-white rounded-xl shadow-sm border p-6 lg:p-8">
                    <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center gap-2">
                      <MapPin className="h-5 w-5 text-primary" />
                      Location
                    </h2>
                    {event.location_details.address && (
                      <p className="text-gray-600 mb-3">{event.location_details.address}</p>
                    )}
                    {event.location_details.map_url && (
                      <div className="rounded-xl overflow-hidden border h-64">
                        <iframe
                          src={event.location_details.map_url}
                          width="100%"
                          height="100%"
                          style={{ border: 0 }}
                          allowFullScreen
                          loading="lazy"
                          referrerPolicy="no-referrer-when-downgrade"
                          title="Event Location"
                        />
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {/* Replay */}
            {event.replay_url && isPast && (
              <div className="bg-white rounded-xl shadow-sm border p-6 lg:p-8">
                <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <Play className="h-5 w-5 text-primary" />
                  {t('events.replay', 'Watch Replay')}
                </h2>
                <Button asChild>
                  <a href={event.replay_url} target="_blank" rel="noopener noreferrer">
                    <Play className="h-4 w-4 mr-2" />
                    {t('events.watchReplay', 'Watch Replay')}
                  </a>
                </Button>
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Registration Card */}
            {!isPast && (
              <Card className="sticky top-20 rounded-2xl shadow-md border-0 overflow-hidden">
                <CardContent className="pt-6 space-y-4">
                  <h3 className="font-semibold text-lg">
                    {event.invitation_only ? 'Request Invitation' : t('events.register', 'Register')}
                  </h3>

                  {/* Event Info */}
                  <div className="space-y-3 text-sm">
                    {event.invitation_only && (
                      <div className="flex items-center gap-2 text-purple-700 bg-purple-50 p-3 rounded-lg">
                        <Lock className="h-4 w-4" />
                        <span>This is an invitation-only event</span>
                      </div>
                    )}
                    {event.fees && (
                      <div className="flex items-center gap-2 text-gray-600">
                        <DollarSign className="h-4 w-4 text-primary" />
                        <span>{event.fees}</span>
                      </div>
                    )}
                    {event.max_attendance && (
                      <div className="flex items-center gap-2 text-gray-600">
                        <UserCheck className="h-4 w-4 text-primary" />
                        <span>{registrationCount} / {event.max_attendance} {t('events.spots', 'spots')}</span>
                      </div>
                    )}
                  </div>

                  {/* Registration Flow */}
                  {isFull && !isUserRegistered ? (
                    <div className="flex items-center gap-2 text-amber-600 bg-amber-50 p-3 rounded-lg">
                      <AlertCircle className="h-5 w-5" />
                      <span className="font-medium">{t('events.eventFull', 'This event is full')}</span>
                    </div>
                  ) : user && isUserRegistered ? (
                    <div className="space-y-3">
                      <div className="flex items-start gap-2 text-green-700 bg-green-50 border border-green-200 p-3 rounded-lg text-sm">
                        <UserCheck className="h-5 w-5 shrink-0 mt-0.5" />
                        <div>
                          <p className="font-medium">You're registered for this event</p>
                          <p className="text-xs text-green-600 mt-0.5">See all your registrations in your account.</p>
                        </div>
                      </div>
                      {event.event_type === 'webinar' && event.meeting_url && (
                        <Button asChild className="w-full bg-violet-600 hover:bg-violet-700">
                          <a href={event.meeting_url} target="_blank" rel="noopener noreferrer">
                            <Video className="h-4 w-4 mr-2" />
                            {t('events.joinWebinar', 'Join the webinar')}
                          </a>
                        </Button>
                      )}
                      <Button variant="outline" className="w-full" onClick={() => navigate('/account?tab=registrations')}>
                        View My Registrations
                      </Button>
                    </div>
                  ) : user && !profileComplete ? (
                    <div className="space-y-3">
                      <div className="flex items-start gap-2 text-amber-600 bg-amber-50 p-3 rounded-lg text-sm">
                        <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
                        <span>{t('events.completeProfileFirst', 'Please complete your profile to register for events.')}</span>
                      </div>
                      <Button className="w-full" onClick={() => navigate('/onboarding')}>
                        {t('events.completeProfile', 'Complete Profile')}
                      </Button>
                    </div>
                  ) : user && profileComplete ? (
                    <EventRegistrationFlow
                      eventId={event.id}
                      eventType={event.event_type}
                      invitationOnly={event.invitation_only}
                      packages={packages}
                      onRegistrationChange={(_reg, count) => {
                        setRegistrationCount(count);
                      }}
                    />
                  ) : event.event_type === 'webinar'
                      && event.access_level === 'public'
                      && !event.invitation_only ? (
                    <div className="space-y-3">
                      <LightweightWebinarSignup
                        eventId={event.id}
                        eventTitle={event.title}
                        onRegistered={() => setRegistrationCount(c => c + 1)}
                      />
                      <div className="text-center text-xs text-gray-500 pt-1 border-t">
                        Already have an account?{' '}
                        <button
                          type="button"
                          className="text-primary hover:underline font-medium"
                          onClick={() => setLoginOpen(true)}
                        >
                          Log in
                        </button>
                      </div>
                    </div>
                  ) : (
                    <Button
                      className="w-full"
                      onClick={() => setLoginOpen(true)}
                    >
                      {event.invitation_only
                        ? 'Log in to Request Invitation'
                        : t('events.loginToRegister', 'Log in to Register')}
                    </Button>
                  )}
                </CardContent>
              </Card>
            )}

            {/* PDF Download */}
            {event.pdf_url && (
              <Card>
                <CardContent className="pt-6">
                  <h3 className="font-semibold text-lg mb-3">{t('events.presentation', 'Presentation')}</h3>
                  <Button variant="outline" className="w-full" asChild>
                    <a href={event.pdf_url} target="_blank" rel="noopener noreferrer">
                      <Download className="h-4 w-4 mr-2" />
                      {t('events.downloadPdf', 'Download PDF')}
                    </a>
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>

      {/* Login Dialog */}
      <Dialog open={loginOpen} onOpenChange={setLoginOpen}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>{t('auth.login')}</DialogTitle>
            <DialogDescription>
              {t('events.loginToRegisterDesc', 'Log in to register for this event.')}{' '}
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
