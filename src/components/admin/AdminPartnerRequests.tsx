import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/lib/supabase';
import type { PartnerRequest } from './types';

export function AdminPartnerRequests() {
  const { t } = useTranslation();
  const [requests, setRequests] = useState<(PartnerRequest & { partner_name?: string; marina_name?: string })[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, []);
  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from('partner_requests').select('*').order('created_at', { ascending: false });
    const rows = data || [];
    // Fetch names for all unique user IDs
    const userIds = [...new Set(rows.flatMap((r: PartnerRequest) => [r.partner_user_id, r.marina_user_id]))];
    const nameMap: Record<string, string> = {};
    if (userIds.length > 0) {
      const { data: profiles } = await supabase.from('profiles').select('user_id, first_name, last_name').in('user_id', userIds);
      (profiles || []).forEach((p: { user_id: string; first_name: string; last_name: string }) => { nameMap[p.user_id] = `${p.first_name || ''} ${p.last_name || ''}`.trim() || p.user_id.slice(0, 8); });
    }
    setRequests(rows.map((r: PartnerRequest) => ({ ...r, partner_name: nameMap[r.partner_user_id] || r.partner_user_id.slice(0, 8), marina_name: nameMap[r.marina_user_id] || r.marina_user_id.slice(0, 8) })));
    setLoading(false);
  };

  const statusBadge = (s: string) => {
    const m: Record<string, 'warning' | 'success' | 'destructive' | 'secondary'> = { pending: 'warning', accepted: 'success', rejected: 'destructive', withdrawn: 'secondary' };
    return <Badge variant={m[s] || 'secondary'}>{s}</Badge>;
  };

  if (loading) return <div className="flex items-center justify-center h-64"><RefreshCw className="h-8 w-8 animate-spin text-gray-400" /></div>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">{t('admin.partnerRequests.title')} ({requests.length})</h1>
      <Card><CardContent className="p-0"><div className="overflow-x-auto"><table className="w-full"><thead className="bg-gray-50 border-b"><tr>
        <th className="text-left p-4 font-medium">{t('admin.partnerRequests.partner')}</th><th className="text-left p-4 font-medium">{t('admin.partnerRequests.marina')}</th><th className="text-left p-4 font-medium">{t('admin.partnerRequests.message')}</th><th className="text-left p-4 font-medium">{t('admin.status')}</th><th className="text-left p-4 font-medium">{t('admin.partnerRequests.date')}</th>
      </tr></thead><tbody>
        {requests.map(r => (<tr key={r.id} className="border-b hover:bg-gray-50">
          <td className="p-4 text-sm font-medium">{r.partner_name}</td>
          <td className="p-4 text-sm font-medium">{r.marina_name}</td>
          <td className="p-4 text-sm max-w-xs truncate">{r.message}</td>
          <td className="p-4">{statusBadge(r.status)}</td>
          <td className="p-4 text-sm text-gray-500">{new Date(r.created_at).toLocaleDateString()}</td>
        </tr>))}
        {requests.length === 0 && <tr><td colSpan={5} className="p-8 text-center text-gray-400">{t('admin.partnerRequests.noRequests')}</td></tr>}
      </tbody></table></div></CardContent></Card>
    </div>
  );
}
