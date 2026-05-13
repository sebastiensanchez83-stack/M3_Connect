import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { sendNotification } from '@/lib/notifications';
import { LoadingSkeleton } from '@/components/LoadingSkeleton';
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

  if (loading) return <LoadingSkeleton variant="inline" />;

  return (
    <div className="space-y-4">
      {/* Header + filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Inbox className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold text-gray-900">Inbox</h2>
              {pendingByCategory.all > 0 && (
                <Badge className="bg-red-500 text-white border-0 text-[10px]">{pendingByCategory.all} pending</Badge>
              )}
            </div>
            <Button size="sm" variant="ghost" onClick={() => load(false)} disabled={refreshing}>
              <RefreshCw className={`h-3.5 w-3.5 mr-1 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => setFilter(f.value)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  filter === f.value
                    ? 'bg-primary text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {f.icon}
                {f.label}
                {pendingByCategory[f.value] > 0 && (
                  <span className={`ml-1 inline-flex items-center justify-center min-w-[16px] h-4 px-1 text-[10px] font-bold rounded-full ${
                    filter === f.value ? 'bg-white/20' : 'bg-red-500 text-white'
                  }`}>
                    {pendingByCategory[f.value]}
                  </span>
                )}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Items */}
      {filtered.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Inbox className="h-10 w-10 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500">
              {filter === 'all' ? 'Your inbox is empty.' : 'Nothing in this category right now.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
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
        </div>
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

function InboxItemCard({ item, acting, onPartnerResponse, onJoinResponse, onResendInvitation, onCancelInvitation }: InboxItemCardProps) {
  const date = new Date(item.created_at).toLocaleDateString();

  // Partner request
  if (item.kind === 'partner_request') {
    const { data, direction } = item;
    const isReceived = direction === 'received';
    const isPending = data.status === 'pending';
    const counterpartName = isReceived ? data.partner_org_name : data.marina_org_name;
    return (
      <Card>
        <CardContent className="p-4">
          <div className="flex gap-3">
            <div className="shrink-0 mt-0.5">
              <div className="w-9 h-9 rounded-full bg-blue-50 flex items-center justify-center">
                <Link2 className="h-4 w-4 text-blue-500" />
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">
                    {isReceived ? 'B2B request' : 'B2B request sent'}
                    {counterpartName && <span className="text-gray-500"> · {counterpartName}</span>}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">{date}</p>
                </div>
                <PartnerStatusBadge status={data.status} />
              </div>
              {data.message && (
                <p className="mt-2 text-sm text-gray-600 line-clamp-3">{data.message}</p>
              )}
              {isReceived && isPending && (
                <div className="mt-3 flex gap-2">
                  <Button size="sm" onClick={() => onPartnerResponse(item, 'accepted')} disabled={acting}>
                    <Check className="h-3.5 w-3.5 mr-1" /> Accept
                  </Button>
                  <Button size="sm" variant="outline" className="text-red-600 hover:text-red-700" onClick={() => onPartnerResponse(item, 'rejected')} disabled={acting}>
                    <X className="h-3.5 w-3.5 mr-1" /> Reject
                  </Button>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Recommendation request
  if (item.kind === 'reference_request') {
    const { data } = item;
    return (
      <Card>
        <CardContent className="p-4">
          <div className="flex gap-3">
            <div className="shrink-0 mt-0.5">
              <div className="w-9 h-9 rounded-full bg-amber-50 flex items-center justify-center">
                <Award className="h-4 w-4 text-amber-500" />
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">
                    Recommendation sent to {data.client_legal_name}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">{data.project_name} · {date}</p>
                </div>
                <ReferenceStatusBadge status={data.status} />
              </div>
              <div className="mt-2">
                <Link to="/account?tab=references" className="text-xs text-primary hover:underline inline-flex items-center gap-1">
                  Manage recommendations <ExternalLink className="h-3 w-3" />
                </Link>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Join request
  if (item.kind === 'join_request') {
    const { data } = item;
    const displayName = `${data.first_name ?? ''} ${data.last_name ?? ''}`.trim() || data.email;
    return (
      <Card>
        <CardContent className="p-4">
          <div className="flex gap-3">
            <div className="shrink-0 mt-0.5">
              <div className="w-9 h-9 rounded-full bg-cyan-50 flex items-center justify-center">
                <Users className="h-4 w-4 text-cyan-500" />
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">
                    Join request from {displayName}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {data.email} · wants to join {data.organization_name} · {date}
                  </p>
                </div>
                <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-[10px]">Action needed</Badge>
              </div>
              <div className="mt-3 flex gap-2">
                <Button size="sm" onClick={() => onJoinResponse(item, true)} disabled={acting}>
                  <Check className="h-3.5 w-3.5 mr-1" /> Approve
                </Button>
                <Button size="sm" variant="outline" className="text-red-600 hover:text-red-700" onClick={() => onJoinResponse(item, false)} disabled={acting}>
                  <X className="h-3.5 w-3.5 mr-1" /> Reject
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Team invitation sent
  if (item.kind === 'team_invitation') {
    const { data } = item;
    return (
      <Card>
        <CardContent className="p-4">
          <div className="flex gap-3">
            <div className="shrink-0 mt-0.5">
              <div className="w-9 h-9 rounded-full bg-purple-50 flex items-center justify-center">
                <Mail className="h-4 w-4 text-purple-500" />
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">
                    Team invitation to {data.email}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">{date}</p>
                </div>
                <TeamInvitationStatusBadge status={data.status} />
              </div>
              {data.status === 'pending' && (
                <div className="mt-3 flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => onResendInvitation(item)} disabled={acting}>
                    <MailCheck className="h-3.5 w-3.5 mr-1" /> Resend
                  </Button>
                  <Button size="sm" variant="outline" className="text-red-600 hover:text-red-700" onClick={() => onCancelInvitation(item)} disabled={acting}>
                    <X className="h-3.5 w-3.5 mr-1" /> Cancel
                  </Button>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return null;
}

function PartnerStatusBadge({ status }: { status: 'pending' | 'accepted' | 'rejected' }) {
  if (status === 'pending') return <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-[10px]"><Clock className="h-3 w-3 mr-1" />Pending</Badge>;
  if (status === 'accepted') return <Badge className="bg-green-100 text-green-700 border-green-200 text-[10px]"><CheckCircle className="h-3 w-3 mr-1" />Accepted</Badge>;
  return <Badge className="bg-red-100 text-red-700 border-red-200 text-[10px]"><X className="h-3 w-3 mr-1" />Rejected</Badge>;
}

function ReferenceStatusBadge({ status }: { status: ReferenceData['status'] }) {
  switch (status) {
    case 'confirmed':
      return <Badge className="bg-green-100 text-green-700 border-green-200 text-[10px]"><CheckCircle className="h-3 w-3 mr-1" />Confirmed</Badge>;
    case 'rejected':
      return <Badge className="bg-red-100 text-red-700 border-red-200 text-[10px]"><MailX className="h-3 w-3 mr-1" />Declined</Badge>;
    case 'expired':
      return <Badge variant="secondary" className="text-[10px]">Expired</Badge>;
    case 'sent':
      return <Badge className="bg-blue-100 text-blue-700 border-blue-200 text-[10px]"><Mail className="h-3 w-3 mr-1" />Sent</Badge>;
    default:
      return <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-[10px]"><Clock className="h-3 w-3 mr-1" />Pending</Badge>;
  }
}

function TeamInvitationStatusBadge({ status }: { status: TeamInvitationData['status'] }) {
  switch (status) {
    case 'accepted':
      return <Badge className="bg-green-100 text-green-700 border-green-200 text-[10px]"><CheckCircle className="h-3 w-3 mr-1" />Accepted</Badge>;
    case 'rejected':
      return <Badge className="bg-red-100 text-red-700 border-red-200 text-[10px]">Declined</Badge>;
    case 'expired':
      return <Badge variant="secondary" className="text-[10px]">Expired</Badge>;
    case 'cancelled':
      return <Badge variant="outline" className="text-[10px] text-gray-500">Cancelled</Badge>;
    default:
      return <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-[10px]"><Clock className="h-3 w-3 mr-1" />Pending</Badge>;
  }
}
