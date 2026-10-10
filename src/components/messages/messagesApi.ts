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
 * first message is NOT sent: the sender is told Messages are not open yet (sending
 * it the old way would file a request nobody is told about).
 *
 * Messaging v2 (Victor, 10 Oct 2026; supabase/migrations/20261010173000_messaging_v2.sql):
 * photos and PDFs in the private bucket message-attachments, "Seen"
 * (msg_thread_seen) and live updates (messageEvents.ts). Before that migration a
 * message without files is sent exactly as before, "Seen" is not shown, and a file
 * is refused with a plain sentence.
 */

const MAX_FIRST_MESSAGE = 500;
export const FIRST_MESSAGE_MAX = MAX_FIRST_MESSAGE;
export const THREAD_MESSAGE_MAX = 4000;

/* ------------------------------------------------------------------ files */

export const ATTACHMENT_BUCKET = 'message-attachments';
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const ATTACHMENT_MAX_FILES = 5;
const ATTACHMENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
/** For <input type="file" accept>: the extensions too (some phones only know those). */
export const ATTACHMENT_ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp';

/** A file of a message, as the database keeps it (its size and type come from storage). */
export interface Attachment {
  path: string;
  name: string;
  size: number;
  mime: string;
  /** Only on the screen, while it is being sent: a local preview of a photo. */
  localUrl?: string;
}

export function isImageAttachment(a: { mime: string }): boolean {
  return a.mime.startsWith('image/');
}

/** "820 KB", "2.4 MB". */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  const mb = n / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/** The type the browser reports, or the one the file's name says (some browsers send none). */
export function attachmentType(file: File): string {
  const t = (file.type || '').toLowerCase();
  if (t === 'image/jpg' || t === 'image/pjpeg') return 'image/jpeg';
  if (t) return t;
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  return ({ pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' } as Record<string, string>)[ext] ?? '';
}

/** "PDF, JPG, PNG or WebP, up to 10 MB." */
export function attachmentRule(): string {
  return i18n.t('messages.files.rule', 'PDF, JPG, PNG or WebP, up to 10 MB.');
}

function tooBigText(file: File): string {
  return i18n.t('messages.files.tooBig', { name: file.name, size: formatBytes(file.size), rule: attachmentRule(), defaultValue: '"{{name}}" is too big ({{size}}). {{rule}}' });
}

function wrongTypeText(file: File): string {
  return i18n.t('messages.files.wrongType', { name: file.name, rule: attachmentRule(), defaultValue: '"{{name}}" cannot be sent. {{rule}}' });
}

/** Why this file cannot be sent, in plain words, or null when it can. */
export function checkAttachment(file: File): string | null {
  if (!ATTACHMENT_TYPES.includes(attachmentType(file))) return wrongTypeText(file);
  if (file.size > ATTACHMENT_MAX_BYTES) return tooBigText(file);
  if (file.size === 0) return i18n.t('messages.files.empty', { name: file.name, defaultValue: '"{{name}}" is empty.' });
  return null;
}

/**
 * The same, for several files chosen at once: one short sentence per file refused,
 * then the rule ONCE ("PDF, JPG, PNG or WebP, up to 10 MB."). Null when all can go.
 */
export function checkAttachments(files: File[]): string | null {
  const lines: string[] = [];
  let rule = false;
  for (const file of files) {
    if (!ATTACHMENT_TYPES.includes(attachmentType(file))) {
      lines.push(i18n.t('messages.files.wrongTypeShort', { name: file.name, defaultValue: '"{{name}}" cannot be sent.' }));
      rule = true;
    } else if (file.size > ATTACHMENT_MAX_BYTES) {
      lines.push(i18n.t('messages.files.tooBigShort', { name: file.name, size: formatBytes(file.size), defaultValue: '"{{name}}" is too big ({{size}}).' }));
      rule = true;
    } else if (file.size === 0) {
      lines.push(i18n.t('messages.files.empty', { name: file.name, defaultValue: '"{{name}}" is empty.' }));
    }
  }
  if (lines.length === 0) return null;
  return [...lines, ...(rule ? [attachmentRule()] : [])].join(' ');
}

/**
 * The name a file is stored under: letters, digits, dot, dash and underscore, at most
 * 120 characters, the extension kept (the database accepts nothing else). People
 * still see the original name.
 */
export function safeFileName(name: string): string {
  const plain = name.normalize('NFKD').replace(/[̀-ͯ]/g, '');
  const dot = plain.lastIndexOf('.');
  const ext = dot > 0 ? plain.slice(dot + 1).replace(/[^A-Za-z0-9]/g, '').slice(0, 8).toLowerCase() : '';
  const base = (dot > 0 ? plain.slice(0, dot) : plain)
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[^A-Za-z0-9]+/, '')
    .replace(/[-._]+$/, '')
    .slice(0, 100) || 'file';
  return ext ? `${base}.${ext}` : base;
}

function newUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function parseAttachments(raw: unknown): Attachment[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object' && typeof (a as Record<string, unknown>).path === 'string')
    .map((a) => ({
      path: String(a.path),
      name: typeof a.name === 'string' && a.name ? a.name : String(a.path).split('/').pop() || 'file',
      size: Number(a.size) || 0,
      mime: typeof a.mime === 'string' ? a.mime : '',
    }));
}

/* Signed links: the bucket is private. The photos shown in a conversation get a link
   for 15 minutes (kept here, asked again shortly before it expires); a download gets
   its own link for 60 seconds. */
const VIEW_SECONDS = 15 * 60;
const viewUrls = new Map<string, { url: string; until: number }>();

function cachedView(path: string): string | null {
  const hit = viewUrls.get(path);
  return hit && hit.until > Date.now() + 60_000 ? hit.url : null;
}

/** Links to show these photos, by path (only the ones that could be signed). */
export async function signAttachmentViews(paths: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const missing: string[] = [];
  for (const p of new Set(paths)) {
    const hit = cachedView(p);
    if (hit) out[p] = hit;
    else missing.push(p);
  }
  if (missing.length) {
    const { data } = await supabase.storage.from(ATTACHMENT_BUCKET).createSignedUrls(missing, VIEW_SECONDS);
    for (const row of data ?? []) {
      if (row.path && row.signedUrl && !row.error) {
        viewUrls.set(row.path, { url: row.signedUrl, until: Date.now() + VIEW_SECONDS * 1000 });
        out[row.path] = row.signedUrl;
      }
    }
  }
  return out;
}

/** Saves a file of a conversation under its own name (a link valid 60 seconds). False when it failed. */
export async function downloadAttachment(a: Attachment): Promise<boolean> {
  const { data, error } = await supabase.storage.from(ATTACHMENT_BUCKET).createSignedUrl(a.path, 60, { download: a.name || true });
  if (error || !data?.signedUrl) return false;
  // The answer says "attachment": the browser saves the file and the page stays where it is.
  const link = document.createElement('a');
  link.href = data.signedUrl;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  return true;
}

/** Uploads one file into the conversation's folder. Throws a plain sentence when it fails. */
async function uploadAttachment(requestId: string, file: File): Promise<Attachment> {
  const mime = attachmentType(file);
  const path = `${requestId}/${newUuid()}/${safeFileName(file.name)}`;
  // A file goes up as a form, with the type the browser gave it (the contentType
  // option is ignored then): a browser that gave none ("application/octet-stream"
  // for the bucket, refused) or "image/jpg" gets the type of its name instead.
  const body = file.type === mime ? file : new File([file], file.name, { type: mime, lastModified: file.lastModified });
  const { error } = await supabase.storage.from(ATTACHMENT_BUCKET).upload(path, body, { contentType: mime, upsert: false, cacheControl: '3600' });
  if (error) {
    const msg = `${(error as { statusCode?: string | number }).statusCode ?? ''} ${error.message}`.toLowerCase();
    if (/413|too large|maximum allowed size/.test(msg)) throw new Error(tooBigText(file));
    if (/415|mime type|not supported/.test(msg)) throw new Error(wrongTypeText(file));
    if (/bucket not found/.test(msg)) throw new Error(i18n.t('messages.files.notYet', 'Files cannot be sent yet. Please write your message as text.'));
    throw new Error(i18n.t('messages.files.uploadFailed', { name: file.name, defaultValue: '"{{name}}" could not be sent. Please check your connection and try again.' }));
  }
  return { path, name: file.name, size: file.size, mime };
}

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
  /** Files of the last message (0 when none, or before messaging v2). */
  lastAttachmentCount: number;
  lastAttachmentName: string | null;
  lastAttachmentMime: string | null;
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
  last_attachment_count?: number | null;
  last_attachment_name?: string | null;
  last_attachment_mime?: string | null;
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
    lastAttachmentCount: Number(r.last_attachment_count) || 0,
    lastAttachmentName: r.last_attachment_name ?? null,
    lastAttachmentMime: r.last_attachment_mime ?? null,
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
  /** Null when the message was removed. Empty for a file sent without text. */
  body: string | null;
  createdAt: string;
  isFirst: boolean;
  fromMySide: boolean;
  isDeleted: boolean;
  /** Its files (none for a removed message). */
  attachments: Attachment[];
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
  attachments?: unknown;
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
    attachments: r.is_deleted ? [] : parseAttachments(r.attachments),
  }));
}

/** "Seen": when someone of the other company last opened the conversation, and who. */
export interface SeenInfo {
  otherReadAt: string | null;
  otherFirstName: string | null;
  otherName: string | null;
}

/** Null when it cannot be told (before messaging v2, or offline): nothing is shown then. */
export async function loadSeen(requestId: string): Promise<SeenInfo | null> {
  const { data, error } = await supabase.rpc('msg_thread_seen', { p_request: requestId });
  if (error) return null;
  const rows = (data ?? []) as { side: string; is_my_side: boolean; last_read_at: string | null; reader_first_name: string | null; reader_name: string | null }[];
  const other = rows.find((r) => !r.is_my_side) ?? null;
  return {
    otherReadAt: other?.last_read_at ?? null,
    otherFirstName: other?.reader_first_name ?? null,
    otherName: other?.reader_name ?? null,
  };
}

export type SendResult = { ok: true } | { ok: false; rateLimited: boolean; message: string };

/**
 * Posts a message in a conversation (the database sets the author, company and time),
 * with its files when there are some: they are uploaded first, into the
 * conversation's folder, then named in the message (the database checks each one).
 * A message may be a file alone. Without files it is sent exactly as before.
 */
export async function sendThreadMessage(requestId: string, body: string, files: File[] = []): Promise<SendResult> {
  const text = body.trim();
  const notSent = i18n.t('messages.err.notSent', 'Your message could not be sent. Please check your connection and try again.');
  if (!text && files.length === 0) return { ok: false, rateLimited: false, message: i18n.t('messages.err.empty', 'Write a message first.') };
  if (files.length > ATTACHMENT_MAX_FILES) {
    return { ok: false, rateLimited: false, message: i18n.t('messages.files.tooMany', { max: ATTACHMENT_MAX_FILES, defaultValue: 'You can send up to {{max}} files at once.' }) };
  }
  for (const f of files) {
    const problem = checkAttachment(f);
    if (problem) return { ok: false, rateLimited: false, message: problem };
  }
  let attachments: Attachment[] = [];
  try {
    attachments = await Promise.all(files.map((f) => uploadAttachment(requestId, f)));
  } catch (e) {
    return { ok: false, rateLimited: false, message: e instanceof Error ? e.message : notSent };
  }
  const row: Record<string, unknown> = { partner_request_id: requestId, body: text.slice(0, THREAD_MESSAGE_MAX) };
  if (attachments.length) row.attachments = attachments.map(({ path, name, size, mime }) => ({ path, name, size, mime }));
  const { error } = await supabase.from('conversation_messages').insert(row);
  if (!error) return { ok: true };
  const hint = error.hint || '';
  const rateLimited = hint === 'rate_limited';
  let message = notSent;
  if (rateLimited) message = i18n.t('messages.err.tooManyPerHour', 'You have sent many messages in the last hour. Please wait a little before sending more.');
  else if (hint === 'attachment_type' || hint === 'attachment_size') message = i18n.t('messages.files.cannotSend', { rule: attachmentRule(), defaultValue: 'This file cannot be sent. {{rule}}' });
  else if (hint === 'too_many_files') message = i18n.t('messages.files.tooMany', { max: ATTACHMENT_MAX_FILES, defaultValue: 'You can send up to {{max}} files at once.' });
  else if (hint.startsWith('attachment_')) message = i18n.t('messages.files.attachAgain', 'A file could not be sent. Please attach it again.');
  else if (attachments.length && (error.code === 'PGRST204' || error.code === '42703')) message = i18n.t('messages.files.notYet', 'Files cannot be sent yet. Please write your message as text.');
  return { ok: false, rateLimited, message };
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
  /** Already connected: the text was added to that conversation (or was already in it, from my side: `repeated`). */
  | { kind: 'posted'; id: string; repeated?: boolean }
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
  const body = text.slice(0, THREAD_MESSAGE_MAX);
  // The same text already written from my side (the same RFP's "Express interest"
  // pressed again after a reload): not a second time.
  const { data: same } = await supabase
    .from('conversation_messages')
    .select('id')
    .eq('partner_request_id', conn.id)
    .eq('body', body)
    .in('author_org_id', myOrgIds)
    .is('deleted_at', null)
    .limit(1);
  if (same && same.length > 0) return { kind: 'posted', id: conn.id, repeated: true };
  const { error } = await supabase.from('conversation_messages').insert({ partner_request_id: conn.id, body });
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
  | { ok: false; reason: 'already' | 'rate_limited' | 'length' | 'not_validated' | 'own' | 'no_team' | 'unavailable' | 'error'; message: string };

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
  const res = await supabase.from('partner_requests').insert({ ...row, origin: 'message' }).select('id, status, auto_connected').single();
  const { data, error } = res as { data: { id: string; status: string; auto_connected?: boolean } | null; error: { code?: string; hint?: string; message: string } | null };
  if (!error && data) return { ok: true, id: data.id, connected: data.status === 'accepted' };

  const hint = error?.hint || '';
  const t = (key: string, fallback: string) => i18n.t(key, fallback);
  // Before the messaging migration the column does not exist. Nothing is sent the old
  // way: the company would get a request nobody tells them about.
  if (error?.code === 'PGRST204' || error?.code === '42703') {
    return { ok: false, reason: 'unavailable', message: t('messages.err.unavailable', 'Messages are not open yet. Please try again in a few days, or write to events@m3monaco.com.') };
  }
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

/** "Today", "Yesterday", or "Mon 6 Oct" ("Mon 6 Oct 2025" another year): the day separators of a conversation. */
export function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (days === 0) return i18n.t('messages.today', 'Today');
  if (days === 1) return i18n.t('messages.yesterday', 'Yesterday');
  const text = d.toLocaleDateString('en-GB', d.getFullYear() === now.getFullYear()
    ? { weekday: 'short', day: 'numeric', month: 'short' }
    : { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  // en-GB writes "Mon, 6 Oct": without the comma.
  return text.replace(/,/g, '');
}

/** Whether two moments fall on the same calendar day (local time). */
export function sameDay(a: string, b: string): boolean {
  const x = new Date(a);
  const y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}

/** "14:05". */
export function timeOf(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}
