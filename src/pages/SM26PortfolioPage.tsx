import { useState, useEffect, useMemo } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import {
  RefreshCw, Search, TrendingUp, Globe, MapPin, ChevronDown, ChevronUp, Lock, Clock, Ship,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { SM_CATEGORIES } from '@/components/sm26/StartupFields';

// SM26 innovation portfolio / deal-flow — visible to VALIDATED investors and
// staff. Data comes from the sm_investor_portfolio RPC, which enforces access
// server-side. The page also resolves the viewer's own investor status to show
// the right gate (pending validation / not available) when they can't see it.

interface Entry {
  id: string;
  company_name: string | null;
  country: string | null;
  website: string | null;
  startup_or_scaleup: string | null;
  stage: string | null;
  categories: string[] | null;
  problem: string | null;
  solution: string | null;
  differentiation: string | null;
  usp: string | null;
  target_markets: string | null;
  business_model: string | null;
  competitive_positioning: string | null;
  collaboration_expected: string | null;
  investment_seeking: boolean | null;
  investment_stage: string | null;
  investment_type: string | null;
  funds_needed: string | null;
  references_text: string | null;
}

type Access = 'loading' | 'staff' | 'investor' | 'pending' | 'none';

export function SM26PortfolioPage() {
  const { user, isModerator, profile, isVerified, loading: authLoading } = useAuth();
  const [access, setAccess] = useState<Access>('loading');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [cat, setCat] = useState('all');
  const [seekingOnly, setSeekingOnly] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => { if (!authLoading && user) init(); }, [authLoading, user]);

  const init = async () => {
    setLoading(true);
    const { data: ev } = await supabase.from('sm_event').select('id').eq('slug', 'sm26').maybeSingle();
    if (!ev) { setAccess('none'); setLoading(false); return; }
    const eventId = (ev as { id: string }).id;

    // Resolve the viewer's own investor status (RLS lets them read their own roles)
    let acc: Access = 'none';
    if (isModerator) {
      acc = 'staff';
    } else if (profile?.persona === 'investor' && isVerified) {
      acc = 'investor'; // unified accreditation: platform investor also sees the SM26 portfolio
    } else {
      const { data: reg } = await supabase
        .from('sm_registration')
        .select('roles:sm_role_assignment(role,status)')
        .eq('event_id', eventId).eq('user_id', user!.id).maybeSingle();
      const investor = (reg as { roles?: { role: string; status: string }[] } | null)?.roles?.find(r => r.role === 'investor');
      acc = investor ? (investor.status === 'confirmed' ? 'investor' : 'pending') : 'none';
    }
    setAccess(acc);

    if (acc === 'staff' || acc === 'investor') {
      const { data, error } = await supabase.rpc('sm_investor_portfolio', { p_event_id: eventId });
      if (!error) setEntries((data || []) as Entry[]);
    }
    setLoading(false);
  };

  const filtered = useMemo(() => entries.filter(e => {
    if (seekingOnly && !e.investment_seeking) return false;
    if (cat !== 'all' && !(e.categories || []).includes(cat)) return false;
    if (search) {
      const hay = `${e.company_name || ''} ${e.problem || ''} ${e.solution || ''} ${e.target_markets || ''} ${(e.categories || []).join(' ')}`.toLowerCase();
      if (!hay.includes(search.toLowerCase())) return false;
    }
    return true;
  }), [entries, seekingOnly, cat, search]);

  if (authLoading || loading) return (
    <div className="flex items-center justify-center h-[60vh]"><RefreshCw className="h-8 w-8 animate-spin text-primary" /></div>
  );

  // Gates
  if (access === 'pending' || access === 'none') {
    const pending = access === 'pending';
    return (
      <div className="container mx-auto px-4 py-16 max-w-xl text-center">
        <div className={`mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full ${pending ? 'bg-amber-100' : 'bg-gray-100'}`}>
          {pending ? <Clock className="h-7 w-7 text-amber-600" /> : <Lock className="h-7 w-7 text-gray-500" />}
        </div>
        <h1 className="text-2xl font-bold mb-2">{pending ? 'Investor access pending' : 'Investor access required'}</h1>
        <p className="text-gray-600 mb-6">
          {pending
            ? 'Your investor accreditation is being validated by M3. You\'ll get access to the deal-flow portfolio as soon as it\'s confirmed.'
            : 'The SM26 innovation portfolio is reserved for accredited investors. Register your interest as an investor to request access.'}
        </p>
        {!pending && <Button asChild><Link to="/sm26/register">Register as an investor</Link></Button>}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Helmet><title>Innovation Portfolio — SM26 Deal-flow</title></Helmet>

      <section className="bg-gradient-to-br from-[#0b2653] to-[#143a6b] text-white">
        <div className="container mx-auto px-4 py-10">
          <p className="uppercase tracking-wide text-white/60 text-sm mb-2 flex items-center gap-2">
            <TrendingUp className="h-4 w-4" /> SM26 · Deal-flow {access === 'staff' && '· staff view'}
          </p>
          <h1 className="text-2xl lg:text-3xl font-bold">Innovation Portfolio</h1>
          <p className="text-white/80 mt-2">The startups & scaleups taking part in the Smart &amp; Sustainable Marina Rendezvous 2026.</p>
        </div>
      </section>

      <div className="container mx-auto px-4 py-8 max-w-4xl space-y-4">
        {/* Filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search startups…" className="pl-9 h-9 bg-white" />
          </div>
          <select value={cat} onChange={e => setCat(e.target.value)} className="h-9 rounded-lg border border-gray-200 bg-white px-3 text-sm max-w-[220px]">
            <option value="all">All categories</option>
            {SM_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <button
            onClick={() => setSeekingOnly(v => !v)}
            className={`h-9 px-3 rounded-lg border text-sm transition-colors ${seekingOnly ? 'border-primary bg-primary/5 text-primary font-medium' : 'border-gray-200 bg-white text-gray-600'}`}
          >
            Seeking investment
          </button>
          <span className="text-sm text-gray-400 ml-auto">{filtered.length} of {entries.length}</span>
        </div>

        {filtered.length === 0 ? (
          <Card className="border-0 shadow-sm"><CardContent className="py-12 text-center text-gray-400">No startups match your filters.</CardContent></Card>
        ) : (
          filtered.map(e => {
            const open = expanded[e.id];
            return (
              <Card key={e.id} className="border-0 shadow-sm">
                <CardContent className="p-5">
                  <div className="flex items-start gap-4">
                    <div className="h-11 w-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0 font-semibold uppercase">
                      {(e.company_name?.[0] || '?')}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-gray-900">{e.company_name || 'Unnamed'}</span>
                        {e.startup_or_scaleup && <Badge variant="secondary" className="text-[10px] capitalize">{e.startup_or_scaleup}</Badge>}
                        {e.stage && <Badge variant="outline" className="text-[10px]">{e.stage}</Badge>}
                        {e.investment_seeking && <Badge className="text-[10px] bg-green-50 text-green-700 border-green-200">Seeking{e.funds_needed ? ` · ${e.funds_needed}` : ''}</Badge>}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-gray-500 mt-1 flex-wrap">
                        {e.country && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {e.country}</span>}
                        {e.website && <a href={e.website.startsWith('http') ? e.website : `https://${e.website}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-primary hover:underline"><Globe className="h-3 w-3" /> Website</a>}
                      </div>
                      {(e.categories || []).length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {(e.categories || []).map(c => <Badge key={c} variant="outline" className="text-[10px] font-normal text-gray-500">{c}</Badge>)}
                        </div>
                      )}
                      {e.problem && <p className="text-sm text-gray-700 mt-2"><span className="text-gray-400">Problem · </span>{e.problem}</p>}
                      {e.solution && <p className="text-sm text-gray-700 mt-1"><span className="text-gray-400">Solution · </span>{e.solution}</p>}

                      {open && (
                        <div className="mt-3 space-y-2 border-t border-gray-100 pt-3">
                          {([
                            ['Differentiation', e.differentiation],
                            ['USP', e.usp],
                            ['Target markets', e.target_markets],
                            ['Business model', e.business_model],
                            ['Competitive positioning', e.competitive_positioning],
                            ['Collaboration sought', e.collaboration_expected],
                            ['Investment', [e.investment_stage, e.investment_type, e.funds_needed].filter(Boolean).join(' · ') || null],
                            ['References', e.references_text],
                          ] as [string, string | null][]).filter(([, v]) => v).map(([label, v]) => (
                            <div key={label} className="text-sm">
                              <span className="text-[11px] uppercase tracking-wide text-gray-400">{label}</span>
                              <div className="text-gray-700 whitespace-pre-wrap">{v}</div>
                            </div>
                          ))}
                        </div>
                      )}

                      <button onClick={() => setExpanded(p => ({ ...p, [e.id]: !p[e.id] }))} className="mt-2 text-xs text-primary flex items-center gap-1 hover:underline">
                        {open ? <>Less <ChevronUp className="h-3 w-3" /></> : <>More detail <ChevronDown className="h-3 w-3" /></>}
                      </button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}

        {entries.length === 0 && (
          <Card className="border-0 shadow-sm">
            <CardContent className="py-12 text-center text-gray-400">
              <Ship className="h-8 w-8 mx-auto mb-2 text-gray-300" />
              No startups in the portfolio yet — entries will appear here as innovators register.
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
