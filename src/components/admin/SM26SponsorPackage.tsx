import { useState, useEffect } from 'react';
import { Loader2, Save, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';

// Per-sponsor entitlement editor. Sponsors have negotiated packages, so each
// benefit is ticked (and quotas set) individually. Presets seed a baseline the
// admin can then fine-tune. Grants live in sm_sponsor_entitlement.

interface Benefit { key: string; label: string; kind: string; display_order: number; }
type Val = { granted: boolean; quota: string };

// Baseline packages — admin applies one, then adjusts. Numeric value = quota.
const PRESETS: Record<string, Record<string, boolean | number>> = {
  Partner: { stand: true, logo_website: true, ecat_page: true, delegate_passes: 2 },
  Silver: { stand: true, stand_size_m2: 6, logo_website: true, logo_badges: true, ecat_page: true, delegate_passes: 4, gala_seats: 2, social_posts: 2 },
  Gold: { stand: true, stand_size_m2: 12, logo_website: true, logo_badges: true, logo_stage: true, speaking_slot: true, ecat_page: true, delegate_passes: 8, gala_seats: 4, newsletter_feature: true, social_posts: 4 },
  'Main partner': { stand: true, stand_size_m2: 24, logo_website: true, logo_badges: true, logo_stage: true, speaking_slot: true, workshop_slot: true, ecat_page: true, delegate_passes: 15, gala_seats: 10, newsletter_feature: true, social_posts: 8 },
};

export function SponsorPackageEditor({ roleAssignmentId, eventId }: { roleAssignmentId: string; eventId: string }) {
  const [benefits, setBenefits] = useState<Benefit[]>([]);
  const [vals, setVals] = useState<Record<string, Val>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [preset, setPreset] = useState('');

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [roleAssignmentId]);

  const load = async () => {
    setLoading(true);
    const [{ data: bens }, { data: ents }] = await Promise.all([
      supabase.from('sm_sponsor_benefit').select('key,label,kind,display_order').eq('event_id', eventId).order('display_order'),
      supabase.from('sm_sponsor_entitlement').select('benefit_key,granted,quota').eq('role_assignment_id', roleAssignmentId),
    ]);
    const catalog = (bens || []) as Benefit[];
    const entMap = new Map((ents || []).map((e: { benefit_key: string; granted: boolean; quota: number | null }) => [e.benefit_key, e]));
    const v: Record<string, Val> = {};
    for (const b of catalog) {
      const e = entMap.get(b.key);
      v[b.key] = { granted: !!e?.granted, quota: e?.quota != null ? String(e.quota) : '' };
    }
    setBenefits(catalog);
    setVals(v);
    setLoading(false);
  };

  const applyPreset = (name: string) => {
    setPreset(name);
    const p = PRESETS[name];
    if (!p) return;
    setVals(prev => {
      const next: Record<string, Val> = {};
      for (const b of benefits) {
        const pv = p[b.key];
        next[b.key] = {
          granted: pv !== undefined && pv !== false,
          quota: typeof pv === 'number' ? String(pv) : (b.kind === 'quota' && pv ? prev[b.key]?.quota || '' : ''),
        };
      }
      return next;
    });
  };

  const toggle = (key: string) => setVals(prev => ({ ...prev, [key]: { ...prev[key], granted: !prev[key]?.granted } }));
  const setQuota = (key: string, q: string) => setVals(prev => ({ ...prev, [key]: { granted: prev[key]?.granted ?? false, quota: q } }));

  const save = async () => {
    setSaving(true);
    const rows = benefits.map(b => ({
      role_assignment_id: roleAssignmentId,
      event_id: eventId,
      benefit_key: b.key,
      granted: vals[b.key]?.granted ?? false,
      quota: b.kind === 'quota' && vals[b.key]?.quota ? parseInt(vals[b.key].quota, 10) : null,
      updated_at: new Date().toISOString(),
    }));
    const { error } = await supabase.from('sm_sponsor_entitlement').upsert(rows, { onConflict: 'role_assignment_id,benefit_key' });
    setSaving(false);
    if (error) { toast({ title: 'Could not save package', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Sponsor package saved' });
  };

  if (loading) return <div className="py-3 text-xs text-gray-400 flex items-center gap-2"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading package…</div>;
  if (benefits.length === 0) return null;

  const grantedCount = benefits.filter(b => vals[b.key]?.granted).length;

  return (
    <div className="rounded-lg border border-amber-100 bg-amber-50/50 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-[11px] uppercase tracking-wide text-amber-700 font-medium">Sponsor package · {grantedCount} granted</div>
        <div className="flex items-center gap-2">
          <Select value={preset} onValueChange={applyPreset}>
            <SelectTrigger className="w-40 h-8 text-xs bg-white"><SelectValue placeholder="Apply a preset…" /></SelectTrigger>
            <SelectContent>{Object.keys(PRESETS).map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
          </Select>
          <span className="text-gray-300"><Sparkles className="h-3.5 w-3.5" /></span>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2">
        {benefits.map(b => (
          <div key={b.key} className="flex items-center gap-2">
            <Checkbox id={`ent-${roleAssignmentId}-${b.key}`} checked={vals[b.key]?.granted ?? false} onCheckedChange={() => toggle(b.key)} />
            <label htmlFor={`ent-${roleAssignmentId}-${b.key}`} className="text-sm text-gray-700 flex-1 cursor-pointer">{b.label}</label>
            {b.kind === 'quota' && (
              <Input
                type="number" min={0}
                value={vals[b.key]?.quota ?? ''}
                onChange={e => setQuota(b.key, e.target.value)}
                disabled={!vals[b.key]?.granted}
                className="h-7 w-16 text-xs bg-white"
                placeholder="#"
              />
            )}
          </div>
        ))}
      </div>

      <div className="flex justify-end">
        <Button size="sm" className="gap-1.5" onClick={save} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save package
        </Button>
      </div>
    </div>
  );
}
