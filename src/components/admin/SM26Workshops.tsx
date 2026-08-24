import { useState, useEffect, useCallback, useMemo } from 'react';
import { Users, Trash2, Download, Search, Loader2, Check, Clock3, UserPlus, ArrowUpCircle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { SM26_ROLE_LABELS } from './AdminSM26';

// Who is in each workshop — the admin side of `sm_workshop_booking`.
//
// Bookings were readable only by the person who made them: the console showed a
// "3/10" counter and nothing else, so there was no seat list to print, none to
// hand the facilitator, and no way to seat someone who books by email. Two
// views over the same data, because staff ask the question from both ends:
// `SM26WorkshopSeats` for "who is in this workshop", `SM26ParticipantWorkshops`
// for "what has this person chosen".
//
// Everything that writes goes through the staff RPCs, which keep the same
// invariants as a participant booking themselves: one workshop per person per
// day, the stated capacity, and a waitlist that fills a freed seat at once.
// Moving someone off a workshop they already hold, and seating them past
// capacity, are both explicit and confirmed — never silent.

const TZ = 'Europe/Monaco';
export const wsTime = (s: string | null) => s ? new Date(s).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: TZ }) : '';
export const wsDay = (s: string | null) => s ? new Date(s).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ }) : 'Date to be confirmed';

export interface WorkshopSession {
  id: string; title: string; starts_at: string | null; ends_at: string | null;
  room: string | null; capacity: number | null; published: boolean;
}
export interface WorkshopBooking {
  session_id: string; session_title: string; starts_at: string | null; capacity: number | null;
  user_id: string; registration_id: string | null; full_name: string; email: string | null;
  company: string | null; roles: string[] | null; status: string; waitlist_pos: number | null;
  booked_at: string;
}
export interface Candidate {
  id: string; user_id: string | null; first_name: string | null; last_name: string | null;
  email: string | null; company_name: string | null; status: string;
}

const candidateName = (c: Candidate) =>
  [c.first_name, c.last_name].filter(Boolean).join(' ').trim() || c.company_name || c.email || 'Participant';

// ── shared data ───────────────────────────────────────────────────────────────
export function useWorkshopData(eventId: string | null) {
  const [sessions, setSessions] = useState<WorkshopSession[]>([]);
  const [bookings, setBookings] = useState<WorkshopBooking[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!eventId) { setLoading(false); return; }
    setLoading(true);
    const [{ data: ss }, { data: bk, error: bkErr }, { data: cs }] = await Promise.all([
      supabase.from('sm_session').select('id,title,starts_at,ends_at,room,capacity,published')
        .eq('event_id', eventId).eq('type', 'workshop').order('starts_at', { ascending: true, nullsFirst: false }),
      supabase.rpc('sm_admin_workshop_bookings', { p_event_id: eventId }),
      supabase.from('sm_registration').select('id,user_id,first_name,last_name,email,company_name,status')
        .eq('event_id', eventId).neq('status', 'cancelled'),
    ]);
    if (bkErr) toast({ title: 'Could not load the workshop lists', description: bkErr.message, variant: 'destructive' });
    setSessions((ss || []) as WorkshopSession[]);
    setBookings((bk || []) as WorkshopBooking[]);
    setCandidates(((cs || []) as Candidate[]).sort((a, b) => candidateName(a).localeCompare(candidateName(b))));
    setLoading(false);
  }, [eventId]);

  useEffect(() => { reload(); }, [reload]);
  return { sessions, bookings, candidates, loading, reload };
}

// ── CSV ───────────────────────────────────────────────────────────────────────
const csvCell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export function downloadWorkshopCsv(rows: WorkshopBooking[], filename: string) {
  const head = ['Workshop', 'Date', 'Start', 'Status', 'Waitlist position', 'Name', 'Company', 'Email', 'Roles', 'Booked at'];
  const body = rows.map(b => [
    b.session_title, wsDay(b.starts_at), wsTime(b.starts_at),
    b.status === 'booked' ? 'Booked' : 'Waitlisted', b.waitlist_pos ?? '',
    b.full_name, b.company ?? '', b.email ?? '',
    (b.roles || []).map(r => SM26_ROLE_LABELS[r] || r).join(' / '),
    new Date(b.booked_at).toLocaleString('en-GB', { timeZone: TZ }),
  ]);
  // BOM so Excel opens the accented names correctly instead of mangling them.
  const csv = '﻿' + [head, ...body].map(r => r.map(csvCell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── the one write path ────────────────────────────────────────────────────────
//
// The RPC refuses rather than guesses, and prefixes the two refusals staff can
// answer: `BOOKED_THAT_DAY:` (they already hold a workshop that day) and
// `FULL:` (no seat left). Both come back here as a question, so a booking is
// never moved and a room is never overfilled without somebody saying so.
async function seat(sessionId: string, userId: string, name: string, opts: { full: boolean; capacity: number | null; booked: number }) {
  const call = (replace: boolean, overbook: boolean) =>
    supabase.rpc('sm_admin_book_workshop', { p_session_id: sessionId, p_user_id: userId, p_replace: replace, p_overbook: overbook });

  let overbook = false;
  if (opts.full) {
    overbook = confirm(
      `This workshop is full (${opts.booked}/${opts.capacity}).\n\n` +
      `OK — seat ${name} anyway, over capacity.\n` +
      `Cancel — put ${name} on the waitlist instead.`);
  }
  let { data, error } = await call(false, overbook);
  if (error && error.message.includes('BOOKED_THAT_DAY:')) {
    const other = error.message.split('BOOKED_THAT_DAY:')[1].trim();
    if (!confirm(`${name} already has "${other}" that day, and nobody can attend two.\n\nMove them to this one?`)) return null;
    ({ data, error } = await call(true, overbook));
  }
  if (error) {
    toast({
      title: 'Could not add them',
      description: error.message.includes('FULL:')
        ? 'The workshop is full — free a seat first, or say yes to seating them over capacity.'
        : error.message,
      variant: 'destructive',
    });
    return null;
  }
  const result = data as string;
  toast({
    title: result === 'already_booked' ? `${name} is already booked`
      : result === 'waitlisted' ? `${name} added to the waitlist`
        : `${name} added`,
    description: result === 'waitlisted' ? 'They move up automatically when a seat is freed.'
      : result === 'booked' ? 'They have been notified and it is on their programme.' : undefined,
  });
  return result;
}

// ── picker ────────────────────────────────────────────────────────────────────
function ParticipantPicker({ candidates, exclude, onPick, busy }: {
  candidates: Candidate[]; exclude: Set<string>; onPick: (c: Candidate) => void; busy: boolean;
}) {
  const [q, setQ] = useState('');
  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    return candidates.filter(c =>
      !(c.user_id && exclude.has(c.user_id)) &&
      [candidateName(c), c.email, c.company_name].some(v => v && v.toLowerCase().includes(needle)),
    ).slice(0, 8);
  }, [q, candidates, exclude]);

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="h-4 w-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
        <Input className="pl-8" placeholder="Add someone — search by name, company or email" value={q} onChange={e => setQ(e.target.value)} />
      </div>
      {q.trim() && matches.length === 0 && (
        <p className="text-xs text-gray-400 px-1">No registration matches “{q.trim()}”.</p>
      )}
      {matches.map(c => {
        // A booking is keyed on the user account, so somebody who has never
        // signed in cannot hold a seat — say so instead of failing on click.
        const noAccount = !c.user_id;
        return (
          <button key={c.id} type="button" disabled={busy || noAccount}
            onClick={() => { onPick(c); setQ(''); }}
            className={`w-full text-left rounded-lg border px-3 py-2 flex items-center gap-2 transition-colors ${noAccount ? 'border-gray-100 bg-gray-50 cursor-not-allowed' : 'border-gray-200 hover:border-primary/50 hover:bg-primary/5'}`}>
            <UserPlus className={`h-4 w-4 shrink-0 ${noAccount ? 'text-gray-300' : 'text-primary'}`} />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-gray-900 truncate">{candidateName(c)}</span>
              <span className="block text-xs text-gray-500 truncate">{[c.company_name, c.email].filter(Boolean).join(' · ')}</span>
            </span>
            {noAccount && <span className="text-[11px] text-amber-600 shrink-0">No account yet</span>}
          </button>
        );
      })}
    </div>
  );
}

function RoleChips({ roles }: { roles: string[] | null }) {
  if (!roles?.length) return null;
  return <>{roles.map(r => <Badge key={r} variant="secondary" className="text-[10px]">{SM26_ROLE_LABELS[r] || r}</Badge>)}</>;
}

// ── view 1: one workshop, its seats ───────────────────────────────────────────
export function SM26WorkshopSeats({ session, bookings, candidates, onChange }: {
  session: WorkshopSession; bookings: WorkshopBooking[]; candidates: Candidate[]; onChange: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const mine = bookings.filter(b => b.session_id === session.id);
  const booked = mine.filter(b => b.status === 'booked');
  const waiting = mine.filter(b => b.status !== 'booked');
  const full = session.capacity != null && booked.length >= session.capacity;
  const taken = new Set(mine.map(b => b.user_id));

  const add = async (c: Candidate) => {
    if (!c.user_id) return;
    setBusy(true);
    const r = await seat(session.id, c.user_id, candidateName(c), { full, capacity: session.capacity, booked: booked.length });
    setBusy(false);
    if (r) onChange();
  };
  const promote = async (b: WorkshopBooking) => {
    setBusy(true);
    const { error } = await supabase.rpc('sm_admin_book_workshop', { p_session_id: session.id, p_user_id: b.user_id, p_replace: true, p_overbook: true });
    setBusy(false);
    if (error) { toast({ title: 'Could not seat them', description: error.message, variant: 'destructive' }); return; }
    toast({ title: `${b.full_name} is now booked in` });
    onChange();
  };
  const remove = async (b: WorkshopBooking) => {
    if (!confirm(`Remove ${b.full_name} from "${session.title}"?\n\nThey are told their place was cancelled, and the first person on the waitlist takes the seat.`)) return;
    setBusy(true);
    const { error } = await supabase.rpc('sm_admin_cancel_workshop', { p_session_id: session.id, p_user_id: b.user_id, p_notify: true });
    setBusy(false);
    if (error) { toast({ title: 'Could not remove them', description: error.message, variant: 'destructive' }); return; }
    toast({ title: `${b.full_name} removed` });
    onChange();
  };

  const Row = ({ b, waitlisted }: { b: WorkshopBooking; waitlisted?: boolean }) => (
    <div className="flex items-center gap-2 rounded-lg border border-gray-100 px-3 py-2">
      <span className={`h-6 w-6 rounded-full shrink-0 flex items-center justify-center text-[11px] font-semibold ${waitlisted ? 'bg-amber-50 text-amber-700' : 'bg-primary/10 text-primary'}`}>
        {waitlisted ? b.waitlist_pos ?? '·' : <Check className="h-3.5 w-3.5" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 flex-wrap">
          <span className="text-sm font-medium text-gray-900">{b.full_name}</span>
          <RoleChips roles={b.roles} />
        </span>
        <span className="block text-xs text-gray-500 truncate">{[b.company, b.email].filter(Boolean).join(' · ')}</span>
      </span>
      {waitlisted && (
        <button type="button" disabled={busy} onClick={() => promote(b)} title="Seat them now (over capacity if the room is full)"
          className="text-gray-400 hover:text-primary p-1.5"><ArrowUpCircle className="h-4 w-4" /></button>
      )}
      <button type="button" disabled={busy} onClick={() => remove(b)} title="Remove"
        className="text-gray-400 hover:text-red-600 p-1.5"><Trash2 className="h-4 w-4" /></button>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap text-sm">
        <span className="text-gray-500">
          {wsDay(session.starts_at)} · {wsTime(session.starts_at)}{session.room ? ` · ${session.room}` : ''}
        </span>
        <span className="flex items-center gap-2">
          <Badge className={full ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}>
            {booked.length}{session.capacity != null ? `/${session.capacity}` : ''} booked
          </Badge>
          {mine.length > 0 && (
            <Button variant="outline" size="sm" className="h-7 gap-1.5"
              onClick={() => downloadWorkshopCsv(mine, `sm26-${session.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.csv`)}>
              <Download className="h-3.5 w-3.5" /> CSV
            </Button>
          )}
        </span>
      </div>

      {booked.length === 0
        ? <p className="text-sm text-gray-400 py-2">Nobody has booked this workshop yet.</p>
        : <div className="space-y-1.5">{booked.map(b => <Row key={b.user_id} b={b} />)}</div>}

      {waiting.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-xs font-semibold text-amber-700 flex items-center gap-1.5 pt-1">
            <Clock3 className="h-3.5 w-3.5" /> Waitlist · {waiting.length}
          </div>
          {waiting.map(b => <Row key={b.user_id} b={b} waitlisted />)}
        </div>
      )}

      <div className="border-t border-gray-100 pt-3">
        <ParticipantPicker candidates={candidates} exclude={taken} onPick={add} busy={busy} />
        <p className="text-[11px] text-gray-400 mt-1.5">
          Adding someone books them and tells them — it is the same seat a participant books themselves, so the one-workshop-a-day rule and the waitlist still apply.
        </p>
      </div>
    </div>
  );
}

// ── view 2: one participant, their workshops ──────────────────────────────────
//
// A day at a time, because that is the choice: exactly one workshop per person
// per day. Days with no workshop scheduled do not appear.
export function SM26ParticipantWorkshops({ eventId, userId, name }: {
  eventId: string; userId: string | null; name: string;
}) {
  const { sessions, bookings, loading, reload } = useWorkshopData(eventId);
  const [busy, setBusy] = useState<string | null>(null);

  const days = useMemo(() => {
    const out: { key: string; items: WorkshopSession[] }[] = [];
    for (const s of sessions) {
      const k = wsDay(s.starts_at);
      let d = out.find(x => x.key === k);
      if (!d) { d = { key: k, items: [] }; out.push(d); }
      d.items.push(s);
    }
    return out;
  }, [sessions]);

  if (loading) return <div className="py-4 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gray-300" /></div>;
  if (sessions.length === 0) return <p className="text-sm text-gray-400">No workshops are scheduled yet.</p>;

  if (!userId) {
    return (
      <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
        This registration has no platform account yet, and a workshop seat is held by the account. Provision one above, then their workshops can be set here.
      </p>
    );
  }

  const mine = bookings.filter(b => b.user_id === userId);

  const choose = async (s: WorkshopSession) => {
    const bookedHere = bookings.filter(b => b.session_id === s.id && b.status === 'booked').length;
    const full = s.capacity != null && bookedHere >= s.capacity;
    setBusy(s.id);
    const r = await seat(s.id, userId, name, { full, capacity: s.capacity, booked: bookedHere });
    setBusy(null);
    if (r) reload();
  };
  const clear = async (b: WorkshopBooking) => {
    if (!confirm(`Remove ${name} from "${b.session_title}"?`)) return;
    setBusy(b.session_id);
    const { error } = await supabase.rpc('sm_admin_cancel_workshop', { p_session_id: b.session_id, p_user_id: userId, p_notify: true });
    setBusy(null);
    if (error) { toast({ title: 'Could not remove', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Removed' });
    reload();
  };

  return (
    <div className="space-y-3">
      {days.map(day => {
        const held = mine.find(b => day.items.some(s => s.id === b.session_id));
        return (
          <div key={day.key} className="rounded-lg border border-gray-100 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-xs font-semibold text-gray-700">{day.key}</span>
              {held ? (
                <span className="flex items-center gap-2">
                  <Badge className={held.status === 'booked' ? 'bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px]' : 'bg-amber-50 text-amber-700 border-amber-200 text-[10px]'}>
                    {held.status === 'booked' ? <><Check className="h-3 w-3 mr-1" /> {held.session_title}</> : <><Clock3 className="h-3 w-3 mr-1" /> Waitlisted · {held.session_title}</>}
                  </Badge>
                  <button type="button" disabled={!!busy} onClick={() => clear(held)} title="Remove" className="text-gray-400 hover:text-red-600"><X className="h-3.5 w-3.5" /></button>
                </span>
              ) : <span className="text-[11px] text-gray-400">No workshop chosen</span>}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {day.items.map(s => {
                const bookedHere = bookings.filter(b => b.session_id === s.id && b.status === 'booked').length;
                const full = s.capacity != null && bookedHere >= s.capacity;
                const current = held?.session_id === s.id;
                // Pressing the one they are waitlisted on seats them, so the
                // whole choice is workable from here; pressing the one they hold
                // does nothing.
                return (
                  <button key={s.id} type="button" disabled={!!busy || (current && held?.status === 'booked')} onClick={() => choose(s)}
                    className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${current ? 'border-primary bg-primary text-white' : 'border-gray-200 bg-white text-gray-600 hover:border-primary/50'}`}>
                    {busy === s.id && <Loader2 className="h-3 w-3 animate-spin inline mr-1" />}
                    {s.title}
                    <span className={`ml-1.5 ${current ? 'text-white/70' : full ? 'text-amber-600' : 'text-gray-400'}`}>
                      {bookedHere}{s.capacity != null ? `/${s.capacity}` : ''}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── the dialog the programme page opens ───────────────────────────────────────
export function SM26WorkshopSeatsDialog({ session, bookings, candidates, onChange, onClose }: {
  session: WorkshopSession | null; bookings: WorkshopBooking[]; candidates: Candidate[];
  onChange: () => void; onClose: () => void;
}) {
  return (
    <Dialog open={!!session} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-6">
            <Users className="h-4 w-4 text-primary shrink-0" /> <span className="min-w-0">{session?.title}</span>
          </DialogTitle>
        </DialogHeader>
        {session && <SM26WorkshopSeats session={session} bookings={bookings} candidates={candidates} onChange={onChange} />}
      </DialogContent>
    </Dialog>
  );
}
