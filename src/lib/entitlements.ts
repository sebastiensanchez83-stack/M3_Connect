import { supabase } from '@/lib/supabase';

export interface QuotaCheckResult {
  allowed: boolean;
  enabled: boolean;
  used: number;
  limit: number | null; // null = unlimited
  unlimited: boolean;
  remaining: number | null; // null = unlimited
}

/**
 * Check if an organization has remaining quota for a feature.
 * Returns current usage vs limit, and whether the action is allowed.
 */
export async function checkQuota(
  organizationId: string,
  featureKey: string
): Promise<QuotaCheckResult> {
  // Get entitlement
  const { data: entitlement } = await supabase
    .from('entitlements')
    .select('enabled, quota')
    .eq('organization_id', organizationId)
    .eq('feature_key', featureKey)
    .maybeSingle();

  if (!entitlement) {
    // No entitlement found — feature not configured for this org
    return { allowed: false, enabled: false, used: 0, limit: 0, unlimited: false, remaining: 0 };
  }

  if (!entitlement.enabled) {
    return { allowed: false, enabled: false, used: 0, limit: 0, unlimited: false, remaining: 0 };
  }

  // Unlimited quota
  if (entitlement.quota === null) {
    return { allowed: true, enabled: true, used: 0, limit: null, unlimited: true, remaining: null };
  }

  // Get current period usage
  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];

  const { data: usage } = await supabase
    .from('feature_usage')
    .select('usage_count')
    .eq('organization_id', organizationId)
    .eq('feature_key', featureKey)
    .eq('period_start', periodStart)
    .maybeSingle();

  const used = usage?.usage_count || 0;
  const remaining = Math.max(0, entitlement.quota - used);
  const allowed = remaining > 0;

  return {
    allowed,
    enabled: true,
    used,
    limit: entitlement.quota,
    unlimited: false,
    remaining,
  };
}

/**
 * Increment usage counter for a feature in the current billing period.
 * Uses upsert to create the row if it doesn't exist.
 */
export async function incrementUsage(
  organizationId: string,
  featureKey: string
): Promise<boolean> {
  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

  // Try to increment existing row
  const { data: existing } = await supabase
    .from('feature_usage')
    .select('id, usage_count')
    .eq('organization_id', organizationId)
    .eq('feature_key', featureKey)
    .eq('period_start', periodStart)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from('feature_usage')
      .update({ usage_count: existing.usage_count + 1 })
      .eq('id', existing.id);
    return !error;
  }

  // Create new row
  const { error } = await supabase
    .from('feature_usage')
    .insert({
      organization_id: organizationId,
      feature_key: featureKey,
      period_start: periodStart,
      period_end: periodEnd,
      usage_count: 1,
    });
  return !error;
}

/**
 * Get a human-readable display string for quota usage.
 * Returns "X / Y used" or "Unlimited" or "Not available".
 */
export async function getQuotaDisplay(
  organizationId: string,
  featureKey: string
): Promise<string> {
  const result = await checkQuota(organizationId, featureKey);
  if (!result.enabled) return 'Not available';
  if (result.unlimited) return 'Unlimited';
  return `${result.used} / ${result.limit} used`;
}

/**
 * Check multiple feature quotas at once.
 * Useful for dashboard displays.
 */
export async function checkMultipleQuotas(
  organizationId: string,
  featureKeys: string[]
): Promise<Record<string, QuotaCheckResult>> {
  const results: Record<string, QuotaCheckResult> = {};

  // Batch fetch entitlements
  const { data: entitlements } = await supabase
    .from('entitlements')
    .select('feature_key, enabled, quota')
    .eq('organization_id', organizationId)
    .in('feature_key', featureKeys);

  // Batch fetch usage for current period
  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];

  const { data: usages } = await supabase
    .from('feature_usage')
    .select('feature_key, usage_count')
    .eq('organization_id', organizationId)
    .eq('period_start', periodStart)
    .in('feature_key', featureKeys);

  const entitlementMap = new Map((entitlements || []).map(e => [e.feature_key, e]));
  const usageMap = new Map((usages || []).map(u => [u.feature_key, u.usage_count]));

  for (const key of featureKeys) {
    const ent = entitlementMap.get(key);
    if (!ent || !ent.enabled) {
      results[key] = { allowed: false, enabled: false, used: 0, limit: 0, unlimited: false, remaining: 0 };
      continue;
    }
    if (ent.quota === null) {
      results[key] = { allowed: true, enabled: true, used: 0, limit: null, unlimited: true, remaining: null };
      continue;
    }
    const used = usageMap.get(key) || 0;
    const remaining = Math.max(0, ent.quota - used);
    results[key] = { allowed: remaining > 0, enabled: true, used, limit: ent.quota, unlimited: false, remaining };
  }

  return results;
}
