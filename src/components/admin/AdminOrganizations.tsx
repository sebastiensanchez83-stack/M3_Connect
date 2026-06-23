import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Search, Building2, ChevronRight, Users, Globe, MapPin, ExternalLink } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TIER_LABELS, TIER_COLORS, OrgTier } from '@/types/database';
import { supabase } from '@/lib/supabase';
import { useAdminFilters } from './hooks/useAdminFilters';
import { AdminContextBanner } from './AdminContextBanner';

interface OrgRow {
  id: string;
  name: string;
  slug: string;
  primary_domain: string | null;
  organization_type: string | null;
  tier: string;
  max_seats: number;
  logo_url: string | null;
  website: string | null;
  country: string | null;
  city: string | null;
  access_status: string;
  onboarding_status: string;
  created_at: string;
  member_count: number;
  owner_name: string | null;
  owner_email: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  verified: 'bg-green-50 text-green-700 border-green-200',
  pending: 'bg-amber-50 text-amber-700 border-amber-200',
  rejected: 'bg-red-50 text-red-700 border-red-200',
  suspended: 'bg-gray-100 text-gray-600 border-gray-300',
};

const TYPE_LABELS: Record<string, string> = {
  marina: 'Marina',
  partner: 'Partner',
  media_partner: 'Media',
};

export function AdminOrganizations() {
  const navigate = useNavigate();
  const { getFilter, setFilters, hasFilters, clearFilters } = useAdminFilters();
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const statusFilter = getFilter('status', 'all');
  const typeFilter = getFilter('type', 'all');
  const tierFilter = getFilter('tier', 'all');

  useEffect(() => { loadOrgs(); }, []);

  const loadOrgs = async () => {
    setLoading(true);

    // Fetch organizations
    const { data: orgData } = await supabase
      .from('organizations')
      .select('id, name, slug, primary_domain, organization_type, tier, max_seats, logo_url, website, country, city, access_status, onboarding_status, created_at, owner_user_id')
      .order('created_at', { ascending: false });

    if (!orgData) { setOrgs([]); setLoading(false); return; }

    // Fetch member counts in a single query (avoid N+1)
    const orgIds = orgData.map(o => o.id);
    const memberCounts: Record<string, number> = {};
    const { data: memberRows } = await supabase
      .from('organization_members')
      .select('organization_id')
      .in('organization_id', orgIds);
    (memberRows || []).forEach((m: { organization_id: string }) => {
      memberCounts[m.organization_id] = (memberCounts[m.organization_id] || 0) + 1;
    });

    // Fetch owner profiles
    const ownerIds = orgData.map(o => o.owner_user_id).filter(Boolean) as string[];
    const { data: ownerProfiles } = ownerIds.length > 0
      ? await supabase.from('profiles').select('user_id, first_name, last_name, email').in('user_id', ownerIds)
      : { data: [] };
    const ownerMap = new Map((ownerProfiles || []).map((p: any) => [p.user_id, p]));

    const rows: OrgRow[] = orgData.map((o: any) => {
      const owner = ownerMap.get(o.owner_user_id) as any;
      return {
        ...o,
        member_count: memberCounts[o.id] || 0,
        owner_name: owner ? `${owner.first_name || ''} ${owner.last_name || ''}`.trim() : null,
        owner_email: owner?.email || null,
      };
    });

    setOrgs(rows);
    setLoading(false);
  };

  // Filter
  const filtered = orgs.filter(o => {
    if (search) {
      const q = search.toLowerCase();
      if (!o.name.toLowerCase().includes(q) &&
          !(o.primary_domain || '').toLowerCase().includes(q) &&
          !(o.owner_email || '').toLowerCase().includes(q) &&
          !(o.owner_name || '').toLowerCase().includes(q)) return false;
    }
    if (statusFilter !== 'all' && o.access_status !== statusFilter) return false;
    if (typeFilter !== 'all' && o.organization_type !== typeFilter) return false;
    if (tierFilter !== 'all' && o.tier !== tierFilter) return false;
    return true;
  });

  // Stats
  const verified = orgs.filter(o => o.access_status === 'verified').length;
  const pending = orgs.filter(o => o.access_status === 'pending').length;

  const bannerLabel = hasFilters
    ? [
        statusFilter !== 'all' ? statusFilter : '',
        typeFilter !== 'all' ? TYPE_LABELS[typeFilter] || typeFilter : '',
        tierFilter !== 'all' ? TIER_LABELS[tierFilter as OrgTier] || tierFilter : '',
      ].filter(Boolean).join(', ')
    : '';

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <RefreshCw className="h-8 w-8 animate-spin text-gray-400" />
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Organizations ({orgs.length})</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {verified} verified • {pending} pending
          </p>
        </div>
      </div>

      {hasFilters && (
        <AdminContextBanner label={bannerLabel} count={filtered.length} onClear={clearFilters} color="blue" />
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, domain, owner..." className="pl-9 h-9" />
        </div>
        <Select value={statusFilter} onValueChange={v => setFilters({ status: v === 'all' ? '' : v } as any)}>
          <SelectTrigger className="w-36 h-9"><SelectValue placeholder="All statuses" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="verified">Verified</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
            <SelectItem value="suspended">Suspended</SelectItem>
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={v => setFilters({ type: v === 'all' ? '' : v } as any)}>
          <SelectTrigger className="w-36 h-9"><SelectValue placeholder="All types" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="marina">Marina</SelectItem>
            <SelectItem value="partner">Partner</SelectItem>
            <SelectItem value="media_partner">Media</SelectItem>
          </SelectContent>
        </Select>
        <Select value={tierFilter} onValueChange={v => setFilters({ tier: v === 'all' ? '' : v } as any)}>
          <SelectTrigger className="w-44 h-9"><SelectValue placeholder="All tiers" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Tiers</SelectItem>
            <SelectItem value="member">Member</SelectItem>
            <SelectItem value="innovation_partner">Innovation Partner</SelectItem>
            <SelectItem value="associate_partner">Associate Partner</SelectItem>
            <SelectItem value="premium_partner">Partner</SelectItem>
            <SelectItem value="premium_sponsor">Premium Sponsor</SelectItem>
            <SelectItem value="main_sponsor">Main Sponsor</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Org rows */}
      <div className="space-y-2">
        {filtered.length === 0 ? (
          <Card className="border-0 shadow-sm">
            <CardContent className="py-12 text-center text-gray-400">No organizations match your filters</CardContent>
          </Card>
        ) : (
          filtered.map(o => {
            const tierColors = TIER_COLORS[o.tier as OrgTier];
            const statusColor = STATUS_COLORS[o.access_status] || STATUS_COLORS.pending;
            return (
              <Card key={o.id}
                className="border-0 shadow-sm hover:shadow-md transition-all cursor-pointer group"
                onClick={() => navigate(`/admin/organizations/${o.id}`)}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-4">
                    {/* Logo */}
                    <div className="h-12 w-12 rounded-xl shrink-0 overflow-hidden bg-white border border-gray-100 flex items-center justify-center">
                      {o.logo_url ? (
                        <img src={o.logo_url} alt={o.name} className="h-full w-full object-contain p-0.5" />
                      ) : (
                        <Building2 className="h-6 w-6 text-gray-400" />
                      )}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                        <span className="text-sm font-semibold text-gray-900 truncate group-hover:text-primary transition-colors">
                          {o.name}
                        </span>
                        <Badge className={`${statusColor} border text-[10px]`}>
                          {o.access_status}
                        </Badge>
                        {o.organization_type && (
                          <Badge variant="outline" className="text-[10px]">
                            {TYPE_LABELS[o.organization_type] || o.organization_type}
                          </Badge>
                        )}
                        <Badge className={`${tierColors?.bg || 'bg-gray-50'} ${tierColors?.text || 'text-gray-700'} border ${tierColors?.border || 'border-gray-200'} text-[10px]`}>
                          {TIER_LABELS[o.tier as OrgTier] || o.tier}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-gray-500 flex-wrap">
                        <span className="flex items-center gap-1">
                          <Users className="h-3 w-3" />
                          {o.member_count}/{o.max_seats} seats
                        </span>
                        {o.primary_domain && (
                          <span className="flex items-center gap-1">
                            <Globe className="h-3 w-3" />
                            {o.primary_domain}
                          </span>
                        )}
                        {(o.city || o.country) && (
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {[o.city, o.country].filter(Boolean).join(', ')}
                          </span>
                        )}
                        {o.owner_name && (
                          <span className="text-gray-400">
                            Owner: {o.owner_name}
                          </span>
                        )}
                        <span className="text-gray-400">
                          {new Date(o.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </span>
                      </div>
                    </div>

                    {/* Actions */}
                    {o.website && (
                      <a href={o.website} target="_blank" rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                        className="text-gray-300 hover:text-primary transition-colors">
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    )}
                    <ChevronRight className="h-5 w-5 text-gray-300 group-hover:text-primary transition-colors shrink-0" />
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
