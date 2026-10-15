import { supabase } from '@/lib/supabase';
import { callRegistration, type RegResult } from '@/lib/registration';

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

/* ------------------------------------------------------------------------------------------
 * Behind the registration switches (platform_settings.registration_flags, all off by default).
 * With both switches off nothing below is called: the pages use guestList() exactly as before.
 *
 *  - wys_form_v2: the /wys26 request goes to the `registration` function's parity action
 *    (same rules, same gl_guest row, same e-mails + a "View my request" link), which also
 *    links the request to a signed-in account that proved its address.
 *  - wys_status_edit: the personal page offers "Edit my request", "Cancel my request", "Send my
 *    request again" and "Add to my account" through `registration`. The guest / rsvp /
 *    plus_one calls stay on guest-list.
 * ---------------------------------------------------------------------------------------- */

/** The body of guest-list's `request` action (the /wys26 form). */
export interface WysRequestBody {
  slug: string;
  first_name: string; last_name: string; email: string; phone: string; company: string;
  job_title: string; country: string; motivation: string; website: string;
  wants_conference: boolean; wants_gala: boolean;
  captcha?: string;
}

/**
 * The parity call, with what is needed to know whether the function did anything: its own
 * error code, or (no code of the function) the HTTP status of the platform's gateway.
 */
async function parityRequest(body: WysRequestBody): Promise<{ ok?: true; error?: string; status?: number; gateway?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('registration', { body: { action: 'register', ...body } });
    if (!error) {
      const d = data as Record<string, unknown> | null;
      if (d && typeof d === 'object' && d.ok === true) return { ok: true };
      return { error: d && typeof d.error === 'string' && d.error ? d.error : 'bad_response' };
    }
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      let payload: Record<string, unknown> | null = null;
      try { payload = await ctx.json(); } catch { /* not JSON */ }
      const code = payload && typeof payload.error === 'string' ? payload.error : '';
      const gateway = payload && typeof payload.code === 'string' ? payload.code : '';
      return { error: code || 'unavailable', status: ctx.status, ...(code ? {} : { gateway }) };
    }
    return { error: 'network' };
  } catch {
    return { error: 'network' };
  }
}

/**
 * Parity answers after which the request goes to guest-list as before: those where the
 * function provably did nothing, so the single-use Turnstile token is still unused:
 *  - not_available (403): the switch was turned off meanwhile (checked before anything else);
 *  - session_expired (401): refused before the action ran;
 *  - no code of the function: the gateway refused the call (401), the function is missing
 *    (404, not deployed yet) or did not boot (BOOT_ERROR).
 * Any other failure (network cut, a 5xx, an odd answer) may come after the function verified
 * the token or wrote the row: the visitor gets the usual "try again" message, and sending the
 * form again is safe (an existing request answers { ok: true } and changes nothing).
 */
function parityFallsBack(r: { error?: string; status?: number; gateway?: string }): boolean {
  if (r.error === 'not_available' || r.error === 'session_expired') return true;
  return r.error === 'unavailable' && (r.status === 401 || r.status === 404 || r.gateway === 'BOOT_ERROR');
}

/**
 * Sends a /wys26 invitation request. `parity` = switch wys_form_v2 (as the page last read it).
 * Same answers as guest-list: `{ ok: true }` or `{ error: <guest-list code> }`.
 */
export async function requestInvitation(body: WysRequestBody, parity: boolean): Promise<{ ok?: boolean; error?: string }> {
  if (parity) {
    const r = await parityRequest(body);
    if (r.ok) return { ok: true };
    if (!parityFallsBack(r)) return { error: r.error || 'unavailable' };
  }
  return guestList({ action: 'request', ...body });
}

/** What the personal page needs for "Edit my request" / "Cancel my request" / "Add to my account". */
export interface WysRequestView {
  ok: true;
  status: GuestStatus;
  source: string;
  is_plus_one: boolean;
  can_edit: boolean;
  can_cancel: boolean;
  /** A request its author cancelled from this link, while the event takes requests. */
  can_restore: boolean;
  linked: boolean;
  linked_to_me: boolean;
  /** Signed in: this account may take the row ("Add to my account"). */
  can_attach: boolean;
  /** Signed in with the very address the link was sent to. */
  same_email: boolean;
  /** Only when can_attach and not same_email: where the link was sent (masked). */
  email_masked: string | null;
  /** Only while the request can be edited. */
  request: {
    first_name: string; last_name: string; email_masked: string;
    phone: string; company: string; job_title: string; country: string; motivation: string;
    wants_conference: boolean; wants_gala: boolean;
  } | null;
}

export type WysRequestChanges = Partial<Pick<NonNullable<WysRequestView['request']>,
  'phone' | 'company' | 'job_title' | 'country' | 'motivation' | 'wants_conference' | 'wants_gala'>>;

const isRequestView = (d: Record<string, unknown>) => typeof d.status === 'string' && typeof d.can_edit === 'boolean';

/** Switch wys_status_edit: the request behind a personal link (403 not_available when the switch is off). */
export function getWysRequest(token: string): Promise<RegResult<WysRequestView>> {
  return callRegistration<WysRequestView>({ action: 'status', token }, isRequestView);
}

/** Only while requested: phone, company, job title, country, motivation, the parts. Answers the new view. */
export function updateWysRequest(token: string, changes: WysRequestChanges): Promise<RegResult<WysRequestView>> {
  return callRegistration<WysRequestView>({ action: 'update', token, ...changes }, isRequestView);
}

/** Only while requested. Confirmed guests keep guest-list's RSVP decline. */
export function cancelWysRequest(token: string): Promise<RegResult<{ ok: true; status: 'cancelled' }>> {
  return callRegistration<{ ok: true; status: 'cancelled' }>({ action: 'cancel', token });
}

/** A request cancelled from this link goes back to review (same row, same link). Answers the new view. */
export function restoreWysRequest(token: string): Promise<RegResult<WysRequestView>> {
  return callRegistration<WysRequestView>({ action: 'restore', token }, isRequestView);
}

/** Signed in: links this guest-list row to the account (never proves the address). */
export function attachWysRequest(token: string): Promise<RegResult<{ ok: true; already?: boolean }>> {
  return callRegistration<{ ok: true; already?: boolean }>({ action: 'attach', token });
}
