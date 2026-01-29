import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MapPin, Users, Play, CalendarPlus } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/hooks/use-toast';

const mockEvents = [
  { id: '1', title: 'Webinar: Energy Efficiency Solutions for Marinas', description: 'Learn about the latest energy-saving technologies for modern marinas. Our experts will share case studies and practical implementation tips.', date_time: '2025-02-15T14:00:00Z', location: null, language: 'EN', access_level: 'public', speakers: [{ name: 'Dr. Maria Santos', title: 'Energy Consultant' }, { name: 'Jean Dupont', title: 'Marina Director' }], replay_url: null },
  { id: '2', title: 'Marina Managers Roundtable', description: 'Exclusive session for marina managers to discuss challenges and share best practices in a collaborative environment.', date_time: '2025-02-22T10:00:00Z', location: 'Monaco Yacht Club', language: 'EN', access_level: 'marina', speakers: [{ name: 'Pierre Martin', title: 'YCM Director' }], replay_url: null },
  { id: '3', title: 'Partner Showcase: Digital Tools', description: 'Discover the latest digital solutions from our technology partners designed specifically for the marina industry.', date_time: '2025-03-01T15:00:00Z', location: null, language: 'EN', access_level: 'members', speakers: [{ name: 'Tech Partners Panel', title: '' }], replay_url: null },
  { id: '4', title: 'Smart Marina 2024 Conference - Day 1', description: 'Full recording of day 1 of our flagship conference featuring keynotes on sustainability and digital transformation.', date_time: '2024-09-15T09:00:00Z', location: 'Monaco', language: 'EN', access_level: 'public', speakers: [{ name: 'Multiple Speakers', title: '' }], replay_url: 'https://example.com/replay' },
  { id: '5', title: 'Sustainable Marina Workshop', description: 'Interactive workshop on implementing sustainable practices in marina operations.', date_time: '2024-11-20T14:00:00Z', location: null, language: 'FR', access_level: 'members', speakers: [{ name: 'Sophie Blanc', title: 'Sustainability Expert' }], replay_url: 'https://example.com/replay2' },
];

export function EventsPage() {
  const { t, i18n } = useTranslation();
  const { user, profile } = useAuth();
  const [registeredEvents, setRegisteredEvents] = useState<string[]>([]);

  const now = new Date();
  const upcomingEvents = mockEvents.filter(e => new Date(e.date_time) > now);
  const pastEvents = mockEvents.filter(e => new Date(e.date_time) <= now);

  const canAccess = (level: string) => {
    if (level === 'public') return true;
    if (!user) return false;
    if (level === 'members') return true;
    if (level === 'marina') return profile?.role === 'marina_verified' || profile?.role === 'admin';
    return false;
  };

  const handleRegister = (eventId: string) => {
    if (!user) {
      toast({ title: 'Please login to register', variant: 'destructive' });
      return;
    }
    setRegisteredEvents(prev => [...prev, eventId]);
    toast({ title: t('events.registrationSuccess') });
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

  const EventCard = ({ event, isPast = false }: { event: typeof mockEvents[0]; isPast?: boolean }) => {
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
