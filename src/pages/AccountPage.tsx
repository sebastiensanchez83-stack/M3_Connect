import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { AlertCircle, Calendar, FileText, CheckCircle, XCircle, Clock, Anchor, Building2, Newspaper, ExternalLink, ClipboardList, Radio, Plus, Link2, MessageSquare, BarChart3, Eye, Users, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { MarinaProfile, PartnerProfile, MediaPartnerProfile } from '@/types/database';

interface EventRegistration {
  id: string;
  event_id: string;
  created_at: string;
  events: { title: string; date_time: string } | null;
}

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
  created_at: string;
}

interface ConsultationItem {
  id: string;
  title: string;
  description: string;
  sector_id: string | null;
  is_open: boolean;
  created_at: string;
}

interface PartnerRequestItem {
  id: string;
  partner_user_id: string;
  marina_user_id: string;
  sector_id: string | null;
  message: string;
  status: string;
  created_at: string;
}

export function AccountPage() {
  const { user, profile, userDetails, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [registrations, setRegistrations] = useState<EventRegistration[]>([]);
  const [projects, setProjects] = useState<MarinaProject[]>([]);
  const [webinarRequests, setWebinarRequests] = useState<WebinarRequest[]>([]);
  const [rfps, setRfps] = useState<RFPItem[]>([]);
  const [consultations, setConsultations] = useState<ConsultationItem[]>([]);
  const [partnerRequests, setPartnerRequests] = useState<PartnerRequestItem[]>([]);
  const [dataLoading, setDataLoading] = useState(false);

  // Dashboard analytics state
  const [profileViewCount, setProfileViewCount] = useState(0);
  const [connectionRequestCount, setConnectionRequestCount] = useState(0);
  const [pendingRequestCount, setPendingRequestCount] = useState(0);
  const [feedResources, setFeedResources] = useState<{ id: string; title: string; type: string; summary: string }[]>([]);
  const [feedEvents, setFeedEvents] = useState<{ id: string; title: string; date_time: string }[]>([]);

  const defaultTab = searchParams.get('tab') || 'dashboard';

  useEffect(() => {
    if (authLoading) return;
    if (!user) { navigate('/'); return; }
    // User logged in but no profile → redirect to onboarding to set up persona
    if (!profile) { navigate('/onboarding'); return; }
  }, [user, profile, authLoading, navigate]);

  useEffect(() => {
    if (!user || !profile) return;
    setDataLoading(true);

    const fetchData = async () => {
      try {
        const { data: regs } = await supabase
          .from('event_registrations')
          .select('id, event_id, created_at, events(title, date_time)')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false });
        if (regs) setRegistrations(regs as unknown as EventRegistration[]);

        if (profile?.persona === 'marina') {
          const { data: proj } = await supabase
            .from('marina_projects')
            .select('id, project_type, budget_range, timeline, status, created_at')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false });
          if (proj) setProjects(proj as MarinaProject[]);
        }

        const { data: webinars } = await supabase
          .from('webinar_requests')
          .select('id, title, description, preferred_language, preferred_timeframe, status, moderator_notes, created_at')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false });
        if (webinars) setWebinarRequests(webinars as WebinarRequest[]);

        // Fetch RFPs (marina only)
        if (profile?.persona === 'marina') {
          const { data: rfpData } = await supabase
            .from('rfps')
            .select('id, title, scope, sector_id, deadline_date, is_open, created_at')
            .eq('marina_user_id', user.id)
            .order('created_at', { ascending: false });
          if (rfpData) setRfps(rfpData as RFPItem[]);

          const { data: consultData } = await supabase
            .from('consultations')
            .select('id, title, description, sector_id, is_open, created_at')
            .eq('marina_user_id', user.id)
            .order('created_at', { ascending: false });
          if (consultData) setConsultations(consultData as ConsultationItem[]);
        }

        // Fetch partner requests received (for any user)
        const { data: prData } = await supabase
          .from('partner_requests')
          .select('id, partner_user_id, marina_user_id, sector_id, message, status, created_at')
          .or(`partner_user_id.eq.${user.id},marina_user_id.eq.${user.id}`)
          .order('created_at', { ascending: false });
        if (prData) setPartnerRequests(prData as PartnerRequestItem[]);

        // Dashboard analytics
        // Profile views count
        const { count: viewCount } = await supabase
          .from('profile_views')
          .select('*', { count: 'exact', head: true })
          .eq('viewed_user_id', user.id);
        setProfileViewCount(viewCount || 0);

        // Connection requests
        const allRequests = prData || [];
        setConnectionRequestCount(allRequests.length);
        setPendingRequestCount(allRequests.filter((r: any) => r.status === 'pending').length);

        // Personalized feed: get user's sectors
        const sectorTable = profile.persona === 'marina'
          ? 'marina_interest_sectors'
          : profile.persona === 'partner'
          ? 'partner_service_sectors'
          : null;

        if (sectorTable) {
          const userIdCol = profile.persona === 'marina' ? 'user_id' : 'partner_user_id';
          const { data: userSectors } = await supabase
            .from(sectorTable)
            .select('sector_id')
            .eq(userIdCol, user.id);

          const sectorIds = (userSectors || []).map((s: any) => s.sector_id);

          if (sectorIds.length > 0) {
            // Resources matching sectors
            const { data: feedRes } = await supabase
              .from('resource_sectors')
              .select('resource_id, resources!inner(id, title, type, summary, published)')
              .in('sector_id', sectorIds)
              .eq('resources.published', true)
              .limit(6);

            if (feedRes) {
              const uniqueResources = new Map<string, { id: string; title: string; type: string; summary: string }>();
              for (const r of feedRes as any[]) {
                if (r.resources && !uniqueResources.has(r.resources.id)) {
                  uniqueResources.set(r.resources.id, {
                    id: r.resources.id,
                    title: r.resources.title,
                    type: r.resources.type,
                    summary: r.resources.summary,
                  });
                }
              }
              setFeedResources(Array.from(uniqueResources.values()).slice(0, 4));
            }

            // Events matching sectors
            const { data: feedEvt } = await supabase
              .from('event_sectors')
              .select('event_id, events!inner(id, title, date_time)')
              .in('sector_id', sectorIds)
              .limit(6);

            if (feedEvt) {
              const uniqueEvents = new Map<string, { id: string; title: string; date_time: string }>();
              for (const e of feedEvt as any[]) {
                if (e.events && !uniqueEvents.has(e.events.id)) {
                  uniqueEvents.set(e.events.id, {
                    id: e.events.id,
                    title: e.events.title,
                    date_time: e.events.date_time,
                  });
                }
              }
              setFeedEvents(Array.from(uniqueEvents.values()).slice(0, 4));
            }
          }
        }
      } catch (err) {
        console.error('Error fetching account data:', err);
      } finally {
        setDataLoading(false);
      }
    };

    fetchData();
  }, [user, profile]);

  const getAccessBadge = () => {
    if (!profile) return null;
    switch (profile.access_status) {
      case 'verified':
        return <Badge className="bg-green-100 text-green-800 border-green-200"><CheckCircle className="h-3 w-3 mr-1" />Vérifié</Badge>;
      case 'pending':
        return <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200"><Clock className="h-3 w-3 mr-1" />En attente</Badge>;
      case 'rejected':
        return <Badge className="bg-red-100 text-red-800 border-red-200"><XCircle className="h-3 w-3 mr-1" />Refusé</Badge>;
      case 'suspended':
        return <Badge className="bg-gray-100 text-gray-800 border-gray-200"><XCircle className="h-3 w-3 mr-1" />Suspendu</Badge>;
      default:
        return null;
    }
  };

  const getPersonaIcon = () => {
    switch (profile?.persona) {
      case 'marina': return <Anchor className="h-5 w-5" />;
      case 'partner': return <Building2 className="h-5 w-5" />;
      case 'media_partner': return <Newspaper className="h-5 w-5" />;
      default: return null;
    }
  };

  const getPersonaLabel = () => {
    switch (profile?.persona) {
      case 'marina': return 'Marina / Port';
      case 'partner': return 'Partenaire';
      case 'media_partner': return 'Média';
      case 'moderator': return 'Modérateur';
      case 'admin': return 'Administrateur';
      case 'individual': return 'Individuel';
      default: return '';
    }
  };

  if (authLoading) {
    return <div className="container mx-auto px-4 py-8 text-center text-gray-500">Chargement...</div>;
  }

  if (!user || !profile) return null;

  const isMarina = profile.persona === 'marina';
  const marinaDetails = isMarina ? (userDetails as MarinaProfile | null) : null;
  const partnerDetails = profile.persona === 'partner' ? (userDetails as PartnerProfile | null) : null;
  const mediaDetails = profile.persona === 'media_partner' ? (userDetails as MediaPartnerProfile | null) : null;

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold text-primary">Mon compte</h1>
        {getAccessBadge()}
      </div>

      {/* Bannière onboarding non complété */}
      {(profile.onboarding_status === 'draft') && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <ClipboardList className="h-5 w-5 text-blue-600 shrink-0" />
            <p className="text-blue-800">Votre profil est incomplet. Complétez-le pour être validé par notre équipe.</p>
          </div>
          <Button size="sm" onClick={() => navigate('/onboarding')}>Compléter</Button>
        </div>
      )}

      {/* Bannière en attente de validation */}
      {profile.onboarding_status === 'submitted' && profile.access_status === 'pending' && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6 flex items-center gap-3">
          <AlertCircle className="h-5 w-5 text-yellow-600 shrink-0" />
          <p className="text-yellow-800">Votre profil est en cours de vérification par notre équipe. Vous recevrez une confirmation par email.</p>
        </div>
      )}

      {/* Bannière compte refusé */}
      {profile.access_status === 'rejected' && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6 space-y-2">
          <div className="flex items-center gap-3">
            <XCircle className="h-5 w-5 text-red-600 shrink-0" />
            <p className="text-red-800 font-medium">Votre demande d'accès a été refusée.</p>
          </div>
          {profile.rejection_reason && (
            <p className="text-red-700 text-sm ml-8">Raison : {profile.rejection_reason}</p>
          )}
          <div className="ml-8">
            <Button size="sm" variant="outline" onClick={() => navigate('/onboarding')}>
              Modifier et resoumettre
            </Button>
          </div>
        </div>
      )}

      <Tabs defaultValue={defaultTab}>
        <TabsList className="mb-6 flex-wrap">
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="profile">Profil</TabsTrigger>
          <TabsTrigger value="registrations">Inscriptions</TabsTrigger>
          {isMarina && <TabsTrigger value="projects">Projets</TabsTrigger>}
          <TabsTrigger value="webinars">Webinars</TabsTrigger>
          {isMarina && <TabsTrigger value="rfps">RFPs</TabsTrigger>}
          {isMarina && <TabsTrigger value="consultations">Consultations</TabsTrigger>}
          <TabsTrigger value="b2b-requests">B2B</TabsTrigger>
        </TabsList>

        {/* ── DASHBOARD ── */}
        <TabsContent value="dashboard">
          <div className="space-y-6">
            {/* Analytics Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-100 rounded-lg"><Eye className="h-5 w-5 text-blue-600" /></div>
                    <div>
                      <div className="text-2xl font-bold text-gray-900">{profileViewCount}</div>
                      <div className="text-sm text-gray-500">Profile Views</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-green-100 rounded-lg"><Users className="h-5 w-5 text-green-600" /></div>
                    <div>
                      <div className="text-2xl font-bold text-gray-900">{connectionRequestCount}</div>
                      <div className="text-sm text-gray-500">Connection Requests</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-amber-100 rounded-lg"><Clock className="h-5 w-5 text-amber-600" /></div>
                    <div>
                      <div className="text-2xl font-bold text-gray-900">{pendingRequestCount}</div>
                      <div className="text-sm text-gray-500">Pending Requests</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Personalized Feed */}
            <div className="grid md:grid-cols-2 gap-6">
              {/* Recommended Resources */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <FileText className="h-4 w-4 text-primary" />
                    Recommended Resources
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  {feedResources.length === 0 ? (
                    <p className="text-sm text-gray-400 py-4 text-center">No resources matching your sectors yet.</p>
                  ) : (
                    <div className="divide-y">
                      {feedResources.map(r => (
                        <Link key={r.id} to={`/resources/${r.id}`} className="block py-3 hover:bg-gray-50 -mx-2 px-2 rounded transition-colors">
                          <div className="flex items-start gap-2">
                            <Badge variant="outline" className="text-xs shrink-0 mt-0.5">{r.type}</Badge>
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-gray-900 truncate">{r.title}</div>
                              <div className="text-xs text-gray-500 truncate">{r.summary}</div>
                            </div>
                          </div>
                        </Link>
                      ))}
                    </div>
                  )}
                  <Link to="/resources" className="text-xs text-primary hover:underline flex items-center gap-1 mt-3">
                    View all resources <ArrowRight className="h-3 w-3" />
                  </Link>
                </CardContent>
              </Card>

              {/* Upcoming Events */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-primary" />
                    Upcoming Events for You
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  {feedEvents.length === 0 ? (
                    <p className="text-sm text-gray-400 py-4 text-center">No events matching your sectors yet.</p>
                  ) : (
                    <div className="divide-y">
                      {feedEvents.map(e => (
                        <Link key={e.id} to={`/events/${e.id}`} className="block py-3 hover:bg-gray-50 -mx-2 px-2 rounded transition-colors">
                          <div className="flex items-center gap-3">
                            <div className="bg-primary/10 rounded-lg p-2 text-center min-w-[48px] shrink-0">
                              <div className="text-lg font-bold text-primary leading-none">{new Date(e.date_time).getDate()}</div>
                              <div className="text-[10px] text-gray-600">{new Date(e.date_time).toLocaleString('default', { month: 'short' })}</div>
                            </div>
                            <div className="text-sm font-medium text-gray-900 truncate">{e.title}</div>
                          </div>
                        </Link>
                      ))}
                    </div>
                  )}
                  <Link to="/events" className="text-xs text-primary hover:underline flex items-center gap-1 mt-3">
                    View all events <ArrowRight className="h-3 w-3" />
                  </Link>
                </CardContent>
              </Card>
            </div>

            {/* Quick Activity */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-primary" />
                  Quick Summary
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
                  <div className="p-3 bg-gray-50 rounded-lg">
                    <div className="text-xl font-bold text-primary">{registrations.length}</div>
                    <div className="text-xs text-gray-500">Event Registrations</div>
                  </div>
                  <div className="p-3 bg-gray-50 rounded-lg">
                    <div className="text-xl font-bold text-primary">{webinarRequests.length}</div>
                    <div className="text-xs text-gray-500">Webinar Requests</div>
                  </div>
                  {isMarina && (
                    <>
                      <div className="p-3 bg-gray-50 rounded-lg">
                        <div className="text-xl font-bold text-primary">{projects.length}</div>
                        <div className="text-xs text-gray-500">Projects</div>
                      </div>
                      <div className="p-3 bg-gray-50 rounded-lg">
                        <div className="text-xl font-bold text-primary">{rfps.length + consultations.length}</div>
                        <div className="text-xs text-gray-500">RFPs & Consultations</div>
                      </div>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── PROFIL ── */}
        <TabsContent value="profile">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {getPersonaIcon()}
                {getPersonaLabel()}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-gray-500 block">Email</span>
                  <span className="font-medium">{user.email}</span>
                </div>
                <div>
                  <span className="text-gray-500 block">Statut</span>
                  <span className="font-medium capitalize">{profile.access_status}</span>
                </div>
              </div>

              {/* Marina details */}
              {marinaDetails && (
                <div className="pt-4 border-t space-y-3">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-gray-500 block">Marina</span>
                      <span className="font-medium">{marinaDetails.marina_name || '—'}</span>
                    </div>
                    <div>
                      <span className="text-gray-500 block">Anneaux</span>
                      <span className="font-medium">{marinaDetails.berths_count ?? '—'}</span>
                    </div>
                    <div>
                      <span className="text-gray-500 block">Pays</span>
                      <span className="font-medium">{marinaDetails.country || '—'}</span>
                    </div>
                    <div>
                      <span className="text-gray-500 block">Ville</span>
                      <span className="font-medium">{marinaDetails.city || '—'}</span>
                    </div>
                  </div>
                  {marinaDetails.website && (
                    <a href={marinaDetails.website} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
                      <ExternalLink className="h-3 w-3" />
                      {marinaDetails.website}
                    </a>
                  )}
                </div>
              )}

              {/* Partner details */}
              {partnerDetails && (
                <div className="pt-4 border-t space-y-3">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-gray-500 block">Entreprise</span>
                      <span className="font-medium">{partnerDetails.company_name || '—'}</span>
                    </div>
                    <div>
                      <span className="text-gray-500 block">Pays du siège</span>
                      <span className="font-medium">{partnerDetails.headquarters_country || '—'}</span>
                    </div>
                  </div>
                  {partnerDetails.description && (
                    <div className="text-sm">
                      <span className="text-gray-500 block mb-1">Description</span>
                      <p className="text-gray-700">{partnerDetails.description}</p>
                    </div>
                  )}
                  {partnerDetails.website && (
                    <a href={partnerDetails.website} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
                      <ExternalLink className="h-3 w-3" />
                      {partnerDetails.website}
                    </a>
                  )}
                </div>
              )}

              {/* Media details */}
              {mediaDetails && (
                <div className="pt-4 border-t space-y-3">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-gray-500 block">Média</span>
                      <span className="font-medium">{mediaDetails.media_name || '—'}</span>
                    </div>
                  </div>
                  {mediaDetails.audience_description && (
                    <div className="text-sm">
                      <span className="text-gray-500 block mb-1">Audience</span>
                      <p className="text-gray-700">{mediaDetails.audience_description}</p>
                    </div>
                  )}
                  {mediaDetails.website && (
                    <a href={mediaDetails.website} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
                      <ExternalLink className="h-3 w-3" />
                      {mediaDetails.website}
                    </a>
                  )}
                </div>
              )}

              {profile.onboarding_status === 'draft' && (
                <div className="pt-4">
                  <Button onClick={() => navigate('/onboarding')} variant="outline">
                    Compléter mon profil
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── INSCRIPTIONS ── */}
        <TabsContent value="registrations">
          <Card>
            <CardHeader>
              <CardTitle>Mes inscriptions aux événements</CardTitle>
            </CardHeader>
            <CardContent>
              {dataLoading ? (
                <p className="text-gray-500 text-center py-8">Chargement...</p>
              ) : registrations.length === 0 ? (
                <p className="text-gray-500 text-center py-8">Aucune inscription pour le moment.</p>
              ) : (
                <div className="space-y-4">
                  {registrations.map((reg) => (
                    <div key={reg.id} className="flex items-center gap-4 p-4 border rounded-lg">
                      <Calendar className="h-5 w-5 text-gray-400 shrink-0" />
                      <div>
                        <div className="font-medium">{reg.events?.title ?? '—'}</div>
                        {reg.events?.date_time && (
                          <div className="text-sm text-gray-500">
                            {new Date(reg.events.date_time).toLocaleDateString('fr-FR', {
                              year: 'numeric', month: 'long', day: 'numeric',
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── PROJETS (marina uniquement) ── */}
        {isMarina && (
          <TabsContent value="projects">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Mes projets</CardTitle>
                <Button size="sm" onClick={() => navigate('/submit-project')}>
                  Soumettre un projet
                </Button>
              </CardHeader>
              <CardContent>
                {dataLoading ? (
                  <p className="text-gray-500 text-center py-8">Chargement...</p>
                ) : projects.length === 0 ? (
                  <p className="text-gray-500 text-center py-8">Aucun projet soumis pour le moment.</p>
                ) : (
                  <div className="space-y-4">
                    {projects.map((project) => (
                      <div key={project.id} className="flex items-center justify-between p-4 border rounded-lg">
                        <div className="flex items-center gap-4">
                          <FileText className="h-5 w-5 text-gray-400 shrink-0" />
                          <div>
                            <div className="font-medium">{project.project_type}</div>
                            <div className="text-sm text-gray-500">
                              {new Date(project.created_at).toLocaleDateString('fr-FR')}
                              {project.budget_range && ` • ${project.budget_range}`}
                            </div>
                          </div>
                        </div>
                        <Badge variant="outline">{project.status}</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}
        {/* ── WEBINAR REQUESTS ── */}
        <TabsContent value="webinars">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Mes demandes de webinar</CardTitle>
              <Button size="sm" onClick={() => navigate('/request-webinar')}>
                <Plus className="h-4 w-4 mr-2" />Proposer un webinar
              </Button>
            </CardHeader>
            <CardContent>
              {dataLoading ? (
                <p className="text-gray-500 text-center py-8">Chargement...</p>
              ) : webinarRequests.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <Radio className="h-8 w-8 mx-auto mb-3 text-gray-300" />
                  <p>Aucune demande de webinar soumise.</p>
                  <Button className="mt-4" size="sm" onClick={() => navigate('/request-webinar')}>
                    Proposer un sujet
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  {webinarRequests.map((req) => (
                    <div key={req.id} className="p-4 border rounded-lg space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-medium">{req.title}</div>
                        <WebinarStatusBadge status={req.status} />
                      </div>
                      <div className="text-sm text-gray-500">
                        {req.preferred_language === 'EN' ? 'English' : 'Français'}
                        {req.preferred_timeframe && ` · ${req.preferred_timeframe}`}
                        {' · '}{new Date(req.created_at).toLocaleDateString('fr-FR')}
                      </div>
                      {req.moderator_notes && (
                        <div className="text-sm bg-blue-50 border border-blue-100 rounded p-3 text-blue-800">
                          <span className="font-medium">Note de l'équipe : </span>
                          {req.moderator_notes}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── RFPs (marina uniquement) ── */}
        {isMarina && (
          <TabsContent value="rfps">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <ClipboardList className="h-5 w-5" />
                  Mes appels d'offres (RFPs)
                </CardTitle>
                <Button size="sm" onClick={() => navigate('/submit-rfp')}>
                  <Plus className="h-4 w-4 mr-2" />Soumettre un RFP
                </Button>
              </CardHeader>
              <CardContent>
                {dataLoading ? (
                  <p className="text-gray-500 text-center py-8">Chargement...</p>
                ) : rfps.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    <ClipboardList className="h-8 w-8 mx-auto mb-3 text-gray-300" />
                    <p>Aucun appel d'offres soumis.</p>
                    <Button className="mt-4" size="sm" onClick={() => navigate('/submit-rfp')}>
                      Créer un RFP
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {rfps.map((rfp) => (
                      <div key={rfp.id} className="p-4 border rounded-lg space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="font-medium">{rfp.title}</div>
                          <Badge variant={rfp.is_open ? 'success' : 'secondary'}>
                            {rfp.is_open ? 'Ouvert' : 'Fermé'}
                          </Badge>
                        </div>
                        <p className="text-sm text-gray-600 line-clamp-2">{rfp.scope}</p>
                        <div className="text-sm text-gray-500">
                          {rfp.deadline_date && `Échéance : ${new Date(rfp.deadline_date).toLocaleDateString('fr-FR')} · `}
                          Créé le {new Date(rfp.created_at).toLocaleDateString('fr-FR')}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* ── CONSULTATIONS (marina uniquement) ── */}
        {isMarina && (
          <TabsContent value="consultations">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <MessageSquare className="h-5 w-5" />
                  Mes consultations
                </CardTitle>
                <Button size="sm" onClick={() => navigate('/submit-consultation')}>
                  <Plus className="h-4 w-4 mr-2" />Nouvelle consultation
                </Button>
              </CardHeader>
              <CardContent>
                {dataLoading ? (
                  <p className="text-gray-500 text-center py-8">Chargement...</p>
                ) : consultations.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    <MessageSquare className="h-8 w-8 mx-auto mb-3 text-gray-300" />
                    <p>Aucune consultation soumise.</p>
                    <Button className="mt-4" size="sm" onClick={() => navigate('/submit-consultation')}>
                      Poser une question
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {consultations.map((c) => (
                      <div key={c.id} className="p-4 border rounded-lg space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="font-medium">{c.title}</div>
                          <Badge variant={c.is_open ? 'success' : 'secondary'}>
                            {c.is_open ? 'Ouverte' : 'Fermée'}
                          </Badge>
                        </div>
                        <p className="text-sm text-gray-600 line-clamp-2">{c.description}</p>
                        <div className="text-sm text-gray-500">
                          Créée le {new Date(c.created_at).toLocaleDateString('fr-FR')}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* ── B2B PARTNER REQUESTS ── */}
        <TabsContent value="b2b-requests">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Link2 className="h-5 w-5" />
                Demandes B2B
              </CardTitle>
            </CardHeader>
            <CardContent>
              {dataLoading ? (
                <p className="text-gray-500 text-center py-8">Chargement...</p>
              ) : partnerRequests.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <Link2 className="h-8 w-8 mx-auto mb-3 text-gray-300" />
                  <p>Aucune demande B2B pour le moment.</p>
                  <p className="text-sm mt-1">
                    {isMarina
                      ? 'Les partenaires peuvent vous contacter via le Marketplace.'
                      : 'Retrouvez vos demandes de contact vers les marinas ici.'}
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {partnerRequests.map((pr) => (
                    <div key={pr.id} className="p-4 border rounded-lg space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-sm text-gray-500">
                            {pr.partner_user_id === user?.id ? 'Envoyée' : 'Reçue'}
                            {' · '}{new Date(pr.created_at).toLocaleDateString('fr-FR')}
                          </div>
                          <p className="text-sm mt-1">{pr.message}</p>
                        </div>
                        <B2BStatusBadge status={pr.status} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

      </Tabs>
    </div>
  );
}

function B2BStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    pending: { label: 'En attente', className: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
    accepted: { label: 'Acceptée', className: 'bg-green-100 text-green-800 border-green-200' },
    rejected: { label: 'Refusée', className: 'bg-red-100 text-red-800 border-red-200' },
  };
  const s = map[status] ?? { label: status, className: 'bg-gray-100 text-gray-800' };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${s.className}`}>
      {s.label}
    </span>
  );
}

function WebinarStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    submitted: { label: 'Soumis', className: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
    under_review: { label: 'En cours d\'examen', className: 'bg-blue-100 text-blue-800 border-blue-200' },
    accepted: { label: 'Accepté', className: 'bg-green-100 text-green-800 border-green-200' },
    rejected: { label: 'Refusé', className: 'bg-red-100 text-red-800 border-red-200' },
  };
  const s = map[status] ?? { label: status, className: 'bg-gray-100 text-gray-800' };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${s.className}`}>
      {s.label}
    </span>
  );
}
