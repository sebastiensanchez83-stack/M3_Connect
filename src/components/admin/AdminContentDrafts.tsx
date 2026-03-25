import { useState, useEffect } from 'react';
import { RefreshCw, Plus, Pencil } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import type { ContentDraft } from './types';

export function AdminContentDrafts() {
  const { user } = useAuth();
  const [drafts, setDrafts] = useState<ContentDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ContentDraft | null>(null);
  const [formData, setFormData] = useState({ title: '', summary: '', body_markdown: '', tags: '' });

  useEffect(() => { load(); }, []);
  const load = async () => { setLoading(true); const { data } = await supabase.from('content_drafts').select('*').order('created_at', { ascending: false }); setDrafts(data || []); setLoading(false); };

  const openCreate = () => { setEditing(null); setFormData({ title: '', summary: '', body_markdown: '', tags: '' }); setIsDialogOpen(true); };
  const openEdit = (d: ContentDraft) => { setEditing(d); setFormData({ title: d.title, summary: d.summary || '', body_markdown: d.body_markdown, tags: d.tags.join(', ') }); setIsDialogOpen(true); };

  const handleSave = async () => {
    const tags = formData.tags.split(',').map(t => t.trim()).filter(Boolean);
    const payload = { title: formData.title, summary: formData.summary || null, body_markdown: formData.body_markdown, tags, created_by: user!.id };
    if (editing) { await supabase.from('content_drafts').update(payload).eq('id', editing.id); toast({ title: 'Draft updated' }); }
    else { await supabase.from('content_drafts').insert({ ...payload, status: 'draft' }); toast({ title: 'Draft created' }); }
    setIsDialogOpen(false); load();
  };

  const updateStatus = async (id: string, status: string) => {
    if (status === 'published') {
      // Publish: create content_item from draft
      const draft = drafts.find(d => d.id === id);
      if (!draft) return;
      const { error: pubError } = await supabase.from('content_items').insert({
        title: draft.title, summary: draft.summary, body_markdown: draft.body_markdown,
        tags: draft.tags, is_published: true, published_at: new Date().toISOString(), published_by: user!.id,
      });
      if (pubError) { toast({ title: 'Publish failed', description: pubError.message, variant: 'destructive' }); return; }
      await supabase.from('content_drafts').update({ status: 'published' }).eq('id', id);
      toast({ title: 'Content published!' }); load(); return;
    }
    await supabase.from('content_drafts').update({ status }).eq('id', id);
    toast({ title: `Status: ${status}` }); load();
  };

  const statusColor = (s: string): 'secondary' | 'warning' | 'info' | 'success' | 'destructive' => {
    const m: Record<string, 'secondary' | 'warning' | 'info' | 'success' | 'destructive'> = { draft: 'secondary', submitted: 'warning', review_1: 'info', review_2: 'info', approved: 'success', published: 'success', rejected: 'destructive' };
    return m[s] || 'secondary';
  };

  if (loading) return <div className="flex items-center justify-center h-64"><RefreshCw className="h-8 w-8 animate-spin text-gray-400" /></div>;

  return (
    <div>
      <div className="flex justify-between items-center mb-6"><h1 className="text-2xl font-bold">CMS Content ({drafts.length})</h1><Button onClick={openCreate}><Plus className="h-4 w-4 mr-2" />New Draft</Button></div>
      <Card><CardContent className="p-0"><div className="overflow-x-auto"><table className="w-full"><thead className="bg-gray-50 border-b"><tr>
        <th className="text-left p-4 font-medium">Title</th><th className="text-left p-4 font-medium">Tags</th><th className="text-left p-4 font-medium">Status</th><th className="text-left p-4 font-medium">Date</th><th className="text-left p-4 font-medium">Actions</th>
      </tr></thead><tbody>
        {drafts.map(d => (<tr key={d.id} className="border-b hover:bg-gray-50">
          <td className="p-4"><div className="font-medium">{d.title}</div>{d.summary && <div className="text-sm text-gray-500 truncate max-w-xs">{d.summary}</div>}</td>
          <td className="p-4"><div className="flex flex-wrap gap-1">{d.tags.map(t => <Badge key={t} variant="outline" className="text-xs">{t}</Badge>)}</div></td>
          <td className="p-4">
            <Select value={d.status} onValueChange={v => updateStatus(d.id, v)}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Draft</SelectItem><SelectItem value="submitted">Submitted</SelectItem>
                <SelectItem value="review_1">Review 1</SelectItem><SelectItem value="review_2">Review 2</SelectItem>
                <SelectItem value="approved">Approved</SelectItem><SelectItem value="published">Publish</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>
          </td>
          <td className="p-4 text-sm text-gray-500">{new Date(d.created_at).toLocaleDateString()}</td>
          <td className="p-4"><Button size="sm" variant="ghost" onClick={() => openEdit(d)}><Pencil className="h-4 w-4" /></Button></td>
        </tr>))}
        {drafts.length === 0 && <tr><td colSpan={5} className="p-8 text-center text-gray-400">No content drafts</td></tr>}
      </tbody></table></div></CardContent></Card>
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}><DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>{editing ? 'Edit Draft' : 'New Content Draft'}</DialogTitle><DialogDescription>Write content for the platform.</DialogDescription></DialogHeader><div className="space-y-4 mt-4">
        <div className="space-y-2"><Label>Title *</Label><Input value={formData.title} onChange={e => setFormData({ ...formData, title: e.target.value })} /></div>
        <div className="space-y-2"><Label>Summary</Label><Textarea value={formData.summary} onChange={e => setFormData({ ...formData, summary: e.target.value })} rows={2} /></div>
        <div className="space-y-2"><Label>Body (Markdown) *</Label><Textarea value={formData.body_markdown} onChange={e => setFormData({ ...formData, body_markdown: e.target.value })} rows={10} className="font-mono text-sm" /></div>
        <div className="space-y-2"><Label>Tags (comma-separated)</Label><Input value={formData.tags} onChange={e => setFormData({ ...formData, tags: e.target.value })} placeholder="sustainability, technology, marina" /></div>
        <div className="flex justify-end gap-2 pt-4"><Button variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button><Button onClick={handleSave}>{editing ? 'Update' : 'Create'}</Button></div>
      </div></DialogContent></Dialog>
    </div>
  );
}
