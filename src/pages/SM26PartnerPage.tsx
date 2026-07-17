import { useState, useEffect, useRef, ComponentType, ReactNode } from 'react';
import { Helmet } from 'react-helmet-async';
import {
  RefreshCw, FileText, ExternalLink, Building2, Mic, BookOpen, CalendarDays, Lock, MapPin,
  Lightbulb, Scale, Image as ImageIcon, ChevronRight, ChevronDown, Download, AlertTriangle, CheckCircle2,
  Upload, Loader2, MessageSquare, Eye, Ruler, Trash2,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { SM26BackLink } from '@/components/sm26/SM26BackLink';
import { SM26PartnerSponsors } from '@/components/sm26/SM26PartnerSponsors';
import { ECAT_STATUS_LABEL, ecatStatusClass } from '@/components/admin/AdminSM26Ecat';
import { downloadDossierZip, downloadAsset } from '@/lib/dossierExport';
import { SM26MediaKitBoard } from '@/components/sm26/SM26MediaKitBoard';

// Yacht Club / event-partner scoped view, geared to building the e-catalogue.
// Drill into any entry to see its content + uploaded assets and what's still
// missing. Contact details are shown only for the roles whose catalogue page the
// Yacht Club builds — innovations, marinas and architecture — never for jury
// (anonymous), sponsors or speakers (M3 owns those). Server-enforced in
// sm_partner_entry_dossier.

interface Entry {
  role_assignment_id: string; reg_id: string; role: string;
  name: string | null; company: string | null; job_title: string | null; country: string | null; thumb: string | null;
  payment_status: string | null; jury_scope: string | null;
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

const TZ = 'Europe/Monaco';
const fmtTime = (s: string | null) => s ? new Date(s).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: TZ }) : '';
const dayKey = (s: string | null) => s ? new Date(s).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ }) : 'TBD';
const ECAT_STATUSES = ['awaiting_export', 'exported', 'in_design', 'uploaded', 'changes_requested', 'approved', 'published'];

const ASSET_KEYS = new Set(['logo', 'logo_url', 'photo', 'photo_url', 'banner', 'deck', 'deck_url', 'slides', 'hero_image', 'press_card', 'proof_of_enrolment', 'panels', 'notice', 'pitch_media', 'pitch_media_url', 'product_images', 'renders', 'project_renders', 'company_image_url', 'hd_images', 'building_images', 'pitch_deck', 'contact_photo']);
// Not catalogue-relevant / commercially sensitive fundraising fields are never
// shown to the Yacht Club catalogue team.
const STARTUP_SKIP = new Set(['id', 'role_assignment_id', 'event_id', 'created_at', 'updated_at', 'visibility_level', 'pitch_optin', 'social_links', 'logo_url', 'deck_url', 'product_images', 'pitch_media_url', 'investment_seeking', 'investment_stage', 'investment_type', 'funds_needed']);
const isHttp = (s: string) => /^https?:\/\//i.test(s);
const isImg = (s: string) => /\.(png|jpe?g|webp|gif|svg)$/i.test(s.split('?')[0]);
const prettyKey = (k: string) => k.replace(/_url$/, '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

// Social links reach us three ways: individual module_data keys (marina), a
// module_data.social_links object (jury), or sm_startup_profile.social_links
// (startups). Collect them all into one clickable "Social media" list.
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

const ROLE_META: Record<string, { label: string; icon: typeof Building2; singular: string }> = {
  startup: { label: 'Innovations', icon: Lightbulb, singular: 'innovation' },
  marina: { label: 'Marinas', icon: MapPin, singular: 'marina' },
  architect_pro: { label: 'Architecture · Pro', icon: Ruler, singular: 'architecture entry' },
  architect_student: { label: 'Architecture · Student', icon: Ruler, singular: 'architecture entry' },
  jury: { label: 'Jury', icon: Scale, singular: 'juror' },
  sponsor: { label: 'Sponsors', icon: Building2, singular: 'sponsor' },
  speaker: { label: 'Speakers', icon: Mic, singular: 'speaker' },
};

// Collapsible section so the console is a compact index the Yacht Club expands
// only where they need to work (media kits, a catalogue role, the programme…).
function CollapsiblePanel({ title, icon: Icon, count, description, defaultOpen = false, children }: {
  title: string;
  icon: ComponentType<{ className?: string }>;
  count?: number;
  description?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card>
      <button type="button" onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-2 px-4 py-3.5 text-left">
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

// Absolute URL for an external link — many entries store a bare host (no scheme),
// which as an href resolves relative to our app and 404s.
const toHref = (u: string) => /^https?:\/\//i.test(u.trim()) ? u.trim() : `https://${u.trim()}`;

// A role's entry list. Defined at MODULE level (not inside SM26PartnerPage) so it
// keeps a stable component identity across the page's re-renders — otherwise every
// re-render (e.g. opening a dossier) remounts it and collapses its panel.
function RoleSection({ role, list, thumbSrc, onOpen }: {
  role: string;
  list: Entry[];
  thumbSrc: (t: string | null) => string | null;
  onOpen: (ra: string) => void;
}) {
  const meta = ROLE_META[role];
  const Icon = meta.icon;
  const desc = role === 'startup' ? 'Full profile, contact and uploaded images for the catalogue.'
    : role === 'jury' ? 'Logo, photo, job title & bio for the catalogue — no contact details.'
    : role === 'marina' ? 'Marina profile & images for the catalogue.'
    : role.startsWith('architect') ? "The firm's catalogue details — never the anonymous competition boards."
    : undefined;
  return (
    <CollapsiblePanel title={meta.label} icon={Icon} count={list.length} description={desc}>
      {list.length === 0 ? (
        <p className="text-sm text-gray-400">No {meta.label.toLowerCase()} yet.</p>
      ) : (
        <div className="grid sm:grid-cols-2 gap-2">
          {list.map(e => {
            const title = e.company || e.name || 'Entry';
            const sub = [e.company ? e.name : null, e.job_title].filter(Boolean).join(' · ');
            const src = thumbSrc(e.thumb);
            return (
              <button key={e.role_assignment_id} onClick={() => onOpen(e.role_assignment_id)}
                className="flex items-center gap-3 text-left rounded-lg border border-gray-100 hover:border-primary/40 hover:bg-gray-50 p-2.5 transition-colors">
                <div className="w-10 h-10 rounded-lg bg-white border border-gray-100 flex items-center justify-center shrink-0 overflow-hidden">
                  {src ? <img src={src} alt="" className="w-full h-full object-contain p-0.5" /> : <Icon className="h-5 w-5 text-gray-300" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-gray-900 truncate">{title}</div>
                  {sub && <div className="text-xs text-gray-500 truncate">{sub}</div>}
                  {e.payment_status && (
                    <span className={`inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded-full border ${
                      e.payment_status === 'paid' ? 'bg-green-50 text-green-700 border-green-200'
                      : e.payment_status === 'free' ? 'bg-gray-50 text-gray-500 border-gray-200'
                      : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
                      {e.payment_status === 'paid' ? 'Paid' : e.payment_status === 'free' ? 'Free entry' : 'Awaiting payment'}
                    </span>
                  )}
                  {e.role === 'jury' && e.jury_scope && (
                    <span className="inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded-full border bg-primary/5 text-primary border-primary/20">
                      {e.jury_scope === 'both' ? 'Innovation + Architecture' : e.jury_scope === 'architecture' ? 'Architecture' : 'Innovation'}
                    </span>
                  )}
                </div>
                <ChevronRight className="h-4 w-4 text-gray-300 shrink-0" />
              </button>
            );
          })}
        </div>
      )}
    </CollapsiblePanel>
  );
}

export function SM26PartnerPage() {
  const { user, loading: authLoading } = useAuth();
  const [eventId, setEventId] = useState<string | null>(null);
  const [access, setAccess] = useState<'loading' | 'ok' | 'denied'>('loading');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [ecat, setEcat] = useState<EcatRow[]>([]);
  const [changeImgs, setChangeImgs] = useState<Record<string, ChangeImg[]>>({});
  const [sessions, setSessions] = useState<Session[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // dossier modal
  const [openId, setOpenId] = useState<string | null>(null);
  const [dossier, setDossier] = useState<(DossierRow & Built & { signed: Record<string, string> }) | null>(null);
  const [dossierLoading, setDossierLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [sendingMsg, setSendingMsg] = useState(false);

  useEffect(() => { if (!authLoading) load(); /* eslint-disable-next-line */ }, [authLoading, user]);

  const load = async () => {
    const { data: ev } = await supabase.from('sm_event').select('id').eq('slug', 'sm26').maybeSingle();
    if (!ev) { setAccess('denied'); return; }
    const eid = (ev as { id: string }).id;
    setEventId(eid);
    const { data: ent, error } = await supabase.rpc('sm_partner_entries', { p_event_id: eid });
    if (error) { setAccess('denied'); return; }
    setAccess('ok');
    const rows = (ent || []) as Entry[];
    setEntries(rows);
    const [{ data: ec }, { data: ag }] = await Promise.all([
      supabase.rpc('sm_partner_ecat', { p_event_id: eid }),
      supabase.rpc('sm_agenda', { p_event_id: eid }),
    ]);
    const ecRows = (ec || []) as EcatRow[];
    setEcat(ecRows);
    setSessions((ag || []) as Session[]);
    // Sign the reference images participants attached to change requests (server-side; the designer can't read the participant's folder directly).
    if (ecRows.some(r => r.status === 'changes_requested' && r.change_attachments?.length)) {
      supabase.functions.invoke('sm26-ecat-change-files', { body: { event_id: eid } })
        .then(res => setChangeImgs(((res?.data as { byPage?: Record<string, ChangeImg[]> } | null)?.byPage) || {}))
        .catch(() => {});
    }
    // sign storage-path thumbnails (http thumbs render directly)
    const signed: Record<string, string> = {};
    await Promise.all(rows.filter(r => r.thumb && !isHttp(r.thumb)).map(async r => {
      const { data: s } = await supabase.storage.from('event-media').createSignedUrl(r.thumb as string, 1800);
      if (s) signed[r.thumb as string] = s.signedUrl;
    }));
    setThumbs(signed);
  };

  const openEntry = async (ra: string) => {
    setOpenId(ra); setDossier(null); setDossierLoading(true);
    const { data, error } = await supabase.rpc('sm_partner_entry_dossier', { p_ra: ra });
    const row = (data && (data as DossierRow[])[0]) || null;
    if (error || !row) { toast({ title: 'Could not open dossier', variant: 'destructive' }); setDossierLoading(false); setOpenId(null); return; }
    const built = buildDossier(row);
    const signed: Record<string, string> = {};
    await Promise.all(built.assets.filter(a => isImg(a.value) && !isHttp(a.value)).map(async a => {
      const { data: s } = await supabase.storage.from('event-media').createSignedUrl(a.value, 600);
      if (s) signed[a.value] = s.signedUrl;
    }));
    setDossier({ ...row, ...built, signed });
    setDossierLoading(false);
  };

  const openAsset = async (value: string) => {
    if (isHttp(value)) { window.open(value, '_blank'); return; }
    const { data } = await supabase.storage.from('event-media').createSignedUrl(value, 300);
    if (data) window.open(data.signedUrl, '_blank');
  };

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

  // Remove a wrongly-uploaded designed page: clear the file + return to "Designing".
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

  // Yacht Club asks a participant to update / provide something for the catalogue.
  const sendPartnerMessage = async (ra: string) => {
    if (!msg.trim()) return;
    setSendingMsg(true);
    const { error } = await supabase.rpc('sm_partner_message', { p_ra: ra, p_message: msg.trim() });
    setSendingMsg(false);
    if (error) { toast({ title: 'Could not send', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Request sent to the participant' });
    setMsg('');
  };

  // One-click "everything" export for the catalogue designers: a .zip holding a
  // readable PDF (all base fields, every text answer, inline images) plus an
  // assets/ folder with every original image and file at full quality.
  const downloadDossier = async () => {
    if (!dossier) return;
    const d = dossier;
    setBusy('dossier');
    try {
      await downloadDossierZip({
        company: d.company, name: d.name, job_title: d.job_title, country: d.country,
        website: d.website, email: d.email,
        roleLabel: d.role ? (ROLE_META[d.role]?.singular || d.role) : null,
        text: [...d.text, ...d.social.map(s => ({ label: s.label, value: s.url }))], assets: d.assets, signed: d.signed, missing: d.missing,
      });
      toast({ title: 'Dossier downloaded', description: 'A .zip with the PDF summary and all original files.' });
    } catch {
      toast({ title: 'Could not build the dossier', variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  // Direct download of a single asset (the real file, not an open-in-tab).
  const downloadOne = async (value: string) => {
    try { await downloadAsset(value, dossier?.signed || {}); }
    catch { toast({ title: 'Could not download the file', variant: 'destructive' }); }
  };

  // Change-request images are already server-signed (the designer can't re-sign
  // the participant's folder), so download straight from the signed URL.
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

  if (authLoading || access === 'loading') return <div className="flex items-center justify-center h-[60vh]"><RefreshCw className="h-8 w-8 animate-spin text-primary" /></div>;
  if (access === 'denied') return (
    <div className="container mx-auto px-4 py-16 max-w-md text-center">
      <Lock className="h-10 w-10 text-gray-300 mx-auto mb-3" />
      <h1 className="text-2xl font-bold mb-2">Partner access only</h1>
      <p className="text-gray-600">This area is for the event's partner organisations. If you should have access, contact <a href="mailto:events@m3monaco.com" className="text-primary">events@m3monaco.com</a>.</p>
    </div>
  );

  const byRole = (role: string) => entries.filter(e => e.role === role);
  const days: { key: string; items: Session[] }[] = [];
  for (const s of sessions) { const k = dayKey(s.starts_at); let d = days.find(x => x.key === k); if (!d) { d = { key: k, items: [] }; days.push(d); } d.items.push(s); }

  const thumbSrc = (t: string | null) => !t ? null : isHttp(t) ? t : (thumbs[t] || null);

  return (
    <div className="min-h-screen bg-gray-50">
      <Helmet><title>Partner area — SM26</title></Helmet>
      <section className="bg-gradient-to-br from-[#0b2653] to-[#143a6b] text-white">
        <div className="container mx-auto px-4 py-10">
          <div className="mb-3"><SM26BackLink light /></div>
          <p className="uppercase tracking-wide text-white/60 text-sm mb-2">SM26 · Partner area</p>
          <h1 className="text-2xl lg:text-3xl font-bold">Yacht Club &amp; partners</h1>
          <p className="text-white/80 mt-2 max-w-2xl">Open any entry to see its content and uploaded assets for the e-catalogue, and what's still missing.</p>
        </div>
      </section>

      <div className="container mx-auto px-4 py-8 max-w-3xl space-y-6">
        {/* Media kits — social visuals for participants to post (flat workspace) */}
        {eventId && (
          <CollapsiblePanel title="Media kits" icon={ImageIcon}
            description="Upload the social visuals each participant can post about the event, then notify them — all from here. The status shows who has received and opened theirs.">
            <SM26MediaKitBoard eventId={eventId} />
          </CollapsiblePanel>
        )}

        <RoleSection role="startup" list={byRole('startup')} thumbSrc={thumbSrc} onOpen={openEntry} />
        <RoleSection role="marina" list={byRole('marina')} thumbSrc={thumbSrc} onOpen={openEntry} />
        <RoleSection role="architect_pro" list={byRole('architect_pro')} thumbSrc={thumbSrc} onOpen={openEntry} />
        <RoleSection role="architect_student" list={byRole('architect_student')} thumbSrc={thumbSrc} onOpen={openEntry} />
        <RoleSection role="jury" list={byRole('jury')} thumbSrc={thumbSrc} onOpen={openEntry} />
        <CollapsiblePanel title="Sponsors — deliverables" icon={Building2}
          description="Tick each item as it is produced for the sponsor, and download each sponsor's uploaded assets.">
          <SM26PartnerSponsors embedded />
        </CollapsiblePanel>
        <RoleSection role="speaker" list={byRole('speaker')} thumbSrc={thumbSrc} onOpen={openEntry} />

        {/* Programme (read-only) */}
        <CollapsiblePanel title="Programme" icon={CalendarDays} count={sessions.length} description="Read-only — the schedule is managed by M3.">
          <div className="space-y-4">
            {days.length === 0 ? <p className="text-sm text-gray-400">The programme will be published soon.</p> : days.map(day => (
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

        {/* E-catalogue — design + upload for participant review */}
        <CollapsiblePanel title="E-catalogue pages" icon={BookOpen} count={ecat.length} description="Set a page to “Designing”, then upload the designed PDF — the participant is asked to approve it or request changes.">
          <div className="space-y-2">
            {ecat.length === 0 ? <p className="text-sm text-gray-400">No catalogue pages yet.</p> : ecat.map(p => {
              const busyRow = busy === p.id;
              return (
                <div key={p.id} className="rounded-lg border border-gray-100 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm font-medium text-gray-800 truncate">{p.title}</span>
                      <Badge variant="outline" className="text-[10px] capitalize">{p.kind}</Badge>
                      <Badge className={`text-[10px] ${ecatStatusClass(p.status)}`}>{ECAT_STATUS_LABEL[p.status] || p.status}</Badge>
                    </div>
                    <Select value={p.status} onValueChange={v => setEcatStatus(p.id, v)} disabled={busyRow}>
                      <SelectTrigger className="w-40 h-8 text-xs"><SelectValue /></SelectTrigger>
                      {/* 'approved' is the participant's step and 'published' is M3's — a partner sets only the design/upload states (also enforced server-side). */}
                      <SelectContent>{ECAT_STATUSES.filter(s => s !== 'approved' && s !== 'published').map(s => <SelectItem key={s} value={s}>{ECAT_STATUS_LABEL[s] || s}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>

                  {p.status === 'changes_requested' && p.changes_note && (
                    <div className="rounded-md bg-red-50 border border-red-100 px-2.5 py-1.5 text-xs text-red-700 flex items-start gap-1.5">
                      <MessageSquare className="h-3.5 w-3.5 mt-0.5 shrink-0" /> <span><span className="font-medium">Changes requested:</span> {p.changes_note}</span>
                    </div>
                  )}

                  {p.status === 'changes_requested' && (changeImgs[p.id]?.length ?? 0) > 0 && (
                    <div className="rounded-md bg-amber-50 border border-amber-100 px-2.5 py-2">
                      <div className="text-[11px] font-medium text-amber-800 mb-1.5 flex items-center gap-1.5"><ImageIcon className="h-3.5 w-3.5" /> Images the participant attached</div>
                      <div className="flex flex-wrap gap-2">
                        {changeImgs[p.id].map(img => (
                          <div key={img.path} className="relative">
                            {img.is_image && img.url ? (
                              <button onClick={() => img.url && window.open(img.url, '_blank')} title={`Open ${img.filename}`} className="block h-16 w-16 rounded-md border border-amber-200 overflow-hidden bg-white hover:ring-2 hover:ring-primary/30">
                                <img src={img.url} alt={img.filename} className="h-full w-full object-contain" />
                              </button>
                            ) : (
                              <button onClick={() => img.url && window.open(img.url, '_blank')} title={img.filename} className="h-16 w-16 rounded-md border border-amber-200 flex flex-col items-center justify-center gap-1 text-[9px] text-gray-600 hover:bg-white p-1">
                                <Download className="h-3.5 w-3.5 text-gray-400" /><span className="truncate w-full text-center">{img.filename}</span>
                              </button>
                            )}
                            <button onClick={() => downloadChangeImg(img)} title="Download" className="absolute -bottom-1.5 -right-1.5 bg-white border border-gray-200 rounded-full p-0.5 text-gray-500 hover:text-primary shadow-sm">
                              <Download className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-2 flex-wrap">
                    <input ref={el => { fileRefs.current[p.id] = el; }} type="file" accept="application/pdf,image/*" className="hidden"
                      onChange={e => { const f = e.target.files?.[0]; if (f) uploadDesigned(p, f); e.target.value = ''; }} />
                    <button type="button" onClick={() => fileRefs.current[p.id]?.click()} disabled={busyRow}
                      className="inline-flex items-center gap-1.5 text-xs font-medium border border-gray-200 rounded-md px-2.5 py-1.5 hover:bg-gray-50 disabled:opacity-60">
                      {busyRow ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                      {p.designed_file_path ? 'Replace designed page' : 'Upload designed page'}
                    </button>
                    {p.designed_file_path && (
                      <button type="button" onClick={() => previewEcat(p.designed_file_path!)}
                        className="inline-flex items-center gap-1.5 text-xs text-gray-600 border border-gray-200 rounded-md px-2.5 py-1.5 hover:bg-gray-50">
                        <Eye className="h-3.5 w-3.5" /> Preview
                      </button>
                    )}
                    {p.designed_file_path && p.status !== 'approved' && p.status !== 'published' && (
                      <button type="button" onClick={() => removeEcat(p)} disabled={busyRow}
                        className="inline-flex items-center gap-1.5 text-xs text-gray-600 border border-gray-200 rounded-md px-2.5 py-1.5 hover:bg-red-50 hover:text-red-600 disabled:opacity-60">
                        <Trash2 className="h-3.5 w-3.5" /> Remove
                      </button>
                    )}
                    {p.status === 'uploaded' && <span className="text-xs text-blue-600 inline-flex items-center gap-1">Awaiting participant approval</span>}
                    {p.status === 'approved' && <span className="text-xs text-emerald-600 inline-flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" /> Approved by participant</span>}
                    {p.status === 'published' && <span className="text-xs text-green-600 inline-flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" /> Published</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </CollapsiblePanel>

        <p className="text-xs text-gray-400 text-center">
          <ExternalLink className="h-3 w-3 inline mr-1" /> The full attendee list isn't shown here. For anything else, contact events@m3monaco.com.
        </p>
      </div>

      {/* Entry dossier */}
      <Dialog open={!!openId} onOpenChange={(o) => { if (!o) { setOpenId(null); setDossier(null); setMsg(''); } }}>
        <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto">
          {dossierLoading || !dossier ? (
            <div className="flex items-center justify-center h-40"><RefreshCw className="h-6 w-6 animate-spin text-gray-300" /></div>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="text-xl">{dossier.company || dossier.name || 'Entry'}</DialogTitle>
                <div className="text-sm text-gray-500 flex flex-wrap gap-x-3 gap-y-0.5">
                  {dossier.company && dossier.name && <span>{dossier.name}</span>}
                  {dossier.job_title && <span>{dossier.job_title}</span>}
                  {dossier.country && <span>{dossier.country}</span>}
                  {dossier.website && <a href={toHref(dossier.website)} target="_blank" rel="noreferrer" className="text-primary inline-flex items-center gap-1">{dossier.website.replace(/^https?:\/\//, '')} <ExternalLink className="h-3 w-3" /></a>}
                  {dossier.email && <a href={`mailto:${dossier.email}`} className="text-primary">{dossier.email}</a>}
                </div>
              </DialogHeader>

              <div className="flex justify-end -mt-2">
                <button onClick={downloadDossier} disabled={busy === 'dossier'}
                  className="inline-flex items-center gap-1.5 text-xs font-medium border border-gray-200 rounded-md px-2.5 py-1.5 hover:bg-gray-50 disabled:opacity-60">
                  {busy === 'dossier' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} Download full dossier (.zip)
                </button>
              </div>

              {dossier.missing.length > 0 ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span><span className="font-medium">Missing for the catalogue:</span> {dossier.missing.join(', ')}.</span>
                </div>
              ) : (
                <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 shrink-0" /> All required catalogue info provided.
                </div>
              )}

              {dossier.social.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Social media</h3>
                  <div className="flex flex-wrap gap-2">
                    {dossier.social.map((s, i) => (
                      <a key={i} href={toHref(s.url)} target="_blank" rel="noreferrer"
                        className="inline-flex items-center gap-1.5 text-sm text-primary border border-gray-200 rounded-md px-2.5 py-1.5 hover:bg-gray-50">
                        {s.label} <ExternalLink className="h-3 w-3" />
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {dossier.assets.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Images &amp; files</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {dossier.assets.map((a, i) => {
                      const src = isHttp(a.value) ? (isImg(a.value) ? a.value : null) : dossier.signed[a.value];
                      const filename = a.value.split('/').pop()?.split('?')[0] || 'file';
                      return (
                        <div key={i} className="border border-gray-100 rounded-lg p-2">
                          <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-1.5 truncate" title={a.label}>{a.label}</div>
                          {isImg(a.value) && src ? (
                            <button onClick={() => openAsset(a.value)} className="block w-full">
                              <img src={src} alt={a.label} className="w-full h-24 object-contain rounded-md bg-gray-50" />
                            </button>
                          ) : (
                            <button onClick={() => openAsset(a.value)} className="flex items-center gap-1.5 text-xs text-primary py-3">
                              {isImg(a.value) ? <ImageIcon className="h-4 w-4" /> : <FileText className="h-4 w-4" />} <span className="truncate">{filename}</span>
                            </button>
                          )}
                          <button onClick={() => downloadOne(a.value)} className="mt-1.5 w-full inline-flex items-center justify-center gap-1 text-[11px] text-gray-600 border border-gray-200 rounded-md py-1 hover:bg-gray-50">
                            <Download className="h-3 w-3" /> Download
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {dossier.text.length > 0 && (
                <div className="space-y-3 mt-1">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Details</h3>
                  {dossier.text.map((t, i) => (
                    <div key={i}>
                      <div className="text-[11px] uppercase tracking-wide text-gray-400">{t.label}</div>
                      <div className="text-sm text-gray-800 whitespace-pre-wrap">{t.value}</div>
                    </div>
                  ))}
                </div>
              )}

              {dossier.assets.length === 0 && dossier.text.length === 0 && dossier.social.length === 0 && (
                <p className="text-sm text-gray-400">No profile content captured yet.</p>
              )}

              {/* Request a change / ask the participant for info */}
              <div className="border-t pt-3 mt-1">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5 flex items-center gap-1.5"><MessageSquare className="h-3.5 w-3.5" /> Request a change / ask for info</h3>
                <textarea value={msg} onChange={e => setMsg(e.target.value)} rows={2}
                  placeholder="e.g. Please send a higher-resolution logo (min 1000 px) for the catalogue."
                  className="w-full text-sm border border-gray-200 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary" />
                <div className="flex justify-end mt-2">
                  <button type="button" disabled={sendingMsg || !msg.trim()} onClick={() => openId && sendPartnerMessage(openId)}
                    className="inline-flex items-center gap-1.5 text-xs font-medium bg-primary text-white rounded-md px-3 py-1.5 hover:bg-primary/90 disabled:opacity-60">
                    {sendingMsg ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MessageSquare className="h-3.5 w-3.5" />} Send to participant
                  </button>
                </div>
                <p className="text-[11px] text-gray-400 mt-1">The participant is notified in their account to update their entry.</p>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
