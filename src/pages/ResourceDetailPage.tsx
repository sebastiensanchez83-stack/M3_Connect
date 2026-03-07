import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Helmet } from 'react-helmet-async';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { LoginForm } from '@/components/auth/LoginForm';
import { SignupForm } from '@/components/auth/SignupForm';
import {
  ChevronLeft, Download, Play, Lock, Calendar, Clock, Tag, FileText,
  RefreshCw, Share2, MapPin, ExternalLink, LogIn,
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
}

interface ResourceSpeaker {
  id: string;
  full_name: string;
  job_title: string | null;
  company_name: string | null;
  profile_id: string | null;
  display_order: number;
}

interface SpeakerProfile {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  persona: string;
  company_name?: string;
  marina_name?: string;
  media_name?: string;
  description?: string;
  website?: string;
  headquarters_country?: string;
  city?: string;
  country?: string;
}

export function ResourceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { user, profile, isVerified } = useAuth();
  const [resource, setResource] = useState<Resource | null>(null);
  const [relatedResources, setRelatedResources] = useState<Resource[]>([]);
  const [speakers, setSpeakers] = useState<ResourceSpeaker[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSpeakerProfile, setSelectedSpeakerProfile] = useState<SpeakerProfile | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [signupOpen, setSignupOpen] = useState(false);

  useEffect(() => {
    const fetchResource = async () => {
      if (!id) return;
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('resources')
          .select('*')
          .eq('id', id)
          .eq('published', true)
          .single();

        if (error || !data) {
          navigate('/resources', { replace: true });
          return;
        }
        setResource(data as Resource);

        // Fetch speakers
        const { data: speakerData } = await supabase
          .from('resource_speakers')
          .select('id, full_name, job_title, company_name, profile_id, display_order')
          .eq('resource_id', id)
          .order('display_order');
        setSpeakers((speakerData || []) as ResourceSpeaker[]);

        // Fetch related resources
        const { data: related } = await supabase
          .from('resources')
          .select('id, title, summary, type, topic, thumbnail_url, access_level, created_at, published_at, tags')
          .eq('published', true)
          .neq('id', id)
          .or(`type.eq.${data.type},topic.eq.${data.topic}`)
          .order('published_at', { ascending: false, nullsFirst: false })
          .limit(3);

        setRelatedResources((related || []) as Resource[]);
      } catch {
        navigate('/resources', { replace: true });
      } finally {
        setLoading(false);
      }
    };

    fetchResource();
    window.scrollTo(0, 0);
  }, [id, navigate]);

  const canAccess = (level: string) => {
    if (level === 'public') return true;
    if (!user) return false;
    if (level === 'members') return true;
    if (level === 'marina') return profile?.persona === 'marina' && isVerified;
    return false;
  };

  const getTypeBadgeColor = (type: string) => {
    const colors: Record<string, string> = {
      article: 'bg-blue-100 text-blue-700 border-blue-200',
      whitepaper: 'bg-purple-100 text-purple-700 border-purple-200',
      guide: 'bg-emerald-100 text-emerald-700 border-emerald-200',
      replay: 'bg-red-100 text-red-700 border-red-200',
      case_study: 'bg-amber-100 text-amber-700 border-amber-200',
    };
    return colors[type] || 'bg-gray-100 text-gray-700 border-gray-200';
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString(undefined, {
      year: 'numeric', month: 'long', day: 'numeric',
    });
  };

  const estimateReadTime = (content: string | null) => {
    if (!content) return 1;
    const plainText = content.replace(/<[^>]+>/g, '');
    const words = plainText.split(/\s+/).length;
    return Math.max(1, Math.ceil(words / 200));
  };

  const getInitials = (name: string) =>
    name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();

  const openSpeakerProfile = async (profileId: string) => {
    const { data: profileData } = await supabase
      .from('profiles')
      .select('user_id, first_name, last_name, email, persona')
      .eq('user_id', profileId)
      .single();
    if (!profileData) return;

    // Look up the speaker's organization via organization_members
    let extra: Record<string, unknown> = {};
    const { data: membership } = await supabase
      .from('organization_members')
      .select('organization_id, organizations(name, description, website, country, city, headquarters_country, audience_description, organization_type)')
      .eq('user_id', profileId)
      .maybeSingle();

    if (membership?.organizations) {
      const rawOrg = membership.organizations;
      const org = (Array.isArray(rawOrg) ? rawOrg[0] : rawOrg) as Record<string, unknown>;
      const orgType = org.organization_type as string;
      if (orgType === 'partner') {
        extra = { company_name: org.name, description: org.description, website: org.website, headquarters_country: org.headquarters_country };
      } else if (orgType === 'marina') {
        extra = { marina_name: org.name, website: org.website, country: org.country, city: org.city };
      } else if (orgType === 'media') {
        extra = { media_name: org.name, website: org.website, description: org.audience_description };
      }
    }

    setSelectedSpeakerProfile({ ...profileData, ...extra } as SpeakerProfile);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <RefreshCw className="h-8 w-8 animate-spin text-primary/40" />
      </div>
    );
  }

  if (!resource) return null;

  const hasAccess = canAccess(resource.access_level);
  const readTime = estimateReadTime(resource.content);
  const displayDate = resource.published_at || resource.created_at;
  const orgName = selectedSpeakerProfile?.company_name || selectedSpeakerProfile?.marina_name || selectedSpeakerProfile?.media_name;
  const speakerLocation = selectedSpeakerProfile?.city && selectedSpeakerProfile?.country
    ? `${selectedSpeakerProfile.city}, ${selectedSpeakerProfile.country}`
    : selectedSpeakerProfile?.headquarters_country || selectedSpeakerProfile?.country || null;

  return (
    <div className="min-h-screen bg-gray-50">
      <Helmet>
        <title>{resource.title} — M3 Connect</title>
        <meta name="description" content={resource.summary || `Read ${resource.title} on M3 Connect`} />
        <meta property="og:title" content={`${resource.title} — M3 Connect`} />
        <meta property="og:description" content={resource.summary || ''} />
        <meta property="og:type" content="article" />
        {resource.thumbnail_url && <meta property="og:image" content={resource.thumbnail_url} />}
      </Helmet>
      {/* Hero Header */}
      <div className="relative">
        {resource.thumbnail_url ? (
          <div className="w-full h-64 sm:h-80 lg:h-96 relative">
            <img src={resource.thumbnail_url} alt={resource.title} className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent" />
          </div>
        ) : (
          <div className="w-full h-64 sm:h-80 lg:h-96 bg-gradient-to-br from-[#1e3a5f] to-[#0d9488] relative">
            <div className="absolute inset-0 flex items-center justify-center opacity-10">
              <FileText className="h-40 w-40 text-white" />
            </div>
            <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
          </div>
        )}

        <div className="absolute top-4 left-4 z-10">
          <Button variant="ghost" size="sm" onClick={() => navigate('/resources')}
            className="bg-white/90 backdrop-blur-sm hover:bg-white text-gray-800 shadow-sm">
            <ChevronLeft className="h-4 w-4 mr-1" />
            {t('resourceDetail.backToResources')}
          </Button>
        </div>

        <div className="absolute bottom-0 left-0 right-0 z-10 px-4 pb-8">
          <div className="container mx-auto max-w-4xl">
            <div className="flex flex-wrap gap-2 mb-3">
              <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${getTypeBadgeColor(resource.type)}`}>
                {t(`resources.types.${resource.type}`)}
              </span>
              {resource.access_level !== 'public' && (
                <Badge variant={resource.access_level === 'members' ? 'info' : 'purple'} className="text-xs">
                  {t(`resources.accessLevels.${resource.access_level}`)}
                </Badge>
              )}
            </div>
            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-white leading-tight">
              {resource.title}
            </h1>
          </div>
        </div>
      </div>

      {/* Article Body */}
      <div className="container mx-auto max-w-4xl px-4">
        {/* Meta bar */}
        <div className="flex flex-wrap items-center gap-4 py-5 border-b border-gray-200 text-sm text-gray-500">
          <div className="flex items-center gap-1.5">
            <Calendar className="h-4 w-4" />
            <span>{formatDate(displayDate)}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Clock className="h-4 w-4" />
            <span>{readTime} {t('resourceDetail.minRead')}</span>
          </div>
          {resource.topic && (
            <div className="flex items-center gap-1.5">
              <Tag className="h-4 w-4" />
              <span className="capitalize">{resource.topic}</span>
            </div>
          )}
          <div className="flex-1" />
          <Button variant="ghost" size="sm" className="text-gray-500 hover:text-primary" onClick={() => {
            if (navigator.share) {
              navigator.share({ title: resource.title, url: window.location.href });
            } else {
              navigator.clipboard.writeText(window.location.href);
            }
          }}>
            <Share2 className="h-4 w-4 mr-1" />
            {t('resourceDetail.share')}
          </Button>
        </div>

        {/* Speakers */}
        {speakers.length > 0 && (
          <div className="py-5 border-b border-gray-200">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
              {t('resourceDetail.speakers')}
            </h3>
            <div className="flex flex-wrap gap-4">
              {speakers.map((speaker) => (
                <div key={speaker.id} className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold text-sm shrink-0">
                    {getInitials(speaker.full_name)}
                  </div>
                  <div>
                    {speaker.profile_id ? (
                      <button
                        onClick={() => openSpeakerProfile(speaker.profile_id!)}
                        className="font-medium text-primary hover:underline cursor-pointer text-left"
                      >
                        {speaker.full_name}
                      </button>
                    ) : (
                      <span className="font-medium text-gray-800">{speaker.full_name}</span>
                    )}
                    {(speaker.job_title || speaker.company_name) && (
                      <p className="text-sm text-gray-500">
                        {[speaker.job_title, speaker.company_name].filter(Boolean).join(' — ')}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Summary */}
        <div className="py-6">
          <p className="text-lg text-gray-600 leading-relaxed font-medium italic border-l-4 border-secondary pl-4">
            {resource.summary}
          </p>
        </div>

        {/* Content or Lock */}
        {hasAccess ? (
          <>
            {resource.content && (
              <article className="pb-8">
                <div
                  className="article-content text-gray-700 leading-relaxed"
                  dangerouslySetInnerHTML={{ __html: resource.content }}
                />
              </article>
            )}
            {resource.file_url && (
              <div className="py-6 border-t border-gray-200">
                <a href={resource.file_url} target="_blank" rel="noopener noreferrer">
                  <Button size="lg" className="bg-secondary hover:bg-secondary/90 text-white">
                    {resource.type === 'replay' ? (
                      <><Play className="h-5 w-5 mr-2" />{t('resources.watchReplay')}</>
                    ) : (
                      <><Download className="h-5 w-5 mr-2" />{t('resources.download')}</>
                    )}
                  </Button>
                </a>
              </div>
            )}
          </>
        ) : (
          <div className="relative">
            {/* Blurred preview of content */}
            {resource.content && (
              <div className="relative overflow-hidden max-h-64">
                <div
                  className="article-content text-gray-700 leading-relaxed select-none"
                  dangerouslySetInnerHTML={{ __html: resource.content }}
                  style={{ filter: 'blur(5px)', pointerEvents: 'none' }}
                />
                <div className="absolute inset-0 bg-gradient-to-b from-transparent via-white/60 to-white" />
              </div>
            )}
            {/* CTA overlay */}
            <div className="relative py-12 text-center bg-white">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4">
                <Lock className="h-8 w-8 text-primary" />
              </div>
              <h3 className="text-xl font-semibold text-gray-800 mb-2">
                {!user
                  ? t('resourceDetail.signupToRead', 'Sign up to read the full article')
                  : t('resourceDetail.restrictedTitle')}
              </h3>
              <p className="text-gray-500 mb-6 max-w-md mx-auto">
                {!user
                  ? t('resourceDetail.signupToReadDesc', 'Create a free account or log in to access this content and all member resources.')
                  : resource.access_level === 'members'
                  ? t('resources.signupToAccess')
                  : t('resources.verifyMarinaToAccess')}
              </p>
              {!user ? (
                <div className="flex items-center justify-center gap-3">
                  <Button size="lg" onClick={() => setSignupOpen(true)}>
                    {t('auth.signup', 'Sign Up')}
                  </Button>
                  <Button size="lg" variant="outline" onClick={() => setLoginOpen(true)}>
                    <LogIn className="h-4 w-4 mr-2" />
                    {t('auth.login', 'Log In')}
                  </Button>
                </div>
              ) : (
                <Link to="/account">
                  <Button size="lg" className="bg-primary hover:bg-primary/90">{t('resourceDetail.goToAccount')}</Button>
                </Link>
              )}
            </div>
          </div>
        )}

        {/* Tags */}
        {resource.tags && resource.tags.length > 0 && (
          <div className="py-6 border-t border-gray-200">
            <div className="flex flex-wrap gap-2">
              {resource.tags.map((tag) => (
                <span key={tag} className="px-3 py-1.5 bg-gray-100 text-gray-600 text-sm rounded-full hover:bg-gray-200 transition-colors">
                  #{tag}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Related Resources */}
        {relatedResources.length > 0 && (
          <div className="py-10 border-t border-gray-200">
            <h2 className="text-xl font-bold text-primary mb-6">{t('resourceDetail.relatedResources')}</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {relatedResources.map((rel) => (
                <Link key={rel.id} to={`/resources/${rel.id}`}
                  className="group block bg-white rounded-xl overflow-hidden shadow-sm border border-gray-100 hover:shadow-md transition-all duration-300 hover:-translate-y-0.5">
                  <div className="relative h-36">
                    {rel.thumbnail_url ? (
                      <img src={rel.thumbnail_url} alt={rel.title} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-primary/10 to-secondary/10 flex items-center justify-center">
                        <FileText className="h-8 w-8 text-primary/30" />
                      </div>
                    )}
                  </div>
                  <div className="p-4">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${getTypeBadgeColor(rel.type)}`}>
                      {t(`resources.types.${rel.type}`)}
                    </span>
                    <h3 className="font-semibold text-gray-800 mt-2 line-clamp-2 group-hover:text-primary transition-colors">
                      {rel.title}
                    </h3>
                    <p className="text-gray-500 text-sm mt-1 line-clamp-2">{rel.summary}</p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Login Dialog */}
      <Dialog open={loginOpen} onOpenChange={setLoginOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('auth.login')}</DialogTitle>
            <DialogDescription>
              {t('auth.noAccount')}{' '}
              <button className="text-primary hover:underline" onClick={() => { setLoginOpen(false); setSignupOpen(true); }}>
                {t('auth.signup')}
              </button>
            </DialogDescription>
          </DialogHeader>
          <LoginForm onSuccess={() => setLoginOpen(false)} />
        </DialogContent>
      </Dialog>

      {/* Signup Dialog */}
      <Dialog open={signupOpen} onOpenChange={setSignupOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('auth.signup')}</DialogTitle>
            <DialogDescription>
              {t('auth.haveAccount')}{' '}
              <button className="text-primary hover:underline" onClick={() => { setSignupOpen(false); setLoginOpen(true); }}>
                {t('auth.login')}
              </button>
            </DialogDescription>
          </DialogHeader>
          <SignupForm onSuccess={() => setSignupOpen(false)} />
        </DialogContent>
      </Dialog>

      {/* Speaker Profile Dialog */}
      <Dialog open={!!selectedSpeakerProfile} onOpenChange={() => setSelectedSpeakerProfile(null)}>
        <DialogContent className="max-w-md" aria-describedby={undefined}>
          {selectedSpeakerProfile && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-4">
                  <div className="w-14 h-14 bg-primary/10 rounded-full flex items-center justify-center text-primary font-bold text-lg shrink-0">
                    {getInitials(`${selectedSpeakerProfile.first_name || ''} ${selectedSpeakerProfile.last_name || ''}`.trim())}
                  </div>
                  <div>
                    <div>{selectedSpeakerProfile.first_name} {selectedSpeakerProfile.last_name}</div>
                    {orgName && (
                      <p className="text-sm font-normal text-gray-500 mt-0.5">{orgName}</p>
                    )}
                    <Badge variant="secondary" className="text-xs mt-1 capitalize">
                      {selectedSpeakerProfile.persona.replace('_', ' ')}
                    </Badge>
                  </div>
                </DialogTitle>
                <DialogDescription className="sr-only">
                  Profile of {selectedSpeakerProfile.first_name} {selectedSpeakerProfile.last_name}
                </DialogDescription>
              </DialogHeader>
              <div className="mt-4 space-y-3">
                {selectedSpeakerProfile.description && (
                  <p className="text-gray-600 text-sm leading-relaxed">{selectedSpeakerProfile.description}</p>
                )}
                {speakerLocation && (
                  <p className="text-sm text-gray-500 flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5" /> {speakerLocation}
                  </p>
                )}
                {selectedSpeakerProfile.website && (
                  <a
                    href={selectedSpeakerProfile.website.startsWith('http') ? selectedSpeakerProfile.website : `https://${selectedSpeakerProfile.website}`}
                    target="_blank" rel="noopener noreferrer"
                  >
                    <Button size="sm" variant="outline" className="mt-2">
                      <ExternalLink className="h-3.5 w-3.5 mr-1.5" /> Website
                    </Button>
                  </a>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
