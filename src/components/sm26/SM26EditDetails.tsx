import { useState, useEffect } from 'react';
import { Loader2, Save, Pencil, AlertCircle, Lock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { SM26_BASE_FIELDS } from '@/components/admin/AdminSM26';
import { useSm26EditLock } from './useSm26EditLock';

// Participant self-service editing of their own registration details. Solves the
// dead-end where a field skipped at signup could never be fixed. Fields M3 has
// explicitly asked for (sm_registration.requested_fields) are highlighted; once
// provided they're cleared from the request list.

type Row = Record<string, unknown> & { requested_fields?: string[]; info_request_note?: string | null };

export function SM26EditDetails({ registrationId, regStatus, onSaved }: { registrationId: string; regStatus?: string; onSaved?: () => void }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [requested, setRequested] = useState<Set<string>>(new Set());
  const [note, setNote] = useState<string | null>(null);
  const { locked, prettyDate } = useSm26EditLock();

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [registrationId]);

  const load = async () => {
    setLoading(true);
    const cols = SM26_BASE_FIELDS.map(f => f.key).join(',');
    const { data } = await supabase.from('sm_registration')
      .select(`${cols},email,requested_fields,info_request_note`)
      .eq('id', registrationId).maybeSingle();
    const r = (data || {}) as Row;
    const v: Record<string, string> = {};
    for (const f of SM26_BASE_FIELDS) v[f.key] = (r[f.key] as string) || '';
    setValues(v);
    const req = new Set((r.requested_fields as string[] | undefined) || []);
    setRequested(req);
    setNote(r.info_request_note || null);
    if (req.size > 0) setOpen(true); // auto-expand when M3 has asked for something
    setLoading(false);
  };

  const set = (k: string, val: string) => setValues(prev => ({ ...prev, [k]: val }));

  const save = async () => {
    if (locked) return;
    if (!values.first_name?.trim() || !values.last_name?.trim()) {
      toast({ title: 'Name required', description: 'First and last name can’t be empty.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    const patch: Record<string, string | null> = {};
    for (const f of SM26_BASE_FIELDS) patch[f.key] = values[f.key]?.trim() || null;
    // Clear any requested field that now has a value.
    const stillMissing = [...requested].filter(k => !patch[k]);
    const { error } = await supabase.from('sm_registration')
      .update({ ...patch, requested_fields: stillMissing, info_request_note: stillMissing.length ? note : null })
      .eq('id', registrationId);
    setSaving(false);
    if (error) { toast({ title: 'Could not save', description: error.message, variant: 'destructive' }); return; }
    setRequested(new Set(stillMissing));
    if (!stillMissing.length) setNote(null);
    toast({ title: 'Details saved' });
    onSaved?.();
  };

  if (loading) return null;

  // Don't nag for details on a declined/cancelled registration.
  const hasRequests = requested.size > 0 && regStatus !== 'declined' && regStatus !== 'cancelled';

  return (
    <Card className={hasRequests ? 'border-amber-200' : undefined}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base"><Pencil className="h-4 w-4 text-primary" /> Your details</CardTitle>
          {locked
            ? <span className="text-xs text-gray-400 inline-flex items-center gap-1.5"><Lock className="h-3.5 w-3.5" /> Editing closed{prettyDate ? ` · ${prettyDate}` : ''}</span>
            : <Button size="sm" variant={open ? 'ghost' : 'outline'} onClick={() => setOpen(o => !o)}>{open ? 'Close' : 'Edit'}</Button>}
        </div>
        <CardDescription>Keep your registration up to date — you can complete or correct anything here.</CardDescription>
      </CardHeader>

      {hasRequests && (
        <CardContent className="pt-0">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
            <p className="font-medium text-amber-800 flex items-center gap-1.5"><AlertCircle className="h-4 w-4" /> M3 needs a few details from you:</p>
            <ul className="mt-1 list-disc list-inside text-amber-700">
              {SM26_BASE_FIELDS.filter(f => requested.has(f.key)).map(f => <li key={f.key}>{f.label}</li>)}
            </ul>
            {note && <p className="mt-1.5 italic text-amber-700">“{note}”</p>}
          </div>
        </CardContent>
      )}

      {open && !locked && (
        <CardContent className="space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            {SM26_BASE_FIELDS.map(f => (
              <div key={f.key} className={f.multi ? 'sm:col-span-2 space-y-1' : 'space-y-1'}>
                <Label className="text-xs flex items-center gap-1.5">
                  {f.label}
                  {requested.has(f.key) && <span className="text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">Requested by M3</span>}
                </Label>
                {f.multi
                  ? <Textarea rows={2} value={values[f.key] || ''} onChange={e => set(f.key, e.target.value)} placeholder="Separate multiple with commas" />
                  : <Input value={values[f.key] || ''} onChange={e => set(f.key, e.target.value)} className="h-9" />}
              </div>
            ))}
          </div>
          <div className="flex justify-end">
            <Button onClick={save} disabled={saving} className="gap-1.5">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save details
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
