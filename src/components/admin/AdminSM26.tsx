import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Search, ChevronRight, Ship, Mail, User, Clock, Scale, BookOpen, CalendarDays, QrCode, Trophy, MessageSquare, Check, BellRing, X, UserPlus, Users } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { suggestProvision, runProvision, findOrgByName } from './SM26ProvisionDialog';

// SM26 admin console — list of registrations for the Smart & Sustainable
// Marina Rendezvous 2026, with role/status filters and a click-through detail.
// Staff read access is enforced by RLS (sm_registration_select).

export const SM26_ROLE_LABELS: Record<string, string> = {
  visitor: 'Visitor',
  marina: 'Marina',
  startup: 'Startup',
  architect_pro: 'Architecture · Pro',
  architect_student: 'Architecture · Student',
  media: 'Media',
  jury: 'Jury',
  investor: 'Investor',
  sponsor: 'Sponsor',
  speaker: 'Speaker',
  vip: 'VIP',
};

export const REG_STATUSES = ['submitted', 'under_review', 'confirmed', 'waitlist', 'declined', 'cancelled'] as const;

export function regStatusBadgeClass(status: string): string {
  switch (status) {
    case 'confirmed': return 'bg-green-50 text-green-700 border-green-200';
    case 'under_review': return 'bg-amber-50 text-amber-700 border-amber-200';
    case 'waitlist': return 'bg-blue-50 text-blue-700 border-blue-200';
    case 'declined': return 'bg-red-50 text-red-700 border-red-200';
    case 'cancelled': return 'bg-gray-100 text-gray-500 border-gray-200';
    default: return 'bg-gray-50 text-gray-600 border-gray-200'; // submitted
  }
}

export const prettyStatus = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

// Plain-English meaning of each registration status + its position on the
// happy-path timeline (Submitted → Under review → Confirmed → Paid). Off-path
// statuses (waitlist/declined/cancelled) have stage = null.
export const REG_STATUS_META: Record<string, { label: string; desc: string; stage: number | null }> = {
  submitted: { label: 'Submitted', desc: 'Just registered — awaiting M3 review.', stage: 0 },
  under_review: { label: 'Under review', desc: 'M3 is checking eligibility and category.', stage: 1 },
  confirmed: { label: 'Confirmed', desc: 'Approved — full access once payment is settled.', stage: 2 },
  waitlist: { label: 'Waitlist', desc: 'On the waiting list for a place.', stage: null },
  // NOTE: desc is participant-facing too (shared SM26StatusTimeline in the event
  // hub) — keep it neutral; admin-only context lives in the console, not here.
  declined: { label: 'Declined', desc: 'Not accepted for this edition.', stage: null },
  cancelled: { label: 'Cancelled', desc: 'Registration withdrawn.', stage: null },
};
export const REG_STAGES = ['Submitted', 'Under review', 'Confirmed', 'Paid'] as const;

export const ROLE_STATUS_DESC: Record<string, string> = {
  self_submitted: 'Chosen by the participant at registration.',
  admin_added: 'Added by M3 — no extra info required yet.',
  needs_info: 'Waiting on the participant to provide requested info.',
  info_provided: 'Participant supplied the info — awaiting M3 review.',
  confirmed: 'Validated by M3.',
  declined: 'Not accepted — hidden from public pages.',
};

// Base registration fields a participant can complete/edit themselves and that
// admins can request. Shared so the participant card and the request picker use
// identical keys + labels. `multi` renders as chips / a longer text box.
// `numeric` fields are stored as integers, so they render as a number input and
// are cast on save rather than trimmed as text.
export const SM26_BASE_FIELDS: { key: string; label: string; multi?: boolean; numeric?: boolean }[] = [
  { key: 'first_name', label: 'First name' },
  { key: 'last_name', label: 'Last name' },
  { key: 'phone', label: 'Phone' },
  { key: 'company_name', label: 'Company' },
  { key: 'job_title', label: 'Job title' },
  { key: 'website', label: 'Website' },
  { key: 'country', label: 'Country' },
  // Editable after registration, and requestable — it was captured once on the
  // form and then unreachable, which is why ten registrations still have no
  // headcount and nobody could correct one without going into the database.
  { key: 'num_attendees', label: 'How many people are coming', numeric: true },
  { key: 'billing_address', label: 'Billing address (for the invoice)', multi: true },
  { key: 'vat_number', label: 'VAT number' },
  { key: 'objective', label: 'Objectives for attending', multi: true },
];

// Friendly labels for the startup/role profile fields (used when listing them
// as tickable request-info items, so "usp" reads "USP" not "Usp").
export const SM26_FIELD_LABELS: Record<string, string> = {
  usp: 'USP (unique selling point)', problem: 'Problem you solve', solution: 'Your solution',
  differentiation: 'Differentiation', organization_activity: 'What the company does',
  target_markets: 'Target markets', business_model: 'Business model',
  competitive_positioning: 'Competitive positioning', collaboration_expected: 'Collaboration expected',
  references_text: 'References', investment_stage: 'Investment stage', investment_type: 'Investment type',
  funds_needed: 'Funds needed', stage: 'Stage', startup_or_scaleup: 'Startup or scale-up',
  domain: 'Domain', bio: 'Short bio', talk_topic: 'Talk title / topic', outlet: 'Outlet / publication',
};
export const sm26FieldLabel = (k: string) => SM26_FIELD_LABELS[k] || k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

// Per-role assignment status (distinct from the overall registration status)
export const ROLE_STATUSES = ['self_submitted', 'admin_added', 'needs_info', 'info_provided', 'confirmed', 'declined'] as const;

export function roleStatusBadgeClass(status: string): string {
  switch (status) {
    case 'confirmed': return 'bg-green-50 text-green-700 border-green-200';
    case 'info_provided': return 'bg-blue-50 text-blue-700 border-blue-200';
    case 'needs_info': return 'bg-amber-50 text-amber-700 border-amber-200';
    case 'declined': return 'bg-red-50 text-red-700 border-red-200';
    case 'admin_added': return 'bg-violet-50 text-violet-700 border-violet-200';
    default: return 'bg-gray-50 text-gray-600 border-gray-200'; // self_submitted
  }
}

// Roles that take an 'org' scope (vs an individual 'user' scope)
export const ORG_SCOPE_ROLES = new Set(['marina', 'startup', 'sponsor']);
// Roles with a dedicated module table (others store extra fields in module_data)
export const MODULE_TABLE_ROLES = new Set(['startup', 'marina', 'architect_pro', 'architect_student']);

interface RoleRow {
  id: string; role: string; status: string; scope: string; module_data?: Record<string, unknown> | null;
  // Joined for the list avatar (company logo / project image).
  startup?: { logo_url: string | null }[] | { logo_url: string | null } | null;
  architecture?: { logo_url: string | null; company_image_url: string | null }[] | { logo_url: string | null; company_image_url: string | null } | null;
}
interface RegRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  company_name: string | null;
  country: string | null;
  status: string;
  created_at: string;
  user_id: string | null;
  organization_id: string | null;
  num_attendees: number | null;
  attendees_confirmed_at: string | null;
  roles: RoleRow[];
}

// ── List-avatar resolution ──────────────────────────────────────────────────
// Priority: the company logo they gave us (startup / architecture / module_data
// logo) → their profile photo → first-letter initial (rendered by the caller).
const AV_IMG = /\.(png|jpe?g|gif|webp|svg|avif)(\?|$)/i;
const oneOf = <T,>(x: T[] | T | null | undefined): T | undefined => (Array.isArray(x) ? x[0] : x ?? undefined);

// module_data may store an image as a plain path, a real JSON array, or an
// array serialised to a string ("[\"imported/…\"]") — normalise to one path.
function mdPath(md: Record<string, unknown> | null | undefined, key: string): string | null {
  const raw = md?.[key];
  if (!raw) return null;
  if (Array.isArray(raw)) return typeof raw[0] === 'string' ? raw[0] : null;
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (s.startsWith('[')) { try { const a = JSON.parse(s); return Array.isArray(a) && typeof a[0] === 'string' ? a[0] : null; } catch { return null; } }
    return s || null;
  }
  return null;
}
// Keep only values that are actually images (http URL or image-extension path).
const imgish = (v: string | null | undefined): v is string => !!v && (/^https?:\/\//.test(v) || AV_IMG.test(v));
function pickAvatarPath(r: RegRow): string | null {
  const logos: (string | null | undefined)[] = [];
  const photos: (string | null | undefined)[] = [];
  for (const role of r.roles || []) {
    logos.push(oneOf(role.startup)?.logo_url);
    logos.push(oneOf(role.architecture)?.logo_url);
    logos.push(mdPath(role.module_data, 'logo_url'));
    photos.push(mdPath(role.module_data, 'photo_url'));
    photos.push(oneOf(role.architecture)?.company_image_url);
  }
  return [...logos, ...photos].find(imgish) || null;
}

// ── Tracking dimensions ────────────────────────────────────────────────────
// Four things the team follows up on outside the registration status itself.
// Every participant sits in exactly one bucket per dimension (absent data is
// its own bucket, never a silent gap), so each row of the overview adds up to
// the same total and any bucket can be clicked as a filter.
type PayState = 'paid' | 'waived' | 'invoiced' | 'unpaid' | 'none';
type AcctState = 'active' | 'pw_pending' | 'never_signed_in' | 'none';
type MkState = 'sent' | 'ready' | 'none';
type EcatState = 'approved' | 'uploaded' | 'changes_requested' | 'awaiting_export' | 'none';

type Bucket = { key: string; label: string; cls: string; hint: string };
const GREEN = 'bg-green-50 text-green-700 border-green-200';
const AMBER = 'bg-amber-50 text-amber-700 border-amber-200';
const SKY = 'bg-sky-50 text-sky-700 border-sky-200';
const RED = 'bg-red-50 text-red-700 border-red-200';
const GREY = 'bg-gray-50 text-gray-500 border-gray-200';

const PAY_BUCKETS: Bucket[] = [
  { key: 'paid', label: 'Paid', cls: GREEN, hint: 'Fee received' },
  { key: 'waived', label: 'Waived', cls: SKY, hint: 'No fee due for this participant' },
  { key: 'invoiced', label: 'Invoiced', cls: AMBER, hint: 'Invoice raised, payment still outstanding' },
  { key: 'unpaid', label: 'Unpaid', cls: RED, hint: 'Explicitly marked unpaid' },
  { key: 'none', label: 'Nothing recorded', cls: GREY, hint: 'No fee line at all — neither invoiced nor waived' },
];
const ACCT_BUCKETS: Bucket[] = [
  { key: 'active', label: 'Active', cls: GREEN, hint: 'Has signed in at least once' },
  { key: 'pw_pending', label: 'Password pending', cls: AMBER, hint: 'Account created, the person has not set their password yet' },
  { key: 'never_signed_in', label: 'Never signed in', cls: SKY, hint: 'Password set but never logged in' },
  { key: 'none', label: 'No account', cls: GREY, hint: 'No platform account has been created' },
];
const MK_BUCKETS: Bucket[] = [
  { key: 'sent', label: 'Sent', cls: GREEN, hint: 'Visuals uploaded and the participant has been emailed' },
  { key: 'ready', label: 'To send', cls: AMBER, hint: 'Visuals uploaded but nobody has been notified yet' },
  { key: 'none', label: 'No kit', cls: GREY, hint: 'No visuals uploaded' },
];
const ECAT_BUCKETS: Bucket[] = [
  { key: 'approved', label: 'Approved', cls: GREEN, hint: 'Page signed off' },
  { key: 'uploaded', label: 'Awaiting approval', cls: AMBER, hint: 'Designed page uploaded, waiting for sign-off' },
  { key: 'changes_requested', label: 'Changes requested', cls: RED, hint: 'Sent back for corrections' },
  { key: 'awaiting_export', label: 'To export', cls: SKY, hint: 'Not exported to the designer yet' },
  { key: 'none', label: 'No page', cls: GREY, hint: 'No e-catalogue page for this participant' },
];
const DIMENSIONS = [
  { key: 'pay', title: 'Payment', buckets: PAY_BUCKETS },
  { key: 'acct', title: 'Account', buckets: ACCT_BUCKETS },
  { key: 'mk', title: 'Media kit', buckets: MK_BUCKETS },
  { key: 'ecat', title: 'E-catalogue', buckets: ECAT_BUCKETS },
] as const;

// A participant can hold several e-catalogue pages (one per role). Surface the
// one that still needs work rather than the best one, so nothing hides behind
// an already-approved sibling page.
const ECAT_PRIORITY: EcatState[] = ['changes_requested', 'awaiting_export', 'uploaded', 'approved'];

export function AdminSM26() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<RegRow[]>([]);
  const [avatarUrls, setAvatarUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  // "Ready to invoice": the company has confirmed its final attendee list
  // (headcount locked) but payment isn't settled yet — the point at which the
  // invoice can be raised for the right amount.
  const [readyToInvoiceOnly, setReadyToInvoiceOnly] = useState(false);
  const [archProgress, setArchProgress] = useState<Map<string, { panels: number; notice: boolean }>>(new Map());
  // One map per tracking dimension, each keyed by registration id. A missing
  // key means the 'none' bucket.
  const [payStatus, setPayStatus] = useState<Map<string, PayState>>(new Map());
  const [acctState, setAcctState] = useState<Map<string, AcctState>>(new Map());
  const [mediaKit, setMediaKit] = useState<Map<string, MkState>>(new Map());
  const [ecat, setEcat] = useState<Map<string, EcatState>>(new Map());
  const [payFilter, setPayFilter] = useState('');
  const [acctFilter, setAcctFilter] = useState('');
  const [mkFilter, setMkFilter] = useState('');
  const [ecatFilter, setEcatFilter] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addBusy, setAddBusy] = useState(false);
  const [addForm, setAddForm] = useState({
    first: '', last: '', email: '', company: '', country: '',
    roles: [] as string[], juryScope: 'innovation', onsite: 'unknown',
    waive: false, status: 'confirmed',
  });

  useEffect(() => { load(); }, []);

  // Resolve one avatar image per registration (company logo → profile photo).
  // http values pass through; Storage paths are signed in a single batched call.
  useEffect(() => {
    let active = true;
    const httpByReg: Record<string, string> = {};
    const pathByReg: Record<string, string> = {};
    for (const r of rows) {
      const p = pickAvatarPath(r);
      if (!p) continue;
      if (/^https?:\/\//.test(p)) httpByReg[r.id] = p; else pathByReg[r.id] = p;
    }
    const paths = [...new Set(Object.values(pathByReg))];
    (async () => {
      const map: Record<string, string> = { ...httpByReg };
      if (paths.length) {
        const { data } = await supabase.storage.from('event-media').createSignedUrls(paths, 3600);
        const signed: Record<string, string> = {};
        for (const d of data || []) { if (d.path && d.signedUrl) signed[d.path] = d.signedUrl; }
        for (const [regId, p] of Object.entries(pathByReg)) { if (signed[p]) map[regId] = signed[p]; }
      }
      if (active) setAvatarUrls(map);
    })();
    return () => { active = false; };
  }, [rows]);

  // Register somebody on their behalf. One RPC does registration, roles,
  // attendee, badge and waiver together, because doing them separately is how
  // you end up with a confirmed participant nobody can scan at the door.
  const createRegistration = async () => {
    setAddBusy(true);
    try {
      const { data, error } = await supabase.rpc('sm_admin_create_registration', {
        p_first_name: addForm.first,
        p_last_name: addForm.last,
        p_email: addForm.email,
        p_company: addForm.company || null,
        p_country: addForm.country || null,
        p_roles: addForm.roles,
        p_jury_scope: addForm.roles.includes('jury') ? addForm.juryScope : null,
        p_onsite: addForm.roles.includes('jury') && addForm.onsite !== 'unknown' ? addForm.onsite === 'yes' : null,
        p_waive_fee: addForm.waive,
        p_status: addForm.status,
      });
      if (error) throw error;
      const res = data as { registration_id?: string; linked_user?: boolean; linked_organization?: string | null; notes?: string[] };
      toast({
        title: `${[addForm.first, addForm.last].filter(Boolean).join(' ') || addForm.email} registered`,
        description: [
          res?.linked_organization ? `Linked to ${res.linked_organization}.` : '',
          res?.linked_user ? 'Attached to their existing account.' : '',
          ...(res?.notes || []),
        ].filter(Boolean).join(' '),
      });
      setAddForm({ first: '', last: '', email: '', company: '', country: '', roles: [], juryScope: 'innovation', onsite: 'unknown', waive: false, status: 'confirmed' });
      setAddOpen(false);
      await load();
      if (res?.registration_id) navigate(`/admin/sm26/${res.registration_id}`);
    } catch (err: unknown) {
      toast({ title: 'Could not register', description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
    }
    setAddBusy(false);
  };

  const load = async () => {
    setLoading(true);
    const { data: ev } = await supabase.from('sm_event').select('id').eq('slug', 'sm26').maybeSingle();
    if (!ev) { setRows([]); setLoading(false); return; }
    const evId = (ev as { id: string }).id;
    const [regsRes, paysRes, filesRes, mkRes, mkFilesRes, acctRes, ecatRes] = await Promise.all([
      supabase
        .from('sm_registration')
        .select('id,first_name,last_name,email,company_name,country,status,created_at,user_id,organization_id,num_attendees,attendees_confirmed_at, roles:sm_role_assignment(id,role,status,scope,module_data, startup:sm_startup_profile(logo_url), architecture:sm_architecture_entry(logo_url,company_image_url))')
        .eq('event_id', (ev as { id: string }).id)
        .order('created_at', { ascending: false }),
      supabase.from('sm_payment').select('registration_id,status'),
      supabase.from('sm_architecture_file').select('role_assignment_id,kind'),
      supabase.from('sm_media_kit').select('registration_id,notified_at'),
      supabase.from('sm_media_kit_file').select('registration_id'),
      // pw_pending lives in auth.users metadata, which PostgREST cannot read —
      // this staff-only RPC is the only way to tell an invited-but-dormant
      // account from a working one.
      supabase.rpc('sm_account_state_map', { p_event_id: evId }),
      supabase.from('sm_ecat_page').select('registration_id,status'),
    ]);
    setRows((regsRes.data || []) as RegRow[]);
    const pay = new Map<string, PayState>();
    for (const p of (paysRes.data || []) as { registration_id: string; status: string }[]) {
      pay.set(p.registration_id, p.status as PayState);
    }
    setPayStatus(pay);
    const acct = new Map<string, AcctState>();
    for (const a of (acctRes.data || []) as { registration_id: string; state: string }[]) {
      if (a.state !== 'none') acct.set(a.registration_id, a.state as AcctState);
    }
    setAcctState(acct);
    const ec = new Map<string, EcatState>();
    for (const p of (ecatRes.data || []) as { registration_id: string | null; status: string }[]) {
      if (!p.registration_id) continue;
      const cur = ec.get(p.registration_id);
      const next = p.status as EcatState;
      if (!cur || ECAT_PRIORITY.indexOf(next) < ECAT_PRIORITY.indexOf(cur)) ec.set(p.registration_id, next);
    }
    setEcat(ec);
    const ap = new Map<string, { panels: number; notice: boolean }>();
    for (const f of (filesRes.data || []) as { role_assignment_id: string; kind: string }[]) {
      const cur = ap.get(f.role_assignment_id) || { panels: 0, notice: false };
      if (f.kind === 'panel') cur.panels++;
      if (f.kind === 'notice') cur.notice = true;
      ap.set(f.role_assignment_id, cur);
    }
    setArchProgress(ap);
    // Media-kit status: has files -> 'ready', has files + notified -> 'sent'.
    const notified = new Set<string>();
    for (const k of (mkRes.data || []) as { registration_id: string; notified_at: string | null }[]) if (k.notified_at) notified.add(k.registration_id);
    const mk = new Map<string, MkState>();
    for (const f of (mkFilesRes.data || []) as { registration_id: string }[]) mk.set(f.registration_id, notified.has(f.registration_id) ? 'sent' : 'ready');
    setMediaKit(mk);
    setLoading(false);
  };

  const paidSet = useMemo(() => {
    const s = new Set<string>();
    for (const [id, st] of payStatus) if (st === 'paid' || st === 'waived') s.add(id);
    return s;
  }, [payStatus]);

  // Which bucket a registration falls in, per dimension. Kept in one place so
  // the overview counts and the list filter can never drift apart.
  const bucketOf = (r: RegRow, dim: string): string =>
    dim === 'pay' ? (payStatus.get(r.id) || 'none')
      : dim === 'acct' ? (acctState.get(r.id) || 'none')
        : dim === 'mk' ? (mediaKit.get(r.id) || 'none')
          : (ecat.get(r.id) || 'none');
  const dimFilter: Record<string, string> = { pay: payFilter, acct: acctFilter, mk: mkFilter, ecat: ecatFilter };
  const dimSetter: Record<string, (v: string) => void> = { pay: setPayFilter, acct: setAcctFilter, mk: setMkFilter, ecat: setEcatFilter };

  // Two stages: `scoped` applies who-you're-looking-at (search / role / status),
  // `filtered` then applies the tracking dimensions. The overview counts run off
  // `scoped`, so picking "Confirmed" re-breaks-down payment for confirmed people
  // instead of zeroing every other bucket.
  const scoped = rows.filter(r => {
    if (search) {
      const hay = `${r.first_name || ''} ${r.last_name || ''} ${r.email || ''} ${r.company_name || ''}`.toLowerCase();
      if (!hay.includes(search.toLowerCase())) return false;
    }
    if (roleFilter !== 'all' && !r.roles.some(x => x.role === roleFilter)) return false;
    if (statusFilter !== 'all' && r.status !== statusFilter) return false;
    return true;
  });
  const filtered = scoped.filter(r => {
    for (const d of DIMENSIONS) if (dimFilter[d.key] && bucketOf(r, d.key) !== dimFilter[d.key]) return false;
    if (readyToInvoiceOnly && !(r.attendees_confirmed_at && !paidSet.has(r.id))) return false;
    return true;
  });

  const readyToInvoiceCount = scoped.filter(r => r.attendees_confirmed_at && !paidSet.has(r.id)).length;
  const anyTrackingFilter = readyToInvoiceOnly || DIMENSIONS.some(d => dimFilter[d.key]);
  const clearTracking = () => {
    setPayFilter(''); setAcctFilter(''); setMkFilter(''); setEcatFilter(''); setReadyToInvoiceOnly(false);
  };

  // Summary counts by registration status
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.status] = (counts[r.status] || 0) + 1;

  // ── Backfill: confirmed registrations that still have no platform account ──
  const [provBusy, setProvBusy] = useState<string | null>(null);
  // An account needs an address to be created and a welcome link to be sent to.
  // Invited officials are written to at an embassy and often have none, so they
  // are confirmed, account-less and unprovisionable — and would otherwise sit in
  // this backfill for ever while "Provision & invite all" failed on each of them.
  const pendingProvision = rows.filter(r => r.status === 'confirmed' && !r.user_id && !!r.email);
  const noEmailGuests = rows.filter(r => r.status === 'confirmed' && !r.user_id && !r.email).length;

  const provisionOne = async (r: RegRow): Promise<{ ok: boolean; skippedActive: boolean }> => {
    const who = `${r.first_name || ''} ${r.last_name || ''}`.trim() || r.email;
    // If this email already has an ACTIVE account, just LINK the registration to
    // it — no new account, no email, and (unlike provisioning) no persona/org
    // overwrite that could demote an existing marina/partner/investor.
    if (r.email) {
      const { data: status } = await supabase.rpc('sm_account_status_for_email', { p_email: r.email });
      if (status === 'active') {
        const { data: uid, error } = await supabase.rpc('sm_link_registration_to_account', { p_registration_id: r.id });
        if (error || !uid) { toast({ title: `Could not link: ${who}`, description: error?.message, variant: 'destructive' }); return { ok: false, skippedActive: true }; }
        return { ok: true, skippedActive: true };
      }
    }
    const s = suggestProvision(r);
    // Avoid creating a DUPLICATE organization when one already exists by the same
    // name — link the existing one instead of spinning up a second.
    let org: 'create' | 'link' | 'none' = s.orgMode;
    let orgId: string | undefined;
    if (org === 'create' && s.orgName) {
      // Exact normalised-name match only. The previous ilike() passed the raw
      // company name as a pattern, so "100% Marine" or "A_B" matched unrelated
      // rows, and limit(1) then picked one of them non-deterministically.
      const { exact } = await findOrgByName(s.orgName);
      if (exact) { org = 'link'; orgId = exact.id; }
    }
    const res = await runProvision({
      registration_id: r.id, persona: s.persona, org,
      org_name: org === 'create' ? s.orgName : undefined,
      org_id: org === 'link' ? orgId : undefined,
      send_email: true,
    });
    if (!res.ok) toast({ title: `Failed: ${who}`, description: res.error, variant: 'destructive' });
    return { ok: res.ok, skippedActive: false };
  };
  const provisionRow = async (r: RegRow) => {
    setProvBusy(r.id);
    const { ok, skippedActive } = await provisionOne(r);
    setProvBusy(null);
    if (ok) { toast({ title: skippedActive ? 'Linked to existing active account (no email sent)' : 'Account provisioned & invite sent', description: r.email || undefined }); load(); }
  };
  const provisionAll = async () => {
    if (!window.confirm(`Provision platform accounts and send welcome invites to all ${pendingProvision.length} confirmed registrants without an account? Anyone who already has an active account is linked without an email.`)) return;
    setProvBusy('__all__');
    let okCount = 0, linkedActive = 0;
    for (const r of pendingProvision) { const res = await provisionOne(r); if (res.ok) { okCount++; if (res.skippedActive) linkedActive++; } }
    setProvBusy(null);
    toast({ title: `${okCount}/${pendingProvision.length} accounts provisioned`, description: linkedActive ? `${linkedActive} already had an active account (linked, no email).` : undefined });
    load();
  };

  // ── Bulk selection ──
  const toggleSel = (id: string) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const clearSel = () => setSelected(new Set());
  const allVisibleSelected = filtered.length > 0 && filtered.every(r => selected.has(r.id));
  const toggleAllVisible = () => setSelected(prev => {
    if (filtered.every(r => prev.has(r.id))) { const n = new Set(prev); filtered.forEach(r => n.delete(r.id)); return n; }
    const n = new Set(prev); filtered.forEach(r => n.add(r.id)); return n;
  });

  const bulkStatus = async (status: string) => {
    if (selected.size === 0) return;
    if (!window.confirm(`Set ${selected.size} selected registration${selected.size > 1 ? 's' : ''} to "${prettyStatus(status)}"?`)) return;
    setBulkBusy(true);
    const ids = [...selected];
    const { error } = await supabase.from('sm_registration').update({ status }).in('id', ids);
    setBulkBusy(false);
    if (error) { toast({ title: 'Bulk update failed', description: error.message, variant: 'destructive' }); return; }
    // Fire the same transactional email the single-row status change sends, so a
    // bulk Confirm/Decline isn't a silent transition.
    if (status === 'confirmed' || status === 'declined') {
      for (const id of ids) void supabase.functions.invoke('sm26-email', { body: { registration_id: id, kind: status } }).catch(() => {});
    }
    toast({ title: `${ids.length} registration${ids.length > 1 ? 's' : ''} set to ${prettyStatus(status)}` });
    clearSel();
    load();
  };

  const bulkAskDetails = async () => {
    const targets = rows.filter(r => selected.has(r.id) && r.user_id);
    if (targets.length === 0) { toast({ title: 'None of the selected have an account to notify' }); return; }
    setBulkBusy(true);
    const notes = targets.map(r => ({
      user_id: r.user_id, type: 'sm26_info_required',
      title: 'Please complete your SM26 details',
      body: 'M3 asks you to review and complete your registration details for the Smart & Sustainable Marina Rendezvous 2026.',
      link: '/sm26/me',
    }));
    const { error } = await supabase.from('sm_notification').insert(notes);
    setBulkBusy(false);
    if (error) { toast({ title: 'Could not notify', description: error.message, variant: 'destructive' }); return; }
    toast({ title: `Asked ${targets.length} participant${targets.length > 1 ? 's' : ''} to complete their details` });
    clearSel();
  };

  // Follow-up emails, sent to a selection. Each kind carries its own test for
  // who it actually applies to, and only those people are mailed however wide
  // the selection is: a payment reminder to someone who has paid, or a
  // "set your password" to someone who already has one, costs more goodwill
  // than it saves effort. The count is shown before anything leaves.
  const CHASE: { key: string; label: string; who: string; eligible: (r: RegRow) => boolean }[] = [
    { key: 'welcome', label: 'Set-password link', who: 'account created but no password chosen yet',
      eligible: r => acctState.get(r.id) === 'pw_pending' },
    { key: 'payment_reminder', label: 'Payment reminder', who: 'fee not settled',
      eligible: r => { const p = payStatus.get(r.id); return p !== 'paid' && p !== 'waived'; } },
    { key: 'invoice_available', label: 'Invoice available', who: 'an invoice has been raised',
      eligible: r => payStatus.get(r.id) === 'invoiced' },
    { key: 'attendees_requested', label: 'Confirm attendees', who: 'attendee list not confirmed',
      eligible: r => !r.attendees_confirmed_at },
    { key: 'ecat_review', label: 'Review e-catalogue page', who: 'a page is waiting for their approval',
      eligible: r => ecat.get(r.id) === 'uploaded' },
    { key: 'info_requested', label: 'Complete your details', who: 'everyone selected',
      eligible: () => true },
  ];

  const bulkEmail = async (key: string) => {
    const def = CHASE.find(c => c.key === key);
    if (!def) return;
    const targets = rows.filter(r => selected.has(r.id) && def.eligible(r));
    if (targets.length === 0) {
      toast({ title: `Nobody selected fits "${def.label}"`, description: `It only goes to those where ${def.who}.` });
      return;
    }
    if (!window.confirm(
      `Send "${def.label}" to ${targets.length} of the ${selected.size} selected?\n\n` +
      `Only those where ${def.who} are emailed.`)) return;
    setBulkBusy(true);
    let sent = 0; let failed = 0;
    for (const r of targets) {
      const res = key === 'welcome'
        ? await supabase.functions.invoke('sm26-provision', { body: { registration_id: r.id, welcome_only: true } })
        : await supabase.functions.invoke('sm26-email', { body: { registration_id: r.id, kind: key } });
      const ok = !res.error && (key !== 'welcome' || (res.data as { emailed?: boolean } | null)?.emailed === true);
      if (ok) sent++; else failed++;
    }
    setBulkBusy(false);
    toast({
      title: `${def.label} sent to ${sent}`,
      description: failed ? `${failed} could not be sent.` : undefined,
      variant: failed && !sent ? 'destructive' : undefined,
    });
    clearSel();
    load();
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <RefreshCw className="h-8 w-8 animate-spin text-gray-400" />
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Ship className="h-6 w-6 text-primary" /> SM26 Registrations ({rows.length})
        </h1>
        <div className="flex items-center gap-2">
          <Button className="gap-1.5" onClick={() => setAddOpen(o => !o)}>
            <UserPlus className="h-4 w-4" /> {addOpen ? 'Close' : 'Register someone'}
          </Button>
          <Button variant="outline" className="gap-1.5" onClick={() => navigate('/admin/sm26/checkin')}>
            <QrCode className="h-4 w-4" /> Check-in
          </Button>
          <Button variant="outline" className="gap-1.5" onClick={() => navigate('/admin/sm26/agenda')}>
            <CalendarDays className="h-4 w-4" /> Agenda
          </Button>
          <Button variant="outline" className="gap-1.5" onClick={() => navigate('/admin/sm26/ecat')}>
            <BookOpen className="h-4 w-4" /> E-catalogue
          </Button>
          <Button variant="outline" className="gap-1.5" onClick={() => navigate('/admin/sm26/evaluation')}>
            <Scale className="h-4 w-4" /> Evaluation &amp; Awards
          </Button>
          <Button variant="outline" className="gap-1.5" onClick={() => navigate('/admin/sm26/feedback')}>
            <MessageSquare className="h-4 w-4" /> Feedback
          </Button>
        </div>
      </div>

      {/* Register someone ourselves. Until now nobody at M3 could: row-level
          security lets a person create their own registration and nothing else,
          so every invited juror, sponsor or VIP had to be inserted by hand. The
          RPC does the whole thing — registration, roles, attendee, badge, and
          the fee waiver — and sends nothing. */}
      {addOpen && (
        <Card className="border-0 shadow-sm ring-1 ring-primary/20">
          <CardContent className="p-4 space-y-3">
            <div className="text-sm font-semibold text-gray-800">Register someone</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <Input placeholder="First name" value={addForm.first} onChange={e => setAddForm({ ...addForm, first: e.target.value })} />
              <Input placeholder="Last name" value={addForm.last} onChange={e => setAddForm({ ...addForm, last: e.target.value })} />
              <Input placeholder="Email *" type="email" value={addForm.email} onChange={e => setAddForm({ ...addForm, email: e.target.value })} />
              <Input placeholder="Company" value={addForm.company} onChange={e => setAddForm({ ...addForm, company: e.target.value })} />
              <Input placeholder="Country" value={addForm.country} onChange={e => setAddForm({ ...addForm, country: e.target.value })} />
              <Select value={addForm.status} onValueChange={v => setAddForm({ ...addForm, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {REG_STATUSES.map(s => <SelectItem key={s} value={s}>{prettyStatus(s)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div>
              <div className="text-xs text-gray-500 mb-1.5">Roles</div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(SM26_ROLE_LABELS).map(([k, v]) => {
                  const on = addForm.roles.includes(k);
                  return (
                    <button key={k} type="button"
                      onClick={() => setAddForm({ ...addForm, roles: on ? addForm.roles.filter(r => r !== k) : [...addForm.roles, k] })}
                      className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${on ? 'bg-primary text-white border-primary' : 'border-gray-200 text-gray-600 hover:border-primary/40'}`}>
                      {v}
                    </button>
                  );
                })}
              </div>
            </div>

            {addForm.roles.includes('jury') && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg bg-gray-50 p-2">
                <span className="text-xs text-gray-500">Judges</span>
                <Select value={addForm.juryScope} onValueChange={v => setAddForm({ ...addForm, juryScope: v })}>
                  <SelectTrigger className="h-8 w-44"><SelectValue placeholder="Which competition" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="innovation">Innovation</SelectItem>
                    <SelectItem value="architecture">Architecture</SelectItem>
                    <SelectItem value="both">Both</SelectItem>
                  </SelectContent>
                </Select>
                <span className="text-xs text-gray-500 ml-2">On site</span>
                <Select value={addForm.onsite} onValueChange={v => setAddForm({ ...addForm, onsite: v })}>
                  <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="yes">Yes — attends</SelectItem>
                    <SelectItem value="no">No — remote</SelectItem>
                    <SelectItem value="unknown">Not known yet</SelectItem>
                  </SelectContent>
                </Select>
                {addForm.onsite === 'unknown' && (
                  <span className="text-[11px] text-amber-700">The door refuses a juror until this is answered.</span>
                )}
              </div>
            )}

            <label className="flex items-center gap-2 text-sm text-gray-700">
              <Checkbox checked={addForm.waive} onCheckedChange={c => setAddForm({ ...addForm, waive: !!c })} />
              Waive the fee {addForm.roles.includes('jury') && <span className="text-xs text-gray-400">(jury attend free of charge)</span>}
            </label>

            <div className="flex items-center gap-2">
              <Button disabled={!addForm.email.trim() || !addForm.roles.length || addBusy} onClick={createRegistration}>
                {addBusy ? 'Registering…' : 'Register'}
              </Button>
              <span className="text-xs text-gray-400">No email is sent. Send their entry pass separately when you are ready.</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Status summary chips */}
      <div className="flex items-center gap-2 flex-wrap">
        {REG_STATUSES.filter(s => counts[s]).map(s => (
          <button
            key={s}
            onClick={() => setStatusFilter(statusFilter === s ? 'all' : s)}
            className={`text-xs px-2.5 py-1 rounded-full border transition-all ${regStatusBadgeClass(s)} ${statusFilter === s ? 'ring-2 ring-primary/30' : ''}`}
          >
            {prettyStatus(s)} · {counts[s]}
          </button>
        ))}
        {readyToInvoiceCount > 0 && (
          <button
            onClick={() => setReadyToInvoiceOnly(v => !v)}
            title="Attendee list confirmed, payment not settled — ready to invoice"
            className={`text-xs px-2.5 py-1 rounded-full border transition-all bg-emerald-50 text-emerald-700 border-emerald-200 ${readyToInvoiceOnly ? 'ring-2 ring-primary/30' : ''}`}
          >
            Ready to invoice · {readyToInvoiceCount}
          </button>
        )}
      </div>

      {/* Follow-up overview — one row per dimension, every bucket a filter.
          Each row totals the same {scoped.length} people, so a glance shows
          where everyone stands without opening a single registration. */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-3 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-gray-500">
              Follow-up · {scoped.length} registration{scoped.length === 1 ? '' : 's'}
              {statusFilter !== 'all' || roleFilter !== 'all' || search ? ' in view' : ''}
            </span>
            {anyTrackingFilter && (
              <button onClick={clearTracking} className="text-xs text-gray-400 hover:text-primary flex items-center gap-1">
                <X className="h-3 w-3" /> Clear
              </button>
            )}
          </div>
          {DIMENSIONS.map(d => {
            const n: Record<string, number> = {};
            for (const r of scoped) { const b = bucketOf(r, d.key); n[b] = (n[b] || 0) + 1; }
            return (
              <div key={d.key} className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[11px] uppercase tracking-wide text-gray-400 w-24 shrink-0">{d.title}</span>
                {d.buckets.map(b => n[b.key] ? (
                  <button
                    key={b.key}
                    title={b.hint}
                    onClick={() => dimSetter[d.key](dimFilter[d.key] === b.key ? '' : b.key)}
                    className={`text-xs px-2.5 py-1 rounded-full border transition-all ${b.cls} ${dimFilter[d.key] === b.key ? 'ring-2 ring-primary/30' : ''}`}
                  >
                    {b.label} · {n[b.key]}
                  </button>
                ) : null)}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Confirmed-but-not-onboarded backfill — provision + welcome invite, admin-triggered */}
      {/* Also shown when the only account-less people are email-less guests —
          otherwise the card is hidden in exactly the state that needs saying,
          and nothing anywhere mentions them. */}
      {(pendingProvision.length > 0 || noEmailGuests > 0) && (
        <Card className="border-0 shadow-sm border-l-4 border-l-amber-400">
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                  <UserPlus className="h-4 w-4 text-amber-500" />
                  {pendingProvision.length > 0
                    ? `${pendingProvision.length} confirmed without a platform account`
                    : `${noEmailGuests} confirmed ${noEmailGuests > 1 ? 'people' : 'person'} with no email address`}
                </div>
                <p className="text-xs text-gray-500 mt-0.5">
                  {pendingProvision.length > 0 && (
                    <>Provisioning creates their verified account (+ company at member tier, suggested from their roles) and emails the
                    welcome link — set password → event hub. Open a registration first to adjust persona/company if needed. </>
                  )}
                  {noEmailGuests > 0 && (
                    <>{pendingProvision.length > 0 ? `${noEmailGuests} more ` : 'They are '}
                    {noEmailGuests > 1 ? 'people are' : 'person is'} confirmed with no email address — invited guests,
                    usually. An account needs an address to be sent to, so they cannot be provisioned and are not
                    listed here. They are on the door list and in the badge print run all the same.</>
                  )}
                </p>
              </div>
              {pendingProvision.length > 0 && (
                <Button size="sm" className="gap-1.5 shrink-0" disabled={provBusy !== null} onClick={provisionAll}>
                  {provBusy === '__all__' ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />} Provision &amp; invite all
                </Button>
              )}
            </div>
            <div className="divide-y divide-gray-100">
              {pendingProvision.map(r => {
                const s = suggestProvision(r);
                return (
                  <div key={r.id} className="flex items-center gap-3 py-1.5 text-sm">
                    <button type="button" className="font-medium text-gray-800 hover:text-primary truncate" onClick={() => navigate(`/admin/sm26/${r.id}`)}>
                      {`${r.first_name || ''} ${r.last_name || ''}`.trim() || r.email}
                    </button>
                    {r.company_name && <span className="text-xs text-gray-400 truncate">{r.company_name}</span>}
                    <Badge variant="secondary" className="text-[10px] shrink-0">
                      {s.persona.replace('_', ' ')}{s.orgMode === 'create' ? ' + new org' : ''}
                    </Badge>
                    <Button size="sm" variant="outline" className="h-7 text-xs ml-auto shrink-0 gap-1" disabled={provBusy !== null} onClick={() => provisionRow(r)}>
                      {provBusy === r.id ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />} Provision &amp; invite
                    </Button>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, email, company..." className="pl-9 h-9" />
        </div>
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="w-44 h-9"><SelectValue placeholder="All roles" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All roles</SelectItem>
            {Object.entries(SM26_ROLE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40 h-9"><SelectValue placeholder="All status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All status</SelectItem>
            {REG_STATUSES.map(s => <SelectItem key={s} value={s}>{prettyStatus(s)}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 ? (
        <div className="flex items-center gap-2 flex-wrap rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
          <span className="text-sm font-medium text-gray-700">{selected.size} selected</span>
          <Button size="sm" className="h-8 gap-1.5" disabled={bulkBusy} onClick={() => bulkStatus('confirmed')}><Check className="h-3.5 w-3.5" /> Confirm</Button>
          <Select value="" onValueChange={v => bulkStatus(v)} disabled={bulkBusy}>
            <SelectTrigger className="w-40 h-8 text-xs"><SelectValue placeholder="Set status…" /></SelectTrigger>
            <SelectContent>{REG_STATUSES.map(s => <SelectItem key={s} value={s}>{prettyStatus(s)}</SelectItem>)}</SelectContent>
          </Select>
          <Button size="sm" variant="outline" className="h-8 gap-1.5" disabled={bulkBusy} onClick={bulkAskDetails}><BellRing className="h-3.5 w-3.5" /> Ask to complete details</Button>
          {/* Each option shows how many of the selection it would actually reach,
              so the effect is known before it is sent. */}
          <Select value="" onValueChange={v => bulkEmail(v)} disabled={bulkBusy}>
            <SelectTrigger className="w-52 h-8 text-xs"><SelectValue placeholder="Send a follow-up email…" /></SelectTrigger>
            <SelectContent>
              {CHASE.map(c => {
                const n = rows.filter(r => selected.has(r.id) && c.eligible(r)).length;
                return (
                  <SelectItem key={c.key} value={c.key} disabled={n === 0}>
                    {c.label} · {n}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          <Button size="sm" variant="ghost" className="h-8 gap-1.5 text-gray-500 ml-auto" onClick={clearSel}><X className="h-3.5 w-3.5" /> Clear</Button>
        </div>
      ) : filtered.length > 0 && (
        <label className="flex items-center gap-2 text-xs text-gray-500 px-1 cursor-pointer w-fit">
          <Checkbox checked={allVisibleSelected} onCheckedChange={toggleAllVisible} /> Select all {filtered.length} shown
        </label>
      )}

      <div className="space-y-2">
        {filtered.length === 0 ? (
          <Card className="border-0 shadow-sm">
            <CardContent className="py-12 text-center text-gray-400">No registrations match your filters</CardContent>
          </Card>
        ) : (
          filtered.map(r => {
            const name = `${r.first_name || ''} ${r.last_name || ''}`.trim() || '(no name)';
            return (
              <Card key={r.id}
                className="border-0 shadow-sm hover:shadow-md transition-all cursor-pointer group"
                onClick={() => navigate(`/admin/sm26/${r.id}`)}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-4">
                    <div onClick={e => e.stopPropagation()} className="shrink-0 flex items-center">
                      <Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggleSel(r.id)} aria-label="Select registration" />
                    </div>
                    {avatarUrls[r.id] ? (
                      <img src={avatarUrls[r.id]} alt=""
                        className="h-11 w-11 rounded-xl object-cover border border-gray-100 bg-white shrink-0"
                        onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                    ) : (
                      <div className="h-11 w-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0 font-semibold uppercase">
                        {(r.first_name?.[0] || r.email?.[0] || '?')}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                        <span className="text-base font-semibold text-gray-900 truncate group-hover:text-primary transition-colors">{r.company_name || name}</span>
                        <Badge className={`shrink-0 text-[10px] ${regStatusBadgeClass(r.status)}`}>{prettyStatus(r.status)}</Badge>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-gray-500 flex-wrap">
                        {r.company_name && <span className="flex items-center gap-1"><User className="h-3 w-3" /> {name}</span>}
                        {r.email && <span className="flex items-center gap-1"><Mail className="h-3 w-3" /> {r.email}</span>}
                        {/* Shown whatever the number, including when nobody
                            said. Hiding it below 2 meant "coming alone" and
                            "never told us" looked identical — and 10 of these
                            registrations have never stated a headcount. */}
                        <span className={`flex items-center gap-1 ${(r.num_attendees || 0) > 1 ? 'text-primary font-medium' : r.num_attendees == null ? 'text-amber-600' : ''}`}>
                          <Users className="h-3 w-3" />
                          {r.num_attendees == null ? 'headcount not stated' : `${r.num_attendees} ${r.num_attendees === 1 ? 'person' : 'people'}`}
                        </span>
                        <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {new Date(r.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                      </div>
                      {r.roles.length > 0 && (
                        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                          {r.roles.map((role, i) => (
                            <Badge key={i} variant="secondary" className="text-[10px]">
                              {SM26_ROLE_LABELS[role.role] || role.role}
                            </Badge>
                          ))}
                        </div>
                      )}
                      {/* Progress chips — what's actually DONE, independent of the status badge */}
                      {(() => {
                        const info = r.roles.some(x => x.status === 'needs_info')
                          ? { t: 'Info requested', c: 'amber' }
                          : r.roles.some(x => x.status === 'info_provided')
                            ? { t: 'Info to review', c: 'blue' }
                            : (r.roles.length > 0 && r.roles.every(x => x.status === 'confirmed'))
                              ? { t: 'Info ✓', c: 'green' }
                              : { t: 'Info: submitted', c: 'gray' };
                        const archRoles = r.roles.filter(x => x.role.startsWith('architect'));
                        let entry: { t: string; c: string } | null = null;
                        if (archRoles.length > 0) {
                          let panels = 0; let notice = false;
                          for (const a of archRoles) {
                            const x = archProgress.get(a.id);
                            if (x) { panels += x.panels; notice = notice || x.notice; }
                          }
                          entry = { t: `Panels ${panels}/8${notice ? ' + notice' : ''}`, c: panels >= 8 && notice ? 'green' : 'amber' };
                        }
                        const chips = [
                          r.user_id ? { t: 'Account ✓', c: 'green' } : { t: 'No account', c: 'amber' },
                          info,
                          ...(entry ? [entry] : []),
                          ...((r.num_attendees || 0) > 1
                            ? [r.attendees_confirmed_at ? { t: 'Attendees ✓', c: 'green' } : { t: 'Attendees pending', c: 'amber' }]
                            : []),
                          paidSet.has(r.id) ? { t: 'Paid ✓', c: 'green' } : { t: 'Not paid', c: 'gray' },
                          ...(mediaKit.get(r.id) === 'sent'
                            ? [{ t: 'Media kit ✓', c: 'green' }]
                            : mediaKit.get(r.id) === 'ready'
                              ? [{ t: 'Media kit to send', c: 'amber' }]
                              : []),
                        ];
                        const cls: Record<string, string> = {
                          green: 'bg-green-50 text-green-700 border-green-200',
                          amber: 'bg-amber-50 text-amber-700 border-amber-200',
                          blue: 'bg-blue-50 text-blue-700 border-blue-200',
                          gray: 'bg-gray-50 text-gray-500 border-gray-200',
                        };
                        return (
                          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                            {chips.map((c, i) => (
                              <span key={i} className={`text-[10px] px-1.5 py-0.5 rounded-full border ${cls[c.c]}`}>{c.t}</span>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                    <ChevronRight className="h-5 w-5 text-gray-300 group-hover:text-primary transition-colors shrink-0" />
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
