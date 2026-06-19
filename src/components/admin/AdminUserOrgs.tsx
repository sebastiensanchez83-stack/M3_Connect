import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Building2, Loader2, Search, Plus, X, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';

// Admin-managed company memberships. A user becomes multi-company ONLY here —
// there is no self-service join. Uses admin_user_orgs / admin_add_org_member /
// admin_remove_org_member (admin-only SECURITY DEFINER RPCs).

interface Membership { org_id: string; org_name: string; role: string }

export function AdminUserOrgs({ userId }: { userId: string }) {
  const [orgs, setOrgs] = useState<Membership[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [userId]);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.rpc('admin_user_orgs', { p_user_id: userId });
    setOrgs((data || []) as Membership[]);
    setLoading(false);
  };

  const doSearch = async (q: string) => {
    setSearch(q);
    if (q.trim().length < 2) { setResults([]); return; }
    const { data } = await supabase.from('organizations').select('id,name').ilike('name', `%${q.trim()}%`).order('name').limit(8);
    const current = new Set(orgs.map(o => o.org_id));
    setResults(((data || []) as { id: string; name: string }[]).filter(o => !current.has(o.id)));
  };

  const add = async (orgId: string) => {
    setBusy(true);
    const { error } = await supabase.rpc('admin_add_org_member', { p_user_id: userId, p_org_id: orgId, p_role: 'collaborator' });
    setBusy(false);
    if (error) { toast({ title: 'Could not add to company', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Added to company' });
    setOpen(false); setSearch(''); setResults([]);
    load();
  };

  const remove = async (orgId: string, name: string) => {
    if (!confirm(`Remove this user from "${name}"?`)) return;
    setBusy(true);
    const { error } = await supabase.rpc('admin_remove_org_member', { p_user_id: userId, p_org_id: orgId });
    setBusy(false);
    if (error) { toast({ title: 'Could not remove', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Removed from company' });
    load();
  };

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-bold text-gray-700 flex items-center gap-2">
            <Building2 className="h-4 w-4 text-blue-500" /> Companies ({orgs.length})
          </CardTitle>
          <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setOpen(o => !o)}>
            <Plus className="h-4 w-4" /> Add to a company
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {loading ? (
          <div className="py-2 flex justify-center"><RefreshCw className="h-5 w-5 animate-spin text-gray-300" /></div>
        ) : orgs.length === 0 ? (
          <p className="text-sm text-gray-400">Not a member of any company.</p>
        ) : (
          orgs.map(o => (
            <div key={o.org_id} className="flex items-center justify-between gap-2 rounded-lg border border-gray-100 px-3 py-2">
              <div className="flex items-center gap-2 min-w-0">
                <Link to={`/admin/organizations/${o.org_id}`} className="text-sm font-medium text-gray-800 hover:text-primary truncate">{o.org_name}</Link>
                <Badge variant="outline" className="text-[10px] shrink-0">{o.role}</Badge>
              </div>
              <Button size="icon" variant="ghost" className="h-7 w-7 text-gray-400 hover:text-red-600 shrink-0" onClick={() => remove(o.org_id, o.org_name)} disabled={busy} title="Remove from company">
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))
        )}

        {open && (
          <div className="space-y-2 pt-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input value={search} onChange={e => doSearch(e.target.value)} placeholder="Search a company to add this user to…" className="pl-9 h-9" autoFocus />
            </div>
            {results.length > 0 && (
              <div className="border border-gray-100 rounded-lg divide-y divide-gray-50 max-h-56 overflow-y-auto">
                {results.map(r => (
                  <button key={r.id} type="button" onClick={() => add(r.id)} disabled={busy}
                    className="w-full text-left px-3 py-2 hover:bg-gray-50 text-sm text-gray-800 truncate">{r.name}</button>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
