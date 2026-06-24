import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { MapPin, Users, Check, Clock3, Download, Loader2, RefreshCw } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';

// Shared SM26 programme renderer. Used full (public agenda + the event page) and
// in "mine" mode (the participant's personalised schedule on /sm26/me). Workshops
// are the only attendee choice: 1 per day, capacity-enforced with a waitlist.

interface Session {
  id: string; title: string; description: string | null; type: string;
  starts_at: string | null; ends_at: string | null; room: string | null; speakers: string | null;
  capacity: number | null; presentation_enabled: boolean; deck_path: string | null;
  share_with_audience: boolean; booked_count: number; my_status: string | null;
}

const TYPE_CLASS: Record<string, string> = {
  ceremony: 'bg-amber-50 text-amber-700 border-amber-200',
  talk: 'bg-blue-50 text-blue-700 border-blue-200',
  panel: 'bg-violet-50 text-violet-700 border-violet-200',
  pitch: 'bg-pink-50 text-pink-700 border-pink-200',
  workshop: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  meal: 'bg-gray-50 text-gray-500 border-gray-200',
  roundtable: 'bg-cyan-50 text-cyan-700 border-cyan-200',
};
const TZ = 'Europe/Monaco';
const fmtTime = (s: string | null) => s ? new Date(s).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: TZ }) : '';
const dayKey = (s: string | null) => s ? new Date(s).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ }) : 'TBD';

export function SM26Agenda({ eventId: eventIdProp, mineOnly = false }: { eventId?: string; mineOnly?: boolean }) {
  const { user } = useAuth();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [dayTab, setDayTab] = useState('all');

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [user, eventIdProp]);

  const load = async () => {
    setLoading(true);
    let eid = eventIdProp ?? null;
    if (!eid) {
      const { data: ev } = await supabase.from('sm_event').select('id').eq('slug', 'sm26').maybeSingle();
      eid = (ev as { id: string } | null)?.id ?? null;
    }
    if (!eid) { setSessions([]); setLoading(false); return; }
    const { data } = await supabase.rpc('sm_agenda', { p_event_id: eid });
    setSessions((data || []) as Session[]);
    setLoading(false);
  };

  const book = async (s: Session) => {
    if (!user) { toast({ title: 'Please sign in to book a workshop' }); return; }
    setBusy(s.id);
    const { data, error } = await supabase.rpc('sm_book_workshop', { p_session_id: s.id });
    setBusy(null);
    if (error) { toast({ title: 'Could not book', description: error.message, variant: 'destructive' }); return; }
    toast({ title: data === 'waitlisted' ? 'Added to the waitlist' : 'Workshop booked' });
    load();
  };
  const cancel = async (s: Session) => {
    setBusy(s.id);
    const { error } = await supabase.rpc('sm_cancel_workshop', { p_session_id: s.id });
    setBusy(null);
    if (error) { toast({ title: 'Could not cancel', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Booking cancelled' });
    load();
  };
  const downloadDeck = async (path: string) => {
    const { data } = await supabase.storage.from('event-media').createSignedUrl(path, 300);
    if (data) window.open(data.signedUrl, '_blank');
  };

  if (loading) return <div className="flex items-center justify-center py-10"><RefreshCw className="h-6 w-6 animate-spin text-gray-300" /></div>;

  const shown = mineOnly ? sessions.filter(s => s.my_status === 'booked' || s.my_status === 'waitlisted') : sessions;

  if (mineOnly && shown.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        You haven't booked any workshops yet. <Link to="/sm26/agenda" className="text-primary hover:underline">Browse the programme</Link> to choose one per day.
      </p>
    );
  }

  // group by day, preserving order
  const days: { key: string; items: Session[] }[] = [];
  for (const s of shown) {
    const k = dayKey(s.starts_at);
    let d = days.find(x => x.key === k);
    if (!d) { d = { key: k, items: [] }; days.push(d); }
    d.items.push(s);
  }
  if (days.length === 0) {
    return <p className="text-sm text-gray-400 py-4 text-center">The programme will be published soon.</p>;
  }

  const visibleDays = (mineOnly || dayTab === 'all') ? days : days.filter(d => d.key === dayTab);

  return (
    <div className="space-y-6">
      {!mineOnly && days.length > 1 && (
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => setDayTab('all')} className={`text-sm px-3 py-1.5 rounded-lg border transition-colors ${dayTab === 'all' ? 'bg-primary text-white border-primary' : 'bg-white text-gray-600 border-gray-200 hover:border-primary/40'}`}>Both days</button>
          {days.map(d => (
            <button key={d.key} onClick={() => setDayTab(d.key)} className={`text-sm px-3 py-1.5 rounded-lg border transition-colors ${dayTab === d.key ? 'bg-primary text-white border-primary' : 'bg-white text-gray-600 border-gray-200 hover:border-primary/40'}`}>{d.key}</button>
          ))}
        </div>
      )}
      {visibleDays.map(day => (
        <div key={day.key}>
          <h3 className="text-base font-bold text-gray-900 mb-3">{day.key}</h3>
          <div className="space-y-2">
            {day.items.map(s => {
              const isWorkshop = s.type === 'workshop';
              const full = s.capacity != null && s.booked_count >= s.capacity;
              const remaining = s.capacity != null ? Math.max(0, s.capacity - s.booked_count) : null;
              return (
                <Card key={s.id} className={`border-0 shadow-sm ${s.type === 'meal' ? 'opacity-80' : ''}`}>
                  <CardContent className="p-4">
                    <div className="flex gap-4">
                      <div className="w-16 shrink-0 text-sm">
                        <div className="font-semibold text-gray-900">{fmtTime(s.starts_at)}</div>
                        {s.ends_at && <div className="text-xs text-gray-400">{fmtTime(s.ends_at)}</div>}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-gray-900">{s.title}</span>
                          <Badge className={`text-[10px] capitalize ${TYPE_CLASS[s.type] || 'bg-gray-50 text-gray-600 border-gray-200'}`}>{s.type}</Badge>
                        </div>
                        {s.description && <p className="text-sm text-gray-600 mt-0.5">{s.description}</p>}
                        <div className="flex items-center gap-3 text-xs text-gray-500 mt-1 flex-wrap">
                          {s.room && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {s.room}</span>}
                          {s.speakers && <span>{s.speakers}</span>}
                          {isWorkshop && s.capacity != null && (
                            <span className="flex items-center gap-1"><Users className="h-3 w-3" /> {s.booked_count}/{s.capacity} booked</span>
                          )}
                        </div>

                        {s.presentation_enabled && s.deck_path && s.share_with_audience && (
                          <Button variant="ghost" size="sm" className="gap-1.5 text-primary mt-1 px-0 h-7" onClick={() => downloadDeck(s.deck_path!)}>
                            <Download className="h-3.5 w-3.5" /> Download slides
                          </Button>
                        )}

                        {isWorkshop && (
                          <div className="mt-2">
                            {s.my_status === 'booked' ? (
                              <div className="flex items-center gap-2">
                                <Badge className="bg-green-50 text-green-700 border-green-200 text-[10px]"><Check className="h-3 w-3 mr-1" /> Booked</Badge>
                                <Button variant="ghost" size="sm" className="h-7 text-gray-500" disabled={busy === s.id} onClick={() => cancel(s)}>Cancel</Button>
                              </div>
                            ) : s.my_status === 'waitlisted' ? (
                              <div className="flex items-center gap-2">
                                <Badge className="bg-amber-50 text-amber-700 border-amber-200 text-[10px]"><Clock3 className="h-3 w-3 mr-1" /> Waitlisted</Badge>
                                <Button variant="ghost" size="sm" className="h-7 text-gray-500" disabled={busy === s.id} onClick={() => cancel(s)}>Leave waitlist</Button>
                              </div>
                            ) : (
                              <Button size="sm" variant={full ? 'outline' : 'default'} className="h-8 gap-1.5" disabled={busy === s.id} onClick={() => book(s)}>
                                {busy === s.id && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                                {full ? 'Join waitlist' : `Book${remaining != null ? ` · ${remaining} left` : ''}`}
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
