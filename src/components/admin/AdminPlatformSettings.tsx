import { useState, useEffect } from 'react';
import { RefreshCw, Save } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';

interface DisplayStats {
  marinas: number;
  partners: number;
  resources: number;
  events: number;
  countries: number;
  /** true: the site shows these typed numbers (as "N+") instead of live counts. */
  override?: boolean;
}

const DEFAULT_STATS: DisplayStats = {
  marinas: 0,
  partners: 0,
  resources: 0,
  events: 0,
  countries: 0,
};

type StatKey = Exclude<keyof DisplayStats, 'override'>;

const STAT_LABELS: { key: StatKey; label: string }[] = [
  { key: 'marinas', label: 'Marinas Worldwide' },
  { key: 'partners', label: 'Verified Partners' },
  { key: 'resources', label: 'Resources' },
  { key: 'events', label: 'Events per Year' },
  { key: 'countries', label: 'Countries' },
];

export function AdminPlatformSettings() {
  const { profile } = useAuth();
  const isAdmin = profile?.persona === 'admin';
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [stats, setStats] = useState<DisplayStats>(DEFAULT_STATS);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('platform_settings')
      .select('*')
      .eq('key', 'display_stats')
      .single();

    if (error && error.code !== 'PGRST116') {
      toast({ title: 'Failed to load settings', description: error.message, variant: 'destructive' });
    }

    if (data?.value) {
      setStats({ ...DEFAULT_STATS, ...(data.value as DisplayStats) });
    }
    setLoading(false);
  };

  const handleChange = (key: StatKey, value: string) => {
    const num = parseInt(value, 10);
    setStats((prev) => ({ ...prev, [key]: isNaN(num) ? 0 : num }));
  };

  const handleSave = async () => {
    setSaving(true);
    const { error } = await supabase
      .from('platform_settings')
      .upsert(
        { key: 'display_stats', value: stats, updated_at: new Date().toISOString() },
        { onConflict: 'key' }
      );

    if (error) {
      toast({ title: 'Error saving settings', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Settings saved successfully!' });
    }
    setSaving(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <RefreshCw className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Platform Settings</h1>
        <p className="text-muted-foreground mt-1">
          Manage platform-wide configuration and display settings.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6 space-y-6">
          <div>
            <h2 className="text-lg font-semibold">Homepage Display Stats</h2>
            <p className="text-sm text-muted-foreground mt-1">
              The homepage and Become a Member page show live counts: verified marinas, verified partners,
              their countries and published resources. The numbers below are only used when the switch is on,
              or as a stand-in if a live count fails to load.
            </p>
          </div>

          <div className="flex items-start gap-3 rounded-lg border p-4 max-w-xl">
            <Switch
              id="stats-override"
              checked={stats.override === true}
              onCheckedChange={(on) => setStats((prev) => ({ ...prev, override: on }))}
            />
            <div>
              <Label htmlFor="stats-override" className="text-sm font-medium">Show these numbers instead of the live counts</Label>
              <p className="text-xs text-muted-foreground mt-1">
                Off (recommended): figures update by themselves. On: the site shows the numbers below as "N+".
              </p>
            </div>
          </div>

          <div className="grid gap-4 max-w-md">
            {STAT_LABELS.map(({ key, label }) => (
              <div key={key} className="flex items-center gap-4">
                <Label className="w-44 shrink-0 text-sm font-medium">{label}</Label>
                <div className="relative flex-1">
                  <Input
                    type="number"
                    min={0}
                    value={stats[key]}
                    onChange={(e) => handleChange(key, e.target.value)}
                    className="pr-8"
                  />
                  {stats[key] > 0 && (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">
                      +
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          <p className="text-xs text-muted-foreground">
            With the switch on, set a number to 0 to hide that figure.
          </p>

          <div>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Save Changes
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
