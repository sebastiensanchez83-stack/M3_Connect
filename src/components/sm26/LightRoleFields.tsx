import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// Lighter roles — a few fields each, stored in sm_role_assignment.module_data
// (no dedicated table). Roles not listed here (visitor, vip) collect nothing
// extra at sign-up. Trusted roles are validated by M3 afterwards.

export type LightData = Record<string, string>;

interface FieldDef { key: string; label: string; type?: 'text' | 'textarea' | 'select'; options?: string[]; placeholder?: string; }

const ROLE_FIELDS: Record<string, { title: string; desc: string; fields: FieldDef[] }> = {
  media: {
    title: 'Media accreditation',
    desc: 'Your request will be reviewed by M3.',
    fields: [
      { key: 'outlet', label: 'Outlet / publication' },
      { key: 'press_card_url', label: 'Press card (link)', placeholder: 'https:// — file upload coming soon' },
    ],
  },
  speaker: {
    title: 'Speaker details',
    desc: 'A short version for now — M3 will follow up on your session, materials and promo assets.',
    fields: [
      { key: 'bio', label: 'Short bio', type: 'textarea' },
      { key: 'talk_topic', label: 'Proposed talk / topic', type: 'textarea' },
    ],
  },
  investor: {
    title: 'Investor profile',
    desc: 'Helps us match you with relevant startups. M3 validates investor access.',
    fields: [
      { key: 'investor_type', label: 'Type', type: 'select', options: ['VC', 'Angel', 'Corporate venture', 'Family office', 'Institution', 'Other'] },
      { key: 'thesis', label: 'Investment thesis / focus', type: 'textarea' },
      { key: 'ticket', label: 'Typical ticket size', placeholder: 'e.g. €100k–€1M' },
      { key: 'categories_interest', label: 'Categories of interest' },
    ],
  },
  sponsor: {
    title: 'Sponsorship interest',
    desc: 'M3 will get in touch to agree the partnership package.',
    fields: [
      { key: 'interest', label: 'What partnership are you interested in?', type: 'textarea' },
    ],
  },
  jury: {
    title: 'Jury profile',
    desc: 'M3 confirms jury invitations. Your logo, photo, bio and job title appear in the e-catalogue.',
    fields: [
      { key: 'competition', label: 'Which competition?', type: 'select', options: ['Innovation', 'Architecture', 'Both'] },
      { key: 'expertise', label: 'Area of expertise', type: 'textarea' },
      { key: 'bio', label: 'Short bio / quote (for the catalogue)', type: 'textarea' },
    ],
  },
};

interface Props {
  role: string;
  value: LightData;
  onChange: (v: LightData) => void;
}

export function LightRoleFields({ role, value, onChange }: Props) {
  const cfg = ROLE_FIELDS[role];
  if (!cfg) return null; // visitor, vip, or a role with its own dedicated card

  const set = (k: string, v: string) => onChange({ ...value, [k]: v });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{cfg.title}</CardTitle>
        <CardDescription>{cfg.desc}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {cfg.fields.map(f => (
          <div key={f.key} className="space-y-1">
            <Label>{f.label}</Label>
            {f.type === 'textarea' ? (
              <Textarea rows={2} value={value[f.key] || ''} onChange={e => set(f.key, e.target.value)} />
            ) : f.type === 'select' ? (
              <Select value={value[f.key] || ''} onValueChange={v => set(f.key, v)}>
                <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>{(f.options || []).map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
              </Select>
            ) : (
              <Input value={value[f.key] || ''} onChange={e => set(f.key, e.target.value)} placeholder={f.placeholder} />
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
