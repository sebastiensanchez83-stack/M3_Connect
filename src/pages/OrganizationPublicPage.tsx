import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Helmet } from 'react-helmet-async';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/lib/supabase';
import {
  Building2, Globe, MapPin, Users, Mail, ChevronLeft,
  Loader2, ExternalLink, Anchor, Newspaper,
} from 'lucide-react';
import { Organization, OrganizationMember } from '@/types/database';

export function OrganizationPublicPage() {
  const { slug } = useParams<{ slug: string }>();
  const { t } = useTranslation();
  const [org, setOrg] = useState<Organization | null>(null);
  const [members, setMembers] = useState<(OrganizationMember & { profiles: { first_name: string | null; last_name: string | null; email: string | null; persona: string } })[]>([]);
  const [loading, setLoading] = useState(true);

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
        setOrg(orgData as Organization);

        // Fetch members
        const { data: membersData } = await supabase
          .from('organization_members')
          .select('id, organization_id, user_id, role, joined_at, profiles(first_name, last_name, email, persona)')
          .eq('organization_id', orgData.id)
          .order('joined_at', { ascending: true });

        if (membersData) setMembers(membersData as any);
      }
      setLoading(false);
    };
    fetchOrg();
  }, [slug]);

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
            </div>
          </div>
        </div>
      </section>

      {/* Content */}
      <div className="container mx-auto px-4 py-8 lg:py-12">
        <Tabs defaultValue="about" className="max-w-4xl mx-auto">
          <TabsList className="mb-8">
            <TabsTrigger value="about">About</TabsTrigger>
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
                    {org.primary_domain && (
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                          <Mail className="h-5 w-5" />
                        </div>
                        <div>
                          <div className="text-xs text-gray-500 uppercase tracking-wide">{t('org.domain')}</div>
                          <div className="font-medium text-gray-900">{org.primary_domain}</div>
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Representatives Tab */}
          <TabsContent value="representatives">
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {members.map((member) => {
                const name = `${member.profiles?.first_name || ''} ${member.profiles?.last_name || ''}`.trim();
                const initials = name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
                return (
                  <Card key={member.id} className="hover:shadow-md transition-shadow">
                    <CardContent className="pt-6 text-center">
                      <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xl mx-auto mb-3">
                        {initials || '??'}
                      </div>
                      <h3 className="font-semibold text-gray-900 mb-1">{name || 'Unknown'}</h3>
                      {member.profiles?.persona && (
                        <div className="flex items-center justify-center gap-1 text-sm text-gray-500">
                          {getPersonaIcon(member.profiles.persona)}
                          <span>{getPersonaLabel(member.profiles.persona)}</span>
                        </div>
                      )}
                      <Badge variant="outline" className="mt-2 text-xs">
                        {t(`org.${member.role}`)}
                      </Badge>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
