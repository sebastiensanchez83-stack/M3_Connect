import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { RefreshCw, Eye, ExternalLink } from 'lucide-react';
import { TIER_LABELS, TIER_COLORS, OrgTier } from '@/types/database';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import type { Partner } from './types';

export function AdminPartners() {
  const { t } = useTranslation();
  const [partners, setPartners] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPartner, setSelectedPartner] = useState<Partner | null>(null);
  const [typeFilter, setTypeFilter] = useState('all');
  const [updatingTier, setUpdatingTier] = useState(false);

  useEffect(() => { loadPartners(); }, []);
  const loadPartners = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('organizations')
      .select('id, name, description, logo_url, website, organization_type, tier, max_seats, country, city, access_status, onboarding_status, owner_user_id')
      .in('organization_type', ['partner', 'media_partner'])
      .order('name');
    setPartners((data || []) as Partner[]);
    setLoading(false);
  };

  const updateStatus = async (id: string, status: string) => {
    await supabase.from('organizations').update({ access_status: status }).eq('id', id);
    toast({ title: `Status updated to ${status}` });
    loadPartners();
  };

  const updateTier = async (id: string, newTier: string) => {
    setUpdatingTier(true);
    // Get max_seats from tier config
    const { data: tierConfig } = await supabase
      .from('organization_tier_config')
      .select('max_seats')
      .eq('tier', newTier)
      .single();
    const maxSeats = tierConfig?.max_seats || 1;
    const { error } = await supabase
      .from('organizations')
      .update({ tier: newTier, max_seats: maxSeats })
      .eq('id', id);
    setUpdatingTier(false);
    if (error) {
      toast({ title: 'Failed to update tier', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: `Tier updated to ${TIER_LABELS[newTier as OrgTier] || newTier}` });
      // Update local state
      if (selectedPartner?.id === id) {
        setSelectedPartner({ ...selectedPartner, tier: newTier });
      }
      loadPartners();
    }
  };

  const filteredPartners = typeFilter === 'all' ? partners : partners.filter(p => p.organization_type === typeFilter);

  const statusBadge = (s: string) => {
    const m: Record<string, string> = { verified: 'bg-green-100 text-green-800', pending: 'bg-yellow-100 text-yellow-800', submitted: 'bg-blue-100 text-blue-800', rejected: 'bg-red-100 text-red-800', suspended: 'bg-gray-100 text-gray-800' };
    return <Badge className={m[s] || 'bg-gray-100 text-gray-800'}>{s}</Badge>;
  };

  const tierBadge = (tier: string) => {
    const colors = TIER_COLORS[tier as OrgTier] || TIER_COLORS.member;
    const label = TIER_LABELS[tier as OrgTier] || tier;
    return <Badge className={`${colors.bg} ${colors.text} border ${colors.border}`}>{label}</Badge>;
  };

  if (loading) return <div className="flex items-center justify-center h-64"><RefreshCw className="h-8 w-8 animate-spin text-gray-400" /></div>;

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">{t('admin.partners')} ({filteredPartners.length})</h1>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="partner">Partners</SelectItem>
            <SelectItem value="media_partner">Media Partners</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Card><CardContent className="p-0"><div className="overflow-x-auto"><table className="w-full"><thead className="bg-gray-50 border-b"><tr>
        <th className="text-left p-4 font-medium">Name</th>
        <th className="text-left p-4 font-medium">Type</th>
        <th className="text-left p-4 font-medium">Tier</th>
        <th className="text-left p-4 font-medium">Country</th>
        <th className="text-left p-4 font-medium">Status</th>
        <th className="text-left p-4 font-medium">Actions</th>
      </tr></thead><tbody>
        {filteredPartners.map(p => (<tr key={p.id} className="border-b hover:bg-gray-50">
          <td className="p-4"><div className="font-medium">{p.name}</div>{p.website && <div className="text-xs text-gray-500 truncate max-w-[200px]">{p.website}</div>}</td>
          <td className="p-4"><Badge variant="outline">{p.organization_type === 'media_partner' ? 'Media' : 'Partner'}</Badge></td>
          <td className="p-4">{tierBadge(p.tier)}</td>
          <td className="p-4">{[p.city, p.country].filter(Boolean).join(', ') || '—'}</td>
          <td className="p-4">{statusBadge(p.access_status)}</td>
          <td className="p-4"><div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setSelectedPartner(p)}><Eye className="h-4 w-4" /></Button>
            {p.access_status !== 'verified' && <Button size="sm" variant="outline" onClick={() => updateStatus(p.id, 'verified')}>Verify</Button>}
            {p.access_status === 'verified' && <Button size="sm" variant="outline" className="text-red-600" onClick={() => updateStatus(p.id, 'suspended')}>Suspend</Button>}
          </div></td>
        </tr>))}
        {filteredPartners.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-gray-400">No partner organizations found</td></tr>}
      </tbody></table></div></CardContent></Card>
      <Dialog open={!!selectedPartner} onOpenChange={() => setSelectedPartner(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Partner Details</DialogTitle><DialogDescription>View and manage partner organization.</DialogDescription></DialogHeader>
          {selectedPartner && (
            <div className="space-y-4 mt-2">
              <div className="grid grid-cols-2 gap-4">
                <div><strong>Name:</strong> {selectedPartner.name}</div>
                <div><strong>Type:</strong> {selectedPartner.organization_type === 'media_partner' ? 'Media Partner' : 'Partner'}</div>
                <div><strong>Country:</strong> {selectedPartner.country || '—'}</div>
                <div><strong>City:</strong> {selectedPartner.city || '—'}</div>
                <div><strong>Status:</strong> {selectedPartner.access_status}</div>
                <div><strong>Onboarding:</strong> {selectedPartner.onboarding_status}</div>
              </div>
              {/* Tier Assignment */}
              <div className="border rounded-lg p-4 bg-gray-50 space-y-2">
                <Label className="font-semibold">Membership Tier</Label>
                <div className="flex items-center gap-3">
                  <Select
                    value={selectedPartner.tier}
                    onValueChange={(v) => updateTier(selectedPartner.id, v)}
                    disabled={updatingTier}
                  >
                    <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="member">Member</SelectItem>
                      <SelectItem value="innovation_partner">Innovation Partner</SelectItem>
                      <SelectItem value="associate_partner">Associate Partner</SelectItem>
                      <SelectItem value="premium_partner">Premium Partner</SelectItem>
                      <SelectItem value="main_sponsor">Main Sponsor</SelectItem>
                    </SelectContent>
                  </Select>
                  {updatingTier && <RefreshCw className="h-4 w-4 animate-spin text-gray-400" />}
                </div>
                <p className="text-xs text-gray-500">Changing the tier will update seat limits automatically.</p>
                {/* Manual seat override */}
                <div className="flex items-center gap-3 mt-3 pt-3 border-t border-gray-200">
                  <Label className="text-sm whitespace-nowrap">Max Seats:</Label>
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    className="w-20 h-8"
                    value={selectedPartner.max_seats}
                    onChange={(e) => setSelectedPartner({ ...selectedPartner, max_seats: parseInt(e.target.value) || 1 })}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      const { error } = await supabase
                        .from('organizations')
                        .update({ max_seats: selectedPartner.max_seats })
                        .eq('id', selectedPartner.id);
                      if (error) {
                        toast({ title: 'Failed', description: error.message, variant: 'destructive' });
                      } else {
                        toast({ title: `Seats updated to ${selectedPartner.max_seats}` });
                        loadPartners();
                      }
                    }}
                  >
                    Save
                  </Button>
                </div>
                <p className="text-xs text-gray-500">Override seat limit when additional payment is confirmed.</p>
              </div>
              {selectedPartner.website && <div><strong>Website:</strong> <a href={selectedPartner.website} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{selectedPartner.website}</a></div>}
              {selectedPartner.description && <div><strong>Description:</strong><p className="mt-1 p-3 bg-gray-50 rounded text-sm">{selectedPartner.description}</p></div>}
              <div className="flex gap-2 pt-2">
                <Link to={`/organizations/${selectedPartner.id}`} target="_blank"><Button variant="outline" size="sm"><ExternalLink className="h-4 w-4 mr-2" />View Public Page</Button></Link>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
