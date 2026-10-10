import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

/**
 * The unified-registration switches (platform_settings.registration_flags).
 *
 * Every switch is OFF until M3 turns it on in the database, and a missing key,
 * a failed read or a value of the wrong type all count as off: with the flags
 * at their defaults the site behaves exactly as before the registration work.
 * The row is readable by anyone (platform_settings is public); staff change it.
 *
 * The value is read once per page load and kept for five minutes, shared by
 * every component that asks (one request, however many callers).
 *
 *   const { flags, ready } = useRegistrationFlags();
 *   if (ready && newEventPagesOn(flags)) …
 */

export const REGISTRATION_FLAG_KEYS = [
  'webinar_v2', 'onsite_v2', 'front_door', 'account_signup_v2', 'password_only_login',
  'wys_form_v2', 'wys_status_edit', 'review_queue', 'provisioning', 'capabilities_enforced', 'turnstile',
] as const;

export type RegistrationFlag = typeof REGISTRATION_FLAG_KEYS[number];
export type RegistrationFlags = Record<RegistrationFlag, boolean>;

export const DEFAULT_REGISTRATION_FLAGS: RegistrationFlags = Object.freeze(
  Object.fromEntries(REGISTRATION_FLAG_KEYS.map((k) => [k, false])) as RegistrationFlags,
);

const TTL_MS = 5 * 60 * 1000;

let cached: { at: number; flags: RegistrationFlags } | null = null;
let inflight: Promise<RegistrationFlags> | null = null;

/** Only a literal `true` turns a switch on; anything else (missing, "true", 1) leaves it off. */
function parseFlags(value: unknown): RegistrationFlags {
  const out = { ...DEFAULT_REGISTRATION_FLAGS };
  let v = value;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch { v = null; }
  }
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const key of REGISTRATION_FLAG_KEYS) out[key] = (v as Record<string, unknown>)[key] === true;
  }
  return out;
}

/** The switches as stored now (cached five minutes). Never rejects: an error gives the defaults. */
export function loadRegistrationFlags(force = false): Promise<RegistrationFlags> {
  if (!force && cached && Date.now() - cached.at < TTL_MS) return Promise.resolve(cached.flags);
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const { data, error } = await supabase
        .from('platform_settings')
        .select('value')
        .eq('key', 'registration_flags')
        .maybeSingle();
      const flags = error ? { ...DEFAULT_REGISTRATION_FLAGS } : parseFlags((data as { value?: unknown } | null)?.value);
      // A failed read is not remembered: the next page asks again.
      if (!error) cached = { at: Date.now(), flags };
      return flags;
    } catch {
      return { ...DEFAULT_REGISTRATION_FLAGS };
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** The switches for a component. `ready` is false until the first answer (the defaults meanwhile). */
export function useRegistrationFlags(): { flags: RegistrationFlags; ready: boolean } {
  const fresh = cached && Date.now() - cached.at < TTL_MS ? cached.flags : null;
  const [state, setState] = useState<{ flags: RegistrationFlags; ready: boolean }>(
    () => ({ flags: fresh ?? DEFAULT_REGISTRATION_FLAGS, ready: !!fresh }),
  );
  useEffect(() => {
    let alive = true;
    loadRegistrationFlags().then((flags) => { if (alive) setState({ flags, ready: true }); });
    return () => { alive = false; };
  }, []);
  return state;
}

/**
 * The new event pages (ParticipateBlock on /events/:id, the unified My events):
 * on as soon as one of the two event switches is. A core_v2 event can only be
 * published once its own switch is on (the database refuses it otherwise), so
 * a published core_v2 event always meets the new page.
 */
export function newEventPagesOn(flags: RegistrationFlags): boolean {
  return flags.webinar_v2 || flags.onsite_v2;
}
