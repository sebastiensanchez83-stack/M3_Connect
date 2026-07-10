import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { AdminContextBanner } from './AdminContextBanner';
import { RefreshCw, ChevronRight } from 'lucide-react';
import { TIER_LABELS, TIER_COLORS, OrgTier } from '@/types/database';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { supabase } from '@/lib/supabase';
import type { SponsorshipRequestRow } from './types';

export function AdminSponsorships() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlStatus = searchParams.get('status');
  const [requests, setRequests] = useState<SponsorshipRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState(urlStatus || 'all');

  const bannerColor = urlStatus === 'pending' ? 'amber' : urlStatus === 'approved' ? 'green' : urlStatus === 'rejected' ? 'red' : 'blue';
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

  const statusColors: Record<string, string> = {
    pending: 'bg-yellow-100 text-yellow-800',
    invoice_sent: 'bg-blue-100 text-blue-800',
    paid: 'bg-green-100 text-green-800',
    approved: 'bg-emerald-100 text-emerald-800',
    rejected: 'bg-red-100 text-red-800',
  };

  if (loading) return <div className="flex items-center justify-center h-64"><RefreshCw className="h-8 w-8 animate-spin text-gray-400" /></div>;

  return (
    <div>
      {urlStatus && <AdminContextBanner label={`Filtered by status: ${urlStatus}`} count={filtered.length} onClear={clearFilter} color={bannerColor} />}
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">{t('admin.sponsorships.title')} ({filtered.length})</h1>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('admin.sponsorships.allStatus')}</SelectItem>
            <SelectItem value="pending">{t('admin.sponsorships.pending')}</SelectItem>
            <SelectItem value="invoice_sent">{t('admin.sponsorships.invoiceSent')}</SelectItem>
            <SelectItem value="paid">{t('admin.sponsorships.paid')}</SelectItem>
            <SelectItem value="approved">{t('admin.sponsorships.approved')}</SelectItem>
            <SelectItem value="rejected">{t('admin.sponsorships.rejected')}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Card><CardContent className="p-0"><div className="overflow-x-auto"><table className="w-full"><thead className="bg-gray-50 border-b"><tr>
        <th className="text-left p-4 font-medium">{t('admin.sponsorships.organization')}</th>
        <th className="text-left p-4 font-medium">{t('admin.sponsorships.currentTier')}</th>
        <th className="text-left p-4 font-medium">{t('admin.sponsorships.requestedTier')}</th>
        <th className="text-left p-4 font-medium">{t('admin.status')}</th>
        <th className="text-left p-4 font-medium">{t('admin.sponsorships.date')}</th>
        <th className="text-left p-4 font-medium">{t('admin.actions')}</th>
      </tr></thead><tbody>
        {filtered.map(r => {
          const curColors = TIER_COLORS[r.current_tier as OrgTier] || TIER_COLORS.member;
          const reqColors = TIER_COLORS[r.requested_tier as OrgTier] || TIER_COLORS.member;
          return (
            <tr key={r.id} className="border-b hover:bg-muted/50 cursor-pointer transition-colors group" onClick={() => navigate(`/admin/sponsorship-requests/${r.id}`)}>
              <td className="p-4">
                <div className="font-medium group-hover:text-primary transition-colors">{r.org_name}</div>
                <div className="text-xs text-gray-500">{r.requester_email}</div>
              </td>
              <td className="p-4"><Badge className={`${curColors.bg} ${curColors.text} border ${curColors.border}`}>{TIER_LABELS[r.current_tier as OrgTier] || r.current_tier}</Badge></td>
              <td className="p-4"><Badge className={`${reqColors.bg} ${reqColors.text} border ${reqColors.border}`}>{TIER_LABELS[r.requested_tier as OrgTier] || r.requested_tier}</Badge></td>
              <td className="p-4"><Badge className={statusColors[r.status] || 'bg-gray-100 text-gray-800'}>{r.status.replace('_', ' ')}</Badge></td>
              <td className="p-4 text-gray-500 text-sm">{new Date(r.created_at).toLocaleDateString()}</td>
              <td className="p-4">
                <ChevronRight className="h-4 w-4 text-gray-300 group-hover:text-primary transition-colors" />
              </td>
            </tr>
          );
        })}
        {filtered.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-gray-400">{t('admin.sponsorships.noSponsorships')}</td></tr>}
      </tbody></table></div></CardContent></Card>
    </div>
  );
}
