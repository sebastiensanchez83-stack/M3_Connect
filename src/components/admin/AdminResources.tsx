import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  RefreshCw, Search, Plus, Pencil, Trash2,
  ChevronUp, ChevronDown, UserPlus, X,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { RichTextEditor } from '@/components/ui/RichTextEditor';
import { ImageUpload } from '@/components/ui/ImageUpload';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
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
import type { Resource, SpeakerFormRow, ProfileSearchResult } from './types';

export function AdminResources() {
  const { t } = useTranslation();
  const { profile: authProfile } = useAuth();
  const isAdmin = authProfile?.persona === 'admin';
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingResource, setEditingResource] = useState<Resource | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  // Moderators create resources as unpublished (require admin approval)
  const [formData, setFormData] = useState({ title: '', summary: '', content: '', type: 'article', topic: 'Sustainability', language: 'EN', access_level: 'public', thumbnail_url: '', file_url: '', published: isAdmin });

  // Speaker management state
  const [speakers, setSpeakers] = useState<SpeakerFormRow[]>([]);
  const [profileSearch, setProfileSearch] = useState('');
  const [profileResults, setProfileResults] = useState<ProfileSearchResult[]>([]);
  const [linkingSpeakerIndex, setLinkingSpeakerIndex] = useState<number | null>(null);

  useEffect(() => { loadResources(); }, []);
  const loadResources = async () => { setLoading(true); const { data } = await supabase.from('resources').select('*').order('created_at', { ascending: false }); setResources(data || []); setLoading(false); };

  const openCreate = () => {
    setEditingResource(null);
    setFormData({ title: '', summary: '', content: '', type: 'article', topic: 'Sustainability', language: 'EN', access_level: 'public', thumbnail_url: '', file_url: '', published: isAdmin });
    setSpeakers([]);
    setIsDialogOpen(true);
  };

  const openEdit = async (resource: Resource) => {
    setEditingResource(resource);
    setFormData({ title: resource.title, summary: resource.summary, content: resource.content || '', type: resource.type, topic: resource.topic, language: resource.language, access_level: resource.access_level, thumbnail_url: resource.thumbnail_url || '', file_url: resource.file_url || '', published: resource.published });
    // Load existing speakers
    const { data: speakerData } = await supabase
      .from('resource_speakers')
      .select('*')
      .eq('resource_id', resource.id)
      .order('display_order');
    setSpeakers((speakerData || []).map((s: Record<string, unknown>) => ({
      id: s.id as string,
      profile_id: (s.profile_id as string) || null,
      full_name: (s.full_name as string) || '',
      job_title: (s.job_title as string) || '',
      company_name: (s.company_name as string) || '',
    })));
    setIsDialogOpen(true);
  };

  const handleSave = async () => {
    const payload = { ...formData, thumbnail_url: formData.thumbnail_url || null, file_url: formData.file_url || null, content: formData.content || null };
    let resourceId: string;

    if (editingResource) {
      await supabase.from('resources').update(payload).eq('id', editingResource.id);
      resourceId = editingResource.id;
      toast({ title: 'Resource updated!' });
    } else {
      // Moderators cannot publish directly — force unpublished
      if (!isAdmin) payload.published = false;
      const { data, error } = await supabase.from('resources').insert(payload).select('id').single();
      if (error || !data) { toast({ title: 'Error creating resource', variant: 'destructive' }); return; }
      resourceId = data.id;
      toast({ title: isAdmin ? 'Resource created!' : 'Resource saved as draft — pending admin approval' });
    }

    // Save speakers: delete all existing, re-insert with current order
    await supabase.from('resource_speakers').delete().eq('resource_id', resourceId);
    if (speakers.length > 0) {
      const speakerRows = speakers.map((s, i) => ({
        resource_id: resourceId,
        profile_id: s.profile_id || null,
        full_name: s.full_name,
        job_title: s.job_title || null,
        company_name: s.company_name || null,
        display_order: i,
      }));
      await supabase.from('resource_speakers').insert(speakerRows);
    }

    setIsDialogOpen(false);
    loadResources();
  };

  const handleDelete = async (id: string) => { if (!confirm('Delete this resource?')) return; await supabase.from('resources').delete().eq('id', id); toast({ title: 'Deleted' }); loadResources(); };

  // Speaker helpers
  const addSpeaker = () => setSpeakers([...speakers, { profile_id: null, full_name: '', job_title: '', company_name: '' }]);
  const removeSpeaker = (index: number) => setSpeakers(speakers.filter((_, i) => i !== index));
  const updateSpeaker = (index: number, field: keyof SpeakerFormRow, value: string) => {
    const updated = [...speakers];
    updated[index] = { ...updated[index], [field]: value };
    setSpeakers(updated);
  };
  const moveSpeaker = (index: number, direction: 'up' | 'down') => {
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= speakers.length) return;
    const updated = [...speakers];
    [updated[index], updated[newIndex]] = [updated[newIndex], updated[index]];
    setSpeakers(updated);
  };

  const searchProfiles = async (query: string) => {
    if (query.length < 2) { setProfileResults([]); return; }
    const { data } = await supabase
      .from('profiles')
      .select('user_id, first_name, last_name, email, persona')
      .or(`first_name.ilike.%${query}%,last_name.ilike.%${query}%,email.ilike.%${query}%`)
      .eq('access_status', 'verified')
      .limit(10);
    if (!data) { setProfileResults([]); return; }
    // Enrich all users with their org name
    const userIds = data.map(p => p.user_id);
    const companyMap: Record<string, string> = {};
    if (userIds.length > 0) {
      const { data: members } = await supabase.from('organization_members')
        .select('user_id, organizations(name)')
        .in('user_id', userIds);
      if (members) members.forEach((m: Record<string, unknown>) => {
        const org = m.organizations as Record<string, unknown> | null;
        if (org?.name) companyMap[m.user_id as string] = org.name as string;
      });
    }
    setProfileResults(data.map(p => ({ ...p, company_name: companyMap[p.user_id] })));
  };

  const linkProfile = (index: number, profile: ProfileSearchResult) => {
    const updated = [...speakers];
    updated[index] = {
      ...updated[index],
      profile_id: profile.user_id,
      full_name: `${profile.first_name || ''} ${profile.last_name || ''}`.trim() || updated[index].full_name,
      company_name: profile.company_name || updated[index].company_name,
    };
    setSpeakers(updated);
    setLinkingSpeakerIndex(null);
    setProfileSearch('');
    setProfileResults([]);
  };

  const unlinkProfile = (index: number) => {
    const updated = [...speakers];
    updated[index] = { ...updated[index], profile_id: null };
    setSpeakers(updated);
  };

  const types = ['article', 'whitepaper', 'guide', 'replay', 'case_study'];
  const topics = ['Sustainability', 'Technology', 'Energy', 'Management', 'Events', 'Infrastructure'];

  if (loading) return <div className="flex items-center justify-center h-64"><RefreshCw className="h-8 w-8 animate-spin text-gray-400" /></div>;

  return (
    <div>
      <div className="flex justify-between items-center mb-6"><h1 className="text-2xl font-bold">{t('admin.resources')} ({resources.length})</h1><Button onClick={openCreate}><Plus className="h-4 w-4 mr-2" />Add Resource</Button></div>
      <Card><CardContent className="p-0"><div className="overflow-x-auto"><table className="w-full"><thead className="bg-gray-50 border-b"><tr><th className="text-left p-4 font-medium">Title</th><th className="text-left p-4 font-medium">Type</th><th className="text-left p-4 font-medium">Access</th><th className="text-left p-4 font-medium">Lang</th><th className="text-left p-4 font-medium">Status</th><th className="text-left p-4 font-medium">Actions</th></tr></thead><tbody>
        {resources.map(r => (<tr key={r.id} className="border-b hover:bg-gray-50"><td className="p-4"><div className="font-medium">{r.title}</div><div className="text-sm text-gray-500 truncate max-w-xs">{r.summary}</div></td><td className="p-4"><Badge variant="outline">{r.type}</Badge></td><td className="p-4"><Badge variant={r.access_level === 'public' ? 'success' : 'info'}>{r.access_level}</Badge></td><td className="p-4">{r.language}</td><td className="p-4"><Badge variant={r.published ? 'success' : 'secondary'}>{r.published ? 'Published' : 'Draft'}</Badge></td><td className="p-4"><div className="flex gap-2"><Button size="sm" variant="ghost" onClick={() => openEdit(r)}><Pencil className="h-4 w-4" /></Button><Button size="sm" variant="ghost" onClick={() => handleDelete(r.id)}><Trash2 className="h-4 w-4 text-red-500" /></Button></div></td></tr>))}
      </tbody></table></div></CardContent></Card>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}><DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>{editingResource ? 'Edit Resource' : 'Add Resource'}</DialogTitle><DialogDescription>Fill in the resource details below.</DialogDescription></DialogHeader><div className="space-y-4 mt-4">
        <div className="space-y-2"><Label>Title *</Label><Input value={formData.title} onChange={e => setFormData({ ...formData, title: e.target.value })} /></div>
        <div className="space-y-2"><Label>Summary *</Label><Textarea value={formData.summary} onChange={e => setFormData({ ...formData, summary: e.target.value })} rows={2} /></div>
        <div className="grid grid-cols-2 gap-4"><div className="space-y-2"><Label>Type</Label><Select value={formData.type} onValueChange={v => setFormData({ ...formData, type: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{types.map(tp => <SelectItem key={tp} value={tp}>{tp}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label>Topic</Label><Select value={formData.topic} onValueChange={v => setFormData({ ...formData, topic: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{topics.map(tp => <SelectItem key={tp} value={tp}>{tp}</SelectItem>)}</SelectContent></Select></div></div>
        <div className="grid grid-cols-2 gap-4"><div className="space-y-2"><Label>Language</Label><Select value={formData.language} onValueChange={v => setFormData({ ...formData, language: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="EN">English</SelectItem><SelectItem value="FR">Français</SelectItem></SelectContent></Select></div><div className="space-y-2"><Label>Access</Label><Select value={formData.access_level} onValueChange={v => setFormData({ ...formData, access_level: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="public">Public</SelectItem><SelectItem value="members">Members</SelectItem><SelectItem value="marina">Marina</SelectItem></SelectContent></Select></div></div>
        <ImageUpload label="Thumbnail Image" value={formData.thumbnail_url} onChange={(url) => setFormData({ ...formData, thumbnail_url: url })} />
        <div className="space-y-2"><Label>File URL</Label><Input value={formData.file_url} onChange={e => setFormData({ ...formData, file_url: e.target.value })} placeholder="https://..." /></div>

        {/* ── Speakers Section ── */}
        <div className="space-y-3 border-t pt-4">
          <div className="flex items-center justify-between">
            <Label className="text-base font-semibold">Speakers</Label>
            <Button type="button" size="sm" variant="outline" onClick={addSpeaker}>
              <UserPlus className="h-3 w-3 mr-1" /> Add Speaker
            </Button>
          </div>
          {speakers.map((speaker, index) => (
            <div key={index} className="border rounded-lg p-3 space-y-2 bg-gray-50">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-600">
                  Speaker {index + 1}
                  {speaker.profile_id && <Badge variant="success" className="ml-2 text-xs">Linked</Badge>}
                </span>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => moveSpeaker(index, 'up')} disabled={index === 0}><ChevronUp className="h-3 w-3" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => moveSpeaker(index, 'down')} disabled={index === speakers.length - 1}><ChevronDown className="h-3 w-3" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => removeSpeaker(index)}><Trash2 className="h-3 w-3 text-red-500" /></Button>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Input placeholder="Full name *" value={speaker.full_name} onChange={e => updateSpeaker(index, 'full_name', e.target.value)} />
                <Input placeholder="Job title" value={speaker.job_title} onChange={e => updateSpeaker(index, 'job_title', e.target.value)} />
                <Input placeholder="Company" value={speaker.company_name} onChange={e => updateSpeaker(index, 'company_name', e.target.value)} />
              </div>
              {/* Link to platform user */}
              <div className="flex items-center gap-2">
                {speaker.profile_id ? (
                  <Button size="sm" variant="outline" onClick={() => unlinkProfile(index)}>
                    <X className="h-3 w-3 mr-1" /> Unlink user
                  </Button>
                ) : linkingSpeakerIndex === index ? (
                  <div className="flex-1 space-y-1">
                    <Input placeholder="Search by name or email..." value={profileSearch} autoFocus
                      onChange={e => { setProfileSearch(e.target.value); searchProfiles(e.target.value); }} />
                    {profileResults.length > 0 && (
                      <div className="border rounded bg-white max-h-32 overflow-y-auto shadow-sm">
                        {profileResults.map(p => (
                          <button key={p.user_id} className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-100 flex items-center gap-2"
                            onClick={() => linkProfile(index, p)}>
                            <span className="font-medium">{p.first_name} {p.last_name}</span>
                            <span className="text-gray-400">— {p.email}</span>
                            {p.company_name && <span className="text-gray-400 text-xs">({p.company_name})</span>}
                          </button>
                        ))}
                      </div>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => { setLinkingSpeakerIndex(null); setProfileSearch(''); setProfileResults([]); }}>Cancel</Button>
                  </div>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => setLinkingSpeakerIndex(index)}>
                    <Search className="h-3 w-3 mr-1" /> Link to user
                  </Button>
                )}
              </div>
            </div>
          ))}
          {speakers.length === 0 && <p className="text-sm text-gray-400 italic">No speakers added yet.</p>}
        </div>

        {/* ── Content (moved to end so metadata is filled first) ── */}
        <div className="space-y-2 border-t pt-4"><Label>Content</Label><RichTextEditor content={formData.content} onChange={(html) => setFormData({ ...formData, content: html })} placeholder="Write the resource content..." /></div>

        <div className="flex items-center space-x-2">
          <Checkbox id="published" checked={formData.published} onCheckedChange={(c) => setFormData({ ...formData, published: c as boolean })} disabled={!isAdmin && !editingResource} />
          <Label htmlFor="published">Published</Label>
          {!isAdmin && !editingResource && <span className="text-xs text-amber-600 ml-2">(Requires admin approval to publish)</span>}
        </div>
        <div className="flex justify-end gap-2 pt-4"><Button variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button><Button onClick={handleSave}>{editingResource ? 'Update' : isAdmin ? 'Create' : 'Submit for Review'}</Button></div>
      </div></DialogContent></Dialog>
    </div>
  );
}
