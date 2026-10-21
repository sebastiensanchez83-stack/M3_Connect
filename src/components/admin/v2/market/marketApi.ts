import { supabase } from '@/lib/supabase';
import { isWaiting, KIND_LABEL, projectTitle, statusName, type RequestKind } from './marketKinds';

/**
 * Admin > Marina requests: the reads and the three actions (lane "market", 21 Oct 2026).
 *
 * Reads go straight to the tables through their staff policies (is_moderator()): rfps,
 * consultations, marina_projects, partner_leads, profiles, organizations, organization_members,
 * sectors, rfp_sectors, review_log (the history), notification_outbox (the e-mails),
 * platform_settings (is the e-mail sender on?).
 *
 * Every action goes through ONE staff-only database function (migration
 * 20261021175000_market_requests.sql), which also writes the history and queues the e-mail:
 *   admin_market_request_set_status(kind, id, status, message, notify)
 *   admin_market_request_edit(kind, id, changes)
 *   admin_market_request_note(kind, id, note)
 * After a status change that queued an e-mail, the page asks send-notification to send it at
 * once (fire and forget; registration-cron sends whatever is left a few minutes later).
 */

const MAX_ROWS = 1000;

export interface RequestRow {
  kind: RequestKind;
  id: string;
  title: string;
  /** The first words of what they wrote. */
  summary: string;
  status: string;
  createdAt: string;
  waiting: boolean;
  authorId: string | null;
  authorName: string | null;
  authorEmail: string | null;
  orgId: string | null;
  orgName: string | null;
  href: string;
}

export function requestHref(kind: RequestKind, id: string): string {
  return `/admin/requests/${kind}/${id}`;
}

function personName(p: { first_name?: string | null; last_name?: string | null; email?: string | null } | null | undefined): string | null {
  if (!p) return null;
  const n = [p.first_name, p.last_name].filter(Boolean).join(' ').trim();
  return n || p.email?.split('@')[0] || null;
}

function excerpt(text: string | null | undefined, max = 140): string {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

async function chunked<T>(ids: string[], read: (part: string[]) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await read(ids.slice(i, i + 200));
    if (error) throw error;
    out.push(...(data ?? []));
  }
  return out;
}

type Raw = Record<string, any>;

/** Names and companies of the people who sent requests (a request without organization_id: the author's company). */
async function resolvePeopleAndCompanies(authorIds: string[], orgIds: string[]) {
  const people = new Map<string, { name: string | null; email: string | null }>();
  const orgOfUser = new Map<string, string>();
  const orgs = new Map<string, Raw>();
  if (authorIds.length) {
    const [profiles, members] = await Promise.all([
      chunked<Raw>(authorIds, part => supabase.from('profiles').select('user_id, first_name, last_name, email').in('user_id', part)),
      chunked<Raw>(authorIds, part => supabase.from('organization_members').select('user_id, organization_id, role, joined_at').in('user_id', part)),
    ]);
    for (const p of profiles) people.set(p.user_id, { name: personName(p), email: p.email ?? null });
    // An owner's company first, then the oldest membership (organization_members has joined_at, no created_at).
    members
      .sort((a, b) => (a.role === 'owner' ? 0 : 1) - (b.role === 'owner' ? 0 : 1) || String(a.joined_at).localeCompare(String(b.joined_at)))
      .forEach(m => { if (m.organization_id && !orgOfUser.has(m.user_id)) orgOfUser.set(m.user_id, m.organization_id); });
  }
  const allOrgIds = [...new Set([...orgIds, ...orgOfUser.values()])];
  if (allOrgIds.length) {
    const rows = await chunked<Raw>(allOrgIds, part => supabase.from('organizations').select('id, name, slug, organization_type, access_status').in('id', part));
    for (const o of rows) orgs.set(o.id, o);
  }
  return { people, orgOfUser, orgs };
}

/** Every marina request of the four kinds, waiting ones first, then the newest. */
export async function loadRequests(): Promise<{ rows: RequestRow[]; problems: string[] }> {
  const problems: string[] = [];
  const read = async (label: string, q: PromiseLike<{ data: Raw[] | null; error: { message?: string } | null }>): Promise<Raw[]> => {
    const { data, error } = await q;
    if (error) { problems.push(`${label} could not be read (${error.message ?? 'error'}).`); return []; }
    return data ?? [];
  };
  const [rfps, cons, projs, leads] = await Promise.all([
    read('Requests for proposals', supabase.from('rfps').select('id, title, scope, status, created_at, marina_user_id, organization_id').order('created_at', { ascending: false }).limit(MAX_ROWS)),
    read('Consultations', supabase.from('consultations').select('id, title, description, status, created_at, marina_user_id, organization_id').order('created_at', { ascending: false }).limit(MAX_ROWS)),
    read('Marina projects', supabase.from('marina_projects').select('id, project_type, description, status, created_at, user_id, organization_id').order('created_at', { ascending: false }).limit(MAX_ROWS)),
    read('Partner leads', supabase.from('partner_leads').select('id, company, first_name, last_name, email, goals, status, created_at').order('created_at', { ascending: false }).limit(MAX_ROWS)),
  ]);

  const authorIds = [...new Set([...rfps.map(r => r.marina_user_id), ...cons.map(r => r.marina_user_id), ...projs.map(r => r.user_id)].filter(Boolean))] as string[];
  const orgIds = [...new Set([...rfps, ...cons, ...projs].map(r => r.organization_id).filter(Boolean))] as string[];
  let resolved: Awaited<ReturnType<typeof resolvePeopleAndCompanies>> = { people: new Map(), orgOfUser: new Map(), orgs: new Map() };
  try {
    resolved = await resolvePeopleAndCompanies(authorIds, orgIds);
  } catch (e) {
    problems.push(`Names and companies could not be read (${e instanceof Error ? e.message : 'error'}).`);
  }
  const { people, orgOfUser, orgs } = resolved;

  const row = (kind: RequestKind, r: Raw, title: string, summary: string, authorId: string | null): RequestRow => {
    const orgId = r.organization_id || (authorId ? orgOfUser.get(authorId) : null) || null;
    const person = authorId ? people.get(authorId) : undefined;
    return {
      kind, id: r.id, title, summary, status: r.status ?? '', createdAt: r.created_at, waiting: isWaiting(kind, r.status),
      authorId, authorName: person?.name ?? null, authorEmail: person?.email ?? null,
      orgId, orgName: orgId ? orgs.get(orgId)?.name ?? null : null,
      href: requestHref(kind, r.id),
    };
  };
  const rows: RequestRow[] = [
    ...rfps.map(r => row('rfp', r, r.title || 'Request for proposals', excerpt(r.scope), r.marina_user_id ?? null)),
    ...cons.map(r => row('consultation', r, r.title || 'Consultation', excerpt(r.description), r.marina_user_id ?? null)),
    ...projs.map(r => row('project', r, projectTitle(r.project_type), excerpt(r.description), r.user_id ?? null)),
    ...leads.map(r => ({
      kind: 'lead' as const, id: r.id, title: r.company || 'Partner lead', summary: excerpt(r.goals), status: r.status ?? '',
      createdAt: r.created_at, waiting: isWaiting('lead', r.status),
      authorId: null, authorName: [r.first_name, r.last_name].filter(Boolean).join(' ') || null, authorEmail: r.email ?? null,
      orgId: null, orgName: r.company || null, href: requestHref('lead', r.id),
    })),
  ];
  rows.sort((a, b) => Number(b.waiting) - Number(a.waiting) || String(b.createdAt).localeCompare(String(a.createdAt)));
  return { rows, problems };
}

/* ------------------------------------------------------------------ one request */

export interface HistoryEntry {
  id: number;
  action: 'request_status' | 'request_edited' | 'request_note' | string;
  note: string | null;
  details: Raw;
  actorId: string | null;
  actorName: string | null;
  createdAt: string;
}

export interface OutboxEntry {
  id: number;
  sentAt: string | null;
  lastError: string | null;
  attempts: number;
  createdAt: string;
}

export interface RequestRecord {
  kind: RequestKind;
  /** The table row as it is. */
  row: Raw;
  title: string;
  author: { id: string; name: string | null; email: string | null; accessStatus: string | null; firstName: string | null } | null;
  org: { id: string; name: string; slug: string | null; type: string | null; status: string | null } | null;
  sectors: string[];
  history: HistoryEntry[];
  outbox: Map<number, OutboxEntry>;
  /** registration_flags.outbox_sender: the database queues the e-mail only while it is on. */
  emailsOn: boolean;
  /** Something could not be read (the page still shows the rest). */
  problems: string[];
}

const TABLE: Record<RequestKind, string> = { rfp: 'rfps', consultation: 'consultations', project: 'marina_projects', lead: 'partner_leads' };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** null when there is no such request (also for an address whose id is not a uuid). */
export async function loadRequest(kind: RequestKind, id: string): Promise<RequestRecord | null> {
  if (!UUID_RE.test(id)) return null;
  const { data: row, error } = await supabase.from(TABLE[kind]).select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) return null;
  const r = row as Raw;
  const problems: string[] = [];
  const authorId: string | null = kind === 'lead' ? null : (kind === 'project' ? r.user_id : r.marina_user_id) ?? null;

  const sectorIds = new Set<string>();
  if (r.sector_id) sectorIds.add(r.sector_id);
  const [profileRes, historyRes, outboxRes, flagsRes, rfpSectorsRes] = await Promise.all([
    authorId ? supabase.from('profiles').select('user_id, first_name, last_name, email, access_status').eq('user_id', authorId).maybeSingle() : Promise.resolve({ data: null, error: null }),
    supabase.from('review_log').select('id, action, note, details, actor_id, created_at').eq('subject_type', 'market_request').eq('subject_id', id).order('created_at', { ascending: true }).order('id', { ascending: true }).limit(500),
    supabase.from('notification_outbox').select('id, sent_at, last_error, attempts, created_at').eq('kind', 'market_request_status').eq('subject_id', id).limit(200),
    supabase.from('platform_settings').select('value').eq('key', 'registration_flags').maybeSingle(),
    kind === 'rfp' ? supabase.from('rfp_sectors').select('sector_id').eq('rfp_id', id) : Promise.resolve({ data: [], error: null }),
  ]);
  if (historyRes.error) problems.push(`The history could not be read (${historyRes.error.message}).`);
  if (outboxRes.error) problems.push(`The e-mails could not be read (${outboxRes.error.message}).`);
  for (const s of ((rfpSectorsRes.data ?? []) as Raw[])) if (s.sector_id) sectorIds.add(s.sector_id);

  // The company: the request's own, else the author's.
  let orgId: string | null = r.organization_id ?? null;
  if (!orgId && authorId) {
    const { data: ms } = await supabase.from('organization_members').select('organization_id, role, joined_at').eq('user_id', authorId);
    const sorted = ((ms ?? []) as Raw[]).sort((a, b) => (a.role === 'owner' ? 0 : 1) - (b.role === 'owner' ? 0 : 1) || String(a.joined_at).localeCompare(String(b.joined_at)));
    orgId = sorted[0]?.organization_id ?? null;
  }
  const history = ((historyRes.data ?? []) as Raw[]);
  const actorIds = [...new Set(history.map(h => h.actor_id).filter(Boolean))] as string[];
  const [orgRes, sectorRes, actorRes] = await Promise.all([
    orgId ? supabase.from('organizations').select('id, name, slug, organization_type, access_status').eq('id', orgId).maybeSingle() : Promise.resolve({ data: null, error: null }),
    sectorIds.size ? supabase.from('sectors').select('id, label').in('id', [...sectorIds]) : Promise.resolve({ data: [], error: null }),
    actorIds.length ? supabase.from('profiles').select('user_id, first_name, last_name, email').in('user_id', actorIds) : Promise.resolve({ data: [], error: null }),
  ]);
  const actors = new Map(((actorRes.data ?? []) as Raw[]).map(p => [p.user_id as string, personName(p)]));
  const profile = profileRes.data as Raw | null;
  const org = orgRes.data as Raw | null;
  const flags = (flagsRes.data as Raw | null)?.value;

  const outbox = new Map<number, OutboxEntry>();
  for (const o of ((outboxRes.data ?? []) as Raw[])) {
    outbox.set(Number(o.id), { id: Number(o.id), sentAt: o.sent_at ?? null, lastError: o.last_error ?? null, attempts: Number(o.attempts ?? 0), createdAt: o.created_at });
  }

  return {
    kind,
    row: r,
    title: kind === 'rfp' || kind === 'consultation' ? r.title || KIND_LABEL[kind] : kind === 'project' ? projectTitle(r.project_type) : r.company || 'Partner lead',
    author: authorId
      ? { id: authorId, name: personName(profile), email: profile?.email ?? null, accessStatus: profile?.access_status ?? null, firstName: profile?.first_name ?? null }
      : null,
    org: org ? { id: org.id, name: org.name, slug: org.slug ?? null, type: org.organization_type ?? null, status: org.access_status ?? null } : null,
    sectors: ((sectorRes.data ?? []) as Raw[]).map(s => s.label).filter(Boolean),
    history: history.map(h => ({
      id: Number(h.id), action: h.action, note: h.note ?? null, details: (h.details ?? {}) as Raw,
      actorId: h.actor_id ?? null, actorName: h.actor_id ? actors.get(h.actor_id) ?? null : null, createdAt: h.created_at,
    })),
    outbox,
    emailsOn: !!flags && typeof flags === 'object' && (flags as Raw).outbox_sender === true,
    problems,
  };
}

/* ------------------------------------------------------------------ actions */

export interface StatusResult {
  ok: boolean;
  from: string | null;
  to: string;
  /** queued, sender_off, not_asked, not_for_this_status, not_for_leads, no_author, author_suspended */
  email: string;
  outbox_id: number | null;
}

/** A database refusal in plain words. */
export function actionErrorText(e: unknown): string {
  const err = e as { code?: string; message?: string; details?: string } | null;
  const code = err?.code ?? '';
  const msg = err?.message ?? (e instanceof Error ? e.message : '');
  if (code === 'PGRST202' || code === '42883' || /Could not find the function/i.test(msg)) {
    return 'This screen needs a database update that is not applied yet. Nothing was changed.';
  }
  const field = err?.details ? ` (${String(err.details).replace(/_/g, ' ')})` : '';
  switch (msg) {
    case 'forbidden': return 'Only the M3 team can do this. Nothing was changed.';
    case 'reason_required': return 'Write the reason: the requester will read it.';
    case 'same_status': return 'The request already has this status.';
    case 'unknown_status': return 'This status does not exist for this kind of request.';
    case 'unknown_kind': return 'This kind of request is not known.';
    case 'not_found': return 'This request no longer exists.';
    case 'message_too_long': return 'The message is too long: 2,000 characters at most.';
    case 'required_field': return `This field cannot be empty${field}.`;
    case 'too_long': return `This text is too long${field}.`;
    case 'bad_date': return 'The deadline must be a real date.';
    case 'bad_email': return 'This e-mail address does not look right.';
    case 'bad_value': return `This value is not accepted${field}.`;
    case 'field_not_editable': return `This field cannot be changed here${field}.`;
    case 'nothing_to_change': return 'Nothing was changed.';
    case 'note_required': return 'Write the note first.';
    default: return msg || 'Something went wrong. Nothing was changed.';
  }
}

export async function setRequestStatus(kind: RequestKind, id: string, status: string, message: string, notify: boolean): Promise<StatusResult> {
  const { data, error } = await supabase.rpc('admin_market_request_set_status', {
    p_kind: kind, p_id: id, p_status: status, p_message: message.trim() || null, p_notify: notify,
  });
  if (error) throw error;
  const res = data as StatusResult;
  if (res?.email === 'queued') {
    // Send it now; what cannot leave now is sent by the e-mail queue a few minutes later.
    void supabase.functions.invoke('send-notification', { body: { type: 'market_request_status', data: { request_id: id } } }).catch(() => undefined);
  }
  return res;
}

export async function editRequest(kind: RequestKind, id: string, changes: Record<string, string | null>): Promise<number> {
  const { data, error } = await supabase.rpc('admin_market_request_edit', { p_kind: kind, p_id: id, p_changes: changes });
  if (error) throw error;
  return Number((data as Raw | null)?.changed ?? 0);
}

export async function addRequestNote(kind: RequestKind, id: string, note: string): Promise<void> {
  const { error } = await supabase.rpc('admin_market_request_note', { p_kind: kind, p_id: id, p_note: note });
  if (error) throw error;
}

/* ------------------------------------------------------------------ export */

/** The rows shown, as a CSV file (Excel opens it: UTF-8 with its mark, a formula never runs). */
export function requestsCsv(rows: RequestRow[], origin: string): string {
  const cell = (v: unknown) => {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const head = ['Kind', 'Title', 'Company', 'Sent by', 'E-mail', 'Status', 'Waiting for an answer', 'Sent on', 'Admin page'];
  const lines = rows.map(r => [
    KIND_LABEL[r.kind], r.title, r.orgName ?? '', r.authorName ?? '', r.authorEmail ?? '', statusName(r.kind, r.status),
    r.waiting ? 'yes' : 'no', r.createdAt ? r.createdAt.slice(0, 10) : '', origin + r.href,
  ].map(cell).join(','));
  return String.fromCharCode(0xfeff) + [head.map(cell).join(','), ...lines].join('\r\n');
}
