import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Plus, Image as ImageIcon, Megaphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { ActionCue } from '@/components/home/dashboard/DashboardKit';
import { supabase } from '@/lib/supabase';
import { useAdminFilters } from './hooks/useAdminFilters';
import {
  AdminEmpty, AdminFilterBar, AdminLoading, AdminPageHeader, AdminStatusPill, ADMIN_BTN, ADMIN_BTN_PRIMARY, type AdminTone,
} from './AdminUI';

interface AdBanner {
  id: string;
  title: string;
  image_url: string;
  target_url: string;
  placement: string;
  placements: string[];
  is_active: boolean;
  start_date: string | null;
  end_date: string | null;
  click_count: number;
  impression_count: number;
  organization_id: string | null;
  created_at: string;
}

// Must stay in step with AdminBannerDetail — the announcement slots were missing
// here, so an announcement row could never be matched by the filter.
const PLACEMENTS = ['homepage', 'marketplace', 'resources', 'events', 'announcement_top', 'announcement_popup'] as const;
const pagesOf = (b: { placements?: string[]; placement: string }) =>
  b.placements?.length ? b.placements : [b.placement];

/** What each place is called on screen (the data keys stay as they are). */
const PLACE_LABEL: Record<string, string> = {
  homepage: 'Homepage',
  marketplace: 'Marketplace',
  resources: 'Articles',
  events: 'Events',
  announcement_top: 'Top strip (announcement)',
  announcement_popup: 'Popup (announcement)',
};
const placeLabel = (p: string) => PLACE_LABEL[p] ?? p.replace(/_/g, ' ');

function getBannerStatus(banner: AdBanner): { label: string; variant: string } {
  if (!banner.is_active) return { label: 'Inactive', variant: 'secondary' };
  const now = new Date();
  if (banner.start_date && new Date(banner.start_date) > now) return { label: 'Scheduled', variant: 'info' };
  if (banner.end_date && new Date(banner.end_date) < now) return { label: 'Expired', variant: 'warning' };
  return { label: 'Active', variant: 'success' };
}

/** The status pill: the same four states as before, in the admin tones. */
const STATUS_TONE: Record<string, AdminTone> = { Active: 'success', Scheduled: 'info', Expired: 'warning', Inactive: 'neutral' };
const STATUS_HINT: Record<string, string> = {
  Active: 'Shown on the site now',
  Scheduled: 'Starts on its start date',
  Expired: 'Its end date has passed: no longer shown',
  Inactive: 'Switched off: not shown on the site',
};

const fmtShort = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
const fmtLong = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

export function AdminBanners() {
  const { t } = useTranslation();
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
    if (placementFilter !== 'all' && !pagesOf(b).includes(placementFilter)) return false;
    if (statusFilter !== 'all') {
      const s = getBannerStatus(b).label.toLowerCase();
      if (s !== statusFilter) return false;
    }
    return true;
  });

  const bannerLabel = hasFilters
    ? [
        placementFilter !== 'all' ? placeLabel(placementFilter) : '',
        statusFilter !== 'all' ? statusFilter : '',
      ].filter(Boolean).join(', ') || 'Filtered banners'
    : '';

  if (loading) return <AdminLoading />;

  return (
    <div>
      <AdminPageHeader
        title={t('adminContent.banners.title', 'Banners and announcements')}
        count={filtered.length}
        description={t('adminContent.banners.desc', 'The sponsors’ adverts and the site announcements (top strip, popup). Press a banner to change it.')}
        actions={
          <Button variant="secondary" onClick={() => navigate('/admin/banners/new')} className={ADMIN_BTN_PRIMARY + ' gap-1.5'}>
            <Plus className="h-4 w-4" aria-hidden="true" /> {t('adminContent.banners.create', 'Create a banner')}
          </Button>
        }
      />

      <AdminFilterBar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder={t('adminContent.banners.search', 'Search a banner by its title…')}
        trailing={hasFilters ? (
          <>
            <span className="hidden text-[13px] text-meta sm:inline">{t('adminContent.banners.showing', 'Showing: {{what}}', { what: bannerLabel })}</span>
            <Button type="button" variant="outline" className={ADMIN_BTN} onClick={clearFilters}>
              {t('adminContent.banners.clear', 'Show all banners')}
            </Button>
          </>
        ) : undefined}
      >
        <Select value={placementFilter} onValueChange={v => setFilters({ placement: v === 'all' ? '' : v } as any)}>
          <SelectTrigger className="w-full sm:w-56" aria-label={t('adminContent.banners.where', 'Where it shows')}><SelectValue placeholder="Every place" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('adminContent.banners.allPlaces', 'Every place on the site')}</SelectItem>
            {PLACEMENTS.map(p => (
              <SelectItem key={p} value={p}>{placeLabel(p)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={v => setFilters({ status: v === 'all' ? '' : v } as any)}>
          <SelectTrigger className="w-full sm:w-44" aria-label={t('adminContent.banners.status', 'Status')}><SelectValue placeholder="All statuses" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('adminContent.banners.allStatuses', 'All statuses')}</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
            <SelectItem value="scheduled">Scheduled</SelectItem>
            <SelectItem value="expired">Expired</SelectItem>
          </SelectContent>
        </Select>
      </AdminFilterBar>

      {filtered.length === 0 ? (
        <div className="rounded-card border border-rule bg-white">
          <AdminEmpty
            icon={Megaphone}
            title={banners.length === 0 ? t('adminContent.banners.none', 'No banner yet') : t('adminContent.banners.noMatch', 'No banner matches these filters')}
            body={banners.length === 0 ? t('adminContent.banners.noneBody', 'Press “Create a banner” to add a sponsor’s advert or a site announcement.') : undefined}
          />
        </div>
      ) : (
        <ul className="space-y-3" aria-label={t('adminContent.banners.title', 'Banners and announcements')}>
          {filtered.map(b => {
            const status = getBannerStatus(b);
            const ctr = b.impression_count > 0
              ? ((b.click_count / b.impression_count) * 100).toFixed(1) + '%'
              : '—';
            return (
              <li key={b.id}>
                <Link
                  to={`/admin/banners/${b.id}`}
                  className="group flex flex-col gap-3 rounded-card border border-rule bg-white p-4 transition-[box-shadow,border-color] duration-200 hover:border-navy/30 hover:shadow-hover focus:outline-none focus-visible:shadow-focus motion-reduce:transition-none sm:flex-row sm:items-center sm:gap-4"
                >
                  <div className="flex min-w-0 flex-1 items-start gap-3 sm:items-center sm:gap-4">
                    {/* Thumbnail */}
                    <div className="h-14 w-20 shrink-0 overflow-hidden rounded-xl border border-rule bg-chip sm:h-16 sm:w-28">
                      {b.image_url ? (
                        <img src={b.image_url} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center">
                          <ImageIcon className="h-5 w-5 text-meta/60" aria-hidden="true" />
                        </div>
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="text-[16px] font-semibold leading-6 text-navy [overflow-wrap:anywhere]">
                        <span className="card-ul">{b.title}</span>
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <AdminStatusPill tone={STATUS_TONE[status.label] ?? 'neutral'} title={STATUS_HINT[status.label]}>{status.label}</AdminStatusPill>
                        {pagesOf(b).map(p => (
                          <AdminStatusPill key={p} tone="info">{placeLabel(p)}</AdminStatusPill>
                        ))}
                      </div>
                      <p className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[13px] leading-5 text-meta">
                        <span>{b.impression_count.toLocaleString()} views</span>
                        <span>{b.click_count.toLocaleString()} clicks</span>
                        <span className="font-semibold text-navy">Click rate: {ctr}</span>
                        {/* Show the end date even with no start date — otherwise a
                            campaign with only an expiry shows no dates at all. */}
                        {(b.start_date || b.end_date) && (
                          <span>
                            {b.start_date ? fmtShort(b.start_date) : 'Until'}
                            {b.end_date && `${b.start_date ? ' — ' : ' '}${fmtLong(b.end_date)}`}
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <ActionCue size="sm">{t('adminContent.banners.open', 'Open the banner')}</ActionCue>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
