import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import {
  Building2, Anchor, Newspaper, ChevronLeft, Loader2, Link2,
  Users, Mail, Briefcase, CheckCircle, MapPin,
} from 'lucide-react';

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

      // Fetch profile
      const { data: pData } = await supabase
        .from('profiles')
        .select('user_id, first_name, last_name, email, persona, job_title, avatar_url, access_status')
        .eq('user_id', id)
        .maybeSingle();

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
    setConnectSending(true);
    try {
      const { error } = await supabase.from('partner_requests').insert({
        partner_user_id: user.id,
        marina_user_id: id,
        message: connectMessage.trim(),
        status: 'pending',
      });
      if (error) throw error;
      toast({ title: 'Connection request sent!' });
      setConnectOpen(false);
      setConnectMessage('');
      setHasExistingRequest(true);
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
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
      case 'partner': return 'Partner';
      case 'media_partner': return 'Media Partner';
      case 'moderator': return 'Moderator';
      case 'admin': return 'Administrator';
      default: return '';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary/40" />
      </div>
    );
  }

  if (!profileData) {
    return (
      <div className="container mx-auto px-4 py-16 text-center">
        <Users className="h-12 w-12 mx-auto text-gray-300 mb-4" />
        <h1 className="text-2xl font-bold text-gray-900 mb-2">User not found</h1>
        <p className="text-gray-500 mb-6">This user profile does not exist.</p>
        <Button asChild>
          <Link to="/">
            <ChevronLeft className="h-4 w-4 mr-2" />
            Go Home
          </Link>
        </Button>
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
    <div className="min-h-screen bg-gray-50">
      {/* Hero */}
      <section className="bg-gradient-to-br from-[#1e3a5f] to-[#0d9488] text-white">
        <div className="container mx-auto px-4 py-12">
          <Link to={userOrg ? `/organizations/${userOrg.slug || userOrg.id}` : '/marketplace'} className="inline-flex items-center gap-1 text-white/70 hover:text-white mb-6 text-sm">
            <ChevronLeft className="h-4 w-4" />
            {userOrg ? `Back to ${userOrg.name}` : 'Back'}
          </Link>
          <div className="flex items-center gap-6">
            {/* Avatar */}
            <div className="w-20 h-20 lg:w-24 lg:h-24 rounded-full bg-white/10 flex items-center justify-center shrink-0">
              {profileData.avatar_url ? (
                <img src={profileData.avatar_url} alt={displayName} className="w-full h-full rounded-full object-cover" />
              ) : (
                <span className="text-2xl lg:text-3xl font-bold text-white/70">{initials}</span>
              )}
            </div>
            <div>
              <h1 className="text-3xl lg:text-4xl font-bold mb-1">{displayName}</h1>
              <div className="flex flex-wrap items-center gap-3 text-white/80">
                {profileData.job_title && (
                  <div className="flex items-center gap-1">
                    <Briefcase className="h-4 w-4" />
                    <span>{profileData.job_title}</span>
                  </div>
                )}
                <Badge variant="outline" className="border-white/30 text-white">
                  {getPersonaIcon(profileData.persona)}
                  <span className="ml-1">{getPersonaLabel(profileData.persona)}</span>
                </Badge>
              </div>
              {/* Connect button */}
              {canConnect && (
                <Button
                  className="mt-4 bg-white text-primary hover:bg-white/90"
                  onClick={() => setConnectOpen(true)}
                >
                  <Link2 className="h-4 w-4 mr-2" />
                  Request to Connect
                </Button>
              )}
              {hasExistingRequest && (
                <Badge className="mt-4 bg-white/20 text-white border-white/30">
                  <CheckCircle className="h-3 w-3 mr-1" />
                  Connection Request Sent
                </Badge>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Content */}
      <div className="container mx-auto px-4 py-8 max-w-3xl">
        <div className="space-y-6">
          {/* Organization Card */}
          {userOrg && (
            <Card>
              <CardContent className="pt-6">
                <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Organization</h3>
                <Link to={`/organizations/${userOrg.slug || userOrg.id}`} className="flex items-center gap-4 hover:bg-gray-50 p-3 -m-3 rounded-lg transition-colors">
                  <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    {userOrg.logo_url ? (
                      <img src={userOrg.logo_url} alt={userOrg.name} className="w-full h-full rounded-lg object-cover" />
                    ) : (
                      <Building2 className="h-6 w-6 text-primary" />
                    )}
                  </div>
                  <div>
                    <div className="font-semibold text-gray-900">{userOrg.name}</div>
                    <div className="flex items-center gap-2 text-sm text-gray-500">
                      {(userOrg.city || userOrg.country) && (
                        <span className="flex items-center gap-1">
                          <MapPin className="h-3 w-3" />
                          {[userOrg.city, userOrg.country].filter(Boolean).join(', ')}
                        </span>
                      )}
                    </div>
                  </div>
                </Link>
              </CardContent>
            </Card>
          )}

          {/* Contact Info (only if same org or is self) */}
          {(isOwnProfile || isSameOrg) && profileData.email && (
            <Card>
              <CardContent className="pt-6">
                <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Contact</h3>
                <div className="flex items-center gap-3">
                  <Mail className="h-4 w-4 text-gray-400" />
                  <span className="text-gray-700">{profileData.email}</span>
                </div>
              </CardContent>
            </Card>
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
              <Button variant="outline" onClick={() => setConnectOpen(false)}>Cancel</Button>
              <Button onClick={handleSendConnectRequest} disabled={connectSending}>
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
