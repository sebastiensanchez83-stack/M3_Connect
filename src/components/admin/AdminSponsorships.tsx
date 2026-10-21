import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { ArrowRight, Award } from 'lucide-react';
import { TIER_LABELS, OrgTier } from '@/types/database';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { ActionCue, CardLink } from '@/components/home/dashboard/DashboardKit';
import { supabase } from '@/lib/supabase';
import type { SponsorshipRequestRow } from './types';
import {
  AdminEmpty, AdminFilterBar, AdminLoading, AdminPageHeader, AdminStatusPill, AdminTableCard, ADMIN_BTN, type AdminTone,
} from './AdminUI';
import { LinkCard } from './v2/ContentFormKit';

/** The five steps of an old plan-upgrade request, in the admin tones. */
export const SPONSORSHIP_REQUEST_STATUS: Record<string, { label: string; tone: AdminTone }> = {
  pending: { label: 'Waiting for M3', tone: 'warning' },
  invoice_sent: { label: 'Invoice sent', tone: 'info' },
  paid: { label: 'Paid', tone: 'success' },
  approved: { label: 'Approved', tone: 'success' },
  rejected: { label: 'Refused', tone: 'danger' },
};

export function SponsorshipRequestStatus({ status }: { status: string }) {
  const s = SPONSORSHIP_REQUEST_STATUS[status];
  return <AdminStatusPill tone={s?.tone ?? 'neutral'}>{s?.label ?? status.replace('_', ' ')}</AdminStatusPill>;
}

const tierName = (tier: string) => TIER_LABELS[tier as OrgTier] || tier;

export function AdminSponsorships() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlStatus = searchParams.get('status');
  const [requests, setRequests] = useState<SponsorshipRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState(urlStatus || 'all');

  const clearFilter = () => { setSearchParams({}); setStatusFilter('all'); };

  useEffect(() => { loadRequests(); }, []);

  const loadRequests = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('sponsorship_requests')
      .select('*, organizations:organization_id(name), profiles!sponsorship_requests_requested_by_profiles_fkey(email)')
      .order('created_at', { ascending: false });
    const rows: SponsorshipRequestRow[] = (data || []).map((r: Record<string, unknown>) => ({
      ...r,
      org_name: (r.organizations as Record<string, string> | null)?.name || '—',
      requester_email: (r.profiles as Record<string, string> | null)?.email || '—',
    })) as SponsorshipRequestRow[];
    setRequests(rows);
    setLoading(false);
  };

  const filtered = statusFilter === 'all' ? requests : requests.filter(r => r.status === statusFilter);

  if (loading) return <AdminLoading />;

  const href = (id: string) => `/admin/sponsorship-requests/${id}`;

  return (
    <div>
      <AdminPageHeader
        title={t('adminContent.spReq.title', 'Old sponsorship requests')}
        count={filtered.length}
        description={t('adminContent.spReq.desc', 'Requests to move a company to a paying plan, sent from the previous version of the site. Press a request to answer it.')}
        actions={<CardLink to="/admin/sponsorships">{t('adminContent.spReq.toHub', 'Go to Sponsors and partners')}</CardLink>}
      />

      <AdminFilterBar
        trailing={urlStatus || statusFilter !== 'all' ? (
          <Button type="button" variant="outline" className={ADMIN_BTN} onClick={clearFilter}>
            {t('adminContent.spReq.clear', 'Show all requests')}
          </Button>
        ) : undefined}
      >
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-52" aria-label={t('adminContent.spReq.status', 'Status')}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('adminContent.spReq.allStatuses', 'All statuses')}</SelectItem>
            {Object.entries(SPONSORSHIP_REQUEST_STATUS).map(([key, s]) => (
              <SelectItem key={key} value={key}>{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </AdminFilterBar>

      {filtered.length === 0 ? (
        <div className="rounded-card border border-rule bg-white">
          <AdminEmpty icon={Award} title={t('admin.sponsorships.noSponsorships', 'No sponsorship requests found')} />
        </div>
      ) : (
        <>
          {/* Phone: one card per request */}
          <ul className="space-y-3 md:hidden" aria-label={t('adminContent.spReq.title', 'Old sponsorship requests')}>
            {filtered.map(r => (
              <li key={r.id}>
                <LinkCard to={href(r.id)} cue={t('adminContent.spReq.open', 'Open the request')}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[16px] font-semibold leading-6 text-navy [overflow-wrap:anywhere]">{r.org_name}</p>
                      <p className="text-[13px] leading-5 text-meta [overflow-wrap:anywhere]">{r.requester_email}</p>
                    </div>
                    <SponsorshipRequestStatus status={r.status} />
                  </div>
                  <p className="mt-2 flex flex-wrap items-center gap-1.5 text-[14px] leading-5 text-ink">
                    <span>{tierName(r.current_tier)}</span>
                    <ArrowRight className="h-4 w-4 text-meta" aria-hidden="true" /><span className="sr-only">to</span>
                    <span className="font-semibold text-navy">{tierName(r.requested_tier)}</span>
                  </p>
                  <p className="mt-1 text-[13px] leading-5 text-meta">{t('adminContent.spReq.sent', 'Sent on {{date}}', { date: new Date(r.created_at).toLocaleDateString() })}</p>
                </LinkCard>
              </li>
            ))}
          </ul>

          {/* Desktop: the table */}
          <AdminTableCard className="hidden md:block">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="text-left">{t('adminContent.spReq.colCompany', 'Company')}</th>
                  <th className="text-left">{t('adminContent.spReq.colCurrent', 'Plan now')}</th>
                  <th className="text-left">{t('adminContent.spReq.colAsked', 'Plan asked for')}</th>
                  <th className="text-left">{t('adminContent.spReq.colStatus', 'Status')}</th>
                  <th className="text-left">{t('adminContent.spReq.colDate', 'Sent on')}</th>
                  <th className="text-left"><span className="sr-only">{t('adminContent.spReq.open', 'Open the request')}</span></th>
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
                    <td className="whitespace-nowrap text-sm text-ink">{tierName(r.current_tier)}</td>
                    <td className="whitespace-nowrap text-sm font-semibold text-navy">{tierName(r.requested_tier)}</td>
                    <td><SponsorshipRequestStatus status={r.status} /></td>
                    <td className="whitespace-nowrap text-sm text-meta">{new Date(r.created_at).toLocaleDateString()}</td>
                    <td className="text-right"><ActionCue size="sm">{t('adminContent.spReq.openShort', 'Open')}</ActionCue></td>
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
