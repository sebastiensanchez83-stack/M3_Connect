import { useState, useEffect, useRef, useMemo, useCallback, type ComponentType, type ReactNode, type MutableRefObject, type Dispatch, type SetStateAction } from 'react';
import { Helmet } from 'react-helmet-async';
import {
  RefreshCw, FileText, ExternalLink, Building2, Mic, BookOpen, CalendarDays, Lock, MapPin,
  Lightbulb, Scale, Image as ImageIcon, ChevronRight, ChevronDown, Download, AlertTriangle,
  CheckCircle2, Upload, Loader2, MessageSquare, Eye, Ruler, Trash2, Bell, Search, X, Clock,
  CreditCard, Palette, Send, CheckSquare, Square, ClipboardCheck, UserCheck,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { SM26BackLink } from '@/components/sm26/SM26BackLink';
import { SM26PartnerSponsors } from '@/components/sm26/SM26PartnerSponsors';
import { ECAT_STATUS_LABEL, ecatStatusClass } from '@/components/admin/AdminSM26Ecat';
import { downloadDossierZip, downloadAsset } from '@/lib/dossierExport';
import { fetchLastEmails, lastEmailText, type LastEmail } from '@/lib/sm26EmailLog';
import {
  MediaKitRow, EMPTY_KIT, mediaKitStatusOf, type KitData, type MediaKitStatus,
} from '@/components/sm26/SM26MediaKitBoard';

// Yacht Club / event-partner console — reorganised BY SOCIÉTÉ. Each participant
// company is one row; opening it slides in a drawer holding everything the Yacht
// Club needs in one place: the catalogue dossier (info + assets to download),
// the e-catalogue page (upload / remind / status) and the media kit (upload /
// notify). A dashboard of clickable "à faire" tiles + progress funnels sits on
// top so Olivia sees what's left to do and can filter to it. Server-enforced by
// sm_partner_* (SECURITY DEFINER, gated on sm_is_event_partner / sm_is_staff).

interface Entry {
  role_assignment_id: string; reg_id: string; role: string;
  name: string | null; company: string | null; job_title: string | null; country: string | null; thumb: string | null;
  payment_status: string | null; jury_scope: string | null; catalogue_listed: boolean;
}
interface EcatRow { id: string; registration_id: string; kind: string; status: string; title: string; designed_file_path: string | null; changes_note: string | null; change_attachments: string[] | null }
interface ChangeImg { path: string; url: string | null; filename: string; is_image: boolean }
interface Session { id: string; title: string; type: string; starts_at: string | null; ends_at: string | null; room: string | null; speakers: string | null }
interface Requirement { field_key: string; label: string; required: boolean; is_asset: boolean }
interface DossierRow {
  role: string; company: string | null; name: string | null; job_title: string | null;
  website: string | null; country: string | null; email: string | null;
  module_data: Record<string, unknown> | null; startup: Record<string, unknown> | null; requirements: Requirement[] | null;
}
interface DossierRaw extends DossierRow { role_assignment_id: string; reg_id: string }

const TZ = 'Europe/Monaco';
const fmtTime = (s: string | null) => s ? new Date(s).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: TZ }) : '';
const dayKey = (s: string | null) => s ? new Date(s).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ }) : 'TBD';
const ECAT_STATUSES = ['awaiting_export', 'exported', 'in_design', 'uploaded', 'changes_requested', 'approved', 'published'];
const ECAT_DESIGN_STATES = ['awaiting_export', 'exported', 'in_design'];

const ASSET_KEYS = new Set(['logo', 'logo_url', 'photo', 'photo_url', 'banner', 'deck', 'deck_url', 'slides', 'hero_image', 'press_card', 'proof_of_enrolment', 'panels', 'notice', 'pitch_media', 'pitch_media_url', 'product_images', 'renders', 'project_renders', 'company_image_url', 'hd_images', 'building_images', 'pitch_deck', 'contact_photo']);
// Not catalogue-relevant / commercially sensitive fundraising fields are never
// shown to the Yacht Club catalogue team.
const STARTUP_SKIP = new Set(['id', 'role_assignment_id', 'event_id', 'created_at', 'updated_at', 'visibility_level', 'pitch_optin', 'social_links', 'logo_url', 'deck_url', 'product_images', 'pitch_media_url', 'investment_seeking', 'investment_stage', 'investment_type', 'funds_needed']);
const isHttp = (s: string) => /^https?:\/\//i.test(s);
const isImg = (s: string) => /\.(png|jpe?g|webp|gif|svg|avif|bmp)$/i.test(s.split('?')[0]);
const prettyKey = (k: string) => k.replace(/_url$/, '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
// Absolute URL for an external link — many entries store a bare host (no scheme),
// which as an href resolves relative to our app and 404s.
const toHref = (u: string) => /^https?:\/\//i.test(u.trim()) ? u.trim() : `https://${u.trim()}`;

// Social links reach us three ways: individual module_data keys (marina), a
// module_data.social_links object (jury / architect), or sm_startup_profile
// .social_links (startups). Collect them all into one clickable list.
const SOCIAL_INDIVIDUAL = new Set(['linkedin', 'instagram', 'facebook', 'twitter', 'x', 'youtube', 'tiktok']);
const platformLabel = (k: string) => {
  const key = k.toLowerCase();
  return key === 'twitter' || key === 'x' ? 'X / Twitter'
    : key === 'linkedin' ? 'LinkedIn' : key === 'instagram' ? 'Instagram'
    : key === 'facebook' ? 'Facebook' : key === 'youtube' ? 'YouTube'
    : key === 'tiktok' ? 'TikTok' : prettyKey(k);
};

interface BuiltAsset { label: string; value: string }
interface SocialLink { label: string; url: string }
interface Built { text: { label: string; value: string }[]; assets: BuiltAsset[]; social: SocialLink[]; missing: string[] }
interface EntryBuilt extends DossierRaw, Built {}

function isProvided(rq: Requirement, d: DossierRow): boolean {
  const k = rq.field_key;
  if (k === '__job_title') return !!d.job_title;
  if (k === 'website') return !!d.website;
  const md = d.module_data || {};
  const has = (val: unknown) => val != null && val !== '' && !(Array.isArray(val) && val.length === 0);
  if (has(md[k])) return true;
  // Key-alias tolerance: marina/sponsor/speaker store logo/photo as logo_url/
  // photo_url in module_data while the requirement field_key is 'logo'/'photo'.
  const alt = k.endsWith('_url') ? k.slice(0, -4) : `${k}_url`;
  if (has(md[alt])) return true;
  const sp = d.startup;
  if (sp) {
    if (k === 'logo') return !!sp.logo_url;
    if (k === 'deck') return !!sp.deck_url;
    if (k === 'product_images') return Array.isArray(sp.product_images) && sp.product_images.length > 0;
  }
  return false;
}

function buildDossier(d: DossierRow): Built {
  const text: { label: string; value: string }[] = [];
  const assets: BuiltAsset[] = [];
  const social: SocialLink[] = [];
  const seenSocial = new Set<string>();
  const addSocial = (platform: string, url: unknown) => {
    if (typeof url !== 'string' || !url.trim() || seenSocial.has(url.trim())) return;
    seenSocial.add(url.trim());
    social.push({ label: platformLabel(platform), url: url.trim() });
  };
  const md = d.module_data || {};
  for (const [k, v] of Object.entries(md)) {
    if (v == null || v === '') continue;
    if (k.startsWith('_')) continue; // internal admin fields (_request_note, _requested_info, …)
    const kl = k.toLowerCase();
    if (kl === 'social_links') {
      if (v && typeof v === 'object' && !Array.isArray(v)) for (const [p, u] of Object.entries(v as Record<string, unknown>)) addSocial(p, u);
      continue;
    }
    if (SOCIAL_INDIVIDUAL.has(kl)) { addSocial(kl, v); continue; }
    if (ASSET_KEYS.has(k)) {
      if (typeof v === 'string') assets.push({ label: prettyKey(k), value: v });
      else if (Array.isArray(v)) v.forEach((p, i) => typeof p === 'string' && assets.push({ label: `${prettyKey(k)} ${i + 1}`, value: p }));
    } else if (typeof v === 'string') {
      text.push({ label: prettyKey(k), value: v });
    } else if (Array.isArray(v) && v.length) {
      text.push({ label: prettyKey(k), value: v.join(', ') });
    }
  }
  const sp = d.startup;
  if (sp) {
    for (const [k, v] of Object.entries(sp)) {
      if (STARTUP_SKIP.has(k)) continue;
      if (typeof v === 'string' && v.trim()) text.push({ label: prettyKey(k), value: v });
      else if (Array.isArray(v) && v.length) text.push({ label: prettyKey(k), value: v.join(', ') });
      else if (typeof v === 'boolean') text.push({ label: prettyKey(k), value: v ? 'Yes' : 'No' });
    }
    if (sp.social_links && typeof sp.social_links === 'object' && !Array.isArray(sp.social_links)) {
      for (const [p, u] of Object.entries(sp.social_links as Record<string, unknown>)) addSocial(p, u);
    }
    if (typeof sp.logo_url === 'string' && sp.logo_url) assets.push({ label: 'Logo', value: sp.logo_url });
    if (typeof sp.deck_url === 'string' && sp.deck_url) assets.push({ label: 'Pitch deck', value: sp.deck_url });
    if (typeof sp.pitch_media_url === 'string' && sp.pitch_media_url) assets.push({ label: 'Pitch media', value: sp.pitch_media_url });
    if (Array.isArray(sp.product_images)) sp.product_images.forEach((p, i) => typeof p === 'string' && p && assets.push({ label: `Product image ${i + 1}`, value: p }));
  }
  let reqs: Requirement[] = d.requirements || [];
  if (d.role === 'jury' && reqs.length === 0) {
    reqs = [
      { field_key: 'logo_url', label: 'Company logo', required: true, is_asset: true },
      { field_key: 'photo_url', label: 'Photo / headshot', required: true, is_asset: true },
      { field_key: 'bio', label: 'Bio', required: true, is_asset: false },
      { field_key: '__job_title', label: 'Job title', required: true, is_asset: false },
    ];
  }
  const missing = reqs.filter(rq => rq.required && !isProvided(rq, d)).map(rq => rq.label);
  // The same file can arrive from both module_data and a typed profile row (e.g.
  // startup logo/product images written to both) — show each file once.
  const seenAsset = new Set<string>();
  const dedupedAssets = assets.filter(a => { if (seenAsset.has(a.value)) return false; seenAsset.add(a.value); return true; });
  return { text, assets: dedupedAssets, social, missing };
}

// ---- Category grouping (first matching role wins, priority order) ------------
const CATEGORIES: { key: string; label: string; icon: ComponentType<{ className?: string }>; roles: string[] }[] = [
  { key: 'startup', label: 'Innovations', icon: Lightbulb, roles: ['startup'] },
  { key: 'marina', label: 'Marinas', icon: MapPin, roles: ['marina'] },
  { key: 'architecture', label: 'Architecture', icon: Ruler, roles: ['architect_pro', 'architect_student'] },
  { key: 'jury', label: 'Jury', icon: Scale, roles: ['jury'] },
  { key: 'sponsor', label: 'Sponsors', icon: Building2, roles: ['sponsor'] },
  { key: 'speaker', label: 'Speakers', icon: Mic, roles: ['speaker'] },
];
const CATEGORY_LABEL: Record<string, string> = { ...Object.fromEntries(CATEGORIES.map(c => [c.key, c.label])), other: 'Autres' };
const CATEGORY_ICON: Record<string, ComponentType<{ className?: string }>> = { ...Object.fromEntries(CATEGORIES.map(c => [c.key, c.icon])), other: Building2 };
const categoryOf = (roles: string[]): string => { for (const c of CATEGORIES) if (roles.some(r => c.roles.includes(r))) return c.key; return 'other'; };
// Roles whose catalogue page the Yacht Club actually DESIGNS (prepare → upload →
// the participant approves). Jury are NOT here: they're just listed, with a
// simple "added to catalogue" tick, no page and no validation.
const BUILDS_PAGE = new Set(['startup', 'marina', 'architect_pro', 'architect_student']);
// Roles for which we still gather catalogue info + flag what's missing (jury
// included — Olivia needs their logo/photo/bio/title to list them).
const HAS_CATALOGUE_INFO = new Set(['startup', 'marina', 'architect_pro', 'architect_student', 'jury']);
const ROLE_LABEL_FR: Record<string, string> = { startup: 'Innovation', marina: 'Marina', architect_pro: 'Architecture · Pro', architect_student: 'Architecture · Étudiant', jury: 'Jury', sponsor: 'Sponsor', speaker: 'Speaker' };
const ROLE_SINGULAR: Record<string, string> = { startup: 'innovation', marina: 'marina', architect_pro: 'architecture entry', architect_student: 'architecture entry', jury: 'juror', sponsor: 'sponsor', speaker: 'speaker' };

// ---- Per-société aggregate ---------------------------------------------------
type Payment = 'paid' | 'awaiting' | 'free' | null;
interface Company {
  reg_id: string; company: string; contact: string | null; thumb: string | null;
  category: string; roles: string[]; entries: Entry[]; payment: Payment; pages: EcatRow[]; missing: number;
  juryRa: string | null; listed: boolean;
}
function aggPayment(entries: Entry[]): Payment {
  const s = entries.map(e => e.payment_status).filter(Boolean) as string[];
  if (s.includes('awaiting')) return 'awaiting';
  if (s.includes('paid')) return 'paid';
  if (s.includes('free')) return 'free';
  return null;
}
function ecatFlags(pages: EcatRow[]) {
  return {
    hasChanges: pages.some(p => p.status === 'changes_requested'),
    hasApproval: pages.some(p => p.status === 'uploaded'),
    hasDesign: pages.some(p => ECAT_DESIGN_STATES.includes(p.status)),
    approved: pages.some(p => p.status === 'approved'),
    published: pages.length > 0 && pages.every(p => p.status === 'published'),
  };
}
const PAY_META: Record<string, { label: string; cls: string }> = {
  paid: { label: 'Payé', cls: 'bg-green-50 text-green-700 border-green-200' },
  awaiting: { label: 'Paiement en attente', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  free: { label: 'Gratuit', cls: 'bg-gray-50 text-gray-500 border-gray-200' },
};
const KIT_META: Record<MediaKitStatus, { label: string; cls: string }> = {
  none: { label: 'Kit à créer', cls: 'bg-gray-50 text-gray-500 border-gray-200' },
  ready: { label: 'Kit à envoyer', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  sent: { label: 'Kit envoyé', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  opened: { label: 'Kit ouvert', cls: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  downloaded: { label: 'Kit téléchargé', cls: 'bg-green-50 text-green-700 border-green-200' },
};
function companyEcatBadge(co: Company): { label: string; cls: string } | null {
  const builds = co.pages.length > 0 || co.entries.some(e => BUILDS_PAGE.has(e.role));
  if (!builds) return null;
  if (!co.pages.length) return { label: 'Page à préparer', cls: 'bg-violet-50 text-violet-700 border-violet-200' };
  const f = ecatFlags(co.pages);
  if (f.published) return { label: 'Publiée', cls: 'bg-green-50 text-green-700 border-green-200' };
  if (f.hasChanges) return { label: 'Modifs demandées', cls: 'bg-red-50 text-red-700 border-red-200' };
  if (f.hasApproval) return { label: 'En attente d’appro', cls: 'bg-blue-50 text-blue-700 border-blue-200' };
  if (f.approved) return { label: 'Approuvée', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
  if (f.hasDesign) return { label: 'En préparation', cls: 'bg-violet-50 text-violet-700 border-violet-200' };
  return { label: 'Page à préparer', cls: 'bg-violet-50 text-violet-700 border-violet-200' };
}

// ---- Dashboard tiles ---------------------------------------------------------
type FilterKey = 'changes' | 'design' | 'approval' | 'kit_todo' | 'kit_send' | 'missing' | 'payment' | 'jury_todo';
const TILES: { key: FilterKey; label: string; icon: ComponentType<{ className?: string }>; cls: string; num: string }[] = [
  { key: 'changes', label: 'Modifs demandées', icon: MessageSquare, cls: 'border-red-200 bg-red-50', num: 'text-red-700' },
  { key: 'design', label: 'Pages à préparer', icon: Palette, cls: 'border-violet-200 bg-violet-50', num: 'text-violet-700' },
  { key: 'approval', label: 'En attente d’appro', icon: Clock, cls: 'border-blue-200 bg-blue-50', num: 'text-blue-700' },
  { key: 'jury_todo', label: 'Jury à ajouter', icon: UserCheck, cls: 'border-teal-200 bg-teal-50', num: 'text-teal-700' },
  { key: 'kit_todo', label: 'Media kits à créer', icon: ImageIcon, cls: 'border-amber-200 bg-amber-50', num: 'text-amber-700' },
  { key: 'kit_send', label: 'Media kits à envoyer', icon: Send, cls: 'border-orange-200 bg-orange-50', num: 'text-orange-700' },
  { key: 'missing', label: 'Infos manquantes', icon: AlertTriangle, cls: 'border-slate-200 bg-slate-100', num: 'text-slate-700' },
  { key: 'payment', label: 'Paiement en attente', icon: CreditCard, cls: 'border-rose-200 bg-rose-50', num: 'text-rose-700' },
];
function matchFilter(key: FilterKey, co: Company, kit: MediaKitStatus): boolean {
  const f = ecatFlags(co.pages);
  switch (key) {
    case 'changes': return f.hasChanges;
    case 'design': return f.hasDesign || (co.entries.some(e => BUILDS_PAGE.has(e.role)) && !co.pages.length);
    case 'approval': return f.hasApproval;
    case 'jury_todo': return !!co.juryRa && !co.listed;
    case 'kit_todo': return kit === 'none';
    case 'kit_send': return kit === 'ready';
    case 'missing': return co.missing > 0;
    case 'payment': return co.payment === 'awaiting';
  }
}

// Small pill.
const Pill = ({ label, cls }: { label: string; cls: string }) => (
  <span className={`text-[10px] px-1.5 py-0.5 rounded-full border whitespace-nowrap ${cls}`}>{label}</span>
);

// Segmented progress funnel.
function Funnel({ title, segments }: { title: string; segments: { label: string; value: number; bar: string; dot: string }[] }) {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  return (
    <div>
      <div className="text-xs font-semibold text-gray-600 mb-1.5">{title}</div>
      <div className="flex h-2.5 rounded-full overflow-hidden bg-gray-100">
        {segments.map((s, i) => s.value > 0 && <div key={i} className={s.bar} style={{ width: `${(s.value / total) * 100}%` }} title={`${s.label}: ${s.value}`} />)}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5">
        {segments.map((s, i) => (
          <span key={i} className="text-[11px] text-gray-500 inline-flex items-center gap-1">
            <span className={`inline-block h-2 w-2 rounded-full ${s.dot}`} /> {s.label} {s.value}
          </span>
        ))}
      </div>
    </div>
  );
}

// Collapsible section for the read-only / specialised blocks (Programme, Sponsor
// deliverables) that live below the by-société list.
function CollapsiblePanel({ title, icon: Icon, count, description, defaultOpen = false, children }: {
  title: string; icon: ComponentType<{ className?: string }>; count?: number; description?: string; defaultOpen?: boolean; children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card>
      <button type="button" onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between gap-2 px-4 py-3.5 text-left">
        <span className="flex items-center gap-2 min-w-0">
          <Icon className="h-5 w-5 text-primary shrink-0" />
          <span className="font-semibold text-gray-900 truncate">{title}</span>
          {typeof count === 'number' && <span className="text-xs text-gray-400 shrink-0">({count})</span>}
        </span>
        <ChevronDown className={`h-5 w-5 text-gray-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <CardContent className="pt-0">
          {description && <p className="text-sm text-gray-500 mb-3">{description}</p>}
          {children}
        </CardContent>
      )}
    </Card>
  );
}

export function SM26PartnerPage() {
  const { user, loading: authLoading } = useAuth();
  const [eventId, setEventId] = useState<string | null>(null);
  const [access, setAccess] = useState<'loading' | 'ok' | 'denied'>('loading');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [dossiers, setDossiers] = useState<Map<string, EntryBuilt>>(new Map());
  const [ecat, setEcat] = useState<EcatRow[]>([]);
  const [changeImgs, setChangeImgs] = useState<Record<string, ChangeImg[]>>({});
  const [kits, setKits] = useState<Map<string, KitData>>(new Map());
  const [kitStatus, setKitStatus] = useState<Map<string, MediaKitStatus>>(new Map());
  const [lastEmail, setLastEmail] = useState<Record<string, LastEmail>>({});
  const [sessions, setSessions] = useState<Session[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [drawerSigned, setDrawerSigned] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // toolbar / dashboard
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<FilterKey | null>(null);

  // drawer
  const [openReg, setOpenReg] = useState<string | null>(null);
  const [msg, setMsg] = useState<Record<string, string>>({});
  const [sendingMsg, setSendingMsg] = useState<string | null>(null);

  const reportKitStatus = useCallback((reg: string, s: MediaKitStatus) => {
    setKitStatus(m => { if (m.get(reg) === s) return m; const n = new Map(m); n.set(reg, s); return n; });
  }, []);
  const reportKitData = useCallback((reg: string, d: KitData) => {
    setKits(m => { const n = new Map(m); n.set(reg, d); return n; });
  }, []);

  useEffect(() => { if (!authLoading) load(); /* eslint-disable-next-line */ }, [authLoading, user]);

  const load = async () => {
    setRefreshing(true);
    const { data: ev } = await supabase.from('sm_event').select('id').eq('slug', 'sm26').maybeSingle();
    if (!ev) { setAccess('denied'); setRefreshing(false); return; }
    const eid = (ev as { id: string }).id;
    setEventId(eid);
    const { data: ent, error } = await supabase.rpc('sm_partner_entries', { p_event_id: eid });
    if (error) { setAccess('denied'); setRefreshing(false); return; }
    setAccess('ok');
    const rows = (ent || []) as Entry[];
    setEntries(rows);

    const [{ data: dz }, { data: ec }, { data: ag }, kitRes] = await Promise.all([
      supabase.rpc('sm_partner_dossiers', { p_event_id: eid }),
      supabase.rpc('sm_partner_ecat', { p_event_id: eid }),
      supabase.rpc('sm_agenda', { p_event_id: eid }),
      supabase.functions.invoke('sm26-media-kit', { body: { action: 'list', event_id: eid } }),
    ]);

    // Dossiers → build + compute missing with the exact same client logic.
    const dmap = new Map<string, EntryBuilt>();
    for (const raw of (dz || []) as DossierRaw[]) dmap.set(raw.role_assignment_id, { ...raw, ...buildDossier(raw) });
    setDossiers(dmap);

    const ecRows = (ec || []) as EcatRow[];
    setEcat(ecRows);
    fetchLastEmails(ecRows.map(r => r.registration_id)).then(setLastEmail);
    setSessions((ag || []) as Session[]);

    // Media kits — seed initial data + status (rows report live once mounted).
    const km = new Map<string, KitData>();
    const ks = new Map<string, MediaKitStatus>();
    for (const k of ((kitRes?.data as { kits?: Array<KitData & { registration_id: string }> })?.kits || [])) {
      const kd: KitData = { caption: k.caption || '', notified_at: k.notified_at, first_viewed_at: k.first_viewed_at, first_downloaded_at: k.first_downloaded_at, files: k.files || [] };
      km.set(k.registration_id, kd); ks.set(k.registration_id, mediaKitStatusOf(kd));
    }
    setKits(km); setKitStatus(ks);

    // Sign reference images attached to change requests (server-side; the designer can't read the participant's folder).
    if (ecRows.some(r => r.status === 'changes_requested' && r.change_attachments?.length)) {
      supabase.functions.invoke('sm26-ecat-change-files', { body: { event_id: eid } })
        .then(res => setChangeImgs(((res?.data as { byPage?: Record<string, ChangeImg[]> } | null)?.byPage) || {}))
        .catch(() => {});
    }

    // Sign storage-path thumbnails (http thumbs render directly).
    const signed: Record<string, string> = {};
    await Promise.all(rows.filter(r => r.thumb && !isHttp(r.thumb)).map(async r => {
      const { data: s } = await supabase.storage.from('event-media').createSignedUrl(r.thumb as string, 1800);
      if (s) signed[r.thumb as string] = s.signedUrl;
    }));
    setThumbs(signed);
    setRefreshing(false);
  };

  const thumbSrc = (t: string | null) => !t ? null : isHttp(t) ? t : (thumbs[t] || null);

  // Build the by-société aggregate from entries + dossiers + e-cat pages.
  const companies = useMemo<Company[]>(() => {
    const byReg = new Map<string, Company>();
    for (const e of entries) {
      let c = byReg.get(e.reg_id);
      if (!c) { c = { reg_id: e.reg_id, company: e.company || e.name || 'Participant', contact: e.company ? e.name : null, thumb: e.thumb, category: 'other', roles: [], entries: [], payment: null, pages: [], missing: 0, juryRa: null, listed: false }; byReg.set(e.reg_id, c); }
      c.entries.push(e);
      if (e.role && !c.roles.includes(e.role)) c.roles.push(e.role);
      if (!c.thumb && e.thumb) c.thumb = e.thumb;
      if (!c.contact && e.company && e.name) c.contact = e.name;
    }
    for (const c of byReg.values()) {
      c.category = categoryOf(c.roles);
      c.payment = aggPayment(c.entries);
      c.pages = ecat.filter(p => p.registration_id === c.reg_id);
      c.missing = c.entries.reduce((sum, e) => HAS_CATALOGUE_INFO.has(e.role) ? sum + (dossiers.get(e.role_assignment_id)?.missing.length || 0) : sum, 0);
      const je = c.entries.find(e => e.role === 'jury');
      c.juryRa = je?.role_assignment_id || null;
      c.listed = !!je?.catalogue_listed;
    }
    return [...byReg.values()];
  }, [entries, dossiers, ecat]);

  const counts = useMemo(() => {
    const c: Record<FilterKey, number> = { changes: 0, design: 0, approval: 0, kit_todo: 0, kit_send: 0, missing: 0, payment: 0, jury_todo: 0 };
    for (const co of companies) { const kit = kitStatus.get(co.reg_id) || 'none'; for (const t of TILES) if (matchFilter(t.key, co, kit)) c[t.key]++; }
    return c;
  }, [companies, kitStatus]);

  const catFunnel = useMemo(() => {
    const s = { design: 0, approval: 0, changes: 0, approved: 0, published: 0 };
    for (const co of companies) {
      const builds = co.pages.length > 0 || co.entries.some(e => BUILDS_PAGE.has(e.role));
      if (!builds) continue;
      const f = ecatFlags(co.pages);
      if (f.published) s.published++;
      else if (f.hasChanges) s.changes++;
      else if (f.hasApproval) s.approval++;
      else if (f.approved) s.approved++;
      else s.design++;
    }
    return s;
  }, [companies]);

  const kitFunnel = useMemo(() => {
    const s = { none: 0, ready: 0, sent: 0, opened: 0, downloaded: 0 };
    for (const co of companies) s[kitStatus.get(co.reg_id) || 'none']++;
    return s;
  }, [companies, kitStatus]);

  const paySummary = useMemo(() => {
    let paid = 0, awaiting = 0;
    for (const co of companies) { if (co.payment === 'paid') paid++; else if (co.payment === 'awaiting') awaiting++; }
    return { paid, awaiting };
  }, [companies]);

  const jurySummary = useMemo(() => {
    let listed = 0, total = 0;
    for (const co of companies) if (co.juryRa) { total++; if (co.listed) listed++; }
    return { listed, total };
  }, [companies]);

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    return companies.filter(co => {
      if (filter && !matchFilter(filter, co, kitStatus.get(co.reg_id) || 'none')) return false;
      if (term && !`${co.company} ${co.contact || ''}`.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [companies, kitStatus, q, filter]);

  const groups = useMemo(() => {
    const by: Record<string, Company[]> = {};
    for (const co of visible) (by[co.category] ||= []).push(co);
    for (const k of Object.keys(by)) by[k].sort((a, b) => a.company.localeCompare(b.company));
    return [...CATEGORIES.map(c => c.key), 'other'].filter(k => by[k]?.length).map(k => ({ key: k, rows: by[k] }));
  }, [visible]);

  const drawerCompany = openReg ? companies.find(c => c.reg_id === openReg) || null : null;

  const openCompany = async (reg: string) => {
    setOpenReg(reg);
    const co = companies.find(c => c.reg_id === reg);
    if (!co) return;
    const paths = new Set<string>();
    for (const e of co.entries) { const d = dossiers.get(e.role_assignment_id); if (d) for (const a of d.assets) if (isImg(a.value) && !isHttp(a.value)) paths.add(a.value); }
    const toSign = [...paths].filter(p => !drawerSigned[p]);
    if (toSign.length) {
      const signed: Record<string, string> = {};
      await Promise.all(toSign.map(async p => { const { data } = await supabase.storage.from('event-media').createSignedUrl(p, 600); if (data) signed[p] = data.signedUrl; }));
      setDrawerSigned(prev => ({ ...prev, ...signed }));
    }
  };

  // ---- e-catalogue actions (unchanged behaviour) -----------------------------
  const setEcatStatus = async (id: string, status: string) => {
    setBusy(id);
    const { error } = await supabase.rpc('sm_partner_ecat_status', { p_page_id: id, p_status: status });
    setBusy(null);
    if (error) { toast({ title: 'Could not update', description: error.message, variant: 'destructive' }); return; }
    setEcat(prev => prev.map(p => p.id === id ? { ...p, status } : p));
    toast({ title: 'E-catalogue status updated' });
  };
  const uploadDesigned = async (p: EcatRow, file: File) => {
    if (!user) return;
    setBusy(p.id);
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `${user.id}/ecat/${p.id}/${safe}`;
    const { error: upErr } = await supabase.storage.from('event-media').upload(path, file, { upsert: true });
    if (upErr) { setBusy(null); toast({ title: 'Upload failed', description: upErr.message, variant: 'destructive' }); return; }
    const { error } = await supabase.rpc('sm_partner_ecat_upload', { p_page_id: p.id, p_path: path });
    setBusy(null);
    if (error) { toast({ title: 'Could not save', description: error.message, variant: 'destructive' }); return; }
    setEcat(prev => prev.map(x => x.id === p.id ? { ...x, designed_file_path: path, status: 'uploaded' } : x));
    void supabase.functions.invoke('sm26-email', { body: { registration_id: p.registration_id, kind: 'ecat_review' } }).catch(() => {});
    toast({ title: 'Designed page sent for review', description: 'The participant will be asked to approve it or request changes.' });
  };
  const previewEcat = async (path: string) => {
    const { data } = await supabase.storage.from('event-media').createSignedUrl(path, 600);
    if (data) window.open(data.signedUrl, '_blank'); else toast({ title: 'Could not open file', variant: 'destructive' });
  };
  const remindReview = async (p: EcatRow) => {
    setBusy(p.id);
    const { error } = await supabase.functions.invoke('sm26-email', { body: { registration_id: p.registration_id, kind: 'ecat_review_reminder' } });
    setBusy(null);
    if (error) { toast({ title: 'Could not send the reminder', description: error.message, variant: 'destructive' }); return; }
    setLastEmail(m => ({ ...m, [p.registration_id]: { kind: 'ecat_review_reminder', sent_at: new Date().toISOString() } }));
    toast({ title: 'Reminder sent', description: 'The participant was emailed to review and approve their page.' });
  };
  const removeEcat = async (p: EcatRow) => {
    if (!window.confirm('Remove the uploaded designed page? This clears the file and returns the page to “Designing” so you can upload the right one.')) return;
    setBusy(p.id);
    const oldPath = p.designed_file_path;
    const { error } = await supabase.rpc('sm_partner_ecat_clear', { p_page_id: p.id });
    setBusy(null);
    if (error) { toast({ title: 'Could not remove', description: error.message, variant: 'destructive' }); return; }
    if (oldPath) supabase.storage.from('event-media').remove([oldPath]).catch(() => {});
    setEcat(prev => prev.map(x => x.id === p.id ? { ...x, designed_file_path: null, status: 'in_design' } : x));
    toast({ title: 'File removed', description: 'The page is back to “Designing”.' });
  };

  // ---- dossier actions -------------------------------------------------------
  const openAsset = async (value: string) => {
    if (isHttp(value)) { window.open(value, '_blank'); return; }
    const { data } = await supabase.storage.from('event-media').createSignedUrl(value, 300);
    if (data) window.open(data.signedUrl, '_blank');
  };
  const downloadOne = async (value: string) => {
    try { await downloadAsset(value, drawerSigned); }
    catch { toast({ title: 'Could not download the file', variant: 'destructive' }); }
  };
  const downloadChangeImg = async (img: ChangeImg) => {
    if (!img.url) return;
    try {
      const b = await (await fetch(img.url)).blob();
      const o = URL.createObjectURL(b);
      const a = document.createElement('a'); a.href = o; a.download = img.filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(o), 1500);
    } catch { window.open(img.url, '_blank'); }
  };
  const downloadDossier = async (d: EntryBuilt) => {
    setBusy(`dossier:${d.role_assignment_id}`);
    try {
      await downloadDossierZip({
        company: d.company, name: d.name, job_title: d.job_title, country: d.country,
        website: d.website, email: d.email,
        roleLabel: d.role ? (ROLE_SINGULAR[d.role] || d.role) : null,
        text: [...d.text, ...d.social.map(s => ({ label: s.label, value: s.url }))], assets: d.assets, signed: drawerSigned, missing: d.missing,
      });
      toast({ title: 'Dossier downloaded', description: 'A .zip with the PDF summary and all original files.' });
    } catch { toast({ title: 'Could not build the dossier', variant: 'destructive' }); }
    finally { setBusy(null); }
  };
  const sendPartnerMessage = async (ra: string) => {
    const text = (msg[ra] || '').trim();
    if (!text) return;
    setSendingMsg(ra);
    const { error } = await supabase.rpc('sm_partner_message', { p_ra: ra, p_message: text });
    setSendingMsg(null);
    if (error) { toast({ title: 'Could not send', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Demande envoyée au participant' });
    setMsg(m => ({ ...m, [ra]: '' }));
  };

  // Tick "added to catalogue" for a juror — internal checklist, no notification.
  const toggleListing = async (ra: string, listed: boolean) => {
    setBusy(`list:${ra}`);
    const { error } = await supabase.rpc('sm_catalogue_listing_set', { p_ra: ra, p_listed: listed });
    setBusy(null);
    if (error) { toast({ title: 'Impossible de mettre à jour', description: error.message, variant: 'destructive' }); return; }
    setEntries(prev => prev.map(e => e.role_assignment_id === ra ? { ...e, catalogue_listed: listed } : e));
  };

  if (authLoading || access === 'loading') return <div className="flex items-center justify-center h-[60vh]"><RefreshCw className="h-8 w-8 animate-spin text-primary" /></div>;
  if (access === 'denied') return (
    <div className="container mx-auto px-4 py-16 max-w-md text-center">
      <Lock className="h-10 w-10 text-gray-300 mx-auto mb-3" />
      <h1 className="text-2xl font-bold mb-2">Espace partenaire</h1>
      <p className="text-gray-600">Cet espace est réservé aux organisations partenaires de l'événement. Si vous devriez y avoir accès, contactez <a href="mailto:events@m3monaco.com" className="text-primary">events@m3monaco.com</a>.</p>
    </div>
  );

  const days: { key: string; items: Session[] }[] = [];
  for (const s of sessions) { const k = dayKey(s.starts_at); let d = days.find(x => x.key === k); if (!d) { d = { key: k, items: [] }; days.push(d); } d.items.push(s); }
  const allClear = TILES.every(t => counts[t.key] === 0);

  return (
    <div className="min-h-screen bg-gray-50">
      <Helmet><title>Espace Yacht Club — SM26</title></Helmet>
      <section className="bg-gradient-to-br from-[#0b2653] to-[#143a6b] text-white">
        <div className="container mx-auto px-4 py-10">
          <div className="mb-3"><SM26BackLink light /></div>
          <p className="uppercase tracking-wide text-white/60 text-sm mb-2">SM26 · Espace partenaire</p>
          <h1 className="text-2xl lg:text-3xl font-bold">Yacht Club &amp; partenaires</h1>
          <p className="text-white/80 mt-2 max-w-2xl">Chaque société regroupe au même endroit ses infos catalogue, sa page e-catalogue et son media kit. Le tableau de bord montre ce qu'il reste à faire — cliquez une tuile pour filtrer.</p>
        </div>
      </section>

      <div className="container mx-auto px-4 py-8 max-w-5xl space-y-6">
        {/* Dashboard — à faire */}
        <Card>
          <CardContent className="p-4 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-gray-900">Tableau de bord</span>
                <span className="text-xs text-gray-400">{companies.length} sociétés</span>
              </div>
              <button onClick={load} disabled={refreshing} title="Rafraîchir" className="inline-flex items-center gap-1.5 text-xs text-gray-600 border border-gray-200 rounded-md px-2.5 py-1.5 hover:bg-gray-50 disabled:opacity-60">
                <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} /> Rafraîchir
              </button>
            </div>

            {allClear && (
              <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 shrink-0" /> Tout est à jour — rien en attente.
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {TILES.map(t => {
                const Icon = t.icon; const n = counts[t.key]; const active = filter === t.key;
                return (
                  <button key={t.key} type="button" onClick={() => setFilter(f => f === t.key ? null : t.key)}
                    className={`text-left rounded-lg border p-2.5 transition-all hover:shadow-sm ${t.cls} ${active ? 'ring-2 ring-primary/50' : ''} ${n === 0 && !active ? 'opacity-55' : ''}`}>
                    <Icon className={`h-4 w-4 mb-1 ${t.num}`} />
                    <div className={`text-xl font-bold leading-none ${t.num}`}>{n}</div>
                    <div className="text-[11px] text-gray-600 mt-1 leading-tight">{t.label}</div>
                  </button>
                );
              })}
            </div>

            <div className="grid sm:grid-cols-2 gap-4 pt-1">
              <Funnel title="Pipeline e-catalogue" segments={[
                { label: 'À préparer', value: catFunnel.design, bar: 'bg-violet-400', dot: 'bg-violet-400' },
                { label: 'Attente appro', value: catFunnel.approval, bar: 'bg-blue-400', dot: 'bg-blue-400' },
                { label: 'Modifs', value: catFunnel.changes, bar: 'bg-red-400', dot: 'bg-red-400' },
                { label: 'Approuvées', value: catFunnel.approved, bar: 'bg-emerald-400', dot: 'bg-emerald-400' },
                { label: 'Publiées', value: catFunnel.published, bar: 'bg-green-500', dot: 'bg-green-500' },
              ]} />
              <Funnel title="Media kits" segments={[
                { label: 'À créer', value: kitFunnel.none, bar: 'bg-gray-300', dot: 'bg-gray-300' },
                { label: 'À envoyer', value: kitFunnel.ready, bar: 'bg-amber-400', dot: 'bg-amber-400' },
                { label: 'Envoyés', value: kitFunnel.sent, bar: 'bg-blue-400', dot: 'bg-blue-400' },
                { label: 'Ouverts', value: kitFunnel.opened + kitFunnel.downloaded, bar: 'bg-green-500', dot: 'bg-green-500' },
              ]} />
            </div>

            <div className="text-[11px] text-gray-500 flex items-center gap-x-4 gap-y-1 flex-wrap pt-1 border-t">
              <span className="inline-flex items-center gap-1"><CreditCard className="h-3.5 w-3.5 text-gray-400" /> Paiement : <span className="text-green-700 font-medium">{paySummary.paid} payés</span> · <span className="text-amber-700 font-medium">{paySummary.awaiting} en attente</span></span>
              {jurySummary.total > 0 && (
                <span className="inline-flex items-center gap-1"><UserCheck className="h-3.5 w-3.5 text-gray-400" /> Jury au catalogue : <span className="text-teal-700 font-medium">{jurySummary.listed}/{jurySummary.total} ajoutés</span></span>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Toolbar */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="h-4 w-4 text-gray-300 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Rechercher une société…"
              className="w-full text-sm rounded-md border border-gray-200 pl-8 pr-2 py-2 focus:outline-none focus:ring-1 focus:ring-primary" />
          </div>
          {filter && (
            <button onClick={() => setFilter(null)} className="inline-flex items-center gap-1.5 text-xs text-primary border border-primary/30 bg-primary/5 rounded-md px-2.5 py-2">
              Filtre : {TILES.find(t => t.key === filter)?.label} <X className="h-3.5 w-3.5" />
            </button>
          )}
          <span className="text-xs text-gray-400">{visible.length} affichées</span>
        </div>

        {/* By-société list */}
        {groups.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">Aucune société ne correspond.</p>
        ) : groups.map(g => {
          const Cat = CATEGORY_ICON[g.key] || Building2;
          return (
            <div key={g.key} className="space-y-1.5">
              <div className="flex items-center gap-2 px-1">
                <Cat className="h-4 w-4 text-primary" />
                <span className="text-sm font-semibold text-gray-800">{CATEGORY_LABEL[g.key]}</span>
                <span className="text-[11px] text-gray-400">{g.rows.length}</span>
                <div className="flex-1 h-px bg-gray-100" />
              </div>
              {g.rows.map(co => {
                const kit = kitStatus.get(co.reg_id) || 'none';
                const eb = companyEcatBadge(co);
                const src = thumbSrc(co.thumb);
                const isJury = co.category === 'jury' && !!co.juryRa;
                return (
                  <div key={co.reg_id} className="flex items-center gap-1 rounded-lg border border-gray-100 bg-white hover:border-primary/40 hover:bg-gray-50 transition-colors">
                    <button onClick={() => openCompany(co.reg_id)} className="flex items-center gap-3 text-left flex-1 min-w-0 p-2.5">
                      <div className="w-10 h-10 rounded-lg bg-white border border-gray-100 flex items-center justify-center shrink-0 overflow-hidden">
                        {src ? <img src={src} alt="" className="w-full h-full object-contain p-0.5" /> : <Cat className="h-5 w-5 text-gray-300" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-gray-900 truncate">{co.company}</div>
                        {co.contact && <div className="text-xs text-gray-500 truncate">{co.contact}</div>}
                        <div className="flex items-center gap-1 flex-wrap mt-1">
                          {co.payment && <Pill {...PAY_META[co.payment]} />}
                          {eb && <Pill {...eb} />}
                          <Pill {...KIT_META[kit]} />
                          {co.missing > 0 && <Pill label={`${co.missing} info${co.missing > 1 ? 's' : ''} manquante${co.missing > 1 ? 's' : ''}`} cls="bg-slate-100 text-slate-600 border-slate-200" />}
                        </div>
                      </div>
                    </button>
                    {isJury ? (
                      <button type="button" onClick={() => toggleListing(co.juryRa!, !co.listed)} disabled={busy === `list:${co.juryRa}`}
                        title={co.listed ? 'Marquer comme non ajouté au catalogue' : 'Marquer comme ajouté au catalogue'}
                        className={`shrink-0 mr-2 inline-flex items-center gap-1.5 text-xs font-medium rounded-md border px-2.5 py-1.5 transition-colors disabled:opacity-60 ${co.listed ? 'bg-teal-50 text-teal-700 border-teal-200 hover:bg-teal-100' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
                        {busy === `list:${co.juryRa}` ? <Loader2 className="h-4 w-4 animate-spin" /> : co.listed ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                        {co.listed ? 'Ajouté' : 'À ajouter'}
                      </button>
                    ) : (
                      <ChevronRight className="h-4 w-4 text-gray-300 shrink-0 mr-2.5" />
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}

        {/* Sponsors — deliverables (specialised tracker kept separate) */}
        <CollapsiblePanel title="Sponsors — livrables" icon={Building2}
          description="Cochez chaque livrable produit pour le sponsor et téléchargez ses fichiers.">
          <SM26PartnerSponsors embedded />
        </CollapsiblePanel>

        {/* Programme (read-only) */}
        <CollapsiblePanel title="Programme" icon={CalendarDays} count={sessions.length} description="Lecture seule — le planning est géré par M3.">
          <div className="space-y-4">
            {days.length === 0 ? <p className="text-sm text-gray-400">Le programme sera publié prochainement.</p> : days.map(day => (
              <div key={day.key}>
                <div className="text-sm font-semibold text-gray-700 mb-2">{day.key}</div>
                <div className="space-y-1.5">
                  {day.items.map(s => (
                    <div key={s.id} className="flex gap-3 text-sm">
                      <span className="w-14 shrink-0 text-gray-500">{fmtTime(s.starts_at)}</span>
                      <div className="min-w-0">
                        <span className="font-medium text-gray-900">{s.title}</span>
                        <div className="text-xs text-gray-500 flex items-center gap-2 flex-wrap">
                          <Badge variant="secondary" className="text-[10px] capitalize">{s.type}</Badge>
                          {s.room && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {s.room}</span>}
                          {s.speakers && <span>{s.speakers}</span>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </CollapsiblePanel>

        <p className="text-xs text-gray-400 text-center">
          <ExternalLink className="h-3 w-3 inline mr-1" /> La liste complète des participants n'est pas affichée ici. Pour toute autre demande, contactez events@m3monaco.com.
        </p>
      </div>

      {/* ---- Drawer : fiche société ---- */}
      {openReg && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setOpenReg(null)} />
          <div className="fixed inset-y-0 right-0 w-full max-w-xl bg-gray-50 z-50 shadow-2xl overflow-y-auto">
            {!drawerCompany ? (
              <div className="flex items-center justify-center h-40"><RefreshCw className="h-6 w-6 animate-spin text-gray-300" /></div>
            ) : (
              <DrawerBody
                co={drawerCompany}
                dossiers={dossiers}
                changeImgs={changeImgs}
                lastEmail={lastEmail}
                drawerSigned={drawerSigned}
                thumbSrc={thumbSrc}
                eventId={eventId!}
                uid={user?.id || ''}
                busy={busy}
                fileRefs={fileRefs}
                kitInitial={kits.get(drawerCompany.reg_id) || EMPTY_KIT}
                msg={msg}
                setMsg={setMsg}
                sendingMsg={sendingMsg}
                onClose={() => setOpenReg(null)}
                onStatusChange={setEcatStatus}
                onUpload={uploadDesigned}
                onPreview={previewEcat}
                onRemind={remindReview}
                onRemoveEcat={removeEcat}
                onOpenAsset={openAsset}
                onDownloadOne={downloadOne}
                onDownloadChangeImg={downloadChangeImg}
                onDownloadDossier={downloadDossier}
                onSendMessage={sendPartnerMessage}
                onToggleListing={toggleListing}
                reportKitStatus={reportKitStatus}
                reportKitData={reportKitData}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ---- Drawer body (per-société fiche) ---------------------------------------
function DrawerBody(props: {
  co: Company;
  dossiers: Map<string, EntryBuilt>;
  changeImgs: Record<string, ChangeImg[]>;
  lastEmail: Record<string, LastEmail>;
  drawerSigned: Record<string, string>;
  thumbSrc: (t: string | null) => string | null;
  eventId: string; uid: string;
  busy: string | null;
  fileRefs: MutableRefObject<Record<string, HTMLInputElement | null>>;
  kitInitial: KitData;
  msg: Record<string, string>; setMsg: Dispatch<SetStateAction<Record<string, string>>>;
  sendingMsg: string | null;
  onClose: () => void;
  onStatusChange: (id: string, status: string) => void;
  onUpload: (p: EcatRow, file: File) => void;
  onPreview: (path: string) => void;
  onRemind: (p: EcatRow) => void;
  onRemoveEcat: (p: EcatRow) => void;
  onOpenAsset: (value: string) => void;
  onDownloadOne: (value: string) => void;
  onDownloadChangeImg: (img: ChangeImg) => void;
  onDownloadDossier: (d: EntryBuilt) => void;
  onSendMessage: (ra: string) => void;
  onToggleListing: (ra: string, listed: boolean) => void;
  reportKitStatus: (reg: string, s: MediaKitStatus) => void;
  reportKitData: (reg: string, d: KitData) => void;
}) {
  const { co, dossiers, changeImgs, lastEmail, drawerSigned, thumbSrc, eventId, uid, busy, fileRefs, kitInitial, msg, setMsg, sendingMsg } = props;
  const kit = mediaKitStatusOf(kitInitial);
  const eb = companyEcatBadge(co);
  const Cat = CATEGORY_ICON[co.category] || Building2;
  const src = thumbSrc(co.thumb);
  const builtEntries = co.entries.map(e => dossiers.get(e.role_assignment_id)).filter(Boolean) as EntryBuilt[];
  const multi = builtEntries.length > 1;

  return (
    <div>
      {/* header */}
      <div className="sticky top-0 z-10 bg-white border-b px-4 py-3 flex items-start gap-3">
        <div className="w-11 h-11 rounded-lg bg-white border border-gray-100 flex items-center justify-center shrink-0 overflow-hidden">
          {src ? <img src={src} alt="" className="w-full h-full object-contain p-0.5" /> : <Cat className="h-5 w-5 text-gray-300" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-lg font-bold text-gray-900 truncate">{co.company}</div>
          {co.contact && <div className="text-sm text-gray-500 truncate">{co.contact}</div>}
          <div className="flex items-center gap-1 flex-wrap mt-1.5">
            <Pill label={CATEGORY_LABEL[co.category]} cls="bg-primary/5 text-primary border-primary/20" />
            {co.payment && <Pill {...PAY_META[co.payment]} />}
            {eb && <Pill {...eb} />}
            <Pill {...KIT_META[kit]} />
            {co.missing > 0 && <Pill label={`${co.missing} info${co.missing > 1 ? 's' : ''} manquante${co.missing > 1 ? 's' : ''}`} cls="bg-slate-100 text-slate-600 border-slate-200" />}
          </div>
        </div>
        <button onClick={props.onClose} className="p-1.5 rounded-md hover:bg-gray-100 text-gray-400 shrink-0"><X className="h-5 w-5" /></button>
      </div>

      <div className="p-4 space-y-5">
        {/* 1 — Infos & fichiers */}
        <section>
          <SectionHeader icon={FileText} title="Infos & fichiers à télécharger" />
          <div className="space-y-4">
            {builtEntries.length === 0 && <p className="text-sm text-gray-400">Aucune fiche disponible.</p>}
            {builtEntries.map(d => (
              <div key={d.role_assignment_id} className="rounded-lg border border-gray-100 bg-white p-3 space-y-3">
                {multi && <div className="text-[11px] font-semibold uppercase tracking-wide text-primary">{ROLE_LABEL_FR[d.role] || d.role}</div>}

                {/* contact line */}
                <div className="text-xs text-gray-500 flex flex-wrap gap-x-3 gap-y-0.5">
                  {d.job_title && <span>{d.job_title}</span>}
                  {d.country && <span>{d.country}</span>}
                  {d.website && <a href={toHref(d.website)} target="_blank" rel="noreferrer" className="text-primary inline-flex items-center gap-1">{d.website.replace(/^https?:\/\//, '')} <ExternalLink className="h-3 w-3" /></a>}
                  {d.email && <a href={`mailto:${d.email}`} className="text-primary">{d.email}</a>}
                </div>

                {d.missing.length > 0 ? (
                  <div className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800 flex items-start gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" /> <span><span className="font-medium">Manque pour le catalogue :</span> {d.missing.join(', ')}.</span>
                  </div>
                ) : HAS_CATALOGUE_INFO.has(d.role) ? (
                  <div className="rounded-md border border-green-200 bg-green-50 px-2.5 py-1.5 text-xs text-green-800 flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> Toutes les infos requises sont fournies.
                  </div>
                ) : null}

                <button onClick={() => props.onDownloadDossier(d)} disabled={busy === `dossier:${d.role_assignment_id}`}
                  className="inline-flex items-center gap-1.5 text-xs font-medium border border-gray-200 rounded-md px-2.5 py-1.5 hover:bg-gray-50 disabled:opacity-60">
                  {busy === `dossier:${d.role_assignment_id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} Télécharger le dossier complet (.zip)
                </button>

                {d.social.length > 0 && (
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">Réseaux sociaux</div>
                    <div className="flex flex-wrap gap-2">
                      {d.social.map((s, i) => (
                        <a key={i} href={toHref(s.url)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs text-primary border border-gray-200 rounded-md px-2 py-1 hover:bg-gray-50">{s.label} <ExternalLink className="h-3 w-3" /></a>
                      ))}
                    </div>
                  </div>
                )}

                {d.assets.length > 0 && (
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">Images &amp; fichiers</div>
                    <div className="grid grid-cols-3 gap-2">
                      {d.assets.map((a, i) => {
                        const asrc = isHttp(a.value) ? (isImg(a.value) ? a.value : null) : drawerSigned[a.value];
                        const filename = a.value.split('/').pop()?.split('?')[0] || 'file';
                        return (
                          <div key={i} className="border border-gray-100 rounded-lg p-1.5">
                            <div className="text-[9px] uppercase tracking-wide text-gray-400 mb-1 truncate" title={a.label}>{a.label}</div>
                            {isImg(a.value) && asrc ? (
                              <button onClick={() => props.onOpenAsset(a.value)} className="block w-full"><img src={asrc} alt={a.label} className="w-full h-16 object-contain rounded bg-gray-50" /></button>
                            ) : (
                              <button onClick={() => props.onOpenAsset(a.value)} className="flex items-center gap-1 text-[11px] text-primary py-2"><FileText className="h-3.5 w-3.5" /> <span className="truncate">{filename}</span></button>
                            )}
                            <button onClick={() => props.onDownloadOne(a.value)} className="mt-1 w-full inline-flex items-center justify-center gap-1 text-[10px] text-gray-600 border border-gray-200 rounded py-0.5 hover:bg-gray-50"><Download className="h-3 w-3" /> Télécharger</button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {d.text.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Détails</div>
                    {d.text.map((t, i) => (
                      <div key={i}>
                        <div className="text-[10px] uppercase tracking-wide text-gray-400">{t.label}</div>
                        <div className="text-sm text-gray-800 whitespace-pre-wrap">{t.value}</div>
                      </div>
                    ))}
                  </div>
                )}

                {/* request a change */}
                <div className="border-t pt-2.5">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5 flex items-center gap-1.5"><MessageSquare className="h-3.5 w-3.5" /> Demander une modif / une info</div>
                  <textarea value={msg[d.role_assignment_id] || ''} onChange={e => setMsg(m => ({ ...m, [d.role_assignment_id]: e.target.value }))} rows={2}
                    placeholder="ex. Merci d'envoyer un logo en meilleure résolution (min. 1000 px) pour le catalogue."
                    className="w-full text-sm border border-gray-200 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary" />
                  <div className="flex justify-end mt-2">
                    <button type="button" disabled={sendingMsg === d.role_assignment_id || !(msg[d.role_assignment_id] || '').trim()} onClick={() => props.onSendMessage(d.role_assignment_id)}
                      className="inline-flex items-center gap-1.5 text-xs font-medium bg-primary text-white rounded-md px-3 py-1.5 hover:bg-primary/90 disabled:opacity-60">
                      {sendingMsg === d.role_assignment_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MessageSquare className="h-3.5 w-3.5" />} Envoyer au participant
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* 2 — Page e-catalogue */}
        {(co.pages.length > 0 || co.entries.some(e => BUILDS_PAGE.has(e.role))) && (
          <section>
            <SectionHeader icon={BookOpen} title="Page e-catalogue" />
            {co.pages.length === 0 ? (
              <p className="text-sm text-gray-400">Aucune page catalogue pour le moment.</p>
            ) : (
              <div className="space-y-2">
                {co.pages.map(p => {
                  const busyRow = busy === p.id;
                  return (
                    <div key={p.id} className="rounded-lg border border-gray-100 bg-white p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2 min-w-0">
                          <Badge variant="outline" className="text-[10px] capitalize">{p.kind}</Badge>
                          <Badge className={`text-[10px] ${ecatStatusClass(p.status)}`}>{ECAT_STATUS_LABEL[p.status] || p.status}</Badge>
                        </div>
                        <Select value={p.status} onValueChange={v => props.onStatusChange(p.id, v)} disabled={busyRow}>
                          <SelectTrigger className="w-40 h-8 text-xs"><SelectValue /></SelectTrigger>
                          {/* 'approved' is the participant's step and 'published' is M3's — a partner sets only design/upload states (also server-enforced). */}
                          <SelectContent>{ECAT_STATUSES.filter(s => s !== 'approved' && s !== 'published').map(s => <SelectItem key={s} value={s}>{ECAT_STATUS_LABEL[s] || s}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>

                      {p.status === 'changes_requested' && p.changes_note && (
                        <div className="rounded-md bg-red-50 border border-red-100 px-2.5 py-1.5 text-xs text-red-700 flex items-start gap-1.5">
                          <MessageSquare className="h-3.5 w-3.5 mt-0.5 shrink-0" /> <span><span className="font-medium">Modifs demandées :</span> {p.changes_note}</span>
                        </div>
                      )}

                      {p.status === 'changes_requested' && (changeImgs[p.id]?.length ?? 0) > 0 && (
                        <div className="rounded-md bg-amber-50 border border-amber-100 px-2.5 py-2">
                          <div className="text-[11px] font-medium text-amber-800 mb-1.5 flex items-center gap-1.5"><ImageIcon className="h-3.5 w-3.5" /> Images jointes par le participant</div>
                          <div className="flex flex-wrap gap-2">
                            {changeImgs[p.id].map(img => (
                              <div key={img.path} className="relative">
                                <button onClick={() => img.url && window.open(img.url, '_blank')} title={img.filename} className={img.is_image && img.url ? 'block h-16 w-16 rounded-md border border-amber-200 overflow-hidden bg-white hover:ring-2 hover:ring-primary/30' : 'h-16 w-16 rounded-md border border-amber-200 flex flex-col items-center justify-center gap-1 text-[9px] text-gray-600 hover:bg-white p-1'}>
                                  {img.is_image && img.url ? <img src={img.url} alt={img.filename} className="h-full w-full object-contain" /> : <><Download className="h-3.5 w-3.5 text-gray-400" /><span className="truncate w-full text-center">{img.filename}</span></>}
                                </button>
                                <button onClick={() => props.onDownloadChangeImg(img)} title="Télécharger" className="absolute -bottom-1.5 -right-1.5 bg-white border border-gray-200 rounded-full p-0.5 text-gray-500 hover:text-primary shadow-sm"><Download className="h-3 w-3" /></button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="flex items-center gap-2 flex-wrap">
                        <input ref={el => { fileRefs.current[p.id] = el; }} type="file" accept="application/pdf,image/*" className="hidden"
                          onChange={e => { const f = e.target.files?.[0]; if (f) props.onUpload(p, f); e.target.value = ''; }} />
                        <button type="button" onClick={() => fileRefs.current[p.id]?.click()} disabled={busyRow}
                          className="inline-flex items-center gap-1.5 text-xs font-medium border border-gray-200 rounded-md px-2.5 py-1.5 hover:bg-gray-50 disabled:opacity-60">
                          {busyRow ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} {p.designed_file_path ? 'Remplacer la page' : 'Uploader la page conçue'}
                        </button>
                        {p.designed_file_path && (
                          <button type="button" onClick={() => props.onPreview(p.designed_file_path!)} className="inline-flex items-center gap-1.5 text-xs text-gray-600 border border-gray-200 rounded-md px-2.5 py-1.5 hover:bg-gray-50"><Eye className="h-3.5 w-3.5" /> Aperçu</button>
                        )}
                        {p.designed_file_path && p.status !== 'approved' && p.status !== 'published' && (
                          <button type="button" onClick={() => props.onRemoveEcat(p)} disabled={busyRow} className="inline-flex items-center gap-1.5 text-xs text-gray-600 border border-gray-200 rounded-md px-2.5 py-1.5 hover:bg-red-50 hover:text-red-600 disabled:opacity-60"><Trash2 className="h-3.5 w-3.5" /> Retirer</button>
                        )}
                        {p.status === 'uploaded' && (
                          <>
                            <span className="text-xs text-blue-600 inline-flex items-center gap-1">En attente d'approbation</span>
                            <button type="button" onClick={() => props.onRemind(p)} disabled={busyRow} title="Envoyer un rappel d'approbation au participant"
                              className="inline-flex items-center gap-1.5 text-xs text-gray-600 border border-gray-200 rounded-md px-2.5 py-1.5 hover:bg-gray-50 disabled:opacity-60"><Bell className="h-3.5 w-3.5" /> Relancer</button>
                          </>
                        )}
                        {p.status === 'approved' && <span className="text-xs text-emerald-600 inline-flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" /> Approuvée par le participant</span>}
                        {p.status === 'published' && <span className="text-xs text-green-600 inline-flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" /> Publiée</span>}
                      </div>
                      {lastEmailText(lastEmail[p.registration_id]) && <p className="text-[11px] text-gray-400">{lastEmailText(lastEmail[p.registration_id])}</p>}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* 2b — Jury : ajout au catalogue (pas de page, juste une case) */}
        {co.juryRa && (
          <section>
            <SectionHeader icon={ClipboardCheck} title="Catalogue" />
            <div className="rounded-lg border border-gray-100 bg-white p-3">
              <button type="button" onClick={() => props.onToggleListing(co.juryRa!, !co.listed)} disabled={busy === `list:${co.juryRa}`}
                className={`w-full flex items-center gap-2.5 rounded-md border px-3 py-2.5 text-left transition-colors disabled:opacity-60 ${co.listed ? 'bg-teal-50 border-teal-200' : 'bg-white border-gray-200 hover:bg-gray-50'}`}>
                {busy === `list:${co.juryRa}` ? <Loader2 className="h-5 w-5 animate-spin text-gray-400 shrink-0" /> : co.listed ? <CheckSquare className="h-5 w-5 text-teal-600 shrink-0" /> : <Square className="h-5 w-5 text-gray-400 shrink-0" />}
                <span className={`text-sm font-medium ${co.listed ? 'text-teal-800' : 'text-gray-800'}`}>{co.listed ? 'Ajouté au catalogue' : 'Marquer comme ajouté au catalogue'}</span>
              </button>
              <p className="text-[11px] text-gray-500 mt-2">Le jury est simplement listé dans le catalogue — pas de page à concevoir ni de validation. Cochez pour votre suivi ; le juré n'est pas notifié.</p>
            </div>
          </section>
        )}

        {/* 3 — Media kit */}
        <section>
          <SectionHeader icon={ImageIcon} title="Media kit" />
          <p className="text-xs text-gray-500 mb-2">Uploadez les visuels que la société peut publier, puis notifiez-la. Le statut indique qui a reçu / ouvert / téléchargé le sien.</p>
          <MediaKitRow
            p={{ reg_id: co.reg_id, name: co.contact, company: co.company, thumb: thumbSrc(co.thumb), roles: co.roles }}
            eventId={eventId} uid={uid} initial={kitInitial}
            onStatus={props.reportKitStatus} onData={props.reportKitData}
          />
        </section>
      </div>
    </div>
  );
}

function SectionHeader({ icon: Icon, title }: { icon: ComponentType<{ className?: string }>; title: string }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <Icon className="h-4 w-4 text-primary" />
      <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
    </div>
  );
}
