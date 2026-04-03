import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { RefreshCw, Plus } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import type { Resource, ResourceDraft } from './types';

interface DraftRow extends ResourceDraft {
  submitter_name: string;
  submitter_email: string;
}

export function AdminResources() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { profile: authProfile } = useAuth();
  const isAdmin = authProfile?.persona === 'admin';

  const [tab, setTab] = useState<'published' | 'drafts'>((searchParams.get('tab') || 'published') as any);
  const [resources, setResources] = useState<Resource[]>([]);
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Sync tab from URL when navigating via sidebar
  useEffect(() => {
    const urlTab = searchParams.get('tab');
    if (urlTab === 'drafts' || urlTab === 'published') setTab(urlTab);
  }, [searchParams]);

  useEffect(() => { loadAll(); }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    // Load resources and drafts in parallel
    const [resResult, draftResult] = await Promise.all([
      supabase.from('resources').select('*').order('created_at', { ascending: false }),
      supabase.from('resource_drafts').select('*').order('created_at', { ascending: false }),
    ]);

    setResources(resResult.data || []);

    // Enrich drafts with submitter names
    const draftRows = draftResult.data || [];
    if (draftRows.length > 0) {
      const userIds = [...new Set(draftRows.map((d: ResourceDraft) => d.created_by))];
      const profileMap: Record<string, { name: string; email: string }> = {};
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('user_id, first_name, last_name, email')
          .in('user_id', userIds);
        (profiles || []).forEach((p: any) => {
          profileMap[p.user_id] = {
            name: `${p.first_name || ''} ${p.last_name || ''}`.trim() || p.user_id.slice(0, 8),
            email: p.email || '---',
          };
        });
      }
      setDrafts(draftRows.map((d: ResourceDraft) => ({
        ...d,
        submitter_name: profileMap[d.created_by]?.name ?? d.created_by.slice(0, 8),
        submitter_email: profileMap[d.created_by]?.email ?? '---',
      })));
    } else {
      setDrafts([]);
    }

    setLoading(false);
  }, []);

  const pendingDraftsCount = drafts.filter(d => d.status === 'pending').length;

  if (loading) return <div className="flex items-center justify-center h-64"><RefreshCw className="h-8 w-8 animate-spin text-gray-400" /></div>;

  const draftStatusBadge = (status: string) => {
    if (status === 'approved') return <Badge className="bg-green-100 text-green-800 border-green-200">Approved</Badge>;
    if (status === 'rejected') return <Badge className="bg-red-100 text-red-800 border-red-200">Rejected</Badge>;
    return <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200">Pending</Badge>;
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">{t('admin.resources')} ({resources.length})</h1>
        <Button onClick={() => navigate('/admin/resources/new')} className="gap-1.5">
          <Plus className="h-4 w-4" /> Add Resource
        </Button>
      </div>

      {/* Tab switcher: Published / Pending Drafts */}
      <div className="flex items-center gap-2 mb-4">
        <Button
          variant={tab === 'published' ? 'default' : 'outline'}
          size="sm"
          className="text-xs gap-1.5"
          onClick={() => setTab('published')}
        >
          Published ({resources.length})
        </Button>
        <Button
          variant={tab === 'drafts' ? 'default' : 'outline'}
          size="sm"
          className="text-xs gap-1.5"
          onClick={() => setTab('drafts')}
        >
          Pending Drafts
          {pendingDraftsCount > 0 && (
            <span className="bg-yellow-200 text-yellow-800 rounded-full px-1.5 text-[10px] font-bold ml-1">{pendingDraftsCount}</span>
          )}
        </Button>
        <div className="ml-auto">
          <Button variant="ghost" size="sm" onClick={loadAll}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* =============== PUBLISHED RESOURCES TABLE =============== */}
      {tab === 'published' && (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="text-left p-4 font-medium">Title</th>
                    <th className="text-left p-4 font-medium">Type</th>
                    <th className="text-left p-4 font-medium">Access</th>
                    <th className="text-left p-4 font-medium">Lang</th>
                    <th className="text-left p-4 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {resources.map(r => (
                    <tr
                      key={r.id}
                      className="border-b cursor-pointer hover:bg-muted/50 transition-colors"
                      onClick={() => navigate(`/admin/resources/${r.id}`)}
                    >
                      <td className="p-4">
                        <div className="font-medium">{r.title}</div>
                        <div className="text-sm text-gray-500 truncate max-w-xs">{r.summary}</div>
                      </td>
                      <td className="p-4"><Badge variant="outline">{r.type}</Badge></td>
                      <td className="p-4"><Badge variant={r.access_level === 'public' ? 'success' : 'info'}>{r.access_level}</Badge></td>
                      <td className="p-4">{r.language}</td>
                      <td className="p-4"><Badge variant={r.published ? 'success' : 'secondary'}>{r.published ? 'Published' : 'Draft'}</Badge></td>
                    </tr>
                  ))}
                  {resources.length === 0 && (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-gray-400">No resources yet</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* =============== DRAFTS TABLE =============== */}
      {tab === 'drafts' && (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="text-left p-4 font-medium">Title</th>
                    <th className="text-left p-4 font-medium">Type</th>
                    <th className="text-left p-4 font-medium">Language</th>
                    <th className="text-left p-4 font-medium">Status</th>
                    <th className="text-left p-4 font-medium">Submitted By</th>
                    <th className="text-left p-4 font-medium">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {drafts.map(d => (
                    <tr
                      key={d.id}
                      className="border-b cursor-pointer hover:bg-muted/50 transition-colors"
                      onClick={() => navigate(`/admin/resources/${d.id}?type=draft`)}
                    >
                      <td className="p-4">
                        <div className="font-medium max-w-xs truncate">{d.title}</div>
                        {d.summary && <div className="text-sm text-gray-500 truncate max-w-xs">{d.summary}</div>}
                      </td>
                      <td className="p-4"><Badge variant="outline">{d.type || '---'}</Badge></td>
                      <td className="p-4 text-sm">{d.language || '---'}</td>
                      <td className="p-4">{draftStatusBadge(d.status)}</td>
                      <td className="p-4">
                        <div className="text-sm font-medium">{d.submitter_name}</div>
                        <div className="text-xs text-gray-500">{d.submitter_email}</div>
                      </td>
                      <td className="p-4 text-sm text-gray-500">{new Date(d.created_at).toLocaleDateString()}</td>
                    </tr>
                  ))}
                  {drafts.length === 0 && (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-gray-400">No resource drafts</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
