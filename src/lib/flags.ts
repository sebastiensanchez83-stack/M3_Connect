import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';

/**
 * The unified-registration switches (platform_settings.registration_flags), the
 * rights switch capabilities_enforced included: the site's ONE reader of that row.
 *
 * Every switch is OFF until M3 turns it on in the database, and a missing key,
 * a failed read or a value of the wrong type all count as off: with the flags
 * at their defaults the site behaves exactly as before the registration work.
 * The row is readable by anyone (platform_settings is public); staff change it.
 *
 * The value is read once per page load and kept for five minutes, shared by
 * every component that asks (one request, however many callers).
 *
 *  - A failed read is never kept: the next caller asks again.
 *  - A read gives up after four seconds (the auth lock after a tab comes back, a
 *    bad connection), so a page waiting on `ready` never stays on its loader.
 *    `failed` then says the switches are NOT known: a screen that must not guess
 *    (which event editor, which participation card) waits or offers a retry.
 *  - After a failed read, useRegistrationFlags reads again when the tab regains
 *    focus (or on retry()), and every mounted hook and onRegistrationFlagsChange
 *    subscriber is told about every successful read, whoever made it.
 *
 *   const { flags, ready, failed } = useRegistrationFlags();
 *   if (ready && !failed && newEventPagesOn(flags)) …
 *
 * readRegistrationFlags() tells "off" from "could not be read" (null). The rights
 * switch needs that: a screen then says "could not load your rights" rather than
 * "not for you" (AuthContext, which also reads the row again when the person
 * comes back to the tab, at most once per five minutes, so an open tab follows
 * the switch without a reload).
 */

/*
 * Go-live order of the Phase 2 front door (registration AUTH lane, 15 Oct 2026):
 *  - account_signup_v2 needs Supabase Auth "Confirm email" ON first. With it off,
 *    GoTrue answers a sign-up on a new address with a session and on a known one
 *    with "already registered", so the form cannot hide which addresses have an
 *    account (spec §5); notify_existing only works as designed with it on.
 *  - front_door needs account_signup_v2 on (turn them on together, or v2 first).
 *    front_door alone keeps claim links (/?signup=true&code=, /onboarding?code=)
 *    on the forms of before, which predate the 11 Oct claim rules.
 *  - The redesign's "Ask M3 to review again" needs notify-admins with the type
 *    "account review requested again" deployed before front_door goes on.
 *  - account_signup_v2 stays off in production until Phase 3 ships M3's screens for
 *    claims and new companies (admin_decide_claim, a queue that reads claim_requested
 *    rows and signup_intent): registration contract §10.8.
 *  - invite_links_v2 is read by the server only (send-notification): with it AND
 *    account_signup_v2 on, team invitation e-mails carry the signed /join/<token> link.
 *    The old live site cannot open such a link: switch it on at go-live only. It is not
 *    in the list below on purpose (no page reads it).
 *  - outbox_sender (Phase 3) is acted on by the server only (registration-cron sends the
 *    e-mails queued in notification_outbox while it is on), but the admin pages read it to
 *    say where a decision e-mail waits ("queued until the sender is on"), so it is listed.
 *  - article_comments (21 Oct 2026): comments under articles, with tags of people and companies
 *    (src/components/resources/ArticleComments.tsx, the dashboard To do, Admin > Resources).
 *    Off: nothing about comments shows and the database refuses them. Only the redesign shows
 *    them, so it can go on once the database update is applied, for validated members to try
 *    them on the preview (docs/operations/article-comments.md).
 *  - article_comment_emails (21 Oct 2026): the e-mails of the comments (a tag, a report to M3).
 *    Off: the database tells people on the site only and queues no e-mail at all; the pages say
 *    "on the site" instead of "by e-mail" and the e-mail preferences hide "Comments". Go-live
 *    only, after the go-live send-notification is deployed.
 */
export const REGISTRATION_FLAG_KEYS = [
  'webinar_v2', 'onsite_v2', 'front_door', 'account_signup_v2', 'password_only_login',
  'wys_form_v2', 'wys_status_edit', 'review_queue', 'provisioning', 'capabilities_enforced', 'turnstile',
  'outbox_sender', 'article_comments', 'article_comment_emails',
] as const;

export type RegistrationFlag = typeof REGISTRATION_FLAG_KEYS[number];
export type RegistrationFlags = Record<RegistrationFlag, boolean>;

export const DEFAULT_REGISTRATION_FLAGS: RegistrationFlags = Object.freeze(
  Object.fromEntries(REGISTRATION_FLAG_KEYS.map((k) => [k, false])) as RegistrationFlags,
);

const TTL_MS = 5 * 60 * 1000;
/** How long a caller waits for the row before giving up (the defaults, or null). */
const READ_TIMEOUT_MS = 4000;

let cached: { at: number; flags: RegistrationFlags } | null = null;
let inflight: Promise<RegistrationFlags | null> | null = null;
/** The mounted useRegistrationFlags and the onRegistrationFlagsChange subscribers, told of every successful read. */
const listeners = new Set<(flags: RegistrationFlags) => void>();

/**
 * Calls `fn` with the switches after every successful read, whoever asked (the
 * value may be the same as before: compare if it matters). Returns the unsubscribe.
 */
export function onRegistrationFlagsChange(fn: (flags: RegistrationFlags) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/**
 * Only a literal `true` in a JSON object turns a switch on; anything else (missing, "true", 1,
 * or the whole value stored as a text) leaves it off. Same reading as the registration edge
 * functions and admin_save_event, so the site and the server never disagree on a switch.
 */
function parseFlags(value: unknown): RegistrationFlags {
  const out = { ...DEFAULT_REGISTRATION_FLAGS };
  const v = value;
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const key of REGISTRATION_FLAG_KEYS) out[key] = (v as Record<string, unknown>)[key] === true;
  }
  return out;
}

const sameFlags = (a: RegistrationFlags, b: RegistrationFlags) =>
  REGISTRATION_FLAG_KEYS.every((k) => a[k] === b[k]);

/** `p`, or `fallback` once `ms` have passed or when it fails. Never rejects. */
function withTimeout<T>(p: PromiseLike<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    Promise.resolve(p).then(
      (v) => { clearTimeout(timer); resolve(v); },
      () => { clearTimeout(timer); resolve(fallback); },
    );
  });
}

/**
 * The switches as stored now (cached five minutes), or null when they could not be
 * read: an error, or no answer within four seconds. Never rejects. A read that
 * answers after its callers gave up still fills the cache (and tells the hooks).
 */
export function readRegistrationFlags(force = false): Promise<RegistrationFlags | null> {
  if (!force && cached && Date.now() - cached.at < TTL_MS) return Promise.resolve(cached.flags);
  if (inflight) return inflight;
  const read = (async (): Promise<RegistrationFlags | null> => {
    try {
      const { data, error } = await supabase
        .from('platform_settings')
        .select('value')
        .eq('key', 'registration_flags')
        .maybeSingle();
      // A failed read is not remembered: the next caller asks again.
      if (error) return null;
      const flags = parseFlags((data as { value?: unknown } | null)?.value);
      cached = { at: Date.now(), flags };
      // Everyone hears of every successful read, even one bringing the value they
      // already had: a hook whose own read failed (or gave up) needs the news too.
      // The hook ignores a value it already shows, so this costs no render.
      listeners.forEach((fn) => fn(flags));
      return flags;
    } catch {
      return null;
    }
  })();
  // Given up after four seconds, the request is forgotten too: the next caller sends
  // a fresh one rather than queue behind a read that may never answer.
  const pending = withTimeout(read, READ_TIMEOUT_MS, null).finally(() => {
    if (inflight === pending) inflight = null;
  });
  inflight = pending;
  return pending;
}

/** The switches as stored now (cached five minutes). Never rejects: an error or a timeout gives the defaults. */
export async function loadRegistrationFlags(force = false): Promise<RegistrationFlags> {
  return (await readRegistrationFlags(force)) ?? { ...DEFAULT_REGISTRATION_FLAGS };
}

type FlagsState = { flags: RegistrationFlags; ready: boolean; failed: boolean };

/**
 * The switches for a component. `ready` is false until the first answer (the defaults
 * meanwhile). `failed` is true while the last read failed: what was shown stays (the
 * defaults at first), and the row is read again when the tab regains focus, or when
 * the component calls retry().
 */
export function useRegistrationFlags(): FlagsState & { retry: () => void } {
  const fresh = cached && Date.now() - cached.at < TTL_MS ? cached.flags : null;
  const [state, setState] = useState<FlagsState>(
    () => ({ flags: fresh ?? DEFAULT_REGISTRATION_FLAGS, ready: !!fresh, failed: false }),
  );
  const [attempt, setAttempt] = useState(0);

  const show = (flags: RegistrationFlags) =>
    setState((prev) => (prev.ready && !prev.failed && sameFlags(prev.flags, flags) ? prev : { flags, ready: true, failed: false }));

  useEffect(() => {
    let alive = true;
    readRegistrationFlags().then((flags) => {
      if (!alive) return;
      if (flags) show(flags);
      else setState((prev) => ({ flags: prev.flags, ready: true, failed: true }));
    });
    return () => { alive = false; };
  }, [attempt]);

  // Any successful read, whoever made it: show its value here too (show() keeps the
  // state as it is when nothing changed).
  useEffect(() => {
    listeners.add(show);
    return () => { listeners.delete(show); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // After a failed read, try again when the person comes back to the tab.
  useEffect(() => {
    if (!state.failed) return;
    const again = () => setAttempt((n) => n + 1);
    window.addEventListener('focus', again);
    return () => window.removeEventListener('focus', again);
  }, [state.failed]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return useMemo(() => ({ ...state, retry }), [state, retry]);
}

/**
 * For a screen that decides once what it shows (which sign-up form, the page or the
 * 404, a redirect): the first value READ, never the defaults of a failed or timed-out
 * read, kept while the component stays mounted. The row is read again when the tab
 * regains focus and every hook hears of it: a switch moved meanwhile must not swap a
 * form under someone typing in it, nor turn an open page into a 404 (the next page
 * load follows it).
 *
 * `known` is false until a read has answered: show a loader, and while `failed` a way
 * to try again (retry(); the row is also read again on focus) rather than guess "off".
 */
export function useRegistrationFlagsOnce(): { flags: RegistrationFlags; known: boolean; failed: boolean; retry: () => void } {
  const live = useRegistrationFlags();
  const kept = useRef<RegistrationFlags | null>(null);
  if (!kept.current && live.ready && !live.failed) kept.current = live.flags;
  return { flags: kept.current ?? live.flags, known: !!kept.current, failed: !kept.current && live.failed, retry: live.retry };
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
