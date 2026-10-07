import { useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { requireFreshSession } from '@/lib/session';
import { toast } from '@/hooks/use-toast';
import { sendNotification } from '@/lib/notifications';
import { CardShell } from '@/components/brand/CardShell';
import { UnderlineLink } from '@/components/brand/UnderlineLink';
import { BTN, BTN_OUTLINE, MemberEmpty, MemberPanel, RowSkeleton, StatusPill } from '@/components/member/MemberUI';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';
import {
  Inbox, Link2, Award, Users, Check, X, Clock, MailCheck, MailX,
  CheckCircle, Mail, RefreshCw, ExternalLink,
} from 'lucide-react';

type FilterCategory = 'all' | 'b2b' | 'recommendations' | 'team';

interface PartnerRequestData {
  id: string;
  partner_user_id: string;
  marina_user_id: string;
  partner_organization_id: string | null;
  marina_organization_id: string | null;
  message: string | null;
  status: 'pending' | 'accepted' | 'rejected';
  created_at: string;
  partner_org_name?: string | null;
  marina_org_name?: string | null;
}

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

type InboxItem =
  | { kind: 'partner_request'; category: 'b2b'; created_at: string; data: PartnerRequestData; direction: 'received' | 'sent' }
  | { kind: 'reference_request'; category: 'recommendations'; created_at: string; data: ReferenceData }
  | { kind: 'join_request'; category: 'team'; created_at: string; data: JoinRequestData }
  | { kind: 'team_invitation'; category: 'team'; created_at: string; data: TeamInvitationData };

const FILTERS: { value: FilterCategory; label: string; icon: React.ReactNode }[] = [
  { value: 'all', label: 'All', icon: <Inbox className="h-4 w-4" /> },
  { value: 'b2b', label: 'B2B connections', icon: <Link2 className="h-4 w-4" /> },
  { value: 'recommendations', label: 'Recommendations', icon: <Award className="h-4 w-4" /> },
  { value: 'team', label: 'Team & invitations', icon: <Users className="h-4 w-4" /> },
];

export function InboxTab() {
  const { user, profile, organization, orgRole } = useAuth();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [items, setItems] = useState<InboxItem[]>([]);
  const [filter, setFilter] = useState<FilterCategory>('all');
  const [actingOn, setActingOn] = useState<string | null>(null);

  const isOwner = orgRole === 'owner';

  const load = useCallback(async (showSpinner = true) => {
    if (!user) return;
    if (showSpinner) setLoading(true);
    else setRefreshing(true);

    const collected: InboxItem[] = [];

    // 1) Partner requests (in/out)
    const { data: prRows } = await supabase
      .from('partner_requests')
      .select(`
        id, partner_user_id, marina_user_id, partner_organization_id, marina_organization_id,
        message, status, created_at,
        partner_org:organizations!partner_requests_partner_organization_id_fkey (name),
        marina_org:organizations!partner_requests_marina_organization_id_fkey (name)
      `)
      .or(`partner_user_id.eq.${user.id},marina_user_id.eq.${user.id}`)
      .order('created_at', { ascending: false });

    type PRRow = PartnerRequestData & {
      partner_org: { name: string } | null;
      marina_org: { name: string } | null;
    };
    (prRows as unknown as PRRow[] | null)?.forEach((r) => {
      collected.push({
        kind: 'partner_request',
        category: 'b2b',
        created_at: r.created_at,
        direction: r.partner_user_id === user.id ? 'sent' : 'received',
        data: {
          ...r,
          partner_org_name: r.partner_org?.name ?? null,
          marina_org_name: r.marina_org?.name ?? null,
        },
      });
    });

    // 2) Recommendation requests (only for partners — those who SEND them)
    if (organization?.id) {
      const { data: refRows } = await supabase
        .from('reference_requests')
        .select('id, reference_id, client_legal_name, project_name, status, created_at, confirmed_at')
        .eq('partner_organization_id', organization.id)
        .order('created_at', { ascending: false });
      (refRows as ReferenceData[] | null)?.forEach((r) => {
        collected.push({
          kind: 'reference_request',
          category: 'recommendations',
          created_at: r.created_at,
          data: r,
        });
      });
    }

    // 3) Join requests received (only for org owners — when someone with a matching domain wants in)
    if (isOwner && organization?.id) {
      const { data: jrRows } = await supabase
        .from('organization_invitations')
        .select('id, email, first_name, last_name, organization_id, created_at')
        .eq('organization_id', organization.id)
        .eq('status', 'join_requested');
      (jrRows as Omit<JoinRequestData, 'organization_name'>[] | null)?.forEach((r) => {
        collected.push({
          kind: 'join_request',
          category: 'team',
          created_at: r.created_at,
          data: { ...r, organization_name: organization.name },
        });
      });
    }

    // 4) Team invitations sent by user (any pending/accepted/rejected outgoing)
    const { data: tiRows } = await supabase
      .from('organization_invitations')
      .select('id, email, first_name, last_name, organization_id, status, created_at, expires_at')
      .eq('invited_by_user_id', user.id)
      .in('status', ['pending', 'accepted', 'rejected', 'expired', 'cancelled']);
    (tiRows as Omit<TeamInvitationData, 'organization_name'>[] | null)?.forEach((r) => {
      collected.push({
        kind: 'team_invitation',
        category: 'team',
        created_at: r.created_at,
        data: { ...r, organization_name: organization?.name ?? '' },
      });
    });

    // Sort all by created_at desc
    collected.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    setItems(collected);
    setLoading(false);
    setRefreshing(false);
  }, [user, organization, isOwner]);

  useEffect(() => {
    load(true);
  }, [load]);

  const filtered = useMemo(() => {
    if (filter === 'all') return items;
    return items.filter((i) => i.category === filter);
  }, [items, filter]);

  // Pending count per category (drives the unread-style badges)
  const pendingByCategory = useMemo(() => {
    const counts: Record<FilterCategory, number> = { all: 0, b2b: 0, recommendations: 0, team: 0 };
    for (const it of items) {
      const isPending =
        (it.kind === 'partner_request' && it.direction === 'received' && it.data.status === 'pending') ||
        (it.kind === 'join_request');
      if (isPending) {
        counts.all += 1;
        counts[it.category] += 1;
      }
    }
    return counts;
  }, [items]);

  // Action handlers
  const handlePartnerResponse = async (item: InboxItem & { kind: 'partner_request' }, newStatus: 'accepted' | 'rejected') => {
    const uid = await requireFreshSession();
    if (!uid) return;
    setActingOn(item.data.id);
    const { error } = await supabase
      .from('partner_requests')
      .update({ status: newStatus })
      .eq('id', item.data.id);
    if (error) {
      toast({ title: 'Failed', description: error.message, variant: 'destructive' });
      setActingOn(null);
      return;
    }
    setItems((prev) => prev.map((i) =>
      i === item ? { ...item, data: { ...item.data, status: newStatus } } : i
    ));

    // Fire-and-forget notification
    const marinaName = organization?.name || profile?.first_name || 'A marina';
    if (newStatus === 'accepted') {
      sendNotification({
        type: 'partner_request_accepted',
        userId: item.data.partner_user_id,
        data: {
          marina_name: marinaName,
          acceptor_email: user?.email || '',
          acceptor_name: `${profile?.first_name || ''} ${profile?.last_name || ''}`.trim() || marinaName,
        },
      });
    } else {
      sendNotification({
        type: 'partner_request_rejected',
        userId: item.data.partner_user_id,
        data: { marina_name: marinaName },
      });
    }
    toast({ title: newStatus === 'accepted' ? 'Request accepted' : 'Request rejected' });
    setActingOn(null);
  };

  const handleJoinResponse = async (item: InboxItem & { kind: 'join_request' }, approve: boolean) => {
    const uid = await requireFreshSession();
    if (!uid) return;
    setActingOn(item.data.id);
    const rpc = approve ? 'approve_join_request' : 'reject_join_request';
    const { error } = await supabase.rpc(rpc, { p_invitation_id: item.data.id });
    if (error) {
      toast({ title: 'Failed', description: error.message, variant: 'destructive' });
    } else {
      // Remove the item from the inbox view
      setItems((prev) => prev.filter((i) => !(i.kind === 'join_request' && i.data.id === item.data.id)));
      toast({ title: approve ? 'Join request approved' : 'Join request rejected' });
    }
    setActingOn(null);
  };

  const handleResendInvitation = async (item: InboxItem & { kind: 'team_invitation' }) => {
    if (!organization) return;
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
                      <span className="sr-only"> pending</span>
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
  onPartnerResponse: (item: InboxItem & { kind: 'partner_request' }, status: 'accepted' | 'rejected') => void;
  onJoinResponse: (item: InboxItem & { kind: 'join_request' }, approve: boolean) => void;
  onResendInvitation: (item: InboxItem & { kind: 'team_invitation' }) => void;
  onCancelInvitation: (item: InboxItem & { kind: 'team_invitation' }) => void;
}

/** One request: icon tile, title and meta line, a state pill, the answer buttons. */
function InboxRow({
  icon: Icon,
  urgent = false,
  title,
  meta,
  status,
  body,
  children,
}: {
  icon: LucideIcon;
  urgent?: boolean;
  title: ReactNode;
  meta?: ReactNode;
  status: ReactNode;
  body?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <li>
      <CardShell>
        <div className="flex gap-4 p-4 sm:p-5">
          <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-xl text-navy', urgent ? 'bg-gold/25' : 'bg-chip')}>
            <Icon className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
              <div className="min-w-0">
                <p className="text-[15px] font-semibold leading-5 text-navy [overflow-wrap:anywhere]">{title}</p>
                {meta && <p className="mt-1 text-[13px] leading-[18px] text-meta [overflow-wrap:anywhere]">{meta}</p>}
              </div>
              {status}
            </div>
            {body && <p className="mt-2 line-clamp-3 text-[15px] leading-6 text-meta">{body}</p>}
            {children && <div className="mt-4 flex flex-wrap gap-2">{children}</div>}
          </div>
        </div>
      </CardShell>
    </li>
  );
}

const DENY = 'text-red-700 hover:border-red-300 hover:bg-red-50 hover:text-red-800';

function InboxItemCard({ item, acting, onPartnerResponse, onJoinResponse, onResendInvitation, onCancelInvitation }: InboxItemCardProps) {
  const created = new Date(item.created_at);
  // A request without a readable date shows no date rather than "Invalid Date".
  const date = Number.isNaN(created.getTime()) ? '' : created.toLocaleDateString();

  // Partner request
  if (item.kind === 'partner_request') {
    const { data, direction } = item;
    const isReceived = direction === 'received';
    const isPending = data.status === 'pending';
    const counterpartName = isReceived ? data.partner_org_name : data.marina_org_name;
    return (
      <InboxRow
        icon={Link2}
        urgent={isReceived && isPending}
        title={(
          <>
            {isReceived ? 'B2B request' : 'B2B request sent'}
            {counterpartName && <span className="font-normal text-meta"> · {counterpartName}</span>}
          </>
        )}
        meta={date}
        status={<PartnerStatusBadge status={data.status} />}
        body={data.message}
      >
        {isReceived && isPending && (
          <>
            <Button size="sm" className={cn(BTN, 'gap-1.5')} onClick={() => onPartnerResponse(item, 'accepted')} disabled={acting}>
              <Check className="h-4 w-4" aria-hidden="true" /> Accept
            </Button>
            <Button size="sm" variant="outline" className={cn(BTN_OUTLINE, DENY, 'gap-1.5')} onClick={() => onPartnerResponse(item, 'rejected')} disabled={acting}>
              <X className="h-4 w-4" aria-hidden="true" /> Reject
            </Button>
          </>
        )}
      </InboxRow>
    );
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
        <Button size="sm" variant="outline" className={cn(BTN_OUTLINE, DENY, 'gap-1.5')} onClick={() => onJoinResponse(item, false)} disabled={acting}>
          <X className="h-4 w-4" aria-hidden="true" /> Reject
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
            <Button size="sm" variant="outline" className={cn(BTN_OUTLINE, DENY, 'gap-1.5')} onClick={() => onCancelInvitation(item)} disabled={acting}>
              <X className="h-4 w-4" aria-hidden="true" /> Cancel
            </Button>
          </>
        )}
      </InboxRow>
    );
  }

  return null;
}

function PartnerStatusBadge({ status }: { status: 'pending' | 'accepted' | 'rejected' }) {
  if (status === 'pending') return <StatusPill tone="warning" icon={Clock}>Pending</StatusPill>;
  if (status === 'accepted') return <StatusPill tone="success" icon={CheckCircle}>Accepted</StatusPill>;
  return <StatusPill tone="danger" icon={X}>Rejected</StatusPill>;
}

function ReferenceStatusBadge({ status }: { status: ReferenceData['status'] }) {
  switch (status) {
    case 'confirmed':
      return <StatusPill tone="success" icon={CheckCircle}>Confirmed</StatusPill>;
    case 'rejected':
      return <StatusPill tone="danger" icon={MailX}>Declined</StatusPill>;
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
      return <StatusPill tone="danger">Declined</StatusPill>;
    case 'expired':
      return <StatusPill tone="neutral">Expired</StatusPill>;
    case 'cancelled':
      return <StatusPill tone="neutral">Cancelled</StatusPill>;
    default:
      return <StatusPill tone="warning" icon={Clock}>Pending</StatusPill>;
  }
}
