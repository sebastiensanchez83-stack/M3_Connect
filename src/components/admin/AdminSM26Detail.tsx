import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  RefreshCw, ArrowLeft, Mail, Phone, Globe, Building2, MapPin, Briefcase,
  Check, X, Calendar, Plus, Trash2, BellRing, Paperclip, FileText,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import {
  SM26_ROLE_LABELS, REG_STATUSES, ROLE_STATUSES, regStatusBadgeClass, roleStatusBadgeClass,
  prettyStatus, ORG_SCOPE_ROLES, MODULE_TABLE_ROLES,
} from './AdminSM26';
import { SponsorPackageEditor } from './SM26SponsorPackage';

// SM26 registration detail — full contact + per-role module data, with the
// registration status pipeline AND role management: add roles (auto-filling
// what we know), flag "info required", and notify the participant.

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

function firstOf(x: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(x)) return x[0] as Record<string, unknown> | undefined;
  return (x as Record<string, unknown> | null) || undefined;
}

function ModuleFields({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data).filter(([k, v]) =>
    !HIDDEN_KEYS.has(k) && v !== null && v !== '' && v !== false && !(Array.isArray(v) && v.length === 0) && !isEmptyObject(v)
  );
  if (entries.length === 0) return null;
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

interface Requirement {
  id: string;
  role: string;
  field_key: string;
  label: string | null;
  required: boolean;
  is_asset: boolean;
  autofill_source: string | null;
  display_order: number;
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
  event_id: string;
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
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [roleSaving, setRoleSaving] = useState(false);
  const [addRoleValue, setAddRoleValue] = useState('');

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
    const r = data as Registration | null;
    setReg(r);
    if (r?.event_id) {
      const { data: reqs } = await supabase.from('sm_role_requirement').select('*').eq('event_id', r.event_id);
      setRequirements((reqs || []) as Requirement[]);
    }
    setLoading(false);
  };

  const reqsForRole = (role: string) =>
    requirements.filter(r => r.role === role).sort((a, b) => a.display_order - b.display_order);

  const updateStatus = async (newStatus: string) => {
    if (!reg) return;
    setSaving(true);
    const { error } = await supabase.from('sm_registration').update({ status: newStatus }).eq('id', reg.id);
    setSaving(false);
    if (error) { toast({ title: 'Could not update status', description: error.message, variant: 'destructive' }); return; }
    setReg({ ...reg, status: newStatus });
    toast({ title: `Status set to "${prettyStatus(newStatus)}"` });
  };

  const notify = async (userId: string, title: string, body: string) => {
    await supabase.from('sm_notification').insert({ user_id: userId, type: 'sm26_info_required', title, body, link: '/sm26/me' });
  };

  // Prefill module_data for a light role from the registration (autofill_source)
  const autofillFor = (role: string): Record<string, string> => {
    if (MODULE_TABLE_ROLES.has(role) || !reg) return {};
    const out: Record<string, string> = {};
    for (const req of reqsForRole(role)) {
      if (req.autofill_source?.startsWith('registration.')) {
        const col = req.autofill_source.split('.')[1] as keyof Registration;
        const val = reg[col];
        if (typeof val === 'string' && val) out[req.field_key] = val;
      }
    }
    return out;
  };

  const addRole = async () => {
    if (!reg || !addRoleValue) return;
    setRoleSaving(true);
    const role = addRoleValue;
    const scope = ORG_SCOPE_ROLES.has(role) ? 'org' : 'user';
    const reqs = reqsForRole(role);
    const needsInfo = reqs.some(r => r.required);
    const { error } = await supabase.from('sm_role_assignment').insert({
      registration_id: reg.id,
      event_id: reg.event_id,
      organization_id: scope === 'org' ? reg.organization_id : null,
      role,
      scope,
      depth: 'full',
      source: 'admin',
      status: needsInfo ? 'needs_info' : 'admin_added',
      module_data: autofillFor(role),
    });
    if (error) {
      setRoleSaving(false);
      toast({ title: 'Could not add role', description: error.message, variant: 'destructive' });
      return;
    }
    if (needsInfo && reg.user_id) {
      const labels = reqs.filter(r => r.required).map(r => r.label).join(', ');
      await notify(reg.user_id, 'Information needed for SM26',
        `You've been added as ${SM26_ROLE_LABELS[role] || role} for the Smart & Sustainable Marina Rendezvous 2026. Please provide: ${labels}.`);
    }
    setAddRoleValue('');
    setRoleSaving(false);
    toast({ title: `Added role: ${SM26_ROLE_LABELS[role] || role}`, description: needsInfo && reg.user_id ? 'Participant notified that info is required.' : undefined });
    await load(reg.id);
  };

  const requestInfo = async (ra: RoleAssignment) => {
    if (!reg) return;
    setRoleSaving(true);
    const { error } = await supabase.from('sm_role_assignment').update({ status: 'needs_info' }).eq('id', ra.id);
    if (!error && reg.user_id) {
      const labels = reqsForRole(ra.role).filter(r => r.required).map(r => r.label).join(', ');
      await notify(reg.user_id, 'Information needed for SM26',
        `Please provide the required details for your ${SM26_ROLE_LABELS[ra.role] || ra.role} participation${labels ? `: ${labels}` : ''}.`);
    }
    setRoleSaving(false);
    if (error) { toast({ title: 'Failed', description: error.message, variant: 'destructive' }); return; }
    toast({ title: reg.user_id ? 'Participant notified — info requested' : 'Marked as needs-info (no account to notify)' });
    await load(reg.id);
  };

  const setRoleStatus = async (ra: RoleAssignment, status: string) => {
    if (!reg) return;
    setRoleSaving(true);
    const { error } = await supabase.from('sm_role_assignment').update({ status }).eq('id', ra.id);
    setRoleSaving(false);
    if (error) { toast({ title: 'Failed', description: error.message, variant: 'destructive' }); return; }
    await load(reg.id);
  };

  const removeRole = async (ra: RoleAssignment) => {
    if (!reg) return;
    if (!confirm(`Remove the "${SM26_ROLE_LABELS[ra.role] || ra.role}" role from this registration?`)) return;
    setRoleSaving(true);
    const { error } = await supabase.from('sm_role_assignment').delete().eq('id', ra.id);
    setRoleSaving(false);
    if (error) { toast({ title: 'Could not remove role', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Role removed' });
    await load(reg.id);
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
  const assignedRoles = new Set(reg.roles.map(r => r.role));
  const addableRoles = Object.entries(SM26_ROLE_LABELS).filter(([k]) => !assignedRoles.has(k));

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

      {/* Roles & participation */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700">Roles &amp; participation</h2>
        <div className="flex items-center gap-2">
          <Select value={addRoleValue} onValueChange={setAddRoleValue} disabled={roleSaving || addableRoles.length === 0}>
            <SelectTrigger className="w-48 h-9"><SelectValue placeholder="Add a role…" /></SelectTrigger>
            <SelectContent>
              {addableRoles.map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" className="gap-1.5" onClick={addRole} disabled={!addRoleValue || roleSaving}>
            <Plus className="h-4 w-4" /> Add
          </Button>
        </div>
      </div>

      {reg.roles.length === 0 ? (
        <Card className="border-0 shadow-sm"><CardContent className="py-8 text-center text-gray-400">No roles assigned yet.</CardContent></Card>
      ) : (
        reg.roles.map(role => {
          const startup = firstOf(role.startup);
          const architecture = firstOf(role.architecture);
          const marina = firstOf(role.marina);
          const hasLight = role.module_data && Object.keys(role.module_data).length > 0;
          const reqs = reqsForRole(role.role);
          const hasModuleDetails = !!(startup || architecture || marina || hasLight);
          return (
            <Card key={role.id} className="border-0 shadow-sm">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <CardTitle className="text-base flex items-center gap-2">
                    {SM26_ROLE_LABELS[role.role] || role.role}
                    <Badge variant="outline" className="text-[10px] font-normal">{role.scope}</Badge>
                    <Badge variant="secondary" className="text-[10px]">via {role.source}</Badge>
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <Badge className={`text-[10px] ${roleStatusBadgeClass(role.status)}`}>{prettyStatus(role.status)}</Badge>
                    <Select value={role.status} onValueChange={v => setRoleStatus(role, v)} disabled={roleSaving}>
                      <SelectTrigger className="w-36 h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {ROLE_STATUSES.map(s => <SelectItem key={s} value={s}>{prettyStatus(s)}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => requestInfo(role)} disabled={roleSaving} title="Mark as needs-info and notify the participant">
                      <BellRing className="h-3.5 w-3.5" /> Request info
                    </Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-gray-400 hover:text-red-600" onClick={() => removeRole(role)} disabled={roleSaving} title="Remove role">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {startup && <ModuleFields data={startup} />}
                {architecture && <ModuleFields data={architecture} />}
                {marina && <ModuleFields data={marina} />}
                {hasLight && <ModuleFields data={role.module_data} />}
                {!hasModuleDetails && <p className="text-xs text-gray-400">No details captured for this role yet.</p>}

                {role.role === 'sponsor' && reg && (
                  <SponsorPackageEditor roleAssignmentId={role.id} eventId={reg.event_id} />
                )}

                {reqs.length > 0 && (
                  <div className="rounded-lg border border-gray-100 bg-gray-50/60 p-3">
                    <div className="text-[11px] uppercase tracking-wide text-gray-400 mb-2">Required from participant</div>
                    <div className="space-y-1.5">
                      {reqs.map(req => {
                        const satisfied = !!(role.module_data && (role.module_data as Record<string, unknown>)[req.field_key]);
                        return (
                          <div key={req.id} className="flex items-center gap-2 text-sm">
                            {satisfied
                              ? <Check className="h-3.5 w-3.5 text-green-600 shrink-0" />
                              : <X className="h-3.5 w-3.5 text-gray-300 shrink-0" />}
                            <span className={satisfied ? 'text-gray-700' : 'text-gray-500'}>{req.label || req.field_key}</span>
                            {req.is_asset
                              ? <Paperclip className="h-3 w-3 text-gray-300" />
                              : <FileText className="h-3 w-3 text-gray-300" />}
                            {!req.required && <span className="text-[10px] text-gray-400">(optional)</span>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}
