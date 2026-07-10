import { useState, useEffect, useRef } from 'react';
import { Loader2, UserPlus, Trash2, Check, Users, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';

// Named-attendee roster for one SM26 registration. The person who filled the
// form is the *registration contact*; who actually attends may differ, so the
// company confirms the real list here. Each attending person gets a badge +
// individual check-in. Invoicing stays per-company — this just gives an
// accurate headcount and the names to print badges from.
//
// Used self-service in the participant hub (canEdit = owner/org-member) and in
// the admin registration sheet (canEdit = staff).

interface Attendee {
  id: string;
  registration_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  job_title: string | null;
  is_primary: boolean;
  attending: boolean;
}

const blankDraft = { first_name: '', last_name: '', email: '', job_title: '' };

export function SM26AttendeeRoster({ registrationId, eventId, canEdit, variant = 'hub' }: {
  registrationId: string; eventId: string; canEdit: boolean; variant?: 'hub' | 'admin';
}) {
  const [rows, setRows] = useState<Attendee[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState(blankDraft);
  const orig = useRef<Record<string, Attendee>>({});

  const load = async () => {
    const { data } = await supabase.from('sm_attendee').select('*')
      .eq('registration_id', registrationId)
      .order('is_primary', { ascending: false })
      .order('created_at', { ascending: true });
    const list = (data || []) as Attendee[];
    orig.current = Object.fromEntries(list.map(r => [r.id, { ...r }]));
    setRows(list);
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [registrationId]);

  const patch = (id: string, changes: Partial<Attendee>) =>
    setRows(prev => prev.map(r => r.id === id ? { ...r, ...changes } : r));

  const isDirty = (r: Attendee) => {
    const o = orig.current[r.id];
    return !!o && (['first_name', 'last_name', 'email', 'job_title'] as const).some(k => (r[k] || '') !== (o[k] || ''));
  };

  const saveRow = async (r: Attendee) => {
    setBusy(r.id);
    const { error } = await supabase.from('sm_attendee').update({
      first_name: r.first_name?.trim() || null,
      last_name: r.last_name?.trim() || null,
      email: r.email?.trim() || null,
      job_title: r.job_title?.trim() || null,
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
    patch(r.id, { attending: v });
    const { error } = await supabase.from('sm_attendee').update({ attending: v, updated_at: new Date().toISOString() }).eq('id', r.id);
    if (error) { patch(r.id, { attending: !v }); toast({ title: 'Could not update', description: error.message, variant: 'destructive' }); return; }
    if (orig.current[r.id]) orig.current[r.id].attending = v;
  };

  const addAttendee = async () => {
    if (!draft.first_name.trim() && !draft.email.trim()) {
      toast({ title: 'Add at least a name or an email', variant: 'destructive' }); return;
    }
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
    setBusy(r.id);
    const { error } = await supabase.from('sm_attendee').delete().eq('id', r.id);
    setBusy(null);
    if (error) { toast({ title: 'Could not remove', description: error.message, variant: 'destructive' }); return; }
    setRows(prev => prev.filter(x => x.id !== r.id));
    delete orig.current[r.id];
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

      <div className="space-y-2">
        {rows.map(r => (
          <div key={r.id} className={`rounded-lg border p-3 ${r.attending ? 'border-gray-200' : 'border-dashed border-gray-200 bg-gray-50/60'}`}>
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              {r.is_primary
                ? <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5"><Star className="h-2.5 w-2.5" /> Registration contact</span>
                : <span className="inline-flex items-center gap-1 text-[10px] font-medium text-gray-500 bg-gray-100 rounded-full px-2 py-0.5"><Users className="h-2.5 w-2.5" /> Guest</span>}
              {canEdit && !r.is_primary && (
                <Button size="sm" variant="ghost" className="h-6 w-6 p-0 ml-auto text-gray-300 hover:text-red-600" disabled={busy === r.id} onClick={() => remove(r)} title="Remove attendee">
                  {busy === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                </Button>
              )}
            </div>
            <div className="grid sm:grid-cols-2 gap-2">
              <Input value={r.first_name || ''} disabled={!canEdit} placeholder="First name" className="h-9 text-sm" onChange={e => patch(r.id, { first_name: e.target.value })} />
              <Input value={r.last_name || ''} disabled={!canEdit} placeholder="Last name" className="h-9 text-sm" onChange={e => patch(r.id, { last_name: e.target.value })} />
              <Input value={r.email || ''} disabled={!canEdit} placeholder="Email" type="email" className="h-9 text-sm" onChange={e => patch(r.id, { email: e.target.value })} />
              <Input value={r.job_title || ''} disabled={!canEdit} placeholder="Job title" className="h-9 text-sm" onChange={e => patch(r.id, { job_title: e.target.value })} />
            </div>
            <div className="flex items-center justify-between gap-2 mt-2 flex-wrap">
              <label className={`flex items-center gap-2 text-xs cursor-pointer ${r.attending ? 'text-gray-700' : 'text-gray-400'}`}>
                <Checkbox checked={r.attending} disabled={!canEdit} onCheckedChange={v => canEdit && setAttending(r, v === true)} />
                {r.is_primary ? 'I am attending in person' : 'Attending in person'}
              </label>
              {canEdit && isDirty(r) && (
                <Button size="sm" className="h-8 gap-1.5" disabled={busy === r.id} onClick={() => saveRow(r)}>
                  {busy === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Save
                </Button>
              )}
            </div>
            {r.is_primary && !r.attending && (
              <p className="text-[11px] text-gray-400 mt-1.5">Marked as not attending — no badge will be issued for this person.</p>
            )}
          </div>
        ))}
      </div>

      {canEdit && (
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
    </div>
  );
}
