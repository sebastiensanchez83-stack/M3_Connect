import { useState, useEffect } from 'react';
import { RefreshCw, Check, Award, AlertCircle, Clock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/lib/supabase';
import {
  SpSponsor, SpAgreement, SpAgreementBenefit, SpTier,
  PROGRAM_LABELS, PROGRAM_ORDER, FULFILMENT_STATUS_META,
  formatMoney, formatBenefitValue, isWysPending, deliveredPct,
} from '@/lib/sponsorship';
import { SponsorBrandAssets } from './SponsorBrandAssets';
import { DeliverableFiles } from './DeliverableFiles';

// Sponsor-facing portal: their agreement read-only, live delivery ticks (no
// emails), upload/link slots for items that need their asset, and a clear view
// of what's been requested / is still missing.

export function SponsorPortal({ sponsorIds }: { sponsorIds: string[] }) {
  const [sponsor, setSponsor] = useState<SpSponsor | null>(null);
  const [sponsors, setSponsors] = useState<SpSponsor[]>([]);
  const [agreement, setAgreement] = useState<SpAgreement | null>(null);
  const [items, setItems] = useState<SpAgreementBenefit[]>([]);
  const [tier, setTier] = useState<SpTier | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: sps } = await supabase.from('sp_sponsor').select('*').in('id', sponsorIds);
      const list = (sps || []) as SpSponsor[];
      setSponsors(list);
      if (list[0]) setSponsor(list[0]);
      setLoading(false);
    })();
  }, [sponsorIds]);

  useEffect(() => {
    if (!sponsor) return;
    let ignore = false;
    // Clear the previous sponsor's data immediately so a slow load can't render
    // it under the newly selected sponsor's name.
    setAgreement(null); setItems([]); setTier(null);
    (async () => {
      const { data: agrs } = await supabase.from('sp_agreement').select('*').eq('sponsor_id', sponsor.id).order('created_at', { ascending: false });
      if (ignore) return;
      const cur = ((agrs || []) as SpAgreement[]).find(a => a.status === 'active') || ((agrs || []) as SpAgreement[]).find(a => a.status !== 'renewed') || null;
      setAgreement(cur);
      if (cur) {
        const [{ data: bens }, { data: t }] = await Promise.all([
          supabase.from('sp_agreement_benefit').select('*').eq('agreement_id', cur.id).order('display_order'),
          cur.tier_key ? supabase.from('sp_tier').select('*').eq('tier_key', cur.tier_key).maybeSingle() : Promise.resolve({ data: null }),
        ]);
        if (ignore) return;
        setItems((bens || []) as SpAgreementBenefit[]);
        setTier(t as SpTier | null);
      }
    })();
    return () => { ignore = true; };
  }, [sponsor]);

  const reload = async () => {
    if (!agreement) return;
    const { data: bens } = await supabase.from('sp_agreement_benefit').select('*').eq('agreement_id', agreement.id).order('display_order');
    setItems((bens || []) as SpAgreementBenefit[]);
  };

  if (loading) return <div className="flex items-center justify-center h-[50vh]"><RefreshCw className="h-8 w-8 animate-spin text-primary" /></div>;
  if (!sponsor) return <div className="max-w-2xl mx-auto py-16 text-center text-gray-500">No sponsorship linked to your account yet.</div>;

  const pct = deliveredPct(items);
  const needed = items.filter(i => i.fulfilment_type === 'SPONSOR_PROVIDES_ASSET' && !i.delivered);
  const grouped = PROGRAM_ORDER.map(prog => ({ program: prog, rows: items.filter(i => i.program === prog) })).filter(g => g.rows.length > 0);

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Award className="h-6 w-6 text-primary" /> {sponsor.company_name}</h1>
        <p className="text-sm text-gray-500 mt-0.5">Your sponsorship benefits and their delivery status.</p>
      </div>

      {sponsors.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {sponsors.map(s => (
            <button key={s.id} onClick={() => setSponsor(s)} className={`px-3 py-1.5 rounded-lg border text-sm ${s.id === sponsor.id ? 'border-primary bg-primary/5 text-primary font-medium' : 'border-gray-200 text-gray-600'}`}>{s.company_name}</button>
          ))}
        </div>
      )}

      {agreement && (
        <Card>
          <CardContent className="pt-6 space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <div className="text-sm text-gray-500">{tier?.label || 'Sponsorship'}</div>
                <div className="text-lg font-bold text-gray-900">{formatMoney(agreement.negotiated_fee_cents ?? tier?.list_fee_cents, agreement.currency)}<span className="text-xs font-normal text-gray-400"> / term</span></div>
              </div>
              {(agreement.term_start || agreement.term_end) && (
                <div className="text-xs text-gray-500 text-right">{agreement.term_start || '—'} → {agreement.term_end || '—'}</div>
              )}
            </div>
            {items.length > 0 && (
              <div>
                <div className="flex items-center justify-between text-xs mb-1"><span className="text-gray-500">Delivered</span><span className="font-medium text-gray-700">{items.filter(i => i.delivered).length}/{items.length} · {pct}%</span></div>
                <div className="h-2 rounded-full bg-gray-100 overflow-hidden"><div className={`h-full rounded-full ${pct === 100 ? 'bg-green-500' : 'bg-primary'}`} style={{ width: `${pct}%` }} /></div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {needed.length > 0 && (
        <Card className="border-amber-200">
          <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2 text-amber-800"><AlertCircle className="h-4 w-4" /> We need from you</CardTitle>
            <CardDescription>Upload a file or paste a link for each item below.</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            {needed.map(i => (
              <div key={i.id} className="rounded-lg border border-amber-100 bg-amber-50/40 p-3">
                <div className="text-sm font-medium text-gray-900 flex items-center gap-2 flex-wrap">
                  {i.name}
                  {i.status === 'REQUESTED_FROM_SPONSOR' && <Badge className="text-[10px] bg-amber-100 text-amber-800 border-amber-200"><Clock className="h-3 w-3 mr-1" /> Requested</Badge>}
                </div>
                <div className="mt-2"><DeliverableFiles sponsorId={sponsor.id} benefitId={i.id} isManager={false} canUpload onChanged={reload} /></div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {grouped.map(g => (
        <Card key={g.program}>
          <CardHeader className="pb-2"><CardTitle className="text-sm">{PROGRAM_LABELS[g.program]}</CardTitle></CardHeader>
          <CardContent className="space-y-1.5">
            {g.rows.map(i => (
              <div key={i.id} className="flex items-center justify-between gap-3 py-1.5 border-b border-gray-50 last:border-0">
                <div className="min-w-0">
                  <div className="text-sm text-gray-800 truncate">{i.name}</div>
                  <div className="text-xs text-gray-400">{formatBenefitValue(i)}</div>
                </div>
                <div className="shrink-0">
                  {isWysPending(i) ? <span className="text-[11px] text-amber-600">pending — event not scheduled</span>
                    : i.delivered ? <span className="inline-flex items-center gap-1 text-xs font-medium text-green-600"><Check className="h-4 w-4" /> Delivered</span>
                    : <Badge className={`text-[10px] ${FULFILMENT_STATUS_META[i.status].cls}`}>{FULFILMENT_STATUS_META[i.status].label}</Badge>}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}

      <SponsorBrandAssets sponsorId={sponsor.id} canEdit />
    </div>
  );
}
