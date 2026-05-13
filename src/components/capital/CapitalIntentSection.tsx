import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { TrendingUp, Loader2, Info, EyeOff } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { CAPITAL_TYPES, CAPITAL_STAGES } from '@/types/database';
import type { OrgCapitalIntent } from '@/types/database';

interface Props {
  organizationId: string;
  isOwner: boolean;
}

/**
 * Section shown on the Organization tab for marina / developer / partner
 * orgs. Owner can toggle "Seeking capital" and fill in raise terms.
 * RLS makes the data visible only to org members + verified investors.
 */
export function CapitalIntentSection({ organizationId, isOwner }: Props) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<{
    seeking_capital: boolean;
    capital_type: string;
    amount_min: string;
    amount_max: string;
    stage: string;
    use_of_funds: string;
  }>({
    seeking_capital: false,
    capital_type: '',
    amount_min: '',
    amount_max: '',
    stage: '',
    use_of_funds: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('org_capital_intents')
      .select('*')
      .eq('organization_id', organizationId)
      .maybeSingle();
    if (data) {
      const d = data as OrgCapitalIntent;
      setForm({
        seeking_capital: d.seeking_capital,
        capital_type: d.capital_type ?? '',
        amount_min: d.amount_min != null ? String(d.amount_min) : '',
        amount_max: d.amount_max != null ? String(d.amount_max) : '',
        stage: d.stage ?? '',
        use_of_funds: d.use_of_funds ?? '',
      });
    }
    setLoading(false);
  }, [organizationId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    const payload = {
      organization_id: organizationId,
      seeking_capital: form.seeking_capital,
      capital_type: form.seeking_capital ? (form.capital_type || null) : null,
      amount_min: form.seeking_capital && form.amount_min ? Number(form.amount_min) : null,
      amount_max: form.seeking_capital && form.amount_max ? Number(form.amount_max) : null,
      stage: form.seeking_capital ? (form.stage || null) : null,
      use_of_funds: form.seeking_capital ? (form.use_of_funds.trim() || null) : null,
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    };
    const { error } = await supabase
      .from('org_capital_intents')
      .upsert(payload, { onConflict: 'organization_id' });
    if (error) {
      toast({ title: 'Could not save', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Capital intent saved', description: form.seeking_capital ? 'Verified investors can now see your raise.' : 'Toggle is off — you are no longer shown as seeking capital.' });
    }
    setSaving(false);
  };

  if (loading) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-emerald-500" />
          Capital raise
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Toggle row */}
        <div className="flex items-start justify-between gap-4 p-3 rounded-lg bg-gray-50 border">
          <div className="flex-1">
            <Label className="font-medium text-gray-900">Currently seeking capital</Label>
            <p className="text-xs text-gray-500 mt-1">
              Turning this on adds your organization to the investor deal-flow feed. You can switch it off at any time.
            </p>
          </div>
          <Switch
            checked={form.seeking_capital}
            onCheckedChange={(v) => setForm({ ...form, seeking_capital: v })}
            disabled={!isOwner}
          />
        </div>

        <div className="flex items-start gap-2 text-xs text-gray-500 bg-blue-50 border border-blue-100 rounded-lg p-2.5">
          <EyeOff className="h-3.5 w-3.5 shrink-0 mt-0.5 text-blue-500" />
          <p>
            <strong>Investor-only visibility:</strong> these details are hidden from the public profile and from non-investor users. Only verified Investor accounts on the platform can see them.
          </p>
        </div>

        {/* Form fields (only when toggled on) */}
        {form.seeking_capital && (
          <div className="space-y-4 pt-2">
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-sm">Capital type</Label>
                <Select
                  value={form.capital_type}
                  onValueChange={(v) => setForm({ ...form, capital_type: v })}
                  disabled={!isOwner}
                >
                  <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                  <SelectContent>
                    {CAPITAL_TYPES.map(t => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-sm">Stage</Label>
                <Select
                  value={form.stage}
                  onValueChange={(v) => setForm({ ...form, stage: v })}
                  disabled={!isOwner}
                >
                  <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                  <SelectContent>
                    {CAPITAL_STAGES.map(s => (
                      <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-sm">Capital range (€)</Label>
              <div className="grid sm:grid-cols-2 gap-3">
                <Input
                  type="number"
                  min={0}
                  placeholder="Min, e.g. 500000"
                  value={form.amount_min}
                  onChange={(e) => setForm({ ...form, amount_min: e.target.value })}
                  disabled={!isOwner}
                />
                <Input
                  type="number"
                  min={0}
                  placeholder="Max, e.g. 2000000"
                  value={form.amount_max}
                  onChange={(e) => setForm({ ...form, amount_max: e.target.value })}
                  disabled={!isOwner}
                />
              </div>
              <p className="text-xs text-gray-400">Enter whole euros. Both fields are optional — investors will see whatever you choose to share.</p>
            </div>

            <div className="space-y-2">
              <Label className="text-sm">Use of funds</Label>
              <textarea
                value={form.use_of_funds}
                onChange={(e) => setForm({ ...form, use_of_funds: e.target.value })}
                disabled={!isOwner}
                rows={3}
                maxLength={400}
                placeholder="One-liner that investors will see, e.g. 'Funding Q3 dredging expansion + 40 new berths'."
                className="w-full resize-y rounded-lg border border-gray-200 bg-white p-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30 disabled:bg-gray-50 disabled:text-gray-500"
              />
              <p className="text-xs text-gray-400">{form.use_of_funds.length} / 400</p>
            </div>
          </div>
        )}

        {isOwner && (
          <div className="flex justify-end pt-2">
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Save
            </Button>
          </div>
        )}

        {!isOwner && (
          <div className="flex items-start gap-2 text-xs text-gray-400 pt-2">
            <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <p>Only the organization owner can edit these fields.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
