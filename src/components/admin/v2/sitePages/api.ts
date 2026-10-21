import { supabase } from '@/lib/supabase';
import { isMissingSiteContentTable } from '@/lib/siteContent/load';
import type { SiteContentBody, SiteContentKind } from '@/lib/siteContent/store';

/**
 * Admin > Site pages: reads site_content (staff read every row, published or not) and its
 * history, and publishes through site_content_publish (supabase/migrations/20261021161000_site_content.sql).
 * Before that file is applied the reads fail with "table missing": the screen says so and
 * Publish stays off.
 */

export interface ContentRow {
  key: string;
  kind: SiteContentKind;
  body: SiteContentBody;
  published: boolean;
  updated_at: string;
}

export interface HistoryRow {
  id: number;
  batch_id: string;
  page: string;
  key: string;
  kind: SiteContentKind;
  body: SiteContentBody | null;
  note: string | null;
  changed_at: string;
  changed_by: string | null;
}

/** A change waiting to be published: body null = back to the code's text. */
export interface DraftItem {
  kind: SiteContentKind;
  body: SiteContentBody | null;
}

export type Draft = Record<string, DraftItem>;

export async function fetchContentRows(): Promise<{ rows: Map<string, ContentRow>; installed: boolean; error?: string }> {
  const { data, error } = await supabase.from('site_content').select('key, kind, body, published, updated_at');
  if (error) {
    return { rows: new Map(), installed: !isMissingSiteContentTable(error), error: isMissingSiteContentTable(error) ? undefined : error.message };
  }
  return { rows: new Map(((data ?? []) as ContentRow[]).map((r) => [r.key, r])), installed: true };
}

export async function fetchHistory(page?: string, limit = 400): Promise<HistoryRow[]> {
  let q = supabase
    .from('site_content_history')
    .select('id, batch_id, page, key, kind, body, note, changed_at, changed_by')
    .order('id', { ascending: false })
    .limit(limit);
  if (page) q = q.eq('page', page);
  const { data, error } = await q;
  if (error) return [];
  return (data ?? []) as HistoryRow[];
}

/** First and last names of the people who published. */
export async function fetchNames(ids: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return {};
  const { data } = await supabase.from('profiles').select('user_id, first_name, last_name').in('user_id', unique);
  const out: Record<string, string> = {};
  for (const p of (data ?? []) as { user_id: string; first_name: string | null; last_name: string | null }[]) {
    out[p.user_id] = [p.first_name, p.last_name].filter(Boolean).join(' ') || 'M3 team';
  }
  return out;
}

export async function publishDraft(page: string, draft: Draft, note: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const items = Object.entries(draft).map(([key, v]) => ({ key, kind: v.kind, body: v.body }));
  if (!items.length) return { ok: true };
  const { error } = await supabase.rpc('site_content_publish', { p_page: page, p_items: items, p_note: note.trim() || null });
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

/** The current state of a block: its published body, or null (the code's text). */
export function publishedBody(rows: Map<string, ContentRow>, key: string): SiteContentBody | null {
  const row = rows.get(key);
  return row && row.published ? row.body : null;
}

/** One Publish of a page, newest first. */
export interface Version {
  batchId: string;
  /** The highest history id of this Publish: the page as it was right after it. */
  lastId: number;
  at: string;
  by: string | null;
  note: string | null;
  count: number;
}

export function versionsOf(history: HistoryRow[]): Version[] {
  const byBatch = new Map<string, Version>();
  for (const h of history) {
    const v = byBatch.get(h.batch_id);
    if (v) {
      v.count += 1;
      v.lastId = Math.max(v.lastId, h.id);
    } else {
      byBatch.set(h.batch_id, { batchId: h.batch_id, lastId: h.id, at: h.changed_at, by: h.changed_by, note: h.note, count: 1 });
    }
  }
  return [...byBatch.values()].sort((a, b) => b.lastId - a.lastId);
}

/**
 * Every block of the page as it was right after a Publish: for each key the page's history
 * touched, its last change up to that Publish, or the code's text if it came later.
 */
export function stateAt(history: HistoryRow[], lastId: number): Map<string, DraftItem> {
  const out = new Map<string, DraftItem>();
  const sorted = [...history].sort((a, b) => a.id - b.id);
  for (const h of sorted) {
    if (!out.has(h.key)) out.set(h.key, { kind: h.kind, body: null });
    if (h.id <= lastId) out.set(h.key, { kind: h.kind, body: h.body });
  }
  return out;
}

/** JSON with sorted keys (jsonb hands keys back in its own order). */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v as Record<string, unknown>).sort()
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

export function sameBody(a: SiteContentBody | null | undefined, b: SiteContentBody | null | undefined): boolean {
  return stable(a ?? null) === stable(b ?? null);
}
