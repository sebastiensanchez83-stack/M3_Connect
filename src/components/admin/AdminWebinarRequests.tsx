import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { AdminContextBanner } from './AdminContextBanner';
import type { WebinarRequest } from './types';

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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  const statusBadge = (status: string) => {
    const colors: Record<string, string> = {
      submitted: 'bg-yellow-100 text-yellow-700',
      under_review: 'bg-blue-100 text-blue-700',
      moderator_approved: 'bg-emerald-100 text-emerald-700',
      accepted: 'bg-green-100 text-green-700',
      rejected: 'bg-red-100 text-red-700',
    };
    return <Badge className={`${colors[status] || 'bg-gray-100 text-gray-700'} border-0`}>{status.replace('_', ' ')}</Badge>;
  };

  const RequestTable = ({ data, showActions }: { data: WebinarRequest[]; showActions: boolean }) => (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left p-4 font-medium">{t('admin.userDetail.name')}</th>
                <th className="text-left p-4 font-medium">Requester</th>
                <th className="text-left p-4 font-medium">{t('admin.webinarRequests.lang')}</th>
                <th className="text-left p-4 font-medium">{t('admin.status')}</th>
                <th className="text-left p-4 font-medium">{t('admin.webinarRequests.date')}</th>
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr
                  key={r.id}
                  className="border-b cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => navigate(`/admin/webinars/${r.id}`)}
                >
                  <td className="p-4 font-medium max-w-xs truncate">{r.title}</td>
                  <td className="p-4">
                    <div className="text-sm font-medium">{r.requester_name || '---'}</div>
                    <div className="text-xs text-gray-500">{r.requester_email || ''}</div>
                  </td>
                  <td className="p-4">{r.preferred_language}</td>
                  <td className="p-4">{statusBadge(r.status)}</td>
                  <td className="p-4 text-gray-500">{new Date(r.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
              {data.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-gray-400">
                    {t('admin.webinarRequests.noRequests')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <h1 className="text-2xl font-bold">
          {isAdmin ? t('admin.webinarRequests.title') : 'Webinar Proposals'}
          {' '}({requests.length})
        </h1>
        {isMod && (
          <Badge variant="outline" className="text-xs">
            {t('admin.webinarRequests.filteredBySectors')}
          </Badge>
        )}
      </div>

      {/* URL-based filter context banner */}
      {hasUrlFilters && (
        <AdminContextBanner
          label={`Showing ${urlStatus.replace('_', ' ')} webinar proposals`}
          count={requests.filter(r => r.status === urlStatus).length}
          onClear={() => { setSearchParams({}, { replace: true }); setStatusFilter('all'); }}
          color="violet"
        />
      )}

      {/* Moderator tab switcher: Review / My Proposals */}
      {isMod && (
        <div className="flex gap-2 mb-6">
          <Button
            variant={tab === 'review' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setTab('review')}
          >
            Review Proposals ({requests.length})
          </Button>
          <Button
            variant={tab === 'my' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setTab('my')}
          >
            My Proposals ({myProposals.length})
          </Button>
        </div>
      )}

      {/* Status filter for admin */}
      {isAdmin && (
        <div className="flex items-center gap-2 mb-4">
          {['all', 'submitted', 'under_review', 'accepted', 'rejected'].map(s => (
            <Button key={s} variant={statusFilter === s ? 'default' : 'outline'} size="sm" className="text-xs capitalize"
              onClick={() => setStatusFilter(s)}>
              {s === 'all' ? 'All' : s.replace('_', ' ')}
            </Button>
          ))}
        </div>
      )}

      {/* Admin: single table; Moderator: tab-based */}
      {isAdmin ? (
        <RequestTable data={statusFilter === 'all' ? requests : requests.filter(r => r.status === statusFilter)} showActions />
      ) : tab === 'review' ? (
        <RequestTable data={statusFilter === 'all' ? requests : requests.filter(r => r.status === statusFilter)} showActions />
      ) : (
        <RequestTable data={myProposals} showActions={false} />
      )}
    </div>
  );
}
