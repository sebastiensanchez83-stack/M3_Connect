import { useEffect, useState } from 'react';
import type { TFunction } from 'i18next';
import { supabase } from '@/lib/supabase';

/**
 * The client of the unified registration (spec §4.1, §6; database contract
 * docs/registration-contract.md of the DB lane).
 *
 * Every public read and write of an event registration goes through ONE edge
 * function, `registration` (verify_jwt false: it reads the session itself when
 * there is one). supabase.functions.invoke sends the member's session token
 * when signed in, the public key otherwise, so the same call serves both.
 * Signed-in reads of the member's own registrations use two RPCs:
 * my_participations() (every engine, SM26 read-only) and get_my_event_access()
 * (join and replay links, confirmed registrants only). Lists of open events
 * use public_registration_events(). The gl_* tables are staff-only: never read
 * them from here.
 *
 * The public answers never say whether an address is already registered: a
 * duplicate gets the same `{ ok: true }` as a new registration (the e-mail
 * differs). Nothing here ever receives a token: status links travel by e-mail.
 */

/* ------------------------------------------------------------------ types */

export type RegEngine = 'guest_list_v1' | 'core_v2';
export type RegKind = 'webinar' | 'onsite';
export type RegMode = 'instant' | 'review' | 'invitation';
export type RegAccess = 'public' | 'members';

/** What a visitor can do on an event now (gl_registration_state, plus not_found). */
export type RegState =
  | 'open' | 'not_published' | 'not_yet_open' | 'closed' | 'full' | 'waitlist'
  | 'members_only' | 'invitation_only' | 'registered' | 'not_found';

/** gl_guest.status (core_v2 has all nine; guest_list_v1 the first, fourth and last four). */
export type RegStatus =
  | 'requested' | 'needs_info' | 'waitlisted' | 'invited' | 'approved'
  | 'confirmed' | 'declined' | 'rejected' | 'cancelled';

/** The one vocabulary of the screens and e-mails (spec §2.3; my_participations.status_display). */
export type StatusDisplay =
  | 'under_review' | 'needs_info' | 'waitlisted' | 'invited' | 'payment_due'
  | 'confirmed' | 'not_accepted' | 'declined' | 'cancelled' | 'event_ended';

export type PaymentDisplay = 'none' | 'due' | 'pending' | 'invoiced' | 'paid' | 'waived' | 'refunded';

export type FieldRule = 'required' | 'optional' | 'hidden';
export type StandardFieldKey = 'company' | 'job_title' | 'phone' | 'country';
export type StandardFields = Partial<Record<StandardFieldKey, FieldRule>>;

export type QuestionKind =
  | 'text' | 'textarea' | 'select' | 'multiselect' | 'checkbox' | 'url' | 'phone'
  | 'country' | 'sectors' | 'parts' | 'consent';

export interface QuestionOption { value: string; label: string }

export interface RegQuestion {
  key: string;
  label: string;
  help?: string | null;
  kind: QuestionKind;
  /** `{value, label}` objects; plain strings are accepted too (normalised by questionOptions). */
  options?: (QuestionOption | string)[] | null;
  max_length?: number | null;
  required?: boolean;
  /** Null or empty: asked for every ticket. */
  ticket_keys?: string[] | null;
  profile_field?: 'job_title' | 'country' | 'phone' | 'linkedin_url' | null;
  editable_after_submit?: boolean;
  display_order?: number;
}

export interface RegTicket {
  key: string;
  label: string;
  description?: string | null;
  price_cents?: number | null;
  currency?: string | null;
  price_note?: string | null;
  invite_only?: boolean;
  capacity?: number | null;
  allowed_company_types?: string[] | null;
  parts?: string[] | null;
  display_order?: number;
  /** When the function says so: no seat left on this ticket. */
  full?: boolean;
}

/** The event as the registration function describes it (catalogue data joined from `events`). */
export interface RegEvent {
  gl_event_id: string;
  /** events.id; null for an event without a catalogue row (the canaries). */
  event_id: string | null;
  slug: string;
  engine: RegEngine;
  kind: RegKind;
  mode: RegMode;
  access: RegAccess;
  public_requests?: boolean;
  waitlist?: boolean;
  title: string;
  description?: string | null;
  starts_at: string | null;
  ends_at: string | null;
  location?: string | null;
  image_url?: string | null;
}

/** What the signed-in caller already knows about this person (spec §4.1 `form`). */
export interface RegPrefill {
  first_name?: string | null;
  last_name?: string | null;
  /** The account's e-mail: the registration is always made with it (locked). */
  email?: string | null;
  company?: string | null;
  job_title?: string | null;
  phone?: string | null;
  country?: string | null;
  organization_id?: string | null;
}

/** The signed-in caller's own registration for this event (never given to anyone else). */
export interface RegMine {
  status: RegStatus;
  ticket_key?: string | null;
  payment_status?: PaymentDisplay | null;
  can_cancel?: boolean;
  info_request?: string | null;
  created_at?: string | null;
}

export interface RegForm {
  ok: true;
  event: RegEvent;
  state: RegState;
  opens_at?: string | null;
  closes_at?: string | null;
  edit_locks_at?: string | null;
  standard_fields?: StandardFields;
  tickets?: RegTicket[];
  questions?: RegQuestion[];
  /** Ask the image-rights consent on the last step. */
  ask_image_consent?: boolean;
  prefill?: RegPrefill | null;
  mine?: RegMine | null;
}

/** A registration seen through its status link (or by its signed-in owner). */
export interface RegStatusView {
  ok: true;
  event: RegEvent;
  registration: {
    status: RegStatus;
    status_display?: StatusDisplay;
    payment_display?: PaymentDisplay;
    first_name?: string | null;
    last_name?: string | null;
    email_masked?: string | null;
    company?: string | null;
    job_title?: string | null;
    phone?: string | null;
    country?: string | null;
    ticket_key?: string | null;
    ticket_label?: string | null;
    answers?: Record<string, unknown>;
    created_at?: string | null;
    decided_at?: string | null;
    info_request?: string | null;
    info_requested_at?: string | null;
    cancelled_at?: string | null;
    can_cancel?: boolean;
    can_edit?: boolean;
    edit_locks_at?: string | null;
    /** Linked to an account: the link shows the registration, the account manages it. */
    read_only?: boolean;
    meeting_url?: string | null;
    replay_url?: string | null;
    /** On-site, confirmed: the entry pass (the door's check-in address, drawn as a QR). */
    checkin_url?: string | null;
  };
  questions?: RegQuestion[];
  standard_fields?: StandardFields;
}

/** Every refusal of the function, as one shape. */
export interface RegFailure {
  ok: false;
  error?: string;
  state?: RegState;
  /** missing_fields: which identity fields. */
  fields?: string[];
  /** invalid_answers: which question keys. */
  keys?: string[];
}

export type RegResult<T> = T | RegFailure;

/** Where the registration came from (gl_guest.source_detail; other keys are dropped by the database). */
export interface SourceDetail {
  entry?: 'signup' | 'event_page' | 'deep_link' | 'campaign';
  ref?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
}

export interface RegisterInput {
  slug?: string;
  event_id?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  company?: string;
  job_title?: string;
  phone?: string;
  country?: string;
  ticket_key?: string | null;
  answers?: Record<string, unknown>;
  consents?: { terms_at?: string; image?: boolean; marketing_at?: string };
  source_detail?: SourceDetail;
  organization_id?: string | null;
  /** Honeypot: always empty from a person. */
  website?: string;
  /** Cloudflare Turnstile token, when the widget gave one. */
  captcha?: string | null;
}

/** A registration addressed either by its status link or, signed in, by its event. */
export type RegTarget = { token: string } | { event_id: string } | { slug: string };

/* ------------------------------------------------------------------ the call */

function isFailure(x: unknown): x is RegFailure {
  return !!x && typeof x === 'object' && (x as { ok?: unknown }).ok === false;
}

/**
 * Calls the registration function. Always resolves: a refusal (any status
 * code) comes back as its JSON body `{ ok: false, error | state }`, a network
 * failure as `{ ok: false, error: 'network' }`.
 */
export async function callRegistration<T>(body: Record<string, unknown>): Promise<RegResult<T>> {
  try {
    const { data, error } = await supabase.functions.invoke('registration', { body });
    if (!error) {
      if (data && typeof data === 'object') {
        const d = data as Record<string, unknown>;
        if (d.ok === false || typeof d.error === 'string') return { ok: false, ...(d as object) } as RegFailure;
        return { ok: true, ...(d as object) } as T;
      }
      return { ok: false, error: 'bad_response' };
    }
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      try {
        const payload = await ctx.json();
        if (payload && typeof payload === 'object') {
          return {
            ok: false,
            ...(payload as object),
            error: (payload as { error?: string }).error ?? (ctx.status === 429 ? 'rate_limited' : undefined),
          } as RegFailure;
        }
      } catch { /* not JSON */ }
      if (ctx.status === 429) return { ok: false, error: 'rate_limited' };
      if (ctx.status === 404) return { ok: false, error: 'not_found' };
    }
    return { ok: false, error: 'network' };
  } catch {
    return { ok: false, error: 'network' };
  }
}

export const regFailed = isFailure;

export function getRegistrationForm(target: { slug: string } | { event_id: string }): Promise<RegResult<RegForm>> {
  return callRegistration<RegForm>({ action: 'form', ...target });
}

/** Public: `{ ok: true }` whether the address was new or already registered. Signed in, `status` may come too. */
export function registerForEvent(input: RegisterInput): Promise<RegResult<{ ok: true; status?: RegStatus }>> {
  return callRegistration<{ ok: true; status?: RegStatus }>({ action: 'register', ...input });
}

export function getRegistrationStatus(target: RegTarget): Promise<RegResult<RegStatusView>> {
  return callRegistration<RegStatusView>({ action: 'status', ...target });
}

export function updateRegistration(
  target: RegTarget,
  changes: { fields?: Partial<Record<StandardFieldKey, string>>; answers?: Record<string, unknown>; info_reply?: string },
): Promise<RegResult<{ ok: true }>> {
  return callRegistration<{ ok: true }>({ action: 'update', ...target, ...changes });
}

export function cancelRegistration(target: RegTarget): Promise<RegResult<{ ok: true }>> {
  return callRegistration<{ ok: true }>({ action: 'cancel', ...target });
}

/** An invitation (core_v2): accept or decline, only ever on a click. */
export function respondToInvitation(target: RegTarget, answer: 'accept' | 'decline'): Promise<RegResult<{ ok: true }>> {
  return callRegistration<{ ok: true }>({ action: 'respond', ...target, answer });
}

/** Always `{ ok: true }`: e-mails fresh status links for the upcoming registrations of that address, if any. */
export function resendRegistrationLinks(email: string, captcha?: string | null): Promise<RegResult<{ ok: true }>> {
  return callRegistration<{ ok: true }>({ action: 'resend_links', email: email.trim().toLowerCase(), ...(captcha ? { captcha } : {}) });
}

/** Signed in, with a status link: links that one registration to the account (never proves the address). */
export function attachRegistration(token: string): Promise<RegResult<{ ok: true }>> {
  return callRegistration<{ ok: true }>({ action: 'attach', token });
}

/* ------------------------------------------------------------------ RPCs */

/** A row of my_participations(): one registration of the signed-in member, any engine. */
export interface Participation {
  engine: RegEngine | 'legacy' | 'sm26';
  registration_id: string;
  gl_event_id: string | null;
  event_id: string | null;
  slug: string | null;
  title: string | null;
  starts_at: string | null;
  ends_at: string | null;
  is_past: boolean;
  kind: RegKind;
  location: string | null;
  image_url: string | null;
  role_or_ticket: string | null;
  status: string;
  status_display: StatusDisplay | null;
  payment_display: PaymentDisplay | null;
  /** guest_list_v1 (proven address): the personal page; legacy: the event page; SM26: /sm26/me; core_v2: null (managed signed in). */
  status_url: string | null;
  can_cancel: boolean;
  linked: boolean;
}

export async function fetchMyParticipations(): Promise<{ rows: Participation[]; failed: boolean }> {
  try {
    const { data, error } = await supabase.rpc('my_participations');
    if (error) return { rows: [], failed: true };
    return { rows: (data ?? []) as Participation[], failed: false };
  } catch {
    return { rows: [], failed: true };
  }
}

/** A row of public_registration_events(): an event that takes registrations, as anyone sees it. */
export interface OpenRegistration {
  gl_event_id: string;
  event_id: string | null;
  slug: string;
  engine: RegEngine;
  kind: RegKind;
  registration_mode: RegMode;
  access: RegAccess;
  title: string;
  starts_at: string | null;
  ends_at: string | null;
  location: string | null;
  image_url: string | null;
  /** As for an anonymous visitor: never 'registered'. */
  state: RegState;
}

export async function fetchOpenRegistrations(): Promise<OpenRegistration[]> {
  try {
    const { data, error } = await supabase.rpc('public_registration_events');
    return error ? [] : ((data ?? []) as OpenRegistration[]);
  } catch {
    return [];
  }
}

/** A row of get_my_event_access(): links handed only to a registrant (or staff). */
export interface EventAccessRow {
  event_id: string;
  is_registered: boolean;
  meeting_url: string | null;
  replay_url?: string | null;
}

export async function fetchMyEventAccess(eventIds: string[] | null): Promise<EventAccessRow[]> {
  try {
    const { data, error } = await supabase.rpc('get_my_event_access', { p_event_ids: eventIds });
    return error ? [] : ((data ?? []) as EventAccessRow[]);
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ the promised delay */

let slaCache: string | null = null;

/** "within 2 working days": the delay M3 promises (platform_settings.review_sla_text). */
export function useReviewSla(): string {
  const [sla, setSla] = useState<string>(slaCache ?? 'within 2 working days');
  useEffect(() => {
    if (slaCache) return;
    let alive = true;
    (async () => {
      try {
        const { data } = await supabase.from('platform_settings').select('value').eq('key', 'review_sla_text').maybeSingle();
        const v = (data as { value?: unknown } | null)?.value;
        if (typeof v === 'string' && v.trim()) {
          slaCache = v.trim();
          if (alive) setSla(slaCache);
        }
      } catch { /* keep the default */ }
    })();
    return () => { alive = false; };
  }, []);
  return sla;
}

/* ------------------------------------------------------------------ words */

export type StatusTone = 'success' | 'warning' | 'danger' | 'neutral' | 'info';

/** A raw status in the shared vocabulary (the same mapping as my_participations). */
export function displayOf(status: string | null | undefined): StatusDisplay | null {
  switch (status) {
    case 'requested': return 'under_review';
    case 'needs_info': return 'needs_info';
    case 'waitlisted': return 'waitlisted';
    case 'invited': return 'invited';
    case 'approved': return 'payment_due';
    case 'confirmed': return 'confirmed';
    case 'rejected': return 'not_accepted';
    case 'declined': return 'declined';
    case 'cancelled': return 'cancelled';
    default: return null;
  }
}

export function statusLabel(t: TFunction, display: StatusDisplay | null | undefined): string {
  switch (display) {
    case 'under_review': return t('reg.status.underReview', 'Received, under review');
    case 'needs_info': return t('reg.status.needsInfo', 'Information needed');
    case 'waitlisted': return t('reg.status.waitlisted', 'Waiting list');
    case 'invited': return t('reg.status.invited', 'Invited, please reply');
    case 'payment_due': return t('reg.status.paymentDue', 'Approved, payment due');
    case 'confirmed': return t('reg.status.confirmed', 'Confirmed');
    case 'not_accepted': return t('reg.status.notAccepted', 'Not accepted');
    case 'declined': return t('reg.status.declined', 'You declined');
    case 'cancelled': return t('reg.status.cancelled', 'Cancelled');
    case 'event_ended': return t('reg.status.eventEnded', 'Event ended');
    default: return t('reg.status.unknown', 'Registered');
  }
}

export function statusTone(display: StatusDisplay | null | undefined): StatusTone {
  switch (display) {
    case 'confirmed': return 'success';
    case 'under_review':
    case 'needs_info':
    case 'invited':
    case 'payment_due': return 'warning';
    case 'waitlisted': return 'info';
    case 'not_accepted': return 'danger';
    default: return 'neutral';
  }
}

/** The payment badge, or null when there is nothing to say (no payment involved). */
export function paymentLabel(t: TFunction, payment: PaymentDisplay | null | undefined): string | null {
  switch (payment) {
    case 'due': return t('reg.payment.due', 'Payment due');
    case 'pending': return t('reg.payment.pending', 'Payment in progress');
    case 'invoiced': return t('reg.payment.invoiced', 'Invoice sent');
    case 'paid': return t('reg.payment.paid', 'Paid');
    case 'waived': return t('reg.payment.waived', 'Free of charge');
    case 'refunded': return t('reg.payment.refunded', 'Refunded');
    default: return null;
  }
}

/** A status a person still holds a place (or a request) with. */
export function isActiveStatus(status: string | null | undefined): boolean {
  return !!status && !['cancelled', 'declined', 'rejected'].includes(status);
}

/** One sentence for any refusal of the function. Never says whether an address is known. */
export function registrationErrorText(t: TFunction, failure: RegFailure | null | undefined): string {
  if (!failure) return t('reg.error.generic', 'Something went wrong. Please try again.');
  switch (failure.state) {
    case 'not_published': return t('reg.error.notPublished', 'Registration for this event is not open yet.');
    case 'not_yet_open': return t('reg.error.notYetOpen', 'Registration for this event has not opened yet.');
    case 'closed': return t('reg.error.closed', 'Registration for this event is closed.');
    case 'members_only': return t('reg.error.membersOnly', 'This event is for members validated by M3. Sign in with your account to register.');
    case 'invitation_only': return t('reg.error.invitationOnly', 'This event is by invitation only.');
    case 'full': return t('reg.error.full', 'Sorry, this event is now full.');
    default: break;
  }
  switch (failure.error) {
    case 'missing_fields': return t('reg.error.missingFields', 'Please fill in the fields marked with a star.');
    case 'invalid_email': return t('reg.error.invalidEmail', 'Please check your e-mail address.');
    case 'invalid_answers': return t('reg.error.invalidAnswers', 'Please check the answers marked in red.');
    case 'ticket_required': return t('reg.error.ticketRequired', 'Please choose how you will take part.');
    case 'unknown_ticket': return t('reg.error.unknownTicket', 'This type of participation is no longer offered. Please choose another one.');
    case 'ticket_invite_only': return t('reg.error.ticketInviteOnly', 'This type of participation is by invitation only.');
    case 'ticket_not_allowed': return t('reg.error.ticketNotAllowed', 'This type of participation is reserved for some companies validated by M3.');
    case 'account_suspended': return t('reg.error.suspended', 'Your account is suspended. Please contact the M3 team.');
    case 'rate_limited':
    case 'too_many': return t('reg.error.rateLimited', 'Too many attempts. Please wait a few minutes and try again.');
    case 'captcha': return t('reg.error.captcha', 'The security check did not go through. Please wait a moment and try again.');
    case 'not_found':
    case 'wrong_engine': return t('reg.error.notFound', 'This registration could not be found.');
    case 'expired': return t('reg.error.expired', 'This link has expired. Ask for a new one below.');
    case 'locked': return t('reg.error.locked', 'Your answers can no longer be changed for this event.');
    case 'not_allowed':
    case 'forbidden': return t('reg.error.notAllowed', 'This action is not available for this registration.');
    case 'network': return t('reg.error.network', 'The connection failed. Please check your internet and try again.');
    default: return t('reg.error.generic', 'Something went wrong. Please try again.');
  }
}

/** Options as `{value, label}` (plain strings are their own label). */
export function questionOptions(q: RegQuestion): QuestionOption[] {
  return (q.options ?? []).map((o) => (typeof o === 'string' ? { value: o, label: o } : { value: String(o.value), label: String(o.label ?? o.value) }));
}

/** The questions asked for a ticket (all of them when the event has no tickets), in their order. */
export function questionsFor(questions: RegQuestion[] | undefined, ticketKey: string | null): RegQuestion[] {
  return (questions ?? [])
    .filter((q) => !q.ticket_keys || q.ticket_keys.length === 0 || (ticketKey !== null && q.ticket_keys.includes(ticketKey)))
    .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0) || a.key.localeCompare(b.key));
}

/** The tickets a person can choose, in their order (inactive ones are never sent). */
export function sortedTickets(tickets: RegTicket[] | undefined): RegTicket[] {
  return [...(tickets ?? [])].sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0) || a.label.localeCompare(b.label));
}

/** Where the visitor came from, for source_detail: the campaign tags of the address, else `fallback`. */
export function sourceFromUrl(search: string, fallback: SourceDetail['entry']): SourceDetail {
  const params = new URLSearchParams(search);
  const out: SourceDetail = {};
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const) {
    const v = params.get(key);
    if (v) out[key] = v.slice(0, 200);
  }
  const from = params.get('from');
  out.entry = out.utm_source || out.utm_campaign ? 'campaign' : from === 'event' ? 'event_page' : from === 'signup' ? 'signup' : fallback;
  if (from) out.ref = from.slice(0, 200);
  return out;
}

/** Guest-list (guest_list_v1) events that have a public page of their own. */
export const GUEST_LIST_PAGES: Record<string, string> = { wys26: '/wys26' };
