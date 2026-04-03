import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { AdminContextBanner } from './AdminContextBanner';
import { RefreshCw } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/lib/supabase';
import type { RFP } from './types';

const STATUS_BADGE: Record<string, { variant: string; label: string }> = {
  submitted: { variant: 'info', label: 'Submitted' },
  under_review: { variant: 'warning', label: 'Under Review' },
  approved: { variant: 'success', label: 'Approved' },
  closed: { variant: 'secondary', label: 'Closed' },
  rejected: { variant: 'destructive', label: 'Rejected' },
  archived: { variant: 'outline', label: 'Archived' },
};

export function AdminRFPs() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlStatus = searchParams.get('status');
  const [rfps, setRfps] = useState<(RFP & { marina_name?: string; org_name?: string })[]>([]);
  const [loading, setLoading] = useState(true);

  const filteredRfps = useMemo(() => {
    if (!urlStatus) return rfps;
    return rfps.filter(r => r.status === urlStatus);
  }, [rfps, urlStatus]);

  const bannerColor = urlStatus === 'approved' ? 'green' : urlStatus === 'rejected' ? 'red' : urlStatus === 'under_review' ? 'amber' : 'blue';
  const clearFilter = () => { setSearchParams({}); };

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from('rfps').select('*').order('created_at', { ascending: false });
    const rows = data || [];
    const userIds = [...new Set(rows.map((r: RFP) => r.marina_user_id))];
    const nameMap: Record<string, string> = {};
    const orgMap: Record<string, string> = {};
    if (userIds.length > 0) {
      const [{ data: profiles }, { data: memberships }] = await Promise.all([
        supabase.from('profiles').select('user_id, first_name, last_name').in('user_id', userIds),
        supabase.from('organization_members').select('user_id, organizations(name)').in('user_id', userIds),
      ]);
      (profiles || []).forEach((p: { user_id: string; first_name: string; last_name: string }) => {
        nameMap[p.user_id] = `${p.first_name || ''} ${p.last_name || ''}`.trim() || p.user_id.slice(0, 8);
      });
      (memberships || []).forEach((m: Record<string, unknown>) => {
        const org = m.organizations as Record<string, string> | null;
        if (org?.name) orgMap[m.user_id as string] = org.name;
      });
    }
    setRfps(rows.map((r: RFP) => ({ ...r, marina_name: nameMap[r.marina_user_id] || r.marina_user_id.slice(0, 8), org_name: orgMap[r.marina_user_id] || '' })));
    setLoading(false);
  };

  if (loading) return <div className="flex items-center justify-center h-64"><RefreshCw className="h-8 w-8 animate-spin text-gray-400" /></div>;

  return (
    <div>
      {urlStatus && <AdminContextBanner label={`Filtered by status: ${urlStatus}`} count={filteredRfps.length} onClear={clearFilter} color={bannerColor} />}
      <h1 className="text-2xl font-bold mb-6">{t('admin.rfps.title')} ({filteredRfps.length})</h1>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-left p-4 font-medium">{t('admin.userDetail.name')}</th>
                  <th className="text-left p-4 font-medium">{t('admin.rfps.marina')}</th>
                  <th className="text-left p-4 font-medium">{t('admin.rfps.deadline')}</th>
                  <th className="text-left p-4 font-medium">{t('admin.status')}</th>
                </tr>
              </thead>
              <tbody>
                {filteredRfps.map(r => (
                  <tr
                    key={r.id}
                    className="border-b cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => navigate(`/admin/rfps/${r.id}`)}
                  >
                    <td className="p-4 font-medium max-w-xs truncate">{r.title}</td>
                    <td className="p-4">
                      <div className="text-sm font-medium">{r.org_name || r.marina_name}</div>
                      {r.org_name && <div className="text-xs text-gray-500">{r.marina_name}</div>}
                    </td>
                    <td className="p-4 text-sm text-gray-500">{r.deadline_date ? new Date(r.deadline_date).toLocaleDateString() : '\u2014'}</td>
                    <td className="p-4">
                      {(() => { const badge = STATUS_BADGE[r.status] || { variant: 'outline', label: r.status }; return <Badge variant={badge.variant as any}>{badge.label}</Badge>; })()}
                    </td>
                  </tr>
                ))}
                {filteredRfps.length === 0 && (
                  <tr><td colSpan={4} className="p-8 text-center text-gray-400">{t('admin.rfps.noRfps')}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
