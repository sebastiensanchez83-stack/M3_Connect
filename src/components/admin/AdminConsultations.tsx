import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { AdminContextBanner } from './AdminContextBanner';
import { RefreshCw } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/lib/supabase';
import type { Consultation } from './types';

export function AdminConsultations() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlStatus = searchParams.get('status');
  const [consultations, setConsultations] = useState<(Consultation & { marina_name?: string; org_name?: string })[]>([]);
  const [loading, setLoading] = useState(true);

  const filteredConsultations = useMemo(() => {
    if (!urlStatus) return consultations;
    if (urlStatus === 'open') return consultations.filter(c => c.is_open);
    if (urlStatus === 'closed') return consultations.filter(c => !c.is_open);
    return consultations;
  }, [consultations, urlStatus]);

  const bannerColor = urlStatus === 'open' ? 'green' : urlStatus === 'closed' ? 'red' : 'blue';
  const clearFilter = () => { setSearchParams({}); };

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from('consultations').select('*').order('created_at', { ascending: false });
    const rows = data || [];
    const userIds = [...new Set(rows.map((c: Consultation) => c.marina_user_id))];
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
    setConsultations(rows.map((c: Consultation) => ({ ...c, marina_name: nameMap[c.marina_user_id] || c.marina_user_id.slice(0, 8), org_name: orgMap[c.marina_user_id] || '' })));
    setLoading(false);
  };

  if (loading) return <div className="flex items-center justify-center h-64"><RefreshCw className="h-8 w-8 animate-spin text-gray-400" /></div>;

  return (
    <div>
      {urlStatus && <AdminContextBanner label={`Filtered by status: ${urlStatus}`} count={filteredConsultations.length} onClear={clearFilter} color={bannerColor} />}
      <h1 className="text-2xl font-bold mb-6">{t('admin.consultations.title')} ({filteredConsultations.length})</h1>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-left p-4 font-medium">{t('admin.userDetail.name')}</th>
                  <th className="text-left p-4 font-medium">{t('admin.consultations.marina')}</th>
                  <th className="text-left p-4 font-medium">{t('admin.status')}</th>
                  <th className="text-left p-4 font-medium">{t('admin.webinarRequests.date')}</th>
                </tr>
              </thead>
              <tbody>
                {filteredConsultations.map(c => (
                  <tr
                    key={c.id}
                    className="border-b cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => navigate(`/admin/consultations/${c.id}`)}
                  >
                    <td className="p-4 font-medium max-w-xs truncate">{c.title}</td>
                    <td className="p-4">
                      <div className="text-sm font-medium">{c.org_name || c.marina_name}</div>
                      {c.org_name && <div className="text-xs text-gray-500">{c.marina_name}</div>}
                    </td>
                    <td className="p-4">
                      <Badge variant={c.is_open ? 'success' : 'secondary'}>
                        {c.is_open ? t('admin.consultations.open') : t('admin.consultations.closed')}
                      </Badge>
                    </td>
                    <td className="p-4 text-sm text-gray-500">{new Date(c.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
                {filteredConsultations.length === 0 && (
                  <tr><td colSpan={4} className="p-8 text-center text-gray-400">{t('admin.consultations.noConsultations')}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
