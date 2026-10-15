import { supabase } from '@/lib/supabase';

/**
 * platform_settings rows changed from Admin > Platform settings (staff RLS: verified admins
 * and moderators may write). Every save is a compare-and-set on `updated_at`: if someone
 * changed the row since this page read it, nothing is written and the page reads it again,
 * so two people never overwrite each other's switches.
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

export type SaveOutcome = { ok: true; updatedAt: string } | { ok: false; reason: 'conflict' | 'error'; message?: string };

export async function saveSetting(key: string, value: unknown, expectedUpdatedAt: string | null, userId: string | undefined): Promise<SaveOutcome> {
  const now = new Date().toISOString();
  if (expectedUpdatedAt === null) {
    const { error } = await supabase
      .from('platform_settings')
      .insert({ key, value, updated_at: now, updated_by: userId ?? null });
    if (error) return { ok: false, reason: error.code === '23505' ? 'conflict' : 'error', message: error.message };
    return { ok: true, updatedAt: now };
  }
  const { data, error } = await supabase
    .from('platform_settings')
    .update({ value, updated_at: now, updated_by: userId ?? null })
    .eq('key', key)
    .eq('updated_at', expectedUpdatedAt)
    .select('updated_at');
  if (error) return { ok: false, reason: 'error', message: error.message };
  if (!data?.length) return { ok: false, reason: 'conflict' };
  return { ok: true, updatedAt: (data[0] as { updated_at?: string }).updated_at ?? now };
}
