import { useState } from 'react';
import { BellRing, Paperclip, FileText, Send, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';

// "Request specific information" picker — replaces the old generic
// per-role "Request info" button. The admin ticks exactly which requirement
// items they still need, adds an optional note, and sends. We:
//   • set the role to needs_info
//   • stash the requested field_keys + note on module_data (prefixed meta keys
//     so they never collide with real fields and stay hidden from display)
//   • notify the participant listing precisely those items
// The participant's checklist (/sm26/me) then highlights those same items.

export interface ReqItem {
  field_key: string;
  label: string | null;
  required: boolean;
  is_asset: boolean;
}

interface Props {
  roleAssignmentId: string;
  roleLabel: string;
  items: ReqItem[];
  moduleData: Record<string, unknown> | null;
  // Combined data to judge "already provided" against (module_data + the profile
  // row). Defaults to moduleData. We only ever WRITE meta keys to moduleData.
  satisfiedData?: Record<string, unknown> | null;
  userId: string | null;
  onSent: () => void;
}

export function SM26RequestInfo({ roleAssignmentId, roleLabel, items, moduleData, satisfiedData, userId, onSent }: Props) {
  const md = moduleData || {};
  const sd = (satisfiedData || moduleData || {}) as Record<string, unknown>;
  const has = (v: unknown) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0);
  const satisfied = (k: string) => {
    if (has(sd[k])) return true;
    // tolerate field_key vs stored column (logo ↔ logo_url, deck ↔ pitch_deck…)
    return Object.keys(sd).some(key => has(sd[key]) && key.includes(k));
  };
  // Default selection: everything the participant hasn't provided yet.
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(items.filter(i => !satisfied(i.field_key)).map(i => i.field_key)));
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);

  const toggle = (k: string) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(k)) next.delete(k); else next.add(k);
    return next;
  });

  const send = async () => {
    if (selected.size === 0 && !note.trim()) {
      toast({ title: 'Nothing selected', description: 'Tick at least one item or add a note.', variant: 'destructive' });
      return;
    }
    setSending(true);
    const keys = [...selected];
    const merged = {
      ...md,
      _requested_info: keys,
      _request_note: note.trim() || null,
      _requested_at: new Date().toISOString(),
    };
    const { error } = await supabase
      .from('sm_role_assignment')
      .update({ status: 'needs_info', module_data: merged })
      .eq('id', roleAssignmentId);
    if (!error && userId) {
      const labels = items.filter(i => selected.has(i.field_key)).map(i => i.label || i.field_key);
      const list = labels.length ? `\n\nWe need: ${labels.join(', ')}.` : '';
      await supabase.from('sm_notification').insert({
        user_id: userId,
        type: 'sm26_info_required',
        title: `Information needed — ${roleLabel}`,
        body: `Please complete your ${roleLabel} details for the Smart & Sustainable Marina Rendezvous 2026.${list}${note.trim() ? `\n\nNote from M3: ${note.trim()}` : ''}`,
        link: '/sm26/me',
      });
    }
    setSending(false);
    if (error) { toast({ title: 'Could not send request', description: error.message, variant: 'destructive' }); return; }
    toast({ title: userId ? 'Request sent to participant' : 'Marked as needs-info', description: userId ? `${selected.size} item(s) requested.` : 'No account yet — nothing emailed.' });
    setOpen(false);
    setNote('');
    onSent();
  };

  if (!open) {
    return (
      <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setOpen(true)} title="Ask the participant for specific details">
        <BellRing className="h-3.5 w-3.5" /> Request info
      </Button>
    );
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 w-full mt-2">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-700 flex items-center gap-1.5">
          <BellRing className="h-3.5 w-3.5" /> Request specific information
        </div>
        <Button size="icon" variant="ghost" className="h-6 w-6 text-amber-700/60 hover:text-amber-800" onClick={() => setOpen(false)}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      <p className="text-xs text-gray-500 -mt-1 mb-2">Tick exactly what's missing — the participant sees only these highlighted on their page.</p>

      {items.length > 0 ? (
        <div className="space-y-1.5">
          {items.map(it => {
            const has = satisfied(it.field_key);
            return (
              <label key={it.field_key} className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox checked={selected.has(it.field_key)} onCheckedChange={() => toggle(it.field_key)} className="border-amber-300" />
                <span className="text-gray-800">{it.label || it.field_key}</span>
                {it.is_asset ? <Paperclip className="h-3 w-3 text-gray-400" /> : <FileText className="h-3 w-3 text-gray-400" />}
                {!it.required && <span className="text-[10px] text-gray-400">(optional)</span>}
                {has && <span className="text-[10px] text-green-600">already provided</span>}
              </label>
            );
          })}
        </div>
      ) : (
        <p className="text-xs text-gray-500">No predefined items for this role — use the note below.</p>
      )}

      <Textarea
        value={note}
        onChange={e => setNote(e.target.value)}
        placeholder="Optional note to the participant…"
        className="mt-2 h-16 text-sm bg-white"
      />

      <div className="flex items-center justify-end gap-2 mt-2">
        <Button size="sm" variant="ghost" className="h-8" onClick={() => setOpen(false)} disabled={sending}>Cancel</Button>
        <Button size="sm" className="h-8 gap-1.5" onClick={send} disabled={sending}>
          <Send className="h-3.5 w-3.5" /> {userId ? 'Send request to participant' : 'Mark as needs-info'}
        </Button>
      </div>
    </div>
  );
}
