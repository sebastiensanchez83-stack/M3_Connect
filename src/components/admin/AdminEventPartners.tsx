import { useState, useEffect } from 'react';
import { Users, Plus, X, RefreshCw, ExternalLink } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';

// Admin grants scoped partner access (Yacht Club etc.). A partner can download
// sponsor/speaker dossiers, read the programme, and change e-catalogue status at
// /sm26/partner — nothing else. The grantee must already have a platform account.

interface Partner { id: string; user_id: string; label: string | null; name: string | null; email: string | null }

export function AdminEventPartners({ eventId }: { eventId: string }) {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [eventId]);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.rpc('sm_partner_list', { p_event_id: eventId });
    setPartners((data || []) as Partner[]);
    setLoading(false);
  };

  const add = async () => {
    if (!email.trim()) return;
    setBusy(true);
    const { error } = await supabase.rpc('sm_partner_add', { p_event_id: eventId, p_email: email.trim(), p_label: label.trim() });
    setBusy(false);
    if (error) { toast({ title: 'Could not add partner', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Partner access granted' });
    setEmail(''); setLabel(''); setOpen(false); load();
  };

  const remove = async (p: Partner) => {
    if (!confirm(`Remove partner access for ${p.label || p.email}?`)) return;
    setBusy(true);
    const { error } = await supabase.rpc('sm_partner_remove', { p_id: p.id });
    setBusy(false);
    if (error) { toast({ title: 'Could not remove', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Removed' });
    load();
  };

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-bold text-gray-700 flex items-center gap-2"><Users className="h-4 w-4 text-blue-500" /> Event partners ({partners.length})</CardTitle>
          <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setOpen(o => !o)}><Plus className="h-4 w-4" /> Grant access</Button>
        </div>
        <CardDescription>Scoped access to <a href="/sm26/partner" target="_blank" rel="noreferrer" className="text-primary inline-flex items-center gap-0.5">/sm26/partner <ExternalLink className="h-3 w-3" /></a> — sponsor &amp; speaker dossiers, read-only programme, e-catalogue status. No attendee list.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {loading ? (
          <div className="py-2 flex justify-center"><RefreshCw className="h-5 w-5 animate-spin text-gray-300" /></div>
        ) : partners.length === 0 ? (
          <p className="text-sm text-gray-400">No partners yet.</p>
        ) : partners.map(p => (
          <div key={p.id} className="flex items-center justify-between gap-2 rounded-lg border border-gray-100 px-3 py-2">
            <div className="min-w-0">
              <div className="text-sm font-medium text-gray-800 truncate">{p.label || p.name || p.email}</div>
              <div className="text-xs text-gray-400 truncate">{p.email}{p.label && p.name ? ` · ${p.name}` : ''}</div>
            </div>
            <Button size="icon" variant="ghost" className="h-7 w-7 text-gray-400 hover:text-red-600 shrink-0" onClick={() => remove(p)} disabled={busy}><X className="h-4 w-4" /></Button>
          </div>
        ))}

        {open && (
          <div className="space-y-2 pt-1 border-t border-gray-100">
            <Input value={email} onChange={e => setEmail(e.target.value)} placeholder="Account email (must already exist)" className="h-9" />
            <div className="flex gap-2">
              <Input value={label} onChange={e => setLabel(e.target.value)} placeholder="Label, e.g. Yacht Club de Monaco" className="h-9" />
              <Button size="sm" className="h-9 shrink-0" disabled={busy || !email.trim()} onClick={add}>Grant</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
