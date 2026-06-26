import { useState, useEffect } from 'react';
import { Loader2, Save, Pencil, Lightbulb, Lock, FileText } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { StartupFields, EMPTY_STARTUP, type StartupData } from '@/components/sm26/StartupFields';
import { useSm26EditLock } from '@/components/sm26/useSm26EditLock';
import { sm26FieldLabel } from '@/components/admin/AdminSM26';

// Participant self-service editing of their ROLE-MODULE content (the text they
// submitted in their form) — separate from base details (SM26EditDetails) and the
// required-asset checklist. Solves the dead-end where text skipped/wrong at signup
// could never be fixed. Startups edit their sm_startup_profile (StartupFields);
// every other module-data role (jury / speaker / sponsor / investor / visitor)
// edits the free-text fields stored in sm_role_assignment.module_data. Both
// respect the admin editing deadline. (Architecture & marina text live in their own
// tables and get dedicated editors next.)

const LockNote = ({ prettyDate }: { prettyDate: string | null }) => (
  <span className="text-xs text-gray-400 inline-flex items-center gap-1.5 shrink-0">
    <Lock className="h-3.5 w-3.5" /> Editing closed{prettyDate ? ` · ${prettyDate}` : ''}
  </span>
);

// Free-text only: never surface assets/files, internal meta keys, or the base
// fields already edited in "Your details".
const ASSET_KEYS = new Set(['logo', 'logo_url', 'photo', 'photo_url', 'banner', 'deck', 'deck_url', 'slides', 'hero_image', 'press_card', 'proof_of_enrolment', 'proof_of_enrolment_url', 'panels', 'notice', 'pitch_media', 'pitch_media_url', 'product_images', 'avatar', 'portfolio_link', 'website']);
const BASE_KEYS = new Set(['first_name', 'last_name', 'email', 'phone', 'company_name', 'country', 'job_title', 'terms_accepted', 'image_consent', 'honeypot']);
// Consents / flags / fixed selections are not free text — never editable here.
const SKIP_KEYS = new Set(['ecat_consent', 'social_consent', 'onsite_attendance', 'investment_seeking', 'is_team', 'pitch_optin', 'visibility_level', 'jury_category', 'stage', 'startup_or_scaleup', 'category', 'marina_type', 'marina_subtype']);
const isEditableText = (k: string, v: unknown) =>
  typeof v === 'string' && !k.startsWith('_') && !k.endsWith('_consent') && !ASSET_KEYS.has(k) && !BASE_KEYS.has(k) && !SKIP_KEYS.has(k);

export function SM26EditModule({ roleAssignmentId, role }: { roleAssignmentId: string; role: string }) {
  const { locked, prettyDate } = useSm26EditLock();
  if (role === 'startup') return <StartupEditor roleAssignmentId={roleAssignmentId} locked={locked} prettyDate={prettyDate} />;
  return <ModuleTextEditor roleAssignmentId={roleAssignmentId} locked={locked} prettyDate={prettyDate} />;
}

// ── Innovation (startup) editor ──────────────────────────────────────────────
function StartupEditor({ roleAssignmentId, locked, prettyDate }: { roleAssignmentId: string; locked: boolean; prettyDate: string | null }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [startup, setStartup] = useState<StartupData>(EMPTY_STARTUP);

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
    if (locked) return;
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
          {locked
            ? <LockNote prettyDate={prettyDate} />
            : <Button size="sm" variant="outline" className="gap-1.5 shrink-0" onClick={openEdit} disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pencil className="h-3.5 w-3.5" />} Edit
              </Button>}
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

// ── Generic module-data text editor (jury / speaker / sponsor / investor / …) ──
function ModuleTextEditor({ roleAssignmentId, locked, prettyDate }: { roleAssignmentId: string; locked: boolean; prettyDate: string | null }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [base, setBase] = useState<Record<string, unknown>>({});
  const [fields, setFields] = useState<{ key: string; value: string }[]>([]);

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [roleAssignmentId]);
  const load = async () => {
    const { data } = await supabase.from('sm_role_assignment').select('module_data').eq('id', roleAssignmentId).maybeSingle();
    const md = ((data as { module_data?: Record<string, unknown> } | null)?.module_data) || {};
    setBase(md);
    setFields(Object.entries(md).filter(([k, v]) => isEditableText(k, v)).map(([k, v]) => ({ key: k, value: v as string })));
    setLoadedOnce(true);
  };

  const setVal = (key: string, value: string) => setFields(prev => prev.map(f => f.key === key ? { ...f, value } : f));

  const save = async () => {
    if (locked) return;
    setSaving(true);
    const patch: Record<string, unknown> = { ...base };
    for (const f of fields) patch[f.key] = f.value.trim() || null;
    const { error } = await supabase.from('sm_role_assignment').update({ module_data: patch }).eq('id', roleAssignmentId);
    setSaving(false);
    if (error) { toast({ title: 'Could not save', description: error.message, variant: 'destructive' }); return; }
    setBase(patch);
    toast({ title: 'Details saved' });
  };

  // Nothing free-text to edit for this role → don't show a card at all.
  if (loadedOnce && fields.length === 0) return null;

  if (!open) {
    return (
      <Card>
        <CardContent className="py-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-medium flex items-center gap-2"><FileText className="h-4 w-4 text-primary" /> Your submitted details</div>
            <div className="text-xs text-gray-500 mt-0.5">Complete or correct the information you provided — used for the catalogue and your profile.</div>
          </div>
          {locked
            ? <LockNote prettyDate={prettyDate} />
            : <Button size="sm" variant="outline" className="gap-1.5 shrink-0" onClick={() => setOpen(true)} disabled={!loadedOnce}>
                {!loadedOnce ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pencil className="h-3.5 w-3.5" />} Edit
              </Button>}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="py-4 space-y-3">
        {fields.map(f => (
          <div key={f.key} className="space-y-1">
            <Label className="text-xs">{sm26FieldLabel(f.key)}</Label>
            <Textarea rows={2} value={f.value} onChange={e => setVal(f.key, e.target.value)} />
          </div>
        ))}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>Close</Button>
          <Button onClick={save} disabled={saving} className="gap-1.5">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save details
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
