import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Search, RefreshCw, Building2, MapPin } from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface OrgCard {
  id: string;
  slug: string;
  name: string;
  organization_type: string;
  description: string | null;
  website: string | null;
  country: string | null;
  headquarters_country: string | null;
  logo_url: string | null;
  sectors: { id: string; label: string }[];
}

export function PartnersPage() {
  const { t } = useTranslation();
  const [partners, setPartners] = useState<OrgCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    const fetchPartners = async () => {
      setLoading(true);
      try {
        // Get verified partner organizations
        const { data: orgRows, error } = await supabase
          .from('organizations')
          .select('id, slug, name, organization_type, website, country, headquarters_country, description, logo_url, access_status')
          .eq('access_status', 'verified')
          .eq('organization_type', 'partner');

        if (error) throw error;
        if (!orgRows || orgRows.length === 0) {
          setPartners([]);
          return;
        }

        // Get sector mappings from organization_service_sectors
        const orgIds = orgRows.map((o: any) => o.id);
        const { data: sectorLinks } = await supabase
          .from('organization_service_sectors')
          .select('organization_id, sector_id, sectors(id, label)')
          .in('organization_id', orgIds);

        const sectorMap: Record<string, { id: string; label: string }[]> = {};
        if (sectorLinks) {
          for (const link of sectorLinks as any[]) {
            const oid = link.organization_id;
            if (!sectorMap[oid]) sectorMap[oid] = [];
            if (link.sectors) {
              sectorMap[oid].push({ id: link.sectors.id, label: link.sectors.label });
            }
          }
        }

        const cards: OrgCard[] = orgRows.map((o: any) => ({
          id: o.id,
          slug: o.slug,
          name: o.name,
          organization_type: o.organization_type,
          website: o.website,
          country: o.country,
          headquarters_country: o.headquarters_country,
          description: o.description,
          logo_url: o.logo_url,
          sectors: sectorMap[o.id] || [],
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
      p.name.toLowerCase().includes(q) ||
      (p.headquarters_country || '').toLowerCase().includes(q) ||
      (p.country || '').toLowerCase().includes(q) ||
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
            <Link key={partner.id} to={`/organizations/${partner.slug}`}>
              <Card className="card-hover cursor-pointer h-full">
                <CardContent className="p-6 text-center">
                  {partner.logo_url ? (
                    <img src={partner.logo_url} alt={partner.name} className="w-20 h-20 rounded-full object-cover mx-auto mb-4" />
                  ) : (
                    <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center text-primary font-bold text-2xl mx-auto mb-4">
                      {getInitials(partner.name)}
                    </div>
                  )}
                  <h3 className="font-semibold mb-2">{partner.name}</h3>
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
                  {(partner.headquarters_country || partner.country) && (
                    <div className="text-sm text-gray-500 flex items-center justify-center gap-1">
                      <MapPin className="h-3 w-3" />
                      {partner.headquarters_country || partner.country}
                    </div>
                  )}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
