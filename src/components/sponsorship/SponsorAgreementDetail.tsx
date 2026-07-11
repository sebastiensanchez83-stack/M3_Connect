import { useState, useEffect, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  RefreshCw, ArrowLeft, Check, Loader2, Plus, Trash2, Pencil, Send, RotateCcw,
  UserPlus, Award,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import {
  SpSponsor, SpAgreement, SpAgreementBenefit, SpTier, SpProgram, SpValueType,
  PROGRAM_LABELS, PROGRAM_ORDER, FULFILMENT_STATUS_META, FULFILMENT_STATUSES,
  SPONSOR_STATUS_CLS, AGREEMENT_STATUS_CLS, SpSponsorStatus, SpAgreementStatus,
  formatMoney, formatBenefitValue, isWysPending, deliveredPct, SPONSORSHIP_BUCKET,
} from '@/lib/sponsorship';
import { SponsorBrandAssets } from './SponsorBrandAssets';
import { DeliverableFiles } from './DeliverableFiles';

const eurosToCents = (s: string): number | null => {
  const n = parseFloat(s.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};
const centsToEuros = (c: number | null | undefined) => (c == null ? '' : String(c / 100));

export function SponsorAgreementDetail({ basePath }: { basePath: string }) {
  const { sponsorId } = useParams<{ sponsorId: string }>();
  const navigate = useNavigate();
  const { isModerator } = useAuth(); // M3 staff see the commercial fee; Yacht Club (YCM) do not
  const [sponsor, setSponsor] = useState<SpSponsor | null>(null);
  const [agreement, setAgreement] = useState<SpAgreement | null>(null);
  const [items, setItems] = useState<SpAgreementBenefit[]>([]);
  const [tiers, setTiers] = useState<SpTier[]>([]);
  const [users, setUsers] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [buildTier, setBuildTier] = useState('');
  const [busy, setBusy] = useState(false);
  const [editItem, setEditItem] = useState<SpAgreementBenefit | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [linkEmail, setLinkEmail] = useState('');
  const [formKey, setFormKey] = useState(0); // remount uncontrolled inputs after renew / failed save

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!sponsorId) return;
    if (!opts?.silent) setLoading(true);
    const [{ data: sp }, { data: agrs }, { data: tierRows }, { data: su }] = await Promise.all([
      supabase.from('sp_sponsor').select('*').eq('id', sponsorId).maybeSingle(),
      supabase.from('sp_agreement').select('*').eq('sponsor_id', sponsorId).order('created_at', { ascending: false }),
      supabase.from('sp_tier').select('*').order('display_order'),
      supabase.from('sp_sponsor_user').select('user_id').eq('sponsor_id', sponsorId),
    ]);
    setSponsor(sp as SpSponsor | null);
    setTiers((tierRows || []) as SpTier[]);
    setUsers(((su || []) as { user_id: string }[]).map(x => x.user_id));
    const agrList = (agrs || []) as SpAgreement[];
    const current = agrList.find(a => a.status === 'active') || agrList.find(a => a.status !== 'renewed') || agrList[0] || null;
    setAgreement(current);
    if (current) {
      const { data: bens } = await supabase.from('sp_agreement_benefit').select('*').eq('agreement_id', current.id).order('display_order');
      setItems((bens || []) as SpAgreementBenefit[]);
    } else setItems([]);
    setLoading(false);
  }, [sponsorId]);
  useEffect(() => { load(); }, [load]);

  const saveSponsor = async (patch: Partial<SpSponsor>) => {
    if (!sponsor) return;
    const prev = sponsor;
    setSponsor({ ...sponsor, ...patch });
    const { error } = await supabase.from('sp_sponsor').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', sponsor.id);
    if (error) { setSponsor(prev); setFormKey(k => k + 1); toast({ title: 'Could not save', description: error.message, variant: 'destructive' }); }
  };
  const saveAgreement = async (patch: Partial<SpAgreement>) => {
    if (!agreement) return;
    const prev = agreement;
    setAgreement({ ...agreement, ...patch });
    const { error } = await supabase.from('sp_agreement').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', agreement.id);
    if (error) { setAgreement(prev); setFormKey(k => k + 1); toast({ title: 'Could not save', description: error.message, variant: 'destructive' }); }
    else toast({ title: 'Saved' });
  };

  const build = async () => {
    if (!sponsorId || !buildTier) return;
    setBusy(true);
    const { error } = await supabase.rpc('sp_create_agreement_from_tier', { p_sponsor_id: sponsorId, p_tier_key: buildTier });
    setBusy(false);
    if (error) { toast({ title: 'Could not build agreement', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Agreement built from tier' });
    await load();
  };

  const renew = async () => {
    if (!agreement || !window.confirm('Renew this agreement into a new term? The current one is marked "renewed".')) return;
    setBusy(true);
    const { error } = await supabase.rpc('sp_renew_agreement', { p_agreement_id: agreement.id });
    setBusy(false);
    if (error) { toast({ title: 'Could not renew', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Renewed — new draft term created' });
    await load();
  };

  const patchItem = async (id: string, patch: Partial<SpAgreementBenefit>) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, ...patch } : i));
    const { error } = await supabase.from('sp_agreement_benefit').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) { toast({ title: 'Could not update', description: error.message, variant: 'destructive' }); load(); }
  };
  const setStatus = async (i: SpAgreementBenefit, status: SpAgreementBenefit['status']) => {
    await patchItem(i.id, {
      status, delivered: status === 'DELIVERED',
      delivered_at: status === 'DELIVERED' ? new Date().toISOString() : null,
      requested_at: status === 'REQUESTED_FROM_SPONSOR' ? new Date().toISOString() : i.requested_at,
    });
    // Requesting an asset now emails the sponsor's contacts so they don't have to
    // discover it by opening the portal.
    if (status === 'REQUESTED_FROM_SPONSOR') {
      const { data, error } = await supabase.functions.invoke('sp-notify', { body: { benefit_id: i.id } });
      const d = data as { sent?: number } | null;
      toast({
        title: error ? 'Requested — the email could not be sent' : (d?.sent ? `Requested — emailed ${d.sent} sponsor contact${d.sent === 1 ? '' : 's'}` : 'Requested — no sponsor contact/email on file'),
        variant: error ? 'destructive' : undefined,
      });
    }
  };

  const removeItem = async (i: SpAgreementBenefit) => {
    if (!window.confirm(`Remove "${i.name}" from this agreement?`)) return;
    setItems(prev => prev.filter(x => x.id !== i.id));
    await supabase.from('sp_agreement_benefit').delete().eq('id', i.id);
  };

  const linkUser = async () => {
    if (!sponsorId || !linkEmail.trim()) return;
    setBusy(true);
    const { data, error } = await supabase.rpc('sp_link_sponsor_user', { p_sponsor_id: sponsorId, p_email: linkEmail.trim() });
    setBusy(false);
    if (error) { toast({ title: 'Could not link', description: error.message, variant: 'destructive' }); return; }
    if (!data) { toast({ title: 'No account for that email yet', description: 'Use "Invite" to create their account and email a set-password link.', variant: 'destructive' }); return; }
    setLinkEmail(''); toast({ title: 'Account linked to sponsor portal' });
    await load();
  };

  // Create (or find) the contact's account, grant portal access, and email a
  // set-password link that lands them on their Sponsorship tab.
  const inviteUser = async () => {
    if (!sponsorId || !linkEmail.trim()) return;
    setBusy(true);
    const { data, error } = await supabase.functions.invoke('sponsor-invite', { body: { sponsor_id: sponsorId, email: linkEmail.trim() } });
    setBusy(false);
    if (error) { toast({ title: 'Could not invite', description: error.message, variant: 'destructive' }); return; }
    const emailed = (data as { emailed?: boolean } | null)?.emailed;
    setLinkEmail('');
    toast({ title: 'Sponsor invited', description: emailed ? 'Account ready — a set-password email was sent.' : 'Account ready, but the email could not be sent — check the function logs.' });
    await load();
  };

  // Delete the sponsor entirely. The DB cascades agreements → line items →
  // deliverable-file rows + brand assets; we best-effort purge their storage
  // folder too (financial docs shouldn't linger). Does NOT un-feature the org
  // as a partner (they may be a partner for other reasons).
  const removeSponsor = async () => {
    if (!sponsor) return;
    if (!window.confirm(`Remove "${sponsor.company_name}"? This permanently deletes their agreement, line items and uploaded files. This cannot be undone.`)) return;
    setBusy(true);
    try {
      const stack = [sponsor.id]; const toRemove: string[] = [];
      while (stack.length) {
        const p = stack.pop()!;
        const { data } = await supabase.storage.from(SPONSORSHIP_BUCKET).list(p, { limit: 1000 });
        for (const e of (data || [])) {
          const full = `${p}/${e.name}`;
          if ((e as { id: string | null }).id === null) stack.push(full); else toRemove.push(full);
        }
      }
      if (toRemove.length) await supabase.storage.from(SPONSORSHIP_BUCKET).remove(toRemove);
    } catch { /* best-effort storage cleanup */ }
    const { error } = await supabase.from('sp_sponsor').delete().eq('id', sponsor.id);
    setBusy(false);
    if (error) { toast({ title: 'Could not remove sponsor', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Sponsor removed' });
    navigate(basePath);
  };

  if (loading) return <div className="flex items-center justify-center h-[50vh]"><RefreshCw className="h-8 w-8 animate-spin text-primary" /></div>;
  if (!sponsor) return <div className="max-w-3xl mx-auto py-16 text-center text-gray-500">Sponsor not found. <Link to={basePath} className="text-primary underline">Back</Link></div>;

  const pct = deliveredPct(items);
  const grouped = PROGRAM_ORDER.map(prog => {
    const progItems = items.filter(i => i.program === prog);
    const sections = Array.from(new Set(progItems.map(i => i.section || ''))).map(sec => ({
      section: sec, rows: progItems.filter(i => (i.section || '') === sec),
    }));
    return { program: prog, count: progItems.length, sections };
  }).filter(g => g.count > 0);

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <Link to={basePath} className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-primary"><ArrowLeft className="h-4 w-4" /> All sponsors</Link>

      {/* Sponsor header */}
      <Card key={`${sponsor.id}-${formKey}`}>
        <CardContent className="pt-6 space-y-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-11 w-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0"><Award className="h-5 w-5" /></div>
              <div className="min-w-0">
                <div className="font-bold text-gray-900 text-lg truncate">{sponsor.company_name}</div>
                {agreement?.tier_key && <div className="text-xs text-gray-500">{tiers.find(t => t.tier_key === agreement.tier_key)?.label}</div>}
              </div>
            </div>
            <Select value={sponsor.status} onValueChange={v => saveSponsor({ status: v as SpSponsorStatus })}>
              <SelectTrigger className="w-32 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>{(['active', 'pending', 'expired'] as SpSponsorStatus[]).map(s => <SelectItem key={s} value={s}><Badge className={`text-[11px] ${SPONSOR_STATUS_CLS[s]}`}>{s}</Badge></SelectItem>)}</SelectContent>
            </Select>
          </div>
          {items.length > 0 && (
            <div>
              <div className="flex items-center justify-between text-xs mb-1"><span className="text-gray-500">Fulfilment</span><span className="font-medium text-gray-700">{items.filter(i => i.delivered).length}/{items.length} delivered · {pct}%</span></div>
              <div className="h-2 rounded-full bg-gray-100 overflow-hidden"><div className={`h-full rounded-full ${pct === 100 ? 'bg-green-500' : 'bg-primary'}`} style={{ width: `${pct}%` }} /></div>
            </div>
          )}
          <div className="grid sm:grid-cols-2 gap-2">
            <Input defaultValue={sponsor.primary_contact_name || ''} placeholder="Contact name" onBlur={e => e.target.value !== (sponsor.primary_contact_name || '') && saveSponsor({ primary_contact_name: e.target.value || null })} className="h-9" />
            <Input defaultValue={sponsor.primary_contact_email || ''} placeholder="Contact email" onBlur={e => e.target.value !== (sponsor.primary_contact_email || '') && saveSponsor({ primary_contact_email: e.target.value || null })} className="h-9" />
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-500 flex-wrap">
            <UserPlus className="h-3.5 w-3.5" />
            <span>{users.length} account{users.length === 1 ? '' : 's'} with portal access</span>
            <Input value={linkEmail} onChange={e => setLinkEmail(e.target.value)} placeholder="contact email…" className="h-8 text-xs w-48" />
            <Button size="sm" variant="outline" className="h-8 text-xs" disabled={busy || !linkEmail.trim()} onClick={linkUser} title="Link an existing account — no email sent">Link existing</Button>
            <Button size="sm" className="h-8 text-xs" disabled={busy || !linkEmail.trim()} onClick={inviteUser} title="Create their account and email a set-password link">Invite</Button>
          </div>
        </CardContent>
      </Card>

      {/* Agreement */}
      {!agreement ? (
        <Card><CardContent className="py-8 text-center space-y-3">
          <p className="text-gray-600">No agreement yet. Build one from a tier template — you can edit every line afterwards.</p>
          <div className="flex items-center justify-center gap-2">
            <Select value={buildTier} onValueChange={setBuildTier}>
              <SelectTrigger className="w-52"><SelectValue placeholder="Choose a tier…" /></SelectTrigger>
              <SelectContent>{tiers.map(t => <SelectItem key={t.tier_key} value={t.tier_key}>{t.label} — {formatMoney(t.list_fee_cents)}</SelectItem>)}</SelectContent>
            </Select>
            <Button className="gap-1.5" disabled={!buildTier || busy} onClick={build}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Build agreement</Button>
          </div>
        </CardContent></Card>
      ) : (
        <Card key={`${agreement.id}-${formKey}`}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <CardTitle className="text-base">Agreement</CardTitle>
              <div className="flex items-center gap-2">
                <Badge className={`text-[11px] ${AGREEMENT_STATUS_CLS[agreement.status]}`}>{agreement.status}</Badge>
                <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" disabled={busy} onClick={renew}><RotateCcw className="h-3.5 w-3.5" /> Renew</Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="grid sm:grid-cols-2 gap-3">
            <label className="text-xs text-gray-500">Tier
              <Select value={agreement.tier_key || ''} onValueChange={v => saveAgreement({ tier_key: v })}>
                <SelectTrigger className="mt-1 h-9"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>{tiers.map(t => <SelectItem key={t.tier_key} value={t.tier_key}>{t.label}</SelectItem>)}</SelectContent>
              </Select>
            </label>
            <label className="text-xs text-gray-500">Status
              <Select value={agreement.status} onValueChange={v => saveAgreement({ status: v as SpAgreementStatus })}>
                <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>{(['draft', 'active', 'expired', 'renewed'] as SpAgreementStatus[]).map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </label>
            {isModerator && (<>
            <label className="text-xs text-gray-500">Negotiated fee (€)
              <Input type="text" defaultValue={centsToEuros(agreement.negotiated_fee_cents)} placeholder={agreement.tier_key ? centsToEuros(tiers.find(t => t.tier_key === agreement.tier_key)?.list_fee_cents) : ''}
                onBlur={e => { const c = eurosToCents(e.target.value); if (c !== agreement.negotiated_fee_cents) saveAgreement({ negotiated_fee_cents: c }); }} className="mt-1 h-9" />
            </label>
            <label className="text-xs text-gray-500">Negotiated renewal fee (€)
              <Input type="text" defaultValue={centsToEuros(agreement.negotiated_renewal_fee_cents)}
                onBlur={e => { const c = eurosToCents(e.target.value); if (c !== agreement.negotiated_renewal_fee_cents) saveAgreement({ negotiated_renewal_fee_cents: c }); }} className="mt-1 h-9" />
            </label>
            </>)}
            <label className="text-xs text-gray-500">Term start
              <Input type="date" defaultValue={agreement.term_start || ''} onBlur={e => { const v = e.target.value || null; if (v !== agreement.term_start) saveAgreement({ term_start: v }); }} className="mt-1 h-9" />
            </label>
            <label className="text-xs text-gray-500">Term end
              <Input type="date" defaultValue={agreement.term_end || ''} onBlur={e => { const v = e.target.value || null; if (v !== agreement.term_end) saveAgreement({ term_end: v }); }} className="mt-1 h-9" />
            </label>
            <label className="text-xs text-gray-500">Renewal date
              <Input type="date" defaultValue={agreement.renewal_date || ''} onBlur={e => { const v = e.target.value || null; if (v !== agreement.renewal_date) saveAgreement({ renewal_date: v }); }} className="mt-1 h-9" />
            </label>
            {isModerator && <div className="text-xs text-gray-400 flex items-end pb-2">Tier list fee: {formatMoney(tiers.find(t => t.tier_key === agreement.tier_key)?.list_fee_cents)}</div>}
          </CardContent>
        </Card>
      )}

      {/* Line items grouped by program → section */}
      {agreement && (
        <>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700">Entitlements &amp; deliverables</h2>
            <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => setAddOpen(true)}><Plus className="h-3.5 w-3.5" /> Add custom line</Button>
          </div>
          {grouped.map(g => (
            <Card key={g.program}>
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2">{PROGRAM_LABELS[g.program]}<span className="text-xs font-normal text-gray-400">{g.count}</span></CardTitle></CardHeader>
              <CardContent className="space-y-4">
                {g.sections.map(sec => (
                  <div key={sec.section} className="space-y-2">
                    {sec.section && <div className="text-[11px] uppercase tracking-wide text-gray-400">{sec.section}</div>}
                    {sec.rows.map(i => (
                      <div key={i.id} className="rounded-lg border border-gray-100 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-gray-900 flex items-center gap-2 flex-wrap">
                              {i.name}
                              {i.is_custom && <Badge variant="secondary" className="text-[10px]">custom</Badge>}
                              {i.draws_from_brand_asset && <Badge variant="secondary" className="text-[10px]">from brand assets</Badge>}
                              {isWysPending(i) && <Badge className="text-[10px] bg-amber-50 text-amber-700 border-amber-200">pending — event not scheduled</Badge>}
                            </div>
                            <div className="text-xs text-gray-500 mt-0.5">{formatBenefitValue(i)}{i.fulfilment_type === 'SPONSOR_PROVIDES_ASSET' ? ' · sponsor provides asset' : ''}</div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button onClick={() => setStatus(i, i.delivered ? 'TODO' : 'DELIVERED')} title={i.delivered ? 'Mark not delivered' : 'Mark delivered'}
                              className={`h-7 w-7 rounded-full flex items-center justify-center border-2 transition-colors ${i.delivered ? 'bg-green-500 border-green-500 text-white' : 'border-gray-200 text-transparent hover:border-green-300'}`}>
                              <Check className="h-4 w-4" />
                            </button>
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-gray-400" onClick={() => setEditItem(i)} title="Edit value"><Pencil className="h-3.5 w-3.5" /></Button>
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-gray-300 hover:text-red-600" onClick={() => removeItem(i)} title="Remove"><Trash2 className="h-3.5 w-3.5" /></Button>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                          <Select value={i.status} onValueChange={v => setStatus(i, v as SpAgreementBenefit['status'])}>
                            <SelectTrigger className="h-7 w-48 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>{FULFILMENT_STATUSES.map(s => <SelectItem key={s} value={s}><Badge className={`text-[10px] ${FULFILMENT_STATUS_META[s].cls}`}>{FULFILMENT_STATUS_META[s].label}</Badge></SelectItem>)}</SelectContent>
                          </Select>
                          {i.fulfilment_type === 'SPONSOR_PROVIDES_ASSET' && i.status !== 'REQUESTED_FROM_SPONSOR' && !i.delivered && (
                            <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={() => setStatus(i, 'REQUESTED_FROM_SPONSOR')}><Send className="h-3 w-3" /> Request from sponsor</Button>
                          )}
                        </div>
                        {(i.fulfilment_type === 'SPONSOR_PROVIDES_ASSET' || i.requires_file) && (
                          <div className="mt-2 pt-2 border-t border-gray-50">
                            <DeliverableFiles sponsorId={sponsor.id} benefitId={i.id} isManager canUpload onChanged={() => load({ silent: true })} />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </>
      )}

      <SponsorBrandAssets sponsorId={sponsor.id} canEdit />

      {/* Danger zone */}
      <div className="pt-2 flex justify-end">
        <Button variant="ghost" className="text-red-600 hover:text-red-700 hover:bg-red-50 gap-1.5" disabled={busy} onClick={removeSponsor}>
          <Trash2 className="h-4 w-4" /> Remove sponsor
        </Button>
      </div>

      {editItem && <EditValueDialog item={editItem} onClose={() => setEditItem(null)} onSave={patch => { patchItem(editItem.id, patch); setEditItem(null); }} />}
      {addOpen && agreement && <AddCustomDialog agreementId={agreement.id} nextOrder={(items[items.length - 1]?.display_order || 0) + 1} onClose={() => setAddOpen(false)} onAdded={() => { setAddOpen(false); load(); }} />}
    </div>
  );
}

// ── Edit a line item's negotiated value ─────────────────────────────────────
function EditValueDialog({ item, onClose, onSave }: { item: SpAgreementBenefit; onClose: () => void; onSave: (p: Partial<SpAgreementBenefit>) => void }) {
  const [qty, setQty] = useState(item.value_qty != null ? String(item.value_qty) : '');
  const [qualifier, setQualifier] = useState(item.value_qualifier || '');
  const [text, setText] = useState(item.value_text || '');
  const [level, setLevel] = useState(item.value_level || '');
  const [bool, setBool] = useState(!!item.value_bool);

  const save = () => {
    if (item.value_type === 'BOOLEAN') return onSave({ value_bool: bool });
    if (item.value_type === 'LEVEL') return onSave({ value_level: level || null });
    onSave({ value_qty: qty ? parseInt(qty, 10) : null, value_qualifier: qualifier || null, value_text: text || null });
  };
  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogTitle className="text-base">{item.name}</DialogTitle>
        <div className="space-y-2 pt-2">
          {item.value_type === 'BOOLEAN' && (
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={bool} onChange={e => setBool(e.target.checked)} /> Included</label>
          )}
          {item.value_type === 'QUANTITY' && (<>
            <div className="grid grid-cols-2 gap-2">
              <Input value={qty} onChange={e => setQty(e.target.value)} placeholder="Quantity" inputMode="numeric" />
              <Input value={qualifier} onChange={e => setQualifier(e.target.value)} placeholder="Qualifier (optional)" />
            </div>
            <Input value={text} onChange={e => setText(e.target.value)} placeholder="…or free text (e.g. All key events)" />
            <p className="text-[11px] text-gray-400">Free text overrides the quantity when set.</p>
          </>)}
          {item.value_type === 'LEVEL' && (
            <Input value={level} onChange={e => setLevel(e.target.value)} placeholder="Level (e.g. Keynote speaker)" />
          )}
          <div className="flex justify-end gap-2 pt-1"><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save}>Save</Button></div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Add a custom (off-catalog) line item ────────────────────────────────────
function AddCustomDialog({ agreementId, nextOrder, onClose, onAdded }: { agreementId: string; nextOrder: number; onClose: () => void; onAdded: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [program, setProgram] = useState<SpProgram>('SMART_MARINA_EVENT');
  const [valueType, setValueType] = useState<SpValueType>('BOOLEAN');
  const [sponsorAsset, setSponsorAsset] = useState(false);
  const [saving, setSaving] = useState(false);

  const add = async () => {
    if (!name.trim()) { toast({ title: 'Name is required', variant: 'destructive' }); return; }
    setSaving(true);
    const { error } = await supabase.from('sp_agreement_benefit').insert({
      agreement_id: agreementId, is_custom: true, name: name.trim(), description: description.trim() || null,
      program, section: 'Custom', value_type: valueType,
      fulfilment_type: sponsorAsset ? 'SPONSOR_PROVIDES_ASSET' : 'M3_DELIVERS',
      requires_file: sponsorAsset, value_bool: valueType === 'BOOLEAN' ? true : null,
      status: 'TODO', display_order: nextOrder,
    });
    setSaving(false);
    if (error) { toast({ title: 'Could not add', description: error.message, variant: 'destructive' }); return; }
    onAdded();
  };
  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogTitle className="text-base">Add custom line</DialogTitle>
        <div className="space-y-2 pt-2">
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="Benefit name *" />
          <Textarea rows={2} value={description} onChange={e => setDescription(e.target.value)} placeholder="Description (optional)" />
          <div className="grid grid-cols-2 gap-2">
            <Select value={program} onValueChange={v => setProgram(v as SpProgram)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{PROGRAM_ORDER.map(p => <SelectItem key={p} value={p}>{PROGRAM_LABELS[p]}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={valueType} onValueChange={v => setValueType(v as SpValueType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="BOOLEAN">Included (yes/no)</SelectItem><SelectItem value="QUANTITY">Quantity</SelectItem><SelectItem value="LEVEL">Level</SelectItem></SelectContent>
            </Select>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-600"><input type="checkbox" checked={sponsorAsset} onChange={e => setSponsorAsset(e.target.checked)} /> Sponsor provides an asset (upload / link)</label>
          <div className="flex justify-end gap-2 pt-1"><Button variant="outline" onClick={onClose}>Cancel</Button><Button className="gap-1.5" disabled={saving} onClick={add}>{saving && <Loader2 className="h-4 w-4 animate-spin" />} Add</Button></div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
