import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Building2, Check, KeyRound, Loader2, Plus } from 'lucide-react';
import { searchCompanies, type CompanyCard, type SignupIntent } from '@/lib/accountSignup';
import { AuthInput, AuthLabel, FieldHint } from '@/components/auth/fields';
import { CountryField } from '@/components/auth/signupParts';
import { UnderlineLink } from '@/components/brand/UnderlineLink';
import { cn } from '@/lib/utils';

/**
 * "My company is already listed" (Victor, 8 Oct 2026): the company field of the
 * sign-up form and of "Add my company". The person types the company's name; from
 * three letters the platform's companies that match come up (account-signup
 * company_search: public card fields only, never who owns or works there):
 *
 *  - "This is my company" picks one: M3 or the company's owner decides whether the
 *    person joins (the server decides between a join request and a claim);
 *  - "It's another company: create {name}" keeps the name as a new company, with
 *    its website and country: nothing is created before M3's review;
 *  - "I have a company code": the code from a claim e-mail. The database checks it
 *    once the address is proven; M3 still decides every claim, and a company that
 *    already has an owner refuses codes (Victor, 11 Oct 2026).
 *
 * Controlled: the parent keeps a `CompanyChoice` and turns it into the intent.
 */

export type CompanyChoice =
  | { mode: 'search' }
  | { mode: 'join'; org: CompanyCard }
  | { mode: 'new'; name: string; website: string; country: string };

export const EMPTY_CHOICE: CompanyChoice = { mode: 'search' };

/**
 * The intent a choice (and a code) gives. null = nothing chosen yet.
 * A code rides along with any choice: when it matches, the database takes the
 * company it names (a claim, which M3 decides); when it does not, the choice
 * stands (a new company stays `new`, so a mistyped code never loses the company
 * the person typed).
 */
export function intentOf(choice: CompanyChoice, code: string): SignupIntent | null {
  const c = code.trim();
  if (choice.mode === 'join') return { action: 'join', org_id: choice.org.id, name: choice.org.name, ...(c ? { code: c } : {}) };
  if (choice.mode === 'new' && choice.name.trim()) {
    return {
      action: 'new',
      name: choice.name.trim(),
      ...(choice.website.trim() ? { website: choice.website.trim() } : {}),
      ...(choice.country.trim() ? { country: choice.country.trim() } : {}),
      ...(c ? { code: c } : {}),
    };
  }
  // A code alone names the company (the claim e-mail's code).
  if (c) return { action: 'join', code: c };
  return null;
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?';
}

function CompanyLine({ org, action }: { org: CompanyCard; action?: string }) {
  const meta = [[org.city, org.country].filter(Boolean).join(', '), org.type_label].filter(Boolean).join(' · ');
  return (
    <>
      {org.logo_url ? (
        <img src={org.logo_url} alt="" className="h-10 w-10 shrink-0 rounded-field border border-rule bg-white object-contain" loading="lazy" />
      ) : (
        <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-field bg-chip text-[13px] font-semibold text-navy">{initials(org.name)}</span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold leading-5 text-navy [overflow-wrap:anywhere]">{org.name}</span>
        {meta && <span className="mt-0.5 block text-[13px] leading-5 text-meta">{meta}</span>}
        {action && <span className="mt-1 block text-[13px] font-semibold leading-5 text-navy underline underline-offset-2 sm:hidden">{action}</span>}
      </span>
    </>
  );
}

export function CompanyPicker({
  value,
  onChange,
  code,
  onCodeChange,
  idPrefix = 'company',
  error,
}: {
  value: CompanyChoice;
  onChange: (c: CompanyChoice) => void;
  code: string;
  onCodeChange: (c: string) => void;
  idPrefix?: string;
  error?: string | null;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState(value.mode === 'new' ? value.name : '');
  const [results, setResults] = useState<CompanyCard[]>([]);
  const [searching, setSearching] = useState(false);
  // The search could not run (switched off, too many searches, offline): creating stays possible.
  const [searchDown, setSearchDown] = useState(false);
  const [codeOpen, setCodeOpen] = useState(!!code);
  const listId = useId();
  const seq = useRef(0);

  const q = query.trim();
  const letters = q.replace(/[^\p{L}\p{N}]+/gu, '').length;

  useEffect(() => {
    if (value.mode !== 'search' || letters < 3) {
      setResults([]);
      setSearching(false);
      return;
    }
    const mine = ++seq.current;
    setSearching(true);
    const timer = window.setTimeout(async () => {
      const res = await searchCompanies(q);
      if (mine !== seq.current) return;
      setSearching(false);
      if (res.ok) {
        setResults(res.results);
        setSearchDown(false);
      } else {
        setResults([]);
        setSearchDown(true);
      }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [q, letters, value.mode]);

  const codeBlock = (
    <div className="space-y-2">
      {codeOpen ? (
        <>
          <AuthLabel htmlFor={`${idPrefix}-code`}>{t('signupV2.company.code', 'Company code')}</AuthLabel>
          <AuthInput
            id={`${idPrefix}-code`}
            value={code}
            onChange={(e) => onCodeChange(e.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={40}
            placeholder={t('signupV2.company.codePlaceholder', 'The code from your e-mail')}
          />
          <FieldHint>{t('signupV2.company.codeHint', 'The M3 team checks it with your request. A company that already has an owner on the platform does not take codes: its owner answers.')}</FieldHint>
        </>
      ) : (
        <UnderlineLink arrow={false} onClick={() => setCodeOpen(true)} className="min-h-11 !text-sm !font-medium">
          <KeyRound className="mr-1.5 inline h-4 w-4" aria-hidden="true" />
          {t('signupV2.company.haveCode', 'I have a company code')}
        </UnderlineLink>
      )}
    </div>
  );

  // ── A company is chosen ──
  if (value.mode === 'join') {
    return (
      <div className="space-y-3">
        <p className="text-sm font-semibold leading-5 text-navy">{t('signupV2.company.label', 'Your company')}</p>
        <div className="flex items-center gap-3 rounded-card border border-navy bg-chip/60 p-3.5 ring-1 ring-navy">
          <CompanyLine org={value.org} />
          <span className="inline-flex shrink-0 items-center gap-1 text-[13px] font-semibold text-navy">
            <Check className="h-4 w-4" aria-hidden="true" strokeWidth={2.5} />
            <span className="hidden sm:inline">{t('signupV2.company.mine', 'This is my company')}</span>
          </span>
        </div>
        <FieldHint>{t('signupV2.company.joinHint', 'Its owner, or the M3 team, confirms that you work there.')}</FieldHint>
        <UnderlineLink arrow={false} onClick={() => { setQuery(''); onChange(EMPTY_CHOICE); }} className="min-h-11 !text-sm !font-medium">
          {t('signupV2.company.change', 'Choose another company')}
        </UnderlineLink>
        {codeBlock}
      </div>
    );
  }

  // ── A new company ──
  if (value.mode === 'new') {
    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <AuthLabel htmlFor={`${idPrefix}-name`}>{t('signupV2.company.newName', 'Company name')} *</AuthLabel>
          <AuthInput
            id={`${idPrefix}-name`}
            autoComplete="organization"
            value={value.name}
            onChange={(e) => onChange({ ...value, name: e.target.value })}
            aria-invalid={!!error || undefined}
          />
          <FieldHint>{t('signupV2.company.newHint', 'M3 adds your company to the platform after checking it.')}</FieldHint>
        </div>
        <div className="space-y-2">
          <AuthLabel htmlFor={`${idPrefix}-website`}>{t('signupV2.company.website', 'Website')}</AuthLabel>
          <AuthInput
            id={`${idPrefix}-website`}
            type="url"
            inputMode="url"
            autoComplete="url"
            value={value.website}
            onChange={(e) => onChange({ ...value, website: e.target.value })}
            placeholder="https://www.example.com"
          />
        </div>
        <CountryField
          id={`${idPrefix}-country`}
          label={t('signupV2.company.country', 'Country of the company')}
          value={value.country}
          onChange={(country) => onChange({ ...value, country })}
        />
        {error && <p role="alert" className="text-sm leading-5 text-red-700">{error}</p>}
        <UnderlineLink arrow={false} onClick={() => { setQuery(value.name); onChange(EMPTY_CHOICE); }} className="min-h-11 !text-sm !font-medium">
          {t('signupV2.company.backToSearch', 'Search the listed companies again')}
        </UnderlineLink>
        {codeBlock}
      </div>
    );
  }

  // ── Searching ──
  // With a company code the search is optional: the code alone names the company.
  const hasCode = !!code.trim();
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <AuthLabel htmlFor={`${idPrefix}-search`}>{t('signupV2.company.label', 'Your company')}{hasCode ? '' : ' *'}</AuthLabel>
        <div className="relative">
          <AuthInput
            id={`${idPrefix}-search`}
            autoComplete="organization"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-describedby={`${idPrefix}-search-hint`}
            aria-controls={results.length ? listId : undefined}
            aria-invalid={!!error || undefined}
            className="pr-11"
          />
          {searching && <Loader2 aria-hidden="true" className="absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-meta" />}
        </div>
        <FieldHint>
          <span id={`${idPrefix}-search-hint`}>
            {hasCode
              ? t('signupV2.company.searchHintCode', 'Your company code names the company: no need to search. You can still pick it from the list if you prefer.')
              : t('signupV2.company.searchHint', 'Type its name: if it is already on the platform, pick it.')}
          </span>
        </FieldHint>
      </div>

      {results.length > 0 && (
        <ul id={listId} aria-label={t('signupV2.company.results', 'Companies on the platform')} className="divide-y divide-rule overflow-hidden rounded-card border border-rule bg-white">
          {results.map((org) => (
            <li key={org.id}>
              <button
                type="button"
                onClick={() => onChange({ mode: 'join', org })}
                className="flex w-full items-center gap-3 p-3 text-left transition-colors hover:bg-page focus:outline-none focus-visible:bg-page focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <CompanyLine org={org} action={t('signupV2.company.mine', 'This is my company')} />
                <span className="hidden shrink-0 rounded-pill sm:inline border border-navy/25 px-3 py-1.5 text-[13px] font-semibold leading-4 text-navy">
                  {t('signupV2.company.mine', 'This is my company')}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {letters >= 3 && !searching && results.length === 0 && !searchDown && (
        <p className="text-[13px] leading-5 text-meta" role="status">{t('signupV2.company.noMatch', 'No company with this name on the platform yet.')}</p>
      )}

      {letters >= 2 && (
        <button
          type="button"
          onClick={() => onChange({ mode: 'new', name: q, website: '', country: '' })}
          className={cn(
            'flex w-full items-start gap-3 rounded-card border border-dashed border-navy/40 bg-white p-3 text-left transition-colors',
            'hover:border-navy hover:bg-page focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          )}
        >
          <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-field bg-chip text-navy">
            {results.length > 0 ? <Plus className="h-5 w-5" /> : <Building2 className="h-5 w-5" />}
          </span>
          <span className="min-w-0 flex-1 text-[15px] leading-5 text-navy">
            {results.length > 0
              ? t('signupV2.company.another', { name: q, defaultValue: 'It’s another company: create “{{name}}”' })
              : t('signupV2.company.create', { name: q, defaultValue: 'Create “{{name}}”' })}
            <span className="mt-0.5 block text-[13px] text-meta">{t('signupV2.company.createHint', 'Then its website and country')}</span>
          </span>
        </button>
      )}
      {error && <p role="alert" className="text-sm leading-5 text-red-700">{error}</p>}
      {codeBlock}
    </div>
  );
}
