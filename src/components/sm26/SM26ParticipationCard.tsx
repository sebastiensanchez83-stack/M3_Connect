import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Ship, ExternalLink, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { SM26_ROLE_LABELS, regStatusBadgeClass, roleStatusBadgeClass, prettyStatus } from '@/components/admin/AdminSM26';

// Single-source view of a participant's SM26 involvement. Reads sm_registration
// (RLS gives own rows to the user, all rows to staff) so the SAME data shows on
// /account, admin User detail, and admin Organization detail — any change
// propagates everywhere automatically.
//
// Provide exactly one lookup key: userId | organizationId (+ optional
// companyName fallback for orgs not yet formally linked).

interface RoleRow { role: string; status: string }
interface Reg {
  id: string;
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  status: string;
  created_at: string;
  organization_id: string | null;
  roles: RoleRow[];
  payment: { status: string }[] | { status: string } | null;
}

interface Props {
  userId?: string;
  organizationId?: string;
  companyName?: string;        // fallback match for org detail (pre-link)
  variant: 'self' | 'admin';   // self → links to /sm26/me, admin → /admin/sm26/:id
  hideWhenEmpty?: boolean;
}

const payStatus = (p: Reg['payment']) => {
  const o = Array.isArray(p) ? p[0] : p;
  return o?.status || null;
};
const payClass = (s: string | null) =>
  s === 'paid' || s === 'waived' ? 'bg-green-50 text-green-700 border-green-200'
  : s === 'invoiced' ? 'bg-amber-50 text-amber-700 border-amber-200'
  : 'bg-gray-50 text-gray-500 border-gray-200';

export function SM26ParticipationCard({ userId, organizationId, companyName, variant, hideWhenEmpty = true }: Props) {
  const [regs, setRegs] = useState<Reg[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [userId, organizationId, companyName]);

  const load = async () => {
    setLoading(true);
    // On the user's own account, first link any registration imported under
    // their email but never claimed via the code link, so it shows up here.
    if (variant === 'self') { try { await supabase.rpc('sm_autoclaim_by_email'); } catch { /* best-effort */ } }
    const sel = 'id,first_name,last_name,company_name,status,created_at,organization_id, roles:sm_role_assignment(role,status), payment:sm_payment(status)';
    const byKey = new Map<string, Reg>();
    const run = async (col: 'user_id' | 'organization_id', val: string) => {
      const { data } = await supabase.from('sm_registration').select(sel).eq(col, val);
      (data || []).forEach((r) => byKey.set((r as Reg).id, r as Reg));
    };
    if (userId) await run('user_id', userId);
    if (organizationId) await run('organization_id', organizationId);
    if (companyName && companyName.trim()) {
      const { data } = await supabase.from('sm_registration').select(sel).ilike('company_name', companyName.trim());
      (data || []).forEach((r) => byKey.set((r as Reg).id, r as Reg));
    }
    setRegs([...byKey.values()].sort((a, b) => b.created_at.localeCompare(a.created_at)));
    setLoading(false);
  };

  if (loading) return (
    <Card><CardContent className="py-6 flex justify-center"><RefreshCw className="h-5 w-5 animate-spin text-gray-300" /></CardContent></Card>
  );
  // Declined participation is admin-only: hide declined registrations (and
  // declined individual roles) from every non-admin surface (e.g. /account).
  const isAdmin = variant === 'admin';
  const visibleRegs = isAdmin ? regs : regs.filter(r => r.status !== 'declined');
  if (visibleRegs.length === 0) {
    if (hideWhenEmpty) return null;
    return (
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Ship className="h-4 w-4 text-gray-400" /> Smart Marina Rendezvous 2026</CardTitle></CardHeader>
        <CardContent><p className="text-sm text-gray-400">No SM26 participation on record.</p></CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2"><Ship className="h-4 w-4 text-primary" /> Smart Marina Rendezvous 2026</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {visibleRegs.map(r => {
          const name = `${r.first_name || ''} ${r.last_name || ''}`.trim();
          const pay = payStatus(r.payment);
          const to = variant === 'self' ? '/sm26/me' : `/admin/sm26/${r.id}`;
          const roles = isAdmin ? r.roles : r.roles.filter(ro => ro.status !== 'declined');
          return (
            <div key={r.id} className="rounded-lg border border-gray-100 p-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap min-w-0">
                  {variant === 'admin' && name && <span className="text-sm font-medium text-gray-900 truncate">{name}</span>}
                  {r.company_name && <span className="text-xs text-gray-500 truncate">{r.company_name}</span>}
                  <Badge className={`text-[10px] ${regStatusBadgeClass(r.status)}`}>{prettyStatus(r.status)}</Badge>
                  {pay && <Badge className={`text-[10px] ${payClass(pay)}`}>{prettyStatus(pay)}</Badge>}
                </div>
                <Button asChild size="sm" variant="ghost" className="h-7 gap-1.5 text-primary shrink-0">
                  <Link to={to}>{variant === 'self' ? 'Open' : 'View'} <ExternalLink className="h-3.5 w-3.5" /></Link>
                </Button>
              </div>
              {roles.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {roles.map((role, i) => (
                    <Badge key={i} className={`text-[10px] ${roleStatusBadgeClass(role.status)}`}>
                      {SM26_ROLE_LABELS[role.role] || role.role}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
