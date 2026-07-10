import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  RefreshCw, ArrowLeft, Mail, Phone, Globe, Building2, MapPin, Briefcase,
  Check, X, Calendar, Plus, Trash2, Paperclip, FileText, Copy, KeyRound, Target, Download,
  ChevronLeft, ChevronRight, UserPlus,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import {
  SM26_ROLE_LABELS, REG_STATUSES, ROLE_STATUSES, regStatusBadgeClass, roleStatusBadgeClass,
  prettyStatus, ORG_SCOPE_ROLES, MODULE_TABLE_ROLES,
  ROLE_STATUS_DESC, SM26_BASE_FIELDS, sm26FieldLabel,
} from './AdminSM26';
import { SponsorPackageEditor } from './SM26SponsorPackage';
import { SM26PaymentPanel } from './SM26PaymentPanel';
import { SM26Invoices } from './SM26Invoices';
import { SM26StatusTimeline } from '@/components/sm26/SM26StatusTimeline';
import { SM26CompanyLink } from './SM26CompanyLink';
import { SM26ProvisionDialog } from './SM26ProvisionDialog';
import { SM26RequestInfo } from './SM26RequestInfo';
import { SM26RequestFields } from './SM26RequestFields';

// SM26 registration detail — full contact + per-role module data, with the
// registration status pipeline AND role management: add roles (auto-filling
// what we know), flag "info required", and notify the participant.

const HIDDEN_KEYS = new Set(['id', 'role_assignment_id', 'event_id', 'organization_id', 'created_at', 'updated_at', 'anon_code']);
// Meta keys we stash on module_data (request-info bookkeeping) — never displayed.
const isMetaKey = (k: string) => k.startsWith('_');

const prettyKey = (k: string) => k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

// Soft, distinguishable chip palette — colour is derived from the value so the
// same category always reads the same colour across registrations.
const CHIP_COLORS = [
  'bg-blue-50 text-blue-700 border-blue-200',
  'bg-emerald-50 text-emerald-700 border-emerald-200',
  'bg-violet-50 text-violet-700 border-violet-200',
  'bg-amber-50 text-amber-700 border-amber-200',
  'bg-rose-50 text-rose-700 border-rose-200',
  'bg-cyan-50 text-cyan-700 border-cyan-200',
  'bg-indigo-50 text-indigo-700 border-indigo-200',
];
const chipColor = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return CHIP_COLORS[h % CHIP_COLORS.length];
};

function Chips({ values }: { values: (string | number)[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {values.map((v, i) => (
        <span key={i} className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${chipColor(String(v))}`}>
          {String(v)}
        </span>
      ))}
    </div>
  );
}

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

// Classify a field so the layout can be compact for short scalars, full-width
// for long text, chips for lists, and a thumbnail/download for files.
const FILE_KEY = /(_url$|logo|image|photo|deck|slides|brochure|attachment|proof|portfolio|document|pitch|file)/i;
const LONG_KEY = /(bio|description|problem|solution|statement|usp|differentiation|positioning|expected|abstract|summary|motivation|objective|background|why|message)/i;
const IMG_EXT = /\.(png|jpe?g|gif|webp|svg|avif)(\?|$)/i;
const isHttp = (v: unknown): v is string => typeof v === 'string' && /^https?:\/\//.test(v);
const isStoragePath = (v: unknown): v is string => typeof v === 'string' && v.includes('/') && !/^https?:\/\//.test(v) && !/\s/.test(v);
function classify(k: string, v: unknown): 'file' | 'long' | 'array' | 'short' {
  if (Array.isArray(v)) {
    // An array of storage paths / urls (e.g. product_images) renders as files.
    if (v.length > 0 && v.every(x => isStoragePath(x) || isHttp(x))) return 'file';
    return 'array';
  }
  if (isStoragePath(v) || (isHttp(v) && FILE_KEY.test(k))) return 'file';
  if (typeof v === 'string' && (LONG_KEY.test(k) || v.length > 80)) return 'long';
  return 'short';
}

// One labelled field's file(s). Resolves each storage path to a signed URL;
// images render as thumbnails that open a shared preview lightbox with ‹ ›
// navigation across all images in the field; other files are download buttons.
function AssetGroup({ label, values }: { label: string; values: string[] }) {
  const [urls, setUrls] = useState<Record<number, string | null>>({});
  useEffect(() => {
    let active = true;
    setUrls({});
    values.forEach(async (v, i) => {
      if (/^https?:\/\//.test(v)) { if (active) setUrls(u => ({ ...u, [i]: v })); return; }
      const { data } = await supabase.storage.from('event-media').createSignedUrl(v, 3600);
      if (active) setUrls(u => ({ ...u, [i]: data?.signedUrl || null }));
    });
    return () => { active = false; };
  }, [values]);

  const nameOf = (v: string) => decodeURIComponent(v.split('/').pop() || 'file');
  const isImg = (v: string, i: number) => IMG_EXT.test(v) || (!!urls[i] && IMG_EXT.test(urls[i]!));
  const imgIdx = values.map((_, i) => i).filter(i => isImg(values[i], i)); // indices that are images
  const [openPos, setOpenPos] = useState<number | null>(null); // position within imgIdx
  const cur = openPos != null ? imgIdx[openPos] : null;
  const go = (d: number) => setOpenPos(p => (p == null ? p : (p + d + imgIdx.length) % imgIdx.length));

  useEffect(() => {
    if (openPos == null) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'ArrowLeft') go(-1); if (e.key === 'ArrowRight') go(1); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openPos, imgIdx.length]);

  return (
    <div className="text-sm">
      <div className="text-[11px] uppercase tracking-wide text-gray-400 mb-1.5">{label}{values.length > 1 ? ` (${values.length})` : ''}</div>
      <div className="flex flex-wrap gap-2">
        {values.map((v, i) => {
          const url = urls[i] ?? null;
          if (isImg(v, i)) {
            return (
              <button key={i} type="button" onClick={() => url && setOpenPos(imgIdx.indexOf(i))} disabled={!url} title="Preview" className="block shrink-0">
                {url
                  ? <img src={url} alt={nameOf(v)} className="h-20 w-20 rounded-lg object-cover border border-gray-200 bg-white hover:ring-2 hover:ring-primary/30 transition" />
                  : <div className="h-20 w-20 rounded-lg border border-gray-200 bg-gray-50 flex items-center justify-center text-gray-300"><RefreshCw className="h-4 w-4 animate-spin" /></div>}
              </button>
            );
          }
          return (
            <Button key={i} size="sm" variant="outline" className="h-9 gap-1.5 max-w-[14rem]" disabled={!url} onClick={() => url && window.open(url, '_blank')}>
              <Download className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{url ? nameOf(v) : 'Loading…'}</span>
            </Button>
          );
        })}
      </div>

      <Dialog open={openPos != null} onOpenChange={o => !o && setOpenPos(null)}>
        <DialogContent className="max-w-4xl">
          <DialogTitle className="sr-only">{cur != null ? nameOf(values[cur]) : 'Image'}</DialogTitle>
          <div className="relative">
            {cur != null && urls[cur] && <img src={urls[cur]!} alt={nameOf(values[cur])} className="max-h-[68vh] w-auto mx-auto rounded-lg" />}
            {imgIdx.length > 1 && (
              <>
                <button type="button" onClick={() => go(-1)} aria-label="Previous" className="absolute left-1 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full bg-white/90 shadow flex items-center justify-center hover:bg-white"><ChevronLeft className="h-5 w-5" /></button>
                <button type="button" onClick={() => go(1)} aria-label="Next" className="absolute right-1 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full bg-white/90 shadow flex items-center justify-center hover:bg-white"><ChevronRight className="h-5 w-5" /></button>
              </>
            )}
          </div>
          <div className="flex items-center justify-center gap-3 pt-2">
            {imgIdx.length > 1 && <span className="text-xs text-gray-400 tabular-nums">{(openPos ?? 0) + 1} / {imgIdx.length}</span>}
            <Button asChild size="sm" variant="outline" className="gap-1.5"><a href={(cur != null && urls[cur]) || '#'} download={cur != null ? nameOf(values[cur]) : undefined} target="_blank" rel="noreferrer"><Download className="h-3.5 w-3.5" /> Download</a></Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ModuleFields({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data).filter(([k, v]) =>
    !HIDDEN_KEYS.has(k) && !isMetaKey(k) && v !== null && v !== '' && v !== false && !(Array.isArray(v) && v.length === 0) && !isEmptyObject(v)
  );
  if (entries.length === 0) return null;
  const shorts = entries.filter(([k, v]) => classify(k, v) === 'short');
  const arrays = entries.filter(([k, v]) => classify(k, v) === 'array');
  const longs = entries.filter(([k, v]) => classify(k, v) === 'long');
  const files = entries.filter(([k, v]) => classify(k, v) === 'file');
  return (
    <div className="space-y-3">
      {/* short scalars — compact, several per row */}
      {shorts.length > 0 && (
        <div className="flex flex-wrap gap-x-5 gap-y-1.5">
          {shorts.map(([k, v]) => (
            <div key={k} className="text-sm leading-tight">
              <span className="text-[10px] uppercase tracking-wide text-gray-400 mr-1.5">{prettyKey(k)}</span>
              <span className="text-gray-800 font-medium">{fmtVal(v)}</span>
            </div>
          ))}
        </div>
      )}
      {/* lists as chips */}
      {arrays.map(([k, v]) => (
        <div key={k} className="text-sm">
          <div className="text-[11px] uppercase tracking-wide text-gray-400 mb-1">{prettyKey(k)}</div>
          <Chips values={v as (string | number)[]} />
        </div>
      ))}
      {/* long text — full width */}
      {longs.map(([k, v]) => (
        <div key={k} className="text-sm">
          <div className="text-[11px] uppercase tracking-wide text-gray-400">{prettyKey(k)}</div>
          <div className="text-gray-800 whitespace-pre-wrap break-words mt-0.5">{fmtVal(v)}</div>
        </div>
      ))}
      {/* files & images — each field labelled, with one or more assets;
          multiple images share a lightbox you can page through with ‹ › */}
      {files.map(([k, v]) => {
        const vals = Array.isArray(v) ? (v as unknown[]).map(String) : [String(v)];
        return <AssetGroup key={k} label={prettyKey(k)} values={vals} />;
      })}
    </div>
  );
}

// Render a free-text "objective" field as colour chips when it reads like a
// multi-select (comma / semicolon / newline separated), else as plain text.
function splitObjective(s: string): string[] {
  return s.split(/[;,\n]|·|•/).map(x => x.trim()).filter(Boolean);
}

// Pretty-print a funding figure: a bare number like "8500000" → "€8.5M";
// anything already formatted (or non-numeric) is shown as-is.
function formatFunds(v: string): string {
  if (!/^[\s€$£0-9.,]+$/.test(v)) return v;
  const n = Number(v.replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(n) || n < 1000) return v;
  const out = n >= 1e6 ? `${(n / 1e6).toFixed(n % 1e6 ? 1 : 0).replace(/\.0$/, '')}M`
    : `${Math.round(n / 1e3)}k`;
  return `€${out}`;
}

// Status timeline (Submitted → Under review → Confirmed → Paid) now lives in
// the shared SM26StatusTimeline component — also rendered in the participant hub.

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
  claim_code: string | null;
  source: string | null;
  requested_fields: string[] | null;
  info_request_note: string | null;
  roles: RoleAssignment[];
}

export function AdminSM26Detail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [reg, setReg] = useState<Registration | null>(null);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [paid, setPaid] = useState(false);
  const [waived, setWaived] = useState(false);
  const [payKey, setPayKey] = useState(0); // bump to refetch the payment panel without a full-page reload
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [roleSaving, setRoleSaving] = useState(false);
  const [addRoleValue, setAddRoleValue] = useState('');
  // Platform-identity provisioning (account + persona + org + welcome email).
  const [provisionOpen, setProvisionOpen] = useState(false);
  const [sponsorLink, setSponsorLink] = useState<{ id: string; company_name: string } | null>(null);
  const [sponsorBusy, setSponsorBusy] = useState(false);

  useEffect(() => { if (id) load(id); }, [id]);

  // Surface the sponsorship-tracker record for this company (by org, else name).
  useEffect(() => {
    if (!reg) { setSponsorLink(null); return; }
    let ignore = false;
    (async () => {
      const q = reg.organization_id
        ? supabase.from('sp_sponsor').select('id,company_name').eq('organization_id', reg.organization_id).limit(1).maybeSingle()
        : reg.company_name
        ? supabase.from('sp_sponsor').select('id,company_name').ilike('company_name', reg.company_name).limit(1).maybeSingle()
        : Promise.resolve({ data: null });
      const { data } = await q;
      if (!ignore) setSponsorLink((data as { id: string; company_name: string } | null) || null);
    })();
    return () => { ignore = true; };
  }, [reg]);

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
    // Payment drives the final timeline stage. Waived counts the same as paid.
    const { data: pay } = await supabase.from('sm_payment').select('status').eq('registration_id', regId).maybeSingle();
    const ps = (pay as { status?: string } | null)?.status;
    setPaid(ps === 'paid' || ps === 'waived');
    setWaived(ps === 'waived');
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
    // Confirming someone without an account → set up their platform identity now.
    if (newStatus === 'confirmed' && !reg.user_id) setProvisionOpen(true);
    if (newStatus === 'confirmed') void supabase.functions.invoke('sm26-email', { body: { registration_id: reg.id, kind: 'confirmed' } }).catch(() => {});
    if (newStatus === 'declined') void supabase.functions.invoke('sm26-email', { body: { registration_id: reg.id, kind: 'declined' } }).catch(() => {});
  };

  // Settling payment (paid OR waived) completes the registration: light up the
  // Paid stage and, if still earlier in the pipeline, confirm it.
  const handlePaymentSaved = async (payStatus: string) => {
    if (!reg) return;
    const settled = payStatus === 'paid' || payStatus === 'waived';
    setPaid(settled);
    setWaived(payStatus === 'waived');
    if (settled && (reg.status === 'submitted' || reg.status === 'under_review')) {
      await supabase.from('sm_registration').update({ status: 'confirmed' }).eq('id', reg.id);
      setReg({ ...reg, status: 'confirmed' });
      toast({ title: 'Registration completed', description: 'Payment settled — status set to Confirmed.' });
      void supabase.functions.invoke('sm26-email', { body: { registration_id: reg.id, kind: 'confirmed' } }).catch(() => {});
    }
    if (settled) void supabase.functions.invoke('sm26-email', { body: { registration_id: reg.id, kind: 'paid' } }).catch(() => {});
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
    // Connect the dots: a sponsor role flows into the sponsorship tracker + partners.
    if (role === 'sponsor') await supabase.rpc('sp_link_from_sm26', { p_registration_id: reg.id }).then(({ error }) => { if (error) console.error('sp_link_from_sm26', error); });
    setAddRoleValue('');
    setRoleSaving(false);
    toast({
      title: `Added role: ${SM26_ROLE_LABELS[role] || role}`,
      description: role === 'sponsor' ? 'Added to the sponsorship tracker & featured as a partner.'
        : needsInfo && reg.user_id ? 'Participant notified that info is required.' : undefined,
    });
    await load(reg.id);
  };

  // Manual "connect the dots" for a company that already has a sponsor role.
  const linkSponsor = async () => {
    if (!reg) return;
    setSponsorBusy(true);
    const { error } = await supabase.rpc('sp_link_from_sm26', { p_registration_id: reg.id });
    setSponsorBusy(false);
    if (error) { toast({ title: 'Could not link', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Linked to sponsorship tracker', description: 'Added to Sponsors and featured as a partner.' });
    await load(reg.id);
  };

  // Give this registration's contact access to the sponsor portal (a "Sponsorship"
  // tab on their account). Needs the contact to have an account already.
  const grantPortalAccess = async () => {
    if (!reg || !sponsorLink) return;
    if (!reg.email) { toast({ title: 'No contact email on this registration', variant: 'destructive' }); return; }
    setSponsorBusy(true);
    const { data, error } = await supabase.rpc('sp_link_sponsor_user', { p_sponsor_id: sponsorLink.id, p_email: reg.email });
    setSponsorBusy(false);
    if (error) { toast({ title: 'Could not grant access', description: error.message, variant: 'destructive' }); return; }
    if (!data) { toast({ title: 'No account yet for this contact', description: 'Set up their account first (confirm / provision), then grant access.', variant: 'destructive' }); return; }
    toast({ title: 'Portal access granted', description: 'They now see a Sponsorship tab on their account.' });
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
  // Headline subtitle (Company · Country · Seeking €X) — the funding figure comes
  // from a startup role's profile when present.
  const startupProfile = reg.roles.map(r => firstOf(r.startup)).find(Boolean);
  const seeking = startupProfile?.funds_needed as string | undefined;
  const headlineParts = [reg.company_name, reg.country, seeking ? `Seeking ${formatFunds(seeking)}` : null].filter(Boolean) as string[];
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
                {headlineParts.length > 0 && (
                  <div className="text-sm text-gray-500 mt-0.5">{headlineParts.join(' · ')}</div>
                )}
                <div className="flex items-center gap-2 text-xs text-gray-400 mt-1">
                  <Calendar className="h-3 w-3" /> Registered {new Date(reg.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                  {!reg.user_id && <Badge className="text-[10px] bg-gray-100 text-gray-500 border-gray-200">No account</Badge>}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" className="gap-1.5 h-9" onClick={() => setProvisionOpen(true)}>
                <KeyRound className="h-4 w-4" /> {reg.user_id ? 'Platform identity' : 'Set up account'}
              </Button>
              <Badge className={`text-xs ${regStatusBadgeClass(reg.status)}`}>{prettyStatus(reg.status)}</Badge>
              <Select value={reg.status} onValueChange={updateStatus} disabled={saving}>
                <SelectTrigger className="w-44 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {REG_STATUSES.map(s => <SelectItem key={s} value={s}>{prettyStatus(s)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <SM26StatusTimeline status={reg.status} paid={paid} waived={waived} />
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
              {reg.objective && (
                <div className="text-sm">
                  <span className="text-[11px] uppercase tracking-wide text-gray-400 flex items-center gap-1"><Target className="h-3 w-3" /> Objectives for attending</span>
                  <div className="mt-1"><Chips values={splitObjective(reg.objective)} /></div>
                </div>
              )}
              {reg.how_heard && <div className="text-sm"><span className="text-[11px] uppercase tracking-wide text-gray-400">How heard</span><div className="text-gray-800">{reg.how_heard}</div></div>}
            </div>
          )}

          <div className="mt-4 pt-3 border-t border-gray-100 space-y-2">
            {reg.requested_fields && reg.requested_fields.length > 0 && (
              <div className="text-xs text-amber-700 bg-amber-50/60 border border-amber-100 rounded-lg px-3 py-2">
                <span className="font-medium">Awaiting from participant:</span>{' '}
                {SM26_BASE_FIELDS.filter(f => reg.requested_fields!.includes(f.key)).map(f => f.label).join(', ')}
                {reg.info_request_note && <span className="block mt-0.5 italic">“{reg.info_request_note}”</span>}
              </div>
            )}
            <SM26RequestFields
              registrationId={reg.id}
              userId={reg.user_id}
              current={reg as unknown as Record<string, unknown>}
              alreadyRequested={reg.requested_fields || []}
              onSent={() => load(reg.id)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Account claim (imported registrations not yet linked to an account) */}
      {reg.claim_code && (
        <Card className="border-0 shadow-sm border-l-4 border-l-amber-400">
          <CardContent className="p-4 flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-gray-400 flex items-center gap-1.5"><KeyRound className="h-3.5 w-3.5" /> Account claim · not yet claimed</div>
              <div className="font-mono text-sm font-semibold text-gray-900 mt-0.5">{reg.claim_code}</div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {!reg.user_id && (
                <Button size="sm" className="gap-1.5" onClick={() => setProvisionOpen(true)}>
                  <Mail className="h-4 w-4" /> Set up account &amp; invite
                </Button>
              )}
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => {
                const link = `${window.location.origin}/sm26/claim?code=${reg.claim_code}`;
                navigator.clipboard?.writeText(link).catch(() => {});
                toast({ title: 'Claim link copied', description: link });
              }}>
                <Copy className="h-4 w-4" /> Copy claim link
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Company link — attach the registration to a real SMC organization (link-when-exists) */}
      <SM26CompanyLink registrationId={reg.id} organizationId={reg.organization_id} companyName={reg.company_name} onChange={() => load(reg.id)} />

      {/* Platform-identity provisioning (account + persona + org + welcome email) */}
      <SM26ProvisionDialog reg={reg} open={provisionOpen} onOpenChange={setProvisionOpen} onDone={() => load(reg.id)} />

      {/* Payment */}
      <SM26PaymentPanel key={payKey} registrationId={reg.id} eventId={reg.event_id} onSaved={handlePaymentSaved} />

      {/* Invoice documents — participant sees them in their event hub. Uploading
          moves unpaid → invoiced, so refetch just the payment panel (no full-page
          reload — that would flash and drop any in-progress edits elsewhere). */}
      <SM26Invoices registrationId={reg.id} eventId={reg.event_id} onChange={() => setPayKey(k => k + 1)} />

      {/* Sponsorship — a sponsor company flows into the fulfilment tracker + partners */}
      {(reg.roles.some(r => r.role === 'sponsor' && r.status !== 'declined') || sponsorLink) && (
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 flex items-center justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-gray-900 flex items-center gap-2"><Building2 className="h-4 w-4 text-primary" /> Sponsorship</div>
              <p className="text-xs text-gray-500 mt-0.5 max-w-md">
                {sponsorLink
                  ? 'Tracked in the sponsorship fulfilment tracker and featured as a partner — set up and fill their deliverables there.'
                  : 'This company has a sponsor role. Add them to the fulfilment tracker to set up and track their deliverables (and feature them as a partner).'}
              </p>
            </div>
            {sponsorLink ? (
              <div className="flex items-center gap-2 shrink-0">
                {reg.user_id && (
                  <Button size="sm" variant="outline" className="gap-1.5" disabled={sponsorBusy} onClick={grantPortalAccess} title="Give this contact a Sponsorship tab on their account">
                    <UserPlus className="h-4 w-4" /> Grant access
                  </Button>
                )}
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => navigate(`/admin/sponsorships/${sponsorLink.id}`)}>
                  Open sponsor <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <Button size="sm" className="gap-1.5 shrink-0" disabled={sponsorBusy} onClick={linkSponsor}>
                {sponsorBusy ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add to tracker
              </Button>
            )}
          </CardContent>
        </Card>
      )}

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
          const roleChip = (startup?.stage as string) || (architecture?.category as string) || '';
          const hasLight = role.module_data && Object.keys(role.module_data).length > 0;
          const reqs = reqsForRole(role.role);
          const hasModuleDetails = !!(startup || architecture || marina || hasLight);
          const md = (role.module_data || {}) as Record<string, unknown>;
          const requestedInfo = new Set((md._requested_info as string[] | undefined) || []);
          const requestNote = md._request_note as string | undefined;
          // Combined data (module_data + the profile row) to judge what's provided,
          // tolerating field_key vs column differences (logo ↔ logo_url, deck ↔ pitch_deck…).
          const roleData = { ...md, ...(startup || {}), ...(architecture || {}), ...(marina || {}) } as Record<string, unknown>;
          const fieldHas = (v: unknown) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0);
          const fieldSatisfied = (k: string) => fieldHas(roleData[k]) || Object.keys(roleData).some(key => fieldHas(roleData[key]) && key.includes(k));
          // Empty TEXT fields the participant could still fill — offered as extra
          // tickable items in the request-info picker (beyond the fixed requirements).
          const STRUCT_KEYS = new Set(['id', 'role_assignment_id', 'event_id', 'organization_id', 'created_at', 'updated_at', 'anon_code', 'visibility_level', 'social_links', 'references_text']);
          const reqKeys = new Set(reqs.map(r => r.field_key));
          const missingTextFields = Object.keys(roleData)
            .filter(k => !STRUCT_KEYS.has(k) && !isMetaKey(k) && !FILE_KEY.test(k) && !reqKeys.has(k) && (roleData[k] === null || roleData[k] === ''))
            .map(k => ({ field_key: k, label: sm26FieldLabel(k), required: false, is_asset: false }));
          return (
            <Card key={role.id} className="border-0 shadow-sm">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <CardTitle className="text-base flex items-center gap-2">
                    {SM26_ROLE_LABELS[role.role] || role.role}
                    {roleChip && <Badge variant="secondary" className="text-[10px] font-normal capitalize">{roleChip}</Badge>}
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <Badge className={`text-[10px] ${roleStatusBadgeClass(role.status)}`}>{prettyStatus(role.status)}</Badge>
                    <Select value={role.status} onValueChange={v => setRoleStatus(role, v)} disabled={roleSaving}>
                      <SelectTrigger className="w-36 h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {ROLE_STATUSES.map(s => (
                          <SelectItem key={s} value={s}>
                            <span className="flex flex-col">
                              <span>{prettyStatus(s)}</span>
                              <span className="text-[10px] text-gray-400">{ROLE_STATUS_DESC[s]}</span>
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-gray-400 hover:text-red-600" onClick={() => removeRole(role)} disabled={roleSaving} title="Remove role">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                {ROLE_STATUS_DESC[role.status] && (
                  <p className="text-xs text-gray-400 mt-1">{ROLE_STATUS_DESC[role.status]}</p>
                )}
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
                        const satisfied = fieldSatisfied(req.field_key);
                        const requested = requestedInfo.has(req.field_key);
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
                            {requested && !satisfied && <span className="text-[10px] text-amber-600 font-medium">· requested</span>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {(requestedInfo.size > 0 || requestNote) && (
                  <div className="text-xs text-amber-700 bg-amber-50/60 border border-amber-100 rounded-lg px-3 py-2">
                    <span className="font-medium">Last request to participant:</span>{' '}
                    {requestedInfo.size > 0
                      ? reqs.filter(r => requestedInfo.has(r.field_key)).map(r => r.label || r.field_key).join(', ')
                      : 'note only'}
                    {requestNote && <span className="block mt-0.5 italic">“{requestNote}”</span>}
                  </div>
                )}

                <SM26RequestInfo
                  roleAssignmentId={role.id}
                  registrationId={reg.id}
                  roleLabel={SM26_ROLE_LABELS[role.role] || role.role}
                  items={[...reqs.map(r => ({ field_key: r.field_key, label: r.label, required: r.required, is_asset: r.is_asset })), ...missingTextFields]}
                  moduleData={role.module_data}
                  satisfiedData={roleData}
                  userId={reg.user_id}
                  onSent={() => load(reg.id)}
                />
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}
