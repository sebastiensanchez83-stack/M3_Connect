import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { Store } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { ActionCue } from '@/components/home/dashboard/DashboardKit';
import { supabase } from '@/lib/supabase';
import {
  AdminEmpty, AdminFilterBar, AdminLoading, AdminPageHeader, AdminStatusPill, AdminTableCard, ADMIN_BTN, type AdminTone,
} from './AdminUI';
import { LinkCard } from './v2/ContentFormKit';

interface ExpositionRequest {
  id: string; organization_id: string; event_id: string; requested_by: string;
  status: string; admin_notes: string | null; invoice_reference: string | null;
  amount_due: number | null; payment_confirmed_at: string | null; created_at: string;
  org_name: string; event_title: string; requester_email: string;
}

/** The steps of an old exhibition-stand request, in the admin tones. */
export const EXPOSITION_STATUS: Record<string, { label: string; tone: AdminTone }> = {
  pending: { label: 'Waiting for M3', tone: 'warning' },
  approved: { label: 'Approved', tone: 'info' },
  invoice_sent: { label: 'Invoice sent', tone: 'info' },
  paid: { label: 'Paid', tone: 'success' },
  rejected: { label: 'Refused', tone: 'danger' },
};

export function ExpositionStatus({ status }: { status: string }) {
  const s = EXPOSITION_STATUS[status];
  return <AdminStatusPill tone={s?.tone ?? 'neutral'}>{s?.label ?? status.replace('_', ' ')}</AdminStatusPill>;
}

export function AdminExpositions() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlStatus = searchParams.get('status');
  const [requests, setRequests] = useState<ExpositionRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState(urlStatus || 'all');

  const clearFilter = () => { setSearchParams({}); setStatusFilter('all'); };

  useEffect(() => { loadReqs(); }, []);

  const loadReqs = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('exposition_requests')
      .select('*, organizations:organization_id(name), events:event_id(title), profiles!exposition_requests_requested_by_profiles_fkey(email)')
      .order('created_at', { ascending: false });
    const rows = (data || []).map((r: Record<string, unknown>) => ({
      ...r,
      org_name: (r.organizations as Record<string, string> | null)?.name || '—',
      event_title: (r.events as Record<string, string> | null)?.title || '—',
      requester_email: (r.profiles as Record<string, string> | null)?.email || '—',
    }));
    setRequests(rows as ExpositionRequest[]);
    setLoading(false);
  };

  const filtered = statusFilter === 'all' ? requests : requests.filter(r => r.status === statusFilter);

  if (loading) return <AdminLoading />;

  const href = (id: string) => `/admin/expositions/${id}`;

  return (
    <div>
      <AdminPageHeader
        title={t('adminContent.expo.title', 'Old exposition requests')}
        count={filtered.length}
        description={t('adminContent.expo.desc', 'Requests for an exhibition stand at an event, sent from the previous version of the site. Press a request to answer it.')}
      />

      <AdminFilterBar
        trailing={urlStatus || statusFilter !== 'all' ? (
          <Button type="button" variant="outline" className={ADMIN_BTN} onClick={clearFilter}>
            {t('adminContent.expo.clear', 'Show all requests')}
          </Button>
        ) : undefined}
      >
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-52" aria-label={t('adminContent.expo.status', 'Status')}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('adminContent.expo.allStatuses', 'All statuses')}</SelectItem>
            {Object.entries(EXPOSITION_STATUS).map(([key, s]) => (
              <SelectItem key={key} value={key}>{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </AdminFilterBar>

      {filtered.length === 0 ? (
        <div className="rounded-card border border-rule bg-white">
          <AdminEmpty icon={Store} title={t('admin.expositions.noExpositions', 'No exposition requests found')} />
        </div>
      ) : (
        <>
          {/* Phone: one card per request */}
          <ul className="space-y-3 md:hidden" aria-label={t('adminContent.expo.title', 'Old exposition requests')}>
            {filtered.map(r => (
              <li key={r.id}>
                <LinkCard to={href(r.id)} cue={t('adminContent.expo.open', 'Open the request')}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[16px] font-semibold leading-6 text-navy [overflow-wrap:anywhere]">{r.org_name}</p>
                      <p className="text-[13px] leading-5 text-meta [overflow-wrap:anywhere]">{r.requester_email}</p>
                    </div>
                    <ExpositionStatus status={r.status} />
                  </div>
                  <p className="mt-2 text-[14px] leading-5 text-ink [overflow-wrap:anywhere]">{r.event_title}</p>
                  <p className="mt-1 text-[13px] leading-5 text-meta">
                    <span className="font-semibold text-navy">€{r.amount_due || 1400}</span>
                    {' · '}
                    {t('adminContent.expo.sent', 'sent on {{date}}', { date: new Date(r.created_at).toLocaleDateString() })}
                  </p>
                </LinkCard>
              </li>
            ))}
          </ul>

          {/* Desktop: the table */}
          <AdminTableCard className="hidden md:block">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="text-left">{t('adminContent.expo.colCompany', 'Company')}</th>
                  <th className="text-left">{t('adminContent.expo.colEvent', 'Event')}</th>
                  <th className="text-left">{t('adminContent.expo.colStatus', 'Status')}</th>
                  <th className="text-left">{t('adminContent.expo.colAmount', 'Amount')}</th>
                  <th className="text-left">{t('adminContent.expo.colDate', 'Sent on')}</th>
                  <th className="text-left"><span className="sr-only">{t('adminContent.expo.open', 'Open the request')}</span></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={r.id} className="group cursor-pointer" onClick={() => navigate(href(r.id))}>
                    <td>
                      <Link to={href(r.id)} onClick={e => e.stopPropagation()} className="rounded-sm font-semibold text-navy focus:outline-none focus-visible:shadow-focus">
                        <span className="card-ul">{r.org_name}</span>
                      </Link>
                      <div className="text-[12px] text-meta [overflow-wrap:anywhere]">{r.requester_email}</div>
                    </td>
                    <td className="text-sm text-ink">{r.event_title}</td>
                    <td><ExpositionStatus status={r.status} /></td>
                    <td className="whitespace-nowrap text-sm text-ink">€{r.amount_due || 1400}</td>
                    <td className="whitespace-nowrap text-sm text-meta">{new Date(r.created_at).toLocaleDateString()}</td>
                    <td className="text-right"><ActionCue size="sm">{t('adminContent.expo.openShort', 'Open')}</ActionCue></td>
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
