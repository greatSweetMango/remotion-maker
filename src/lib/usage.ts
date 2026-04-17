import type { Tier } from '@/types';

export const TIER_LIMITS = {
  FREE: { monthlyGenerations: 3, editsPerAsset: 3 },
  PRO:  { monthlyGenerations: 200, editsPerAsset: Infinity },
} as const;

interface UsageCheckResult {
  allowed: boolean;
  reason?: string;
}

export function checkGenerationLimit(params: { tier: Tier; monthlyUsage: number }): UsageCheckResult {
  const limit = TIER_LIMITS[params.tier].monthlyGenerations;
  if (params.monthlyUsage >= limit) {
    return {
      allowed: false,
      reason: `Monthly generation limit reached (${limit}). ${params.tier === 'FREE' ? 'Upgrade to Pro for 200/month.' : 'Purchase additional credits.'}`,
    };
  }
  return { allowed: true };
}

export function checkEditLimit(params: { tier: Tier; editCount: number }): UsageCheckResult {
  const limit = TIER_LIMITS[params.tier].editsPerAsset;
  if (params.editCount >= limit) {
    return {
      allowed: false,
      reason: `Edit limit reached (${limit} per asset on Free plan). Upgrade to Pro for unlimited edits.`,
    };
  }
  return { allowed: true };
}
