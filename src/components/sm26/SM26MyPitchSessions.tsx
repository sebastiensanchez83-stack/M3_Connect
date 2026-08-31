import { useCallback, useEffect, useState } from 'react';
import { CalendarDays, Video, Users, CheckCircle2, XCircle, Clock, ChevronDown } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { Pill } from '@/components/sm26/SM26ConsoleUI';

// A startup's own view of the jury sessions it pitches in: when it is, the
// button that joins the call, and who will be listening — with a short bio each,
// so nobody walks into a pitch not knowing who is in the room. Self-scoped by
// sm_startup_my_sessions (the registration the caller can access).

const TZ = 'Europe/Monaco';
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ });
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ });

interface Juror { name: string; company: string | null; job_title: string | null; domain: string | null; bio: string | null }
interface Slot {
  id: string; title: string; slot_label: string | null; scheduled_at: string; duration_minutes: number;
  status: string; my_rsvp: string | null; zoom_sent: boolean; zoom_join_url: string | null;
  company: string; jurors: Juror[];
}

export function SM26MyPitchSessions({ eventId }: { eventId: string | null }) {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [openPanel, setOpenPanel] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!eventId) return;
    const { data } = await supabase.rpc('sm_startup_my_sessions', { p_event_id: eventId });
    setSlots((data || []) as Slot[]);
    setLoaded(true);
  }, [eventId]);
  useEffect(() => { load(); }, [load]);

  const answer = async (s: Slot, ans: 'confirmed' | 'declined') => {
    if (ans === 'declined' && !window.confirm('Tell M3 you cannot make this slot? You will be taken off the invitation for it.')) return;
    setBusy(`${s.id}:${ans}`);
    const { error } = await supabase.rpc('sm_startup_set_attendance', { p_session_id: s.id, p_answer: ans });
    setBusy(null);
    if (error) { toast({ title: 'Could not save your answer', description: error.message, variant: 'destructive' }); return; }
    toast({ title: ans === 'confirmed' ? "You're confirmed for this session" : 'Thanks — we have noted that this slot does not work' });
    load();
  };

  if (!loaded || slots.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2"><CalendarDays className="h-4 w-4 text-primary" /> Your pitch session{slots.length > 1 ? 's' : ''}</CardTitle>
        <p className="text-xs text-gray-500 mt-1">
          When you pitch, who will be listening, and the link to join. All times are Monaco time (CEST).
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {slots.map(s => {
          const declined = s.my_rsvp === 'declined';
          const open = openPanel === s.id;
          const past = new Date(s.scheduled_at).getTime() + s.duration_minutes * 60000 < Date.now();
          return (
            <div key={s.id} className={`rounded-xl border p-3.5 ${declined ? 'border-gray-200 bg-gray-50/70' : 'border-gray-200'}`}>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="font-semibold text-gray-900">{fmtDay(s.scheduled_at)}</div>
                  <div className="text-sm text-gray-600">
                    {s.slot_label || `${fmtTime(s.scheduled_at)} · ${s.duration_minutes} min`}
                    <span className="text-gray-400"> · {s.company}</span>
                  </div>
                </div>
                {declined
                  ? <Pill label="You declined" cls="bg-gray-100 text-gray-500 border-gray-200" />
                  : s.my_rsvp === 'confirmed'
                    ? <Pill label="Confirmed" cls="bg-green-50 text-green-700 border-green-200" />
                    : <Pill label="Awaiting your answer" cls="bg-amber-50 text-amber-700 border-amber-200" />}
              </div>

              {/* Join — the whole point of the card. */}
              {!declined && (
                <div className="mt-3 flex items-center gap-2 flex-wrap">
                  {s.zoom_join_url ? (
                    <Button asChild size="sm" className="gap-1.5" disabled={past}>
                      <a href={s.zoom_join_url} target="_blank" rel="noreferrer"><Video className="h-4 w-4" /> Join the Zoom session</a>
                    </Button>
                  ) : (
                    <span className="text-xs text-gray-500 inline-flex items-center gap-1.5">
                      <Clock className="h-3.5 w-3.5" /> The joining link appears here as soon as M3 sends it.
                    </span>
                  )}
                  {s.jurors.length > 0 && (
                    <button type="button" onClick={() => setOpenPanel(open ? null : s.id)}
                      className="text-xs text-primary hover:underline inline-flex items-center gap-1">
                      <Users className="h-3.5 w-3.5" /> {open ? 'Hide the panel' : `Who is on the panel (${s.jurors.length})`}
                      <ChevronDown className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} />
                    </button>
                  )}
                </div>
              )}

              {/* Confirm / decline in place, so nobody has to find the email. */}
              {!past && s.my_rsvp !== 'confirmed' && (
                <div className="mt-3 flex items-center gap-2 flex-wrap">
                  <Button size="sm" variant="outline" className="h-8 gap-1.5" disabled={!!busy}
                    onClick={() => answer(s, 'confirmed')}>
                    <CheckCircle2 className="h-3.5 w-3.5" /> {declined ? 'Actually, I can make it' : 'Confirm I can make it'}
                  </Button>
                  {!declined && (
                    <Button size="sm" variant="ghost" className="h-8 gap-1.5 text-gray-500 hover:text-red-600" disabled={!!busy}
                      onClick={() => answer(s, 'declined')}>
                      <XCircle className="h-3.5 w-3.5" /> I cannot make this slot
                    </Button>
                  )}
                </div>
              )}

              {declined && (
                <p className="text-xs text-gray-500 mt-2">
                  You are not on the invitation for this slot. M3 will be in touch about an alternative.
                </p>
              )}

              {open && s.jurors.length > 0 && (
                <div className="mt-3 pt-3 border-t border-gray-100 grid sm:grid-cols-2 gap-2">
                  {s.jurors.map((j, i) => (
                    <div key={i} className="rounded-lg border border-gray-100 bg-gray-50/60 p-2.5">
                      <div className="text-sm font-medium text-gray-900">{j.name}</div>
                      {(j.job_title || j.company) && (
                        <div className="text-[11px] text-gray-500">{[j.job_title, j.company].filter(Boolean).join(' · ')}</div>
                      )}
                      {j.domain && <div className="text-[11px] text-primary mt-0.5">{j.domain}</div>}
                      {j.bio && <p className="text-xs text-gray-600 mt-1.5 leading-relaxed">{j.bio}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
