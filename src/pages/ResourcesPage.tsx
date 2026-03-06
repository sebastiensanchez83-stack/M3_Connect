import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
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
import {
  Search, Lock, FileText, RefreshCw, Calendar, Clock, ArrowRight, BookOpen, Tag, Users,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';

interface Resource {
  id: string;
  title: string;
  summary: string;
  content: string | null;
  type: string;
  topic: string;
  language: string;
  access_level: string;
  thumbnail_url: string | null;
  file_url: string | null;
  published: boolean;
  created_at: string;
  published_at: string | null;
  tags: string[];
  resource_speakers?: { id: string; full_name: string; profile_id: string | null; display_order: number }[];
}

const TYPE_COLORS: Record<string, string> = {
  article: 'bg-blue-100 text-blue-700 border-blue-200',
  whitepaper: 'bg-purple-100 text-purple-700 border-purple-200',
  guide: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  replay: 'bg-red-100 text-red-700 border-red-200',
  case_study: 'bg-amber-100 text-amber-700 border-amber-200',
};

export function ResourcesPage() {
  const { t } = useTranslation();
  const { user, profile, isVerified } = useAuth();
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeType, setActiveType] = useState('all');
  const [languageFilter, setLanguageFilter] = useState('all');
  const [accessFilter, setAccessFilter] = useState('all');

  const types = ['article', 'whitepaper', 'guide', 'replay', 'case_study'];

  useEffect(() => {
    const fetchResources = async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('resources')
          .select('*, resource_speakers(id, full_name, profile_id, display_order)')
          .eq('published', true)
          .order('published_at', { ascending: false, nullsFirst: false });

        if (error) throw error;
        setResources((data || []) as Resource[]);
      } catch (err) {
        console.error('Error fetching resources:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchResources();
  }, []);

  const filteredResources = useMemo(() => {
    return resources.filter((r) => {
      const matchesSearch =
        r.title.toLowerCase().includes(search.toLowerCase()) ||
        r.summary.toLowerCase().includes(search.toLowerCase()) ||
        (r.tags || []).some((tag) => tag.toLowerCase().includes(search.toLowerCase()));
      const matchesType = activeType === 'all' || r.type === activeType;
      const matchesLang = languageFilter === 'all' || r.language === languageFilter;
      const matchesAccess = accessFilter === 'all' || r.access_level === accessFilter;
      return matchesSearch && matchesType && matchesLang && matchesAccess;
    });
  }, [resources, search, activeType, languageFilter, accessFilter]);

  const featuredResource = filteredResources[0] || null;
  const remainingResources = filteredResources.slice(1);

  const canAccess = (level: string) => {
    if (level === 'public') return true;
    if (!user) return false;
    if (level === 'members') return true;
    if (level === 'marina') return profile?.persona === 'marina' && isVerified;
    return false;
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const estimateReadTime = (content: string | null) => {
    if (!content) return 1;
    const words = content.replace(/<[^>]+>/g, '').split(/\s+/).length;
    return Math.max(1, Math.ceil(words / 200));
  };

  const clearFilters = () => {
    setSearch('');
    setActiveType('all');
    setLanguageFilter('all');
    setAccessFilter('all');
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Helmet>
        <title>Resources — M3 Connect</title>
        <meta name="description" content="Browse articles, whitepapers, guides and case studies about the marina industry on M3 Connect." />
        <meta property="og:title" content="Resources — M3 Connect" />
        <meta property="og:description" content="Explore marina industry resources: articles, whitepapers, guides and case studies." />
      </Helmet>
      {/* Hero Section */}
      <section className="bg-gradient-to-br from-[#1e3a5f] to-[#0d9488] text-white">
        <div className="container mx-auto px-4 py-14 lg:py-20">
          <div className="max-w-3xl mx-auto text-center">
            <div className="inline-flex items-center gap-2 bg-white/15 backdrop-blur-sm rounded-full px-4 py-1.5 text-sm mb-6">
              <BookOpen className="h-4 w-4" />
              <span>{t('resources.heroTag')}</span>
            </div>
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold mb-4 leading-tight">
              {t('resources.title')}
            </h1>
            <p className="text-lg text-white/80 mb-8 max-w-2xl mx-auto">
              {t('resources.subtitle')}
            </p>
            {/* Search Bar */}
            <div className="relative max-w-xl mx-auto">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
              <Input
                placeholder={t('resources.search')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-12 pr-4 py-3 h-12 bg-white text-gray-800 border-0 rounded-full shadow-lg text-base placeholder:text-gray-400"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Filters Bar */}
      <section className="sticky top-0 z-30 bg-white border-b border-gray-200 shadow-sm">
        <div className="container mx-auto px-4">
          <div className="flex items-center gap-3 py-3 overflow-x-auto no-scrollbar">
            {/* Type pills */}
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <button
                onClick={() => setActiveType('all')}
                className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all whitespace-nowrap ${
                  activeType === 'all'
                    ? 'bg-primary text-white shadow-sm'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {t('resources.filters.all')}
              </button>
              {types.map((type) => (
                <button
                  key={type}
                  onClick={() => setActiveType(type)}
                  className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all whitespace-nowrap ${
                    activeType === type
                      ? 'bg-primary text-white shadow-sm'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {t(`resources.types.${type}`)}
                </button>
              ))}
            </div>
            <div className="flex-1" />
            {/* Additional filters — hide access filter for verified users (they see all) and logged-out users */}
            <div className="flex items-center gap-2 flex-shrink-0">
              {user && !isVerified && (
                <Select value={accessFilter} onValueChange={setAccessFilter}>
                  <SelectTrigger className="h-8 w-[120px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('resources.filters.accessLevel')}</SelectItem>
                    <SelectItem value="public">{t('resources.accessLevels.public')}</SelectItem>
                    <SelectItem value="members">{t('resources.accessLevels.members')}</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Content */}
      <div className="container mx-auto px-4 py-8 lg:py-12">
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <RefreshCw className="h-8 w-8 animate-spin text-primary/40" />
          </div>
        ) : filteredResources.length === 0 ? (
          <div className="text-center py-24">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-gray-100 mb-4">
              <FileText className="h-10 w-10 text-gray-300" />
            </div>
            <p className="text-gray-500 text-lg mb-2">
              {resources.length === 0
                ? t('resources.noResources')
                : t('resources.noMatch')}
            </p>
            {resources.length > 0 && (
              <Button variant="outline" size="sm" onClick={clearFilters}>
                {t('resources.clearFilters')}
              </Button>
            )}
          </div>
        ) : (
          <>
            {/* Featured Article (first result) */}
            {featuredResource && (
              <Link
                to={`/resources/${featuredResource.id}`}
                className="group block mb-10"
              >
                <div className="relative bg-white rounded-2xl overflow-hidden shadow-sm border border-gray-100 hover:shadow-lg transition-all duration-300">
                  <div className="grid lg:grid-cols-2">
                    {/* Image */}
                    <div className="relative h-64 lg:h-80">
                      {featuredResource.thumbnail_url ? (
                        <img
                          src={featuredResource.thumbnail_url}
                          alt={featuredResource.title}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                        />
                      ) : (
                        <div className="w-full h-full bg-gradient-to-br from-primary/10 to-secondary/10 flex items-center justify-center">
                          <FileText className="h-16 w-16 text-primary/20" />
                        </div>
                      )}
                      {!canAccess(featuredResource.access_level) && (
                        <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                          <Lock className="h-10 w-10 text-white/80" />
                        </div>
                      )}
                      <div className="absolute top-4 left-4">
                        <span className="px-3 py-1 bg-secondary text-white text-xs font-bold rounded-full uppercase tracking-wide">
                          {t('resources.featured')}
                        </span>
                      </div>
                    </div>
                    {/* Content */}
                    <div className="p-6 lg:p-8 flex flex-col justify-center">
                      <div className="flex flex-wrap items-center gap-2 mb-3">
                        <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${TYPE_COLORS[featuredResource.type] || ''}`}>
                          {t(`resources.types.${featuredResource.type}`)}
                        </span>
                        {featuredResource.access_level !== 'public' && (
                          <Badge variant={featuredResource.access_level === 'members' ? 'info' : 'purple'} className="text-xs">
                            {t(`resources.accessLevels.${featuredResource.access_level}`)}
                          </Badge>
                        )}
                      </div>
                      <h2 className="text-xl lg:text-2xl font-bold text-gray-900 mb-3 group-hover:text-primary transition-colors leading-tight">
                        {featuredResource.title}
                      </h2>
                      <p className="text-gray-600 line-clamp-3 mb-4 leading-relaxed">
                        {featuredResource.summary}
                      </p>
                      <div className="flex items-center gap-4 text-sm text-gray-400 mb-4">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3.5 w-3.5" />
                          {formatDate(featuredResource.published_at || featuredResource.created_at)}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5" />
                          {estimateReadTime(featuredResource.content)} {t('resourceDetail.minRead')}
                        </span>
                      </div>
                      {featuredResource.resource_speakers && featuredResource.resource_speakers.length > 0 && (
                        <div className="flex items-center gap-2 text-sm text-gray-500 mb-2">
                          <Users className="h-4 w-4 shrink-0" />
                          <span>
                            {featuredResource.resource_speakers
                              .sort((a, b) => a.display_order - b.display_order)
                              .map(s => s.full_name)
                              .join(', ')}
                          </span>
                        </div>
                      )}
                      <div className="flex items-center gap-1 text-primary font-semibold text-sm group-hover:gap-2 transition-all">
                        {t('resources.readMore')} <ArrowRight className="h-4 w-4" />
                      </div>
                    </div>
                  </div>
                </div>
              </Link>
            )}

            {/* Results count */}
            {filteredResources.length > 0 && (
              <div className="flex items-center justify-between mb-6">
                <p className="text-sm text-gray-500">
                  {filteredResources.length} {t('resources.resultsCount')}
                </p>
              </div>
            )}

            {/* Resources Grid */}
            {remainingResources.length > 0 && (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {remainingResources.map((resource) => (
                  <ResourceCard
                    key={resource.id}
                    resource={resource}
                    canAccess={canAccess(resource.access_level)}
                    formatDate={formatDate}
                    estimateReadTime={estimateReadTime}
                    t={t}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ─── Resource Card ─────────────────────────────────────────────── */

function ResourceCard({
  resource,
  canAccess,
  formatDate,
  estimateReadTime,
  t,
}: {
  resource: Resource;
  canAccess: boolean;
  formatDate: (d: string) => string;
  estimateReadTime: (c: string | null) => number;
  t: ReturnType<typeof useTranslation>['t'];
}) {
  return (
    <Link
      to={`/resources/${resource.id}`}
      className="group block bg-white rounded-xl overflow-hidden shadow-sm border border-gray-100 hover:shadow-md transition-all duration-300 hover:-translate-y-0.5"
    >
      {/* Image */}
      <div className="relative aspect-[16/10] overflow-hidden">
        {resource.thumbnail_url ? (
          <img
            src={resource.thumbnail_url}
            alt={resource.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-primary/10 to-secondary/10 flex items-center justify-center">
            <FileText className="h-10 w-10 text-primary/20" />
          </div>
        )}
        {!canAccess && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
            <div className="text-center text-white p-3">
              <Lock className="h-6 w-6 mx-auto mb-1" />
              <p className="text-xs font-medium">
                {resource.access_level === 'members'
                  ? t('resources.signupToAccess')
                  : t('resources.verifyMarinaToAccess')}
              </p>
            </div>
          </div>
        )}
        {/* Type badge on image */}
        <div className="absolute top-3 left-3">
          <span className={`px-2.5 py-1 rounded-full text-xs font-semibold border backdrop-blur-sm bg-white/90 ${TYPE_COLORS[resource.type] || ''}`}>
            {t(`resources.types.${resource.type}`)}
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="p-4">
        <div className="flex items-center gap-3 text-xs text-gray-400 mb-2">
          <span className="flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            {formatDate(resource.published_at || resource.created_at)}
          </span>
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {estimateReadTime(resource.content)} min
          </span>
        </div>
        <h3 className="font-semibold text-gray-800 line-clamp-2 mb-2 group-hover:text-primary transition-colors leading-snug">
          {resource.title}
        </h3>
        <p className="text-gray-500 text-sm line-clamp-2 leading-relaxed">
          {resource.summary}
        </p>

        {/* Speakers */}
        {resource.resource_speakers && resource.resource_speakers.length > 0 && (
          <div className="flex items-center gap-1.5 text-xs text-gray-400 mt-2">
            <Users className="h-3 w-3 shrink-0" />
            <span className="truncate">
              {resource.resource_speakers
                .sort((a, b) => a.display_order - b.display_order)
                .map(s => s.full_name)
                .join(', ')}
            </span>
          </div>
        )}

        {/* Tags */}
        {resource.tags && resource.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {resource.tags.slice(0, 3).map((tag) => (
              <span key={tag} className="flex items-center gap-0.5 text-xs text-gray-400 bg-gray-50 px-2 py-0.5 rounded-full">
                <Tag className="h-2.5 w-2.5" />{tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}
