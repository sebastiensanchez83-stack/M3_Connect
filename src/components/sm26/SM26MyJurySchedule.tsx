import { useCallback, useEffect, useState } from 'react';
import { CalendarDays, Video, CheckCircle2, Clock, XCircle, Users } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { Pill } from '@/components/sm26/SM26ConsoleUI';

// A juror's own view of the jury sessions they sit on: when, with whom, which
// startups — plus the in-app answer to the availability request, so they never
// have to hunt for the email. Self-scoped by sm_jury_my_sessions (auth.uid()).

const TZ = 'Europe/Monaco';
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ });
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ });
function tzLabel(iso: string) {
  const d = new Date(iso);
  const local = new Date(d.toLocaleString('en-US', { timeZone: TZ }));
  const utc = new Date(d.toLocaleString('en-US', { timeZone: 'UTC' }));
  return Math.round((local.getTime() - utc.getTime()) / 3600000) === 2 ? 'CEST' : 'CET';
}

interface Slot {
  id: string; title: string; slot_label: string | null; scheduled_at: string; duration_minutes: number;
  status: string; my_rsvp: string; zoom_sent: boolean; zoom_join_url: string | null; panel_code: string | null;
  co_jurors: { name: string; rsvp: string }[];
  startups: { role_assignment_id: string; company: string; submitted: boolean }[];
}

export function SM26MyJurySchedule({ eventId }: { eventId: string | null }) {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!eventId) return;
    const { data } = await supabase.rpc('sm_jury_my_sessions', { p_event_id: eventId });
    setSlots((data || []) as Slot[]);
    setLoaded(true);
  }, [eventId]);
  useEffect(() => { load(); }, [load]);

  const answer = async (s: Slot, ans: 'available' | 'unavailable') => {
    setBusy(`${s.id}:${ans}`);
    const { error } = await supabase.rpc('sm_jury_set_availability', { p_session_id: s.id, p_answer: ans });
    setBusy(null);
    if (error) { toast({ title: 'Could not save your answer', description: error.message, variant: 'destructive' }); return; }
    toast({ title: ans === 'available' ? 'Availability confirmed' : 'Thanks — we have noted that this slot does not work' });
    load();
  };

  if (!loaded || slots.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2"><CalendarDays className="h-4 w-4 text-primary" /> Your jury sessions</CardTitle>
        <p className="text-xs text-gray-500 mt-1">
          When you judge, who is on your panel and which startups pitch. All times are Monaco time.
          You score each startup here once the session is over.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {slots.map(s => {
          const end = new Date(new Date(s.scheduled_at).getTime() + s.duration_minutes * 60000).toISOString();
          const range = s.slot_label || `${fmtTime(s.scheduled_at)}–${fmtTime(end)} ${tzLabel(s.scheduled_at)}`;
          const done = s.startups.filter(x => x.submitted).length;
          return (
            <div key={s.id} className="rounded-lg border border-gray-200 p-3">
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-gray-900">{fmtDay(s.scheduled_at)}</div>
                  <div className="text-xs text-gray-500">{range}{s.panel_code ? ` · panel ${s.panel_code}` : ''}</div>
                </div>
                {s.my_rsvp === 'confirmed' || s.my_rsvp === 'available'
                  ? <Pill label="You're confirmed" cls="bg-green-50 text-green-700 border-green-200" />
                  : s.my_rsvp === 'unavailable'
                    ? <Pill label="You said you can't make it" cls="bg-red-50 text-red-600 border-red-200" />
                    : <Pill label="Awaiting your answer" cls="bg-amber-50 text-amber-700 border-amber-200" />}
              </div>

              {s.startups.length > 0 && (
                <div className="mt-2">
                  <div className="text-[11px] uppercase tracking-wide text-gray-400 mb-1">
                    {s.startups.length} startup{s.startups.length === 1 ? '' : 's'}{done > 0 ? ` · ${done} scored` : ''}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {s.startups.map(x => (
                      <span key={x.role_assignment_id} className={`inline-flex items-center gap-1 text-[11px] rounded-full border px-2 py-0.5 ${x.submitted ? 'bg-green-50 text-green-700 border-green-200' : 'bg-gray-50 text-gray-600 border-gray-200'}`}>
                        {x.submitted ? <CheckCircle2 className="h-3 w-3" /> : <Clock className="h-3 w-3" />}{x.company}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {s.co_jurors.length > 0 && (
                <div className="text-xs text-gray-500 mt-2 flex items-start gap-1.5">
                  <Users className="h-3.5 w-3.5 text-gray-300 mt-0.5 shrink-0" />
                  <span>With {s.co_jurors.map(c => c.name).join(', ')}</span>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2 mt-3">
                {s.zoom_sent && s.zoom_join_url ? (
                  <a href={s.zoom_join_url} target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm text-primary font-medium"><Video className="h-4 w-4" /> Join the Zoom meeting</a>
                ) : (
                  <span className="text-xs text-gray-400">The Zoom link will follow once the panel is confirmed.</span>
                )}
                {s.my_rsvp !== 'confirmed' && (
                  <div className="flex gap-1.5 ml-auto">
                    <Button size="sm" variant={s.my_rsvp === 'available' ? 'default' : 'outline'} className="h-7 text-xs gap-1"
                      disabled={!!busy} onClick={() => answer(s, 'available')}>
                      <CheckCircle2 className="h-3.5 w-3.5" /> I'm available
                    </Button>
                    <Button size="sm" variant={s.my_rsvp === 'unavailable' ? 'default' : 'outline'} className="h-7 text-xs gap-1"
                      disabled={!!busy} onClick={() => answer(s, 'unavailable')}>
                      <XCircle className="h-3.5 w-3.5" /> Not available
                    </Button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
