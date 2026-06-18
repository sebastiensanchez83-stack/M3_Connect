import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { RefreshCw, ArrowLeft, Mail, Phone, Globe, Building2, MapPin, Briefcase, Check, X, Calendar } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { SM26_ROLE_LABELS, REG_STATUSES, regStatusBadgeClass, prettyStatus } from './AdminSM26';

// SM26 registration detail — full contact + per-role module data, with a
// registration-status pipeline control. Role-level management (add roles,
// flag required info, notify) is layered on top of this in a later task.

const HIDDEN_KEYS = new Set(['id', 'role_assignment_id', 'event_id', 'organization_id', 'created_at', 'updated_at', 'anon_code']);

const prettyKey = (k: string) => k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

function fmtVal(v: unknown): string {
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (v && typeof v === 'object') return Object.entries(v).map(([k, val]) => `${k}: ${val}`).join(', ');
  return String(v);
}

const isEmptyObject = (v: unknown) =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && Object.keys(v as object).length === 0;

// PostgREST returns a one-to-one embed (unique FK) as an object, but a
// one-to-many as an array — normalise both to a single record.
function firstOf(x: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(x)) return x[0] as Record<string, unknown> | undefined;
  return (x as Record<string, unknown> | null) || undefined;
}

function ModuleFields({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data).filter(([k, v]) =>
    !HIDDEN_KEYS.has(k) && v !== null && v !== '' && v !== false && !(Array.isArray(v) && v.length === 0) && !isEmptyObject(v)
  );
  if (entries.length === 0) return <p className="text-xs text-gray-400">No details provided yet.</p>;
  return (
    <div className="grid sm:grid-cols-2 gap-x-6 gap-y-3">
      {entries.map(([k, v]) => (
        <div key={k} className="text-sm">
          <div className="text-[11px] uppercase tracking-wide text-gray-400">{prettyKey(k)}</div>
          <div className="text-gray-800 whitespace-pre-wrap break-words">{fmtVal(v)}</div>
        </div>
      ))}
    </div>
  );
}

interface RoleAssignment {
  id: string;
  role: string;
  scope: string;
  depth: string;
  source: string;
  status: string;
  module_data: Record<string, unknown>;
  startup?: Record<string, unknown> | Record<string, unknown>[];
  architecture?: Record<string, unknown> | Record<string, unknown>[];
  marina?: Record<string, unknown> | Record<string, unknown>[];
}

interface Registration {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  company_name: string | null;
  website: string | null;
  country: string | null;
  job_title: string | null;
  objective: string | null;
  how_heard: string | null;
  image_consent: boolean;
  terms_accepted_at: string | null;
  status: string;
  created_at: string;
  user_id: string | null;
  organization_id: string | null;
  roles: RoleAssignment[];
}

export function AdminSM26Detail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [reg, setReg] = useState<Registration | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (id) load(id); }, [id]);

  const load = async (regId: string) => {
    setLoading(true);
    const { data } = await supabase
      .from('sm_registration')
      .select(`
        *,
        roles:sm_role_assignment(
          id, role, scope, depth, source, status, module_data,
          startup:sm_startup_profile(*),
          architecture:sm_architecture_entry(*),
          marina:sm_marina_extra(*)
        )
      `)
      .eq('id', regId)
      .maybeSingle();
    setReg(data as Registration | null);
    setLoading(false);
  };

  const updateStatus = async (newStatus: string) => {
    if (!reg) return;
    setSaving(true);
    const { error } = await supabase.from('sm_registration').update({ status: newStatus }).eq('id', reg.id);
    setSaving(false);
    if (error) {
      toast({ title: 'Could not update status', description: error.message, variant: 'destructive' });
      return;
    }
    setReg({ ...reg, status: newStatus });
    toast({ title: `Status set to "${prettyStatus(newStatus)}"` });
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64"><RefreshCw className="h-8 w-8 animate-spin text-gray-400" /></div>
  );
  if (!reg) return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={() => navigate('/admin/sm26')} className="gap-1.5"><ArrowLeft className="h-4 w-4" /> Back</Button>
      <Card className="border-0 shadow-sm"><CardContent className="py-12 text-center text-gray-400">Registration not found.</CardContent></Card>
    </div>
  );

  const name = `${reg.first_name || ''} ${reg.last_name || ''}`.trim() || '(no name)';
  const contact: { icon: typeof Mail; value: string | null }[] = [
    { icon: Mail, value: reg.email },
    { icon: Phone, value: reg.phone },
    { icon: Building2, value: reg.company_name },
    { icon: Globe, value: reg.website },
    { icon: MapPin, value: reg.country },
    { icon: Briefcase, value: reg.job_title },
  ];

  return (
    <div className="space-y-4 max-w-4xl">
      <Button variant="ghost" size="sm" onClick={() => navigate('/admin/sm26')} className="gap-1.5"><ArrowLeft className="h-4 w-4" /> Back to registrations</Button>

      {/* Header + status pipeline */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0 font-semibold text-lg uppercase">
                {(reg.first_name?.[0] || reg.email?.[0] || '?')}
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-900">{name}</h1>
                <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5">
                  <Calendar className="h-3 w-3" /> Registered {new Date(reg.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                  {!reg.user_id && <Badge className="text-[10px] bg-gray-100 text-gray-500 border-gray-200">No account</Badge>}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge className={`text-xs ${regStatusBadgeClass(reg.status)}`}>{prettyStatus(reg.status)}</Badge>
              <Select value={reg.status} onValueChange={updateStatus} disabled={saving}>
                <SelectTrigger className="w-44 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {REG_STATUSES.map(s => <SelectItem key={s} value={s}>{prettyStatus(s)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-xs text-gray-400 mt-3">
            "Confirmed" signals full access once payment/eligibility is settled. Payment tracking is handled separately.
          </p>
        </CardContent>
      </Card>

      {/* Contact */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-2"><CardTitle className="text-base">Contact</CardTitle></CardHeader>
        <CardContent>
          <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2">
            {contact.filter(c => c.value).map((c, i) => {
              const Icon = c.icon;
              return (
                <div key={i} className="flex items-center gap-2 text-sm text-gray-700">
                  <Icon className="h-4 w-4 text-gray-400 shrink-0" /> <span className="break-words">{c.value}</span>
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-4 mt-3 text-xs text-gray-500">
            <span className="flex items-center gap-1">
              {reg.image_consent ? <Check className="h-3.5 w-3.5 text-green-600" /> : <X className="h-3.5 w-3.5 text-gray-400" />} Image consent
            </span>
            <span className="flex items-center gap-1">
              {reg.terms_accepted_at ? <Check className="h-3.5 w-3.5 text-green-600" /> : <X className="h-3.5 w-3.5 text-gray-400" />} Terms accepted
            </span>
          </div>
          {(reg.objective || reg.how_heard) && (
            <div className="mt-3 space-y-2">
              {reg.objective && <div className="text-sm"><span className="text-[11px] uppercase tracking-wide text-gray-400">Objective</span><div className="text-gray-800">{reg.objective}</div></div>}
              {reg.how_heard && <div className="text-sm"><span className="text-[11px] uppercase tracking-wide text-gray-400">How heard</span><div className="text-gray-800">{reg.how_heard}</div></div>}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Roles + module data */}
      {reg.roles.length === 0 ? (
        <Card className="border-0 shadow-sm"><CardContent className="py-8 text-center text-gray-400">No roles assigned.</CardContent></Card>
      ) : (
        reg.roles.map(role => {
          const startup = firstOf(role.startup);
          const architecture = firstOf(role.architecture);
          const marina = firstOf(role.marina);
          const hasLight = role.module_data && Object.keys(role.module_data).length > 0;
          return (
            <Card key={role.id} className="border-0 shadow-sm">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <CardTitle className="text-base flex items-center gap-2">
                    {SM26_ROLE_LABELS[role.role] || role.role}
                    <Badge variant="outline" className="text-[10px] font-normal">{role.scope}</Badge>
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <Badge className="text-[10px] bg-gray-50 text-gray-600 border-gray-200">{prettyStatus(role.status)}</Badge>
                    <Badge variant="secondary" className="text-[10px]">via {role.source}</Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {startup && <ModuleFields data={startup} />}
                {architecture && <ModuleFields data={architecture} />}
                {marina && <ModuleFields data={marina} />}
                {hasLight && <ModuleFields data={role.module_data} />}
                {!startup && !architecture && !marina && !hasLight && (
                  <p className="text-xs text-gray-400">No additional details for this role.</p>
                )}
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}
