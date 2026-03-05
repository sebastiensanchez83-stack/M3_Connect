import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ExternalLink, Globe, Search, RefreshCw, Building2, MapPin } from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface PartnerCard {
  user_id: string;
  company_name: string;
  description: string | null;
  website: string | null;
  headquarters_country: string | null;
  sectors: { id: string; label: string }[];
}

export function PartnersPage() {
  const { t } = useTranslation();
  const [partners, setPartners] = useState<PartnerCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedPartner, setSelectedPartner] = useState<PartnerCard | null>(null);

  useEffect(() => {
    const fetchPartners = async () => {
      setLoading(true);
      try {
        // Get verified partner profiles
        const { data: partnerRows, error } = await supabase
          .from('partner_profiles')
          .select('user_id, company_name, website, headquarters_country, description, profiles!inner(access_status)')
          .eq('profiles.access_status', 'verified');

        if (error) throw error;
        if (!partnerRows || partnerRows.length === 0) {
          setPartners([]);
          return;
        }

        // Get sector mappings
        const userIds = partnerRows.map((p: any) => p.user_id);
        const { data: sectorLinks } = await supabase
          .from('partner_service_sectors')
          .select('partner_user_id, sector_id, sectors(id, label)')
          .in('partner_user_id', userIds);

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
        setLoading(false);
      }
    };

    fetchPartners();
  }, []);

  const filteredPartners = partners.filter((p) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      p.company_name.toLowerCase().includes(q) ||
      (p.headquarters_country || '').toLowerCase().includes(q) ||
      (p.description || '').toLowerCase().includes(q) ||
      p.sectors.some((s) => s.label.toLowerCase().includes(q))
    );
  });

  const getInitials = (name: string) => {
    return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-primary mb-2">{t('partners.title')}</h1>
        <p className="text-gray-600">{t('partners.subtitle')}</p>
      </div>

      <div className="mb-6 max-w-md">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            placeholder={t('partners.search', 'Search by name, country, sector...')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <RefreshCw className="h-8 w-8 animate-spin text-gray-400" />
        </div>
      ) : filteredPartners.length === 0 ? (
        <div className="text-center py-16">
          <Building2 className="h-12 w-12 mx-auto text-gray-300 mb-4" />
          <p className="text-gray-500 text-lg">
            {partners.length === 0
              ? t('partners.noPartners', 'No verified partners yet. Check back soon!')
              : t('partners.noMatch', 'No partners match your search.')}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {filteredPartners.map(partner => (
            <Card
              key={partner.user_id}
              className="card-hover cursor-pointer"
              onClick={() => setSelectedPartner(partner)}
            >
              <CardContent className="p-6 text-center">
                <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center text-primary font-bold text-2xl mx-auto mb-4">
                  {getInitials(partner.company_name)}
                </div>
                <h3 className="font-semibold mb-2">{partner.company_name}</h3>
                {partner.sectors.length > 0 && (
                  <div className="flex flex-wrap gap-1 justify-center mb-2">
                    {partner.sectors.slice(0, 2).map((s) => (
                      <Badge key={s.id} variant="secondary" className="text-xs">
                        {s.label}
                      </Badge>
                    ))}
                    {partner.sectors.length > 2 && (
                      <Badge variant="outline" className="text-xs">+{partner.sectors.length - 2}</Badge>
                    )}
                  </div>
                )}
                {partner.headquarters_country && (
                  <div className="text-sm text-gray-500 flex items-center justify-center gap-1">
                    <MapPin className="h-3 w-3" />
                    {partner.headquarters_country}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!selectedPartner} onOpenChange={() => setSelectedPartner(null)}>
        <DialogContent className="max-w-lg">
          {selectedPartner && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-4">
                  <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center text-primary font-bold text-xl shrink-0">
                    {getInitials(selectedPartner.company_name)}
                  </div>
                  <div>
                    <div>{selectedPartner.company_name}</div>
                    <div className="flex flex-wrap gap-2 mt-1">
                      {selectedPartner.sectors.map((s) => (
                        <Badge key={s.id} variant="secondary" className="text-xs font-normal">
                          {s.label}
                        </Badge>
                      ))}
                      {selectedPartner.headquarters_country && (
                        <span className="text-sm text-gray-500 flex items-center gap-1">
                          <MapPin className="h-3 w-3" />
                          {selectedPartner.headquarters_country}
                        </span>
                      )}
                    </div>
                  </div>
                </DialogTitle>
                <DialogDescription className="sr-only">
                  Details about {selectedPartner.company_name}
                </DialogDescription>
              </DialogHeader>
              <div className="mt-4">
                {selectedPartner.description && (
                  <p className="text-gray-600 mb-6">{selectedPartner.description}</p>
                )}
                {selectedPartner.website && (
                  <a
                    href={selectedPartner.website.startsWith('http') ? selectedPartner.website : `https://${selectedPartner.website}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Button>
                      <Globe className="h-4 w-4 mr-2" />
                      {t('partners.visitWebsite')}
                      <ExternalLink className="h-4 w-4 ml-2" />
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
