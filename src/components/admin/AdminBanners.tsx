import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Plus, Search, ChevronRight, Image as ImageIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { supabase } from '@/lib/supabase';
import { useAdminFilters } from './hooks/useAdminFilters';
import { AdminContextBanner } from './AdminContextBanner';

interface AdBanner {
  id: string;
  title: string;
  image_url: string;
  target_url: string;
  placement: string;
  is_active: boolean;
  start_date: string | null;
  end_date: string | null;
  click_count: number;
  impression_count: number;
  organization_id: string | null;
  created_at: string;
}

const PLACEMENTS = ['homepage', 'marketplace', 'resources', 'events'] as const;

function getBannerStatus(banner: AdBanner): { label: string; variant: string } {
  if (!banner.is_active) return { label: 'Inactive', variant: 'secondary' };
  const now = new Date();
  if (banner.start_date && new Date(banner.start_date) > now) return { label: 'Scheduled', variant: 'info' };
  if (banner.end_date && new Date(banner.end_date) < now) return { label: 'Expired', variant: 'warning' };
  return { label: 'Active', variant: 'success' };
}

export function AdminBanners() {
  const navigate = useNavigate();
  const { getFilter, setFilters, hasFilters, clearFilters } = useAdminFilters();
  const [banners, setBanners] = useState<AdBanner[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const placementFilter = getFilter('placement', 'all');
  const statusFilter = getFilter('status', 'all');

  useEffect(() => { loadBanners(); }, []);

  const loadBanners = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('ad_banners')
      .select('*')
      .order('created_at', { ascending: false });
    setBanners((data || []) as AdBanner[]);
    setLoading(false);
  };

  const filtered = banners.filter(b => {
    if (search && !b.title.toLowerCase().includes(search.toLowerCase())) return false;
    if (placementFilter !== 'all' && b.placement !== placementFilter) return false;
    if (statusFilter !== 'all') {
      const s = getBannerStatus(b).label.toLowerCase();
      if (s !== statusFilter) return false;
    }
    return true;
  });

  const bannerLabel = hasFilters
    ? [
        placementFilter !== 'all' ? placementFilter : '',
        statusFilter !== 'all' ? statusFilter : '',
      ].filter(Boolean).join(', ') || 'Filtered banners'
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
        <h1 className="text-2xl font-bold text-gray-900">Ad Banners ({filtered.length})</h1>
        <Button onClick={() => navigate('/admin/banners/new')} className="gap-1.5">
          <Plus className="h-4 w-4" /> Create Banner
        </Button>
      </div>

      {/* Context banner */}
      {hasFilters && (
        <AdminContextBanner label={bannerLabel} count={filtered.length} onClear={clearFilters} color="pink" />
      )}

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search banners..." className="pl-9 h-9" />
        </div>
        <Select value={placementFilter} onValueChange={v => setFilters({ placement: v === 'all' ? '' : v } as any)}>
          <SelectTrigger className="w-40 h-9"><SelectValue placeholder="All placements" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Placements</SelectItem>
            {PLACEMENTS.map(p => (
              <SelectItem key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={v => setFilters({ status: v === 'all' ? '' : v } as any)}>
          <SelectTrigger className="w-40 h-9"><SelectValue placeholder="All statuses" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
            <SelectItem value="scheduled">Scheduled</SelectItem>
            <SelectItem value="expired">Expired</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Banner cards */}
      <div className="space-y-2">
        {filtered.length === 0 ? (
          <Card className="border-0 shadow-sm">
            <CardContent className="py-12 text-center text-gray-400">No banners match your filters</CardContent>
          </Card>
        ) : (
          filtered.map(b => {
            const status = getBannerStatus(b);
            const ctr = b.impression_count > 0
              ? ((b.click_count / b.impression_count) * 100).toFixed(1) + '%'
              : '—';
            return (
              <Card
                key={b.id}
                className={`border-0 shadow-sm hover:shadow-md transition-all cursor-pointer group ${!b.is_active ? 'opacity-70' : ''}`}
                onClick={() => navigate(`/admin/banners/${b.id}`)}
              >
                <CardContent className="p-4">
                  <div className="flex items-center gap-4">
                    {/* Thumbnail */}
                    <div className="h-14 w-20 rounded-lg overflow-hidden bg-gray-100 shrink-0">
                      {b.image_url ? (
                        <img src={b.image_url} alt={b.title} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <ImageIcon className="h-5 w-5 text-gray-300" />
                        </div>
                      )}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-sm font-semibold text-gray-900 truncate group-hover:text-primary transition-colors">
                          {b.title}
                        </span>
                        <Badge variant={status.variant as any} className="shrink-0 text-[10px]">
                          {status.label}
                        </Badge>
                        <Badge variant="outline" className="shrink-0 text-[10px]">
                          {b.placement}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-gray-500">
                        <span>{b.impression_count.toLocaleString()} impressions</span>
                        <span>{b.click_count.toLocaleString()} clicks</span>
                        <span className="font-medium text-violet-600">CTR: {ctr}</span>
                        {b.start_date && (
                          <span>
                            {new Date(b.start_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                            {b.end_date && ` — ${new Date(b.end_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}`}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Arrow */}
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
