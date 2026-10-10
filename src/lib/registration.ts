import { useEffect, useState } from 'react';
import type { TFunction } from 'i18next';
import { supabase } from '@/lib/supabase';

/**
 * The client of the unified registration (spec §4.1, §6; the DB lane's contract
 * docs/registration-contract.md and the EDGE lane's API,
 * supabase/functions/registration/README.md).
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
 * differs). Nothing here ever receives a status token: status links travel by
 * e-mail.
 */

/* ------------------------------------------------------------------ types */

export type RegEngine = 'guest_list_v1' | 'core_v2';
export type RegKind = 'webinar' | 'onsite';
export type RegMode = 'instant' | 'review' | 'invitation';
export type RegAccess = 'public' | 'members';

/** What a visitor can do on an event now (gl_registration_state). */
export type RegState =
  | 'open' | 'not_published' | 'not_yet_open' | 'closed' | 'full' | 'waitlist'
  | 'members_only' | 'invitation_only' | 'registered' | 'not_found';

/** gl_guest.status (core_v2 has all nine; guest_list_v1 the first, fourth and last four). */
export type RegStatus =
  | 'requested' | 'needs_info' | 'waitlisted' | 'invited' | 'approved'
  | 'confirmed' | 'declined' | 'rejected' | 'cancelled';

/** The one vocabulary of the screens and e-mails (spec §2.3; contract §5 REG). */
export type StatusDisplay =
  | 'under_review' | 'needs_info' | 'waitlisted' | 'invited' | 'payment_due'
  | 'confirmed' | 'not_accepted' | 'declined' | 'cancelled' | 'event_ended';

export type PaymentDisplay = 'none' | 'due' | 'pending' | 'invoiced' | 'paid' | 'waived' | 'refunded';

export type FieldRule = 'required' | 'optional' | 'hidden';
export type StandardFieldKey = 'company' | 'job_title' | 'phone' | 'country';
/** The event's standard fields, each required, optional or hidden (a missing key is optional). */
export type StandardFields = Partial<Record<StandardFieldKey, FieldRule>>;

export type QuestionKind =
  | 'text' | 'textarea' | 'select' | 'multiselect' | 'checkbox' | 'url' | 'phone'
  | 'country' | 'sectors' | 'parts' | 'consent';

export interface QuestionOption { value: string; label: string }

/** One of the event's own questions (gl_question), in the order the function sends them. */
export interface RegQuestion {
  key: string;
  label: string;
  help?: string | null;
  kind: QuestionKind;
  /** `{value, label}` objects; plain strings are accepted too (normalised by questionOptions). */
  options?: (QuestionOption | string)[] | null;
  max_length?: number | null;
  required?: boolean;
  /** Null or empty: asked for every participation type. */
  ticket_keys?: string[] | null;
  /** Not sent by the function today: only used for the autocomplete hint when present. */
  profile_field?: 'job_title' | 'country' | 'phone' | 'linkedin_url' | null;
  editable_after_submit?: boolean;
  /** Status view only: this answer can be changed now. */
  editable?: boolean;
}

/** A participation type (gl_ticket), as the function shows it to this caller. */
export interface RegTicket {
  key: string;
  label: string;
  description?: string | null;
  price_cents?: number | null;
  currency?: string | null;
  price_note?: string | null;
  invite_only?: boolean;
  parts?: string[] | null;
  /** Company types this type is kept for (organization_type values), or null. */
  restricted_to?: string[] | null;
  /** False: given by invitation, or kept for company types the caller's validated companies are not. */
  allowed?: boolean;
}

/**
 * The event as the registration function describes it. A core_v2 event that
 * takes registrations has every field; a guest list (wys26) or a draft only
 * the first ones: read the rest with a fallback.
 */
export interface RegEvent {
  gl_event_id: string;
  /** events.id; null for an event without a catalogue row (the canaries). */
  event_id?: string | null;
  slug: string;
  title?: string;
  kind?: RegKind;
  mode?: RegMode;
  access?: RegAccess;
  public_requests?: boolean;
  waitlist?: boolean;
  starts_at?: string | null;
  ends_at?: string | null;
  opens_at?: string | null;
  closes_at?: string | null;
  edit_locks_at?: string | null;
  /** IANA zone of the event (default Europe/Monaco). */
  timezone?: string | null;
  location?: string | null;
  image_url?: string | null;
  hidden?: boolean;
  /** Status view only: the event is over. */
  ended?: boolean;
}

/** What the platform knows about the signed-in caller (spec §4.1 `form`). */
export interface RegPrefill {
  first_name?: string | null;
  last_name?: string | null;
  /** The account's e-mail: the registration is always made with it. */
  email?: string | null;
  email_locked?: boolean;
  job_title?: string | null;
  country?: string | null;
  phone?: string | null;
  /** The only company's name, else the declared affiliation. */
  company?: string | null;
  organizations?: { id: string; name: string }[];
  /** The person is validated by M3. */
  verified?: boolean;
}

/** The signed-in caller's own registration for this event (never given to anyone else). */
export interface RegMine {
  registration_id?: string;
  status: RegStatus;
  status_display?: StatusDisplay | string;
}

/** The answer of `form`. */
export interface RegForm {
  ok: true;
  engine: RegEngine;
  state: RegState;
  /** The switch of this kind of event is off: "Registration is closed for now". */
  paused?: boolean;
  /** Guest list only: the /wys26 form posts to `registration` (flag wys_form_v2). */
  parity?: boolean;
  event: RegEvent;
  fields?: StandardFields;
  tickets?: RegTicket[];
  questions?: RegQuestion[];
  /** "within 2 working days". */
  review_sla_text?: string;
  prefill?: RegPrefill | null;
  mine?: RegMine | null;
  /**
   * Ask the image-rights consent on the last step. Not sent by the function in
   * Phase 1 (contract §2, gl_event settings): image rights are asked, when an
   * event needs them, with one of its own questions of kind `consent`.
   */
  ask_image_consent?: boolean;
}

export type TimelineStep = 'received' | 'needs_info' | 'confirmed' | 'not_accepted' | 'waitlisted' | 'cancelled' | 'checked_in';

/** A registration seen through its status link, or by its signed-in owner (`status`, `update`). */
export interface RegStatusView {
  ok: true;
  engine: RegEngine;
  via: 'token' | 'session';
  /** Linked to an account and not opened by it: the link shows the registration, the account manages it. */
  read_only: boolean;
  event: RegEvent;
  registration: {
    id: string;
    status: RegStatus;
    status_display?: StatusDisplay | string;
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
    /** What M3 asked (needs_info only). */
    info_request?: string | null;
    created_at?: string | null;
    linked?: boolean;
    /** Linked to the account that is asking (a status link opened while signed in). */
    linked_to_me?: boolean;
  };
  timeline: { step: TimelineStep; at: string }[];
  fields?: StandardFields;
  /** The questions of this registration's participation type. */
  questions?: RegQuestion[];
  can_edit: boolean;
  can_edit_names: boolean;
  can_cancel: boolean;
  /**
   * needs_info: the answer to M3 can still be sent from the page (until the event ends),
   * even when the details are locked (can_edit false): then the answer only.
   */
  can_answer_info?: boolean;
  edit_locks_at?: string | null;
  reminders_on: boolean;
  meeting_url?: string | null;
  replay_url?: string | null;
  /** Confirmed on site: the entry pass, to draw as a QR code. */
  pass?: { qr_text: string } | null;
  calendar?: { title: string; starts_at: string; ends_at: string; location?: string | null; url?: string | null } | null;
}

/** Every refusal of the function, as one shape. */
export interface RegFailure {
  ok: false;
  error?: string;
  state?: RegState;
  paused?: boolean;
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

/** An event, by its slug or its catalogue id. */
export type EventSelector = { slug: string } | { event_id: string };

export interface RegisterInput {
  first_name?: string;
  last_name?: string;
  email?: string;
  company?: string;
  job_title?: string;
  phone?: string;
  country?: string;
  ticket_key?: string | null;
  answers?: Record<string, unknown>;
  /** Booleans: the function stamps the dates. `terms` is required without an account. */
  consents?: { terms?: boolean; image?: boolean; marketing?: boolean };
  source_detail?: SourceDetail;
  /** Signed in: the company the registration is made for (one of prefill.organizations). */
  organization_id?: string | null;
  /** Honeypot: always empty from a person. */
  website?: string;
  /** Cloudflare Turnstile token, when the widget gave one. */
  captcha?: string | null;
}

/** Signed in: where the registration landed. Anonymous answers are only `{ ok: true }`. */
export interface RegisterDone {
  ok: true;
  status?: RegStatus;
  duplicate?: boolean;
  registration_id?: string;
}

/** A registration addressed by its status link or, signed in, by its id or its event. */
export type RegTarget = { token: string } | { registration_id: string } | EventSelector;

/** What can be changed after sending (`update`): only the keys that change. */
export interface RegChanges {
  first_name?: string;
  last_name?: string;
  company?: string;
  job_title?: string;
  phone?: string;
  country?: string;
  answers?: Record<string, unknown>;
  /** needs_info only: the person's answer to M3's question, in their words (up to 2000 characters). */
  info_answer?: string;
}

/** The longest answer to M3's question the function keeps. */
export const INFO_ANSWER_MAX = 2000;

/* ------------------------------------------------------------------ the call */

function isFailure(x: unknown): x is RegFailure {
  return !!x && typeof x === 'object' && (x as { ok?: unknown }).ok === false;
}

/** An HTTP refusal without a code of the function (the platform's gateway, a crash): a code from the status. */
function codeForStatus(status: number | undefined): string {
  if (status === 401) return 'session_expired';
  if (status === 429) return 'rate_limited';
  // A 404 without the function's own `not_found` is the gateway (the function is missing):
  // never "this registration does not exist".
  return 'unavailable';
}

/**
 * Calls the registration function. Always resolves: a refusal (an HTTP 4xx
 * `{ error }`, or a 200 `{ ok: false, state }`) comes back as one failure
 * shape, a network failure as `{ ok: false, error: 'network' }`. An answer
 * that does not have the expected shape (`valid`) is a failure too
 * (`bad_response`), never a half-read success.
 */
export async function callRegistration<T>(body: Record<string, unknown>, valid?: (d: Record<string, unknown>) => boolean): Promise<RegResult<T>> {
  try {
    const { data, error } = await supabase.functions.invoke('registration', { body });
    if (!error) {
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        const d = data as Record<string, unknown>;
        if (d.ok === false || typeof d.error === 'string') return { ...(d as object), ok: false } as RegFailure;
        if (valid && !valid(d)) return { ok: false, error: 'bad_response' };
        return { ...(d as object), ok: true } as T;
      }
      return { ok: false, error: 'bad_response' };
    }
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      let payload: unknown = null;
      try { payload = await ctx.json(); } catch { /* not JSON */ }
      if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
        const code = (payload as { error?: unknown }).error;
        return {
          ...(payload as object),
          ok: false,
          error: typeof code === 'string' && code ? code : codeForStatus(ctx.status),
        } as RegFailure;
      }
      return { ok: false, error: codeForStatus(ctx.status) };
    }
    return { ok: false, error: 'network' };
  } catch {
    return { ok: false, error: 'network' };
  }
}

export const regFailed = isFailure;

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

export function getRegistrationForm(event: EventSelector): Promise<RegResult<RegForm>> {
  return callRegistration<RegForm>(
    { action: 'form', ...event },
    (d) => typeof d.engine === 'string' && isObj(d.event) && typeof d.event.slug === 'string',
  );
}

/** Signed in with nothing else: one click (the function fills in what the account knows). */
export function registerForEvent(event: EventSelector, input: RegisterInput = {}): Promise<RegResult<RegisterDone>> {
  return callRegistration<RegisterDone>({ action: 'register', ...event, ...input });
}

const isStatusView = (d: Record<string, unknown>) =>
  isObj(d.event) && isObj(d.registration) && typeof d.registration.status === 'string';

export function getRegistrationStatus(target: RegTarget): Promise<RegResult<RegStatusView>> {
  return callRegistration<RegStatusView>({ action: 'status', ...target }, isStatusView);
}

/** Saves the changed keys; a registration waiting for information goes back to review. Answers the new view. */
export function updateRegistration(target: RegTarget, changes: RegChanges): Promise<RegResult<RegStatusView>> {
  return callRegistration<RegStatusView>({ action: 'update', ...target, ...changes }, isStatusView);
}

export function cancelRegistration(target: RegTarget): Promise<RegResult<{ ok: true; status: 'cancelled' }>> {
  return callRegistration<{ ok: true; status: 'cancelled' }>({ action: 'cancel', ...target });
}

/** Reminder e-mails about this one event, on or off (off also stops the follow-up after a webinar). */
export function setRegistrationReminders(target: RegTarget, on: boolean): Promise<RegResult<{ ok: true; reminders_on: boolean }>> {
  return callRegistration<{ ok: true; reminders_on: boolean }>({ action: 'reminders', ...target, on });
}

/** Always `{ ok: true }` for a valid address: e-mails fresh status links for its upcoming registrations, if any. */
export function resendRegistrationLinks(email: string, honeypot = ''): Promise<RegResult<{ ok: true }>> {
  return callRegistration<{ ok: true }>({ action: 'resend_links', email: email.trim().toLowerCase(), ...(honeypot ? { website: honeypot } : {}) });
}

/** Signed in, with a status link: links that one registration to the account (never proves the address). */
export function attachRegistration(token: string): Promise<RegResult<{ ok: true; already?: boolean }>> {
  return callRegistration<{ ok: true; already?: boolean }>({ action: 'attach', token });
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
  /**
   * guest_list_v1 (proven address only): the personal page; legacy: the event
   * page; SM26: /sm26/me; core_v2: null (managed signed in, statusPagePath).
   */
  status_url: string | null;
  can_cancel: boolean;
  /** The row is linked to an account (a row found by the proven e-mail may not be yet). */
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

const DEFAULT_SLA = 'within 2 working days';
let slaCache: string | null = null;

/** "within 2 working days": the delay M3 promises (platform_settings.review_sla_text). */
export function useReviewSla(known?: string | null): string {
  const [sla, setSla] = useState<string>(slaCache ?? DEFAULT_SLA);
  useEffect(() => {
    if (known || slaCache) return;
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
  }, [known]);
  return known?.trim() || sla;
}

/* ------------------------------------------------------------------ words */

export type StatusTone = 'success' | 'warning' | 'danger' | 'neutral' | 'info';

const DISPLAYS: StatusDisplay[] = [
  'under_review', 'needs_info', 'waitlisted', 'invited', 'payment_due',
  'confirmed', 'not_accepted', 'declined', 'cancelled', 'event_ended',
];

/** A raw status, or a display value, in the shared vocabulary (the same mapping as my_participations). */
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
    default: return status && (DISPLAYS as string[]).includes(status) ? status as StatusDisplay : null;
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

/**
 * A registration the person has to be told about, rather than offered a new
 * one: anything but one they cancelled or declined (a request M3 did not
 * accept stays visible, with its words).
 */
export function isShownRegistration(status: string | null | undefined): boolean {
  return !!status && !['cancelled', 'declined'].includes(status);
}

/**
 * What to tell a signed-in member after `register`, from the function's answer
 * (never from what the page expected): already registered, on the waiting
 * list, received for review, registered. A bare `{ ok: true }` (an account
 * whose e-mail is not confirmed yet gets the public answer) says only that an
 * e-mail is on its way.
 */
export function registerOutcomeText(t: TFunction, res: RegisterDone): string {
  if (res.duplicate) return t('reg.toast.already', 'You already have a registration for this event. Its page says where it stands.');
  switch (res.status) {
    case 'confirmed': return t('reg.toast.registered', "You're registered. We sent you the details by e-mail.");
    case 'waitlisted': return t('reg.toast.waitlisted', 'You are on the waiting list. We sent you an e-mail.');
    case 'requested': return t('reg.toast.received', 'Registration received. The M3 team will reply by e-mail.');
    default: return t('reg.toast.checkInbox', 'Thank you. Please check your inbox: we sent you an e-mail about this registration.');
  }
}

/** One sentence for any refusal of the function. Never says whether an address is known. */
export function registrationErrorText(t: TFunction, failure: RegFailure | null | undefined): string {
  if (!failure) return t('reg.error.generic', 'Something went wrong. Please try again.');
  if (failure.paused) return t('reg.error.paused', 'Registration is closed for now. Please try again later.');
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
    case 'terms_required': return t('reg.confirm.termsNeeded', 'Please accept the terms to send your registration.');
    case 'invalid_answers': return t('reg.error.invalidAnswers', 'Please check the answers marked in red.');
    case 'ticket_required': return t('reg.error.ticketRequired', 'Please choose how you will take part.');
    case 'unknown_ticket': return t('reg.error.unknownTicket', 'This type of participation is no longer offered. Please choose another one.');
    case 'ticket_invite_only': return t('reg.error.ticketInviteOnly', 'This type of participation is by invitation only.');
    case 'ticket_not_allowed': return t('reg.error.ticketNotAllowed', 'This type of participation is kept for some companies validated by M3.');
    case 'account_suspended': return t('reg.error.suspended', 'Your account is suspended. Please contact the M3 team.');
    case 'rate_limited': return t('reg.error.rateLimited', 'Too many attempts. Please wait a few minutes and try again.');
    case 'busy': return t('reg.error.busy', 'Many people are registering right now. Please try again in a few minutes.');
    case 'captcha': return t('reg.error.captcha', 'The security check did not go through. Please wait a moment and try again.');
    case 'session_expired': return t('reg.error.sessionExpired', 'You have been signed out. Please sign in again and retry.');
    case 'sign_in_required': return t('reg.error.signInRequired', 'This registration belongs to an account. Please sign in to change it.');
    case 'not_found':
    case 'wrong_engine': return t('reg.error.notFound', 'This registration could not be found.');
    case 'unavailable':
    case 'bad_response': return t('reg.error.unavailable', 'Registration is not available right now. Please try again in a few minutes.');
    case 'locked': return t('reg.error.locked', 'This registration can no longer be changed.');
    case 'changed': return t('reg.error.changed', 'This registration was just changed somewhere else. The page now shows the latest version.');
    case 'linked_elsewhere': return t('reg.error.linkedElsewhere', 'This registration already belongs to another account.');
    case 'already_registered': return t('reg.error.alreadyRegistered', 'Your account already has a registration for this event.');
    case 'not_available':
    case 'forbidden': return t('reg.error.notAllowed', 'This action is not available for this registration.');
    case 'network': return t('reg.error.network', 'The connection failed. Please check your internet and try again.');
    default: return t('reg.error.generic', 'Something went wrong. Please try again.');
  }
}

/** Options as `{value, label}` (plain strings are their own label). */
export function questionOptions(q: RegQuestion): QuestionOption[] {
  return (q.options ?? []).map((o) => (typeof o === 'string' ? { value: o, label: o } : { value: String(o.value), label: String(o.label ?? o.value) }));
}

/** The questions asked for a participation type (all of them when there is none), in the function's order. */
export function questionsFor(questions: RegQuestion[] | undefined, ticketKey: string | null): RegQuestion[] {
  return (questions ?? []).filter((q) => !q.ticket_keys || q.ticket_keys.length === 0 || (ticketKey !== null && q.ticket_keys.includes(ticketKey)));
}

/** Whether a participation type can be chosen by this caller. */
export function ticketOpen(tk: RegTicket): boolean {
  return tk.allowed !== false && !tk.invite_only;
}

/** The event offers participation types, and none of them can be chosen by this caller. */
export function noOpenTicket(form: RegForm): boolean {
  const tickets = form.tickets ?? [];
  return tickets.length > 0 && !tickets.some(ticketOpen);
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

/**
 * Guest-list (guest_list_v1) events that have a public page of their own.
 *
 * A NEW guest-list event (wys27, for example) needs THREE things, or its event
 * page shows the plain "invitation only" card instead of its own page: its two
 * public routes in App.tsx (/<slug> and /<slug>/guest), and an entry here. The
 * slug alone is not enough: gl_event_slug_for answers for core_v2 events and for
 * the hidden test canaries too, which have no page at /<slug>.
 */
export const GUEST_LIST_PAGES: Record<string, string> = { wys26: '/wys26' };

/** The page of one registration for its signed-in owner (core_v2 rows of My events have no link of their own). */
export function statusPagePath(registrationId: string): string {
  return `/registration?id=${encodeURIComponent(registrationId)}`;
}
