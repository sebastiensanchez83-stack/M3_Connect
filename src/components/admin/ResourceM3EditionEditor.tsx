import { useEffect, useState } from 'react';
import DOMPurify from 'dompurify';
import { Newspaper } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { RichTextEditor } from '@/components/ui/RichTextEditor';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { AdminPanel, ADMIN_BTN_PRIMARY } from './AdminUI';
import { Note } from './v2/MembersKit';

interface Edition {
  content_html: string;
  is_ready: boolean;
  updated_at: string;
}

const editorialSanitizer = {
  ALLOWED_TAGS: ['p', 'h2', 'h3', 'ul', 'ol', 'li', 'strong', 'b', 'em', 'i', 'a', 'br', 'blockquote', 'hr'],
  ALLOWED_ATTR: ['href', 'title'],
};

/** Independent save: editing an edition never rewrites the source resource. */
export function ResourceM3EditionEditor({ resourceId }: { resourceId: string }) {
  const [html, setHtml] = useState('');
  const [ready, setReady] = useState(false);
  const [saved, setSaved] = useState<Edition | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    supabase.from('resource_m3_editions').select('content_html,is_ready,updated_at')
      .eq('resource_id', resourceId).maybeSingle().then(({ data, error: loadError }) => {
        if (cancelled) return;
        if (loadError) setError('The M3 edition could not be loaded. Reload this page before editing.');
        else {
          const edition = data as Edition | null;
          setSaved(edition);
          setHtml(edition?.content_html ?? '');
          setReady(edition?.is_ready ?? false);
        }
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [resourceId]);

  // TipTap adds link/editor attributes again after a successful save. Compare
  // the same persisted representation so these do not produce a false dirty state.
  const cleanHtml = DOMPurify.sanitize(html, editorialSanitizer);
  const dirty = cleanHtml !== (saved?.content_html ?? '') || ready !== (saved?.is_ready ?? false);
  async function save() {
    const content = cleanHtml;
    const plain = DOMPurify.sanitize(content, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] }).replace(/&nbsp;/g, ' ').trim();
    if (ready && !plain) {
      toast({ title: 'Add the M3 editorial text before marking it ready.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const values = { content_html: content, is_ready: ready };
      const query = saved
        ? supabase.from('resource_m3_editions').update(values).eq('resource_id', resourceId).eq('updated_at', saved.updated_at)
        : supabase.from('resource_m3_editions').insert({ resource_id: resourceId, ...values });
      const { data, error: saveError } = await query.select('content_html,is_ready,updated_at').maybeSingle();
      if (saveError || !data) throw new Error(saveError?.code === '23505' || !saveError
        ? 'Another editor changed this edition. Reload before saving to avoid overwriting their work.'
        : 'The M3 edition could not be saved. Your text is still in the editor.');
      const edition = data as Edition;
      setHtml(edition.content_html);
      setReady(edition.is_ready);
      setSaved(edition);
      toast({ title: ready ? 'M3 edition saved and ready for the next import.' : 'M3 editorial draft saved.' });
    } catch (saveError) {
      toast({ title: saveError instanceof Error ? saveError.message : 'Save failed.', variant: 'destructive' });
    } finally { setSaving(false); }
  }

  return (
    <AdminPanel
      title="M3 Monaco editorial edition"
      icon={Newspaper}
      description="The version of this article that m3monaco.com publishes. It has its own Save button and never changes the article above."
    >
      <div className="space-y-4">
        <p className="text-[14px] leading-5 text-ink">Write a distinct M3 perspective: summarise the source, explain the implications for owners, developers or operators, and link to the relevant M3 expertise. The source link and cover image are added automatically.</p>
        <Note>For automatic publication, save this article as public and published with “Also publish on m3monaco.com” ticked, then mark this edition ready. Allow the feed cache and the next hourly WordPress import to refresh. Later edits do not overwrite an article already imported into WordPress.</Note>
        {loading ? <p role="status" className="text-[14px] text-meta">Loading M3 edition…</p> : error ? <p role="alert" className="text-[14px] text-red-700">{error}</p> : <>
          <div className={saving ? 'pointer-events-none opacity-60' : ''}>
            <RichTextEditor allowImages={false} content={html} onChange={setHtml} placeholder="Source overview · M3 perspective · Practical implications · Relevant expertise links" />
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-h-11 items-center gap-2.5">
              <Checkbox id="m3-edition-ready" checked={ready} onCheckedChange={c => setReady(c === true)} disabled={saving} />
              <label htmlFor="m3-edition-ready" className="cursor-pointer text-[15px] font-semibold leading-5 text-navy">M3 edition ready for automatic publication</label>
            </div>
            <Button type="button" variant="secondary" className={ADMIN_BTN_PRIMARY} onClick={save} disabled={saving || !dirty}>{saving ? 'Saving…' : 'Save the M3 edition'}</Button>
          </div>
          <p className="text-[13px] leading-5 text-meta" role="status">{dirty ? 'Unsaved M3 edition changes' : saved?.is_ready ? 'Saved · ready for the M3 feed when resource publication conditions are met' : 'Draft · excluded from the M3 feed'}</p>
        </>}
      </div>
    </AdminPanel>
  );
}
