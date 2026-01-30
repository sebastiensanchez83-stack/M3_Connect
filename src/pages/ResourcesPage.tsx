import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Search, Download, Play, Lock } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

const mockResources = [
  { id: '1', title: 'Sustainable Marina Operations Guide', summary: 'Best practices for implementing sustainable operations in modern marinas. Learn how to reduce environmental impact while improving efficiency.', type: 'guide', topic: 'Sustainability', language: 'EN', access_level: 'public', thumbnail_url: 'https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=400', file_url: '#' },
  { id: '2', title: 'Digital Transformation in Ports', summary: 'How technology is reshaping the marina industry. Discover the latest trends in port digitalization.', type: 'whitepaper', topic: 'Technology', language: 'EN', access_level: 'members', thumbnail_url: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400', file_url: '#' },
  { id: '3', title: 'Smart Marina 2024 Highlights', summary: 'Key takeaways from our annual conference featuring industry leaders and innovators.', type: 'replay', topic: 'Events', language: 'EN', access_level: 'marina', thumbnail_url: 'https://images.unsplash.com/photo-1559827260-dc66d52bef19?w=400', file_url: '#' },
  { id: '4', title: 'Guide des Marinas Durables', summary: 'Meilleures pratiques pour une gestion durable des ports de plaisance en Méditerranée.', type: 'guide', topic: 'Sustainability', language: 'FR', access_level: 'public', thumbnail_url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400', file_url: '#' },
  { id: '5', title: 'Energy Efficiency Case Study: Port Monaco', summary: 'How Port Monaco reduced energy consumption by 40% through smart technologies.', type: 'case_study', topic: 'Energy', language: 'EN', access_level: 'members', thumbnail_url: 'https://images.unsplash.com/photo-1569263979104-865ab7cd8d13?w=400', file_url: '#' },
  { id: '6', title: 'Marina Management Best Practices', summary: 'Comprehensive article on modern marina management techniques and strategies.', type: 'article', topic: 'Management', language: 'EN', access_level: 'public', thumbnail_url: 'https://images.unsplash.com/photo-1540946485063-a40da27545f8?w=400', file_url: '#' },
];

export function ResourcesPage() {
  const { t } = useTranslation();
  const { user, profile } = useAuth();
  const [search, setSearch] = useState('');
  const [typeFilters, setTypeFilters] = useState<string[]>([]);
  const [languageFilter, setLanguageFilter] = useState('all');
  const [accessFilter, setAccessFilter] = useState('all');

  const types = ['article', 'whitepaper', 'guide', 'replay', 'case_study'];

  const filteredResources = mockResources.filter((resource) => {
    const matchesSearch = resource.title.toLowerCase().includes(search.toLowerCase()) ||
      resource.summary.toLowerCase().includes(search.toLowerCase());
    const matchesType = typeFilters.length === 0 || typeFilters.includes(resource.type);
    const matchesLanguage = languageFilter === 'all' || resource.language === languageFilter;
    const matchesAccess = accessFilter === 'all' || resource.access_level === accessFilter;
    return matchesSearch && matchesType && matchesLanguage && matchesAccess;
  });

  const canAccess = (level: string) => {
    if (level === 'public') return true;
    if (!user) return false;
    if (level === 'members') return true;
    if (level === 'marina') return profile?.role === 'marina' && profile?.status === 'verified'
    return false;
  };

  const getTypeBadge = (type: string) => {
    const colors: Record<string, string> = {
      article: 'bg-blue-100 text-blue-800',
      whitepaper: 'bg-purple-100 text-purple-800',
      guide: 'bg-green-100 text-green-800',
      replay: 'bg-red-100 text-red-800',
      case_study: 'bg-orange-100 text-orange-800',
    };
    return <span className={`px-2 py-1 rounded text-xs font-medium ${colors[type]}`}>{t(`resources.types.${type}`)}</span>;
  };

  const getAccessBadge = (level: string) => {
    switch (level) {
      case 'public': return <Badge variant="success">🌍 {t('resources.accessLevels.public')}</Badge>;
      case 'members': return <Badge variant="info">👤 {t('resources.accessLevels.members')}</Badge>;
      case 'marina': return <Badge variant="purple">⚓ {t('resources.accessLevels.marina')}</Badge>;
      default: return null;
    }
  };

  const toggleType = (type: string) => {
    setTypeFilters(prev => prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]);
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-primary mb-2">{t('resources.title')}</h1>
        <p className="text-gray-600">{t('resources.subtitle')}</p>
      </div>

      <div className="flex flex-col lg:flex-row gap-8">
        {/* Filters Sidebar */}
        <div className="w-full lg:w-64 space-y-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder={t('resources.search')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>

          <div>
            <h3 className="font-semibold mb-3">{t('resources.filters.type')}</h3>
            <div className="space-y-2">
              {types.map((type) => (
                <div key={type} className="flex items-center space-x-2">
                  <Checkbox
                    id={type}
                    checked={typeFilters.includes(type)}
                    onCheckedChange={() => toggleType(type)}
                  />
                  <label htmlFor={type} className="text-sm cursor-pointer">
                    {t(`resources.types.${type}`)}
                  </label>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h3 className="font-semibold mb-3">{t('resources.filters.language')}</h3>
            <Select value={languageFilter} onValueChange={setLanguageFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('resources.filters.all')}</SelectItem>
                <SelectItem value="EN">English</SelectItem>
                <SelectItem value="FR">Français</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <h3 className="font-semibold mb-3">{t('resources.filters.accessLevel')}</h3>
            <Select value={accessFilter} onValueChange={setAccessFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('resources.filters.all')}</SelectItem>
                <SelectItem value="public">{t('resources.accessLevels.public')}</SelectItem>
                <SelectItem value="members">{t('resources.accessLevels.members')}</SelectItem>
                <SelectItem value="marina">{t('resources.accessLevels.marina')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Resources Grid */}
        <div className="flex-1">
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-6">
            {filteredResources.map((resource) => (
              <Card key={resource.id} className="card-hover overflow-hidden">
                <div className="relative">
                  <img src={resource.thumbnail_url} alt={resource.title} className="w-full h-40 object-cover" />
                  {!canAccess(resource.access_level) && (
                    <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                      <div className="text-center text-white p-4">
                        <Lock className="h-8 w-8 mx-auto mb-2" />
                        <p className="text-sm">
                          {resource.access_level === 'members' ? t('resources.signupToAccess') : t('resources.verifyMarinaToAccess')}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
                <CardContent className="p-4">
                  <div className="flex flex-wrap gap-2 mb-2">
                    {getTypeBadge(resource.type)}
                    {getAccessBadge(resource.access_level)}
                  </div>
                  <h3 className="font-semibold mb-2 line-clamp-2">{resource.title}</h3>
                  <p className="text-gray-600 text-sm line-clamp-2 mb-4">{resource.summary}</p>
                  {canAccess(resource.access_level) && (
                    <Button size="sm" variant="outline" className="w-full">
                      {resource.type === 'replay' ? (
                        <><Play className="h-4 w-4 mr-2" />{t('resources.watchReplay')}</>
                      ) : (
                        <><Download className="h-4 w-4 mr-2" />{t('resources.download')}</>
                      )}
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
          {filteredResources.length === 0 && (
            <div className="text-center py-12 text-gray-500">No resources found matching your criteria.</div>
          )}
        </div>
      </div>
    </div>
  );
}
