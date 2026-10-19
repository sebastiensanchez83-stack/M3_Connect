import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { AlertTriangle, Building2, Check, Loader2, Plus, Search, UserX } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { AdminStatusPill } from '../AdminUI';
import { NEAR_MATCH_SCORE, ORG_TYPES, orgCandidates, reviewErrorText, type OrgAction, type OrgCandidate, type OrgType } from './reviewApi';

/**
 * Which company a person belongs to once M3 says yes: one of their current companies, an
 * existing company of the platform (candidates from org_match_candidates), a new company M3
 * creates now (verified, its type locked), or none. Used by ValidatePersonDialog and by the
 * approval of an on-site registration (the account created at confirmation).
 */

export type CompanyPick =
  | { mode: 'none' }
  | { mode: 'current'; orgId: string; type: OrgType | '' }
  | { mode: 'link'; orgId: string | null; asOwner: boolean }
  | {
    mode: 'create'; name: string; type: OrgType | ''; website: string; country: string; forceNew: boolean;
    /** The closest listed company (NEAR_MATCH_SCORE or more), set by CompanyChoice; null = none. */
    nearMatch?: string | null;
    /** M3 ticked "This is a different company" (needed to create while nearMatch is set). */
    different?: boolean;
  };

/** A new "create" pick (nothing near found yet). */
export function createPickOf(p: { name?: string | null; type?: OrgType | ''; website?: string | null; country?: string | null }): CompanyPick {
  return { mode: 'create', name: p.name ?? '', type: p.type ?? '', website: p.website ?? '', country: p.country ?? '', forceNew: false, nearMatch: null, different: false };
}

/** A company the person already belongs to. */
export interface CurrentCompany {
  id: string;
  name: string;
  status: string | null;
  type: string | null;
  role: string | null;
}

export function orgTypeLabel(type: string | null | undefined, t: TFunction): string | undefined {
  switch (type) {
    case 'marina': return t('adminReview.orgType.marina', 'Marina');
    case 'partner': return t('adminReview.orgType.partner', 'Service provider');
    case 'media_partner': return t('adminReview.orgType.media', 'Media');
    case 'developer': return t('adminReview.orgType.developer', 'Developer');
    case 'investor': return t('adminReview.orgType.investor', 'Investor');
    default: return undefined;
  }
}

function orgStatusWord(status: string | null | undefined, t: TFunction): string {
  switch (status) {
    case 'verified': return t('adminReview.v2.company.verified', 'Validated');
    case 'pending': return t('adminReview.v2.company.pending', 'Waiting for approval');
    case 'rejected': return t('adminReview.v2.company.rejected', 'Not accepted');
    case 'suspended': return t('adminReview.v2.company.suspended', 'Suspended');
    default: return status ?? '';
  }
}

function reasonWord(reason: string, t: TFunction): string {
  switch (reason) {
    case 'same_name': return t('adminReview.v2.match.sameName', 'Same name');
    case 'similar_name': return t('adminReview.v2.match.similarName', 'Similar name');
    case 'same_website': return t('adminReview.v2.match.sameWebsite', 'Same website');
    case 'email_domain': return t('adminReview.v2.match.emailDomain', 'Same e-mail domain');
    case 'same_country': return t('adminReview.v2.match.sameCountry', 'Same country');
    default: return reason;
  }
}

export function CompanyChoice({
  value,
  onChange,
  current = [],
  allowNone = true,
  noneLabel,
  noneHint,
  lookup,
  disabled = false,
  ownerBlocked = [],
}: {
  value: CompanyPick;
  onChange: (next: CompanyPick) => void;
  /** The person's companies today (the old sign-up wizard made them). */
  current?: CurrentCompany[];
  allowNone?: boolean;
  noneLabel?: string;
  noneHint?: string;
  /** What to look for first: the declared company, the website, the e-mail, the country. */
  lookup: { name?: string | null; website?: string | null; email?: string | null; country?: string | null };
  disabled?: boolean;
  /**
   * Companies this person has an open CLAIM on: becoming their owner is decided on the claim
   * card (admin_decide_claim), never by ticking "owner" here.
   */
  ownerBlocked?: string[];
}) {
  const { t } = useTranslation();
  const groupName = useId();
  const [query, setQuery] = useState(lookup.name ?? '');
  const [candidates, setCandidates] = useState<OrgCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const linkPick = value.mode === 'link' ? value : null;
  const createPick = value.mode === 'create' ? value : null;

  // What is looked up: the company M3 is about to create (its name and website), or what M3
  // types in the search box. The declared company at once, then after a 300 ms pause.
  const searchName = createPick ? createPick.name : query;
  const searchWebsite = createPick
    ? createPick.website
    : query.trim() === (lookup.name ?? '').trim() ? lookup.website : null;
  useEffect(() => {
    const n = ++seq.current;
    const typed = searchName.trim();
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const rows = await orgCandidates({
          name: typed || lookup.name,
          website: searchWebsite,
          email: lookup.email,
          country: lookup.country,
        });
        if (n === seq.current) setCandidates(rows.slice(0, 8));
      } catch (e) {
        if (n === seq.current) { setCandidates([]); setError(reviewErrorText(e, t)); }
      }
      if (n === seq.current) setLoading(false);
    }, n === 1 ? 0 : 300);
    return () => clearTimeout(timer);
  }, [searchName, searchWebsite, lookup.name, lookup.email, lookup.country, t]);

  const currentIds = new Set(current.map(c => c.id));
  const shown = candidates.filter(c => !currentIds.has(c.id));
  const picked = linkPick?.orgId ? candidates.find(c => c.id === linkPick.orgId) : undefined;
  const ownerBlockedHere = !!picked && ownerBlocked.includes(picked.id);

  // Before creating: the listed companies close to it, shown above the form; creating anyway
  // needs "This is a different company" (companyPickToOrg refuses it otherwise).
  const nearby = createPick
    ? shown.filter(c => (c.score ?? 0) >= NEAR_MATCH_SCORE).slice(0, 3)
    : [];
  const nearName = nearby[0]?.name ?? null;
  useEffect(() => {
    if (!createPick || loading || error) return;
    if ((createPick.nearMatch ?? null) === nearName) return;
    onChange({ ...createPick, nearMatch: nearName, different: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nearName, loading, error, createPick?.nearMatch, createPick ? 1 : 0]);

  const option = (checked: boolean, onSelect: () => void, children: React.ReactNode, key: string) => (
    <label
      key={key}
      className={cn(
        'flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border bg-white px-3 py-2.5 text-[14px] leading-5 text-navy transition-colors',
        checked ? 'border-navy ring-1 ring-navy/20' : 'border-rule hover:border-navy/30',
        disabled && 'cursor-not-allowed opacity-60',
      )}
    >
      <input
        type="radio"
        name={groupName}
        className="mt-0.5 h-4 w-4 shrink-0 accent-navy"
        checked={checked}
        disabled={disabled}
        onChange={onSelect}
      />
      <span className="min-w-0 flex-1">{children}</span>
    </label>
  );

  return (
    <div className="space-y-2" role="radiogroup" aria-label={t('adminReview.v2.company.label', 'Company')}>
      {current.map(c => option(
        value.mode === 'current' && value.orgId === c.id,
        () => onChange({ mode: 'current', orgId: c.id, type: (ORG_TYPES as string[]).includes(c.type ?? '') ? (c.type as OrgType) : '' }),
        <>
          <span className="flex flex-wrap items-center gap-1.5 font-semibold">
            <Building2 className="h-4 w-4 text-teal" aria-hidden="true" />
            {c.status === 'pending'
              ? t('adminReview.v2.company.keepPending', 'Their company {{name}}, approved with them', { name: c.name })
              : t('adminReview.v2.company.keep', 'Keep their company {{name}}', { name: c.name })}
          </span>
          <span className="mt-1 flex flex-wrap gap-1.5">
            <AdminStatusPill tone={c.status === 'verified' ? 'success' : c.status === 'pending' ? 'warning' : 'danger'}>{orgStatusWord(c.status, t)}</AdminStatusPill>
            {orgTypeLabel(c.type, t) && <AdminStatusPill tone="navy">{orgTypeLabel(c.type, t)}</AdminStatusPill>}
            {c.role === 'owner' && <AdminStatusPill>{t('adminReview.fact.owner', 'Company owner')}</AdminStatusPill>}
          </span>
        </>,
        `current-${c.id}`,
      ))}

      {value.mode === 'current' && current.find(c => c.id === value.orgId)?.status === 'pending' && (
        <div className="ml-2 border-l-2 border-rule pl-3 sm:ml-7">
          <TypePicker
            value={value.type}
            onChange={ty => onChange({ ...value, type: ty })}
            disabled={disabled}
            legend={t('adminReview.v2.company.typeOfTheirs', 'Type of their company')}
          />
        </div>
      )}

      {option(
        value.mode === 'link',
        // Nothing is picked for M3: a company is chosen by a click in the list.
        () => onChange({ mode: 'link', orgId: linkPick?.orgId ?? null, asOwner: false }),
        <>
          <span className="font-semibold">{t('adminReview.v2.company.link', 'Link to a company already on the platform')}</span>
          <span className="block text-[13px] text-meta">{t('adminReview.v2.company.linkHint', 'They join it as a team member. The owner is not e-mailed: they see them in their team.')}</span>
        </>,
        'link',
      )}

      {value.mode === 'link' && (
        <div className="ml-2 space-y-2 border-l-2 border-rule pl-3 sm:ml-7">
          <label className="relative block">
            <span className="sr-only">{t('adminReview.v2.company.search', 'Search a company')}</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-meta" aria-hidden="true" />
            <Input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={t('adminReview.v2.company.searchPlaceholder', 'Company name')}
              className="h-11 pl-9"
              disabled={disabled}
            />
          </label>
          {loading && (
            <p className="flex items-center gap-2 text-[13px] text-meta">
              <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              {t('adminReview.v2.company.searching', 'Looking for matching companies…')}
            </p>
          )}
          {error && <p role="alert" className="text-[13px] text-red-800">{error}</p>}
          {!loading && !error && shown.length === 0 && (
            <p className="text-[13px] text-meta">{t('adminReview.v2.company.noMatch', 'No matching company. Try another spelling, or create a new company below.')}</p>
          )}
          <ul className="space-y-1.5">
            {shown.map(c => {
              const active = linkPick?.orgId === c.id;
              const linkable = c.access_status === 'verified';
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    disabled={disabled || !linkable}
                    onClick={() => onChange({ mode: 'link', orgId: c.id, asOwner: false })}
                    aria-pressed={active}
                    className={cn(
                      'flex w-full min-h-11 items-start gap-2 rounded-xl border px-3 py-2 text-left text-[14px] leading-5 transition-colors focus:outline-none focus-visible:shadow-focus',
                      active ? 'border-navy bg-chip' : 'border-rule bg-white hover:border-navy/30',
                      !linkable && 'cursor-not-allowed opacity-60',
                    )}
                  >
                    {active ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-teal" aria-hidden="true" /> : <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-meta" aria-hidden="true" />}
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold text-navy [overflow-wrap:anywhere]">{c.name}</span>
                      <span className="mt-1 flex flex-wrap gap-1.5">
                        <AdminStatusPill tone={c.access_status === 'verified' ? 'success' : 'warning'}>{orgStatusWord(c.access_status, t)}</AdminStatusPill>
                        {orgTypeLabel(c.organization_type, t) && <AdminStatusPill tone="navy">{orgTypeLabel(c.organization_type, t)}</AdminStatusPill>}
                        {c.country && <AdminStatusPill>{c.country}</AdminStatusPill>}
                        {c.reasons.map(r => <AdminStatusPill key={r} tone="info">{reasonWord(r, t)}</AdminStatusPill>)}
                        {c.sm26_linked && <AdminStatusPill tone="info">{t('adminReview.v2.match.sm26', 'Smart Marina 2026')}</AdminStatusPill>}
                        <AdminStatusPill>
                          {c.has_owner
                            ? t('adminReview.v2.match.hasOwner', 'Has an owner')
                            : t('adminReview.v2.match.noOwner', 'No owner yet')}
                        </AdminStatusPill>
                        {typeof c.members === 'number' && (
                          <AdminStatusPill>{t('adminReview.v2.match.members', { count: c.members, defaultValue_one: '{{count}} person', defaultValue_other: '{{count}} people' })}</AdminStatusPill>
                        )}
                      </span>
                      {!linkable && (
                        <span className="mt-1 block text-[12px] text-meta">{t('adminReview.v2.company.pendingNotLinkable', 'Waiting for approval: approve this company first.')}</span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {picked && !picked.has_owner && linkPick && !ownerBlockedHere && (
            <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-rule bg-white px-3 py-2 text-[14px] text-navy">
              <Checkbox
                checked={linkPick.asOwner}
                onCheckedChange={v => onChange({ ...linkPick, asOwner: v === true })}
                disabled={disabled}
              />
              <span>{t('adminReview.v2.company.asOwner', 'Make them the owner of {{name}} (it has no owner yet)', { name: picked.name })}</span>
            </label>
          )}
          {picked && ownerBlockedHere && (
            <p className="text-[13px] leading-5 text-amber-800">
              {t('adminReview.v2.company.ownerViaClaim', 'They asked to manage {{name}}: decide that on their claim card. Linking here only adds them as a team member.', { name: picked.name })}
            </p>
          )}
          {picked?.has_owner && (
            <p className="text-[13px] text-meta">{t('adminReview.v2.company.ownerExists', '{{name}} already has an owner: they join as a team member.', { name: picked.name })}</p>
          )}
        </div>
      )}

      {option(
        value.mode === 'create',
        () => onChange(createPick ?? createPickOf({ name: lookup.name, website: lookup.website, country: lookup.country })),
        <>
          <span className="flex items-center gap-1.5 font-semibold"><Plus className="h-4 w-4 text-teal" aria-hidden="true" />{t('adminReview.v2.company.create', 'Create a new company')}</span>
          <span className="block text-[13px] text-meta">{t('adminReview.v2.company.createHint', 'Validated at once, with them as its owner.')}</span>
        </>,
        'create',
      )}

      {createPick && nearby.length > 0 && (
        <div className="ml-2 space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3 sm:ml-7" role="group" aria-label={t('adminReview.v2.company.nearTitle', 'Already on the platform?')}>
          <p className="flex items-start gap-1.5 text-[14px] font-semibold leading-5 text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {t('adminReview.v2.company.nearTitle', 'Already on the platform?')}
          </p>
          <ul className="space-y-1.5">
            {nearby.map(c => {
              const pct = c.score !== null ? Math.round(c.score * 100) : null;
              const why = [pct !== null ? `${pct}%` : null, ...c.reasons.map(r => reasonWord(r, t))].filter(Boolean).join(', ');
              const linkable = c.access_status === 'verified';
              return (
                <li key={c.id} className="flex flex-wrap items-center gap-2 text-[14px] leading-5 text-navy">
                  <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                    <span className="font-semibold">{c.name}</span>
                    {why && <span className="text-meta"> ({why})</span>}
                    {!linkable && <span className="block text-[12px] text-meta">{t('adminReview.v2.company.pendingNotLinkable', 'Waiting for approval: approve this company first.')}</span>}
                  </span>
                  {linkable && (
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => onChange({ mode: 'link', orgId: c.id, asOwner: false })}
                      className="inline-flex h-11 shrink-0 items-center rounded-pill border border-navy/25 bg-white px-4 text-[14px] font-semibold text-navy hover:border-navy hover:bg-chip focus:outline-none focus-visible:shadow-focus"
                    >
                      {t('adminReview.v2.company.linkInstead', 'Link to it instead')}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-amber-300 bg-white px-3 py-2 text-[14px] leading-5 text-navy">
            <Checkbox
              checked={createPick.different === true}
              onCheckedChange={v => onChange({ ...createPick, different: v === true })}
              disabled={disabled}
            />
            <span>{t('adminReview.v2.company.different', 'This is a different company: create {{name}}', { name: createPick.name.trim() || t('adminValidate.theCompany', 'the company') })}</span>
          </label>
        </div>
      )}

      {createPick && (
        <div className="ml-2 grid gap-3 border-l-2 border-rule pl-3 sm:ml-7 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="text-[13px] font-semibold text-navy">{t('adminReview.v2.company.name', 'Company name')}</span>
            <Input
              value={createPick.name}
              onChange={e => onChange({ ...createPick, name: e.target.value, forceNew: false })}
              maxLength={200}
              autoComplete="organization"
              className="mt-1 h-11"
              disabled={disabled}
            />
          </label>
          <div className="sm:col-span-2">
            <TypePicker
              value={createPick.type}
              onChange={ty => onChange({ ...createPick, type: ty })}
              disabled={disabled}
              legend={t('adminReview.v2.company.type', 'Type of company')}
            />
          </div>
          <label className="block">
            <span className="text-[13px] font-semibold text-navy">{t('adminReview.v2.company.website', 'Website (optional)')}</span>
            <Input
              value={createPick.website}
              onChange={e => onChange({ ...createPick, website: e.target.value })}
              maxLength={300}
              inputMode="url"
              className="mt-1 h-11"
              disabled={disabled}
            />
          </label>
          <label className="block">
            <span className="text-[13px] font-semibold text-navy">{t('adminReview.v2.company.country', 'Country (optional)')}</span>
            <Input
              value={createPick.country}
              onChange={e => onChange({ ...createPick, country: e.target.value })}
              maxLength={80}
              autoComplete="country-name"
              className="mt-1 h-11"
              disabled={disabled}
            />
          </label>
        </div>
      )}

      {allowNone && option(
        value.mode === 'none',
        () => onChange({ mode: 'none' }),
        <>
          <span className="flex items-center gap-1.5 font-semibold"><UserX className="h-4 w-4 text-meta" aria-hidden="true" />{noneLabel ?? t('adminReview.v2.company.none', 'No company')}</span>
          {noneHint && <span className="block text-[13px] text-meta">{noneHint}</span>}
        </>,
        'none',
      )}
    </div>
  );
}

/** The five company types as large buttons, with the type-lock note. */
function TypePicker({ value, onChange, disabled, legend }: {
  value: OrgType | '';
  onChange: (ty: OrgType) => void;
  disabled?: boolean;
  legend: string;
}) {
  const { t } = useTranslation();
  return (
    <fieldset>
      <legend className="text-[13px] font-semibold text-navy">{legend}</legend>
      <div className="mt-1 flex flex-wrap gap-2">
        {ORG_TYPES.map(ty => (
          <button
            key={ty}
            type="button"
            aria-pressed={value === ty}
            disabled={disabled}
            onClick={() => onChange(ty)}
            className={cn(
              'inline-flex h-11 items-center rounded-pill border px-4 text-[14px] font-semibold transition-colors focus:outline-none focus-visible:shadow-focus',
              value === ty ? 'border-navy bg-navy text-white' : 'border-rule bg-white text-navy hover:border-navy/30',
            )}
          >
            {orgTypeLabel(ty, t)}
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-[12px] leading-4 text-meta">
        {t('adminReview.v2.company.typeLocked', 'What the company can do on the platform follows its type. Once it is validated, only M3 can change the type.')}
      </p>
    </fieldset>
  );
}

/** The org object the server takes, or an error code when the pick is incomplete. */
export function companyPickToOrg(
  pick: CompanyPick,
  current: CurrentCompany[],
): { ok: true; org: OrgAction } | { ok: false; code: string } {
  switch (pick.mode) {
    case 'none':
      return { ok: true, org: { mode: 'none' } };
    case 'current': {
      const c = current.find(x => x.id === pick.orgId);
      // A company already validated needs no change; one still waiting is validated with them,
      // with its type (rights follow it, and it is locked once validated).
      if (!c || c.status === 'verified') return { ok: true, org: { mode: 'none' } };
      if (!pick.type) return { ok: false, code: 'type_required' };
      return { ok: true, org: { mode: 'link', org_id: c.id, type: pick.type } };
    }
    case 'link':
      if (!pick.orgId) return { ok: false, code: 'org_id_required' };
      return { ok: true, org: { mode: 'link', org_id: pick.orgId, as_owner: pick.asOwner || undefined } };
    case 'create':
      if (!pick.name.trim()) return { ok: false, code: 'name_required' };
      if (!pick.type) return { ok: false, code: 'type_required' };
      if (pick.nearMatch && !pick.different && !pick.forceNew) return { ok: false, code: 'near_match' };
      return {
        ok: true,
        org: {
          mode: 'create',
          name: pick.name.trim(),
          type: pick.type,
          website: pick.website.trim() || undefined,
          country: pick.country.trim() || undefined,
          force_new: pick.forceNew || undefined,
        },
      };
  }
}
