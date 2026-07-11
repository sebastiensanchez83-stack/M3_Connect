import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw, Plus, Building2, ChevronRight, Award, Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { SpSponsor, SpTier, SpProgram, SPONSOR_STATUS_CLS, deliveredPct } from '@/lib/sponsorship';

// Admin / YCM fulfilment hub: every sponsor with tier, status and % delivered.
// basePath differs by mount point (/admin/sponsorships vs /sponsorship).

interface Row extends SpSponsor { tierLabel: string | null; pct: number; hasAgreement: boolean }

export function SponsorshipHub({ basePath }: { basePath: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [tiers, setTiers] = useState<SpTier[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ company_name: '', primary_contact_name: '', primary_contact_email: '', tier_key: '' });

  const load = async () => {
    setLoading(true);
    const [{ data: sponsors }, { data: agr }, { data: benefits }, { data: tierRows }] = await Promise.all([
      supabase.from('sp_sponsor').select('*').order('created_at', { ascending: false }),
      supabase.from('sp_agreement').select('id,sponsor_id,tier_key,status'),
      supabase.from('sp_agreement_benefit').select('agreement_id,delivered,program,event_id'),
      supabase.from('sp_tier').select('*').order('display_order'),
    ]);
    const tierList = (tierRows || []) as SpTier[];
    setTiers(tierList);
    const tierLabel = (k: string | null) => tierList.find(t => t.tier_key === k)?.label || null;
    const agrs = (agr || []) as { id: string; sponsor_id: string; tier_key: string | null; status: string }[];
    const bens = (benefits || []) as { agreement_id: string; delivered: boolean; program: SpProgram; event_id: string | null }[];
    const agrBySponsor = new Map<string, typeof agrs>();
    agrs.forEach(a => { const l = agrBySponsor.get(a.sponsor_id) || []; l.push(a); agrBySponsor.set(a.sponsor_id, l); });
    setRows(((sponsors || []) as SpSponsor[]).map(s => {
      const myAgrs = agrBySponsor.get(s.id) || [];
      const agrIds = new Set(myAgrs.filter(a => a.status !== 'renewed').map(a => a.id));
      const items = bens.filter(b => agrIds.has(b.agreement_id));
      const active = myAgrs.find(a => a.status === 'active') || myAgrs[0];
      return { ...s, tierLabel: tierLabel(active?.tier_key || null), pct: deliveredPct(items), hasAgreement: myAgrs.length > 0 };
    }));
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const create = async () => {
    if (!form.company_name.trim()) { toast({ title: 'Company name is required', variant: 'destructive' }); return; }
    setCreating(true);
    const { data: u } = await supabase.auth.getUser();
    const { data: sp, error } = await supabase.from('sp_sponsor').insert({
      company_name: form.company_name.trim(),
      primary_contact_name: form.primary_contact_name.trim() || null,
      primary_contact_email: form.primary_contact_email.trim() || null,
      status: 'pending', created_by: u?.user?.id || null,
    }).select('id').single();
    if (error || !sp) { setCreating(false); toast({ title: 'Could not create sponsor', description: error?.message, variant: 'destructive' }); return; }
    if (form.tier_key) {
      const { error: agErr } = await supabase.rpc('sp_create_agreement_from_tier', { p_sponsor_id: (sp as { id: string }).id, p_tier_key: form.tier_key });
      if (agErr) toast({ title: 'Sponsor created, but agreement failed', description: agErr.message, variant: 'destructive' });
    }
    setCreating(false); setOpen(false);
    setForm({ company_name: '', primary_contact_name: '', primary_contact_email: '', tier_key: '' });
    toast({ title: 'Sponsor created' });
    await load();
  };

  if (loading) return <div className="flex items-center justify-center h-[50vh]"><RefreshCw className="h-8 w-8 animate-spin text-primary" /></div>;

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Award className="h-6 w-6 text-primary" /> Sponsorship fulfilment</h1>
          <p className="text-sm text-gray-500 mt-0.5">What each sponsor was sold, what we owe, and what we've delivered.</p>
        </div>
        <Button className="gap-1.5" onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> New sponsor</Button>
      </div>

      {rows.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-gray-500">
          <Building2 className="h-10 w-10 text-gray-300 mx-auto mb-3" />
          No sponsors yet. Create one and build its agreement from a tier template.
        </CardContent></Card>
      ) : (
        <div className="space-y-2">
          {rows.map(s => (
            <Link key={s.id} to={`${basePath}/${s.id}`}>
              <Card className="hover:border-primary/40 transition-colors">
                <CardContent className="py-4 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold text-gray-900 truncate">{s.company_name}</div>
                    <div className="text-xs text-gray-500 truncate">
                      {s.tierLabel || 'No tier'}{s.primary_contact_name ? ` · ${s.primary_contact_name}` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {s.hasAgreement && (
                      <div className="w-28 hidden sm:block">
                        <div className="flex items-center justify-between text-[11px] mb-1"><span className="text-gray-400">Delivered</span><span className="font-medium text-gray-600">{s.pct}%</span></div>
                        <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className="h-full rounded-full bg-primary" style={{ width: `${s.pct}%` }} /></div>
                      </div>
                    )}
                    <Badge className={`text-[11px] ${SPONSOR_STATUS_CLS[s.status]}`}>{s.status}</Badge>
                    <ChevronRight className="h-4 w-4 text-gray-300" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogTitle>New sponsor</DialogTitle>
          <div className="space-y-3 pt-2">
            <Input placeholder="Company name *" value={form.company_name} onChange={e => setForm(f => ({ ...f, company_name: e.target.value }))} />
            <Input placeholder="Primary contact name" value={form.primary_contact_name} onChange={e => setForm(f => ({ ...f, primary_contact_name: e.target.value }))} />
            <Input placeholder="Primary contact email" value={form.primary_contact_email} onChange={e => setForm(f => ({ ...f, primary_contact_email: e.target.value }))} />
            <div>
              <label className="text-xs text-gray-500">Build agreement from tier (optional)</label>
              <Select value={form.tier_key} onValueChange={v => setForm(f => ({ ...f, tier_key: v }))}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="No agreement yet" /></SelectTrigger>
                <SelectContent>{tiers.map(t => <SelectItem key={t.tier_key} value={t.tier_key}>{t.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button className="gap-1.5" disabled={creating} onClick={create}>{creating && <Loader2 className="h-4 w-4 animate-spin" />} Create</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
