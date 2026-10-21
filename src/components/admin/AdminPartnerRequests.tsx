import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams, Link } from 'react-router-dom';
import { AdminContextBanner } from './AdminContextBanner';
import { ArrowRight, MessageSquare } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { PartnerRequest } from './types';
import { ActionCue, CardLink } from '@/components/home/dashboard/DashboardKit';
import { INBOX_PATHS } from './v2/inboxApi';
import { AdminEmpty, AdminLoading, AdminPageHeader, AdminStatus } from './AdminUI';
import { cn } from '@/lib/utils';

/**
 * Members > Connection requests (/admin/partner-requests): a service provider asks to be
 * introduced to a marina (table partner_requests). Refonte admin style (Oct 2026): one card per
 * request, phone and computer alike; the whole card opens the request and its pill says so.
 * Accepting or refusing happens on the request's page. Same reads as before.
 */

type EnrichedRequest = PartnerRequest & {
  partner_name?: string;
  partner_email?: string;
  marina_name?: string;
  marina_email?: string;
};

/** partner_requests.status, in plain words. */
const REQUEST_STATUS_LABEL: Record<string, string> = {
  pending: 'Waiting',
  accepted: 'Accepted',
  rejected: 'Refused',
  withdrawn: 'Withdrawn',
};

export function AdminPartnerRequests() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlStatus = searchParams.get('status');
  const [requests, setRequests] = useState<EnrichedRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState(urlStatus || 'all');

  const filteredRequests = useMemo(() => {
    if (statusFilter === 'all') return requests;
    return requests.filter(r => r.status === statusFilter);
  }, [requests, statusFilter]);

  const bannerColor = urlStatus === 'pending' ? 'amber' : urlStatus === 'accepted' ? 'green' : urlStatus === 'rejected' ? 'red' : 'blue';
  const clearFilter = () => { setSearchParams({}); setStatusFilter('all'); };

  useEffect(() => { load(); }, []);
  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from('partner_requests').select('*').order('created_at', { ascending: false });
    const rows = data || [];
    const userIds = [...new Set(rows.flatMap((r: PartnerRequest) => [r.partner_user_id, r.marina_user_id]))];
    const nameMap: Record<string, { name: string; email: string }> = {};
    if (userIds.length > 0) {
      const { data: profiles } = await supabase.from('profiles').select('user_id, first_name, last_name, email').in('user_id', userIds);
      (profiles || []).forEach((p: { user_id: string; first_name: string; last_name: string; email: string }) => {
        nameMap[p.user_id] = {
          name: `${p.first_name || ''} ${p.last_name || ''}`.trim() || p.user_id.slice(0, 8),
          email: p.email || '',
        };
      });
    }
    setRequests(rows.map((r: PartnerRequest) => ({
      ...r,
      partner_name: nameMap[r.partner_user_id]?.name || r.partner_user_id.slice(0, 8),
      partner_email: nameMap[r.partner_user_id]?.email || '',
      marina_name: nameMap[r.marina_user_id]?.name || r.marina_user_id.slice(0, 8),
      marina_email: nameMap[r.marina_user_id]?.email || '',
    })));
    setLoading(false);
  };

  if (loading) return <AdminLoading />;

  const filters = [
    { key: 'all', label: t('adm2.b2b.all', 'All'), count: requests.length },
    { key: 'pending', label: REQUEST_STATUS_LABEL.pending, count: requests.filter(r => r.status === 'pending').length },
    { key: 'accepted', label: REQUEST_STATUS_LABEL.accepted, count: requests.filter(r => r.status === 'accepted').length },
    { key: 'rejected', label: REQUEST_STATUS_LABEL.rejected, count: requests.filter(r => r.status === 'rejected').length },
  ];
  const ago = (iso: string) => {
    const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
    return days <= 0 ? t('adm2.b2b.today', 'today') : t('adm2.b2b.daysAgo', { count: days, defaultValue_one: '{{count}} day ago', defaultValue_other: '{{count}} days ago' });
  };

  return (
    <div>
      {urlStatus && (
        <AdminContextBanner
          lead={t('adm2.banner.lead', 'Showing only:')}
          label={t('adm2.b2b.banner', 'requests with the status "{{status}}"', { status: REQUEST_STATUS_LABEL[urlStatus] ?? urlStatus })}
          count={filteredRequests.length}
          onClear={clearFilter}
          color={bannerColor}
        />
      )}

      <AdminPageHeader
        title={t('adm2.b2b.title', 'Connection requests')}
        count={requests.length}
        description={t('adm2.b2b.desc', 'A service provider asks to be introduced to a marina. Press a request to read it, then accept or refuse it.')}
      />

      {/* "Report to M3" from Messages: read and closed in the Inbox since the admin refonte (one place to act). */}
      <div className="mb-5 flex flex-col gap-2 rounded-xl border border-rule bg-foam px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <p className="text-[14px] leading-5 text-navy">{t('adminReports.movedToInbox', 'Conversations reported by members are now in the Inbox.')}</p>
        <CardLink to={INBOX_PATHS.inbox + '#reported-conversations'} className="self-start sm:self-auto">{t('adminReports.openInbox', 'Open the Inbox')}</CardLink>
      </div>

      {/* Status filter: pills that wrap on a phone (never a sideways scroll) */}
      <div role="group" aria-label={t('adm2.b2b.filter', 'Show the requests')} className="mb-4 flex flex-wrap gap-2">
        {filters.map(s => {
          const active = statusFilter === s.key;
          return (
            <button
              key={s.key}
              type="button"
              aria-pressed={active}
              onClick={() => setStatusFilter(s.key)}
              className={cn(
                'inline-flex h-10 items-center gap-1.5 rounded-pill border px-4 text-[14px] font-semibold transition-colors focus:outline-none focus-visible:shadow-focus',
                active ? 'border-navy bg-navy text-white' : 'border-navy/30 bg-white text-navy hover:border-navy hover:bg-chip',
              )}
            >
              {s.label}
              <span className={cn('rounded-pill px-1.5 text-[12px] leading-5 tabular-nums', active ? 'bg-white/20 text-white' : 'bg-chip text-navy')}>{s.count}</span>
            </button>
          );
        })}
      </div>

      {/* Request cards: the whole card opens the request */}
      {filteredRequests.length === 0 ? (
        <div className="rounded-card border border-rule bg-white">
          <AdminEmpty icon={MessageSquare} title={t('adm2.b2b.none', 'No request matches this filter')} />
        </div>
      ) : (
        <ul className="space-y-3">
          {filteredRequests.map(r => (
            <li key={r.id}>
              <Link
                to={`/admin/partner-requests/${r.id}`}
                className="group flex flex-col gap-3 rounded-card border border-rule bg-white p-4 transition-[box-shadow,border-color] hover:border-navy/25 hover:shadow-hover focus:outline-none focus-visible:shadow-focus sm:flex-row sm:items-center sm:gap-4"
              >
                <span className="flex min-w-0 flex-1 items-start gap-3">
                  <span className={cn(
                    'grid h-10 w-10 shrink-0 place-items-center rounded-xl',
                    r.status === 'pending' ? 'bg-gold/25 text-navy' : r.status === 'accepted' ? 'bg-foam text-teal-text' : 'bg-chip text-meta',
                  )}>
                    <MessageSquare className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[15px] font-semibold leading-5 text-navy">
                      <span className="[overflow-wrap:anywhere]">{r.partner_name}</span>
                      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-meta" aria-label={t('adm2.b2b.to', 'to')} />
                      <span className="[overflow-wrap:anywhere]">{r.marina_name}</span>
                    </span>
                    {r.message && <span className="mt-1 line-clamp-2 block text-[14px] leading-5 text-ink [overflow-wrap:anywhere]">{r.message}</span>}
                    <span className="mt-1.5 flex flex-wrap items-center gap-2 text-[13px] text-meta">
                      <AdminStatus status={r.status} label={REQUEST_STATUS_LABEL[r.status] ?? undefined} />
                      <span>{t('adm2.b2b.sent', 'Sent {{ago}}', { ago: ago(r.created_at) })}</span>
                    </span>
                  </span>
                </span>
                <ActionCue size="sm" className="self-start sm:self-center">
                  {r.status === 'pending' ? t('adm2.b2b.openToDecide', 'Open to decide') : t('adm2.b2b.open', 'Open')}
                </ActionCue>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
