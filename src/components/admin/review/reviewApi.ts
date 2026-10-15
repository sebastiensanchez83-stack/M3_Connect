import { readRegistrationFlags, useRegistrationFlags } from '@/lib/flags';
import type { TFunction } from 'i18next';
import { supabase } from '@/lib/supabase';
import { guestList } from '@/lib/guestList';
import { registrationStaff, staffErrorText } from '@/components/admin/events/eventAdmin';

/**
 * Review queue v2 (spec §8.1, flag registration_flags.review_queue): every server call of
 * /admin/review v2, ValidatePersonDialog and the Users screens, in ONE place, so the names
 * and payloads can be checked against the database contract at a glance.
 *
 * Database (Phase 3 DB lane, migrations 20261016090000..091000, verified admins unless said):
 *   admin_review_queue(p_filter jsonb)        p_filter {} = the v2 cards (moderators: content only)
 *   admin_review_queue_counts()               {total, people, registrations, team_joins, duplicates, retro, content, oldest}
 *   admin_validate_person(p_user_id, p_decision)
 *       p_decision {action: validate|participant|reject|ask, reason, notify,
 *                   org: {mode: none|link|create, org_id, type, name, website, country, as_owner, force_new}}
 *   admin_decide_claim(p_invitation_id, p_approve, p_note)
 *   admin_revoke_team_join(p_member_id, p_reset_person, p_note)
 *   admin_review_dismiss(p_kind team_join|retro|duplicate_org|duplicate_person, p_id, p_other_id, p_note)
 *   admin_mark_duplicate_org(p_org_id, p_duplicate_of | null, p_note)
 *   org_match_candidates(p_name, p_website, p_email, p_country)
 *   person_match_candidates(p_email, p_first, p_last, p_company)
 *   admin_add_org_member(p_user_id, p_org_id, p_role)   (existing: the "Add back" of a removed team join)
 *   review_log_add(...)                                 (existing: the note after a guest-list decision)
 * Edge functions (staff session):
 *   registration {action: 'decide', gl_event_id, guest_ids[], decision, org_action, validate_person,
 *                 info_request, notify, force}     core_v2 events (gl_decide_v2 logs each change)
 *   guest-list   {action: 'decide', slug, guest_ids[], decision, force, notify}
 *                                                  guest_list_v1 events (wys26), the UNCHANGED call
 *                                                  of /admin/guest-list/<slug>
 * Every decision is logged by the server (review_log), except guest-list's, which this page
 * notes itself through review_log_add, as queue v1 does.
 */

/* ------------------------------------------------------------------ rows */

export type QueueTab = 'people' | 'registrations' | 'team_joins' | 'duplicates' | 'retro' | 'content';

export const QUEUE_TABS: QueueTab[] = ['people', 'registrations', 'team_joins', 'duplicates', 'retro', 'content'];

export type QueueKind =
  | 'person' | 'company' | 'claim' | 'join_request'
  | 'event_request'
  | 'team_join'
  | 'duplicate_org' | 'duplicate_person'
  | 'retro'
  | 'report' | 'need' | 'webinar' | 'resource_draft' | 'sponsorship' | 'exposition';

export const CONTENT_KINDS: QueueKind[] = ['report', 'need', 'webinar', 'resource_draft', 'sponsorship', 'exposition'];

const KNOWN_KINDS = new Set<string>([
  'person', 'company', 'claim', 'join_request', 'event_request', 'team_join', 'duplicate_org', 'duplicate_person',
  'retro', ...CONTENT_KINDS,
]);

export type Facts = Record<string, unknown>;

export interface QueueRow {
  kind: QueueKind;
  id: string;
  title: string;
  subtitle: string | null;
  created_at: string | null;
  waiting_since: string | null;
  url: string;
  priority: number;
  facts: Facts;
  tab: QueueTab;
  signals: Facts;
}

/** The tab of a kind, when a row comes without one (never with the v2 function; a safety net). */
export function tabOfKind(kind: QueueKind): QueueTab {
  switch (kind) {
    case 'person': case 'company': case 'claim': case 'join_request': return 'people';
    case 'event_request': return 'registrations';
    case 'team_join': return 'team_joins';
    case 'duplicate_org': case 'duplicate_person': return 'duplicates';
    case 'retro': return 'retro';
    default: return 'content';
  }
}

export const rowKey = (r: { kind: string; id: string }) => `${r.kind}:${r.id}`;

/* ------------------------------------------------------------------ fact readers */

export const fStr = (f: Facts | undefined, k: string): string | undefined => {
  const v = f?.[k];
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (typeof v === 'number') return String(v);
  return undefined;
};
export const fNum = (f: Facts | undefined, k: string): number | undefined => {
  const v = f?.[k];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() && !Number.isNaN(Number(v))) return Number(v);
  return undefined;
};
export const fBool = (f: Facts | undefined, k: string): boolean | undefined => (typeof f?.[k] === 'boolean' ? (f[k] as boolean) : undefined);
export const fObj = (f: Facts | undefined, k: string): Facts | undefined => {
  const v = f?.[k];
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Facts) : undefined;
};

/* ------------------------------------------------------------------ errors */

/** A refused or failed call, with the database's (or the function's) code. */
export class ReviewError extends Error {
  code: string;
  detail?: string;
  constructor(code: string, message?: string, detail?: string) {
    super(message || code);
    this.code = code;
    this.detail = detail;
  }
}

type PgError = { code?: string; message?: string; details?: string; hint?: string } | null;

export function fromPg(error: PgError): ReviewError {
  const code = error?.code ?? '';
  const msg = error?.message ?? '';
  // The function is not installed yet (migration not applied) or its signature differs.
  if (code === 'PGRST202' || code === 'PGRST203' || code === '42883' || code === 'PGRST205' || code === '42P01') {
    return new ReviewError('not_installed', msg);
  }
  if (code === '42501') return new ReviewError('forbidden', msg);
  if (code === '22023' && msg) return new ReviewError(msg, msg, error?.details ?? undefined);
  if (code === '23505') return new ReviewError('conflict', msg);
  // No database code: the request never reached Postgres (offline, gateway, timeout).
  if (!code) return new ReviewError('network', msg);
  return new ReviewError(msg || 'unknown', msg, error?.details ?? undefined);
}

/** Plain-English text for a code, for people who do not know the database. */
export function reviewErrorText(err: unknown, t: TFunction): string {
  const code = err instanceof ReviewError ? err.code : typeof err === 'string' ? err : 'unknown';
  switch (code) {
    case 'forbidden':
      return t('adminReview.v2.err.forbidden', 'Your account cannot do this. Only validated M3 administrators can decide here; sign in again if your session ended.');
    case 'not_installed':
      return t('adminReview.v2.err.notInstalled', 'This part of the review tools is not installed on the database yet. Ask the developer to finish the set-up.');
    case 'network':
      return t('adminReview.v2.err.network', 'The connection failed. Check your internet connection and try again.');
    case 'reason_required':
      return t('adminReview.v2.err.reason', 'Write a short reason first: the person reads it in the e-mail.');
    case 'person_not_found':
      return t('adminReview.v2.err.person', 'This account no longer exists. Refresh the list.');
    case 'staff_profile':
      return t('adminReview.v2.err.staff', 'This is an M3 staff account. Staff accounts are not reviewed here.');
    case 'not_pending':
      return t('adminReview.v2.err.notPending', 'This person is already validated, so there is no question to ask. Refresh the list.');
    case 'org_id_required':
    case 'org_not_found':
      return t('adminReview.v2.err.orgMissing', 'Choose a company from the list first.');
    case 'org_not_listed':
      return t('adminReview.v2.err.orgNotListed', 'This company is archived or marked as a duplicate. Choose another one.');
    case 'org_not_verified':
      return t('adminReview.v2.err.orgNotVerified', 'This company is still waiting for approval. Approve the company first, or choose another one.');
    case 'org_not_linkable':
      return t('adminReview.v2.err.orgNotLinkable', 'This company was not accepted or is suspended. Choose another one.');
    case 'name_required':
      return t('adminReview.v2.err.name', 'Write the company name.');
    case 'type_required':
    case 'bad_type':
      return t('adminReview.v2.err.type', 'Choose the type of company: the rights on the platform follow it.');
    case 'org_exists':
      return t('adminReview.v2.err.orgExists', 'A company with this name is already on the platform. Link the person to it, or create a new one anyway.');
    case 'org_needs_validate':
    case 'bad_org':
    case 'bad_org_mode':
    case 'bad_action':
    case 'bad_input':
    case 'bad_kind':
    case 'bad_filter':
    case 'bad_tab':
      return t('adminReview.v2.err.input', 'The request could not be read. Refresh the page and try again.');
    case 'claim_not_found':
    case 'not_an_open_claim':
      return t('adminReview.v2.err.claimGone', 'This request was already decided or withdrawn. Refresh the list.');
    case 'no_account':
      return t('adminReview.v2.err.noAccountNA', 'This person has no account any more. Mark the request as not accepted.');
    case 'account_suspended':
      return t('adminReview.v2.err.suspendedNA', 'This account is suspended. Mark the request as not accepted, or lift the suspension first.');
    case 'org_has_owner':
      return t('adminReview.v2.err.hasOwnerNA', 'This company already has an owner. Mark the claim as not accepted: the person can ask the owner to invite them.');
    case 'member_not_found':
      return t('adminReview.v2.err.memberGone', 'This person is no longer in the company. Refresh the list.');
    case 'owner_not_removable':
      return t('adminReview.v2.err.owner', 'The owner of a company cannot be removed here. Open the company to change its owner first.');
    case 'other_id_required':
      return t('adminReview.v2.err.input', 'The request could not be read. Refresh the page and try again.');
    case 'duplicate_of_self':
    case 'target_not_found':
    case 'target_not_listed':
      return t('adminReview.v2.err.target', 'The company to keep is no longer listed. Refresh the list.');
    case 'has_duplicates':
      return t('adminReview.v2.err.hasDuplicates', 'Other companies are already marked as duplicates of this one. Keep this one and hide the other instead.');
    case 'sm26_company_must_survive':
      return t('adminReview.v2.err.sm26', 'This company took part in Smart Marina 2026, so it must stay. Hide the other one instead.');
    case 'capacity':
    case 'ticket_capacity':
      return t('adminReview.v2.err.capacity', 'The event is full.');
    case 'no_part':
      return t('adminReview.v2.err.noPart', 'Choose conference or gala dinner in the guest list first.');
    case 'already_decided':
      return t('adminReview.toast.alreadyDecidedBody', 'Someone else decided this request. The list is now up to date.');
    case 'not_proven':
      return t('adminReview.v2.err.notProvenNA', 'This person has not confirmed their e-mail address yet, so the claim cannot be approved. Mark it as not accepted, or wait until they confirm it.');
    case 'claimant_changed':
      return t('adminReview.v2.err.claimantChangedNA', 'The account using this e-mail address was made after the claim was sent, so it is not the person who asked. Mark the claim as not accepted.');
    case 'near_match':
      return t('adminReview.v2.err.nearMatch', 'A company with a similar name is already on the platform. Link the person to it, or tick "This is a different company" first.');
    default: {
      // The registration function's own codes (onsite_not_live, wrong_engine…).
      return staffErrorText(code, t);
    }
  }
}

/* ------------------------------------------------------------------ the list */

function normaliseRow(raw: Record<string, unknown>): QueueRow | null {
  const kind = String(raw.kind ?? '');
  if (!KNOWN_KINDS.has(kind) || typeof raw.id !== 'string') return null;
  const facts = raw.facts && typeof raw.facts === 'object' && !Array.isArray(raw.facts) ? (raw.facts as Facts) : {};
  const signals = raw.signals && typeof raw.signals === 'object' && !Array.isArray(raw.signals) ? (raw.signals as Facts) : {};
  const tab = (QUEUE_TABS as string[]).includes(String(raw.tab)) ? (raw.tab as QueueTab) : tabOfKind(kind as QueueKind);
  return {
    kind: kind as QueueKind,
    id: raw.id,
    title: typeof raw.title === 'string' && raw.title ? raw.title : '—',
    subtitle: typeof raw.subtitle === 'string' && raw.subtitle ? raw.subtitle : null,
    created_at: typeof raw.created_at === 'string' ? raw.created_at : null,
    waiting_since: typeof raw.waiting_since === 'string' ? raw.waiting_since : null,
    url: typeof raw.url === 'string' && raw.url.startsWith('/') ? raw.url : '/admin',
    priority: typeof raw.priority === 'number' ? raw.priority : 9,
    facts,
    tab,
    signals,
  };
}

/** The v2 cards: admin_review_queue({}) (an object filter = the v2 list). */
export async function loadQueueV2(): Promise<QueueRow[]> {
  const { data, error } = await supabase.rpc('admin_review_queue', { p_filter: {} });
  if (error) throw fromPg(error);
  const rows = ((Array.isArray(data) ? data : []) as Record<string, unknown>[])
    .map(normaliseRow)
    .filter((r): r is QueueRow => !!r);
  return dropArchivedCompanies(rows);
}

/**
 * The list's pending-company cards (kind 'company') do not leave out an ARCHIVED company
 * (review_queue_rows, 20261016091000, filters only the access status): archived ones are
 * dropped here, so "Archive…" clears the card. A failed read keeps every card.
 */
async function dropArchivedCompanies(rows: QueueRow[]): Promise<QueueRow[]> {
  const ids = rows.filter(r => r.kind === 'company').map(r => r.id);
  if (!ids.length) return rows;
  const { data, error } = await supabase.from('organizations').select('id').in('id', ids).not('archived_at', 'is', null);
  if (error || !Array.isArray(data) || !data.length) return rows;
  const archived = new Set((data as { id: string }[]).map(o => o.id));
  return rows.filter(r => !(r.kind === 'company' && archived.has(r.id)));
}

/** Archives a company (or brings it back): admin_archive_org, logged by the server. */
export async function archiveOrg(orgId: string, archived: boolean, note?: string): Promise<void> {
  const { error } = await supabase.rpc('admin_archive_org', { p_org_id: orgId, p_archived: archived, p_note: note?.trim() || null });
  if (error) throw fromPg(error);
}

/** {total, people, …} of the v2 list (sidebar badge); null when it cannot be read. */
export async function loadQueueCounts(): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase.rpc('admin_review_queue_counts');
  if (error || !data || typeof data !== 'object') return null;
  return data as Record<string, unknown>;
}

/* ------------------------------------------------------------------ people */

export type PersonAction = 'validate' | 'participant' | 'reject' | 'ask';
export type OrgType = 'marina' | 'partner' | 'investor' | 'developer' | 'media_partner';
export const ORG_TYPES: OrgType[] = ['marina', 'partner', 'investor', 'developer', 'media_partner'];

export type OrgAction =
  | { mode: 'none' }
  | { mode: 'link'; org_id: string; as_owner?: boolean; type?: OrgType }
  | { mode: 'create'; name: string; type: OrgType; website?: string; country?: string; force_new?: boolean };

export interface PersonDecision {
  action: PersonAction;
  reason?: string;
  /** false = no e-mail to the person (validate, participant, reject). An "ask" always e-mails the question. */
  notify?: boolean;
  org?: OrgAction;
}

export interface PersonDecisionResult {
  ok?: boolean;
  action?: string;
  access_status?: string;
  persona?: string;
  organization_id?: string;
  organization_name?: string;
  role?: string;
  company_created?: boolean;
  company_verified?: boolean;
  owner_ignored?: boolean;
  type_ignored?: boolean;
  unchanged?: boolean;
  outbox_id?: string;
}

export async function validatePerson(userId: string, decision: PersonDecision): Promise<PersonDecisionResult> {
  const { data, error } = await supabase.rpc('admin_validate_person', { p_user_id: userId, p_decision: decision });
  if (error) throw fromPg(error);
  return (data ?? {}) as PersonDecisionResult;
}

export async function decideClaim(invitationId: string, approve: boolean, note?: string): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc('admin_decide_claim', {
    p_invitation_id: invitationId, p_approve: approve, p_note: note?.trim() || null,
  });
  if (error) throw fromPg(error);
  return (data ?? {}) as Record<string, unknown>;
}

export async function revokeTeamJoin(memberId: string, resetPerson: boolean, note?: string): Promise<{ organization_id?: string; user_id?: string; person_reset?: boolean }> {
  const { data, error } = await supabase.rpc('admin_revoke_team_join', {
    p_member_id: memberId, p_reset_person: resetPerson, p_note: note?.trim() || null,
  });
  if (error) throw fromPg(error);
  return (data ?? {}) as { organization_id?: string; user_id?: string; person_reset?: boolean };
}

/**
 * Undo of a removed team join: the person goes back into the company as a team member, and
 * the audit says so (admin_add_org_member writes no review_log row itself): one 'join_restored'
 * row on the removed membership, next to its 'join_revoked'.
 */
export async function addOrgMemberBack(userId: string, orgId: string, memberId: string): Promise<void> {
  const { error } = await supabase.rpc('admin_add_org_member', { p_user_id: userId, p_org_id: orgId, p_role: 'collaborator' });
  if (error) throw fromPg(error);
  await supabase
    .rpc('review_log_add', {
      p_subject_type: 'join',
      p_subject_id: memberId,
      p_action: 'join_restored',
      p_note: null,
      p_details: { source: 'review_queue_v2', organization_id: orgId, user_id: userId },
    })
    .then(() => undefined, () => undefined);
}

export type DismissKind = 'team_join' | 'retro' | 'duplicate_org' | 'duplicate_person';

export async function dismissCard(kind: DismissKind, id: string, otherId?: string | null, note?: string): Promise<void> {
  const { error } = await supabase.rpc('admin_review_dismiss', {
    p_kind: kind, p_id: id, p_other_id: otherId ?? null, p_note: note?.trim() || null,
  });
  if (error) throw fromPg(error);
}

/** Hides `orgId` from the directory as a duplicate of `keepId` (null = shown again). */
export async function markDuplicateOrg(orgId: string, keepId: string | null, note?: string): Promise<void> {
  const { error } = await supabase.rpc('admin_mark_duplicate_org', {
    p_org_id: orgId, p_duplicate_of: keepId, p_note: note?.trim() || null,
  });
  if (error) throw fromPg(error);
}

/* ------------------------------------------------------------------ lookups */

export interface OrgCandidate {
  id: string;
  name: string;
  slug: string | null;
  organization_type: string | null;
  access_status: string | null;
  country: string | null;
  website: string | null;
  logo_url: string | null;
  score: number | null;
  reasons: string[];
  sm26_linked: boolean;
  has_owner: boolean;
  members: number | null;
}

/**
 * A listed company this close to the one M3 is about to create is shown above the create
 * form, and creating anyway needs "This is a different company" ticked (org_match_candidates
 * lists from 0.55; the server's org_exists only catches an identical normalised name).
 */
export const NEAR_MATCH_SCORE = 0.55;

export async function orgCandidates(q: { name?: string | null; website?: string | null; email?: string | null; country?: string | null }): Promise<OrgCandidate[]> {
  const name = (q.name ?? '').trim();
  const website = (q.website ?? '').trim();
  const email = (q.email ?? '').trim();
  if (!name && !website && !email) return [];
  const { data, error } = await supabase.rpc('org_match_candidates', {
    p_name: name || null,
    p_website: website || null,
    p_email: email || null,
    p_country: (q.country ?? '').trim() || null,
  });
  if (error) throw fromPg(error);
  return ((Array.isArray(data) ? data : []) as Record<string, unknown>[])
    .filter(r => typeof r.id === 'string')
    .map(r => ({
      id: r.id as string,
      name: typeof r.name === 'string' && r.name ? r.name : '—',
      slug: typeof r.slug === 'string' ? r.slug : null,
      organization_type: typeof r.organization_type === 'string' ? r.organization_type : null,
      access_status: typeof r.access_status === 'string' ? r.access_status : null,
      country: typeof r.country === 'string' ? r.country : null,
      website: typeof r.website === 'string' ? r.website : null,
      logo_url: typeof r.logo_url === 'string' ? r.logo_url : null,
      score: typeof r.score === 'number' ? r.score : typeof r.score === 'string' ? Number(r.score) : null,
      reasons: Array.isArray(r.reasons) ? (r.reasons as unknown[]).filter((x): x is string => typeof x === 'string') : [],
      sm26_linked: r.sm26_linked === true,
      has_owner: r.has_owner === true,
      members: typeof r.members === 'number' ? r.members : null,
    }));
}

export interface PersonCandidate {
  source: string;
  id: string | null;
  user_id: string | null;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  status: string | null;
  match: string | null;
  score: number | null;
}

export async function personCandidates(q: { email?: string | null; first?: string | null; last?: string | null; company?: string | null }): Promise<PersonCandidate[]> {
  if (!(q.email ?? '').trim() && !(q.first ?? '').trim() && !(q.last ?? '').trim()) return [];
  const { data, error } = await supabase.rpc('person_match_candidates', {
    p_email: (q.email ?? '').trim() || null,
    p_first: (q.first ?? '').trim() || null,
    p_last: (q.last ?? '').trim() || null,
    p_company: (q.company ?? '').trim() || null,
  });
  if (error) throw fromPg(error);
  const s = (v: unknown) => (typeof v === 'string' && v ? v : null);
  return ((Array.isArray(data) ? data : []) as Record<string, unknown>[]).map(r => ({
    source: s(r.source) ?? 'account',
    id: s(r.id),
    user_id: s(r.user_id),
    email: s(r.email),
    first_name: s(r.first_name),
    last_name: s(r.last_name),
    company: s(r.company),
    status: s(r.status),
    match: s(r.match),
    score: typeof r.score === 'number' ? r.score : typeof r.score === 'string' ? Number(r.score) : null,
  }));
}

/* ------------------------------------------------------------------ registrations */

export type RegDecision = 'approve' | 'reject' | 'waitlist' | 'request_info';

export interface RegDecisionResult {
  /** Registrations whose status changed. */
  changed: number;
  sent: number;
  failed: number;
  /**
   * A capacity refusal: `remaining` (the ids not sent yet, the refused batch included) were
   * not decided; ask before going over. Earlier batches may have gone through (`changed`).
   */
  capacity?: { held: number; capacity: number; adding: number; remaining: string[] };
  /** A later batch failed with this code after earlier ones went through (`changed`). */
  stopped?: string;
}

/** The registration function takes 200 registrations per decision (gl_decide_v2). */
export const MAX_DECIDE_IDS = 200;

/**
 * A decision on core_v2 registrations (registration function, gl_decide_v2: one transaction,
 * one review_log row per change). `orgAction` / `validatePerson` are M3's choices for the
 * account the on-site confirmation creates (provisioning job); ignored for webinars.
 */
export async function decideRegistrationV2(
  glEventId: string,
  guestIds: string[],
  decision: RegDecision,
  opts: { orgAction?: OrgAction; validatePerson?: boolean; infoRequest?: string; notify?: boolean; force?: boolean } = {},
): Promise<RegDecisionResult> {
  let changed = 0;
  let sent = 0;
  let failed = 0;
  for (let i = 0; i < guestIds.length; i += MAX_DECIDE_IDS) {
    const res = await registrationStaff<{ ok?: boolean; changed?: string[]; sent?: number; failed?: number; held?: number; capacity?: number; adding?: number }>({
      action: 'decide',
      gl_event_id: glEventId,
      guest_ids: guestIds.slice(i, i + MAX_DECIDE_IDS),
      decision,
      org_action: opts.orgAction ?? { mode: 'none' },
      validate_person: opts.validatePerson !== false,
      info_request: decision === 'request_info' ? (opts.infoRequest ?? '').trim() : undefined,
      notify: opts.notify,
      force: opts.force || undefined,
    });
    if (res.error === 'capacity' || res.error === 'ticket_capacity') {
      const remaining = guestIds.slice(i);
      return {
        changed, sent, failed,
        capacity: { held: Number(res.held ?? 0), capacity: Number(res.capacity ?? 0), adding: Number(res.adding ?? remaining.length), remaining },
      };
    }
    if (res.error || res.ok !== true) {
      if (changed) return { changed, sent, failed, stopped: res.error || 'unknown' };
      throw new ReviewError(res.error || 'unknown');
    }
    changed += res.changed?.length ?? 0;
    sent += Number(res.sent ?? 0);
    failed += Number(res.failed ?? 0);
  }
  return { changed, sent, failed };
}

/**
 * guest-list approves and e-mails one guest after the other inside ONE request: a few dozen
 * per call keeps each call well inside the function's time limit (the body of each call is
 * the unchanged one; only the list is shorter).
 */
export const GUEST_LIST_BATCH = 25;

type GuestState = { id: string; status: string | null; decided_by: string | null };

async function guestStates(ids: string[]): Promise<Map<string, GuestState> | null> {
  const { data, error } = await supabase.from('gl_guest').select('id, status, decided_by').in('id', ids);
  if (error || !Array.isArray(data)) return null;
  return new Map((data as GuestState[]).map(g => [g.id, g]));
}

/**
 * A decision on a guest-list event (wys26): the guest-list function's `decide`, exactly the
 * call of /admin/guest-list/<slug> (staff session; `force` goes over capacity after a yes),
 * sent GUEST_LIST_BATCH guests at a time. Each decision is then noted in review_log
 * (review_log_add), as queue v1 does, but only for the guests THIS call decided: the rows
 * that were 'requested' just before and are now in the target status with this staff member
 * as decided_by (guest-list skips, without saying which, those someone else decided).
 */
export async function decideGuestList(
  slug: string,
  guestIds: string[],
  decision: 'approve' | 'reject',
  opts: { force?: boolean; notify?: boolean; glEventId?: string | null; actorId?: string | null } = {},
): Promise<RegDecisionResult> {
  const extra: Record<string, unknown> = {};
  if (decision === 'approve' && opts.force) extra.force = true;
  if (decision === 'reject') extra.notify = opts.notify === true;
  const target = decision === 'approve' ? 'confirmed' : 'rejected';
  let changed = 0;
  let sent = 0;
  let failed = 0;
  for (let i = 0; i < guestIds.length; i += GUEST_LIST_BATCH) {
    const batch = guestIds.slice(i, i + GUEST_LIST_BATCH);
    const before = await guestStates(batch);
    const r = await guestList<{ approved?: number; rejected?: number; sent?: number; failed?: number; held?: number; capacity?: number; adding?: number }>({
      action: 'decide', slug, guest_ids: batch, decision, ...extra,
    });
    if (r.error === 'capacity') {
      const remaining = guestIds.slice(i);
      return { changed, sent, failed, capacity: { held: Number(r.held ?? 0), capacity: Number(r.capacity ?? 0), adding: Number(r.adding ?? batch.length), remaining } };
    }
    if (r.error) {
      // Earlier batches went through: say so rather than lose them.
      if (changed) return { changed, sent, failed, stopped: r.error };
      throw new ReviewError(r.error);
    }
    const n = decision === 'approve' ? Number(r.approved ?? 0) : Number(r.rejected ?? 0);
    changed += n;
    sent += Number(r.sent ?? 0);
    failed += Number(r.failed ?? 0);
    if (n <= 0) continue;
    const after = await guestStates(batch);
    const decidedHere = batch.filter(id => {
      const was = before?.get(id);
      const now = after?.get(id);
      // Unknown (a read failed): logged only when the whole batch changed, as before.
      if (!before || !after) return n === batch.length;
      return was?.status === 'requested' && now?.status === target && (!opts.actorId || now?.decided_by === opts.actorId);
    });
    for (const id of decidedHere) {
      void supabase
        .rpc('review_log_add', {
          p_subject_type: 'registration',
          p_subject_id: id,
          p_action: decision,
          p_note: null,
          p_details: {
            source: 'review_queue_v2',
            gl_event_id: opts.glEventId ?? null,
            status: target,
            forced: opts.force || undefined,
            notify: decision === 'reject' ? opts.notify === true : undefined,
            mails_failed: Number(r.failed ?? 0) || undefined,
          },
        })
        .then(() => undefined, () => undefined);
    }
  }
  return { changed, sent, failed };
}

/** The account choices of an on-site registration (gl_guest, staff RLS): for the company lookup. */
export async function loadGuestIdentity(guestId: string): Promise<{ company: string | null; job_title: string | null; country: string | null; email: string | null; first_name: string | null; last_name: string | null } | null> {
  const { data, error } = await supabase
    .from('gl_guest')
    .select('company, job_title, country, email, first_name, last_name')
    .eq('id', guestId)
    .maybeSingle();
  if (error || !data) return null;
  return data as { company: string | null; job_title: string | null; country: string | null; email: string | null; first_name: string | null; last_name: string | null };
}

/** kind / hidden / engine of the events in the list (staff RLS on gl_event). */
export async function loadEventKinds(ids: string[]): Promise<Record<string, { kind: string | null; hidden: boolean; engine: string | null }>> {
  if (!ids.length) return {};
  const { data, error } = await supabase.from('gl_event').select('id, kind, hidden, engine').in('id', ids);
  if (error || !Array.isArray(data)) return {};
  const out: Record<string, { kind: string | null; hidden: boolean; engine: string | null }> = {};
  for (const r of data as { id: string; kind?: string | null; hidden?: boolean | null; engine?: string | null }[]) {
    out[r.id] = { kind: r.kind ?? null, hidden: r.hidden === true, engine: r.engine ?? null };
  }
  return out;
}

/* ------------------------------------------------------------------ open company requests of a person */

export interface OpenRequest {
  id: string;
  kind: 'claim' | 'join';
  organization_id: string;
  org_name: string | null;
  created_at: string | null;
}

/**
 * The person's open claim (claim_requested: M3 decides it, admin_decide_claim) or join request
 * (join_requested: the company's owner decides it), filed on their login address by
 * complete_signup_for. Admins read organization_invitations (RLS admins_can_view_invitations).
 * Null when it could not be read.
 */
export async function loadOpenRequests(emails: (string | null | undefined)[]): Promise<OpenRequest[] | null> {
  const list = [...new Set(emails.map(e => (e ?? '').trim().toLowerCase()).filter(Boolean))];
  if (!list.length) return [];
  const { data, error } = await supabase
    .from('organization_invitations')
    .select('id, status, organization_id, created_at, email')
    .in('status', ['claim_requested', 'join_requested'])
    .in('email', list);
  if (error || !Array.isArray(data)) return null;
  const rows = data as { id: string; status: string; organization_id: string; created_at: string | null }[];
  const orgIds = [...new Set(rows.map(r => r.organization_id).filter(Boolean))];
  const names = new Map<string, string>();
  if (orgIds.length) {
    const { data: orgs } = await supabase.from('organizations').select('id, name').in('id', orgIds);
    for (const o of (orgs ?? []) as { id: string; name: string | null }[]) if (o.name) names.set(o.id, o.name);
  }
  return rows.map(r => ({
    id: r.id,
    kind: r.status === 'claim_requested' ? 'claim' as const : 'join' as const,
    organization_id: r.organization_id,
    org_name: names.get(r.organization_id) ?? null,
    created_at: r.created_at,
  }));
}

/* ------------------------------------------------------------------ e-mail sender switch */

/**
 * registration_flags.outbox_sender, read through src/lib/flags.ts like every switch: while it
 * is not JSON true, the e-mails of M3's decisions (validated, not accepted, a question, claim
 * approved or declined) wait in notification_outbox and nobody receives them. The pages say
 * so instead of "they will receive an e-mail". Null = not read yet, or the read failed (the
 * pages then say "queued", never "sent").
 */
export async function readOutboxSender(force = false): Promise<boolean | null> {
  const flags = await readRegistrationFlags(force);
  return flags ? flags.outbox_sender : null;
}

/** The sender switch for a component: null until read (or while the read failed). */
export function useOutboxSender(): boolean | null {
  const { flags, ready, failed } = useRegistrationFlags();
  return ready && !failed ? flags.outbox_sender : null;
}

/** "They will receive an e-mail", or where it waits while the sender is off (or unknown). */
export function decisionMailText(t: TFunction, senderOn: boolean | null): string {
  return senderOn === true
    ? t('adminValidate.done.mail', 'They will receive an e-mail.')
    : t('adminValidate.done.mailQueued', 'Their e-mail is queued: it leaves once "Send the e-mails queued by sign-ups and M3\'s decisions" is on (Platform settings).');
}

/* ------------------------------------------------------------------ content */

/** Closes a reported conversation: the same staff update as the reports panel (queue v1). */
export async function closeReport(id: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('conversation_reports')
    .update({ status: 'closed' })
    .eq('id', id)
    .eq('status', 'open')
    .select('id');
  if (error) throw fromPg(error);
  return !!data?.length;
}
