import { useState, useEffect } from 'react';
import { MapPin, Users, Check, Clock3, Download, Loader2, RefreshCw, CalendarPlus, MessageSquare, ArrowRightLeft } from 'lucide-react';
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
//
// "Mine" mode shows the day's workshops under that day's schedule, so the choice
// is made where the participant already is. It used to send them off to the full
// programme to book, which meant leaving their account to do the one thing the
// account exists for.

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
const isMine = (s: Session) => s.my_status === 'booked' || s.my_status === 'waitlisted';
const isPersonal = (s: Session) => s.type !== 'meal' && (s.type !== 'workshop' || isMine(s));
const personalSet = (sessions: Session[]) => sessions.filter(isPersonal);

// Postgres raises 'FULL: …' / 'NO_BOOKING: …' so the client can tell the cases
// apart; the sentence after the tag is already written for the participant.
const plainError = (msg: string) => msg.replace(/^[A-Z_]+:\s*/, '');

export function SM26Agenda({ eventId: eventIdProp, mineOnly = false, onBookingsChange }: {
  eventId?: string; mineOnly?: boolean;
  /** Fired after a booking changes, so a host page can refresh what it counts. */
  onBookingsChange?: () => void;
}) {
  const { user } = useAuth();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [dayTab, setDayTab] = useState('all');
  const [published, setPublished] = useState(false);
  const [changingDay, setChangingDay] = useState<string | null>(null);
  const [qaOpen, setQaOpen] = useState<Set<string>>(new Set());
  const toggleQa = (id: string) => setQaOpen(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  // Keyed on the id, not the user object: coming back to the tab hands us a
  // fresh object for the same person, and reloading on that would blank the
  // programme into a spinner every time someone switches windows.
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [user?.id, eventIdProp]);

  const load = async () => {
    setLoading(true);
    let eid = eventIdProp ?? null;
    let settings: Record<string, unknown> | null = null;
    if (!eid) {
      const { data: ev } = await supabase.from('sm_event').select('id, settings').eq('slug', 'sm26').maybeSingle();
      eid = (ev as { id: string } | null)?.id ?? null;
      settings = (ev as { settings?: Record<string, unknown> } | null)?.settings ?? null;
    } else {
      const { data: ev } = await supabase.from('sm_event').select('settings').eq('id', eid).maybeSingle();
      settings = (ev as { settings?: Record<string, unknown> } | null)?.settings ?? null;
    }
    setPublished(!!(settings && settings.programme_published));
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
    load(); onBookingsChange?.();
  };
  // Moving to another workshop the same day is one call, not cancel-then-book:
  // the seat you hold is only released once the new one is secured.
  const switchTo = async (s: Session, dayK: string) => {
    setBusy(s.id);
    const { error } = await supabase.rpc('sm_switch_workshop', { p_session_id: s.id });
    setBusy(null);
    if (error) {
      toast({ title: 'Could not change workshop', description: plainError(error.message), variant: 'destructive' });
      load(); onBookingsChange?.();   // whatever happened, show the truth
      return;
    }
    toast({ title: 'Workshop changed', description: `You now have a place in ${s.title}.` });
    setChangingDay(prev => (prev === dayK ? null : prev));
    load(); onBookingsChange?.();
  };
  const cancel = async (s: Session) => {
    setBusy(s.id);
    const { error } = await supabase.rpc('sm_cancel_workshop', { p_session_id: s.id });
    setBusy(null);
    if (error) { toast({ title: 'Could not cancel', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Booking cancelled' });
    load(); onBookingsChange?.();
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

  // Download the programme as a PDF. This used to open a window and call
  // print(), which hands over the operating system's print dialog and leaves
  // people hunting for "Save as PDF" — a download button should produce a file.
  const downloadProgramme = async () => {
    const byDay: { key: string; items: Session[] }[] = [];
    for (const s of sessions) {
      const k = dayKey(s.starts_at);
      let d = byDay.find(x => x.key === k);
      if (!d) { d = { key: k, items: [] }; byDay.push(d); }
      d.items.push(s);
    }
    try {
      const { downloadProgrammePdf, toDataUrl } = await import('@/lib/programmePdf');
      const { BUNDLED_ASSETS } = await import('@/lib/invitationTemplates');
      // Same letterhead the official invitations use, so a printed programme
      // and a printed invitation are recognisably the same event.
      const [banner, footer] = await Promise.all([
        toDataUrl(BUNDLED_ASSETS.banner),
        toDataUrl(BUNDLED_ASSETS.footer),
      ]);
      await downloadProgrammePdf(byDay, {
        title: 'Smart & Sustainable Marina Rendezvous 2026',
        subtitle: '20–21 September 2026 · Yacht Club de Monaco · Programme',
      }, fmtTime, { banner, footer });
    } catch {
      toast({ title: 'Could not build the programme', description: 'Please try again.', variant: 'destructive' });
    }
  };

  if (loading) return <div className="flex items-center justify-center py-10"><RefreshCw className="h-6 w-6 animate-spin text-gray-300" /></div>;

  const myWorkshopCount = mineOnly ? sessions.filter(s => s.type === 'workshop' && isMine(s)).length : 0;

  // Group by day, preserving order. A day in "mine" mode carries two lists: the
  // participant's own schedule, and every workshop running that day so the
  // choice can be made here rather than on the full programme.
  const days: { key: string; items: Session[]; workshops: Session[] }[] = [];
  for (const s of sessions) {
    const k = dayKey(s.starts_at);
    let d = days.find(x => x.key === k);
    if (!d) { d = { key: k, items: [], workshops: [] }; days.push(d); }
    if (!mineOnly || isPersonal(s)) d.items.push(s);
    if (mineOnly && s.type === 'workshop') d.workshops.push(s);
  }
  const dayList = days.filter(d => d.items.length > 0 || d.workshops.length > 0);
  if (dayList.length === 0) {
    return <p className="text-sm text-gray-400 py-4 text-center">The programme will be published soon.</p>;
  }

  const visibleDays = (mineOnly || dayTab === 'all') ? dayList : dayList.filter(d => d.key === dayTab);

  // The day's workshops, in the participant's own account: book one, or move to
  // another. Shown open when nothing is booked yet, folded away once it is.
  const workshopChooser = (day: { key: string; workshops: Session[] }) => {
    const mine = day.workshops.find(isMine);
    const open = !mine || changingDay === day.key;
    const options = mine ? day.workshops.filter(w => w.id !== mine.id) : day.workshops;
    return (
      <div className="mt-3 rounded-xl border border-emerald-100 bg-emerald-50/40 p-3 space-y-2.5">
        {mine ? (
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-sm text-gray-700">
              Your workshop: <span className="font-semibold text-gray-900">{mine.title}</span>
              {mine.my_status === 'waitlisted' && <span className="text-amber-700"> — waitlisted</span>}
            </p>
            {options.length > 0 && (
              <Button variant="outline" size="sm" className="h-8 gap-1.5 bg-white"
                onClick={() => setChangingDay(changingDay === day.key ? null : day.key)}>
                {changingDay === day.key ? 'Keep this one' : <><ArrowRightLeft className="h-3.5 w-3.5" /> Change</>}
              </Button>
            )}
          </div>
        ) : (
          <div>
            <p className="text-sm font-semibold text-gray-900">Choose your workshop</p>
            <p className="text-xs text-gray-500">One per day, and seats are limited. You can change it here later.</p>
          </div>
        )}
        {open && options.map(w => {
          const full = w.capacity != null && w.booked_count >= w.capacity;
          const left = w.capacity != null ? Math.max(0, w.capacity - w.booked_count) : null;
          return (
            <div key={w.id} className="flex items-start justify-between gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2">
              <div className="min-w-0">
                <div className="text-sm font-medium text-gray-900">{w.title}</div>
                {w.description && <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{w.description}</p>}
                <div className="flex items-center gap-3 text-xs text-gray-500 mt-1 flex-wrap">
                  <span>{fmtTime(w.starts_at)}</span>
                  {w.room && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {w.room}</span>}
                  {left != null && (
                    <span className={`flex items-center gap-1 ${full ? 'text-amber-700' : ''}`}>
                      <Users className="h-3 w-3" /> {full ? 'Full' : `${left} seat${left === 1 ? '' : 's'} left`}
                    </span>
                  )}
                </div>
              </div>
              {mine ? (
                // Switching into a full room would mean giving up a seat for a
                // waitlist place, so it is simply not offered.
                <Button size="sm" variant="outline" className="h-8 shrink-0 gap-1.5 bg-white"
                  disabled={full || busy === w.id} onClick={() => switchTo(w, day.key)}>
                  {busy === w.id && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {full ? 'Full' : 'Switch to this'}
                </Button>
              ) : (
                <Button size="sm" variant={full ? 'outline' : 'default'} className="h-8 shrink-0 gap-1.5"
                  disabled={busy === w.id} onClick={() => book(w)}>
                  {busy === w.id && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {full ? 'Join waitlist' : 'Book'}
                </Button>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {published && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
          <span className="text-sm text-gray-700">The programme is published.</span>
          <Button variant="outline" size="sm" className="gap-1.5 bg-white" onClick={downloadProgramme}>
            <Download className="h-4 w-4" /> Download programme
          </Button>
        </div>
      )}
      {mineOnly && (
        <div className="space-y-3">
          {myWorkshopCount === 0 && (
            <p className="text-sm text-gray-500">
              You haven't chosen a workshop yet — pick one for each day below and it will join your schedule.
            </p>
          )}
          <div className="flex justify-end">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={addMyCalendar}>
              <CalendarPlus className="h-4 w-4" /> Add my schedule to calendar
            </Button>
          </div>
        </div>
      )}
      {!mineOnly && dayList.length > 1 && (
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => setDayTab('all')} className={`text-sm px-3 py-1.5 rounded-lg border transition-colors ${dayTab === 'all' ? 'bg-primary text-white border-primary' : 'bg-white text-gray-600 border-gray-200 hover:border-primary/40'}`}>Both days</button>
          {dayList.map(d => (
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
          {mineOnly && day.workshops.length > 0 && workshopChooser(day)}
        </div>
      ))}
    </div>
  );
}
