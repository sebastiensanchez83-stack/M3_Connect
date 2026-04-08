import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Save, Loader2, Briefcase, User } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { sendNotification } from '@/lib/notifications';
import type { MarinaProject } from './types';

interface ProjectWithUser extends MarinaProject {
  profile_name: string;
  profile_email: string;
  org_name: string | null;
}

const STATUS_BADGE: Record<string, { variant: any; label: string }> = {
  new: { variant: 'info', label: 'New' },
  submitted: { variant: 'info', label: 'Submitted' },
  under_review: { variant: 'warning', label: 'Under Review' },
  in_progress: { variant: 'warning', label: 'In Progress' },
  approved: { variant: 'success', label: 'Approved' },
  completed: { variant: 'success', label: 'Completed' },
  rejected: { variant: 'destructive', label: 'Rejected' },
  archived: { variant: 'outline', label: 'Archived' },
};

export function AdminProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [project, setProject] = useState<ProjectWithUser | null>(null);
  const [status, setStatus] = useState('new');
  const [adminNotes, setAdminNotes] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');

  useEffect(() => {
    if (id) loadProject(id);
  }, [id]);

  const loadProject = async (projectId: string) => {
    setLoading(true);
    const { data, error } = await supabase
      .from('marina_projects')
      .select('*')
      .eq('id', projectId)
      .single();

    if (error || !data) {
      toast({ title: 'Project not found', variant: 'destructive' });
      navigate('/admin/projects');
      return;
    }

    // Enrich with user info
    const { data: profile } = await supabase
      .from('profiles')
      .select('user_id, first_name, last_name, email')
      .eq('user_id', data.user_id)
      .single();

    const { data: membership } = await supabase
      .from('organization_members')
      .select('user_id, organizations(name)')
      .eq('user_id', data.user_id)
      .maybeSingle();

    const org = membership?.organizations as unknown as Record<string, string> | null;

    const enriched: ProjectWithUser = {
      ...data,
      profile_name: profile
        ? `${profile.first_name || ''} ${profile.last_name || ''}`.trim() || profile.email || data.user_id.slice(0, 8)
        : data.user_id.slice(0, 8),
      profile_email: profile?.email || '',
      org_name: org?.name || null,
    };

    setProject(enriched);
    setStatus(enriched.status);
    setAdminNotes(enriched.admin_notes || '');
    setRejectionReason(data.rejection_reason || '');
    setLoading(false);
  };

  const handleSave = async () => {
    if (!project) return;
    setSaving(true);

    const { error } = await supabase
      .from('marina_projects')
      .update({ status, admin_notes: adminNotes, rejection_reason: rejectionReason || null })
      .eq('id', project.id);

    if (error) {
      toast({ title: 'Failed to save', variant: 'destructive' });
      setSaving(false);
      return;
    }

    // Notify on status change
    if (status !== project.status) {
      if (status === 'rejected') {
        sendNotification({
          type: 'project_rejected',
          userId: project.user_id,
          data: {
            title: project.project_type,
            reason: rejectionReason,
          },
        });
      } else {
        sendNotification({
          type: 'project_status_updated',
          userId: project.user_id,
          data: {
            submission_type: 'Project Status Update',
            title: project.project_type,
            details: `Your project status has been updated to: ${status.replace('_', ' ')}`,
          },
        });
      }
    }

    toast({ title: 'Project saved!' });
    loadProject(project.id);
    setSaving(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!project) return null;

  const badge = STATUS_BADGE[project.status] || { variant: 'outline', label: project.status };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate('/admin/projects')} className="gap-1.5">
            <ArrowLeft className="h-4 w-4" /> Projects
          </Button>
          <Separator orientation="vertical" className="h-6" />
          <h1 className="text-xl font-bold text-gray-900">{project.project_type}</h1>
          <Badge variant={badge.variant}>{badge.label}</Badge>
        </div>
        <Button onClick={handleSave} disabled={saving} className="gap-1.5">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save Changes
        </Button>
      </div>

      {/* Project Details */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold text-gray-700 flex items-center gap-2">
            <Briefcase className="h-4 w-4 text-blue-500" /> Project Details
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <Label className="text-xs text-gray-500">Project Type</Label>
              <p className="text-sm font-medium mt-1">{project.project_type}</p>
            </div>
            <div>
              <Label className="text-xs text-gray-500">Budget Range</Label>
              <p className="text-sm font-medium mt-1">{project.budget_range}</p>
            </div>
            <div>
              <Label className="text-xs text-gray-500">Timeline</Label>
              <p className="text-sm font-medium mt-1">{project.timeline}</p>
            </div>
          </div>
          <div>
            <Label className="text-xs text-gray-500">Description</Label>
            <p className="mt-1 p-3 bg-gray-50 rounded-lg text-sm whitespace-pre-wrap">{project.description}</p>
          </div>
          <div>
            <Label className="text-xs text-gray-500">Submitted</Label>
            <p className="text-sm mt-1">{new Date(project.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
          </div>
        </CardContent>
      </Card>

      {/* Submitted By */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold text-gray-700 flex items-center gap-2">
            <User className="h-4 w-4 text-violet-500" /> Submitted By
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-violet-100 flex items-center justify-center text-sm font-bold text-violet-700">
              {(project.profile_name?.[0] || '?').toUpperCase()}
            </div>
            <div>
              <div className="text-sm font-medium text-gray-900">{project.profile_name}</div>
              <div className="text-xs text-gray-500">
                {project.profile_email}
                {project.org_name && <span> &bull; {project.org_name}</span>}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Admin Controls */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold text-gray-700">Admin Controls</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-full sm:w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="new">New</SelectItem>
                <SelectItem value="submitted">Submitted</SelectItem>
                <SelectItem value="under_review">Under Review</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
                <SelectItem value="archived">Archived</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {status === 'rejected' && (
            <div className="space-y-2">
              <Label>Rejection Reason</Label>
              <Textarea
                value={rejectionReason}
                onChange={e => setRejectionReason(e.target.value)}
                rows={3}
                placeholder="Explain why this project was rejected..."
              />
            </div>
          )}
          <div className="space-y-2">
            <Label>Admin Notes</Label>
            <Textarea
              value={adminNotes}
              onChange={e => setAdminNotes(e.target.value)}
              rows={4}
              placeholder="Internal notes about this project..."
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
