import { useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { requireFreshSession } from '@/lib/session';
import { toast } from '@/hooks/use-toast';
import { sendNotification } from '@/lib/notifications';
import { CardShell } from '@/components/brand/CardShell';
import { LogoTile } from '@/components/brand/OrgCard';
import { UnderlineLink } from '@/components/brand/UnderlineLink';
import { BTN, BTN_OUTLINE, MemberEmpty, MemberPanel, RowSkeleton, StatusPill } from '@/components/member/MemberUI';
import { fetchPeopleOrgs, type PersonOrg } from '@/lib/personOrg';
import { displayCase } from '@/lib/displayCase';
import { cn } from '@/lib/utils';
import { myOrganizationIds, needsAction } from './inboxCounts';
import {
  answerConnectionRequest, fetchPeople, loadPartnerRows,
  type OrgRef, type PartnerRequestData, type PartnerStatus, type PersonRef,
} from './inboxActions';
import type { LucideIcon } from 'lucide-react';
import {
  Inbox, Link2, Award, Users, Check, X, Clock, MailCheck, Undo2,
  CheckCircle, Mail, RefreshCw,
} from 'lucide-react';

/**
 * The member's inbox: connection requests (received and sent), recommendation
 * requests, join requests and team invitations.
 *
 * Oct 2026: a connection request goes to the WHOLE receiving company
 * (partner_requests.marina_organization_id, 20261008200000_partner_requests_whole_company.sql):
 * every member of it sees it here and any of them can accept or decline it; the
 * first answer wins (the database refuses the second) and the card then says who
 * answered ("Accepted by …", "Declined by …"). Each request shows who sent it:
 * photo or logo, name, job title, and the company, which links to its page. Dates
 * read "19 Sept 2026". "Waiting for you" counts follow inboxCounts.ts.
 */

type FilterCategory = 'all' | 'b2b' | 'recommendations' | 'team';
interface ReferenceData {
  id: string;
  reference_id: string;
  client_legal_name: string;
  project_name: string;
  status: 'pending' | 'sent' | 'confirmed' | 'rejected' | 'expired';
  created_at: string;
  confirmed_at: string | null;
}

interface JoinRequestData {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  organization_id: string;
  organization_name: string;
  created_at: string;
}

interface TeamInvitationData {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  organization_id: string;
  organization_name: string;
  status: 'pending' | 'accepted' | 'rejected' | 'expired' | 'cancelled';
  created_at: string;
  expires_at: string | null;
}

type PartnerItem = {
  kind: 'partner_request';
  category: 'b2b';
  created_at: string;
  data: PartnerRequestData;
  direction: 'received' | 'sent';
  /** Received: the person who sent it. Sent: null (it is me). */
  person: PersonRef | null;
  /** Received: the sender's company. Sent: the company I asked. */
  org: OrgRef | null;
  /** Who in the receiving company answered: a name, "you", or null when unknown. */
  answeredBy: string | null;
};

type InboxItem =
  | PartnerItem
  | { kind: 'reference_request'; category: 'recommendations'; created_at: string; data: ReferenceData }
  | { kind: 'join_request'; category: 'team'; created_at: string; data: JoinRequestData }
  | { kind: 'team_invitation'; category: 'team'; created_at: string; data: TeamInvitationData };

const FILTERS: { value: FilterCategory; label: string; icon: React.ReactNode }[] = [
  { value: 'all', label: 'All', icon: <Inbox className="h-4 w-4" /> },
  { value: 'b2b', label: 'B2B connections', icon: <Link2 className="h-4 w-4" /> },
  { value: 'recommendations', label: 'Recommendations', icon: <Award className="h-4 w-4" /> },
  { value: 'team', label: 'Team & invitations', icon: <Users className="h-4 w-4" /> },
];

/** "19 Sept 2026", the short date of the rest of the site; '' for an unreadable date. */
function shortDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function InboxTab() {
  const { user, profile, organization, orgRole } = useAuth();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [items, setItems] = useState<InboxItem[]>([]);
  const [filter, setFilter] = useState<FilterCategory>('all');
  const [actingOn, setActingOn] = useState<string | null>(null);

  const isOwner = orgRole === 'owner';
  // Keyed on ids, never on the auth objects (replaced on every tab refocus).
  const uid = user?.id ?? null;
  const orgId = organization?.id ?? null;
  const orgName = organization?.name ?? '';

  const load = useCallback(async (showSpinner = true) => {
    if (!uid) return;
    if (showSpinner) setLoading(true);
    else setRefreshing(true);

    const collected: InboxItem[] = [];

    // 1) Connection requests: sent by me, addressed to me, or to any of my organisations.
    const orgIds = [...new Set([...(await myOrganizationIds(uid)), ...(orgId ? [orgId] : [])])];
    const prRows = await loadPartnerRows(uid, orgIds);

    // Who is on the other side. People's public fields (verified accounts) come from
    // get_public_profiles; a request saved without its organisations (before 8 Oct
    // 2026) gets the company each person speaks for.
    const personIds = new Set<string>();
    for (const r of prRows) {
      if (r.partner_user_id !== uid) personIds.add(r.partner_user_id);
      if (r.answered_by_user_id && r.answered_by_user_id !== uid) personIds.add(r.answered_by_user_id);
    }
    const people: Record<string, PersonRef> = await fetchPeople([...personIds]);
    const missingOrgFor = prRows
      .map((r) => (r.partner_user_id === uid ? (r.marina_org ? null : r.marina_user_id) : (r.partner_org ? null : r.partner_user_id)))
      .filter((x): x is string => !!x);
    const fallbackOrgs: Record<string, PersonOrg> = missingOrgFor.length ? await fetchPeopleOrgs(missingOrgFor) : {};

    for (const r of prRows) {
      const sent = r.partner_user_id === uid;
      const org: OrgRef | null = sent
        ? r.marina_org ?? fallbackOrgs[r.marina_user_id] ?? null
        : r.partner_org ?? fallbackOrgs[r.partner_user_id] ?? null;
      const answeredBy = !r.answered_by_user_id
        ? null
        : r.answered_by_user_id === uid
        ? 'you'
        : people[r.answered_by_user_id]?.name || null;
      collected.push({
        kind: 'partner_request',
        category: 'b2b',
        created_at: r.created_at,
        direction: sent ? 'sent' : 'received',
        person: sent ? null : people[r.partner_user_id] ?? null,
        org,
        answeredBy,
        data: r,
      });
    }

    // 2) Recommendation requests (only for partners — those who SEND them)
    if (orgId) {
      const { data: refRows } = await supabase
        .from('reference_requests')
        .select('id, reference_id, client_legal_name, project_name, status, created_at, confirmed_at')
        .eq('partner_organization_id', orgId)
        .order('created_at', { ascending: false });
      (refRows as ReferenceData[] | null)?.forEach((r) => {
        collected.push({ kind: 'reference_request', category: 'recommendations', created_at: r.created_at, data: r });
      });
    }

    // 3) Join requests received (only for org owners — when someone with a matching domain wants in)
    if (isOwner && orgId) {
      const { data: jrRows } = await supabase
        .from('organization_invitations')
        .select('id, email, first_name, last_name, organization_id, created_at')
        .eq('organization_id', orgId)
        .eq('status', 'join_requested');
      (jrRows as Omit<JoinRequestData, 'organization_name'>[] | null)?.forEach((r) => {
        collected.push({ kind: 'join_request', category: 'team', created_at: r.created_at, data: { ...r, organization_name: orgName } });
      });
    }

    // 4) Team invitations sent by user (any pending/accepted/rejected outgoing)
    const { data: tiRows } = await supabase
      .from('organization_invitations')
      .select('id, email, first_name, last_name, organization_id, status, created_at, expires_at')
      .eq('invited_by_user_id', uid)
      .in('status', ['pending', 'accepted', 'rejected', 'expired', 'cancelled']);
    (tiRows as Omit<TeamInvitationData, 'organization_name'>[] | null)?.forEach((r) => {
      collected.push({ kind: 'team_invitation', category: 'team', created_at: r.created_at, data: { ...r, organization_name: orgName } });
    });

    // Sort all by created_at desc
    collected.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    setItems(collected);
    setLoading(false);
    setRefreshing(false);
  }, [uid, orgId, orgName, isOwner]);

  useEffect(() => {
    load(true);
  }, [load]);

  const filtered = useMemo(() => {
    if (filter === 'all') return items;
    return items.filter((i) => i.category === filter);
  }, [items, filter]);

  // "Waiting for you" per category: the rule of inboxCounts.ts (received and pending, join requests).
  const pendingByCategory = useMemo(() => {
    const counts: Record<FilterCategory, number> = { all: 0, b2b: 0, recommendations: 0, team: 0 };
    for (const it of items) {
      const countable = it.kind === 'partner_request'
        ? { kind: it.kind, direction: it.direction, status: it.data.status }
        : { kind: it.kind };
      if (needsAction(countable)) {
        counts.all += 1;
        counts[it.category] += 1;
      }
    }
    return counts;
  }, [items]);

  // Action handlers
  const handlePartnerResponse = async (item: PartnerItem, newStatus: 'accepted' | 'rejected') => {
    const freshUid = await requireFreshSession();
    if (!freshUid) return;
    setActingOn(item.data.id);
    // Only a request still pending: a colleague may have answered in the meantime
    // (the database refuses a second answer too). The e-mail to the sender follows.
    const result = await answerConnectionRequest(item.data, newStatus, {
      email: user?.email, firstName: profile?.first_name, lastName: profile?.last_name, orgName,
    });
    if (!result.ok) {
      // No row (it was no longer pending) or the database's "already answered":
      // a colleague was first. Anything else is a real failure.
      toast(result.taken
        ? { title: 'Already answered', description: 'Someone in your team has already answered this request.' }
        : { title: 'Failed', description: result.message, variant: 'destructive' });
      setActingOn(null);
      load(false);
      return;
    }
    setItems((prev) => prev.map((i) =>
      i === item
        ? { ...item, answeredBy: 'you', data: { ...item.data, status: newStatus, answered_by_user_id: uid, answered_at: new Date().toISOString() } }
        : i,
    ));

    toast({
      title: newStatus === 'accepted' ? 'Request accepted' : 'Request declined',
      description: newStatus === 'accepted' ? 'We are introducing you both by e-mail.' : undefined,
    });
    setActingOn(null);
  };

  const handleJoinResponse = async (item: InboxItem & { kind: 'join_request' }, approve: boolean) => {
    const freshUid = await requireFreshSession();
    if (!freshUid) return;
    setActingOn(item.data.id);
    const rpc = approve ? 'approve_join_request' : 'reject_join_request';
    const { error } = await supabase.rpc(rpc, { p_invitation_id: item.data.id });
    if (error) {
      toast({ title: 'Failed', description: error.message, variant: 'destructive' });
    } else {
      // Remove the item from the inbox view
      setItems((prev) => prev.filter((i) => !(i.kind === 'join_request' && i.data.id === item.data.id)));
      toast({ title: approve ? 'Join request approved' : 'Join request declined' });
    }
    setActingOn(null);
  };

  const handleResendInvitation = async (item: InboxItem & { kind: 'team_invitation' }) => {
    if (!orgId) return;
    setActingOn(item.data.id);
    await sendNotification({
      type: 'team_invitation_reminder',
      email: item.data.email,
      data: {
        first_name: item.data.first_name ?? '',
        org_name: item.data.organization_name,
        signup_url: `${window.location.origin}/?signup=true&email=${encodeURIComponent(item.data.email)}`,
      },
    });
    toast({ title: 'Reminder sent', description: item.data.email });
    setActingOn(null);
  };

  const handleCancelInvitation = async (item: InboxItem & { kind: 'team_invitation' }) => {
    if (!confirm(`Cancel invitation to ${item.data.email}?`)) return;
    setActingOn(item.data.id);
    const { error } = await supabase
      .from('organization_invitations')
      .update({ status: 'cancelled' })
      .eq('id', item.data.id);
    if (error) {
      toast({ title: 'Failed', description: error.message, variant: 'destructive' });
    } else {
      setItems((prev) => prev.map((i) =>
        i.kind === 'team_invitation' && i.data.id === item.data.id
          ? { ...i, data: { ...i.data, status: 'cancelled' as const } }
          : i
      ));
      toast({ title: 'Invitation cancelled' });
    }
    setActingOn(null);
  };

  if (loading) return <MemberPanel><RowSkeleton rows={3} /></MemberPanel>;

  return (
    <div className="space-y-5">
      {/* Filters: the directory's segmented control, scrolling sideways on a phone */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Filter the inbox" className="no-scrollbar -mx-1 max-w-full overflow-x-auto px-1 py-1">
          <div className="inline-flex rounded-pill bg-[#e9edf3] p-1">
            {FILTERS.map((f) => {
              const active = filter === f.value;
              return (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setFilter(f.value)}
                  aria-pressed={active}
                  className={cn(
                    'inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-pill px-3.5 text-[14px] font-medium transition-colors duration-300 focus-visible:outline-none focus-visible:shadow-focus',
                    active ? 'bg-white text-navy shadow-[0_1px_3px_rgba(11,38,83,.10)]' : 'text-meta hover:text-navy',
                  )}
                >
                  {f.icon}
                  {f.label}
                  {pendingByCategory[f.value] > 0 && (
                    <span className="grid h-5 min-w-5 place-items-center rounded-pill bg-navy px-1.5 text-[12px] font-semibold leading-none tabular-nums text-white">
                      {pendingByCategory[f.value]}
                      <span className="sr-only"> waiting for you</span>
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
        <Button size="sm" variant="ghost" className={cn(BTN, 'gap-1.5 text-navy hover:bg-chip')} onClick={() => load(false)} disabled={refreshing}>
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden="true" />
          Refresh
        </Button>
      </div>

      {/* Items */}
      {filtered.length === 0 ? (
        <CardShell>
          <MemberEmpty
            icon={Inbox}
            title={filter === 'all' ? 'Your inbox is empty.' : 'Nothing in this category right now.'}
            body="Connection requests, team requests and recommendations from other members show up here."
          />
        </CardShell>
      ) : (
        <ul className="space-y-3">
          {filtered.map((item) => (
            <InboxItemCard
              key={`${item.kind}-${'id' in item.data ? item.data.id : ''}`}
              item={item}
              acting={actingOn === ('id' in item.data ? item.data.id : '')}
              onPartnerResponse={handlePartnerResponse}
              onJoinResponse={handleJoinResponse}
              onResendInvitation={handleResendInvitation}
              onCancelInvitation={handleCancelInvitation}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

interface InboxItemCardProps {
  item: InboxItem;
  acting: boolean;
  onPartnerResponse: (item: PartnerItem, status: 'accepted' | 'rejected') => void;
  onJoinResponse: (item: InboxItem & { kind: 'join_request' }, approve: boolean) => void;
  onResendInvitation: (item: InboxItem & { kind: 'team_invitation' }) => void;
  onCancelInvitation: (item: InboxItem & { kind: 'team_invitation' }) => void;
}

/** One request: icon tile (or the sender's photo / logo), title and meta line, a state pill, the answer buttons. */
function InboxRow({
  icon: Icon,
  visual,
  urgent = false,
  title,
  meta,
  status,
  body,
  note,
  children,
}: {
  icon: LucideIcon;
  /** Replaces the icon tile (a person's photo, a company logo). */
  visual?: ReactNode;
  urgent?: boolean;
  title: ReactNode;
  meta?: ReactNode;
  status: ReactNode;
  body?: ReactNode;
  /** A line under the message (who answered, the e-mail introduction). */
  note?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <li>
      <CardShell className={cn(urgent && 'border-gold/60')}>
        <div className="flex gap-4 p-4 sm:p-5">
          {visual ?? (
            <span className={cn('grid h-12 w-12 shrink-0 place-items-center rounded-field text-navy', urgent ? 'bg-gold/25' : 'bg-chip')}>
              <Icon className="h-5 w-5" aria-hidden="true" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
              <div className="min-w-0">
                <p className="text-[15px] font-semibold leading-5 text-navy [overflow-wrap:anywhere]">{title}</p>
                {meta && <p className="mt-1 text-[13px] leading-[18px] text-meta [overflow-wrap:anywhere]">{meta}</p>}
              </div>
              {status}
            </div>
            {body && <p className="mt-3 line-clamp-3 border-l-2 border-rule pl-3 text-[15px] leading-6 text-ink">{body}</p>}
            {note}
            {children && <div className="mt-4 flex flex-wrap gap-2">{children}</div>}
          </div>
        </div>
      </CardShell>
    </li>
  );
}

/** The company, linked to its page when it has one. */
function CompanyLink({ org }: { org: OrgRef }) {
  const name = displayCase(org.name) || org.name;
  if (!org.slug) return <span>{name}</span>;
  return (
    <Link
      to={`/organizations/${org.slug}`}
      className="rounded-sm text-navy underline decoration-navy/30 underline-offset-[3px] transition-colors hover:decoration-gold focus:outline-none focus-visible:shadow-focus"
    >
      {name}
    </Link>
  );
}

function PartnerRequestCard({ item, acting, onRespond }: { item: PartnerItem; acting: boolean; onRespond: InboxItemCardProps['onPartnerResponse'] }) {
  const { data, direction, person, org, answeredBy } = item;
  const received = direction === 'received';
  const pending = data.status === 'pending';
  const date = shortDate(data.created_at);
  const answeredOn = shortDate(data.answered_at);

  // Who it is: on a received request the person who sent it (photo, else their
  // company's logo, else initials); on a sent one the company I asked.
  const personName = person?.name || '';
  const visual = received && person?.avatar_url ? (
    <img src={person.avatar_url} alt="" className="h-12 w-12 shrink-0 rounded-pill object-cover ring-1 ring-rule" />
  ) : org ? (
    <LogoTile src={org.logo_url} name={displayCase(org.name) || org.name} type={org.organization_type} size={48} />
  ) : undefined;

  const title = received ? (
    <>
      {personName || (org ? <CompanyLink org={org} /> : 'A member')}
      {personName && org && (
        <span className="font-normal text-meta">
          {' · '}
          <CompanyLink org={org} />
        </span>
      )}
    </>
  ) : (
    <>
      <span className="font-normal text-meta">Request to </span>
      {org ? <CompanyLink org={org} /> : 'a company'}
    </>
  );

  const meta = [
    received ? person?.job_title : null,
    received ? 'Connection request' : 'Sent',
    date,
  ].filter(Boolean).join(' · ');

  // After the answer: who answered (for the colleagues), and the e-mail introduction.
  let note: ReactNode = null;
  if (data.status === 'accepted' || data.status === 'rejected') {
    const verb = data.status === 'accepted' ? 'Accepted' : 'Declined';
    const by = received && answeredBy ? ` by ${answeredBy}` : '';
    const on = answeredOn ? ` on ${answeredOn}` : '';
    note = (
      <div className="mt-3 space-y-2">
        {received && (by || on) && <p className="text-[13px] leading-[18px] text-meta">{verb}{by}{on}.</p>}
        {data.status === 'accepted' && (
          <p className="flex items-start gap-2 rounded-field bg-foam px-3 py-2.5 text-[14px] leading-5 text-teal-text">
            <MailCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              {received
                ? <>M3 introduced {personName || 'the sender'} and {answeredBy === 'you' ? 'you' : answeredBy || 'your team'} by e-mail ("Introduction — Smart Marina Connect"): reply to it to continue the conversation.</>
                : <>{org ? displayCase(org.name) : 'The company'} accepted. M3 introduced you by e-mail ("Introduction — Smart Marina Connect"): reply to it to continue the conversation.</>}
            </span>
          </p>
        )}
      </div>
    );
  }

  return (
    <InboxRow
      icon={Link2}
      visual={visual}
      urgent={received && pending}
      title={title}
      meta={meta}
      status={<PartnerStatusBadge status={data.status} />}
      body={data.message}
      note={note}
    >
      {received && pending && (
        <>
          <Button size="sm" className={cn(BTN, 'gap-1.5')} onClick={() => onRespond(item, 'accepted')} disabled={acting}>
            <Check className="h-4 w-4" aria-hidden="true" /> Accept
          </Button>
          <Button size="sm" variant="outline" className={cn(BTN_OUTLINE, 'gap-1.5')} onClick={() => onRespond(item, 'rejected')} disabled={acting}>
            <X className="h-4 w-4" aria-hidden="true" /> Decline
          </Button>
        </>
      )}
    </InboxRow>
  );
}

function InboxItemCard({ item, acting, onPartnerResponse, onJoinResponse, onResendInvitation, onCancelInvitation }: InboxItemCardProps) {
  const date = shortDate(item.created_at);

  // Partner request
  if (item.kind === 'partner_request') {
    return <PartnerRequestCard item={item} acting={acting} onRespond={onPartnerResponse} />;
  }

  // Recommendation request
  if (item.kind === 'reference_request') {
    const { data } = item;
    return (
      <InboxRow
        icon={Award}
        title={`Recommendation sent to ${data.client_legal_name}`}
        meta={[data.project_name, date].filter(Boolean).join(' · ')}
        status={<ReferenceStatusBadge status={data.status} />}
      >
        <UnderlineLink to="/account?tab=references" className="!text-[14px] !leading-5">
          Manage recommendations
        </UnderlineLink>
      </InboxRow>
    );
  }

  // Join request
  if (item.kind === 'join_request') {
    const { data } = item;
    const displayName = `${data.first_name ?? ''} ${data.last_name ?? ''}`.trim() || data.email;
    return (
      <InboxRow
        icon={Users}
        urgent
        title={`Join request from ${displayName}`}
        meta={[data.email, `wants to join ${data.organization_name}`, date].filter(Boolean).join(' · ')}
        status={<StatusPill tone="warning">Action needed</StatusPill>}
      >
        <Button size="sm" className={cn(BTN, 'gap-1.5')} onClick={() => onJoinResponse(item, true)} disabled={acting}>
          <Check className="h-4 w-4" aria-hidden="true" /> Approve
        </Button>
        <Button size="sm" variant="outline" className={cn(BTN_OUTLINE, 'gap-1.5')} onClick={() => onJoinResponse(item, false)} disabled={acting}>
          <X className="h-4 w-4" aria-hidden="true" /> Decline
        </Button>
      </InboxRow>
    );
  }

  // Team invitation sent
  if (item.kind === 'team_invitation') {
    const { data } = item;
    return (
      <InboxRow
        icon={Mail}
        title={`Team invitation to ${data.email}`}
        meta={date}
        status={<TeamInvitationStatusBadge status={data.status} />}
      >
        {data.status === 'pending' && (
          <>
            <Button size="sm" variant="outline" className={cn(BTN_OUTLINE, 'gap-1.5')} onClick={() => onResendInvitation(item)} disabled={acting}>
              <MailCheck className="h-4 w-4" aria-hidden="true" /> Resend
            </Button>
            <Button size="sm" variant="outline" className={cn(BTN_OUTLINE, 'gap-1.5')} onClick={() => onCancelInvitation(item)} disabled={acting}>
              <X className="h-4 w-4" aria-hidden="true" /> Cancel
            </Button>
          </>
        )}
      </InboxRow>
    );
  }

  return null;
}

// State pills in the kit's colours: amber while it waits, green once accepted,
// grey for every closed state (no red: a declined request is not an error).
function PartnerStatusBadge({ status }: { status: PartnerStatus }) {
  if (status === 'pending') return <StatusPill tone="warning" icon={Clock}>Pending</StatusPill>;
  if (status === 'accepted') return <StatusPill tone="success" icon={CheckCircle}>Accepted</StatusPill>;
  if (status === 'withdrawn') return <StatusPill tone="neutral" icon={Undo2}>Withdrawn</StatusPill>;
  return <StatusPill tone="neutral" icon={X}>Declined</StatusPill>;
}

function ReferenceStatusBadge({ status }: { status: ReferenceData['status'] }) {
  switch (status) {
    case 'confirmed':
      return <StatusPill tone="success" icon={CheckCircle}>Confirmed</StatusPill>;
    case 'rejected':
      return <StatusPill tone="neutral" icon={X}>Declined</StatusPill>;
    case 'expired':
      return <StatusPill tone="neutral">Expired</StatusPill>;
    case 'sent':
      return <StatusPill tone="info" icon={Mail}>Sent</StatusPill>;
    default:
      return <StatusPill tone="warning" icon={Clock}>Pending</StatusPill>;
  }
}

function TeamInvitationStatusBadge({ status }: { status: TeamInvitationData['status'] }) {
  switch (status) {
    case 'accepted':
      return <StatusPill tone="success" icon={CheckCircle}>Accepted</StatusPill>;
    case 'rejected':
      return <StatusPill tone="neutral">Declined</StatusPill>;
    case 'expired':
      return <StatusPill tone="neutral">Expired</StatusPill>;
    case 'cancelled':
      return <StatusPill tone="neutral">Cancelled</StatusPill>;
    default:
      return <StatusPill tone="warning" icon={Clock}>Pending</StatusPill>;
  }
}
