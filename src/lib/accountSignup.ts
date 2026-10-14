import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { throughWelcome } from '@/lib/confirmationLink';
import { notifyAdminsOfSignup } from '@/lib/notifications';
import { isAlreadyRegistered, type AuthErrorLike } from '@/lib/authErrors';

/**
 * The account sign-up v2 (registration Phase 2, AUTH lane; spec regspec-en.md §4.4,
 * §5, §6; Victor 6, 8 and 11 Oct 2026) and the calls around it:
 *
 *  - supabase.auth.signUp with the metadata handle_new_user maps (names, job title,
 *    country, affiliation, sector ids, declared type, signup_intent): the database
 *    never derives a status from it, and runs the intent only once the address is
 *    PROVEN (complete_signup_for, from /welcome, /reset-password or /verify-email);
 *  - the edge function account-signup: company_search ("My company is already
 *    listed"), notify_existing (an address that already has an account gets an
 *    e-mail; the page says the same thing either way), send_email_proof (the
 *    dashboard banner: a /verify-email?t= link);
 *  - the RPCs confirm_email_proof (/verify-email) and submit_signup_intent ("Add my
 *    company" for a signed-in person with no company).
 *
 * Every call here resolves, never throws: a refusal comes back as `{ ok: false, error }`.
 */

/* ------------------------------------------------------------------ types */

/** The six cards of step 2. `participant` = "No company: I'm here for events and content". */
export type SignupType = 'marina' | 'partner' | 'investor' | 'developer' | 'media_partner' | 'participant';
export type CompanyType = Exclude<SignupType, 'participant'>;

export const SIGNUP_TYPES: SignupType[] = ['marina', 'partner', 'investor', 'developer', 'media_partner', 'participant'];

export const isSignupType = (v: unknown): v is SignupType => typeof v === 'string' && (SIGNUP_TYPES as string[]).includes(v);

/** The profile persona a type gives (self-service personas only: handle_new_user keeps no other). */
export function personaOfType(type: SignupType): string {
  return type === 'participant' ? 'individual' : type;
}

/** A public company card from company_search: never an owner, a member, a status or a code. */
export interface CompanyCard {
  id: string;
  name: string;
  logo_url: string | null;
  city: string | null;
  country: string | null;
  type: CompanyType | null;
  type_label: string;
}

/**
 * What the person said about their company (profiles.signup_intent once cleaned by the
 * database): join an existing one, a new one M3 creates after review, or none. A
 * `code` (a company claim code) is kept apart by the database, never in the profile.
 */
export interface SignupIntent {
  action: 'join' | 'new' | 'none';
  org_id?: string;
  name?: string;
  website?: string;
  country?: string;
  type?: SignupType;
  code?: string;
}

export type Failure = { ok: false; error: string; retry_after?: number };
export type Result<T> = ({ ok: true } & T) | Failure;

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX_BYTES = 72;

/** Why a password is refused before any call: null when it is fine. */
export function passwordProblem(pw: string): 'short' | 'long' | null {
  if ([...pw].length < PASSWORD_MIN) return 'short';
  if (new TextEncoder().encode(pw).length > PASSWORD_MAX_BYTES) return 'long';
  return null;
}

/* ------------------------------------------------------------------ edge function */

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

async function invoke<T>(fn: 'account-signup' | 'accept-invite', body: Record<string, unknown>): Promise<Result<T>> {
  try {
    const { data, error } = await supabase.functions.invoke(fn, { body });
    if (!error) {
      if (isObj(data)) {
        if (typeof data.error === 'string') return { ...(data as object), ok: false, error: data.error } as Failure;
        return { ...(data as object), ok: true } as { ok: true } & T;
      }
      return { ok: false, error: 'bad_response' };
    }
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      let payload: unknown = null;
      try { payload = await ctx.json(); } catch { /* not JSON */ }
      if (isObj(payload)) {
        const code = typeof payload.error === 'string' && payload.error ? payload.error : statusCode(ctx.status);
        return { ...(payload as object), ok: false, error: code } as Failure;
      }
      return { ok: false, error: statusCode(ctx.status) };
    }
    return { ok: false, error: 'network' };
  } catch {
    return { ok: false, error: 'network' };
  }
}

function statusCode(status: number | undefined): string {
  if (status === 401) return 'session_expired';
  if (status === 403) return 'not_enabled';
  if (status === 429) return 'rate_limited';
  return 'unavailable';
}

/** The account-signup function, or accept-invite (the team invitation page). */
export const callAccountSignup = <T>(body: Record<string, unknown>) => invoke<T>('account-signup', body);
export const callAcceptInvite = <T>(body: Record<string, unknown>) => invoke<T>('accept-invite', body);

/** "My company is already listed": up to 8 public cards for at least 3 letters. */
export async function searchCompanies(q: string): Promise<Result<{ results: CompanyCard[] }>> {
  const res = await callAccountSignup<{ results?: unknown }>({ action: 'company_search', q: q.trim().slice(0, 80) });
  if (!res.ok) return res;
  const rows = Array.isArray(res.results) ? res.results : [];
  const results = rows.filter(isObj).filter((r) => typeof r.id === 'string' && typeof r.name === 'string').map((r) => ({
    id: r.id as string,
    name: r.name as string,
    logo_url: typeof r.logo_url === 'string' ? r.logo_url : null,
    city: typeof r.city === 'string' ? r.city : null,
    country: typeof r.country === 'string' ? r.country : null,
    type: isSignupType(r.type) && r.type !== 'participant' ? r.type : null,
    type_label: typeof r.type_label === 'string' ? r.type_label : '',
  }));
  return { ok: true, results };
}

/**
 * The sign-up did not create an account (the address has one): that account's owner
 * gets an e-mail (sign in, or set a password). Always "ok" for the page, whatever the
 * function answers: the page never says whether an address has an account.
 */
export async function notifyExisting(email: string): Promise<void> {
  await callAccountSignup({ action: 'notify_existing', email: email.trim().toLowerCase() });
}

/** The "Confirm your e-mail" banner: a /verify-email link to the account's address. */
export function sendEmailProof(): Promise<Result<{ sent?: boolean; already_proven?: boolean }>> {
  return callAccountSignup<{ sent?: boolean; already_proven?: boolean }>({ action: 'send_email_proof' });
}

/* ------------------------------------------------------------------ RPCs */

export interface ProofResult {
  proven: boolean;
  stamped?: boolean;
  /** invalid_token | wrong_account | email_changed | used | expired | impersonation */
  reason?: string;
  /** What complete_signup_for answered once the address was proven (see sendSignupNotices). */
  signup?: Record<string, unknown> | null;
}

/** /verify-email?t=: the signed-in account proves its address (never a sign-in). */
export async function confirmEmailProof(token: string): Promise<Result<ProofResult>> {
  try {
    const { data, error } = await supabase.rpc('confirm_email_proof', { p_token: token });
    if (error) return { ok: false, error: error.code === '42501' ? 'session_expired' : error.code === 'PGRST202' || error.code === '42883' ? 'unavailable' : 'server' };
    const d = isObj(data) ? data : {};
    return {
      ok: true,
      proven: d.proven === true,
      stamped: d.stamped === true,
      reason: typeof d.reason === 'string' ? d.reason : undefined,
      signup: isObj(d.signup) ? d.signup : null,
    };
  } catch {
    return { ok: false, error: 'network' };
  }
}

/**
 * The e-mails a sign-up step owes, sent right after it ran (registration contract §10.5:
 * "the person's page calls send-notification right after confirm_email_proof,
 * mark_email_proven or submit_signup_intent"). `signup` is complete_signup_for's answer
 * ({done, result: {path, invitation_id}}), as confirm_email_proof (`signup`) and
 * submit_signup_intent return it:
 *  - account_under_review, to the person (send-notification checks that the caller is
 *    that pending, proven account, and sends it once);
 *  - team_join_request, to the owner of the company the person asked to join (the
 *    function resolves the owner and the words from the invitation row, which must be
 *    the caller's own, fresh join request).
 * Nothing when the step did not run (not proven yet, already done earlier). Fire and
 * forget; send-notification sends each e-mail once (per person, per request row). The
 * database also queues them (notification_outbox): the server side that drains that
 * queue must skip what this call already sent (integration note, Phase 2).
 */
export async function sendSignupNotices(signup: unknown): Promise<void> {
  if (!isObj(signup) || signup.done !== true || signup.already === true) return;
  const result = isObj(signup.result) ? signup.result : {};
  const path = typeof result.path === 'string' ? result.path : '';
  const invitationId = typeof result.invitation_id === 'string' ? result.invitation_id : '';
  let uid: string | null = null;
  try {
    const { data } = await supabase.auth.getSession();
    uid = data.session?.user?.id ?? null;
  } catch { /* no session: nothing to send for */ }
  if (!uid) return;
  const send = (body: Record<string, unknown>) =>
    supabase.functions.invoke('send-notification', { body }).then(() => undefined, () => undefined);
  const calls: Promise<void>[] = [send({ type: 'account_under_review', user_id: uid })];
  if (path === 'join_requested' && invitationId) {
    calls.push(send({ type: 'team_join_request', data: { invitation_id: invitationId } }));
  }
  await Promise.all(calls);
}

/**
 * After mark_email_proven stamped the proof (/welcome, /reset-password): it ran the
 * sign-up intent (on_email_proven -> complete_signup_for) but does not return its
 * answer, so the profile's intent is read back. The notices go out only when that
 * intent was run in the last few minutes, i.e. by this very proof: an older account
 * (no intent), or an intent run long ago, sends nothing.
 */
const JUST_RUN_MS = 10 * 60 * 1000;
export async function sendNoticesAfterProof(): Promise<void> {
  try {
    const { data: s } = await supabase.auth.getSession();
    const uid = s.session?.user?.id;
    if (!uid) return;
    const { data } = await supabase.from('profiles').select('signup_intent').eq('user_id', uid).maybeSingle();
    const raw = isObj(data) && isObj(data.signup_intent) ? data.signup_intent : null;
    if (!raw || typeof raw.done_at !== 'string') return;
    const at = Date.parse(raw.done_at);
    if (!Number.isFinite(at) || Date.now() - at > JUST_RUN_MS) return;
    await sendSignupNotices({ done: true, result: isObj(raw.result) ? raw.result : {} });
  } catch { /* the e-mails are a courtesy: never block the page */ }
}

/**
 * "Add my company" (signed in, in no company yet), or a claim link opened while signed
 * in: the same intent as the sign-up form. The database runs it now when the address
 * is proven, else as soon as it is. Codes: no_profile, account_suspended,
 * already_in_company, request_pending, too_soon, bad_input.
 */
export async function submitSignupIntent(intent: SignupIntent): Promise<Result<{ result: Record<string, unknown> | null }>> {
  try {
    const { data, error } = await supabase.rpc('submit_signup_intent', { p_intent: intent });
    if (error) {
      const msg = error.message || '';
      const known = ['no_profile', 'account_suspended', 'already_in_company', 'request_pending', 'too_soon', 'bad_input', 'not_signed_in'];
      const code = known.find((k) => msg === k || msg.includes(k));
      if (code) return { ok: false, error: code };
      if (error.code === 'PGRST202' || error.code === '42883') return { ok: false, error: 'unavailable' };
      return { ok: false, error: 'server' };
    }
    return { ok: true, result: isObj(data) ? data : null };
  } catch {
    return { ok: false, error: 'network' };
  }
}

/* ------------------------------------------------------------------ the profile */

/** The profile columns of Phase 1/2 this lane reads (select('*') carries them once they exist). */
export interface ProfileIdentity {
  email?: string | null;
  email_proven_at?: string | null;
  signup_intent?: unknown;
  affiliation?: string | null;
  country?: string | null;
}

/**
 * Proven (contract §2): email_proven_at set AND profiles.email = the auth e-mail. Before the
 * Phase 1 columns exist (undefined), a profile counts as proven, so no banner shows.
 */
export function isProven(profile: unknown, authEmail: string | null | undefined): boolean {
  if (!isObj(profile)) return false;
  const p = profile as ProfileIdentity;
  if (!('email_proven_at' in p)) return true;
  if (!p.email_proven_at) return false;
  return (p.email || '').trim().toLowerCase() === (authEmail || '').trim().toLowerCase();
}

/** The stored intent as the database cleaned it: what the person asked about their company, and where it stands. */
export interface StoredIntent {
  action: 'join' | 'new' | 'none';
  org_id?: string;
  name?: string;
  type?: string;
  has_code?: boolean;
  submitted_at?: string;
  done_at?: string;
  /** join_requested | claim_requested | company_pending | new_company | none | invitation_pending | already_member | org_not_found | join_declined_recently */
  path?: string;
  /** matched | invalid | throttled | refused_has_owner */
  code?: string;
}

/**
 * A profile made by the sign-up v2 (or that sent "Add my company"): it carries the
 * intent the database cleaned. Such an account never goes through the old company
 * wizard (create_organization), whatever the flags: with account_signup_v2 on and
 * front_door still off, its draft status would otherwise send it there.
 */
export function isV2Signup(profile: unknown): boolean {
  return readStoredIntent(profile) !== null;
}

export function readStoredIntent(profile: unknown): StoredIntent | null {
  if (!isObj(profile)) return null;
  const raw = (profile as ProfileIdentity).signup_intent;
  if (!isObj(raw)) return null;
  const action = raw.action === 'join' || raw.action === 'new' || raw.action === 'none' ? raw.action : null;
  if (!action) return null;
  const result = isObj(raw.result) ? raw.result : {};
  const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
  return {
    action,
    org_id: str(raw.org_id),
    name: str(raw.name),
    type: str(raw.type),
    has_code: raw.has_code === true,
    submitted_at: str(raw.submitted_at),
    done_at: str(raw.done_at),
    path: str(result.path),
    code: str(result.code),
  };
}

/* ------------------------------------------------------------------ sessions */

const LINK_METHODS = ['otp', 'magiclink', 'recovery', 'invite', 'email/signup', 'email_change'];

/**
 * Whether this session was opened from an e-mailed link (the JWT's `amr`), and when.
 * Read without checking the signature: it only decides where the page goes next,
 * never what the server allows (mark_email_proven reads the same claim server-side).
 */
export function linkSessionAt(session: Session | null | undefined): number | null {
  const token = session?.access_token;
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))) as { amr?: unknown };
    if (!Array.isArray(claims.amr)) return null;
    let at: number | null = null;
    for (const a of claims.amr) {
      if (!isObj(a) || typeof a.method !== 'string' || !LINK_METHODS.includes(a.method)) continue;
      const ts = typeof a.timestamp === 'number' ? a.timestamp * 1000 : null;
      if (ts && (at === null || ts > at)) at = ts;
      else if (!ts && at === null) at = 0;
    }
    return at;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ the sign-up */

export interface AccountSignupInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  type: SignupType;
  jobTitle: string;
  country: string;
  /** A participant's free-text organisation (never creates a company). */
  affiliation: string;
  sectorIds: string[];
  intent: SignupIntent;
  /** Where the confirmation link continues after /welcome (a path on this site). */
  next: string;
  captchaToken?: string | null;
}

/**
 * What the form shows next:
 *  - `check_inbox`: no session yet (Confirm email ON: a new account waits for its link;
 *    or the address already had an account, which got an e-mail). Both read the same;
 *  - `signed_in`: Confirm email OFF, the account exists and is signed in; a proof link
 *    was sent (`proofSent`) so M3 can review it;
 *  - `error`: refused (weak password, rate limit, network...), shown in plain words.
 */
export type SignupOutcome =
  | { kind: 'check_inbox'; via: 'confirmation' | 'existing'; redirectTo: string }
  | { kind: 'signed_in'; proofSent: boolean }
  | { kind: 'error'; error: AuthErrorLike };

export async function signUpAccount(input: AccountSignupInput): Promise<SignupOutcome> {
  const email = input.email.trim().toLowerCase();
  const emailRedirectTo = throughWelcome(`${window.location.origin}${input.next}`);
  const participant = input.type === 'participant';
  const intent: SignupIntent = { ...input.intent, type: input.type };
  const data: Record<string, unknown> = {
    persona: personaOfType(input.type),
    first_name: input.firstName.trim(),
    last_name: input.lastName.trim(),
    job_title: input.jobTitle.trim(),
    country: input.country.trim(),
    declared_type: input.type,
    sector_ids: input.sectorIds.slice(0, 5),
    signup_intent: intent,
    // The old main client's keys, which prefill its company wizard: only for a company the
    // person declared as new (a listed company picked here must never be created again).
    company_name: input.intent.action === 'new' ? (input.intent.name || '').trim() : '',
    company_website: input.intent.action === 'new' ? (input.intent.website || '').trim() : '',
    // Language of the auth e-mails (send-email hook): English only.
    lang: 'en',
  };
  if (participant && input.affiliation.trim()) data.affiliation = input.affiliation.trim();

  let res: Awaited<ReturnType<typeof supabase.auth.signUp>>;
  try {
    res = await supabase.auth.signUp({
      email,
      password: input.password,
      options: { emailRedirectTo, data, ...(input.captchaToken ? { captchaToken: input.captchaToken } : {}) },
    });
  } catch (err) {
    return { kind: 'error', error: err instanceof Error ? err : { message: String(err) } };
  }
  const { data: out, error } = res;

  // The address already has an account. With Confirm email ON GoTrue hides it (a user
  // with no identities); OFF, it says "User already registered". Either way that
  // account's owner gets an e-mail, and the page says the same as for a new account.
  if (isAlreadyRegistered(error) || (!error && out.user && (out.user.identities?.length ?? 0) === 0)) {
    await notifyExisting(email);
    return { kind: 'check_inbox', via: 'existing', redirectTo: emailRedirectTo };
  }
  if (error) return { kind: 'error', error };

  // A new account: M3 hears of it (notify-admins reads the account itself).
  void notifyAdminsOfSignup(email);

  if (!out.session) return { kind: 'check_inbox', via: 'confirmation', redirectTo: emailRedirectTo };

  // Confirm email OFF: signed in already, address not proven. The proof link lets the
  // database run the sign-up intent (M3's review) once the person opens it.
  const proof = await sendEmailProof();
  return { kind: 'signed_in', proofSent: proof.ok };
}
