import { useEffect, useState } from 'react';
import DOMPurify from 'dompurify';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { RichTextEditor } from '@/components/ui/RichTextEditor';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';

interface Edition {
  content_html: string;
  is_ready: boolean;
  updated_at: string;
}

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

  const dirty = html !== (saved?.content_html ?? '') || ready !== (saved?.is_ready ?? false);
  async function save() {
    const content = DOMPurify.sanitize(html, {
      ALLOWED_TAGS: ['p', 'h2', 'h3', 'ul', 'ol', 'li', 'strong', 'b', 'em', 'i', 'a', 'br', 'blockquote', 'hr'],
      ALLOWED_ATTR: ['href', 'title'],
    });
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

  return <Card className="border-primary/20 shadow-sm">
    <CardHeader><CardTitle className="text-base">M3 Monaco editorial edition</CardTitle></CardHeader>
    <CardContent className="space-y-4">
      <p className="text-sm text-gray-600">Write a distinct M3 perspective: summarise the source, explain the implications for owners, developers or operators, and link to the relevant M3 expertise. The source link and cover image are added automatically.</p>
      <p className="text-sm text-gray-600">For automatic publication, save this resource as public and published with “Also publish on m3monaco.com” enabled, then mark this edition ready. Allow the feed cache and the next hourly WordPress import to refresh. Later edits do not overwrite an article already imported into WordPress.</p>
      {loading ? <p role="status">Loading M3 edition…</p> : error ? <p role="alert" className="text-red-600">{error}</p> : <>
        <div className={saving ? 'pointer-events-none opacity-60' : ''}>
          <RichTextEditor allowImages={false} content={html} onChange={setHtml} placeholder="Source overview · M3 perspective · Practical implications · Relevant expertise links" />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Checkbox id="m3-edition-ready" checked={ready} onCheckedChange={c => setReady(c === true)} disabled={saving} />
            <Label htmlFor="m3-edition-ready">M3 edition ready for automatic publication</Label>
          </div>
          <Button type="button" onClick={save} disabled={saving || !dirty}>{saving ? 'Saving…' : 'Save M3 edition'}</Button>
        </div>
        <p className="text-sm text-gray-500" role="status">{dirty ? 'Unsaved M3 edition changes' : saved?.is_ready ? 'Saved · ready for the M3 feed when resource publication conditions are met' : 'Draft · excluded from the M3 feed'}</p>
      </>}
    </CardContent>
  </Card>;
}
