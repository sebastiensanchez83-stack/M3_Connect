import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ExternalLink, Globe } from 'lucide-react';

const mockPartners = [
  { id: '1', name: 'Marina Tech Solutions', description: 'Leading provider of marina management software and digital solutions. Our platform helps marinas streamline operations, manage berths, and improve customer experience.', logo_url: null, website: 'https://example.com', sector: 'digital', country: 'France', is_featured: true },
  { id: '2', name: 'EcoPorts International', description: 'Specialists in environmental solutions for ports and marinas. We help marinas achieve sustainability certifications and reduce their environmental footprint.', logo_url: null, website: 'https://example.com', sector: 'environment', country: 'Netherlands', is_featured: true },
  { id: '3', name: 'GreenShore Energy', description: 'Renewable energy solutions designed specifically for coastal installations. Solar, wind, and innovative charging solutions for electric vessels.', logo_url: null, website: 'https://example.com', sector: 'energy', country: 'Germany', is_featured: true },
  { id: '4', name: 'AquaSmart Systems', description: 'Smart water management and monitoring systems for marinas. Real-time monitoring of water quality and consumption.', logo_url: null, website: 'https://example.com', sector: 'equipment', country: 'Italy', is_featured: false },
  { id: '5', name: 'PortConnect Services', description: 'Professional services for marina development and operations consulting. Over 20 years of industry experience.', logo_url: null, website: 'https://example.com', sector: 'services', country: 'Monaco', is_featured: true },
  { id: '6', name: 'Blue Marina Consulting', description: 'Strategic consulting for marina investments and development projects across the Mediterranean region.', logo_url: null, website: 'https://example.com', sector: 'services', country: 'Spain', is_featured: false },
  { id: '7', name: 'SmartDock Equipment', description: 'High-quality marina equipment including floating docks, mooring systems, and safety equipment.', logo_url: null, website: 'https://example.com', sector: 'equipment', country: 'Croatia', is_featured: false },
  { id: '8', name: 'Mediterranean Marina Institute', description: 'Research institution dedicated to advancing knowledge in marina management and sustainable practices.', logo_url: null, website: 'https://example.com', sector: 'institution', country: 'Greece', is_featured: true },
];

export function PartnersPage() {
  const { t } = useTranslation();
  const [sectorFilter, setSectorFilter] = useState('all');
  const [selectedPartner, setSelectedPartner] = useState<typeof mockPartners[0] | null>(null);

  const sectors = ['energy', 'equipment', 'digital', 'environment', 'services', 'institution'];

  const filteredPartners = mockPartners.filter(
    partner => sectorFilter === 'all' || partner.sector === sectorFilter
  );

  const getSectorColor = (sector: string) => {
    const colors: Record<string, string> = {
      energy: 'bg-yellow-100 text-yellow-800',
      equipment: 'bg-blue-100 text-blue-800',
      digital: 'bg-purple-100 text-purple-800',
      environment: 'bg-green-100 text-green-800',
      services: 'bg-orange-100 text-orange-800',
      institution: 'bg-gray-100 text-gray-800',
    };
    return colors[sector] || 'bg-gray-100';
  };

  const getInitials = (name: string) => {
    return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-primary mb-2">{t('partners.title')}</h1>
        <p className="text-gray-600">{t('partners.subtitle')}</p>
      </div>

      <div className="mb-6">
        <Select value={sectorFilter} onValueChange={setSectorFilter}>
          <SelectTrigger className="w-64">
            <SelectValue placeholder={t('partners.filterBySector')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('partners.allSectors')}</SelectItem>
            {sectors.map(sector => (
              <SelectItem key={sector} value={sector}>
                {t(`partners.sectors.${sector}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
        {filteredPartners.map(partner => (
          <Card
            key={partner.id}
            className="card-hover cursor-pointer"
            onClick={() => setSelectedPartner(partner)}
          >
            <CardContent className="p-6 text-center">
              <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center text-primary font-bold text-2xl mx-auto mb-4">
                {getInitials(partner.name)}
              </div>
              <h3 className="font-semibold mb-2">{partner.name}</h3>
              <span className={`inline-block px-2 py-1 rounded text-xs font-medium ${getSectorColor(partner.sector)}`}>
                {t(`partners.sectors.${partner.sector}`)}
              </span>
              <div className="text-sm text-gray-500 mt-2">{partner.country}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {filteredPartners.length === 0 && (
        <div className="text-center py-12 text-gray-500">No partners found in this sector.</div>
      )}

      <Dialog open={!!selectedPartner} onOpenChange={() => setSelectedPartner(null)}>
        <DialogContent className="max-w-lg">
          {selectedPartner && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-4">
                  <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center text-primary font-bold text-xl">
                    {getInitials(selectedPartner.name)}
                  </div>
                  <div>
                    <div>{selectedPartner.name}</div>
                    <div className="flex gap-2 mt-1">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${getSectorColor(selectedPartner.sector)}`}>
                        {t(`partners.sectors.${selectedPartner.sector}`)}
                      </span>
                      <span className="text-sm text-gray-500">{selectedPartner.country}</span>
                    </div>
                  </div>
                </DialogTitle>
              </DialogHeader>
              <div className="mt-4">
                <p className="text-gray-600 mb-6">{selectedPartner.description}</p>
                {selectedPartner.website && (
                  <Button asChild>
                    <a href={selectedPartner.website} target="_blank" rel="noopener noreferrer">
                      <Globe className="h-4 w-4 mr-2" />
                      {t('partners.visitWebsite')}
                      <ExternalLink className="h-4 w-4 ml-2" />
                    </a>
                  </Button>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
