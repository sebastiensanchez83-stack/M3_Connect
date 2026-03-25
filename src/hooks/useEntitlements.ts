import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

export interface Entitlement {
  feature_key: string;
  enabled: boolean;
  quota: number | null;
}

export interface FeatureUsage {
  feature_key: string;
  usage_count: number;
  period_start: string;
  period_end: string;
}

interface UseEntitlementsReturn {
  isFeatureEnabled: (featureKey: string) => boolean;
  getQuota: (featureKey: string) => number | null;
  getUsage: (featureKey: string) => FeatureUsage | null;
  isLoading: boolean;
}

export function useEntitlements(): UseEntitlementsReturn {
  const { organization } = useAuth();
  const [entitlements, setEntitlements] = useState<Entitlement[]>([]);
  const [usageMap, setUsageMap] = useState<Map<string, FeatureUsage>>(new Map());
  const [isLoading, setIsLoading] = useState(true);

  const fetchEntitlements = useCallback(async (orgId: string) => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('entitlements')
        .select('feature_key, enabled, quota')
        .eq('organization_id', orgId);

      if (error) throw error;

      setEntitlements((data ?? []) as Entitlement[]);

      // Fetch current period usage for all features
      const today = new Date().toISOString().split('T')[0];
      const { data: usageData, error: usageError } = await supabase
        .from('feature_usage')
        .select('feature_key, usage_count, period_start, period_end')
        .eq('organization_id', orgId)
        .lte('period_start', today)
        .gte('period_end', today);

      if (usageError) throw usageError;

      const map = new Map<string, FeatureUsage>();
      for (const row of (usageData ?? []) as FeatureUsage[]) {
        map.set(row.feature_key, row);
      }
      setUsageMap(map);
    } catch {
      // On error, leave entitlements empty — the UI will handle the disabled state
      setEntitlements([]);
      setUsageMap(new Map());
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!organization?.id) {
      setEntitlements([]);
      setUsageMap(new Map());
      setIsLoading(false);
      return;
    }
    fetchEntitlements(organization.id);
  }, [organization?.id, fetchEntitlements]);

  const isFeatureEnabled = useCallback(
    (featureKey: string): boolean => {
      const entitlement = entitlements.find((e) => e.feature_key === featureKey);
      return entitlement?.enabled ?? false;
    },
    [entitlements]
  );

  const getQuota = useCallback(
    (featureKey: string): number | null => {
      const entitlement = entitlements.find((e) => e.feature_key === featureKey);
      if (!entitlement) return null;
      return entitlement.quota;
    },
    [entitlements]
  );

  const getUsage = useCallback(
    (featureKey: string): FeatureUsage | null => {
      return usageMap.get(featureKey) ?? null;
    },
    [usageMap]
  );

  return { isFeatureEnabled, getQuota, getUsage, isLoading };
}
