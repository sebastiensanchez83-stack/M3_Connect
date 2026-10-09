import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Check, CheckCircle2, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LogoTile } from '@/components/brand/OrgCard';
import { LogoBadge } from '@/components/ui/CoverImage';
import { StatusPill } from '@/components/member/MemberUI';
import { useAuth } from '@/contexts/AuthContext';
import {
  answerJoinRequest, invitationProblem, inviterName, sendTeamInvitation,
} from '@/components/organization/orgActions';
import { answerConnectionRequest, loadWaitingConnections, type WaitingConnection } from '@/components/inbox/inboxActions';
import { toast } from '@/hooks/use-toast';
import { displayCase } from '@/lib/displayCase';
import { supabase } from '@/lib/supabase';
import { requireFreshSession } from '@/lib/session';
import type { CreateAction } from '@/lib/nav';
import type { Organization } from '@/types/database';
import { cn } from '@/lib/utils';
import { BTN_TOUCH, EditDialog, errorText } from './EditKit';

/**
 * The windows of the team and of the requests that wait for an answer:
 * invite a colleague, answer connection requests, answer people who asked to
 * join, switch company, publish a new need. Same writes as the inbox and the
 * full company editor (inboxActions, orgActions).
 */

const ACCEPT = 'h-11 rounded-pill bg-navy px-5 text-[15px] font-semibold text-white hover:bg-navy/90 md:h-11';

/**
 * After an answer the pressed button gives way to "Accepted" / "Declined":
 * the focus goes on to the next request's Accept, or to the closing button
 * when none is left, instead of falling back to the window itself.
 */
function useFocusOnAfterAnswer(contentRef: RefObject<HTMLDivElement>, answered: object) {
  useEffect(() => {
    const root = contentRef.current;
    if (!root || Object.keys(answered).length === 0) return;
    const id = requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active && active !== document.body && active !== root && root.contains(active)) return;
      const next = root.querySelector<HTMLElement>('[data-answer-next]:not([disabled])') ?? root.querySelector<HTMLElement>('[data-dialog-close]');
      next?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [contentRef, answered]);
}

/* ------------------------------------------------------------------ invite */

export function InviteDialog({
  open,
  onOpenChange,
  org,
  occupiedSeats,
  onSent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  org: Pick<Organization, 'id' | 'name' | 'organization_type' | 'max_seats' | 'primary_domain'>;
  /** Members and open invitations: what counts against the company's seats. */
  occupiedSeats: number;
  onSent?: () => void;
}) {
  const { t } = useTranslation();
  const { user, profile } = useAuth();
  const id = useId();
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setEmail(''); setError(null); } }, [open]);

  const send = async () => {
    const address = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      setError(t('dash.inviteBadEmail', 'Please type a full e-mail address, like name@company.com.'));
      return;
    }
    const problem = invitationProblem(org, occupiedSeats, address);
    if (problem === 'capacity') {
      setError(t('dash.inviteFull', { count: org.max_seats, defaultValue: 'Your company has used all its places ({{count}}). Write to the M3 team to add more.' }));
      return;
    }
    if (problem === 'domain') {
      setError(t('dash.inviteDomain', { domain: org.primary_domain, defaultValue: 'Please use an address ending in @{{domain}}, your company\'s e-mail.' }));
      return;
    }
    if (!user) return;
    const uid = await requireFreshSession();
    if (!uid) return;
    setSaving(true);
    setError(null);
    try {
      await sendTeamInvitation(org, user.id, inviterName(profile, user.email), { email: address });
      toast({ title: t('dash.inviteSent', 'Invitation sent'), description: t('dash.inviteSentDesc', { email: address.toLowerCase(), defaultValue: 'We e-mailed {{email}} a link to join your company.' }) });
      setSaving(false);
      onOpenChange(false);
      onSent?.();
    } catch (err) {
      setSaving(false);
      setError(t('dash.inviteFailed', { reason: errorText(err, ''), defaultValue: 'We could not send the invitation. {{reason}}' }).trim());
    }
  };

  return (
    <EditDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('dash.inviteTitle', 'Invite a colleague')}
      description={t('dash.inviteDesc', { org: org.name, defaultValue: 'We will e-mail them a link to join {{org}} on the platform.' })}
      onSave={send}
      saveLabel={t('dash.inviteSend', 'Send the invitation')}
      saving={saving}
      canSave={!!email.trim()}
      error={error}
      errorId={`${id}-error`}
    >
      <div className="space-y-2">
        <Label htmlFor={id} className="text-[15px] font-semibold text-navy">{t('dash.inviteEmail', 'Their e-mail address')}</Label>
        <Input
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          type="email"
          inputMode="email"
          autoComplete="off"
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={org.primary_domain && org.organization_type !== 'marina' ? `name@${org.primary_domain}` : 'name@company.com'}
          className="h-12 text-[16px] md:h-12 md:text-[16px]"
        />
      </div>
    </EditDialog>
  );
}

/* ------------------------------------------------------------------ connection requests */

type Answered = Record<string, 'accepted' | 'rejected' | 'taken'>;

/** "Answer 2 connection requests": who asked, their message, Accept or Decline. */
export function ConnectionsDialog({
  open,
  onOpenChange,
  onAnswered,
  onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** After each answer, with how many still wait. */
  onAnswered: (remaining: number) => void;
  onCloseAutoFocus?: (e: Event) => void;
}) {
  const { t } = useTranslation();
  const { user, profile, organization } = useAuth();
  const uid = user?.id ?? null;
  const orgId = organization?.id ?? null;
  const [items, setItems] = useState<WaitingConnection[] | null>(null);
  const [answered, setAnswered] = useState<Answered>({});
  const [acting, setActing] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  useFocusOnAfterAnswer(contentRef, answered);

  useEffect(() => {
    if (!open || !uid) return;
    let alive = true;
    setItems(null);
    setAnswered({});
    loadWaitingConnections(uid, orgId).then((r) => { if (alive) setItems(r); }, () => { if (alive) setItems([]); });
    return () => { alive = false; };
  }, [open, uid, orgId]);

  const answer = async (item: WaitingConnection, status: 'accepted' | 'rejected') => {
    const fresh = await requireFreshSession();
    if (!fresh) return;
    setActing(item.data.id);
    const result = await answerConnectionRequest(item.data, status, {
      email: user?.email, firstName: profile?.first_name, lastName: profile?.last_name, orgName: organization?.name ?? '',
    });
    setActing(null);
    if (!result.ok && !result.taken) {
      toast({ title: t('dash.answerFailed', 'We could not send your answer'), description: result.message, variant: 'destructive' });
      return;
    }
    const next: Answered = { ...answered, [item.data.id]: result.ok ? status : 'taken' };
    setAnswered(next);
    toast(result.ok
      ? { title: status === 'accepted' ? t('dash.accepted', 'Accepted') : t('dash.declined', 'Declined'), description: status === 'accepted' ? t('dash.acceptedDesc', 'M3 is introducing you both by e-mail.') : undefined }
      : { title: t('dash.alreadyAnswered', 'Already answered'), description: t('dash.alreadyAnsweredDesc', 'Someone in your team answered this request first.') });
    onAnswered((items ?? []).filter((i) => !next[i.data.id]).length);
  };

  const left = (items ?? []).filter((i) => !answered[i.data.id]).length;

  return (
    <EditDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('dash.connectionsTitle', 'Connection requests')}
      description={t('dash.connectionsDesc', 'These members would like to get in touch. If you accept, M3 introduces you both by e-mail.')}
      saveLabel={left === 0 && items && items.length > 0 ? t('dash.done', 'Done') : t('dash.closeLater', 'I will answer later')}
      quietClose={!(left === 0 && items && items.length > 0)}
      wide
      onCloseAutoFocus={onCloseAutoFocus}
      contentRef={contentRef}
    >
      {!items ? (
        <div className="flex items-center justify-center py-10 text-meta" role="status">
          <Loader2 className="mr-2 h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          {t('dash.loading', 'Loading…')}
        </div>
      ) : items.length === 0 ? (
        <p className="rounded-field bg-page px-4 py-6 text-center text-[15px] text-meta">{t('dash.noConnections', 'Nothing is waiting for your answer.')}</p>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => {
            const done = answered[item.data.id];
            const person = item.person?.name || '';
            const company = item.org ? displayCase(item.org.name) || item.org.name : '';
            const visual = item.person?.avatar_url
              ? <img src={item.person.avatar_url} alt="" className="h-12 w-12 shrink-0 rounded-full object-cover ring-1 ring-rule" />
              : item.org
                ? <LogoTile src={item.org.logo_url} name={company} type={item.org.organization_type} size={48} />
                : <span aria-hidden="true" className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-chip text-[15px] font-semibold text-navy">{(person || company || '?').slice(0, 1).toUpperCase()}</span>;
            return (
              <li key={item.data.id} className={cn('rounded-field border p-4', done ? 'border-rule bg-page' : 'border-gold/60 bg-white')}>
                <div className="flex gap-3">
                  {visual}
                  <div className="min-w-0 flex-1">
                    <p className="text-[16px] font-semibold leading-6 text-navy [overflow-wrap:anywhere]">
                      {person || company || t('dash.aMember', 'A member')}
                    </p>
                    <p className="text-[14px] leading-5 text-meta [overflow-wrap:anywhere]">
                      {[item.person?.job_title, person ? company : null].filter(Boolean).join(' · ')}
                    </p>
                    {item.data.message && (
                      <p className="mt-2 line-clamp-4 border-l-2 border-rule pl-3 text-[15px] leading-6 text-ink">{item.data.message}</p>
                    )}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 sm:pl-[60px]">
                  {done ? (
                    <StatusPill tone={done === 'accepted' ? 'success' : 'neutral'} icon={done === 'accepted' ? CheckCircle2 : undefined}>
                      {done === 'accepted' ? t('dash.accepted', 'Accepted') : done === 'rejected' ? t('dash.declined', 'Declined') : t('dash.alreadyAnswered', 'Already answered')}
                    </StatusPill>
                  ) : (
                    <>
                      <Button type="button" data-answer-next="" className={cn(ACCEPT, 'gap-1.5')} disabled={acting === item.data.id} onClick={() => answer(item, 'accepted')}>
                        <Check className="h-4 w-4" aria-hidden="true" />
                        {t('dash.accept', 'Accept')}
                        <span className="sr-only"> {person || company}</span>
                      </Button>
                      <Button type="button" variant="outline" className={cn(BTN_TOUCH, 'gap-1.5')} disabled={acting === item.data.id} onClick={() => answer(item, 'rejected')}>
                        <X className="h-4 w-4" aria-hidden="true" />
                        {t('dash.decline', 'Decline')}
                        <span className="sr-only"> {person || company}</span>
                      </Button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </EditDialog>
  );
}

/* ------------------------------------------------------------------ join requests */

interface JoinRequest { id: string; email: string; first_name: string | null; last_name: string | null; created_at: string }

/** People who asked to join the company: Accept or Decline (the owner's decision). */
export function JoinRequestsDialog({
  open,
  onOpenChange,
  org,
  onAnswered,
  onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  org: Pick<Organization, 'id' | 'name'>;
  onAnswered: (remaining: number) => void;
  onCloseAutoFocus?: (e: Event) => void;
}) {
  const { t } = useTranslation();
  const [items, setItems] = useState<JoinRequest[] | null>(null);
  const [answered, setAnswered] = useState<Record<string, 'accepted' | 'rejected'>>({});
  const [acting, setActing] = useState<string | null>(null);
  // "Decline Sam Rivera?" first: the refusal e-mail leaves at once and cannot be taken back.
  const [confirming, setConfirming] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  useFocusOnAfterAnswer(contentRef, answered);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setItems(null);
    setAnswered({});
    setConfirming(null);
    supabase
      .from('organization_invitations')
      .select('id, email, first_name, last_name, created_at')
      .eq('organization_id', org.id)
      .eq('status', 'join_requested')
      .order('created_at', { ascending: true })
      .then(({ data }) => { if (alive) setItems((data ?? []) as JoinRequest[]); }, () => { if (alive) setItems([]); });
    return () => { alive = false; };
  }, [open, org.id]);

  const answer = async (req: JoinRequest, approve: boolean) => {
    const fresh = await requireFreshSession();
    if (!fresh) return;
    setActing(req.id);
    try {
      await answerJoinRequest(req.id, req.email, org.name, approve);
      const next = { ...answered, [req.id]: approve ? 'accepted' as const : 'rejected' as const };
      setConfirming(null);
      setAnswered(next);
      toast({
        title: approve ? t('dash.joinAccepted', 'Welcome to the team') : t('dash.declined', 'Declined'),
        description: approve
          ? t('dash.joinAcceptedDesc', { email: req.email, defaultValue: '{{email}} is now part of your company. We let them know by e-mail.' })
          : t('dash.joinDeclinedDesc', { email: req.email, defaultValue: 'We let {{email}} know by e-mail.' }),
      });
      onAnswered((items ?? []).filter((i) => !next[i.id]).length);
    } catch (err) {
      toast({ title: t('dash.answerFailed', 'We could not send your answer'), description: errorText(err, ''), variant: 'destructive' });
    }
    setActing(null);
  };

  const left = (items ?? []).filter((i) => !answered[i.id]).length;

  return (
    <EditDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('dash.joinTitle', 'People asking to join your company')}
      description={t('dash.joinDesc', { org: org.name, defaultValue: 'Accept the people who work at {{org}}. Decline the others.' })}
      saveLabel={left === 0 && items && items.length > 0 ? t('dash.done', 'Done') : t('dash.closeLater', 'I will answer later')}
      quietClose={!(left === 0 && items && items.length > 0)}
      wide
      onCloseAutoFocus={onCloseAutoFocus}
      contentRef={contentRef}
    >
      {!items ? (
        <div className="flex items-center justify-center py-10 text-meta" role="status">
          <Loader2 className="mr-2 h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          {t('dash.loading', 'Loading…')}
        </div>
      ) : items.length === 0 ? (
        <p className="rounded-field bg-page px-4 py-6 text-center text-[15px] text-meta">{t('dash.noJoin', 'Nobody is waiting any more.')}</p>
      ) : (
        <ul className="space-y-3">
          {items.map((req) => {
            const name = displayCase(`${req.first_name ?? ''} ${req.last_name ?? ''}`.trim()) || req.email;
            const done = answered[req.id];
            return (
              <li key={req.id} className={cn('rounded-field border p-4', done ? 'border-rule bg-page' : 'border-gold/60 bg-white')}>
                <p className="text-[16px] font-semibold leading-6 text-navy [overflow-wrap:anywhere]">{name}</p>
                {name !== req.email && <p className="text-[14px] leading-5 text-meta [overflow-wrap:anywhere]">{req.email}</p>}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {done ? (
                    <StatusPill tone={done === 'accepted' ? 'success' : 'neutral'} icon={done === 'accepted' ? CheckCircle2 : undefined}>
                      {done === 'accepted' ? t('dash.accepted', 'Accepted') : t('dash.declined', 'Declined')}
                    </StatusPill>
                  ) : confirming === req.id ? (
                    <>
                      <span className="w-full text-[15px] font-semibold leading-6 text-navy sm:w-auto">
                        {t('dash.declineQ', { name, defaultValue: 'Decline {{name}}? We will tell them by e-mail.' })}
                      </span>
                      <Button
                        type="button"
                        disabled={acting === req.id}
                        onClick={() => answer(req, false)}
                        className="h-11 rounded-pill bg-red-700 px-5 text-[15px] font-semibold text-white hover:bg-red-800 md:h-11"
                      >
                        {acting === req.id && <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                        {t('dash.yesDecline', 'Yes, decline')}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        autoFocus
                        className={BTN_TOUCH}
                        disabled={acting === req.id}
                        onClick={() => {
                          setConfirming(null);
                          requestAnimationFrame(() => contentRef.current?.querySelector<HTMLElement>(`[data-decline="${req.id}"]`)?.focus());
                        }}
                      >
                        {t('dash.keep', 'Keep')}
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button type="button" data-answer-next="" className={cn(ACCEPT, 'gap-1.5')} disabled={acting === req.id} onClick={() => answer(req, true)}>
                        <Check className="h-4 w-4" aria-hidden="true" />
                        {t('dash.accept', 'Accept')}
                        <span className="sr-only"> {name}</span>
                      </Button>
                      <Button type="button" data-decline={req.id} variant="outline" className={cn(BTN_TOUCH, 'gap-1.5')} disabled={acting === req.id} onClick={() => setConfirming(req.id)}>
                        <X className="h-4 w-4" aria-hidden="true" />
                        {t('dash.decline', 'Decline')}
                        <span className="sr-only"> {name}</span>
                      </Button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </EditDialog>
  );
}

/* ------------------------------------------------------------------ switch company */

/** For members of several companies: which one they act for. */
export function SwitchCompanyDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const { organization, organizations, setActiveOrganization } = useAuth();
  return (
    <EditDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('dash.switchTitle', 'Which company do you act for?')}
      description={t('dash.switchDesc', 'You belong to several companies. Your dashboard shows the one you choose.')}
      saveLabel={t('memberHome.close', 'Close')}
      quietClose
    >
      <ul className="space-y-2">
        {organizations.map((m) => {
          const current = organization?.id === m.organization.id;
          return (
            <li key={m.organization.id}>
              <button
                type="button"
                aria-pressed={current}
                onClick={() => {
                  if (!current) {
                    setActiveOrganization(m.organization.id);
                    toast({ title: t('dash.switched', { org: m.organization.name, defaultValue: 'You now act for {{org}}' }) });
                  }
                  onOpenChange(false);
                }}
                className={cn(
                  'flex min-h-14 w-full items-center gap-3 rounded-field border px-3 py-2 text-left transition-colors focus:outline-none focus-visible:shadow-focus',
                  current ? 'border-navy bg-foam' : 'border-rule bg-white hover:bg-page',
                )}
              >
                <LogoBadge src={m.organization.logo_url} name={m.organization.name} size="sm" />
                <span className="min-w-0 flex-1 truncate text-[16px] font-semibold text-navy">{m.organization.name}</span>
                {current && <span className="text-[14px] font-semibold text-teal-text">{t('dash.current', 'Current')}</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </EditDialog>
  );
}

/* ------------------------------------------------------------------ publish */

/** "Publish a new need": the forms this member may use, as big choices. */
export function PublishDialog({
  open,
  onOpenChange,
  actions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions: CreateAction[];
}) {
  const { t } = useTranslation();
  return (
    <EditDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('dash.publishTitle', 'What do you want to publish?')}
      description={t('dash.publishDesc', 'Choose one. The M3 team checks it, then the right companies see it.')}
      saveLabel={t('common.cancel', 'Cancel')}
      quietClose
    >
      <ul className="space-y-2">
        {actions.map((a) => {
          const Icon = a.icon;
          return (
            <li key={a.href}>
              <Link
                to={a.href}
                onClick={() => onOpenChange(false)}
                className="group flex min-h-16 items-center gap-3 rounded-field border border-rule bg-white px-4 py-3 transition-colors hover:border-navy/40 hover:bg-page focus:outline-none focus-visible:shadow-focus"
              >
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-field bg-chip text-navy">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[16px] font-semibold leading-6 text-navy"><span className="card-ul">{t(a.labelKey, a.fallback)}</span></span>
                  {a.descKey && <span className="block text-[14px] leading-5 text-meta">{t(a.descKey, a.descFallback ?? '')}</span>}
                </span>
                <ArrowRight className="card-arrow !ml-0 shrink-0" strokeWidth={2.25} aria-hidden="true" />
              </Link>
            </li>
          );
        })}
      </ul>
    </EditDialog>
  );
}
