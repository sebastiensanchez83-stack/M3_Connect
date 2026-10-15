import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  AlertTriangle, Check, ExternalLink, HelpCircle, Loader2, Mail, UserCheck, UserRound, X, type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { externalUrl } from '@/lib/externalUrl';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { ADMIN_BTN, ADMIN_BTN_DANGER, ADMIN_BTN_PRIMARY, AdminStatusPill, type AdminTone } from './AdminUI';
import { CompanyChoice, companyPickToOrg, createPickOf, orgTypeLabel, type CompanyPick, type CurrentCompany } from './review/CompanyChoice';
import {
  ORG_TYPES, ReviewError, decideClaim, decisionMailText, fBool, fObj, fStr, loadOpenRequests, personCandidates,
  reviewErrorText, useOutboxSender, validatePerson,
  type Facts, type OpenRequest, type OrgAction, type OrgType, type PersonAction, type PersonCandidate, type PersonDecisionResult,
} from './review/reviewApi';

/**
 * M3's decision on a person (spec §8.1, §4.6 admin_validate_person), from the review queue,
 * the Users list or a user's page, while registration_flags.review_queue is on:
 *  - Validate, with their company: one they already have (a company still waiting is
 *    validated with them, with its type), one already on the platform (candidates from
 *    org_match_candidates; owner only if it has none), or a new one M3 creates now
 *    (validated, type locked, the person as owner);
 *  - Validate as participant only (no company: events, resources, the directory);
 *  - Not accepted (a reason the person reads; templates);
 *  - Ask for a detail (a question the person reads; they stay under review).
 * The person's signals and possible duplicates (person_match_candidates) are shown first.
 * An open claim or join request of theirs (organization_invitations) is said first, and
 * never decided here: a claim on its card (admin_decide_claim, or "Approve the claim" in the
 * banner), a join request by the company's owner. Validating then defaults to "participant
 * only", nothing picked, and "owner" is never offered for the claimed company.
 * The server writes review_log and queues the e-mail (notification_outbox, sent while
 * registration_flags.outbox_sender is on); nothing is e-mailed from here.
 */

interface PersonData {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  job_title: string | null;
  country: string | null;
  linkedin_url: string | null;
  persona: string | null;
  access_status: string | null;
  onboarding_status: string | null;
  signup_intent: Facts | null;
  affiliation: string | null;
  email_proven_at: string | null;
  created_at: string | null;
  rejection_reason: string | null;
}

const PERSON_COLUMNS =
  'user_id, first_name, last_name, email, job_title, country, linkedin_url, persona, access_status, onboarding_status, '
  + 'signup_intent, affiliation, email_proven_at, created_at, rejection_reason';

type Template = { key: string; text: string };

function rejectTemplates(t: TFunction): Template[] {
  return [
    { key: 'industry', text: t('adminValidate.tpl.reject.industry', 'We could not confirm that you work in the marina or yachting industry.') },
    { key: 'company', text: t('adminValidate.tpl.reject.company', 'We could not confirm your link with the company you named.') },
    { key: 'work_email', text: t('adminValidate.tpl.reject.workEmail', 'Please sign up again with your work e-mail address, so that we can confirm your company.') },
    { key: 'duplicate', text: t('adminValidate.tpl.reject.duplicate', 'You already have an account on Smart Marina Connect. Please sign in with that account.') },
  ];
}

function askTemplates(t: TFunction): Template[] {
  return [
    { key: 'company', text: t('adminValidate.tpl.ask.company', 'Which company or marina do you work for? Its website is enough.') },
    { key: 'role', text: t('adminValidate.tpl.ask.role', 'What is your role in your company?') },
    { key: 'linkedin', text: t('adminValidate.tpl.ask.linkedin', 'Could you send us a link to your LinkedIn profile?') },
    { key: 'work_email', text: t('adminValidate.tpl.ask.workEmail', 'Could you tell us your work e-mail address, so that we can confirm your company?') },
  ];
}

const fullName = (p: { first_name?: string | null; last_name?: string | null; email?: string | null }) =>
  `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || p.email || '—';

function sourceLabel(source: string, t: TFunction): string {
  switch (source) {
    case 'account': return t('adminValidate.dup.account', 'Account');
    case 'registration': return t('adminValidate.dup.registration', 'Event registration');
    case 'legacy_registration': return t('adminValidate.dup.legacy', 'Old event registration');
    case 'sm26': case 'sm26_attendee': return t('adminValidate.dup.sm26', 'Smart Marina 2026');
    default: return source;
  }
}

export interface ValidatePersonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string | null;
  initialAction?: PersonAction;
  /** The queue card's signals (e-mail confirmed, SM26, duplicate…), shown as they are. */
  signals?: Facts;
  /** The person's LOGIN address (the queue card's facts.email), where claims are filed. */
  loginEmail?: string | null;
  onDone?: (result: PersonDecisionResult, action: PersonAction) => void;
}

export function ValidatePersonDialog({ open, onOpenChange, userId, initialAction, signals, loginEmail, onDone }: ValidatePersonDialogProps) {
  const { t } = useTranslation();
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [person, setPerson] = useState<PersonData | null>(null);
  const [current, setCurrent] = useState<CurrentCompany[]>([]);
  const [dups, setDups] = useState<PersonCandidate[]>([]);
  const [action, setAction] = useState<PersonAction>(initialAction ?? 'validate');
  const [pick, setPick] = useState<CompanyPick>({ mode: 'none' });
  const [text, setText] = useState('');
  const [notify, setNotify] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existingOrgId, setExistingOrgId] = useState<string | null>(null);
  const [requests, setRequests] = useState<OpenRequest[]>([]);
  const [claimBusy, setClaimBusy] = useState(false);
  const senderOn = useOutboxSender();

  // Load the person each time the window opens.
  useEffect(() => {
    if (!open || !userId) return;
    let alive = true;
    setState('loading');
    setError(null);
    setExistingOrgId(null);
    setText('');
    setNotify(true);
    setDups([]);
    setRequests([]);
    (async () => {
      const [{ data: p, error: pErr }, { data: mems }] = await Promise.all([
        supabase.from('profiles').select(PERSON_COLUMNS).eq('user_id', userId).maybeSingle(),
        supabase
          .from('organization_members')
          .select('role, joined_at, organizations(id, name, organization_type, access_status)')
          .eq('user_id', userId),
      ]);
      if (!alive) return;
      if (pErr || !p) { setState('error'); return; }
      const prof = p as unknown as PersonData;
      const companies: CurrentCompany[] = ((mems ?? []) as unknown as { role: string | null; organizations: Record<string, unknown> | null }[])
        .map(m => m.organizations ? {
          id: String(m.organizations.id),
          name: String(m.organizations.name ?? '—'),
          status: (m.organizations.access_status as string | null) ?? null,
          type: (m.organizations.organization_type as string | null) ?? null,
          role: m.role,
        } : null)
        .filter((c): c is CurrentCompany => !!c && (c.status === 'verified' || c.status === 'pending'))
        .sort((a, b) => Number(b.role === 'owner') - Number(a.role === 'owner'));
      // An open claim or join request (filed on the login address) changes the defaults.
      const intent = prof.signup_intent && typeof prof.signup_intent === 'object' ? prof.signup_intent : null;
      const open = (await loadOpenRequests([loginEmail, prof.email])) ?? [];
      if (!alive) return;
      const path = fStr(fObj(intent ?? undefined, 'result'), 'path');
      if (!open.length && (path === 'claim_requested' || path === 'join_requested')) {
        // The rows could not be read (or the address differs): the intent still says so.
        const orgId = fStr(intent ?? undefined, 'org_id') ?? fStr(fObj(intent ?? undefined, 'result'), 'organization_id');
        if (orgId) open.push({ id: '', kind: path === 'claim_requested' ? 'claim' : 'join', organization_id: orgId, org_name: fStr(intent ?? undefined, 'name') ?? null, created_at: null });
      }
      setRequests(open);
      setPerson(prof);
      setCurrent(companies);

      // The best first choice: their own company, the one they declared, or none.
      const declaredType = fStr(intent ?? undefined, 'type');
      // The type they declared at sign-up; for a company of the old wizard, their account type.
      const intentType = (ORG_TYPES as string[]).includes(declaredType ?? '')
        ? (declaredType as OrgType)
        : (ORG_TYPES as string[]).includes(prof.persona ?? '') ? (prof.persona as OrgType) : '';
      if (companies.length) {
        const c = companies[0];
        setPick({ mode: 'current', orgId: c.id, type: (ORG_TYPES as string[]).includes(c.type ?? '') ? (c.type as OrgType) : intentType });
      } else if (open.length) {
        // A claim or a join request waits: nothing is picked for M3 (the claim is decided on
        // its card, the join request by the owner); linking needs an explicit click.
        setPick({ mode: 'link', orgId: null, asOwner: false });
      } else if (fStr(intent ?? undefined, 'action') === 'new' && fStr(intent ?? undefined, 'name')) {
        setPick(createPickOf({
          name: fStr(intent ?? undefined, 'name'),
          type: intentType,
          website: fStr(intent ?? undefined, 'website'),
          country: fStr(intent ?? undefined, 'country') ?? prof.country,
        }));
      } else if (fStr(intent ?? undefined, 'action') === 'join' && fStr(intent ?? undefined, 'org_id')) {
        setPick({ mode: 'link', orgId: fStr(intent ?? undefined, 'org_id') ?? null, asOwner: false });
      } else {
        setPick({ mode: 'link', orgId: null, asOwner: false });
      }
      const nothingDeclared = !companies.length && !fStr(intent ?? undefined, 'name') && fStr(intent ?? undefined, 'action') !== 'join';
      const waitingRequest = !companies.length && open.length > 0;
      setAction(initialAction && !(waitingRequest && initialAction === 'validate')
        ? initialAction
        : nothingDeclared || waitingRequest ? 'participant' : 'validate');
      setState('ready');

      // Possible duplicates (other accounts, registrations, SM26), never this account itself.
      try {
        const rows = await personCandidates({
          email: prof.email,
          first: prof.first_name,
          last: prof.last_name,
          company: companies[0]?.name ?? fStr(intent ?? undefined, 'name') ?? prof.affiliation,
        });
        if (alive) setDups(rows.filter(r => !(r.source === 'account' && r.user_id === prof.user_id)).slice(0, 6));
      } catch { /* the lookup is a help, not a requirement */ }
    })();
    return () => { alive = false; };
  }, [open, userId, initialAction, loginEmail]);

  const intent = person?.signup_intent && typeof person.signup_intent === 'object' ? person.signup_intent : null;
  const firstName = person?.first_name?.trim() || fullName(person ?? {});
  const templates = action === 'reject' ? rejectTemplates(t) : action === 'ask' ? askTemplates(t) : [];

  const lookup = useMemo(() => ({
    name: fStr(intent ?? undefined, 'name') ?? person?.affiliation ?? null,
    website: fStr(intent ?? undefined, 'website') ?? null,
    email: person?.email ?? null,
    country: fStr(intent ?? undefined, 'country') ?? person?.country ?? null,
  }), [intent, person?.affiliation, person?.email, person?.country]);

  const pickedCurrent = pick.mode === 'current' ? current.find(c => c.id === pick.orgId) : undefined;

  const confirmLabel = (() => {
    switch (action) {
      case 'participant': return t('adminValidate.confirm.participant', 'Validate as participant');
      case 'reject': return notify ? t('adminValidate.confirm.rejectMail', 'Not accepted, e-mail them') : t('adminValidate.confirm.reject', 'Mark as not accepted');
      case 'ask': return t('adminValidate.confirm.ask', 'Send the question');
      default:
        if (pick.mode === 'create') return t('adminValidate.confirm.create', 'Validate and create {{name}}', { name: pick.name.trim() || t('adminValidate.theCompany', 'the company') });
        if (pick.mode === 'link') return t('adminValidate.confirm.link', 'Validate and link');
        if (pickedCurrent?.status === 'pending') return t('adminValidate.confirm.withCompany', 'Validate {{name}} and {{company}}', { name: firstName, company: pickedCurrent.name });
        return t('adminValidate.confirm.validate', 'Validate {{name}}', { name: firstName });
    }
  })();

  const submit = async (forceNew = false) => {
    if (!person || saving) return;
    setError(null);
    let org: OrgAction | undefined;
    if (action === 'validate') {
      const p = forceNew && pick.mode === 'create' ? { ...pick, forceNew: true } : pick;
      const r = companyPickToOrg(p, current);
      if (!r.ok) { setError(reviewErrorText(r.code, t)); return; }
      org = r.org;
    }
    if ((action === 'reject' || action === 'ask') && !text.trim()) {
      setError(reviewErrorText('reason_required', t));
      return;
    }
    setSaving(true);
    try {
      const res = await validatePerson(person.user_id, {
        action,
        reason: action === 'reject' || action === 'ask' ? text.trim() : undefined,
        notify: action === 'ask' ? true : notify,
        org,
      });
      setSaving(false);
      const name = fullName(person);
      const notes = [
        res.unchanged ? t('adminValidate.done.unchanged', 'Nothing had to change.') : '',
        res.company_created ? t('adminValidate.done.created', '{{company}} was created and validated.', { company: res.organization_name ?? '' }) : '',
        res.company_verified && !res.company_created ? t('adminValidate.done.verified', '{{company}} is validated too.', { company: res.organization_name ?? '' }) : '',
        res.owner_ignored ? t('adminValidate.done.ownerIgnored', 'The company already had an owner: they joined as a team member.') : '',
        res.type_ignored ? t('adminValidate.done.typeIgnored', 'The company type was kept: a validated company keeps its type. Change it on the company page if needed.') : '',
        (action === 'ask' || notify) && !res.unchanged ? decisionMailText(t, senderOn) : '',
      ].filter(Boolean).join(' ');
      toast({
        title: action === 'reject'
          ? t('adminValidate.done.rejectTitle', '{{name}}: not accepted', { name })
          : action === 'ask'
            ? (senderOn === true
              ? t('adminValidate.done.askTitle', 'Question sent to {{name}}', { name })
              : t('adminValidate.done.askQueuedTitle', 'Question for {{name}} saved', { name }))
            : action === 'participant'
              ? t('adminValidate.done.participantTitle', '{{name}} is validated as a participant', { name })
              : t('adminValidate.done.validateTitle', '{{name}} is validated', { name }),
        description: notes || undefined,
      });
      onDone?.(res, action);
      onOpenChange(false);
    } catch (e) {
      setSaving(false);
      if (e instanceof ReviewError && e.code === 'org_exists') setExistingOrgId(e.detail ?? null);
      setError(reviewErrorText(e, t));
    }
  };

  /** The claim's own decision (admin_decide_claim): owner of the company, and validated. */
  const approveClaimHere = async (r: OpenRequest) => {
    if (!person || !r.id || claimBusy) return;
    setClaimBusy(true);
    setError(null);
    try {
      await decideClaim(r.id, true);
      setClaimBusy(false);
      toast({
        title: t('adminReview.v2.done.claimApproved', '{{name}} now manages {{org}}', { name: fullName(person), org: r.org_name ?? '' }),
        description: decisionMailText(t, senderOn),
      });
      onDone?.({ ok: true, action: 'validate', organization_id: r.organization_id, organization_name: r.org_name ?? undefined, role: 'owner' }, 'validate');
      onOpenChange(false);
    } catch (e) {
      setClaimBusy(false);
      setError(reviewErrorText(e, t));
    }
  };

  const signalChips = person ? personSignals(person, signals, t) : [];

  return (
    <Dialog open={open} onOpenChange={o => { if (!saving) onOpenChange(o); }}>
      <DialogContent
        className={cn(
          'flex max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-2xl flex-col gap-0 overflow-hidden rounded-card p-0 sm:max-h-[calc(100dvh-4rem)]',
          '[&>button:last-child]:right-2 [&>button:last-child]:top-2 [&>button:last-child]:grid [&>button:last-child]:h-11 [&>button:last-child]:w-11 [&>button:last-child]:place-items-center [&>button:last-child]:rounded-full [&>button:last-child]:hover:bg-chip',
        )}
      >
        <DialogHeader className="border-b border-rule px-4 pb-3 pt-4 pr-14 text-left sm:px-6">
          <DialogTitle className="text-[19px] leading-7 text-navy [overflow-wrap:anywhere]">
            {person ? t('adminValidate.title', 'Decide on {{name}}', { name: fullName(person) }) : t('adminValidate.titleLoading', 'Decide on this person')}
          </DialogTitle>
          <DialogDescription className="text-[14px] leading-5 text-meta">
            {t('adminValidate.description', 'M3 validates every person. Choose what happens to them; the e-mail is written for you.')}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4 sm:px-6">
          {state === 'loading' && (
            <p className="flex items-center gap-2 py-10 text-[14px] text-meta" role="status">
              <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              {t('adminValidate.loading', 'Loading the person…')}
            </p>
          )}
          {state === 'error' && (
            <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-[14px] text-red-900">
              {t('adminValidate.loadError', 'This person could not be loaded. Close this window and refresh the list.')}
            </p>
          )}

          {state === 'ready' && person && (
            <>
              {/* Who */}
              <section className="rounded-xl bg-page p-3.5" aria-label={t('adminValidate.who', 'Who they are')}>
                <p className="text-[15px] font-semibold leading-6 text-navy [overflow-wrap:anywhere]">
                  {[fullName(person), person.job_title].filter(Boolean).join(', ')}
                </p>
                <p className="text-[14px] leading-5 text-navy [overflow-wrap:anywhere]">{declaredLine(person, intent, current, t)}</p>
                <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] leading-5 text-meta [overflow-wrap:anywhere]">
                  {person.email && <span className="inline-flex items-center gap-1"><Mail className="h-3.5 w-3.5" aria-hidden="true" />{person.email}</span>}
                  {person.country && <span>{person.country}</span>}
                  {person.linkedin_url && externalUrl(person.linkedin_url) && (
                    <a href={externalUrl(person.linkedin_url) ?? undefined} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-navy underline decoration-navy/30 underline-offset-2 hover:decoration-gold">
                      LinkedIn <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </a>
                  )}
                  <Link to={`/admin/users/${person.user_id}`} target="_blank" className="inline-flex items-center gap-1 text-navy underline decoration-navy/30 underline-offset-2 hover:decoration-gold">
                    {t('adminValidate.openProfile', 'Full profile')} <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  </Link>
                </p>
                {signalChips.length > 0 && (
                  <ul className="mt-2.5 flex flex-wrap gap-1.5" aria-label={t('adminReview.factsLabel', 'Key facts')}>
                    {signalChips.map((c, i) => (
                      <li key={i}><AdminStatusPill tone={c.tone} icon={c.icon} title={c.title}>{c.label}</AdminStatusPill></li>
                    ))}
                  </ul>
                )}
                {person.access_status === 'rejected' && person.rejection_reason && (
                  <p className="mt-2 text-[13px] text-meta">{t('adminValidate.previousReason', 'Not accepted before: “{{reason}}”', { reason: person.rejection_reason })}</p>
                )}
              </section>

              {dups.length > 0 && (
                <section aria-label={t('adminValidate.dup.title', 'Maybe the same person')}>
                  <h3 className="flex items-center gap-1.5 text-[14px] font-semibold text-navy">
                    <AlertTriangle className="h-4 w-4 text-amber-700" aria-hidden="true" />
                    {t('adminValidate.dup.title', 'Maybe the same person')}
                  </h3>
                  <ul className="mt-1.5 space-y-1.5">
                    {dups.map((d, i) => (
                      <li key={`${d.source}:${d.id ?? i}`} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-rule bg-white px-3 py-2 text-[13px] leading-5 text-navy">
                        <AdminStatusPill tone="warning">{sourceLabel(d.source, t)}</AdminStatusPill>
                        <span className="font-semibold [overflow-wrap:anywhere]">{fullName(d)}</span>
                        {d.email && <span className="text-meta [overflow-wrap:anywhere]">{d.email}</span>}
                        {d.company && <span className="text-meta">· {d.company}</span>}
                        {d.match === 'email' && <AdminStatusPill tone="info">{t('adminValidate.dup.sameEmail', 'Same e-mail')}</AdminStatusPill>}
                        {d.source === 'account' && d.user_id && (
                          <Link to={`/admin/users/${d.user_id}`} target="_blank" className="ml-auto inline-flex min-h-8 items-center gap-1 underline decoration-navy/30 underline-offset-2 hover:decoration-gold">
                            {t('adminValidate.dup.open', 'Open')} <ExternalLink className="h-3 w-3" aria-hidden="true" />
                          </Link>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* A claim (M3 decides it on its card) or a join request (the owner decides it). */}
              {requests.map(r => (
                <section
                  key={`${r.kind}:${r.id || r.organization_id}`}
                  className="rounded-xl border border-amber-300 bg-amber-50 p-3.5 text-[14px] leading-5 text-amber-950"
                  aria-label={r.kind === 'claim' ? t('adminValidate.request.claimLabel', 'Company claim waiting') : t('adminValidate.request.joinLabel', 'Join request waiting')}
                >
                  <p className="flex items-start gap-1.5 font-semibold">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    {r.kind === 'claim'
                      ? t('adminValidate.request.claim', '{{name}} also asked to manage {{org}}.', { name: firstName, org: r.org_name ?? t('adminReview.v2.aCompany', 'a company') })
                      : t('adminValidate.request.join', '{{name}} asked to join {{org}}.', { name: firstName, org: r.org_name ?? t('adminReview.v2.aCompany', 'a company') })}
                  </p>
                  <p className="mt-1">
                    {r.kind === 'claim'
                      ? t('adminValidate.request.claimBody', 'Approving the claim makes them its owner and validates them. If they should not manage it, decline it on the claim card in To review, then decide on them here.')
                      : t('adminValidate.request.joinBody', 'Its owner decides whether they join. You can validate them as a participant now: they join the company when the owner says yes.')}
                  </p>
                  {r.kind === 'claim' && r.id && (
                    <div className="mt-2.5 flex flex-wrap gap-2">
                      <Button type="button" size="sm" className={cn(ADMIN_BTN_PRIMARY, 'h-auto min-h-11 whitespace-normal py-2 text-left')} disabled={claimBusy || saving} onClick={() => approveClaimHere(r)}>
                        {claimBusy ? <Loader2 className="mr-1.5 h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Check className="mr-1.5 h-4 w-4 shrink-0" aria-hidden="true" />}
                        {t('adminValidate.request.approveClaim', 'Approve the claim: they manage {{org}}', { org: r.org_name ?? t('adminValidate.theCompany', 'the company') })}
                      </Button>
                    </div>
                  )}
                </section>
              ))}

              {/* What M3 decides */}
              <fieldset>
                <legend className="text-[14px] font-semibold text-navy">{t('adminValidate.decision', 'Your decision')}</legend>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <ActionCard icon={UserCheck} active={action === 'validate'} onClick={() => { setAction('validate'); setError(null); }}
                    title={t('adminValidate.action.validate', 'Validate as a member')}
                    hint={t('adminValidate.action.validateHint', 'With their company. They get the features of its type.')} />
                  <ActionCard icon={UserRound} active={action === 'participant'} onClick={() => { setAction('participant'); setError(null); }}
                    title={t('adminValidate.action.participant', 'Validate as participant only')}
                    hint={t('adminValidate.action.participantHint', 'No company: events, resources and the directory.')} />
                  <ActionCard icon={HelpCircle} active={action === 'ask'} onClick={() => { setAction('ask'); setError(null); setText(''); }}
                    title={t('adminValidate.action.ask', 'Ask for a detail')}
                    hint={t('adminValidate.action.askHint', 'They stay under review until you decide.')}
                    disabled={person.access_status === 'verified'} />
                  <ActionCard icon={X} danger active={action === 'reject'} onClick={() => { setAction('reject'); setError(null); setText(''); }}
                    title={t('adminValidate.action.reject', 'Not accepted')}
                    hint={t('adminValidate.action.rejectHint', 'They can ask M3 to review again.')} />
                </div>
              </fieldset>

              {action === 'validate' && (
                <section>
                  <h3 className="mb-2 text-[14px] font-semibold text-navy">{t('adminValidate.companyQuestion', 'Which company?')}</h3>
                  <CompanyChoice
                    value={pick}
                    onChange={p => { setPick(p); setError(null); setExistingOrgId(null); }}
                    current={current}
                    allowNone={false}
                    lookup={lookup}
                    disabled={saving}
                    ownerBlocked={requests.filter(r => r.kind === 'claim').map(r => r.organization_id)}
                  />
                </section>
              )}

              {(action === 'reject' || action === 'ask') && (
                <section className="space-y-2">
                  <h3 className="text-[14px] font-semibold text-navy">
                    {action === 'reject'
                      ? t('adminValidate.reasonTitle', 'Why (they read this in the e-mail)')
                      : t('adminValidate.questionTitle', 'Your question (they read this in the e-mail)')}
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    {templates.map(tp => (
                      <button
                        key={tp.key}
                        type="button"
                        onClick={() => setText(tp.text)}
                        aria-pressed={text === tp.text}
                        className={cn(
                          'min-h-11 rounded-xl border px-3 py-2 text-left text-[13px] leading-5 transition-colors focus:outline-none focus-visible:shadow-focus',
                          text === tp.text ? 'border-navy bg-chip text-navy' : 'border-rule bg-white text-navy hover:border-navy/30',
                        )}
                      >
                        {tp.text}
                      </button>
                    ))}
                  </div>
                  <Textarea
                    value={text}
                    onChange={e => setText(e.target.value)}
                    rows={3}
                    maxLength={2000}
                    placeholder={action === 'reject'
                      ? t('adminValidate.reasonPlaceholder', 'Pick a sentence above or write your own.')
                      : t('adminValidate.questionPlaceholder', 'Pick a question above or write your own.')}
                    aria-label={action === 'reject' ? t('adminValidate.reasonTitle', 'Why (they read this in the e-mail)') : t('adminValidate.questionTitle', 'Your question (they read this in the e-mail)')}
                  />
                </section>
              )}

              {action !== 'ask' && (
                <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-rule bg-white px-3 py-2.5 text-[14px] leading-5 text-navy">
                  <Checkbox checked={notify} onCheckedChange={v => setNotify(v === true)} />
                  <span>{t('adminValidate.notify', 'E-mail them the decision')}</span>
                </label>
              )}
              {(action === 'ask' || notify) && senderOn !== true && (
                <p className="text-[13px] leading-5 text-amber-800">{decisionMailText(t, senderOn)}</p>
              )}

              {error && (
                <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-[14px] leading-5 text-red-900">
                  {error}
                  {existingOrgId && pick.mode === 'create' && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button type="button" size="sm" variant="outline" className={cn(ADMIN_BTN, 'h-11')} onClick={() => { setPick({ mode: 'link', orgId: existingOrgId, asOwner: false }); setError(null); setExistingOrgId(null); }}>
                        {t('adminValidate.orgExists.link', 'Link them to the existing company')}
                      </Button>
                      <Button type="button" size="sm" variant="outline" className={cn(ADMIN_BTN, 'h-11')} onClick={() => submit(true)} disabled={saving}>
                        {t('adminValidate.orgExists.create', 'Create a new one anyway')}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-rule bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-end sm:px-6">
          <Button type="button" variant="outline" size="sm" className={cn(ADMIN_BTN, 'h-11')} onClick={() => onOpenChange(false)} disabled={saving}>
            {t('adminReview.cancel', 'Cancel')}
          </Button>
          <Button
            type="button"
            size="sm"
            className={cn(action === 'reject' ? ADMIN_BTN_DANGER : ADMIN_BTN_PRIMARY, 'h-11')}
            variant={action === 'reject' ? 'outline' : 'default'}
            onClick={() => submit()}
            disabled={saving || state !== 'ready'}
          >
            {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Check className="mr-1.5 h-4 w-4" aria-hidden="true" />}
            <span className="[overflow-wrap:anywhere]">{confirmLabel}</span>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ActionCard({ icon: Icon, title, hint, active, onClick, danger = false, disabled = false }: {
  icon: LucideIcon; title: string; hint: string; active: boolean; onClick: () => void; danger?: boolean; disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      disabled={disabled}
      className={cn(
        'flex min-h-[64px] items-start gap-2.5 rounded-xl border bg-white px-3 py-2.5 text-left transition-colors focus:outline-none focus-visible:shadow-focus',
        active ? (danger ? 'border-red-400 ring-1 ring-red-200' : 'border-navy ring-1 ring-navy/20') : 'border-rule hover:border-navy/30',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', danger ? 'text-red-700' : 'text-teal')} aria-hidden="true" />
      <span className="min-w-0">
        <span className="block text-[14px] font-semibold leading-5 text-navy">{title}</span>
        <span className="block text-[13px] leading-[18px] text-meta">{hint}</span>
      </span>
    </button>
  );
}

/** "Wants to add a new company: NewCo (Service provider, France)" — what the person declared. */
function declaredLine(p: PersonData, intent: Facts | null, current: CurrentCompany[], t: TFunction): string {
  const iAction = fStr(intent ?? undefined, 'action');
  const iName = fStr(intent ?? undefined, 'name');
  const iType = orgTypeLabel(fStr(intent ?? undefined, 'type'), t);
  const iCountry = fStr(intent ?? undefined, 'country');
  const extra = [iType, iCountry].filter(Boolean).join(', ');
  if (current.length) {
    const c = current[0];
    return c.status === 'pending'
      ? t('adminValidate.declared.pending', 'Company: {{name}}, waiting for approval', { name: c.name })
      : t('adminValidate.declared.member', 'Member of {{name}}', { name: c.name });
  }
  if (iAction === 'new' && iName) {
    return extra
      ? t('adminValidate.declared.newWith', 'Declared a new company: {{name}} ({{extra}})', { name: iName, extra })
      : t('adminValidate.declared.new', 'Declared a new company: {{name}}', { name: iName });
  }
  if (iAction === 'join') {
    return iName
      ? t('adminValidate.declared.join', 'Picked an existing company: {{name}}', { name: iName })
      : t('adminValidate.declared.joinAny', 'Picked an existing company');
  }
  if (p.affiliation) return t('adminValidate.declared.affiliation', 'No company; organisation given: {{name}}', { name: p.affiliation });
  return t('adminValidate.declared.none', 'Signed up without a company');
}

interface Chip { label: string; tone: AdminTone; icon?: LucideIcon; title?: string }

function personSignals(p: PersonData, signals: Facts | undefined, t: TFunction): Chip[] {
  const chips: Chip[] = [];
  const proven = fBool(signals, 'email_proven') ?? !!p.email_proven_at;
  chips.push(proven
    ? { label: t('adminReview.fact.emailProven', 'E-mail address confirmed'), tone: 'success', icon: Check }
    : { label: t('adminReview.fact.emailNotProven', 'E-mail address not confirmed yet'), tone: 'neutral' });
  const dm = fBool(signals, 'domain_match');
  if (dm === true) chips.push({ label: proven ? t('adminReview.fact.domainMatch', 'E-mail matches the website') : t('adminReview.fact.domainMatchUnproven', 'Same domain as the website (address not verified)'), tone: proven ? 'success' : 'neutral' });
  if (dm === false) chips.push({ label: t('adminReview.fact.domainMismatch', 'E-mail does not match the website'), tone: 'warning', icon: AlertTriangle });
  if (fBool(signals, 'sm26')) chips.push({ label: t('adminReview.fact.sm26Confirmed', 'Confirmed for Smart Marina 2026'), tone: 'info' });
  if (p.linkedin_url || fBool(signals, 'linkedin')) chips.push({ label: t('adminReview.fact.linkedin', 'LinkedIn given'), tone: 'success' });
  const dup = fObj(signals, 'duplicate');
  if (dup) {
    const score = typeof dup.score === 'number' ? Math.round(dup.score * 100) : undefined;
    chips.push({
      label: score !== undefined
        ? t('adminReview.v2.signal.duplicateScore', 'Possible duplicate ({{score}}%)', { score })
        : t('adminReview.v2.signal.duplicate', 'Possible duplicate'),
      tone: 'warning',
      icon: AlertTriangle,
      title: fStr(dup, 'name'),
    });
  }
  if (p.access_status === 'verified') chips.push({ label: t('adminValidate.status.verified', 'Already validated'), tone: 'success' });
  if (p.access_status === 'rejected') chips.push({ label: t('adminValidate.status.rejected', 'Not accepted before'), tone: 'danger' });
  if (p.access_status === 'suspended') chips.push({ label: t('adminValidate.status.suspended', 'Suspended'), tone: 'danger' });
  return chips;
}
