import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { LucideIcon } from 'lucide-react';
import { Anchor, ChevronDown, ClipboardList, Clock, MessageSquare, Pencil, Radio, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BTN, BTN_OUTLINE, MemberEmpty, RowSkeleton } from '@/components/member/MemberUI';
import { useAuth } from '@/contexts/AuthContext';
import { useEntitlements } from '@/hooks/useEntitlements';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { canCreate } from '@/lib/nav';
import { REQUEST_KINDS, type RequestKind } from '@/lib/accountNav';
import { scrollTopUnderBars } from '@/lib/scrollTarget';
import { cn } from '@/lib/utils';
import { ItemRow, SubmissionStatusBadge, WebinarStatusBadge } from './accountUi';
import { formatBudgetRange, formatDay, humanize, uiLocale } from './format';

/**
 * Everything this member has put out on the network, in ONE block: projects,
 * RFPs, consultations and webinar proposals. It replaces five tabs of the old
 * account area (the four lists and "All submissions", which repeated them),
 * with every action they had: edit, close / reopen, delete, withdraw.
 *
 * Which kinds show follows the old menu: marinas and developers (or an
 * organisation granted the feature) have the first three, every member can
 * propose a webinar. `section=<kind>` in the address opens on that kind
 * (the old /account?tab=rfps links).
 */

interface MarinaProject {
  id: string;
  project_type: string;
  budget_range: string | null;
  timeline: string | null;
  status: string;
  created_at: string;
}

interface WebinarRequest {
  id: string;
  title: string;
  description: string;
  preferred_language: string;
  preferred_timeframe: string | null;
  status: string;
  moderator_notes: string | null;
  created_at: string;
}

interface RFPItem {
  id: string;
  title: string;
  scope: string;
  sector_id: string | null;
  deadline_date: string | null;
  is_open: boolean;
  status: string;
  rejection_reason: string | null;
  created_at: string;
}

interface ConsultationItem {
  id: string;
  title: string;
  description: string;
  sector_id: string | null;
  is_open: boolean;
  status: string;
  rejection_reason: string | null;
  created_at: string;
}

const DANGER = cn(BTN, 'text-red-600 hover:bg-red-50 hover:text-red-700');

export function MyRequests() {
  const { t, i18n } = useTranslation();
  const { user, profile, organization } = useAuth();
  const { isFeatureEnabled, isLoading: entLoading } = useEntitlements();
  const [searchParams] = useSearchParams();
  const locale = uiLocale(i18n.language);
  const fmtDate = (iso: string) => formatDay(iso, locale);

  const uid = user?.id;
  const persona = profile?.persona as string | undefined;
  const orgId = organization?.id;
  const marinaLike = persona === 'marina' || persona === 'developer';
  const canProjects = marinaLike || isFeatureEnabled('submit_project');
  const canRFPs = marinaLike || isFeatureEnabled('submit_rfp');
  const canConsultations = marinaLike || isFeatureEnabled('submit_consultation');

  // Feature grants load after the organisation: for anyone who is not a marina
  // they are "not known yet" for a moment, and the lists wait instead of
  // showing an empty kind. Remember which organisation they were settled for
  // (the hook's isLoading can read false for the render in which it arrives).
  const [entSettledOrg, setEntSettledOrg] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (!entLoading) setEntSettledOrg(orgId ?? null);
  }, [entLoading, orgId]);
  const entPending = !marinaLike && (entLoading || entSettledOrg !== (orgId ?? null));

  // The rights the lists were fetched with, as one primitive: a list fetched
  // before a grant arrived is fetched again.
  const fetchKey = `${canProjects ? 1 : 0}${canRFPs ? 1 : 0}${canConsultations ? 1 : 0}`;
  const [fetchedKey, setFetchedKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<MarinaProject[]>([]);
  const [rfps, setRfps] = useState<RFPItem[]>([]);
  const [consultations, setConsultations] = useState<ConsultationItem[]>([]);
  const [webinars, setWebinars] = useState<WebinarRequest[]>([]);
  const [open, setOpen] = useState<Record<RequestKind, boolean>>({ projects: true, rfps: true, consultations: true, webinars: true });

  useEffect(() => {
    if (!uid || entPending || fetchedKey === fetchKey) return;
    const runKey = fetchKey;
    const [hasProjects, hasRFPs, hasConsultations] = [runKey[0] === '1', runKey[1] === '1', runKey[2] === '1'];
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        const [projRes, rfpRes, consultRes, webinarRes] = await Promise.all([
          hasProjects
            ? supabase.from('marina_projects').select('id, project_type, budget_range, timeline, status, created_at').eq('user_id', uid).order('created_at', { ascending: false })
            : Promise.resolve({ data: null }),
          hasRFPs
            ? supabase.from('rfps').select('id, title, scope, sector_id, deadline_date, is_open, status, rejection_reason, created_at').eq('marina_user_id', uid).order('created_at', { ascending: false })
            : Promise.resolve({ data: null }),
          hasConsultations
            ? supabase.from('consultations').select('id, title, description, sector_id, is_open, status, rejection_reason, created_at').eq('marina_user_id', uid).order('created_at', { ascending: false })
            : Promise.resolve({ data: null }),
          supabase.from('webinar_requests').select('id, title, description, preferred_language, preferred_timeframe, status, moderator_notes, created_at').eq('user_id', uid).order('created_at', { ascending: false }),
        ]);
        if (!alive) return;
        setProjects(hasProjects ? ((projRes.data ?? []) as MarinaProject[]) : []);
        setRfps(hasRFPs ? ((rfpRes.data ?? []) as RFPItem[]) : []);
        setConsultations(hasConsultations ? ((consultRes.data ?? []) as ConsultationItem[]) : []);
        setWebinars((webinarRes.data ?? []) as WebinarRequest[]);
        setFetchedKey(runKey);
      } catch (err) {
        if (import.meta.env.DEV) console.error('My requests failed:', err);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [uid, entPending, fetchKey, fetchedKey]);

  // section=<kind>: that group is open and on screen once the lists are there.
  const requested = searchParams.get('section');
  const appliedRef = useRef<string | null>(null);
  const ready = !loading && !entPending;
  useEffect(() => {
    if (!ready || !requested || appliedRef.current === requested) return;
    if (!(REQUEST_KINDS as readonly string[]).includes(requested)) return;
    appliedRef.current = requested;
    const kind = requested as RequestKind;
    setOpen((prev) => ({ ...prev, [kind]: true }));
    const el = document.getElementById(`my-requests-${kind}`);
    if (!el) return;
    const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.setTimeout(() => {
      window.scrollTo({ top: scrollTopUnderBars(el, 0, 16), behavior: reduce ? 'auto' : 'smooth' });
    }, 350);
  }, [ready, requested]);

  if (!profile) return null;

  const createCtx = {
    isVerified: profile.access_status === 'verified',
    orgVerified: organization?.access_status === 'verified',
    persona: profile.persona,
    isFeatureEnabled,
  };
  const mayPublish = {
    projects: canCreate('submit_project', createCtx),
    rfps: canCreate('submit_rfp', createCtx),
    consultations: canCreate('submit_consultation', createCtx),
    webinars: canCreate('request_webinar', createCtx),
  };
  const publishWhenVerified = t('accountArea.publishWhenVerified', 'You can publish once your organisation is verified');
  const under10k = t('accountArea.budgetUnder10k', 'Under €10k');
  const langLabel = (code: string) => (code === 'EN' ? t('accountArea.lang.en', 'English') : t('accountArea.lang.fr', 'French'));
  const toggle = (kind: RequestKind) => setOpen((prev) => ({ ...prev, [kind]: !prev[kind] }));

  if (loading || entPending) {
    return <div className="rounded-card border border-rule bg-white"><RowSkeleton rows={3} /></div>;
  }

  const kinds: RequestKind[] = [
    ...(canProjects ? ['projects' as const] : []),
    ...(canRFPs ? ['rfps' as const] : []),
    ...(canConsultations ? ['consultations' as const] : []),
    'webinars',
  ];

  const newAction = (kind: RequestKind, href: string, label: string) => (mayPublish[kind] ? (
    <Button asChild variant="ctaNavy" size="sm">
      <Link to={href}>{label}</Link>
    </Button>
  ) : null);

  return (
    <div className="space-y-4">
      {/* ── Projects ── */}
      {kinds.includes('projects') && (
        <RequestGroup
          kind="projects"
          icon={Anchor}
          title={t('accountArea.submissions.projects', 'My projects')}
          count={projects.length}
          open={open.projects}
          onToggle={() => toggle('projects')}
          action={newAction('projects', '/submit-project', t('accountArea.projects.submit', 'Submit a project'))}
        >
          {projects.length === 0 ? (
            <MemberEmpty
              icon={Anchor}
              className="py-8"
              title={t('accountArea.projects.empty', 'No projects submitted yet.')}
              body={mayPublish.projects ? t('accountArea.projects.emptyBody', 'Describe a need and the right service providers come to you.') : publishWhenVerified}
            />
          ) : (
            <ul className="divide-y divide-rule">
              {projects.map((project) => (
                <ItemRow
                  key={project.id}
                  icon={Anchor}
                  title={humanize(project.project_type)}
                  meta={[
                    fmtDate(project.created_at),
                    project.budget_range ? formatBudgetRange(project.budget_range, under10k) : null,
                    project.timeline ? project.timeline.replace(/_/g, ' ') : null,
                  ]}
                  aside={(
                    <>
                      {project.status === 'new' && (
                        <Button asChild variant="outline" size="sm" className={BTN_OUTLINE}>
                          <Link to={`/submit-project/${project.id}`}>
                            <Pencil className="mr-1 h-3.5 w-3.5" aria-hidden="true" />{t('common.edit', 'Edit')}
                          </Link>
                        </Button>
                      )}
                      <SubmissionStatusBadge status={project.status} />
                    </>
                  )}
                />
              ))}
            </ul>
          )}
        </RequestGroup>
      )}

      {/* ── RFPs ── */}
      {kinds.includes('rfps') && (
        <RequestGroup
          kind="rfps"
          icon={ClipboardList}
          title={t('accountArea.submissions.rfps', 'My RFPs')}
          count={rfps.length}
          open={open.rfps}
          onToggle={() => toggle('rfps')}
          action={newAction('rfps', '/submit-rfp', t('accountArea.rfps.submit', 'Submit an RFP'))}
        >
          {rfps.length === 0 ? (
            <MemberEmpty icon={ClipboardList} className="py-8" title={t('accountArea.rfps.empty', 'No RFPs submitted.')} body={mayPublish.rfps ? undefined : publishWhenVerified} />
          ) : (
            <ul className="divide-y divide-rule">
              {rfps.map((rfp) => (
                <ItemRow
                  key={rfp.id}
                  icon={ClipboardList}
                  title={rfp.title}
                  description={rfp.scope}
                  meta={[
                    rfp.deadline_date ? t('accountArea.rfps.deadline', { date: fmtDate(rfp.deadline_date), defaultValue: 'Deadline: {{date}}' }) : null,
                    t('accountArea.common.created', { date: fmtDate(rfp.created_at), defaultValue: 'Created {{date}}' }),
                  ]}
                  rejection={rfp.status === 'rejected' ? rfp.rejection_reason : null}
                  aside={<SubmissionStatusBadge status={rfp.status || (rfp.is_open ? 'open' : 'closed')} />}
                  footer={(
                    <div className="flex flex-wrap gap-2">
                      {(rfp.status === 'submitted' || rfp.status === 'rejected') && (
                        <Button asChild variant="outline" size="sm" className={BTN_OUTLINE}>
                          <Link to={`/submit-rfp/${rfp.id}`}>
                            <Pencil className="mr-1 h-3.5 w-3.5" aria-hidden="true" />{t('common.edit', 'Edit')}
                          </Link>
                        </Button>
                      )}
                      <Button variant="outline" size="sm" className={BTN_OUTLINE} onClick={async () => {
                        const newOpen = !rfp.is_open;
                        await supabase.from('rfps').update({ is_open: newOpen }).eq('id', rfp.id);
                        setRfps((prev) => prev.map((r) => (r.id === rfp.id ? { ...r, is_open: newOpen } : r)));
                        toast({ title: newOpen ? t('accountArea.rfps.reopened', 'RFP reopened') : t('accountArea.rfps.closed', 'RFP closed') });
                      }}>
                        {rfp.is_open ? t('accountArea.common.close', 'Close') : t('accountArea.common.reopen', 'Reopen')}
                      </Button>
                      <Button variant="ghost" size="sm" className={DANGER} onClick={async () => {
                        if (!confirm(t('accountArea.rfps.deleteConfirm', 'Delete this RFP?'))) return;
                        await supabase.from('rfps').delete().eq('id', rfp.id);
                        setRfps((prev) => prev.filter((r) => r.id !== rfp.id));
                        toast({ title: t('accountArea.rfps.deleted', 'RFP deleted') });
                      }}>
                        <X className="mr-1 h-4 w-4" aria-hidden="true" />{t('common.delete', 'Delete')}
                      </Button>
                    </div>
                  )}
                />
              ))}
            </ul>
          )}
        </RequestGroup>
      )}

      {/* ── Consultations ── */}
      {kinds.includes('consultations') && (
        <RequestGroup
          kind="consultations"
          icon={MessageSquare}
          title={t('accountArea.submissions.consultations', 'My consultations')}
          count={consultations.length}
          open={open.consultations}
          onToggle={() => toggle('consultations')}
          action={newAction('consultations', '/submit-consultation', t('accountArea.consultations.new', 'New consultation'))}
        >
          {consultations.length === 0 ? (
            <MemberEmpty icon={MessageSquare} className="py-8" title={t('accountArea.consultations.empty', 'No consultations submitted.')} body={mayPublish.consultations ? undefined : publishWhenVerified} />
          ) : (
            <ul className="divide-y divide-rule">
              {consultations.map((c) => (
                <ItemRow
                  key={c.id}
                  icon={MessageSquare}
                  title={c.title}
                  description={c.description}
                  meta={[t('accountArea.common.created', { date: fmtDate(c.created_at), defaultValue: 'Created {{date}}' })]}
                  rejection={c.status === 'rejected' ? c.rejection_reason : null}
                  aside={<SubmissionStatusBadge status={c.status || (c.is_open ? 'open' : 'closed')} />}
                  footer={(
                    <div className="flex flex-wrap gap-2">
                      {(c.status === 'submitted' || c.status === 'rejected') && (
                        <Button asChild variant="outline" size="sm" className={BTN_OUTLINE}>
                          <Link to={`/submit-consultation/${c.id}`}>
                            <Pencil className="mr-1 h-3.5 w-3.5" aria-hidden="true" />{t('common.edit', 'Edit')}
                          </Link>
                        </Button>
                      )}
                      <Button variant="outline" size="sm" className={BTN_OUTLINE} onClick={async () => {
                        const newOpen = !c.is_open;
                        await supabase.from('consultations').update({ is_open: newOpen }).eq('id', c.id);
                        setConsultations((prev) => prev.map((x) => (x.id === c.id ? { ...x, is_open: newOpen } : x)));
                        toast({ title: newOpen ? t('accountArea.consultations.reopened', 'Consultation reopened') : t('accountArea.consultations.closed', 'Consultation closed') });
                      }}>
                        {c.is_open ? t('accountArea.common.close', 'Close') : t('accountArea.common.reopen', 'Reopen')}
                      </Button>
                      <Button variant="ghost" size="sm" className={DANGER} onClick={async () => {
                        if (!confirm(t('accountArea.consultations.deleteConfirm', 'Delete this consultation?'))) return;
                        await supabase.from('consultations').delete().eq('id', c.id);
                        setConsultations((prev) => prev.filter((x) => x.id !== c.id));
                        toast({ title: t('accountArea.consultations.deleted', 'Consultation deleted') });
                      }}>
                        <X className="mr-1 h-4 w-4" aria-hidden="true" />{t('common.delete', 'Delete')}
                      </Button>
                    </div>
                  )}
                />
              ))}
            </ul>
          )}
        </RequestGroup>
      )}

      {/* ── Webinar proposals (every member) ── */}
      <RequestGroup
        kind="webinars"
        icon={Radio}
        title={t('accountArea.submissions.webinars', 'My webinar proposals')}
        count={webinars.length}
        open={open.webinars}
        onToggle={() => toggle('webinars')}
        action={newAction('webinars', '/request-webinar', t('memberHome.requests.proposeWebinar', 'Propose a webinar'))}
      >
        {profile.access_status !== 'verified' ? (
          <MemberEmpty
            icon={Clock}
            tone="warning"
            className="py-8"
            title={t('accountArea.webinars.pendingTitle', 'Account pending approval')}
            body={t('accountArea.webinars.pendingBody', "You'll be able to propose webinars once your profile is verified by our team.")}
          />
        ) : webinars.length === 0 ? (
          <MemberEmpty icon={Radio} className="py-8" title={t('accountArea.webinars.empty', 'No webinar requests submitted.')} body={mayPublish.webinars ? undefined : publishWhenVerified} />
        ) : (
          <ul className="divide-y divide-rule">
            {webinars.map((req) => (
              <ItemRow
                key={req.id}
                icon={Radio}
                title={req.title}
                meta={[langLabel(req.preferred_language), req.preferred_timeframe, fmtDate(req.created_at)]}
                aside={<WebinarStatusBadge status={req.status} />}
                footer={(
                  <>
                    {req.moderator_notes && (
                      <div className="rounded-field border border-teal/25 bg-foam p-3 text-sm text-navy">
                        <span className="font-medium">{t('accountArea.webinars.teamNote', 'Team note:')}</span>{' '}
                        {req.moderator_notes}
                      </div>
                    )}
                    {req.status === 'submitted' && (
                      <div className="flex flex-wrap gap-2">
                        <Button asChild variant="outline" size="sm" className={BTN_OUTLINE}>
                          <Link to={`/request-webinar?edit=${req.id}`}>
                            <Pencil className="mr-1 h-3.5 w-3.5" aria-hidden="true" />{t('common.edit', 'Edit')}
                          </Link>
                        </Button>
                        <Button variant="ghost" size="sm" className={DANGER} onClick={async () => {
                          if (!confirm(t('accountArea.webinars.withdrawConfirm', 'Withdraw this webinar request?'))) return;
                          await supabase.from('webinar_requests').delete().eq('id', req.id);
                          setWebinars((prev) => prev.filter((r) => r.id !== req.id));
                          toast({ title: t('accountArea.webinars.deleted', 'Request deleted') });
                        }}>
                          <X className="mr-1 h-4 w-4" aria-hidden="true" />{t('accountArea.webinars.withdraw', 'Withdraw')}
                        </Button>
                      </div>
                    )}
                  </>
                )}
              />
            ))}
          </ul>
        )}
      </RequestGroup>
    </div>
  );
}

/** One kind of request: a header that folds the list (count, the "new" button), then the list. */
function RequestGroup({
  kind,
  icon: Icon,
  title,
  count,
  open,
  onToggle,
  action,
  children,
}: {
  kind: RequestKind;
  icon: LucideIcon;
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  action?: ReactNode;
  children: ReactNode;
}) {
  const listId = `my-requests-${kind}-list`;
  return (
    <section id={`my-requests-${kind}`} className="rounded-card border border-rule bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 sm:pr-5">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={listId}
          className="flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-field px-2 text-left focus:outline-none focus-visible:shadow-focus"
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-field bg-chip text-navy">
            <Icon className="h-4 w-4" aria-hidden="true" />
          </span>
          <span className="min-w-0 text-[15px] font-semibold text-navy">{title}</span>
          <span className="rounded-pill bg-chip px-2 py-0.5 text-xs font-semibold tabular-nums text-navy">{count}</span>
          <ChevronDown className={cn('ml-auto h-4 w-4 shrink-0 text-meta transition-transform sm:ml-1', open && 'rotate-180')} aria-hidden="true" />
        </button>
        {action}
      </div>
      {open && <div id={listId} className="border-t border-rule">{children}</div>}
    </section>
  );
}
