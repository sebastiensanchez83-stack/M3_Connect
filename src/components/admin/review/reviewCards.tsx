import { forwardRef, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  AlertTriangle, ArrowRight, Building2, Check, Clock, Copy, Eye, History, Inbox, KeyRound, Link2, Mail,
  Ticket, UserCheck, UserPlus, Users, type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { partsLabel } from '@/lib/guestList';
import { cn } from '@/lib/utils';
import {
  KIND_ICON, describe, formatDate, formatDateTime, kindLabel, personaLabel, sinceLabel, waiting,
  type FactChip, type ReviewItem, type ReviewKind,
} from '../AdminReviewQueue';
import { ADMIN_BTN, ADMIN_BTN_DANGER, ADMIN_BTN_PRIMARY, AdminStatusPill } from '../AdminUI';
import { orgTypeLabel } from './CompanyChoice';
import { CONTENT_KINDS, fBool, fNum, fObj, fStr, type Facts, type QueueRow } from './reviewApi';

/**
 * The cards of queue v2: who and what in one sentence, the signals M3 checks (§8.1: e-mail
 * confirmed, e-mail domain = website, existing account, Smart Marina 2026, LinkedIn, possible
 * duplicate with its score, status link opened, time waiting), and ONE main action in gold.
 * Content cards (reports, needs, proposals, drafts) are described as in queue v1.
 */

export interface CardAction {
  key: string;
  label: string;
  icon?: LucideIcon;
  tone: 'primary' | 'outline' | 'danger';
  run: () => void;
  disabled?: boolean;
  /** Said next to the buttons when the action is disabled. */
  hint?: string;
  ariaLabel?: string;
}

export interface CardLink { to: string; label: string; newTab?: boolean }

export interface CardModel {
  icon: LucideIcon;
  kindLabel: string;
  what: string;
  chips: FactChip[];
  quote?: string;
  quoteLabel?: string;
  more?: string;
  moreLabel?: string;
  contact?: string;
  /** Links under the chips (the possible duplicate). */
  extraLinks?: CardLink[];
}

const V2_ICON: Partial<Record<QueueRow['kind'], LucideIcon>> = {
  claim: KeyRound,
  join_request: UserPlus,
  team_join: Users,
  duplicate_org: Copy,
  duplicate_person: Copy,
  retro: History,
  person: UserCheck,
  event_request: Ticket,
  company: Building2,
};

function v2KindLabel(row: QueueRow, t: TFunction): string {
  switch (row.kind) {
    case 'person': return fBool(row.facts, 'draft') ? t('adminReview.v2.kind.personDraft', 'Unfinished sign-up') : t('adminReview.kind.person', 'New member');
    case 'claim': return t('adminReview.v2.kind.claim', 'Company claim');
    case 'join_request': return t('adminReview.v2.kind.joinRequest', 'Join request (owner decides)');
    case 'team_join': return t('adminReview.v2.kind.teamJoin', 'Joined a team');
    case 'duplicate_org': return t('adminReview.v2.kind.duplicateOrg', 'Possible duplicate companies');
    case 'duplicate_person': return t('adminReview.v2.kind.duplicatePerson', 'Possible duplicate accounts');
    case 'retro': return t('adminReview.v2.kind.retro', 'Validated without review');
    default: return kindLabel(row.kind as ReviewKind, t);
  }
}

/** The §8.1 signals, as chips. */
export function signalChips(row: QueueRow, t: TFunction): { chips: FactChip[]; links: CardLink[] } {
  const s = row.signals;
  const f = row.facts;
  const chips: FactChip[] = [];
  const links: CardLink[] = [];
  const proven = fBool(s, 'email_proven') ?? fBool(f, 'email_proven');
  if (proven === true) chips.push({ label: t('adminReview.fact.emailProven', 'E-mail address confirmed'), tone: 'success', icon: Check });
  else if (proven === false) chips.push({ label: t('adminReview.fact.emailNotProven', 'E-mail address not confirmed yet') });
  if (fBool(f, 'public_email')) {
    chips.push({ label: t('adminReview.fact.personalEmail', 'Personal e-mail address'), tone: 'warning', icon: Mail, title: fStr(f, 'email_domain') });
  } else {
    const dm = fBool(s, 'domain_match') ?? fBool(f, 'domain_match');
    if (dm === true) {
      chips.push(proven === true
        ? { label: t('adminReview.fact.domainMatch', 'E-mail matches the website'), tone: 'success', icon: Check }
        : {
          label: t('adminReview.fact.domainMatchUnproven', 'Same domain as the website (address not verified)'),
          title: t('adminReview.fact.domainMatchUnprovenHint', 'Anyone can sign up with any address: this is a hint, not a proof.'),
        });
    } else if (dm === false) {
      chips.push({ label: t('adminReview.fact.domainMismatch', 'E-mail does not match the website'), tone: 'warning', icon: AlertTriangle });
    }
  }
  const account = fBool(s, 'existing_account');
  if (account === true && row.kind === 'event_request') chips.push({ label: t('adminReview.v2.signal.hasAccount', 'Has an account'), tone: 'info' });
  if (account === false && (row.kind === 'event_request' || row.kind === 'claim' || row.kind === 'join_request')) {
    chips.push({ label: t('adminReview.v2.signal.noAccount', 'No account yet') });
  }
  if (fBool(s, 'sm26') || fBool(s, 'sm26_by_email')) {
    chips.push({
      label: row.kind === 'claim' || row.kind === 'join_request'
        ? t('adminReview.v2.signal.sm26Company', 'Company at Smart Marina 2026')
        : t('adminReview.fact.sm26Confirmed', 'Confirmed for Smart Marina 2026'),
      tone: 'info',
    });
  }
  if (fBool(s, 'linkedin') ?? fBool(f, 'linkedin')) chips.push({ label: t('adminReview.fact.linkedin', 'LinkedIn given'), tone: 'success' });
  const dup = fObj(s, 'duplicate');
  if (dup && row.kind !== 'duplicate_org' && row.kind !== 'duplicate_person') {
    const score = fNum(dup, 'score');
    const pct = score !== undefined ? Math.round(score * 100) : undefined;
    const name = fStr(dup, 'name');
    chips.push({
      label: pct !== undefined
        ? t('adminReview.v2.signal.duplicateScore', 'Possible duplicate ({{score}}%)', { score: pct })
        : t('adminReview.v2.signal.duplicate', 'Possible duplicate'),
      tone: 'warning',
      icon: AlertTriangle,
      title: name,
    });
    const id = fStr(dup, 'id');
    const kind = fStr(dup, 'kind');
    if (id && (kind === 'person' || kind === 'company')) {
      links.push({
        to: kind === 'person' ? `/admin/users/${id}` : `/admin/organizations/${id}`,
        label: name
          ? t('adminReview.v2.signal.openDuplicateNamed', 'See the possible duplicate: {{name}}', { name })
          : t('adminReview.v2.signal.openDuplicate', 'See the possible duplicate'),
        newTab: true,
      });
    }
  }
  const opened = fStr(s, 'link_opened_at');
  if (opened) chips.push({ label: t('adminReview.v2.signal.linkOpened', 'Opened their status link {{date}}', { date: formatDate(opened) }), tone: 'info', icon: Eye });
  const asked = fStr(s, 'info_requested_at');
  if (asked) chips.push({ label: t('adminReview.v2.signal.asked', 'Detail asked {{date}}', { date: formatDate(asked) }), tone: 'info', icon: Clock });
  return { chips, links };
}

function personWhat(f: Facts, t: TFunction): string {
  const company = fStr(f, 'company_name');
  const status = fStr(f, 'company_status');
  const type = orgTypeLabel(fStr(f, 'company_type'), t);
  const country = fStr(f, 'company_country');
  const paren = [type, country].filter(Boolean).join(', ');
  const intent = fObj(f, 'intent');
  const iAction = fStr(intent, 'action');
  const iName = fStr(intent, 'name');
  const iParen = [orgTypeLabel(fStr(intent, 'type'), t), fStr(intent, 'country')].filter(Boolean).join(', ');
  if (company) {
    if (status === 'pending') {
      return fStr(f, 'company_role') === 'owner'
        ? (paren
          ? t('adminReview.v2.what.personNewCompanyP', 'Signed up with a new company: {{company}} ({{paren}}), also waiting for approval', { company, paren })
          : t('adminReview.what.personNewCompany', 'Signed up with a new company, {{company}}, also waiting for approval', { company }))
        : t('adminReview.what.personPendingCompany', 'Joins {{company}}, a company still waiting for approval', { company });
    }
    if (status === 'verified') return t('adminReview.what.personVerifiedCompany', 'Joins {{company}}, an approved company', { company });
    return t('adminReview.v2.what.personOther', 'Linked to {{company}} (not accepted or suspended)', { company });
  }
  if (iAction === 'new' && iName) {
    return iParen
      ? t('adminReview.v2.what.personDeclaredP', 'Wants to add a new company: {{name}} ({{paren}})', { name: iName, paren: iParen })
      : t('adminReview.v2.what.personDeclared', 'Wants to add a new company: {{name}}', { name: iName });
  }
  if (iAction === 'join') {
    return iName
      ? t('adminReview.v2.what.personPicked', 'Picked {{name}}, a company already on the platform', { name: iName })
      : t('adminReview.v2.what.personPickedAny', 'Picked a company already on the platform');
  }
  return t('adminReview.what.personNoCompany', 'Signed up without a company');
}

function retroReason(r: string, t: TFunction): string {
  switch (r) {
    case 'team_invite': return t('adminReview.v2.retro.teamInvite', 'joined a team by invitation');
    case 'claimed_company': return t('adminReview.v2.retro.claimed', 'claimed a company');
    case 'auto_verified_company': return t('adminReview.v2.retro.autoVerified', 'their company was validated automatically');
    case 'sm26_delegation': return t('adminReview.v2.retro.sm26', 'account made for a Smart Marina 2026 delegation');
    default: return r.replace(/_/g, ' ');
  }
}

function personStatusWord(status: string | undefined, t: TFunction): FactChip | null {
  switch (status) {
    case 'pending': return { label: t('adminReview.v2.person.pending', 'Account under review'), tone: 'warning' };
    case 'verified': return { label: t('adminReview.v2.person.verified', 'Account validated'), tone: 'success' };
    case 'rejected': return { label: t('adminReview.v2.person.rejected', 'Account not accepted'), tone: 'danger' };
    case 'suspended': return { label: t('adminReview.v2.person.suspended', 'Account suspended'), tone: 'danger' };
    default: return null;
  }
}

/** Who and what, chips and quote, for any card. */
export function describeRow(row: QueueRow, t: TFunction, canOpen: boolean): CardModel {
  const f = row.facts;
  const sig = signalChips(row, t);
  const base = { icon: V2_ICON[row.kind] ?? KIND_ICON[row.kind as ReviewKind] ?? Inbox, kindLabel: v2KindLabel(row, t), extraLinks: sig.links };

  // Content cards and companies: queue v1's words.
  if (CONTENT_KINDS.includes(row.kind) || row.kind === 'company') {
    const d = describe(row as unknown as ReviewItem, t, canOpen);
    return { ...base, ...d, chips: d.chips, extraLinks: [] };
  }

  switch (row.kind) {
    case 'event_request': {
      const d = describe(row as unknown as ReviewItem, t, canOpen);
      const chips = [...d.chips];
      const ticket = fStr(f, 'ticket_key');
      if (ticket) chips.push({ label: t('adminReview.v2.fact.ticket', 'Type: {{ticket}}', { ticket: ticket.replace(/_/g, ' ') }), tone: 'navy' });
      return { ...base, ...d, chips: [...chips, ...sig.chips] };
    }
    case 'person': {
      const chips: FactChip[] = [];
      const persona = personaLabel(fStr(f, 'persona'), t);
      if (persona && fStr(f, 'persona') !== 'individual') chips.push({ label: persona, tone: 'navy' });
      const country = fStr(f, 'person_country');
      if (country) chips.push({ label: country });
      if (fStr(f, 'company_role') === 'owner') chips.push({ label: t('adminReview.fact.owner', 'Company owner') });
      if (fStr(f, 'company_name') && fStr(f, 'company_status') === 'pending' && !fStr(f, 'company_type')) {
        chips.push({ label: t('adminReview.fact.noCompanyType', 'Company type not chosen'), tone: 'warning' });
      }
      if (fBool(f, 'draft')) chips.push({ label: t('adminReview.v2.fact.draft', 'Old sign-up form not finished'), tone: 'warning' });
      if (fBool(fObj(f, 'intent'), 'has_code')) chips.push({ label: t('adminReview.v2.fact.typedCode', 'Typed a company code'), tone: 'info' });
      const members = fNum(f, 'company_members');
      if (members !== undefined && members > 1) {
        chips.push({ label: t('adminReview.fact.members', { count: members, defaultValue_one: '{{count}} person in the company', defaultValue_other: '{{count}} people in the company' }) });
      }
      return { ...base, what: personWhat(f, t), chips: [...chips, ...sig.chips], contact: fStr(f, 'email') };
    }
    case 'claim': {
      const org = fStr(f, 'org_name') ?? t('adminReview.v2.aCompany', 'a company');
      const paren = [orgTypeLabel(fStr(f, 'org_type'), t), fStr(f, 'org_country')].filter(Boolean).join(', ');
      const chips: FactChip[] = [];
      if (fBool(f, 'code_matched')) chips.push({ label: t('adminReview.v2.fact.codeMatched', 'Typed this company\'s code'), tone: 'success', icon: KeyRound });
      if (fStr(f, 'org_status') !== 'verified') chips.push({ label: t('adminReview.v2.fact.orgPending', 'Company waiting for approval'), tone: 'warning' });
      if (fBool(f, 'org_has_owner')) chips.push({ label: t('adminReview.v2.fact.orgHasOwner', 'The company has an owner now'), tone: 'danger' });
      const others = fNum(f, 'other_claims');
      if (others) chips.push({ label: t('adminReview.v2.fact.otherClaims', { count: others, defaultValue_one: '{{count}} other claim for this company', defaultValue_other: '{{count}} other claims for this company' }), tone: 'warning' });
      const ps = personStatusWord(fStr(f, 'person_status'), t);
      if (ps) chips.push(ps);
      if (fBool(f, 'expired')) chips.push({ label: t('adminReview.v2.fact.expired', 'Asked more than 30 days ago') });
      return {
        ...base,
        what: paren
          ? t('adminReview.v2.what.claimP', 'Asks to manage {{org}} ({{paren}}), a company with no owner on the platform', { org, paren })
          : t('adminReview.v2.what.claim', 'Asks to manage {{org}}, a company with no owner on the platform', { org }),
        chips: [...chips, ...sig.chips],
        contact: fStr(f, 'email'),
      };
    }
    case 'join_request': {
      const org = fStr(f, 'org_name') ?? t('adminReview.v2.aCompany', 'a company');
      const owner = fStr(f, 'owner_name');
      const chips: FactChip[] = [];
      const ps = personStatusWord(fStr(f, 'person_status'), t);
      if (ps) chips.push(ps);
      if (fBool(f, 'expired')) chips.push({ label: t('adminReview.v2.fact.expired', 'Asked more than 30 days ago') });
      return {
        ...base,
        what: owner
          ? t('adminReview.v2.what.joinOwner', 'Asked to join {{org}}. Its owner, {{owner}}, decides: nothing to do unless something looks wrong.', { org, owner })
          : t('adminReview.v2.what.join', 'Asked to join {{org}}. Its owner decides: nothing to do unless something looks wrong.', { org }),
        chips: [...chips, ...sig.chips],
        contact: fStr(f, 'email'),
      };
    }
    case 'team_join': {
      const org = fStr(f, 'org_name') ?? t('adminReview.v2.aCompany', 'a company');
      const by = fStr(f, 'invited_by');
      const via = fStr(f, 'via');
      const chips: FactChip[] = [];
      const ps = personStatusWord(fStr(f, 'person_status'), t);
      if (ps) chips.push(ps);
      if (fStr(f, 'org_status') !== 'verified') chips.push({ label: t('adminReview.v2.fact.orgPending', 'Company waiting for approval'), tone: 'warning' });
      return {
        ...base,
        what: via === 'invitation'
          ? (by
            ? t('adminReview.v2.what.teamInvitedBy', 'Joined {{org}}, invited by {{by}}', { org, by })
            : t('adminReview.v2.what.teamInvited', 'Joined {{org}} by invitation', { org }))
          : t('adminReview.v2.what.teamRequest', 'Joined {{org}}: the owner accepted their request', { org }),
        chips: [...chips, ...sig.chips],
        contact: fStr(f, 'email'),
      };
    }
    case 'duplicate_org': {
      const dup = fObj(row.signals, 'duplicate');
      const score = fNum(dup, 'score');
      const chips: FactChip[] = [];
      if (score !== undefined) chips.push({ label: t('adminReview.v2.fact.similarity', '{{score}}% alike', { score: Math.round(score * 100) }), tone: 'warning' });
      for (const side of ['a', 'b'] as const) {
        const name = fStr(f, `${side}_name`) ?? '?';
        const members = fNum(f, `${side}_members`) ?? 0;
        const st = fStr(f, `${side}_status`);
        chips.push({
          label: t('adminReview.v2.fact.dupSide', {
            defaultValue_one: '{{name}}: {{status}}, {{count}} person', defaultValue_other: '{{name}}: {{status}}, {{count}} people',
            name, count: members,
            status: st === 'verified' ? t('adminReview.v2.company.verified', 'Validated') : t('adminReview.v2.company.pending', 'Waiting for approval'),
          }),
        });
        if (fBool(f, `${side}_sm26`)) chips.push({ label: t('adminReview.v2.fact.dupSm26', '{{name}} was at Smart Marina 2026 (it stays)', { name }), tone: 'info' });
      }
      return {
        ...base,
        what: t('adminReview.v2.what.duplicateOrg', '{{a}} and {{b}} may be the same company', { a: fStr(f, 'a_name') ?? '?', b: fStr(f, 'b_name') ?? '?' }),
        chips,
      };
    }
    case 'duplicate_person': {
      return {
        ...base,
        what: t('adminReview.v2.what.duplicatePerson', 'Two accounts with the same name: {{a}} and {{b}}', {
          a: fStr(f, 'a_email') ?? '?', b: fStr(f, 'b_email') ?? '?',
        }),
        chips: (['a', 'b'] as const).map(side => {
          const st = personStatusWord(fStr(f, `${side}_status`), t);
          return { label: `${fStr(f, `${side}_email`) ?? '?'}: ${st?.label ?? '—'}`, tone: st?.tone };
        }),
      };
    }
    case 'retro': {
      const reasons = Array.isArray(f.reasons) ? (f.reasons as unknown[]).filter((x): x is string => typeof x === 'string') : [];
      const chips: FactChip[] = [];
      const company = fStr(f, 'company_name');
      if (company) chips.push({ label: company, tone: 'navy', icon: Building2 });
      const persona = personaLabel(fStr(f, 'persona'), t);
      if (persona) chips.push({ label: persona });
      return {
        ...base,
        what: reasons.length
          ? t('adminReview.v2.what.retro', 'Validated before M3 reviewed every account: {{reasons}}', { reasons: reasons.map(r => retroReason(r, t)).join('; ') })
          : t('adminReview.v2.what.retroAny', 'Validated before M3 reviewed every account'),
        chips: [...chips, ...sig.chips],
        contact: fStr(f, 'email'),
      };
    }
    default:
      return { ...base, what: '', chips: sig.chips };
  }
}

/** "Signed up 3 Oct 2026", "Joined …": the date under the card. */
function sinceText(row: QueueRow, t: TFunction): string {
  const date = formatDate(row.waiting_since);
  if (!date) return '';
  switch (row.kind) {
    case 'claim':
    case 'join_request': return t('adminReview.since.requested', 'Requested {{date}}', { date });
    case 'team_join': return t('adminReview.v2.since.joined', 'Joined {{date}}', { date });
    case 'retro': return t('adminReview.since.person', 'Signed up {{date}}', { date });
    case 'duplicate_org':
    case 'duplicate_person': return '';
    default: return sinceLabel(row as unknown as ReviewItem, t);
  }
}

/** Kinds whose sentence already says what the server's subtitle says ("Claims X", "Joined X"). A report's subtitle is the start of its reason, shown in full in the quote. */
const NO_SUBTITLE = new Set<QueueRow['kind']>(['report', 'claim', 'join_request', 'team_join', 'duplicate_org', 'duplicate_person']);

export function hasPart(row: QueueRow): boolean {
  return row.facts.wants_conference === true || row.facts.wants_gala === true;
}

export function partsText(row: QueueRow): string {
  return partsLabel({ conference: row.facts.wants_conference === true, gala: row.facts.wants_gala === true });
}

/* ------------------------------------------------------------------ the card */

export const QueueCard = forwardRef<HTMLLIElement, {
  row: QueueRow;
  model: CardModel;
  actions: CardAction[];
  links: CardLink[];
  focused: boolean;
  overdue: boolean;
  slaDays: number;
  selectable?: boolean;
  selected?: boolean;
  onSelect?: (on: boolean) => void;
  onFocusCard: () => void;
  busy?: boolean;
  footer?: ReactNode;
}>(function QueueCard({ row, model, actions, links, focused, overdue, slaDays, selectable, selected, onSelect, onFocusCard, busy, footer }, ref) {
  const { t } = useTranslation();
  const Icon = model.icon;
  const unreadable = row.kind === 'report' && row.facts.unreadable === true;
  const waitText = unreadable ? '' : waiting(row.waiting_since, t);
  const since = unreadable ? '' : sinceText(row, t);
  const contactLine = [model.contact, since].filter(Boolean).join(' · ');
  const hints = actions.filter(a => a.disabled && a.hint).map(a => a.hint as string);

  return (
    <li
      ref={ref}
      tabIndex={-1}
      onFocus={onFocusCard}
      onClick={onFocusCard}
      data-focused={focused || undefined}
      className={cn(
        'scroll-mt-32 rounded-card border bg-white p-4 outline-none transition-[border-color,box-shadow] sm:p-5',
        focused ? 'border-navy shadow-[0_0_0_1px_rgba(11,37,69,0.25)]' : 'border-rule',
        selected && 'bg-foam/40',
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        {selectable && (
          <label className="-my-2 -ml-2 inline-flex h-11 w-11 cursor-pointer items-center justify-center" onClick={e => e.stopPropagation()}>
            <Checkbox
              checked={!!selected}
              onCheckedChange={v => onSelect?.(v === true)}
              aria-label={t('adminReview.v2.select', 'Select {{name}}', { name: row.title })}
            />
          </label>
        )}
        <AdminStatusPill tone="info" icon={Icon}>{model.kindLabel}</AdminStatusPill>
        {row.kind === 'report' && <AdminStatusPill tone="danger" icon={AlertTriangle}>{t('adminReview.urgent', 'Urgent')}</AdminStatusPill>}
        {overdue && (
          <AdminStatusPill tone="warning" icon={Clock} title={t('adminReview.overdueHint', 'M3 promises an answer within {{count}} working days.', { count: slaDays })}>
            {t('adminReview.overdue', { count: slaDays, defaultValue_one: 'Over {{count}} working day', defaultValue_other: 'Over {{count}} working days' })}
          </AdminStatusPill>
        )}
        {waitText && (
          <span className={cn('ml-auto inline-flex items-center gap-1 text-[13px] font-medium leading-5', overdue ? 'text-amber-800' : 'text-meta')} title={formatDateTime(row.waiting_since)}>
            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
            {waitText}
          </span>
        )}
      </div>

      <h3 className="mt-3 text-[16px] font-semibold leading-6 text-navy [overflow-wrap:anywhere]">{row.title}</h3>
      {row.subtitle && !NO_SUBTITLE.has(row.kind) && <p className="text-[14px] leading-5 text-meta [overflow-wrap:anywhere]">{row.subtitle}</p>}
      {model.what && <p className="mt-1.5 text-[14px] leading-5 text-navy [overflow-wrap:anywhere]">{model.what}</p>}

      {model.quote && (
        <blockquote className="mt-2.5 border-l-2 border-teal pl-3 text-[13px] leading-5 text-meta">
          {model.quoteLabel && <span className="block text-[12px] font-semibold text-navy">{model.quoteLabel}</span>}
          <span className="line-clamp-3 [overflow-wrap:anywhere]">{model.quote}</span>
        </blockquote>
      )}

      {model.more && (
        <details className="mt-2">
          <summary className="inline-flex min-h-11 cursor-pointer items-center text-[14px] font-semibold text-navy underline decoration-navy/30 underline-offset-[3px] hover:decoration-gold">
            {model.moreLabel}
          </summary>
          <pre className="mt-1 max-h-80 overflow-auto whitespace-pre-wrap rounded-xl bg-page p-3 font-sans text-[13px] leading-5 text-navy [overflow-wrap:anywhere]">{model.more}</pre>
        </details>
      )}

      {model.chips.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label={t('adminReview.factsLabel', 'Key facts')}>
          {model.chips.map((c, i) => (
            <li key={i} className="max-w-full">
              <AdminStatusPill tone={c.tone ?? 'neutral'} icon={c.icon} title={c.title} className="max-w-full whitespace-normal">{c.label}</AdminStatusPill>
            </li>
          ))}
        </ul>
      )}

      {!!model.extraLinks?.length && (
        <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px] leading-5">
          {model.extraLinks.map(l => (
            <Link key={l.to} to={l.to} target={l.newTab ? '_blank' : undefined} className="inline-flex min-h-8 items-center gap-1 text-navy underline decoration-navy/30 underline-offset-2 hover:decoration-gold">
              <Link2 className="h-3.5 w-3.5" aria-hidden="true" />{l.label}
            </Link>
          ))}
        </p>
      )}

      {contactLine && <p className="mt-3 text-[13px] leading-5 text-meta [overflow-wrap:anywhere]">{contactLine}</p>}

      {footer}

      {(actions.length > 0 || links.length > 0) && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {actions.map(a => (
            <Button
              key={a.key}
              type="button"
              size="sm"
              variant={a.tone === 'primary' ? 'default' : 'outline'}
              className={cn(a.tone === 'primary' ? ADMIN_BTN_PRIMARY : a.tone === 'danger' ? ADMIN_BTN_DANGER : ADMIN_BTN, 'h-11')}
              onClick={e => { e.stopPropagation(); a.run(); }}
              disabled={busy || a.disabled}
              aria-label={a.ariaLabel}
            >
              {a.icon && <a.icon className="mr-1.5 h-4 w-4" aria-hidden="true" />}
              {a.label}
            </Button>
          ))}
          {links.map(l => (
            <Button key={l.to + l.label} asChild variant="outline" size="sm" className={cn(ADMIN_BTN, 'h-11')}>
              <Link to={l.to} target={l.newTab ? '_blank' : undefined} onClick={e => e.stopPropagation()}>
                {l.label}
                <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
          ))}
          {hints.map(h => <span key={h} className="text-[13px] leading-5 text-meta">{h}</span>)}
        </div>
      )}
    </li>
  );
});
