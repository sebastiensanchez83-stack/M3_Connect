import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Plus, Calendar, MapPin, ChevronRight, Lock, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { supabase } from '@/lib/supabase';
import type { Event } from './types';
import { useAdminFilters } from './hooks/useAdminFilters';
import { AdminContextBanner } from './AdminContextBanner';
import {
  AdminPageHeader, AdminFilterBar, AdminTableCard, AdminStatusPill, AdminEmpty, AdminLoading, ADMIN_BTN_PRIMARY,
} from './AdminUI';

interface ExtendedEvent extends Event {
  invitation_only?: boolean;
  is_full_day?: boolean;
  published?: boolean;
  end_date_time?: string | null;
}

export function AdminEvents() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { getFilter, setFilters, hasFilters, clearFilters } = useAdminFilters();
  const [events, setEvents] = useState<ExtendedEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [regCounts, setRegCounts] = useState<Record<string, number>>({});

  const typeFilter = getFilter('type', 'all');
  const timeFilter = getFilter('time', 'all');
  const publishedFilter = getFilter('published', 'all');

  useEffect(() => { loadEvents(); }, []);

  const loadEvents = async () => {
    setLoading(true);
    const { data } = await supabase.from('events').select('*').order('date_time', { ascending: false, nullsFirst: true });
    const evts = (data || []) as ExtendedEvent[];
    setEvents(evts);

    if (evts.length > 0) {
      const counts: Record<string, number> = {};
      for (const e of evts) {
        const { count } = await supabase.from('event_registrations').select('id', { count: 'exact' }).eq('event_id', e.id);
        counts[e.id] = count || 0;
      }
      setRegCounts(counts);
    }
    setLoading(false);
  };

  const now = new Date();
  const filtered = events.filter(e => {
    if (search && !e.title.toLowerCase().includes(search.toLowerCase())) return false;
    if (typeFilter !== 'all' && (e.event_type || 'webinar') !== typeFilter) return false;
    if (timeFilter === 'upcoming') {
      if (!e.date_time) return true; // TBD events count as upcoming
      if (new Date(e.date_time) < now) return false;
    }
    if (timeFilter === 'past') {
      if (!e.date_time) return false;
      if (new Date(e.date_time) >= now) return false;
    }
    if (publishedFilter === 'published' && e.published === false) return false;
    if (publishedFilter === 'draft' && e.published !== false) return false;
    return true;
  });

  const bannerLabel = hasFilters
    ? [
        typeFilter !== 'all' ? (typeFilter === 'on_site' ? 'On-site events' : 'Webinars') : '',
        timeFilter !== 'all' ? (timeFilter === 'upcoming' ? 'upcoming' : 'past') : '',
        publishedFilter !== 'all' ? (publishedFilter === 'published' ? 'published' : 'drafts') : '',
      ].filter(Boolean).join(', ') || 'Filtered events'
    : '';

  if (loading) return <AdminLoading />;

  return (
    <div>
      <AdminPageHeader
        title={t('admin.events')}
        count={filtered.length}
        description={t('adminUi.pages.events')}
        actions={
          <Button variant="secondary" size="sm" className={ADMIN_BTN_PRIMARY} onClick={() => navigate('/admin/events/new')}>
            <Plus className="h-4 w-4 mr-1.5" /> Create Event
          </Button>
        }
      />

      {hasFilters && (
        <AdminContextBanner label={bannerLabel} count={filtered.length} onClear={clearFilters} color="blue" />
      )}

      <AdminFilterBar search={search} onSearchChange={setSearch} searchPlaceholder="Search events...">
        <Select value={typeFilter} onValueChange={v => setFilters({ type: v === 'all' ? '' : v } as any)}>
          <SelectTrigger className="w-40"><SelectValue placeholder="All types" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="webinar">Webinar</SelectItem>
            <SelectItem value="on_site">On-Site</SelectItem>
          </SelectContent>
        </Select>
        <Select value={timeFilter} onValueChange={v => setFilters({ time: v === 'all' ? '' : v } as any)}>
          <SelectTrigger className="w-40"><SelectValue placeholder="All events" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Events</SelectItem>
            <SelectItem value="upcoming">Upcoming</SelectItem>
            <SelectItem value="past">Past</SelectItem>
          </SelectContent>
        </Select>
        <Select value={publishedFilter} onValueChange={v => setFilters({ published: v === 'all' ? '' : v } as any)}>
          <SelectTrigger className="w-40"><SelectValue placeholder="All status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="published">Published</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
          </SelectContent>
        </Select>
      </AdminFilterBar>

      <AdminTableCard footer={`${filtered.length} of ${events.length} events`}>
        <table className="w-full">
          <thead>
            <tr>
              <th className="text-left">Event</th>
              <th className="text-left">Type</th>
              <th className="text-left">When</th>
              <th className="text-left">Location</th>
              <th className="text-left">Access</th>
              <th className="text-left">Registrations</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={6}><AdminEmpty icon={Calendar} title="No events match your filters" /></td></tr>
            ) : (
              filtered.map(e => {
                const hasDate = !!e.date_time;
                const isPast = hasDate && new Date(e.date_time) < now;
                const evType = e.event_type || 'webinar';
                const regs = regCounts[e.id] || 0;
                const isDraft = e.published === false;

                return (
                  <tr key={e.id} className="group cursor-pointer" onClick={() => navigate(`/admin/events/${e.id}`)}>
                    <td>
                      <div className="flex items-center gap-3">
                        {/* Date tile */}
                        <div className={`flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-xl ${isPast ? 'bg-chip' : hasDate ? 'bg-foam' : 'bg-amber-50'}`}>
                          {hasDate ? (
                            <>
                              <span className={`text-[15px] font-semibold leading-none tabular-nums ${isPast ? 'text-meta' : 'text-navy'}`}>
                                {new Date(e.date_time).getDate()}
                              </span>
                              <span className={`mt-0.5 text-[10px] font-semibold uppercase leading-none ${isPast ? 'text-meta/70' : 'text-teal-text'}`}>
                                {new Date(e.date_time).toLocaleDateString('en-US', { month: 'short' })}
                              </span>
                            </>
                          ) : (
                            <span className="text-[11px] font-semibold text-amber-700">TBD</span>
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <Link
                              to={`/admin/events/${e.id}`}
                              onClick={ev => ev.stopPropagation()}
                              className={`rounded-sm font-semibold focus:outline-none focus-visible:shadow-focus ${isPast ? 'text-meta' : 'text-navy'}`}
                            >
                              <span className="card-ul">{e.title}</span>
                            </Link>
                            {isDraft && <AdminStatusPill tone="warning" icon={EyeOff}>Draft</AdminStatusPill>}
                            {e.invitation_only && <AdminStatusPill tone="info" icon={Lock}>Invite only</AdminStatusPill>}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td><AdminStatusPill tone={evType === 'on_site' ? 'navy' : 'neutral'}>{evType === 'on_site' ? 'On-site' : 'Webinar'}</AdminStatusPill></td>
                    <td className="whitespace-nowrap text-sm text-ink">
                      {hasDate ? (
                        <>
                          {new Date(e.date_time).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                          {!e.is_full_day && (
                            <span className="text-meta"> {new Date(e.date_time).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
                          )}
                          {e.is_full_day && <span className="text-meta"> (all day)</span>}
                        </>
                      ) : (
                        <span className="text-amber-700">Date TBD</span>
                      )}
                    </td>
                    <td className="text-sm text-ink">
                      {e.location ? (
                        <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5 shrink-0 text-meta" aria-hidden="true" />{e.location}</span>
                      ) : <span className="text-meta/60">—</span>}
                    </td>
                    <td><AdminStatusPill tone={e.access_level === 'public' ? 'success' : 'neutral'}>{e.access_level}</AdminStatusPill></td>
                    <td>
                      <div className="flex items-center justify-between gap-2">
                        <span className="whitespace-nowrap text-sm tabular-nums text-ink">{regs}</span>
                        <ChevronRight className="h-4 w-4 text-meta/50 transition-colors group-hover:text-navy" aria-hidden="true" />
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </AdminTableCard>
    </div>
  );
}
