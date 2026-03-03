import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { AlertCircle, Calendar, FileText, CheckCircle, XCircle, Clock, Anchor, Building2, Newspaper, ExternalLink, ClipboardList } from 'lucide-react';
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

export function AccountPage() {
  const { user, profile, userDetails, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [registrations, setRegistrations] = useState<EventRegistration[]>([]);
  const [projects, setProjects] = useState<MarinaProject[]>([]);
  const [dataLoading, setDataLoading] = useState(false);

  const defaultTab = searchParams.get('tab') || 'profile';

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/');
    }
  }, [user, authLoading, navigate]);

  useEffect(() => {
    if (!user) return;
    setDataLoading(true);

    const fetchData = async () => {
      const { data: regs } = await supabase
        .from('event_registrations')
        .select('id, event_id, created_at, events(title, date_time)')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      if (regs) setRegistrations(regs as EventRegistration[]);

      if (profile?.persona === 'marina') {
        const { data: proj } = await supabase
          .from('marina_projects')
          .select('id, project_type, budget_range, timeline, status, created_at')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false });
        if (proj) setProjects(proj as MarinaProject[]);
      }

      setDataLoading(false);
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
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6 flex items-center gap-3">
          <XCircle className="h-5 w-5 text-red-600 shrink-0" />
          <p className="text-red-800">Votre demande d'accès a été refusée. Contactez-nous pour plus d'informations.</p>
        </div>
      )}

      <Tabs defaultValue={defaultTab}>
        <TabsList className="mb-6">
          <TabsTrigger value="profile">Profil</TabsTrigger>
          <TabsTrigger value="registrations">Inscriptions</TabsTrigger>
          {isMarina && <TabsTrigger value="projects">Projets</TabsTrigger>}
        </TabsList>

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
      </Tabs>
    </div>
  );
}
