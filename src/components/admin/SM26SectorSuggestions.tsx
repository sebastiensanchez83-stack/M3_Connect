import { useState, useEffect, useCallback } from 'react';
import { Lightbulb, Plus, Check, AlertTriangle, Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';

// D2 crosswalk consumer (admin surface). Suggests service sectors for an org from
// the SM26 innovation categories its startup entries chose, translated through
// sm26_category_sector_map. Admin confirms (never a silent write). Categories with
// no map row surface as an alert (fail loud) rather than being dropped — imported
// Jotform categories are free text and land here until the map covers them.

interface SuggData { suggested: { id: string; label: string }[]; unmapped: string[]; }

export function SM26SectorSuggestions({ orgId, onApplied }: { orgId: string; onApplied?: () => void }) {
  const [data, setData] = useState<SuggData | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [applying, setApplying] = useState(false);

  const load = useCallback(async () => {
    const { data: d } = await supabase.rpc('sm_org_sector_suggestions', { p_org_id: orgId });
    setData((d || { suggested: [], unmapped: [] }) as SuggData);
    setLoaded(true);
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  const apply = async (sectorIds: string[]) => {
    if (!sectorIds.length) return;
    setApplying(true);
    const { error } = await supabase.rpc('admin_apply_org_service_sectors', { p_org_id: orgId, p_sector_ids: sectorIds });
    setApplying(false);
    if (error) { toast({ title: 'Could not add sectors', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Sectors added' });
    await load();
    onApplied?.();
  };

  if (!loaded || !data) return null;
  const { suggested, unmapped } = data;
  if (suggested.length === 0 && unmapped.length === 0) return null;

  return (
    <Card>
      <CardContent className="pt-6 space-y-3">
        <div className="text-sm font-medium flex items-center gap-2"><Lightbulb className="h-4 w-4 text-primary" /> Sectors from Smart Marina 2026</div>
        <p className="text-xs text-gray-500 -mt-1">Suggested from this company's SM26 innovation categories, via the category&rarr;sector map. Admin-confirmed.</p>
        {suggested.length > 0 && (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              {suggested.map(s => (
                <button key={s.id} type="button" disabled={applying} onClick={() => apply([s.id])}
                  className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/5 text-primary text-xs px-3 py-1 hover:bg-primary/10 disabled:opacity-50">
                  <Plus className="h-3 w-3" /> {s.label}
                </button>
              ))}
            </div>
            {suggested.length > 1 && (
              <Button size="sm" variant="outline" disabled={applying} onClick={() => apply(suggested.map(s => s.id))} className="gap-1.5">
                {applying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Add all {suggested.length}
              </Button>
            )}
          </div>
        )}
        {unmapped.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 flex items-start gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>Not mapped to a sector: <strong>{unmapped.join(', ')}</strong>. These SM26 categories aren't in the category&rarr;sector map (often free text from an import) &mdash; add them to the map, or set the org's sectors manually.</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
