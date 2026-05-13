import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { TrendingUp, Loader2, Info, Globe, Plus, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { HOLD_PERIODS } from '@/types/database';
import type { Organization } from '@/types/database';

interface Props {
  org: Organization;
  isOwner: boolean;
  onSaved?: (updated: Partial<Organization>) => void;
}

/**
 * Section shown on the Organization tab for investor orgs. Captures
 * geographies, deal-size range, hold period and a free-form thesis.
 * Public on /organizations/:slug so marinas/devs can self-assess fit.
 */
export function InvestmentThesisSection({ org, isOwner, onSaved }: Props) {
  const [saving, setSaving] = useState(false);
  const [geoInput, setGeoInput] = useState('');
  const [form, setForm] = useState({
    investment_geographies: (org.investment_geographies ?? []) as string[],
    investment_size_min: org.investment_size_min != null ? String(org.investment_size_min) : '',
    investment_size_max: org.investment_size_max != null ? String(org.investment_size_max) : '',
    investment_hold_period: org.investment_hold_period ?? '',
    investment_thesis: org.investment_thesis ?? '',
  });

  useEffect(() => {
    setForm({
      investment_geographies: org.investment_geographies ?? [],
      investment_size_min: org.investment_size_min != null ? String(org.investment_size_min) : '',
      investment_size_max: org.investment_size_max != null ? String(org.investment_size_max) : '',
      investment_hold_period: org.investment_hold_period ?? '',
      investment_thesis: org.investment_thesis ?? '',
    });
  }, [org]);

  const addGeo = () => {
    const trimmed = geoInput.trim();
    if (!trimmed) return;
    if (form.investment_geographies.includes(trimmed)) {
      setGeoInput('');
      return;
    }
    setForm({ ...form, investment_geographies: [...form.investment_geographies, trimmed] });
    setGeoInput('');
  };

  const removeGeo = (g: string) => {
    setForm({ ...form, investment_geographies: form.investment_geographies.filter(x => x !== g) });
  };

  const handleSave = async () => {
    setSaving(true);
    const payload: Partial<Organization> = {
      investment_geographies: form.investment_geographies.length ? form.investment_geographies : null,
      investment_size_min: form.investment_size_min ? Number(form.investment_size_min) : null,
      investment_size_max: form.investment_size_max ? Number(form.investment_size_max) : null,
      investment_hold_period: form.investment_hold_period || null,
      investment_thesis: form.investment_thesis.trim() || null,
    };
    const { error } = await supabase
      .from('organizations')
      .update(payload)
      .eq('id', org.id);
    if (error) {
      toast({ title: 'Could not save', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Investment thesis saved', description: 'Your profile has been updated.' });
      onSaved?.(payload);
    }
    setSaving(false);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-emerald-500" />
          Investment thesis
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start gap-2 text-xs text-gray-500 bg-amber-50 border border-amber-100 rounded-lg p-2.5">
          <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-600" />
          <p>
            <strong>Public on your profile.</strong> Marinas and developers will see this on <code>/organizations/{org.slug}</code> so they can decide whether their raise fits your strategy. Focus sectors are managed in your interest sectors below.
          </p>
        </div>

        {/* Geographies */}
        <div className="space-y-2">
          <Label className="text-sm flex items-center gap-1.5"><Globe className="h-3.5 w-3.5 text-gray-400" /> Geographies</Label>
          <p className="text-xs text-gray-400">Countries or regions you target. Press Enter or click + to add.</p>
          {form.investment_geographies.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {form.investment_geographies.map((g) => (
                <Badge key={g} variant="secondary" className="text-xs gap-1 pr-1">
                  {g}
                  {isOwner && (
                    <button
                      type="button"
                      onClick={() => removeGeo(g)}
                      className="ml-1 hover:bg-gray-200 rounded-full p-0.5"
                      title={`Remove ${g}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </Badge>
              ))}
            </div>
          )}
          {isOwner && (
            <div className="flex gap-2">
              <Input
                value={geoInput}
                onChange={(e) => setGeoInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addGeo();
                  }
                }}
                placeholder="e.g. France, Italy, Mediterranean, MENA"
                className="text-sm"
              />
              <Button type="button" size="sm" variant="outline" onClick={addGeo} disabled={!geoInput.trim()}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>

        {/* Check size */}
        <div className="space-y-2">
          <Label className="text-sm">Typical check size (€)</Label>
          <div className="grid sm:grid-cols-2 gap-3">
            <Input
              type="number"
              min={0}
              placeholder="Min, e.g. 500000"
              value={form.investment_size_min}
              onChange={(e) => setForm({ ...form, investment_size_min: e.target.value })}
              disabled={!isOwner}
            />
            <Input
              type="number"
              min={0}
              placeholder="Max, e.g. 10000000"
              value={form.investment_size_max}
              onChange={(e) => setForm({ ...form, investment_size_max: e.target.value })}
              disabled={!isOwner}
            />
          </div>
        </div>

        {/* Hold period */}
        <div className="space-y-2">
          <Label className="text-sm">Hold period</Label>
          <Select
            value={form.investment_hold_period}
            onValueChange={(v) => setForm({ ...form, investment_hold_period: v })}
            disabled={!isOwner}
          >
            <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
            <SelectContent>
              {HOLD_PERIODS.map(h => (
                <SelectItem key={h.value} value={h.value}>{h.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Free-form thesis */}
        <div className="space-y-2">
          <Label className="text-sm">Investment thesis</Label>
          <textarea
            value={form.investment_thesis}
            onChange={(e) => setForm({ ...form, investment_thesis: e.target.value })}
            disabled={!isOwner}
            rows={5}
            maxLength={1500}
            placeholder="What you look for, your value-add, why founders/operators should pick you. Public to anyone visiting your profile."
            className="w-full resize-y rounded-lg border border-gray-200 bg-white p-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30 disabled:bg-gray-50 disabled:text-gray-500"
          />
          <p className="text-xs text-gray-400">{form.investment_thesis.length} / 1500</p>
        </div>

        {isOwner && (
          <div className="flex justify-end pt-1">
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Save thesis
            </Button>
          </div>
        )}

        {!isOwner && (
          <div className="flex items-start gap-2 text-xs text-gray-400 pt-2">
            <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <p>Only the organization owner can edit the investment thesis.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Format a €BIGINT as a human-friendly string. Exported for re-use. */
export function formatCapitalAmount(amount: number | null | undefined): string {
  if (amount == null) return '—';
  if (amount >= 1_000_000) {
    const m = amount / 1_000_000;
    return `€${m.toFixed(m >= 10 ? 0 : 1)}M`;
  }
  if (amount >= 1_000) {
    return `€${Math.round(amount / 1_000)}K`;
  }
  return `€${amount.toLocaleString()}`;
}

/** Format a min/max range for display. */
export function formatCapitalRange(min: number | null | undefined, max: number | null | undefined): string {
  if (min == null && max == null) return '—';
  if (min != null && max != null) return `${formatCapitalAmount(min)} – ${formatCapitalAmount(max)}`;
  if (min != null) return `${formatCapitalAmount(min)}+`;
  return `up to ${formatCapitalAmount(max)}`;
}
