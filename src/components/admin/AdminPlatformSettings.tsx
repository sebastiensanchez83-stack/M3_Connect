import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart3, RefreshCw, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { RegistrationFlagsPanel } from './settings/RegistrationFlagsPanel';
import { ReviewSettingsPanel } from './settings/ReviewSettingsPanel';
import { AdminLoading, AdminPageHeader, AdminPanel, ADMIN_BTN_PRIMARY } from './AdminUI';
import { FIELD, FormField } from './AdminStyleKit';

/**
 * Settings > Site settings (/admin/settings): the registration switches, the review list's
 * settings and the figures of the home page. Refonte admin style (Oct 2026); same reads and
 * writes as before (platform_settings.display_stats).
 */

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
  { key: 'marinas', label: 'Marinas worldwide' },
  { key: 'partners', label: 'Validated service providers' },
  { key: 'resources', label: 'Resources' },
  { key: 'events', label: 'Events per year' },
  { key: 'countries', label: 'Countries' },
];

export function AdminPlatformSettings() {
  const { t } = useTranslation();
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
      toast({ title: 'The figures are saved' });
    }
    setSaving(false);
  };

  if (loading) return <AdminLoading />;

  return (
    <div className="space-y-6">
      <AdminPageHeader
        className="mb-0"
        title={t('adm2.settings.title', 'Site settings')}
        description={t('adm2.settings.desc', 'The registration switches, the settings of the To validate list and the figures shown on the home page.')}
      />

      {/* Registration switches (spec §13) and the review list's settings (spec §8.4). */}
      <RegistrationFlagsPanel />
      <ReviewSettingsPanel />

      <AdminPanel
        icon={BarChart3}
        title={t('adm2.settings.statsTitle', 'Figures on the home page')}
        description={t('adm2.settings.statsDesc', 'The home page and the Become a member page count by themselves: validated marinas, validated service providers, their countries and published resources. The numbers below are used only when the switch is on, or if a live count cannot be read.')}
      >
        <div className="space-y-5">
          <label htmlFor="stats-override" className="flex max-w-xl cursor-pointer items-start gap-3 rounded-xl border border-rule bg-white p-4">
            <Switch
              id="stats-override"
              checked={stats.override === true}
              onCheckedChange={(on) => setStats((prev) => ({ ...prev, override: on }))}
              className="mt-0.5"
            />
            <span>
              <span className="block text-[14px] font-semibold leading-5 text-navy">{t('adm2.settings.override', 'Show these numbers instead of the live counts')}</span>
              <span className="mt-0.5 block text-[13px] leading-[18px] text-meta">
                {t('adm2.settings.overrideHint', 'Off (recommended): the figures update by themselves. On: the site shows the numbers below as "N+".')}
              </span>
            </span>
          </label>

          <div className="grid max-w-xl gap-4 sm:grid-cols-2">
            {STAT_LABELS.map(({ key, label }) => (
              <FormField key={key} label={label} htmlFor={`stat-${key}`}>
                <div className="relative">
                  <Input
                    id={`stat-${key}`}
                    type="number"
                    min={0}
                    value={stats[key]}
                    onChange={(e) => handleChange(key, e.target.value)}
                    className={`${FIELD} pr-8`}
                  />
                  {stats[key] > 0 && (
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[14px] text-meta" aria-hidden="true">
                      +
                    </span>
                  )}
                </div>
              </FormField>
            ))}
          </div>

          <p className="text-[13px] leading-5 text-meta">
            {t('adm2.settings.zeroHint', 'With the switch on, set a number to 0 to hide that figure.')}
          </p>

          <div className="border-t border-rule pt-4">
            <Button variant="secondary" size="sm" className={`${ADMIN_BTN_PRIMARY} w-full sm:w-auto`} onClick={handleSave} disabled={saving}>
              {saving
                ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                : <Save className="mr-2 h-4 w-4" aria-hidden="true" />}
              {saving ? t('adm2.saving', 'Saving…') : t('adm2.settings.save', 'Save the figures')}
            </Button>
          </div>
        </div>
      </AdminPanel>
    </div>
  );
}
