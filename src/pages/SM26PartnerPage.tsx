import { useState, useEffect, useRef } from 'react';
import { Helmet } from 'react-helmet-async';
import {
  RefreshCw, FileText, ExternalLink, Building2, Mic, BookOpen, CalendarDays, Lock, MapPin,
  Lightbulb, Scale, Image as ImageIcon, ChevronRight, Download, AlertTriangle, CheckCircle2,
  Upload, Loader2, MessageSquare, Eye,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { SM26BackLink } from '@/components/sm26/SM26BackLink';
import { ECAT_STATUS_LABEL, ecatStatusClass } from '@/components/admin/AdminSM26Ecat';

// Yacht Club / event-partner scoped view, geared to building the e-catalogue.
// Drill into any entry to see its content + uploaded assets and what's still
// missing. Contact details are shown ONLY for innovations (never sponsors,
// speakers or jury — server-enforced in sm_partner_entry_dossier).

interface Entry {
  role_assignment_id: string; reg_id: string; role: string;
  name: string | null; company: string | null; job_title: string | null; country: string | null; thumb: string | null;
  payment_status: string | null;
}
interface EcatRow { id: string; registration_id: string; kind: string; status: string; title: string; designed_file_path: string | null; changes_note: string | null }
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

const ASSET_KEYS = new Set(['logo', 'logo_url', 'photo', 'photo_url', 'banner', 'deck', 'deck_url', 'slides', 'hero_image', 'press_card', 'proof_of_enrolment', 'panels', 'notice', 'pitch_media', 'pitch_media_url', 'product_images']);
const STARTUP_SKIP = new Set(['id', 'role_assignment_id', 'event_id', 'created_at', 'updated_at', 'visibility_level', 'pitch_optin', 'social_links', 'logo_url', 'deck_url', 'product_images', 'pitch_media_url']);
const isHttp = (s: string) => /^https?:\/\//i.test(s);
const isImg = (s: string) => /\.(png|jpe?g|webp|gif|svg)$/i.test(s.split('?')[0]);
const prettyKey = (k: string) => k.replace(/_url$/, '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

interface BuiltAsset { label: string; value: string }
interface Built { text: { label: string; value: string }[]; assets: BuiltAsset[]; missing: string[] }

function isProvided(rq: Requirement, d: DossierRow): boolean {
  const k = rq.field_key;
  if (k === '__job_title') return !!d.job_title;
  if (k === 'website') return !!d.website;
  const md = d.module_data || {};
  const v = md[k];
  if (v != null && v !== '' && !(Array.isArray(v) && v.length === 0)) return true;
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
  const md = d.module_data || {};
  for (const [k, v] of Object.entries(md)) {
    if (v == null || v === '') continue;
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
  return { text, assets, missing };
}

const ROLE_META: Record<string, { label: string; icon: typeof Building2; singular: string }> = {
  startup: { label: 'Innovations', icon: Lightbulb, singular: 'innovation' },
  jury: { label: 'Jury', icon: Scale, singular: 'juror' },
  sponsor: { label: 'Sponsors', icon: Building2, singular: 'sponsor' },
  speaker: { label: 'Speakers', icon: Mic, singular: 'speaker' },
};

export function SM26PartnerPage() {
  const { user, loading: authLoading } = useAuth();
  const [eventId, setEventId] = useState<string | null>(null);
  const [access, setAccess] = useState<'loading' | 'ok' | 'denied'>('loading');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [ecat, setEcat] = useState<EcatRow[]>([]);
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
    setEcat((ec || []) as EcatRow[]);
    setSessions((ag || []) as Session[]);
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

  // One-click "everything" export for the catalogue designers: a self-contained
  // HTML file with all base fields, every text answer, and images inlined as data
  // URIs (so it survives signed-URL expiry). Open in a browser / print to PDF.
  const downloadDossier = async () => {
    if (!dossier) return;
    const d = dossier;
    setBusy('dossier');
    try {
      const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const title = d.company || d.name || 'Entry';
      const baseRows: [string, string | null][] = [
        ['Name', d.name], ['Company', d.company], ['Job title', d.job_title],
        ['Country', d.country], ['Website', d.website], ['Email', d.email],
      ];
      const imgBlocks: string[] = [];
      const fileRows: string[] = [];
      for (const a of d.assets) {
        if (isImg(a.value)) {
          const src = isHttp(a.value) ? a.value : d.signed[a.value];
          let uri = src || '';
          try {
            if (src) {
              const blob = await (await fetch(src)).blob();
              uri = await new Promise<string>((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = rej; fr.readAsDataURL(blob); });
            }
          } catch { /* keep the (possibly signed) direct URL */ }
          if (uri) imgBlocks.push(`<figure><img src="${uri}" alt="${esc(a.label)}"/><figcaption>${esc(a.label)}</figcaption></figure>`);
        } else {
          const fn = a.value.split('/').pop()?.split('?')[0] || 'file';
          fileRows.push(`<li><strong>${esc(a.label)}:</strong> ${esc(fn)}</li>`);
        }
      }
      const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"/><title>${esc(title)} — SM26 dossier</title>
<style>body{font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:780px;margin:32px auto;padding:0 20px;color:#16264a;line-height:1.5}
h1{font-size:24px;margin:0 0 2px}.sub{color:#6b7a99;margin:0 0 22px}
h2{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#8b96b0;border-bottom:1px solid #eef0f4;padding-bottom:5px;margin:26px 0 10px}
table{width:100%;border-collapse:collapse}td{padding:4px 6px;vertical-align:top}td.k{color:#6b7a99;width:140px}
.field{margin:0 0 14px}.field .l{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#9aa3ba;margin-bottom:1px}.field .v{white-space:pre-wrap}
figure{display:inline-block;margin:0 14px 14px 0;text-align:center}img{max-width:230px;max-height:190px;border:1px solid #eef0f4;border-radius:8px;display:block}
figcaption{font-size:10px;color:#9aa3ba;text-transform:uppercase;margin-top:3px}ul{padding-left:18px}</style></head>
<body>
<h1>${esc(title)}</h1>
<p class="sub">Smart &amp; Sustainable Marina Rendezvous 2026${d.role ? ` · ${esc(ROLE_META[d.role]?.singular || d.role)}` : ''}</p>
<h2>Contact &amp; profile</h2>
<table>${baseRows.filter(([, v]) => v).map(([k, v]) => `<tr><td class="k">${esc(k)}</td><td>${esc(String(v))}</td></tr>`).join('')}</table>
${d.text.length ? `<h2>Details</h2>${d.text.map(t => `<div class="field"><div class="l">${esc(t.label)}</div><div class="v">${esc(t.value)}</div></div>`).join('')}` : ''}
${imgBlocks.length ? `<h2>Images</h2>${imgBlocks.join('')}` : ''}
${fileRows.length ? `<h2>Other files</h2><ul>${fileRows.join('')}</ul><p style="font-size:11px;color:#9aa3ba">Download these from the entry in the partner area.</p>` : ''}
${d.missing.length ? `<h2>Still missing for the catalogue</h2><p>${esc(d.missing.join(', '))}</p>` : ''}
</body></html>`;
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const base = (d.company || d.name || 'entry').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'entry';
      link.href = url; link.download = `${base}-sm26-dossier.html`;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      toast({ title: 'Dossier downloaded', description: 'Open it in a browser — print to PDF if you need a PDF.' });
    } catch {
      toast({ title: 'Could not build the dossier', variant: 'destructive' });
    } finally {
      setBusy(null);
    }
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

  const Section = ({ role }: { role: string }) => {
    const meta = ROLE_META[role];
    const list = byRole(role);
    const Icon = meta.icon;
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Icon className="h-5 w-5 text-primary" /> {meta.label} ({list.length})</CardTitle>
          {role === 'startup' && <CardDescription>Full profile, contact and uploaded images for the catalogue.</CardDescription>}
          {role === 'jury' && <CardDescription>Logo, photo, job title &amp; bio for the catalogue — no contact details.</CardDescription>}
        </CardHeader>
        <CardContent>
          {list.length === 0 ? (
            <p className="text-sm text-gray-400">No {meta.label.toLowerCase()} yet.</p>
          ) : (
            <div className="grid sm:grid-cols-2 gap-2">
              {list.map(e => {
                const title = e.company || e.name || 'Entry';
                const sub = [e.company ? e.name : null, e.job_title].filter(Boolean).join(' · ');
                const src = thumbSrc(e.thumb);
                return (
                  <button key={e.role_assignment_id} onClick={() => openEntry(e.role_assignment_id)}
                    className="flex items-center gap-3 text-left rounded-lg border border-gray-100 hover:border-primary/40 hover:bg-gray-50 p-2.5 transition-colors">
                    <div className="w-10 h-10 rounded-lg bg-white border border-gray-100 flex items-center justify-center shrink-0 overflow-hidden">
                      {src ? <img src={src} alt="" className="w-full h-full object-contain p-0.5" /> : <Icon className="h-5 w-5 text-gray-300" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-gray-900 truncate">{title}</div>
                      {sub && <div className="text-xs text-gray-500 truncate">{sub}</div>}
                      {e.role === 'startup' && e.payment_status && (
                        <span className={`inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded-full border ${e.payment_status === 'paid' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
                          {e.payment_status === 'paid' ? 'Paid' : 'Awaiting payment'}
                        </span>
                      )}
                    </div>
                    <ChevronRight className="h-4 w-4 text-gray-300 shrink-0" />
                  </button>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

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
        <Section role="startup" />
        <Section role="jury" />
        <Section role="sponsor" />
        <Section role="speaker" />

        {/* Programme (read-only) */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><CalendarDays className="h-5 w-5 text-primary" /> Programme</CardTitle>
            <CardDescription>Read-only — the schedule is managed by M3.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
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
          </CardContent>
        </Card>

        {/* E-catalogue — design + upload for participant review */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><BookOpen className="h-5 w-5 text-primary" /> E-catalogue pages ({ecat.length})</CardTitle>
            <CardDescription>Set a page to “Designing”, then upload the designed PDF — the participant is asked to approve it or request changes.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
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
                      <SelectContent>{ECAT_STATUSES.map(s => <SelectItem key={s} value={s}>{ECAT_STATUS_LABEL[s] || s}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>

                  {p.status === 'changes_requested' && p.changes_note && (
                    <div className="rounded-md bg-red-50 border border-red-100 px-2.5 py-1.5 text-xs text-red-700 flex items-start gap-1.5">
                      <MessageSquare className="h-3.5 w-3.5 mt-0.5 shrink-0" /> <span><span className="font-medium">Changes requested:</span> {p.changes_note}</span>
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
                    {p.status === 'uploaded' && <span className="text-xs text-blue-600 inline-flex items-center gap-1">Awaiting participant approval</span>}
                    {p.status === 'approved' && <span className="text-xs text-emerald-600 inline-flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" /> Approved by participant</span>}
                    {p.status === 'published' && <span className="text-xs text-green-600 inline-flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" /> Published</span>}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

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
                  {dossier.website && <a href={dossier.website} target="_blank" rel="noreferrer" className="text-primary inline-flex items-center gap-1">{dossier.website.replace(/^https?:\/\//, '')} <ExternalLink className="h-3 w-3" /></a>}
                  {dossier.email && <a href={`mailto:${dossier.email}`} className="text-primary">{dossier.email}</a>}
                </div>
              </DialogHeader>

              <div className="flex justify-end -mt-2">
                <button onClick={downloadDossier} disabled={busy === 'dossier'}
                  className="inline-flex items-center gap-1.5 text-xs font-medium border border-gray-200 rounded-md px-2.5 py-1.5 hover:bg-gray-50 disabled:opacity-60">
                  {busy === 'dossier' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} Download full dossier
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
                          <button onClick={() => openAsset(a.value)} className="mt-1.5 w-full inline-flex items-center justify-center gap-1 text-[11px] text-gray-600 border border-gray-200 rounded-md py-1 hover:bg-gray-50">
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

              {dossier.assets.length === 0 && dossier.text.length === 0 && (
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
