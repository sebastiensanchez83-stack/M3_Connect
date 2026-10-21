/**
 * The four kinds of marina requests and their statuses, in plain words (Admin > Marina requests).
 * Pure: no import, so tests/market-email.test.mjs can check these lists against the database's
 * (supabase/migrations/20261021175000_market_requests.sql, market_request_statuses).
 *
 *   rfp           public.rfps            a marina asks partners for proposals (published on the marketplace)
 *   consultation  public.consultations   a marina asks the network a question
 *   project       public.marina_projects a marina describes a project it plans
 *   lead          public.partner_leads   a company that filled the old public "become a partner"
 *                                        form: a sales contact for M3, without an account
 */

export type RequestKind = 'rfp' | 'consultation' | 'project' | 'lead';

export const REQUEST_KINDS: RequestKind[] = ['rfp', 'consultation', 'project', 'lead'];

export const KIND_LABEL: Record<RequestKind, string> = {
  rfp: 'Request for proposals',
  consultation: 'Consultation',
  project: 'Marina project',
  lead: 'Partner lead',
};

/** Short name for a pill. */
export const KIND_SHORT: Record<RequestKind, string> = {
  rfp: 'RFP',
  consultation: 'Consultation',
  project: 'Project',
  lead: 'Partner lead',
};

/** Each table's CHECK list, in the order the page offers them (the database's market_request_statuses). */
export const KIND_STATUSES: Record<RequestKind, string[]> = {
  rfp: ['submitted', 'under_review', 'approved', 'closed', 'rejected', 'archived'],
  consultation: ['submitted', 'under_review', 'approved', 'closed', 'rejected', 'archived'],
  project: ['new', 'submitted', 'under_review', 'approved', 'in_progress', 'completed', 'rejected', 'archived'],
  lead: ['new', 'qualified', 'in_discussion', 'signed', 'rejected'],
};

/** Waiting for M3's answer (the same statuses as the admin home's "To do today"). */
export const WAITING_STATUSES: Record<RequestKind, string[]> = {
  rfp: ['submitted', 'under_review'],
  consultation: ['submitted', 'under_review'],
  project: ['new', 'submitted', 'under_review'],
  lead: ['new'],
};

export function isWaiting(kind: RequestKind, status: string | null | undefined): boolean {
  return WAITING_STATUSES[kind].includes(status ?? '');
}

export function isRequestKind(value: string | null | undefined): value is RequestKind {
  return value === 'rfp' || value === 'consultation' || value === 'project' || value === 'lead';
}

/** Status filters across the four kinds, in plain words. */
export const STATUS_FILTERS: { value: string; label: string; match: (kind: RequestKind, status: string, waiting: boolean) => boolean }[] = [
  { value: 'waiting', label: 'Waiting for an answer', match: (_k, _s, waiting) => waiting },
  { value: 'published', label: 'Published', match: (k, s) => k !== 'lead' && (s === 'approved' || s === 'in_progress') },
  { value: 'rejected', label: 'Not published, or not a fit', match: (_k, s) => s === 'rejected' },
  { value: 'done', label: 'Closed or completed', match: (_k, s) => s === 'closed' || s === 'completed' },
  { value: 'archived', label: 'Archived', match: (_k, s) => s === 'archived' },
  { value: 'talking', label: 'Leads: qualified or in discussion', match: (k, s) => k === 'lead' && (s === 'qualified' || s === 'in_discussion') },
  { value: 'signed', label: 'Leads: signed', match: (k, s) => k === 'lead' && s === 'signed' },
];

/** A status written by the old screens' links (?status=new) as one of the filters above. */
export function statusFilterOf(raw: string | null | undefined): string | null {
  switch (raw) {
    case 'new': case 'submitted': case 'under_review': return 'waiting';
    case 'approved': case 'in_progress': return 'published';
    case 'rejected': return 'rejected';
    case 'closed': case 'completed': return 'done';
    case 'archived': return 'archived';
    case 'qualified': case 'in_discussion': return 'talking';
    case 'signed': return 'signed';
    default: return STATUS_FILTERS.some(f => f.value === raw) ? raw ?? null : null;
  }
}

/** A status in plain words, as the requester would understand it. */
export function statusName(kind: RequestKind, status: string | null | undefined): string {
  const s = status ?? '';
  if (kind === 'lead') {
    return ({ new: 'New', qualified: 'Qualified', in_discussion: 'In discussion', signed: 'Signed', rejected: 'Not a fit' } as Record<string, string>)[s] ?? fallback(s);
  }
  const common: Record<string, string> = {
    new: 'Waiting for M3',
    submitted: 'Waiting for M3',
    under_review: 'Being reviewed',
    approved: 'Published',
    in_progress: 'In progress',
    completed: 'Completed',
    closed: 'Closed',
    rejected: 'Not published',
    archived: 'Archived',
  };
  return common[s] ?? fallback(s);
}

/** One line under each choice of the status picker: what choosing it does. */
export function statusHint(kind: RequestKind, status: string): string {
  if (kind === 'lead') {
    return ({
      new: 'Nobody at M3 has contacted them yet.',
      qualified: 'A real prospect, worth a call.',
      in_discussion: 'M3 is talking with them.',
      signed: 'They became a paying partner.',
      rejected: 'Not a fit for now.',
    } as Record<string, string>)[status] ?? '';
  }
  if (kind === 'project') {
    return ({
      new: 'Back to waiting for M3. Not shown to partners.',
      submitted: 'Back to waiting for M3. Not shown to partners.',
      under_review: 'M3 is looking at it. Not shown to partners yet.',
      approved: 'Published: partners can see it.',
      in_progress: 'The works have started.',
      completed: 'The project is done.',
      rejected: 'Not published. Write the reason: they will read it.',
      archived: 'Hidden everywhere, kept for the record.',
    } as Record<string, string>)[status] ?? '';
  }
  return ({
    submitted: 'Back to waiting for M3. Not on the marketplace.',
    under_review: 'M3 is looking at it. Not on the marketplace yet.',
    approved: 'Shown on the marketplace: partners can answer.',
    closed: 'Taken off the marketplace: no more answers.',
    rejected: 'Not published. Write the reason: they will read it.',
    archived: 'Hidden everywhere, kept for the record.',
  } as Record<string, string>)[status] ?? '';
}

function fallback(s: string): string {
  if (!s) return 'No status';
  const t = s.replace(/_/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/* ---- marina projects: the codes of the "Submit a project" form, in words ---- */

export const PROJECT_TYPES: Record<string, string> = {
  energy: 'Energy', digital: 'Digital', infrastructure: 'Infrastructure', services: 'Services', other: 'Other',
};
export const PROJECT_BUDGETS: Record<string, string> = {
  under_10k: 'Under €10k', '10k_50k': '€10k to €50k', '50k_100k': '€50k to €100k', '100k_500k': '€100k to €500k', over_500k: 'Over €500k',
};
export const PROJECT_TIMELINES: Record<string, string> = {
  '0_12_months': 'Within 12 months', '12_24_months': '12 to 24 months', '24_plus': 'More than 24 months',
};
export const LEAD_ENGAGEMENT: Record<string, string> = {
  info: 'Information only', meeting: 'A meeting', proposal: 'A proposal',
};

/**
 * The title of a marina project, exactly as the database names it in the e-mail
 * (market_request_row: initcap of the code, "_" as spaces, then " project"; "Marina project" when empty).
 */
export function projectTitle(projectType: string | null | undefined): string {
  const words = (projectType ?? '').trim().replace(/_/g, ' ').toLowerCase().replace(/(^|[^a-z0-9])([a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase());
  return `${words || 'Marina'} project`;
}

/** A code in words, from one of the maps above (the raw value when it is not in the map). */
export function codeLabel(map: Record<string, string>, value: string | null | undefined): string {
  if (!value) return '';
  return map[value] ?? fallback(value);
}
