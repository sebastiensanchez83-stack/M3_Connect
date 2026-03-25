import { useState, useEffect } from 'react';
import { RefreshCw, Plus, Pencil } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { RichTextEditor } from '@/components/ui/RichTextEditor';
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
import type { ResourceDraft } from './types';

export function AdminResourceDrafts() {
  const { user } = useAuth();
  const [drafts, setDrafts] = useState<ResourceDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ResourceDraft | null>(null);
  const [formData, setFormData] = useState({ title: '', summary: '', content: '', type: 'article', topic: 'Sustainability', language: 'EN', access_level: 'public' });

  const types = ['article', 'whitepaper', 'guide', 'replay', 'case_study'];
  const topics = ['Sustainability', 'Technology', 'Energy', 'Management', 'Events', 'Infrastructure'];

  useEffect(() => { load(); }, []);
  const load = async () => { setLoading(true); const { data } = await supabase.from('resource_drafts').select('*').order('created_at', { ascending: false }); setDrafts(data || []); setLoading(false); };

  const openCreate = () => { setEditing(null); setFormData({ title: '', summary: '', content: '', type: 'article', topic: 'Sustainability', language: 'EN', access_level: 'public' }); setIsDialogOpen(true); };
  const openEdit = (d: ResourceDraft) => { setEditing(d); setFormData({ title: d.title, summary: d.summary || '', content: d.content, type: d.type || 'article', topic: d.topic || 'Sustainability', language: d.language || 'EN', access_level: d.access_level || 'public' }); setIsDialogOpen(true); };

  const handleSave = async () => {
    const payload = { title: formData.title, summary: formData.summary || null, content: formData.content, type: formData.type, topic: formData.topic, language: formData.language, access_level: formData.access_level, created_by: user!.id };
    if (editing) { await supabase.from('resource_drafts').update(payload).eq('id', editing.id); toast({ title: 'Draft updated' }); }
    else { await supabase.from('resource_drafts').insert({ ...payload, status: 'draft' }); toast({ title: 'Draft created' }); }
    setIsDialogOpen(false); load();
  };

  const updateStatus = async (id: string, status: string) => {
    if (status === 'published') {
      const draft = drafts.find(d => d.id === id);
      if (!draft) return;
      const { error: pubError } = await supabase.from('resources').insert({
        title: draft.title, summary: draft.summary, content: draft.content, type: draft.type, topic: draft.topic,
        language: draft.language, access_level: draft.access_level, published: true,
      });
      if (pubError) { toast({ title: 'Publish failed', description: pubError.message, variant: 'destructive' }); return; }
      await supabase.from('resource_drafts').update({ status: 'published' }).eq('id', id);
      toast({ title: 'Resource published!' }); load(); return;
    }
    await supabase.from('resource_drafts').update({ status }).eq('id', id);
    toast({ title: `Status: ${status}` }); load();
  };

  if (loading) return <div className="flex items-center justify-center h-64"><RefreshCw className="h-8 w-8 animate-spin text-gray-400" /></div>;

  return (
    <div>
      <div className="flex justify-between items-center mb-6"><h1 className="text-2xl font-bold">Resource Drafts ({drafts.length})</h1><Button onClick={openCreate}><Plus className="h-4 w-4 mr-2" />New Draft</Button></div>
      <Card><CardContent className="p-0"><div className="overflow-x-auto"><table className="w-full"><thead className="bg-gray-50 border-b"><tr>
        <th className="text-left p-4 font-medium">Title</th><th className="text-left p-4 font-medium">Type</th><th className="text-left p-4 font-medium">Status</th><th className="text-left p-4 font-medium">Date</th><th className="text-left p-4 font-medium">Actions</th>
      </tr></thead><tbody>
        {drafts.map(d => (<tr key={d.id} className="border-b hover:bg-gray-50">
          <td className="p-4"><div className="font-medium">{d.title}</div></td>
          <td className="p-4"><Badge variant="outline">{d.type || '—'}</Badge></td>
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
        {drafts.length === 0 && <tr><td colSpan={5} className="p-8 text-center text-gray-400">No resource drafts</td></tr>}
      </tbody></table></div></CardContent></Card>
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}><DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>{editing ? 'Edit Resource Draft' : 'New Resource Draft'}</DialogTitle><DialogDescription>Create or edit a resource draft for review.</DialogDescription></DialogHeader><div className="space-y-4 mt-4">
        <div className="space-y-2"><Label>Title *</Label><Input value={formData.title} onChange={e => setFormData({ ...formData, title: e.target.value })} /></div>
        <div className="space-y-2"><Label>Summary</Label><Textarea value={formData.summary} onChange={e => setFormData({ ...formData, summary: e.target.value })} rows={2} /></div>
        <div className="space-y-2"><Label>Content *</Label><RichTextEditor content={formData.content} onChange={(html) => setFormData({ ...formData, content: html })} placeholder="Write the resource content..." /></div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2"><Label>Type</Label><Select value={formData.type} onValueChange={v => setFormData({ ...formData, type: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{types.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-2"><Label>Topic</Label><Select value={formData.topic} onValueChange={v => setFormData({ ...formData, topic: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{topics.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select></div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2"><Label>Language</Label><Select value={formData.language} onValueChange={v => setFormData({ ...formData, language: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="EN">English</SelectItem><SelectItem value="FR">Français</SelectItem></SelectContent></Select></div>
          <div className="space-y-2"><Label>Access</Label><Select value={formData.access_level} onValueChange={v => setFormData({ ...formData, access_level: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="public">Public</SelectItem><SelectItem value="members">Members</SelectItem><SelectItem value="marina">Marina</SelectItem></SelectContent></Select></div>
        </div>
        <div className="flex justify-end gap-2 pt-4"><Button variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button><Button onClick={handleSave}>{editing ? 'Update' : 'Create'}</Button></div>
      </div></DialogContent></Dialog>
    </div>
  );
}
