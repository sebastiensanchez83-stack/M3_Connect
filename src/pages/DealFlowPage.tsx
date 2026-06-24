import { useState, useEffect, useMemo } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  TrendingUp, MapPin, Building2, Anchor, HardHat, ChevronRight,
  Filter, Loader2, MessageSquare, Search, RefreshCw,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { LoadingSkeleton } from '@/components/LoadingSkeleton';
import { BookmarkButton } from '@/components/shortlist/BookmarkButton';
import { formatCapitalRange, formatCapitalAmount } from '@/components/capital/InvestmentThesisSection';
import { CAPITAL_TYPES, CAPITAL_STAGES } from '@/types/database';

interface DealFlowOrg {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  organization_type: string | null;
  country: string | null;
  city: string | null;
  description: string | null;
  // capital intent
  capital_type: string | null;
  amount_min: number | null;
  amount_max: number | null;
  stage: string | null;
  use_of_funds: string | null;
  updated_at: string;
  // sectors (loaded after the main fetch)
  sector_ids: string[];
  sector_labels: string[];
  // computed
  overlapping_sectors: number;
}

const TYPE_LABEL: Record<string, string> = {
  marina: 'Marina',
  developer: 'Developer',
  partner: 'Innovation partner',
};

const TYPE_ICON: Record<string, React.ReactNode> = {
  marina: <Anchor className="h-4 w-4" />,
  developer: <HardHat className="h-4 w-4" />,
  partner: <Building2 className="h-4 w-4" />,
};

export function DealFlowPage() {
  const { user, profile, organization, isVerified, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [orgs, setOrgs] = useState<DealFlowOrg[]>([]);
  const [investorSectorIds, setInvestorSectorIds] = useState<Set<string>>(new Set());

  // Filter state
  const [matchMyFocus, setMatchMyFocus] = useState(true);
  const [orgTypeFilter, setOrgTypeFilter] = useState<string>('all');
  const [capitalTypeFilter, setCapitalTypeFilter] = useState<string>('all');
  const [countryFilter, setCountryFilter] = useState<string>('all');
  const [search, setSearch] = useState('');

  // "Express interest" dialog state
  const [interestTarget, setInterestTarget] = useState<DealFlowOrg | null>(null);
  const [interestMessage, setInterestMessage] = useState('');
  const [sendingInterest, setSendingInterest] = useState(false);

  // Access guard — unified investor accreditation: a verified platform investor
  // (persona) OR someone with a confirmed SM26 investor role can see the deal-flow.
  const personaInvestor = !!user && profile?.persona === 'investor' && isVerified;
  const [smInvestor, setSmInvestor] = useState<boolean | null>(null); // null = still checking
  useEffect(() => {
    if (!user || personaInvestor) { setSmInvestor(false); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('sm_registration')
        .select('id, roles:sm_role_assignment(role,status)')
        .eq('user_id', user.id);
      const has = (data || []).some(r =>
        ((r as { roles?: { role: string; status: string }[] }).roles || []).some(x => x.role === 'investor' && x.status === 'confirmed'));
      if (!cancelled) setSmInvestor(has);
    })();
    return () => { cancelled = true; };
  }, [user, personaInvestor]);
  const accessOK = personaInvestor || smInvestor === true;
  const checkingAccess = !!user && !personaInvestor && smInvestor === null;

  const loadData = async (showSpinner = true) => {
    if (!user || !accessOK) return;
    if (showSpinner) setLoading(true);
    else setRefreshing(true);

    // 1) Investor's own focus sectors (interest sectors of their org)
    let myFocus = new Set<string>();
    if (organization?.id) {
      const { data: mySectors } = await supabase
        .from('organization_interest_sectors')
        .select('sector_id')
        .eq('organization_id', organization.id);
      if (mySectors) {
        myFocus = new Set((mySectors as { sector_id: string }[]).map(s => s.sector_id));
      }
    }
    setInvestorSectorIds(myFocus);

    // 2) Capital seekers — joined with org info
    const { data: intents, error } = await supabase
      .from('org_capital_intents')
      .select(`
        organization_id, capital_type, amount_min, amount_max, stage, use_of_funds, updated_at,
        organization:organizations (
          id, name, slug, logo_url, organization_type,
          country, city, headquarters_country, description
        )
      `)
      .eq('seeking_capital', true)
      .order('updated_at', { ascending: false });

    if (error) {
      toast({ title: 'Could not load deal flow', description: error.message, variant: 'destructive' });
      setLoading(false);
      setRefreshing(false);
      return;
    }

    type IntentRow = {
      organization_id: string;
      capital_type: string | null;
      amount_min: number | null;
      amount_max: number | null;
      stage: string | null;
      use_of_funds: string | null;
      updated_at: string;
      organization: {
        id: string;
        name: string;
        slug: string;
        logo_url: string | null;
        organization_type: string | null;
        country: string | null;
        city: string | null;
        headquarters_country: string | null;
        description: string | null;
      } | null;
    };

    const rows = (intents as unknown as IntentRow[]).filter(r => r.organization);

    // 3) Fetch sectors for each org. Marina/developer use interest sectors;
    //    partners use service sectors. Two batched queries.
    const orgIds = rows.map(r => r.organization!.id);
    const interestOrgIds = rows.filter(r => r.organization!.organization_type === 'marina' || r.organization!.organization_type === 'developer').map(r => r.organization!.id);
    const serviceOrgIds = rows.filter(r => r.organization!.organization_type === 'partner').map(r => r.organization!.id);

    const [{ data: interestLinks }, { data: serviceLinks }] = await Promise.all([
      interestOrgIds.length
        ? supabase.from('organization_interest_sectors').select('organization_id, sector_id, sectors(label)').in('organization_id', interestOrgIds)
        : Promise.resolve({ data: [] }),
      serviceOrgIds.length
        ? supabase.from('organization_service_sectors').select('organization_id, sector_id, sectors(label)').in('organization_id', serviceOrgIds)
        : Promise.resolve({ data: [] }),
    ]);

    const sectorsByOrg = new Map<string, { ids: string[]; labels: string[] }>();
    const addSector = (row: { organization_id: string; sector_id: string; sectors: { label: string } | { label: string }[] | null }) => {
      const entry = sectorsByOrg.get(row.organization_id) ?? { ids: [], labels: [] };
      entry.ids.push(row.sector_id);
      // .sectors may be array or single depending on cardinality; normalize
      const lab = Array.isArray(row.sectors) ? row.sectors[0]?.label : row.sectors?.label;
      if (lab) entry.labels.push(lab);
      sectorsByOrg.set(row.organization_id, entry);
    };
    (interestLinks as { organization_id: string; sector_id: string; sectors: { label: string } | null }[] | null)?.forEach(addSector);
    (serviceLinks as { organization_id: string; sector_id: string; sectors: { label: string } | null }[] | null)?.forEach(addSector);

    // 4) Build the typed result with overlap count
    const built: DealFlowOrg[] = rows.map(r => {
      const o = r.organization!;
      const sec = sectorsByOrg.get(o.id) ?? { ids: [], labels: [] };
      const overlap = sec.ids.filter(id => myFocus.has(id)).length;
      return {
        id: o.id,
        name: o.name,
        slug: o.slug,
        logo_url: o.logo_url,
        organization_type: o.organization_type,
        country: o.country || o.headquarters_country,
        city: o.city,
        description: o.description,
        capital_type: r.capital_type,
        amount_min: r.amount_min,
        amount_max: r.amount_max,
        stage: r.stage,
        use_of_funds: r.use_of_funds,
        updated_at: r.updated_at,
        sector_ids: sec.ids,
        sector_labels: sec.labels,
        overlapping_sectors: overlap,
      };
    });

    setOrgs(built);
    setLoading(false);
    setRefreshing(false);
    void orgIds;
  };

  useEffect(() => {
    if (accessOK) loadData(true);
  }, [accessOK, organization?.id]);

  // Derived filter result
  const filteredOrgs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orgs.filter(o => {
      if (matchMyFocus && investorSectorIds.size > 0 && o.overlapping_sectors === 0) return false;
      if (orgTypeFilter !== 'all' && o.organization_type !== orgTypeFilter) return false;
      if (capitalTypeFilter !== 'all' && o.capital_type !== capitalTypeFilter) return false;
      if (countryFilter !== 'all' && o.country !== countryFilter) return false;
      if (q && !o.name.toLowerCase().includes(q) && !(o.description?.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [orgs, matchMyFocus, investorSectorIds, orgTypeFilter, capitalTypeFilter, countryFilter, search]);

  // Country options derived from data
  const countryOptions = useMemo(() => {
    const set = new Set<string>();
    orgs.forEach(o => { if (o.country) set.add(o.country); });
    return Array.from(set).sort();
  }, [orgs]);

  // Express interest handler — bypasses sector matching gate because this is an
  // explicit investor-side reach-out to an opted-in capital seeker.
  const openInterest = (org: DealFlowOrg) => {
    setInterestTarget(org);
    setInterestMessage('');
  };

  const sendInterest = async () => {
    if (!user || !interestTarget) return;
    setSendingInterest(true);
    try {
      // Resolve the target org's owner user_id
      const { data: ownerMember } = await supabase
        .from('organization_members')
        .select('user_id')
        .eq('organization_id', interestTarget.id)
        .eq('role', 'owner')
        .maybeSingle();

      if (!ownerMember?.user_id) {
        toast({ title: 'No org owner', description: 'Could not find the owner of this organization.', variant: 'destructive' });
        setSendingInterest(false);
        return;
      }

      const { error } = await supabase.from('partner_requests').insert({
        partner_user_id: user.id,
        marina_user_id: ownerMember.user_id,
        partner_organization_id: organization?.id || null,
        marina_organization_id: interestTarget.id,
        message: interestMessage.trim() || `Investor interest in your raise.`,
        status: 'pending',
      });

      if (error) {
        toast({ title: 'Could not send', description: error.message, variant: 'destructive' });
        setSendingInterest(false);
        return;
      }

      // Fire-and-forget notification (don't await — keeps the dialog snappy)
      void supabase.functions.invoke('send-notification', {
        body: {
          type: 'partner_request_received',
          user_id: ownerMember.user_id,
          data: {
            partner_name: organization?.name || 'An investor',
            message: interestMessage.trim() || '',
          },
        },
      });

      toast({ title: 'Interest sent', description: `${interestTarget.name} will be notified.` });
      setInterestTarget(null);
      setInterestMessage('');
    } finally {
      setSendingInterest(false);
    }
  };

  if (authLoading) return <LoadingSkeleton variant="page" />;

  if (!user) return <Navigate to="/" replace />;

  if (checkingAccess) {
    return <div className="container mx-auto px-4 py-16 text-center text-gray-400">Checking access…</div>;
  }

  if (!accessOK) {
    return (
      <div className="container mx-auto px-4 py-16 max-w-lg text-center">
        <TrendingUp className="h-10 w-10 text-gray-300 mx-auto mb-3" />
        <h1 className="text-2xl font-bold text-gray-800 mb-2">Investor access required</h1>
        <p className="text-gray-500 mb-6">
          {profile?.persona !== 'investor'
            ? 'The deal-flow board is reserved for verified investor accounts.'
            : 'Your investor account is pending verification.'}
        </p>
        <Button onClick={() => navigate('/account')}>Back to my account</Button>
      </div>
    );
  }

  const hasFocusSectors = investorSectorIds.size > 0;

  return (
    <div className="min-h-screen bg-gray-50">
      <Helmet>
        <title>Deal flow — Smart Marina Connect</title>
        <meta name="description" content="Active capital-seeking marinas, developers, and innovation partners on Smart Marina Connect." />
      </Helmet>

      {/* Hero */}
      <section className="bg-gradient-to-br from-[#0b2653] to-[#143a6b] text-white">
        <div className="container mx-auto px-4 py-10 lg:py-14">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-white/10 rounded-xl backdrop-blur-sm shrink-0">
              <TrendingUp className="h-8 w-8" />
            </div>
            <div className="flex-1">
              <h1 className="text-3xl lg:text-4xl font-bold mb-2">Deal flow</h1>
              <p className="text-white/80 max-w-2xl">
                Organizations on Smart Marina Connect currently raising capital. Filter by your focus sectors, country and capital type. Click into a profile to see the full thesis or send an introduction directly from here.
              </p>
            </div>
          </div>
        </div>
      </section>

      <div className="container mx-auto px-4 py-8 max-w-6xl">
        {/* Filters */}
        <Card className="mb-6">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3 text-sm font-semibold text-gray-700">
              <Filter className="h-4 w-4 text-gray-400" />
              Filter
              {refreshing && <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400 ml-1" />}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => loadData(false)}
                className="ml-auto"
                disabled={refreshing}
              >
                <RefreshCw className={`h-3.5 w-3.5 mr-1 ${refreshing ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
              <div className="lg:col-span-2 relative">
                <Search className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by name or description"
                  className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-gray-200 focus:outline-none focus:ring-1 focus:ring-primary/30"
                />
              </div>
              <Select value={orgTypeFilter} onValueChange={setOrgTypeFilter}>
                <SelectTrigger><SelectValue placeholder="Org type" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  <SelectItem value="marina">Marina</SelectItem>
                  <SelectItem value="developer">Developer</SelectItem>
                  <SelectItem value="partner">Innovation partner</SelectItem>
                </SelectContent>
              </Select>
              <Select value={capitalTypeFilter} onValueChange={setCapitalTypeFilter}>
                <SelectTrigger><SelectValue placeholder="Capital type" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All capital types</SelectItem>
                  {CAPITAL_TYPES.map(t => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={countryFilter} onValueChange={setCountryFilter}>
                <SelectTrigger><SelectValue placeholder="Country" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All countries</SelectItem>
                  {countryOptions.map(c => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {hasFocusSectors && (
              <div className="mt-3 flex items-center gap-2">
                <label className="inline-flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={matchMyFocus}
                    onChange={(e) => setMatchMyFocus(e.target.checked)}
                    className="rounded border-gray-300"
                  />
                  Only show orgs in my focus sectors ({investorSectorIds.size} configured)
                </label>
              </div>
            )}
            {!hasFocusSectors && (
              <p className="mt-3 text-xs text-amber-600">
                Tip: configure your focus sectors in your{' '}
                <Link to="/account?tab=organization" className="underline">organization profile</Link>{' '}
                to filter deal flow by sector overlap.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Results */}
        {loading ? (
          <LoadingSkeleton variant="inline" />
        ) : filteredOrgs.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center">
              <TrendingUp className="h-10 w-10 text-gray-300 mx-auto mb-3" />
              <h3 className="font-medium text-gray-800 mb-1">
                {orgs.length === 0 ? 'No active raises yet' : 'No matches with these filters'}
              </h3>
              <p className="text-sm text-gray-500 max-w-md mx-auto">
                {orgs.length === 0
                  ? 'When marinas, developers, or innovation partners on the platform flip on "Seeking capital", they show up here.'
                  : 'Try widening your filters or unticking "Only show orgs in my focus sectors".'}
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            <p className="text-sm text-gray-500 mb-3">
              {filteredOrgs.length} {filteredOrgs.length === 1 ? 'opportunity' : 'opportunities'}
              {matchMyFocus && hasFocusSectors && ' matching your focus sectors'}
            </p>
            <div className="space-y-3">
              {filteredOrgs.map((o) => (
                <Card key={o.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="p-5">
                    <div className="flex gap-4">
                      {/* Logo */}
                      <Link to={`/organizations/${o.slug}`} className="shrink-0">
                        {o.logo_url ? (
                          <img src={o.logo_url} alt={o.name} className="w-14 h-14 rounded-lg object-cover border" />
                        ) : (
                          <div className="w-14 h-14 rounded-lg bg-primary/10 flex items-center justify-center">
                            <Building2 className="h-6 w-6 text-primary" />
                          </div>
                        )}
                      </Link>

                      <div className="flex-1 min-w-0">
                        {/* Header row */}
                        <div className="flex items-start justify-between gap-3 flex-wrap">
                          <div className="min-w-0">
                            <Link to={`/organizations/${o.slug}`} className="font-semibold text-gray-900 hover:text-primary text-base">
                              {o.name}
                            </Link>
                            <div className="flex items-center gap-3 mt-1 flex-wrap text-xs text-gray-500">
                              {o.organization_type && (
                                <Badge variant="outline" className="text-[10px] gap-1">
                                  {TYPE_ICON[o.organization_type] ?? <Building2 className="h-3 w-3" />}
                                  {TYPE_LABEL[o.organization_type] ?? o.organization_type}
                                </Badge>
                              )}
                              {(o.city || o.country) && (
                                <span className="inline-flex items-center gap-1">
                                  <MapPin className="h-3 w-3" />
                                  {[o.city, o.country].filter(Boolean).join(', ')}
                                </span>
                              )}
                              {hasFocusSectors && o.overlapping_sectors > 0 && (
                                <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-[10px]">
                                  {o.overlapping_sectors} sector match{o.overlapping_sectors > 1 ? 'es' : ''}
                                </Badge>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <BookmarkButton organizationId={o.id} organizationName={o.name} />
                          </div>
                        </div>

                        {/* Capital details */}
                        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
                          {o.capital_type && (
                            <Badge variant="secondary" className="text-xs">
                              {CAPITAL_TYPES.find(t => t.value === o.capital_type)?.label ?? o.capital_type}
                            </Badge>
                          )}
                          {o.stage && (
                            <Badge variant="outline" className="text-xs">
                              {CAPITAL_STAGES.find(s => s.value === o.stage)?.label ?? o.stage}
                            </Badge>
                          )}
                          {(o.amount_min != null || o.amount_max != null) && (
                            <span className="font-medium text-emerald-700">
                              {formatCapitalRange(o.amount_min, o.amount_max)}
                            </span>
                          )}
                        </div>

                        {/* Use of funds */}
                        {o.use_of_funds && (
                          <p className="mt-3 text-sm text-gray-700 line-clamp-2">{o.use_of_funds}</p>
                        )}

                        {/* Sectors */}
                        {o.sector_labels.length > 0 && (
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            {o.sector_labels.slice(0, 4).map((label, i) => (
                              <Badge key={i} variant="outline" className="text-[10px] text-gray-500">{label}</Badge>
                            ))}
                            {o.sector_labels.length > 4 && (
                              <Badge variant="outline" className="text-[10px] text-gray-400">+{o.sector_labels.length - 4}</Badge>
                            )}
                          </div>
                        )}

                        {/* Actions */}
                        <div className="mt-4 flex flex-wrap gap-2">
                          <Button size="sm" variant="outline" asChild>
                            <Link to={`/organizations/${o.slug}`}>
                              View profile
                              <ChevronRight className="h-3.5 w-3.5 ml-1" />
                            </Link>
                          </Button>
                          <Button size="sm" onClick={() => openInterest(o)}>
                            <MessageSquare className="h-3.5 w-3.5 mr-1" />
                            Express interest
                          </Button>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Express interest dialog */}
      <Dialog open={!!interestTarget} onOpenChange={(open) => !open && setInterestTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Express interest</DialogTitle>
            <DialogDescription>
              {interestTarget && (
                <>
                  Send a connection request to <strong>{interestTarget.name}</strong>. They'll see your investor profile and can reply directly. Skips the usual sector-matching gate — this is an opt-in deal-flow path.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-sm">Message <span className="text-gray-400 font-normal">(optional)</span></Label>
              <Textarea
                value={interestMessage}
                onChange={(e) => setInterestMessage(e.target.value)}
                rows={4}
                placeholder={
                  interestTarget?.amount_min || interestTarget?.amount_max
                    ? `Hi, we're an investor focused on the marina industry. Your ${formatCapitalAmount(interestTarget.amount_min ?? interestTarget.amount_max ?? 0)} raise caught our eye — we'd love to schedule a call.`
                    : "Tell them why you're interested and propose a next step (intro call, NDA, etc.)."
                }
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setInterestTarget(null)} disabled={sendingInterest}>Cancel</Button>
            <Button onClick={sendInterest} disabled={sendingInterest}>
              {sendingInterest && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Send interest
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
