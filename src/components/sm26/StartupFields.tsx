import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// Innovation (Startup / Scaleup) module — feeds the jury scorecards + e-catalogue.
// Fields are optional at registration; the entrant can refine them up to the
// submission deadline (the required-info checklist nudges anything missing).

export interface StartupData {
  startup_or_scaleup: string;
  stage: string;
  categories: string[];
  organization_activity: string;
  problem: string;
  solution: string;
  differentiation: string;
  usp: string;
  target_markets: string;
  business_model: string;
  competitive_positioning: string;
  collaboration_expected: string;
  investment_seeking: boolean;
  investment_stage: string;
  investment_type: string;
  funds_needed: string;
  references_text: string;
}

export const EMPTY_STARTUP: StartupData = {
  startup_or_scaleup: '', stage: '', categories: [],
  organization_activity: '', problem: '', solution: '', differentiation: '', usp: '',
  target_markets: '', business_model: '', competitive_positioning: '', collaboration_expected: '',
  investment_seeking: false, investment_stage: '', investment_type: '', funds_needed: '',
  references_text: '',
};

// The 11 Smart Marina innovation categories (admin-editable later).
export const SM_CATEGORIES = [
  'Smart Marina Infrastructure & Digitalization',
  'Energy Management & Electrification',
  'Water Management, Treatment & Recycling',
  'Environmental Monitoring & Sustainability',
  'Biodiversity Regeneration',
  'Waste Management & Circularity',
  'Dockside Mobility & Logistics',
  'Automation, Data Platforms & Connectivity',
  'Smart Services / Customer Experience',
  'Biobased & New Infrastructure Materials',
  'Marina Management / Operations',
];

const STAGES = ['Idea', 'Prototype', 'Pilot', 'Pre-revenue', 'Early revenue', 'Scaling revenue', 'Scale-up / Established'];
const INVEST_TYPES = ['Equity', 'Grant', 'Debt', 'Convertible', 'Strategic / Corporate', 'Other'];

// Per-field character limits (matching the Smart Marina pitch form). Generous so
// they never truncate already-submitted text; the live counter shows usage.
export const STARTUP_LIMITS: Record<string, number> = {
  organization_activity: 1500, problem: 1500, solution: 2500, differentiation: 1000,
  usp: 800, target_markets: 300, business_model: 1500, competitive_positioning: 1500,
  collaboration_expected: 1500, references_text: 1500,
};

// Label + counter wrapper enforcing a max length.
function Limited({ label, value, onChange, max, rows }: { label: string; value: string; onChange: (v: string) => void; max: number; rows?: number }) {
  const near = value.length > max * 0.9;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <Label>{label}</Label>
        <span className={`text-[10px] tabular-nums ${value.length >= max ? 'text-red-500' : near ? 'text-amber-600' : 'text-gray-400'}`}>{value.length}/{max}</span>
      </div>
      {rows
        ? <Textarea rows={rows} maxLength={max} value={value} onChange={e => onChange(e.target.value)} />
        : <Input maxLength={max} value={value} onChange={e => onChange(e.target.value)} />}
    </div>
  );
}

interface Props {
  value: StartupData;
  onChange: (v: StartupData) => void;
}

export function StartupFields({ value, onChange }: Props) {
  const set = (patch: Partial<StartupData>) => onChange({ ...value, ...patch });
  const toggleCategory = (c: string) =>
    set({ categories: value.categories.includes(c) ? value.categories.filter(x => x !== c) : [...value.categories, c] });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Innovation details</CardTitle>
        <CardDescription>Tell us about your solution — the jury uses this to score your entry. You can refine it later, up to the submission deadline.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label>Startup or Scaleup?</Label>
            <Select value={value.startup_or_scaleup} onValueChange={v => set({ startup_or_scaleup: v })}>
              <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
              <SelectContent>
                <SelectItem value="startup">Startup</SelectItem>
                <SelectItem value="scaleup">Scaleup</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Stage</Label>
            <Select value={value.stage} onValueChange={v => set({ stage: v })}>
              <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
              <SelectContent>
                {STAGES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1">
          <Label>Smart-marina category</Label>
          <p className="text-xs text-gray-500">Pick the one(s) that fit. M3 confirms your primary category.</p>
          <div className="grid sm:grid-cols-2 gap-1.5 mt-1">
            {SM_CATEGORIES.map(c => (
              <button
                type="button"
                key={c}
                onClick={() => toggleCategory(c)}
                aria-pressed={value.categories.includes(c)}
                className={`text-left text-sm rounded-lg border px-3 py-2 transition-colors ${value.categories.includes(c) ? 'border-primary bg-primary/5 text-primary font-medium' : 'border-gray-200 text-gray-600 hover:border-primary/40'}`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        <Limited label="What does your company do?" rows={2} max={STARTUP_LIMITS.organization_activity} value={value.organization_activity} onChange={v => set({ organization_activity: v })} />
        <Limited label="Problem you solve" rows={2} max={STARTUP_LIMITS.problem} value={value.problem} onChange={v => set({ problem: v })} />
        <Limited label="Your solution" rows={3} max={STARTUP_LIMITS.solution} value={value.solution} onChange={v => set({ solution: v })} />
        <Limited label="What makes it different?" rows={2} max={STARTUP_LIMITS.differentiation} value={value.differentiation} onChange={v => set({ differentiation: v })} />
        <Limited label="Unique selling proposition (USP)" rows={2} max={STARTUP_LIMITS.usp} value={value.usp} onChange={v => set({ usp: v })} />
        <Limited label="Target markets" max={STARTUP_LIMITS.target_markets} value={value.target_markets} onChange={v => set({ target_markets: v })} />
        <Limited label="Business model" rows={2} max={STARTUP_LIMITS.business_model} value={value.business_model} onChange={v => set({ business_model: v })} />
        <Limited label="Competitive positioning" rows={2} max={STARTUP_LIMITS.competitive_positioning} value={value.competitive_positioning} onChange={v => set({ competitive_positioning: v })} />
        <Limited label="What collaboration do you expect, and why?" rows={2} max={STARTUP_LIMITS.collaboration_expected} value={value.collaboration_expected} onChange={v => set({ collaboration_expected: v })} />
        <Limited label="References (pilots, clients, awards…)" rows={2} max={STARTUP_LIMITS.references_text} value={value.references_text} onChange={v => set({ references_text: v })} />

        <div className="rounded-lg border border-gray-200 p-4 space-y-3">
          <div className="flex items-start gap-2">
            <Checkbox id="inv-seeking" checked={value.investment_seeking} onCheckedChange={c => set({ investment_seeking: c as boolean })} />
            <Label htmlFor="inv-seeking" className="font-normal text-sm">We're currently looking for investment</Label>
          </div>
          {value.investment_seeking && (
            <div className="grid sm:grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label>Stage</Label>
                <Input value={value.investment_stage} onChange={e => set({ investment_stage: e.target.value })} placeholder="e.g. Seed" />
              </div>
              <div className="space-y-1">
                <Label>Type</Label>
                <Select value={value.investment_type} onValueChange={v => set({ investment_type: v })}>
                  <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                  <SelectContent>{INVEST_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Funds needed</Label>
                <Input value={value.funds_needed} onChange={e => set({ funds_needed: e.target.value })} placeholder="e.g. €500k" />
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
