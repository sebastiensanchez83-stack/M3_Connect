import { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import DOMPurify from 'dompurify';
import {
  Save, Trash2, Loader2, Eye, UserPlus, Search,
  ChevronUp, ChevronDown, X, CheckCircle, XCircle,
  FileText, Tags, Users, PenLine, Globe, Gavel, ExternalLink, Link2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { RichTextEditor } from '@/components/ui/RichTextEditor';
import { ImageUpload } from '@/components/ui/ImageUpload';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import type { Resource, ResourceDraft, SpeakerFormRow, ProfileSearchResult } from './types';
import {
  AdminDetailHeader, AdminLoading, AdminPanel, AdminStatusPill, ADMIN_BTN, ADMIN_BTN_DANGER, ADMIN_BTN_PRIMARY,
} from './AdminUI';
import { ResourceM3EditionEditor } from './ResourceM3EditionEditor';
import { ResourceMentionsPanel } from './ResourceMentionsPanel';
import { AdminArticleComments } from './AdminArticleComments';
import { SlugAddressPanel } from './SlugAddressPanel';
import { Field, Note } from './v2/MembersKit';
import { ADMIN_INPUT, CheckField, DetailList, FormField } from './v2/ContentFormKit';

/** What the types and the reading rights are called on screen (the stored values stay as they are). */
const TYPE_LABEL: Record<string, string> = {
  article: 'Article', whitepaper: 'White paper', guide: 'Guide', replay: 'Replay (video)', case_study: 'Case study',
};
const ACCESS_LABEL: Record<string, string> = {
  public: 'Everyone (public)', members: 'Members only', marina: 'Marinas only',
};

interface Sector {
  id: string;
  label: string;
  slug: string;
  is_active: boolean;
}

const types = ['article', 'whitepaper', 'guide', 'replay', 'case_study'];
// The usual topics, offered first. resources.topic is free text: an editor can add a new one from
// the dropdown ("Add a new topic…", Victor, 21 Oct 2026), and every topic already used on an
// article is offered again after that.
const BASE_TOPICS = ['Sustainability', 'Technology', 'Energy', 'Management', 'Events', 'Infrastructure'];
const NEW_TOPIC = '__new_topic__';

/** Trimmed, single spaces, first letter in capitals; null when too short or too long. */
function cleanTopic(raw: string): string | null {
  const s = raw.replace(/\s+/g, ' ').trim();
  if (s.length < 2 || s.length > 40) return null;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

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
    seo_keywords: '', published: isAdmin, share_to_m3: false, share_to_s3: false,
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
  // Bumped on every (re)load: the web address panel reads the slug again (a draft's follows its title).
  const [slugVersion, setSlugVersion] = useState(0);

  // Topics: the usual ones, then every topic already used on an article, then the one being added.
  const [usedTopics, setUsedTopics] = useState<string[]>([]);
  const [addingTopic, setAddingTopic] = useState(false);
  const [newTopic, setNewTopic] = useState('');
  const [newTopicError, setNewTopicError] = useState('');

  // Load all active sectors once
  useEffect(() => {
    supabase.from('sectors').select('*').eq('is_active', true).order('label')
      .then(({ data }) => { if (data) setAllSectors(data as Sector[]); });
    supabase.from('resources').select('topic').not('topic', 'is', null)
      .then(({ data }) => {
        if (!data) return;
        const seen = new Set<string>();
        setUsedTopics((data as { topic: string | null }[])
          .map((r) => (r.topic ?? '').trim())
          .filter((tp) => tp && !seen.has(tp.toLowerCase()) && seen.add(tp.toLowerCase())));
      });
  }, []);

  const topicOptions = (() => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const tp of [...BASE_TOPICS, ...usedTopics.slice().sort((a, b) => a.localeCompare(b)), form.topic]) {
      const k = (tp ?? '').trim().toLowerCase();
      if (k && !seen.has(k)) { seen.add(k); out.push(tp.trim()); }
    }
    return out;
  })();

  const addTopic = () => {
    const cleaned = cleanTopic(newTopic);
    if (!cleaned) { setNewTopicError(t('admin.resource.topicLength', 'Write between 2 and 40 characters.')); return; }
    // An existing topic written differently is reused as it is.
    const existing = topicOptions.find((tp) => tp.toLowerCase() === cleaned.toLowerCase());
    const topic = existing ?? cleaned;
    if (!existing) setUsedTopics((list) => [...list, topic]);
    setForm((f) => ({ ...f, topic }));
    setAddingTopic(false); setNewTopic(''); setNewTopicError('');
  };

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
      seo_keywords: r.seo_keywords || '', published: r.published, share_to_m3: r.share_to_m3 === true, share_to_s3: r.share_to_s3 === true,
    });
    setSlugVersion((n) => n + 1);

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
      share_to_m3: form.share_to_m3, share_to_s3: form.share_to_s3,
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
  if (loading) return <AdminLoading />;

  // =============== DRAFT VIEW ===============
  if (isDraft && draft) {
    const draftStatusBadge = (status: string) => {
      if (status === 'approved') return <AdminStatusPill tone="success">Approved</AdminStatusPill>;
      if (status === 'rejected') return <AdminStatusPill tone="danger">Rejected</AdminStatusPill>;
      return <AdminStatusPill tone="warning">Pending</AdminStatusPill>;
    };
    const awaitingReview = ['submitted', 'review_1', 'review_2'].includes(draft.status);

    return (
      <div className="mx-auto max-w-4xl">
        {/* Header */}
        <AdminDetailHeader
          back={{ to: '/admin/resources', label: t('adminContent.article.back', 'Back to Articles') }}
          title={draft.title}
          badges={<><AdminStatusPill>Draft</AdminStatusPill>{draftStatusBadge(draft.status)}</>}
          subtitle={t('adminContent.draft.subtitle', 'Proposed by a member: read it, then publish it or refuse it at the bottom of the page.')}
        />

        <div className="space-y-6">
          {/* Draft Meta */}
          <AdminPanel title={t('adminContent.draft.details', 'About this draft')} icon={Eye}>
            <DetailList>
              <Field label="Type">{draft.type ? TYPE_LABEL[draft.type] ?? draft.type : '---'}</Field>
              <Field label="Topic">{draft.topic || '---'}</Field>
              <Field label="Language">{draft.language || '---'}</Field>
              <Field label="Who can read it">{draft.access_level ? ACCESS_LABEL[draft.access_level] ?? draft.access_level : '---'}</Field>
              <Field label="Submitted by">{draft.submitter_name}</Field>
              <Field label="E-mail">{draft.submitter_email}</Field>
              <Field label="Submitted on">{new Date(draft.created_at).toLocaleString()}</Field>
              {draft.resource_id && (
                <Field label="Updates the article">
                  <span className="font-mono text-[12px] text-meta">{draft.resource_id}</span>
                </Field>
              )}
            </DetailList>

            {/* Links */}
            {(draft.thumbnail_url || draft.file_url) && (
              <div className="mt-5 flex flex-wrap gap-2 border-t border-rule pt-5">
                {draft.thumbnail_url && (
                  <a href={draft.thumbnail_url} target="_blank" rel="noopener noreferrer" className={EXT_LINK}>
                    See the cover image <ExternalLink className="h-4 w-4" aria-hidden="true" /><span className="sr-only"> (new tab)</span>
                  </a>
                )}
                {draft.file_url && (
                  <a href={draft.file_url} target="_blank" rel="noopener noreferrer" className={EXT_LINK}>
                    Open the attached file <ExternalLink className="h-4 w-4" aria-hidden="true" /><span className="sr-only"> (new tab)</span>
                  </a>
                )}
              </div>
            )}
          </AdminPanel>

          {/* Summary + content */}
          <AdminPanel title={t('adminContent.draft.text', 'The text')} icon={FileText}>
            {draft.summary && (
              <div className="mb-5">
                <h3 className="text-meta-caps mb-1.5">Summary</h3>
                <p className="rounded-xl border border-rule bg-page p-3 text-[15px] leading-6 text-ink">{draft.summary}</p>
              </div>
            )}
            <h3 className="text-meta-caps mb-1.5">Content</h3>
            <div
              className="prose prose-sm max-h-[28rem] max-w-none overflow-y-auto rounded-xl border border-rule bg-page p-4"
              dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(draft.content) }}
            />
          </AdminPanel>

          {/* Decision */}
          <AdminPanel title={t('adminContent.draft.decision', 'Your decision')} icon={Gavel}>
            <div className="space-y-4">
              <FormField
                label="Comment for the author"
                htmlFor="draft-review-comment"
                hint={awaitingReview ? 'Optional to publish, required to refuse.' : undefined}
              >
                <Textarea
                  id="draft-review-comment"
                  value={reviewComment}
                  onChange={(e) => setReviewComment(e.target.value)}
                  rows={3}
                  placeholder="Add notes or feedback..."
                  disabled={!awaitingReview}
                  className="bg-white"
                />
              </FormField>

              {/* Actions — a partner-submitted draft awaiting review (the enum has
                  no 'pending'; un-reviewed states are submitted/review_1/review_2) */}
              {awaitingReview && (
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button
                    variant="secondary"
                    className={ADMIN_BTN_PRIMARY + ' gap-1.5 sm:flex-1'}
                    onClick={handleApproveDraft}
                    disabled={saving}
                  >
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <CheckCircle className="h-4 w-4" aria-hidden="true" />}
                    Approve and publish
                  </Button>
                  <Button
                    variant="outline"
                    className={ADMIN_BTN_DANGER + ' gap-1.5 sm:flex-1'}
                    onClick={handleRejectDraft}
                    disabled={saving}
                  >
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <XCircle className="h-4 w-4" aria-hidden="true" />}
                    Refuse this draft
                  </Button>
                </div>
              )}

              {!awaitingReview && (
                <Note>This draft has already been {draft.status}.</Note>
              )}
            </div>
          </AdminPanel>
        </div>
      </div>
    );
  }

  const saveLabel = isNew ? (isAdmin ? 'Create the article' : 'Submit for review') : 'Save the changes';
  const saveButton = (
    <Button variant="secondary" onClick={handleSave} disabled={saving} className={ADMIN_BTN_PRIMARY + ' gap-1.5'}>
      {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
      {saveLabel}
    </Button>
  );

  // =============== RESOURCE EDIT VIEW ===============
  return (
    <div className="mx-auto max-w-4xl">
      {/* Header */}
      <AdminDetailHeader
        back={{ to: '/admin/resources', label: t('adminContent.article.back', 'Back to Articles') }}
        title={isNew ? 'New article' : form.title || 'Article without a title'}
        badges={!isNew ? <AdminStatusPill tone={form.published ? 'success' : 'neutral'}>{form.published ? 'Published' : 'Draft'}</AdminStatusPill> : undefined}
        actions={
          <>
            {!isNew && (
              <Button variant="outline" onClick={handleDelete} className={ADMIN_BTN_DANGER + ' gap-1.5'}>
                <Trash2 className="h-4 w-4" aria-hidden="true" /> Delete
              </Button>
            )}
            {saveButton}
          </>
        }
      />

      <div className="space-y-6">
        {/* Resource Details */}
        <AdminPanel title="The article" icon={FileText}>
          <div className="space-y-5">
            <FormField label="Title" htmlFor="resource-title" required>
              <Input id="resource-title" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Resource title" className={ADMIN_INPUT} />
            </FormField>
            {!isDraft && (
              <FormField label="Web address" htmlFor="resource-slug">
                <SlugAddressPanel table="resources" recordId={isNew ? null : resourceId} title={form.title} version={slugVersion} inputId="resource-slug" />
              </FormField>
            )}
            <FormField label="Summary" htmlFor="resource-summary" required hint="Two lines at most: shown on the list of articles and under the title.">
              <Textarea id="resource-summary" value={form.summary} onChange={e => setForm({ ...form, summary: e.target.value })} rows={2} className="bg-white" />
            </FormField>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <FormField label="Type" htmlFor="resource-type">
                <Select value={form.type} onValueChange={v => setForm({ ...form, type: v })}>
                  <SelectTrigger id="resource-type" className={ADMIN_INPUT}><SelectValue /></SelectTrigger>
                  <SelectContent>{types.map(tp => <SelectItem key={tp} value={tp}>{TYPE_LABEL[tp] ?? tp}</SelectItem>)}</SelectContent>
                </Select>
              </FormField>
              <FormField label="Topic" htmlFor="resource-topic">
                <Select
                  value={form.topic}
                  onValueChange={v => {
                    if (v === NEW_TOPIC) { setAddingTopic(true); setNewTopicError(''); return; }
                    setForm({ ...form, topic: v }); setAddingTopic(false);
                  }}
                >
                  <SelectTrigger id="resource-topic" className={ADMIN_INPUT}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {topicOptions.map(tp => <SelectItem key={tp} value={tp}>{tp}</SelectItem>)}
                    <SelectItem value={NEW_TOPIC} className="font-semibold text-gold-text">
                      {t('admin.resource.addTopic', '+ Add a new topic…')}
                    </SelectItem>
                  </SelectContent>
                </Select>
                {addingTopic && (
                  <div className="mt-2 space-y-2 rounded-xl border border-rule bg-chip/50 p-3">
                    <label htmlFor="resource-new-topic" className="block text-[14px] font-semibold leading-5 text-navy">
                      {t('admin.resource.newTopicLabel', 'New topic for this article')}
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <Input
                        id="resource-new-topic"
                        autoFocus
                        value={newTopic}
                        maxLength={40}
                        placeholder={t('admin.resource.newTopicPlaceholder', 'For example: Regulation')}
                        onChange={e => { setNewTopic(e.target.value); setNewTopicError(''); }}
                        onKeyDown={e => {
                          if (e.key === 'Enter') { e.preventDefault(); addTopic(); }
                          if (e.key === 'Escape') { setAddingTopic(false); setNewTopic(''); }
                        }}
                        aria-invalid={!!newTopicError}
                        aria-describedby={newTopicError ? 'resource-new-topic-error' : undefined}
                        className={ADMIN_INPUT + ' min-w-0 flex-1 basis-40'}
                      />
                      <Button type="button" variant="secondary" className={ADMIN_BTN_PRIMARY} onClick={addTopic}>
                        {t('admin.resource.addTopicButton', 'Add topic')}
                      </Button>
                      <Button type="button" variant="outline" className={ADMIN_BTN} onClick={() => { setAddingTopic(false); setNewTopic(''); setNewTopicError(''); }}>
                        {t('common.cancel', 'Cancel')}
                      </Button>
                    </div>
                    {newTopicError && <p id="resource-new-topic-error" className="text-[13px] text-red-700">{newTopicError}</p>}
                    <p className="text-[13px] leading-[18px] text-meta">
                      {t('admin.resource.newTopicHint', 'It is saved with the article and offered in this list for the next articles.')}
                    </p>
                  </div>
                )}
              </FormField>
              <FormField label="Language" htmlFor="resource-language">
                <Select value={form.language} onValueChange={v => setForm({ ...form, language: v })}>
                  <SelectTrigger id="resource-language" className={ADMIN_INPUT}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="EN">English</SelectItem>
                    <SelectItem value="FR">Fran&#231;ais</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>
              <FormField label="Who can read it" htmlFor="resource-access">
                <Select value={form.access_level} onValueChange={v => setForm({ ...form, access_level: v })}>
                  <SelectTrigger id="resource-access" className={ADMIN_INPUT}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="public">{ACCESS_LABEL.public}</SelectItem>
                    <SelectItem value="members">{ACCESS_LABEL.members}</SelectItem>
                    <SelectItem value="marina">{ACCESS_LABEL.marina}</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>
            </div>
            <ImageUpload label="Cover image" value={form.thumbnail_url} onChange={(url) => setForm({ ...form, thumbnail_url: url })} />
            <FormField label="Attached file (web address)" htmlFor="resource-file" optional hint="A PDF or a document readers can open from the article.">
              <Input id="resource-file" value={form.file_url} onChange={e => setForm({ ...form, file_url: e.target.value })} placeholder="https://..." className={ADMIN_INPUT} />
            </FormField>
            <FormField label="Search keywords (SEO)" htmlFor="resource-seo" optional hint="Separate them with commas. Search engines read them; readers do not see them.">
              <Input id="resource-seo" value={form.seo_keywords} onChange={e => setForm({ ...form, seo_keywords: e.target.value })} placeholder="marina,sustainability,operations" className={ADMIN_INPUT} />
            </FormField>
          </div>
        </AdminPanel>

        {/* Sectors */}
        <AdminPanel
          title={<>Sectors{selectedSectorIds.length > 0 && <span className="ml-2 rounded-pill bg-chip px-2 py-0.5 text-[12px] font-semibold tabular-nums text-navy">{selectedSectorIds.length}</span>}</>}
          icon={Tags}
          description="Tick the sectors this article is about. Members who follow these sectors see it first."
        >
          {allSectors.length === 0 ? (
            <p className="flex items-center gap-2 text-[14px] text-meta" role="status"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading sectors...</p>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {allSectors.map(s => {
                const isChecked = selectedSectorIds.includes(s.id);
                return (
                  <CheckField
                    key={s.id}
                    id={`sector-${s.id}`}
                    checked={isChecked}
                    label={<span className="text-[14px]">{s.label}</span>}
                    control={
                      <Checkbox
                        id={`sector-${s.id}`}
                        checked={isChecked}
                        onCheckedChange={() => {
                          setSelectedSectorIds(prev =>
                            isChecked ? prev.filter(sid => sid !== s.id) : [...prev, s.id]
                          );
                        }}
                      />
                    }
                  />
                );
              })}
            </div>
          )}
          {selectedSectorIds.length > 0 && (
            <p className="mt-3 text-[13px] text-meta">{selectedSectorIds.length} sector{selectedSectorIds.length > 1 ? 's' : ''} selected</p>
          )}
        </AdminPanel>

        {/* Speakers */}
        <AdminPanel
          title={<>Speakers <span className="ml-1 rounded-pill bg-chip px-2 py-0.5 text-[12px] font-semibold tabular-nums text-navy">{speakers.length}</span></>}
          icon={Users}
          description="The people who speak in this article or replay. Link them to their member account when they have one."
          actions={
            <Button variant="outline" onClick={addSpeaker} className={ADMIN_BTN + ' h-9 gap-1.5'}>
              <UserPlus className="h-4 w-4" aria-hidden="true" /> Add a speaker
            </Button>
          }
        >
          {speakers.length === 0 ? (
            <p className="py-2 text-center text-[14px] text-meta">No speakers added yet.</p>
          ) : (
            <div className="space-y-3">
              {speakers.map((speaker, index) => (
                <div key={index} className="space-y-3 rounded-xl border border-rule bg-page p-3 sm:p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-[14px] font-semibold text-navy">
                      Speaker {index + 1}
                      {speaker.profile_id && <AdminStatusPill tone="success">Linked to a member</AdminStatusPill>}
                    </span>
                    <div className="flex gap-1">
                      <Button type="button" variant="outline" size="icon" className="h-9 w-9 rounded-pill border-navy/25 bg-white text-navy hover:bg-chip" onClick={() => moveSpeaker(index, 'up')} disabled={index === 0} aria-label={`Move speaker ${index + 1} up`} title="Move up"><ChevronUp className="h-4 w-4" aria-hidden="true" /></Button>
                      <Button type="button" variant="outline" size="icon" className="h-9 w-9 rounded-pill border-navy/25 bg-white text-navy hover:bg-chip" onClick={() => moveSpeaker(index, 'down')} disabled={index === speakers.length - 1} aria-label={`Move speaker ${index + 1} down`} title="Move down"><ChevronDown className="h-4 w-4" aria-hidden="true" /></Button>
                      <Button type="button" variant="outline" size="icon" className="h-9 w-9 rounded-pill border-red-200 bg-white text-red-700 hover:bg-red-50" onClick={() => removeSpeaker(index)} aria-label={`Remove speaker ${index + 1}`} title="Remove"><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <Input placeholder="Full name *" aria-label={`Full name of speaker ${index + 1}`} value={speaker.full_name} onChange={e => updateSpeaker(index, 'full_name', e.target.value)} className={ADMIN_INPUT} />
                    <Input placeholder="Job title" aria-label={`Job title of speaker ${index + 1}`} value={speaker.job_title} onChange={e => updateSpeaker(index, 'job_title', e.target.value)} className={ADMIN_INPUT} />
                    <Input placeholder="Company" aria-label={`Company of speaker ${index + 1}`} value={speaker.company_name} onChange={e => updateSpeaker(index, 'company_name', e.target.value)} className={ADMIN_INPUT} />
                  </div>
                  <div className="flex items-center gap-2">
                    {speaker.profile_id ? (
                      <Button type="button" variant="outline" className={ADMIN_BTN + ' h-9 gap-1.5'} onClick={() => unlinkProfile(index)}>
                        <X className="h-4 w-4" aria-hidden="true" /> Unlink from the member
                      </Button>
                    ) : linkingSpeakerIndex === index ? (
                      <div className="flex-1 space-y-2">
                        <div className="relative">
                          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-meta" aria-hidden="true" />
                          <Input placeholder="Search a member by name or e-mail..." aria-label="Search a member by name or e-mail" value={profileSearch} autoFocus
                            className="h-11 rounded-pill bg-white pl-10"
                            onChange={e => { setProfileSearch(e.target.value); searchProfiles(e.target.value); }} />
                        </div>
                        {profileResults.length > 0 && (
                          <ul className="max-h-48 divide-y divide-rule overflow-y-auto rounded-xl border border-rule bg-white">
                            {profileResults.map(p => (
                              <li key={p.user_id}>
                                <button type="button" className="group flex min-h-11 w-full flex-wrap items-center gap-x-2 gap-y-0.5 px-3 py-2 text-left text-[14px] transition-colors hover:bg-page focus:outline-none focus-visible:[box-shadow:inset_0_0_0_2px_#0b2653]"
                                  onClick={() => linkProfile(index, p)}>
                                  <span className="font-semibold text-navy">{p.first_name} {p.last_name}</span>
                                  <span className="text-meta">{p.email}</span>
                                  {p.company_name && <span className="text-[12px] text-meta">({p.company_name})</span>}
                                  <span className="ml-auto inline-flex h-8 items-center rounded-pill border border-navy/55 px-3 text-[13px] font-semibold text-navy group-hover:border-navy group-hover:bg-chip">Link</span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                        <Button type="button" variant="outline" className={ADMIN_BTN + ' h-9'} onClick={() => { setLinkingSpeakerIndex(null); setProfileSearch(''); setProfileResults([]); }}>Cancel</Button>
                      </div>
                    ) : (
                      <Button type="button" variant="outline" className={ADMIN_BTN + ' h-9 gap-1.5'} onClick={() => setLinkingSpeakerIndex(index)}>
                        <Link2 className="h-4 w-4" aria-hidden="true" /> Link to a member
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </AdminPanel>

        {/* Content */}
        <AdminPanel title="Text of the article" icon={PenLine}>
          <RichTextEditor
            content={form.content}
            onChange={(html) => setForm({ ...form, content: html })}
            placeholder="Write the resource content..."
          />
        </AdminPanel>

        {/* Companies the article mentions: linked in the text and listed under it (saved at once). */}
        <ResourceMentionsPanel resourceId={resourceId} title={form.title} summary={form.summary} content={form.content} />

        {/* Members' comments under the article (switch article_comments): hide, show again, close reports. */}
        {!isNew && !isDraft && <AdminArticleComments resourceId={resourceId} />}

        {isAdmin && resourceId && <ResourceM3EditionEditor key={resourceId} resourceId={resourceId} />}

        {/* Published checkbox + Save */}
        <AdminPanel title="Publishing" icon={Globe} description="Saved with the rest of the article when you press the Save button.">
          <div className="space-y-3">
            <CheckField
              id="published"
              checked={form.published}
              label="Published on Smart Marina Connect"
              hint={!isAdmin && isNew ? '(Requires admin approval to publish)' : 'Unticked: a draft, seen only by the M3 team.'}
              control={<Checkbox id="published" checked={form.published} onCheckedChange={(c) => setForm({ ...form, published: c as boolean })} disabled={!isAdmin && isNew} />}
            />
            {/* The feeds that m3monaco.com (/rss.xml) and s3monaco.com (/rss-s3.xml) import (netlify/edge-functions/rss.ts). */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <CheckField
                id="share_to_m3"
                checked={form.share_to_m3}
                label="Also publish on m3monaco.com"
                control={<Checkbox id="share_to_m3" checked={form.share_to_m3} onCheckedChange={(c) => setForm({ ...form, share_to_m3: c === true })} />}
              />
              <CheckField
                id="share_to_s3"
                checked={form.share_to_s3}
                label="Also publish on s3monaco.com"
                control={<Checkbox id="share_to_s3" checked={form.share_to_s3} onCheckedChange={(c) => setForm({ ...form, share_to_s3: c === true })} />}
              />
            </div>
            {(form.share_to_m3 || form.share_to_s3) && (!form.published || form.access_level !== 'public') && (
              <Note tone="warning">The other sites only take it once it is published and readable by everyone (public).</Note>
            )}
            <div className="flex justify-end pt-2">{saveButton}</div>
          </div>
        </AdminPanel>
      </div>
    </div>
  );
}

/** A link that opens in a new tab, as the admin's outline pill. */
const EXT_LINK = 'inline-flex min-h-10 items-center gap-1.5 rounded-pill border border-navy/55 bg-white px-4 text-[14px] font-semibold text-navy transition-colors hover:border-navy hover:bg-chip focus:outline-none focus-visible:shadow-focus';
