import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { RefreshCw, Plus, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import type { Resource, ResourceDraft } from './types';
import {
  AdminPageHeader, AdminTableCard, AdminStatusPill, AdminSegmented, AdminEmpty, AdminLoading, ADMIN_BTN_PRIMARY,
} from './AdminUI';

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

  const pendingDraftsCount = drafts.filter(d => ['submitted', 'review_1', 'review_2'].includes(d.status)).length;

  if (loading) return <AdminLoading />;

  const draftStatusBadge = (status: string) => {
    if (status === 'approved') return <AdminStatusPill tone="success">Approved</AdminStatusPill>;
    if (status === 'rejected') return <AdminStatusPill tone="danger">Rejected</AdminStatusPill>;
    return <AdminStatusPill tone="warning">Pending</AdminStatusPill>;
  };

  return (
    <div>
      <AdminPageHeader
        title={t('admin.resources')}
        count={resources.length}
        description={t('adminUi.pages.resources')}
        actions={
          <Button variant="secondary" size="sm" className={ADMIN_BTN_PRIMARY} onClick={() => navigate('/admin/resources/new')}>
            <Plus className="h-4 w-4 mr-1.5" /> Add Resource
          </Button>
        }
      />

      {/* Tab switcher: Published / Pending Drafts */}
      <div className="mb-4 flex items-center gap-2">
        <AdminSegmented
          label="Resources view"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'published', label: `Published (${resources.length})` },
            { value: 'drafts', label: 'Pending Drafts', badge: pendingDraftsCount },
          ]}
        />
        <div className="ml-auto">
          <Button variant="ghost" size="sm" className="h-10 w-10 rounded-pill p-0 text-meta hover:text-navy" onClick={loadAll} aria-label="Refresh">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* =============== PUBLISHED RESOURCES TABLE =============== */}
      {tab === 'published' && (
        <AdminTableCard footer={`${resources.length} resources`}>
          <table className="w-full">
            <thead>
              <tr>
                <th className="text-left">Title</th>
                <th className="text-left">Type</th>
                <th className="text-left">Access</th>
                <th className="text-left">Lang</th>
                <th className="text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {resources.map(r => (
                <tr
                  key={r.id}
                  className="cursor-pointer"
                  onClick={() => navigate(`/admin/resources/${r.id}`)}
                >
                  <td>
                    <Link
                      to={`/admin/resources/${r.id}`}
                      onClick={e => e.stopPropagation()}
                      className="rounded-sm font-semibold text-navy focus:outline-none focus-visible:shadow-focus"
                    >
                      <span className="card-ul">{r.title}</span>
                    </Link>
                    <div className="max-w-md truncate text-[13px] text-meta">{r.summary}</div>
                  </td>
                  <td><AdminStatusPill>{r.type}</AdminStatusPill></td>
                  <td><AdminStatusPill tone={r.access_level === 'public' ? 'success' : 'info'}>{r.access_level}</AdminStatusPill></td>
                  <td className="text-sm text-ink">{r.language}</td>
                  <td><AdminStatusPill tone={r.published ? 'success' : 'neutral'}>{r.published ? 'Published' : 'Draft'}</AdminStatusPill></td>
                </tr>
              ))}
              {resources.length === 0 && (
                <tr>
                  <td colSpan={5}><AdminEmpty icon={FileText} title="No resources yet" /></td>
                </tr>
              )}
            </tbody>
          </table>
        </AdminTableCard>
      )}

      {/* =============== DRAFTS TABLE =============== */}
      {tab === 'drafts' && (
        <AdminTableCard footer={`${drafts.length} drafts`}>
          <table className="w-full">
            <thead>
              <tr>
                <th className="text-left">Title</th>
                <th className="text-left">Type</th>
                <th className="text-left">Language</th>
                <th className="text-left">Status</th>
                <th className="text-left">Submitted By</th>
                <th className="text-left">Date</th>
              </tr>
            </thead>
            <tbody>
              {drafts.map(d => (
                <tr
                  key={d.id}
                  className="cursor-pointer"
                  onClick={() => navigate(`/admin/resources/${d.id}?type=draft`)}
                >
                  <td>
                    <Link
                      to={`/admin/resources/${d.id}?type=draft`}
                      onClick={e => e.stopPropagation()}
                      className="block max-w-md truncate rounded-sm font-semibold text-navy focus:outline-none focus-visible:shadow-focus"
                    >
                      <span className="card-ul">{d.title}</span>
                    </Link>
                    {d.summary && <div className="max-w-md truncate text-[13px] text-meta">{d.summary}</div>}
                  </td>
                  <td><AdminStatusPill>{d.type || '---'}</AdminStatusPill></td>
                  <td className="text-sm text-ink">{d.language || '---'}</td>
                  <td>{draftStatusBadge(d.status)}</td>
                  <td>
                    <div className="text-sm font-medium text-ink">{d.submitter_name}</div>
                    <div className="text-xs text-meta">{d.submitter_email}</div>
                  </td>
                  <td className="whitespace-nowrap text-sm text-meta">{new Date(d.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
              {drafts.length === 0 && (
                <tr>
                  <td colSpan={6}><AdminEmpty icon={FileText} title="No resource drafts" /></td>
                </tr>
              )}
            </tbody>
          </table>
        </AdminTableCard>
      )}
    </div>
  );
}
