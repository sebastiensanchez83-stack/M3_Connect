import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Minus, RefreshCw, ShieldCheck, TrendingDown, TrendingUp, Users, Equal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import {
  CAPABILITIES,
  CAPABILITY_LABELS,
  CAPABILITY_ORG_TYPES,
  CAPABILITY_ORG_TYPE_LABELS,
  type Capability,
  type CapabilityOrgType,
} from '@/lib/capabilities';
import { readRegistrationFlags } from '@/lib/flags';
import {
  ADMIN_BTN,
  AdminEmpty,
  AdminKpiCard,
  AdminLoading,
  AdminPageHeader,
  AdminPanel,
  AdminStatusPill,
  AdminTableCard,
} from './AdminUI';

/**
 * Admin → Rights (/admin/rights). Read-only for now.
 *
 *  - The rights per company type, as the database holds them (org_type_capability,
 *    seeded from Victor's table of 6-7 Oct and his answers of 9 Oct 2026).
 *  - What the switch would change: capability_shadow_report() compares, for every
 *    person who is not M3 staff, their rights today with the rights the table gives
 *    them. Only counts are shown here (the report itself carries ids only).
 *  - Whether the site enforces the table (registration_flags.capabilities_enforced,
 *    read by src/lib/flags.ts), which the held migration
 *    supabase/migrations/held/capabilities_enforce.sql turns on together with the
 *    database policies, on the day the refonte goes live (docs/rights-switch-runbook.md).
 *  - The one person-level exception (Victor, 11 Oct 2026): a verified person who is
 *    an SM26-confirmed investor sees Deal flow, company or not: a frozen list
 *    (capability_person_grant, copied once from the SM26 registrations; sm26_investor
 *    in the report).
 */

interface ShadowRow {
  user_id: string;
  person_status: string | null;
  persona: string | null;
  company_ids: string[] | null;
  company_types: string[] | null;
  current_caps: string[] | null;
  new_caps: string[] | null;
  gained: string[] | null;
  lost: string[] | null;
  /** An SM26-confirmed investor: sees Deal flow whatever their company (11 Oct 2026). */
  sm26_investor: boolean | null;
}

/** The six columns of the table (pending has no right and is said in a sentence). */
const MATRIX_TYPES: CapabilityOrgType[] = CAPABILITY_ORG_TYPES.filter((ty) => ty !== 'pending');

const typeLabel = (ty: string) => CAPABILITY_ORG_TYPE_LABELS[ty as CapabilityOrgType] ?? ty;

export function AdminRights() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [matrix, setMatrix] = useState<Set<string>>(new Set());
  const [rows, setRows] = useState<ShadowRow[]>([]);
  const [reportError, setReportError] = useState<string | null>(null);
  // null = the switch could not be read (src/lib/flags.ts gives up after four seconds).
  const [enforced, setEnforced] = useState<boolean | null>(false);
  // Validated companies with no type give their members no right but proposing a
  // webinar: M3 should never validate one (null = could not be counted).
  const [untyped, setUntyped] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setReportError(null);
    const [table, report, flag, untypedCount] = await Promise.all([
      supabase.from('org_type_capability').select('org_type, capability'),
      supabase.rpc('capability_shadow_report'),
      readRegistrationFlags(true),
      supabase.from('organizations').select('id', { count: 'exact', head: true })
        .eq('access_status', 'verified').is('organization_type', null),
    ]);
    setEnforced(flag ? flag.capabilities_enforced : null);
    setUntyped(untypedCount.error ? null : untypedCount.count ?? 0);
    if (table.error) {
      // 42P01 / PGRST205: the shadow migration is not applied yet.
      setMissing(true);
      setMatrix(new Set());
      setRows([]);
    } else {
      setMissing(false);
      setMatrix(new Set(((table.data ?? []) as { org_type: string; capability: string }[]).map((r) => `${r.org_type}:${r.capability}`)));
      if (report.error) {
        setReportError(report.error.message);
        setRows([]);
      } else {
        setRows((report.data ?? []) as ShadowRow[]);
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const has = (ty: string, cap: string) => matrix.has(`${ty}:${cap}`);

  const stats = useMemo(() => {
    const verified = rows.filter((r) => r.person_status === 'verified');
    const gainers = verified.filter((r) => (r.gained ?? []).length > 0);
    const losers = verified.filter((r) => (r.lost ?? []).length > 0);
    const unchanged = verified.length - verified.filter((r) => (r.gained ?? []).length > 0 || (r.lost ?? []).length > 0).length;
    const notVerified = rows.length - verified.length;
    const notVerifiedChanged = rows.filter((r) => r.person_status !== 'verified' && ((r.gained ?? []).length > 0 || (r.lost ?? []).length > 0)).length;
    // SM26-confirmed investors, and those who see Deal flow through that exception alone.
    const sm26 = verified.filter((r) => r.sm26_investor === true);
    const sm26Only = sm26.filter((r) => !(r.company_types ?? []).includes('investor')).length;

    const byCap = CAPABILITIES.map((cap) => ({
      cap,
      today: verified.filter((r) => (r.current_caps ?? []).includes(cap)).length,
      after: verified.filter((r) => (r.new_caps ?? []).includes(cap)).length,
      gain: verified.filter((r) => (r.gained ?? []).includes(cap)).length,
      lose: verified.filter((r) => (r.lost ?? []).includes(cap)).length,
    }));

    // By the company types that give the person their rights ("none" = no validated, typed company).
    const groups = new Map<string, { people: number; gain: number; lose: number; same: number }>();
    for (const r of verified) {
      const types = [...(r.company_types ?? [])].sort();
      const key = types.length ? types.map(typeLabel).join(' + ') : t('adminRights.noCompanyType', 'No validated, typed company');
      const g = groups.get(key) ?? { people: 0, gain: 0, lose: 0, same: 0 };
      g.people += 1;
      const gained = (r.gained ?? []).length > 0;
      const lost = (r.lost ?? []).length > 0;
      if (gained) g.gain += 1;
      if (lost) g.lose += 1;
      if (!gained && !lost) g.same += 1;
      groups.set(key, g);
    }
    const byType = [...groups.entries()].sort((a, b) => b[1].people - a[1].people);

    return { verified: verified.length, gainers: gainers.length, losers: losers.length, unchanged, notVerified, notVerifiedChanged, sm26: sm26.length, sm26Only, byCap, byType };
  }, [rows, t]);

  if (loading) return <AdminLoading />;

  const header = (
    <AdminPageHeader
      title={t('adminRights.title', 'Rights')}
      description={t('adminRights.description', 'What each type of company can do on the platform, and what the switch would change. Read-only for now.')}
      meta={enforced === null ? (
        <AdminStatusPill tone="neutral" title={t('adminRights.switchUnknownHint', 'registration_flags could not be read. Press Refresh to try again.')}>
          {t('adminRights.switchUnknown', 'Switch state unknown')}
        </AdminStatusPill>
      ) : enforced ? (
        <AdminStatusPill tone="success" icon={ShieldCheck}>{t('adminRights.enforced', 'Enforced by the site and the database')}</AdminStatusPill>
      ) : (
        <AdminStatusPill tone="warning" title={t('adminRights.shadowHint', 'registration_flags.capabilities_enforced is off: the site and the database keep today\'s rules.')}>
          {t('adminRights.notSwitchedOn', 'Not switched on: today\'s rules still apply')}
        </AdminStatusPill>
      )}
      actions={(
        <Button variant="outline" size="sm" className={ADMIN_BTN} onClick={() => void load()}>
          <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden="true" />
          {t('adminRights.refresh', 'Refresh')}
        </Button>
      )}
    />
  );

  if (missing) {
    return (
      <div>
        {header}
        <AdminPanel>
          <AdminEmpty
            icon={ShieldCheck}
            title={t('adminRights.missingTitle', 'The rights table is not in the database yet')}
            body={t('adminRights.missingBody', 'It arrives with the migration 20261011090000_capabilities_shadow. Until then, today\'s rules apply everywhere.')}
          />
        </AdminPanel>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {header}

      {/* ── The table ── */}
      <section aria-labelledby="rights-matrix-heading" className="space-y-3">
        <div>
          <h2 id="rights-matrix-heading" className="text-[18px] font-semibold leading-6 text-navy">{t('adminRights.matrixTitle', 'Rights by company type')}</h2>
          <p className="mt-1 max-w-3xl text-[14px] leading-5 text-meta">
            {t('adminRights.matrixLead', 'A person gets the rights of every validated, typed company they belong to. A suspended, pending or untyped company counts as none: the person is a participant. People not verified yet have no right. M3 staff keep everything.')}
          </p>
          {untyped !== null && (
            <p className={untyped > 0
              ? 'mt-3 max-w-3xl rounded-field border border-amber-300 bg-amber-50 px-4 py-3 text-[14px] leading-5 text-amber-900'
              : 'mt-1 text-[13px] leading-5 text-meta'}
            >
              {untyped > 0
                ? t('adminRights.untypedWarning', {
                  count: untyped,
                  defaultValue_one: '{{count}} validated company has no type: its members get no right but proposing a webinar. Set its type before the switch.',
                  defaultValue_other: '{{count}} validated companies have no type: their members get no right but proposing a webinar. Set their type before the switch.',
                })
                : t('adminRights.untypedNone', 'Validated companies without a type: none.')}
            </p>
          )}
        </div>
        <AdminTableCard footer={t('adminRights.matrixFooter', 'Marinas see the needs other marinas publish, read-only: they do not answer them. Sponsor tiers add no right.')}>
          <table className="w-full min-w-[720px]">
            <thead>
              <tr>
                <th scope="col" className="text-left">{t('adminRights.colRight', 'Right')}</th>
                {MATRIX_TYPES.map((ty) => (
                  <th key={ty} scope="col" className="text-center">{t(`adminRights.type.${ty}`, CAPABILITY_ORG_TYPE_LABELS[ty])}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CAPABILITIES.map((cap) => (
                <tr key={cap}>
                  <td className="text-left">
                    <span className="block text-[14px] font-semibold text-navy">{t(`adminRights.cap.${cap}`, CAPABILITY_LABELS[cap].label)}</span>
                    <span className="block text-[12px] leading-4 text-meta">{t(`adminRights.capHint.${cap}`, CAPABILITY_LABELS[cap].hint)}</span>
                  </td>
                  {MATRIX_TYPES.map((ty) => (
                    <td key={ty} className="text-center">
                      {/* Labelled icons, not sr-only text: an absolutely placed span inside the
                          sideways-scrolling table would widen the whole page on a phone. */}
                      {has(ty, cap) ? (
                        <span className="inline-flex flex-col items-center">
                          <Check className="h-4 w-4 text-teal" role="img" aria-label={t('adminRights.yes', 'Yes')} />
                          {ty === 'marina' && cap === 'see_opportunities' && (
                            <span className="mt-0.5 text-[11px] leading-4 text-meta">{t('adminRights.readOnly', 'read-only')}</span>
                          )}
                        </span>
                      ) : (
                        <Minus className="mx-auto h-4 w-4 text-meta/50" role="img" aria-label={t('adminRights.no', 'No')} />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </AdminTableCard>
        <p className="max-w-3xl text-[13px] leading-5 text-meta">
          {t('adminRights.sm26Exception', 'One exception, for a person rather than a company: the people M3 verified who were confirmed investors at Smart Marina 2026 also see Deal flow, with or without a company. Nothing else comes with it. The list was copied once from the event registrations and does not grow by itself. Their company does not affect it: to take Deal flow back from one of them, suspend the person, or ask for their exception to be removed (see docs/rights-switch-runbook.md).')}
        </p>
      </section>

      {/* ── What the switch changes ── */}
      <section aria-labelledby="rights-shadow-heading" className="space-y-3">
        <div>
          <h2 id="rights-shadow-heading" className="text-[18px] font-semibold leading-6 text-navy">
            {enforced ? t('adminRights.shadowTitleOn', 'Compared with the rules before the switch') : t('adminRights.shadowTitle', 'What the switch would change')}
          </h2>
          <p className="mt-1 max-w-3xl text-[14px] leading-5 text-meta">
            {t('adminRights.shadowLead', 'For every person who is not M3 staff: the rights the site and the database give today, against the rights of the table. Proposing a webinar is already open to every verified person, so it is not a change.')}
          </p>
        </div>

        {reportError ? (
          <AdminPanel>
            <AdminEmpty title={t('adminRights.reportError', 'The report could not be read')} body={reportError} />
          </AdminPanel>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <AdminKpiCard icon={Users} label={t('adminRights.kpiVerified', 'Verified people')} value={stats.verified} hint={t('adminRights.kpiVerifiedHint', 'M3 staff not counted')} />
              <AdminKpiCard icon={Equal} label={t('adminRights.kpiSame', 'Unchanged')} value={stats.unchanged} />
              <AdminKpiCard icon={TrendingUp} label={t('adminRights.kpiGain', 'Gain a right')} value={stats.gainers} tone="attention" />
              <AdminKpiCard icon={TrendingDown} label={t('adminRights.kpiLose', 'Lose a right')} value={stats.losers} tone="danger" />
            </div>
            <p className="text-[13px] leading-5 text-meta">
              {t('adminRights.notVerifiedLine', {
                count: stats.notVerified,
                changed: stats.notVerifiedChanged,
                defaultValue: '{{count}} people not verified yet: {{changed}} of them change.',
              })}
            </p>
            {stats.sm26 > 0 && (
              <p className="text-[13px] leading-5 text-meta">
                {t('adminRights.sm26Line', {
                  count: stats.sm26,
                  only: stats.sm26Only,
                  defaultValue_one: '{{count}} verified person is a confirmed investor at Smart Marina 2026. People who see Deal flow through that exception alone: {{only}}.',
                  defaultValue_other: '{{count}} verified people are confirmed investors at Smart Marina 2026. For {{only}} of them, Deal flow comes from that exception alone.',
                })}
              </p>
            )}

            <div className="grid gap-6 2xl:grid-cols-2">
              <AdminPanel title={t('adminRights.byRightTitle', 'By right')} description={t('adminRights.byRightDesc', 'Verified people who have it today and after the switch')} padded={false}>
                <div className="admin-table-scroll">
                  <table className="w-full min-w-[480px]">
                    <thead>
                      <tr>
                        <th scope="col" className="text-left">{t('adminRights.colRight', 'Right')}</th>
                        <th scope="col" className="text-right">{t('adminRights.colToday', 'Today')}</th>
                        <th scope="col" className="text-right">{t('adminRights.colAfter', 'After')}</th>
                        <th scope="col" className="text-right">{t('adminRights.colGain', 'Gain')}</th>
                        <th scope="col" className="text-right">{t('adminRights.colLose', 'Lose')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.byCap.map((c) => (
                        <tr key={c.cap}>
                          <td className="text-left font-medium text-navy">{t(`adminRights.cap.${c.cap}`, CAPABILITY_LABELS[c.cap as Capability].label)}</td>
                          <td className="text-right tabular-nums">{c.today}</td>
                          <td className="text-right tabular-nums">{c.after}</td>
                          <td className="text-right tabular-nums">{c.gain ? <span className="font-semibold text-teal-text">+{c.gain}</span> : 0}</td>
                          <td className="text-right tabular-nums">{c.lose ? <span className="font-semibold text-red-700">−{c.lose}</span> : 0}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </AdminPanel>

              <AdminPanel title={t('adminRights.byTypeTitle', 'By company type')} description={t('adminRights.byTypeDesc', 'The types of the validated companies each verified person belongs to')} padded={false}>
                <div className="admin-table-scroll">
                  <table className="w-full min-w-[480px]">
                    <thead>
                      <tr>
                        <th scope="col" className="text-left">{t('adminRights.colType', 'Company type')}</th>
                        <th scope="col" className="text-right">{t('adminRights.colPeople', 'People')}</th>
                        <th scope="col" className="text-right">{t('adminRights.colSame', 'Unchanged')}</th>
                        <th scope="col" className="text-right">{t('adminRights.colGain', 'Gain')}</th>
                        <th scope="col" className="text-right">{t('adminRights.colLose', 'Lose')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.byType.map(([key, g]) => (
                        <tr key={key}>
                          <td className="text-left font-medium text-navy">{key}</td>
                          <td className="text-right tabular-nums">{g.people}</td>
                          <td className="text-right tabular-nums">{g.same}</td>
                          <td className="text-right tabular-nums">{g.gain ? <span className="font-semibold text-teal-text">{g.gain}</span> : 0}</td>
                          <td className="text-right tabular-nums">{g.lose ? <span className="font-semibold text-red-700">{g.lose}</span> : 0}</td>
                        </tr>
                      ))}
                      {stats.byType.length === 0 && (
                        <tr><td colSpan={5}><AdminEmpty title={t('adminRights.nobody', 'Nobody to compare yet')} /></td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </AdminPanel>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
