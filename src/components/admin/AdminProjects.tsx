import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { AdminContextBanner } from './AdminContextBanner';
import { RefreshCw } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/lib/supabase';
import type { MarinaProject } from './types';

const STATUS_BADGE: Record<string, { variant: any; label: string }> = {
  new: { variant: 'info', label: 'New' },
  in_progress: { variant: 'warning', label: 'In Progress' },
  completed: { variant: 'success', label: 'Completed' },
};

export function AdminProjects() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlStatus = searchParams.get('status');
  const [projects, setProjects] = useState<MarinaProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [marinaNames, setMarinaNames] = useState<Record<string, string>>({});

  const filteredProjects = useMemo(() => {
    if (!urlStatus) return projects;
    return projects.filter(p => p.status === urlStatus);
  }, [projects, urlStatus]);

  const bannerColor = urlStatus === 'new' ? 'blue' : urlStatus === 'in_progress' ? 'amber' : urlStatus === 'completed' ? 'green' : 'blue';
  const clearFilter = () => { setSearchParams({}); };

  useEffect(() => { loadProjects(); }, []);

  const loadProjects = async () => {
    setLoading(true);
    const { data } = await supabase.from('marina_projects').select('*').order('created_at', { ascending: false });
    const rows = data || [];
    const userIds = [...new Set(rows.map((p: MarinaProject) => p.user_id))];
    const nameMap: Record<string, string> = {};
    if (userIds.length > 0) {
      const { data: profiles } = await supabase.from('profiles').select('user_id, first_name, last_name').in('user_id', userIds);
      (profiles || []).forEach((p: { user_id: string; first_name: string; last_name: string }) => {
        nameMap[p.user_id] = `${p.first_name || ''} ${p.last_name || ''}`.trim() || p.user_id.slice(0, 8);
      });
    }
    setMarinaNames(nameMap);
    setProjects(rows);
    setLoading(false);
  };

  if (loading) return <div className="flex items-center justify-center h-64"><RefreshCw className="h-8 w-8 animate-spin text-gray-400" /></div>;

  return (
    <div>
      {urlStatus && <AdminContextBanner label={`Filtered by status: ${urlStatus}`} count={filteredProjects.length} onClear={clearFilter} color={bannerColor} />}
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">{t('admin.marinaProjects')} ({filteredProjects.length})</h1>
      </div>
      <Card>
        <CardContent className="p-0">
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left p-4 font-medium">Marina</th>
                <th className="text-left p-4 font-medium">Type</th>
                <th className="text-left p-4 font-medium">Budget</th>
                <th className="text-left p-4 font-medium">Status</th>
                <th className="text-left p-4 font-medium">Date</th>
              </tr>
            </thead>
            <tbody>
              {filteredProjects.map(p => {
                const badge = STATUS_BADGE[p.status] || { variant: 'outline', label: p.status };
                return (
                  <tr
                    key={p.id}
                    className="border-b cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => navigate(`/admin/projects/${p.id}`)}
                  >
                    <td className="p-4 text-sm font-medium">{marinaNames[p.user_id] || p.user_id.slice(0, 8)}</td>
                    <td className="p-4">{p.project_type}</td>
                    <td className="p-4">{p.budget_range}</td>
                    <td className="p-4"><Badge variant={badge.variant}>{badge.label}</Badge></td>
                    <td className="p-4 text-gray-500">{new Date(p.created_at).toLocaleDateString()}</td>
                  </tr>
                );
              })}
              {filteredProjects.length === 0 && (
                <tr><td colSpan={5} className="p-8 text-center text-gray-400">No projects found</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
