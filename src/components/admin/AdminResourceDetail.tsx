import { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft, Save, Trash2, Loader2, Eye, UserPlus, Search,
  ChevronUp, ChevronDown, X, CheckCircle, XCircle,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { RichTextEditor } from '@/components/ui/RichTextEditor';
import { ImageUpload } from '@/components/ui/ImageUpload';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import type { Resource, ResourceDraft, SpeakerFormRow, ProfileSearchResult } from './types';

interface Sector {
  id: string;
  label: string;
  slug: string;
  is_active: boolean;
}

const types = ['article', 'whitepaper', 'guide', 'replay', 'case_study'];
const topics = ['Sustainability', 'Technology', 'Energy', 'Management', 'Events', 'Infrastructure'];

interface DraftRow extends ResourceDraft {
  submitter_name: string;
  submitter_email: string;
}

export function AdminResourceDetail() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { user, profile: authProfile } = useAuth();
  const isAdmin = authProfile?.persona === 'admin';

  const isDraft = searchParams.get('type') === 'draft';
  const isNew = id === 'new';

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);

  // Resource form state
  const [form, setForm] = useState({
    title: '', summary: '', content: '', type: 'article', topic: 'Sustainability',
    language: 'EN', access_level: 'public', thumbnail_url: '', file_url: '',
    seo_keywords: '', published: isAdmin,
  });

  // Speaker management
  const [speakers, setSpeakers] = useState<SpeakerFormRow[]>([]);
  const [profileSearch, setProfileSearch] = useState('');
  const [profileResults, setProfileResults] = useState<ProfileSearchResult[]>([]);
  const [linkingSpeakerIndex, setLinkingSpeakerIndex] = useState<number | null>(null);

  // Sector management
  const [allSectors, setAllSectors] = useState<Sector[]>([]);
  const [selectedSectorIds, setSelectedSectorIds] = useState<string[]>([]);

  // Draft-specific state
  const [draft, setDraft] = useState<DraftRow | null>(null);
  const [reviewComment, setReviewComment] = useState('');

  // Existing resource reference
  const [resourceId, setResourceId] = useState<string | null>(null);

  // Load all active sectors once
  useEffect(() => {
    supabase.from('sectors').select('*').eq('is_active', true).order('label')
      .then(({ data }) => { if (data) setAllSectors(data as Sector[]); });
  }, []);

  useEffect(() => {
    if (!isNew && id) {
      if (isDraft) {
        loadDraft(id);
      } else {
        loadResource(id);
      }
    }
  }, [id, isDraft]);

  const loadResource = async (resId: string) => {
    setLoading(true);
    const { data, error } = await supabase.from('resources').select('*').eq('id', resId).single();
    if (error || !data) {
      toast({ title: 'Resource not found', variant: 'destructive' });
      navigate('/admin/resources');
      return;
    }
    const r = data as Resource;
    setResourceId(r.id);
    setForm({
      title: r.title, summary: r.summary, content: r.content || '',
      type: r.type, topic: r.topic, language: r.language, access_level: r.access_level,
      thumbnail_url: r.thumbnail_url || '', file_url: r.file_url || '',
      seo_keywords: r.seo_keywords || '', published: r.published,
    });

    // Load speakers
    const { data: speakerData } = await supabase
      .from('resource_speakers')
      .select('*')
      .eq('resource_id', r.id)
      .order('display_order');
    setSpeakers((speakerData || []).map((s: Record<string, unknown>) => ({
      id: s.id as string,
      profile_id: (s.profile_id as string) || null,
      full_name: (s.full_name as string) || '',
      job_title: (s.job_title as string) || '',
      company_name: (s.company_name as string) || '',
    })));

    // Load linked sectors
    const { data: sectorData } = await supabase
      .from('resource_sectors')
      .select('sector_id')
      .eq('resource_id', r.id);
    setSelectedSectorIds((sectorData || []).map((s: Record<string, unknown>) => s.sector_id as string));

    setLoading(false);
  };

  const loadDraft = async (draftId: string) => {
    setLoading(true);
    const { data, error } = await supabase
      .from('resource_drafts')
      .select('*')
      .eq('id', draftId)
      .single();

    if (error || !data) {
      toast({ title: 'Draft not found', variant: 'destructive' });
      navigate('/admin/resources');
      return;
    }

    const d = data as ResourceDraft;

    // Fetch submitter info
    const { data: profileData } = await supabase
      .from('profiles')
      .select('first_name, last_name, email')
      .eq('user_id', d.created_by)
      .single();

    const draftRow: DraftRow = {
      ...d,
      submitter_name: profileData
        ? `${profileData.first_name || ''} ${profileData.last_name || ''}`.trim() || d.created_by.slice(0, 8)
        : d.created_by.slice(0, 8),
      submitter_email: profileData?.email || '---',
    };

    setDraft(draftRow);
    setLoading(false);
  };

  // ---- Resource save ----
  const handleSave = async () => {
    if (!form.title) {
      toast({ title: 'Title is required', variant: 'destructive' });
      return;
    }
    setSaving(true);
    const payload = {
      title: form.title, summary: form.summary, content: form.content || null,
      type: form.type, topic: form.topic, language: form.language, access_level: form.access_level,
      thumbnail_url: form.thumbnail_url || null, file_url: form.file_url || null,
      seo_keywords: form.seo_keywords.trim() || null, published: form.published,
    };

    let savedId: string;
    if (isNew) {
      if (!isAdmin) (payload as any).published = false;
      const { data, error } = await supabase.from('resources').insert(payload).select('id').single();
      if (error || !data) {
        toast({ title: 'Error creating resource', variant: 'destructive' });
        setSaving(false);
        return;
      }
      savedId = data.id;
      toast({ title: isAdmin ? 'Resource created!' : 'Resource saved as draft' });
    } else {
      const { error } = await supabase.from('resources').update(payload).eq('id', id!);
      if (error) {
        toast({ title: 'Failed to update', variant: 'destructive' });
        setSaving(false);
        return;
      }
      savedId = id!;
      toast({ title: 'Resource saved!' });
    }

    // Save speakers
    await supabase.from('resource_speakers').delete().eq('resource_id', savedId);
    if (speakers.length > 0) {
      const speakerRows = speakers.map((s, i) => ({
        resource_id: savedId,
        profile_id: s.profile_id || null,
        full_name: s.full_name,
        job_title: s.job_title || null,
        company_name: s.company_name || null,
        display_order: i,
      }));
      await supabase.from('resource_speakers').insert(speakerRows);
    }

    // Save sectors
    await supabase.from('resource_sectors').delete().eq('resource_id', savedId);
    if (selectedSectorIds.length > 0) {
      const sectorRows = selectedSectorIds.map(sectorId => ({
        resource_id: savedId,
        sector_id: sectorId,
      }));
      await supabase.from('resource_sectors').insert(sectorRows);
    }

    setSaving(false);
    if (isNew) {
      navigate(`/admin/resources/${savedId}`, { replace: true });
    } else {
      loadResource(savedId);
    }
  };

  const handleDelete = async () => {
    if (!id || isNew || !confirm('Delete this resource permanently?')) return;
    await supabase.from('resources').delete().eq('id', id);
    toast({ title: 'Resource deleted' });
    navigate('/admin/resources');
  };

  // ---- Draft approve/reject ----
  const handleApproveDraft = async () => {
    if (!draft || !user) return;
    setSaving(true);

    let newResourceId = draft.resource_id;

    if (newResourceId) {
      // Update existing resource
      const { error } = await supabase.from('resources').update({
        title: draft.title,
        summary: draft.summary ?? '',
        content: draft.content,
        type: draft.type ?? 'article',
        topic: draft.topic ?? 'Sustainability',
        language: draft.language ?? 'EN',
        access_level: draft.access_level ?? 'public',
        thumbnail_url: draft.thumbnail_url ?? null,
        file_url: draft.file_url ?? null,
        published: true,
      }).eq('id', newResourceId);

      if (error) {
        toast({ title: 'Failed to update resource', description: error.message, variant: 'destructive' });
        setSaving(false);
        return;
      }
    } else {
      // Insert new resource from draft
      const { data: newResource, error } = await supabase.from('resources').insert({
        title: draft.title,
        summary: draft.summary ?? '',
        content: draft.content,
        type: draft.type ?? 'article',
        topic: draft.topic ?? 'Sustainability',
        language: draft.language ?? 'EN',
        access_level: draft.access_level ?? 'public',
        thumbnail_url: draft.thumbnail_url ?? null,
        file_url: draft.file_url ?? null,
        published: true,
      }).select('id').single();

      if (error || !newResource) {
        toast({ title: 'Failed to publish resource', description: error?.message, variant: 'destructive' });
        setSaving(false);
        return;
      }

      newResourceId = newResource.id as string;

      // Backfill resource_id on draft
      await supabase.from('resource_drafts').update({ resource_id: newResourceId }).eq('id', draft.id);
    }

    // Record approval
    await supabase.from('resource_approvals').insert({
      draft_id: draft.id,
      reviewer_id: user.id,
      decision: 'approved',
      comment: reviewComment.trim() || null,
    });

    // Update draft status
    await supabase.from('resource_drafts').update({ status: 'approved' }).eq('id', draft.id);

    toast({ title: 'Draft approved and published!' });
    setSaving(false);
    loadDraft(draft.id);
  };

  const handleRejectDraft = async () => {
    if (!draft || !user) return;
    if (!reviewComment.trim()) {
      toast({ title: 'A comment is required when rejecting', variant: 'destructive' });
      return;
    }
    setSaving(true);

    await supabase.from('resource_approvals').insert({
      draft_id: draft.id,
      reviewer_id: user.id,
      decision: 'rejected',
      comment: reviewComment.trim(),
    });

    await supabase.from('resource_drafts').update({ status: 'rejected' }).eq('id', draft.id);

    toast({ title: 'Draft rejected' });
    setSaving(false);
    loadDraft(draft.id);
  };

  // ---- Speaker helpers ----
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

  // ---- Loading state ----
  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );

  // =============== DRAFT VIEW ===============
  if (isDraft && draft) {
    const draftStatusBadge = (status: string) => {
      if (status === 'approved') return <Badge className="bg-green-100 text-green-800 border-green-200">Approved</Badge>;
      if (status === 'rejected') return <Badge className="bg-red-100 text-red-800 border-red-200">Rejected</Badge>;
      return <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200">Pending</Badge>;
    };

    return (
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate('/admin/resources')} className="gap-1.5">
              <ArrowLeft className="h-4 w-4" /> Resources
            </Button>
            <Separator orientation="vertical" className="h-6" />
            <h1 className="text-xl font-bold text-gray-900">{draft.title}</h1>
            <Badge variant="secondary">Draft</Badge>
            {draftStatusBadge(draft.status)}
          </div>
        </div>

        {/* Draft Meta */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-bold text-gray-700 flex items-center gap-2">
              <Eye className="h-4 w-4 text-blue-500" /> Draft Details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <div><span className="font-medium text-gray-600">Type: </span>{draft.type || '---'}</div>
              <div><span className="font-medium text-gray-600">Topic: </span>{draft.topic || '---'}</div>
              <div><span className="font-medium text-gray-600">Language: </span>{draft.language || '---'}</div>
              <div><span className="font-medium text-gray-600">Access: </span>{draft.access_level || '---'}</div>
              <div><span className="font-medium text-gray-600">Submitted by: </span>{draft.submitter_name}</div>
              <div><span className="font-medium text-gray-600">Email: </span>{draft.submitter_email}</div>
              <div>
                <span className="font-medium text-gray-600">Submitted: </span>
                {new Date(draft.created_at).toLocaleString()}
              </div>
              {draft.resource_id && (
                <div>
                  <span className="font-medium text-gray-600">Updating resource: </span>
                  <span className="text-xs text-gray-400 font-mono">{draft.resource_id}</span>
                </div>
              )}
            </div>

            {/* Summary */}
            {draft.summary && (
              <div>
                <p className="text-sm font-medium text-gray-600 mb-1">Summary</p>
                <p className="text-sm p-3 bg-gray-50 rounded border">{draft.summary}</p>
              </div>
            )}

            {/* Content */}
            <div>
              <p className="text-sm font-medium text-gray-600 mb-1">Content</p>
              <div
                className="text-sm p-3 bg-gray-50 rounded border max-h-64 overflow-y-auto prose prose-sm"
                dangerouslySetInnerHTML={{ __html: draft.content }}
              />
            </div>

            {/* Links */}
            {(draft.thumbnail_url || draft.file_url) && (
              <div className="flex gap-4 text-sm">
                {draft.thumbnail_url && (
                  <a href={draft.thumbnail_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">
                    View Thumbnail
                  </a>
                )}
                {draft.file_url && (
                  <a href={draft.file_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">
                    Attached File
                  </a>
                )}
              </div>
            )}

            {/* Reviewer comment */}
            <div className="space-y-2">
              <Label>
                Reviewer Comment <span className="text-gray-400 font-normal">(required to reject)</span>
              </Label>
              <Textarea
                value={reviewComment}
                onChange={(e) => setReviewComment(e.target.value)}
                rows={3}
                placeholder="Add notes or feedback..."
                disabled={draft.status !== 'pending'}
              />
            </div>

            {/* Actions */}
            {draft.status === 'pending' && (
              <div className="flex gap-3 pt-2 border-t">
                <Button
                  className="flex-1 bg-green-600 hover:bg-green-700 text-white gap-1.5"
                  onClick={handleApproveDraft}
                  disabled={saving}
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                  Approve & Publish
                </Button>
                <Button
                  variant="destructive"
                  className="flex-1 gap-1.5"
                  onClick={handleRejectDraft}
                  disabled={saving}
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                  Reject
                </Button>
              </div>
            )}

            {draft.status !== 'pending' && (
              <p className="text-sm text-gray-400 text-center pt-1">
                This draft has already been {draft.status}.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // =============== RESOURCE EDIT VIEW ===============
  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate('/admin/resources')} className="gap-1.5">
            <ArrowLeft className="h-4 w-4" /> Resources
          </Button>
          <Separator orientation="vertical" className="h-6" />
          <h1 className="text-xl font-bold text-gray-900">{isNew ? 'Create Resource' : form.title || 'Edit Resource'}</h1>
          {!isNew && (
            <Badge variant={form.published ? 'success' : 'secondary'}>
              {form.published ? 'Published' : 'Draft'}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!isNew && (
            <Button variant="outline" size="sm" onClick={handleDelete} className="text-red-600 hover:bg-red-50 gap-1.5">
              <Trash2 className="h-4 w-4" /> Delete
            </Button>
          )}
          <Button onClick={handleSave} disabled={saving} className="gap-1.5">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {isNew ? (isAdmin ? 'Create' : 'Submit for Review') : 'Save Changes'}
          </Button>
        </div>
      </div>

      {/* Resource Details */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold text-gray-700">Resource Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Title *</Label>
            <Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Resource title" />
          </div>
          <div className="space-y-2">
            <Label>Summary *</Label>
            <Textarea value={form.summary} onChange={e => setForm({ ...form, summary: e.target.value })} rows={2} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={form.type} onValueChange={v => setForm({ ...form, type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{types.map(tp => <SelectItem key={tp} value={tp}>{tp}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Topic</Label>
              <Select value={form.topic} onValueChange={v => setForm({ ...form, topic: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{topics.map(tp => <SelectItem key={tp} value={tp}>{tp}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Language</Label>
              <Select value={form.language} onValueChange={v => setForm({ ...form, language: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="EN">English</SelectItem>
                  <SelectItem value="FR">Fran&#231;ais</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Access Level</Label>
              <Select value={form.access_level} onValueChange={v => setForm({ ...form, access_level: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="public">Public</SelectItem>
                  <SelectItem value="members">Members</SelectItem>
                  <SelectItem value="marina">Marina</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <ImageUpload label="Thumbnail Image" value={form.thumbnail_url} onChange={(url) => setForm({ ...form, thumbnail_url: url })} />
          <div className="space-y-2">
            <Label>File URL</Label>
            <Input value={form.file_url} onChange={e => setForm({ ...form, file_url: e.target.value })} placeholder="https://..." />
          </div>
          <div className="space-y-2">
            <Label>SEO Keywords</Label>
            <Input value={form.seo_keywords} onChange={e => setForm({ ...form, seo_keywords: e.target.value })} placeholder="marina,sustainability,innovation" />
            <p className="text-xs text-gray-500">Comma-separated target keywords.</p>
          </div>

          {/* Sectors */}
          <div className="space-y-2">
            <Label>Sectors</Label>
            <p className="text-xs text-gray-500">Select the sectors this resource is relevant to. Users with matching sectors will see this resource.</p>
            {allSectors.length === 0 ? (
              <p className="text-sm text-gray-400 italic">Loading sectors...</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-60 overflow-y-auto border rounded-lg p-3 bg-gray-50">
                {allSectors.map(s => {
                  const isChecked = selectedSectorIds.includes(s.id);
                  return (
                    <div key={s.id} className="flex items-center space-x-2">
                      <Checkbox
                        id={`sector-${s.id}`}
                        checked={isChecked}
                        onCheckedChange={() => {
                          setSelectedSectorIds(prev =>
                            isChecked ? prev.filter(sid => sid !== s.id) : [...prev, s.id]
                          );
                        }}
                      />
                      <Label htmlFor={`sector-${s.id}`} className="text-sm cursor-pointer font-normal">
                        {s.label}
                      </Label>
                    </div>
                  );
                })}
              </div>
            )}
            {selectedSectorIds.length > 0 && (
              <p className="text-xs text-gray-500">{selectedSectorIds.length} sector{selectedSectorIds.length > 1 ? 's' : ''} selected</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Speakers */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-bold text-gray-700">Speakers ({speakers.length})</CardTitle>
            <Button variant="outline" size="sm" onClick={addSpeaker} className="gap-1.5">
              <UserPlus className="h-3.5 w-3.5" /> Add Speaker
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {speakers.length === 0 ? (
            <p className="text-sm text-gray-400 italic text-center py-4">No speakers added yet.</p>
          ) : (
            <div className="space-y-3">
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
                                <span className="text-gray-400">--- {p.email}</span>
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
            </div>
          )}
        </CardContent>
      </Card>

      {/* Content */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold text-gray-700">Content</CardTitle>
        </CardHeader>
        <CardContent>
          <RichTextEditor
            content={form.content}
            onChange={(html) => setForm({ ...form, content: html })}
            placeholder="Write the resource content..."
          />
        </CardContent>
      </Card>

      {/* Published checkbox + Save */}
      <Card className="border-0 shadow-sm">
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Checkbox id="published" checked={form.published} onCheckedChange={(c) => setForm({ ...form, published: c as boolean })} disabled={!isAdmin && isNew} />
              <Label htmlFor="published">Published</Label>
              {!isAdmin && isNew && <span className="text-xs text-amber-600 ml-2">(Requires admin approval to publish)</span>}
            </div>
            <Button onClick={handleSave} disabled={saving} className="gap-1.5">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {isNew ? (isAdmin ? 'Create' : 'Submit for Review') : 'Save Changes'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
