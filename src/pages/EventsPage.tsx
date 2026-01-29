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
  cons
