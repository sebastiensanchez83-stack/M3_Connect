import { supabase } from '@/lib/supabase';
import { sendNotification } from '@/lib/notifications';
import { fetchPeopleOrgs, type PersonOrg } from '@/lib/personOrg';
import { displayCase } from '@/lib/displayCase';
import { myOrganizationIds } from './inboxCounts';

/**
 * The connection requests' reads and answer, shared by Messages
 * (src/components/messages) and the dashboard's "Answer 2 connection requests"
 * window, so both do exactly the same (same rows, same update, same e-mail).
 */

export type PartnerStatus = 'pending' | 'accepted' | 'rejected' | 'withdrawn';

export interface OrgRef {
  id: string;
  name: string;
  slug: string | null;
  logo_url: string | null;
  organization_type?: string | null;
}

export interface PersonRef {
  name: string;
  avatar_url: string | null;
  job_title: string | null;
}

export interface PartnerRequestData {
  id: string;
  partner_user_id: string;
  marina_user_id: string;
  partner_organization_id: string | null;
  marina_organization_id: string | null;
  message: string | null;
  status: PartnerStatus;
  created_at: string;
  answered_by_user_id?: string | null;
  answered_at?: string | null;
}

const PR_COLUMNS = `
  id, partner_user_id, marina_user_id, partner_organization_id, marina_organization_id,
  message, status, created_at`;
const PR_ORGS = `
  partner_org:organizations!partner_requests_partner_organization_id_fkey (id, name, slug, logo_url, organization_type),
  marina_org:organizations!partner_requests_marina_organization_id_fkey (id, name, slug, logo_url, organization_type)`;

export type PRRow = PartnerRequestData & { partner_org: OrgRef | null; marina_org: OrgRef | null };

/**
 * Connection requests I sent, received, or that reached one of my organisations.
 * The answer columns only exist once the 8 Oct 2026 migration is applied: until
 * then the same read runs without them (and nobody can show who answered).
 */
export async function loadPartnerRows(userId: string, orgIds: string[]): Promise<PRRow[]> {
  const audience = [
    `partner_user_id.eq.${userId}`,
    `marina_user_id.eq.${userId}`,
    ...(orgIds.length ? [`marina_organization_id.in.(${orgIds.join(',')})`] : []),
  ].join(',');
  const run = (cols: string) => supabase
    .from('partner_requests')
    .select(`${cols},${PR_ORGS}`)
    .or(audience)
    .order('created_at', { ascending: false });
  const withAnswer = await run(`${PR_COLUMNS}, answered_by_user_id, answered_at`);
  if (!withAnswer.error) return (withAnswer.data ?? []) as unknown as PRRow[];
  const plain = await run(PR_COLUMNS);
  return (plain.data ?? []) as unknown as PRRow[];
}

/** People's public fields (verified accounts), by user id, through get_public_profiles. */
export async function fetchPeople(ids: string[]): Promise<Record<string, PersonRef>> {
  const people: Record<string, PersonRef> = {};
  if (ids.length === 0) return people;
  const { data } = await supabase.rpc('get_public_profiles', { target_user_ids: ids });
  for (const p of (data ?? []) as { user_id: string; first_name: string | null; last_name: string | null; avatar_url: string | null; job_title: string | null }[]) {
    people[p.user_id] = {
      name: displayCase([p.first_name, p.last_name].filter(Boolean).join(' ')),
      avatar_url: p.avatar_url,
      job_title: p.job_title,
    };
  }
  return people;
}

/** A request someone sent to me or my company, still waiting for an answer. */
export interface WaitingConnection {
  data: PartnerRequestData;
  person: PersonRef | null;
  org: OrgRef | null;
}

/**
 * The connection requests waiting for my answer (received, pending: the rule of
 * Messages and of the count, src/hooks/useInboxCount.ts), newest first, with who
 * sent them. Addressed to a company I belong to now, or, for an old request
 * without a company, to me.
 */
export async function loadWaitingConnections(uid: string, activeOrgId: string | null): Promise<WaitingConnection[]> {
  const orgIds = [...new Set([...(await myOrganizationIds(uid)), ...(activeOrgId ? [activeOrgId] : [])])];
  const rows = (await loadPartnerRows(uid, orgIds)).filter((r) =>
    r.partner_user_id !== uid
    && r.status === 'pending'
    && (r.marina_organization_id ? orgIds.includes(r.marina_organization_id) : r.marina_user_id === uid)
    && !(r.partner_organization_id && orgIds.includes(r.partner_organization_id)));
  const people = await fetchPeople([...new Set(rows.map((r) => r.partner_user_id))]);
  const missing = rows.filter((r) => !r.partner_org).map((r) => r.partner_user_id);
  const fallbackOrgs: Record<string, PersonOrg> = missing.length ? await fetchPeopleOrgs(missing) : {};
  return rows.map((r) => ({
    data: r,
    person: people[r.partner_user_id] ?? null,
    org: r.partner_org ?? fallbackOrgs[r.partner_user_id] ?? null,
  }));
}

export type AnswerResult =
  | { ok: true }
  /** taken: a colleague answered first (no row left to update, or the database's "already answered"). */
  | { ok: false; taken: boolean; message?: string };

/**
 * Accepts or declines a connection request (a first message): only one still
 * pending (a colleague may have answered in the meantime; the database refuses a
 * second answer too). Accepting sends the introduction e-mail to the sender (fire
 * and forget; the server takes the company name from the database and checks that
 * this account answered). Declining sends NO e-mail (Victor, 9 Oct 2026: the only
 * instant e-mail of messaging is the introduction when a company accepts).
 */
export async function answerConnectionRequest(
  request: Pick<PartnerRequestData, 'id' | 'partner_user_id'>,
  newStatus: 'accepted' | 'rejected',
  me: { email: string | null | undefined; firstName: string | null | undefined; lastName: string | null | undefined; orgName: string },
): Promise<AnswerResult> {
  const { data: updated, error } = await supabase
    .from('partner_requests')
    .update({ status: newStatus })
    .eq('id', request.id)
    .eq('status', 'pending')
    .select('id');
  if (error || !updated || updated.length === 0) {
    const taken = !error || /already been answered/i.test(error.message);
    return { ok: false, taken, message: error?.message };
  }
  const companyName = me.orgName || me.firstName || 'A member';
  if (newStatus === 'accepted') {
    sendNotification({
      type: 'partner_request_accepted',
      userId: request.partner_user_id,
      data: {
        marina_name: companyName,
        acceptor_email: me.email || '',
        acceptor_name: `${me.firstName || ''} ${me.lastName || ''}`.trim() || companyName,
      },
    });
  }
  return { ok: true };
}
