import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Helmet } from 'react-helmet-async';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Search, Briefcase, FileText, MessageSquare, Globe, MapPin, Loader2,
  Users, Anchor, Building2, Newspaper, Filter, X, ArrowRight,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { Sector } from '@/types/database';
import { toast } from '@/hooks/use-toast';

/* ---------- local types ---------- */

interface OrgCard {
  id: string;
  slug: string;
  name: string;
  organization_type: string | null;
  website: string | null;
  country: string | null;
  city: string | null;
  headquarters_country: string | null;
  description: string | null;
  audience_description: string | null;
  logo_url: string | null;
  sectors: { id: string; label: string }[];
}

// Keep old interface name as alias for backward compat in contact dialog
type PartnerCard = OrgCard & { company_name: string; user_id: string };

interface RfpCard {
  id: string;
  title: string;
  scope: string | null;
  deadline_date: string | null;
  created_at: string;
  sector: { id: string; label: string } | null;
}

interface ConsultationCard {
  id: string;
  title: string;
  description: string | null;
  created_at: string;
  sector: { id: string; label: string } | null;
}


/* ---------- helpers ---------- */

function truncate(text: string | null | undefined, maxLen = 160): string {
  if (!text) return '';
  return text.length > maxLen ? text.slice(0, maxLen).trimEnd() + '...' : text;
}

function formatDate(iso: string | null, locale: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(locale === 'fr' ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function getInitials(name: string) {
  return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
}

/* ========== component ========== */

export function MarketplacePage() {
  const { t, i18n } = useTranslation();
  const { user, profile, isVerified, organization, loading: authLoading } = useAuth();

  /* --- data states --- */
  const [orgs, setOrgs] = useState<OrgCard[]>([]);
  const [rfps, setRfps] = useState<RfpCard[]>([]);
  const [consultations, setConsultations] = useState<ConsultationCard[]>([]);
  const [sectors, setSectors] = useState<Sector[]>([]);

  const [loadingOrgs, setLoadingOrgs] = useState(false);
  const [loadingRfps, setLoadingRfps] = useState(false);
  const [loadingConsultations, setLoadingConsultations] = useState(false);

  /* --- search & filters --- */
  const [partnerSearch, setPartnerSearch] = useState('');
  const [selectedSectors, setSelectedSectors] = useState<string[]>([]);
  const [typeFilter, setTypeFilter] = useState('all');
  const [sidebarOpen, setSidebarOpen] = useState(false); // mobile toggle

  /* --- contact dialog state --- */
  const [contactOpen, setContactOpen] = useState(false);
  const [contactPartner, setContactPartner] = useState<PartnerCard | null>(null);
  const [contactSectorId, setContactSectorId] = useState('');
  const [contactMessage, setContactMessage] = useState('');
  const [contactSending, setContactSending] = useState(false);

  const isMarina = profile?.persona === 'marina';

  /* ---- fetch sectors ---- */
  useEffect(() => {
    supabase
      .from('sectors')
      .select('*')
      .eq('is_active', true)
      .order('label')
      .then(({ data }) => {
        if (data) setSectors(data as Sector[]);
      });
  }, []);

  /* ---- pre-select sectors for logged-in users ---- */
  useEffect(() => {
    if (!user || !organization) return;
    const table = organization.organization_type === 'marina'
      ? 'organization_interest_sectors'
      : 'organization_service_sectors';
    supabase
      .from(table)
      .select('sector_id')
      .eq('organization_id', organization.id)
      .then(({ data }) => {
        if (data && data.length > 0) {
          setSelectedSectors(data.map((d: any) => d.sector_id));
        }
      });
  }, [user, organization]);

  /* ---- fetch organizations ---- */
  useEffect(() => {
    setLoadingOrgs(true);
    const fetchOrgs = async () => {
      try {
        const { data: orgRows, error: oErr } = await supabase
          .from('organizations')
          .select('id, slug, name, organization_type, website, country, city, headquarters_country, description, audience_description, logo_url, access_status')
          .eq('access_status', 'verified');

        if (oErr) throw oErr;
        if (!orgRows || orgRows.length === 0) {
          setOrgs([]);
          return;
        }

        const orgIds = orgRows.map((o: any) => o.id);

        // Fetch service sectors (partners) and interest sectors (marinas)
        const [{ data: serviceSectors }, { data: interestSectors }] = await Promise.all([
          supabase
            .from('organization_service_sectors')
            .select('organization_id, sector_id, sectors(id, label)')
            .in('organization_id', orgIds),
          supabase
            .from('organization_interest_sectors')
            .select('organization_id, sector_id, sectors(id, label)')
            .in('organization_id', orgIds),
        ]);

        const sectorMap: Record<string, { id: string; label: string }[]> = {};
        for (const link of [...(serviceSectors || []), ...(interestSectors || [])] as any[]) {
          const oid = link.organization_id;
          if (!sectorMap[oid]) sectorMap[oid] = [];
          if (link.sectors && !sectorMap[oid].some((s: any) => s.id === link.sectors.id)) {
            sectorMap[oid].push({ id: link.sectors.id, label: link.sectors.label });
          }
        }

        const cards: OrgCard[] = orgRows.map((o: any) => ({
          id: o.id,
          slug: o.slug,
          name: o.name,
          organization_type: o.organization_type,
          website: o.website,
          country: o.country,
          city: o.city,
          headquarters_country: o.headquarters_country,
          description: o.description,
          audience_description: o.audience_description,
          logo_url: o.logo_url || null,
          sectors: sectorMap[o.id] || [],
        }));

        setOrgs(cards);
      } catch (err) {
        console.error('Error fetching organizations:', err);
      } finally {
        setLoadingOrgs(false);
      }
    };

    fetchOrgs();
  }, []);

  /* ---- fetch RFPs ---- */
  useEffect(() => {
    if (!isVerified) return;
    setLoadingRfps(true);

    const fetchRfps = async () => {
      try {
        const { data, error } = await supabase
          .from('rfps')
          .select('id, title, scope, deadline_date, created_at, sector_id, sectors(id, label)')
          .eq('is_open', true)
          .order('created_at', { ascending: false });

        if (error) throw error;

        const cards: RfpCard[] = (data || []).map((r: any) => ({
          id: r.id,
          title: r.title,
          scope: r.scope,
          deadline_date: r.deadline_date,
          created_at: r.created_at,
          sector: r.sectors ? { id: r.sectors.id, label: r.sectors.label } : null,
        }));

        setRfps(cards);
      } catch (err) {
        console.error('Error fetching RFPs:', err);
      } finally {
        setLoadingRfps(false);
      }
    };

    fetchRfps();
  }, [isVerified]);

  /* ---- fetch Consultations ---- */
  useEffect(() => {
    if (!isVerified) return;
    setLoadingConsultations(true);

    const fetchConsultations = async () => {
      try {
        const { data, error } = await supabase
          .from('consultations')
          .select('id, title, description, created_at, sector_id, sectors(id, label)')
          .eq('is_open', true)
          .order('created_at', { ascending: false });

        if (error) throw error;

        const cards: ConsultationCard[] = (data || []).map((c: any) => ({
          id: c.id,
          title: c.title,
          description: c.description,
          created_at: c.created_at,
          sector: c.sectors ? { id: c.sectors.id, label: c.sectors.label } : null,
        }));

        setConsultations(cards);
      } catch (err) {
        console.error('Error fetching consultations:', err);
      } finally {
        setLoadingConsultations(false);
      }
    };

    fetchConsultations();
  }, [isVerified]);

  /* ---- contact dialog helpers ---- */
  const openContactDialog = (orgCard: OrgCard) => {
    if (!user) {
      toast({ title: t('marketplace.loginRequired', 'Please log in to contact organizations'), variant: 'destructive' });
      return;
    }
    // Build PartnerCard-compatible object for contact dialog
    const contactTarget: PartnerCard = {
      ...orgCard,
      company_name: orgCard.name,
      user_id: orgCard.id, // org id, used as key
    };
    setContactPartner(contactTarget);
    setContactSectorId('');
    setContactMessage('');
    setContactOpen(true);
  };

  const handleSendRequest = async () => {
    if (!user || !contactPartner) return;
    if (!contactSectorId) {
      toast({ title: t('marketplace.sectorRequired'), description: t('marketplace.sectorRequiredDesc'), variant: 'destructive' });
      return;
    }
    if (!contactMessage.trim()) {
      toast({ title: t('marketplace.messageRequired'), description: t('marketplace.messageRequiredDesc'), variant: 'destructive' });
      return;
    }

    setContactSending(true);
    try {
      // Get the owner of the target org to use as partner_user_id
      const { data: ownerMember } = await supabase
        .from('organization_members')
        .select('user_id')
        .eq('organization_id', contactPartner.id)
        .eq('role', 'owner')
        .maybeSingle();

      const targetUserId = ownerMember?.user_id || contactPartner.id;

      // Get user's org id for the marina side
      const userOrgId = organization?.id || null;

      const { error } = await supabase.from('partner_requests').insert({
        partner_user_id: targetUserId,
        marina_user_id: user.id,
        partner_organization_id: contactPartner.id,
        marina_organization_id: userOrgId,
        sector_id: contactSectorId,
        message: contactMessage.trim(),
        status: 'pending',
      });

      if (error) throw error;

      toast({ title: t('marketplace.requestSent'), description: t('marketplace.requestSentDesc', { name: contactPartner.company_name }) });
      setContactOpen(false);
    } catch (err: unknown) {
      toast({
        title: t('marketplace.error'),
        description: err instanceof Error ? err.message : t('marketplace.errorSending'),
        variant: 'destructive',
      });
    } finally {
      setContactSending(false);
    }
  };

  /* ---- org type helpers ---- */
  const getOrgTypeIcon = (type: string | null) => {
    switch (type) {
      case 'marina': return <Anchor className="h-3.5 w-3.5" />;
      case 'partner': return <Building2 className="h-3.5 w-3.5" />;
      case 'media_partner': return <Newspaper className="h-3.5 w-3.5" />;
      default: return <Building2 className="h-3.5 w-3.5" />;
    }
  };

  const getOrgTypeLabel = (type: string | null) => {
    switch (type) {
      case 'marina': return 'Marina';
      case 'partner': return 'Partner';
      case 'media_partner': return 'Media';
      default: return 'Organization';
    }
  };

  /* ---- sector helpers ---- */
  const toggleSector = (sectorId: string) => {
    setSelectedSectors((prev) =>
      prev.includes(sectorId) ? prev.filter((id) => id !== sectorId) : [...prev, sectorId]
    );
  };

  const selectAllSectors = () => setSelectedSectors(sectors.map((s) => s.id));
  const clearAllSectors = () => setSelectedSectors([]);

  // Count orgs per sector (from unfiltered org list)
  const sectorOrgCounts: Record<string, number> = {};
  for (const o of orgs) {
    for (const s of o.sectors) {
      sectorOrgCounts[s.id] = (sectorOrgCounts[s.id] || 0) + 1;
    }
  }

  /* ---- filtered organizations ---- */
  const filteredOrgs = orgs.filter((o) => {
    const matchesSearch = !partnerSearch.trim() || (
      o.name.toLowerCase().includes(partnerSearch.toLowerCase()) ||
      (o.country || '').toLowerCase().includes(partnerSearch.toLowerCase()) ||
      (o.city || '').toLowerCase().includes(partnerSearch.toLowerCase()) ||
      (o.headquarters_country || '').toLowerCase().includes(partnerSearch.toLowerCase()) ||
      (o.description || '').toLowerCase().includes(partnerSearch.toLowerCase()) ||
      o.sectors.some((s) => s.label.toLowerCase().includes(partnerSearch.toLowerCase()))
    );
    const matchesSector = selectedSectors.length === 0 || o.sectors.some(s => selectedSectors.includes(s.id));
    const matchesType = typeFilter === 'all' || o.organization_type === typeFilter;
    return matchesSearch && matchesSector && matchesType;
  });

  /* ========== render ========== */

  if (authLoading) {
    return (
      <div className="container mx-auto py-16 text-center">
        <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Helmet>
        <title>Marketplace — M3 Connect</title>
        <meta name="description" content="Find marina industry partners, service providers and experts. Browse open RFPs and consultation requests." />
        <meta property="og:title" content="Marketplace — M3 Connect" />
        <meta property="og:description" content="B2B marketplace connecting marina operators with service providers." />
      </Helmet>
      {/* Search Bar Section */}
      <section className="bg-white border-b shadow-sm">
        <div className="container mx-auto px-4 py-4">
          <div className="flex flex-col sm:flex-row gap-3 items-center">
            <div className="relative flex-1 w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder={t('marketplace.searchPartners', 'Search organizations by name, location, or description...')}
                value={partnerSearch}
                onChange={(e) => setPartnerSearch(e.target.value)}
                className="pl-10 h-11"
              />
            </div>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-full sm:w-48 h-11">
                <SelectValue placeholder={t('marketplace.filterByType', 'All Types')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('marketplace.allTypes', 'All Types')}</SelectItem>
                <SelectItem value="marina">{t('marketplace.typeMarina', 'Marinas')}</SelectItem>
                <SelectItem value="partner">{t('marketplace.typePartner', 'Partners')}</SelectItem>
                <SelectItem value="media_partner">{t('marketplace.typeMedia', 'Media')}</SelectItem>
              </SelectContent>
            </Select>
            {/* Mobile: toggle sidebar button */}
            <Button
              variant="outline"
              className="sm:hidden w-full h-11 gap-2"
              onClick={() => setSidebarOpen(!sidebarOpen)}
            >
              <Filter className="h-4 w-4" />
              {t('marketplace.filterBySector', 'Sectors')}
              {selectedSectors.length > 0 && (
                <Badge variant="secondary" className="ml-1 text-xs">{selectedSectors.length}</Badge>
              )}
            </Button>
          </div>
        </div>
      </section>

      <div className="container mx-auto px-4 py-6">
        <Tabs defaultValue="partners" className="space-y-6">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="partners" className="flex items-center gap-2">
              <Briefcase className="h-4 w-4" />
              <span className="hidden sm:inline">{t('marketplace.partnerDirectory')}</span>
              <span className="sm:hidden">{t('marketplace.partners')}</span>
            </TabsTrigger>
            <TabsTrigger value="rfps" className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              <span className="hidden sm:inline">{t('marketplace.openRfps')}</span>
              <span className="sm:hidden">{t('marketplace.rfps')}</span>
            </TabsTrigger>
            <TabsTrigger value="consultations" className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4" />
              <span className="hidden sm:inline">{t('marketplace.openConsultations')}</span>
              <span className="sm:hidden">{t('marketplace.consults')}</span>
            </TabsTrigger>
          </TabsList>

          {/* ====== TAB 1: Organization Directory ====== */}
          <TabsContent value="partners">
            <div className="flex gap-6">
              {/* ---- Sector Sidebar (desktop: always visible, mobile: toggled) ---- */}
              <aside className={`${sidebarOpen ? 'block' : 'hidden'} sm:block w-full sm:w-64 shrink-0`}>
                <Card className="sm:sticky sm:top-4">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-semibold text-sm text-gray-900 flex items-center gap-1.5">
                        <Filter className="h-4 w-4 text-primary" />
                        {t('marketplace.sectors', 'Sectors')}
                      </h3>
                      {/* Mobile close button */}
                      <Button variant="ghost" size="sm" className="sm:hidden h-7 w-7 p-0" onClick={() => setSidebarOpen(false)}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>

                    <div className="flex gap-2 mb-3">
                      <Button variant="outline" size="sm" className="text-xs h-7 flex-1" onClick={selectAllSectors}>
                        {t('marketplace.selectAll', 'Select All')}
                      </Button>
                      <Button variant="outline" size="sm" className="text-xs h-7 flex-1" onClick={clearAllSectors}>
                        {t('marketplace.clearAll', 'Clear All')}
                      </Button>
                    </div>

                    <div className="space-y-1 max-h-[60vh] overflow-y-auto pr-1">
                      {sectors.map((sector) => (
                        <label
                          key={sector.id}
                          className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-gray-50 cursor-pointer transition-colors"
                        >
                          <Checkbox
                            id={`sector-${sector.id}`}
                            checked={selectedSectors.includes(sector.id)}
                            onCheckedChange={() => toggleSector(sector.id)}
                          />
                          <span className="text-sm text-gray-700 flex-1 truncate">{sector.label}</span>
                          <span className="text-xs text-gray-400 tabular-nums">{sectorOrgCounts[sector.id] || 0}</span>
                        </label>
                      ))}
                    </div>

                    {selectedSectors.length > 0 && (
                      <p className="text-xs text-gray-500 mt-3 pt-2 border-t">
                        {selectedSectors.length} {t('marketplace.sectorsSelected', 'sector(s) selected')}
                      </p>
                    )}
                  </CardContent>
                </Card>
              </aside>

              {/* ---- Organization Grid (main content area) ---- */}
              <div className="flex-1 min-w-0">
                {/* Result count */}
                <div className="flex items-center justify-between mb-4">
                  <p className="text-sm text-gray-500">
                    {t('marketplace.showing', 'Showing')} <span className="font-semibold text-gray-900">{filteredOrgs.length}</span> {t('marketplace.of', 'of')} {orgs.length} {t('marketplace.organizations', 'organizations')}
                  </p>
                  {/* Active sector chips on desktop */}
                  {selectedSectors.length > 0 && selectedSectors.length <= 5 && (
                    <div className="hidden sm:flex gap-1 flex-wrap">
                      {selectedSectors.map((sid) => {
                        const s = sectors.find((sec) => sec.id === sid);
                        return s ? (
                          <Badge key={sid} variant="secondary" className="text-xs gap-1 cursor-pointer hover:bg-gray-200" onClick={() => toggleSector(sid)}>
                            {s.label}
                            <X className="h-3 w-3" />
                          </Badge>
                        ) : null;
                      })}
                    </div>
                  )}
                </div>

                {loadingOrgs ? (
                  <div className="py-12 text-center">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto text-primary" />
                    <p className="text-sm text-gray-400 mt-2">{t('marketplace.loadingPartners')}</p>
                  </div>
                ) : filteredOrgs.length === 0 ? (
                  <div className="py-12 text-center">
                    <Briefcase className="h-10 w-10 mx-auto text-gray-300 mb-3" />
                    <p className="text-gray-500">
                      {partnerSearch.trim() || selectedSectors.length > 0 || typeFilter !== 'all'
                        ? t('marketplace.noMatchingPartners')
                        : t('marketplace.noVerifiedPartners')}
                    </p>
                    {selectedSectors.length > 0 && (
                      <Button variant="link" size="sm" className="mt-2" onClick={clearAllSectors}>
                        {t('marketplace.clearFilters', 'Clear sector filters')}
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                    {filteredOrgs.map((orgCard) => (
                      <Link
                        key={orgCard.id}
                        to={`/organizations/${orgCard.slug}`}
                        className="block"
                      >
                        <Card className="card-hover cursor-pointer flex flex-col h-full">
                          <CardContent className="p-5 flex flex-col flex-1">
                            <div className="flex items-center gap-3 mb-3">
                              {orgCard.logo_url ? (
                                <img src={orgCard.logo_url} alt={orgCard.name} className="w-14 h-14 rounded-lg object-cover border" />
                              ) : (
                                <div className="w-14 h-14 bg-primary/10 rounded-lg flex items-center justify-center text-primary font-bold text-lg shrink-0">
                                  {getInitials(orgCard.name)}
                                </div>
                              )}
                              <div className="min-w-0">
                                <h3 className="font-semibold text-gray-900 truncate">{orgCard.name}</h3>
                                <div className="flex items-center gap-2 mt-0.5">
                                  <Badge variant="outline" className="text-xs gap-1 py-0">
                                    {getOrgTypeIcon(orgCard.organization_type)}
                                    {getOrgTypeLabel(orgCard.organization_type)}
                                  </Badge>
                                </div>
                                {(orgCard.city || orgCard.country) && (
                                  <span className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                                    <MapPin className="h-3 w-3" />
                                    {[orgCard.city, orgCard.country].filter(Boolean).join(', ')}
                                  </span>
                                )}
                              </div>
                            </div>

                            {(orgCard.description || orgCard.audience_description) && (
                              <p className="text-sm text-gray-600 leading-relaxed mb-3 line-clamp-2">
                                {orgCard.description || orgCard.audience_description}
                              </p>
                            )}

                            {orgCard.sectors.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-auto pt-2">
                                {orgCard.sectors.slice(0, 4).map((s) => (
                                  <Badge key={s.id} variant="secondary" className="text-xs">
                                    {s.label}
                                  </Badge>
                                ))}
                                {orgCard.sectors.length > 4 && (
                                  <Badge variant="outline" className="text-xs">+{orgCard.sectors.length - 4}</Badge>
                                )}
                              </div>
                            )}

                            <div className="flex items-center gap-1 mt-3 pt-2 border-t text-xs text-primary font-medium">
                              {t('marketplace.viewProfile', 'View Profile')} <ArrowRight className="h-3 w-3" />
                            </div>
                          </CardContent>
                        </Card>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </TabsContent>

          {/* ====== TAB 2: Open RFPs ====== */}
          <TabsContent value="rfps" className="space-y-6">
            {!isVerified ? (
              <div className="py-12 text-center">
                <FileText className="h-10 w-10 mx-auto text-gray-300 mb-3" />
                <p className="text-gray-500 mb-4">{t('marketplace.verifiedOnly')}</p>
                {!user ? (
                  <Link to="/become-partner"><Button>{t('marketplace.signUp', 'Sign Up')}</Button></Link>
                ) : (
                  <Link to="/account"><Button>{t('marketplace.viewAccountStatus')}</Button></Link>
                )}
              </div>
            ) : loadingRfps ? (
              <div className="py-12 text-center">
                <Loader2 className="h-6 w-6 animate-spin mx-auto text-primary" />
                <p className="text-sm text-gray-400 mt-2">{t('marketplace.loadingRfps')}</p>
              </div>
            ) : rfps.length === 0 ? (
              <div className="py-12 text-center">
                <FileText className="h-10 w-10 mx-auto text-gray-300 mb-3" />
                <p className="text-gray-500">{t('marketplace.noOpenRfps')}</p>
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {rfps.map((rfp) => (
                  <Card key={rfp.id}>
                    <CardHeader>
                      <div className="flex items-start justify-between gap-3">
                        <CardTitle className="text-lg">{rfp.title}</CardTitle>
                        {rfp.sector && (
                          <Badge variant="secondary" className="shrink-0 text-xs">{rfp.sector.label}</Badge>
                        )}
                      </div>
                      {rfp.deadline_date && (
                        <CardDescription>
                          {t('marketplace.deadline')}: {formatDate(rfp.deadline_date, i18n.language)}
                        </CardDescription>
                      )}
                    </CardHeader>
                    <CardContent>
                      {rfp.scope && (
                        <p className="text-sm text-gray-600 mb-3 leading-relaxed">{truncate(rfp.scope, 200)}</p>
                      )}
                      <p className="text-xs text-gray-400">
                        {t('marketplace.posted')} {formatDate(rfp.created_at, i18n.language)}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* ====== TAB 3: Open Consultations ====== */}
          <TabsContent value="consultations" className="space-y-6">
            {!isVerified ? (
              <div className="py-12 text-center">
                <MessageSquare className="h-10 w-10 mx-auto text-gray-300 mb-3" />
                <p className="text-gray-500 mb-4">{t('marketplace.verifiedOnly')}</p>
                {!user ? (
                  <Link to="/become-partner"><Button>{t('marketplace.signUp', 'Sign Up')}</Button></Link>
                ) : (
                  <Link to="/account"><Button>{t('marketplace.viewAccountStatus')}</Button></Link>
                )}
              </div>
            ) : loadingConsultations ? (
              <div className="py-12 text-center">
                <Loader2 className="h-6 w-6 animate-spin mx-auto text-primary" />
                <p className="text-sm text-gray-400 mt-2">{t('marketplace.loadingConsultations')}</p>
              </div>
            ) : consultations.length === 0 ? (
              <div className="py-12 text-center">
                <MessageSquare className="h-10 w-10 mx-auto text-gray-300 mb-3" />
                <p className="text-gray-500">{t('marketplace.noOpenConsultations')}</p>
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {consultations.map((c) => (
                  <Card key={c.id}>
                    <CardHeader>
                      <div className="flex items-start justify-between gap-3">
                        <CardTitle className="text-lg">{c.title}</CardTitle>
                        {c.sector && (
                          <Badge variant="secondary" className="shrink-0 text-xs">{c.sector.label}</Badge>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent>
                      {c.description && (
                        <p className="text-sm text-gray-600 mb-3 leading-relaxed">{truncate(c.description, 200)}</p>
                      )}
                      <p className="text-xs text-gray-400">
                        {t('marketplace.posted')} {formatDate(c.created_at, i18n.language)}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* ====== Contact Organization Dialog ====== */}
      <Dialog open={contactOpen} onOpenChange={setContactOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('marketplace.contactPartner', { name: contactPartner?.company_name })}</DialogTitle>
            <DialogDescription>{t('marketplace.contactDescription')}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label>{t('marketplace.sector')} *</Label>
              <Select value={contactSectorId} onValueChange={setContactSectorId}>
                <SelectTrigger>
                  <SelectValue placeholder={t('marketplace.selectSector')} />
                </SelectTrigger>
                <SelectContent>
                  {(contactPartner?.sectors && contactPartner.sectors.length > 0
                    ? contactPartner.sectors
                    : sectors
                  ).map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>{t('marketplace.message')} *</Label>
              <Textarea
                value={contactMessage}
                onChange={(e) => setContactMessage(e.target.value)}
                rows={4}
                placeholder={t('marketplace.messagePlaceholder')}
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setContactOpen(false)} disabled={contactSending}>
                {t('common.cancel')}
              </Button>
              <Button onClick={handleSendRequest} disabled={contactSending}>
                {contactSending ? (
                  <><Loader2 className="h-4 w-4 animate-spin mr-2" />{t('marketplace.sending')}</>
                ) : (
                  t('marketplace.sendRequest')
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
