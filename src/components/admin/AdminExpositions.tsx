import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { AdminContextBanner } from './AdminContextBanner';
import { RefreshCw, ChevronRight } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { supabase } from '@/lib/supabase';

interface ExpositionRequest {
  id: string; organization_id: string; event_id: string; requested_by: string;
  status: string; admin_notes: string | null; invoice_reference: string | null;
  amount_due: number | null; payment_confirmed_at: string | null; created_at: string;
  org_name: string; event_title: string; requester_email: string;
}

export function AdminExpositions() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlStatus = searchParams.get('status');
  const [requests, setRequests] = useState<ExpositionRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState(urlStatus || 'all');

  const bannerColor = urlStatus === 'pending' ? 'amber' : urlStatus === 'approved' ? 'green' : urlStatus === 'rejected' ? 'red' : 'blue';
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

  const statusColors: Record<string, string> = {
    pending: 'bg-yellow-100 text-yellow-800',
    approved: 'bg-blue-100 text-blue-800',
    invoice_sent: 'bg-indigo-100 text-indigo-800',
    paid: 'bg-green-100 text-green-800',
    rejected: 'bg-red-100 text-red-800',
  };

  if (loading) return <div className="flex items-center justify-center h-64"><RefreshCw className="h-8 w-8 animate-spin text-gray-400" /></div>;

  return (
    <div>
      {urlStatus && <AdminContextBanner label={`Filtered by status: ${urlStatus}`} count={filtered.length} onClear={clearFilter} color={bannerColor} />}
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">{t('admin.expositions.title')} ({filtered.length})</h1>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('admin.expositions.allStatus')}</SelectItem>
            <SelectItem value="pending">{t('admin.expositions.pending')}</SelectItem>
            <SelectItem value="approved">{t('admin.expositions.approved')}</SelectItem>
            <SelectItem value="invoice_sent">{t('admin.expositions.invoiceSent')}</SelectItem>
            <SelectItem value="paid">{t('admin.expositions.paid')}</SelectItem>
            <SelectItem value="rejected">{t('admin.expositions.rejected')}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Card><CardContent className="p-0"><div className="overflow-x-auto"><table className="w-full"><thead className="bg-gray-50 border-b"><tr>
        <th className="text-left p-4 font-medium">{t('admin.expositions.marina')}</th>
        <th className="text-left p-4 font-medium">{t('admin.expositions.event')}</th>
        <th className="text-left p-4 font-medium">{t('admin.status')}</th>
        <th className="text-left p-4 font-medium">{t('admin.expositions.amount')}</th>
        <th className="text-left p-4 font-medium">{t('admin.expositions.date')}</th>
        <th className="text-left p-4 font-medium">{t('admin.actions')}</th>
      </tr></thead><tbody>
        {filtered.map(r => (
          <tr key={r.id} className="border-b hover:bg-muted/50 cursor-pointer transition-colors group" onClick={() => navigate(`/admin/expositions/${r.id}`)}>
            <td className="p-4">
              <div className="font-medium group-hover:text-primary transition-colors">{r.org_name}</div>
              <div className="text-xs text-gray-500">{r.requester_email}</div>
            </td>
            <td className="p-4 text-sm">{r.event_title}</td>
            <td className="p-4"><Badge className={statusColors[r.status] || 'bg-gray-100'}>{r.status.replace('_', ' ')}</Badge></td>
            <td className="p-4 text-sm">€{r.amount_due || 1400}</td>
            <td className="p-4 text-sm text-gray-500">{new Date(r.created_at).toLocaleDateString()}</td>
            <td className="p-4">
              <ChevronRight className="h-4 w-4 text-gray-300 group-hover:text-primary transition-colors" />
            </td>
          </tr>
        ))}
        {filtered.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-gray-400">{t('admin.expositions.noExpositions')}</td></tr>}
      </tbody></table></div></CardContent></Card>
    </div>
  );
}
