import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

// Marina exhibitor questionnaire — profile/e-catalogue data (no Marina Award).
// Core marina facts (berths, facilities) come from the organisation profile;
// this captures the SM26 sustainability/architecture narrative. Per-section
// image uploads come later.

export interface MarinaData {
  architectural_quality: string;
  biodiversity: string;
  water: string;
  energy: string;
  waste: string;
  innovation: string;
  security: string;
  further_info: string;
}

export const EMPTY_MARINA: MarinaData = {
  architectural_quality: '', biodiversity: '', water: '', energy: '', waste: '',
  innovation: '', security: '', further_info: '',
};

const FIELDS: { key: keyof MarinaData; label: string }[] = [
  { key: 'architectural_quality', label: 'Overall architectural quality (accessibility, masterplan, link with the environment & surrounding city…)' },
  { key: 'biodiversity', label: 'How does the marina minimise its impact on biodiversity and contribute to sustainability?' },
  { key: 'water', label: 'Initiatives to reduce water use / improve water management' },
  { key: 'energy', label: 'Measures adopted for energy usage' },
  { key: 'waste', label: 'Initiatives for waste management' },
  { key: 'innovation', label: 'Innovative initiatives in design, management or operations' },
  { key: 'security', label: 'Health & security measures for marina guests' },
  { key: 'further_info', label: 'Anything else you would like to present' },
];

interface Props {
  value: MarinaData;
  onChange: (v: MarinaData) => void;
}

export function MarinaFields({ value, onChange }: Props) {
  const set = (patch: Partial<MarinaData>) => onChange({ ...value, ...patch });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Marina profile</CardTitle>
        <CardDescription>This feeds your e-catalogue page. You can complete it later — per-section image uploads are coming soon.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {FIELDS.map(f => (
          <div key={f.key} className="space-y-1">
            <Label>{f.label}</Label>
            <Textarea rows={2} value={value[f.key]} onChange={e => set({ [f.key]: e.target.value } as Partial<MarinaData>)} />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
