import { useState } from 'react';
import { BellRing, Send, X, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { SM26_BASE_FIELDS } from './AdminSM26';

// Admin-side request for missing BASE registration fields (company, country,
// objectives…). Mirrors the per-role request picker but writes to
// sm_registration.requested_fields, which /sm26/me reads to highlight + collect.

interface Props {
  registrationId: string;
  userId: string | null;
  current: Record<string, unknown>;
  alreadyRequested?: string[];
  onSent: () => void;
}

export function SM26RequestFields({ registrationId, userId, current, alreadyRequested = [], onSent }: Props) {
  const isEmpty = (k: string) => {
    const v = current[k];
    return v === undefined || v === null || v === '';
  };
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(
    alreadyRequested.length ? alreadyRequested : SM26_BASE_FIELDS.filter(f => isEmpty(f.key)).map(f => f.key)
  ));
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);

  const toggle = (k: string) => setSelected(prev => {
    const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n;
  });

  const send = async () => {
    if (selected.size === 0 && !note.trim()) {
      toast({ title: 'Nothing selected', description: 'Tick at least one field or add a note.', variant: 'destructive' });
      return;
    }
    setSending(true);
    const keys = [...selected];
    const { error } = await supabase.from('sm_registration')
      .update({ requested_fields: keys, info_request_note: note.trim() || null })
      .eq('id', registrationId);
    if (!error && userId) {
      const labels = SM26_BASE_FIELDS.filter(f => selected.has(f.key)).map(f => f.label);
      await supabase.from('sm_notification').insert({
        user_id: userId,
        type: 'sm26_info_required',
        title: 'Please complete your SM26 details',
        body: `M3 needs a few details to finalise your registration${labels.length ? `: ${labels.join(', ')}` : ''}.${note.trim() ? `\n\nNote: ${note.trim()}` : ''}`,
        link: '/sm26/me',
      });
    }
    setSending(false);
    if (error) { toast({ title: 'Could not send', description: error.message, variant: 'destructive' }); return; }
    toast({ title: userId ? 'Request sent to participant' : 'Saved (no account to notify)' });
    setOpen(false); setNote('');
    onSent();
  };

  if (!open) {
    return (
      <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setOpen(true)}>
        <BellRing className="h-3.5 w-3.5" /> Request details
      </Button>
    );
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3">
      <div className="flex items-center justify-between mb-1">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-700 flex items-center gap-1.5"><BellRing className="h-3.5 w-3.5" /> Request registration details</div>
        <Button size="icon" variant="ghost" className="h-6 w-6 text-amber-700/60 hover:text-amber-800" onClick={() => setOpen(false)}><X className="h-3.5 w-3.5" /></Button>
      </div>
      <p className="text-xs text-gray-500 mb-2">Tick what's missing — the participant completes these on their page.</p>
      <div className="grid sm:grid-cols-2 gap-1.5">
        {SM26_BASE_FIELDS.map(f => (
          <label key={f.key} className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox checked={selected.has(f.key)} onCheckedChange={() => toggle(f.key)} className="border-amber-300" />
            <span className="text-gray-800">{f.label}</span>
            {!isEmpty(f.key) && <span className="text-[10px] text-green-600 flex items-center gap-0.5"><Check className="h-3 w-3" />on file</span>}
          </label>
        ))}
      </div>
      <Textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Optional note…" className="mt-2 h-14 text-sm bg-white" />
      <div className="flex justify-end gap-2 mt-2">
        <Button size="sm" variant="ghost" className="h-8" onClick={() => setOpen(false)} disabled={sending}>Cancel</Button>
        <Button size="sm" className="h-8 gap-1.5" onClick={send} disabled={sending}><Send className="h-3.5 w-3.5" /> {userId ? 'Send request' : 'Save'}</Button>
      </div>
    </div>
  );
}
