import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Building2, Loader2, Search, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ActionCue } from '@/components/home/dashboard/DashboardKit';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { AdminPanel, AdminStatusPill, ADMIN_BTN, ADMIN_BTN_DANGER } from './AdminUI';

// Admin-managed company memberships. A user becomes multi-company ONLY here —
// there is no self-service join. Uses admin_user_orgs / admin_add_org_member /
// admin_remove_org_member (admin-only SECURITY DEFINER RPCs).
// Refonte admin style (Oct 2026): each company is a row that opens the company page and says so;
// "Take out" asks first; "Add to a company" opens a search right here.

interface Membership { org_id: string; org_name: string; role: string }

export function AdminUserOrgs({ userId }: { userId: string }) {
  const { t } = useTranslation();
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
    if (error) { toast({ title: 'Could not add to the company', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Added to the company' });
    setOpen(false); setSearch(''); setResults([]);
    load();
  };

  const remove = async (orgId: string, name: string) => {
    if (!confirm(t('adm2.userOrgs.removeConfirm', 'Take this person out of "{{name}}"?\n\nThey lose access to its company page and team at once.', { name }))) return;
    setBusy(true);
    const { error } = await supabase.rpc('admin_remove_org_member', { p_user_id: userId, p_org_id: orgId });
    setBusy(false);
    if (error) { toast({ title: 'Could not take them out', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Taken out of the company' });
    load();
  };

  const roleLabel = (role: string) => role === 'owner'
    ? t('adm2.userOrgs.owner', 'Person in charge')
    : role === 'collaborator' ? t('adm2.userOrgs.member', 'Member') : role.charAt(0).toUpperCase() + role.slice(1);

  return (
    <AdminPanel
      icon={Building2}
      title={t('adm2.userOrgs.title', 'Companies ({{count}})', { count: orgs.length })}
      description={t('adm2.userOrgs.desc', 'The companies this person belongs to. Adding or taking out applies at once.')}
      padded={false}
      actions={
        <Button type="button" variant="outline" size="sm" className={ADMIN_BTN} aria-expanded={open} onClick={() => setOpen(o => !o)}>
          {open ? <X className="mr-2 h-4 w-4" aria-hidden="true" /> : <Plus className="mr-2 h-4 w-4" aria-hidden="true" />}
          {open ? t('adm2.userOrgs.close', 'Close the search') : t('adm2.userOrgs.add', 'Add to a company')}
        </Button>
      }
    >
      {loading ? (
        <div className="flex justify-center px-5 py-4"><Loader2 className="h-5 w-5 animate-spin text-meta" aria-label={t('adm2.loading', 'Loading')} /></div>
      ) : orgs.length === 0 ? (
        <p className="px-5 py-4 text-[14px] leading-5 text-meta">{t('adm2.userOrgs.none', 'Not a member of any company.')}</p>
      ) : (
        <ul className="divide-y divide-rule">
          {orgs.map(o => (
            <li key={o.org_id} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:gap-3">
              <Link
                to={`/admin/companies/${o.org_id}`}
                className="group -mx-2 flex min-w-0 flex-1 flex-col gap-2 rounded-xl px-2 py-1 transition-colors hover:bg-page focus:outline-none focus-visible:shadow-focus sm:flex-row sm:items-center sm:gap-3"
              >
                <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                  <span className="text-[15px] font-semibold leading-5 text-navy [overflow-wrap:anywhere]">{o.org_name}</span>
                  <AdminStatusPill tone={o.role === 'owner' ? 'navy' : 'neutral'}>{roleLabel(o.role)}</AdminStatusPill>
                </span>
                <ActionCue size="sm" className="self-start sm:self-center">{t('adm2.userOrgs.open', 'Open the company')}</ActionCue>
              </Link>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={`${ADMIN_BTN_DANGER} h-9 self-start px-3 text-[13px] sm:self-center`}
                onClick={() => remove(o.org_id, o.org_name)}
                disabled={busy}
              >
                <X className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                {t('adm2.userOrgs.remove', 'Take out')}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {open && (
        <div className="space-y-3 border-t border-rule bg-page/60 px-5 py-4">
          <label className="block">
            <span className="block text-[13px] font-semibold leading-5 text-navy">{t('adm2.userOrgs.searchLabel', 'Find the company (type 2 letters or more)')}</span>
            <span className="relative mt-1.5 block">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-meta" aria-hidden="true" />
              <Input
                type="search"
                value={search}
                onChange={e => doSearch(e.target.value)}
                placeholder={t('adm2.userOrgs.searchPlaceholder', 'Company name…')}
                className="h-11 rounded-pill bg-white pl-10 md:h-10"
                autoFocus
              />
            </span>
          </label>
          {results.length > 0 && (
            <ul className="space-y-2">
              {results.map(r => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => add(r.id)}
                    disabled={busy}
                    className="group flex w-full items-center justify-between gap-3 rounded-xl border border-rule bg-white px-4 py-2.5 text-left transition-colors hover:border-navy/40 hover:bg-chip focus:outline-none focus-visible:shadow-focus disabled:opacity-60"
                  >
                    <span className="min-w-0 text-[15px] font-semibold text-navy [overflow-wrap:anywhere]">{r.name}</span>
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-pill border border-navy/55 px-3 py-1 text-[13px] font-semibold text-navy group-hover:border-navy">
                      <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                      {t('adm2.userOrgs.addHere', 'Add them here')}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {search.trim().length >= 2 && results.length === 0 && (
            <p className="text-[13px] leading-5 text-meta">{t('adm2.userOrgs.noResult', 'No other company with this name.')}</p>
          )}
        </div>
      )}
    </AdminPanel>
  );
}
