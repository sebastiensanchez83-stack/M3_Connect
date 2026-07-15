import { useState, useEffect, useRef } from 'react';
import { Loader2, UserPlus, Trash2, Check, Users, Star, Mail, BadgeCheck, CheckCircle2, Send, Lock, QrCode } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { requireFreshSession } from '@/lib/session';
import { useSm26RosterLock } from './useSm26EditLock';

// Named-attendee roster for one SM26 registration. The person who filled the
// form is the *registration contact*; who actually attends may differ, so the
// company confirms the real list here. Each attending person gets a badge +
// individual check-in. Invoicing stays per-company — this just gives an
// accurate headcount and the names to print badges from.
//
// Used self-service in the participant hub (canEdit = owner/org-member, respects
// the admin-set roster deadline) and in the admin registration sheet
// (canEdit = staff, no deadline lock, plus invite + confirmation-request nudge).

interface Attendee {
  id: string;
  registration_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  job_title: string | null;
  user_id: string | null;
  is_primary: boolean;
  attending: boolean;
  dietary: string | null;
  accessibility: string | null;
}

const blankDraft = { first_name: '', last_name: '', email: '', job_title: '' };
const prettyDateTime = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

export function SM26AttendeeRoster({ registrationId, eventId, canEdit, variant = 'hub', registrantUserId }: {
  registrationId: string; eventId: string; canEdit: boolean; variant?: 'hub' | 'admin'; registrantUserId?: string | null;
}) {
  const [rows, setRows] = useState<Attendee[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [inviting, setInviting] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState(blankDraft);
  const [confirmedAt, setConfirmedAt] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [nudging, setNudging] = useState(false);
  const [sendingQr, setSendingQr] = useState(false);
  const orig = useRef<Record<string, Attendee>>({});
  const { locked: rosterLocked, prettyDate: deadlinePretty } = useSm26RosterLock();

  // Staff (admin sheet) can always edit; participants are gated by the deadline.
  const editable = canEdit && (variant === 'admin' || !rosterLocked);

  const load = async () => {
    const [{ data }, { data: reg }] = await Promise.all([
      supabase.from('sm_attendee').select('*')
        .eq('registration_id', registrationId)
        .order('is_primary', { ascending: false })
        .order('created_at', { ascending: true }),
      supabase.from('sm_registration').select('attendees_confirmed_at').eq('id', registrationId).maybeSingle(),
    ]);
    const list = (data || []) as Attendee[];
    orig.current = Object.fromEntries(list.map(r => [r.id, { ...r }]));
    setRows(list);
    setConfirmedAt((reg as { attendees_confirmed_at?: string | null } | null)?.attendees_confirmed_at || null);
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [registrationId]);

  const patch = (id: string, changes: Partial<Attendee>) =>
    setRows(prev => prev.map(r => r.id === id ? { ...r, ...changes } : r));

  const isDirty = (r: Attendee) => {
    const o = orig.current[r.id];
    return !!o && (['first_name', 'last_name', 'email', 'job_title', 'dietary', 'accessibility'] as const).some(k => (r[k] || '') !== (o[k] || ''));
  };

  const saveRow = async (r: Attendee) => {
    const uid = await requireFreshSession();
    if (!uid) return;
    setBusy(r.id);
    const { error } = await supabase.from('sm_attendee').update({
      first_name: r.first_name?.trim() || null,
      last_name: r.last_name?.trim() || null,
      email: r.email?.trim() || null,
      job_title: r.job_title?.trim() || null,
      dietary: r.dietary?.trim() || null,
      accessibility: r.accessibility?.trim() || null,
      updated_at: new Date().toISOString(),
    }).eq('id', r.id);
    setBusy(null);
    if (error) {
      toast({ title: error.code === '23505' ? 'That email is already on this roster' : 'Could not save', description: error.message, variant: 'destructive' });
      return;
    }
    orig.current[r.id] = { ...r };
    setRows(prev => [...prev]); // refresh dirty state
    toast({ title: 'Saved' });
  };

  const setAttending = async (r: Attendee, v: boolean) => {
    const uid = await requireFreshSession();
    if (!uid) return;
    patch(r.id, { attending: v });
    const { error } = await supabase.from('sm_attendee').update({ attending: v, updated_at: new Date().toISOString() }).eq('id', r.id);
    if (error) { patch(r.id, { attending: !v }); toast({ title: 'Could not update', description: error.message, variant: 'destructive' }); return; }
    if (orig.current[r.id]) orig.current[r.id].attending = v;
  };

  const addAttendee = async () => {
    if (!draft.first_name.trim() && !draft.email.trim()) {
      toast({ title: 'Add at least a name or an email', variant: 'destructive' }); return;
    }
    const uid = await requireFreshSession();
    if (!uid) return;
    setAdding(true);
    const { error } = await supabase.from('sm_attendee').insert({
      registration_id: registrationId, event_id: eventId,
      first_name: draft.first_name.trim() || null, last_name: draft.last_name.trim() || null,
      email: draft.email.trim() || null, job_title: draft.job_title.trim() || null,
      is_primary: false, attending: true,
    });
    setAdding(false);
    if (error) {
      toast({ title: error.code === '23505' ? 'That email is already on this roster' : 'Could not add attendee', description: error.message, variant: 'destructive' });
      return;
    }
    setDraft(blankDraft);
    load();
  };

  const remove = async (r: Attendee) => {
    if (r.is_primary) return;
    if (!window.confirm('Remove this attendee from the list?')) return;
    const uid = await requireFreshSession();
    if (!uid) return;
    setBusy(r.id);
    const { error } = await supabase.from('sm_attendee').delete().eq('id', r.id);
    setBusy(null);
    if (error) { toast({ title: 'Could not remove', description: error.message, variant: 'destructive' }); return; }
    setRows(prev => prev.filter(x => x.id !== r.id));
    delete orig.current[r.id];
  };

  // Create-or-link a platform account for this attendee and email them a set-
  // password link (adds them to the company org). Idempotent by email.
  const invite = async (r: Attendee) => {
    if (!r.email?.trim()) { toast({ title: 'Add an email for this attendee first', variant: 'destructive' }); return; }
    if (isDirty(r)) await saveRow(r); // persist the email before inviting
    setInviting(r.id);
    const { data, error } = await supabase.functions.invoke('sm26-attendee-invite', { body: { attendee_id: r.id } });
    setInviting(null);
    if (error) {
      let msg = error.message || 'Please try again.';
      try { const b = await (error as { context?: Response }).context?.json(); if (b?.error) msg = b.error; } catch { /* keep */ }
      toast({ title: 'Could not invite', description: msg, variant: 'destructive' });
      return;
    }
    const d = data as { ok?: boolean; created_account?: boolean; emailed?: boolean } | null;
    toast({
      title: d?.created_account ? 'Account created' : 'Linked to existing account',
      description: d?.emailed ? `A set-up email was sent to ${r.email}.` : 'Account is ready (no email sent).',
    });
    load();
  };

  const confirmList = async (val: boolean) => {
    const uid = await requireFreshSession();
    if (!uid) return;
    setConfirming(true);
    const { data, error } = await supabase.rpc('sm_confirm_attendees', { p_registration_id: registrationId, p_confirmed: val });
    setConfirming(false);
    if (error) { toast({ title: 'Could not update', description: error.message, variant: 'destructive' }); return; }
    setConfirmedAt((data as string | null) || null);
    toast({ title: val ? 'Attendee list confirmed — thank you' : 'Confirmation cleared' });
  };

  // Admin nudge: bell notification + email asking the company to confirm.
  const requestConfirmation = async () => {
    if (!registrantUserId) return;
    setNudging(true);
    await supabase.from('sm_notification').insert({
      user_id: registrantUserId,
      type: 'sm26_attendee_confirm',
      title: 'Please confirm your attendees',
      body: 'Please confirm who from your company will attend the Smart & Sustainable Marina Rendezvous 2026. Add or edit the names in your event hub, then confirm the list.',
      link: '/sm26/me',
    });
    const { error } = await supabase.functions.invoke('sm26-email', { body: { registration_id: registrationId, kind: 'attendees_requested' } });
    setNudging(false);
    toast({
      title: 'Attendee confirmation requested',
      description: error ? 'In-app notification sent (email may not have gone out).' : 'The participant was notified by email and in-app.',
    });
  };

  // Email every attending person their personal entry QR (mints badges first).
  const emailEntryQr = async () => {
    if (!window.confirm('Email each attending person their entry QR now?')) return;
    setSendingQr(true);
    await supabase.rpc('sm_ensure_badges', { p_event_id: eventId });
    const { data, error } = await supabase.functions.invoke('sm26-badge-email', { body: { registration_id: registrationId } });
    setSendingQr(false);
    if (error) { toast({ title: 'Could not send entry passes', description: error.message, variant: 'destructive' }); return; }
    const d = data as { sent?: number; skipped?: { no_email?: number; no_badge?: number } } | null;
    const skips = (d?.skipped?.no_email || 0) + (d?.skipped?.no_badge || 0);
    toast({
      title: `Entry pass sent to ${d?.sent ?? 0} attendee${(d?.sent ?? 0) === 1 ? '' : 's'}`,
      description: skips ? `${d?.skipped?.no_email || 0} had no email, ${d?.skipped?.no_badge || 0} had no badge.` : undefined,
    });
  };

  if (loading) return <div className="flex items-center gap-2 text-sm text-gray-400 py-4"><Loader2 className="h-4 w-4 animate-spin" /> Loading attendees…</div>;

  const attendingCount = rows.filter(r => r.attending).length;

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="text-sm font-semibold text-gray-900 flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" /> Who is attending
          </div>
          <p className="text-xs text-gray-500 mt-0.5 max-w-prose">
            {variant === 'hub'
              ? 'Add every person from your company who will attend — each gets their own badge and check-in. The person who filled the form is listed first; edit or unset them if they are not attending.'
              : 'Named attendees for this registration. Each attending person gets a badge and individual check-in.'}
          </p>
        </div>
        <span className="text-xs font-medium text-gray-500 shrink-0 rounded-full bg-gray-100 px-2.5 py-1">
          {attendingCount} attending
        </span>
      </div>

      {/* Confirmation status */}
      <div className={`flex items-center gap-2 text-xs rounded-lg border px-3 py-2 ${confirmedAt ? 'border-green-200 bg-green-50 text-green-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
        {confirmedAt
          ? <><CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> Attendee list confirmed on {prettyDateTime(confirmedAt)}.</>
          : <><Users className="h-3.5 w-3.5 shrink-0" /> This list is not confirmed yet{deadlinePretty ? ` — please confirm by ${deadlinePretty}` : ''}.</>}
      </div>

      {variant === 'hub' && rosterLocked && (
        <div className="flex items-center gap-2 text-xs text-gray-500 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
          <Lock className="h-3.5 w-3.5 shrink-0" /> The attendee list closed{deadlinePretty ? ` on ${deadlinePretty}` : ''}. Contact M3 to make a change.
        </div>
      )}

      <div className="space-y-2">
        {rows.map(r => (
          <div key={r.id} className={`rounded-lg border p-3 ${r.attending ? 'border-gray-200' : 'border-dashed border-gray-200 bg-gray-50/60'}`}>
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              {r.is_primary
                ? <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5"><Star className="h-2.5 w-2.5" /> Registration contact</span>
                : <span className="inline-flex items-center gap-1 text-[10px] font-medium text-gray-500 bg-gray-100 rounded-full px-2 py-0.5"><Users className="h-2.5 w-2.5" /> Guest</span>}
              {r.user_id && <span className="inline-flex items-center gap-1 text-[10px] font-medium text-green-700 bg-green-50 border border-green-200 rounded-full px-2 py-0.5"><BadgeCheck className="h-2.5 w-2.5" /> Has account</span>}
              {editable && !r.is_primary && (
                <Button size="sm" variant="ghost" className="h-6 w-6 p-0 ml-auto text-gray-300 hover:text-red-600" disabled={busy === r.id} onClick={() => remove(r)} title="Remove attendee">
                  {busy === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                </Button>
              )}
            </div>
            <div className="grid sm:grid-cols-2 gap-2">
              <Input value={r.first_name || ''} disabled={!editable} placeholder="First name" className="h-9 text-sm" onChange={e => patch(r.id, { first_name: e.target.value })} />
              <Input value={r.last_name || ''} disabled={!editable} placeholder="Last name" className="h-9 text-sm" onChange={e => patch(r.id, { last_name: e.target.value })} />
              <Input value={r.email || ''} disabled={!editable} placeholder="Email" type="email" className="h-9 text-sm" onChange={e => patch(r.id, { email: e.target.value })} />
              <Input value={r.job_title || ''} disabled={!editable} placeholder="Job title" className="h-9 text-sm" onChange={e => patch(r.id, { job_title: e.target.value })} />
              <Input value={r.dietary || ''} disabled={!editable} placeholder="Dietary needs (optional)" className="h-9 text-sm" onChange={e => patch(r.id, { dietary: e.target.value })} />
              <Input value={r.accessibility || ''} disabled={!editable} placeholder="Accessibility needs (optional)" className="h-9 text-sm" onChange={e => patch(r.id, { accessibility: e.target.value })} />
            </div>
            <div className="flex items-center justify-between gap-2 mt-2 flex-wrap">
              <label className={`flex items-center gap-2 text-xs cursor-pointer ${r.attending ? 'text-gray-700' : 'text-gray-400'}`}>
                <Checkbox checked={r.attending} disabled={!editable} onCheckedChange={v => editable && setAttending(r, v === true)} />
                {r.is_primary ? 'I am attending in person' : 'Attending in person'}
              </label>
              <div className="flex items-center gap-1.5">
                {canEdit && !r.user_id && (
                  <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" disabled={inviting === r.id || !r.email?.trim()} onClick={() => invite(r)} title={r.email?.trim() ? 'Create or link a platform account and email a set-up link' : 'Add an email first'}>
                    {inviting === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />} Invite to account
                  </Button>
                )}
                {editable && isDirty(r) && (
                  <Button size="sm" className="h-8 gap-1.5" disabled={busy === r.id} onClick={() => saveRow(r)}>
                    {busy === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Save
                  </Button>
                )}
              </div>
            </div>
            {r.is_primary && !r.attending && (
              <p className="text-[11px] text-gray-400 mt-1.5">Marked as not attending — no badge will be issued for this person.</p>
            )}
          </div>
        ))}
      </div>

      {editable && (
        <div className="rounded-lg border border-dashed border-gray-200 p-3 space-y-2">
          <div className="text-xs font-medium text-gray-600 flex items-center gap-1.5"><UserPlus className="h-3.5 w-3.5 text-primary" /> Add an attendee</div>
          <div className="grid sm:grid-cols-2 gap-2">
            <Input value={draft.first_name} placeholder="First name" className="h-9 text-sm" onChange={e => setDraft(d => ({ ...d, first_name: e.target.value }))} />
            <Input value={draft.last_name} placeholder="Last name" className="h-9 text-sm" onChange={e => setDraft(d => ({ ...d, last_name: e.target.value }))} />
            <Input value={draft.email} placeholder="Email" type="email" className="h-9 text-sm" onChange={e => setDraft(d => ({ ...d, email: e.target.value }))} />
            <Input value={draft.job_title} placeholder="Job title" className="h-9 text-sm" onChange={e => setDraft(d => ({ ...d, job_title: e.target.value }))} />
          </div>
          <Button size="sm" className="gap-1.5" disabled={adding} onClick={addAttendee}>
            {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />} Add attendee
          </Button>
        </div>
      )}

      {/* Footer actions: participant confirms; admin nudges. */}
      {variant === 'hub' && canEdit && (
        <div className="flex items-center justify-between gap-2 flex-wrap pt-1">
          <p className="text-[11px] text-gray-400 max-w-prose">
            {confirmedAt ? 'You can still edit and re-confirm.' : 'Once your list is complete, confirm it so M3 knows it is final.'}
          </p>
          <Button size="sm" variant={confirmedAt ? 'outline' : 'default'} className="gap-1.5" disabled={confirming} onClick={() => confirmList(!confirmedAt)}>
            {confirming ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            {confirmedAt ? 'Unconfirm' : 'Confirm attendee list'}
          </Button>
        </div>
      )}

      {variant === 'admin' && (
        <div className="flex items-center justify-between gap-2 flex-wrap pt-1 border-t border-gray-100 mt-1">
          <p className="text-[11px] text-gray-400 max-w-prose pt-2">
            {registrantUserId
              ? 'Ask the company to review and confirm who is attending (bell + email).'
              : 'No platform account on this registration yet — invite an attendee or provision the account to enable the reminder.'}
          </p>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <Button size="sm" variant="outline" className="gap-1.5" disabled={sendingQr} onClick={emailEntryQr} title="Email each attending person their personal entry QR">
              {sendingQr ? <Loader2 className="h-4 w-4 animate-spin" /> : <QrCode className="h-4 w-4" />} Email entry QR
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5" disabled={nudging || !registrantUserId} onClick={requestConfirmation}>
              {nudging ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Request attendee confirmation
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
