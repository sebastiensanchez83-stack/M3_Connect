import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  AlertTriangle, ArrowRight, Award, Building2, Check, CheckCircle2, ClipboardList, Clock, FileText,
  Flag, Inbox, Mail, Radio, RefreshCw, Store, Ticket, UserCheck, X, type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/hooks/use-toast';
import { guestList, partsLabel } from '@/lib/guestList';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { REVIEW_QUEUE_EVENT } from './reviewQueueCount';
import {
  ADMIN_BTN, ADMIN_BTN_DANGER, ADMIN_BTN_PRIMARY, AdminEmpty, AdminLoading, AdminPageHeader, AdminSegmented,
  AdminStatusPill, statusLabel, type AdminTone,
} from './AdminUI';

/**
 * /admin/review: ONE list of everything waiting for the M3 team (spec §8.1).
 *
 * The rows come from the staff-only SQL function admin_review_queue()
 * (migration 20261009230000): people and companies waiting for approval, event
 * invitation requests, reported conversations, needs, webinar proposals, article
 * drafts and the two old request queues. Each card says who, what, since when
 * and the key facts, and links to the existing screen that decides it.
 *
 * Quick decisions exist only where an existing staff action does exactly that:
 * - an event invitation request on a guest-list event (wys26) is approved or
 *   refused here through the guest-list edge function's `decide`, the same call
 *   as the Approve / Refuse buttons of /admin/guest-list/<slug>, with the same
 *   capacity question; the decision is then noted in review_log through
 *   review_log_add() when that function exists (registration lane). These two
 *   buttons only show while the switch platform_settings.registration_flags
 *   .review_queue is on (spec 13; off or missing = the guest list decides);
 * - a reported conversation is closed with the same staff update as the
 *   messaging lane's "Reported conversations" panel (conversation_reports
 *   status 'closed', allowed by that table's is_moderator() policy).
 * Everything else opens its own screen. Moderators only get the links their
 * screens allow (webinar proposals and article drafts).
 *
 * Order "Most urgent first": reported conversations, then people, companies
 * and event requests past the promised delay, then the rest; inside each group
 * the function's order (most urgent kind, then waiting longest). Or newest
 * first. The promised delay is platform_settings.review_sla_text ("within 2
 * working days"), counted in working days (Monday to Friday).
 *
 * After every load the page announces the new total on the window
 * (REVIEW_QUEUE_EVENT, detail.count) so the sidebar badge follows.
 */

type ReviewKind =
  | 'report' | 'event_request' | 'person' | 'company' | 'need'
  | 'webinar' | 'resource_draft' | 'sponsorship' | 'exposition';

const KIND_ORDER: ReviewKind[] = [
  'report', 'event_request', 'person', 'company', 'need', 'webinar', 'resource_draft', 'sponsorship', 'exposition',
];

type FactValue = string | number | boolean | null | undefined;

interface ReviewItem {
  kind: ReviewKind;
  id: string;
  title: string;
  subtitle: string | null;
  created_at: string | null;
  /** Null only on old rows whose source column allows it (marina projects, old request forms). */
  waiting_since: string | null;
  url: string;
  priority: number;
  facts: Record<string, FactValue>;
}

interface DecideResult {
  error?: string;
  ok?: boolean;
  approved?: number;
  rejected?: number;
  sent?: number;
  failed?: number;
  held?: number;
  capacity?: number;
  adding?: number;
}

type DialogState =
  | { mode: 'approve'; item: ReviewItem }
  | { mode: 'capacity'; item: ReviewItem; held: number; capacity: number; adding: number }
  | { mode: 'refuse'; item: ReviewItem; notify: boolean }
  | { mode: 'close'; item: ReviewItem };

/** The kinds whose screen a moderator (not admin) may open; every other screen is behind AdminOnlyGuard. */
const MODERATOR_SCREENS: ReviewKind[] = ['webinar', 'resource_draft'];

/** Touch targets of at least 44 px on this page (the kit's buttons are 40 px). */
const TALL = 'h-11';

const KIND_ICON: Record<ReviewKind, LucideIcon> = {
  report: Flag,
  event_request: Ticket,
  person: UserCheck,
  company: Building2,
  need: ClipboardList,
  webinar: Radio,
  resource_draft: FileText,
  sponsorship: Award,
  exposition: Store,
};

/* ─── small readers for the facts object ─── */

const str = (f: Record<string, FactValue>, k: string): string | undefined => {
  const v = f[k];
  return typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : undefined;
};
const num = (f: Record<string, FactValue>, k: string): number | undefined => {
  const v = f[k];
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() && !Number.isNaN(Number(v))) return Number(v);
  return undefined;
};
const bool = (f: Record<string, FactValue>, k: string): boolean | undefined => (typeof f[k] === 'boolean' ? (f[k] as boolean) : undefined);

function websiteHost(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const host = url.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/^www\./i, '').replace(/[/:?#].*$/, '');
  return host || undefined;
}

function toTime(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function formatDate(iso: string | null | undefined): string {
  const ms = toTime(iso);
  return ms === null ? '' : new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatDateTime(iso: string | null | undefined): string {
  const ms = toTime(iso);
  return ms === null
    ? ''
    : new Date(ms).toLocaleString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const DAY_MS = 86_400_000;

/** Whole working days (Monday to Friday) since a moment: Friday 18:00 counts 1 on Monday 18:00. */
function workingDaysSince(ms: number, now = Date.now()): number {
  let n = 0;
  // Bounded: a few hundred steps for an item waiting a year.
  for (let at = ms + DAY_MS; at <= now && n < 1000; at += DAY_MS) {
    const day = new Date(at).getDay();
    if (day !== 0 && day !== 6) n += 1;
  }
  return n;
}

/** "Waiting 3 days" (calendar time). Empty when the date is unknown. */
function waiting(iso: string | null, t: TFunction): string {
  const start = toTime(iso);
  if (start === null) return '';
  const hours = Math.max(0, Math.floor((Date.now() - start) / 3_600_000));
  const days = Math.floor(hours / 24);
  if (hours < 1) return t('adminReview.wait.now', 'Waiting less than an hour');
  if (hours < 24) return t('adminReview.wait.hours', { count: hours, defaultValue_one: 'Waiting {{count}} hour', defaultValue_other: 'Waiting {{count}} hours' });
  if (days < 14) return t('adminReview.wait.days', { count: days, defaultValue_one: 'Waiting {{count}} day', defaultValue_other: 'Waiting {{count}} days' });
  if (days < 60) {
    const weeks = Math.floor(days / 7);
    return t('adminReview.wait.weeks', { count: weeks, defaultValue_one: 'Waiting {{count}} week', defaultValue_other: 'Waiting {{count}} weeks' });
  }
  const months = Math.floor(days / 30);
  return t('adminReview.wait.months', { count: months, defaultValue_one: 'Waiting {{count}} month', defaultValue_other: 'Waiting {{count}} months' });
}

/* ─── the promised delay and the queue switch (platform_settings) ─── */

interface QueueSettings {
  /** "within N working days" (review_sla_text); 2 when missing or unreadable. */
  slaDays: number;
  /** registration_flags.review_queue: the quick Approve / Refuse of event requests. Off when missing. */
  quickDecisions: boolean;
}

const DEFAULT_SETTINGS: QueueSettings = { slaDays: 2, quickDecisions: false };

function readSettings(rows: { key: string; value: unknown }[] | null): QueueSettings {
  const out = { ...DEFAULT_SETTINGS };
  for (const r of rows ?? []) {
    if (r.key === 'review_sla_text' && typeof r.value === 'string') {
      const m = /(\d+)\s*working\s*days?/i.exec(r.value);
      const n = m ? Number(m[1]) : NaN;
      if (Number.isInteger(n) && n >= 1 && n <= 30) out.slaDays = n;
    }
    if (r.key === 'registration_flags' && r.value && typeof r.value === 'object') {
      out.quickDecisions = (r.value as Record<string, unknown>).review_queue === true;
    }
  }
  return out;
}

/** Past the promised delay: a person, company or event request waiting at least the SLA, in working days. */
function isOverdue(item: ReviewItem, slaDays: number): boolean {
  if (item.kind !== 'person' && item.kind !== 'company' && item.kind !== 'event_request') return false;
  const start = toTime(item.waiting_since);
  return start !== null && workingDaysSince(start) >= slaDays;
}

/** 0 = a reported conversation, 1 = past the promised delay, 2 = the rest. */
function urgencyRank(item: ReviewItem, slaDays: number): number {
  if (item.kind === 'report') return 0;
  return isOverdue(item, slaDays) ? 1 : 2;
}

/* ─── words ─── */

function kindLabel(kind: ReviewKind, t: TFunction): string {
  switch (kind) {
    case 'report': return t('adminReview.kind.report', 'Reported conversation');
    case 'event_request': return t('adminReview.kind.eventRequest', 'Event request');
    case 'person': return t('adminReview.kind.person', 'New member');
    case 'company': return t('adminReview.kind.company', 'Company');
    case 'need': return t('adminReview.kind.need', 'New need');
    case 'webinar': return t('adminReview.kind.webinar', 'Webinar proposal');
    case 'resource_draft': return t('adminReview.kind.resourceDraft', 'Article draft');
    case 'sponsorship': return t('adminReview.kind.sponsorship', 'Old sponsorship request');
    case 'exposition': return t('adminReview.kind.exposition', 'Old exposition request');
  }
}

function chipLabel(kind: ReviewKind, t: TFunction): string {
  switch (kind) {
    case 'report': return t('adminReview.chip.report', 'Reported conversations');
    case 'event_request': return t('adminReview.chip.eventRequest', 'Event requests');
    case 'person': return t('adminReview.chip.person', 'People');
    case 'company': return t('adminReview.chip.company', 'Companies');
    case 'need': return t('adminReview.chip.need', 'New needs');
    case 'webinar': return t('adminReview.chip.webinar', 'Webinar proposals');
    case 'resource_draft': return t('adminReview.chip.resourceDraft', 'Article drafts');
    case 'sponsorship': return t('adminReview.chip.sponsorship', 'Old sponsorship requests');
    case 'exposition': return t('adminReview.chip.exposition', 'Old exposition requests');
  }
}

function openLabel(item: ReviewItem, t: TFunction): string {
  switch (item.kind) {
    case 'report': return t('adminReview.open.report', 'See all reports');
    case 'event_request':
      // Only a guest-list event (wys26) opens its guest list; the others open their event.
      return item.facts.engine === 'guest_list_v1'
        ? t('adminReview.open.eventRequest', 'Open the guest list')
        : t('adminReview.open.event', 'Open the event');
    case 'person': return t('adminReview.open.person', 'Review and decide');
    case 'company': return t('adminReview.open.company', 'Open the company');
    case 'need': return t('adminReview.open.need', 'Open the need');
    case 'webinar': return t('adminReview.open.webinar', 'Open the proposal');
    case 'resource_draft': return t('adminReview.open.resourceDraft', 'Open the draft');
    case 'sponsorship':
    case 'exposition': return t('adminReview.open.request', 'Open the request');
  }
}

function sinceLabel(item: ReviewItem, t: TFunction): string {
  const date = formatDate(item.waiting_since);
  if (!date) return '';
  switch (item.kind) {
    case 'person': return t('adminReview.since.person', 'Signed up {{date}}', { date });
    case 'company': return t('adminReview.since.company', 'Created {{date}}', { date });
    case 'report': return t('adminReview.since.report', 'Reported {{date}}', { date });
    case 'resource_draft': return t('adminReview.since.updated', 'Last updated {{date}}', { date });
    case 'sponsorship':
    case 'exposition':
      return str(item.facts, 'status') === 'paid'
        ? t('adminReview.since.paid', 'Paid {{date}}', { date })
        : t('adminReview.since.requested', 'Requested {{date}}', { date });
    case 'event_request': return t('adminReview.since.requested', 'Requested {{date}}', { date });
    default: return t('adminReview.since.sent', 'Sent {{date}}', { date });
  }
}

function personaLabel(persona: string | undefined, t: TFunction): string | undefined {
  switch (persona) {
    case 'marina': return t('adminReview.persona.marina', 'Marina or port');
    case 'developer': return t('adminReview.persona.developer', 'Marina developer');
    case 'partner': return t('adminReview.persona.partner', 'Service provider');
    case 'media_partner': return t('adminReview.persona.media', 'Media');
    case 'investor': return t('adminReview.persona.investor', 'Investor');
    case 'individual': return t('adminReview.persona.individual', 'Individual');
    case 'moderator': return t('adminReview.persona.moderator', 'Moderator');
    case 'admin': return t('adminReview.persona.admin', 'Administrator');
    default: return undefined;
  }
}

function companyTypeLabel(type: string | undefined, t: TFunction): string | undefined {
  switch (type) {
    case 'marina': return t('adminReview.orgType.marina', 'Marina');
    case 'partner': return t('adminReview.orgType.partner', 'Service provider');
    case 'media_partner': return t('adminReview.orgType.media', 'Media');
    case 'developer': return t('adminReview.orgType.developer', 'Developer');
    case 'investor': return t('adminReview.orgType.investor', 'Investor');
    default: return undefined;
  }
}

interface FactChip { label: string; tone?: AdminTone; icon?: LucideIcon; title?: string }
interface Description {
  what: string;
  quote?: string;
  quoteLabel?: string;
  chips: FactChip[];
  contact?: string;
  /** A longer text behind a "show" toggle (a report's last messages). */
  more?: string;
  moreLabel?: string;
}

/** What the item asks for, its key facts and an optional quote, in plain words. */
function describe(item: ReviewItem, t: TFunction, canOpen: boolean): Description {
  const f = item.facts || {};
  const chips: FactChip[] = [];
  const push = (c: FactChip | false | undefined) => { if (c && c.label) chips.push(c); };

  switch (item.kind) {
    case 'person': {
      const company = str(f, 'company_name');
      const companyStatus = str(f, 'company_status');
      let what: string;
      if (!company) what = t('adminReview.what.personNoCompany', 'Signed up without a company');
      else if (companyStatus === 'pending') {
        what = str(f, 'company_role') === 'owner'
          ? t('adminReview.what.personNewCompany', 'Signed up with a new company, {{company}}, also waiting for approval', { company })
          : t('adminReview.what.personPendingCompany', 'Joins {{company}}, a company still waiting for approval', { company });
      } else if (companyStatus === 'verified') {
        what = t('adminReview.what.personVerifiedCompany', 'Joins {{company}}, an approved company', { company });
      } else {
        // The agreed status words (spec 2.3), never the raw database value.
        const status = companyStatus === 'rejected'
          ? t('adminReview.status.rejected', 'not accepted')
          : companyStatus === 'suspended'
            ? t('adminReview.status.suspended', 'suspended')
            : statusLabel(companyStatus).toLowerCase();
        what = t('adminReview.what.personOtherCompany', 'Joins {{company}} (company {{status}})', { company, status });
      }
      push({ label: personaLabel(str(f, 'persona'), t) ?? '', tone: 'navy' });
      // The company's type only when it says something the person's own type does not.
      const companyType = companyTypeLabel(str(f, 'company_type'), t);
      if (companyType && str(f, 'company_type') !== str(f, 'persona')) {
        push({ label: t('adminReview.fact.companyType', 'Company: {{type}}', { type: companyType }) });
      }
      // Rights follow the company type: M3 chooses one when it is missing.
      if (company && companyStatus === 'pending' && !str(f, 'company_type')) {
        push({ label: t('adminReview.fact.noCompanyType', 'Company type not chosen'), tone: 'warning' });
      }
      // The person's own country (asked at sign-up), then the company's when it differs.
      const personCountry = str(f, 'person_country');
      const companyCountry = str(f, 'company_country');
      push({ label: personCountry ?? '' });
      if (companyCountry && companyCountry.toLowerCase() !== (personCountry ?? '').toLowerCase()) {
        push({ label: personCountry ? t('adminReview.fact.companyCountry', 'Company in {{country}}', { country: companyCountry }) : companyCountry });
      }
      if (str(f, 'company_role') === 'owner') push({ label: t('adminReview.fact.owner', 'Company owner') });
      // No address is proven yet (sign-up does not confirm it): a domain match is only a hint until
      // email_proven is true. email_proven is absent until the database records the proof.
      const domain = str(f, 'email_domain');
      const proven = bool(f, 'email_proven');
      if (proven === true) push({ label: t('adminReview.fact.emailProven', 'E-mail address confirmed'), tone: 'success', icon: Check });
      else if (proven === false) push({ label: t('adminReview.fact.emailNotProven', 'E-mail address not confirmed yet') });
      if (bool(f, 'public_email')) {
        push({ label: t('adminReview.fact.personalEmail', 'Personal e-mail address'), tone: 'warning', icon: Mail, title: domain });
      } else if (bool(f, 'domain_match') === true) {
        push(proven === true
          ? { label: t('adminReview.fact.domainMatch', 'E-mail matches the website'), tone: 'success', icon: Check, title: domain }
          : {
            label: t('adminReview.fact.domainMatchUnproven', 'Same domain as the website (address not verified)'),
            title: t('adminReview.fact.domainMatchUnprovenHint', 'Anyone can sign up with any address: this is a hint, not a proof.'),
          });
      } else if (bool(f, 'domain_match') === false) {
        push({
          label: t('adminReview.fact.domainMismatch', 'E-mail does not match the website'),
          tone: 'warning',
          icon: AlertTriangle,
          title: [domain, websiteHost(str(f, 'company_website'))].filter(Boolean).join(' / '),
        });
      }
      if (bool(f, 'linkedin')) push({ label: t('adminReview.fact.linkedin', 'LinkedIn given'), tone: 'success' });
      if (bool(f, 'sm26')) push({ label: t('adminReview.fact.sm26Confirmed', 'Confirmed for Smart Marina 2026'), tone: 'info' });
      const members = num(f, 'company_members');
      if (members !== undefined && members > 1) {
        push({ label: t('adminReview.fact.members', { count: members, defaultValue_one: '{{count}} person in the company', defaultValue_other: '{{count}} people in the company' }) });
      }
      return { what, chips, contact: str(f, 'email') };
    }

    case 'company': {
      const members = num(f, 'members') ?? 0;
      const ownerStatus = str(f, 'owner_status');
      let what: string;
      if (members === 0) what = t('adminReview.what.companyEmpty', 'Waiting for approval, and no one belongs to it yet');
      else if (ownerStatus === 'rejected') what = t('adminReview.what.companyOwnerRejected', 'Its owner was not accepted. Open the company and refuse it too, so it leaves this list.');
      else if (ownerStatus === 'verified') what = t('adminReview.what.companyOwnerVerified', 'Its owner is approved, the company is still waiting');
      else what = t('adminReview.what.company', 'Waiting for approval');
      const type = companyTypeLabel(str(f, 'company_type'), t);
      push(type ? { label: type, tone: 'navy' } : { label: t('adminReview.fact.noType', 'Type not chosen'), tone: 'warning' });
      // The country is already the subtitle.
      push({ label: t('adminReview.fact.members', { count: members, defaultValue_one: '{{count}} person in the company', defaultValue_other: '{{count}} people in the company' }) });
      const owner = str(f, 'owner_name');
      if (owner) push({ label: t('adminReview.fact.ownerName', 'Owner: {{name}}', { name: owner }) });
      return { what, chips };
    }

    case 'event_request': {
      const event = str(f, 'event_title') ?? str(f, 'event_slug') ?? t('adminReview.fact.anEvent', 'an event');
      const host = str(f, 'plus_one_of');
      const what = str(f, 'source') === 'plus_one'
        ? t('adminReview.what.plusOne', 'Plus-one of {{host}} for {{event}}', { host: host ?? t('adminReview.fact.aGuest', 'a guest'), event })
        : t('adminReview.what.eventRequest', 'Asks for an invitation to {{event}}', { event });
      const parts = partsLabel({ conference: bool(f, 'wants_conference') === true, gala: bool(f, 'wants_gala') === true });
      push({ label: parts === '—' ? t('adminReview.fact.noPart', 'No part chosen') : parts, tone: parts === '—' ? 'warning' : 'navy' });
      push({ label: str(f, 'country') ?? '' });
      const capacity = num(f, 'capacity');
      const held = num(f, 'seats_held');
      if (capacity !== undefined && held !== undefined) {
        push({
          label: t('adminReview.fact.seats', '{{held}} of {{capacity}} seats taken', { held, capacity }),
          tone: held >= capacity ? 'danger' : 'neutral',
          title: t('adminReview.fact.seatsHint', 'Confirmed guests plus invitations awaiting an answer'),
        });
      }
      return {
        what,
        chips,
        contact: str(f, 'email'),
        quote: str(f, 'motivation'),
        quoteLabel: t('adminReview.quote.motivation', 'Why they want to come'),
      };
    }

    case 'report': {
      if (bool(f, 'unreadable')) {
        // admin_review_queue() could not read conversation_reports (columns changed): never drop them silently.
        return {
          what: canOpen
            ? t('adminReview.what.reportUnreadable', 'The reported conversations could not be read here. Open B2B requests in the menu to see them.')
            : t('adminReview.what.reportUnreadableModerator', 'The reported conversations could not be read here. Ask an administrator to look under B2B requests.'),
          chips,
        };
      }
      const by = [str(f, 'reporter_name'), str(f, 'reporter_company')].filter(Boolean).join(', ');
      const what = by
        ? t('adminReview.what.reportBy', 'Reported to M3 by {{by}}', { by })
        : t('adminReview.what.report', 'Reported to M3 by a member');
      if (bool(f, 'one_message')) push({ label: t('adminReview.fact.oneMessage', 'About one message'), tone: 'warning' });
      return {
        what,
        chips,
        quote: str(f, 'reason'),
        quoteLabel: t('adminReview.quote.reason', 'Reason given'),
        // The only way M3 reads a conversation: the last messages, copied when the report was sent.
        more: str(f, 'excerpt'),
        moreLabel: t('adminReview.more.excerpt', 'The last messages at the time of the report'),
      };
    }

    case 'need': {
      const type = str(f, 'need_type');
      const what = type === 'rfp'
        ? t('adminReview.what.rfp', 'Request for proposals waiting to be published')
        : type === 'consultation'
          ? t('adminReview.what.consultation', 'Consultation waiting to be published')
          : t('adminReview.what.project', 'Marina project waiting for M3');
      const status = str(f, 'status');
      if (status === 'under_review') push({ label: t('adminReview.fact.beingReviewed', 'Being reviewed'), tone: 'info' });
      const author = str(f, 'author_name');
      if (author && author !== item.subtitle) push({ label: t('adminReview.fact.by', 'By {{name}}', { name: author }) });
      const deadline = str(f, 'deadline');
      if (deadline) push({ label: t('adminReview.fact.deadline', 'Deadline {{date}}', { date: formatDate(deadline) }) });
      const budget = str(f, 'budget_range');
      if (budget) push({ label: t('adminReview.fact.budget', 'Budget: {{budget}}', { budget }) });
      const timeline = str(f, 'timeline');
      if (timeline) push({ label: t('adminReview.fact.timeline', 'Timeline: {{timeline}}', { timeline }) });
      return { what, chips };
    }

    case 'webinar': {
      const status = str(f, 'status');
      if (status === 'under_review') push({ label: t('adminReview.fact.beingReviewed', 'Being reviewed'), tone: 'info' });
      const language = str(f, 'language');
      if (language) push({ label: t('adminReview.fact.language', 'Language: {{language}}', { language }) });
      const timeframe = str(f, 'timeframe');
      if (timeframe) push({ label: t('adminReview.fact.timeframe', 'When: {{timeframe}}', { timeframe }) });
      return { what: t('adminReview.what.webinar', 'Proposes a webinar'), chips };
    }

    case 'resource_draft': {
      const status = str(f, 'status');
      push({
        label: status === 'review_1'
          ? t('adminReview.fact.review1', 'In first review')
          : status === 'review_2'
            ? t('adminReview.fact.review2', 'In second review')
            : t('adminReview.fact.submitted', 'Sent for review'),
        tone: 'info',
      });
      const type = str(f, 'type');
      if (type) push({ label: statusLabel(type) });
      return { what: t('adminReview.what.resourceDraft', 'Article draft waiting for review'), chips };
    }

    case 'sponsorship': {
      const tier = str(f, 'requested_tier');
      if (str(f, 'status') === 'paid') push({ label: t('adminReview.fact.paid', 'Paid, waiting for approval'), tone: 'warning' });
      return {
        what: tier
          ? t('adminReview.what.sponsorshipTier', 'Asks for the {{tier}} level (old request form)', { tier: statusLabel(tier) })
          : t('adminReview.what.sponsorship', 'Sponsorship request from the old form'),
        chips,
      };
    }

    case 'exposition': {
      const event = str(f, 'event_title');
      if (str(f, 'status') === 'paid') push({ label: t('adminReview.fact.paid', 'Paid, waiting for approval'), tone: 'warning' });
      return {
        what: event
          ? t('adminReview.what.expositionEvent', 'Asks for exhibition space at {{event}} (old request form)', { event })
          : t('adminReview.what.exposition', 'Exhibition space request from the old form'),
        chips,
      };
    }

    default:
      // A kind this page does not know yet (load() leaves them out; kept as a safety net).
      return { what: '', chips };
  }
}

/* ─── the page ─── */

export function AdminReviewQueue() {
  const { t } = useTranslation();
  const { user, isAdmin } = useAuth();
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [refreshing, setRefreshing] = useState(false);
  const [sort, setSort] = useState<'urgent' | 'newest'>('urgent');
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState<QueueSettings>(DEFAULT_SETTINGS);
  const [params, setParams] = useSearchParams();
  const loadedOnce = useRef(false);

  const typeParam = params.get('type');
  const filter: ReviewKind | 'all' = (KIND_ORDER as string[]).includes(typeParam ?? '') ? (typeParam as ReviewKind) : 'all';
  const setFilter = (next: ReviewKind | 'all') => {
    const p = new URLSearchParams(params);
    if (next === 'all') p.delete('type'); else p.set('type', next);
    setParams(p, { replace: true });
  };

  const load = useCallback(async () => {
    if (loadedOnce.current) setRefreshing(true);
    const [{ data, error }, conf] = await Promise.all([
      supabase.rpc('admin_review_queue'),
      // The promised delay and the queue switch; unreadable = 2 working days, quick decisions off.
      supabase.from('platform_settings').select('key, value').in('key', ['review_sla_text', 'registration_flags']),
    ]);
    setSettings(conf.error ? DEFAULT_SETTINGS : readSettings(conf.data as { key: string; value: unknown }[] | null));
    if (error) {
      const msg = error.message || '';
      const missing = error.code === 'PGRST202' || error.code === '42883'
        || (/admin_review_queue/.test(msg) && /(could not find|does not exist)/i.test(msg));
      if (missing) setState('missing');
      else if (loadedOnce.current) {
        toast({ title: t('adminReview.toast.reloadFailed', 'The list could not be refreshed'), description: msg, variant: 'destructive' });
      } else setState('error');
    } else {
      // Only the kinds this page knows: a later migration may add others before its screen ships.
      const rows = ((Array.isArray(data) ? data : []) as ReviewItem[]).filter(r => (KIND_ORDER as string[]).includes(r.kind));
      setItems(rows.map(r => ({ ...r, facts: r.facts && typeof r.facts === 'object' ? r.facts : {} })));
      setState('ready');
      window.dispatchEvent(new CustomEvent(REVIEW_QUEUE_EVENT, { detail: { count: rows.length } }));
    }
    loadedOnce.current = true;
    setRefreshing(false);
  }, [t]);

  // Keyed on the user id: auth re-emits a fresh user object on every tab refocus.
  const uid = user?.id;
  useEffect(() => {
    if (uid) load();
  }, [uid, load]);

  const counts = useMemo(() => {
    const c = Object.fromEntries(KIND_ORDER.map(k => [k, 0])) as Record<ReviewKind, number>;
    for (const i of items) if (i.kind in c) c[i.kind] += 1;
    return c;
  }, [items]);

  const visible = useMemo(() => {
    const list = filter === 'all' ? items : items.filter(i => i.kind === filter);
    // Most urgent first: reports, then what is past the promised delay, then the rest. The sort is
    // stable, so each group keeps the function's order (most urgent kind, then waiting longest).
    if (sort === 'urgent') return [...list].sort((a, b) => urgencyRank(a, settings.slaDays) - urgencyRank(b, settings.slaDays));
    return [...list].sort((a, b) => (toTime(b.waiting_since) ?? 0) - (toTime(a.waiting_since) ?? 0));
  }, [items, filter, sort, settings.slaDays]);

  /* ─── quick decisions on a guest-list request (same call as /admin/guest-list/<slug>) ─── */

  const decide = async (item: ReviewItem, decision: 'approve' | 'reject', extra: Record<string, unknown> = {}) => {
    setBusy(true);
    const r = await guestList<DecideResult>({
      action: 'decide',
      slug: str(item.facts, 'event_slug'),
      guest_ids: [item.id],
      decision,
      ...extra,
    });
    setBusy(false);
    return r;
  };

  /** One review_log row per decision (spec 8.1). review_log_add() ships with the registration lane:
   *  until it exists the call fails quietly, and the decision itself is already saved. */
  const logDecision = (item: ReviewItem, action: 'approve' | 'reject', details: Record<string, unknown>) => {
    void supabase
      .rpc('review_log_add', {
        p_subject_type: 'registration',
        p_subject_id: item.id,
        p_action: action,
        p_note: null,
        p_details: { source: 'review_queue', gl_event_id: str(item.facts, 'event_id') ?? null, ...details },
      })
      .then(() => undefined, () => undefined);
  };

  const approve = async (item: ReviewItem, force = false) => {
    const r = await decide(item, 'approve', force ? { force: true } : {});
    if (r.error === 'capacity') {
      setDialog({ mode: 'capacity', item, held: r.held ?? 0, capacity: r.capacity ?? 0, adding: r.adding ?? 1 });
      return;
    }
    setDialog(null);
    if (r.error) {
      toast({ title: t('adminReview.toast.notDone', 'Not done'), description: r.error, variant: 'destructive' });
    } else if (!r.approved || ((r.sent ?? 0) + (r.failed ?? 0)) === 0) {
      // No pass was attempted: someone else decided between the read and the update.
      toast({ title: t('adminReview.toast.alreadyDecided', 'Already decided'), description: t('adminReview.toast.alreadyDecidedBody', 'Someone else decided this request. The list is now up to date.') });
    } else if (r.failed) {
      logDecision(item, 'approve', { status: 'confirmed', forced: force || undefined, pass_emailed: false });
      toast({
        title: t('adminReview.toast.approvedNoMail', 'Approved, but the e-mail was not sent'),
        description: t('adminReview.toast.approvedNoMailBody', 'Send the entry pass again from the guest list.'),
        variant: 'destructive',
      });
    } else {
      logDecision(item, 'approve', { status: 'confirmed', forced: force || undefined, pass_emailed: true });
      toast({ title: t('adminReview.toast.approved', 'Approved'), description: t('adminReview.toast.approvedBody', 'The entry pass was e-mailed.') });
    }
    await load();
  };

  const refuse = async (item: ReviewItem, notify: boolean) => {
    const r = await decide(item, 'reject', { notify });
    setDialog(null);
    if (r.error) {
      toast({ title: t('adminReview.toast.notDone', 'Not done'), description: r.error, variant: 'destructive' });
    } else if (!r.rejected) {
      toast({ title: t('adminReview.toast.alreadyDecided', 'Already decided'), description: t('adminReview.toast.alreadyDecidedBody', 'Someone else decided this request. The list is now up to date.') });
    } else {
      logDecision(item, 'reject', { status: 'rejected', notify });
      toast({
        title: t('adminReview.toast.refused', 'Request refused'),
        description: notify
          ? (r.sent ? t('adminReview.toast.refusedMailed', 'A polite decline e-mail was sent.') : t('adminReview.toast.refusedMailFailed', 'The decline e-mail could not be sent.'))
          : t('adminReview.toast.refusedSilent', 'No e-mail was sent.'),
      });
    }
    await load();
  };

  /* ─── close a reported conversation (same staff update as the messaging lane's reports panel) ─── */

  const closeReport = async (item: ReviewItem) => {
    setBusy(true);
    const { data, error } = await supabase
      .from('conversation_reports')
      .update({ status: 'closed' })
      .eq('id', item.id)
      .eq('status', 'open')
      .select('id');
    setBusy(false);
    setDialog(null);
    if (error) {
      toast({ title: t('adminReview.toast.notDone', 'Not done'), description: error.message, variant: 'destructive' });
    } else if (!data?.length) {
      toast({ title: t('adminReview.toast.alreadyClosed', 'Already closed'), description: t('adminReview.toast.alreadyClosedBody', 'Someone else closed this report. The list is now up to date.') });
    } else {
      toast({ title: t('adminReview.toast.closed', 'Report closed'), description: t('adminReview.toast.closedBody', 'Nobody is told. An administrator can reopen it under B2B requests in the menu.') });
    }
    await load();
  };

  /* ─── render ─── */

  if (state === 'loading') return <AdminLoading />;

  const refreshButton = (
    <Button variant="outline" size="sm" className={cn(ADMIN_BTN, TALL)} onClick={() => load()} disabled={refreshing}>
      <RefreshCw className={cn('mr-2 h-4 w-4', refreshing && 'animate-spin motion-reduce:animate-none')} aria-hidden="true" />
      {t('adminUi.refresh', 'Refresh')}
    </Button>
  );

  const header = (
    <AdminPageHeader
      title={t('adminReview.title', 'To review')}
      count={state === 'ready' ? items.length : undefined}
      description={t('adminReview.description', 'Everything waiting for a decision from the M3 team. Decide with the buttons on a card, or open it.')}
      meta={!isAdmin ? <span>{t('adminReview.moderatorNote', 'As a moderator, you see reported conversations, webinar proposals and article drafts. People, companies and event requests are reviewed by the administrators.')}</span> : undefined}
      actions={refreshButton}
    />
  );

  if (state === 'missing' || state === 'error') {
    return (
      <div>
        {header}
        <div className="rounded-card border border-rule bg-white">
          {state === 'missing' ? (
            <AdminEmpty
              icon={Inbox}
              title={t('adminReview.missing.title', 'The review list is not available yet')}
              body={t('adminReview.missing.body', 'It needs a database update that is not live yet. In the meantime, use the other admin pages.')}
            />
          ) : (
            <AdminEmpty
              icon={AlertTriangle}
              title={t('adminReview.error.title', 'The list could not be loaded')}
              body={t('adminReview.error.body', 'Check your connection, then try again.')}
              action={<Button variant="outline" size="sm" className={cn(ADMIN_BTN, TALL)} onClick={() => load()}>{t('adminReview.error.retry', 'Try again')}</Button>}
            />
          )}
        </div>
      </div>
    );
  }

  const presentKinds = KIND_ORDER.filter(k => counts[k] > 0);

  return (
    <div>
      {header}

      {items.length > 0 && (
        <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          {/* Phone: one line that scrolls sideways, so the first item stays in view. No sticky element inside. */}
          <div
            role="group"
            aria-label={t('adminReview.filterLabel', 'Show one type')}
            className="-mx-4 flex min-w-0 flex-1 flex-nowrap gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0"
          >
            <TypeChip active={filter === 'all'} onClick={() => setFilter('all')} icon={Inbox} label={t('adminReview.chip.all', 'Everything')} count={items.length} />
            {presentKinds.map(k => (
              <TypeChip key={k} active={filter === k} onClick={() => setFilter(k)} icon={KIND_ICON[k]} label={chipLabel(k, t)} count={counts[k]} />
            ))}
          </div>
          <AdminSegmented
            label={t('adminReview.sortLabel', 'Order')}
            value={sort}
            onChange={setSort}
            className="shrink-0 self-start whitespace-nowrap [&>button]:h-11"
            options={[
              { value: 'urgent', label: t('adminReview.sort.urgent', 'Most urgent first') },
              { value: 'newest', label: t('adminReview.sort.newest', 'Newest first') },
            ]}
          />
        </div>
      )}

      {items.length === 0 ? (
        <div className="rounded-card border border-rule bg-white">
          <AdminEmpty
            icon={CheckCircle2}
            title={t('adminReview.empty.title', 'Nothing to review')}
            body={isAdmin
              ? t('adminReview.empty.body', 'Everything waiting for the M3 team has been handled. New sign-ups and requests appear here as soon as they arrive.')
              : t('adminReview.empty.bodyModerator', 'Nothing waiting for you. New reported conversations, webinar proposals and article drafts appear here as soon as they are sent.')}
          />
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-card border border-rule bg-white">
          <AdminEmpty
            icon={Inbox}
            title={t('adminReview.emptyFilter.title', 'Nothing of this type to review')}
            action={<Button variant="outline" size="sm" className={cn(ADMIN_BTN, TALL)} onClick={() => setFilter('all')}>{t('adminReview.emptyFilter.showAll', 'Show everything')}</Button>}
          />
        </div>
      ) : (
        <ul className="space-y-3" aria-label={t('adminReview.listLabel', 'Items to review')}>
          {visible.map(item => (
            <ReviewCard
              key={`${item.kind}:${item.id}`}
              item={item}
              busy={busy}
              canOpen={isAdmin || MODERATOR_SCREENS.includes(item.kind)}
              quickDecisions={settings.quickDecisions}
              slaDays={settings.slaDays}
              onApprove={() => setDialog({ mode: 'approve', item })}
              onRefuse={() => setDialog({ mode: 'refuse', item, notify: false })}
              onClose={() => setDialog({ mode: 'close', item })}
            />
          ))}
        </ul>
      )}

      <Dialog open={!!dialog} onOpenChange={open => { if (!open && !busy) setDialog(null); }}>
        <DialogContent className="sm:max-w-md">
          {dialog?.mode === 'approve' && (() => {
            const f = dialog.item.facts;
            const event = str(f, 'event_title') ?? str(f, 'event_slug') ?? '';
            const parts = partsLabel({ conference: bool(f, 'wants_conference') === true, gala: bool(f, 'wants_gala') === true });
            return (
              <>
                <DialogHeader>
                  <DialogTitle>{t('adminReview.approve.title', 'Approve {{name}}?', { name: dialog.item.title })}</DialogTitle>
                  <DialogDescription>
                    {t('adminReview.approve.body', '{{name}} gets a confirmed seat for {{parts}} at {{event}}. Their entry pass with its QR code is e-mailed right away.', { name: dialog.item.title, parts, event })}
                    {' '}
                    {t('adminReview.approve.parts', 'To change the parts, open the guest list instead.')}
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter className="gap-2 sm:gap-2">
                  <Button variant="outline" size="sm" className={cn(ADMIN_BTN, TALL)} onClick={() => setDialog(null)} disabled={busy}>
                    {t('adminReview.cancel', 'Cancel')}
                  </Button>
                  <Button size="sm" className={cn(ADMIN_BTN_PRIMARY, TALL)} onClick={() => approve(dialog.item)} disabled={busy}>
                    <Check className="mr-1.5 h-4 w-4" aria-hidden="true" />
                    {t('adminReview.approve.confirm', 'Approve and e-mail the pass')}
                  </Button>
                </DialogFooter>
              </>
            );
          })()}

          {dialog?.mode === 'capacity' && (
            <>
              <DialogHeader>
                <DialogTitle>{t('adminReview.capacity.title', 'The event is full')}</DialogTitle>
                <DialogDescription>
                  {t('adminReview.capacity.body', 'Approving would bring the guest list to {{total}} for a capacity of {{capacity}} (confirmed guests plus invitations awaiting an answer). Go over capacity anyway?', {
                    total: dialog.held + dialog.adding,
                    capacity: dialog.capacity,
                  })}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="gap-2 sm:gap-2">
                <Button variant="outline" size="sm" className={cn(ADMIN_BTN, TALL)} onClick={() => setDialog(null)} disabled={busy}>
                  {t('adminReview.capacity.no', 'No, keep the limit')}
                </Button>
                <Button size="sm" className={cn(ADMIN_BTN_PRIMARY, TALL)} onClick={() => approve(dialog.item, true)} disabled={busy}>
                  {t('adminReview.capacity.yes', 'Approve over capacity')}
                </Button>
              </DialogFooter>
            </>
          )}

          {dialog?.mode === 'refuse' && (
            <>
              <DialogHeader>
                <DialogTitle>{t('adminReview.refuse.title', 'Refuse the request from {{name}}?', { name: dialog.item.title })}</DialogTitle>
                <DialogDescription>
                  {t('adminReview.refuse.body', 'The request is marked as refused. They will not be told unless you tick the box below.')}
                </DialogDescription>
              </DialogHeader>
              {/* The whole row is the label: a 44 px target, not only the small box. */}
              <label
                htmlFor="review-refuse-notify"
                className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-rule bg-white px-3 py-2.5 text-[14px] leading-5 text-navy transition-colors hover:border-navy/30"
              >
                <Checkbox
                  id="review-refuse-notify"
                  checked={dialog.notify}
                  onCheckedChange={v => setDialog(d => (d && d.mode === 'refuse' ? { ...d, notify: v === true } : d))}
                />
                <span>{t('adminReview.refuse.notify', 'Send them a polite decline e-mail')}</span>
              </label>
              <DialogFooter className="gap-2 sm:gap-2">
                <Button variant="outline" size="sm" className={cn(ADMIN_BTN, TALL)} onClick={() => setDialog(null)} disabled={busy}>
                  {t('adminReview.cancel', 'Cancel')}
                </Button>
                <Button variant="outline" size="sm" className={cn(ADMIN_BTN_DANGER, TALL)} onClick={() => refuse(dialog.item, dialog.notify)} disabled={busy}>
                  <X className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  {t('adminReview.refuse.confirm', 'Refuse the request')}
                </Button>
              </DialogFooter>
            </>
          )}

          {dialog?.mode === 'close' && (
            <>
              <DialogHeader>
                <DialogTitle>{t('adminReview.close.title', 'Close this report?')}</DialogTitle>
                <DialogDescription>
                  {t('adminReview.close.body', 'Close it once you have read it and done what was needed. It leaves this list and nobody is told. An administrator can reopen it under B2B requests in the menu.')}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="gap-2 sm:gap-2">
                <Button variant="outline" size="sm" className={cn(ADMIN_BTN, TALL)} onClick={() => setDialog(null)} disabled={busy}>
                  {t('adminReview.cancel', 'Cancel')}
                </Button>
                <Button size="sm" className={cn(ADMIN_BTN_PRIMARY, TALL)} onClick={() => closeReport(dialog.item)} disabled={busy}>
                  <Check className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  {t('adminReview.close.confirm', 'Close the report')}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ─── pieces ─── */

function TypeChip({ active, onClick, icon: Icon, label, count }: {
  active: boolean; onClick: () => void; icon: LucideIcon; label: string; count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-pill border px-3.5 text-[13px] font-semibold transition-colors',
        'focus:outline-none focus-visible:shadow-focus',
        active ? 'border-navy bg-navy text-white' : 'border-rule bg-white text-navy hover:border-navy/30 hover:bg-chip',
      )}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{label}</span>
      <span className={cn('rounded-pill px-1.5 text-[11px] font-bold leading-5 tabular-nums', active ? 'bg-white/20 text-white' : 'bg-chip text-navy')}>
        {count}
      </span>
    </button>
  );
}

function ReviewCard({ item, busy, canOpen, quickDecisions, slaDays, onApprove, onRefuse, onClose }: {
  item: ReviewItem; busy: boolean; canOpen: boolean; quickDecisions: boolean; slaDays: number;
  onApprove: () => void; onRefuse: () => void; onClose: () => void;
}) {
  const { t } = useTranslation();
  const Icon = KIND_ICON[item.kind] ?? Inbox;
  const d = describe(item, t, canOpen);
  // The stand-in row of an unreadable reports table: nothing to close, no date of its own.
  const unreadable = item.kind === 'report' && item.facts.unreadable === true;
  const waitText = unreadable ? '' : waiting(item.waiting_since, t);
  // Red "Urgent" only for a reported conversation; amber "Over N working days" for a person, company or
  // event request past the promised delay (the same rule as the "Most urgent first" order).
  const urgent = item.kind === 'report';
  const overdue = isOverdue(item, slaDays);
  // Contact and "since" date; an old row without a date shows neither.
  const contactLine = unreadable ? '' : [d.contact, sinceLabel(item, t)].filter(Boolean).join(' · ');

  // Quick decisions: only a request on a guest-list event (engine guest_list_v1), like the guest list's own
  // buttons, and only while the review_queue switch is on.
  const quick = quickDecisions && item.kind === 'event_request' && item.facts.engine === 'guest_list_v1' && !!str(item.facts, 'event_slug');
  const hasPart = item.facts.wants_conference === true || item.facts.wants_gala === true;

  return (
    <li className="rounded-card border border-rule bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <AdminStatusPill tone="info" icon={Icon}>{kindLabel(item.kind, t)}</AdminStatusPill>
        {urgent && <AdminStatusPill tone="danger" icon={AlertTriangle}>{t('adminReview.urgent', 'Urgent')}</AdminStatusPill>}
        {overdue && (
          <AdminStatusPill tone="warning" icon={Clock} title={t('adminReview.overdueHint', 'M3 promises an answer within {{count}} working days.', { count: slaDays })}>
            {t('adminReview.overdue', { count: slaDays, defaultValue_one: 'Over {{count}} working day', defaultValue_other: 'Over {{count}} working days' })}
          </AdminStatusPill>
        )}
        {waitText && (
          <span
            className={cn('ml-auto inline-flex items-center gap-1 text-[13px] font-medium leading-5', overdue ? 'text-amber-800' : 'text-meta')}
            title={formatDateTime(item.waiting_since)}
          >
            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
            {waitText}
          </span>
        )}
      </div>

      <h3 className="mt-3 text-[16px] font-semibold leading-6 text-navy [overflow-wrap:anywhere]">{item.title}</h3>
      {/* A report's subtitle is the start of its reason, shown in full in the quote below. */}
      {item.subtitle && item.kind !== 'report' && <p className="text-[14px] leading-5 text-meta [overflow-wrap:anywhere]">{item.subtitle}</p>}
      <p className="mt-1.5 text-[14px] leading-5 text-navy">{d.what}</p>

      {d.quote && (
        <blockquote className="mt-2.5 border-l-2 border-teal pl-3 text-[13px] leading-5 text-meta">
          {d.quoteLabel && <span className="block text-[12px] font-semibold text-navy">{d.quoteLabel}</span>}
          <span className="line-clamp-3 [overflow-wrap:anywhere]">{d.quote}</span>
        </blockquote>
      )}

      {d.more && (
        <details className="mt-2">
          <summary className="inline-flex min-h-11 cursor-pointer items-center text-[14px] font-semibold text-navy underline decoration-navy/30 underline-offset-[3px] hover:decoration-gold">
            {d.moreLabel}
          </summary>
          <pre className="mt-1 max-h-80 overflow-auto whitespace-pre-wrap rounded-xl bg-page p-3 font-sans text-[13px] leading-5 text-navy [overflow-wrap:anywhere]">{d.more}</pre>
        </details>
      )}

      {d.chips.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label={t('adminReview.factsLabel', 'Key facts')}>
          {d.chips.map((c, i) => (
            <li key={i}>
              <AdminStatusPill tone={c.tone ?? 'neutral'} icon={c.icon} title={c.title}>{c.label}</AdminStatusPill>
            </li>
          ))}
        </ul>
      )}

      {contactLine && <p className="mt-3 text-[13px] leading-5 text-meta [overflow-wrap:anywhere]">{contactLine}</p>}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {quick && (
          <>
            <Button
              size="sm"
              className={cn(ADMIN_BTN_PRIMARY, TALL)}
              onClick={onApprove}
              disabled={busy || !hasPart}
              aria-label={t('adminReview.approve.aria', 'Approve {{name}}', { name: item.title })}
            >
              <Check className="mr-1.5 h-4 w-4" aria-hidden="true" />
              {t('adminReview.approve.button', 'Approve')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className={cn(ADMIN_BTN_DANGER, TALL)}
              onClick={onRefuse}
              disabled={busy}
              aria-label={t('adminReview.refuse.aria', 'Refuse the request from {{name}}', { name: item.title })}
            >
              <X className="mr-1.5 h-4 w-4" aria-hidden="true" />
              {t('adminReview.refuse.button', 'Refuse')}
            </Button>
          </>
        )}
        {item.kind === 'report' && !unreadable && (
          <Button
            size="sm"
            className={cn(ADMIN_BTN_PRIMARY, TALL)}
            onClick={onClose}
            disabled={busy}
            aria-label={t('adminReview.close.aria', 'Close the report about {{name}}', { name: item.title })}
          >
            <Check className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {t('adminReview.close.button', 'Close the report')}
          </Button>
        )}
        {canOpen && (
          <Button asChild variant="outline" size="sm" className={cn(ADMIN_BTN, TALL)}>
            <Link to={item.url}>
              {openLabel(item, t)}
              <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
        )}
        {quick && !hasPart && (
          <span className="text-[13px] leading-5 text-meta">
            {t('adminReview.approve.needPart', 'Choose conference or gala dinner in the guest list first.')}
          </span>
        )}
      </div>
    </li>
  );
}
