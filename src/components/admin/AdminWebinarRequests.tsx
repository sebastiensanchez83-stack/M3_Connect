import { useState, useEffect } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Plus, Radio } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ActionCue } from '@/components/home/dashboard/DashboardKit';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { AdminContextBanner } from './AdminContextBanner';
import type { WebinarRequest } from './types';
import {
  AdminEmpty, AdminLoading, AdminPageHeader, AdminSegmented, AdminStatus, AdminStatusPill, AdminTableCard, ADMIN_BTN_PRIMARY,
} from './AdminUI';

/**
 * Events > Webinar proposals: the webinars members propose. Admins see every proposal; a
 * moderator sees the ones matching their company's sectors (to review) and their own.
 * Restyled to the admin look (wave 2, 21 Oct 2026); the data and the actions are unchanged.
 * Desktop: a table; phone: one card per proposal. Every row opens the proposal.
 */

const STATUS_WORD: Record<string, string> = {
  submitted: 'Submitted',
  under_review: 'Under review',
  moderator_approved: 'Pre-approved',
  accepted: 'Accepted',
  rejected: 'Rejected',
};
const toneStatus = (s: string) => (s === 'moderator_approved' ? 'approved' : s === 'under_review' ? 'in_review' : s);

export function WebinarStatus({ status }: { status: string }) {
  return <AdminStatus status={toneStatus(status)} label={STATUS_WORD[status] ?? status.replace(/_/g, ' ')} />;
}

export function AdminWebinarRequests() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, profile, organization, isAdmin } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlStatus = searchParams.get('status') || '';
  const hasUrlFilters = !!urlStatus;
  const isMod = profile?.persona === 'moderator';
  const [requests, setRequests] = useState<WebinarRequest[]>([]);
  const [myProposals, setMyProposals] = useState<WebinarRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'review' | 'my'>('review');
  const [statusFilter, setStatusFilter] = useState(urlStatus || 'all');

  useEffect(() => { loadRequests(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadRequests = async () => {
    setLoading(true);

    if (isAdmin) {
      const { data } = await supabase
        .from('webinar_requests')
        .select('*, profiles:user_id(first_name, last_name, email)')
        .order('created_at', { ascending: false });
      setRequests((data || []).map((r: Record<string, unknown>) => {
        const p = r.profiles as Record<string, string> | null;
        return { ...r, requester_name: p ? `${p.first_name || ''} ${p.last_name || ''}`.trim() : '', requester_email: p?.email || '' };
      }) as WebinarRequest[]);
      setMyProposals([]);
    } else if (isMod && user) {
      const { data: ownData } = await supabase
        .from('webinar_requests')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      setMyProposals(ownData || []);

      let sectorIds: string[] = [];
      if (organization?.id) {
        const { data: orgSectors } = await supabase
          .from('organization_service_sectors')
          .select('sector_id')
          .eq('organization_id', organization.id);
        sectorIds = (orgSectors || []).map((s: { sector_id: string }) => s.sector_id);
      }

      if (sectorIds.length > 0) {
        const { data: matchedWRS } = await supabase
          .from('webinar_request_sectors')
          .select('webinar_request_id')
          .in('sector_id', sectorIds);
        const matchedIds = [...new Set((matchedWRS || []).map((wr: { webinar_request_id: string }) => wr.webinar_request_id))];

        if (matchedIds.length > 0) {
          const { data: allData } = await supabase
            .from('webinar_requests')
            .select('*')
            .in('id', matchedIds)
            .neq('user_id', user.id)
            .order('created_at', { ascending: false });

          if (allData && allData.length > 0) {
            const userIds = [...new Set(allData.map((r: WebinarRequest) => r.user_id))];
            const { data: profiles } = await supabase
              .rpc('get_public_profiles', { target_user_ids: userIds });
            const moderatorUserIds = new Set(
              (profiles || [])
                .filter((p: { persona: string }) => p.persona === 'moderator')
                .map((p: { user_id: string }) => p.user_id)
            );
            setRequests(allData.filter((r: WebinarRequest) => !moderatorUserIds.has(r.user_id)));
          } else {
            setRequests([]);
          }
        } else {
          setRequests([]);
        }
      } else {
        setRequests([]);
      }
    } else {
      setRequests([]);
      setMyProposals([]);
    }

    setLoading(false);
  };

  if (loading) return <AdminLoading />;

  const shown = isAdmin || tab === 'review'
    ? (statusFilter === 'all' ? requests : requests.filter(r => r.status === statusFilter))
    : myProposals;
  const fmt = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const requester = (r: WebinarRequest) => r.requester_name || r.requester_email || '';

  return (
    <div>
      <AdminPageHeader
        title={t('adminWebinars.title', 'Webinar proposals')}
        count={requests.length}
        description={isAdmin
          ? t('adminWebinars.desc', 'Webinars that members propose. Open one to accept it (the webinar is created, with no date yet) or to refuse it with a reason.')
          : t('adminWebinars.descMod', 'Proposals in your sectors, to pre-approve, and your own proposals.')}
        meta={isMod ? <AdminStatusPill tone="info">{t('adminWebinars.bySectors', 'Filtered by your sectors')}</AdminStatusPill> : undefined}
        actions={isAdmin ? (
          <Button asChild variant="secondary" size="sm" className={ADMIN_BTN_PRIMARY}>
            <Link to="/admin/events/new?type=webinar&editor=new"><Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />{t('adminWebinars.create', 'Create a webinar')}</Link>
          </Button>
        ) : undefined}
      />

      {hasUrlFilters && (
        <AdminContextBanner
          label={`Showing ${urlStatus.replace('_', ' ')} webinar proposals`}
          count={requests.filter(r => r.status === urlStatus).length}
          onClear={() => { setSearchParams({}, { replace: true }); setStatusFilter('all'); }}
          color="violet"
        />
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        {/* Moderator: proposals to review / my own proposals */}
        {isMod && (
          <AdminSegmented<'review' | 'my'>
            label={t('adminWebinars.which', 'Which proposals')}
            value={tab}
            onChange={setTab}
            options={[
              { value: 'review', label: t('adminWebinars.toReview', 'To review ({{n}})', { n: requests.length }) },
              { value: 'my', label: t('adminWebinars.mine', 'My proposals ({{n}})', { n: myProposals.length }) },
            ]}
          />
        )}
        {(isAdmin || tab === 'review') && (
          <AdminSegmented<string>
            className="flex-wrap"
            label={t('adminWebinars.status', 'Status')}
            value={statusFilter}
            onChange={setStatusFilter}
            options={['all', 'submitted', 'under_review', 'accepted', 'rejected'].map(s => ({
              value: s,
              label: s === 'all' ? t('adminWebinars.all', 'All') : STATUS_WORD[s],
            }))}
          />
        )}
      </div>

      {shown.length === 0 ? (
        <div className="rounded-card border border-rule bg-white">
          <AdminEmpty icon={Radio} title={t('adminWebinars.none', 'No proposal here')} />
        </div>
      ) : (
        <>
          {/* Phone: one card per proposal */}
          <ul className="space-y-3 md:hidden">
            {shown.map(r => (
              <li key={r.id}>
                <Link to={`/admin/webinars/${r.id}`} className="group block rounded-card border border-rule bg-white p-4 focus:outline-none focus-visible:shadow-focus">
                  <p className="text-[16px] font-semibold leading-6 text-navy [overflow-wrap:anywhere]">{r.title}</p>
                  <p className="text-[13px] leading-5 text-meta [overflow-wrap:anywhere]">{[requester(r), r.preferred_language, fmt(r.created_at)].filter(Boolean).join(' · ')}</p>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                    <WebinarStatus status={r.status} />
                    <ActionCue size="sm">{t('adminWebinars.open', 'Open the proposal')}</ActionCue>
                  </div>
                </Link>
              </li>
            ))}
          </ul>

          {/* Desktop: the table */}
          <AdminTableCard className="hidden md:block">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="text-left">{t('adminWebinars.colTitle', 'Proposal')}</th>
                  <th className="text-left">{t('adminWebinars.colBy', 'Proposed by')}</th>
                  <th className="text-left">{t('adminWebinars.colLang', 'Language')}</th>
                  <th className="text-left">{t('adminWebinars.colStatus', 'Status')}</th>
                  <th className="text-left">{t('adminWebinars.colDate', 'Received')}</th>
                  <th className="text-left"><span className="sr-only">{t('adminWebinars.open', 'Open the proposal')}</span></th>
                </tr>
              </thead>
              <tbody>
                {shown.map(r => (
                  <tr key={r.id} className="group cursor-pointer" onClick={() => navigate(`/admin/webinars/${r.id}`)}>
                    <td className="max-w-xs">
                      <Link to={`/admin/webinars/${r.id}`} onClick={e => e.stopPropagation()} className="rounded-sm font-semibold text-navy focus:outline-none focus-visible:shadow-focus">
                        <span className="card-ul [overflow-wrap:anywhere]">{r.title}</span>
                      </Link>
                    </td>
                    <td className="text-sm text-ink">
                      <div>{r.requester_name || '—'}</div>
                      {r.requester_email && <div className="text-[12px] text-meta [overflow-wrap:anywhere]">{r.requester_email}</div>}
                    </td>
                    <td className="text-sm text-ink">{r.preferred_language || '—'}</td>
                    <td><WebinarStatus status={r.status} /></td>
                    <td className="whitespace-nowrap text-sm text-ink">{fmt(r.created_at)}</td>
                    <td className="text-right"><ActionCue size="sm">{t('adminWebinars.openShort', 'Open')}</ActionCue></td>
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
