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
  Users, Anchor, Building2, Newspaper, Filter, X, ArrowRight, Calendar, Clock,
} from 'lucide-react';
import { LoadingSkeleton } from '@/components/LoadingSkeleton';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { Sector, OrgTier } from '@/types/database';
import { SponsorBadge } from '@/components/ui/SponsorBadge';
import { toast } from '@/hooks/use-toast';
import { sendNotification } from '@/lib/notifications';

/* ---------- local types ---------- */

interface OrgCard {
  id: string;
  slug: string;
  name: string;
  organization_type: string | null;
  tier: string;
  website: string | null;
  country: string | null;
  city: string | null;
  headquarters_country: string | null;
  description: string | null;
  audience_description: string | null;
  logo_url: string | null;
  sectors: { id: string; label: string }[];
  member_count: number;
}

// Keep old interface name as alias for backward compat in contact dialog
type PartnerCard = OrgCard & { company_name: string; user_id: string };

interface RfpCard {
  id: string;
  title: string;
  scope: string | null;
  deadline_date: string | null;
  is_open: boolean;
  created_at: string;
  marina_user_id: string;
  marina_name: string;
  sector: { id: string; label: string } | null;
}

interface ConsultationCard {
  id: string;
  title: string;
  description: string | null;
  is_open: boolean;
  created_at: string;
  marina_user_id: string;
  marina_name: string;
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

  /* --- RFP detail dialog state --- */
  const [rfpDetailOpen, setRfpDetailOpen] = useState(false);
  const [selectedRfp, setSelectedRfp] = useState<RfpCard | null>(null);

  /* --- Consultation detail dialog state --- */
  const [consultDetailOpen, setConsultDetailOpen] = useState(false);
  const [selectedConsult, setSelectedConsult] = useState<ConsultationCard | null>(null);

  const isMarina = profile?.persona === 'marina';
  const isPartner = profile?.persona === 'partner' && isVerified;

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
    if (!user || !organization || sectors.length === 0) return;
    const table = organization.organization_type === 'marina'
      ? 'organization_interest_sectors'
      : 'organization_service_sectors';
    supabase
      .from(table)
      .select('sector_id')
      .eq('organization_id', organization.id)
      .then(({ data }) => {
        if (data && data.length > 0) {
          // Only pre-select sectors that exist in the active sectors list
          const activeSectorIds = new Set(sectors.map(s => s.id));
          const validIds = data
            .map((d: { sector_id: string }) => d.sector_id)
            .filter(id => activeSectorIds.has(id));
          if (validIds.length > 0) setSelectedSectors(validIds);
        }
      });
  }, [user, organization, sectors]);

  /* ---- fetch organizations ---- */
  useEffect(() => {
    setLoadingOrgs(true);
    const fetchOrgs = async () => {
      try {
        const { data: orgRows, error: oErr } = await supabase
          .from('organizations')
          .select('id, slug, name, organization_type, tier, website, country, city, headquarters_country, description, audience_description, logo_url, access_status')
          .eq('access_status', 'verified');

        if (oErr) throw oErr;
        if (!orgRows || orgRows.length === 0) {
          setOrgs([]);
          return;
        }

        const orgIds = orgRows.map((o) => o.id);

        // Fetch member counts per org
        const { data: memberRows } = await supabase
          .from('organization_members')
          .select('organization_id')
          .in('organization_id', orgIds);

        const memberCountMap: Record<string, number> = {};
        if (memberRows) {
          for (const row of memberRows as { organization_id: string }[]) {
            memberCountMap[row.organization_id] = (memberCountMap[row.organization_id] || 0) + 1;
          }
        }

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
        for (const link of [...(serviceSectors || []), ...(interestSectors || [])] as unknown as { organization_id: string; sector_id: string; sectors: { id: string; label: string } | null }[]) {
          const oid = link.organization_id;
          if (!sectorMap[oid]) sectorMap[oid] = [];
          if (link.sectors && !sectorMap[oid].some((s) => s.id === link.sectors!.id)) {
            sectorMap[oid].push({ id: link.sectors.id, label: link.sectors.label });
          }
        }

        const cards: OrgCard[] = orgRows.map((o) => ({
          id: o.id,
          slug: o.slug,
          name: o.name,
          organization_type: o.organization_type,
          tier: o.tier || 'member',
          website: o.website,
          country: o.country,
          city: o.city,
          headquarters_country: o.headquarters_country,
          description: o.description,
          audience_description: o.audience_description,
          logo_url: o.logo_url || null,
          sectors: sectorMap[o.id] || [],
          member_count: memberCountMap[o.id] || 0,
        }));

        // Sort by sponsorship tier (highest first), then alphabetically
        const tierOrder: Record<string, number> = { main_sponsor: 0, premium_partner: 1, associate_partner: 2, innovation_partner: 3, member: 4 };
        cards.sort((a, b) => {
          const aOrder = tierOrder[a.tier] ?? 5;
          const bOrder = tierOrder[b.tier] ?? 5;
          if (aOrder !== bOrder) return aOrder - bOrder;
          return a.name.localeCompare(b.name);
        });

        setOrgs(cards);
      } catch (err) {
        if (import.meta.env.DEV) console.error('Error fetching organizations:', err);
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
          .select('id, title, scope, deadline_date, is_open, created_at, marina_user_id, sector_id, sectors(id, label)')
          .eq('is_open', true)
          .order('created_at', { ascending: false });

        if (error) throw error;

        const rows = (data || []) as unknown as { id: string; title: string; scope: string | null; deadline_date: string | null; is_open: boolean; created_at: string; marina_user_id: string; sector_id: string; sectors: { id: string; label: string } | null }[];

        // Resolve marina names: prefer organization name, fall back to profile first+last
        const marinaIds = [...new Set(rows.map((r) => r.marina_user_id))];
        const nameMap: Record<string, string> = {};
        if (marinaIds.length > 0) {
          // Batch-fetch organization names via organization_members -> organizations
          const { data: memberOrgs } = await supabase
            .from('organization_members')
            .select('user_id, organizations(name)')
            .in('user_id', marinaIds);
          for (const m of (memberOrgs || []) as unknown as { user_id: string; organizations: { name: string } | null }[]) {
            if (m.organizations?.name) {
              nameMap[m.user_id] = m.organizations.name;
            }
          }

          // For any marina user without an org name, fall back to profile first+last name via RPC
          const missingIds = marinaIds.filter((uid) => !nameMap[uid]);
          if (missingIds.length > 0) {
            const { data: profiles } = await supabase
              .rpc('get_public_profiles', { target_user_ids: missingIds });
            for (const p of (profiles || []) as { user_id: string; first_name: string | null; last_name: string | null }[]) {
              const name = [p.first_name, p.last_name].filter(Boolean).join(' ');
              nameMap[p.user_id] = name || p.user_id.slice(0, 8);
            }
          }
        }

        const cards: RfpCard[] = rows.map((r) => ({
          id: r.id,
          title: r.title,
          scope: r.scope,
          deadline_date: r.deadline_date,
          is_open: r.is_open,
          created_at: r.created_at,
          marina_user_id: r.marina_user_id,
          marina_name: nameMap[r.marina_user_id] || r.marina_user_id.slice(0, 8),
          sector: r.sectors ? { id: r.sectors.id, label: r.sectors.label } : null,
        }));

        setRfps(cards);
      } catch (err) {
        if (import.meta.env.DEV) console.error('Error fetching RFPs:', err);
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
          .select('id, title, description, is_open, created_at, marina_user_id, sector_id, sectors(id, label)')
          .eq('is_open', true)
          .order('created_at', { ascending: false });

        if (error) throw error;

        const rows = (data || []) as unknown as { id: string; title: string; description: string | null; is_open: boolean; created_at: string; marina_user_id: string; sector_id: string; sectors: { id: string; label: string } | null }[];

        // Resolve marina names: prefer organization name, fall back to profile first+last
        const marinaIds = [...new Set(rows.map((c) => c.marina_user_id))];
        const nameMap: Record<string, string> = {};
        if (marinaIds.length > 0) {
          // Batch-fetch organization names via organization_members -> organizations
          const { data: memberOrgs } = await supabase
            .from('organization_members')
            .select('user_id, organizations(name)')
            .in('user_id', marinaIds);
          for (const m of (memberOrgs || []) as unknown as { user_id: string; organizations: { name: string } | null }[]) {
            if (m.organizations?.name) {
              nameMap[m.user_id] = m.organizations.name;
            }
          }

          // For any marina user without an org name, fall back to profile first+last name via RPC
          const missingIds = marinaIds.filter((uid) => !nameMap[uid]);
          if (missingIds.length > 0) {
            const { data: profiles } = await supabase
              .rpc('get_public_profiles', { target_user_ids: missingIds });
            for (const p of (profiles || []) as { user_id: string; first_name: string | null; last_name: string | null }[]) {
              const name = [p.first_name, p.last_name].filter(Boolean).join(' ');
              nameMap[p.user_id] = name || p.user_id.slice(0, 8);
            }
          }
        }

        const cards: ConsultationCard[] = rows.map((c) => ({
          id: c.id,
          title: c.title,
          description: c.description,
          is_open: c.is_open,
          created_at: c.created_at,
          marina_user_id: c.marina_user_id,
          marina_name: nameMap[c.marina_user_id] || c.marina_user_id.slice(0, 8),
          sector: c.sectors ? { id: c.sectors.id, label: c.sectors.label } : null,
        }));

        setConsultations(cards);
      } catch (err) {
        if (import.meta.env.DEV) console.error('Error fetching consultations:', err);
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

      sendNotification({ type: 'partner_request_received', userId: targetUserId, data: { partner_name: contactPartner.company_name || '', message: contactMessage.trim() } });

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
      case 'marina': return t('marketplace.typeMarina', 'Marina');
      case 'partner': return t('marketplace.typePartner', 'Partner');
      case 'media_partner': return t('marketplace.typeMedia', 'Media');
      default: return t('marketplace.typeOrganization', 'Organization');
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
    return <LoadingSkeleton variant="page" />;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Helmet>
        <title>Network — M3 Connect</title>
        <meta name="description" content="Find marina industry partners, service providers and experts. Browse open RFPs and consultation requests." />
        <meta property="og:title" content="Network — M3 Connect" />
        <meta property="og:description" content="B2B network connecting marina operators with service providers." />
      </Helmet>
      {/* Search Bar Section */}
      <section className="bg-white/80 backdrop-blur-xl border-b">
        <div className="container mx-auto px-4 py-4">
          <div className="flex flex-col sm:flex-row gap-3 items-center">
            <div className="relative flex-1 w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder={t('marketplace.searchPartners', 'Search organizations by name, location, or description...')}
                value={partnerSearch}
                onChange={(e) => setPartnerSearch(e.target.value)}
                className="pl-10 h-11 rounded-xl"
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
                        <Card className="card-hover cursor-pointer flex flex-col h-full rounded-2xl border-0 shadow-sm hover:shadow-md transition-all duration-200">
                          <CardContent className="p-5 flex flex-col flex-1">
                            <div className="flex items-center gap-3 mb-3">
                              {orgCard.logo_url ? (
                                <img src={orgCard.logo_url} alt={orgCard.name} className="w-14 h-14 rounded-xl object-cover border" />
                              ) : (
                                <div className="w-14 h-14 bg-primary/10 rounded-xl flex items-center justify-center text-primary font-bold text-lg shrink-0">
                                  {getInitials(orgCard.name)}
                                </div>
                              )}
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <h3 className="font-semibold text-gray-900 truncate">{orgCard.name}</h3>
                                  <SponsorBadge tier={orgCard.tier as OrgTier} size="sm" />
                                </div>
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

                            <div className="flex items-center justify-between mt-3 pt-2 border-t">
                              {orgCard.member_count > 0 && (
                                <span className="text-xs text-gray-500 flex items-center gap-1">
                                  <Users className="h-3 w-3" />
                                  {orgCard.member_count} {orgCard.member_count === 1 ? 'member' : 'members'}
                                </span>
                              )}
                              <span className="text-xs text-primary font-medium flex items-center gap-1 ml-auto">
                                {t('marketplace.viewProfile', 'View Profile')} <ArrowRight className="h-3 w-3" />
                              </span>
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
                  <Card
                    key={rfp.id}
                    className="cursor-pointer hover:shadow-md transition-shadow duration-200"
                    onClick={() => { setSelectedRfp(rfp); setRfpDetailOpen(true); }}
                  >
                    <CardHeader>
                      <div className="flex items-start justify-between gap-3">
                        <CardTitle className="text-lg">{rfp.title}</CardTitle>
                        {rfp.sector && (
                          <Badge variant="secondary" className="shrink-0 text-xs">{rfp.sector.label}</Badge>
                        )}
                      </div>
                      <CardDescription className="flex items-center gap-3 flex-wrap">
                        <span className="flex items-center gap-1">
                          <Anchor className="h-3.5 w-3.5" />
                          {rfp.marina_name}
                        </span>
                        {rfp.deadline_date && (
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3.5 w-3.5" />
                            {t('marketplace.deadline', 'Deadline')}: {formatDate(rfp.deadline_date, i18n.language)}
                          </span>
                        )}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      {rfp.scope && (
                        <p className="text-sm text-gray-600 mb-3 leading-relaxed">{truncate(rfp.scope, 200)}</p>
                      )}
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-gray-400">
                          {t('marketplace.posted', 'Posted')} {formatDate(rfp.created_at, i18n.language)}
                        </p>
                        <span className="text-xs text-primary font-medium flex items-center gap-1">
                          {t('marketplace.viewDetails', 'View Details')} <ArrowRight className="h-3 w-3" />
                        </span>
                      </div>
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
                  <Card
                    key={c.id}
                    className="cursor-pointer hover:shadow-md transition-shadow duration-200"
                    onClick={() => { setSelectedConsult(c); setConsultDetailOpen(true); }}
                  >
                    <CardHeader>
                      <div className="flex items-start justify-between gap-3">
                        <CardTitle className="text-lg">{c.title}</CardTitle>
                        {c.sector && (
                          <Badge variant="secondary" className="shrink-0 text-xs">{c.sector.label}</Badge>
                        )}
                      </div>
                      <CardDescription className="flex items-center gap-1">
                        <Anchor className="h-3.5 w-3.5" />
                        {c.marina_name}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      {c.description && (
                        <p className="text-sm text-gray-600 mb-3 leading-relaxed">{truncate(c.description, 200)}</p>
                      )}
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-gray-400">
                          {t('marketplace.posted', 'Posted')} {formatDate(c.created_at, i18n.language)}
                        </p>
                        <span className="text-xs text-primary font-medium flex items-center gap-1">
                          {t('marketplace.viewDetails', 'View Details')} <ArrowRight className="h-3 w-3" />
                        </span>
                      </div>
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
        <DialogContent className="sm:max-w-md rounded-2xl">
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

      {/* ====== RFP Detail Dialog ====== */}
      <Dialog open={rfpDetailOpen} onOpenChange={setRfpDetailOpen}>
        <DialogContent className="sm:max-w-lg rounded-2xl">
          {selectedRfp && (
            <>
              <DialogHeader>
                <DialogTitle className="text-xl">{selectedRfp.title}</DialogTitle>
                <DialogDescription className="flex items-center gap-2 pt-1">
                  <Anchor className="h-4 w-4" />
                  {selectedRfp.marina_name}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 pt-2">
                {/* Status & Sector */}
                <div className="flex flex-wrap gap-2">
                  <Badge variant={selectedRfp.is_open ? 'default' : 'secondary'}>
                    {selectedRfp.is_open
                      ? t('marketplace.rfpStatusOpen', 'Open')
                      : t('marketplace.rfpStatusClosed', 'Closed')}
                  </Badge>
                  {selectedRfp.sector && (
                    <Badge variant="outline">{selectedRfp.sector.label}</Badge>
                  )}
                </div>

                {/* Deadline */}
                {selectedRfp.deadline_date && (
                  <div className="flex items-center gap-2 text-sm text-gray-700">
                    <Calendar className="h-4 w-4 text-gray-400" />
                    <span className="font-medium">{t('marketplace.deadline', 'Deadline')}:</span>
                    <span>{formatDate(selectedRfp.deadline_date, i18n.language)}</span>
                  </div>
                )}

                {/* Created date */}
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <Clock className="h-4 w-4 text-gray-400" />
                  <span>{t('marketplace.posted', 'Posted')} {formatDate(selectedRfp.created_at, i18n.language)}</span>
                </div>

                {/* Full scope text */}
                {selectedRfp.scope && (
                  <div className="space-y-1">
                    <Label className="text-sm font-medium text-gray-700">{t('marketplace.rfpScope', 'Scope')}</Label>
                    <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap bg-gray-50 rounded-lg p-3">
                      {selectedRfp.scope}
                    </p>
                  </div>
                )}

                {/* Action buttons */}
                <div className="flex justify-end gap-2 pt-2 border-t">
                  <Button variant="outline" onClick={() => setRfpDetailOpen(false)}>
                    {t('common.close', 'Close')}
                  </Button>
                  {isPartner && (
                    <Button onClick={() => {
                      setRfpDetailOpen(false);
                      toast({
                        title: t('marketplace.rfpContactSent', 'Interest registered'),
                        description: t('marketplace.rfpContactSentDesc', 'The marina has been notified of your interest in this RFP.'),
                      });
                    }}>
                      <MessageSquare className="h-4 w-4 mr-2" />
                      {t('marketplace.contactMarina', 'Contact Marina')}
                    </Button>
                  )}
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ====== Consultation Detail Dialog ====== */}
      <Dialog open={consultDetailOpen} onOpenChange={setConsultDetailOpen}>
        <DialogContent className="sm:max-w-lg rounded-2xl">
          {selectedConsult && (
            <>
              <DialogHeader>
                <DialogTitle className="text-xl">{selectedConsult.title}</DialogTitle>
                <DialogDescription className="flex items-center gap-2 pt-1">
                  <Anchor className="h-4 w-4" />
                  {selectedConsult.marina_name}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 pt-2">
                {/* Status & Sector */}
                <div className="flex flex-wrap gap-2">
                  <Badge variant={selectedConsult.is_open ? 'default' : 'secondary'}>
                    {selectedConsult.is_open
                      ? t('marketplace.consultStatusOpen', 'Open')
                      : t('marketplace.consultStatusClosed', 'Closed')}
                  </Badge>
                  {selectedConsult.sector && (
                    <Badge variant="outline">{selectedConsult.sector.label}</Badge>
                  )}
                </div>

                {/* Created date */}
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <Clock className="h-4 w-4 text-gray-400" />
                  <span>{t('marketplace.posted', 'Posted')} {formatDate(selectedConsult.created_at, i18n.language)}</span>
                </div>

                {/* Full description */}
                {selectedConsult.description && (
                  <div className="space-y-1">
                    <Label className="text-sm font-medium text-gray-700">{t('marketplace.consultDescription', 'Description')}</Label>
                    <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap bg-gray-50 rounded-lg p-3">
                      {selectedConsult.description}
                    </p>
                  </div>
                )}

                {/* Action buttons */}
                <div className="flex justify-end gap-2 pt-2 border-t">
                  <Button variant="outline" onClick={() => setConsultDetailOpen(false)}>
                    {t('common.close', 'Close')}
                  </Button>
                  {isPartner && (
                    <Button onClick={() => {
                      setConsultDetailOpen(false);
                      toast({
                        title: t('marketplace.consultResponseSent', 'Response registered'),
                        description: t('marketplace.consultResponseSentDesc', 'The marina has been notified of your interest in this consultation.'),
                      });
                    }}>
                      <MessageSquare className="h-4 w-4 mr-2" />
                      {t('marketplace.respond', 'Respond')}
                    </Button>
                  )}
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
