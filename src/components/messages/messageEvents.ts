import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

/**
 * Live messages (Victor, 10 Oct 2026: "new messages appear instantly, and a small
 * alert shows on any page"). ONE Realtime channel per signed-in member, shared by
 * every screen that listens (the site-wide alerts, Messages, an open conversation).
 *
 * What it listens to (migration 20261010173000_messaging_v2.sql puts both tables in
 * the supabase_realtime publication):
 *   conversation_messages  INSERT            a new message in one of my conversations
 *   partner_requests       INSERT / UPDATE   a first message sent to my company, a
 *                                            request accepted (or answered by a colleague)
 * No filter is sent: Realtime only delivers a row to a subscriber who may SELECT it
 * under RLS (conversation_messages_select = the two companies; partner_requests'
 * own policies = sender, receiver, their companies, and M3 staff). Screens still
 * check that a row concerns them before acting on it. DELETE events are not asked for.
 *
 * Realtime is a bonus, never a requirement: `useRealtimeStatus()` says whether the
 * channel is live; while it is not, the screens keep reading every 15 to 30 seconds
 * (and when the window gets the focus back), as before.
 *
 * Which conversation is on screen (setActiveThread): the alerts stay quiet for it.
 */

export interface LiveMessageRow {
  id: string;
  partner_request_id: string;
  author_user_id: string | null;
  author_org_id: string | null;
  body: string;
  created_at: string;
  attachments: unknown;
  deleted_at: string | null;
}

export interface LiveRequestRow {
  id: string;
  partner_user_id: string;
  marina_user_id: string;
  partner_organization_id: string | null;
  marina_organization_id: string | null;
  status: 'pending' | 'accepted' | 'rejected' | 'withdrawn';
  message: string | null;
  created_at: string;
  answered_at?: string | null;
  auto_connected?: boolean;
}

export type LiveEvent =
  | { kind: 'message'; row: LiveMessageRow }
  | { kind: 'request'; type: 'INSERT' | 'UPDATE'; row: LiveRequestRow };

export type RealtimeStatus = 'off' | 'connecting' | 'live' | 'down';

let channel: RealtimeChannel | null = null;
let channelUid: string | null = null;
let status: RealtimeStatus = 'off';
/** How many mounted components keep the channel open (useLiveChannel). */
let holders = 0;
const listeners = new Set<(e: LiveEvent) => void>();
const statusListeners = new Set<() => void>();

function setStatus(next: RealtimeStatus) {
  if (status === next) return;
  status = next;
  statusListeners.forEach((l) => l());
}

function emit(e: LiveEvent) {
  listeners.forEach((l) => {
    try { l(e); } catch { /* one screen's error never stops the others */ }
  });
}

function open(uid: string) {
  if (channel && channelUid === uid) return;
  close();
  channelUid = uid;
  setStatus('connecting');
  try {
    const ch = supabase
      // A new topic each time: a channel being removed is never handed back.
      .channel(`smc-messages-${uid}-${Date.now().toString(36)}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'conversation_messages' },
        (p) => { if (channel === ch) emit({ kind: 'message', row: p.new as LiveMessageRow }); })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'partner_requests' },
        (p) => { if (channel === ch) emit({ kind: 'request', type: 'INSERT', row: p.new as LiveRequestRow }); })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'partner_requests' },
        (p) => { if (channel === ch) emit({ kind: 'request', type: 'UPDATE', row: p.new as LiveRequestRow }); });
    channel = ch;
    // The client retries by itself after an error; the status follows.
    ch.subscribe((s) => {
      if (channel !== ch) return;
      if (s === 'SUBSCRIBED') setStatus('live');
      else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' || s === 'CLOSED') setStatus('down');
    });
  } catch {
    channel = null;
    setStatus('down');
  }
}

function close() {
  const ch = channel;
  channel = null;
  channelUid = null;
  if (ch) void supabase.removeChannel(ch).catch(() => {});
  setStatus('off');
}

let closeTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Keeps the channel open for this member while the calling component is mounted.
 * When the last one goes, the channel closes a few seconds later, unless another
 * screen needs it meanwhile (a page swapped for another, the profile read again on
 * sign-in or on a tab's refocus): no closing and re-joining for a blink.
 */
export function useLiveChannel(uid: string | null) {
  useEffect(() => {
    if (!uid) return;
    holders += 1;
    if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
    open(uid);
    return () => {
      holders -= 1;
      if (holders <= 0) {
        holders = 0;
        if (closeTimer) clearTimeout(closeTimer);
        closeTimer = setTimeout(() => { closeTimer = null; if (holders === 0) close(); }, 3000);
      }
    };
  }, [uid]);
}

/** Calls `handler` for every live event while mounted (the latest handler, without re-subscribing). */
export function useLiveEvents(handler: (e: LiveEvent) => void) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const l = (e: LiveEvent) => ref.current(e);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
}

function subscribeStatus(l: () => void) {
  statusListeners.add(l);
  return () => { statusListeners.delete(l); };
}

/** 'live' when new messages arrive by themselves; otherwise screens keep polling. */
export function useRealtimeStatus(): RealtimeStatus {
  return useSyncExternalStore(subscribeStatus, () => status, () => status);
}

/* ------------------------------------------------------------------ the conversation on screen */

let activeThread: string | null = null;

/** The conversation open on screen (null when none): the alerts stay quiet for it. */
export function setActiveThread(id: string | null) {
  activeThread = id;
}

export function getActiveThread(): string | null {
  return activeThread;
}

/* ------------------------------------------------------------------ the phone conversation screen */

let screenOpen = false;
const screenListeners = new Set<() => void>();

/** A conversation fills the phone's screen (the alerts then show at the top, clear of its composer). */
export function setConversationScreenOpen(open: boolean) {
  if (screenOpen === open) return;
  screenOpen = open;
  screenListeners.forEach((l) => l());
}

export function useConversationScreenOpen(): boolean {
  return useSyncExternalStore(
    (l) => { screenListeners.add(l); return () => { screenListeners.delete(l); }; },
    () => screenOpen,
    () => screenOpen,
  );
}
