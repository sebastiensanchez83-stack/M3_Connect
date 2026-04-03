import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { AdminContextBanner } from './AdminContextBanner';
import { RefreshCw, MessageSquare } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import type { PartnerRequest } from './types';

type EnrichedRequest = PartnerRequest & {
  partner_name?: string;
  partner_email?: string;
  marina_name?: string;
  marina_email?: string;
};

export function AdminPartnerRequests() {
  const { t } = useTranslation();
  const navigate = useNavigate();
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

  const statusBadge = (s: string) => {
    const colors: Record<string, string> = {
      pending: 'bg-amber-100 text-amber-800 border-amber-200',
      accepted: 'bg-green-100 text-green-800 border-green-200',
      rejected: 'bg-red-100 text-red-800 border-red-200',
      withdrawn: 'bg-gray-100 text-gray-600 border-gray-200',
    };
    return <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${colors[s] || colors.withdrawn}`}>{s}</span>;
  };

  if (loading) return <div className="flex items-center justify-center h-64"><RefreshCw className="h-8 w-8 animate-spin text-gray-400" /></div>;

  return (
    <div>
      {urlStatus && <AdminContextBanner label={`Filtered by status: ${urlStatus}`} count={filteredRequests.length} onClear={clearFilter} color={bannerColor} />}
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">B2B Requests ({filteredRequests.length})</h1>
      </div>

      {/* Status filter bar */}
      <div className="flex items-center gap-2 mb-4">
        {[
          { key: 'all', label: 'All', count: requests.length },
          { key: 'pending', label: 'Pending', count: requests.filter(r => r.status === 'pending').length },
          { key: 'accepted', label: 'Accepted', count: requests.filter(r => r.status === 'accepted').length },
          { key: 'rejected', label: 'Rejected', count: requests.filter(r => r.status === 'rejected').length },
        ].map(s => (
          <Button key={s.key} variant={statusFilter === s.key ? 'default' : 'outline'} size="sm"
            className="text-xs gap-1.5" onClick={() => setStatusFilter(s.key)}>
            {s.label}
            {s.count > 0 && <span className="bg-white/20 rounded-full px-1.5 text-[10px] font-bold">{s.count}</span>}
          </Button>
        ))}
      </div>

      {/* Request cards — clickable, no inline actions */}
      <div className="space-y-2">
        {filteredRequests.length === 0 ? (
          <Card><CardContent className="py-12 text-center text-gray-400">No B2B requests match this filter</CardContent></Card>
        ) : filteredRequests.map(r => {
          const daysSince = Math.floor((Date.now() - new Date(r.created_at).getTime()) / 86400000);
          return (
            <Card
              key={r.id}
              className="border-0 shadow-sm cursor-pointer hover:bg-muted/50 transition-colors group"
              onClick={() => navigate(`/admin/partner-requests/${r.id}`)}
            >
              <CardContent className="p-4">
                <div className="flex items-center gap-4">
                  {/* Icon */}
                  <div className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${
                    r.status === 'pending' ? 'bg-amber-50 text-amber-600' :
                    r.status === 'accepted' ? 'bg-green-50 text-green-600' :
                    'bg-gray-50 text-gray-400'
                  }`}>
                    <MessageSquare className="h-5 w-5" />
                  </div>
                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-sm font-semibold text-gray-900">{r.partner_name}</span>
                      <span className="text-gray-400 text-xs">-&gt;</span>
                      <span className="text-sm font-semibold text-gray-900">{r.marina_name}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-gray-500">
                      {r.message && <span className="truncate max-w-xs">{r.message}</span>}
                      <span className="text-gray-300">{daysSince}d ago</span>
                    </div>
                  </div>
                  {/* Status */}
                  <div className="shrink-0">
                    {statusBadge(r.status)}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
