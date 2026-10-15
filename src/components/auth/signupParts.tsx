import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LucideIcon } from 'lucide-react';
import { Anchor, Building2, Check, HardHat, Newspaper, Ticket, TrendingUp } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { COUNTRIES } from '@/lib/countries';
import { THEMES } from '@/lib/themes';
import { cn } from '@/lib/utils';
import type { SignupType } from '@/lib/accountSignup';
import { AuthInput, AuthLabel, FieldHint } from '@/components/auth/fields';

/**
 * Pieces shared by the account sign-up (AccountSignup) and "Add my company"
 * (AddCompanyForm): the six type cards, the searchable country field and the
 * sector chips grouped by the six themes. English only (Victor, 7 Oct 2026).
 */

interface TypeDef { value: SignupType; icon: LucideIcon; title: string; desc: string }

export function useSignupTypes(): TypeDef[] {
  const { t } = useTranslation();
  return [
    { value: 'marina', icon: Anchor, title: t('signupV2.type.marina', 'Marina'), desc: t('signupV2.type.marinaDesc', 'A marina, a port or a marina group') },
    // "Partner" is kept for paying sponsors (Victor, 6 Oct 2026): this profile is shown as Service provider.
    { value: 'partner', icon: Building2, title: t('signupV2.type.partner', 'Service provider'), desc: t('signupV2.type.partnerDesc', 'Products, services or expertise for marinas') },
    { value: 'investor', icon: TrendingUp, title: t('signupV2.type.investor', 'Investor'), desc: t('signupV2.type.investorDesc', 'A fund, a family office or a strategic investor') },
    { value: 'developer', icon: HardHat, title: t('signupV2.type.developer', 'Developer'), desc: t('signupV2.type.developerDesc', 'Marina developer, real-estate group or builder') },
    { value: 'media_partner', icon: Newspaper, title: t('signupV2.type.media', 'Media'), desc: t('signupV2.type.mediaDesc', 'A magazine, a website or a news agency') },
    { value: 'participant', icon: Ticket, title: t('signupV2.type.participant', "No company — I'm here for events and content"), desc: t('signupV2.type.participantDesc', 'Events, the library and the directory. You can add a company later.') },
  ];
}

/**
 * The six profile cards as one radio group (arrow keys move between them, as for
 * native radios). Two columns from 640 px; the "No company" card spans both.
 */
export function TypeCards({
  value,
  onChange,
  only,
  legend,
  error,
}: {
  value: SignupType | null;
  onChange: (v: SignupType) => void;
  /** Restrict the cards (Add my company: the five company types). */
  only?: SignupType[];
  legend: string;
  error?: string | null;
}) {
  const types = useSignupTypes().filter((d) => !only || only.includes(d.value));
  const name = useId();
  return (
    <fieldset className="space-y-3">
      <legend className="mb-3 text-sm font-semibold leading-5 text-navy">{legend}</legend>
      <div className="grid grid-cols-2 gap-2.5">
        {types.map((d) => {
          const on = value === d.value;
          const Icon = d.icon;
          return (
            <label
              key={d.value}
              className={cn(
                'relative flex min-h-[64px] cursor-pointer items-center gap-2.5 rounded-card border bg-white p-3 text-left transition-colors sm:items-start sm:gap-3 sm:p-3.5',
                'focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2',
                on ? 'border-navy bg-chip/60 ring-1 ring-navy' : 'border-rule hover:border-navy/40',
                d.value === 'participant' && 'col-span-2',
              )}
            >
              <input
                type="radio"
                name={name}
                value={d.value}
                aria-label={`${d.title}. ${d.desc}`}
                checked={on}
                onChange={() => onChange(d.value)}
                className="sr-only"
              />
              <span aria-hidden="true" className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-field sm:h-10 sm:w-10', on ? 'bg-navy text-white' : 'bg-chip text-navy')}>
                <Icon className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold leading-5 text-navy">{d.title}</span>
                {/* Phones: two cards a row, the title alone (the No company card keeps its line). */}
                <span className={cn('mt-0.5 text-[13px] leading-5 text-meta', d.value === 'participant' ? 'block' : 'hidden sm:block')}>{d.desc}</span>
              </span>
              {on && <Check aria-hidden="true" className="absolute right-2 top-2 h-4 w-4 text-navy sm:static sm:mt-0.5 sm:shrink-0" strokeWidth={2.5} />}
            </label>
          );
        })}
      </div>
      {error && <p role="alert" className="text-sm leading-5 text-red-700">{error}</p>}
    </fieldset>
  );
}

/** The canonical spelling of a typed country (case-insensitive match on the shared list), else the text as typed. */
export function canonicalCountry(raw: string): string {
  const v = raw.trim();
  if (!v) return '';
  return COUNTRIES.find((c) => c.toLowerCase() === v.toLowerCase()) ?? v;
}

/**
 * A searchable country: a text field with the shared list as suggestions (the
 * browser's own list, which phones show above the keyboard). Free text is kept,
 * matched to the list's spelling when it is one of them.
 */
export function CountryField({
  id,
  label,
  value,
  onChange,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}) {
  const { t } = useTranslation();
  const listId = `${id}-list`;
  return (
    <div className="space-y-2">
      <AuthLabel htmlFor={id}>{label}</AuthLabel>
      <AuthInput
        id={id}
        list={listId}
        autoComplete="country-name"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => onChange(canonicalCountry(e.target.value))}
        placeholder={t('signupV2.countryPlaceholder', 'Start typing, e.g. France')}
      />
      <datalist id={listId}>
        {COUNTRIES.filter((c) => c !== 'Other').map((c) => <option key={c} value={c} />)}
      </datalist>
      {hint && <FieldHint>{hint}</FieldHint>}
    </div>
  );
}

interface SectorRow { id: string; slug: string; label: string }

let sectorsCache: SectorRow[] | null = null;

/** The active sectors (public table), read once per page load. */
export function useSectors(): SectorRow[] | null {
  const [rows, setRows] = useState<SectorRow[] | null>(sectorsCache);
  useEffect(() => {
    if (sectorsCache) return;
    let alive = true;
    void (async () => {
      try {
        const { data } = await supabase.from('sectors').select('id, slug, label').eq('is_active', true).order('label');
        const list = ((data ?? []) as SectorRow[]).filter((s) => s && s.id && s.label);
        sectorsCache = list;
        if (alive) setRows(list);
      } catch {
        if (alive) setRows([]);
      }
    })();
    return () => { alive = false; };
  }, []);
  return rows;
}

export const MAX_SECTORS = 5;

/**
 * Sectors of interest as chips, grouped under the six themes (src/lib/themes.ts),
 * up to five. A sector in no theme shows under "Other". Nothing to choose when the
 * list cannot be read: the field is optional.
 */
export function SectorChips({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const { t } = useTranslation();
  const sectors = useSectors();
  if (sectors === null) return <p className="text-[13px] text-meta">{t('common.loading', 'Loading...')}</p>;
  if (sectors.length === 0) return null;
  const full = value.length >= MAX_SECTORS;
  const toggle = (id: string) => {
    if (value.includes(id)) onChange(value.filter((x) => x !== id));
    else if (!full) onChange([...value, id]);
  };
  const themed = new Set(THEMES.flatMap((th) => th.sectors));
  const groups = [
    ...THEMES.map((th) => ({ key: th.key, label: t(th.labelKey, th.fallback), rows: sectors.filter((s) => th.sectors.includes(s.slug)) })),
    { key: 'other', label: t('signupV2.sectorsOther', 'Other'), rows: sectors.filter((s) => !themed.has(s.slug)) },
  ].filter((g) => g.rows.length > 0);
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-semibold leading-5 text-navy">
        {t('signupV2.sectors', 'What interests you')}{' '}
        <span className="font-normal text-meta">{t('signupV2.sectorsCount', { count: value.length, max: MAX_SECTORS, defaultValue: '({{count}} of {{max}})' })}</span>
      </legend>
      {groups.map((g) => (
        <div key={g.key}>
          <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-[0.06em] text-meta">{g.label}</p>
          <div className="flex flex-wrap gap-2">
            {g.rows.map((s) => {
              const on = value.includes(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={on}
                  disabled={!on && full}
                  onClick={() => toggle(s.id)}
                  className={cn(
                    'inline-flex min-h-10 max-w-full items-center gap-1.5 rounded-full border px-3.5 text-left text-sm font-medium leading-5 transition-colors',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                    on ? 'border-navy bg-navy text-white' : 'border-rule bg-white text-ink hover:border-navy/40',
                    !on && full && 'cursor-not-allowed opacity-50',
                  )}
                >
                  {on && <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" strokeWidth={2.5} />}
                  <span className="[overflow-wrap:anywhere]">{s.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {full && <FieldHint>{t('signupV2.sectorsFull', 'Five chosen: remove one to pick another.')}</FieldHint>}
    </fieldset>
  );
}

/** The bottom bar of a long form on phones: the primary button stays in reach (sticky below 640 px). */
export const STICKY_ACTIONS = 'max-sm:sticky max-sm:bottom-0 max-sm:z-10 max-sm:-mx-6 max-sm:border-t max-sm:border-rule max-sm:bg-white max-sm:px-6 max-sm:pb-[max(0.75rem,env(safe-area-inset-bottom))] max-sm:pt-3';
