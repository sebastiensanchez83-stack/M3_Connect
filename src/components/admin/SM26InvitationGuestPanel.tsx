import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Check, Loader2, Plus, Trash2, UserPlus, Mail, KeyRound, ExternalLink,
  ShieldCheck, AlertTriangle, Users, Printer, DoorOpen,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { Pill } from '@/components/sm26/SM26ConsoleUI';
import { SM26_ROLE_LABELS } from './AdminSM26';
import {
  SM26_RSVP_STATES as RSVP_STATES,
  type SM26Invitation as Invitation,
  type SM26InvitationBoardRow as BoardRow,
  type SM26InvitationGuest as InvitationGuest,
} from './types';

// Everything that happens to an invitation AFTER the envelope: the reply, the
// delegation that comes with the guest, and the moment they stop being a name on
// a letter and become somebody the door will let in.
//
// The three sections are deliberately in that order, because that is the order
// in which the facts arrive.

/** The door speaks in reason codes; the welcome desk does not. */
const DOOR_LABEL: Record<string, string> = {
  registration_cancelled: 'registration withdrawn',
  registration_declined: 'registration refused',
  registration_under_review: 'registration not confirmed',
  registration_submitted: 'registration not confirmed',
  payment_missing: 'no payment recorded — waive the fee',
  payment_invoiced: 'invoice not settled',
  payment_unpaid: 'payment outstanding',
  not_attending: 'marked as not attending',
  jury_not_onsite: 'juror has not confirmed attending on site',
  not_found: 'no attendee behind this registration',
};

// A juror is judged by a rule this path cannot satisfy (they have to confirm
// attending on site in the jury console), so the server refuses the role here
// and the picker does not offer it.
const OFFERED_ROLES = Object.entries(SM26_ROLE_LABELS).filter(([k]) => k !== 'jury');

interface Attendee {
  id: string;
  first_name: string | null; last_name: string | null; email: string | null;
  is_primary: boolean; user_id: string | null;
  badge?: { exported_at: string | null }[] | { exported_at: string | null } | null;
}
const exportedAt = (a: Attendee) =>
  (Array.isArray(a.badge) ? a.badge[0]?.exported_at : a.badge?.exported_at) || null;
const hasBadge = (a: Attendee) => (Array.isArray(a.badge) ? a.badge.length > 0 : !!a.badge);

/**
 * The letter names a country in the grammar of its own sentence — "l'Égypte",
 * "les Émirats arabes unis" — because a paragraph reads "…the delegation of
 * l'Égypte". A participant record wants the country, not the phrase.
 */
const plainCountry = (c: string) =>
  (c || '').trim().replace(/^(l['’]|le |la |les |the )/i, '').trim();

/** "Dr. Tarek Dahroug" → first "Dr. Tarek", last "Dahroug". A guess the staff corrects. */
const splitName = (full: string): [string, string] => {
  const parts = (full || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return ['', ''];
  if (parts.length === 1) return ['', parts[0]];
  return [parts.slice(0, -1).join(' '), parts[parts.length - 1]];
};

export function SM26InvitationGuestPanel({ invitation, board, staffName, onChanged }: {
  invitation: Invitation;
  board: BoardRow | undefined;
  staffName: (id: string | null) => string | null;
  onChanged: () => void | Promise<void>;
}) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const [guests, setGuests] = useState<InvitationGuest[]>([]);
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  /** False once linked to a registration the company made itself. */
  const [oursToEdit, setOursToEdit] = useState(true);
  const [rsvp, setRsvp] = useState(invitation.rsvp_status);
  const [note, setNote] = useState(invitation.rsvp_note || '');
  const [newGuest, setNewGuest] = useState({ first: '', last: '', job: '', email: '' });

  const [guessFirst, guessLast] = splitName(invitation.recipient_name || '');
  const [form, setForm] = useState({
    first: guessFirst, last: guessLast,
    email: invitation.recipient_email || '',
    company: invitation.recipient_org || '',
    country: plainCountry(invitation.country || ''),
    job: invitation.recipient_role || '',
    roles: ['vip'] as string[],
    waive: true,
    scannable: !invitation.discreet,
  });

  const converted = !!invitation.registration_id;

  const load = useCallback(async () => {
    const { data: g } = await supabase.from('sm_invitation_guest')
      .select('*').eq('invitation_id', invitation.id).order('created_at');
    setGuests((g || []) as InvitationGuest[]);
    if (invitation.registration_id) {
      const [{ data: a }, { data: reg }] = await Promise.all([
        supabase.from('sm_attendee')
          .select('id, first_name, last_name, email, is_primary, user_id, badge:sm_badge(exported_at)')
          .eq('registration_id', invitation.registration_id)
          .order('is_primary', { ascending: false }),
        // `source` decides what this panel may offer: on a registration the
        // company made itself, the roster is their declared headcount and what
        // they are invoiced for, and the server refuses to add people to it.
        supabase.from('sm_registration').select('source')
          .eq('id', invitation.registration_id).maybeSingle(),
      ]);
      setAttendees((a || []) as Attendee[]);
      setOursToEdit((reg as { source?: string } | null)?.source === 'invitation');
    } else {
      setAttendees([]);
      setOursToEdit(true);
    }
  }, [invitation.id, invitation.registration_id]);
  useEffect(() => { load(); }, [load]);

  // Reopening the panel on another row must not carry the previous row's answer.
  useEffect(() => {
    setRsvp(invitation.rsvp_status);
    setNote(invitation.rsvp_note || '');
  }, [invitation.id, invitation.rsvp_status, invitation.rsvp_note]);

  // ---- the reply ----------------------------------------------------------
  const saveRsvp = async () => {
    setBusy('rsvp');
    try {
    // getUser() can reject rather than return an error (Navigator LockManager
    // timeout is not an AuthError), so everything after it lives in a try.
    const { data: u } = await supabase.auth.getUser();
    const changed = rsvp !== invitation.rsvp_status;
    const { error } = await supabase.from('sm_invitation').update({
      rsvp_status: rsvp,
      rsvp_note: note.trim() || null,
      // The timestamp and the name answer "who told us, and when" — they only
      // move when the answer itself moves, so editing a typo in the note does
      // not rewrite who recorded it.
      rsvp_at: changed ? new Date().toISOString() : invitation.rsvp_at,
      rsvp_by: changed ? (u?.user?.id || null) : invitation.rsvp_by,
    }).eq('id', invitation.id);
    if (error) { toast({ title: 'Could not save the reply', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Reply recorded' });
    await onChanged();
    } catch (e) {
      toast({ title: 'Could not save the reply', description: String((e as Error).message || e), variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  // ---- the delegation -----------------------------------------------------
  const addGuest = async () => {
    if (!newGuest.first.trim() && !newGuest.last.trim()) return;
    setBusy('guest');
    const { error } = await supabase.from('sm_invitation_guest').insert({
      invitation_id: invitation.id,
      first_name: newGuest.first.trim() || null,
      last_name: newGuest.last.trim() || null,
      job_title: newGuest.job.trim() || null,
      email: newGuest.email.trim().toLowerCase() || null,
    });
    setBusy(null);
    if (error) { toast({ title: 'Could not add', description: error.message, variant: 'destructive' }); return; }
    setNewGuest({ first: '', last: '', job: '', email: '' });
    await load();
    await onChanged();
  };

  const removeGuest = async (g: InvitationGuest) => {
    const who = [g.first_name, g.last_name].filter(Boolean).join(' ') || 'this guest';
    if (!confirm(`Remove ${who}${g.attendee_id ? ' and their badge' : ''}?`)) return;
    setBusy(`g:${g.id}`);
    const { error } = await supabase.rpc('sm_invitation_remove_guest', { p_guest_id: g.id });
    setBusy(null);
    if (error) { toast({ title: 'Could not remove', description: error.message, variant: 'destructive' }); return; }
    await load();
    await onChanged();
  };

  const syncGuests = async () => {
    setBusy('sync');
    const { data, error } = await supabase.rpc('sm_invitation_sync_guests', { p_invitation_id: invitation.id });
    setBusy(null);
    if (error) { toast({ title: 'Could not issue the badges', description: error.message, variant: 'destructive' }); return; }
    const r = data as { minted?: number; reissued?: number; skipped_not_ours?: boolean };
    // The server refuses to add anybody to a registration this feature did not
    // create — that roster is the company's declared headcount and what they are
    // invoiced for. Reporting "everyone already has a badge" over that refusal
    // leaves staff clicking a button that will never do anything.
    if (r?.skipped_not_ours) {
      toast({
        title: 'Not added — this is the company’s own registration',
        description: 'Their roster is what they are invoiced for, so M3 cannot add people to it from here. Add them from the registration itself if they really are part of that booking.',
        variant: 'destructive',
      });
    } else {
      const n = (r?.minted ?? 0) + (r?.reissued ?? 0);
      toast({ title: n ? `${n} badge${n > 1 ? 's' : ''} issued` : 'Everyone already has a badge' });
    }
    await load();
    await onChanged();
  };

  // ---- becoming a participant --------------------------------------------
  const createParticipant = async () => {
    setBusy('convert');
    const { data, error } = await supabase.rpc('sm_invitation_to_participant', {
      p_invitation_id: invitation.id,
      p_first_name: form.first.trim() || null,
      p_last_name: form.last.trim() || null,
      // Sent as an empty string rather than null when the field was cleared:
      // null means "not specified" to the RPC, which then falls back to the
      // invitation's own address — so emptying the box would not have removed it.
      p_email: form.email.trim(),
      p_company: form.company.trim() || null,
      p_country: form.country.trim() || null,
      p_job_title: form.job.trim() || null,
      p_roles: form.roles,
      p_discreet: !form.scannable,
      p_waive_fee: form.waive,
    });
    setBusy(null);
    if (error) { toast({ title: 'Could not create the participant', description: error.message, variant: 'destructive' }); return; }
    const res = data as { linked_existing?: boolean; guests_minted?: number; door_ok?: string; door_blocker?: string; notes?: string[] };
    toast({
      title: res?.linked_existing ? 'Linked to their existing registration' : 'Participant created',
      description: [
        res?.guests_minted ? `${res.guests_minted} guest badge${res.guests_minted > 1 ? 's' : ''} issued.` : '',
        res?.door_ok === 'true' ? 'The door will let them in.' : `The door still refuses: ${DOOR_LABEL[res?.door_blocker || ''] || res?.door_blocker}.`,
        ...(res?.notes || []),
      ].filter(Boolean).join(' '),
    });
    await load();
    await onChanged();
  };

  const emailBadge = async () => {
    setBusy('badge');
    const { data, error } = await supabase.functions.invoke('sm26-badge-email', {
      body: { registration_id: invitation.registration_id, resend: true },
    });
    setBusy(null);
    if (error) { toast({ title: 'Could not send the badge', description: error.message, variant: 'destructive' }); return; }
    const r = data as { sent?: number; failed?: number; qr_failed?: number; skipped?: Record<string, number> };
    const sent = r?.sent || 0;
    const broke = (r?.failed || 0) + (r?.qr_failed || 0);
    if (sent) {
      toast({
        title: `Badge emailed to ${sent} ${sent > 1 ? 'people' : 'person'}`,
        description: broke ? `${broke} could not be sent — check the address.` : '',
      });
      return;
    }
    // Distinguish "there was nobody to email" from "the mail server refused".
    // Blaming a missing address for a Resend outage sends staff hunting for a
    // problem that is not there.
    toast({
      title: 'Nobody was emailed',
      description: broke
        ? `${broke} attempt${broke > 1 ? 's' : ''} failed on the way out — the address may be wrong, or email is down.`
        : 'They have no email address on file, or no badge yet.',
      variant: broke ? 'destructive' : undefined,
    });
  };

  const givePlatformAccess = async (a: Attendee) => {
    setBusy(`acct:${a.id}`);
    const { data, error } = await supabase.functions.invoke('sm26-attendee-invite', { body: { attendee_id: a.id } });
    setBusy(null);
    if (error) { toast({ title: 'Could not open the account', description: error.message, variant: 'destructive' }); return; }
    const r = data as { created_account?: boolean; emailed?: boolean };
    toast({
      title: r?.created_account ? 'Account created' : 'Linked to their existing account',
      // The edge function reports whether the welcome mail actually left. Saying
      // it did when it did not is how somebody waits for a link that never came.
      description: r?.emailed
        ? 'They have been emailed a link to set a password and open their event hub.'
        : 'The welcome email did NOT go out — send it again from their registration once you know why.',
      variant: r?.emailed ? undefined : 'destructive',
    });
    await load();
    await onChanged();
  };

  const rsvpMeta = RSVP_STATES.find(s => s.key === invitation.rsvp_status);
  const pending = guests.filter(g => !g.attendee_id).length;
  const notPrinted = attendees.filter(a => hasBadge(a) && !exportedAt(a)).length;

  return (
    <div className="space-y-5">
      {/* ─── the reply ─────────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between gap-2 flex-wrap mb-1.5">
          <Label className="text-xs text-gray-500">Did they answer?</Label>
          {invitation.rsvp_at && (
            <span className="text-[11px] text-gray-400">
              {rsvpMeta?.label} recorded by {staffName(invitation.rsvp_by) || 'staff'} on {invitation.rsvp_at.slice(0, 10)}
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {RSVP_STATES.map(s => (
            <button key={s.key} type="button" onClick={() => setRsvp(s.key)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                rsvp === s.key ? 'bg-primary text-white border-primary' : 'border-gray-200 text-gray-600 hover:border-primary/40'}`}>
              {s.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 mt-2">
          <Input className="h-9" value={note} onChange={e => setNote(e.target.value)}
            placeholder="How we know — “confirmed by email of 3 Sep”, “called back, sending their deputy”" />
          <Button size="sm" className="gap-1.5 shrink-0" disabled={busy === 'rsvp'} onClick={saveRsvp}>
            {busy === 'rsvp' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save
          </Button>
        </div>
        {/* Changing the answer after the fact does not un-invite anyone: the
            participant, the badge and the place on the door list are separate
            records, and only the registrations console can withdraw them. Saying
            so beats a guest who cancelled still being admitted. */}
        {converted && invitation.rsvp_status !== 'accepted' && (
          <div className="flex items-start gap-1.5 mt-2 text-[11px] text-amber-700">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
            They are still on the participant list and the door still lets them in. Cancel the registration
            itself if they are no longer coming.
          </div>
        )}
      </div>

      {/* ─── the delegation ────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between gap-2 flex-wrap mb-1.5">
          <Label className="text-xs text-gray-500 flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5" /> Who comes with them
          </Label>
          {converted && pending > 0 && oursToEdit && (
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" disabled={busy === 'sync'} onClick={syncGuests}>
              {busy === 'sync' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              Issue {pending} missing badge{pending > 1 ? 's' : ''}
            </Button>
          )}
        </div>
        <p className="text-[11px] text-gray-400 mb-2">
          {converted && !oursToEdit
            ? 'This invitation is linked to a registration the company made itself. Its roster is their declared headcount and what they are invoiced for, so names added here get no badge — add them from the registration instead.'
            : 'Each name gets its own badge, so the printer can put a label on it. A delegation that names its people later is fine — add them here and the badges follow.'}
        </p>

        {guests.length > 0 && (
          <div className="space-y-1 mb-2">
            {guests.map(g => (
              <div key={g.id} className="flex items-center gap-2 text-sm rounded-lg border border-gray-100 px-3 py-1.5">
                <span className="font-medium">{[g.first_name, g.last_name].filter(Boolean).join(' ') || '—'}</span>
                <span className="text-xs text-gray-400 truncate">{[g.job_title, g.email].filter(Boolean).join(' · ')}</span>
                <span className="ml-auto flex items-center gap-2">
                  {g.attendee_id
                    ? <Pill label="badge issued" cls="bg-green-50 text-green-700 border-green-200" />
                    : <Pill label={converted ? 'no badge yet' : 'badge on creation'} cls="bg-amber-50 text-amber-700 border-amber-200" />}
                  <Button size="icon" variant="ghost" className="h-6 w-6 text-gray-300 hover:text-red-600"
                    disabled={busy === `g:${g.id}`} onClick={() => removeGuest(g)}><Trash2 className="h-3.5 w-3.5" /></Button>
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
          <Input className="h-8 text-xs" placeholder="First name" value={newGuest.first} onChange={e => setNewGuest({ ...newGuest, first: e.target.value })} />
          <Input className="h-8 text-xs" placeholder="Last name" value={newGuest.last} onChange={e => setNewGuest({ ...newGuest, last: e.target.value })} />
          <Input className="h-8 text-xs" placeholder="Title" value={newGuest.job} onChange={e => setNewGuest({ ...newGuest, job: e.target.value })} />
          <Input className="h-8 text-xs" placeholder="Email (optional)" value={newGuest.email} onChange={e => setNewGuest({ ...newGuest, email: e.target.value })} />
          <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5"
            disabled={busy === 'guest' || (!newGuest.first.trim() && !newGuest.last.trim())} onClick={addGuest}>
            {busy === 'guest' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Add
          </Button>
        </div>
      </div>

      {/* ─── the participant ───────────────────────────────────────────── */}
      {!converted ? (
        invitation.rsvp_status !== 'accepted' ? (
          // Ticking "Accepted" is not recording it. The server refuses to convert
          // an invitation whose saved answer is anything else, so the hint has to
          // point at the Save button rather than at the chips the user just clicked.
          <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500">
            {rsvp === 'accepted'
              ? 'Save the acceptance above, and this becomes a participant: registration, badge and a place on the check-in list, in one click.'
              : 'Record the acceptance above and this becomes a participant: registration, badge and a place on the check-in list, in one click.'}
          </div>
        ) : (
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-3">
            <div className="text-sm font-semibold text-gray-800 flex items-center gap-1.5">
              <UserPlus className="h-4 w-4 text-primary" /> Turn them into a participant
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div>
                <Label className="text-[11px] text-gray-500">First name</Label>
                <Input className="h-8 mt-0.5 text-sm" value={form.first} onChange={e => setForm({ ...form, first: e.target.value })} />
              </div>
              <div>
                <Label className="text-[11px] text-gray-500">Last name</Label>
                <Input className="h-8 mt-0.5 text-sm" value={form.last} onChange={e => setForm({ ...form, last: e.target.value })} />
              </div>
              <div>
                <Label className="text-[11px] text-gray-500">Job title</Label>
                <Input className="h-8 mt-0.5 text-sm" value={form.job} onChange={e => setForm({ ...form, job: e.target.value })} />
              </div>
              <div>
                <Label className="text-[11px] text-gray-500">Email — leave empty if there is none</Label>
                <Input className="h-8 mt-0.5 text-sm" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
              </div>
              <div>
                <Label className="text-[11px] text-gray-500">Organisation</Label>
                <Input className="h-8 mt-0.5 text-sm" value={form.company} onChange={e => setForm({ ...form, company: e.target.value })} />
              </div>
              <div>
                <Label className="text-[11px] text-gray-500">Country</Label>
                <Input className="h-8 mt-0.5 text-sm" value={form.country} onChange={e => setForm({ ...form, country: e.target.value })} />
              </div>
            </div>

            <p className="text-[11px] text-gray-500 -mt-1">
              The badge label is printed from the first and last name, so split “{invitation.recipient_name || 'the recipient'}”
              the way it should read on the badge.
            </p>

            <div>
              <div className="text-[11px] text-gray-500 mb-1">What they are at the event</div>
              <div className="flex flex-wrap gap-1.5">
                {OFFERED_ROLES.map(([k, v]) => {
                  const on = form.roles.includes(k);
                  return (
                    <button key={k} type="button"
                      onClick={() => setForm({ ...form, roles: on ? form.roles.filter(r => r !== k) : [...form.roles, k] })}
                      className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                        on ? 'bg-primary text-white border-primary' : 'border-gray-200 text-gray-600 hover:border-primary/40'}`}>
                      {v}
                    </button>
                  );
                })}
              </div>
            </div>

            <label className="flex items-start gap-2 text-sm text-gray-700">
              <Checkbox className="mt-0.5" checked={form.waive} onCheckedChange={c => setForm({ ...form, waive: !!c })} />
              <span>
                Guest of M3 — no fee
                {!form.waive && (
                  <span className="block text-[11px] text-amber-700">
                    Unticked, the door refuses them until an invoice is settled. Only untick this if they really are paying.
                  </span>
                )}
              </span>
            </label>

            <label className="flex items-start gap-2 text-sm text-gray-700">
              <Checkbox className="mt-0.5" checked={form.scannable} onCheckedChange={c => setForm({ ...form, scannable: !!c })} />
              <span>
                Let other participants scan their badge to swap contacts
                <span className="block text-[11px] text-gray-500">
                  Off by default for an invited guest: the badge opens the door and nothing more, so nobody
                  collects a minister’s details by scanning them in a corridor.
                </span>
              </span>
            </label>

            <Button size="sm" className="gap-1.5" disabled={busy === 'convert' || (!form.first.trim() && !form.last.trim()) || !form.roles.length}
              onClick={createParticipant}>
              {busy === 'convert' ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />} Create the participant
            </Button>
          </div>
        )
      ) : (
        <div className="rounded-lg border border-green-200 bg-green-50/50 p-3 space-y-2.5">
          <div className="flex items-center gap-2 flex-wrap text-sm">
            <ShieldCheck className="h-4 w-4 text-green-600" />
            <span className="font-semibold text-gray-800">On the participant list</span>
            {board?.door_ok
              ? <Pill label="the door lets them in" cls="bg-green-50 text-green-700 border-green-200" />
              : <Pill label={`the door refuses: ${DOOR_LABEL[board?.door_blocker || ''] || board?.door_blocker || 'unknown'}`}
                      cls="bg-red-50 text-red-700 border-red-200" />}
            {invitation.discreet && <Pill label="access badge only" cls="bg-gray-50 text-gray-600 border-gray-200" />}
          </div>

          <div className="space-y-1">
            {attendees.map(a => (
              <div key={a.id} className="flex items-center gap-2 text-sm rounded border border-green-100 bg-white px-2.5 py-1.5">
                <span className="font-medium">{[a.first_name, a.last_name].filter(Boolean).join(' ') || a.email || '—'}</span>
                {a.is_primary && <Pill label="guest of honour" cls="bg-blue-50 text-blue-700 border-blue-200" />}
                <span className="ml-auto flex items-center gap-1.5">
                  {exportedAt(a)
                    ? <Pill label={`label printed ${exportedAt(a)!.slice(0, 10)}`} cls="bg-gray-50 text-gray-500 border-gray-200" />
                    : <Pill label="not in a print run yet" cls="bg-amber-50 text-amber-700 border-amber-200" />}
                  {a.email && !a.user_id && (
                    <Button size="sm" variant="ghost" className="h-6 text-[11px] gap-1 text-gray-500 hover:text-primary"
                      disabled={busy === `acct:${a.id}`} onClick={() => givePlatformAccess(a)}>
                      {busy === `acct:${a.id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <KeyRound className="h-3 w-3" />}
                      Give platform access
                    </Button>
                  )}
                  {a.user_id && <Pill label="has an account" cls="bg-violet-50 text-violet-700 border-violet-200" />}
                </span>
              </div>
            ))}
          </div>

          {notPrinted > 0 && (
            <div className="flex items-center gap-1.5 text-[11px] text-amber-700">
              <Printer className="h-3.5 w-3.5" />
              {notPrinted} badge{notPrinted > 1 ? 's have' : ' has'} not gone to the printer yet — they come out in the next
              delta export from the check-in console.
            </div>
          )}
          {board && board.checked_in_count > 0 && (
            <div className="flex items-center gap-1.5 text-[11px] text-green-700">
              <DoorOpen className="h-3.5 w-3.5" /> {board.checked_in_count} of them have walked in.
            </div>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5"
              onClick={() => navigate(`/admin/sm26/${invitation.registration_id}`)}>
              <ExternalLink className="h-3.5 w-3.5" /> Open the registration
            </Button>
            {attendees.some(a => a.email) && (
              <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" disabled={busy === 'badge'} onClick={emailBadge}>
                {busy === 'badge' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />} Email the entry QR
              </Button>
            )}
            {!attendees.some(a => a.email) && (
              <span className="text-[11px] text-gray-400 flex items-center gap-1">
                <AlertTriangle className="h-3.5 w-3.5" /> No email on file — hand them the badge at the desk.
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
