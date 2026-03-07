import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Helmet } from 'react-helmet-async';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Anchor, ArrowRight, FileText, Calendar, Users, Clock, MapPin, Building2, Newspaper, BarChart3 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';

interface FeaturedResource {
  id: string;
  title: string;
  summary: string;
  type: string;
  access_level: string;
  thumbnail_url: string | null;
}

interface UpcomingEvent {
  id: string;
  title: string;
  date_time: string;
  access_level: string;
}

interface PartnerPreview {
  user_id: string;
  company_name: string;
}

interface HomeStats {
  marinas: number;
  partners: number;
  resources: number;
  events: number;
}

export function HomePage() {
  const { t } = useTranslation();
  const { user, profile, organization } = useAuth();
  const [featuredResources, setFeaturedResources] = useState<FeaturedResource[]>([]);
  const [upcomingEvents, setUpcomingEvents] = useState<UpcomingEvent[]>([]);
  const [partnerPreviews, setPartnerPreviews] = useState<PartnerPreview[]>([]);
  const [stats, setStats] = useState<HomeStats>({ marinas: 0, partners: 0, resources: 0, events: 0 });

  // Personalized data for logged-in users
  const [personalResources, setPersonalResources] = useState<FeaturedResource[]>([]);
  const [personalEvents, setPersonalEvents] = useState<UpcomingEvent[]>([]);
  const [myRegistrations, setMyRegistrations] = useState<{ event_id: string; title: string; date_time: string }[]>([]);

  // Fetch personalized feed for logged-in users (from org-level sectors)
  useEffect(() => {
    if (!user || !profile) return;
    const fetchPersonal = async () => {
      const orgSectorTable = profile.persona === 'marina'
        ? 'organization_interest_sectors'
        : profile.persona === 'partner'
        ? 'organization_service_sectors'
        : null;

      const feedOrgId = organization?.id;

      if (orgSectorTable && feedOrgId) {
        const { data: userSectors } = await supabase
          .from(orgSectorTable)
          .select('sector_id')
          .eq('organization_id', feedOrgId);
        const sectorIds = (userSectors || []).map((s: any) => s.sector_id);

        if (sectorIds.length > 0) {
          const { data: feedRes } = await supabase
            .from('resource_sectors')
            .select('resource_id, resources!inner(id, title, summary, type, access_level, thumbnail_url, published)')
            .in('sector_id', sectorIds)
            .eq('resources.published', true)
            .limit(8);

          if (feedRes) {
            const unique = new Map<string, FeaturedResource>();
            for (const r of feedRes as any[]) {
              if (r.resources && !unique.has(r.resources.id)) {
                unique.set(r.resources.id, r.resources);
              }
            }
            setPersonalResources(Array.from(unique.values()).slice(0, 6));
          }

          const { data: feedEvt } = await supabase
            .from('event_sectors')
            .select('event_id, events!inner(id, title, date_time, access_level)')
            .in('sector_id', sectorIds)
            .limit(8);

          if (feedEvt) {
            const unique = new Map<string, UpcomingEvent>();
            for (const e of feedEvt as any[]) {
              if (e.events && new Date(e.events.date_time) > new Date() && !unique.has(e.events.id)) {
                unique.set(e.events.id, e.events);
              }
            }
            setPersonalEvents(Array.from(unique.values()).slice(0, 4));
          }
        }
      }

      // My registrations
      const { data: regs } = await supabase
        .from('event_registrations')
        .select('event_id, events(title, date_time)')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(5);
      if (regs) {
        setMyRegistrations(
          (regs as any[])
            .filter(r => r.events)
            .map(r => ({ event_id: r.event_id, title: r.events.title, date_time: r.events.date_time }))
        );
      }
    };
    fetchPersonal();
  }, [user, profile, organization]);

  useEffect(() => {
    // Fetch everything in parallel
    const fetchAll = async () => {
      try {
        const [resourcesRes, eventsRes, partnersRes, marinasCount, partnersCount, resourcesCount, eventsCount] = await Promise.all([
          // Featured resources (latest 3 published public)
          supabase
            .from('resources')
            .select('id, title, summary, type, access_level, thumbnail_url')
            .eq('published', true)
            .order('created_at', { ascending: false })
            .limit(3),
          // Upcoming events (next 3 future events)
          supabase
            .from('events')
            .select('id, title, date_time, access_level')
            .gte('date_time', new Date().toISOString())
            .order('date_time', { ascending: true })
            .limit(3),
          // Partner previews (verified, up to 6)
          supabase
            .from('partner_profiles')
            .select('user_id, company_name, profiles!inner(access_status)')
            .eq('profiles.access_status', 'verified')
            .limit(6),
          // Stats counts
          supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('persona', 'marina'),
          supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('persona', 'partner'),
          supabase.from('resources').select('*', { count: 'exact', head: true }).eq('published', true),
          supabase.from('events').select('*', { count: 'exact', head: true }),
        ]);

        if (resourcesRes.data) setFeaturedResources(resourcesRes.data as FeaturedResource[]);
        if (eventsRes.data) setUpcomingEvents(eventsRes.data as UpcomingEvent[]);
        if (partnersRes.data) {
          setPartnerPreviews(partnersRes.data.map((p: any) => ({
            user_id: p.user_id,
            company_name: p.company_name,
          })));
        }

        setStats({
          marinas: marinasCount.count || 0,
          partners: partnersCount.count || 0,
          resources: resourcesCount.count || 0,
          events: eventsCount.count || 0,
        });
      } catch (err) {
        console.error('Error fetching homepage data:', err);
      }
    };

    fetchAll();
  }, []);

  const getAccessBadge = (level: string) => {
    switch (level) {
      case 'public':
        return <Badge variant="success">{t('resources.accessLevels.public')}</Badge>;
      case 'members':
        return <Badge variant="info">{t('resources.accessLevels.members')}</Badge>;
      case 'marina':
        return <Badge variant="purple">{t('resources.accessLevels.marina')}</Badge>;
      default:
        return null;
    }
  };

  const getTypeBadge = (type: string) => {
    const colors: Record<string, string> = {
      article: 'bg-blue-100 text-blue-800',
      whitepaper: 'bg-purple-100 text-purple-800',
      guide: 'bg-green-100 text-green-800',
      replay: 'bg-red-100 text-red-800',
      case_study: 'bg-orange-100 text-orange-800',
    };
    return (
      <span className={`px-2 py-1 rounded text-xs font-medium ${colors[type] || 'bg-gray-100'}`}>
        {t(`resources.types.${type}`)}
      </span>
    );
  };

  const getInitials = (name: string) =>
    name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();

  return (
    <div className="flex flex-col">
      <Helmet>
        <title>M3 Connect — B2B Platform for the Marina Industry</title>
        <meta name="description" content="M3 Connect connects marina operators, service providers and media professionals. Browse resources, events, and find partners for the marina industry." />
        <meta property="og:title" content="M3 Connect — B2B Platform for the Marina Industry" />
        <meta property="og:description" content="Connect with marina operators, service providers and media professionals worldwide." />
        <meta property="og:url" content="https://m3connect.com/" />
      </Helmet>
      {/* Hero Section */}
      <section className="gradient-hero text-white py-20 md:py-32">
        <div className="container mx-auto px-4 text-center">
          {user ? (
            <>
              <h1 className="text-3xl md:text-5xl font-bold mb-4">
                {t('home.welcomeBack', 'Welcome back')}{profile?.first_name ? `, ${profile.first_name}` : ''}!
              </h1>
              <p className="text-lg md:text-xl text-gray-200 mb-8 max-w-2xl mx-auto">
                {t('home.personalizedSubtitle', 'Here\'s what\'s happening in the marina industry for you.')}
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Button size="lg" variant="secondary" asChild>
                  <Link to="/resources">
                    {t('home.exploreResources')}
                    <ArrowRight className="ml-2 h-5 w-5" />
                  </Link>
                </Button>
                <Button size="lg" variant="outline" className="bg-transparent border-white text-white hover:bg-white/10" asChild>
                  <Link to="/account">
                    {t('home.myAccount', 'My Account')}
                  </Link>
                </Button>
              </div>
            </>
          ) : (
            <>
              <h1 className="text-4xl md:text-6xl font-bold mb-6">
                {t('home.heroTitle')}
              </h1>
              <p className="text-xl md:text-2xl text-gray-200 mb-8 max-w-3xl mx-auto">
                {t('home.heroSubtitle')}
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Button size="lg" variant="secondary" asChild>
                  <Link to="/resources">
                    {t('home.exploreResources')}
                    <ArrowRight className="ml-2 h-5 w-5" />
                  </Link>
                </Button>
                <Button size="lg" variant="outline" className="bg-transparent border-white text-white hover:bg-white/10" asChild>
                  <Link to="/become-partner">
                    {t('home.becomePartner')}
                  </Link>
                </Button>
              </div>
            </>
          )}
        </div>
      </section>

      {/* Personalized Feed for logged-in users */}
      {user && (
        <section className="py-10 bg-white border-b">
          <div className="container mx-auto px-4">
            <div className="grid md:grid-cols-3 gap-6">
              {/* My Upcoming Registrations */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-primary" />
                    {t('home.myRegistrations', 'My Registrations')}
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  {myRegistrations.length === 0 ? (
                    <p className="text-sm text-gray-400 py-2 text-center">{t('home.noRegistrations', 'No event registrations yet.')}</p>
                  ) : (
                    <div className="divide-y">
                      {myRegistrations.map((r) => (
                        <Link key={r.event_id} to={`/events/${r.event_id}`} className="flex items-center gap-3 py-2.5 hover:bg-gray-50 -mx-2 px-2 rounded transition-colors">
                          <div className="bg-primary/10 rounded-lg p-1.5 text-center min-w-[40px] shrink-0">
                            <div className="text-sm font-bold text-primary leading-none">{new Date(r.date_time).getDate()}</div>
                            <div className="text-[9px] text-gray-600">{new Date(r.date_time).toLocaleString('default', { month: 'short' })}</div>
                          </div>
                          <div className="text-sm font-medium text-gray-900 truncate">{r.title}</div>
                        </Link>
                      ))}
                    </div>
                  )}
                  <Link to="/account?tab=registrations" className="text-xs text-primary hover:underline flex items-center gap-1 mt-2">
                    {t('home.viewAllRegistrations', 'View all')} <ArrowRight className="h-3 w-3" />
                  </Link>
                </CardContent>
              </Card>

              {/* Recommended Resources */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <FileText className="h-4 w-4 text-primary" />
                    {t('home.forYou', 'For You')}
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  {personalResources.length === 0 ? (
                    <p className="text-sm text-gray-400 py-2 text-center">{t('home.noPersonalResources', 'Complete your profile to get recommendations.')}</p>
                  ) : (
                    <div className="divide-y">
                      {personalResources.slice(0, 4).map((r) => (
                        <Link key={r.id} to={`/resources/${r.id}`} className="flex items-start gap-2 py-2.5 hover:bg-gray-50 -mx-2 px-2 rounded transition-colors">
                          <Badge variant="outline" className="text-[10px] shrink-0 mt-0.5">{r.type}</Badge>
                          <div className="text-sm font-medium text-gray-900 truncate">{r.title}</div>
                        </Link>
                      ))}
                    </div>
                  )}
                  <Link to="/resources" className="text-xs text-primary hover:underline flex items-center gap-1 mt-2">
                    {t('home.browseAll', 'Browse all')} <ArrowRight className="h-3 w-3" />
                  </Link>
                </CardContent>
              </Card>

              {/* Upcoming Events for You */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Clock className="h-4 w-4 text-primary" />
                    {t('home.eventsForYou', 'Events for You')}
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  {personalEvents.length === 0 ? (
                    <p className="text-sm text-gray-400 py-2 text-center">{t('home.noPersonalEvents', 'No upcoming events matching your sectors.')}</p>
                  ) : (
                    <div className="divide-y">
                      {personalEvents.map((e) => (
                        <Link key={e.id} to={`/events/${e.id}`} className="flex items-center gap-3 py-2.5 hover:bg-gray-50 -mx-2 px-2 rounded transition-colors">
                          <div className="bg-primary/10 rounded-lg p-1.5 text-center min-w-[40px] shrink-0">
                            <div className="text-sm font-bold text-primary leading-none">{new Date(e.date_time).getDate()}</div>
                            <div className="text-[9px] text-gray-600">{new Date(e.date_time).toLocaleString('default', { month: 'short' })}</div>
                          </div>
                          <div className="text-sm font-medium text-gray-900 truncate">{e.title}</div>
                        </Link>
                      ))}
                    </div>
                  )}
                  <Link to="/events" className="text-xs text-primary hover:underline flex items-center gap-1 mt-2">
                    {t('home.viewAllEvents', 'View all events')} <ArrowRight className="h-3 w-3" />
                  </Link>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>
      )}

      {/* Stats Bar — live counts */}
      <section className="bg-white py-8 border-b">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            <div>
              <div className="text-3xl md:text-4xl font-bold text-primary">{stats.marinas || '—'}</div>
              <div className="text-gray-600">{t('home.stats.marinas')}</div>
            </div>
            <div>
              <div className="text-3xl md:text-4xl font-bold text-primary">{stats.partners || '—'}</div>
              <div className="text-gray-600">{t('home.stats.partners')}</div>
            </div>
            <div>
              <div className="text-3xl md:text-4xl font-bold text-primary">{stats.resources || '—'}</div>
              <div className="text-gray-600">{t('home.stats.resources')}</div>
            </div>
            <div>
              <div className="text-3xl md:text-4xl font-bold text-primary">{stats.events || '—'}</div>
              <div className="text-gray-600">{t('home.stats.events')}</div>
            </div>
          </div>
        </div>
      </section>

      {/* Featured Resources */}
      <section className="py-16 bg-slate-50">
        <div className="container mx-auto px-4">
          <div className="flex justify-between items-center mb-8">
            <h2 className="text-3xl font-bold text-primary">{t('home.featuredResources')}</h2>
            <Link to="/resources" className="text-secondary hover:underline flex items-center">
              {t('home.viewAll')} <ArrowRight className="ml-1 h-4 w-4" />
            </Link>
          </div>
          {featuredResources.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="h-10 w-10 mx-auto text-gray-300 mb-3" />
              <p className="text-gray-500">{t('home.noResources', 'Resources coming soon.')}</p>
            </div>
          ) : (
            <div className="grid md:grid-cols-3 gap-6">
              {featuredResources.map((resource) => (
                <Link key={resource.id} to={`/resources/${resource.id}`} className="block">
                  <Card className="card-hover overflow-hidden h-full">
                    {resource.thumbnail_url ? (
                      <img
                        src={resource.thumbnail_url}
                        alt={resource.title}
                        className="w-full h-48 object-cover"
                      />
                    ) : (
                      <div className="w-full h-48 bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center">
                        <FileText className="h-12 w-12 text-primary/30" />
                      </div>
                    )}
                    <CardContent className="p-4">
                      <div className="flex gap-2 mb-2">
                        {getTypeBadge(resource.type)}
                        {getAccessBadge(resource.access_level)}
                      </div>
                      <h3 className="font-semibold text-lg mb-2">{resource.title}</h3>
                      <p className="text-gray-600 text-sm line-clamp-2">{resource.summary}</p>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Upcoming Events */}
      <section className="py-16">
        <div className="container mx-auto px-4">
          <div className="flex justify-between items-center mb-8">
            <h2 className="text-3xl font-bold text-primary">{t('home.upcomingEvents')}</h2>
            <Link to="/events" className="text-secondary hover:underline flex items-center">
              {t('home.viewCalendar')} <ArrowRight className="ml-1 h-4 w-4" />
            </Link>
          </div>
          {upcomingEvents.length === 0 ? (
            <div className="text-center py-12">
              <Calendar className="h-10 w-10 mx-auto text-gray-300 mb-3" />
              <p className="text-gray-500">{t('home.noEvents', 'No upcoming events. Check back soon!')}</p>
            </div>
          ) : (
            <div className="grid md:grid-cols-3 gap-6">
              {upcomingEvents.map((event) => (
                <Link key={event.id} to={`/events/${event.id}`} className="block">
                  <Card className="card-hover h-full">
                    <CardContent className="p-6">
                      <div className="flex items-start gap-4">
                        <div className="bg-primary/10 rounded-lg p-3 text-center min-w-[60px]">
                          <div className="text-2xl font-bold text-primary">
                            {new Date(event.date_time).getDate()}
                          </div>
                          <div className="text-xs text-gray-600">
                            {new Date(event.date_time).toLocaleString('default', { month: 'short' })}
                          </div>
                        </div>
                        <div>
                          <h3 className="font-semibold mb-2">{event.title}</h3>
                          {getAccessBadge(event.access_level)}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Partners */}
      <section className="py-16 bg-slate-50">
        <div className="container mx-auto px-4">
          <div className="flex justify-between items-center mb-8">
            <h2 className="text-3xl font-bold text-primary">{t('home.ourPartners')}</h2>
            <Link to="/partners" className="text-secondary hover:underline flex items-center">
              {t('home.viewAllPartners')} <ArrowRight className="ml-1 h-4 w-4" />
            </Link>
          </div>
          {partnerPreviews.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-500">{t('home.noPartners', 'Partner directory launching soon.')}</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 md:grid-cols-6 gap-6">
              {partnerPreviews.map((partner) => (
                <div
                  key={partner.user_id}
                  className="bg-white rounded-lg p-6 flex flex-col items-center justify-center shadow-sm hover:shadow-md transition-shadow"
                >
                  <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center text-primary font-bold text-xl">
                    {getInitials(partner.company_name)}
                  </div>
                  <p className="text-xs text-gray-500 mt-2 text-center truncate max-w-full">{partner.company_name}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* CTA Banner — only for logged-out users */}
      {!user && (
        <section className="py-16 bg-secondary text-white">
          <div className="container mx-auto px-4 text-center">
            <Anchor className="h-12 w-12 mx-auto mb-4" />
            <h2 className="text-3xl font-bold mb-4">{t('home.ctaTitle')}</h2>
            <p className="text-xl text-gray-100 mb-8 max-w-2xl mx-auto">
              {t('home.ctaSubtitle')}
            </p>
            <Button size="lg" variant="outline" className="bg-transparent border-white text-white hover:bg-white hover:text-secondary" asChild>
              <Link to="/become-partner">
                {t('home.joinNow')}
              </Link>
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
