/**
 * Readable addresses of articles and events in the browser (20 Oct 2026, Victor: "des liens avec
 * le nom de l'article ou de l'evenement ... pour le SEO"). The paths themselves are built by
 * resourcePath() / eventPath() in src/lib/seoMeta.ts, which the edge functions share; this file
 * holds what only the browser needs:
 *
 *  - withSlug(): a read that selects `slug`, run again without it while the column does not
 *    exist (supabase/migrations/20261020160000_readable_slugs.sql not applied yet). Until then
 *    every link stays an id link and every page works exactly as before; the first refusal is
 *    remembered for the session, so it costs one request.
 *  - currentSlugFor(): an old address (a slug the record had before) -> its current one, through
 *    the database lookups, which answer only for a record the reader may open.
 *  - slugifyTitle(): the address a title gives, as public.smc_slugify() makes it (the admin
 *    editors preview it; the database has the last word).
 */
import { supabase } from '@/lib/supabase';

export type SlugTable = 'resources' | 'events';

interface ErrorLike {
  code?: string;
  message?: string;
}

/** Tables whose slug column the database said it does not have, for this session. */
const missingSlugColumn = new Set<SlugTable>();

/** PostgREST's answer to a read naming a column that does not exist (42703), or a write naming one (PGRST204). */
export function isMissingSlugColumn(error: ErrorLike | null | undefined): boolean {
  if (!error) return false;
  return (error.code === '42703' || error.code === 'PGRST204') && /slug/i.test(error.message ?? '');
}

/** Note that `table` has no slug column (yet): later reads skip it straight away. */
export function noteMissingSlugColumn(table: SlugTable): void {
  missingSlugColumn.add(table);
}

/** False once the database has said `table` has no slug column. */
export function slugColumnMayExist(table: SlugTable): boolean {
  return !missingSlugColumn.has(table);
}

/**
 * Runs a read that selects the slug, and runs it again without it when the column does not exist
 * yet. `run` gets the text to append to the column list of `table` (the main one or an embedded
 * one): ', slug' or ''.
 */
export async function withSlug<R extends { error: ErrorLike | null }>(
  table: SlugTable,
  run: (slugColumn: string) => PromiseLike<R>,
): Promise<R> {
  if (missingSlugColumn.has(table)) return run('');
  const first = await run(', slug');
  if (!isMissingSlugColumn(first.error)) return first;
  missingSlugColumn.add(table);
  return run('');
}

/**
 * The current address of an article or event that had `oldSlug` before, when the reader may open
 * it (the database applies the same rules as for reading the record; never an unpublished
 * event); null otherwise, and null while the lookups do not exist yet.
 */
export async function currentSlugFor(table: SlugTable, oldSlug: string): Promise<string | null> {
  if (missingSlugColumn.has(table) || !oldSlug) return null;
  const fn = table === 'resources' ? 'resource_slug_lookup' : 'event_slug_lookup';
  try {
    const { data, error } = await supabase.rpc(fn, { p_slug: oldSlug });
    if (error) return null;
    return typeof data === 'string' && data ? data : null;
  } catch {
    return null;
  }
}

// What unaccent turns into plain letters and a decomposition does not (public.smc_fold uses unaccent).
const LETTERS: Record<string, string> = {
  'ß': 'ss', 'æ': 'ae', 'œ': 'oe', 'ø': 'o', 'ł': 'l', 'đ': 'd', 'ð': 'd', 'þ': 'th', 'ı': 'i',
};

/**
 * The address a title (or a typed address) gives, as public.smc_slugify() makes it: lower case,
 * accents off, "&" as "and", apostrophes dropped ("Europe's" -> "europes"), every other run of
 * characters as "-", at most 80 characters cut at a word boundary. Can be '' (emoji only).
 */
export function slugifyTitle(text: string, max = 80): string {
  let s = text
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[ßæœøłđðþı]/g, (ch) => LETTERS[ch] ?? ch)
    .replace(/[‘’ʼ`´′']/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (s.length > max) {
    if (s.charAt(max) === '-') s = s.slice(0, max);
    else {
      const head = s.slice(0, max);
      const cut = head.lastIndexOf('-');
      s = cut > 0 ? head.slice(0, cut) : head;
    }
    s = s.replace(/^-+|-+$/g, '');
  }
  return s;
}

/** Shaped like an id: the database refuses such an address (a page would read it as an id). */
export const looksLikeId = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
