import { useEffect, useState } from 'react';
import { Copy, ExternalLink, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { RENDEZVOUS_6TH_EVENT_ID, RENDEZVOUS_6TH_SLUG, SITE_URL, eventPath, resourcePath } from '@/lib/seoMeta';
import { isMissingSlugColumn, looksLikeId, noteMissingSlugColumn, slugifyTitle, type SlugTable } from '@/lib/slugRoutes';
import { ADMIN_BTN, ADMIN_BTN_PRIMARY } from './AdminUI';

/**
 * The public web address of an article or an event, in its admin editor (20 Oct 2026, the
 * readable slugs): what it is, a link to open or copy it, and the field to change it.
 *
 * The database makes the address from the title when the record is created, keeps it when the
 * title is edited once the record has ever been public (a record never published follows its
 * title until it is, or until someone sets an address here: slug_auto false), and keeps every
 * address the record had while it was public leading to the current one
 * (supabase/migrations/20261020160000_readable_slugs.sql). An address a never-published record
 * had is not kept: nobody saw it, and another record may take it. Saving here writes the slug
 * alone, apart from the editor's own Save, so it never mixes with the other fields: the
 * database normalises it and refuses one that another record uses, now or before.
 *
 * The Rendezvous 6th edition's address is read-only here: the site's code links to it
 * (RENDEZVOUS_6TH_SLUG in src/lib/seoMeta.ts: the featured cards, the /sm26/agenda canonical).
 *
 * Before that migration the panel says so and the page keeps its id address.
 */

const WORD: Record<SlugTable, string> = { resources: 'article', events: 'event' };

/** The columns that say whether the address still follows the title (see the migration). */
const STATE_COLUMNS: Record<SlugTable, string> = {
  resources: 'id, slug, slug_auto, published, published_at',
  events: 'id, slug, slug_auto, slug_public, published',
};

interface SlugRow {
  slug?: string | null;
  slug_auto?: boolean | null;
  slug_public?: boolean | null;
  published?: boolean | null;
  published_at?: string | null;
}

/**
 * Whether the record was ever public, as the database decides it (smc_slug_assign): from then on
 * its address never follows the title, and a replaced one keeps redirecting. Articles: published
 * now, or published_at stamped (first publication, never cleared). Events: not unpublished now,
 * or slug_public (set by the database the first time the event is not unpublished).
 */
export function everPublic(table: SlugTable, row: SlugRow): boolean {
  return table === 'resources'
    ? row.published === true || !!row.published_at
    : row.published !== false || row.slug_public === true;
}

interface DbError {
  code?: string;
  message?: string;
  details?: string | null;
}

/** The database's refusal of an address, in plain English; null for any other error. */
export function slugErrorMessage(error: DbError | null | undefined, table: SlugTable): string | null {
  if (!error) return null;
  const text = `${error.message ?? ''} ${error.details ?? ''}`;
  if (error.code === '23505' && /slug_taken|_slug_key/.test(text)) {
    return `This web address is already used by another ${WORD[table]}, now or before. Choose another one.`;
  }
  if ((error.code === '22023' && /slug_invalid/.test(text)) || (error.code === '23514' && /slug_format/.test(text))) {
    return 'This web address is not valid: use letters, digits and dashes, and nothing shaped like an id.';
  }
  return null;
}

export function SlugAddressPanel({ table, recordId, title, version, inputId }: {
  table: SlugTable;
  /** The record's id; null while it is new (not saved yet). */
  recordId: string | null;
  /** The title as currently typed: offered as the address ("Use the title"). */
  title?: string;
  /** Changes when the editor saved: the address is read again (a draft's follows its title). */
  version?: string | number;
  /** For the editor's <label htmlFor>. */
  inputId?: string;
}) {
  const word = WORD[table];
  const [state, setState] = useState<'loading' | 'missing' | 'ready' | 'failed'>('loading');
  const [saved, setSaved] = useState<string | null>(null);
  /** Ever public: the address is frozen, and a replaced one keeps redirecting. */
  const [wasPublic, setWasPublic] = useState(true);
  /** The address is the automatic one (from the title), not one set here. */
  const [auto, setAuto] = useState(true);
  const [value, setValue] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reads, setReads] = useState(0);

  useEffect(() => {
    if (!recordId) return;
    let alive = true;
    setState('loading');
    (async () => {
      const { data, error: readError } = await supabase.from(table).select(STATE_COLUMNS[table]).eq('id', recordId).maybeSingle();
      if (!alive) return;
      if (isMissingSlugColumn(readError)) {
        noteMissingSlugColumn(table);
        setState('missing');
        return;
      }
      if (readError || !data) {
        setState('failed');
        return;
      }
      const row = data as SlugRow;
      setSaved(row.slug ?? null);
      setValue(row.slug ?? '');
      setWasPublic(everPublic(table, row));
      setAuto(row.slug_auto !== false);
      setError(null);
      // The old addresses (staff can read them): best effort.
      const old = table === 'resources'
        ? await supabase.from('resource_slug_history').select('slug').eq('resource_id', recordId).order('replaced_at', { ascending: false })
        : await supabase.from('event_slug_history').select('slug').eq('event_id', recordId).order('replaced_at', { ascending: false });
      if (!alive) return;
      setHistory(((old.data ?? []) as { slug: string }[]).map((h) => h.slug));
      setState('ready');
    })();
    return () => { alive = false; };
  }, [table, recordId, version, reads]);

  const hint = 'text-[13px] leading-[18px] text-meta';
  if (!recordId) {
    return <p className={hint}>The web address is made from the title when the {word} is first saved. You can change it afterwards.</p>;
  }
  if (state === 'missing') {
    return (
      <p className={hint}>
        Readable web addresses arrive with the next database update. Until then this {word}&apos;s page is /{table}/{recordId}.
      </p>
    );
  }
  if (state === 'loading') {
    return <p className={cn(hint, 'flex items-center gap-2')}><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Reading the web address…</p>;
  }
  if (state === 'failed') {
    return (
      <p className={hint}>
        The web address could not be read.{' '}
        <button type="button" onClick={() => setReads((n) => n + 1)} className="font-semibold text-navy underline underline-offset-2">Try again</button>
      </p>
    );
  }

  // The Rendezvous 6th edition: the site's code links to its address (see the header comment).
  const pinned = table === 'events' && recordId === RENDEZVOUS_6TH_EVENT_ID;
  const normalized = slugifyTitle(value);
  const changed = normalized !== (saved ?? '');
  const fromTitle = title ? slugifyTitle(title) : '';
  const path = saved ? (table === 'resources' ? resourcePath({ id: recordId, slug: saved }) : eventPath({ id: recordId, slug: saved })) : null;
  const url = path ? `${SITE_URL}${path}` : null;
  const helpId = inputId ? `${inputId}-help` : undefined;

  const save = async () => {
    if (pinned) return;
    if (!normalized || looksLikeId(normalized)) {
      setError('A web address needs at least one letter or digit, and cannot look like an id.');
      return;
    }
    setSaving(true);
    setError(null);
    const { data, error: saveError } = await supabase.from(table).update({ slug: normalized }).eq('id', recordId).select('slug').maybeSingle();
    setSaving(false);
    if (saveError) {
      setError(slugErrorMessage(saveError, table) ?? `The web address could not be saved: ${saveError.message}`);
      return;
    }
    if (!data) {
      setError('The web address could not be saved: only M3 staff can change it.');
      return;
    }
    toast({ title: 'Web address saved', description: saved && wasPublic ? 'The previous address keeps working: it leads here.' : undefined });
    setReads((n) => n + 1);
  };

  const copyOpen = url && (
    <div className="flex min-w-0 flex-wrap items-center gap-2 text-[13px] text-meta">
      <span className="min-w-0 break-all">{url}</span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={ADMIN_BTN}
        onClick={() => { void navigator.clipboard?.writeText(url); toast({ title: 'Link copied' }); }}
      >
        <Copy className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Copy
      </Button>
      <a
        href={path ?? undefined}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-10 items-center gap-1 rounded-pill px-3 font-semibold text-navy hover:underline focus:outline-none focus-visible:shadow-focus"
      >
        Open <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
      </a>
    </div>
  );

  const oldOnes = history.length > 0 && (
    <p className={hint}>Old addresses, still leading here: {history.join(', ')}</p>
  );

  if (pinned) {
    // Read-only: a change here would leave the code's links and the /sm26/agenda canonical on an old address.
    return (
      <div className="space-y-2">
        {copyOpen}
        <p id={helpId} className={hint}>
          The site links to this address in its code (seoMeta.ts RENDEZVOUS_6TH_SLUG), so it cannot be changed here. Ask a developer to change it.
        </p>
        {saved !== RENDEZVOUS_6TH_SLUG && (
          <p role="alert" className="text-[13px] font-medium leading-[18px] text-red-700">
            The saved address is not the one in the code ({RENDEZVOUS_6TH_SLUG}). Ask a developer to put them back in step.
          </p>
        )}
        {oldOnes}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="hidden shrink-0 text-[14px] text-meta sm:inline">/{table}/</span>
        <Input
          id={inputId}
          value={value}
          onChange={(e) => { setValue(e.target.value); setError(null); }}
          onBlur={() => { if (value.trim()) setValue(slugifyTitle(value)); }}
          className="h-11 min-w-0 flex-1 rounded-field border-rule bg-white text-[15px]"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={120}
          aria-describedby={helpId}
        />
        <Button type="button" variant="outline" size="sm" className={ADMIN_BTN_PRIMARY} onClick={save} disabled={!changed || saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : 'Save address'}
        </Button>
      </div>
      {changed && normalized && normalized !== value.trim() && <p className={hint}>Saved as: {normalized}</p>}
      {error && <p role="alert" className="text-[13px] font-medium leading-[18px] text-red-700">{error}</p>}
      {copyOpen}
      <p id={helpId} className={hint}>
        {wasPublic
          ? 'It stays the same when the title is edited. Changing it keeps the old address working: it leads here.'
          : auto
            ? `Never published yet: the address follows the title until the ${word} is first published or you set one here.`
            : 'Never published yet: this address was set here, so it stays when the title is edited.'}
        {fromTitle && fromTitle !== saved && fromTitle !== normalized && (
          <>
            {' '}
            <button type="button" onClick={() => { setValue(fromTitle); setError(null); }} className="font-semibold text-navy underline underline-offset-2">
              Use the title
            </button>
          </>
        )}
      </p>
      {oldOnes}
    </div>
  );
}
