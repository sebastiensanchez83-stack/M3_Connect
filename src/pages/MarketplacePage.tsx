import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, Briefcase, FileText, MessageSquare, Globe, MapPin, Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { Sector } from '@/types/database';
import { toast } from '@/hooks/use-toast';

/* ---------- local types ---------- */

interface PartnerCard {
  user_id: string;
  company_name: string;
  website: string | null;
  headquarters_country: string | null;
  description: string | null;
  sectors: { id: string; label: string }[];
}

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

function formatDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/* ========== component ========== */

export function MarketplacePage() {
  const { user, profile, isVerified, loading: authLoading } = useAuth();

  /* --- data states --- */
  const [partners, setPartners] = useState<PartnerCard[]>([]);
  const [rfps, setRfps] = useState<RfpCard[]>([]);
  const [consultations, setConsultations] = useState<ConsultationCard[]>([]);
  const [sectors, setSectors] = useState<Sector[]>([]);

  const [loadingPartners, setLoadingPartners] = useState(false);
  const [loadingRfps, setLoadingRfps] = useState(false);
  const [loadingConsultations, setLoadingConsultations] = useState(false);

  /* --- search --- */
  const [partnerSearch, setPartnerSearch] = useState('');

  /* --- contact dialog state --- */
  const [contactOpen, setContactOpen] = useState(false);
  const [contactPartner, setContactPartner] = useState<PartnerCard | null>(null);
  const [contactSectorId, setContactSectorId] = useState('');
  const [contactMessage, setContactMessage] = useState('');
  const [contactSending, setContactSending] = useState(false);

  const isMarina = profile?.persona === 'marina';

  /* ---- fetch sectors (used by contact dialog) ---- */
  useEffect(() => {
    if (!isVerified) return;
    supabase
      .from('sectors')
      .select('*')
      .eq('is_active', true)
      .order('label')
      .then(({ data }) => {
        if (data) setSectors(data as Sector[]);
      });
  }, [isVerified]);

  /* ---- fetch partners ---- */
  useEffect(() => {
    if (!isVerified) return;
    setLoadingPartners(true);

    const fetchPartners = async () => {
      try {
        // 1. get verified partner profiles
        const { data: partnerRows, error: pErr } = await supabase
          .from('partner_profiles')
          .select('user_id, company_name, website, headquarters_country, description, profiles!inner(access_status)')
          .eq('profiles.access_status', 'verified');

        if (pErr) throw pErr;
        if (!partnerRows || partnerRows.length === 0) {
          setPartners([]);
          return;
        }

        // 2. get sector mappings for all partner user_ids
        const userIds = partnerRows.map((p: any) => p.user_id);
        const { data: sectorLinks } = await supabase
          .from('partner_service_sectors')
          .select('partner_user_id, sector_id, sectors(id, label)')
          .in('partner_user_id', userIds);

        // build a map: user_id -> sectors[]
        const sectorMap: Record<string, { id: string; label: string }[]> = {};
        if (sectorLinks) {
          for (const link of sectorLinks as any[]) {
            const uid = link.partner_user_id;
            if (!sectorMap[uid]) sectorMap[uid] = [];
            if (link.sectors) {
              sectorMap[uid].push({ id: link.sectors.id, label: link.sectors.label });
            }
          }
        }

        const cards: PartnerCard[] = partnerRows.map((p: any) => ({
          user_id: p.user_id,
          company_name: p.company_name,
          website: p.website,
          headquarters_country: p.headquarters_country,
          description: p.description,
          sectors: sectorMap[p.user_id] || [],
        }));

        setPartners(cards);
      } catch (err) {
        console.error('Error fetching partners:', err);
      } finally {
        setLoadingPartners(false);
      }
    };

    fetchPartners();
  }, [isVerified]);

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

  const openContactDialog = (partner: PartnerCard) => {
    setContactPartner(partner);
    setContactSectorId('');
    setContactMessage('');
    setContactOpen(true);
  };

  const handleSendRequest = async () => {
    if (!user || !contactPartner) return;
    if (!contactSectorId) {
      toast({ title: 'Sector required', description: 'Please select a sector for your request.', variant: 'destructive' });
      return;
    }
    if (!contactMessage.trim()) {
      toast({ title: 'Message required', description: 'Please write a message for the partner.', variant: 'destructive' });
      return;
    }

    setContactSending(true);
    try {
      const { error } = await supabase.from('partner_requests').insert({
        partner_user_id: contactPartner.user_id,
        marina_user_id: user.id,
        sector_id: contactSectorId,
        message: contactMessage.trim(),
        status: 'pending',
      });

      if (error) throw error;

      toast({ title: 'Request sent!', description: `Your message has been sent to ${contactPartner.company_name}.` });
      setContactOpen(false);
    } catch (err: unknown) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Could not send request.',
        variant: 'destructive',
      });
    } finally {
      setContactSending(false);
    }
  };

  /* ---- filtered partners ---- */
  const filteredPartners = partners.filter((p) => {
    if (!partnerSearch.trim()) return true;
    const q = partnerSearch.toLowerCase();
    return (
      p.company_name.toLowerCase().includes(q) ||
      (p.headquarters_country || '').toLowerCase().includes(q) ||
      (p.description || '').toLowerCase().includes(q) ||
      p.sectors.some((s) => s.label.toLowerCase().includes(q))
    );
  });

  /* ========== render guards ========== */

  if (authLoading) {
    return (
      <div className="container mx-auto py-16 text-center">
        <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
      </div>
    );
  }

  if (!user || !isVerified) {
    return (
      <div className="container mx-auto px-4 py-16 max-w-lg text-center">
        <Briefcase className="h-12 w-12 mx-auto text-gray-300 mb-4" />
        <h1 className="text-2xl font-bold text-gray-800 mb-2">Marketplace</h1>
        <p className="text-gray-500 mb-6">
          Only verified members can access the marketplace.
        </p>
        {!user ? (
          <Link to="/">
            <Button>Go to Homepage</Button>
          </Link>
        ) : (
          <Link to="/account">
            <Button>View Account Status</Button>
          </Link>
        )}
      </div>
    );
  }

  /* ========== main render ========== */

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Page header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-primary mb-2">Marketplace</h1>
        <p className="text-gray-600">
          Explore verified partners, open requests for proposals, and consultation opportunities across the marina industry.
        </p>
      </div>

      <Tabs defaultValue="partners" className="space-y-6">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="partners" className="flex items-center gap-2">
            <Briefcase className="h-4 w-4" />
            <span className="hidden sm:inline">Partner Directory</span>
            <span className="sm:hidden">Partners</span>
          </TabsTrigger>
          <TabsTrigger value="rfps" className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            <span className="hidden sm:inline">Open RFPs</span>
            <span className="sm:hidden">RFPs</span>
          </TabsTrigger>
          <TabsTrigger value="consultations" className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4" />
            <span className="hidden sm:inline">Open Consultations</span>
            <span className="sm:hidden">Consults</span>
          </TabsTrigger>
        </TabsList>

        {/* ====== TAB 1: Partner Directory ====== */}
        <TabsContent value="partners" className="space-y-6">
          {/* search bar */}
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Search by name, country, sector..."
              value={partnerSearch}
              onChange={(e) => setPartnerSearch(e.target.value)}
              className="pl-10"
            />
          </div>

          {loadingPartners ? (
            <div className="py-12 text-center">
              <Loader2 className="h-6 w-6 animate-spin mx-auto text-primary" />
              <p className="text-sm text-gray-400 mt-2">Loading partners...</p>
            </div>
          ) : filteredPartners.length === 0 ? (
            <div className="py-12 text-center">
              <Briefcase className="h-10 w-10 mx-auto text-gray-300 mb-3" />
              <p className="text-gray-500">
                {partnerSearch.trim()
                  ? 'No partners match your search.'
                  : 'No verified partners yet.'}
              </p>
            </div>
          ) : (
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {filteredPartners.map((partner) => (
                <Card key={partner.user_id} className="flex flex-col">
                  <CardHeader>
                    <CardTitle className="text-lg">{partner.company_name}</CardTitle>
                    {partner.headquarters_country && (
                      <CardDescription className="flex items-center gap-1">
                        <MapPin className="h-3.5 w-3.5" />
                        {partner.headquarters_country}
                      </CardDescription>
                    )}
                  </CardHeader>
                  <CardContent className="flex flex-col flex-1 gap-4">
                    {/* description */}
                    {partner.description && (
                      <p className="text-sm text-gray-600 leading-relaxed">
                        {truncate(partner.description)}
                      </p>
                    )}

                    {/* sectors */}
                    {partner.sectors.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {partner.sectors.map((s) => (
                          <Badge key={s.id} variant="secondary" className="text-xs">
                            {s.label}
                          </Badge>
                        ))}
                      </div>
                    )}

                    {/* footer actions */}
                    <div className="mt-auto flex items-center gap-2 pt-2">
                      {partner.website && (
                        <a
                          href={partner.website.startsWith('http') ? partner.website : `https://${partner.website}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <Button variant="outline" size="sm" className="flex items-center gap-1.5">
                            <Globe className="h-3.5 w-3.5" />
                            Website
                          </Button>
                        </a>
                      )}

                      {isMarina && (
                        <Button size="sm" onClick={() => openContactDialog(partner)}>
                          Contact
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ====== TAB 2: Open RFPs ====== */}
        <TabsContent value="rfps" className="space-y-6">
          {loadingRfps ? (
            <div className="py-12 text-center">
              <Loader2 className="h-6 w-6 animate-spin mx-auto text-primary" />
              <p className="text-sm text-gray-400 mt-2">Loading RFPs...</p>
            </div>
          ) : rfps.length === 0 ? (
            <div className="py-12 text-center">
              <FileText className="h-10 w-10 mx-auto text-gray-300 mb-3" />
              <p className="text-gray-500">No open requests for proposals at this time.</p>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {rfps.map((rfp) => (
                <Card key={rfp.id}>
                  <CardHeader>
                    <div className="flex items-start justify-between gap-3">
                      <CardTitle className="text-lg">{rfp.title}</CardTitle>
                      {rfp.sector && (
                        <Badge variant="secondary" className="shrink-0 text-xs">
                          {rfp.sector.label}
                        </Badge>
                      )}
                    </div>
                    {rfp.deadline_date && (
                      <CardDescription>
                        Deadline: {formatDate(rfp.deadline_date)}
                      </CardDescription>
                    )}
                  </CardHeader>
                  <CardContent>
                    {rfp.scope && (
                      <p className="text-sm text-gray-600 mb-3 leading-relaxed">
                        {truncate(rfp.scope, 200)}
                      </p>
                    )}
                    <p className="text-xs text-gray-400">
                      Posted {formatDate(rfp.created_at)}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ====== TAB 3: Open Consultations ====== */}
        <TabsContent value="consultations" className="space-y-6">
          {loadingConsultations ? (
            <div className="py-12 text-center">
              <Loader2 className="h-6 w-6 animate-spin mx-auto text-primary" />
              <p className="text-sm text-gray-400 mt-2">Loading consultations...</p>
            </div>
          ) : consultations.length === 0 ? (
            <div className="py-12 text-center">
              <MessageSquare className="h-10 w-10 mx-auto text-gray-300 mb-3" />
              <p className="text-gray-500">No open consultations at this time.</p>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {consultations.map((c) => (
                <Card key={c.id}>
                  <CardHeader>
                    <div className="flex items-start justify-between gap-3">
                      <CardTitle className="text-lg">{c.title}</CardTitle>
                      {c.sector && (
                        <Badge variant="secondary" className="shrink-0 text-xs">
                          {c.sector.label}
                        </Badge>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent>
                    {c.description && (
                      <p className="text-sm text-gray-600 mb-3 leading-relaxed">
                        {truncate(c.description, 200)}
                      </p>
                    )}
                    <p className="text-xs text-gray-400">
                      Posted {formatDate(c.created_at)}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* ====== Contact Partner Dialog ====== */}
      <Dialog open={contactOpen} onOpenChange={setContactOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Contact {contactPartner?.company_name}</DialogTitle>
            <DialogDescription>
              Send a request to this partner. They will receive your message and can respond directly.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label>Sector *</Label>
              <Select value={contactSectorId} onValueChange={setContactSectorId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a sector" />
                </SelectTrigger>
                <SelectContent>
                  {/* Show partner's sectors first if available, otherwise all sectors */}
                  {(contactPartner?.sectors && contactPartner.sectors.length > 0
                    ? contactPartner.sectors
                    : sectors
                  ).map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Message *</Label>
              <Textarea
                value={contactMessage}
                onChange={(e) => setContactMessage(e.target.value)}
                rows={4}
                placeholder="Describe what you are looking for, your marina's needs, timeline, etc."
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setContactOpen(false)} disabled={contactSending}>
                Cancel
              </Button>
              <Button onClick={handleSendRequest} disabled={contactSending}>
                {contactSending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Sending...
                  </>
                ) : (
                  'Send Request'
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
