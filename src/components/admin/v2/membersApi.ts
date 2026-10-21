import { supabase } from '@/lib/supabase';

/**
 * Admin redesign, "Members" (Victor, 21 Oct 2026): every read of the Companies list, the company
 * page and the person page, in one place. Rule of the section: VIEW everywhere, ACT in one place.
 * Registrations, requests, reports and sponsoring are read here and only LINK to the screen that
 * manages them ("Manage in the event ->"). The writes this section owns (members, page address,
 * visibility, notes, account) are in the pages themselves and use the existing admin calls.
 *
 * Tables and calls (staff session; RLS decides, a refused read shows a note, never a crash):
 *   organizations (never claim_code: select=* is refused, audit S2), organization_members,
 *   profiles, organization_invitations, event_registrations + events, gl_guest + gl_event,
 *   sm_registration + sm_event (READ ONLY, SM26 is frozen), rfps, consultations, marina_projects,
 *   partner_leads, partner_requests, conversation_reports, sp_sponsor, sp_agreement,
 *   commercial_invoices, organization_audit_log (staff read: migration 20261021161000),
 *   review_log, org_admin_note (migration 20261021161000), newsletter_subscribers, admin_user_orgs.
 */

/* ------------------------------------------------------------------ helpers */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Only plain addresses go into a PostgREST filter (no quotes, commas or brackets to escape).
const SAFE_EMAIL_RE = /^[^\s",()\\]+@[^\s",()\\]+$/;

const uuids = (ids: (string | null | undefined)[]) => [...new Set(ids.filter((x): x is string => !!x && UUID_RE.test(x)))];
const emails = (list: (string | null | undefined)[]) =>
  [...new Set(list.map(e => (e ?? '').trim().toLowerCase()).filter(e => SAFE_EMAIL_RE.test(e)))];

/** `a.eq.x,b.in.(y,z)` for .or(), skipping empty parts. Null when there is nothing to match. */
function orFilter(parts: (string | null)[]): string | null {
  const p = parts.filter(Boolean) as string[];
  return p.length ? p.join(',') : null;
}
const inIds = (col: string, ids: string[]) => (ids.length ? `${col}.in.(${ids.join(',')})` : null);
const inEmails = (col: string, list: string[]) => (list.length ? `${col}.in.(${list.map(e => `"${e}"`).join(',')})` : null);
const eqId = (col: string, id: string | null | undefined) => (id && UUID_RE.test(id) ? `${col}.eq.${id}` : null);

export function personName(p: { first_name?: string | null; last_name?: string | null; email?: string | null } | null | undefined): string {
  const n = [p?.first_name, p?.last_name].filter(Boolean).join(' ').trim();
  return n || p?.email?.split('@')[0] || 'Unnamed person';
}

export const TYPE_LABEL: Record<string, string> = {
  marina: 'Marina',
  partner: 'Service provider',
  media_partner: 'Media',
  developer: 'Developer',
  investor: 'Investor',
  individual: 'Individual',
};

export function fmtDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** A scope: one company and its people, or one person. */
export interface Scope {
  orgId: string | null;
  userIds: string[];
  emails: string[];
}

export type Loaded<T> = { rows: T; error: string | null };

/* ------------------------------------------------------------------ the list */

export interface DirectoryRow {
  kind: 'company' | 'individual';
  id: string;
  name: string;
  type: string | null;
  status: string;
  tier: string | null;
  country: string | null;
  city: string | null;
  members: number;
  contactName: string | null;
  contactEmail: string | null;
  domain: string | null;
  logoUrl: string | null;
  archived: boolean;
  duplicate: boolean;
  createdAt: string;
  href: string;
}

/** Every company, plus every person who belongs to none (staff excluded), as one list. */
export async function loadDirectory(): Promise<DirectoryRow[]> {
  const [orgRes, memRes, profRes] = await Promise.all([
    supabase.from('organizations')
      .select('id, name, slug, primary_domain, organization_type, tier, logo_url, country, city, access_status, created_at, owner_user_id, archived_at, duplicate_of')
      .order('name'),
    supabase.from('organization_members').select('organization_id, user_id'),
    supabase.from('profiles').select('user_id, first_name, last_name, email, persona, access_status, country, created_at'),
  ]);
  if (orgRes.error) throw new Error(orgRes.error.message);
  type P = { user_id: string; first_name: string | null; last_name: string | null; email: string | null; persona: string | null; access_status: string | null; country: string | null; created_at: string };
  const profiles = (profRes.data ?? []) as P[];
  const byUser = new Map(profiles.map(p => [p.user_id, p]));
  const counts = new Map<string, number>();
  const inCompany = new Set<string>();
  for (const m of (memRes.data ?? []) as { organization_id: string; user_id: string }[]) {
    counts.set(m.organization_id, (counts.get(m.organization_id) ?? 0) + 1);
    inCompany.add(m.user_id);
  }
  const companies: DirectoryRow[] = ((orgRes.data ?? []) as Record<string, any>[]).map(o => {
    const owner = o.owner_user_id ? byUser.get(o.owner_user_id) : undefined;
    return {
      kind: 'company',
      id: o.id,
      name: o.name || 'Unnamed company',
      type: o.organization_type,
      status: o.access_status || 'pending',
      tier: o.tier,
      country: o.country,
      city: o.city,
      members: counts.get(o.id) ?? 0,
      contactName: owner ? personName(owner) : null,
      contactEmail: owner?.email ?? null,
      domain: o.primary_domain,
      logoUrl: o.logo_url,
      archived: !!o.archived_at,
      duplicate: !!o.duplicate_of,
      createdAt: o.created_at,
      href: `/admin/companies/${o.id}`,
    };
  });
  // Without the profiles (refused read) the list still shows the companies.
  const individuals: DirectoryRow[] = profRes.error ? [] : profiles
    .filter(p => !inCompany.has(p.user_id) && p.persona !== 'admin' && p.persona !== 'moderator')
    .map(p => ({
      kind: 'individual',
      id: p.user_id,
      name: personName(p),
      type: 'individual',
      status: p.access_status || 'pending',
      tier: null,
      country: p.country,
      city: null,
      members: 1,
      contactName: personName(p),
      contactEmail: p.email,
      domain: null,
      logoUrl: null,
      archived: false,
      duplicate: false,
      createdAt: p.created_at,
      href: `/admin/people/${p.user_id}`,
    }));
  return [...companies, ...individuals].sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
}

/** The CSV of the rows on screen (Excel opens it: BOM, quotes, formulas neutralised). */
export function directoryCsv(rows: DirectoryRow[], origin: string): string {
  const cell = (v: unknown) => {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const head = ['Name', 'Kind', 'Type', 'Status', 'Plan', 'Country', 'City', 'Members', 'Person in charge', 'E-mail', 'Created', 'Admin page'];
  const lines = rows.map(r => [
    r.name, r.kind === 'individual' ? 'Individual' : 'Company', r.type ? TYPE_LABEL[r.type] ?? r.type : '',
    r.archived ? 'archived' : r.duplicate ? 'duplicate' : r.status, r.tier ?? '', r.country ?? '', r.city ?? '', r.members,
    r.contactName ?? '', r.contactEmail ?? '', r.createdAt ? r.createdAt.slice(0, 10) : '', origin + r.href,
  ].map(cell).join(','));
  return '﻿' + [head.map(cell).join(','), ...lines].join('\r\n');
}

/* ------------------------------------------------------------------ one company */

export interface CompanyRecord {
  id: string;
  name: string;
  slug: string;
  primary_domain: string | null;
  organization_type: string | null;
  tier: string;
  logo_url: string | null;
  website: string | null;
  description: string | null;
  country: string | null;
  city: string | null;
  access_status: string;
  onboarding_status: string;
  featured_partner: boolean | null;
  is_event_media_partner: boolean | null;
  owner_user_id: string | null;
  archived_at: string | null;
  duplicate_of: string | null;
  created_at: string;
  updated_at: string;
}

export interface MemberRecord {
  id: string;
  user_id: string;
  role: string;
  joined_at: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  job_title: string | null;
  access_status: string | null;
}

export interface InvitationRecord {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  status: string;
  invited_by_user_id: string | null;
  created_at: string;
  updated_at: string | null;
}

const COMPANY_COLUMNS =
  'id, name, slug, primary_domain, organization_type, tier, logo_url, website, description, country, city, access_status, onboarding_status, featured_partner, is_event_media_partner, owner_user_id, archived_at, duplicate_of, created_at, updated_at';

export async function loadCompany(id: string): Promise<{ org: CompanyRecord | null; members: MemberRecord[]; invitations: InvitationRecord[] }> {
  const [orgRes, memRes, invRes] = await Promise.all([
    supabase.from('organizations').select(COMPANY_COLUMNS).eq('id', id).maybeSingle(),
    supabase.from('organization_members').select('id, user_id, role, joined_at').eq('organization_id', id).order('joined_at', { ascending: true }),
    supabase.from('organization_invitations')
      .select('id, email, first_name, last_name, status, invited_by_user_id, created_at, updated_at')
      .eq('organization_id', id).order('created_at', { ascending: false }),
  ]);
  if (orgRes.error) throw new Error(orgRes.error.message);
  const raw = (memRes.data ?? []) as { id: string; user_id: string; role: string; joined_at: string | null }[];
  const ids = uuids(raw.map(m => m.user_id));
  const { data: profs } = ids.length
    ? await supabase.from('profiles').select('user_id, first_name, last_name, email, job_title, access_status').in('user_id', ids)
    : { data: [] };
  const byUser = new Map(((profs ?? []) as Record<string, any>[]).map(p => [p.user_id as string, p]));
  const members: MemberRecord[] = raw.map(m => {
    const p = byUser.get(m.user_id) ?? {};
    return { ...m, first_name: p.first_name ?? null, last_name: p.last_name ?? null, email: p.email ?? null, job_title: p.job_title ?? null, access_status: p.access_status ?? null };
  });
  // Owner first, then by arrival.
  members.sort((a, b) => (a.role === 'owner' ? -1 : b.role === 'owner' ? 1 : 0));
  return { org: (orgRes.data as CompanyRecord | null) ?? null, members, invitations: (invRes.data ?? []) as InvitationRecord[] };
}

/* ------------------------------------------------------------------ registrations (read only) */

export interface RegistrationItem {
  key: string;
  system: 'Event' | 'Guest list' | 'Smart Marina 2026';
  event: string;
  eventDate: string | null;
  person: string;
  status: string;
  createdAt: string | null;
  /** The one screen that manages it. */
  manageTo: string | null;
  manageLabel: string;
}

/**
 * Every event registration of a scope, from the four registration systems: the catalogue
 * (event_registrations), the guest lists (gl_guest, guest_list_v1 = WYS) and the registration
 * core (gl_guest, core_v2), and Smart Marina 2026 (sm_registration, read only: frozen).
 */
export async function loadRegistrations(scope: Scope): Promise<Loaded<RegistrationItem[]>> {
  const userIds = uuids(scope.userIds);
  const mails = emails(scope.emails);
  const errors: string[] = [];
  const items: RegistrationItem[] = [];

  const catFilter = orFilter([eqId('organization_id', scope.orgId), inIds('user_id', userIds), inEmails('guest_email', mails)]);
  const glFilter = orFilter([eqId('organization_id', scope.orgId), inIds('user_id', userIds), inEmails('email', mails)]);
  const smFilter = orFilter([eqId('organization_id', scope.orgId), inIds('user_id', userIds), inEmails('email', mails)]);
  if (!catFilter) return { rows: [], error: null };

  const [cat, gl, sm] = await Promise.all([
    supabase.from('event_registrations')
      .select('id, event_id, user_id, created_at, registration_type, payment_status, guest_first_name, guest_last_name, guest_email')
      .or(catFilter).limit(500),
    glFilter ? supabase.from('gl_guest')
      .select('id, event_id, status, first_name, last_name, email, user_id, created_at, checked_in_at, conference, gala')
      .or(glFilter).limit(500) : Promise.resolve({ data: [], error: null }),
    smFilter ? supabase.from('sm_registration')
      .select('id, event_id, status, first_name, last_name, email, company_name, user_id, created_at')
      .or(smFilter).limit(500) : Promise.resolve({ data: [], error: null }),
  ]);

  const nameFor = new Map<string, string>();
  const peopleIds = uuids([
    ...((cat.data ?? []) as { user_id: string | null }[]).map(r => r.user_id),
  ]);
  if (peopleIds.length) {
    const { data } = await supabase.from('profiles').select('user_id, first_name, last_name, email').in('user_id', peopleIds);
    for (const p of (data ?? []) as Record<string, any>[]) nameFor.set(p.user_id, personName(p));
  }

  if (cat.error) errors.push('event registrations');
  const catRows = (cat.data ?? []) as Record<string, any>[];
  const evIds = uuids(catRows.map(r => r.event_id));
  const { data: evs } = evIds.length ? await supabase.from('events').select('id, title, date_time').in('id', evIds) : { data: [] };
  const evMap = new Map(((evs ?? []) as Record<string, any>[]).map(e => [e.id as string, e]));
  for (const r of catRows) {
    const ev = evMap.get(r.event_id);
    items.push({
      key: `cat:${r.id}`,
      system: 'Event',
      event: ev?.title ?? 'Event',
      eventDate: ev?.date_time ?? null,
      person: r.user_id ? nameFor.get(r.user_id) ?? 'A member' : personName({ first_name: r.guest_first_name, last_name: r.guest_last_name, email: r.guest_email }),
      status: r.payment_status || 'registered',
      createdAt: r.created_at,
      manageTo: r.event_id ? `/admin/events/${r.event_id}` : null,
      manageLabel: 'Manage in the event',
    });
  }

  if (gl.error) errors.push('guest lists');
  const glRows = (gl.data ?? []) as Record<string, any>[];
  const glIds = uuids(glRows.map(r => r.event_id));
  const { data: gls } = glIds.length ? await supabase.from('gl_event').select('id, slug, title, engine, legacy_event_id').in('id', glIds) : { data: [] };
  const glMap = new Map(((gls ?? []) as Record<string, any>[]).map(e => [e.id as string, e]));
  for (const r of glRows) {
    const ev = glMap.get(r.event_id);
    const core = ev?.engine === 'core_v2';
    items.push({
      key: `gl:${r.id}`,
      system: core ? 'Event' : 'Guest list',
      event: ev?.title ?? 'Event',
      eventDate: null,
      person: personName(r),
      status: r.checked_in_at ? 'checked in' : r.status || 'requested',
      createdAt: r.created_at,
      manageTo: !ev ? null : core ? `/admin/events/${ev.legacy_event_id ?? ev.id}` : `/admin/guest-list/${ev.slug}`,
      manageLabel: core ? 'Manage in the event' : 'Manage in the guest list',
    });
  }

  if (sm.error) errors.push('Smart Marina 2026');
  const smRows = (sm.data ?? []) as Record<string, any>[];
  const smIds = uuids(smRows.map(r => r.event_id));
  const { data: sms } = smIds.length ? await supabase.from('sm_event').select('id, name, start_date').in('id', smIds) : { data: [] };
  const smMap = new Map(((sms ?? []) as Record<string, any>[]).map(e => [e.id as string, e]));
  for (const r of smRows) {
    const ev = smMap.get(r.event_id);
    items.push({
      key: `sm:${r.id}`,
      system: 'Smart Marina 2026',
      event: ev?.name ?? 'Smart Marina',
      eventDate: ev?.start_date ?? null,
      person: personName(r),
      status: r.status || 'submitted',
      createdAt: r.created_at,
      manageTo: `/admin/sm26/${r.id}`,
      manageLabel: 'Open in Smart 26',
    });
  }

  items.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
  return { rows: items, error: errors.length ? `Could not read: ${errors.join(', ')}.` : null };
}

/* ------------------------------------------------------------------ requests (read only) */

export interface RequestItem {
  key: string;
  kind: 'RFP' | 'Project' | 'Consultation' | 'Lead';
  title: string;
  status: string;
  createdAt: string | null;
  to: string;
}

export async function loadRequests(scope: Scope): Promise<Loaded<RequestItem[]>> {
  const userIds = uuids(scope.userIds);
  const mails = emails(scope.emails);
  const byMarina = orFilter([eqId('organization_id', scope.orgId), inIds('marina_user_id', userIds)]);
  const byUser = orFilter([eqId('organization_id', scope.orgId), inIds('user_id', userIds)]);
  if (!byMarina || !byUser) return { rows: [], error: null };
  const [rfps, cons, projs, leads] = await Promise.all([
    supabase.from('rfps').select('id, title, status, created_at').or(byMarina).limit(200),
    supabase.from('consultations').select('id, title, status, created_at').or(byMarina).limit(200),
    supabase.from('marina_projects').select('id, project_type, status, created_at').or(byUser).limit(200),
    mails.length ? supabase.from('partner_leads').select('id, company, status, created_at').in('email', mails).limit(200) : Promise.resolve({ data: [], error: null }),
  ]);
  const items: RequestItem[] = [
    ...((rfps.data ?? []) as Record<string, any>[]).map(r => ({ key: `rfp:${r.id}`, kind: 'RFP' as const, title: r.title || 'Request for proposals', status: r.status, createdAt: r.created_at, to: `/admin/rfps/${r.id}` })),
    ...((cons.data ?? []) as Record<string, any>[]).map(r => ({ key: `con:${r.id}`, kind: 'Consultation' as const, title: r.title || 'Consultation', status: r.status, createdAt: r.created_at, to: `/admin/consultations/${r.id}` })),
    ...((projs.data ?? []) as Record<string, any>[]).map(r => ({ key: `prj:${r.id}`, kind: 'Project' as const, title: sentence(String(r.project_type || 'project')), status: r.status, createdAt: r.created_at, to: `/admin/projects/${r.id}` })),
    ...((leads.data ?? []) as Record<string, any>[]).map(r => ({ key: `lead:${r.id}`, kind: 'Lead' as const, title: r.company || 'Partner lead', status: r.status, createdAt: r.created_at, to: `/admin/leads/${r.id}` })),
  ].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
  const failed = [rfps.error && 'RFPs', cons.error && 'consultations', projs.error && 'projects', leads.error && 'leads'].filter(Boolean);
  return { rows: items, error: failed.length ? `Could not read: ${failed.join(', ')}.` : null };
}

/* ------------------------------------------------------------------ reported conversations */

export interface ReportItem {
  id: string;
  reason: string | null;
  excerpt: string | null;
  status: string;
  createdAt: string;
  reportedByScope: boolean;
}

export async function loadReports(scope: Scope): Promise<Loaded<{ reports: ReportItem[]; conversations: number }>> {
  const userIds = uuids(scope.userIds);
  const convFilter = orFilter([
    eqId('partner_organization_id', scope.orgId), eqId('marina_organization_id', scope.orgId),
    inIds('partner_user_id', userIds), inIds('marina_user_id', userIds),
  ]);
  if (!convFilter) return { rows: { reports: [], conversations: 0 }, error: null };
  const conv = await supabase.from('partner_requests').select('id').or(convFilter).limit(1000);
  const convIds = uuids(((conv.data ?? []) as { id: string }[]).map(c => c.id));
  const repFilter = orFilter([eqId('reporter_org_id', scope.orgId), inIds('reporter_user_id', userIds), inIds('partner_request_id', convIds.slice(0, 300))]);
  const rep = repFilter
    ? await supabase.from('conversation_reports').select('id, reason, excerpt, status, created_at, reporter_user_id, reporter_org_id').or(repFilter).order('created_at', { ascending: false }).limit(200)
    : { data: [], error: null };
  const mine = new Set(userIds);
  const reports = ((rep.data ?? []) as Record<string, any>[]).map(r => ({
    id: r.id,
    reason: r.reason,
    excerpt: r.excerpt,
    status: r.status,
    createdAt: r.created_at,
    reportedByScope: (!!scope.orgId && r.reporter_org_id === scope.orgId) || mine.has(r.reporter_user_id),
  }));
  return { rows: { reports, conversations: convIds.length }, error: conv.error || rep.error ? 'Could not read the conversations.' : null };
}

/* ------------------------------------------------------------------ sponsoring (read only) */

export interface SponsoringData {
  sponsors: { id: string; company_name: string | null; status: string | null }[];
  agreements: { id: string; sponsor_id: string; tier_key: string | null; status: string | null; term_start: string | null; term_end: string | null; negotiated_fee_cents: number | null; currency: string | null }[];
  invoices: { id: string; invoice_number: string | null; display_status: string | null; total_amount: number | null; balance_due: number | null; currency_code: string | null; invoice_date: string | null }[];
}

export async function loadSponsoring(orgId: string): Promise<Loaded<SponsoringData>> {
  const [sp, inv] = await Promise.all([
    supabase.from('sp_sponsor').select('id, company_name, status').eq('organization_id', orgId),
    supabase.from('commercial_invoices').select('id, invoice_number, display_status, total_amount, balance_due, currency_code, invoice_date').eq('organization_id', orgId).order('invoice_date', { ascending: false }).limit(100),
  ]);
  const sponsors = (sp.data ?? []) as SponsoringData['sponsors'];
  const ids = uuids(sponsors.map(s => s.id));
  const ag = ids.length
    ? await supabase.from('sp_agreement').select('id, sponsor_id, tier_key, status, term_start, term_end, negotiated_fee_cents, currency').in('sponsor_id', ids).order('term_start', { ascending: false })
    : { data: [], error: null };
  const failed = [sp.error && 'sponsor records', ag.error && 'contracts', inv.error && 'invoices'].filter(Boolean);
  return {
    rows: { sponsors, agreements: (ag.data ?? []) as SponsoringData['agreements'], invoices: (inv.data ?? []) as SponsoringData['invoices'] },
    error: failed.length ? `Could not read: ${failed.join(', ')}.` : null,
  };
}

export function money(amount: number | null | undefined, currency: string | null | undefined, cents = false): string {
  if (amount === null || amount === undefined) return '—';
  const v = cents ? amount / 100 : amount;
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: currency || 'EUR', maximumFractionDigits: 0 }).format(v);
  } catch {
    return `${v} ${currency ?? ''}`.trim();
  }
}

/* ------------------------------------------------------------------ history */

export interface HistoryItem {
  key: string;
  at: string;
  what: string;
  detail: string | null;
  actor: string | null;
}

const AUDIT_LABEL: Record<string, string> = {
  organization_created: 'Company created',
  organization_auto_verified: 'Company verified automatically',
  ownership_transferred: 'Person in charge changed',
  manual_org_soft_merge_snapshot_v1: 'Merged with a duplicate (by M3)',
  manual_person_name_correction_snapshot_v1: 'A name corrected (by M3)',
};

const INVITE_LABEL: Record<string, string> = {
  pending: 'Invited to join',
  accepted: 'Joined the company',
  join_requested: 'Asked to join',
  claim_requested: 'Asked to take over the company page',
  rejected: 'Request refused',
  cancelled: 'Invitation cancelled',
  expired: 'Invitation expired',
};

function sentence(s: string): string {
  const t = s.replace(/_/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * One timeline from the logs the database already keeps: organization_audit_log (staff read
 * since migration 20261021161000; before it, only what the owner could read: nothing),
 * review_log (M3's decisions on the company, its people and their join requests) and the
 * company's invitations and join requests.
 */
export async function loadHistory(scope: Scope, invitations: InvitationRecord[] = []): Promise<Loaded<HistoryItem[]>> {
  const userIds = uuids(scope.userIds);
  const subjects = uuids([scope.orgId, ...userIds, ...invitations.map(i => i.id)]);
  const [audit, review] = await Promise.all([
    scope.orgId
      ? supabase.from('organization_audit_log').select('id, actor_user_id, event_type, created_at').eq('organization_id', scope.orgId).order('created_at', { ascending: false }).limit(200)
      : Promise.resolve({ data: [], error: null }),
    subjects.length
      ? supabase.from('review_log').select('id, subject_type, action, note, actor_id, created_at').in('subject_id', subjects.slice(0, 300)).order('created_at', { ascending: false }).limit(300)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const auditRows = (audit.data ?? []) as Record<string, any>[];
  const reviewRows = (review.data ?? []) as Record<string, any>[];
  const actors = uuids([...auditRows.map(r => r.actor_user_id), ...reviewRows.map(r => r.actor_id)]);
  const names = new Map<string, string>();
  if (actors.length) {
    const { data } = await supabase.from('profiles').select('user_id, first_name, last_name, email').in('user_id', actors);
    for (const p of (data ?? []) as Record<string, any>[]) names.set(p.user_id, personName(p));
  }
  const items: HistoryItem[] = [
    ...auditRows.map(r => ({ key: `a:${r.id}`, at: r.created_at, what: AUDIT_LABEL[r.event_type] ?? sentence(r.event_type), detail: null, actor: r.actor_user_id ? names.get(r.actor_user_id) ?? 'Someone' : null })),
    ...reviewRows.map(r => ({ key: `r:${r.id}`, at: r.created_at, what: sentence(r.action), detail: r.note || null, actor: r.actor_id ? names.get(r.actor_id) ?? 'M3' : null })),
    ...invitations.map(i => ({
      key: `i:${i.id}`,
      at: i.updated_at || i.created_at,
      what: INVITE_LABEL[i.status] ?? sentence(i.status),
      detail: [i.first_name, i.last_name].filter(Boolean).join(' ') || i.email,
      actor: null,
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  return { rows: items, error: audit.error || review.error ? 'Part of the history could not be read.' : null };
}

/* ------------------------------------------------------------------ internal notes */

export interface NoteItem {
  id: string;
  body: string;
  author_id: string | null;
  author: string;
  created_at: string;
}

/** 'missing' until migration 20261021161000 is applied (the table does not exist yet). */
export async function loadNotes(subject: { orgId?: string | null; userId?: string | null }): Promise<{ rows: NoteItem[]; state: 'ok' | 'missing' | 'error' }> {
  let q = supabase.from('org_admin_note').select('id, body, author_id, created_at').order('created_at', { ascending: false }).limit(200);
  q = subject.orgId ? q.eq('organization_id', subject.orgId) : q.eq('user_id', subject.userId ?? '');
  const { data, error } = await q;
  if (error) return { rows: [], state: error.code === '42P01' || error.code === 'PGRST205' ? 'missing' : 'error' };
  const rows = (data ?? []) as { id: string; body: string; author_id: string | null; created_at: string }[];
  const ids = uuids(rows.map(r => r.author_id));
  const names = new Map<string, string>();
  if (ids.length) {
    const { data: ps } = await supabase.from('profiles').select('user_id, first_name, last_name, email').in('user_id', ids);
    for (const p of (ps ?? []) as Record<string, any>[]) names.set(p.user_id, personName(p));
  }
  return { rows: rows.map(r => ({ ...r, author: r.author_id ? names.get(r.author_id) ?? 'M3' : 'M3' })), state: 'ok' };
}

export async function addNote(subject: { orgId?: string | null; userId?: string | null }, body: string, authorId: string): Promise<void> {
  const row = subject.orgId ? { organization_id: subject.orgId, body: body.trim(), author_id: authorId } : { user_id: subject.userId, body: body.trim(), author_id: authorId };
  const { error } = await supabase.from('org_admin_note').insert(row);
  if (error) throw new Error(error.message);
}

export async function deleteNote(id: string): Promise<void> {
  const { error } = await supabase.from('org_admin_note').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/* ------------------------------------------------------------------ members' actions */

/** M3 answers a join request (migration 20261021161000). */
export async function decideJoinRequest(invitationId: string, approve: boolean): Promise<void> {
  const { error } = await supabase.rpc('admin_decide_join_request', { p_invitation_id: invitationId, p_approve: approve, p_note: null });
  if (error) {
    if (error.code === 'PGRST202' || error.code === '42883') throw new Error('This button is not set up yet (database update pending). The owner can still answer from their dashboard.');
    throw new Error(error.message);
  }
}

/* ------------------------------------------------------------------ the person */

export interface PersonRecord {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  persona: string;
  access_status: string;
  onboarding_status: string | null;
  job_title: string | null;
  country: string | null;
  phone: string | null;
  created_at: string;
  email_proven_at: string | null;
  notification_prefs: Record<string, unknown> | null;
}

export async function loadPerson(userId: string): Promise<{ person: PersonRecord | null; companies: { org_id: string; org_name: string; role: string }[]; newsletter: { mailchimp_status: string | null; first_consented_at: string | null; source: string | null } | null | 'unknown' }> {
  const { data, error } = await supabase.from('profiles')
    .select('user_id, first_name, last_name, email, persona, access_status, onboarding_status, job_title, country, phone, created_at, email_proven_at, notification_prefs')
    .eq('user_id', userId).maybeSingle();
  if (error) throw new Error(error.message);
  const person = (data as PersonRecord | null) ?? null;
  const [orgs, news] = await Promise.all([
    supabase.rpc('admin_user_orgs', { p_user_id: userId }),
    person?.email && SAFE_EMAIL_RE.test(person.email.trim().toLowerCase())
      ? supabase.from('newsletter_subscribers').select('mailchimp_status, first_consented_at, source').eq('email', person.email.trim().toLowerCase()).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  return {
    person,
    companies: (orgs.data ?? []) as { org_id: string; org_name: string; role: string }[],
    newsletter: news.error ? 'unknown' : ((news.data as { mailchimp_status: string | null; first_consented_at: string | null; source: string | null } | null) ?? null),
  };
}
