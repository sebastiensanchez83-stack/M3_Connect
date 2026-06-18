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

        <div className="space-y-1"><Label>What does your company do?</Label><Textarea rows={2} value={value.organization_activity} onChange={e => set({ organization_activity: e.target.value })} /></div>
        <div className="space-y-1"><Label>Problem you solve</Label><Textarea rows={2} value={value.problem} onChange={e => set({ problem: e.target.value })} /></div>
        <div className="space-y-1"><Label>Your solution</Label><Textarea rows={3} value={value.solution} onChange={e => set({ solution: e.target.value })} /></div>
        <div className="space-y-1"><Label>What makes it different?</Label><Textarea rows={2} value={value.differentiation} onChange={e => set({ differentiation: e.target.value })} /></div>
        <div className="space-y-1"><Label>Unique selling proposition</Label><Textarea rows={2} value={value.usp} onChange={e => set({ usp: e.target.value })} /></div>
        <div className="space-y-1"><Label>Target markets</Label><Input value={value.target_markets} onChange={e => set({ target_markets: e.target.value })} /></div>
        <div className="space-y-1"><Label>Business model</Label><Textarea rows={2} value={value.business_model} onChange={e => set({ business_model: e.target.value })} /></div>
        <div className="space-y-1"><Label>Competitive positioning</Label><Textarea rows={2} value={value.competitive_positioning} onChange={e => set({ competitive_positioning: e.target.value })} /></div>
        <div className="space-y-1"><Label>What collaboration do you expect, and why?</Label><Textarea rows={2} value={value.collaboration_expected} onChange={e => set({ collaboration_expected: e.target.value })} /></div>
        <div className="space-y-1"><Label>References (pilots, clients, awards…)</Label><Textarea rows={2} value={value.references_text} onChange={e => set({ references_text: e.target.value })} /></div>

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
