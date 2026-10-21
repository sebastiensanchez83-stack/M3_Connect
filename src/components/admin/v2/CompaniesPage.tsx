import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Building2, Download, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ActionCue, CardLink } from '@/components/home/dashboard/DashboardKit';
import { TIER_LABELS, type OrgTier } from '@/types/database';
import {
  AdminEmpty, AdminFilterBar, AdminLoading, AdminPageHeader, AdminStatus, AdminStatusPill, AdminTableCard, ADMIN_BTN,
} from '../AdminUI';
import { Note } from './MembersKit';
import { directoryCsv, loadDirectory, TYPE_LABEL, type DirectoryRow } from './membersApi';

/**
 * Members > Companies (Victor, 21 Oct 2026): ONE list for everyone. Every company, and every
 * person who belongs to none, as a row under their own name with the "Individual" tag. There is
 * no separate people list: a person's page opens from their company or from the search.
 * Filters live in the address (?type=&status=&country=&plan=&q=) so a link keeps them.
 * Desktop: a table; phone: one card per row. Every row is a link with its "Open" pill.
 */

const TYPES = ['marina', 'partner', 'media_partner', 'developer', 'investor', 'individual'];
const STATUSES = ['verified', 'pending', 'rejected', 'suspended', 'archived'];
const PLANS: OrgTier[] = ['member', 'innovation_partner', 'associate_partner', 'premium_partner', 'premium_sponsor', 'main_sponsor'];

function Avatar({ row }: { row: DirectoryRow }) {
  return (
    <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-xl border border-rule bg-white">
      {row.logoUrl ? (
        <img src={row.logoUrl} alt="" className="h-full w-full object-contain p-0.5" />
      ) : row.kind === 'individual' ? (
        <User className="h-5 w-5 text-meta/70" aria-hidden="true" />
      ) : (
        <Building2 className="h-5 w-5 text-meta/70" aria-hidden="true" />
      )}
    </span>
  );
}

function Tags({ row }: { row: DirectoryRow }) {
  return (
    <>
      {row.kind === 'individual' && <AdminStatusPill tone="info" icon={User}>Individual</AdminStatusPill>}
      {row.archived ? <AdminStatusPill>Archived</AdminStatusPill> : row.duplicate ? <AdminStatusPill>Duplicate</AdminStatusPill> : <AdminStatus status={row.status} />}
    </>
  );
}

export function CompaniesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [rows, setRows] = useState<DirectoryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const type = params.get('type') || 'all';
  const status = params.get('status') || 'all';
  const country = params.get('country') || 'all';
  const plan = params.get('plan') || 'all';
  const q = params.get('q') || '';

  const set = (key: string, value: string) => {
    setParams(prev => {
      const next = new URLSearchParams(prev);
      if (!value || value === 'all') next.delete(key); else next.set(key, value);
      return next;
    }, { replace: true });
  };

  useEffect(() => {
    let alive = true;
    loadDirectory().then(r => { if (alive) setRows(r); }, (e: unknown) => { if (alive) { setRows([]); setError(e instanceof Error ? e.message : 'Could not load.'); } });
    return () => { alive = false; };
  }, []);

  const countries = useMemo(
    () => [...new Set((rows ?? []).map(r => r.country?.trim()).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b)),
    [rows],
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (rows ?? []).filter(r => {
      if (needle && ![r.name, r.domain, r.contactName, r.contactEmail, r.city].some(v => (v ?? '').toLowerCase().includes(needle))) return false;
      if (type !== 'all' && r.type !== type) return false;
      if (status === 'archived' ? !(r.archived || r.duplicate) : status !== 'all' && (r.status !== status || r.archived || r.duplicate)) return false;
      if (country !== 'all' && (r.country ?? '').trim() !== country) return false;
      if (plan === 'paying' ? !r.tier || r.tier === 'member' : plan !== 'all' && r.tier !== plan) return false;
      return true;
    });
  }, [rows, q, type, status, country, plan]);

  const exportCsv = () => {
    const blob = new Blob([directoryCsv(filtered, window.location.origin)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `smc-companies-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  if (!rows) return <AdminLoading />;

  const companies = rows.filter(r => r.kind === 'company').length;
  const individuals = rows.length - companies;
  const pending = rows.filter(r => r.status === 'pending' && !r.archived && !r.duplicate).length;
  const filtersOn = type !== 'all' || status !== 'all' || country !== 'all' || plan !== 'all' || !!q;

  return (
    <div>
      <AdminPageHeader
        title={t('adminMembers.list.title', 'Companies')}
        count={rows.length}
        description={t('adminMembers.list.desc', 'Every company, and every person without a company (tagged Individual). Press a row to open its page.')}
        meta={
          <>
            <span>{t('adminMembers.list.companies', { count: companies, defaultValue_one: '{{count}} company', defaultValue_other: '{{count}} companies' })}</span>
            <span aria-hidden="true">•</span>
            <span>{t('adminMembers.list.individuals', { count: individuals, defaultValue_one: '{{count}} individual', defaultValue_other: '{{count}} individuals' })}</span>
          </>
        }
        actions={
          <>
            {pending > 0 && <CardLink to="/admin/review?tab=people">{t('adminMembers.list.toValidate', { count: pending, defaultValue: 'To validate ({{count}})' })}</CardLink>}
            <Button type="button" variant="outline" className={ADMIN_BTN} onClick={exportCsv} disabled={filtered.length === 0}>
              <Download className="mr-2 h-4 w-4" aria-hidden="true" />
              {t('adminMembers.list.export', 'Download the list (CSV)')}
            </Button>
          </>
        }
      />

      {error && <div className="mb-4"><Note tone="warning">{error}</Note></div>}

      <AdminFilterBar
        search={q}
        onSearchChange={v => set('q', v)}
        searchPlaceholder={t('adminMembers.list.search', 'Search a name, an e-mail, a website…')}
        trailing={filtersOn ? (
          <Button type="button" variant="outline" className={ADMIN_BTN} onClick={() => setParams({}, { replace: true })}>
            {t('adminMembers.list.clear', 'Show everyone')}
          </Button>
        ) : undefined}
      >
        <Select value={type} onValueChange={v => set('type', v)}>
          <SelectTrigger className="w-full sm:w-44" aria-label={t('adminMembers.list.type', 'Type')}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('adminMembers.list.allTypes', 'All types')}</SelectItem>
            {TYPES.map(x => <SelectItem key={x} value={x}>{TYPE_LABEL[x]}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={v => set('status', v)}>
          <SelectTrigger className="w-full sm:w-44" aria-label={t('adminMembers.list.status', 'Status')}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('adminMembers.list.allStatuses', 'All statuses')}</SelectItem>
            {STATUSES.map(x => <SelectItem key={x} value={x}>{x === 'archived' ? 'Archived or duplicate' : x.charAt(0).toUpperCase() + x.slice(1)}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={country} onValueChange={v => set('country', v)}>
          <SelectTrigger className="w-full sm:w-44" aria-label={t('adminMembers.list.country', 'Country')}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('adminMembers.list.allCountries', 'All countries')}</SelectItem>
            {countries.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={plan} onValueChange={v => set('plan', v)}>
          <SelectTrigger className="w-full sm:w-48" aria-label={t('adminMembers.list.plan', 'Sponsor plan')}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('adminMembers.list.allPlans', 'All plans')}</SelectItem>
            <SelectItem value="paying">{t('adminMembers.list.paying', 'Sponsors only (any paying plan)')}</SelectItem>
            {PLANS.map(x => <SelectItem key={x} value={x}>{TIER_LABELS[x]}</SelectItem>)}
          </SelectContent>
        </Select>
      </AdminFilterBar>

      {filtered.length === 0 ? (
        <div className="rounded-card border border-rule bg-white">
          <AdminEmpty icon={Building2} title={t('adminMembers.list.none', 'Nobody matches these filters')} />
        </div>
      ) : (
        <>
          {/* Phone: one card per row */}
          <ul className="space-y-3 md:hidden" aria-label={t('adminMembers.list.title', 'Companies')}>
            {filtered.map(r => (
              <li key={`${r.kind}:${r.id}`}>
                <Link to={r.href} className="group block rounded-card border border-rule bg-white p-4 focus:outline-none focus-visible:shadow-focus">
                  <div className="flex items-start gap-3">
                    <Avatar row={r} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[16px] font-semibold leading-6 text-navy [overflow-wrap:anywhere]">{r.name}</p>
                      <p className="text-[13px] leading-5 text-meta">
                        {[r.type ? TYPE_LABEL[r.type] ?? r.type : null, [r.city, r.country].filter(Boolean).join(', ') || null].filter(Boolean).join(' · ')}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5"><Tags row={r} /></div>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <span className="text-[13px] text-meta">
                      {r.kind === 'company'
                        ? t('adminMembers.list.people', { count: r.members, defaultValue_one: '{{count}} person', defaultValue_other: '{{count}} people' })
                        : r.contactEmail}
                    </span>
                    <ActionCue size="sm">{t('adminMembers.list.open', 'Open')}</ActionCue>
                  </div>
                </Link>
              </li>
            ))}
          </ul>

          {/* Desktop: the table */}
          <AdminTableCard className="hidden md:block" footer={t('adminMembers.list.footer', '{{shown}} of {{total}} shown', { shown: filtered.length, total: rows.length })}>
            <table className="w-full">
              <thead>
                <tr>
                  <th className="text-left">{t('adminMembers.list.colName', 'Name')}</th>
                  <th className="text-left">{t('adminMembers.list.colType', 'Type')}</th>
                  <th className="text-left">{t('adminMembers.list.colStatus', 'Status')}</th>
                  <th className="text-left">{t('adminMembers.list.colPlan', 'Plan')}</th>
                  <th className="text-left">{t('adminMembers.list.colPlace', 'Country')}</th>
                  <th className="hidden text-left 2xl:table-cell">{t('adminMembers.list.colContact', 'Person in charge')}</th>
                  <th className="text-left"><span className="sr-only">{t('adminMembers.list.colOpen', 'Open')}</span></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={`${r.kind}:${r.id}`} className="group cursor-pointer" onClick={() => navigate(r.href)}>
                    <td>
                      <div className="flex items-center gap-3">
                        <Avatar row={r} />
                        <div className="min-w-0">
                          <Link to={r.href} onClick={e => e.stopPropagation()} className="rounded-sm font-semibold text-navy focus:outline-none focus-visible:shadow-focus">
                            <span className="card-ul">{r.name}</span>
                          </Link>
                          <div className="text-[12px] text-meta [overflow-wrap:anywhere]">{r.kind === 'individual' ? r.contactEmail : [t('adminMembers.list.people', { count: r.members, defaultValue_one: '{{count}} person', defaultValue_other: '{{count}} people' }), r.contactName ? t('adminMembers.list.inCharge', '{{name}} in charge', { name: r.contactName }) : null].filter(Boolean).join(' · ')}</div>
                        </div>
                      </div>
                    </td>
                    <td className="whitespace-nowrap text-sm text-ink">
                      {r.kind === 'individual' ? <AdminStatusPill tone="info" icon={User}>Individual</AdminStatusPill> : r.type ? TYPE_LABEL[r.type] ?? r.type : <span className="text-meta/60">—</span>}
                    </td>
                    <td>{r.archived ? <AdminStatusPill>Archived</AdminStatusPill> : r.duplicate ? <AdminStatusPill>Duplicate</AdminStatusPill> : <AdminStatus status={r.status} />}</td>
                    <td className="whitespace-nowrap text-sm text-ink">{r.tier ? TIER_LABELS[r.tier as OrgTier] ?? r.tier : <span className="text-meta/60">—</span>}</td>
                    <td className="text-sm text-ink">{[r.city, r.country].filter(Boolean).join(', ') || <span className="text-meta/60">—</span>}</td>
                    <td className="hidden text-sm text-ink 2xl:table-cell">{r.kind === 'company' ? r.contactName || <span className="text-meta/60">—</span> : <span className="text-meta/60">—</span>}</td>
                    <td className="text-right"><ActionCue size="sm">{t('adminMembers.list.open', 'Open')}</ActionCue></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </AdminTableCard>
        </>
      )}
    </div>
  );
}
