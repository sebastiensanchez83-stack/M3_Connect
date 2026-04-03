import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { AdminContextBanner } from './AdminContextBanner';
import { RefreshCw, Eye } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { sendNotification } from '@/lib/notifications';
import type { MarinaProject } from './types';

export function AdminProjects() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlStatus = searchParams.get('status');
  const [projects, setProjects] = useState<MarinaProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedProject, setSelectedProject] = useState<MarinaProject | null>(null);
  const [adminNotes, setAdminNotes] = useState('');

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
      (profiles || []).forEach((p: { user_id: string; first_name: string; last_name: string }) => { nameMap[p.user_id] = `${p.first_name || ''} ${p.last_name || ''}`.trim() || p.user_id.slice(0, 8); });
    }
    setMarinaNames(nameMap);
    setProjects(rows);
    setLoading(false);
  };
  const updateStatus = async (id: string, status: string) => {
    await supabase.from('marina_projects').update({ status }).eq('id', id);
    // Notify the project owner about the status change
    const project = projects.find(p => p.id === id);
    if (project) {
      sendNotification({
        type: 'rfp_submitted',
        userId: project.user_id,
        data: {
          submission_type: 'Project Status Update',
          title: project.project_type,
          details: `Your project status has been updated to: ${status.replace('_', ' ')}`,
        },
      });
    }
    toast({ title: `Status: ${status}` });
    loadProjects();
  };
  const saveNotes = async () => { if (!selectedProject) return; await supabase.from('marina_projects').update({ admin_notes: adminNotes }).eq('id', selectedProject.id); toast({ title: 'Notes saved' }); setSelectedProject(null); loadProjects(); };

  if (loading) return <div className="flex items-center justify-center h-64"><RefreshCw className="h-8 w-8 animate-spin text-gray-400" /></div>;

  return (
    <div>
      {urlStatus && <AdminContextBanner label={`Filtered by status: ${urlStatus}`} count={filteredProjects.length} onClear={clearFilter} color={bannerColor} />}
      <div className="flex justify-between items-center mb-6"><h1 className="text-2xl font-bold">{t('admin.marinaProjects')} ({filteredProjects.length})</h1></div>
      <Card><CardContent className="p-0"><table className="w-full"><thead className="bg-gray-50 border-b"><tr><th className="text-left p-4 font-medium">Marina</th><th className="text-left p-4 font-medium">Type</th><th className="text-left p-4 font-medium">Budget</th><th className="text-left p-4 font-medium">Status</th><th className="text-left p-4 font-medium">Date</th><th className="text-left p-4 font-medium">Actions</th></tr></thead><tbody>
        {filteredProjects.map(p => (<tr key={p.id} className="border-b hover:bg-gray-50"><td className="p-4 text-sm font-medium">{marinaNames[p.user_id] || p.user_id.slice(0, 8)}</td><td className="p-4">{p.project_type}</td><td className="p-4">{p.budget_range}</td><td className="p-4"><Select value={p.status} onValueChange={v => updateStatus(p.id, v)}><SelectTrigger className="w-32"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="new">New</SelectItem><SelectItem value="in_progress">In Progress</SelectItem><SelectItem value="completed">Completed</SelectItem></SelectContent></Select></td><td className="p-4 text-gray-500">{new Date(p.created_at).toLocaleDateString()}</td><td className="p-4"><Button size="sm" variant="ghost" aria-label="View details" onClick={() => { setSelectedProject(p); setAdminNotes(p.admin_notes || ''); }}><Eye className="h-4 w-4" /></Button></td></tr>))}
      </tbody></table></CardContent></Card>
      <Dialog open={!!selectedProject} onOpenChange={() => setSelectedProject(null)}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>Project Details</DialogTitle><DialogDescription>View and manage project notes.</DialogDescription></DialogHeader>{selectedProject && (<div className="space-y-4 mt-4"><div><strong>Type:</strong> {selectedProject.project_type}</div><div><strong>Budget:</strong> {selectedProject.budget_range}</div><div><strong>Description:</strong><p className="mt-1 p-2 bg-gray-50 rounded text-sm">{selectedProject.description}</p></div><div className="space-y-2"><Label>Admin Notes</Label><Textarea value={adminNotes} onChange={e => setAdminNotes(e.target.value)} rows={3} /></div><Button onClick={saveNotes} className="w-full">Save Notes</Button></div>)}</DialogContent></Dialog>
    </div>
  );
}
