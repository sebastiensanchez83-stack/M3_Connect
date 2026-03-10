import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Helmet } from 'react-helmet-async';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Building2, Globe, MapPin, Users, Mail, ChevronLeft,
  Loader2, ExternalLink, Anchor, Newspaper, Ship, Droplets,
  CheckCircle, GraduationCap, Wrench, UtensilsCrossed, Sparkles, Link2,
} from 'lucide-react';
import { Organization, OrganizationMember, OrganizationMarinaDetails, Sector } from '@/types/database';

export function OrganizationPublicPage() {
  const { slug } = useParams<{ slug: string }>();
  const { t } = useTranslation();
  const { user, profile, organization, isVerified } = useAuth();
  const [org, setOrg] = useState<Organization | null>(null);
  const [members, setMembers] = useState<(OrganizationMember & { profiles: { first_name: string | null; last_name: string | null; email: string | null; persona: string; job_title: string | null } })[]>([]);
  const [marinaDetails, setMarinaDetails] = useState<OrganizationMarinaDetails | null>(null);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [futurePlans, setFuturePlans] = useState<{ sector_label: string; timeline: string }[]>([]);
  const [loading, setLoading] = useState(true);

  // Connect request state
  const [connectOpen, setConnectOpen] = useState(false);
  const [connectMessage, setConnectMessage] = useState('');
  const [connectSending, setConnectSending] = useState(false);
  const [hasExistingRequest, setHasExistingRequest] = useState(false);

  useEffect(() => {
    if (!slug) return;
    const fetchOrg = async () => {
      setLoading(true);
      const { data: orgData } = await supabase
        .from('organizations')
        .select('*')
        .eq('slug', slug)
        .single();

      if (orgData) {
        const o = orgData as Organization;
        setOrg(o);

        // Fetch members with job_title
        const { data: membersData } = await supabase
          .from('organization_members')
          .select('id, organization_id, user_id, role, joined_at, profiles(first_name, last_name, email, persona, job_title)')
          .eq('organization_id', o.id)
          .order('joined_at', { ascending: true });

        if (membersData) setMembers(membersData as any);

        // Fetch marina details if marina org
        if (o.organization_type === 'marina') {
          const { data: marinaData } = await supabase
            .from('organization_marina_details')
            .select('*')
            .eq('organization_id', o.id)
            .maybeSingle();
          if (marinaData) setMarinaDetails(marinaData as OrganizationMarinaDetails);
        }

        // Fetch sectors (interest for marinas, service for partners)
        const sectorTable = o.organization_type === 'marina'
          ? 'organization_interest_sectors'
          : o.organization_type === 'partner'
          ? 'organization_service_sectors'
          : null;

        if (sectorTable) {
          const { data: sectorLinks } = await supabase
            .from(sectorTable)
            .select('sector_id, sectors(id, slug, label, is_active, created_at)')
            .eq('organization_id', o.id);

          if (sectorLinks) {
            setSectors(
              (sectorLinks as any[])
                .filter((sl: any) => sl.sectors)
                .map((sl: any) => sl.sectors as Sector)
            );
          }
        }

        // Fetch future plans for marinas
        if (o.organization_type === 'marina') {
          const { data: plansData } = await supabase
            .from('organization_future_plans')
            .select('sector_id, timeline, sectors(label)')
            .eq('organization_id', o.id);

          if (plansData && plansData.length > 0) {
            setFuturePlans(
              (plansData as any[])
                .filter((p: any) => p.sectors)
                .map((p: any) => ({ sector_label: p.sectors.label, timeline: p.timeline }))
                .sort((a: any, b: any) => a.sector_label.localeCompare(b.sector_label))
            );
          }
        }
      }
      setLoading(false);
    };
    fetchOrg();
  }, [slug]);

  // Check for existing connect request when user or org changes
  useEffect(() => {
    if (!user || !org) return;
    const checkExisting = async () => {
      const { data } = await supabase
        .from('partner_requests')
        .select('id')
        .eq('partner_user_id', user.id)
        .eq('marina_user_id', org.owner_user_id!)
        .in('status', ['pending', 'accepted'])
        .maybeSingle();
      setHasExistingRequest(!!data);
    };
    checkExisting();
  }, [user, org]);

  const handleSendConnectRequest = async () => {
    if (!user || !org) return;
    setConnectSending(true);
    try {
      const { error } = await supabase.from('partner_requests').insert({
        partner_user_id: user.id,
        marina_user_id: org.owner_user_id,
        message: connectMessage.trim(),
        status: 'pending',
      });
      if (error) throw error;
      toast({ title: 'Connection request sent!', description: `Your request has been sent to ${org.name}.` });
      setConnectOpen(false);
      setConnectMessage('');
      setHasExistingRequest(true);
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
    setConnectSending(false);
  };

  const isMemberOfThisOrg = organization?.id === org?.id;
  const canConnect = user && isVerified && !isMemberOfThisOrg && !hasExistingRequest;

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
      case 'partner': return t('auth.personaPartner');
      case 'media_partner': return t('auth.personaMedia');
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

  if (!org) {
    return (
      <div className="container mx-auto px-4 py-16 text-center">
        <Building2 className="h-12 w-12 mx-auto text-gray-300 mb-4" />
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Organization not found</h1>
        <p className="text-gray-500 mb-6">This organization does not exist or has been removed.</p>
        <Button asChild>
          <Link to="/">
            <ChevronLeft className="h-4 w-4 mr-2" />
            {t('common.goHome')}
          </Link>
        </Button>
      </div>
    );
  }

  const orgTypeLabel = org.organization_type ? getPersonaLabel(org.organization_type) : '';

  return (
    <div className="min-h-screen bg-gray-50">
      <Helmet>
        <title>{org.name} — M3 Connect</title>
        <meta name="description" content={org.description || `${org.name} on M3 Connect — B2B platform for the marina industry.`} />
        <meta property="og:title" content={`${org.name} — M3 Connect`} />
        <meta property="og:description" content={org.description || ''} />
      </Helmet>

      {/* Hero Header */}
      <section className="bg-gradient-to-br from-[#1e3a5f] to-[#0d9488] text-white">
        <div className="container mx-auto px-4 py-12 lg:py-16">
          <Link to="/partners" className="inline-flex items-center gap-1 text-white/70 hover:text-white mb-6 text-sm">
            <ChevronLeft className="h-4 w-4" />
            {t('home.viewAllPartners')}
          </Link>
          <div className="flex items-start gap-6">
            {/* Org Avatar */}
            <div className="w-20 h-20 lg:w-24 lg:h-24 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
              {org.logo_url ? (
                <img src={org.logo_url} alt={org.name} className="w-full h-full rounded-xl object-cover" />
              ) : (
                <Building2 className="h-10 w-10 lg:h-12 lg:w-12 text-white/70" />
              )}
            </div>
            <div>
              <h1 className="text-3xl lg:text-4xl font-bold mb-2">{org.name}</h1>
              <div className="flex flex-wrap items-center gap-3 text-white/80">
                {orgTypeLabel && (
                  <Badge variant="outline" className="border-white/30 text-white">
                    {orgTypeLabel}
                  </Badge>
                )}
                {(org.city || org.country) && (
                  <div className="flex items-center gap-1">
                    <MapPin className="h-4 w-4" />
                    <span>{[org.city, org.country].filter(Boolean).join(', ')}</span>
                  </div>
                )}
                {org.website && (
                  <a
                    href={org.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 hover:text-white"
                  >
                    <Globe className="h-4 w-4" />
                    <span>{org.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}</span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
                <div className="flex items-center gap-1">
                  <Users className="h-4 w-4" />
                  <span>{members.length} {t('org.members').toLowerCase()}</span>
                </div>
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
      <div className="container mx-auto px-4 py-8 lg:py-12">
        <Tabs defaultValue="about" className="max-w-4xl mx-auto">
          <TabsList className="mb-8">
            <TabsTrigger value="about">About</TabsTrigger>
            {org.organization_type === 'marina' && marinaDetails && (
              <TabsTrigger value="marina">Marina Details</TabsTrigger>
            )}
            <TabsTrigger value="representatives">Representatives</TabsTrigger>
          </TabsList>

          {/* About Tab */}
          <TabsContent value="about">
            <div className="space-y-6">
              {org.description && (
                <Card>
                  <CardContent className="pt-6">
                    <h2 className="text-lg font-semibold text-gray-900 mb-3">{t('org.description')}</h2>
                    <p className="text-gray-600 leading-relaxed whitespace-pre-wrap">{org.description}</p>
                  </CardContent>
                </Card>
              )}

              {/* Audience description for media orgs */}
              {org.audience_description && (
                <Card>
                  <CardContent className="pt-6">
                    <h2 className="text-lg font-semibold text-gray-900 mb-3">Audience</h2>
                    <p className="text-gray-600 leading-relaxed whitespace-pre-wrap">{org.audience_description}</p>
                  </CardContent>
                </Card>
              )}

              {/* Sectors */}
              {sectors.length > 0 && (
                <Card>
                  <CardContent className="pt-6">
                    <h2 className="text-lg font-semibold text-gray-900 mb-3">
                      {org.organization_type === 'marina' ? 'Sectors of Interest' : 'Service Sectors'}
                    </h2>
                    <div className="flex flex-wrap gap-2">
                      {sectors.map((s) => (
                        <Badge key={s.id} variant="secondary" className="text-sm py-1 px-3">
                          {s.label}
                        </Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Organization details */}
              <Card>
                <CardContent className="pt-6">
                  <h2 className="text-lg font-semibold text-gray-900 mb-4">Details</h2>
                  <div className="grid sm:grid-cols-2 gap-4">
                    {orgTypeLabel && (
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                          {org.organization_type ? getPersonaIcon(org.organization_type) : <Building2 className="h-5 w-5" />}
                        </div>
                        <div>
                          <div className="text-xs text-gray-500 uppercase tracking-wide">Type</div>
                          <div className="font-medium text-gray-900">{orgTypeLabel}</div>
                        </div>
                      </div>
                    )}
                    {(org.city || org.country) && (
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                          <MapPin className="h-5 w-5" />
                        </div>
                        <div>
                          <div className="text-xs text-gray-500 uppercase tracking-wide">Location</div>
                          <div className="font-medium text-gray-900">{[org.city, org.country].filter(Boolean).join(', ')}</div>
                        </div>
                      </div>
                    )}
                    {org.headquarters_country && (
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                          <MapPin className="h-5 w-5" />
                        </div>
                        <div>
                          <div className="text-xs text-gray-500 uppercase tracking-wide">Headquarters</div>
                          <div className="font-medium text-gray-900">{org.headquarters_country}</div>
                        </div>
                      </div>
                    )}
                    {org.website && (
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                          <Globe className="h-5 w-5" />
                        </div>
                        <div>
                          <div className="text-xs text-gray-500 uppercase tracking-wide">{t('org.website')}</div>
                          <a href={org.website} target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline">
                            {org.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                          </a>
                        </div>
                      </div>
                    )}
                    {/* Primary domain removed from public display */}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Marina Details Tab */}
          {org.organization_type === 'marina' && marinaDetails && (
            <TabsContent value="marina">
              <div className="space-y-6">
                {/* Key Figures */}
                <Card>
                  <CardContent className="pt-6">
                    <h2 className="text-lg font-semibold text-gray-900 mb-4">Key Figures</h2>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                      {marinaDetails.marina_type && (
                        <div className="bg-primary/5 rounded-lg p-4 text-center">
                          <Ship className="h-6 w-6 text-primary mx-auto mb-2" />
                          <div className="text-xs text-gray-500 uppercase">Type</div>
                          <div className="font-semibold text-gray-900 capitalize">{marinaDetails.marina_type}</div>
                        </div>
                      )}
                      {marinaDetails.berths_count != null && (
                        <div className="bg-primary/5 rounded-lg p-4 text-center">
                          <Anchor className="h-6 w-6 text-primary mx-auto mb-2" />
                          <div className="text-xs text-gray-500 uppercase">Berths</div>
                          <div className="font-semibold text-gray-900">{marinaDetails.berths_count}</div>
                        </div>
                      )}
                      {marinaDetails.superyacht_berths != null && marinaDetails.superyacht_berths > 0 && (
                        <div className="bg-primary/5 rounded-lg p-4 text-center">
                          <Ship className="h-6 w-6 text-primary mx-auto mb-2" />
                          <div className="text-xs text-gray-500 uppercase">Superyacht Berths</div>
                          <div className="font-semibold text-gray-900">{marinaDetails.superyacht_berths}</div>
                        </div>
                      )}
                      {marinaDetails.longest_berth_meters != null && (
                        <div className="bg-primary/5 rounded-lg p-4 text-center">
                          <Ship className="h-6 w-6 text-primary mx-auto mb-2" />
                          <div className="text-xs text-gray-500 uppercase">Max Berth Length</div>
                          <div className="font-semibold text-gray-900">{marinaDetails.longest_berth_meters}m</div>
                        </div>
                      )}
                      {marinaDetails.fresh_water_available && (
                        <div className="bg-primary/5 rounded-lg p-4 text-center">
                          <Droplets className="h-6 w-6 text-primary mx-auto mb-2" />
                          <div className="text-xs text-gray-500 uppercase">Fresh Water</div>
                          <div className="font-semibold text-green-600">Available</div>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* Facilities & Services */}
                <Card>
                  <CardContent className="pt-6">
                    <h2 className="text-lg font-semibold text-gray-900 mb-4">Facilities & Services</h2>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {marinaDetails.has_yacht_club && (
                        <div className="flex items-center gap-2 text-sm">
                          <CheckCircle className="h-4 w-4 text-green-500" />
                          <span>Yacht Club{marinaDetails.yacht_club_members ? ` (${marinaDetails.yacht_club_members} members)` : ''}</span>
                        </div>
                      )}
                      {marinaDetails.has_sailing_school && (
                        <div className="flex items-center gap-2 text-sm">
                          <GraduationCap className="h-4 w-4 text-green-500" />
                          <span>Sailing School</span>
                        </div>
                      )}
                      {marinaDetails.has_boat_yard && (
                        <div className="flex items-center gap-2 text-sm">
                          <Wrench className="h-4 w-4 text-green-500" />
                          <span>Boat Yard</span>
                        </div>
                      )}
                      {marinaDetails.has_restaurants && (
                        <div className="flex items-center gap-2 text-sm">
                          <UtensilsCrossed className="h-4 w-4 text-green-500" />
                          <span>Restaurant{marinaDetails.restaurants_count && marinaDetails.restaurants_count > 1 ? `s (${marinaDetails.restaurants_count})` : ''}</span>
                        </div>
                      )}
                      {marinaDetails.has_concierge && (
                        <div className="flex items-center gap-2 text-sm">
                          <Sparkles className="h-4 w-4 text-green-500" />
                          <span>Concierge Service</span>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* Certifications */}
                {marinaDetails.certifications && marinaDetails.certifications.length > 0 && (
                  <Card>
                    <CardContent className="pt-6">
                      <h2 className="text-lg font-semibold text-gray-900 mb-3">Certifications</h2>
                      <div className="flex flex-wrap gap-2">
                        {marinaDetails.certifications.map((cert) => (
                          <Badge key={cert} variant="outline" className="text-sm py-1 px-3">
                            {cert}
                          </Badge>
                        ))}
                        {marinaDetails.certifications_other && (
                          <Badge variant="outline" className="text-sm py-1 px-3">
                            {marinaDetails.certifications_other}
                          </Badge>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Future Development Plans */}
                {futurePlans.length > 0 && (
                  <Card>
                    <CardContent className="pt-6">
                      <h2 className="text-lg font-semibold text-gray-900 mb-4">Future Development Plans</h2>
                      <div className="space-y-2">
                        {futurePlans.map((plan) => {
                          const timelineLabels: Record<string, string> = {
                            'immediate': 'Immediate',
                            '0-3months': '0-3 months',
                            '3-12months': '3-12 months',
                            '1-3years': '1-3 years',
                            '3+years': '3+ years',
                          };
                          const timelineColors: Record<string, string> = {
                            'immediate': 'bg-green-100 text-green-800',
                            '0-3months': 'bg-blue-100 text-blue-800',
                            '3-12months': 'bg-yellow-100 text-yellow-800',
                            '1-3years': 'bg-orange-100 text-orange-800',
                            '3+years': 'bg-gray-100 text-gray-800',
                          };
                          return (
                            <div key={plan.sector_label} className="flex items-center justify-between py-2 px-3 rounded-lg bg-gray-50">
                              <span className="text-sm font-medium text-gray-700">{plan.sector_label}</span>
                              <Badge className={`text-xs ${timelineColors[plan.timeline] || 'bg-gray-100 text-gray-800'}`}>
                                {timelineLabels[plan.timeline] || plan.timeline}
                              </Badge>
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Marina Description / Services Description */}
                {(marinaDetails.marina_description || marinaDetails.services_description) && (
                  <Card>
                    <CardContent className="pt-6 space-y-4">
                      {marinaDetails.marina_description && (
                        <div>
                          <h2 className="text-lg font-semibold text-gray-900 mb-2">About the Marina</h2>
                          <p className="text-gray-600 leading-relaxed whitespace-pre-wrap">{marinaDetails.marina_description}</p>
                        </div>
                      )}
                      {marinaDetails.services_description && (
                        <div>
                          <h2 className="text-lg font-semibold text-gray-900 mb-2">Services</h2>
                          <p className="text-gray-600 leading-relaxed whitespace-pre-wrap">{marinaDetails.services_description}</p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}
              </div>
            </TabsContent>
          )}

          {/* Representatives Tab */}
          <TabsContent value="representatives">
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {members.map((member) => {
                const fullName = `${member.profiles?.first_name || ''} ${member.profiles?.last_name || ''}`.trim();
                const displayName = fullName || member.profiles?.email?.split('@')[0] || 'Team Member';
                const initials = fullName
                  ? fullName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
                  : displayName.slice(0, 2).toUpperCase();
                const jobTitle = member.profiles?.job_title;
                return (
                  <Link key={member.id} to={`/users/${member.user_id}`}>
                    <Card className="hover:shadow-md transition-shadow cursor-pointer">
                      <CardContent className="pt-6 text-center">
                        <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xl mx-auto mb-3">
                          {initials || '??'}
                        </div>
                        <h3 className="font-semibold text-gray-900 mb-1">{displayName}</h3>
                        {jobTitle && (
                          <p className="text-sm text-gray-500 mb-1">{jobTitle}</p>
                        )}
                        <Badge variant="outline" className="mt-2 text-xs">
                          Team Member
                        </Badge>
                      </CardContent>
                    </Card>
                  </Link>
                );
              })}
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Connect Request Dialog */}
      <Dialog open={connectOpen} onOpenChange={setConnectOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Request to Connect</DialogTitle>
            <DialogDescription>Send a connection request to {org?.name}.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label>Message (optional)</Label>
              <Textarea
                value={connectMessage}
                onChange={(e) => setConnectMessage(e.target.value)}
                placeholder="Introduce yourself and explain why you'd like to connect..."
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
