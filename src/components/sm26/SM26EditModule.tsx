import { useState } from 'react';
import { Loader2, Save, Pencil, Lightbulb } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { StartupFields, EMPTY_STARTUP, type StartupData } from '@/components/sm26/StartupFields';

// Participant self-service editing of their ROLE-MODULE content (the innovation
// pitch text etc.) — separate from base details (SM26EditDetails) and from the
// required-asset checklist. Solves the dead-end where text skipped at signup
// could never be completed. RLS (sm_owns_role_assignment) lets the owner update
// their own sm_startup_profile row. Currently covers the innovation (startup)
// module; architecture/marina follow the same pattern when needed.

export function SM26EditModule({ roleAssignmentId, role }: { roleAssignmentId: string; role: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [startup, setStartup] = useState<StartupData>(EMPTY_STARTUP);

  if (role !== 'startup') return null;

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from('sm_startup_profile')
      .select('startup_or_scaleup,stage,categories,organization_activity,problem,solution,differentiation,usp,target_markets,business_model,competitive_positioning,collaboration_expected,investment_seeking,investment_stage,investment_type,funds_needed,references_text')
      .eq('role_assignment_id', roleAssignmentId).maybeSingle();
    if (data) {
      const d = data as Record<string, unknown>;
      const s = (k: string) => (typeof d[k] === 'string' ? (d[k] as string) : '');
      setStartup({
        startup_or_scaleup: s('startup_or_scaleup'), stage: s('stage'),
        categories: Array.isArray(d.categories) ? (d.categories as string[]) : [],
        organization_activity: s('organization_activity'), problem: s('problem'), solution: s('solution'),
        differentiation: s('differentiation'), usp: s('usp'), target_markets: s('target_markets'),
        business_model: s('business_model'), competitive_positioning: s('competitive_positioning'),
        collaboration_expected: s('collaboration_expected'), investment_seeking: !!d.investment_seeking,
        investment_stage: s('investment_stage'), investment_type: s('investment_type'),
        funds_needed: s('funds_needed'), references_text: s('references_text'),
      });
    }
    setLoaded(true);
    setLoading(false);
  };

  const openEdit = async () => { if (!loaded) await load(); setOpen(true); };

  const save = async () => {
    setSaving(true);
    const patch: Record<string, unknown> = {
      startup_or_scaleup: startup.startup_or_scaleup || null, stage: startup.stage || null,
      categories: startup.categories,
      organization_activity: startup.organization_activity || null, problem: startup.problem || null,
      solution: startup.solution || null, differentiation: startup.differentiation || null,
      usp: startup.usp || null, target_markets: startup.target_markets || null,
      business_model: startup.business_model || null, competitive_positioning: startup.competitive_positioning || null,
      collaboration_expected: startup.collaboration_expected || null, investment_seeking: startup.investment_seeking,
      investment_stage: startup.investment_stage || null, investment_type: startup.investment_type || null,
      funds_needed: startup.funds_needed || null, references_text: startup.references_text || null,
    };
    const { error } = await supabase.from('sm_startup_profile').update(patch).eq('role_assignment_id', roleAssignmentId);
    setSaving(false);
    if (error) { toast({ title: 'Could not save', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Innovation details saved' });
  };

  if (!open) {
    return (
      <Card>
        <CardContent className="py-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-medium flex items-center gap-2"><Lightbulb className="h-4 w-4 text-primary" /> Innovation details</div>
            <div className="text-xs text-gray-500 mt-0.5">Complete or refine your pitch — the jury and the e-catalogue use this.</div>
          </div>
          <Button size="sm" variant="outline" className="gap-1.5 shrink-0" onClick={openEdit} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pencil className="h-3.5 w-3.5" />} Edit
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      <StartupFields value={startup} onChange={setStartup} />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => setOpen(false)}>Close</Button>
        <Button onClick={save} disabled={saving} className="gap-1.5">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save innovation details
        </Button>
      </div>
    </div>
  );
}
