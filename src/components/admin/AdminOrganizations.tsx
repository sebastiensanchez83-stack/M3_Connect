import { useState, useEffect } from 'react';
import { externalUrl } from '@/lib/externalUrl';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Building2, Globe, ExternalLink } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TIER_LABELS, TIER_COLORS, OrgTier } from '@/types/database';
import { supabase } from '@/lib/supabase';
import { useAdminFilters } from './hooks/useAdminFilters';
import { AdminContextBanner } from './AdminContextBanner';
import { AdminPageHeader, AdminFilterBar, AdminTableCard, AdminStatus, AdminEmpty, AdminLoading } from './AdminUI';

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


const TYPE_LABELS: Record<string, string> = {
  marina: 'Marina',
  partner: 'Service provider',
  media_partner: 'Media',
  investor: 'Investor',
};

export function AdminOrganizations() {
  const { t } = useTranslation();
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

  if (loading) return <AdminLoading />;

  return (
    <div>
      <AdminPageHeader
        title="Organizations"
        count={orgs.length}
        description={t('adminUi.pages.organizations')}
        meta={<><span>{verified} verified</span><span aria-hidden="true">•</span><span>{pending} pending</span></>}
      />

      {hasFilters && (
        <AdminContextBanner label={bannerLabel} count={filtered.length} onClear={clearFilters} color="blue" />
      )}

      {/* Filters */}
      <AdminFilterBar search={search} onSearchChange={setSearch} searchPlaceholder="Search name, domain, owner...">
        <Select value={statusFilter} onValueChange={v => setFilters({ status: v === 'all' ? '' : v } as any)}>
          <SelectTrigger className="w-40"><SelectValue placeholder="All statuses" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="verified">Verified</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
            <SelectItem value="suspended">Suspended</SelectItem>
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={v => setFilters({ type: v === 'all' ? '' : v } as any)}>
          <SelectTrigger className="w-44"><SelectValue placeholder="All types" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="marina">Marina</SelectItem>
            <SelectItem value="partner">Service provider</SelectItem>
            <SelectItem value="media_partner">Media</SelectItem>
          </SelectContent>
        </Select>
        <Select value={tierFilter} onValueChange={v => setFilters({ tier: v === 'all' ? '' : v } as any)}>
          <SelectTrigger className="w-48"><SelectValue placeholder="All tiers" /></SelectTrigger>
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
      </AdminFilterBar>

      {/* Org rows */}
      <AdminTableCard footer={`${filtered.length} of ${orgs.length} organizations`}>
        <table className="w-full">
          <thead>
            <tr>
              <th className="text-left">Organization</th>
              <th className="text-left">Type</th>
              <th className="text-left">Plan</th>
              <th className="text-left">Access</th>
              <th className="text-left">Seats</th>
              <th className="text-left">Location</th>
              <th className="text-left">Owner</th>
              <th className="text-left">Created</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={8}><AdminEmpty icon={Building2} title="No organizations match your filters" /></td></tr>
            ) : (
              filtered.map(o => {
                const tierColors = TIER_COLORS[o.tier as OrgTier];
                return (
                  <tr key={o.id} className="group cursor-pointer" onClick={() => navigate(`/admin/organizations/${o.id}`)}>
                    <td>
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-rule bg-white">
                          {o.logo_url ? (
                            <img src={o.logo_url} alt="" className="h-full w-full object-contain p-0.5" />
                          ) : (
                            <Building2 className="h-5 w-5 text-meta/60" aria-hidden="true" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <Link
                            to={`/admin/organizations/${o.id}`}
                            onClick={e => e.stopPropagation()}
                            className="rounded-sm font-semibold text-navy focus:outline-none focus-visible:shadow-focus"
                          >
                            <span className="card-ul">{o.name}</span>
                          </Link>
                          {o.primary_domain && (
                            <div className="flex items-center gap-1 text-xs text-meta">
                              <Globe className="h-3 w-3 shrink-0" aria-hidden="true" />
                              <span className="truncate">{o.primary_domain}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="whitespace-nowrap text-sm text-ink">
                      {o.organization_type ? (TYPE_LABELS[o.organization_type] || o.organization_type) : <span className="text-meta/60">—</span>}
                    </td>
                    <td>
                      <Badge className={`${tierColors?.bg || 'bg-gray-50'} ${tierColors?.text || 'text-gray-700'} border ${tierColors?.border || 'border-gray-200'} whitespace-nowrap text-[11px]`}>
                        {TIER_LABELS[o.tier as OrgTier] || o.tier}
                      </Badge>
                    </td>
                    <td><AdminStatus status={o.access_status} /></td>
                    <td className="whitespace-nowrap text-sm tabular-nums text-ink">{o.member_count}/{o.max_seats}</td>
                    <td className="text-sm text-ink">
                      {(o.city || o.country) ? [o.city, o.country].filter(Boolean).join(', ') : <span className="text-meta/60">—</span>}
                    </td>
                    <td className="text-sm text-ink">{o.owner_name || <span className="text-meta/60">—</span>}</td>
                    <td>
                      <div className="flex items-center justify-between gap-2">
                        <span className="whitespace-nowrap text-sm text-meta">
                          {new Date(o.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </span>
                        {o.website && (
                          <a
                            href={externalUrl(o.website) ?? undefined}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={e => e.stopPropagation()}
                            aria-label={`Open ${o.name} website`}
                            className="rounded-sm text-meta/60 transition-colors hover:text-navy focus:outline-none focus-visible:shadow-focus"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </AdminTableCard>
    </div>
  );
}
