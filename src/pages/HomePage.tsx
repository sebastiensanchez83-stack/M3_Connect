import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Helmet } from 'react-helmet-async';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Anchor, ArrowRight, FileText, Calendar, Users, Clock, MapPin, Building2, Newspaper, BarChart3, CheckCircle, Globe, Shield, UserPlus, ClipboardCheck, Unlock, Eye, Link2, Inbox } from 'lucide-react';
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
  id: string;
  slug: string;
  name: string;
  logo_url: string | null;
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
  const [personalStats, setPersonalStats] = useState<{ profileViews: number; connectionRequests: number; pendingItems: number } | null>(null);

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

      // Personal stats: profile views, connection requests, pending items
      const [viewsRes, connectionsRes, pendingRes] = await Promise.all([
        supabase
          .from('profile_views')
          .select('*', { count: 'exact', head: true })
          .eq('viewed_user_id', user.id),
        supabase
          .from('partner_requests')
          .select('*', { count: 'exact', head: true })
          .eq('marina_user_id', user.id)
          .in('status', ['pending', 'accepted']),
        supabase
          .from('partner_requests')
          .select('*', { count: 'exact', head: true })
          .eq('marina_user_id', user.id)
          .eq('status', 'pending'),
      ]);
      setPersonalStats({
        profileViews: viewsRes.count || 0,
        connectionRequests: connectionsRes.count || 0,
        pendingItems: pendingRes.count || 0,
      });
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
          // Partner previews (verified orgs, up to 6)
          supabase
            .from('organizations')
            .select('id, slug, name, logo_url')
            .eq('access_status', 'verified')
            .eq('organization_type', 'partner')
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
          setPartnerPreviews(partnersRes.data.map((o: any) => ({
            id: o.id,
            slug: o.slug,
            name: o.name,
            logo_url: o.logo_url,
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
        <title>M3 Connect — The B2B Platform for the Marina &amp; Yachting Industry</title>
        <meta name="description" content="M3 Connect is the professional B2B network connecting marinas, service providers, and media partners worldwide. Access exclusive resources, industry events, RFPs, and grow your marina business." />
        <meta property="og:title" content="M3 Connect — The B2B Platform for the Marina & Yachting Industry" />
        <meta property="og:description" content="Connect marinas, service providers, and media partners. Share expertise, find solutions, and grow your marina business on the industry's professional network." />
        <meta property="og:type" content="website" />
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
                {t('home.heroTitle', 'The B2B Network for the Marina & Yachting Industry')}
              </h1>
              <p className="text-xl md:text-2xl text-gray-200 mb-8 max-w-3xl mx-auto">
                {t('home.heroSubtitle', 'Connect marinas, service providers, and media partners. Share expertise, find solutions, grow your business.')}
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Button size="lg" variant="secondary" asChild>
                  <Link to="/become-partner">
                    {t('home.joinNowFree', 'Join Now — It\'s Free')}
                    <ArrowRight className="ml-2 h-5 w-5" />
                  </Link>
                </Button>
                <Button size="lg" variant="outline" className="bg-transparent border-white text-white hover:bg-white/10" asChild>
                  <Link to="/marketplace">
                    {t('home.exploreMarketplace', 'Explore the Marketplace')}
                  </Link>
                </Button>
              </div>
              {/* Trust indicators */}
              <div className="flex flex-wrap justify-center gap-6 mt-8 text-sm text-gray-200">
                <span className="flex items-center gap-1.5"><CheckCircle className="h-4 w-4 text-green-300" /> {t('home.trustFree', 'Free for Marinas')}</span>
                <span className="flex items-center gap-1.5"><CheckCircle className="h-4 w-4 text-green-300" /> {t('home.trustVerified', 'Verified Partners')}</span>
                <span className="flex items-center gap-1.5"><CheckCircle className="h-4 w-4 text-green-300" /> {t('home.trustEvents', 'Industry Events & Resources')}</span>
              </div>
            </>
          )}
        </div>
      </section>

      {/* "Why Join?" Section — only for logged-out visitors */}
      {!user && (
        <section className="py-16 bg-white">
          <div className="container mx-auto px-4">
            <h2 className="text-3xl font-bold text-center text-primary mb-3">
              {t('home.whyJoinTitle', 'Why Join M3 Connect?')}
            </h2>
            <p className="text-gray-600 text-center max-w-2xl mx-auto mb-10">
              {t('home.whyJoinSubtitle', 'A dedicated platform for every stakeholder in the marina ecosystem.')}
            </p>
            <div className="grid md:grid-cols-3 gap-6">
              <Card className="text-center hover:shadow-lg transition-shadow">
                <CardContent className="pt-8 pb-6 px-6">
                  <div className="w-14 h-14 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Anchor className="h-7 w-7 text-blue-600" />
                  </div>
                  <h3 className="font-semibold text-lg mb-2">{t('home.whyMarinas', 'For Marinas')}</h3>
                  <p className="text-sm text-gray-600">
                    {t('home.whyMarinasDesc', 'Post RFPs, find certified service providers, access exclusive resources and events tailored to your operations.')}
                  </p>
                </CardContent>
              </Card>
              <Card className="text-center hover:shadow-lg transition-shadow">
                <CardContent className="pt-8 pb-6 px-6">
                  <div className="w-14 h-14 bg-orange-50 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Building2 className="h-7 w-7 text-orange-600" />
                  </div>
                  <h3 className="font-semibold text-lg mb-2">{t('home.whyPartners', 'For Partners')}</h3>
                  <p className="text-sm text-gray-600">
                    {t('home.whyPartnersDesc', 'Showcase your services, respond to marina RFPs, and connect directly with decision-makers.')}
                  </p>
                </CardContent>
              </Card>
              <Card className="text-center hover:shadow-lg transition-shadow">
                <CardContent className="pt-8 pb-6 px-6">
                  <div className="w-14 h-14 bg-purple-50 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Newspaper className="h-7 w-7 text-purple-600" />
                  </div>
                  <h3 className="font-semibold text-lg mb-2">{t('home.whyMedia', 'For Media')}</h3>
                  <p className="text-sm text-gray-600">
                    {t('home.whyMediaDesc', 'Reach the marina industry audience, share content, and participate in community events.')}
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>
      )}

      {/* "How It Works" Section — only for logged-out visitors */}
      {!user && (
        <section className="py-16 bg-slate-50 border-b">
          <div className="container mx-auto px-4">
            <h2 className="text-3xl font-bold text-center text-primary mb-10">
              {t('home.howItWorksTitle', 'How It Works')}
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6 max-w-4xl mx-auto">
              {[
                { icon: <UserPlus className="h-6 w-6 text-white" />, title: t('home.step1', 'Create Your Free Account'), num: '1' },
                { icon: <Building2 className="h-6 w-6 text-white" />, title: t('home.step2', 'Complete Your Organization Profile'), num: '2' },
                { icon: <ClipboardCheck className="h-6 w-6 text-white" />, title: t('home.step3', 'Get Verified by Our Team'), num: '3' },
                { icon: <Unlock className="h-6 w-6 text-white" />, title: t('home.step4', 'Access the Full Platform'), num: '4' },
              ].map((step) => (
                <div key={step.num} className="text-center">
                  <div className="w-14 h-14 bg-primary rounded-full flex items-center justify-center mx-auto mb-3 relative">
                    {step.icon}
                    <span className="absolute -top-1 -right-1 w-6 h-6 bg-secondary rounded-full text-white text-xs font-bold flex items-center justify-center">{step.num}</span>
                  </div>
                  <p className="text-sm font-medium text-gray-700">{step.title}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

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

      {/* Stats Bar — personalized for logged-in, global for visitors */}
      <section className="bg-white py-8 border-b">
        <div className="container mx-auto px-4">
          {user && personalStats ? (
            <div className="grid grid-cols-3 gap-6 max-w-2xl mx-auto">
              <Link to="/account?tab=b2b-requests" className="text-center group hover:bg-gray-50 rounded-xl p-4 transition-colors">
                <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-blue-50 text-blue-600 mb-2 group-hover:scale-110 transition-transform">
                  <Eye className="h-5 w-5" />
                </div>
                <div className="text-2xl md:text-3xl font-bold text-primary">{personalStats.profileViews}</div>
                <div className="text-sm text-gray-600">{t('home.personalStats.profileViews', 'Profile Views')}</div>
              </Link>
              <Link to="/account?tab=b2b-requests" className="text-center group hover:bg-gray-50 rounded-xl p-4 transition-colors">
                <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-teal-50 text-teal-600 mb-2 group-hover:scale-110 transition-transform">
                  <Link2 className="h-5 w-5" />
                </div>
                <div className="text-2xl md:text-3xl font-bold text-primary">{personalStats.connectionRequests}</div>
                <div className="text-sm text-gray-600">{t('home.personalStats.connections', 'Connections')}</div>
              </Link>
              <Link to="/account?tab=b2b-requests" className="text-center group hover:bg-gray-50 rounded-xl p-4 transition-colors">
                <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-amber-50 text-amber-600 mb-2 group-hover:scale-110 transition-transform">
                  <Inbox className="h-5 w-5" />
                </div>
                <div className="text-2xl md:text-3xl font-bold text-primary">{personalStats.pendingItems}</div>
                <div className="text-sm text-gray-600">{t('home.personalStats.pending', 'Pending Requests')}</div>
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
              <div>
                <div className="text-3xl md:text-4xl font-bold text-primary">{stats.marinas ? `${stats.marinas}+` : '—'}</div>
                <div className="text-gray-600">{t('home.stats.marinas', 'Marinas Worldwide')}</div>
              </div>
              <div>
                <div className="text-3xl md:text-4xl font-bold text-primary">{stats.partners ? `${stats.partners}+` : '—'}</div>
                <div className="text-gray-600">{t('home.stats.partners', 'Verified Partners')}</div>
              </div>
              <div>
                <div className="text-3xl md:text-4xl font-bold text-primary">{stats.resources ? `${stats.resources}+` : '—'}</div>
                <div className="text-gray-600">{t('home.stats.resources', 'Resources')}</div>
              </div>
              <div>
                <div className="text-3xl md:text-4xl font-bold text-primary">{stats.events ? `${stats.events}+` : '—'}</div>
                <div className="text-gray-600">{t('home.stats.events', 'Events')}</div>
              </div>
            </div>
          )}
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
            <h2 className="text-3xl font-bold text-primary">{t('home.ourPartners', 'Trusted by Industry Leaders')}</h2>
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
                <Link
                  key={partner.id}
                  to={`/organizations/${partner.slug}`}
                  className="bg-white rounded-lg p-6 flex flex-col items-center justify-center shadow-sm hover:shadow-md transition-shadow"
                >
                  {partner.logo_url ? (
                    <img src={partner.logo_url} alt={partner.name} className="w-16 h-16 rounded-full object-cover" />
                  ) : (
                    <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center text-primary font-bold text-xl">
                      {getInitials(partner.name)}
                    </div>
                  )}
                  <p className="text-xs text-gray-500 mt-2 text-center truncate max-w-full">{partner.name}</p>
                </Link>
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
            <h2 className="text-3xl font-bold mb-4">{t('home.ctaTitle', 'Ready to Grow Your Marina Business?')}</h2>
            <p className="text-xl text-gray-100 mb-8 max-w-2xl mx-auto">
              {t('home.ctaSubtitle', 'Join hundreds of marina professionals already on M3 Connect. It\'s free to get started.')}
            </p>
            <Button size="lg" variant="outline" className="bg-transparent border-white text-white hover:bg-white hover:text-secondary" asChild>
              <Link to="/become-partner">
                {t('home.joinNow', 'Create Free Account')}
                <ArrowRight className="ml-2 h-5 w-5" />
              </Link>
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
