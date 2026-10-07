import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { sendNotification } from '@/lib/notifications';
import { checkSectorMatch } from '@/lib/sector-matching';
import { requireFreshSession } from '@/lib/session';
import {
  Building2, Anchor, Newspaper, ChevronLeft, Link2, Loader2,
  Users, Mail, Briefcase, CheckCircle, MapPin, ArrowRight,
} from 'lucide-react';
import { CardShell } from '@/components/brand/CardShell';
import { BTN, BTN_OUTLINE, BackLink, BandPill, MemberEmpty, MemberHeader, MemberPanel, ROW_FOCUS, RowSkeleton } from '@/components/member/MemberUI';
import { cn } from '@/lib/utils';

interface UserProfile {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  persona: string;
  job_title: string | null;
  avatar_url: string | null;
  access_status: string;
}

interface UserOrg {
  id: string;
  name: string;
  slug: string;
  organization_type: string;
  logo_url: string | null;
  city: string | null;
  country: string | null;
}

export function UserProfilePage() {
  const { id } = useParams<{ id: string }>();
  const { user, isVerified, organization } = useAuth();
  const [profileData, setProfileData] = useState<UserProfile | null>(null);
  const [userOrg, setUserOrg] = useState<UserOrg | null>(null);
  const [orgRole, setOrgRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Connect request state
  const [connectOpen, setConnectOpen] = useState(false);
  const [connectMessage, setConnectMessage] = useState('');
  const [connectSending, setConnectSending] = useState(false);
  const [hasExistingRequest, setHasExistingRequest] = useState(false);

  useEffect(() => {
    if (!id) return;
    const fetchProfile = async () => {
      setLoading(true);

      // Fetch profile via public RPC (limited columns, verified only)
      const { data: pRows } = await supabase
        .rpc('get_public_profile', { target_user_id: id });
      const pData = pRows && pRows.length > 0 ? pRows[0] : null;

      if (!pData) {
        setLoading(false);
        return;
      }

      setProfileData(pData as UserProfile);

      // Fetch org membership
      const { data: membership } = await supabase
        .from('organization_members')
        .select('organization_id, role')
        .eq('user_id', id)
        .maybeSingle();

      if (membership) {
        setOrgRole(membership.role);
        const { data: orgData } = await supabase
          .from('organizations')
          .select('id, name, slug, organization_type, logo_url, city, country')
          .eq('id', membership.organization_id)
          .single();
        if (orgData) setUserOrg(orgData as UserOrg);
      }

      // Record profile view (only if logged in and viewing someone else)
      if (user && user.id !== id) {
        await supabase.from('profile_views').insert({
          viewed_user_id: id,
          viewer_user_id: user.id,
        });
      }

      // Check existing connect request
      if (user && user.id !== id) {
        const { data: existing } = await supabase
          .from('partner_requests')
          .select('id')
          .eq('partner_user_id', user.id)
          .eq('marina_user_id', id)
          .in('status', ['pending', 'accepted'])
          .maybeSingle();
        setHasExistingRequest(!!existing);
      }

      setLoading(false);
    };
    fetchProfile();
  }, [id, user]);

  const handleSendConnectRequest = async () => {
    if (!user || !id) return;
    const uid = await requireFreshSession();
    if (!uid) return;
    setConnectSending(true);
    try {
      // Sector matching gate (only relevant for cross-type connections marina↔partner)
      if (organization?.id && userOrg?.id) {
        const match = await checkSectorMatch(organization.id, userOrg.id);
        if (!match.allowed) {
          toast({
            title: 'Connection blocked',
            description: match.reason || 'No overlapping sectors with this user\u2019s organization.',
            variant: 'destructive',
          });
          setConnectSending(false);
          return;
        }
      }
      const { error } = await supabase.from('partner_requests').insert({
        partner_user_id: user.id,
        marina_user_id: id,
        message: connectMessage.trim() || null,
        sector_id: null,
        status: 'pending',
      });
      if (error) throw error;
      // partner_name = REQUESTER's organization (who is reaching out), not the recipient.
      const requesterOrgName = organization?.name || 'A partner';
      sendNotification({ type: 'partner_request_received', userId: id, data: { partner_name: requesterOrgName, message: connectMessage.trim() } });
      toast({ title: 'Connection request sent!' });
      setConnectOpen(false);
      setConnectMessage('');
      setHasExistingRequest(true);
    } catch (err: unknown) {
      toast({ title: 'Error', description: err instanceof Error ? err.message : 'An unexpected error occurred.', variant: 'destructive' });
    }
    setConnectSending(false);
  };

  const getPersonaIcon = (persona: string) => {
    switch (persona) {
      case 'marina': return <Anchor className="h-4 w-4" />;
      case 'partner': return <Building2 className="h-4 w-4" />;
      case 'media_partner': return <Newspaper className="h-4 w-4" />;
      default: return <Users className="h-4 w-4" />;
    }
  };

  const getPersonaLabel = (persona: string) => {
    switch (persona) {
      case 'marina': return 'Marina / Port';
      case 'partner': return 'Service provider';
      case 'media_partner': return 'Media';
      case 'moderator': return 'Moderator';
      case 'admin': return 'Administrator';
      default: return '';
    }
  };

  if (loading) {
    return <div className="min-h-screen bg-page"><div className="mx-auto max-w-3xl px-4 py-16"><CardShell><RowSkeleton rows={3} /></CardShell></div></div>;
  }

  if (!profileData) {
    return (
      <div className="min-h-screen bg-page">
        <div className="mx-auto max-w-xl px-4 py-16 sm:py-24">
          <CardShell>
            <MemberEmpty
              titleAs="h1"
              icon={Users}
              title="User not found"
              body="This user profile does not exist."
              action={(
                <Button asChild variant="ctaNavy" size="sm">
                  <Link to="/">Go home</Link>
                </Button>
              )}
            />
          </CardShell>
        </div>
      </div>
    );
  }

  const fullName = `${profileData.first_name || ''} ${profileData.last_name || ''}`.trim();
  const displayName = fullName || profileData.email?.split('@')[0] || 'Unknown User';
  const initials = fullName
    ? fullName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
    : displayName.slice(0, 2).toUpperCase();

  const isOwnProfile = user?.id === id;
  const isSameOrg = organization?.id === userOrg?.id;
  const canConnect = user && isVerified && !isOwnProfile && !hasExistingRequest;

  return (
    <div className="min-h-screen bg-page pb-20">
      {/* Band */}
      <MemberHeader
        image={null}
        seed={profileData.user_id}
        icon={Users}
        eyebrow={getPersonaLabel(profileData.persona) || undefined}
        title={displayName}
        back={(
          <BackLink to={userOrg ? `/organizations/${userOrg.slug || userOrg.id}` : '/directory'}>
            {userOrg ? `Back to ${userOrg.name}` : 'Back'}
          </BackLink>
        )}
        leading={(
          <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full border-2 border-white/40 bg-white/10 lg:h-24 lg:w-24">
            {profileData.avatar_url ? (
              <img src={profileData.avatar_url} alt={displayName} className="h-full w-full rounded-full object-cover" />
            ) : (
              <span className="font-signage text-3xl font-semibold text-white/80">{initials}</span>
            )}
          </div>
        )}
        actions={(
          <>
            {canConnect && (
              <Button variant="ctaOnDark" onClick={() => setConnectOpen(true)}>
                Request to connect
              </Button>
            )}
            {hasExistingRequest && (
              <BandPill icon={CheckCircle}>Connection request sent</BandPill>
            )}
          </>
        )}
      >
        {profileData.job_title && (
          <span className="inline-flex items-center gap-1.5">
            <Briefcase className="h-4 w-4" aria-hidden="true" />
            {profileData.job_title}
          </span>
        )}
        <span className="inline-flex items-center gap-1.5">
          {getPersonaIcon(profileData.persona)}
          {getPersonaLabel(profileData.persona)}
        </span>
      </MemberHeader>

      {/* Content */}
      <div className="mx-auto max-w-3xl px-4 pt-8 sm:px-6 md:pt-10">
        <div className="space-y-6">
          {/* Organization Card */}
          {userOrg && (
            <MemberPanel title="Organization">
              <Link to={`/organizations/${userOrg.slug || userOrg.id}`} className={cn('group flex items-center gap-4 p-5 transition-colors hover:bg-page', ROW_FOCUS)}>
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-rule bg-white">
                    {userOrg.logo_url ? (
                      <img src={userOrg.logo_url} alt={userOrg.name} className="h-full w-full rounded-xl object-contain p-1" />
                    ) : (
                      <Building2 className="h-6 w-6 text-navy" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="text-[16px] font-semibold text-navy">
                      <span className="card-ul">{userOrg.name}</span>
                      <ArrowRight className="card-arrow" strokeWidth={2.25} aria-hidden="true" />
                    </div>
                    {(userOrg.city || userOrg.country) && (
                      <div className="mt-0.5 flex items-center gap-1 text-[14px] text-meta">
                        <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                        {[userOrg.city, userOrg.country].filter(Boolean).join(', ')}
                      </div>
                    )}
                  </div>
              </Link>
            </MemberPanel>
          )}

          {/* Contact Info (only if same org or is self) */}
          {(isOwnProfile || isSameOrg) && profileData.email && (
            <MemberPanel title="Contact">
              <div className="flex items-center gap-3 p-5">
                <Mail className="h-4 w-4 text-meta" aria-hidden="true" />
                <span className="break-all text-[15px] text-ink">{profileData.email}</span>
              </div>
            </MemberPanel>
          )}
        </div>
      </div>

      {/* Connect Dialog */}
      <Dialog open={connectOpen} onOpenChange={setConnectOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Request to Connect</DialogTitle>
            <DialogDescription>Send a connection request to {displayName}.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label>Message (optional)</Label>
              <Textarea
                value={connectMessage}
                onChange={(e) => setConnectMessage(e.target.value)}
                placeholder="Introduce yourself..."
                rows={4}
              />
            </div>
            <div className="flex gap-3 justify-end">
              <Button variant="outline" className={BTN_OUTLINE} onClick={() => setConnectOpen(false)}>Cancel</Button>
              <Button className={BTN} onClick={handleSendConnectRequest} disabled={connectSending}>
                {connectSending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Send Request
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
