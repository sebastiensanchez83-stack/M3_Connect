import { useState, useEffect } from 'react';
import { Check, Award, Clock } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import {
  SpSponsor, SpAgreement, SpAgreementBenefit, SpTier,
  PROGRAM_ORDER,
  formatMoney, formatBenefitValue, isWysPending, deliveredPct,
} from '@/lib/sponsorship';
import { CardShell } from '@/components/brand/CardShell';
import { Eyebrow } from '@/components/brand/Eyebrow';
import { UnderlineLink } from '@/components/brand/UnderlineLink';
import { FOCUS, MemberEmpty, MemberPanel, RowSkeleton, StatusPill } from '@/components/member/MemberUI';
import { SponsorBrandAssets } from './SponsorBrandAssets';
import { DeliverableFiles } from './DeliverableFiles';
import { FulfilmentPill, PROGRAM_NAMES, ProgressBar, SponsorshipFrame, fmtDate } from './sponsorshipUi';
import { cn } from '@/lib/utils';

// Sponsor-facing portal: their agreement read-only, live delivery ticks (no
// emails), upload/link slots for items that need their asset, and a clear view
// of what's been requested / is still missing.
//
// Two homes: the /sponsorship page (`band`: marine band on top, agreement beside
// the work on wide screens) and the "Sponsorship" tab of the account area, which
// already has its own page header (no band, one column).

export function SponsorPortal({ sponsorIds, band = false }: { sponsorIds: string[]; band?: boolean }) {
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

  // Before there is a company to name: in the account tab the page header is already there.
  const plain = (children: React.ReactNode) => band
    ? <SponsorshipFrame band icon={Award} eyebrow="Sponsorship" title="Your sponsorship">{children}</SponsorshipFrame>
    : <div>{children}</div>;

  if (loading) return plain(<CardShell><RowSkeleton rows={3} /></CardShell>);
  if (!sponsor) {
    return plain(
      <CardShell>
        <MemberEmpty
          icon={Award}
          title="No sponsorship linked yet"
          body="Nothing is linked to your account at the moment. If you expected to see your agreement here, the M3 team can link it."
          action={<UnderlineLink to="/contact">Contact the M3 team</UnderlineLink>}
        />
      </CardShell>,
    );
  }

  const pct = deliveredPct(items);
  const doneCount = items.filter(i => i.delivered).length;
  const needed = items.filter(i => i.fulfilment_type === 'SPONSOR_PROVIDES_ASSET' && !i.delivered);
  const grouped = PROGRAM_ORDER.map(prog => ({ program: prog, rows: items.filter(i => i.program === prog) })).filter(g => g.rows.length > 0);

  // The company switcher: only for an account linked to several sponsors.
  const switcher = sponsors.length > 1 && (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Sponsor">
      {sponsors.map(s => (
        <button
          key={s.id}
          type="button"
          aria-pressed={s.id === sponsor.id}
          onClick={() => setSponsor(s)}
          className={cn(
            'min-h-10 rounded-pill border px-4 text-[14px] font-medium transition-colors',
            FOCUS,
            s.id === sponsor.id ? 'border-navy bg-navy text-white' : 'border-rule bg-white text-navy hover:border-navy/40 hover:bg-chip',
          )}
        >
          {s.company_name}
        </button>
      ))}
    </div>
  );

  const summary = agreement && (
    <MemberPanel title={tier?.label || 'Sponsorship'}>
      <div className="space-y-5 p-5">
        <div>
          <p className="font-signage text-[30px] font-semibold leading-9 tabular-nums text-navy">
            {formatMoney(agreement.negotiated_fee_cents ?? tier?.list_fee_cents, agreement.currency)}
            <span className="ml-1.5 font-sans text-[14px] font-normal text-meta">per term</span>
          </p>
          {(agreement.term_start || agreement.term_end) && (
            <p className="mt-1 text-[14px] leading-5 text-meta">{fmtDate(agreement.term_start)} to {fmtDate(agreement.term_end)}</p>
          )}
        </div>
        {items.length > 0 && (
          <div>
            <div className="mb-1.5 flex items-center justify-between text-[13px] leading-5">
              <span className="text-meta">Delivered</span>
              <span className="font-semibold tabular-nums text-navy">{doneCount} of {items.length} · {pct}%</span>
            </div>
            <ProgressBar pct={pct} label={`${doneCount} of ${items.length} delivered`} />
          </div>
        )}
      </div>
    </MemberPanel>
  );

  const needs = needed.length > 0 && (
    <MemberPanel title="We need from you" count={needed.length}>
      <p className="border-b border-amber-200 bg-amber-50 px-5 py-3 text-[14px] leading-5 text-amber-950">
        Upload a file or paste a link for each item below.
      </p>
      <ul className="divide-y divide-rule">
        {needed.map(i => (
          <li key={i.id} className="space-y-3 p-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[15px] font-semibold leading-5 text-navy [overflow-wrap:anywhere]">{i.name}</span>
              {i.status === 'REQUESTED_FROM_SPONSOR' && <StatusPill tone="warning" icon={Clock}>Requested</StatusPill>}
            </div>
            <DeliverableFiles sponsorId={sponsor.id} benefitId={i.id} isManager={false} canUpload onChanged={reload} />
          </li>
        ))}
      </ul>
    </MemberPanel>
  );

  const programs = grouped.map(g => (
    <MemberPanel key={g.program} title={PROGRAM_NAMES[g.program]} count={g.rows.length}>
      <ul className="divide-y divide-rule">
        {g.rows.map(i => (
          <li key={i.id} className="flex items-center justify-between gap-4 px-5 py-3.5">
            <div className="min-w-0">
              <p className="text-[15px] leading-5 text-ink [overflow-wrap:anywhere]">{i.name}</p>
              <p className="mt-0.5 text-[13px] leading-[18px] text-meta">{formatBenefitValue(i)}</p>
            </div>
            <div className="shrink-0">
              {isWysPending(i) ? <StatusPill tone="warning">Pending, event not yet scheduled</StatusPill>
                : i.delivered ? <StatusPill tone="success" icon={Check}>Delivered</StatusPill>
                : <FulfilmentPill status={i.status} />}
            </div>
          </li>
        ))}
      </ul>
    </MemberPanel>
  ));

  const body = (
    <>
      {switcher}
      <div className={cn(switcher && 'mt-6', band ? 'lg:grid lg:grid-cols-[minmax(0,1fr)_21rem] lg:grid-rows-[auto_1fr] lg:gap-x-8' : '')}>
        {summary && <div className={cn("mb-6", band && "lg:col-start-2 lg:row-start-1")}>{summary}</div>}
        <div className={cn("space-y-6", band && "lg:col-start-1 lg:row-span-2 lg:row-start-1")}>
          {!agreement && (
            <CardShell>
              <MemberEmpty icon={Award} title="No agreement yet" body="Your agreement will appear here once the M3 team has set it up." />
            </CardShell>
          )}
          {needs}
          {programs}
        </div>
        <div className={band ? "mt-6 lg:col-start-2 lg:row-start-2 lg:mt-0" : "mt-6"}><SponsorBrandAssets sponsorId={sponsor.id} canEdit /></div>
      </div>
    </>
  );

  if (!band) {
    // In the account tab: the page header says "Sponsorship"; the company comes first.
    return (
      <div>
        <div className="mb-6 flex items-center gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-chip text-navy"><Award className="h-5 w-5" aria-hidden="true" /></span>
          <div className="min-w-0">
            <Eyebrow>Your sponsorship</Eyebrow>
            <p className="mt-1 text-card-title text-navy [overflow-wrap:anywhere]">{sponsor.company_name}</p>
          </div>
        </div>
        {body}
      </div>
    );
  }
  return (
    <SponsorshipFrame
      band
      icon={Award}
      eyebrow="Your sponsorship"
      title={sponsor.company_name}
      meta={<span>Your sponsorship benefits and their delivery status.</span>}
    >
      {body}
    </SponsorshipFrame>
  );
}
