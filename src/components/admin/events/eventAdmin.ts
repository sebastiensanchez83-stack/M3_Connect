import { supabase } from '@/lib/supabase';

/**
 * The event editor's data layer (registration core, Phase 1 ADMIN lane).
 *
 * Contract: docs/registration-contract.md of the DB lane.
 *   - Reads: events, gl_event, gl_question, gl_guest directly (staff RLS).
 *   - Writes: ONE call, admin_save_event(p) (events + gl_event + gl_question in one
 *     transaction; a key left out keeps its stored value), admin_clone_event(src, overrides).
 *   - Staff decisions go through the `registration` edge function (gl_decide_v2 is
 *     service-role only); "attended" through gl_checkin_v2 (staff RPC).
 * Nothing here writes a gl_guest row directly, and nothing reads or shows a token.
 */

/* ------------------------------------------------------------------ types */

export type EventKind = 'webinar' | 'onsite';
export type RegistrationMode = 'instant' | 'review' | 'invitation';
export type FieldRule = 'required' | 'optional' | 'hidden';
export type StandardField = 'company' | 'job_title' | 'phone' | 'country';
export const STANDARD_FIELDS: StandardField[] = ['company', 'job_title', 'phone', 'country'];

export interface CatalogueRow {
  id: string;
  title: string;
  description: string | null;
  date_time: string | null;
  end_date_time: string | null;
  is_full_day: boolean | null;
  location: string | null;
  language: string | null;
  speakers: { name?: string; title?: string }[] | null;
  event_website_url: string | null;
  image_url: string | null;
  replay_url: string | null;
  published: boolean | null;
}

export interface GlEventRow {
  id: string;
  slug: string;
  title: string;
  legacy_event_id: string | null;
  capacity: number | null;
  notify_email: string | null;
  settings: Record<string, unknown> | null;
  engine?: 'guest_list_v1' | 'core_v2';
  kind?: EventKind;
  registration_mode?: RegistrationMode;
  public_requests?: boolean;
  access?: 'public' | 'members';
  opens_at?: string | null;
  closes_at?: string | null;
  edit_locks_at?: string | null;
  waitlist?: boolean;
  plus_ones?: number;
  standard_fields?: Partial<Record<StandardField, FieldRule>> | null;
  meeting_url?: string | null;
  replay_url?: string | null;
  reminders?: string[] | null;
  staff_alert_mode?: 'each' | 'digest';
  hidden?: boolean;
}

export type QuestionKind =
  | 'text' | 'textarea' | 'select' | 'multiselect' | 'checkbox' | 'url' | 'phone'
  | 'country' | 'sectors' | 'parts' | 'consent';

export type ProfileField = 'job_title' | 'country' | 'phone' | 'linkedin_url';

export interface QuestionOption { value: string; label: string }

export interface QuestionRow {
  key: string;
  label: string;
  help: string | null;
  kind: QuestionKind;
  options: QuestionOption[] | null;
  max_length: number | null;
  required: boolean;
  ticket_keys: string[] | null;
  profile_field: ProfileField | null;
  editable_after_submit: boolean;
  display_order: number;
}

export type GuestStatus =
  | 'requested' | 'needs_info' | 'waitlisted' | 'invited' | 'approved'
  | 'confirmed' | 'declined' | 'rejected' | 'cancelled';

/** A registration as the staff list reads it. Never the personal or door token. */
export interface GuestRow {
  id: string;
  status: GuestStatus;
  source: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  company: string | null;
  job_title: string | null;
  country: string | null;
  ticket_key: string | null;
  answers: Record<string, unknown> | null;
  consents: Record<string, unknown> | null;
  source_detail: Record<string, unknown> | null;
  user_id: string | null;
  info_request: string | null;
  info_requested_at: string | null;
  link_opened_at: string | null;
  checked_in_at: string | null;
  created_at: string;
  decided_at: string | null;
  account_action: string | null;
  payment_status: string | null;
}

export const GUEST_COLUMNS =
  'id, status, source, first_name, last_name, email, phone, company, job_title, country, ticket_key, answers, consents, '
  + 'source_detail, user_id, info_request, info_requested_at, link_opened_at, checked_in_at, created_at, decided_at, '
  + 'account_action, payment_status';

/* ------------------------------------------------------------------ errors */

/** A database or function failure, with the code the editor turns into words. */
export class EditorError extends Error {
  code: string;
  detail?: string;
  extra?: Record<string, unknown>;
  constructor(code: string, message: string, detail?: string, extra?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.detail = detail;
    this.extra = extra;
  }
}

/** admin_save_event / admin_clone_event codes (contract §4.1) in plain English. */
const SAVE_ERRORS: Record<string, string> = {
  forbidden: 'You need an M3 admin account to change events.',
  bad_input: 'Something in the form could not be read. Check the fields and try again.',
  event_not_found: 'This event no longer exists. Go back to the list and open it again.',
  guest_list_event: 'This event runs on the guest list. Change it from its guest-list page.',
  title_required: 'Give the event a title.',
  slug_required: 'Give the event a web address.',
  slug_invalid: 'The web address can only use lower-case letters, numbers and single dashes (60 characters at most).',
  slug_reserved: 'This web address is reserved for another page. Choose another one.',
  slug_taken: 'Another event already uses this web address. Choose another one.',
  slug_locked: 'The web address cannot change once the event is published.',
  bad_kind: 'Choose webinar or on-site event.',
  bad_mode: 'Choose how people register.',
  instant_needs_webinar: 'Open registration works for webinars only. On-site events are checked by M3.',
  bad_access: 'Choose who can register.',
  bad_capacity: 'The number of places must be a whole number.',
  bad_standard_fields: 'One of the form fields has a setting the system does not accept.',
  bad_reminders: 'One of the reminder times is not valid.',
  publish_needs_flag: 'Publishing opens once the new event pages are live. Keep the event as a draft, or as a hidden test, until then.',
  bad_tickets: 'The participation types could not be read.',
  bad_ticket_key: 'A participation type has an internal name the system does not accept.',
  duplicate_ticket_key: 'Two participation types have the same internal name.',
  bad_questions: 'The questions could not be read.',
  bad_question_key: 'A question has an internal name the system does not accept.',
  duplicate_question_key: 'Two questions have the same internal name. Rename one of them.',
  not_installed: 'The new registration system is not installed on the database yet. Ask the developer to finish the set-up.',
  network: 'The connection failed. Check your internet connection and try again.',
};

export function editorErrorText(err: unknown): string {
  if (err instanceof EditorError) {
    return SAVE_ERRORS[err.code] ?? (err.message || 'Something went wrong. Try again in a moment.');
  }
  if (err instanceof Error && err.message) return err.message;
  return 'Something went wrong. Try again in a moment.';
}

type PgError = { code?: string; message?: string; details?: string; hint?: string } | null;

function fromPg(error: PgError): EditorError {
  const code = error?.code ?? '';
  const msg = error?.message ?? '';
  // The RPC does not exist yet (migration not applied) or its signature is unknown.
  if (code === 'PGRST202' || code === '42883' || code === 'PGRST205' || code === '42P01') {
    return new EditorError('not_installed', msg);
  }
  if (code === '42501') return new EditorError('forbidden', msg);
  if (code === '23514') {
    return new EditorError('check', 'A question or a setting has a value the system does not accept. Check the question types.', error?.details);
  }
  if (code === '22023' && msg) return new EditorError(msg, msg, error?.details);
  if (!code && /fetch|network/i.test(msg)) return new EditorError('network', msg);
  return new EditorError(msg || 'unknown', msg, error?.details);
}

/* ------------------------------------------------------------------ reads */

export interface LoadedEvent {
  catalogue: CatalogueRow | null;
  gl: GlEventRow;
  questions: QuestionRow[];
  sectorIds: string[];
}

/**
 * The gl_event behind a catalogue id. Falls back to a gl_event id (the hidden canaries
 * have no catalogue row). Null when the event has no core registration, or before the
 * registration migration is applied (the query then fails on the missing columns).
 */
export async function findGlEvent(id: string): Promise<GlEventRow | null> {
  const byCatalogue = await supabase.from('gl_event').select('*').eq('legacy_event_id', id).maybeSingle();
  if (byCatalogue.error) return null;
  if (byCatalogue.data) return byCatalogue.data as GlEventRow;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const byId = await supabase.from('gl_event').select('*').eq('id', id).maybeSingle();
  if (byId.error || !byId.data) return null;
  return byId.data as GlEventRow;
}

export async function loadEvent(gl: GlEventRow): Promise<LoadedEvent> {
  const [cat, qs, secs] = await Promise.all([
    gl.legacy_event_id
      ? supabase.from('events').select('*').eq('id', gl.legacy_event_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase.from('gl_question').select('*').eq('event_id', gl.id).order('display_order').order('key'),
    gl.legacy_event_id
      ? supabase.from('event_sectors').select('sector_id').eq('event_id', gl.legacy_event_id)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (qs.error) throw fromPg(qs.error);
  return {
    catalogue: (cat.data as CatalogueRow | null) ?? null,
    gl,
    questions: ((qs.data || []) as QuestionRow[]).map(normaliseQuestion),
    sectorIds: ((secs.data || []) as { sector_id: string }[]).map((r) => r.sector_id),
  };
}

function normaliseQuestion(q: QuestionRow): QuestionRow {
  const options = Array.isArray(q.options)
    ? (q.options as unknown[]).map((o) => (typeof o === 'string' ? { value: o, label: o } : (o as QuestionOption)))
    : null;
  return { ...q, options };
}

export async function loadGuests(glEventId: string): Promise<GuestRow[]> {
  const { data, error } = await supabase
    .from('gl_guest')
    .select(GUEST_COLUMNS)
    .eq('event_id', glEventId)
    .order('created_at', { ascending: false });
  if (error) throw fromPg(error);
  return (data || []) as unknown as GuestRow[];
}

/* ------------------------------------------------------------------ writes */

export interface SaveResult { gl_event_id: string; event_id: string; slug: string }

export async function saveEvent(p: Record<string, unknown>): Promise<SaveResult> {
  const { data, error } = await supabase.rpc('admin_save_event', { p });
  if (error) throw fromPg(error);
  return data as SaveResult;
}

export async function cloneEvent(src: string, overrides: Record<string, unknown>): Promise<SaveResult> {
  const { data, error } = await supabase.rpc('admin_clone_event', { p_src: src, p_overrides: overrides });
  if (error) throw fromPg(error);
  return data as SaveResult;
}

/** Sectors stay in event_sectors (staff RLS), as in the old editor: replaced as a whole. */
export async function saveSectors(eventId: string, sectorIds: string[]): Promise<void> {
  const del = await supabase.from('event_sectors').delete().eq('event_id', eventId);
  if (del.error) throw fromPg(del.error);
  if (sectorIds.length) {
    const ins = await supabase.from('event_sectors').insert(sectorIds.map((sector_id) => ({ event_id: eventId, sector_id })));
    if (ins.error) throw fromPg(ins.error);
  }
}

/** Marks one confirmed registration as attended (or undoes it). */
export async function setAttended(glEventId: string, guestId: string, undo = false): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase.rpc('gl_checkin_v2', {
    p_event_id: glEventId, p_token: null, p_guest_id: guestId, p_undo: undo,
  });
  if (error) throw fromPg(error);
  return (data || { ok: false }) as { ok: boolean; error?: string };
}

/**
 * Staff actions of the `registration` edge function. Returns its JSON body whether it
 * answered 2xx or not, so callers switch on `{ error }` codes (same as lib/guestList.ts).
 */
export async function registrationStaff<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<T & { error?: string }> {
  const { data, error } = await supabase.functions.invoke('registration', { body });
  if (!error) return (data ?? {}) as T & { error?: string };
  try {
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      const answer = (await ctx.json()) as Record<string, unknown> | null;
      // A non-2xx answer always counts as an error, even without our own { error } code
      // (the gateway's 404 when the function is not deployed yet says { code, message }).
      const code = typeof answer?.error === 'string' ? answer.error : typeof answer?.code === 'string' ? answer.code : 'unavailable';
      return { ...(answer || {}), error: code } as T & { error?: string };
    }
  } catch { /* fall through */ }
  return { error: (error as { message?: string }).message || 'network' } as T & { error?: string };
}

/** registration function codes a staff screen can meet, in plain English. */
export function staffErrorText(code: string | undefined): string {
  switch (code) {
    case 'forbidden':
    case 'session_expired':
      return 'Your session has ended or your account cannot do this. Sign in again as M3 staff.';
    case 'not_found':
      return 'This event or registration no longer exists. Reload the page.';
    case 'wrong_engine':
      return 'This event runs on the guest list. Use its guest-list page.';
    case 'info_request_required':
      return 'Write what you need to know before sending.';
    case 'bad_decision':
    case 'bad_input':
      return 'The request could not be read. Reload the page and try again.';
    case 'rate_limited':
    case 'busy':
      return 'Too many actions at once. Wait a minute and try again.';
    case 'NOT_FOUND':
    case 'unavailable':
      return 'The registration service is not installed yet. Ask the developer to deploy it.';
    case 'network':
    case 'Failed to send a request to the Edge Function':
      return 'The registration service could not be reached. Check your connection; if it keeps failing, it is not installed yet.';
    default:
      return 'Something went wrong. Try again in a moment.';
  }
}

/* ------------------------------------------------------------------ words */

/** Status words for M3 staff (the registrant sees the contract's own words). */
export const STATUS_WORDS: Record<GuestStatus, string> = {
  requested: 'To review',
  needs_info: 'Detail asked',
  waitlisted: 'Waiting list',
  invited: 'Invited',
  approved: 'Approved, payment due',
  confirmed: 'Confirmed',
  declined: 'Declined',
  rejected: 'Not accepted',
  cancelled: 'Cancelled',
};

export const STATUS_TONE: Record<GuestStatus, 'success' | 'warning' | 'danger' | 'neutral' | 'info'> = {
  requested: 'warning',
  needs_info: 'warning',
  waitlisted: 'info',
  invited: 'info',
  approved: 'info',
  confirmed: 'success',
  declined: 'neutral',
  rejected: 'danger',
  cancelled: 'neutral',
};

export const QUESTION_KIND_WORDS: Record<QuestionKind, string> = {
  text: 'Short answer',
  textarea: 'Long answer',
  select: 'One choice from a list',
  multiselect: 'Several choices from a list',
  checkbox: 'Yes / no tick box',
  url: 'Web link',
  phone: 'Phone number',
  country: 'Country',
  sectors: 'Sectors of interest',
  parts: 'Parts of the event',
  consent: 'Agreement to a statement',
};

export const PROFILE_FIELD_WORDS: Record<ProfileField, string> = {
  job_title: 'Job title',
  country: 'Country',
  phone: 'Phone',
  linkedin_url: 'LinkedIn profile',
};

/* ------------------------------------------------------------------ helpers */

export const RESERVED_SLUGS = ['sm26', 'wys26', 'admin', 'register', 'registration', 'signup', 'events', 'join', 'welcome'];
export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** "Data standards: Part 2!" -> "data-standards-part-2" (60 characters at most). */
export function slugify(text: string, max = 60): string {
  const s = text
    .normalize('NFD').replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s.slice(0, max).replace(/-+$/g, '');
}

/** An internal key for a question: letters, digits and underscores, unique in the list. */
export function questionKey(label: string, taken: string[]): string {
  const base = slugify(label, 32).replace(/-/g, '_') || 'question';
  let key = base;
  let n = 2;
  while (taken.includes(key)) key = `${base}_${n++}`;
  return key;
}

export function isEmail(v: string): boolean {
  return /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(v.trim());
}

/** A list of addresses typed with commas, semicolons or spaces. */
export function emailList(v: string): string[] {
  return v.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
}

export function isHttpsUrl(v: string): boolean {
  return /^https:\/\/[^\s]+\.[^\s]+/i.test(v.trim());
}

/* ------------------------------------------------------------- time zones */

export const DEFAULT_TIMEZONE = 'Europe/Monaco';

export const TIMEZONES: { value: string; label: string }[] = [
  { value: 'Europe/Monaco', label: 'Monaco, Paris, Rome' },
  { value: 'Europe/London', label: 'London' },
  { value: 'Europe/Lisbon', label: 'Lisbon' },
  { value: 'Europe/Athens', label: 'Athens' },
  { value: 'Asia/Dubai', label: 'Dubai' },
  { value: 'Asia/Singapore', label: 'Singapore' },
  { value: 'Australia/Sydney', label: 'Sydney' },
  { value: 'America/New_York', label: 'New York, Miami' },
  { value: 'America/Los_Angeles', label: 'Los Angeles' },
  { value: 'UTC', label: 'UTC' },
];

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The zone's offset from UTC at a given instant, in milliseconds. */
function offsetMs(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - (at.getTime() - at.getMilliseconds());
}

/** "2026-10-23T15:00" read in `tz` -> ISO instant. Empty -> null. */
export function wallToIso(local: string, tz: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(local.trim());
  if (!m) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0);
  const zone = isValidTimeZone(tz) ? tz : DEFAULT_TIMEZONE;
  let ts = guess - offsetMs(new Date(guess), zone);
  const second = guess - offsetMs(new Date(ts), zone);
  if (second !== ts) ts = second;
  return new Date(ts).toISOString();
}

/** ISO instant -> "2026-10-23T15:00" as a clock in `tz` shows it. */
export function isoToWall(iso: string | null | undefined, tz: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const zone = isValidTimeZone(tz) ? tz : DEFAULT_TIMEZONE;
  return new Date(d.getTime() + offsetMs(d, zone)).toISOString().slice(0, 16);
}

/** "Thursday 23 October 2026, 15:00 (CEST)" in the event's zone. */
export function formatInZone(iso: string | null | undefined, tz: string, withTime = true): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const zone = isValidTimeZone(tz) ? tz : DEFAULT_TIMEZONE;
  const date = new Intl.DateTimeFormat('en-GB', { timeZone: zone, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(d);
  if (!withTime) return date;
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short' }).format(d);
  return `${date}, ${time}`;
}

/** Adds minutes to a wall-clock "YYYY-MM-DDTHH:mm" (no zone involved). */
export function addMinutesToWall(local: string, minutes: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return '';
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) + minutes * 60000);
  return d.toISOString().slice(0, 16);
}

/* ------------------------------------------------------------------ CSV */

export function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  // A cell starting with = + - @ would run as a formula in Excel.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n\r;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function downloadCsv(filename: string, rows: unknown[][]): void {
  const text = String.fromCharCode(0xfeff) + rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Where a registration came from (gl_guest.source_detail), in words. */
const ENTRY_WORDS: Record<string, string> = {
  signup: 'Sign-up page',
  event_page: 'Event page',
  deep_link: 'Direct link',
  campaign: 'E-mail campaign',
};
export function sourceText(d: Record<string, unknown> | null | undefined): string {
  if (!d) return '';
  const entry = typeof d.entry === 'string' ? ENTRY_WORDS[d.entry] ?? d.entry : '';
  return [entry, d.utm_source, d.utm_campaign].filter((x) => typeof x === 'string' && x).join(' / ');
}
