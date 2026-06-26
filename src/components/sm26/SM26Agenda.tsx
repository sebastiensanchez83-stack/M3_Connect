import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { MapPin, Users, Check, Clock3, Download, Loader2, RefreshCw, CalendarPlus, MessageSquare } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { SM26SessionQA } from '@/components/sm26/SM26SessionQA';

// Shared SM26 programme renderer. Used full (public agenda + the event page) and
// in "mine" mode (the participant's personalised schedule on /sm26/me). Workshops
// are the only attendee choice: 1 per day, capacity-enforced with a waitlist.

interface Session {
  id: string; title: string; description: string | null; type: string;
  starts_at: string | null; ends_at: string | null; room: string | null; speakers: string | null;
  capacity: number | null; presentation_enabled: boolean; deck_path: string | null;
  share_with_audience: boolean; qa_enabled: boolean; booked_count: number; my_status: string | null;
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

// ── iCalendar (.ics) export — lets attendees drop sessions into Apple/Google/Outlook ──
const icsStamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const icsEsc = (s: string) => s.replace(/\\/g, '\\\\').replace(/[;,]/g, m => '\\' + m).replace(/\r?\n/g, '\\n');
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'session';

function buildIcs(items: Session[]): string {
  const stamp = icsStamp(new Date());
  const out = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Smart Marina Connect//SM26//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  for (const s of items) {
    if (!s.starts_at) continue;
    const start = new Date(s.starts_at);
    const end = s.ends_at ? new Date(s.ends_at) : new Date(start.getTime() + 3600_000);
    const desc = [s.description, s.speakers ? `Speakers: ${s.speakers}` : ''].filter(Boolean).join('\n');
    out.push('BEGIN:VEVENT', `UID:sm26-${s.id}@smartmarinaconnect.com`, `DTSTAMP:${stamp}`, `DTSTART:${icsStamp(start)}`, `DTEND:${icsStamp(end)}`, `SUMMARY:${icsEsc(s.title)}`);
    if (desc) out.push(`DESCRIPTION:${icsEsc(desc)}`);
    if (s.room) out.push(`LOCATION:${icsEsc(s.room)}`);
    out.push('END:VEVENT');
  }
  out.push('END:VCALENDAR');
  return out.join('\r\n');
}

function downloadIcs(filename: string, ics: string) {
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// A participant's personal calendar = the common programme (everything that isn't
// an optional workshop or a meal break) plus the workshops they actually chose.
const personalSet = (sessions: Session[]) =>
  sessions.filter(s => s.type !== 'meal' && (s.type !== 'workshop' || s.my_status === 'booked' || s.my_status === 'waitlisted'));

export function SM26Agenda({ eventId: eventIdProp, mineOnly = false }: { eventId?: string; mineOnly?: boolean }) {
  const { user } = useAuth();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [dayTab, setDayTab] = useState('all');
  const [qaOpen, setQaOpen] = useState<Set<string>>(new Set());
  const toggleQa = (id: string) => setQaOpen(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

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
  const addOne = (s: Session) => downloadIcs(`sm26-${slugify(s.title)}.ics`, buildIcs([s]));
  const addMyCalendar = () => {
    const mine = personalSet(sessions);
    if (mine.length === 0) { toast({ title: 'Nothing to add yet', description: 'Book a workshop and your schedule will fill in.' }); return; }
    downloadIcs('sm26-my-schedule.ics', buildIcs(mine));
  };

  if (loading) return <div className="flex items-center justify-center py-10"><RefreshCw className="h-6 w-6 animate-spin text-gray-300" /></div>;

  const shown = mineOnly ? personalSet(sessions) : sessions;
  const myWorkshopCount = mineOnly
    ? sessions.filter(s => s.type === 'workshop' && (s.my_status === 'booked' || s.my_status === 'waitlisted')).length
    : 0;

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
      {mineOnly && (
        <div className="space-y-3">
          {myWorkshopCount === 0 && (
            <p className="text-sm text-gray-500">
              You haven't booked a workshop yet. <Link to="/sm26/agenda" className="text-primary hover:underline">Browse the programme</Link> to choose one per day — it will appear here.
            </p>
          )}
          <div className="flex justify-end">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={addMyCalendar}>
              <CalendarPlus className="h-4 w-4" /> Add my schedule to calendar
            </Button>
          </div>
        </div>
      )}
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

                        <div className="flex items-center gap-3 flex-wrap mt-1">
                          {s.presentation_enabled && s.deck_path && s.share_with_audience && (
                            <Button variant="ghost" size="sm" className="gap-1.5 text-primary px-0 h-7" onClick={() => downloadDeck(s.deck_path!)}>
                              <Download className="h-3.5 w-3.5" /> Download slides
                            </Button>
                          )}
                          {s.starts_at && s.type !== 'meal' && (
                            <Button variant="ghost" size="sm" className="gap-1.5 text-gray-500 px-0 h-7" onClick={() => addOne(s)}>
                              <CalendarPlus className="h-3.5 w-3.5" /> Add to calendar
                            </Button>
                          )}
                          {s.qa_enabled && (
                            <Button variant="ghost" size="sm" className={`gap-1.5 px-0 h-7 ${qaOpen.has(s.id) ? 'text-primary' : 'text-gray-500'}`} onClick={() => toggleQa(s.id)}>
                              <MessageSquare className="h-3.5 w-3.5" /> Q&amp;A
                            </Button>
                          )}
                        </div>

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

                        {s.qa_enabled && qaOpen.has(s.id) && (
                          <div className="mt-3 border-t border-gray-100 pt-2.5"><SM26SessionQA sessionId={s.id} /></div>
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
