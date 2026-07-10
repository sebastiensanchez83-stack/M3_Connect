// Shared types + helpers for the sponsorship fulfilment tracker (sp_* tables).
// The agreement line items (sp_agreement_benefit) are the source of truth; tiers
// are only templates. Money is stored as integer cents.

export type SpProgram = 'SMC' | 'SMART_MARINA_EVENT' | 'WYS';
export type SpValueType = 'BOOLEAN' | 'QUANTITY' | 'LEVEL';
export type SpFulfilmentType = 'M3_DELIVERS' | 'SPONSOR_PROVIDES_ASSET';
export type SpFulfilmentStatus = 'TODO' | 'REQUESTED_FROM_SPONSOR' | 'AWAITING_REVIEW' | 'DELIVERED' | 'REJECTED';
export type SpSponsorStatus = 'active' | 'pending' | 'expired';
export type SpAgreementStatus = 'draft' | 'active' | 'expired' | 'renewed';
export type SpReviewStatus = 'pending' | 'approved' | 'rejected';

export interface SpTier {
  tier_key: string; label: string;
  list_fee_cents: number | null; renewal_fee_cents: number | null;
  currency: string; display_order: number;
}
export interface SpSponsor {
  id: string; organization_id: string | null; company_name: string;
  primary_contact_name: string | null; primary_contact_email: string | null;
  status: SpSponsorStatus; hubspot_company_id: string | null; notes: string | null;
  created_at: string;
}
export interface SpBrandAsset {
  id: string; sponsor_id: string; kind: string; label: string | null;
  storage_path: string | null; external_url: string | null; filename: string | null;
  mime: string | null; size_bytes: number | null; created_at: string;
}
export interface SpAgreement {
  id: string; sponsor_id: string; tier_key: string | null;
  negotiated_fee_cents: number | null; currency: string;
  term_start: string | null; term_end: string | null;
  renewal_date: string | null; negotiated_renewal_fee_cents: number | null;
  status: SpAgreementStatus; notes: string | null; renewed_from: string | null;
  created_at: string;
}
export interface SpAgreementBenefit {
  id: string; agreement_id: string; benefit_id: string | null; is_custom: boolean;
  name: string; description: string | null; program: SpProgram; section: string | null;
  value_type: SpValueType; fulfilment_type: SpFulfilmentType;
  requires_file: boolean; draws_from_brand_asset: boolean;
  value_bool: boolean | null; value_qty: number | null; value_qualifier: string | null;
  value_text: string | null; value_level: string | null;
  event_id: string | null; status: SpFulfilmentStatus; delivered: boolean;
  delivered_at: string | null; requested_at: string | null; display_order: number;
}
export interface SpDeliverableFile {
  id: string; agreement_benefit_id: string;
  storage_path: string | null; external_url: string | null; filename: string | null;
  mime: string | null; size_bytes: number | null; uploaded_by: string | null;
  review_status: SpReviewStatus; review_note: string | null; created_at: string;
}
export interface SpBenefit {
  id: string; code: string; name: string; description: string | null;
  program: SpProgram; section: string | null; value_type: SpValueType;
  allowed_levels: string[] | null; fulfilment_type: SpFulfilmentType;
  requires_file: boolean; draws_from_brand_asset: boolean; display_order: number; active: boolean;
}

export const PROGRAM_LABELS: Record<SpProgram, string> = {
  SMC: 'Smart Marina Connect',
  SMART_MARINA_EVENT: 'Smart Marina Event',
  WYS: 'World Yachting Summit',
};
export const PROGRAM_ORDER: SpProgram[] = ['SMC', 'SMART_MARINA_EVENT', 'WYS'];

export const SPONSORSHIP_BUCKET = 'sponsorship-files';

export const FULFILMENT_STATUS_META: Record<SpFulfilmentStatus, { label: string; cls: string }> = {
  TODO: { label: 'To do', cls: 'bg-gray-100 text-gray-600 border-gray-200' },
  REQUESTED_FROM_SPONSOR: { label: 'Requested from sponsor', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  AWAITING_REVIEW: { label: 'Awaiting review', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  DELIVERED: { label: 'Delivered', cls: 'bg-green-50 text-green-700 border-green-200' },
  REJECTED: { label: 'Rejected', cls: 'bg-red-50 text-red-700 border-red-200' },
};
export const FULFILMENT_STATUSES: SpFulfilmentStatus[] = ['TODO', 'REQUESTED_FROM_SPONSOR', 'AWAITING_REVIEW', 'DELIVERED', 'REJECTED'];

export const SPONSOR_STATUS_CLS: Record<SpSponsorStatus, string> = {
  active: 'bg-green-50 text-green-700 border-green-200',
  pending: 'bg-amber-50 text-amber-700 border-amber-200',
  expired: 'bg-gray-100 text-gray-500 border-gray-200',
};
export const AGREEMENT_STATUS_CLS: Record<SpAgreementStatus, string> = {
  draft: 'bg-gray-100 text-gray-600 border-gray-200',
  active: 'bg-green-50 text-green-700 border-green-200',
  expired: 'bg-gray-100 text-gray-500 border-gray-200',
  renewed: 'bg-blue-50 text-blue-700 border-blue-200',
};

export const formatMoney = (cents: number | null | undefined, currency = 'EUR') => {
  if (cents == null) return '—';
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency, maximumFractionDigits: 0 }).format(cents / 100);
};

// Render a line item's negotiated value for display.
export function formatBenefitValue(b: Pick<SpAgreementBenefit, 'value_type' | 'value_bool' | 'value_qty' | 'value_qualifier' | 'value_text' | 'value_level'>): string {
  if (b.value_type === 'LEVEL') return b.value_level || '—';
  if (b.value_type === 'QUANTITY') {
    if (b.value_text) return b.value_text;
    if (b.value_qty != null) return `${b.value_qty}${b.value_qualifier ? ` ${b.value_qualifier}` : ''}`;
    return '—';
  }
  return b.value_bool ? 'Included' : '—';
}

export const isWysPending = (b: Pick<SpAgreementBenefit, 'program' | 'event_id'>) => b.program === 'WYS' && !b.event_id;

// Delivered-percentage across a set of line items (drives the tracker progress).
export function deliveredPct(items: Pick<SpAgreementBenefit, 'delivered'>[]): number {
  if (items.length === 0) return 0;
  return Math.round((items.filter(i => i.delivered).length / items.length) * 100);
}
