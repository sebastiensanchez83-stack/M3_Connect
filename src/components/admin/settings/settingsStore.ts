import { supabase } from '@/lib/supabase';

/**
 * platform_settings rows changed from Admin > Platform settings (staff RLS: verified admins
 * and moderators may write). Every save is a compare-and-set: the row is read again just
 * before writing, and if its VALUE is not the one this page showed (changed from another
 * page, or by SQL, which does not move updated_at), nothing is written and the page reads it
 * again. The write itself is also conditional on `updated_at`, so two pages saving at the
 * same moment never overwrite each other either.
 */

export interface SettingRow<T = unknown> {
  value: T | undefined;
  /** null = no row yet. */
  updatedAt: string | null;
  /** The read failed (network, rights): show an error, never "off". */
  failed: boolean;
}

export async function readSetting<T = unknown>(key: string): Promise<SettingRow<T>> {
  const { data, error } = await supabase
    .from('platform_settings')
    .select('value, updated_at')
    .eq('key', key)
    .maybeSingle();
  if (error) return { value: undefined, updatedAt: null, failed: true };
  const row = data as { value?: unknown; updated_at?: string | null } | null;
  return { value: row?.value as T | undefined, updatedAt: row?.updated_at ?? null, failed: false };
}

/** The same JSON value (object key order ignored), as jsonb compares. */
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    return a.length === bb.length && a.every((x, i) => sameJson(x, bb[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao);
  return ak.length === Object.keys(bo).length && ak.every(k => Object.prototype.hasOwnProperty.call(bo, k) && sameJson(ao[k], bo[k]));
}

export type SaveOutcome = { ok: true; updatedAt: string } | { ok: false; reason: 'conflict' | 'error'; message?: string };

/**
 * Writes `value` only if the row still holds `expected.value` (and `expected.updatedAt`):
 * what the person saw when they decided. `expected.updatedAt` null = no row was there.
 */
export async function saveSetting(
  key: string,
  value: unknown,
  expected: { value: unknown; updatedAt: string | null },
  userId: string | undefined,
): Promise<SaveOutcome> {
  const now = new Date().toISOString();
  if (expected.updatedAt === null) {
    const { error } = await supabase
      .from('platform_settings')
      .insert({ key, value, updated_at: now, updated_by: userId ?? null });
    if (error) return { ok: false, reason: error.code === '23505' ? 'conflict' : 'error', message: error.message };
    return { ok: true, updatedAt: now };
  }
  // Read again: a change that did not move updated_at (SQL) is caught here.
  const fresh = await readSetting(key);
  if (fresh.failed) return { ok: false, reason: 'error', message: 'the setting could not be read again' };
  if (fresh.updatedAt !== expected.updatedAt || !sameJson(fresh.value, expected.value)) return { ok: false, reason: 'conflict' };
  const { data, error } = await supabase
    .from('platform_settings')
    .update({ value, updated_at: now, updated_by: userId ?? null })
    .eq('key', key)
    .eq('updated_at', expected.updatedAt)
    .select('updated_at');
  if (error) return { ok: false, reason: 'error', message: error.message };
  if (!data?.length) return { ok: false, reason: 'conflict' };
  return { ok: true, updatedAt: (data[0] as { updated_at?: string }).updated_at ?? now };
}
