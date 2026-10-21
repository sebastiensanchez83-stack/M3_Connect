import { useState, useEffect } from 'react';
import { Plus, Building2, Award, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CardShell, StretchedLink } from '@/components/brand/CardShell';
import { BTN, BTN_OUTLINE, MemberEmpty, RowSkeleton } from '@/components/member/MemberUI';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { SpSponsor, SpTier, SpProgram, deliveredPct } from '@/lib/sponsorship';
import { FIELD, FIELD_LABEL, ProgressBar, SponsorStatusPill, SponsorshipFrame } from './sponsorshipUi';
import { cn } from '@/lib/utils';
import {
  AdminEmpty, AdminLoading, AdminPageHeader, AdminStatus, ADMIN_BTN_PRIMARY,
} from '@/components/admin/AdminUI';
import { LinkCard } from '@/components/admin/v2/ContentFormKit';

// Admin / YCM fulfilment hub: every sponsor with tier, status and % delivered.
// basePath differs by mount point (/admin/sponsorships vs /sponsorship); `band`
// puts the marine band on top (the /sponsorship page, for M3 and Yacht Club de
// Monaco: it looks exactly as before). Without it (the admin workspace) the
// screen speaks the admin's language (wave 2, 21 Oct 2026): the admin page
// header, the gold main action, and cards that say where they lead. Same data,
// same handlers either way.

interface Row extends SpSponsor { tierLabel: string | null; pct: number; hasAgreement: boolean }

export function SponsorshipHub({ basePath, band = false }: { basePath: string; band?: boolean }) {
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

  const frame = (children: React.ReactNode) => band ? (
    <SponsorshipFrame
      band
      icon={Award}
      eyebrow="Sponsorship"
      title="Sponsorship fulfilment"
      meta={<span>What each sponsor was sold, what we owe, and what we've delivered.</span>}
      actions={!loading && <Button variant="ctaOnDark" size="sm" onClick={() => setOpen(true)}>New sponsor</Button>}
    >
      {children}
    </SponsorshipFrame>
  ) : (
    <div className="mx-auto w-full max-w-5xl">
      <AdminPageHeader
        title="Sponsors and partners"
        count={loading ? undefined : rows.length}
        description="The paying sponsors: what each one was sold, what M3 owes them and what has been delivered. Press a sponsor to see its agreement and what is left to deliver."
        actions={!loading && (
          <Button variant="secondary" className={cn(ADMIN_BTN_PRIMARY, 'gap-1.5')} onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" /> Add a sponsor
          </Button>
        )}
      />
      {children}
    </div>
  );

  if (loading) return frame(band ? <CardShell><RowSkeleton rows={3} /></CardShell> : <AdminLoading />);

  /** What a sponsor's card shows (tier, contact, status, delivery), the same on both screens. */
  const progress = (s: Row) => s.hasAgreement ? (
    <>
      <div className="mb-1.5 flex items-center justify-between text-[13px] leading-5">
        <span className="text-meta">Delivered</span>
        <span className="font-semibold tabular-nums text-navy">{s.pct}%</span>
      </div>
      <ProgressBar pct={s.pct} label={`${s.company_name}: ${s.pct}% delivered`} />
    </>
  ) : (
    <p className="text-[13px] leading-5 text-meta">No agreement yet</p>
  );

  return frame(
    <>
      {!band ? (
        rows.length === 0 ? (
          <div className="rounded-card border border-rule bg-white">
            <AdminEmpty
              icon={Building2}
              title="No sponsors yet"
              body="Press “Add a sponsor”, then build its agreement from a tier template."
            />
          </div>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Sponsors">
            {rows.map(s => (
              <li key={s.id} className="flex">
                <LinkCard to={`${basePath}/${s.id}`} cue="Open the sponsor" className="w-full">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="text-[16px] font-semibold leading-6 text-navy [overflow-wrap:anywhere]">
                        <span className="card-ul">{s.company_name}</span>
                      </h2>
                      <p className="mt-1 text-[14px] leading-5 text-meta [overflow-wrap:anywhere]">
                        {s.tierLabel || 'No tier'}{s.primary_contact_name ? ` · ${s.primary_contact_name}` : ''}
                      </p>
                    </div>
                    <AdminStatus status={s.status} />
                  </div>
                  <div className="mt-auto pt-5">{progress(s)}</div>
                </LinkCard>
              </li>
            ))}
          </ul>
        )
      ) : rows.length === 0 ? (
        <CardShell>
          <MemberEmpty
            icon={Building2}
            title="No sponsors yet"
            body="Create one and build its agreement from a tier template."
          />
        </CardShell>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map(s => (
            <li key={s.id} className="flex">
              <CardShell interactive className="w-full p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-card-title text-navy [overflow-wrap:anywhere]">
                      <StretchedLink to={`${basePath}/${s.id}`}>{s.company_name}</StretchedLink>
                    </h2>
                    <p className="mt-1 text-[14px] leading-5 text-meta [overflow-wrap:anywhere]">
                      {s.tierLabel || 'No tier'}{s.primary_contact_name ? ` · ${s.primary_contact_name}` : ''}
                    </p>
                  </div>
                  <SponsorStatusPill status={s.status} />
                </div>
                <div className="mt-auto pt-5">{progress(s)}</div>
              </CardShell>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New sponsor</DialogTitle>
            <DialogDescription>Add the company, then build its agreement from a tier template if you want one now.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="sp-new-company" className={FIELD_LABEL}>Company name *</Label>
              <Input id="sp-new-company" className={FIELD} value={form.company_name} onChange={e => setForm(f => ({ ...f, company_name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sp-new-contact" className={FIELD_LABEL}>Primary contact name</Label>
              <Input id="sp-new-contact" className={FIELD} value={form.primary_contact_name} onChange={e => setForm(f => ({ ...f, primary_contact_name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sp-new-email" className={FIELD_LABEL}>Primary contact email</Label>
              <Input id="sp-new-email" className={FIELD} value={form.primary_contact_email} onChange={e => setForm(f => ({ ...f, primary_contact_email: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sp-new-tier" className={FIELD_LABEL}>Build agreement from tier (optional)</Label>
              <Select value={form.tier_key} onValueChange={v => setForm(f => ({ ...f, tier_key: v }))}>
                <SelectTrigger id="sp-new-tier" className={FIELD}><SelectValue placeholder="No agreement yet" /></SelectTrigger>
                <SelectContent>{tiers.map(t => <SelectItem key={t.tier_key} value={t.tier_key}>{t.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" className={BTN_OUTLINE} onClick={() => setOpen(false)}>Cancel</Button>
              <Button className={cn(BTN, 'gap-1.5')} disabled={creating} onClick={create}>{creating && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />} Create</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>,
  );
}
