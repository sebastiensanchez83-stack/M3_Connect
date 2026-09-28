import { supabase } from '@/lib/supabase';

// Guest-list events (gl_event / gl_guest) — invitation-only events run on a
// plain guest list. Everything public goes through the guest-list edge
// function; staff screens read the tables directly (RLS: moderators).

export interface GuestEventSettings {
  tagline?: string; date_label?: string; venue?: string; city?: string;
  logo_url?: string; logo_white_url?: string; website?: string; contact_email?: string;
  intro?: string; themes?: string[]; programme_note?: string;
  parts?: { key: 'conference' | 'gala'; label: string; when?: string }[];
}
export interface PublicGuestEvent { slug: string; title: string; requests_open: boolean; settings: GuestEventSettings }

export type GuestStatus = 'requested' | 'invited' | 'confirmed' | 'declined' | 'rejected' | 'cancelled';
export interface GuestView {
  event: PublicGuestEvent;
  guest: {
    first_name: string; last_name: string; company: string | null; status: GuestStatus; source: string;
    conference: boolean; gala: boolean; checked_in: boolean; checkin_url: string | null;
    is_plus_one: boolean; host: { first_name: string; last_name: string } | null;
    plus_one: { first_name: string; last_name: string; status: GuestStatus } | null;
  };
}

// Returns the function's JSON body whether it answered 2xx or not, so callers
// can switch on our own { error } codes.
export async function guestList<T = any>(body: Record<string, unknown>): Promise<T & { error?: string }> {
  const { data, error } = await supabase.functions.invoke('guest-list', { body });
  if (!error) return data;
  try {
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') return await ctx.json();
  } catch { /* fall through */ }
  return { error: (error as { message?: string }).message || 'network' } as T & { error?: string };
}

export const partsLabel = (g: { conference: boolean; gala: boolean }) =>
  g.conference && g.gala ? 'Conference + Gala dinner' : g.gala ? 'Gala dinner' : g.conference ? 'Conference' : '—';
