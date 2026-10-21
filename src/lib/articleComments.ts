import type { TFunction } from 'i18next';
import { supabase } from '@/lib/supabase';

/**
 * Comments under articles, with tags of people and companies (Victor, 21 Oct 2026). The
 * database does everything (supabase/migrations/20261021130000_article_comments.sql): who may
 * read and write (validated members only; M3 staff moderate), the tags (checked and renamed by
 * the server), the limits, the dashboard notices and the queued e-mails. This file is the
 * site's one door to it, plus the few pure helpers the pages share.
 *
 * Switch: registration_flags.article_comments (src/lib/flags.ts). Off, the pages show nothing
 * about comments and every function below except the count answers "comments_off".
 *
 * A tag in the stored text: "@[Name](user:<uuid>)" (a person) or "@[Name](org:<uuid>)" (a
 * company). People read "@Name"; the page turns it into a link (company page, or the person's
 * company page) from the tag list the server returns with each comment.
 */

export type MentionKind = 'person' | 'company';

/** A tag as the server returns it with a comment (only people and companies still listed). */
export interface CommentMention {
  kind: MentionKind;
  id: string;
  name: string;
  /** The company's page (a company), or the person's company page (a person; null without one). */
  slug: string | null;
  /** A person's company name. */
  org_name: string | null;
}

export interface ArticleComment {
  id: string;
  body: string;
  created_at: string;
  edited_at: string | null;
  is_mine: boolean;
  /** Hidden by M3: only its author and M3 staff get it. */
  hidden: boolean;
  hidden_reason: string | null;
  /** M3 staff only. */
  author_user_id: string | null;
  author_name: string;
  author_job_title: string | null;
  author_avatar_url: string | null;
  author_org_name: string | null;
  author_org_slug: string | null;
  author_org_logo_url: string | null;
  author_org_type: string | null;
  mentions: CommentMention[];
  /** M3 staff only: open reports. */
  open_reports: number | null;
  reported_by_me: boolean;
  /** My "you were tagged" notice for this comment, not seen yet. */
  my_notice_id: number | null;
}

export interface MentionSuggestion {
  kind: MentionKind;
  id: string;
  label: string;
  detail: string | null;
  image_url: string | null;
  org_slug: string | null;
}

export interface CommentNotice {
  notice_id: number;
  comment_id: string;
  resource_id: string;
  resource_slug: string | null;
  resource_title: string;
  author_name: string;
  author_org_name: string | null;
  /** Told because this company of mine was tagged (null: tagged by name). */
  via_org_name: string | null;
  excerpt: string;
  created_at: string;
}

export interface ReportedComment {
  comment_id: string;
  resource_id: string;
  resource_slug: string | null;
  resource_title: string;
  body: string;
  author_name: string;
  author_org_name: string | null;
  comment_created_at: string;
  hidden: boolean;
  deleted: boolean;
  open_reports: number;
  total_reports: number;
  last_reported_at: string;
  reports: { reporter_name: string; reason: string | null; created_at: string; resolution: string | null; resolved_at: string | null }[];
}

/** The longest comment, in characters as people read them (tags count as "@Name"). */
export const COMMENT_MAX = 2000;
/** The most people and companies one comment may tag. */
export const COMMENT_MAX_TAGS = 5;

/* ------------------------------------------------------------------ tags in the text */

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
// Same pattern as the database (resource_comment_prepare): a label without square brackets
// or control characters, then (user|org):<uuid>.
const TOKEN_SOURCE = `@\\[([^\\][\\x00-\\x1f\\x7f]{1,120})\\]\\((user|org):(${UUID})\\)`;
const tokenRe = () => new RegExp(TOKEN_SOURCE, 'g');

export type BodyPart =
  | { type: 'text'; text: string }
  | { type: 'tag'; kind: MentionKind; id: string; label: string };

/** The stored text cut into plain text and tags, in order. */
export function splitBody(body: string): BodyPart[] {
  const out: BodyPart[] = [];
  const re = tokenRe();
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    if (m.index > last) out.push({ type: 'text', text: body.slice(last, m.index) });
    out.push({ type: 'tag', kind: m[2] === 'org' ? 'company' : 'person', id: m[3].toLowerCase(), label: m[1] });
    last = m.index + m[0].length;
  }
  if (last < body.length) out.push({ type: 'text', text: body.slice(last) });
  return out;
}

/** The text as people read it: every tag becomes "@Name". */
export function plainBody(body: string): string {
  return body.replace(tokenRe(), (_all, label: string) => `@${label}`);
}

/** A tag chosen in the composer. */
export interface PickedTag {
  kind: MentionKind;
  id: string;
  label: string;
}

/** A name as a tag label (the server's rule): one line, no square brackets or parentheses. */
export function tagLabel(name: string): string {
  // eslint-disable-next-line no-control-regex
  return name.replace(/[[\]()\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** "@Name" followed by a letter or a digit is another word: only whole names count. */
const afterName = '(?![\\p{L}\\p{N}])';

/**
 * The composer's text with the chosen tags turned into stored tags: each "@Label" of a tag that
 * is still in the text (longest labels first, so "@Port Azur Marina" wins over "@Port Azur").
 * Tags whose "@Label" was deleted from the text are dropped.
 */
export function toStoredBody(text: string, picked: PickedTag[]): string {
  const byLabel = new Map<string, PickedTag>();
  for (const p of picked) byLabel.set(p.label, p);
  const labels = [...byLabel.keys()].sort((a, b) => b.length - a.length);
  if (!labels.length) return text;
  const re = new RegExp(`@(${labels.map(escapeRe).join('|')})${afterName}`, 'gu');
  return text.replace(re, (_all, label: string) => {
    const p = byLabel.get(label);
    return p ? `@[${p.label}](${p.kind === 'company' ? 'org' : 'user'}:${p.id})` : `@${label}`;
  });
}

/** The tags of `picked` whose "@Label" is still in the text. */
export function tagsInText(text: string, picked: PickedTag[]): PickedTag[] {
  return picked.filter((p) => new RegExp(`@${escapeRe(p.label)}${afterName}`, 'u').test(text));
}

/** A stored comment back into the composer: "@Name" text, and its tags. */
export function toEditable(body: string): { text: string; picked: PickedTag[] } {
  const picked: PickedTag[] = [];
  let text = '';
  for (const part of splitBody(body)) {
    if (part.type === 'text') text += part.text;
    else {
      text += `@${part.label}`;
      if (!picked.some((p) => p.id === part.id && p.kind === part.kind)) picked.push({ kind: part.kind, id: part.id, label: part.label });
    }
  }
  return { text, picked };
}

/**
 * The "@..." being typed just before the cursor, if any: an "@" at the start or after a space or
 * a line break, then up to 40 characters without a line break or a second "@". Null otherwise.
 */
export function activeQuery(text: string, cursor: number): { start: number; query: string } | null {
  const before = text.slice(0, cursor);
  const at = before.lastIndexOf('@');
  if (at < 0) return null;
  if (at > 0 && !/\s/.test(before[at - 1])) return null;
  const query = before.slice(at + 1);
  if (query.length > 40 || /[\n@]/.test(query) || /\s{2,}/.test(query)) return null;
  return { start: at, query };
}

/* ------------------------------------------------------------------ errors in plain words */

const errorCode = (err: unknown): string => {
  const msg = typeof err === 'object' && err && 'message' in err ? String((err as { message: unknown }).message ?? '') : String(err ?? '');
  return msg.trim();
};

/** What went wrong, in plain words, from the database's answer. */
export function commentErrorText(err: unknown, t: TFunction): string {
  switch (errorCode(err)) {
    case 'comments_off':
      return t('comments.err.off', 'Comments are not open yet.');
    case 'comment_not_signed_in':
      return t('comments.err.signIn', 'Please sign in first.');
    case 'comment_not_validated':
      return t('comments.err.notValidated', 'Your account is being reviewed by the M3 team. You can comment once it is validated.');
    case 'comment_article_unavailable':
      return t('comments.err.article', 'This article is not available any more.');
    case 'comment_empty':
      return t('comments.err.empty', 'Please write something first.');
    case 'comment_too_long':
      return t('comments.err.tooLong', { max: COMMENT_MAX, defaultValue: 'Your comment is too long: {{max}} characters at most.' });
    case 'comment_too_many_tags':
      return t('comments.err.tooManyTags', { max: COMMENT_MAX_TAGS, defaultValue: 'You can tag {{max}} people or companies at most in one comment.' });
    case 'comment_rate_limited':
      return t('comments.err.rate', 'You have written many comments in the last hour. Please try again a little later.');
    case 'comment_tag_limit':
      return t('comments.err.tagLimit', 'You have tagged many people today. Please try again tomorrow, or send your comment without tags.');
    case 'comment_not_found':
      return t('comments.err.notFound', 'This comment is not there any more.');
    case 'comment_not_yours':
      return t('comments.err.notYours', 'Only its author can change this comment.');
    case 'comment_hidden':
      return t('comments.err.hidden', 'The M3 team hid this comment: it cannot be changed.');
    case 'comment_report_own':
      return t('comments.err.reportOwn', 'You cannot report your own comment.');
    case 'comment_report_rate_limited':
      return t('comments.err.reportRate', 'You have sent many reports today. Please try again tomorrow, or write to the M3 team.');
    case 'comment_not_staff':
      return t('comments.err.staff', 'Only the M3 team can do this.');
    default:
      return t('comments.err.generic', 'Something went wrong. Please try again.');
  }
}

/* ------------------------------------------------------------------ the database */

type Row = Record<string, unknown>;

const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v));

function toComment(r: Row): ArticleComment {
  return {
    id: String(r.id),
    body: String(r.body ?? ''),
    created_at: String(r.created_at),
    edited_at: (r.edited_at as string | null) ?? null,
    is_mine: r.is_mine === true,
    hidden: r.hidden === true,
    hidden_reason: (r.hidden_reason as string | null) ?? null,
    author_user_id: (r.author_user_id as string | null) ?? null,
    author_name: String(r.author_name ?? ''),
    author_job_title: (r.author_job_title as string | null) ?? null,
    author_avatar_url: (r.author_avatar_url as string | null) ?? null,
    author_org_name: (r.author_org_name as string | null) ?? null,
    author_org_slug: (r.author_org_slug as string | null) ?? null,
    author_org_logo_url: (r.author_org_logo_url as string | null) ?? null,
    author_org_type: (r.author_org_type as string | null) ?? null,
    mentions: Array.isArray(r.mentions) ? (r.mentions as CommentMention[]) : [],
    open_reports: num(r.open_reports),
    reported_by_me: r.reported_by_me === true,
    my_notice_id: num(r.my_notice_id),
  };
}

/** The comments of an article, oldest first (validated members and M3 staff). */
export async function fetchComments(resourceId: string): Promise<ArticleComment[]> {
  const { data, error } = await supabase.rpc('resource_comments_list', { p_resource_id: resourceId });
  if (error) throw error;
  return ((data ?? []) as Row[]).map(toComment);
}

/** The number of visible comments, for everyone; null while comments are off (or on failure). */
export async function fetchCommentCount(resourceId: string): Promise<number | null> {
  const { data, error } = await supabase.rpc('resource_comment_count', { p_resource_id: resourceId });
  if (error || data === null || data === undefined) return null;
  return Number(data);
}

/**
 * Asks send-notification to send the e-mails the database just queued (the people tagged, or
 * the M3 team for a report), at once. Fire-and-forget: what it does not send, registration-cron
 * sends a few minutes later (notification_outbox).
 */
function sendQueued(type: 'comment_mention' | 'comment_report', data: Record<string, string>): void {
  void supabase.functions.invoke('send-notification', { body: { type, data } }).catch(() => undefined);
}

export async function postComment(resourceId: string, body: string): Promise<{ id: string; emails: number }> {
  const { data, error } = await supabase.rpc('resource_comment_post', { p_resource_id: resourceId, p_body: body });
  if (error) throw error;
  const r = (data ?? {}) as Row;
  const out = { id: String(r.id), emails: Number(r.emails ?? 0) };
  if (out.emails > 0) sendQueued('comment_mention', { comment_id: out.id });
  return out;
}

export async function editComment(commentId: string, body: string): Promise<{ emails: number; changed: boolean }> {
  const { data, error } = await supabase.rpc('resource_comment_edit', { p_comment_id: commentId, p_body: body });
  if (error) throw error;
  const r = (data ?? {}) as Row;
  const out = { emails: Number(r.emails ?? 0), changed: r.changed === true };
  if (out.emails > 0) sendQueued('comment_mention', { comment_id: commentId });
  return out;
}

export async function deleteComment(commentId: string): Promise<void> {
  const { error } = await supabase.rpc('resource_comment_delete', { p_comment_id: commentId });
  if (error) throw error;
}

export async function reportComment(commentId: string, reason: string): Promise<{ already: boolean }> {
  const { data, error } = await supabase.rpc('resource_comment_report', { p_comment_id: commentId, p_reason: reason || null });
  if (error) throw error;
  const r = (data ?? {}) as Row;
  if (Number(r.emails ?? 0) > 0 && r.report_id) sendQueued('comment_report', { report_id: String(r.report_id) });
  return { already: r.already === true };
}

/** Tag suggestions for "@" + at least 2 characters. */
export async function searchMentions(query: string): Promise<MentionSuggestion[]> {
  if (query.trim().length < 2) return [];
  const { data, error } = await supabase.rpc('resource_comment_mention_search', { p_query: query });
  if (error) throw error;
  return ((data ?? []) as Row[]).map((r) => ({
    kind: r.kind === 'company' ? 'company' : 'person',
    id: String(r.id),
    label: String(r.label ?? ''),
    detail: (r.detail as string | null) ?? null,
    image_url: (r.image_url as string | null) ?? null,
    org_slug: (r.org_slug as string | null) ?? null,
  }));
}

/** My "you were tagged" notices not seen yet (newest first). */
export async function fetchMyNotices(): Promise<CommentNotice[]> {
  const { data, error } = await supabase.rpc('resource_comment_my_notices');
  if (error) throw error;
  return ((data ?? []) as Row[]).map((r) => ({
    notice_id: Number(r.notice_id),
    comment_id: String(r.comment_id),
    resource_id: String(r.resource_id),
    resource_slug: (r.resource_slug as string | null) ?? null,
    resource_title: String(r.resource_title ?? ''),
    author_name: String(r.author_name ?? ''),
    author_org_name: (r.author_org_name as string | null) ?? null,
    via_org_name: (r.via_org_name as string | null) ?? null,
    excerpt: String(r.excerpt ?? ''),
    created_at: String(r.created_at),
  }));
}

/** Mark notices seen: those named, or all of mine (null). */
export async function markNoticesSeen(ids: number[] | null): Promise<void> {
  const { error } = await supabase.rpc('resource_comment_mark_seen', { p_notice_ids: ids });
  if (error) throw error;
}

/** M3 staff: hide (with a reason its author sees), show again, or keep it and close the reports. */
export async function moderateComment(commentId: string, action: 'hide' | 'unhide' | 'keep', reason?: string): Promise<void> {
  const { error } = await supabase.rpc('admin_resource_comment_moderate', { p_comment_id: commentId, p_action: action, p_reason: reason || null });
  if (error) throw error;
}

/** M3 staff: the reported comments (open reports first). */
export async function fetchReportedComments(openOnly: boolean): Promise<ReportedComment[]> {
  const { data, error } = await supabase.rpc('admin_resource_comment_reports', { p_open_only: openOnly });
  if (error) throw error;
  return ((data ?? []) as Row[]).map((r) => ({
    comment_id: String(r.comment_id),
    resource_id: String(r.resource_id),
    resource_slug: (r.resource_slug as string | null) ?? null,
    resource_title: String(r.resource_title ?? ''),
    body: String(r.body ?? ''),
    author_name: String(r.author_name ?? ''),
    author_org_name: (r.author_org_name as string | null) ?? null,
    comment_created_at: String(r.comment_created_at),
    hidden: r.hidden === true,
    deleted: r.deleted === true,
    open_reports: Number(r.open_reports ?? 0),
    total_reports: Number(r.total_reports ?? 0),
    last_reported_at: String(r.last_reported_at),
    reports: Array.isArray(r.reports) ? (r.reports as ReportedComment['reports']) : [],
  }));
}

/** The anchor of a comment on its article page. */
export const commentAnchor = (id: string) => `comment-${id}`;
