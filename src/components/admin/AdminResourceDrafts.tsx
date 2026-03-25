import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Eye, CheckCircle, XCircle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import type { ResourceDraft } from './types';

type DraftStatus = 'all' | 'pending' | 'approved' | 'rejected';

interface DraftRow extends ResourceDraft {
  submitter_name: string;
  submitter_email: string;
}

function statusBadge(status: string) {
  if (status === 'approved') {
    return <Badge className="bg-green-100 text-green-800 border-green-200">Approved</Badge>;
  }
  if (status === 'rejected') {
    return <Badge className="bg-red-100 text-red-800 border-red-200">Rejected</Badge>;
  }
  return <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200">Pending</Badge>;
}

export function AdminResourceDrafts() {
  const { user } = useAuth();
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<DraftStatus>('all');
  const [selected, setSelected] = useState<DraftRow | null>(null);
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);

    const { data: rows, error } = await supabase
      .from('resource_drafts')
      .select('*')
      .order('created_at', { ascending: false });

    if (error || !rows) {
      toast({ title: 'Failed to load drafts', description: error?.message, variant: 'destructive' });
      setLoading(false);
      return;
    }

    const userIds = [...new Set(rows.map((r: ResourceDraft) => r.created_by))];
    const profileMap: Record<string, { name: string; email: string }> = {};

    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, first_name, last_name, email')
        .in('user_id', userIds);

      (profiles || []).forEach((p: { user_id: string; first_name: string | null; last_name: string | null; email: string | null }) => {
        profileMap[p.user_id] = {
          name: `${p.first_name || ''} ${p.last_name || ''}`.trim() || p.user_id.slice(0, 8),
          email: p.email || '—',
        };
      });
    }

    setDrafts(
      rows.map((r: ResourceDraft) => ({
        ...r,
        submitter_name: profileMap[r.created_by]?.name ?? r.created_by.slice(0, 8),
        submitter_email: profileMap[r.created_by]?.email ?? '—',
      })),
    );
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = drafts.filter(d => statusFilter === 'all' || d.status === statusFilter);

  const openDetail = (draft: DraftRow) => {
    setSelected(draft);
    setComment('');
  };

  const handleApprove = async () => {
    if (!selected || !user) return;
    setSaving(true);

    let resourceId = selected.resource_id;

    if (resourceId) {
      // Update existing resource
      const { error: updateErr } = await supabase
        .from('resources')
        .update({
          title: selected.title,
          summary: selected.summary,
          content: selected.content,
          type: selected.type,
          topic: selected.topic,
          language: selected.language,
          access_level: selected.access_level,
          thumbnail_url: selected.thumbnail_url ?? null,
          file_url: selected.file_url ?? null,
          published: true,
        })
        .eq('id', resourceId);

      if (updateErr) {
        toast({ title: 'Failed to update resource', description: updateErr.message, variant: 'destructive' });
        setSaving(false);
        return;
      }
    } else {
      // Insert new resource
      const { data: newResource, error: insertErr } = await supabase
        .from('resources')
        .insert({
          title: selected.title,
          summary: selected.summary ?? '',
          content: selected.content,
          type: selected.type ?? 'article',
          topic: selected.topic ?? 'Sustainability',
          language: selected.language ?? 'EN',
          access_level: selected.access_level ?? 'public',
          thumbnail_url: selected.thumbnail_url ?? null,
          file_url: selected.file_url ?? null,
          published: true,
        })
        .select('id')
        .single();

      if (insertErr || !newResource) {
        toast({ title: 'Failed to publish resource', description: insertErr?.message, variant: 'destructive' });
        setSaving(false);
        return;
      }

      resourceId = newResource.id as string;

      // Backfill resource_id on the draft
      await supabase
        .from('resource_drafts')
        .update({ resource_id: resourceId })
        .eq('id', selected.id);
    }

    // Record approval
    const { error: approvalErr } = await supabase.from('resource_approvals').insert({
      draft_id: selected.id,
      reviewer_id: user.id,
      decision: 'approved',
      comment: comment.trim() || null,
    });

    if (approvalErr) {
      toast({ title: 'Approval recorded but log failed', description: approvalErr.message, variant: 'destructive' });
    }

    // Update draft status
    await supabase.from('resource_drafts').update({ status: 'approved' }).eq('id', selected.id);

    toast({ title: 'Resource approved and published!' });
    setSelected(null);
    setSaving(false);
    load();
  };

  const handleReject = async () => {
    if (!selected || !user) return;
    if (!comment.trim()) {
      toast({ title: 'A rejection comment is required.', variant: 'destructive' });
      return;
    }
    setSaving(true);

    const { error: approvalErr } = await supabase.from('resource_approvals').insert({
      draft_id: selected.id,
      reviewer_id: user.id,
      decision: 'rejected',
      comment: comment.trim(),
    });

    if (approvalErr) {
      toast({ title: 'Failed to record rejection', description: approvalErr.message, variant: 'destructive' });
      setSaving(false);
      return;
    }

    await supabase.from('resource_drafts').update({ status: 'rejected' }).eq('id', selected.id);

    toast({ title: 'Draft rejected.' });
    setSelected(null);
    setSaving(false);
    load();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Resource Drafts ({filtered.length})</h1>
        <div className="flex items-center gap-3">
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as DraftStatus)}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="ghost" size="sm" onClick={load}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Table */}
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
                  <th className="text-left p-4 font-medium">Submitted by</th>
                  <th className="text-left p-4 font-medium">Date</th>
                  <th className="text-left p-4 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((d) => (
                  <tr key={d.id} className="border-b hover:bg-gray-50">
                    <td className="p-4">
                      <div className="font-medium max-w-xs truncate">{d.title}</div>
                      {d.summary && (
                        <div className="text-sm text-gray-500 truncate max-w-xs">{d.summary}</div>
                      )}
                    </td>
                    <td className="p-4">
                      <Badge variant="outline">{d.type || '—'}</Badge>
                    </td>
                    <td className="p-4 text-sm">{d.language || '—'}</td>
                    <td className="p-4">{statusBadge(d.status)}</td>
                    <td className="p-4">
                      <div className="text-sm font-medium">{d.submitter_name}</div>
                      <div className="text-xs text-gray-500">{d.submitter_email}</div>
                    </td>
                    <td className="p-4 text-sm text-gray-500">
                      {new Date(d.created_at).toLocaleDateString()}
                    </td>
                    <td className="p-4">
                      <Button size="sm" variant="ghost" onClick={() => openDetail(d)}>
                        <Eye className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-gray-400">
                      No resource drafts found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Detail / Review Dialog */}
      <Dialog open={!!selected} onOpenChange={() => setSelected(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Review Resource Draft</DialogTitle>
            <DialogDescription>
              Approve to publish, or reject with a required comment.
            </DialogDescription>
          </DialogHeader>

          {selected && (
            <div className="space-y-4 mt-2">
              {/* Meta grid */}
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                <div>
                  <span className="font-medium text-gray-600">Title: </span>
                  {selected.title}
                </div>
                <div>
                  <span className="font-medium text-gray-600">Status: </span>
                  {statusBadge(selected.status)}
                </div>
                <div>
                  <span className="font-medium text-gray-600">Type: </span>
                  {selected.type || '—'}
                </div>
                <div>
                  <span className="font-medium text-gray-600">Topic: </span>
                  {selected.topic || '—'}
                </div>
                <div>
                  <span className="font-medium text-gray-600">Language: </span>
                  {selected.language || '—'}
                </div>
                <div>
                  <span className="font-medium text-gray-600">Access: </span>
                  {selected.access_level || '—'}
                </div>
                <div>
                  <span className="font-medium text-gray-600">Submitted by: </span>
                  {selected.submitter_name}
                </div>
                <div>
                  <span className="font-medium text-gray-600">Email: </span>
                  {selected.submitter_email}
                </div>
                <div>
                  <span className="font-medium text-gray-600">Submitted: </span>
                  {new Date(selected.created_at).toLocaleString()}
                </div>
                {selected.resource_id && (
                  <div>
                    <span className="font-medium text-gray-600">Updating resource: </span>
                    <span className="text-xs text-gray-400 font-mono">{selected.resource_id}</span>
                  </div>
                )}
              </div>

              {/* Summary */}
              {selected.summary && (
                <div>
                  <p className="text-sm font-medium text-gray-600 mb-1">Summary</p>
                  <p className="text-sm p-3 bg-gray-50 rounded border">{selected.summary}</p>
                </div>
              )}

              {/* Content */}
              <div>
                <p className="text-sm font-medium text-gray-600 mb-1">Content</p>
                <div
                  className="text-sm p-3 bg-gray-50 rounded border max-h-52 overflow-y-auto prose prose-sm"
                  dangerouslySetInnerHTML={{ __html: selected.content }}
                />
              </div>

              {/* File / thumbnail links */}
              {(selected.thumbnail_url || selected.file_url) && (
                <div className="flex gap-4 text-sm">
                  {selected.thumbnail_url && (
                    <a href={selected.thumbnail_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">
                      Thumbnail
                    </a>
                  )}
                  {selected.file_url && (
                    <a href={selected.file_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">
                      Attached file
                    </a>
                  )}
                </div>
              )}

              {/* Reviewer comment */}
              <div className="space-y-2">
                <Label>
                  Reviewer comment{' '}
                  <span className="text-gray-400 font-normal">(required to reject)</span>
                </Label>
                <Textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  rows={3}
                  placeholder="Add notes for the submitter…"
                  disabled={selected.status !== 'pending'}
                />
              </div>

              {/* Action buttons */}
              {selected.status === 'pending' && (
                <div className="flex gap-3 pt-2">
                  <Button
                    className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                    onClick={handleApprove}
                    disabled={saving}
                  >
                    <CheckCircle className="h-4 w-4 mr-2" />
                    Approve & Publish
                  </Button>
                  <Button
                    variant="destructive"
                    className="flex-1"
                    onClick={handleReject}
                    disabled={saving}
                  >
                    <XCircle className="h-4 w-4 mr-2" />
                    Reject
                  </Button>
                </div>
              )}

              {selected.status !== 'pending' && (
                <p className="text-sm text-gray-400 text-center pt-1">
                  This draft has already been {selected.status}.
                </p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
