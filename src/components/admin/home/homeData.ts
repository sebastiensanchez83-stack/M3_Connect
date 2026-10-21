import { supabase } from '@/lib/supabase';
import { loadQueueV2, type QueueRow } from '@/components/admin/review/reviewApi';
import { loadEventRegistrationCounts, type EventRegistrationCount } from '@/components/admin/events/registrationCounts';

/**
 * Everything the admin home ("To do today") reads. Read-only: head counts (count: 'exact',
 * head: true) wherever a number is enough, a few small selects otherwise. No database change:
 * the one figure that needs one (messages exchanged) calls admin_home_message_counts() and says
 * "not counted yet" while that function is not installed.
 *
 * Every figure carries its source (shown on hover and in "Where the figures come from").
 * A count that cannot be read is null, shown as "—", never as 0.
 */

/** The Inbox screen (contact form, reports) comes from the inbox lane; null until it is wired. */
export const INBOX_PATH: string | null = '/admin/inbox';

const DAY = 24 * 60 * 60 * 1000;

type HeadQuery = PromiseLike<{ count: number | null; error: unknown }>;
const head = async (q: HeadQuery): Promise<number | null> => {
  const { count, error } = await q;
  return error ? null : count ?? 0;
};
const sum = (...xs: (number | null)[]) => (xs.some(x => x === null) ? null : (xs as number[]).reduce((a, b) => a + b, 0));
const cnt = (table: string) => supabase.from(table).select('*', { count: 'exact', head: true });

/* ------------------------------------------------------------------ the queue */

export type QueueKey = 'accounts' | 'companies' | 'event_requests' | 'reports' | 'contact' | 'needs' | 'leads';

export interface QueueItem {
  key: string;
  kind: QueueKey;
  count: number;
  title: string;
  line: string;
  /** Where to act; null = no screen yet (the line says where to look instead). */
  to: string | null;
  cue: string;
  source: string;
}

interface GlEventRow { id: string; slug: string; title: string | null; engine: string | null; hidden: boolean | null; legacy_event_id: string | null }

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/**
 * What waits for M3, admin view. Accounts and companies come from the To validate list itself
 * (admin_review_queue), so the two always agree; the rest are head counts with the same rules.
 */
export async function loadQueue(isAdmin: boolean): Promise<QueueItem[]> {
  const items: QueueItem[] = [];
  const since48h = new Date(Date.now() - 2 * DAY).toISOString();

  const [rows, glEvents, reports, contact, rfps, cons, projects, leads] = await Promise.all([
    isAdmin ? loadQueueV2().catch(() => null) : Promise.resolve(null),
    isAdmin
      ? supabase.from('gl_event').select('id, slug, title, engine, hidden, legacy_event_id').then(r => (r.error ? null : (r.data as GlEventRow[])))
      : Promise.resolve(null),
    head(cnt('conversation_reports').eq('status', 'open')),
    head(cnt('contact_submissions').eq('status', 'new')),
    isAdmin ? head(cnt('rfps').in('status', ['submitted', 'under_review'])) : Promise.resolve(0),
    isAdmin ? head(cnt('consultations').in('status', ['submitted', 'under_review'])) : Promise.resolve(0),
    isAdmin ? head(cnt('marina_projects').in('status', ['new', 'submitted', 'under_review'])) : Promise.resolve(0),
    isAdmin ? head(cnt('partner_leads').eq('status', 'new')) : Promise.resolve(0),
  ]);

  if (isAdmin) {
    let accounts: number | null = null;
    let accountsOld: number | null = null;
    let companies: number | null = null;
    let claims = 0;
    if (rows) {
      const people = (rows as QueueRow[]).filter(r => r.kind === 'person');
      accounts = people.length;
      accountsOld = people.filter(r => (r.waiting_since ?? r.created_at ?? '') <= since48h).length;
      claims = (rows as QueueRow[]).filter(r => r.kind === 'claim').length;
      companies = (rows as QueueRow[]).filter(r => r.kind === 'company').length + claims;
    } else {
      // The list could not be read: the rule /admin/review v1 uses (form sent, not a draft).
      const base = () => cnt('profiles').eq('access_status', 'pending').neq('onboarding_status', 'draft').not('persona', 'in', '(admin,moderator)');
      [accounts, accountsOld, companies] = await Promise.all([
        head(base()),
        head(base().lte('created_at', since48h)),
        head(cnt('organizations').eq('access_status', 'pending').is('archived_at', null).is('duplicate_of', null)),
      ]);
    }
    if (accounts) {
      items.push({
        key: 'accounts', kind: 'accounts', count: accounts,
        title: `${accounts} ${plural(accounts, 'account', 'accounts')} to validate`,
        line: accountsOld
          ? `${accountsOld} ${plural(accountsOld, 'has', 'have')} been waiting for more than 48 hours.`
          : 'All arrived in the last 48 hours.',
        to: '/admin/review?tab=people', cue: 'Validate',
        source: 'The person cards of To validate (admin_review_queue): sign-up form sent, account not validated yet. 48 hours counted from when the person started waiting.',
      });
    }
    if (companies) {
      items.push({
        key: 'companies', kind: 'companies', count: companies,
        title: `${companies} ${plural(companies, 'company', 'companies')} to validate`,
        line: claims ? `Including ${claims} ${plural(claims, 'request', 'requests')} to take over a company page.` : 'New company pages waiting for approval.',
        to: '/admin/review?tab=people', cue: 'Validate',
        source: 'The company and claim cards of To validate (admin_review_queue). A company whose only person is waiting shows on that person\'s card instead.',
      });
    }

    // Invitation and registration requests, per event (same rule as To validate: status requested, no test or hidden event).
    const glList = (glEvents ?? []).filter(g => !g.hidden && !g.slug.startsWith('canary-'));
    const reqCounts = await Promise.all(glList.map(g => head(cnt('gl_guest').eq('event_id', g.id).eq('status', 'requested'))));
    glList.forEach((g, i) => {
      const n = reqCounts[i];
      if (!n) return;
      const name = g.title?.trim() || g.slug;
      const to = g.engine === 'core_v2'
        ? (g.legacy_event_id ? `/admin/events/${g.legacy_event_id}` : `/admin/review?tab=registrations&event=${g.id}`)
        : `/admin/guest-list/${g.slug}`;
      items.push({
        key: `event_requests:${g.id}`, kind: 'event_requests', count: n,
        title: `${n} ${plural(n, 'invitation request', 'invitation requests')}`,
        line: `${name}: people asking to attend, waiting for an answer.`,
        to, cue: 'Answer',
        source: `Guests of ${name} with the status Requested (gl_guest). They are answered in the event's guest list.`,
      });
    });
  }

  if (reports) {
    items.push({
      key: 'reports', kind: 'reports', count: reports,
      title: `${reports} reported ${plural(reports, 'conversation', 'conversations')}`,
      line: 'A member reported a message between companies.',
      to: INBOX_PATH ?? '/admin/review?tab=content', cue: 'See the reports',
      source: 'Reports with the status Open (conversation_reports).',
    });
  }
  if (contact) {
    items.push({
      key: 'contact', kind: 'contact', count: contact,
      title: `${contact} ${plural(contact, 'message', 'messages')} from the contact form`,
      line: INBOX_PATH ? 'Not handled yet.' : 'Not handled yet. Each one was also e-mailed to events@m3monaco.com.',
      to: INBOX_PATH, cue: 'Read',
      source: 'Contact-form messages with the status New (contact_submissions).',
    });
  }
  if (isAdmin) {
    const needs = sum(rfps, cons, projects);
    if (needs) {
      const parts = [
        rfps ? `${rfps} ${plural(rfps, 'RFP', 'RFPs')}` : '',
        cons ? `${cons} ${plural(cons, 'consultation', 'consultations')}` : '',
        projects ? `${projects} marina ${plural(projects, 'project', 'projects')}` : '',
      ].filter(Boolean).join(', ');
      items.push({
        key: 'needs', kind: 'needs', count: needs,
        title: `${needs} marketplace ${plural(needs, 'request', 'requests')} without an answer`,
        line: `${parts}: to approve or turn down before they are published.`,
        to: '/admin/review?tab=content', cue: 'Answer',
        source: 'RFPs and consultations Submitted or Under review, marina projects New, Submitted or Under review (rfps, consultations, marina_projects).',
      });
    }
    if (leads) {
      items.push({
        key: 'leads', kind: 'leads', count: leads,
        title: `${leads} new partner ${plural(leads, 'lead', 'leads')}`,
        line: 'Companies that asked about a partnership and were not contacted yet.',
        to: '/admin/leads?status=new', cue: 'Contact them',
        source: 'Partner leads with the status New (partner_leads).',
      });
    }
  }
  return items;
}

/* ------------------------------------------------------------------ the week's figures */

export interface Figure {
  key: string;
  label: string;
  value: string | null;
  hint: string | null;
  source: string;
}

const eur = (cents: number) => `€${Math.round(cents / 100).toLocaleString('en-GB')}`;

export async function loadFigures(): Promise<Figure[]> {
  const since7d = new Date(Date.now() - 7 * DAY).toISOString();
  const year = new Date().getFullYear();
  const yearStart = `${year}-01-01`;
  const yearStartTs = new Date(year, 0, 1).toISOString();

  const members = () => cnt('profiles').eq('access_status', 'verified').not('persona', 'in', '(admin,moderator)');
  const visible = () => cnt('organizations').eq('access_status', 'verified').is('archived_at', null).is('duplicate_of', null);

  const [
    nMembers, nNewAccounts, nCompanies, nNewCompanies, msg,
    rfpOpen, consOpen, projApproved,
    payments, invoices, agreements,
  ] = await Promise.all([
    head(members()),
    head(cnt('profiles').not('persona', 'in', '(admin,moderator)').gte('created_at', since7d)),
    head(visible()),
    head(visible().gte('created_at', since7d)),
    supabase.rpc('admin_home_message_counts').then(r => (r.error || !r.data || typeof r.data !== 'object' ? null : (r.data as { last_7_days?: number; total?: number }))),
    head(cnt('rfps').eq('status', 'approved').eq('is_open', true)),
    head(cnt('consultations').eq('status', 'approved').eq('is_open', true)),
    head(cnt('marina_projects').eq('status', 'approved')),
    supabase.from('sm_payment').select('registration_id, amount_cents, currency').eq('status', 'paid').gte('paid_at', yearStartTs),
    supabase.from('sm_invoice').select('registration_id, amount_cents, currency').gte('created_at', yearStartTs),
    supabase.from('sp_agreement').select('negotiated_fee_cents, currency, term_start, created_at').in('status', ['active', 'renewed', 'expired']),
  ]);

  // Money collected this year (read-only, staff only by RLS). The dead `payments` table is not read.
  let money: string | null = null;
  let moneyHint: string | null = null;
  if (!payments.error && !invoices.error && !agreements.error) {
    const isEur = (c: string | null | undefined) => !c || c.toUpperCase() === 'EUR';
    const paid = (payments.data ?? []).filter(p => isEur(p.currency));
    const paidRegs = new Set(paid.map(p => p.registration_id));
    const sm26Paid = paid.reduce((s, p) => s + (p.amount_cents ?? 0), 0);
    // An invoice whose registration is already paid is the same money: counted once.
    const sm26Invoiced = (invoices.data ?? [])
      .filter(i => isEur(i.currency) && !paidRegs.has(i.registration_id))
      .reduce((s, i) => s + (i.amount_cents ?? 0), 0);
    const sponsoring = (agreements.data ?? [])
      .filter(a => isEur(a.currency) && ((a.term_start as string | null) ?? (a.created_at as string).slice(0, 10)) >= yearStart)
      .reduce((s, a) => s + Number(a.negotiated_fee_cents ?? 0), 0);
    money = eur(sm26Paid + sm26Invoiced + sponsoring);
    moneyHint = `SM26 ${eur(sm26Paid + sm26Invoiced)} · sponsorship ${eur(sponsoring)}`;
  }

  const needs = sum(rfpOpen, consOpen, projApproved);
  return [
    {
      key: 'members', label: 'validated members',
      value: nMembers === null ? null : nMembers.toLocaleString('en-GB'),
      hint: nNewAccounts === null ? null : `${nNewAccounts} new ${plural(nNewAccounts, 'account', 'accounts')} in 7 days`,
      source: 'Accounts with the status Validated (profiles.access_status = verified), M3 staff left out. Below: accounts created in the last 7 days, validated or not.',
    },
    {
      key: 'companies', label: 'visible companies',
      value: nCompanies === null ? null : nCompanies.toLocaleString('en-GB'),
      hint: nNewCompanies === null ? null : `${nNewCompanies} added in 7 days`,
      source: 'Companies with the status Validated, not archived and not marked as a duplicate (organizations). Individuals count too: their company carries their own name.',
    },
    {
      key: 'messages', label: 'messages exchanged in 7 days',
      value: msg && typeof msg.last_7_days === 'number' ? msg.last_7_days.toLocaleString('en-GB') : null,
      hint: msg && typeof msg.total === 'number' ? `${msg.total.toLocaleString('en-GB')} since the start` : 'Not counted yet: a small database update is needed.',
      source: 'Messages between companies in the last 7 days, deleted ones left out (conversation_messages, through admin_home_message_counts: M3 cannot read the messages themselves).',
    },
    {
      key: 'needs', label: 'needs published',
      value: needs === null ? null : needs.toLocaleString('en-GB'),
      hint: needs === null ? null : `${rfpOpen} ${plural(rfpOpen ?? 0, 'RFP', 'RFPs')} · ${consOpen} consult. · ${projApproved} ${plural(projApproved ?? 0, 'project', 'projects')}`,
      source: 'Approved and open RFPs and consultations, approved marina projects (rfps, consultations, marina_projects).',
    },
    {
      key: 'money', label: `collected in ${year}`,
      value: money,
      hint: moneyHint,
      source: `SM26 registrations marked Paid in ${year} (sm_payment) + SM26 invoices of registrations not marked paid (sm_invoice) + signed sponsorship agreements starting in ${year}: Active, Renewed or Expired (sp_agreement). Euros only. The old payments table is not used.`,
    },
  ];
}

/* ------------------------------------------------------------------ upcoming events */

export interface UpcomingEvent {
  id: string;
  title: string;
  date_time: string | null;
  location: string | null;
  event_type: string | null;
  published: boolean | null;
  counts: EventRegistrationCount | null;
}

export async function loadUpcomingEvents(): Promise<UpcomingEvent[] | null> {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from('events')
    .select('id, title, date_time, end_date_time, location, event_type, published, max_attendance')
    .or(`date_time.gte.${nowIso},end_date_time.gte.${nowIso}`)
    .order('date_time', { ascending: true })
    .limit(5);
  if (error) return null;
  const rows = (data ?? []) as { id: string; title: string; date_time: string | null; location: string | null; event_type: string | null; published: boolean | null; max_attendance: number | null }[];
  const counts = await loadEventRegistrationCounts(rows).catch(() => ({} as Record<string, EventRegistrationCount>));
  return rows.map(r => ({ id: r.id, title: r.title, date_time: r.date_time, location: r.location, event_type: r.event_type, published: r.published, counts: counts[r.id] ?? null }));
}

/* ------------------------------------------------------------------ site health */

/**
 * The home's one line about the site monitor: what its last automatic run found (ops_health_run,
 * staff read). Null when it cannot be read: the line is then left out, never shown as "fine".
 */
export { fetchHealthLine as loadHealthLine, SITE_HEALTH_PATH, type HealthLine } from '@/components/admin/v2/health/healthApi';

/* ------------------------------------------------------------------ content */

export interface ContentItem {
  key: string;
  label: string;
  value: string | null;
  to: string;
  cue: string;
  source: string;
}

export async function loadContent(isAdmin: boolean): Promise<ContentItem[]> {
  const nowIso = new Date().toISOString();
  const [drafts, proposals, webinars, banners] = await Promise.all([
    isAdmin ? head(cnt('resources').eq('published', false)) : Promise.resolve(null),
    head(cnt('resource_drafts').in('status', ['submitted', 'review_1', 'review_2'])),
    head(cnt('webinar_requests').in('status', ['submitted', 'under_review'])),
    isAdmin
      ? supabase.from('ad_banners').select('id, title, start_date, end_date').eq('is_active', true).order('updated_at', { ascending: false })
      : Promise.resolve(null),
  ]);
  const items: ContentItem[] = [];
  if (isAdmin) {
    items.push({
      key: 'drafts', label: 'Articles in draft', value: drafts === null ? null : String(drafts),
      to: '/admin/resources', cue: 'Open the articles',
      source: 'Articles not published yet (resources.published = false).',
    });
  }
  items.push({
    key: 'proposals', label: 'Articles proposed by members', value: proposals === null ? null : String(proposals),
    to: '/admin/resources?tab=drafts', cue: 'Review them',
    source: 'Member article proposals Submitted or in review (resource_drafts).',
  });
  items.push({
    key: 'webinars', label: 'Webinar proposals', value: webinars === null ? null : String(webinars),
    to: '/admin/webinars', cue: 'Review them',
    source: 'Webinar proposals Submitted or Under review (webinar_requests).',
  });
  if (isAdmin && banners) {
    const live = banners.error
      ? null
      : ((banners.data ?? []) as { id: string; title: string | null; start_date: string | null; end_date: string | null }[])
        .filter(b => (!b.start_date || b.start_date <= nowIso) && (!b.end_date || b.end_date >= nowIso));
    const first = live?.[0];
    items.push({
      key: 'banner', label: live && live.length > 1 ? `Banners showing (${live.length})` : 'Banner showing',
      value: live === null ? null : first ? (first.title?.trim() || 'Untitled banner') : 'None',
      to: first ? `/admin/banners/${first.id}` : '/admin/banners', cue: first ? 'Open the banner' : 'Open the banners',
      source: 'Banners switched on whose dates include today (ad_banners).',
    });
  }
  return items;
}
