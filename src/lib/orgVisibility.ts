import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';

/**
 * Who sees what of a company (Victor, 21 Oct 2026; go-live runbook P3/P4). ONE definition for
 * every screen, so the visitor version is the same everywhere.
 *
 * - Q1 = C "generous": a visitor reads a company's name, logo, cover, type, city / country,
 *   headquarters, sectors, full description, badges (verified, sponsor, winner), member count,
 *   website, gallery, investment terms and confirmed recommendations; for a marina also its key
 *   figures (status, berths, superyacht berths, longest berth, certifications).
 * - Members only: the team (names), sending a message, a marina's facilities, its two texts and
 *   its purchase projects, the Smart Marina 2026 texts beyond their first block.
 * - Q2: "a member" is an account M3 VALIDATED (profile access_status 'verified'). An account M3
 *   has not validated yet sees the visitor version, with "Your account is being reviewed" where a
 *   visitor gets "Sign in".
 * - Q5: a company M3 has not validated (pending, suspended) is invisible to visitors and to
 *   accounts not validated; members still see it, as before.
 * - Locked blocks never load what they lock: the page reads org_visitor_teaser (counts only) and
 *   org_public_highlights (the few public values that sit in members-only tables).
 *
 * The database enforces the same rule for visitors at go-live
 * (supabase/migrations/held/directory_visitor_basic.sql: anon keeps exactly these columns).
 * Until then the preview runs on the same database as the live site: every read here falls back
 * when an object of the P2 files does not exist yet (is_claimed, the two functions).
 */

/**
 * The organizations columns a visitor reads (28 with name_search and is_claimed, all granted to
 * anon at go-live). Every ORG_SEO_COLUMNS field of src/lib/seoMeta.ts is in it. Never the
 * internal ones (ORG_INTERNAL_COLUMNS). is_claimed is added by withClaimed().
 */
export const ORG_BASIC_COLUMNS = 'id, name, slug, organization_type, tier, logo_url, banner_url, description, audience_description, website, country, city, headquarters_country, gallery, investment_geographies, investment_size_min, investment_size_max, investment_hold_period, investment_thesis, featured_partner, is_event_media_partner, access_status, archived_at, duplicate_of, created_at, updated_at';

/** What a validated member reads on top of ORG_BASIC_COLUMNS on a company page: who to write to. */
export const ORG_MEMBER_COLUMNS = 'owner_user_id';

/** Never read by a visitor; anon loses them at go-live. Signed-in accounts keep them until December (Q9). */
export const ORG_INTERNAL_COLUMNS = [
  'primary_domain', 'max_seats', 'created_by_user_id', 'owner_user_id', 'onboarding_status', 'rejection_reason',
  'auto_approve_domain_joins', 'social_media_links', 'marina_subtype',
] as const;

interface ErrorLike {
  code?: string;
  message?: string;
}

// ------------------------------------------------------------------ is_claimed

/** 'is_claimed' (20261021140000), or 'owner_user_id' while that column does not exist yet. */
export type ClaimedColumn = 'is_claimed' | 'owner_user_id';

let claimedColumnMissing = false;

/** PostgREST's answer to a read naming is_claimed before the column exists (42703, or PGRST204). */
export function isMissingClaimedColumn(error: ErrorLike | null | undefined): boolean {
  if (!error) return false;
  return (error.code === '42703' || error.code === 'PGRST204') && /is_claimed/i.test(error.message ?? '');
}

/**
 * Runs a read that names is_claimed (in its columns or its filters), and runs it again with
 * owner_user_id while the column does not exist (the first refusal is remembered for the visit).
 * Filter with claimedFilter(); read the answer with rowIsClaimed().
 */
export async function withClaimed<R extends { error: ErrorLike | null }>(run: (col: ClaimedColumn) => PromiseLike<R>): Promise<R> {
  if (claimedColumnMissing) return run('owner_user_id');
  const first = await run('is_claimed');
  if (!isMissingClaimedColumn(first.error)) return first;
  claimedColumnMissing = true;
  return run('owner_user_id');
}

/** Whether a row read through withClaimed() has an owner on the platform, whichever column it carries. */
export function rowIsClaimed(row: { is_claimed?: boolean | null; owner_user_id?: string | null } | null | undefined): boolean {
  if (!row) return false;
  if (typeof row.is_claimed === 'boolean') return row.is_claimed;
  return !!row.owner_user_id;
}

/** A row read through withClaimed(), with is_claimed set and owner_user_id dropped (a visitor never keeps it). */
export function withClaimedFlag<T extends { is_claimed?: boolean | null; owner_user_id?: string | null }>(row: T): Omit<T, 'owner_user_id'> & { is_claimed: boolean } {
  const { owner_user_id: _owner, ...rest } = row;
  void _owner;
  return { ...rest, is_claimed: rowIsClaimed(row) };
}

// ------------------------------------------------------------------ functions that may not exist yet

/** PostgREST's answer to a call of a function that does not exist (yet): PGRST202, or 42883. */
export function isMissingFunction(error: ErrorLike | null | undefined): boolean {
  return !!error && (error.code === 'PGRST202' || error.code === '42883');
}

/** What the locked blocks of a validated company hold: counts and yes/no only (org_visitor_teaser). */
export interface OrgTeaser {
  team: number;
  gallery: number;
  has_website: boolean;
  has_marina_details: boolean;
  marina_facilities: number;
  marina_texts: number;
  plans: number;
  sm26_texts_more: number;
  showcase_more: number;
}

/** The public values of members-only tables (org_public_highlights). */
export interface OrgHighlights {
  marina: {
    marina_type: string | null;
    berths_count: number | null;
    superyacht_berths: number | null;
    longest_berth_meters: number | null;
    certifications: string[] | null;
    certifications_other: string | null;
  } | null;
  sm26_marina: { key: string; text: string } | null;
  showcase: { edition: string; blocks: { kind: 'startup' | 'architect'; sections: Record<string, string> }[] } | null;
}

/** org_visitor_teaser(p_org_id); null when the company is not listed, the read fails or the function is not there yet. */
export async function fetchOrgTeaser(orgId: string): Promise<OrgTeaser | null> {
  try {
    const { data, error } = await supabase.rpc('org_visitor_teaser', { p_org_id: orgId });
    if (error || !data || typeof data !== 'object') return null;
    return data as OrgTeaser;
  } catch {
    return null;
  }
}

/**
 * org_public_highlights(p_org_id). While the function does not exist yet (the P2 file not
 * applied), a marina's key figures come from organization_marina_details, the public columns only
 * (anon still reads that table until go-live); the Smart Marina 2026 first blocks then stay out.
 */
export async function fetchOrgHighlights(orgId: string, isMarina: boolean): Promise<OrgHighlights | null> {
  try {
    const { data, error } = await supabase.rpc('org_public_highlights', { p_org_id: orgId });
    if (!error) return data && typeof data === 'object' ? (data as OrgHighlights) : null;
    if (!isMissingFunction(error) || !isMarina) return null;
    const { data: figures, error: figuresError } = await supabase
      .from('organization_marina_details')
      .select('marina_type, berths_count, superyacht_berths, longest_berth_meters, certifications, certifications_other')
      .eq('organization_id', orgId)
      .maybeSingle();
    if (figuresError) return null;
    return { marina: (figures as OrgHighlights['marina']) ?? null, sm26_marina: null, showcase: null };
  } catch {
    return null;
  }
}

/**
 * The company recognised from an e-mail domain on the sign-up form (org_by_email_domain:
 * validated companies only, exact domain). While the function does not exist yet, the old direct
 * filter on primary_domain, which works until go-live.
 */
export async function findCompanyByEmailDomain(domain: string): Promise<{ id: string; name: string } | null> {
  const clean = domain.trim().toLowerCase();
  if (clean.length < 3) return null;
  try {
    const { data, error } = await supabase.rpc('org_by_email_domain', { p_domain: clean });
    if (!error) {
      const row = (Array.isArray(data) ? data[0] : data) as { id?: string; name?: string } | null | undefined;
      return row?.id && row.name ? { id: row.id, name: row.name } : null;
    }
    if (!isMissingFunction(error)) return null;
    const { data: legacy } = await supabase.from('organizations').select('id, name').eq('primary_domain', clean).maybeSingle();
    return (legacy as { id: string; name: string } | null) ?? null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ the reader

/**
 * Who is reading, as one word (Q2):
 * - 'loading': the session or the profile is still being read (decide nothing yet);
 * - 'visitor': signed out;
 * - 'pending': signed in, the account not validated by M3 (or its profile could not be read):
 *   the visitor version, with "Your account is being reviewed";
 * - 'member': an account M3 validated: the full profile.
 * Derived from primitives only: auth-js hands over a new user object on every tab refocus, and an
 * effect keyed on an object would reload the page each time (the refocus trap).
 */
export type OrgViewer = 'loading' | 'visitor' | 'pending' | 'member';

export function useOrgViewer(): OrgViewer {
  const { user, profile, loading } = useAuth();
  const userId = user?.id ?? null;
  const status = profile?.access_status ?? null;
  if (!userId) return loading ? 'loading' : 'visitor';
  // Signed in, the profile not there (yet): wait while it loads; if it could not be read, the
  // visitor version (it switches to the full profile once the profile arrives).
  if (!status) return loading ? 'loading' : 'pending';
  return status === 'verified' ? 'member' : 'pending';
}

/** Whether `viewer` sees the full profile (Q2): validated accounts only. */
export function seesMore(viewer: OrgViewer): boolean {
  return viewer === 'member';
}
