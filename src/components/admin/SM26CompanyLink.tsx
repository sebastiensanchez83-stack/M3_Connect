import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Building2, Loader2, Search, X, Link2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';

// Admin control to link an SM26 registration to an existing SMC organization
// (link-when-exists — does NOT create orgs). Sets sm_registration.organization_id
// so the registration shows on that company's admin page and is one identity.

interface Org { id: string; name: string; access_status: string }

export function SM26CompanyLink({ registrationId, organizationId, companyName, onChange }: {
  registrationId: string; organizationId: string | null; companyName: string | null; onChange: () => void;
}) {
  const [linkedName, setLinkedName] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<Org[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!organizationId) { setLinkedName(null); return; }
    supabase.from('organizations').select('name').eq('id', organizationId).maybeSingle()
      .then(({ data }) => setLinkedName((data as { name?: string } | null)?.name || '(unknown company)'));
  }, [organizationId]);

  const doSearch = async (q: string) => {
    setSearch(q);
    if (q.trim().length < 2) { setResults([]); return; }
    const { data } = await supabase.from('organizations').select('id,name,access_status').ilike('name', `%${q.trim()}%`).order('name').limit(8);
    setResults((data || []) as Org[]);
  };

  const setOrg = async (orgId: string | null) => {
    setBusy(true);
    const { error } = await supabase.from('sm_registration').update({ organization_id: orgId }).eq('id', registrationId);
    setBusy(false);
    if (error) { toast({ title: 'Could not update company link', description: error.message, variant: 'destructive' }); return; }
    toast({ title: orgId ? 'Linked to company' : 'Company link removed' });
    setOpen(false); setSearch(''); setResults([]);
    onChange();
  };

  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            <Building2 className="h-4 w-4 text-gray-400 shrink-0" />
            {organizationId ? (
              <span className="text-sm text-gray-700 flex items-center gap-2 flex-wrap">
                Linked to <Link to={`/admin/organizations/${organizationId}`} className="font-medium text-primary hover:underline">{linkedName || '…'}</Link>
                <Badge className="text-[10px] bg-green-50 text-green-700 border-green-200">company</Badge>
              </span>
            ) : (
              <span className="text-sm text-gray-500">
                Company: <span className="text-gray-700">{companyName || '—'}</span>
                <Badge className="ml-2 text-[10px] bg-gray-100 text-gray-500 border-gray-200">not linked</Badge>
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {organizationId ? (
              <Button size="sm" variant="ghost" className="h-8 gap-1.5 text-gray-500" onClick={() => setOrg(null)} disabled={busy}>
                <X className="h-3.5 w-3.5" /> Unlink
              </Button>
            ) : (
              <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => { setOpen(o => !o); if (!open && companyName) doSearch(companyName); }}>
                <Link2 className="h-3.5 w-3.5" /> Link to a company
              </Button>
            )}
          </div>
        </div>

        {open && !organizationId && (
          <div className="mt-3 space-y-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input value={search} onChange={e => doSearch(e.target.value)} placeholder="Search existing companies by name…" className="pl-9 h-9" autoFocus />
            </div>
            {results.length > 0 ? (
              <div className="border border-gray-100 rounded-lg divide-y divide-gray-50 max-h-56 overflow-y-auto">
                {results.map(o => (
                  <button key={o.id} type="button" onClick={() => setOrg(o.id)} disabled={busy}
                    className="w-full text-left px-3 py-2 hover:bg-gray-50 flex items-center justify-between gap-2">
                    <span className="text-sm text-gray-800 truncate">{o.name}</span>
                    <Badge variant="outline" className="text-[10px] shrink-0">{o.access_status}</Badge>
                  </button>
                ))}
              </div>
            ) : search.trim().length >= 2 ? (
              <p className="text-xs text-gray-400 px-1">No matching company on the platform. Leave unlinked — the name is kept for reference.</p>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
