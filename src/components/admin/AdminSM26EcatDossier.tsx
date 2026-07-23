import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { RefreshCw, ArrowLeft, Printer, FileText, Image as ImageIcon, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';

// Printable e-catalogue dossier: the participant's profile content + uploaded
// assets, laid out for the designer (YCM). Open -> Print to PDF.

const isImage = (path: string) => /\.(png|jpe?g|webp|gif)$/i.test(path);
const prettyKey = (k: string) => k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

interface Detail {
  kind: string;
  company: string;
  website: string | null;
  country: string | null;
  textFields: Record<string, string>;
  assets: { field: string; path: string }[];
}

export function AdminSM26EcatDossier() {
  const { pageId } = useParams<{ pageId: string }>();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [signed, setSigned] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => { if (pageId) load(pageId); }, [pageId]);

  const load = async (id: string) => {
    setLoading(true);
    const { data } = await supabase
      .from('sm_ecat_page')
      .select(`kind,
        ra:sm_role_assignment(module_data,
          registration:sm_registration(company_name,first_name,last_name,website,country),
          startup:sm_startup_profile(*), marina:sm_marina_extra(*))`)
      .eq('id', id).maybeSingle();
    if (!data) { setLoading(false); return; }
    const page = data as Record<string, unknown>;
    const ra = page.ra as Record<string, unknown>;
    const reg = (ra.registration || {}) as Record<string, string | null>;
    const startup = (Array.isArray(ra.startup) ? ra.startup[0] : ra.startup) as Record<string, unknown> | undefined;
    const marina = (Array.isArray(ra.marina) ? ra.marina[0] : ra.marina) as Record<string, unknown> | undefined;
    const moduleData = (ra.module_data || {}) as Record<string, unknown>;

    const skip = new Set(['id', 'role_assignment_id', 'event_id', 'organization_id', 'created_at', 'updated_at', 'anon_code', 'logo_url', 'deck_url', 'product_images', 'social_links', 'visibility_level', 'pitch_optin', 'biodiversity_image', 'water_image', 'energy_image', 'waste_image', 'innovation_image', 'security_image']);
    const src = (page.kind === 'startup' ? startup : marina) || {};
    const textFields: Record<string, string> = {};
    for (const [k, v] of Object.entries(src)) {
      if (skip.has(k)) continue;
      if (typeof v === 'string' && v.trim()) textFields[k] = v;
      else if (Array.isArray(v) && v.length) textFields[k] = v.join(', ');
    }
    // assets live in role_assignment.module_data AND (for imported startups) in
    // the sm_startup_profile columns — pull both, deduped by path.
    const assets: { field: string; path: string }[] = [];
    const seenPaths = new Set<string>();
    const pushAsset = (k: string, p: unknown) => { if (typeof p === 'string' && p.includes('/') && !seenPaths.has(p)) { seenPaths.add(p); assets.push({ field: k, path: p }); } };
    for (const [k, v] of Object.entries(moduleData)) {
      if (Array.isArray(v)) v.forEach(p => pushAsset(k, p)); // multi-file assets are stored as a list
      else pushAsset(k, v);
    }
    if (startup) {
      pushAsset('logo', startup.logo_url);
      pushAsset('deck', startup.deck_url);
      pushAsset('pitch_media', startup.pitch_media_url);
      if (Array.isArray(startup.product_images)) startup.product_images.forEach(p => pushAsset('product_image', p));
    }
    if (marina) {
      // Per-criterion evidence images (storage paths, or Jotform URLs for imports).
      for (const k of ['biodiversity_image', 'water_image', 'energy_image', 'waste_image', 'innovation_image', 'security_image']) {
        pushAsset(k, marina[k]);
      }
    }

    setDetail({
      kind: page.kind as string,
      company: reg.company_name || `${reg.first_name || ''} ${reg.last_name || ''}`.trim() || 'Entry',
      website: reg.website, country: reg.country,
      textFields, assets,
    });

    // sign image assets for inline preview
    const urls: Record<string, string> = {};
    for (const a of assets) {
      if (isImage(a.path)) {
        if (/^https?:\/\//i.test(a.path)) { urls[a.path] = a.path; continue; } // imported (Jotform) URL — use as-is
        const { data: s } = await supabase.storage.from('event-media').createSignedUrl(a.path, 600);
        if (s) urls[a.path] = s.signedUrl;
      }
    }
    setSigned(urls);
    setLoading(false);
  };

  const openAsset = async (path: string) => {
    if (/^https?:\/\//i.test(path)) { window.open(path, '_blank'); return; }
    const { data } = await supabase.storage.from('event-media').createSignedUrl(path, 300);
    if (data) window.open(data.signedUrl, '_blank');
  };

  if (loading) return <div className="flex items-center justify-center h-64"><RefreshCw className="h-8 w-8 animate-spin text-gray-400" /></div>;
  if (!detail) return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={() => navigate('/admin/sm26/ecat')} className="gap-1.5"><ArrowLeft className="h-4 w-4" /> Back</Button>
      <p className="text-gray-400">Dossier not found.</p>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between print:hidden">
        <Button variant="ghost" size="sm" onClick={() => navigate('/admin/sm26/ecat')} className="gap-1.5"><ArrowLeft className="h-4 w-4" /> Back to e-catalogue</Button>
        <Button size="sm" className="gap-1.5" onClick={() => window.print()}><Printer className="h-4 w-4" /> Print / Save PDF</Button>
      </div>

      <div className="bg-white rounded-xl shadow-sm p-8 max-w-3xl mx-auto">
        <div className="border-b pb-4 mb-6">
          <p className="text-xs uppercase tracking-wide text-gray-400">SM26 E-catalogue dossier · {detail.kind}</p>
          <h1 className="text-2xl font-bold text-gray-900 mt-1">{detail.company}</h1>
          <div className="text-sm text-gray-500 mt-1 flex gap-3 flex-wrap">
            {detail.country && <span>{detail.country}</span>}
            {detail.website && <a href={detail.website} target="_blank" rel="noreferrer" className="text-primary inline-flex items-center gap-1">{detail.website} <ExternalLink className="h-3 w-3" /></a>}
          </div>
        </div>

        <div className="space-y-4">
          {Object.entries(detail.textFields).map(([k, v]) => (
            <div key={k}>
              <div className="text-[11px] uppercase tracking-wide text-gray-400">{prettyKey(k)}</div>
              <div className="text-sm text-gray-800 whitespace-pre-wrap">{v}</div>
            </div>
          ))}
          {Object.keys(detail.textFields).length === 0 && <p className="text-sm text-gray-400">No profile text captured yet.</p>}
        </div>

        {detail.assets.length > 0 && (
          <div className="mt-8 border-t pt-6">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Assets</h2>
            <div className="grid sm:grid-cols-2 gap-4">
              {detail.assets.map(a => (
                <div key={a.field} className="border border-gray-100 rounded-lg p-3">
                  <div className="text-[11px] uppercase tracking-wide text-gray-400 mb-2">{prettyKey(a.field)}</div>
                  {isImage(a.path) && signed[a.path] ? (
                    <img src={signed[a.path]} alt={a.field} className="max-h-40 rounded-md object-contain" />
                  ) : (
                    <button onClick={() => openAsset(a.path)} className="text-sm text-primary inline-flex items-center gap-1.5">
                      {isImage(a.path) ? <ImageIcon className="h-4 w-4" /> : <FileText className="h-4 w-4" />} {a.path.split('/').pop()}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
