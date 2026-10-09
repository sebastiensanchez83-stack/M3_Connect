import i18n from '@/i18n';
import { supabase } from '@/lib/supabase';
import { fetchPeople, type OrgRef, type PartnerRequestData, type PersonRef } from '@/components/inbox/inboxActions';
import { myOrganizationIds } from '@/components/inbox/inboxCounts';
import { fetchPeopleOrgs, type PersonOrg } from '@/lib/personOrg';

/**
 * Company-to-company messaging (Victor's decisions of 9 Oct 2026), the data side.
 *
 *  - A first message (max 500 characters) goes from a company page to the WHOLE
 *    receiving company: a partner_requests row with origin 'message'. When the two
 *    companies' sectors match, the database accepts it at once (auto_connected);
 *    otherwise any member of the receiving company accepts or declines it, and the
 *    first answer counts.
 *  - Once accepted, the two companies share one conversation: every member of both
 *    can read and reply, and every message shows its author's name, company and
 *    time. The first message opens the thread (msg_thread returns it first).
 *  - No e-mail per message: only the introduction when a company accepts by hand,
 *    and the Friday digest (edge function messages-digest).
 *
 * Database side: supabase/migrations/20261009190000_company_messaging.sql. Until it
 * is applied, the reads here fail softly (no conversations, no unread count) and a
 * first message is sent the old way (a pending request, no automatic connection).
 */

const MAX_FIRST_MESSAGE = 500;
export const FIRST_MESSAGE_MAX = MAX_FIRST_MESSAGE;
export const THREAD_MESSAGE_MAX = 4000;

/* ------------------------------------------------------------------ conversations */

export interface Conversation {
  id: string;
  mySide: 'partner' | 'marina';
  myOrgId: string | null;
  otherOrg: OrgRef | null;
  /** The other side's person when their company is unknown (old requests). */
  otherPersonName: string | null;
  autoConnected: boolean;
  startedAt: string;
  connectedAt: string;
  lastMessageAt: string;
  lastPreview: string;
  lastAuthorName: string | null;
  lastFromMySide: boolean;
  unread: number;
}

interface ConversationRow {
  partner_request_id: string;
  my_side: 'partner' | 'marina';
  my_org_id: string | null;
  other_org_id: string | null;
  other_org_name: string | null;
  other_org_slug: string | null;
  other_org_logo_url: string | null;
  other_org_type: string | null;
  other_person_name: string | null;
  auto_connected: boolean;
  started_at: string;
  connected_at: string;
  last_message_at: string;
  last_message_preview: string | null;
  last_author_name: string | null;
  last_from_my_side: boolean;
  unread_count: number;
}

/** The signed-in member's conversations, most recent first. `ok` is false when they could not be read. */
export async function loadConversations(): Promise<{ ok: boolean; items: Conversation[] }> {
  const { data, error } = await supabase.rpc('msg_conversations');
  if (error) return { ok: false, items: [] };
  const items = ((data ?? []) as ConversationRow[]).map((r) => ({
    id: r.partner_request_id,
    mySide: r.my_side,
    myOrgId: r.my_org_id,
    otherOrg: r.other_org_id
      ? { id: r.other_org_id, name: r.other_org_name || '', slug: r.other_org_slug, logo_url: r.other_org_logo_url, organization_type: r.other_org_type }
      : null,
    otherPersonName: r.other_person_name,
    autoConnected: !!r.auto_connected,
    startedAt: r.started_at,
    connectedAt: r.connected_at,
    lastMessageAt: r.last_message_at,
    lastPreview: r.last_message_preview || '',
    lastAuthorName: r.last_author_name,
    lastFromMySide: !!r.last_from_my_side,
    unread: Number(r.unread_count) || 0,
  }));
  return { ok: true, items };
}

export interface ThreadMessage {
  id: string;
  authorUserId: string | null;
  authorName: string | null;
  authorJobTitle: string | null;
  authorAvatarUrl: string | null;
  authorOrgId: string | null;
  authorOrgName: string | null;
  /** Null when the message was removed. */
  body: string | null;
  createdAt: string;
  isFirst: boolean;
  fromMySide: boolean;
  isDeleted: boolean;
  /** Only on the screen, while it is being sent. */
  pending?: boolean;
}

interface ThreadRow {
  id: string;
  author_user_id: string | null;
  author_name: string | null;
  author_job_title: string | null;
  author_avatar_url: string | null;
  author_org_id: string | null;
  author_org_name: string | null;
  body: string | null;
  created_at: string;
  is_first: boolean;
  from_my_side: boolean;
  is_deleted: boolean;
}

/** One conversation, oldest first. Throws when it cannot be read. */
export async function loadThread(requestId: string): Promise<ThreadMessage[]> {
  const { data, error } = await supabase.rpc('msg_thread', { p_request: requestId });
  if (error) throw error;
  return ((data ?? []) as ThreadRow[]).map((r) => ({
    id: r.id,
    authorUserId: r.author_user_id,
    authorName: r.author_name,
    authorJobTitle: r.author_job_title,
    authorAvatarUrl: r.author_avatar_url,
    authorOrgId: r.author_org_id,
    authorOrgName: r.author_org_name,
    body: r.body,
    createdAt: r.created_at,
    isFirst: !!r.is_first,
    fromMySide: !!r.from_my_side,
    isDeleted: !!r.is_deleted,
  }));
}

export type SendResult = { ok: true } | { ok: false; rateLimited: boolean; message: string };

/** Posts a message in a conversation (the database sets the author, company and time). */
export async function sendThreadMessage(requestId: string, body: string): Promise<SendResult> {
  const text = body.trim();
  if (!text) return { ok: false, rateLimited: false, message: i18n.t('messages.err.empty', 'Write a message first.') };
  const { error } = await supabase.from('conversation_messages').insert({ partner_request_id: requestId, body: text.slice(0, THREAD_MESSAGE_MAX) });
  if (!error) return { ok: true };
  const rateLimited = error.hint === 'rate_limited';
  return {
    ok: false,
    rateLimited,
    message: rateLimited
      ? i18n.t('messages.err.tooManyPerHour', 'You have sent many messages in the last hour. Please wait a little before sending more.')
      : i18n.t('messages.err.notSent', 'Your message could not be sent. Please check your connection and try again.'),
  };
}

/**
 * Marks a conversation read (best effort), up to `until`: the time of the newest
 * message on screen, so one that arrived meanwhile stays unread. Now when not given.
 */
export async function markThreadRead(requestId: string, until?: string | null): Promise<void> {
  await supabase.rpc('msg_mark_read', { p_request: requestId, p_until: until ?? null });
}

/**
 * "Report to M3": a row the M3 team reviews (with the last messages, for context),
 * on a conversation or on a first message, whatever its status.
 */
export async function reportConversation(requestId: string, reason: string): Promise<{ ok: boolean; message?: string }> {
  const { error } = await supabase.from('conversation_reports').insert({ partner_request_id: requestId, reason: reason.trim().slice(0, 1000) });
  if (!error) return { ok: true };
  return {
    ok: false,
    message: error.hint === 'rate_limited'
      ? i18n.t('messages.err.tooManyReports', 'You have sent many reports today. Please write to M3 at events@m3monaco.com.')
      : i18n.t('messages.err.reportNotSent', 'Your report could not be sent. Please try again, or write to events@m3monaco.com.'),
  };
}

/** Unread messages in all the member's conversations; 0 when it cannot be read. */
export async function fetchUnreadMessageCount(): Promise<number> {
  const { data, error } = await supabase.rpc('msg_unread_count');
  if (error) return 0;
  return Number(data) || 0;
}

/* ------------------------------------------------------------------ requests */

/** A first message still waiting for an answer (received), or one my company sent. */
export interface ConnectionRequest {
  data: PartnerRequestData;
  direction: 'received' | 'sent';
  /** Received: who wrote it. Sent: who in my company sent it (null when it was me). */
  person: PersonRef | null;
  /** The other company. */
  org: OrgRef | null;
}

const PR_SELECT = `
  id, partner_user_id, marina_user_id, partner_organization_id, marina_organization_id,
  message, status, created_at,
  partner_org:organizations!partner_requests_partner_organization_id_fkey (id, name, slug, logo_url, organization_type),
  marina_org:organizations!partner_requests_marina_organization_id_fkey (id, name, slug, logo_url, organization_type)`;

type PRRow = PartnerRequestData & { partner_org: OrgRef | null; marina_org: OrgRef | null };

/**
 * Requests waiting for my company's answer (all of them, whatever their age: the
 * count in the navbar and the dashboard tile has no date limit either), and the
 * ones my company sent that are still waiting, or were declined in the last 90
 * days. The sender's colleagues see what their company sent (the migration's
 * sender-company read; before it, only one's own).
 *
 * A side that names a company is that company's members, now (the database's rule,
 * msg_side): someone who left a company no longer sees what was sent to or by it.
 */
export async function loadRequests(uid: string, activeOrgId: string | null): Promise<{ received: ConnectionRequest[]; sent: ConnectionRequest[] }> {
  const orgIds = [...new Set([...(await myOrganizationIds(uid)), ...(activeOrgId ? [activeOrgId] : [])])];
  const mine = new Set(orgIds);
  const inList = orgIds.length ? `(${orgIds.join(',')})` : null;
  const audience = [
    `partner_user_id.eq.${uid}`,
    `marina_user_id.eq.${uid}`,
    ...(inList ? [`marina_organization_id.in.${inList}`, `partner_organization_id.in.${inList}`] : []),
  ].join(',');
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from('partner_requests')
    .select(PR_SELECT)
    .or(audience)
    // A second or() is ANDed with the first by PostgREST.
    .or(`status.eq.pending,and(status.eq.rejected,created_at.gte."${since}")`)
    .order('created_at', { ascending: false });
  if (error) throw error;
  const rows = (data ?? []) as unknown as PRRow[];

  const isMySide = (userId: string, orgId: string | null) => (orgId ? mine.has(orgId) : userId === uid);
  const received: PRRow[] = [];
  const sent: PRRow[] = [];
  for (const r of rows) {
    const iSent = isMySide(r.partner_user_id, r.partner_organization_id);
    const toMe = isMySide(r.marina_user_id, r.marina_organization_id);
    if (iSent) sent.push(r);
    else if (toMe && r.status === 'pending') received.push(r);
  }

  const people = await fetchPeople([...new Set([
    ...received.map((r) => r.partner_user_id),
    ...sent.filter((r) => r.partner_user_id !== uid).map((r) => r.partner_user_id),
  ])]);
  // Old requests saved without their organisations: the company each person speaks for.
  const missing = [
    ...received.filter((r) => !r.partner_org).map((r) => r.partner_user_id),
    ...sent.filter((r) => !r.marina_org).map((r) => r.marina_user_id),
  ];
  const fallback: Record<string, PersonOrg> = missing.length ? await fetchPeopleOrgs(missing) : {};

  return {
    received: received.map((r) => ({
      data: r,
      direction: 'received' as const,
      person: people[r.partner_user_id] ?? null,
      org: r.partner_org ?? fallback[r.partner_user_id] ?? null,
    })),
    sent: sent.map((r) => ({
      data: r,
      direction: 'sent' as const,
      person: r.partner_user_id === uid ? null : people[r.partner_user_id] ?? null,
      org: r.marina_org ?? fallback[r.marina_user_id] ?? null,
    })),
  };
}

/* ------------------------------------------------------------------ the first message */

export interface CompanyConnection {
  id: string;
  status: 'pending' | 'accepted';
  /** sent: my company wrote first; received: they did. */
  direction: 'sent' | 'received';
}

/**
 * The open request (pending or accepted) between my company and another one, either
 * way, or null. Accepted first. `myOrgIds`: every company I belong to.
 */
export async function findCompanyConnection(uid: string, myOrgIds: string[], targetOrgId: string): Promise<CompanyConnection | null> {
  const ids = [...new Set(myOrgIds)].filter(Boolean);
  const inList = ids.length ? `(${ids.join(',')})` : null;
  const parts = [
    `and(partner_user_id.eq.${uid},marina_organization_id.eq.${targetOrgId})`,
    ...(inList ? [
      `and(partner_organization_id.in.${inList},marina_organization_id.eq.${targetOrgId})`,
      `and(partner_organization_id.eq.${targetOrgId},marina_organization_id.in.${inList})`,
    ] : []),
    `and(partner_organization_id.eq.${targetOrgId},marina_user_id.eq.${uid})`,
  ];
  const { data, error } = await supabase
    .from('partner_requests')
    .select('id, status, partner_user_id, partner_organization_id, created_at')
    .or(parts.join(','))
    .in('status', ['pending', 'accepted'])
    .order('created_at', { ascending: false })
    .limit(10);
  if (error || !data || data.length === 0) return null;
  const rows = data as { id: string; status: 'pending' | 'accepted'; partner_user_id: string; partner_organization_id: string | null }[];
  const best = rows.find((r) => r.status === 'accepted') ?? rows[0];
  const sentByMe = best.partner_user_id === uid || (!!best.partner_organization_id && ids.includes(best.partner_organization_id));
  return { id: best.id, status: best.status, direction: sentByMe ? 'sent' : 'received' };
}

export type ExistingContact =
  /** Already connected: the text was added to that conversation. */
  | { kind: 'posted'; id: string }
  /** A first message is already waiting between the two companies (sent: ours; received: theirs). */
  | { kind: 'waiting'; direction: 'sent' | 'received' }
  /** Already connected, but the message could not be added. */
  | { kind: 'failed'; message: string }
  /** Not in touch yet: send a first message (a new request) as usual. */
  | { kind: 'none' };

/**
 * Two companies share ONE conversation (Victor, 9 Oct 2026). Before another page
 * writes a new first message to a company (an RFP's "Express interest", Deal flow),
 * this checks where my company already stands with it: connected, the text goes into
 * that conversation instead of opening a second one; a first message already waiting
 * either way, nothing new is sent. `text` is what would have been sent.
 */
export async function routeToExistingConversation(args: {
  uid: string;
  activeOrgId: string | null;
  targetOrgId: string | null;
  text: string;
}): Promise<ExistingContact> {
  const text = args.text.trim();
  if (!args.targetOrgId || !text) return { kind: 'none' };
  const myOrgIds = [...new Set([...(await myOrganizationIds(args.uid)), ...(args.activeOrgId ? [args.activeOrgId] : [])])];
  if (myOrgIds.includes(args.targetOrgId)) return { kind: 'none' };
  const conn = await findCompanyConnection(args.uid, myOrgIds, args.targetOrgId);
  if (!conn) return { kind: 'none' };
  if (conn.status === 'pending') return { kind: 'waiting', direction: conn.direction };
  const { error } = await supabase.from('conversation_messages').insert({ partner_request_id: conn.id, body: text.slice(0, THREAD_MESSAGE_MAX) });
  if (!error) return { kind: 'posted', id: conn.id };
  // Before the messaging migration there is no conversation to add to: the old way.
  if (error.code === '42P01' || error.code === 'PGRST205') return { kind: 'none' };
  return {
    kind: 'failed',
    message: error.hint === 'rate_limited'
      ? i18n.t('messages.err.tooManyPerHour', 'You have sent many messages in the last hour. Please wait a little before sending more.')
      : i18n.t('messages.err.notSent', 'Your message could not be sent. Please check your connection and try again.'),
  };
}

export type FirstMessageResult =
  | { ok: true; id: string; connected: boolean }
  | { ok: false; reason: 'already' | 'rate_limited' | 'length' | 'not_validated' | 'own' | 'no_team' | 'error'; message: string };

/**
 * Sends a first message to a company. `targetUserId` is a person of that company
 * (its owner when it has one): the database files the message under the company
 * (marina_organization_id) and every member of it sees it.
 */
export async function sendFirstMessage(args: {
  uid: string;
  myOrgId: string | null;
  targetOrgId: string;
  targetUserId: string;
  message: string;
}): Promise<FirstMessageResult> {
  const message = args.message.trim();
  const lengthMessage = i18n.t('messages.err.firstLength', 'Write a message of 1 to {{max}} characters.', { max: MAX_FIRST_MESSAGE });
  if (!message || message.length > MAX_FIRST_MESSAGE) {
    return { ok: false, reason: 'length', message: lengthMessage };
  }
  const row = {
    partner_user_id: args.uid,
    marina_user_id: args.targetUserId,
    partner_organization_id: args.myOrgId,
    marina_organization_id: args.targetOrgId,
    message,
    sector_id: null,
    status: 'pending',
  };
  let res = await supabase.from('partner_requests').insert({ ...row, origin: 'message' }).select('id, status, auto_connected').single();
  // Before the messaging migration the column does not exist: send it the old way.
  if (res.error && (res.error.code === 'PGRST204' || res.error.code === '42703')) {
    res = await supabase.from('partner_requests').insert(row).select('id, status').single();
  }
  const { data, error } = res as { data: { id: string; status: string; auto_connected?: boolean } | null; error: { code?: string; hint?: string; message: string } | null };
  if (!error && data) return { ok: true, id: data.id, connected: data.status === 'accepted' };

  const hint = error?.hint || '';
  const t = (key: string, fallback: string) => i18n.t(key, fallback);
  if (hint === 'already_connected') return { ok: false, reason: 'already', message: t('messages.err.already', 'Your companies are already in touch. Open the conversation in Messages.') };
  if (hint === 'rate_limited') return { ok: false, reason: 'rate_limited', message: t('messages.err.tooManyPerDay', 'You have reached the limit of 20 new messages to companies in 24 hours. Please try again tomorrow.') };
  if (hint === 'message_length') return { ok: false, reason: 'length', message: lengthMessage };
  if (hint === 'company_not_validated') return { ok: false, reason: 'not_validated', message: t('messages.err.notValidated', 'You can send messages once the M3 team has validated your company.') };
  if (hint === 'own_company') return { ok: false, reason: 'own', message: t('messages.err.own', 'This is your own company.') };
  if (hint === 'no_team') return { ok: false, reason: 'no_team', message: t('messages.err.noTeam', 'This company has nobody on the platform to receive your message yet.') };
  if (hint === 'target_suspended') return { ok: false, reason: 'no_team', message: t('messages.err.suspended', 'This company cannot receive messages at the moment.') };
  return { ok: false, reason: 'error', message: t('messages.err.notSent', 'Your message could not be sent. Please check your connection and try again.') };
}

/* ------------------------------------------------------------------ dates */

/** "14:05" today, "Yesterday", "Mon" this week, else "3 Oct" (and the year when it is not this year). */
export function shortWhen(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (days <= 0) return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (days === 1) return i18n.t('messages.yesterday', 'Yesterday');
  if (days < 7) return d.toLocaleDateString('en-GB', { weekday: 'short' });
  return d.toLocaleDateString('en-GB', d.getFullYear() === now.getFullYear()
    ? { day: 'numeric', month: 'short' }
    : { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "Today", "Yesterday", or "3 October 2026": the day headings of a conversation. */
export function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (days === 0) return i18n.t('messages.today', 'Today');
  if (days === 1) return i18n.t('messages.yesterday', 'Yesterday');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** "14:05". */
export function timeOf(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}
