import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  RefreshCw, Check, Loader2, Plus, Trash2, Pencil, Send, RotateCcw,
  UserPlus, Award, FileDown, Building2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CardShell } from '@/components/brand/CardShell';
import { BTN, BTN_OUTLINE, FOCUS, MemberEmpty, MemberPanel, RowSkeleton, StatusPill } from '@/components/member/MemberUI';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import {
  SpSponsor, SpAgreement, SpAgreementBenefit, SpTier, SpProgram, SpValueType,
  PROGRAM_ORDER, FULFILMENT_STATUSES,
  SpSponsorStatus, SpAgreementStatus,
  formatMoney, formatBenefitValue, isWysPending, deliveredPct, SPONSORSHIP_BUCKET,
} from '@/lib/sponsorship';
import { SponsorBrandAssets } from './SponsorBrandAssets';
import { DeliverableFiles } from './DeliverableFiles';
import {
  AgreementStatusPill, FIELD, FIELD_LABEL, FulfilmentPill, ICON_BTN, PROGRAM_NAMES,
  ProgressBar, SponsorStatusPill, SponsorshipFrame,
} from './sponsorshipUi';
import { cn } from '@/lib/utils';

const eurosToCents = (s: string): number | null => {
  const n = parseFloat(s.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};
const centsToEuros = (c: number | null | undefined) => (c == null ? '' : String(c / 100));

// `band` puts the marine band on top (the /sponsorship page); the admin workspace
// (/admin/sponsorships) brings its own shell and gets a plain heading.
export function SponsorAgreementDetail({ basePath, band = false }: { basePath: string; band?: boolean }) {
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
  const [reportBusy, setReportBusy] = useState(false);
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

  // The renewal report: what they were promised, what has been delivered, and
  // what the audience was. Built from sm_sponsor_report so the document and the
  // fulfilment tracker below can never disagree — and downloaded, not sent,
  // because the figures that close a renewal are not all in here.
  const buildSponsorReport = async () => {
    if (!sponsor) return;
    setReportBusy(true);
    try {
      const { data: ev } = await supabase.from('sm_event').select('id, name').eq('slug', 'sm26').maybeSingle();
      const eid = (ev as { id: string } | null)?.id;
      if (!eid) throw new Error('Event not found');
      const { data, error } = await supabase.rpc('sm_sponsor_report', { p_sponsor_id: sponsor.id, p_event_id: eid });
      if (error) throw error;
      const rows = (data || []) as { kind: string; section: string; label: string; detail: string | null; state: string; sort_order: number }[];

      const { downloadFeedbackReportPdf } = await import('@/lib/feedbackReportPdf');
      const { toDataUrl } = await import('@/lib/programmePdf');
      const { BUNDLED_ASSETS } = await import('@/lib/invitationTemplates');
      const [banner, footer] = await Promise.all([
        toDataUrl(BUNDLED_ASSETS.banner), toDataUrl(BUNDLED_ASSETS.footer),
      ]);

      const blocks: import('@/lib/feedbackReportPdf').ReportBlock[] = [];
      const audience = rows.filter(r => r.kind === 'audience');
      for (const sec of Array.from(new Set(audience.map(a => a.section)))) {
        blocks.push({
          kind: 'stats', heading: sec,
          items: audience.filter(a => a.section === sec)
            .sort((a, b) => a.sort_order - b.sort_order)
            .map(a => ({ label: a.label, value: a.state })),
        });
      }
      const benefits = rows.filter(r => r.kind === 'benefit');
      const done = benefits.filter(b => /deliver/i.test(b.state)).length;
      for (const sec of Array.from(new Set(benefits.map(b => b.section)))) {
        const inSec = benefits.filter(b => b.section === sec).sort((a, b) => a.sort_order - b.sort_order);
        blocks.push({
          kind: 'checklist', heading: sec,
          note: `${inSec.filter(b => /deliver/i.test(b.state)).length} of ${inSec.length} delivered.`,
          items: inSec.map(b => ({ label: b.label, detail: b.detail, state: b.state })),
        });
      }
      blocks.push({
        kind: 'placeholder', heading: 'To complete before sending',
        note: 'Press coverage, social reach, and anything else measured outside the platform.',
        lines: 6,
      });

      await downloadFeedbackReportPdf(blocks, {
        title: sponsor.company_name,
        subtitle: 'Monaco Smart & Sustainable Marina Rendezvous 2026 · Partnership report',
        note: `${done} of ${benefits.length} commitments delivered at the time of writing. This document is a draft for internal completion — it is not sent automatically.`,
      }, { banner, footer }, `${sponsor.company_name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-partnership-report.pdf`);
    } catch (e) {
      toast({ title: 'Could not build the report', description: (e as Error).message, variant: 'destructive' });
    }
    setReportBusy(false);
  };

  const backTo = { to: basePath, label: 'All sponsors' };

  if (loading) {
    return (
      <SponsorshipFrame band={band} icon={Award} eyebrow="Sponsor" title="Sponsor" back={backTo}>
        <CardShell><RowSkeleton rows={3} /></CardShell>
      </SponsorshipFrame>
    );
  }
  if (!sponsor) {
    return (
      <SponsorshipFrame band={band} icon={Award} eyebrow="Sponsor" title="Sponsor" back={backTo} narrow>
        <CardShell>
          <MemberEmpty icon={Building2} title="Sponsor not found" body="It may have been removed, or the link is out of date." />
        </CardShell>
      </SponsorshipFrame>
    );
  }

  const pct = deliveredPct(items);
  const doneCount = items.filter(i => i.delivered).length;
  const tierLabel = agreement?.tier_key ? tiers.find(t => t.tier_key === agreement.tier_key)?.label : undefined;
  const grouped = PROGRAM_ORDER.map(prog => {
    const progItems = items.filter(i => i.program === prog);
    const sections = Array.from(new Set(progItems.map(i => i.section || ''))).map(sec => ({
      section: sec, rows: progItems.filter(i => (i.section || '') === sec),
    }));
    return { program: prog, count: progItems.length, sections };
  }).filter(g => g.count > 0);

  /* ── Sponsor: status, renewal report, contact, portal access ── */
  const sponsorPanel = (
    <MemberPanel key={`${sponsor.id}-${formKey}`} title="Sponsor">
      <div className="space-y-5 p-5">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[9rem] flex-1 space-y-1.5">
            <Label htmlFor="sp-status" className={FIELD_LABEL}>Status</Label>
            <Select value={sponsor.status} onValueChange={v => saveSponsor({ status: v as SpSponsorStatus })}>
              <SelectTrigger id="sp-status" className={FIELD}><SelectValue /></SelectTrigger>
              <SelectContent>{(['active', 'pending', 'expired'] as SpSponsorStatus[]).map(s => <SelectItem key={s} value={s}><SponsorStatusPill status={s} /></SelectItem>)}</SelectContent>
            </Select>
          </div>
          {/* Downloaded, never sent. The document is deliberately incomplete
              — press coverage, social reach, anything measured outside this
              platform — so it goes to Victor to finish, not to the sponsor. */}
          <Button variant="outline" className={cn(BTN_OUTLINE, 'gap-1.5')} disabled={reportBusy} onClick={buildSponsorReport}>
            {reportBusy ? <RefreshCw className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <FileDown className="h-4 w-4" aria-hidden="true" />}
            Renewal report
          </Button>
        </div>

        {items.length > 0 && (
          <div>
            <div className="mb-1.5 flex items-center justify-between text-[13px] leading-5">
              <span className="text-meta">Fulfilment</span>
              <span className="font-semibold tabular-nums text-navy">{doneCount} of {items.length} delivered · {pct}%</span>
            </div>
            <ProgressBar pct={pct} label={`${doneCount} of ${items.length} delivered`} />
          </div>
        )}

        <div className={cn('grid gap-3', !band && 'sm:grid-cols-2')}>
          <div className="space-y-1.5">
            <Label htmlFor="sp-contact-name" className={FIELD_LABEL}>Contact name</Label>
            <Input id="sp-contact-name" defaultValue={sponsor.primary_contact_name || ''} onBlur={e => e.target.value !== (sponsor.primary_contact_name || '') && saveSponsor({ primary_contact_name: e.target.value || null })} className={FIELD} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sp-contact-email" className={FIELD_LABEL}>Contact email</Label>
            <Input id="sp-contact-email" defaultValue={sponsor.primary_contact_email || ''} onBlur={e => e.target.value !== (sponsor.primary_contact_email || '') && saveSponsor({ primary_contact_email: e.target.value || null })} className={FIELD} />
          </div>
        </div>

        <div className="space-y-2.5 border-t border-rule pt-5">
          <p className="flex items-center gap-2 text-[14px] leading-5 text-ink">
            <UserPlus className="h-4 w-4 shrink-0 text-meta" aria-hidden="true" />
            <span>{users.length} account{users.length === 1 ? '' : 's'} with portal access</span>
          </p>
          <Label htmlFor="sp-link-email" className={FIELD_LABEL}>Contact email to link or invite</Label>
          <Input id="sp-link-email" value={linkEmail} onChange={e => setLinkEmail(e.target.value)} placeholder="name@company.com" className={FIELD} />
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className={BTN_OUTLINE} disabled={busy || !linkEmail.trim()} onClick={linkUser} title="Link an existing account — no email sent">Link existing</Button>
            <Button className={BTN} disabled={busy || !linkEmail.trim()} onClick={inviteUser} title="Create their account and email a set-password link">Invite</Button>
          </div>
        </div>
      </div>
    </MemberPanel>
  );

  /* ── Agreement ── */
  const agreementPanel = !agreement ? (
    <CardShell>
      <MemberEmpty
        icon={Award}
        title="No agreement yet"
        body="Build one from a tier template. You can edit every line afterwards."
        action={(
          <div className="flex w-full max-w-md flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-center">
            <Select value={buildTier} onValueChange={setBuildTier}>
              <SelectTrigger className={cn(FIELD, 'sm:w-60')} aria-label="Tier"><SelectValue placeholder="Choose a tier…" /></SelectTrigger>
              <SelectContent>{tiers.map(t => <SelectItem key={t.tier_key} value={t.tier_key}>{t.label} — {formatMoney(t.list_fee_cents)}</SelectItem>)}</SelectContent>
            </Select>
            <Button className={cn(BTN, 'gap-1.5')} disabled={!buildTier || busy} onClick={build}>{busy && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />} Build agreement</Button>
          </div>
        )}
      />
    </CardShell>
  ) : (
    <MemberPanel
      key={`${agreement.id}-${formKey}`}
      title="Agreement"
      actions={(
        <div className="flex items-center gap-2">
          <AgreementStatusPill status={agreement.status} />
          <Button variant="outline" className={cn(BTN_OUTLINE, 'gap-1.5')} disabled={busy} onClick={renew}><RotateCcw className="h-4 w-4" aria-hidden="true" /> Renew</Button>
        </div>
      )}
    >
      <div className="grid gap-4 p-5 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="sp-ag-tier" className={FIELD_LABEL}>Tier</Label>
          <Select value={agreement.tier_key || ''} onValueChange={v => saveAgreement({ tier_key: v })}>
            <SelectTrigger id="sp-ag-tier" className={FIELD}><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>{tiers.map(t => <SelectItem key={t.tier_key} value={t.tier_key}>{t.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sp-ag-status" className={FIELD_LABEL}>Status</Label>
          <Select value={agreement.status} onValueChange={v => saveAgreement({ status: v as SpAgreementStatus })}>
            <SelectTrigger id="sp-ag-status" className={cn(FIELD, 'capitalize')}><SelectValue /></SelectTrigger>
            <SelectContent>{(['draft', 'active', 'expired', 'renewed'] as SpAgreementStatus[]).map(s => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        {isModerator && (<>
          <div className="space-y-1.5">
            <Label htmlFor="sp-ag-fee" className={FIELD_LABEL}>Negotiated fee (€)</Label>
            <Input id="sp-ag-fee" type="text" defaultValue={centsToEuros(agreement.negotiated_fee_cents)} placeholder={agreement.tier_key ? centsToEuros(tiers.find(t => t.tier_key === agreement.tier_key)?.list_fee_cents) : ''}
              onBlur={e => { const c = eurosToCents(e.target.value); if (c !== agreement.negotiated_fee_cents) saveAgreement({ negotiated_fee_cents: c }); }} className={FIELD} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sp-ag-renewal-fee" className={FIELD_LABEL}>Negotiated renewal fee (€)</Label>
            <Input id="sp-ag-renewal-fee" type="text" defaultValue={centsToEuros(agreement.negotiated_renewal_fee_cents)}
              onBlur={e => { const c = eurosToCents(e.target.value); if (c !== agreement.negotiated_renewal_fee_cents) saveAgreement({ negotiated_renewal_fee_cents: c }); }} className={FIELD} />
          </div>
        </>)}
        <div className="space-y-1.5">
          <Label htmlFor="sp-ag-start" className={FIELD_LABEL}>Term start</Label>
          <Input id="sp-ag-start" type="date" defaultValue={agreement.term_start || ''} onBlur={e => { const v = e.target.value || null; if (v !== agreement.term_start) saveAgreement({ term_start: v }); }} className={FIELD} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sp-ag-end" className={FIELD_LABEL}>Term end</Label>
          <Input id="sp-ag-end" type="date" defaultValue={agreement.term_end || ''} onBlur={e => { const v = e.target.value || null; if (v !== agreement.term_end) saveAgreement({ term_end: v }); }} className={FIELD} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sp-ag-renewal" className={FIELD_LABEL}>Renewal date</Label>
          <Input id="sp-ag-renewal" type="date" defaultValue={agreement.renewal_date || ''} onBlur={e => { const v = e.target.value || null; if (v !== agreement.renewal_date) saveAgreement({ renewal_date: v }); }} className={FIELD} />
        </div>
        {isModerator && (
          <div className="space-y-1.5">
            <p className={FIELD_LABEL}>Tier list fee</p>
            <p className="flex h-10 items-center text-[15px] font-medium tabular-nums text-navy">{formatMoney(tiers.find(t => t.tier_key === agreement.tier_key)?.list_fee_cents)}</p>
          </div>
        )}
      </div>
    </MemberPanel>
  );

  /* ── Line items grouped by program → section ── */
  const entitlements = agreement && (
    <section aria-labelledby="sp-entitlements" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="sp-entitlements" className="text-h3 text-navy">Entitlements &amp; deliverables</h2>
        <Button variant="outline" className={cn(BTN_OUTLINE, 'gap-1.5')} onClick={() => setAddOpen(true)}><Plus className="h-4 w-4" aria-hidden="true" /> Add custom line</Button>
      </div>
      {grouped.map(g => (
        <MemberPanel key={g.program} title={PROGRAM_NAMES[g.program]} count={g.count}>
          {g.sections.map(sec => (
            <div key={sec.section} className="border-b border-rule last:border-b-0">
              {sec.section && <h3 className="border-b border-rule bg-page px-5 py-2 text-[12px] font-semibold uppercase leading-4 tracking-[0.08em] text-meta">{sec.section}</h3>}
              <ul className="divide-y divide-rule">
                {sec.rows.map(i => (
                  <li key={i.id} className="space-y-3 p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[15px] font-semibold leading-5 text-navy [overflow-wrap:anywhere]">{i.name}</span>
                          {i.is_custom && <StatusPill tone="neutral">Custom</StatusPill>}
                          {i.draws_from_brand_asset && <StatusPill tone="neutral">From brand assets</StatusPill>}
                          {isWysPending(i) && <StatusPill tone="warning">Pending, event not yet scheduled</StatusPill>}
                        </div>
                        <p className="mt-1 text-[13px] leading-[18px] text-meta">{formatBenefitValue(i)}{i.fulfilment_type === 'SPONSOR_PROVIDES_ASSET' ? ' · sponsor provides asset' : ''}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setStatus(i, i.delivered ? 'TODO' : 'DELIVERED')}
                          title={i.delivered ? 'Mark not delivered' : 'Mark delivered'}
                          aria-label={i.delivered ? `Mark "${i.name}" not delivered` : `Mark "${i.name}" delivered`}
                          aria-pressed={i.delivered}
                          className={cn(
                            'grid h-10 w-10 place-items-center rounded-pill border-2 transition-colors',
                            FOCUS,
                            i.delivered ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-meta/30 text-meta/40 hover:border-emerald-600 hover:text-emerald-600',
                          )}
                        >
                          <Check className="h-5 w-5" aria-hidden="true" />
                        </button>
                        <Button type="button" size="icon" variant="ghost" className={cn(ICON_BTN, 'text-meta hover:bg-chip hover:text-navy')} onClick={() => setEditItem(i)} title="Edit value" aria-label={`Edit the value of "${i.name}"`}><Pencil className="h-4 w-4" aria-hidden="true" /></Button>
                        <Button type="button" size="icon" variant="ghost" className={cn(ICON_BTN, 'text-meta hover:bg-red-50 hover:text-red-700')} onClick={() => removeItem(i)} title="Remove" aria-label={`Remove "${i.name}"`}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Select value={i.status} onValueChange={v => setStatus(i, v as SpAgreementBenefit['status'])}>
                        <SelectTrigger className={cn(FIELD, 'w-full sm:w-64')} aria-label={`Status of "${i.name}"`}><SelectValue /></SelectTrigger>
                        <SelectContent>{FULFILMENT_STATUSES.map(s => <SelectItem key={s} value={s}><FulfilmentPill status={s} /></SelectItem>)}</SelectContent>
                      </Select>
                      {i.fulfilment_type === 'SPONSOR_PROVIDES_ASSET' && i.status !== 'REQUESTED_FROM_SPONSOR' && !i.delivered && (
                        <Button variant="outline" className={cn(BTN_OUTLINE, 'gap-1.5')} onClick={() => setStatus(i, 'REQUESTED_FROM_SPONSOR')}><Send className="h-4 w-4" aria-hidden="true" /> Request from sponsor</Button>
                      )}
                    </div>
                    {(i.fulfilment_type === 'SPONSOR_PROVIDES_ASSET' || i.requires_file) && (
                      <DeliverableFiles sponsorId={sponsor.id} benefitId={i.id} isManager canUpload onChanged={() => load({ silent: true })} />
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </MemberPanel>
      ))}
    </section>
  );

  const dangerZone = (
    <Button variant="ghost" className={cn(BTN, 'gap-1.5 text-red-700 hover:bg-red-50 hover:text-red-800')} disabled={busy} onClick={removeSponsor}>
      <Trash2 className="h-4 w-4" aria-hidden="true" /> Remove sponsor
    </Button>
  );

  return (
    <SponsorshipFrame
      band={band}
      icon={Award}
      eyebrow={tierLabel || 'Sponsor'}
      title={sponsor.company_name}
      back={backTo}
      meta={items.length > 0 ? <span>{doneCount} of {items.length} delivered · {pct}%</span> : undefined}
    >
      <div className={cn('space-y-6', band && 'lg:grid lg:grid-cols-[minmax(0,1fr)_21rem] lg:grid-rows-[auto_auto_1fr] lg:gap-x-8 lg:gap-y-6 lg:space-y-0')}>
        <div className="lg:col-start-2 lg:row-start-1">{sponsorPanel}</div>
        <div className="space-y-6 lg:col-start-1 lg:row-span-3 lg:row-start-1">
          {agreementPanel}
          {entitlements}
        </div>
        <div className="lg:col-start-2 lg:row-start-2"><SponsorBrandAssets sponsorId={sponsor.id} canEdit /></div>
        <div className="flex justify-end lg:col-start-2 lg:row-start-3 lg:items-start">{dangerZone}</div>
      </div>

      {editItem && <EditValueDialog item={editItem} onClose={() => setEditItem(null)} onSave={patch => { patchItem(editItem.id, patch); setEditItem(null); }} />}
      {addOpen && agreement && <AddCustomDialog agreementId={agreement.id} nextOrder={(items[items.length - 1]?.display_order || 0) + 1} onClose={() => setAddOpen(false)} onAdded={() => { setAddOpen(false); load(); }} />}
    </SponsorshipFrame>
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
        <DialogHeader>
          <DialogTitle className="[overflow-wrap:anywhere]">{item.name}</DialogTitle>
          <DialogDescription>Set the value agreed for this line.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {item.value_type === 'BOOLEAN' && (
            <label className="flex min-h-10 cursor-pointer items-center gap-2.5 text-[15px] text-ink"><input type="checkbox" className="h-4 w-4 accent-navy" checked={bool} onChange={e => setBool(e.target.checked)} /> Included</label>
          )}
          {item.value_type === 'QUANTITY' && (<>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="sp-ev-qty" className={FIELD_LABEL}>Quantity</Label>
                <Input id="sp-ev-qty" className={FIELD} value={qty} onChange={e => setQty(e.target.value)} inputMode="numeric" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sp-ev-qual" className={FIELD_LABEL}>Qualifier (optional)</Label>
                <Input id="sp-ev-qual" className={FIELD} value={qualifier} onChange={e => setQualifier(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sp-ev-text" className={FIELD_LABEL}>…or free text</Label>
              <Input id="sp-ev-text" className={FIELD} value={text} onChange={e => setText(e.target.value)} placeholder="e.g. All key events" />
              <p className="text-[13px] leading-5 text-meta">Free text overrides the quantity when set.</p>
            </div>
          </>)}
          {item.value_type === 'LEVEL' && (
            <div className="space-y-1.5">
              <Label htmlFor="sp-ev-level" className={FIELD_LABEL}>Level</Label>
              <Input id="sp-ev-level" className={FIELD} value={level} onChange={e => setLevel(e.target.value)} placeholder="e.g. Keynote speaker" />
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1"><Button variant="outline" className={BTN_OUTLINE} onClick={onClose}>Cancel</Button><Button className={BTN} onClick={save}>Save</Button></div>
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
        <DialogHeader>
          <DialogTitle>Add custom line</DialogTitle>
          <DialogDescription>A benefit that is not in the tier template.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="sp-cl-name" className={FIELD_LABEL}>Benefit name *</Label>
            <Input id="sp-cl-name" className={FIELD} value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sp-cl-desc" className={FIELD_LABEL}>Description (optional)</Label>
            <Textarea id="sp-cl-desc" className={FIELD} rows={2} value={description} onChange={e => setDescription(e.target.value)} />
          </div>
          <div className="grid gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="sp-cl-program" className={FIELD_LABEL}>Programme</Label>
              <Select value={program} onValueChange={v => setProgram(v as SpProgram)}>
                <SelectTrigger id="sp-cl-program" className={FIELD}><SelectValue /></SelectTrigger>
                <SelectContent>{PROGRAM_ORDER.map(p => <SelectItem key={p} value={p}>{PROGRAM_NAMES[p]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sp-cl-type" className={FIELD_LABEL}>Value</Label>
              <Select value={valueType} onValueChange={v => setValueType(v as SpValueType)}>
                <SelectTrigger id="sp-cl-type" className={FIELD}><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="BOOLEAN">Included (yes/no)</SelectItem><SelectItem value="QUANTITY">Quantity</SelectItem><SelectItem value="LEVEL">Level</SelectItem></SelectContent>
              </Select>
            </div>
          </div>
          <label className="flex min-h-10 cursor-pointer items-center gap-2.5 text-[15px] text-ink"><input type="checkbox" className="h-4 w-4 accent-navy" checked={sponsorAsset} onChange={e => setSponsorAsset(e.target.checked)} /> Sponsor provides an asset (upload / link)</label>
          <div className="flex justify-end gap-2 pt-1"><Button variant="outline" className={BTN_OUTLINE} onClick={onClose}>Cancel</Button><Button className={cn(BTN, 'gap-1.5')} disabled={saving} onClick={add}>{saving && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />} Add</Button></div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
