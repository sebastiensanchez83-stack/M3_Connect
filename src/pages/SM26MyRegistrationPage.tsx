import { useState, useEffect, useRef } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import {
  CheckCircle, Loader2, Upload, Check, FileText, Paperclip, ExternalLink, Ship, RefreshCw,
  BookOpen, CreditCard, MessageSquare,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { SM26_ROLE_LABELS, roleStatusBadgeClass, prettyStatus } from '@/components/admin/AdminSM26';

// Participant self-service: complete the info/assets M3 needs for each of your
// SM26 roles. Linked from the "information needed" notification (/sm26/me).
// Answers (text + uploaded file paths) are stored in sm_role_assignment.module_data.

interface Requirement {
  id: string; role: string; field_key: string; label: string | null;
  required: boolean; is_asset: boolean; display_order: number;
}
interface RoleAssignment {
  id: string; role: string; status: string; module_data: Record<string, unknown>;
}
interface Registration {
  id: string; event_id: string; status: string;
  first_name: string | null; company_name: string | null;
  roles: RoleAssignment[];
}
interface EcatPage {
  id: string; kind: string; status: string;
  designed_file_path: string | null; published_file_path: string | null;
}

const ECAT_LABEL: Record<string, string> = {
  awaiting_export: 'Being prepared', exported: 'With our designer', in_design: 'In design',
  uploaded: 'Ready for your review', changes_requested: 'Changes sent to designer',
  approved: 'Approved', published: 'Published',
};
const ecatClass = (s: string) =>
  s === 'published' || s === 'approved' ? 'bg-green-50 text-green-700 border-green-200'
  : s === 'uploaded' ? 'bg-blue-50 text-blue-700 border-blue-200'
  : s === 'changes_requested' ? 'bg-amber-50 text-amber-700 border-amber-200'
  : 'bg-gray-50 text-gray-600 border-gray-200';

export function SM26MyRegistrationPage() {
  const { user, loading: authLoading } = useAuth();
  const [reg, setReg] = useState<Registration | null>(null);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [loading, setLoading] = useState(true);
  // draft text values + busy flags, keyed by role assignment id
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({});
  const [savingRole, setSavingRole] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null); // `${roleId}:${field}`
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});
  const [ecat, setEcat] = useState<EcatPage[]>([]);
  const [payStatus, setPayStatus] = useState<string>('unpaid');
  const [ecatBusy, setEcatBusy] = useState<string | null>(null);
  const [changeNote, setChangeNote] = useState<Record<string, string>>({});

  useEffect(() => { if (user) load(); }, [user]);

  const load = async () => {
    setLoading(true);
    const { data: ev } = await supabase.from('sm_event').select('id').eq('slug', 'sm26').maybeSingle();
    if (!ev) { setReg(null); setLoading(false); return; }
    const eventId = (ev as { id: string }).id;
    const { data } = await supabase
      .from('sm_registration')
      .select('id,event_id,status,first_name,company_name, roles:sm_role_assignment(id,role,status,module_data)')
      .eq('event_id', eventId)
      .eq('user_id', user!.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const r = data as Registration | null;
    setReg(r);
    // seed drafts from existing module_data
    if (r) {
      const d: Record<string, Record<string, string>> = {};
      for (const role of r.roles) {
        d[role.id] = {};
        for (const [k, v] of Object.entries(role.module_data || {})) {
          if (typeof v === 'string') d[role.id][k] = v;
        }
      }
      setDrafts(d);
      const [{ data: ecatRows }, { data: pay }] = await Promise.all([
        supabase.from('sm_ecat_page').select('id,kind,status,designed_file_path,published_file_path').eq('registration_id', r.id),
        supabase.from('sm_payment').select('status').eq('registration_id', r.id).maybeSingle(),
      ]);
      setEcat((ecatRows || []) as EcatPage[]);
      setPayStatus((pay as { status?: string } | null)?.status || 'unpaid');
    }
    const { data: reqs } = await supabase.from('sm_role_requirement').select('*').eq('event_id', eventId);
    setRequirements((reqs || []) as Requirement[]);
    setLoading(false);
  };

  const respondEcat = async (page: EcatPage, action: 'approve' | 'request_changes') => {
    setEcatBusy(page.id);
    const { error } = await supabase.rpc('sm_ecat_respond', {
      p_page_id: page.id, p_action: action, p_comment: action === 'request_changes' ? (changeNote[page.id] || '') : null,
    });
    setEcatBusy(null);
    if (error) { toast({ title: 'Could not submit', description: error.message, variant: 'destructive' }); return; }
    setEcat(prev => prev.map(p => p.id === page.id ? { ...p, status: action === 'approve' ? 'approved' : 'changes_requested' } : p));
    setChangeNote(prev => ({ ...prev, [page.id]: '' }));
    toast({ title: action === 'approve' ? 'Page approved' : 'Change request sent' });
  };

  const reqsForRole = (role: string) =>
    requirements.filter(r => r.role === role).sort((a, b) => a.display_order - b.display_order);

  const setDraft = (roleId: string, field: string, value: string) =>
    setDrafts(prev => ({ ...prev, [roleId]: { ...prev[roleId], [field]: value } }));

  // Persist module_data (+ optionally a new status) for a role assignment.
  const persist = async (role: RoleAssignment, moduleData: Record<string, unknown>) => {
    const reqs = reqsForRole(role.role);
    const allRequiredMet = reqs.filter(r => r.required).every(r => !!moduleData[r.field_key]);
    const nextStatus = allRequiredMet && (role.status === 'needs_info' || role.status === 'admin_added')
      ? 'info_provided'
      : role.status;
    const { error } = await supabase
      .from('sm_role_assignment')
      .update({ module_data: moduleData, status: nextStatus })
      .eq('id', role.id);
    if (error) { toast({ title: 'Could not save', description: error.message, variant: 'destructive' }); return false; }
    // update local state
    setReg(prev => prev ? { ...prev, roles: prev.roles.map(r => r.id === role.id ? { ...r, module_data: moduleData, status: nextStatus } : r) } : prev);
    return true;
  };

  const saveRole = async (role: RoleAssignment) => {
    setSavingRole(role.id);
    const merged = { ...(role.module_data || {}), ...(drafts[role.id] || {}) };
    const ok = await persist(role, merged);
    setSavingRole(null);
    if (ok) toast({ title: 'Saved' });
  };

  const onUpload = async (role: RoleAssignment, field: string, file: File) => {
    if (!user) return;
    setUploading(`${role.id}:${field}`);
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `${user.id}/${role.id}/${field}/${safe}`;
    const { error } = await supabase.storage.from('event-media').upload(path, file, { upsert: true });
    if (error) {
      setUploading(null);
      toast({ title: 'Upload failed', description: error.message, variant: 'destructive' });
      return;
    }
    // persist the new path into module_data immediately (avoid orphaned files)
    const merged = { ...(role.module_data || {}), ...(drafts[role.id] || {}), [field]: path };
    const ok = await persist(role, merged);
    setDraft(role.id, field, path);
    setUploading(null);
    if (ok) toast({ title: 'File uploaded' });
  };

  const viewFile = async (path: string) => {
    const { data, error } = await supabase.storage.from('event-media').createSignedUrl(path, 300);
    if (error || !data) { toast({ title: 'Could not open file', variant: 'destructive' }); return; }
    window.open(data.signedUrl, '_blank');
  };

  if (authLoading || loading) return (
    <div className="flex items-center justify-center h-[60vh]"><RefreshCw className="h-8 w-8 animate-spin text-primary" /></div>
  );

  if (!reg) return (
    <div className="container mx-auto px-4 py-16 max-w-xl text-center">
      <Ship className="h-10 w-10 text-gray-300 mx-auto mb-3" />
      <h1 className="text-2xl font-bold mb-2">No SM26 registration yet</h1>
      <p className="text-gray-600 mb-6">You haven't registered for the Smart &amp; Sustainable Marina Rendezvous 2026.</p>
      <Button asChild><Link to="/sm26/register">Register now</Link></Button>
    </div>
  );

  const rolesWithReqs = reg.roles.filter(r => reqsForRole(r.role).length > 0);

  return (
    <div className="min-h-screen bg-gray-50">
      <Helmet><title>My SM26 participation — Smart Marina Connect</title></Helmet>

      <section className="bg-gradient-to-br from-[#0b2653] to-[#143a6b] text-white">
        <div className="container mx-auto px-4 py-10">
          <p className="uppercase tracking-wide text-white/60 text-sm mb-2">SM26 · 20–21 September 2026 · Yacht Club de Monaco</p>
          <h1 className="text-2xl lg:text-3xl font-bold">Your participation</h1>
          <p className="text-white/80 mt-2">Complete the details M3 needs for each of your roles.</p>
        </div>
      </section>

      <div className="container mx-auto px-4 py-8 max-w-2xl space-y-6">
        <Card>
          <CardContent className="pt-6 flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="text-sm text-gray-500">Registration status</div>
              <Badge className={`mt-1 ${roleStatusBadgeClass(reg.status)}`}>{prettyStatus(reg.status)}</Badge>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {reg.roles.map(r => (
                <Badge key={r.id} variant="secondary" className="text-[11px]">{SM26_ROLE_LABELS[r.role] || r.role}</Badge>
              ))}
            </div>
          </CardContent>
        </Card>

        {ecat.length > 0 && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <CardTitle className="flex items-center gap-2"><BookOpen className="h-5 w-5 text-primary" /> Your e-catalogue page</CardTitle>
                <Badge className={`text-[11px] ${payStatus === 'paid' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-gray-100 text-gray-500 border-gray-200'}`}>
                  <CreditCard className="h-3 w-3 mr-1" /> {payStatus === 'paid' ? 'Paid' : payStatus === 'invoiced' ? 'Invoiced' : 'Payment pending'}
                </Badge>
              </div>
              <CardDescription>We design a catalogue page from your profile. Review it here when it's ready — it goes live once you approve it and payment is received.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {ecat.map(page => (
                <div key={page.id} className="rounded-lg border border-gray-200 p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-sm font-medium capitalize">{page.kind} page</span>
                    <Badge className={`text-[10px] ${ecatClass(page.status)}`}>{ECAT_LABEL[page.status] || page.status}</Badge>
                  </div>

                  {(page.status === 'uploaded' || page.status === 'approved' || page.status === 'changes_requested' || page.status === 'published') && (page.published_file_path || page.designed_file_path) && (
                    <Button variant="outline" size="sm" className="gap-1.5" onClick={() => viewFile((page.published_file_path || page.designed_file_path)!)}>
                      <ExternalLink className="h-3.5 w-3.5" /> View {page.status === 'published' ? 'published page' : 'designed page'}
                    </Button>
                  )}

                  {page.status === 'uploaded' && (
                    <div className="space-y-2">
                      <p className="text-sm text-gray-600">Please review the designed page and either approve it or request changes.</p>
                      <Textarea rows={2} placeholder="Optional: what would you like changed?" value={changeNote[page.id] || ''} onChange={e => setChangeNote(prev => ({ ...prev, [page.id]: e.target.value }))} />
                      <div className="flex gap-2">
                        <Button size="sm" className="gap-1.5" disabled={ecatBusy === page.id} onClick={() => respondEcat(page, 'approve')}>
                          {ecatBusy === page.id && <Loader2 className="h-4 w-4 animate-spin" />}<Check className="h-4 w-4" /> Approve
                        </Button>
                        <Button size="sm" variant="outline" className="gap-1.5" disabled={ecatBusy === page.id} onClick={() => respondEcat(page, 'request_changes')}>
                          <MessageSquare className="h-4 w-4" /> Request changes
                        </Button>
                      </div>
                    </div>
                  )}
                  {page.status === 'changes_requested' && <p className="text-sm text-amber-700">Your change request was sent to the designer — we'll share a revised version to review.</p>}
                  {page.status === 'approved' && <p className="text-sm text-green-700">Approved. {payStatus === 'paid' ? 'It will be published shortly.' : 'It will be published once payment is received.'}</p>}
                  {page.status === 'published' && <p className="text-sm text-green-700">Your page is live in the e-catalogue.</p>}
                  {(page.status === 'awaiting_export' || page.status === 'exported' || page.status === 'in_design') && <p className="text-sm text-gray-500">Your page is being prepared — we'll let you know when it's ready to review.</p>}
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {rolesWithReqs.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center">
              <CheckCircle className="h-10 w-10 text-green-500 mx-auto mb-3" />
              <p className="text-gray-700 font-medium">You're all set</p>
              <p className="text-gray-500 text-sm mt-1">There's nothing else to complete right now. M3 will be in touch if anything is needed.</p>
            </CardContent>
          </Card>
        ) : (
          rolesWithReqs.map(role => {
            const reqs = reqsForRole(role.role);
            const md = role.module_data || {};
            const requiredItems = reqs.filter(r => r.required);
            const doneCount = requiredItems.filter(r => !!md[r.field_key]).length;
            const complete = doneCount === requiredItems.length;
            return (
              <Card key={role.id}>
                <CardHeader>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <CardTitle className="flex items-center gap-2">
                      {SM26_ROLE_LABELS[role.role] || role.role}
                      <Badge className={`text-[10px] ${roleStatusBadgeClass(role.status)}`}>{prettyStatus(role.status)}</Badge>
                    </CardTitle>
                    <span className={`text-xs font-medium ${complete ? 'text-green-600' : 'text-amber-600'}`}>
                      {doneCount}/{requiredItems.length} required complete
                    </span>
                  </div>
                  <CardDescription>Provide the items below. Your answers are saved to your registration.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {reqs.map(req => {
                    const current = (drafts[role.id]?.[req.field_key] ?? (md[req.field_key] as string) ?? '');
                    const hasValue = !!(md[req.field_key]);
                    if (req.is_asset) {
                      const busy = uploading === `${role.id}:${req.field_key}`;
                      return (
                        <div key={req.id} className="space-y-1.5">
                          <Label className="flex items-center gap-1.5">
                            <Paperclip className="h-3.5 w-3.5 text-gray-400" /> {req.label || req.field_key}
                            {!req.required && <span className="text-[10px] text-gray-400">(optional)</span>}
                            {hasValue && <Check className="h-3.5 w-3.5 text-green-600" />}
                          </Label>
                          <div className="flex items-center gap-2">
                            <input
                              ref={el => { fileInputs.current[`${role.id}:${req.field_key}`] = el; }}
                              type="file"
                              className="hidden"
                              onChange={e => { const f = e.target.files?.[0]; if (f) onUpload(role, req.field_key, f); e.target.value = ''; }}
                            />
                            <Button type="button" variant="outline" size="sm" className="gap-1.5" disabled={busy}
                              onClick={() => fileInputs.current[`${role.id}:${req.field_key}`]?.click()}>
                              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                              {hasValue ? 'Replace file' : 'Upload file'}
                            </Button>
                            {hasValue && (
                              <Button type="button" variant="ghost" size="sm" className="gap-1.5 text-primary"
                                onClick={() => viewFile(md[req.field_key] as string)}>
                                <ExternalLink className="h-3.5 w-3.5" /> View
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    }
                    return (
                      <div key={req.id} className="space-y-1.5">
                        <Label className="flex items-center gap-1.5">
                          <FileText className="h-3.5 w-3.5 text-gray-400" /> {req.label || req.field_key}
                          {!req.required && <span className="text-[10px] text-gray-400">(optional)</span>}
                          {hasValue && <Check className="h-3.5 w-3.5 text-green-600" />}
                        </Label>
                        <Textarea rows={2} value={current} onChange={e => setDraft(role.id, req.field_key, e.target.value)} />
                      </div>
                    );
                  })}

                  <div className="flex justify-end">
                    <Button onClick={() => saveRole(role)} disabled={savingRole === role.id} className="gap-1.5">
                      {savingRole === role.id && <Loader2 className="h-4 w-4 animate-spin" />}
                      Save
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
