import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MapPin, Users, Play, CalendarPlus, Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';

interface Event {
  id: string;
  title: string;
  description: string | null;
  date_time: string;
  location: string | null;
  language: string;
  access_level: string;
  speakers: { name: string; title: string }[];
  replay_url: string | null;
}

export function EventsPage() {
  const { t, i18n } = useTranslation();
  const { user, profile } = useAuth();
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [registeredEvents, setRegisteredEvents] = useState<string[]>([]);

  useEffect(() => {
    fetchEvents();
  }, []);

  const fetchEvents = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('events')
      .select('*')
      .order('date_time', { ascending: true });

    if (error) {
      console.error('Error fetching events:', error);
      toast({ title: 'Error loading events', variant: 'destructive' });
    } else {
      setEvents(data || []);
    }
    setLoading(false);
  };

  const now = new Date();
  const upcomingEvents = events.filter(e => new Date(e.date_time) > now);
  const pastEvents = events.filter(e => new Date(e.date_time) <= now);

  const canAccess = (level: string) => {
    if (level === 'public') return true;
    if (!user) return false;
    if (level === 'members') return true;
    if (level === 'marina') return profile?.role === 'marina_verified' || profile?.role === 'admin';
    return false;
  };

  const handleRegister = async (eventId: string) => {
    if (!user) {
      toast({ title: 'Please login to register', variant: 'destructive' });
      return;
    }

    const { error } = await supabase.from('event_registrations').insert({
      event_id: eventId,
      user_id: user.id,
    });

    if (error) {
      if (error.code === '23505') {
        toast({ title: 'Already registered', variant: 'destructive' });
      } else {
        toast({ title: 'Registration failed', variant: 'destructive' });
      }
    } else {
      setRegisteredEvents(prev => [...prev, eventId]);
      toast({ title: t('events.registrationSuccess') });
    }
  };

  const getAccessBadge = (level: string) => {
    switch (level) {
      case 'public': return <Badge variant="success">🌍 {t('resources.accessLevels.public')}</Badge>;
      case 'members': return <Badge variant="info">👤 {t('resources.accessLevels.members')}</Badge>;
      case 'marina': return <Badge variant="purple">⚓ {t('resources.accessLevels.marina')}</Badge>;
      default: return null;
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return {
      day: date.getDate(),
      month: date.toLocaleString(i18n.language === 'fr' ? 'fr-FR' : 'en-US', { month: 'short' }),
      time: date.toLocaleTimeString(i18n.language === 'fr' ? 'fr-FR' : 'en-US', { hour: '2-digit', minute: '2-digit' }),
    };
  };

  const EventCard = ({ event, isPast = false }: { event: Event; isPast?: boolean }) => {
    const { day, month, time } = formatDate(event.date_time);
    const isRegistered = registeredEvents.includes(event.id);
    const hasAccess = canAccess(event.access_level);

    return (
      <Card className="card-hover">
        <CardContent className="p-6">
          <div className="flex gap-4">
            <div className="bg-primary/10 rounded-lg p-3 text-center min-w-[70px]">
              <div className="text-2xl font-bold text-primary">{day}</div>
              <div className="text-sm text-gray-600">{month}</div>
              <div className="text-xs text-gray-500">{time}</div>
            </div>
            <div className="flex-1">
              <div className="flex flex-wrap gap-2 mb-2">
                {getAccessBadge(event.access_level)}
                {event.location ? (
                  <Badge variant="outline"><MapPin className="h-3 w-3 mr-1" />{t('events.inPerson')}</Badge>
                ) : (
                  <Badge variant="outline">{t('events.online')}</Badge>
                )}
                {isPast && event.replay_url && (
                  <Badge variant="secondary">Replay</Badge>
                )}
              </div>
              <h3 className="font-semibold text-lg mb-2">{event.title}</h3>
              <p className="text-gray-600 text-sm mb-3 line-clamp-2">{event.description}</p>
              {event.speakers && event.speakers.length > 0 && (
                <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
                  <Users className="h-4 w-4" />
                  {event.speakers.map(s => s.name).join(', ')}
                </div>
              )}
              <div className="flex gap-2">
                {isPast && event.replay_url ? (
                  <Button size="sm" disabled={!hasAccess}>
                    <Play className="h-4 w-4 mr-2" />{t('events.watchReplay')}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    disabled={!hasAccess || isRegistered}
                    onClick={() => handleRegister(event.id)}
                    variant={isRegistered ? 'secondary' : 'default'}
                  >
                    {isRegistered ? t('events.registered') : t('events.register')}
                  </Button>
                )}
                {!isPast && (
                  <Button size="sm" variant="outline">
                    <CalendarPlus className="h-4 w-4 mr-2" />{t('events.addToCalendar')}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8 text-center">
        <Loader2 className="h-8 w-8 animate-spin mx-auto" />
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-primary mb-2">{t('events.title')}</h1>
        <p className="text-gray-600">{t('events.subtitle')}</p>
      </div>

      <Tabs defaultValue="upcoming" className="w-full">
        <TabsList className="mb-6">
          <TabsTrigger value="upcoming">{t('events.upcoming')} ({upcomingEvents.length})</TabsTrigger>
          <TabsTrigger value="past">{t('events.past')} ({pastEvents.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="upcoming">
          <div className="space-y-4">
            {upcomingEvents.map(event => (
              <EventCard key={event.id} event={event} />
            ))}
            {upcomingEvents.length === 0 && (
              <div className="text-center py-12 text-gray-500">No upcoming events</div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="past">
          <div className="space-y-4">
            {pastEvents.map(event => (
              <EventCard key={event.id} event={event} isPast />
            ))}
            {pastEvents.length === 0 && (
              <div className="text-center py-12 text-gray-500">No past events</div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
