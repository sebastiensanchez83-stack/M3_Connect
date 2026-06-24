import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';

// Architecture competition module — Professional or Student.
// Registration/competition entry is free; the 8 anonymous A2 panels + A3 notice
// are submitted later (deadline 19 Aug 2026). Onsite attendance is a paid add-on.

export interface ArchitectureData {
  company_description: string;
  sustainability_statement: string;
  domain: string;
  references_text: string;
  proof_of_enrolment_url: string;
  is_team: boolean;
  team_size: string;
  team_members: string;
  portfolio_link: string;
  onsite_attendance: boolean;
}

export const EMPTY_ARCHITECTURE: ArchitectureData = {
  company_description: '', sustainability_statement: '', domain: '', references_text: '',
  proof_of_enrolment_url: '', is_team: false, team_size: '', team_members: '', portfolio_link: '',
  onsite_attendance: false,
};

interface Props {
  variant: 'professional' | 'student';
  value: ArchitectureData;
  onChange: (v: ArchitectureData) => void;
}

export function ArchitectureFields({ variant, value, onChange }: Props) {
  const set = (patch: Partial<ArchitectureData>) => onChange({ ...value, ...patch });
  const onsiteFee = variant === 'professional' ? '€600' : '€120';

  return (
    <Card>
      <CardHeader>
        <CardTitle>Architecture entry — {variant === 'professional' ? 'Professional' : 'Student'}</CardTitle>
        <CardDescription>
          Free to enter. Your 8 anonymous A2 panels + A3 notice are submitted later (deadline 19 Aug 2026); jury scoring is blind.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {variant === 'professional' ? (
          <>
            <div className="space-y-1"><Label>Company / practice description</Label><Textarea rows={3} value={value.company_description} onChange={e => set({ company_description: e.target.value })} /></div>
            <div className="space-y-1"><Label>Your commitment to sustainability & innovation</Label><Textarea rows={3} value={value.sustainability_statement} onChange={e => set({ sustainability_statement: e.target.value })} /></div>
            <div className="space-y-1"><Label>Field / domain you work in</Label><Input value={value.domain} onChange={e => set({ domain: e.target.value })} /></div>
            <div className="space-y-1"><Label>References / signature projects</Label><Textarea rows={2} value={value.references_text} onChange={e => set({ references_text: e.target.value })} /></div>
            <div className="space-y-1"><Label>Portfolio link</Label><Input value={value.portfolio_link} onChange={e => set({ portfolio_link: e.target.value })} placeholder="https://" /></div>
          </>
        ) : (
          <>
            <div className="space-y-1">
              <Label>Proof of enrolment (link)</Label>
              <Input value={value.proof_of_enrolment_url} onChange={e => set({ proof_of_enrolment_url: e.target.value })} placeholder="https:// — file upload coming soon" />
            </div>
            <div className="space-y-1"><Label>Portfolio link</Label><Input value={value.portfolio_link} onChange={e => set({ portfolio_link: e.target.value })} placeholder="https://" /></div>
            <div className="rounded-lg border border-gray-200 p-4 space-y-3">
              <div className="flex items-start gap-2">
                <Checkbox id="arch-team" checked={value.is_team} onCheckedChange={c => set({ is_team: c as boolean })} />
                <Label htmlFor="arch-team" className="font-normal text-sm">We're entering as a team (up to 5 students)</Label>
              </div>
              {value.is_team && (
                <div className="space-y-3">
                  <div className="space-y-1 max-w-[12rem]">
                    <Label>Number of members</Label>
                    <Input type="number" min={1} max={5} value={value.team_size} onChange={e => set({ team_size: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label>Full names of members (one per line)</Label>
                    <Textarea rows={3} value={value.team_members} onChange={e => set({ team_members: e.target.value })} />
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        <div className="flex items-start gap-2 rounded-lg border border-gray-200 p-4">
          <Checkbox id="arch-onsite" checked={value.onsite_attendance} onCheckedChange={c => set({ onsite_attendance: c as boolean })} />
          <Label htmlFor="arch-onsite" className="font-normal text-sm">
            I'd like to attend the award ceremony on-site at the Yacht Club de Monaco (20–21 Sep).
            <span className="text-gray-500"> Optional · {onsiteFee} (VAT excl.)</span>
          </Label>
        </div>
      </CardContent>
    </Card>
  );
}
