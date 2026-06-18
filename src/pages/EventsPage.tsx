import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MapPin, Users, Play, CalendarPlus, Video, Building2 as Building2Icon, Lock, Tag } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { LoadingSkeleton } from '@/components/LoadingSkeleton';
import { AdBanner } from '@/components/ui/AdBanner';
import { toast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';

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
  speakers: { name: string; title: string }[];
  replay_url: string | null;
  meeting_url: string | null;
}

interface SectorTag {
  event_id: string;
  sector_label: string;
}

export function EventsPage() {
  const { t, i18n } = useTranslation();
  const { user, profile, isVerified, isModerator } = useAuth();
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [registeredEvents, setRegisteredEvents] = useState<string[]>([]);
  const [sectorTags, setSectorTags] = useState<SectorTag[]>([]);
  const [filterSector, setFilterSector] = useState<string | null>(null);
  const [smPaths, setSmPaths] = useState<Record<string, string>>({});
  const navigate = useNavigate();

  useEffect(() => {
    fetchEvents();
    if (user) fetchRegisteredEvents();
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  // SM-managed events (e.g. SM26) route registration to their own intake page.
  useEffect(() => {
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

  const fetchEvents = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('events')
      .select('*')
      .order('date_time', { ascending: true, nullsFirst: false });

    if (error) {
      toast({ title: t('events.errorLoading', 'Error loading events'), variant: 'destructive' });
    } else {
      // Filter out unpublished events (unless user is admin/moderator)
      const allEvents = (data || []) as Event[];
      const visible = isModerator ? allEvents : allEvents.filter(e => e.published !== false);
      setEvents(visible);

      // Fetch sector tags for all visible events
      const eventIds = visible.map(e => e.id);
      if (eventIds.length > 0) {
        const { data: esData } = await supabase
          .from('event_sectors')
          .select('event_id, sectors(label)')
          .in('event_id', eventIds);
        if (esData) {
          const tags: SectorTag[] = (esData as any[]).map(row => ({
            event_id: row.event_id,
            sector_label: row.sectors?.label || '',
          })).filter(t => t.sector_label);
          setSectorTags(tags);
        }
      }
    }
    setLoading(false);
  };

  const fetchRegisteredEvents = async () => {
    if (!user) return;
    const [{ data: regData }, { data: expoData }] = await Promise.all([
      supabase.from('event_registrations').select('event_id').eq('user_id', user.id),
      supabase.from('exposition_requests').select('event_id').eq('requested_by', user.id),
    ]);
    const regIds = (regData || []).map(r => r.event_id);
    const expoIds = (expoData || []).map(r => r.event_id);
    setRegisteredEvents([...new Set([...regIds, ...expoIds])]);
  };

  const now = new Date();
  const upcomingEvents = events.filter(e => {
    if (!e.date_time) return true; // Events without date are "upcoming" (TBD)
    return new Date(e.date_time) > now;
  });
  const pastEvents = events.filter(e => e.date_time && new Date(e.date_time) <= now);

  // Filter by sector if active
  const filterEvents = (list: Event[]) => {
    if (!filterSector) return list;
    const matchingIds = new Set(sectorTags.filter(t => t.sector_label === filterSector).map(t => t.event_id));
    return list.filter(e => matchingIds.has(e.id));
  };

  const filteredUpcoming = filterEvents(upcomingEvents);
  const filteredPast = filterEvents(pastEvents);

  // Unique sector labels for filter chips
  const uniqueSectors = [...new Set(sectorTags.map(t => t.sector_label))].sort();

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
      toast({ title: t('events.loginToRegister', 'Please login to register'), variant: 'destructive' });
      return;
    }
    if (!profileComplete) {
      toast({
        title: t('events.profileRequired', 'Complete your profile'),
        description: t('events.profileRequiredDesc', 'You need to complete and verify your profile before registering for events.'),
        variant: 'destructive',
      });
      return;
    }
    const { error } = await supabase.from('event_registrations').insert({
      event_id: eventId,
      user_id: user.id,
    });
    if (error) {
      if (error.code === '23505') {
        toast({ title: t('events.alreadyRegistered', 'Already registered'), variant: 'destructive' });
      } else {
        toast({ title: t('events.registrationFailed', 'Registration failed'), variant: 'destructive' });
      }
    } else {
      setRegisteredEvents(prev => [...prev, eventId]);
      toast({ title: t('events.registrationSuccess') });
    }
  };

  const handleAddToCalendar = (event: Event) => {
    if (!event.date_time) return;
    const start = new Date(event.date_time);
    const end = event.end_date_time
      ? new Date(event.end_date_time)
      : new Date(start.getTime() + 60 * 60 * 1000);
    const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const icsContent = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Smart Marina Connect//EN', 'BEGIN:VEVENT',
      `DTSTART:${fmt(start)}`, `DTEND:${fmt(end)}`,
      `SUMMARY:${event.title}`,
      `DESCRIPTION:${(event.description || '').replace(/\n/g, '\\n')}`,
      event.location ? `LOCATION:${event.location}` : '',
      'END:VEVENT', 'END:VCALENDAR',
    ].filter(Boolean).join('\r\n');
    const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${event.title.replace(/[^a-zA-Z0-9]/g, '_')}.ics`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast({ title: t('events.calendarDownloaded', 'Calendar file downloaded') });
  };

  const getAccessBadge = (level: string) => {
    switch (level) {
      case 'public': return <Badge variant="success">{t('resources.accessLevels.public')}</Badge>;
      case 'members': return <Badge variant="info">{t('resources.accessLevels.members')}</Badge>;
      case 'marina': return <Badge variant="purple">{t('resources.accessLevels.marina')}</Badge>;
      default: return null;
    }
  };

  const formatDate = (dateStr: string | null, isFullDay?: boolean) => {
    if (!dateStr) return { day: '?', month: 'TBD', time: '' };
    const date = new Date(dateStr);
    return {
      day: date.getDate(),
      month: date.toLocaleString(i18n.language === 'fr' ? 'fr-FR' : 'en-US', { month: 'short' }),
      time: isFullDay ? 'All day' : date.toLocaleTimeString(i18n.language === 'fr' ? 'fr-FR' : 'en-US', { hour: '2-digit', minute: '2-digit' }),
    };
  };

  const EventCard = ({ event, isPast = false }: { event: Event; isPast?: boolean }) => {
    const { day, month, time } = formatDate(event.date_time, event.is_full_day);
    const isRegistered = registeredEvents.includes(event.id);
    const hasAccess = canAccess(event.access_level);
    const eventSectors = sectorTags.filter(t => t.event_id === event.id);

    return (
      <Link to={`/events/${event.id}`} className="block">
        <Card className="card-hover group cursor-pointer">
          <CardContent className="p-6">
            <div className="flex gap-4">
              <div className="bg-primary/10 rounded-lg p-3 text-center min-w-[70px]">
                <div className="text-2xl font-bold text-primary">{day}</div>
                <div className="text-sm text-gray-600">{month}</div>
                {time && <div className="text-xs text-gray-500">{time}</div>}
              </div>
              <div className="flex-1">
                <div className="flex flex-wrap gap-2 mb-2">
                  {getAccessBadge(event.access_level)}
                  {event.event_type === 'webinar' ? (
                    <Badge className="bg-violet-100 text-violet-700 border-violet-200">
                      <Video className="h-3 w-3 mr-1" />Webinar
                    </Badge>
                  ) : (
                    <Badge className="bg-amber-100 text-amber-700 border-amber-200">
                      <Building2Icon className="h-3 w-3 mr-1" />On-site Event
                    </Badge>
                  )}
                  {event.invitation_only && (
                    <Badge className="bg-purple-100 text-purple-700 border-purple-200">
                      <Lock className="h-3 w-3 mr-1" />Invitation Only
                    </Badge>
                  )}
                  {event.location && (
                    <Badge variant="outline"><MapPin className="h-3 w-3 mr-1" />{event.location}</Badge>
                  )}
                  {isPast && event.replay_url && (
                    <Badge variant="secondary">Replay</Badge>
                  )}
                  {!event.published && isModerator && (
                    <Badge className="bg-gray-100 text-gray-500 border-gray-300">Draft</Badge>
                  )}
                </div>
                <h3 className="font-semibold text-lg mb-2 group-hover:text-primary transition-colors">{event.title}</h3>
                <p className="text-gray-600 text-sm mb-3 line-clamp-2">{event.description}</p>

                {/* Sector tags */}
                {eventSectors.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {eventSectors.map((s, i) => (
                      <span key={i} className="inline-flex items-center gap-1 text-xs bg-gray-100 text-gray-600 rounded-full px-2.5 py-0.5">
                        <Tag className="h-2.5 w-2.5" />{s.sector_label}
                      </span>
                    ))}
                  </div>
                )}

                {event.event_type === 'webinar' && event.speakers && event.speakers.length > 0 && (
                  <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
                    <Users className="h-4 w-4" />
                    {event.speakers.map(s => s.name).join(', ')}
                  </div>
                )}
                <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                  {isPast && event.replay_url ? (
                    <Button
                      size="sm"
                      disabled={!hasAccess}
                      onClick={() => { if (hasAccess && event.replay_url) window.open(event.replay_url, '_blank'); }}
                    >
                      <Play className="h-4 w-4 mr-2" />{t('events.watchReplay')}
                    </Button>
                  ) : isPast ? (
                    <Button size="sm" variant="secondary" disabled>
                      {t('events.eventEnded', 'Event Ended')}
                    </Button>
                  ) : event.invitation_only ? (
                    <Button size="sm" variant="outline" disabled={!hasAccess}>
                      <Lock className="h-4 w-4 mr-2" />
                      Request Invitation
                    </Button>
                  ) : isRegistered && event.event_type === 'webinar' && event.meeting_url ? (
                    <Button
                      size="sm"
                      className="bg-violet-600 hover:bg-violet-700"
                      onClick={() => window.open(event.meeting_url!, '_blank')}
                    >
                      <Video className="h-4 w-4 mr-2" />
                      {t('events.joinWebinar', 'Join webinar')}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      disabled={!hasAccess || (isRegistered && !smPaths[event.id])}
                      onClick={(e) => {
                        const p = smPaths[event.id];
                        if (p) { e.preventDefault(); e.stopPropagation(); navigate(p); return; }
                        handleRegister(event.id);
                      }}
                      variant={isRegistered && !smPaths[event.id] ? 'secondary' : 'default'}
                    >
                      {isRegistered && !smPaths[event.id] ? t('events.registered') : t('events.register')}
                    </Button>
                  )}
                  {!isPast && event.date_time && (
                    <Button size="sm" variant="outline" onClick={() => handleAddToCalendar(event)}>
                      <CalendarPlus className="h-4 w-4 mr-2" />{t('events.addToCalendar')}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </Link>
    );
  };

  if (loading) {
    return <LoadingSkeleton variant="page" />;
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <Helmet>
        <title>Events — Smart Marina Connect</title>
        <meta name="description" content="Discover upcoming marina industry events, webinars and conferences on Smart Marina Connect." />
        <meta property="og:title" content="Events — Smart Marina Connect" />
        <meta property="og:description" content="Marina industry events, webinars and conferences. Register and connect with professionals." />
      </Helmet>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-primary mb-2">{t('events.title')}</h1>
        <p className="text-gray-600">{t('events.subtitle')}</p>
      </div>

      <AdBanner placement="events" className="mb-6" />

      {/* Sector filter chips */}
      {uniqueSectors.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-6">
          <button
            onClick={() => setFilterSector(null)}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
              !filterSector ? 'bg-primary text-white border-primary' : 'bg-white text-gray-600 border-gray-200 hover:border-primary/40'
            }`}
          >
            All
          </button>
          {uniqueSectors.map(s => (
            <button
              key={s}
              onClick={() => setFilterSector(filterSector === s ? null : s)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                filterSector === s ? 'bg-primary text-white border-primary' : 'bg-white text-gray-600 border-gray-200 hover:border-primary/40'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <Tabs defaultValue="upcoming" className="w-full">
        <TabsList className="mb-6">
          <TabsTrigger value="upcoming">{t('events.upcoming')} ({filteredUpcoming.length})</TabsTrigger>
          <TabsTrigger value="past">{t('events.past')} ({filteredPast.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="upcoming">
          <div className="space-y-4">
            {filteredUpcoming.map(event => (
              <EventCard key={event.id} event={event} />
            ))}
            {filteredUpcoming.length === 0 && (
              <div className="text-center py-12 text-gray-500">No upcoming events</div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="past">
          <div className="space-y-4">
            {filteredPast.map(event => (
              <EventCard key={event.id} event={event} isPast />
            ))}
            {filteredPast.length === 0 && (
              <div className="text-center py-12 text-gray-500">No past events</div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
