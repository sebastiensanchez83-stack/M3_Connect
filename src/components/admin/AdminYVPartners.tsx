import { useState, useEffect } from 'react';
import { Compass, Plus, X, RefreshCw, ExternalLink } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';

// Admin grants Yachting Ventures (Gabriella) scoped access to the innovation
// pipeline + jury console at /sm26/yv — registration, confirmation and payment
// status for follow-ups. The grantee must already have a platform account.

interface YV { id: string; user_id: string; name: string | null; email: string | null }

export function AdminYVPartners({ eventId }: { eventId: string }) {
  const [people, setPeople] = useState<YV[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [eventId]);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.rpc('sm_yv_list', { p_event_id: eventId });
    setPeople((data || []) as YV[]);
    setLoading(false);
  };

  const add = async () => {
    if (!email.trim()) return;
    setBusy(true);
    const { error } = await supabase.rpc('sm_yv_add', { p_event_id: eventId, p_email: email.trim() });
    setBusy(false);
    if (error) { toast({ title: 'Could not grant access', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Yachting Ventures access granted' });
    setEmail(''); setOpen(false); load();
  };

  const remove = async (p: YV) => {
    if (!confirm(`Remove Yachting Ventures access for ${p.name || p.email}?`)) return;
    setBusy(true);
    const { error } = await supabase.rpc('sm_yv_remove', { p_id: p.id });
    setBusy(false);
    if (error) { toast({ title: 'Could not remove', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Removed' });
    load();
  };

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-bold text-gray-700 flex items-center gap-2"><Compass className="h-4 w-4 text-teal-500" /> Yachting Ventures ({people.length})</CardTitle>
          <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setOpen(o => !o)}><Plus className="h-4 w-4" /> Grant access</Button>
        </div>
        <CardDescription>Scoped access to <a href="/sm26/yv" target="_blank" rel="noreferrer" className="text-primary inline-flex items-center gap-0.5">/sm26/yv <ExternalLink className="h-3 w-3" /></a> — the innovation pipeline &amp; jury with registration, confirmation and payment status. No other event data.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {loading ? (
          <div className="py-2 flex justify-center"><RefreshCw className="h-5 w-5 animate-spin text-gray-300" /></div>
        ) : people.length === 0 ? (
          <p className="text-sm text-gray-400">No Yachting Ventures access granted yet.</p>
        ) : people.map(p => (
          <div key={p.id} className="flex items-center justify-between gap-2 rounded-lg border border-gray-100 px-3 py-2">
            <div className="min-w-0">
              <div className="text-sm font-medium text-gray-800 truncate">{p.name || p.email}</div>
              <div className="text-xs text-gray-400 truncate">{p.email}</div>
            </div>
            <Button size="icon" variant="ghost" className="h-7 w-7 text-gray-400 hover:text-red-600 shrink-0" onClick={() => remove(p)} disabled={busy}><X className="h-4 w-4" /></Button>
          </div>
        ))}

        {open && (
          <div className="space-y-2 pt-1 border-t border-gray-100">
            <div className="flex gap-2">
              <Input value={email} onChange={e => setEmail(e.target.value)} placeholder="Gabriella's account email (must already exist)" className="h-9" />
              <Button size="sm" className="h-9 shrink-0" disabled={busy || !email.trim()} onClick={add}>Grant</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
