import { useState, useEffect } from 'react';
import { Loader2, Award, Check, Download } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';

// Yacht Club view of the Smart Marina Event sponsors + their deliverables. No
// fees or non-event programs (server-scoped via sm_partner_sponsors). The YCM
// team ticks each deliverable as it is produced (sm_partner_benefit_deliver),
// and can DOWNLOAD each sponsor's uploaded marketing/e-catalogue assets (logos,
// deliverable files, designed e-cat page) via sm-sponsor-assets (signed URLs).

interface Row {
  sponsor_id: string; company_name: string | null;
  benefit_id: string; benefit_name: string | null;
  fulfilment_type: string; status: string; delivered: boolean;
}
interface Group { sponsor_id: string; company_name: string; items: Row[] }
interface Asset { group: string; label: string; filename: string; url: string; is_image: boolean; is_external: boolean }

const GROUP_LABEL: Record<string, string> = { logo: 'Logos & brand', deliverable: 'Uploaded files', ecat: 'E-catalogue page' };

export function SM26PartnerSponsors({ embedded = false }: { embedded?: boolean } = {}) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [assets, setAssets] = useState<Map<string, Asset[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    const [{ data }, assetRes] = await Promise.all([
      supabase.rpc('sm_partner_sponsors'),
      supabase.functions.invoke('sm-sponsor-assets').then(r => r, () => null),
    ]);
    const rows = (data || []) as Row[];
    const by = new Map<string, Group>();
    for (const r of rows) {
      const g = by.get(r.sponsor_id) || { sponsor_id: r.sponsor_id, company_name: r.company_name || 'Sponsor', items: [] };
      g.items.push(r);
      by.set(r.sponsor_id, g);
    }
    setGroups([...by.values()]);

    const am = new Map<string, Asset[]>();
    const list = (assetRes?.data?.sponsors || []) as { sponsor_id: string; assets: Asset[] }[];
    for (const s of list) am.set(s.sponsor_id, s.assets || []);
    setAssets(am);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const toggle = async (r: Row, delivered: boolean) => {
    setBusy(r.benefit_id);
    const { error } = await supabase.rpc('sm_partner_benefit_deliver', { p_benefit_id: r.benefit_id, p_delivered: delivered });
    setBusy(null);
    if (error) { toast({ title: 'Could not update', description: error.message, variant: 'destructive' }); return; }
    setGroups(prev => prev.map(g => ({
      ...g,
      items: g.items.map(x => x.benefit_id === r.benefit_id ? { ...x, delivered, status: delivered ? 'DELIVERED' : 'TODO' } : x),
    })));
  };

  if (loading) return <div className="flex items-center gap-2 text-sm text-gray-400 py-4"><Loader2 className="h-4 w-4 animate-spin" /> Loading sponsors…</div>;
  if (groups.length === 0) return null;

  const rows = groups.map(g => {
          const done = g.items.filter(i => i.delivered).length;
          return (
            <div key={g.sponsor_id} className="rounded-lg border border-gray-100 p-3">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="text-sm font-semibold text-gray-900">{g.company_name}</div>
                <Badge variant="secondary" className="text-[10px]">{done}/{g.items.length} done</Badge>
              </div>
              <div className="space-y-1.5">
                {g.items.map(i => (
                  <label key={i.benefit_id} className="flex items-center gap-2.5 text-sm cursor-pointer rounded-md hover:bg-gray-50 px-1.5 py-1">
                    {busy === i.benefit_id
                      ? <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                      : <Checkbox checked={i.delivered} onCheckedChange={v => toggle(i, v === true)} />}
                    <span className={`flex-1 ${i.delivered ? 'text-gray-500 line-through' : 'text-gray-800'}`}>{i.benefit_name || 'Deliverable'}</span>
                    {i.fulfilment_type === 'SPONSOR_PROVIDES_ASSET' && <Badge variant="outline" className="text-[10px] text-gray-400">sponsor provides</Badge>}
                    {i.delivered && <Check className="h-3.5 w-3.5 text-green-600" />}
                  </label>
                ))}
              </div>

              {/* Downloadable assets the sponsor uploaded — logos, files, e-cat page */}
              {(() => {
                const list = assets.get(g.sponsor_id) || [];
                if (list.length === 0) return <p className="mt-3 text-[11px] text-gray-400">No sponsor files uploaded yet.</p>;
                return (
                  <div className="mt-3 pt-2.5 border-t border-gray-100">
                    <div className="text-[11px] uppercase tracking-wide text-gray-400 mb-1.5">Downloads — marketing &amp; e-catalogue</div>
                    <div className="flex flex-wrap gap-2">
                      {list.map((a, idx) => a.is_image ? (
                        <a key={idx} href={a.url} target="_blank" rel="noreferrer" title={`${a.label} — ${GROUP_LABEL[a.group] || a.group}`}
                          className="relative block h-16 w-16 rounded-md border border-gray-200 overflow-hidden bg-white hover:ring-2 hover:ring-primary/30">
                          <img src={a.url} alt={a.label} className="h-full w-full object-contain" />
                          <span className="absolute bottom-0 right-0 bg-white/90 rounded-tl p-0.5"><Download className="h-3 w-3 text-gray-500" /></span>
                        </a>
                      ) : (
                        <a key={idx} href={a.url} target="_blank" rel="noreferrer" title={GROUP_LABEL[a.group] || a.group}
                          className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 px-2.5 py-1.5 text-xs text-gray-700 hover:bg-gray-50">
                          <Download className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                          <span className="truncate max-w-[12rem]">{a.label}</span>
                        </a>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
          );
  });

  if (embedded) return <div className="space-y-4">{rows}</div>;
  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2"><Award className="h-4 w-4 text-primary" /> Sponsors — deliverables</CardTitle>
        <CardDescription>Tick each item as it is produced for the sponsor. (Fees are managed by M3 and not shown here.)</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">{rows}</CardContent>
    </Card>
  );
}
