import { useMemo, useState } from 'react';
import {
  Calendar, Plus, Video, Mail, X, Send, CheckCircle2, Clock, AlertTriangle, Trash2, Wand2, FlaskConical,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { Pill } from '@/components/sm26/SM26ConsoleUI';

// The scheduler at the heart of the Yachting Ventures console: a grid of time
// slots x jury panels, where each filled cell is one panel hearing one startup
// batch. Sending is deliberately staged so nothing reaches a juror by accident:
//   draft -> availability request -> panel confirms -> Zoom invite -> scored.

export const TZ = 'Europe/Monaco';
export const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ });
export const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ });
export function tzLabel(iso: string): string {
  const d = new Date(iso);
  const local = new Date(d.toLocaleString('en-US', { timeZone: TZ }));
  const utc = new Date(d.toLocaleString('en-US', { timeZone: 'UTC' }));
  return Math.round((local.getTime() - utc.getTime()) / 3600000) === 2 ? 'CEST' : 'CET';
}
export const slotRange = (iso: string, minutes: number) =>
  `${fmtTime(iso)}–${fmtTime(new Date(new Date(iso).getTime() + minutes * 60000).toISOString())} ${tzLabel(iso)}`;

export interface CellJuror { user_id: string; name: string; rsvp: string; responded_at: string | null; invited_at: string | null }
// Startups now carry their own RSVP, at the same grain and with the same three
// fields as the jurors — so the chips, the counts and the chase read the same
// on both sides of the session.
export interface CellEntry {
  role_assignment_id: string; company: string;
  rsvp: string; responded_at: string | null; invited_at: string | null;
}
export interface Cell {
  id: string; title: string; slot_label: string | null; scheduled_at: string; duration_minutes: number;
  status: string; is_test: boolean; zoom_sent: boolean; zoom_sent_at: string | null; zoom_join_url: string | null;
  last_availability_email_at: string | null; last_startup_email_at: string | null;
  jury_group_id: string | null; jury_group_code: string | null;
  startup_group_id: string | null; startup_group_code: string | null;
  jurors: CellJuror[]; entries: CellEntry[]; guests: CellGuest[]; assigned: number; submitted: number;
}
// An address on the Zoom invitation that is not an account: a juror recruited
// by email who will never sign in. No RSVP and no scorecard — those need a
// user, which is what makes a guest a guest.
export interface CellGuest { email: string; name: string | null }
export interface GroupRef { id: string; code: string; name: string | null; size: number }

export type CellState = 'cancelled' | 'draft' | 'asked' | 'invited' | 'scored';
export function cellState(c: Cell): CellState {
  if (c.status === 'cancelled') return 'cancelled';
  if (c.zoom_sent) return c.assigned > 0 && c.submitted >= c.assigned ? 'scored' : 'invited';
  return c.last_availability_email_at ? 'asked' : 'draft';
}
const STATE_META: Record<CellState, { label: string; cls: string }> = {
  draft: { label: 'Draft — nothing sent', cls: 'bg-gray-50 text-gray-600 border-gray-200' },
  asked: { label: 'Availability requested', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  invited: { label: 'Zoom invite sent', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  scored: { label: 'All scores in', cls: 'bg-green-50 text-green-700 border-green-200' },
  cancelled: { label: 'Cancelled', cls: 'bg-red-50 text-red-600 border-red-200' },
};

// How long a juror has been sitting on the question. "Silent" alone doesn't say
// whether to chase; "silent for 6 days" does. invited_at is stamped only by a
// real send, never by a preview, so no answer at all means never contacted.
export function silenceLabel(invitedAt: string | null): string {
  if (!invitedAt) return '(never asked)';
  const days = Math.floor((Date.now() - new Date(invitedAt).getTime()) / 86400000);
  if (days <= 0) return '(asked today)';
  if (days === 1) return '(asked yesterday)';
  return `(asked ${days} days ago)`;
}

const rsvpMeta = (s: string) =>
  s === 'confirmed' ? { cls: 'bg-green-50 text-green-700 border-green-200', label: 'confirmed' }
  : s === 'available' ? { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', label: 'available' }
  : s === 'unavailable' ? { cls: 'bg-red-50 text-red-600 border-red-200', label: 'not available' }
  : { cls: 'bg-gray-50 text-gray-500 border-gray-200', label: 'no answer' };

// Startups answer one question, so they get three states rather than the
// jurors' four. Same colours for the same meanings.
const entryMeta = (s: string) =>
  s === 'confirmed' ? { cls: 'bg-green-50 text-green-700 border-green-200', label: 'coming' }
  : s === 'declined' ? { cls: 'bg-red-50 text-red-600 border-red-200', label: "can't make it" }
  : { cls: 'bg-gray-100 text-gray-600 border-gray-200', label: 'no answer' };

// A datetime-local value is wall-clock in the BROWSER's zone. Gabbi schedules in
// Monaco time, so convert explicitly instead of trusting the local offset.
function monacoLocalToISO(v: string): string | null {
  if (!v) return null;
  const [d, t] = v.split('T');
  if (!d || !t) return null;
  const guess = new Date(`${d}T${t}:00Z`);
  const asMonaco = new Date(guess.toLocaleString('en-US', { timeZone: TZ }));
  const asUtc = new Date(guess.toLocaleString('en-US', { timeZone: 'UTC' }));
  return new Date(guess.getTime() - (asMonaco.getTime() - asUtc.getTime())).toISOString();
}
const isoToMonacoLocal = (iso: string) => {
  const d = new Date(iso);
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
  const g = (k: string) => p.find(x => x.type === k)?.value || '00';
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}`;
};

interface Props {
  eventId: string;
  cells: Cell[];
  panels: GroupRef[];
  batches: GroupRef[];
  testEmail: string | null;
  onChanged: () => void;
}

export function SM26YVTimetable({ eventId, cells, panels, batches, testEmail, onChanged }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showAuto, setShowAuto] = useState(false);
  const [fPanel, setFPanel] = useState('');
  const [fBatch, setFBatch] = useState('');
  const [fWhen, setFWhen] = useState('');
  const [fDur, setFDur] = useState('60');
  const [fTest, setFTest] = useState(false);
  // auto-build
  const [aStart, setAStart] = useState('');
  const [aSlot, setASlot] = useState('60');
  const [aBreak, setABreak] = useState('0');
  const [aRounds, setARounds] = useState('1');
  const [aSkip, setASkip] = useState<Set<string>>(new Set());

  const live = cells.filter(c => c.status !== 'cancelled');
  const days = useMemo(() => {
    const map = new Map<string, Cell[]>();
    for (const c of cells) {
      const k = fmtDay(c.scheduled_at);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(c);
    }
    return [...map.entries()];
  }, [cells]);

  const call = async (label: string, fn: () => PromiseLike<{ error?: unknown; data?: unknown }>) => {
    setBusy(label);
    try { return await fn(); } finally { setBusy(null); }
  };

  const addCell = async () => {
    const iso = monacoLocalToISO(fWhen);
    if (!fPanel || !fBatch || !iso) { toast({ title: 'Pick a panel, a batch and a time', variant: 'destructive' }); return; }
    const { error } = await call('add', () => supabase.rpc('sm_yv_session_create', {
      p_event_id: eventId, p_jury_group_id: fPanel, p_startup_group_id: fBatch,
      p_scheduled_at: iso, p_duration: Number(fDur) || 60,
      p_slot_label: slotRange(iso, Number(fDur) || 60), p_title: null, p_is_test: fTest,
    }));
    if (error) { toast({ title: 'Could not create the slot', description: (error as { message?: string }).message, variant: 'destructive' }); return; }
    toast({ title: 'Slot created', description: 'Draft only — no Zoom and no emails yet.' });
    setShowAdd(false); setFPanel(''); setFBatch(''); setFWhen(''); setFTest(false);
    onChanged();
  };

  // Round-robin proposal: in each round every panel meets a different batch, so
  // batches rotate across panels instead of one panel hearing everything.
  const proposal = useMemo(() => {
    const iso0 = monacoLocalToISO(aStart);
    if (!iso0 || !panels.length || !batches.length) return [];
    const slot = Number(aSlot) || 60;
    const gap = Number(aBreak) || 0;
    const rounds = Math.max(1, Math.min(12, Number(aRounds) || 1));
    const out: { key: string; panel: GroupRef; batch: GroupRef; iso: string }[] = [];
    for (let r = 0; r < rounds; r++) {
      const when = new Date(new Date(iso0).getTime() + r * (slot + gap) * 60000).toISOString();
      panels.forEach((p, pi) => {
        out.push({ key: `${r}-${pi}`, panel: p, batch: batches[(pi + r) % batches.length], iso: when });
      });
    }
    return out;
  }, [aStart, aSlot, aBreak, aRounds, panels, batches]);

  const runAuto = async () => {
    const rows = proposal.filter(p => !aSkip.has(p.key));
    if (!rows.length) { toast({ title: 'Nothing to create', variant: 'destructive' }); return; }
    setBusy('auto');
    let made = 0; let failed = 0;
    for (const r of rows) {
      const { error } = await supabase.rpc('sm_yv_session_create', {
        p_event_id: eventId, p_jury_group_id: r.panel.id, p_startup_group_id: r.batch.id,
        p_scheduled_at: r.iso, p_duration: Number(aSlot) || 60,
        p_slot_label: slotRange(r.iso, Number(aSlot) || 60), p_title: null, p_is_test: false,
      });
      if (error) failed++; else made++;
    }
    setBusy(null);
    toast({
      title: `${made} slot${made === 1 ? '' : 's'} created`,
      description: failed ? `${failed} could not be created.` : 'All drafts — nothing has been emailed.',
      variant: failed ? 'destructive' : undefined,
    });
    setShowAuto(false); setASkip(new Set());
    onChanged();
  };

  const invoke = async (label: string, action: string, c: Cell, extra: Record<string, unknown> = {}, asTest = false) => {
    setBusy(`${label}:${c.id}`);
    const { data, error } = await supabase.functions.invoke('sm26-jury-session', {
      body: { action, session_id: c.id, ...(asTest && testEmail ? { test_email: testEmail } : {}), ...extra },
    });
    setBusy(null);
    const err = error || (data as { error?: string })?.error;
    if (err) { toast({ title: 'Could not send', description: typeof err === 'string' ? err : 'Please try again.', variant: 'destructive' }); return false; }
    const r = (data || {}) as { sent?: number; failed?: number; skipped?: number; nothing_to_do?: boolean };
    // "Everyone has already answered" is the outcome we are working towards, so
    // it gets a plain confirmation rather than a red banner.
    if (r.nothing_to_do) {
      toast({ title: 'Nobody left to chase', description: `All ${r.skipped ?? 0} jurors on this panel have answered.` });
      onChanged();
      return true;
    }
    toast({
      title: asTest ? `Test sent to ${testEmail}` : `Sent to ${r.sent ?? 0} recipient${r.sent === 1 ? '' : 's'}`,
      description: r.failed
        ? `${r.failed} could not be delivered — check the address.`
        : r.skipped ? `${r.skipped} already answered and were left alone.` : undefined,
      variant: r.failed ? 'destructive' : undefined,
    });
    onChanged();
    return true;
  };

  const sendAvailability = (c: Cell, asTest = false) => {
    if (!asTest && c.last_availability_email_at && !confirm('This writes to the WHOLE panel, including jurors who have already answered. Send to everyone?')) return;
    invoke('avail', 'notify_availability', c, {}, asTest);
  };
  // The everyday action once the first request has gone out: only the jurors
  // still sitting on "no answer". The count is spelled out in the button and
  // again in the confirmation, so the number of people about to be emailed is
  // never a surprise.
  const chaseSilent = (c: Cell, asTest = false) => {
    const silent = c.jurors.filter(j => j.rsvp === 'invited');
    if (!asTest && !silent.length) {
      toast({ title: 'Nobody left to chase', description: 'Every juror on this panel has answered.' });
      return;
    }
    if (!asTest && !confirm(`Email the ${silent.length} juror${silent.length === 1 ? '' : 's'} who ${silent.length === 1 ? 'has' : 'have'} not answered?\n\n${silent.map(j => `· ${j.name}`).join('\n')}\n\nNobody who has already replied will be contacted.`)) return;
    invoke('chase', 'notify_availability', c, { only_unanswered: true }, asTest);
  };

  // The startups' side of the same step. Their answer is an acknowledgement,
  // not a negotiation, so the confirmation says what will actually happen.
  const sendStartupSlot = (c: Cell, asTest = false) => {
    if (!asTest && !confirm(`Tell all ${c.entries.length} startup${c.entries.length === 1 ? '' : 's'} in this batch their slot and ask them to confirm they'll be there?`)) return;
    invoke('slot', 'notify_startup_slot', c, {}, asTest);
  };
  const chaseStartups = (c: Cell, asTest = false) => {
    const silent = c.entries.filter(e => e.rsvp === 'invited');
    if (!asTest && !silent.length) {
      toast({ title: 'Nobody left to chase', description: 'Every startup in this batch has answered.' });
      return;
    }
    if (!asTest && !confirm(`Email the ${silent.length} startup${silent.length === 1 ? '' : 's'} who ${silent.length === 1 ? 'has' : 'have'} not answered?\n\n${silent.map(e => `· ${e.company}`).join('\n')}\n\nNobody who has already replied will be contacted.`)) return;
    invoke('slotchase', 'notify_startup_slot', c, { only_unanswered: true }, asTest);
  };
  const sendZoom = (c: Cell, asTest = false) => {
    const yes = c.jurors.filter(j => j.rsvp === 'available' || j.rsvp === 'confirmed').length;
    const force = yes === 0;
    if (!asTest && force && !confirm(`No juror has confirmed availability for "${c.title}" yet. Create the Zoom and invite the whole panel anyway?`)) return;
    if (!asTest && !force && !confirm(`Create the Zoom meeting and send the calendar invitation to ${yes} confirmed juror${yes === 1 ? '' : 's'} and the ${c.entries.length} startup${c.entries.length === 1 ? '' : 's'}?`)) return;
    invoke('zoom', 'send_zoom', c, force ? { force: true } : {}, asTest);
  };
  const sendEvaluate = (c: Cell, asTest = false) => {
    if (!asTest && !confirm("Email every juror on this panel a link to score the session's startups?")) return;
    invoke('eval', 'notify_evaluate', c, {}, asTest);
  };
  // Guests exist for jurors who were recruited by email and will never sign in.
  // They are added to the Zoom invitation only — deliberately no RSVP and no
  // scorecard, because both of those key on a user account.
  const addGuest = async (c: Cell) => {
    const email = prompt(`Add someone to the Zoom invitation for "${c.title}".\n\nThey will receive the calendar invitation like everyone else, but no availability request and no scorecard — those need a platform account.\n\nEmail address:`);
    if (!email?.trim()) return;
    const name = prompt('Their name (optional — it appears on the calendar invitation):') || null;
    setBusy(`guest:${c.id}`);
    const { data, error } = await supabase.rpc('sm_yv_session_guest_add', { p_session_id: c.id, p_email: email.trim(), p_name: name });
    setBusy(null);
    const res = (data || {}) as { ok?: boolean; error?: string };
    if (error || !res.ok) {
      toast({
        title: 'Could not add them',
        description: res.error === 'bad_email' ? "That doesn't look like an email address." : error?.message,
        variant: 'destructive',
      });
      return;
    }
    toast({
      title: 'Added to the Zoom invitation',
      description: c.zoom_sent
        ? 'The invitation has already gone out for this slot, so send them the Zoom link by hand.'
        : 'They will be included when you send the Zoom invitation.',
    });
    onChanged();
  };
  const removeGuest = async (c: Cell, email: string) => {
    if (!confirm(`Remove ${email} from the Zoom invitation for "${c.title}"?`)) return;
    setBusy(`guest:${c.id}`);
    const { error } = await supabase.rpc('sm_yv_session_guest_remove', { p_session_id: c.id, p_email: email });
    setBusy(null);
    if (error) { toast({ title: 'Could not remove them', description: error.message, variant: 'destructive' }); return; }
    onChanged();
  };

  const cancelCell = async (c: Cell) => {
    if (!confirm(`Cancel "${c.title}"? Any Zoom meeting is deleted and everyone invited is notified.`)) return;
    setBusy(`cancel:${c.id}`);
    const { data, error } = await supabase.functions.invoke('sm26-jury-session', { body: { action: 'cancel', session_id: c.id } });
    setBusy(null);
    const err = error || (data as { error?: string })?.error;
    if (err) { toast({ title: 'Could not cancel', description: typeof err === 'string' ? err : undefined, variant: 'destructive' }); return; }
    toast({ title: 'Session cancelled' });
    onChanged();
  };
  const deleteCell = async (c: Cell) => {
    if (!confirm(`Delete the draft "${c.title}"? Nothing has been sent, so nobody is notified.`)) return;
    setBusy(`del:${c.id}`);
    const { error } = await supabase.rpc('sm_yv_session_delete', { p_id: c.id });
    setBusy(null);
    if (error) { toast({ title: 'Could not delete', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Draft deleted' });
    onChanged();
  };
  const reschedule = async (c: Cell) => {
    const v = prompt('New date and time (Monaco time, YYYY-MM-DDTHH:MM)', isoToMonacoLocal(c.scheduled_at));
    if (!v) return;
    const iso = monacoLocalToISO(v.trim());
    if (!iso) { toast({ title: 'Could not read that date', variant: 'destructive' }); return; }
    setBusy(`move:${c.id}`);
    const { error } = await supabase.rpc('sm_yv_session_update', {
      p_id: c.id, p_scheduled_at: iso, p_duration: c.duration_minutes,
      p_slot_label: slotRange(iso, c.duration_minutes), p_title: null,
    });
    setBusy(null);
    if (error) { toast({ title: 'Could not reschedule', description: error.message, variant: 'destructive' }); return; }
    onChanged();
  };

  const canSchedule = panels.length > 0 && batches.length > 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="flex items-center gap-2 text-base">
            <Calendar className="h-4 w-4 text-primary" /> Timetable ({live.length} slot{live.length === 1 ? '' : 's'})
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" className="h-8 gap-1.5" disabled={!canSchedule} onClick={() => { setShowAuto(o => !o); setShowAdd(false); }}>
              <Wand2 className="h-4 w-4" /> Auto-build
            </Button>
            <Button size="sm" variant="outline" className="h-8 gap-1.5" disabled={!canSchedule} onClick={() => { setShowAdd(o => !o); setShowAuto(false); }}>
              <Plus className="h-4 w-4" /> Add a slot
            </Button>
          </div>
        </div>
        <p className="text-xs text-gray-500 mt-1">
          A slot is one panel hearing one batch. Creating it sends nothing: you ask the panel for their availability first,
          and the Zoom invitation only goes out once they have answered. All times are Monaco time.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {!canSchedule && (
          <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            Create at least one jury panel and one startup batch before scheduling.
          </p>
        )}

        {showAdd && (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-2">
            <div className="grid sm:grid-cols-2 gap-2">
              <select value={fPanel} onChange={e => setFPanel(e.target.value)} className="h-9 rounded-md border border-gray-200 px-2 text-sm bg-white">
                <option value="">Jury panel…</option>
                {panels.map(p => <option key={p.id} value={p.id}>{p.code}{p.name ? ` · ${p.name}` : ''} ({p.size} juror{p.size === 1 ? '' : 's'})</option>)}
              </select>
              <select value={fBatch} onChange={e => setFBatch(e.target.value)} className="h-9 rounded-md border border-gray-200 px-2 text-sm bg-white">
                <option value="">Startup batch…</option>
                {batches.map(b => <option key={b.id} value={b.id}>{b.code}{b.name ? ` · ${b.name}` : ''} ({b.size} startup{b.size === 1 ? '' : 's'})</option>)}
              </select>
            </div>
            <div className="flex gap-2">
              <Input type="datetime-local" value={fWhen} onChange={e => setFWhen(e.target.value)} className="h-9 bg-white" />
              <Input type="number" min={10} max={240} value={fDur} onChange={e => setFDur(e.target.value)} className="h-9 w-24 bg-white" title="Minutes" />
            </div>
            <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
              <input type="checkbox" checked={fTest} onChange={e => setFTest(e.target.checked)} className="rounded border-gray-300" />
              <span>Test slot — marked [TEST]; it can only ever email you, never a juror or startup</span>
            </label>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setShowAdd(false)}>Cancel</Button>
              <Button size="sm" onClick={addCell} disabled={busy === 'add'}>{busy === 'add' ? 'Creating…' : 'Create draft slot'}</Button>
            </div>
          </div>
        )}

        {showAuto && (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-2">
            <p className="text-xs text-gray-500">
              Proposes a full rotation from your {panels.length} panel{panels.length === 1 ? '' : 's'} and {batches.length} batch{batches.length === 1 ? '' : 'es'}.
              Every panel meets a different batch each round. Review it below, untick what you don't want, then create — all as drafts.
            </p>
            <div className="grid sm:grid-cols-4 gap-2">
              <label className="text-xs text-gray-500">First slot
                <Input type="datetime-local" value={aStart} onChange={e => setAStart(e.target.value)} className="h-9 bg-white mt-0.5" />
              </label>
              <label className="text-xs text-gray-500">Slot length (min)
                <Input type="number" min={10} max={240} value={aSlot} onChange={e => setASlot(e.target.value)} className="h-9 bg-white mt-0.5" />
              </label>
              <label className="text-xs text-gray-500">Break between (min)
                <Input type="number" min={0} max={120} value={aBreak} onChange={e => setABreak(e.target.value)} className="h-9 bg-white mt-0.5" />
              </label>
              <label className="text-xs text-gray-500">Rounds
                <Input type="number" min={1} max={12} value={aRounds} onChange={e => setARounds(e.target.value)} className="h-9 bg-white mt-0.5" />
              </label>
            </div>
            {proposal.length > 0 && (
              <div className="max-h-64 overflow-y-auto rounded-md border border-gray-200 bg-white divide-y divide-gray-50">
                {proposal.map(p => {
                  const off = aSkip.has(p.key);
                  return (
                    <label key={p.key} className={`flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer ${off ? 'opacity-40' : ''}`}>
                      <input type="checkbox" checked={!off} className="rounded border-gray-300"
                        onChange={() => setASkip(prev => { const n = new Set(prev); if (n.has(p.key)) n.delete(p.key); else n.add(p.key); return n; })} />
                      <span className="w-40 shrink-0 text-gray-500 text-xs">{fmtDay(p.iso)} · {slotRange(p.iso, Number(aSlot) || 60)}</span>
                      <span className="font-medium">{p.panel.code}</span>
                      <span className="text-gray-300">×</span>
                      <span className="font-medium">{p.batch.code}</span>
                      <span className="text-xs text-gray-400">{p.panel.size} jurors · {p.batch.size} startups</span>
                    </label>
                  );
                })}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setShowAuto(false)}>Cancel</Button>
              <Button size="sm" onClick={runAuto} disabled={busy === 'auto' || proposal.length === 0}>
                {busy === 'auto' ? 'Creating…' : `Create ${proposal.length - aSkip.size} draft slot${proposal.length - aSkip.size === 1 ? '' : 's'}`}
              </Button>
            </div>
          </div>
        )}

        {cells.length === 0 && !showAdd && !showAuto && (
          <p className="text-sm text-gray-400">No slots yet. Build your panels and batches, then add a slot or auto-build the whole rotation.</p>
        )}

        {days.map(([day, list]) => (
          <div key={day} className="space-y-2">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide pt-1">{day}</div>
            {list.map(c => {
              const st = cellState(c);
              const meta = STATE_META[st];
              const yes = c.jurors.filter(j => j.rsvp === 'available' || j.rsvp === 'confirmed').length;
              const no = c.jurors.filter(j => j.rsvp === 'unavailable').length;
              const silent = c.jurors.filter(j => j.rsvp === 'invited');
              // Never written to at all — chasing them is really a first ask.
              const neverAsked = silent.filter(j => !j.invited_at).length;
              const startupsSilent = c.entries.filter(e => e.rsvp === 'invited');
              const startupsIn = c.entries.filter(e => e.rsvp === 'confirmed').length;
              const startupsOut = c.entries.filter(e => e.rsvp === 'declined').length;
              const cancelled = st === 'cancelled';
              return (
                <div key={c.id} className={`rounded-lg border px-3 py-2.5 ${cancelled ? 'border-gray-100 opacity-50' : 'border-gray-200'}`}>
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div className="min-w-0">
                      <div className="text-sm font-medium flex items-center gap-2 flex-wrap">
                        <span>{c.slot_label || slotRange(c.scheduled_at, c.duration_minutes)}</span>
                        <span className="text-gray-300">·</span>
                        <span>{c.jury_group_code || '—'} <span className="text-gray-300">×</span> {c.startup_group_code || '—'}</span>
                        {c.is_test && <Pill label="TEST" cls="bg-purple-50 text-purple-700 border-purple-200" />}
                        <Pill label={meta.label} cls={meta.cls} />
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-x-2 gap-y-0.5 flex-wrap">
                        <span>{c.duration_minutes} min</span>
                        <span>· {c.entries.length} startup{c.entries.length === 1 ? '' : 's'}</span>
                        <span>· {c.jurors.length} juror{c.jurors.length === 1 ? '' : 's'}</span>
                        {!cancelled && st !== 'draft' && <span>· <span className={yes >= c.jurors.length && c.jurors.length > 0 ? 'text-green-700' : 'text-amber-700'}>{yes}/{c.jurors.length} available</span>{no > 0 ? ` · ${no} declined` : ''}{silent.length ? ` · ${silent.length} silent` : ''}</span>}
                        {!cancelled && neverAsked > 0 && st !== 'draft' && <span>· <span className="text-gray-500">{neverAsked} never asked</span></span>}
                        {!cancelled && c.last_startup_email_at && (
                          <span>· <span className={startupsIn >= c.entries.length && c.entries.length > 0 ? 'text-green-700' : 'text-amber-700'}>{startupsIn}/{c.entries.length} startups coming</span>{startupsOut > 0 ? ` · ${startupsOut} out` : ''}</span>
                        )}
                        {c.assigned > 0 && <span>· {c.submitted}/{c.assigned} scored</span>}
                        {c.zoom_sent && c.zoom_join_url && !cancelled && (
                          <a href={c.zoom_join_url} target="_blank" rel="noreferrer" className="text-primary inline-flex items-center gap-0.5"><Video className="h-3 w-3" /> Zoom</a>
                        )}
                      </div>
                    </div>
                    {!cancelled && (
                      <div className="flex items-center gap-1 shrink-0">
                        {st === 'draft' && !c.zoom_sent && (
                          <>
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-gray-400 hover:text-gray-700" title="Reschedule" onClick={() => reschedule(c)} disabled={!!busy}><Clock className="h-4 w-4" /></Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-gray-400 hover:text-red-600" title="Delete draft" onClick={() => deleteCell(c)} disabled={!!busy}><Trash2 className="h-4 w-4" /></Button>
                          </>
                        )}
                        {st !== 'draft' && (
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-gray-400 hover:text-red-600" title="Cancel session" onClick={() => cancelCell(c)} disabled={!!busy}><X className="h-4 w-4" /></Button>
                        )}
                      </div>
                    )}
                  </div>

                  {c.entries.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {c.entries.map(e => {
                        const m = entryMeta(e.rsvp);
                        // Before anyone has been asked there is no answer to
                        // report, so the chip stays the plain company name it
                        // has always been.
                        if (!c.last_startup_email_at && e.rsvp === 'invited') {
                          return <span key={e.role_assignment_id} className="text-[11px] bg-gray-100 text-gray-600 rounded-full px-2 py-0.5">{e.company}</span>;
                        }
                        return (
                          <span key={e.role_assignment_id}
                                className={`inline-flex items-center gap-1 text-[11px] rounded-full border px-2 py-0.5 ${m.cls}`}
                                title={e.invited_at ? `Asked ${new Date(e.invited_at).toLocaleString('en-GB', { timeZone: TZ })}` : 'Never emailed about this slot'}>
                            {e.rsvp === 'declined' ? <AlertTriangle className="h-3 w-3" /> : e.rsvp === 'invited' ? <Clock className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
                            {e.company} <span className="opacity-60">· {m.label}{e.rsvp === 'invited' ? ` ${silenceLabel(e.invited_at)}` : ''}</span>
                          </span>
                        );
                      })}
                    </div>
                  )}
                  {c.jurors.length > 0 && !cancelled && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {c.jurors.map(j => {
                        const m = rsvpMeta(j.rsvp);
                        return (
                          <span key={j.user_id} className={`inline-flex items-center gap-1 text-[11px] rounded-full border px-2 py-0.5 ${m.cls}`}
                                title={j.invited_at ? `Asked ${new Date(j.invited_at).toLocaleString('en-GB', { timeZone: TZ })}` : 'Never emailed about this slot'}>
                            {j.rsvp === 'unavailable' ? <AlertTriangle className="h-3 w-3" /> : j.rsvp === 'invited' ? <Clock className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
                            {j.name} <span className="opacity-60">· {m.label}{j.rsvp === 'invited' ? ` ${silenceLabel(j.invited_at)}` : ''}</span>
                          </span>
                        );
                      })}
                    </div>
                  )}

                  {!cancelled && (
                    <div className="flex flex-wrap items-center gap-1 mt-1.5">
                      {(c.guests || []).map(g => (
                        <span key={g.email} className="inline-flex items-center gap-1 text-[11px] rounded-full border border-blue-200 bg-blue-50 text-blue-800 px-2 py-0.5"
                              title={`${g.email} — on the Zoom invitation only: no availability request, no scorecard`}>
                          <Video className="h-3 w-3" />
                          {g.name || g.email} <span className="opacity-60">· guest</span>
                          <button className="ml-0.5 opacity-50 hover:opacity-100" disabled={!!busy}
                                  onClick={() => removeGuest(c, g.email)} title="Remove from the invitation">
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      ))}
                      <button className="text-[11px] text-gray-400 hover:text-primary hover:underline px-1" disabled={!!busy} onClick={() => addGuest(c)}>
                        + add someone to the Zoom
                      </button>
                    </div>
                  )}

                  {!cancelled && (
                    <div className="flex flex-wrap items-center gap-1.5 mt-2.5 pt-2.5 border-t border-gray-100">
                      {/* A test slot refuses to email anyone but you, so the real
                          send buttons would only ever return an error — offer the
                          previews instead. */}
                      {/* The availability email names the startups the panel will
                          hear, so an empty batch has nothing to ask about and the
                          server refuses it. Saying so here beats a red error
                          after the click — and it is why some panels show
                          jurors who have never been asked. */}
                      {!c.is_test && !c.zoom_sent && c.entries.length === 0 ? (
                        <span className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                          No startups in this batch yet — the panel cannot be asked until at least one is added.
                        </span>
                      ) : c.is_test ? (
                        <span className="text-[11px] text-purple-700 bg-purple-50 border border-purple-200 rounded px-2 py-1">
                          Test slot — it can only ever email you. Use the previews to see each email.
                        </span>
                      ) : (
                        <>
                          {/* Once the first request has gone out, chasing the
                              silent ones is the everyday action, so it leads.
                              Writing to the whole panel again stays available
                              but steps back to a quiet link. */}
                          {!c.zoom_sent && !c.last_availability_email_at && (
                            <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" disabled={!!busy} onClick={() => sendAvailability(c)}>
                              <Send className="h-3.5 w-3.5" /> Send availability request ({c.jurors.length})
                            </Button>
                          )}
                          {!c.zoom_sent && c.last_availability_email_at && (
                            <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" disabled={!!busy || !silent.length} onClick={() => chaseSilent(c)}>
                              <Send className="h-3.5 w-3.5" />
                              {silent.length
                                ? `Chase the ${silent.length} who haven't answered`
                                : 'Everyone has answered'}
                            </Button>
                          )}
                          {/* Asked in parallel with the panel, never gating it:
                              waiting for 30 startups before 12 sessions can go
                              out would deadlock the whole schedule. */}
                          {!c.zoom_sent && c.entries.length > 0 && !c.last_startup_email_at && (
                            <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" disabled={!!busy} onClick={() => sendStartupSlot(c)}>
                              <Mail className="h-3.5 w-3.5" /> Tell the {c.entries.length} startup{c.entries.length === 1 ? '' : 's'} their slot
                            </Button>
                          )}
                          {!c.zoom_sent && c.entries.length > 0 && c.last_startup_email_at && (
                            <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" disabled={!!busy || !startupsSilent.length} onClick={() => chaseStartups(c)}>
                              <Mail className="h-3.5 w-3.5" />
                              {startupsSilent.length
                                ? `Chase ${startupsSilent.length} startup${startupsSilent.length === 1 ? '' : 's'}`
                                : 'All startups answered'}
                            </Button>
                          )}
                          {!c.zoom_sent && (
                            <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" disabled={!!busy} onClick={() => sendZoom(c)}>
                              <Video className="h-3.5 w-3.5" /> Send Zoom invite{yes === 0 ? ' (nobody confirmed yet)' : ` (${yes})`}
                            </Button>
                          )}
                          {c.zoom_sent && (
                            <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" disabled={!!busy} onClick={() => sendEvaluate(c)}>
                              <Mail className="h-3.5 w-3.5" /> Email jurors to score
                            </Button>
                          )}
                        </>
                      )}
                      {!c.zoom_sent && c.last_availability_email_at && !c.is_test && (
                        <button
                          className="text-[11px] text-gray-400 hover:text-gray-700 hover:underline"
                          disabled={!!busy}
                          onClick={() => sendAvailability(c)}
                          title="Writes to every juror on the panel, including those who have already replied. Use this when the slot itself has changed."
                        >
                          ask all {c.jurors.length} again
                        </button>
                      )}
                      {testEmail && (
                        <div className="flex items-center gap-1 ml-auto">
                          <span className="text-[11px] text-gray-400 inline-flex items-center gap-1"><FlaskConical className="h-3 w-3" /> preview to me:</span>
                          <button className="text-[11px] text-primary hover:underline" disabled={!!busy} onClick={() => sendAvailability(c, true)}>availability</button>
                          {c.entries.length > 0 && <><span className="text-gray-300">·</span>
                            <button className="text-[11px] text-primary hover:underline" disabled={!!busy} onClick={() => sendStartupSlot(c, true)}>startup slot</button></>}
                          {!c.zoom_sent && <><span className="text-gray-300">·</span>
                            <button className="text-[11px] text-primary hover:underline" disabled={!!busy} onClick={() => sendZoom(c, true)}>zoom invite</button></>}
                          {c.zoom_sent && <><span className="text-gray-300">·</span>
                            <button className="text-[11px] text-primary hover:underline" disabled={!!busy} onClick={() => sendEvaluate(c, true)}>scoring</button></>}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
