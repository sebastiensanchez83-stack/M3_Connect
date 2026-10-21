import { useState, useEffect } from 'react';
import { externalUrl } from '@/lib/externalUrl';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Building2, Globe, ExternalLink } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TIER_LABELS, OrgTier } from '@/types/database';
import { supabase } from '@/lib/supabase';
import { ActionCue, CardLink } from '@/components/home/dashboard/DashboardKit';
import { useAdminFilters } from './hooks/useAdminFilters';
import { AdminContextBanner } from './AdminContextBanner';
import { AdminPageHeader, AdminFilterBar, AdminTableCard, AdminStatus, AdminEmpty, AdminLoading } from './AdminUI';
import { fmtDay, TierPill } from './AdminStyleKit';
import { Note } from './v2/MembersKit';

/**
 * The previous list of companies (/admin/organizations). Members > Companies (/admin/companies)
 * is the list of the menu now; this one stays reachable by its address and keeps its filters
 * (?status=&type=&tier=). Desktop: a table; phone: one card per company. Every row opens the
 * company's settings screen (/admin/organizations/:id) and says so with its "Open" pill.
 */

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

function Logo({ o }: { o: OrgRow }) {
  return (
    <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-xl border border-rule bg-white">
      {o.logo_url ? (
        <img src={o.logo_url} alt="" className="h-full w-full object-contain p-0.5" />
      ) : (
        <Building2 className="h-5 w-5 text-meta/60" aria-hidden="true" />
      )}
    </span>
  );
}

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
        statusFilter !== 'all' ? ({ verified: 'Verified', pending: 'Pending', rejected: 'Rejected', suspended: 'Suspended' } as Record<string, string>)[statusFilter] || statusFilter : '',
        typeFilter !== 'all' ? TYPE_LABELS[typeFilter] || typeFilter : '',
        tierFilter !== 'all' ? TIER_LABELS[tierFilter as OrgTier] || tierFilter : '',
      ].filter(Boolean).join(', ')
    : '';

  if (loading) return <AdminLoading />;

  const place = (o: OrgRow) => [o.city, o.country].filter(Boolean).join(', ');
  const openLabel = t('adm2.orgs.open', 'Open');

  return (
    <div>
      <AdminPageHeader
        title={t('adm2.orgs.title', 'All companies (settings view)')}
        count={orgs.length}
        description={t('adm2.orgs.desc', 'Every registered company with its access, type, sponsor plan and seats. Press a row to open its settings.')}
        meta={<><span>{t('adm2.orgs.verified', '{{count}} validated', { count: verified })}</span><span aria-hidden="true">•</span><span>{t('adm2.orgs.pending', '{{count}} waiting for validation', { count: pending })}</span></>}
        actions={<CardLink to="/admin/companies">{t('adm2.orgs.toCompanies', 'Go to Members > Companies')}</CardLink>}
      />

      <div className="mb-4">
        <Note>{t('adm2.orgs.note', 'The everyday list is Members > Companies. This view adds the seats used, and each row opens the company settings: sponsor plan, seats, claim code.')}</Note>
      </div>

      {hasFilters && (
        <AdminContextBanner lead={t('adm2.banner.lead', 'Showing only:')} label={bannerLabel} count={filtered.length} onClear={clearFilters} color="blue" />
      )}

      {/* Filters */}
      <AdminFilterBar search={search} onSearchChange={setSearch} searchPlaceholder={t('adm2.orgs.search', 'Search a name, an e-mail domain, the person in charge…')}>
        <Select value={statusFilter} onValueChange={v => setFilters({ status: v === 'all' ? '' : v } as any)}>
          <SelectTrigger className="w-full sm:w-44" aria-label={t('adm2.orgs.status', 'Access')}><SelectValue placeholder="All statuses" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="verified">Verified</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
            <SelectItem value="suspended">Suspended</SelectItem>
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={v => setFilters({ type: v === 'all' ? '' : v } as any)}>
          <SelectTrigger className="w-full sm:w-44" aria-label={t('adm2.orgs.type', 'Type')}><SelectValue placeholder="All types" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="marina">Marina</SelectItem>
            <SelectItem value="partner">Service provider</SelectItem>
            <SelectItem value="media_partner">Media</SelectItem>
          </SelectContent>
        </Select>
        <Select value={tierFilter} onValueChange={v => setFilters({ tier: v === 'all' ? '' : v } as any)}>
          <SelectTrigger className="w-full sm:w-48" aria-label={t('adm2.orgs.tier', 'Sponsor plan')}><SelectValue placeholder="All plans" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All plans</SelectItem>
            {(Object.keys(TIER_LABELS) as OrgTier[]).map(k => <SelectItem key={k} value={k}>{TIER_LABELS[k]}</SelectItem>)}
          </SelectContent>
        </Select>
      </AdminFilterBar>

      {filtered.length === 0 ? (
        <div className="rounded-card border border-rule bg-white">
          <AdminEmpty icon={Building2} title={t('adm2.orgs.none', 'No company matches these filters')} />
        </div>
      ) : (
        <>
          {/* Phone and tablet (below 1280 px, where the table would scroll sideways): one card per company */}
          <ul className="grid gap-3 lg:grid-cols-2 xl:hidden" aria-label={t('adm2.orgs.title', 'All companies (settings view)')}>
            {filtered.map(o => (
              <li key={o.id}>
                <Link to={`/admin/organizations/${o.id}`} className="group block rounded-card border border-rule bg-white p-4 focus:outline-none focus-visible:shadow-focus">
                  <div className="flex items-start gap-3">
                    <Logo o={o} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[16px] font-semibold leading-6 text-navy [overflow-wrap:anywhere]">{o.name}</p>
                      <p className="text-[13px] leading-5 text-meta">
                        {[o.organization_type ? (TYPE_LABELS[o.organization_type] || o.organization_type) : null, place(o) || null].filter(Boolean).join(' · ')}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <AdminStatus status={o.access_status} />
                        <TierPill tier={o.tier} />
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <span className="text-[13px] text-meta [overflow-wrap:anywhere]">
                      {t('adm2.orgs.seats', '{{used}} of {{max}} seats', { used: o.member_count, max: o.max_seats })}
                      {o.owner_name ? ` · ${o.owner_name}` : ''}
                    </span>
                    <ActionCue size="sm">{openLabel}</ActionCue>
                  </div>
                </Link>
              </li>
            ))}
          </ul>

          {/* Wide screens (1280 px and up): the table */}
          <AdminTableCard className="hidden xl:block" footer={t('adm2.orgs.footer', '{{shown}} of {{total}} companies shown', { shown: filtered.length, total: orgs.length })}>
            <table className="w-full">
              <thead>
                <tr>
                  <th className="text-left">Company</th>
                  <th className="text-left">Type</th>
                  <th className="text-left">Sponsor plan</th>
                  <th className="text-left">Access</th>
                  <th className="text-left">Seats</th>
                  <th className="hidden text-left lg:table-cell">Place</th>
                  <th className="hidden text-left 2xl:table-cell">Person in charge</th>
                  <th className="hidden text-left 2xl:table-cell">Created</th>
                  <th className="text-left"><span className="sr-only">{openLabel}</span></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(o => (
                  <tr key={o.id} className="group cursor-pointer" onClick={() => navigate(`/admin/organizations/${o.id}`)}>
                    <td>
                      <div className="flex items-center gap-3">
                        <Logo o={o} />
                        <div className="min-w-0">
                          <Link
                            to={`/admin/organizations/${o.id}`}
                            onClick={e => e.stopPropagation()}
                            className="rounded-sm font-semibold text-navy focus:outline-none focus-visible:shadow-focus"
                          >
                            <span className="card-ul">{o.name}</span>
                          </Link>
                          {(o.primary_domain || o.website) && (
                            <div className="flex items-center gap-1 text-xs text-meta">
                              <Globe className="h-3 w-3 shrink-0" aria-hidden="true" />
                              <span className="truncate">{o.primary_domain || o.website}</span>
                              {o.website && (
                                <a
                                  href={externalUrl(o.website) ?? undefined}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={e => e.stopPropagation()}
                                  aria-label={`Open the website of ${o.name} (new tab)`}
                                  title="Open their website (new tab)"
                                  className="ml-0.5 rounded-sm text-meta transition-colors hover:text-navy focus:outline-none focus-visible:shadow-focus"
                                >
                                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                                </a>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="whitespace-nowrap text-sm text-ink">
                      {o.organization_type ? (TYPE_LABELS[o.organization_type] || o.organization_type) : <span className="text-meta/60">—</span>}
                    </td>
                    <td><TierPill tier={o.tier} /></td>
                    <td><AdminStatus status={o.access_status} /></td>
                    <td className="whitespace-nowrap text-sm tabular-nums text-ink">{o.member_count}/{o.max_seats}</td>
                    <td className="hidden text-sm text-ink lg:table-cell">{place(o) || <span className="text-meta/60">—</span>}</td>
                    <td className="hidden text-sm text-ink 2xl:table-cell">{o.owner_name || <span className="text-meta/60">—</span>}</td>
                    <td className="hidden whitespace-nowrap text-sm text-meta 2xl:table-cell">{fmtDay(o.created_at)}</td>
                    <td className="text-right"><ActionCue size="sm">{openLabel}</ActionCue></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </AdminTableCard>
        </>
      )}
    </div>
  );
}
