import { useState, useEffect, useRef } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link, useNavigate } from 'react-router-dom';
import {
  CheckCircle, Loader2, Check, FileText, Paperclip, ExternalLink, Ship, RefreshCw,
  BookOpen, CreditCard, MessageSquare, Calendar, LayoutDashboard, Users, Scale,
  AlertCircle, ChevronRight, Receipt, Download, UserCheck,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { SM26_ROLE_LABELS, roleStatusBadgeClass, prettyStatus, sm26FieldLabel } from '@/components/admin/AdminSM26';
import { SM26Notifications } from '@/components/sm26/SM26Notifications';
import { SM26EditDetails } from '@/components/sm26/SM26EditDetails';
import { SM26EditModule } from '@/components/sm26/SM26EditModule';
import { SM26BackLink } from '@/components/sm26/SM26BackLink';
import { SM26Agenda } from '@/components/sm26/SM26Agenda';
import { SM26MyConnections } from '@/components/sm26/SM26MyConnections';
import { SM26AssetUpload } from '@/components/sm26/SM26AssetUpload';
import { SM26MyJuryPanel } from '@/components/sm26/SM26MyJuryPanel';
import { SM26StatusTimeline } from '@/components/sm26/SM26StatusTimeline';
import { SM26AttendeeRoster } from '@/components/sm26/SM26AttendeeRoster';
import { SM26JuryPage } from '@/pages/SM26JuryPage';
import { SM26VotePage } from '@/pages/SM26VotePage';

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
  user_id: string | null; organization_id: string | null;
  first_name: string | null; last_name: string | null;
  company_name: string | null; country: string | null; created_at: string | null;
  roles: RoleAssignment[];
}
interface EcatPage {
  id: string; kind: string; status: string;
  designed_file_path: string | null; published_file_path: string | null;
}
interface Invoice {
  id: string; file_path: string; label: string | null;
  amount_cents: number | null; currency: string | null; created_at: string;
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

// `embedded` renders the hub without its own page chrome (bg + hero) so it can
// live inside the /account "Event" tab; standalone /sm26/me keeps the chrome.
export function SM26MyRegistrationPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { user, loading: authLoading } = useAuth();
  const [reg, setReg] = useState<Registration | null>(null);
  const [regs, setRegs] = useState<Registration[]>([]);
  const selectedIdRef = useRef<string | null>(null);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [loading, setLoading] = useState(true);
  // draft text values + busy flags, keyed by role assignment id
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({});
  const [savingRole, setSavingRole] = useState<string | null>(null);
  const [ecat, setEcat] = useState<EcatPage[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payStatus, setPayStatus] = useState<string>('unpaid');
  const [ecatBusy, setEcatBusy] = useState<string | null>(null);
  const [changeNote, setChangeNote] = useState<Record<string, string>>({});
  const [statusBusy, setStatusBusy] = useState(false);
  const [onsiteBusy, setOnsiteBusy] = useState<string | null>(null);
  const [subTab, setSubTab] = useState('overview');

  useEffect(() => { if (user) load(); }, [user]);

  // Load the per-registration details (drafts, e-catalogue, payment) for one reg.
  const selectReg = async (r: Registration) => {
    setReg(r);
    selectedIdRef.current = r.id;
    // Reset per-registration panels immediately so a slow load can't show the
    // previous registration's billing data under the new identity.
    setEcat([]); setInvoices([]); setPayStatus('unpaid');
    const d: Record<string, Record<string, string>> = {};
    for (const role of r.roles) {
      d[role.id] = {};
      for (const [k, v] of Object.entries(role.module_data || {})) {
        if (typeof v === 'string') d[role.id][k] = v;
      }
    }
    setDrafts(d);
    const [{ data: ecatRows }, { data: pay }, { data: invRows }] = await Promise.all([
      supabase.from('sm_ecat_page').select('id,kind,status,designed_file_path,published_file_path').eq('registration_id', r.id),
      supabase.from('sm_payment').select('status').eq('registration_id', r.id).maybeSingle(),
      supabase.from('sm_invoice').select('id,file_path,label,amount_cents,currency,created_at').eq('registration_id', r.id).order('created_at', { ascending: false }),
    ]);
    if (selectedIdRef.current !== r.id) return; // selection moved on mid-flight
    setEcat((ecatRows || []) as EcatPage[]);
    setPayStatus((pay as { status?: string } | null)?.status || 'unpaid');
    setInvoices((invRows || []) as Invoice[]);
  };

  const load = async () => {
    setLoading(true);
    // Link any registration imported under this user's email but never claimed
    // via the code link, so it appears here even if they signed up normally.
    try { await supabase.rpc('sm_autoclaim_by_email'); } catch { /* best-effort */ }
    const { data: ev } = await supabase.from('sm_event').select('id').eq('slug', 'sm26').maybeSingle();
    if (!ev) { setReg(null); setLoading(false); return; }
    const eventId = (ev as { id: string }).id;
    // Registrations for this personal hub: the user's OWN, plus any that belong
    // to an organization they're a member of (lets teammates view/manage the
    // company's entry). We scope explicitly here rather than lean on row-level
    // access, because M3 staff (admin/moderator) can read EVERY registration —
    // they manage those from the admin console, not from their personal hub.
    const [{ data }, { data: memberships }] = await Promise.all([
      supabase
        .from('sm_registration')
        .select('id,event_id,status,user_id,organization_id,first_name,last_name,company_name,country,created_at, roles:sm_role_assignment(id,role,status,module_data)')
        .eq('event_id', eventId)
        .order('created_at', { ascending: false }),
      supabase.from('organization_members').select('organization_id').eq('user_id', user!.id),
    ]);
    const myOrgIds = new Set((memberships || []).map((m: { organization_id: string }) => m.organization_id));
    const list = ((data || []) as Registration[])
      .filter(r => r.user_id === user!.id || (!!r.organization_id && myOrgIds.has(r.organization_id)));
    setRegs(list);
    const { data: reqs } = await supabase.from('sm_role_requirement').select('*').eq('event_id', eventId);
    setRequirements((reqs || []) as Requirement[]);
    // Keep the current selection across reloads; else prefer the user's own
    // registration, falling back to the first one they can access.
    const chosen = list.find(r => r.id === selectedIdRef.current)
      || list.find(r => r.user_id === user!.id) || list[0] || null;
    if (chosen) await selectReg(chosen); else { setReg(null); selectedIdRef.current = null; }
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
    // Alert M3 when the participant has just completed a requested-info checklist.
    if (reg && nextStatus === 'info_provided' && role.status !== 'info_provided') {
      void supabase.functions.invoke('sm26-email', { body: { registration_id: reg.id, kind: 'admin_info_completed' } }).catch(() => {});
    }
    return true;
  };

  const saveRole = async (role: RoleAssignment) => {
    setSavingRole(role.id);
    const merged = { ...(role.module_data || {}), ...(drafts[role.id] || {}) };
    const ok = await persist(role, merged);
    setSavingRole(null);
    if (ok) toast({ title: 'Saved' });
  };

  // Jury on-site opt-in: adds/removes the entry badge (the on-site check-in list).
  const setOnsite = async (role: RoleAssignment, attending: boolean) => {
    setOnsiteBusy(role.id);
    const { error } = await supabase.rpc('sm_set_onsite_attendance', { p_role_assignment_id: role.id, p_attending: attending });
    setOnsiteBusy(null);
    if (error) { toast({ title: 'Could not update', description: error.message, variant: 'destructive' }); return; }
    setReg(prev => prev ? { ...prev, roles: prev.roles.map(r => r.id === role.id ? { ...r, module_data: { ...(r.module_data || {}), onsite_attendance: attending ? 'yes' : 'no' } } : r) } : prev);
    toast({ title: attending ? "You're on the on-site check-in list" : 'Marked as evaluating online only' });
  };

  // Persist a new asset path-list for a field (uploads handled by SM26AssetUpload).
  // Stored as an array; null when empty so required-completeness checks stay truthy-only.
  const onAssetChange = async (role: RoleAssignment, field: string, paths: string[]) => {
    const merged = { ...(role.module_data || {}), ...(drafts[role.id] || {}), [field]: paths.length ? paths : null };
    // drop any stale single-string draft for this field so a later text Save can't clobber the list
    setDrafts(prev => { const d = { ...(prev[role.id] || {}) }; delete d[field]; return { ...prev, [role.id]: d }; });
    await persist(role, merged);
  };

  const viewFile = async (path: string) => {
    const { data, error } = await supabase.storage.from('event-media').createSignedUrl(path, 300);
    if (error || !data) { toast({ title: 'Could not open file', variant: 'destructive' }); return; }
    window.open(data.signedUrl, '_blank');
  };

  const navigate = useNavigate();

  // "Start over" — discard the (cancelled) registration entirely and go to the form
  // fresh, so the participant can choose a different way to take part. The cascade
  // (verified CASCADE/SET NULL) cleans up role + role-specific data; the register
  // form then treats them as a new registrant (no existing row to redirect on).
  const restartRegistration = async () => {
    if (!reg) return;
    if (!window.confirm('Start a new registration? This permanently replaces your current registration — including any details you entered — so you can choose how to take part again.')) return;
    setStatusBusy(true);
    const { error } = await supabase.rpc('sm_restart_registration', { p_event_id: reg.event_id });
    setStatusBusy(false);
    if (error) { toast({ title: 'Could not restart', description: error.message, variant: 'destructive' }); return; }
    navigate('/sm26/register');
  };

  // Self-service unregister / re-register. The reg-status guard allows the owner
  // to move their own registration to 'cancelled' or back to 'submitted'; M3 sees
  // the "Cancelled" status in the admin registrations console.
  const setRegStatus = async (status: 'cancelled' | 'submitted') => {
    if (!reg) return;
    if (status === 'cancelled' && !window.confirm('Unregister from the Smart & Sustainable Marina Rendezvous 2026? M3 will see that you have withdrawn. You can re-register later.')) return;
    setStatusBusy(true);
    const { error } = await supabase.from('sm_registration').update({ status }).eq('id', reg.id);
    setStatusBusy(false);
    if (error) { toast({ title: 'Could not update', description: error.message, variant: 'destructive' }); return; }
    setReg(prev => prev ? { ...prev, status } : prev);
    toast({ title: status === 'cancelled' ? 'You have unregistered' : "You're registered again" });
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

  if (reg.status === 'cancelled') return (
    <div className={embedded ? '' : 'min-h-screen bg-gray-50'}>
      {!embedded && <Helmet><title>My SM26 participation — Smart Marina Connect</title></Helmet>}
      {!embedded && (
        <section className="bg-gradient-to-br from-[#0b2653] to-[#143a6b] text-white">
          <div className="container mx-auto px-4 py-10">
            <div className="mb-3"><SM26BackLink light /></div>
            <h1 className="text-2xl lg:text-3xl font-bold">Your participation</h1>
          </div>
        </section>
      )}
      <div className={embedded ? 'max-w-xl' : 'container mx-auto px-4 py-8 max-w-xl'}>
        <Card>
          <CardContent className="py-10 text-center">
            <Ship className="h-10 w-10 text-gray-300 mx-auto mb-3" />
            <h2 className="text-lg font-semibold text-gray-900">You've unregistered</h2>
            <p className="text-gray-500 text-sm mt-1 mb-5">You've withdrawn from the Smart &amp; Sustainable Marina Rendezvous 2026. Changed your mind?</p>
            <div className="flex flex-col sm:flex-row gap-2 justify-center">
              <Button onClick={() => setRegStatus('submitted')} disabled={statusBusy} className="gap-1.5">
                {statusBusy && <Loader2 className="h-4 w-4 animate-spin" />} Bring back my registration
              </Button>
              {reg.user_id === user?.id && (
                <Button variant="outline" onClick={restartRegistration} disabled={statusBusy}>
                  Start a new registration
                </Button>
              )}
            </div>
            <p className="text-[11px] text-gray-400 mt-3 max-w-sm mx-auto">
              <strong>Bring back</strong> restores your previous details exactly as they were. <strong>Start new</strong> lets you choose a different way to take part — it replaces your current registration.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );

  // Declined roles are hidden from the participant (admin-only), matching SM26ParticipationCard.
  const visibleRoles = reg.roles.filter(r => r.status !== 'declined');
  const rolesWithReqs = visibleRoles.filter(r => reqsForRole(r.role).length > 0);

  // Dashboard rollups: required-item completeness + count of items M3 explicitly requested.
  const isJuror = visibleRoles.some(r => r.role === 'jury');
  const requiredCells = rolesWithReqs.flatMap(role => {
    const md = role.module_data || {};
    return reqsForRole(role.role).filter(r => r.required).map(r => !!md[r.field_key]);
  });
  const reqTotal = requiredCells.length;
  const reqDone = requiredCells.filter(Boolean).length;
  const outstandingCount = rolesWithReqs.reduce((n, role) => {
    const md = role.module_data || {};
    const requested = new Set((md._requested_info as string[] | undefined) || []);
    return n + reqsForRole(role.role).filter(r => requested.has(r.field_key) && !md[r.field_key]).length;
  }, 0);
  const subTabs: { key: string; label: string; icon: typeof FileText; dot?: boolean }[] = [
    { key: 'overview', label: 'Overview', icon: LayoutDashboard },
    { key: 'participation', label: 'My details', icon: FileText, dot: outstandingCount > 0 || (reqTotal > 0 && reqDone < reqTotal) },
    { key: 'attendees', label: 'Attendees', icon: UserCheck },
    { key: 'programme', label: 'Programme', icon: Calendar },
    ...(ecat.length > 0 ? [{ key: 'catalogue', label: 'E-catalogue', icon: BookOpen }] : []),
    { key: 'connections', label: 'Connections', icon: Users },
    ...(isJuror ? [{ key: 'jury', label: 'Jury', icon: Scale }] : []),
  ];

  return (
    <div className={embedded ? '' : 'min-h-screen bg-gray-50'}>
      {!embedded && <Helmet><title>My SM26 participation — Smart Marina Connect</title></Helmet>}

      {!embedded && (
        <section className="bg-gradient-to-br from-[#0b2653] to-[#143a6b] text-white">
          <div className="container mx-auto px-4 py-10">
            <div className="mb-3"><SM26BackLink light /></div>
            <p className="uppercase tracking-wide text-white/60 text-sm mb-2">SM26 · 20–21 September 2026 · Yacht Club de Monaco</p>
            <h1 className="text-2xl lg:text-3xl font-bold">Your participation</h1>
            <p className="text-white/80 mt-2">Complete the details M3 needs for each of your roles.</p>
          </div>
        </section>
      )}

      <div className={embedded ? 'max-w-2xl space-y-6' : 'container mx-auto px-4 py-8 max-w-2xl space-y-6'}>
        <SM26Notifications />

        {regs.length > 1 && (
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="text-xs font-medium text-gray-500 mb-2">You can access more than one registration</div>
              <div className="flex flex-wrap gap-2">
                {regs.map(r => {
                  const active = r.id === reg.id;
                  const mine = r.user_id === user?.id;
                  return (
                    <button key={r.id} type="button" onClick={() => selectReg(r)}
                      className={`px-3 py-1.5 rounded-lg border text-sm transition-colors ${active ? 'border-primary bg-primary/5 text-primary font-medium' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                      {r.company_name || r.first_name || 'Registration'}{mine ? <span className="ml-1 text-[10px] text-gray-400">(you)</span> : null}
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {reg.user_id !== user?.id && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 text-xs text-blue-800 flex items-start gap-2">
            <Ship className="h-4 w-4 mt-0.5 shrink-0 text-blue-500" />
            <span>You're viewing your organisation's registration{reg.first_name ? <> — submitted by <strong>{reg.first_name}</strong></> : null}. As a team member you can view and update it; changes apply to the company's entry.</span>
          </div>
        )}

        {/* ── Dashboard header ── */}
        <Card>
          <CardContent className="pt-6 space-y-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-3 min-w-0">
                <div className="h-11 w-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-bold text-lg shrink-0">
                  {([reg.first_name, reg.company_name].find(Boolean) || '?').charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="font-bold text-gray-900 truncate">
                    {[reg.first_name, reg.last_name].filter(Boolean).join(' ') || reg.company_name || 'Your registration'}
                  </div>
                  {(reg.company_name || reg.country) && (
                    <div className="text-xs text-gray-500 truncate">{[reg.company_name, reg.country].filter(Boolean).join(' · ')}</div>
                  )}
                  {reg.created_at && (
                    <div className="text-[11px] text-gray-400 flex items-center gap-1 mt-0.5">
                      <Calendar className="h-3 w-3" /> Registered {new Date(reg.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 justify-end">
                {visibleRoles.map(r => (
                  <Badge key={r.id} variant="secondary" className="text-[11px]">{SM26_ROLE_LABELS[r.role] || r.role}</Badge>
                ))}
              </div>
            </div>
            <SM26StatusTimeline status={reg.status} paid={payStatus === 'paid' || payStatus === 'waived'} waived={payStatus === 'waived'} />
            {reqTotal > 0 && (
              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-gray-500">Your details</span>
                  <span className={reqDone === reqTotal ? 'text-green-600 font-medium' : 'text-amber-600 font-medium'}>{reqDone}/{reqTotal} complete</span>
                </div>
                <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                  <div className={`h-full rounded-full ${reqDone === reqTotal ? 'bg-green-500' : 'bg-primary'}`} style={{ width: `${Math.round((reqDone / reqTotal) * 100)}%` }} />
                </div>
              </div>
            )}
            {outstandingCount > 0 && (
              <button type="button" onClick={() => setSubTab('participation')}
                className="w-full text-left rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 flex items-center gap-2 hover:bg-amber-100 transition-colors">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>M3 has requested <strong>{outstandingCount}</strong> {outstandingCount === 1 ? 'item' : 'items'} from you — tap to complete.</span>
                <ChevronRight className="h-4 w-4 ml-auto shrink-0" />
              </button>
            )}
          </CardContent>
        </Card>

        {/* ── Sub-navigation ── */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          {subTabs.map(t => {
            const Icon = t.icon;
            const active = subTab === t.key;
            return (
              <button key={t.key} type="button" onClick={() => setSubTab(t.key)}
                className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${active ? 'border-primary bg-primary text-white' : 'border-gray-200 bg-white text-gray-600 hover:border-primary/40'}`}>
                <Icon className="h-4 w-4" /> {t.label}
                {t.dot && !active && <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />}
              </button>
            );
          })}
        </div>

        {/* ── Overview ── */}
        {subTab === 'overview' && (
          <div className="space-y-4">
            {invoices.length > 0 && (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <CardTitle className="flex items-center gap-2"><Receipt className="h-5 w-5 text-primary" /> Your invoices</CardTitle>
                    <Badge className={`text-[11px] ${(payStatus === 'paid' || payStatus === 'waived') ? 'bg-green-50 text-green-700 border-green-200' : payStatus === 'invoiced' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-gray-100 text-gray-500 border-gray-200'}`}>
                      <CreditCard className="h-3 w-3 mr-1" /> {payStatus === 'paid' ? 'Paid' : payStatus === 'waived' ? 'No payment due' : payStatus === 'invoiced' ? 'Invoiced' : 'Payment pending'}
                    </Badge>
                  </div>
                  <CardDescription>Invoices from M3 for your participation. Download them any time.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {invoices.map(inv => (
                    <div key={inv.id} className="flex items-center justify-between gap-3 rounded-lg border border-gray-100 p-3">
                      <div className="min-w-0 flex items-center gap-2.5">
                        <FileText className="h-4 w-4 text-gray-400 shrink-0" />
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-gray-900 truncate">
                            {inv.label || (inv.file_path.split('/').pop() || 'Invoice').replace(/^\d{10,}-/, '')}
                          </div>
                          <div className="text-xs text-gray-500">
                            {inv.amount_cents != null && <>{(inv.amount_cents / 100).toFixed(2)} {inv.currency || 'EUR'} · </>}
                            {new Date(inv.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                          </div>
                        </div>
                      </div>
                      <Button variant="outline" size="sm" className="gap-1.5 shrink-0" onClick={() => viewFile(inv.file_path)}>
                        <Download className="h-3.5 w-3.5" /> Download
                      </Button>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
            {visibleRoles.some(r => r.role === 'startup') && <SM26MyJuryPanel eventId={reg.event_id} />}
            <SM26VotePage embedded />
            <Card>
              <CardContent className="pt-6">
                <div className="text-sm font-semibold text-gray-900 mb-3">Quick access</div>
                <div className="grid grid-cols-2 gap-2">
                  {subTabs.filter(t => t.key !== 'overview').map(t => {
                    const Icon = t.icon;
                    return (
                      <button key={t.key} onClick={() => setSubTab(t.key)}
                        className="rounded-lg border border-gray-100 p-3 text-left hover:border-primary/40 hover:bg-gray-50 transition-colors">
                        <Icon className="h-4 w-4 text-primary mb-1" />
                        <div className="text-sm font-medium text-gray-900 flex items-center gap-1.5">{t.label}{t.dot && <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />}</div>
                      </button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {subTab === 'participation' && (
          <>
            <SM26EditDetails registrationId={reg.id} regStatus={reg.status} onSaved={load} />
            {visibleRoles.map(r => <SM26EditModule key={`mod-${r.id}`} roleAssignmentId={r.id} role={r.role} />)}
          </>
        )}

        {subTab === 'attendees' && reg && (
          <Card>
            <CardContent className="pt-6">
              <SM26AttendeeRoster registrationId={reg.id} eventId={reg.event_id} canEdit={reg.status !== 'declined'} variant="hub" />
            </CardContent>
          </Card>
        )}

        {subTab === 'programme' && (
          <Card>
            <CardContent className="pt-6">
              <div className="text-sm font-semibold text-gray-900 mb-1 flex items-center gap-2"><Calendar className="h-4 w-4 text-primary" /> My programme</div>
              <p className="text-xs text-gray-500 mb-3">Your personal schedule — the main programme plus the workshops you've chosen. <Link to="/sm26/agenda" className="text-primary hover:underline">View the full programme</Link> to add or change.</p>
              <SM26Agenda mineOnly />
            </CardContent>
          </Card>
        )}

        {subTab === 'connections' && reg && <SM26MyConnections eventId={reg.event_id} />}

        {subTab === 'catalogue' && ecat.length > 0 && (
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

        {subTab === 'participation' && (rolesWithReqs.length === 0 ? (
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
            // Items M3 specifically asked for (still outstanding) + any note.
            const requested = new Set((md._requested_info as string[] | undefined) || []);
            const requestNote = md._request_note as string | undefined;
            const outstanding = reqs.filter(r => requested.has(r.field_key) && !md[r.field_key]);
            // Fields M3 requested that aren't part of the fixed requirement list
            // (e.g. a missing text field like "domain") — render a box for each.
            const extraRequested = [...requested].filter(k => !reqs.some(r => r.field_key === k));
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
                  {role.role === 'jury' && (
                    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 flex items-center justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-gray-800">Attending on-site in Monaco?</div>
                        <p className="text-xs text-gray-500 mt-0.5">Jurors evaluate online. Turn this on only if you're coming to the event in person — it adds you to the on-site check-in list and issues your entry pass.</p>
                      </div>
                      {md.onsite_attendance === 'yes' ? (
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="inline-flex items-center gap-1.5 rounded-full border border-green-200 bg-green-50 px-3 py-1 text-sm font-medium text-green-700">
                            <Check className="h-4 w-4" /> Attending on-site
                          </span>
                          <Button size="sm" variant="ghost" className="h-8 text-xs text-gray-500 hover:text-gray-700" disabled={onsiteBusy === role.id}
                            onClick={() => setOnsite(role, false)}>
                            {onsiteBusy === role.id ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Cancel'}
                          </Button>
                        </div>
                      ) : (
                        <Button size="sm" disabled={onsiteBusy === role.id}
                          onClick={() => setOnsite(role, true)} className="gap-1.5 shrink-0">
                          {onsiteBusy === role.id ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Attend on-site
                        </Button>
                      )}
                    </div>
                  )}
                  {(outstanding.length > 0 || requestNote) && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
                      <p className="font-medium text-amber-800">M3 has asked you for{outstanding.length > 0 ? ':' : ' a few details.'}</p>
                      {outstanding.length > 0 && (
                        <ul className="mt-1 list-disc list-inside text-amber-700">
                          {outstanding.map(r => <li key={r.id}>{r.label || r.field_key}</li>)}
                        </ul>
                      )}
                      {requestNote && <p className="mt-1.5 text-amber-700 italic">“{requestNote}”</p>}
                    </div>
                  )}
                  {reqs.map(req => {
                    const isRequested = requested.has(req.field_key) && !md[req.field_key];
                    const current = (drafts[role.id]?.[req.field_key] ?? (md[req.field_key] as string) ?? '');
                    const hv = md[req.field_key];
                    const hasValue = Array.isArray(hv) ? hv.length > 0 : !!hv;
                    if (req.is_asset) {
                      return (
                        <div key={req.id} className="space-y-1.5">
                          <Label className="flex items-center gap-1.5">
                            <Paperclip className="h-3.5 w-3.5 text-gray-400" /> {req.label || req.field_key}
                            {!req.required && <span className="text-[10px] text-gray-400">(optional)</span>}
                            {isRequested && <span className="text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">Requested by M3</span>}
                            {hasValue && <Check className="h-3.5 w-3.5 text-green-600" />}
                          </Label>
                          <SM26AssetUpload
                            value={md[req.field_key] as string | string[] | null}
                            basePath={`${user!.id}/${role.id}/${req.field_key}`}
                            onChange={paths => onAssetChange(role, req.field_key, paths)}
                          />
                        </div>
                      );
                    }
                    return (
                      <div key={req.id} className="space-y-1.5">
                        <Label className="flex items-center gap-1.5">
                          <FileText className="h-3.5 w-3.5 text-gray-400" /> {req.label || req.field_key}
                          {!req.required && <span className="text-[10px] text-gray-400">(optional)</span>}
                          {isRequested && <span className="text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">Requested by M3</span>}
                          {hasValue && <Check className="h-3.5 w-3.5 text-green-600" />}
                        </Label>
                        <Textarea rows={2} value={current} onChange={e => setDraft(role.id, req.field_key, e.target.value)} />
                      </div>
                    );
                  })}

                  {extraRequested.map(key => {
                    const hasValue = !!(md[key]);
                    return (
                      <div key={key} className="space-y-1.5">
                        <Label className="flex items-center gap-1.5">
                          <FileText className="h-3.5 w-3.5 text-gray-400" /> {sm26FieldLabel(key)}
                          <span className="text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">Requested by M3</span>
                          {hasValue && <Check className="h-3.5 w-3.5 text-green-600" />}
                        </Label>
                        <Textarea rows={2} value={drafts[role.id]?.[key] ?? (md[key] as string) ?? ''} onChange={e => setDraft(role.id, key, e.target.value)} />
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
        ))}

        {/* Jury scoring console — jurors only */}
        {subTab === 'jury' && isJuror && <SM26JuryPage embedded />}

        {subTab === 'participation' && reg.status !== 'declined' && (
          <div className="text-center pt-2">
            <button type="button" onClick={() => setRegStatus('cancelled')} disabled={statusBusy}
              className="text-xs text-gray-400 hover:text-red-600 underline underline-offset-2 disabled:opacity-50">
              Unregister from the event
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
