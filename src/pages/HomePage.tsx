import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  Anchor, 
  ArrowRight
} from 'lucide-react';

// Demo data
const featuredResources = [
  {
    id: '1',
    title: 'Sustainable Marina Operations Guide',
    summary: 'Best practices for implementing sustainable operations in modern marinas.',
    type: 'guide',
    access_level: 'public',
    thumbnail_url: 'https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=400',
  },
  {
    id: '2',
    title: 'Digital Transformation in Ports',
    summary: 'How technology is reshaping the marina industry.',
    type: 'whitepaper',
    access_level: 'members',
    thumbnail_url: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400',
  },
  {
    id: '3',
    title: 'Smart Marina 2024 Highlights',
    summary: 'Key takeaways from our annual conference.',
    type: 'replay',
    access_level: 'marina',
    thumbnail_url: 'https://images.unsplash.com/photo-1559827260-dc66d52bef19?w=400',
  },
];

const upcomingEvents = [
  {
    id: '1',
    title: 'Webinar: Energy Efficiency Solutions',
    date_time: '2025-02-15T14:00:00Z',
    access_level: 'public',
  },
  {
    id: '2',
    title: 'Marina Managers Roundtable',
    date_time: '2025-02-22T10:00:00Z',
    access_level: 'marina',
  },
  {
    id: '3',
    title: 'Partner Showcase: Digital Tools',
    date_time: '2025-03-01T15:00:00Z',
    access_level: 'members',
  },
];

const partners = [
  { name: 'Marina Tech', logo: 'MT' },
  { name: 'EcoPorts', logo: 'EP' },
  { name: 'Digital Marina', logo: 'DM' },
  { name: 'GreenShore', logo: 'GS' },
  { name: 'PortConnect', logo: 'PC' },
  { name: 'AquaSmart', logo: 'AS' },
];

export function HomePage() {
  const { t } = useTranslation();

  const getAccessBadge = (level: string) => {
    switch (level) {
      case 'public':
        return <Badge variant="success">🌍 {t('resources.accessLevels.public')}</Badge>;
      case 'members':
        return <Badge variant="info">👤 {t('resources.accessLevels.members')}</Badge>;
      case 'marina':
        return <Badge variant="purple">⚓ {t('resources.accessLevels.marina')}</Badge>;
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

  return (
    <div className="flex flex-col">
      {/* Hero Section */}
      <section className="gradient-hero text-white py-20 md:py-32">
        <div className="container mx-auto px-4 text-center">
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
        </div>
      </section>

      {/* Stats Bar */}
      <section className="bg-white py-8 border-b">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            <div>
              <div className="text-3xl md:text-4xl font-bold text-primary">500+</div>
              <div className="text-gray-600">{t('home.stats.marinas')}</div>
            </div>
            <div>
              <div className="text-3xl md:text-4xl font-bold text-primary">50+</div>
              <div className="text-gray-600">{t('home.stats.partners')}</div>
            </div>
            <div>
              <div className="text-3xl md:text-4xl font-bold text-primary">100+</div>
              <div className="text-gray-600">{t('home.stats.resources')}</div>
            </div>
            <div>
              <div className="text-3xl md:text-4xl font-bold text-primary">20+</div>
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
          <div className="grid md:grid-cols-3 gap-6">
            {featuredResources.map((resource) => (
              <Card key={resource.id} className="card-hover overflow-hidden">
                <img
                  src={resource.thumbnail_url}
                  alt={resource.title}
                  className="w-full h-48 object-cover"
                />
                <CardContent className="p-4">
                  <div className="flex gap-2 mb-2">
                    {getTypeBadge(resource.type)}
                    {getAccessBadge(resource.access_level)}
                  </div>
                  <h3 className="font-semibold text-lg mb-2">{resource.title}</h3>
                  <p className="text-gray-600 text-sm line-clamp-2">{resource.summary}</p>
                </CardContent>
              </Card>
            ))}
          </div>
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
          <div className="grid md:grid-cols-3 gap-6">
            {upcomingEvents.map((event) => (
              <Card key={event.id} className="card-hover">
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
            ))}
          </div>
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
          <div className="grid grid-cols-3 md:grid-cols-6 gap-6">
            {partners.map((partner) => (
              <div
                key={partner.name}
                className="bg-white rounded-lg p-6 flex items-center justify-center shadow-sm hover:shadow-md transition-shadow"
              >
                <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center text-primary font-bold text-xl">
                  {partner.logo}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Banner */}
      <section className="py-16 bg-secondary text-white">
        <div className="container mx-auto px-4 text-center">
          <Anchor className="h-12 w-12 mx-auto mb-4" />
          <h2 className="text-3xl font-bold mb-4">{t('home.ctaTitle')}</h2>
          <p className="text-xl text-gray-100 mb-8 max-w-2xl mx-auto">
            {t('home.ctaSubtitle')}
          </p>
          <Button size="lg" variant="outline" className="bg-transparent border-white text-white hover:bg-white hover:text-secondary">
            {t('home.joinNow')}
          </Button>
        </div>
      </section>
    </div>
  );
}
