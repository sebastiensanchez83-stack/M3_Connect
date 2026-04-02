import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { RefreshCw, Plus, Calendar, MapPin, ChevronRight, Search } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { supabase } from '@/lib/supabase';
import type { Event } from './types';
import { useAdminFilters } from './hooks/useAdminFilters';
import { AdminContextBanner } from './AdminContextBanner';

export function AdminEvents() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { getFilter, setFilters, hasFilters, clearFilters } = useAdminFilters();
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [regCounts, setRegCounts] = useState<Record<string, number>>({});

  // Read filters from URL
  const typeFilter = getFilter('type', 'all');
  const timeFilter = getFilter('time', 'all');

  useEffect(() => { loadEvents(); }, []);

  const loadEvents = async () => {
    setLoading(true);
    const { data } = await supabase.from('events').select('*').order('date_time', { ascending: false });
    const evts = (data || []) as Event[];
    setEvents(evts);

    // Load registration counts for all events
    if (evts.length > 0) {
      const counts: Record<string, number> = {};
      const ids = evts.map(e => e.id);
      // Batch count registrations
      for (const eid of ids) {
        const { count } = await supabase.from('event_registrations').select('id', { count: 'exact' }).eq('event_id', eid);
        counts[eid] = count || 0;
      }
      setRegCounts(counts);
    }
    setLoading(false);
  };

  // Filter logic
  const now = new Date();
  const filtered = events.filter(e => {
    if (search && !e.title.toLowerCase().includes(search.toLowerCase())) return false;
    if (typeFilter !== 'all' && (e.event_type || 'webinar') !== typeFilter) return false;
    if (timeFilter === 'upcoming' && new Date(e.date_time) < now) return false;
    if (timeFilter === 'past' && new Date(e.date_time) >= now) return false;
    return true;
  });

  // Context banner label
  const bannerLabel = hasFilters
    ? [
        typeFilter !== 'all' ? (typeFilter === 'on_site' ? 'On-site events' : 'Webinars') : '',
        timeFilter !== 'all' ? (timeFilter === 'upcoming' ? 'upcoming' : 'past') : '',
      ].filter(Boolean).join(', ') || 'Filtered events'
    : '';

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <RefreshCw className="h-8 w-8 animate-spin text-gray-400" />
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">{t('admin.events')} ({filtered.length})</h1>
        <Button onClick={() => navigate('/admin/events/new')} className="gap-1.5">
          <Plus className="h-4 w-4" /> Create Event
        </Button>
      </div>

      {/* Context banner */}
      {hasFilters && (
        <AdminContextBanner label={bannerLabel} count={filtered.length} onClear={clearFilters} color="pink" />
      )}

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search events..." className="pl-9 h-9" />
        </div>
        <Select value={typeFilter} onValueChange={v => setFilters({ type: v === 'all' ? '' : v } as any)}>
          <SelectTrigger className="w-40 h-9"><SelectValue placeholder="All types" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="webinar">Webinar</SelectItem>
            <SelectItem value="on_site">On-Site</SelectItem>
          </SelectContent>
        </Select>
        <Select value={timeFilter} onValueChange={v => setFilters({ time: v === 'all' ? '' : v } as any)}>
          <SelectTrigger className="w-40 h-9"><SelectValue placeholder="All events" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Events</SelectItem>
            <SelectItem value="upcoming">Upcoming</SelectItem>
            <SelectItem value="past">Past</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Event cards (clickable rows) */}
      <div className="space-y-2">
        {filtered.length === 0 ? (
          <Card className="border-0 shadow-sm">
            <CardContent className="py-12 text-center text-gray-400">No events match your filters</CardContent>
          </Card>
        ) : (
          filtered.map(e => {
            const isPast = new Date(e.date_time) < now;
            const evType = e.event_type || 'webinar';
            const regs = regCounts[e.id] || 0;
            return (
              <Card key={e.id}
                className={`border-0 shadow-sm hover:shadow-md transition-all cursor-pointer group ${isPast ? 'opacity-70' : ''}`}
                onClick={() => navigate(`/admin/events/${e.id}`)}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-4">
                    {/* Date block */}
                    <div className={`h-14 w-14 rounded-xl flex flex-col items-center justify-center shrink-0 ${
                      isPast ? 'bg-gray-100' : 'bg-pink-50'
                    }`}>
                      <span className={`text-lg font-bold leading-none ${isPast ? 'text-gray-500' : 'text-pink-700'}`}>
                        {new Date(e.date_time).getDate()}
                      </span>
                      <span className={`text-[10px] font-medium uppercase ${isPast ? 'text-gray-400' : 'text-pink-500'}`}>
                        {new Date(e.date_time).toLocaleDateString('en-US', { month: 'short' })}
                      </span>
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-sm font-semibold text-gray-900 truncate group-hover:text-primary transition-colors">
                          {e.title}
                        </span>
                        <Badge variant={evType === 'on_site' ? 'info' : 'secondary'} className="shrink-0 text-[10px]">
                          {evType === 'on_site' ? 'On-Site' : 'Webinar'}
                        </Badge>
                        <Badge variant={e.access_level === 'public' ? 'success' : 'outline'} className="shrink-0 text-[10px]">
                          {e.access_level}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-gray-500">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {new Date(e.date_time).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                          {' '}
                          {new Date(e.date_time).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        {e.location && (
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3 w-3" /> {e.location}
                          </span>
                        )}
                        <span className="flex items-center gap-1 text-violet-600 font-medium">
                          {regs} registration{regs !== 1 ? 's' : ''}
                        </span>
                      </div>
                    </div>

                    {/* Arrow */}
                    <ChevronRight className="h-5 w-5 text-gray-300 group-hover:text-primary transition-colors shrink-0" />
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
