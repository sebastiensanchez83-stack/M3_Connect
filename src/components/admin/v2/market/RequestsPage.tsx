import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Building2, ClipboardList, Download, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ActionCue } from '@/components/home/dashboard/DashboardKit';
import {
  AdminEmpty, AdminFilterBar, AdminLoading, AdminPageHeader, AdminStatusPill, AdminTableCard, ADMIN_BTN, statusTone,
} from '../../AdminUI';
import { Note } from '../MembersKit';
import { fmtDate } from '../membersApi';
import { loadRequests, requestsCsv, type RequestRow } from './marketApi';
import {
  isRequestKind, KIND_LABEL, KIND_SHORT, REQUEST_KINDS, STATUS_FILTERS, statusFilterOf, statusName, type RequestKind,
} from './marketKinds';

/**
 * Admin > Marketplace > Marina requests (Victor, 21 Oct 2026: "Les demandes du marché ne vont pas
 * au bout"). ONE list for the four kinds that were four screens: requests for proposals,
 * consultations, marina projects and partner leads. The ones waiting for M3's answer come first.
 * Filters live in the address (?kind=&status=&company=&when=&q=) so a link keeps them; the old
 * screens' addresses land here (/admin/rfps?status=… → ?kind=rfp&status=…).
 * Desktop: a table; phone: one card per request. Every row opens the request's page, where M3
 * answers (status, message and e-mail, corrections, notes): VIEW here, ACT there.
 */

const PERIODS: { value: string; label: string; days: number }[] = [
  { value: '7', label: 'Last 7 days', days: 7 },
  { value: '30', label: 'Last 30 days', days: 30 },
  { value: '90', label: 'Last 3 months', days: 90 },
  { value: '365', label: 'Last 12 months', days: 365 },
];

const KIND_TONE: Record<RequestKind, 'info' | 'navy' | 'neutral'> = { rfp: 'info', consultation: 'info', project: 'info', lead: 'neutral' };

function Pills({ row }: { row: RequestRow }) {
  return (
    <>
      <AdminStatusPill tone={KIND_TONE[row.kind]}>{KIND_SHORT[row.kind]}</AdminStatusPill>
      <AdminStatusPill tone={statusTone(row.status)}>{statusName(row.kind, row.status)}</AdminStatusPill>
    </>
  );
}

/** The company, as a link to its admin page when the request has one; plain words otherwise. */
function CompanyLink({ row, className }: { row: RequestRow; className?: string }) {
  const { t } = useTranslation();
  if (row.orgId && row.orgName) {
    return (
      <Link
        to={`/admin/companies/${row.orgId}`}
        onClick={e => e.stopPropagation()}
        title={t('adminMarket.list.openCompany', 'Open the company page of {{name}}', { name: row.orgName })}
        className={`inline-flex items-center gap-1 rounded-sm font-semibold text-navy underline decoration-navy/40 underline-offset-2 hover:decoration-navy focus:outline-none focus-visible:shadow-focus ${className ?? ''}`}
      >
        <Building2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="[overflow-wrap:anywhere]">{row.orgName}</span>
      </Link>
    );
  }
  return <span className={`text-meta ${className ?? ''}`}>{row.orgName || t('adminMarket.list.noCompany', 'No company')}</span>;
}

export function RequestsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [rows, setRows] = useState<RequestRow[] | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);

  const kindParam = params.get('kind');
  const kind: RequestKind | 'all' = isRequestKind(kindParam) ? kindParam : 'all';
  const status = statusFilterOf(params.get('status')) ?? 'all';
  const company = params.get('company') || 'all';
  const when = PERIODS.some(p => p.value === params.get('when')) ? params.get('when')! : 'all';
  const q = params.get('q') || '';

  const set = (key: string, value: string) => {
    setParams(prev => {
      const next = new URLSearchParams(prev);
      if (!value || value === 'all') next.delete(key); else next.set(key, value);
      return next;
    }, { replace: true });
  };

  const load = () => {
    setReloading(true);
    return loadRequests().then(
      r => { setRows(r.rows); setProblems(r.problems); setError(null); },
      (e: unknown) => { setRows(prev => prev ?? []); setError(e instanceof Error ? e.message : 'The requests could not be read.'); },
    ).finally(() => setReloading(false));
  };
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const companies = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows ?? []) if (r.orgId && r.orgName) m.set(r.orgId, r.orgName);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const period = PERIODS.find(p => p.value === when);
    const since = period ? Date.now() - period.days * 86400000 : null;
    const statusFilter = STATUS_FILTERS.find(f => f.value === status);
    return (rows ?? []).filter(r => {
      if (kind !== 'all' && r.kind !== kind) return false;
      if (statusFilter && !statusFilter.match(r.kind, r.status, r.waiting)) return false;
      if (company === 'none' ? !!r.orgId : company !== 'all' && r.orgId !== company) return false;
      if (since !== null && !(Date.parse(r.createdAt) >= since)) return false;
      if (needle && ![r.title, r.summary, r.orgName, r.authorName, r.authorEmail].some(v => (v ?? '').toLowerCase().includes(needle))) return false;
      return true;
    });
  }, [rows, kind, status, company, when, q]);

  const exportCsv = () => {
    const blob = new Blob([requestsCsv(filtered, window.location.origin)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `smc-marina-requests-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  if (!rows) return <AdminLoading />;

  const waiting = rows.filter(r => r.waiting).length;
  const filtersOn = kind !== 'all' || status !== 'all' || company !== 'all' || when !== 'all' || !!q;
  const byKind = (k: RequestKind) => rows.filter(r => r.kind === k).length;

  return (
    <div>
      <AdminPageHeader
        title={t('adminMarket.list.title', 'Marina requests')}
        count={rows.length}
        description={t('adminMarket.list.desc', 'Requests for proposals, consultations, marina projects and partner leads, in one list. The ones waiting for an answer come first. Press a request to open it and answer.')}
        meta={
          <>
            {waiting > 0
              ? <AdminStatusPill tone="warning">{t('adminMarket.list.waitingCount', { count: waiting, defaultValue_one: '{{count}} waiting for an answer', defaultValue_other: '{{count}} waiting for an answer' })}</AdminStatusPill>
              : <span>{t('adminMarket.list.noneWaiting', 'Nothing is waiting for an answer.')}</span>}
            {REQUEST_KINDS.map(k => (
              <span key={k}>{KIND_LABEL[k]}: {byKind(k)}</span>
            ))}
          </>
        }
        actions={
          <>
            <Button type="button" variant="outline" className={ADMIN_BTN} onClick={() => void load()} disabled={reloading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${reloading ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden="true" />
              {t('adminMarket.list.reload', 'Check for new ones')}
            </Button>
            <Button type="button" variant="outline" className={ADMIN_BTN} onClick={exportCsv} disabled={filtered.length === 0}>
              <Download className="mr-2 h-4 w-4" aria-hidden="true" />
              {t('adminMarket.list.export', 'Download this list (CSV)')}
            </Button>
          </>
        }
      />

      {error && <div className="mb-4"><Note tone="warning">{error}</Note></div>}
      {problems.map(p => <div key={p} className="mb-4"><Note tone="warning">{p}</Note></div>)}

      <AdminFilterBar
        search={q}
        onSearchChange={v => set('q', v)}
        searchPlaceholder={t('adminMarket.list.search', 'Search a title, a company, a name, an e-mail…')}
        trailing={filtersOn ? (
          <Button type="button" variant="outline" className={ADMIN_BTN} onClick={() => setParams({}, { replace: true })}>
            {t('adminMarket.list.clear', 'Show every request')}
          </Button>
        ) : undefined}
      >
        <Select value={kind} onValueChange={v => set('kind', v)}>
          <SelectTrigger className="w-full sm:w-52" aria-label={t('adminMarket.list.kind', 'Kind of request')}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('adminMarket.list.allKinds', 'All kinds')}</SelectItem>
            {REQUEST_KINDS.map(k => <SelectItem key={k} value={k}>{KIND_LABEL[k]}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={v => set('status', v)}>
          <SelectTrigger className="w-full sm:w-60" aria-label={t('adminMarket.list.status', 'Status')}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('adminMarket.list.allStatuses', 'All statuses')}</SelectItem>
            {STATUS_FILTERS.map(f => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={company} onValueChange={v => set('company', v)}>
          <SelectTrigger className="w-full sm:w-52" aria-label={t('adminMarket.list.company', 'Company')}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('adminMarket.list.allCompanies', 'All companies')}</SelectItem>
            <SelectItem value="none">{t('adminMarket.list.noCompanyFilter', 'No company on the platform')}</SelectItem>
            {companies.map(([id, name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={when} onValueChange={v => set('when', v)}>
          <SelectTrigger className="w-full sm:w-44" aria-label={t('adminMarket.list.when', 'Sent')}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('adminMarket.list.anyDate', 'Any date')}</SelectItem>
            {PERIODS.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </AdminFilterBar>

      {rows.length === 0 ? (
        <div className="rounded-card border border-rule bg-white">
          <AdminEmpty
            icon={ClipboardList}
            title={t('adminMarket.list.empty', 'No marina request yet')}
            body={t('adminMarket.list.emptyBody', 'When a marina publishes a request for proposals, asks a consultation or submits a project, or a company fills the partner form, it shows here.')}
          />
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-card border border-rule bg-white">
          <AdminEmpty
            icon={ClipboardList}
            title={t('adminMarket.list.none', 'No request matches these filters')}
            action={<Button type="button" variant="outline" className={ADMIN_BTN} onClick={() => setParams({}, { replace: true })}>{t('adminMarket.list.clear', 'Show every request')}</Button>}
          />
        </div>
      ) : (
        <>
          {/* Phone: one card per request */}
          <ul className="space-y-3 md:hidden" aria-label={t('adminMarket.list.title', 'Marina requests')}>
            {filtered.map(r => (
              <li key={`${r.kind}:${r.id}`} className={`overflow-hidden rounded-card border bg-white ${r.waiting ? 'border-gold' : 'border-rule'}`}>
                <Link to={r.href} className="group block p-4 focus:outline-none focus-visible:[box-shadow:inset_0_0_0_2px_#0b2653]">
                  <div className="flex flex-wrap gap-1.5"><Pills row={r} /></div>
                  <p className="mt-2 text-[16px] font-semibold leading-6 text-navy [overflow-wrap:anywhere]">{r.title}</p>
                  {r.summary && <p className="mt-0.5 line-clamp-2 text-[14px] leading-5 text-meta">{r.summary}</p>}
                  <p className="mt-1.5 text-[13px] leading-5 text-meta">
                    {[r.authorName, t('adminMarket.list.sentOn', 'sent {{date}}', { date: fmtDate(r.createdAt) })].filter(Boolean).join(' · ')}
                  </p>
                  <div className="mt-3 flex justify-end">
                    <ActionCue size="sm">{r.waiting ? t('adminMarket.list.answer', 'Open and answer') : t('adminMarket.list.open', 'Open')}</ActionCue>
                  </div>
                </Link>
                <div className="border-t border-rule px-4 py-2.5 text-[14px] leading-5">
                  <span className="text-meta">{t('adminMarket.list.companyLabel', 'Company:')} </span>
                  <CompanyLink row={r} />
                </div>
              </li>
            ))}
          </ul>

          {/* Desktop: the table */}
          <AdminTableCard className="hidden md:block" footer={t('adminMarket.list.footer', '{{shown}} of {{total}} shown', { shown: filtered.length, total: rows.length })}>
            <table className="w-full">
              <thead>
                <tr>
                  <th className="text-left">{t('adminMarket.list.colKind', 'Kind')}</th>
                  <th className="text-left">{t('adminMarket.list.colTitle', 'Request')}</th>
                  <th className="text-left">{t('adminMarket.list.colCompany', 'Company')}</th>
                  <th className="text-left">{t('adminMarket.list.colDate', 'Sent on')}</th>
                  <th className="text-left">{t('adminMarket.list.colStatus', 'Status')}</th>
                  <th className="text-left"><span className="sr-only">{t('adminMarket.list.colOpen', 'Open')}</span></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={`${r.kind}:${r.id}`} className="group cursor-pointer" onClick={() => navigate(r.href)}>
                    <td className="whitespace-nowrap"><AdminStatusPill tone={KIND_TONE[r.kind]}>{KIND_SHORT[r.kind]}</AdminStatusPill></td>
                    <td>
                      <Link to={r.href} onClick={e => e.stopPropagation()} className="rounded-sm font-semibold text-navy focus:outline-none focus-visible:shadow-focus">
                        <span className="card-ul [overflow-wrap:anywhere]">{r.title}</span>
                      </Link>
                      <div className="text-[12px] text-meta [overflow-wrap:anywhere]">
                        {[r.authorName, r.summary].filter(Boolean).join(' · ')}
                      </div>
                    </td>
                    <td className="text-sm"><CompanyLink row={r} /></td>
                    <td className="whitespace-nowrap text-sm text-ink">{fmtDate(r.createdAt)}</td>
                    <td>
                      <div className="flex flex-wrap gap-1.5">
                        <AdminStatusPill tone={statusTone(r.status)}>{statusName(r.kind, r.status)}</AdminStatusPill>
                      </div>
                    </td>
                    <td className="text-right">
                      <ActionCue size="sm" className="whitespace-nowrap">{r.waiting ? t('adminMarket.list.answer', 'Open and answer') : t('adminMarket.list.open', 'Open')}</ActionCue>
                    </td>
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
