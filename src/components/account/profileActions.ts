import { supabase } from '@/lib/supabase';
import { resizeImage, fileMeta } from '@/lib/image';
import { memberHomeHref } from '@/lib/accountNav';

/**
 * The member's own writes, taken out of ProfileEditor and
 * NotificationPreferencesTab so the dashboard's one-field windows do exactly
 * the same thing (same bucket and path, same columns). Each caller keeps its
 * own messages and checks the session first (requireFreshSession).
 */

export const AVATAR_MAX_BYTES = 25 * 1024 * 1024;

/** Why a photo cannot be used ('type': not an image, 'size': over 25 MB), or null. */
export function avatarProblem(file: File): 'type' | 'size' | null {
  if (!file.type.startsWith('image/')) return 'type';
  if (file.size > AVATAR_MAX_BYTES) return 'size';
  return null;
}

/** The columns of the profile a member edits one by one. */
export type ProfileField = 'first_name' | 'last_name' | 'job_title';

/**
 * Saves some of the profile's columns. The caller trims; a job title left
 * empty is stored as null (the names as an empty string, as before).
 */
export async function saveProfileFields(uid: string, fields: Partial<Record<ProfileField, string | null>>): Promise<void> {
  const { error } = await supabase.from('profiles').update(fields).eq('user_id', uid);
  if (error) throw error;
}

/** Uploads a profile photo (600 px) to profile-images and stores its address. */
export async function uploadAvatar(uid: string, file: File): Promise<{ url: string; meta: string }> {
  const meta = await fileMeta(file);
  const blob = await resizeImage(file, 600, 600); // shrink big files; keep PNG/SVG transparency
  const ctype = (blob as Blob).type || file.type;
  const ext = ctype === 'image/svg+xml' ? 'svg' : ctype === 'image/png' ? 'png' : 'jpg';
  // The storage RLS policy requires the first path segment to be the user's id.
  const fileName = `${uid}/avatar-${Date.now()}.${ext}`;
  const { error: uploadErr } = await supabase.storage.from('profile-images').upload(fileName, blob, { cacheControl: '3600', upsert: true, contentType: ctype });
  if (uploadErr) throw uploadErr;
  const { data: urlData } = supabase.storage.from('profile-images').getPublicUrl(fileName);
  const { error } = await supabase.from('profiles').update({ avatar_url: urlData.publicUrl }).eq('user_id', uid);
  if (error) throw error;
  return { url: urlData.publicUrl, meta };
}

/**
 * E-mails a link to choose a new password. /reset-password redeems it (any
 * device) and shows the new-password form; `next` brings the member back to
 * My profile afterwards, still signed in.
 */
export async function sendPasswordLink(email: string): Promise<void> {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/reset-password?next=${encodeURIComponent(memberHomeHref('profile'))}`,
  });
  if (error) throw error;
}

/** Stores the whole e-mail preference map (a missing key reads as "on"). */
export async function saveNotificationPrefs(uid: string, prefs: Record<string, boolean>): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({ notification_prefs: prefs })
    .eq('user_id', uid);
  if (error) throw error;
}
