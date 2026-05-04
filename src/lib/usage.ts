import type { Tier } from '@/types';
import { prisma } from '@/lib/db/prisma';
import { TIER_LIMITS } from '@/lib/tier-limits';

// Re-exported for backwards compatibility — prefer importing from
// `@/lib/tier-limits` in client components (TM-98).
export { TIER_LIMITS };

/**
 * TM-93 — assetId character whitelist for safe interpolation into a SQLite
 * `json_extract` JSON path. cuids are `[a-z0-9]+`; template ids are
 * `template-<cuid>`. Anything else is rejected before we touch the DB.
 */
const ASSET_ID_RE = /^[a-zA-Z0-9_-]+$/;

export function isValidAssetIdForUsageKey(assetId: string): boolean {
  return ASSET_ID_RE.test(assetId) && assetId.length <= 128;
}

/**
 * TM-93 — atomically reserve one edit slot for `assetId` against the
 * per-asset edit cap. The previous code did
 * `findUnique → JSON.parse → compare → editAsset → update`,
 * which is the same TOCTOU pattern fixed for /api/generate in TM-92 (see
 * `wiki/02-dev/tech-notes/2026-04-27-TM-92-fix.md`). With JSON column the
 * Prisma `updateMany` route is awkward (no per-key conditional), so we use
 * SQLite's `json_extract` / `json_set` inside a single atomic UPDATE.
 *
 * Returns `true` when a slot was reserved (caller proceeds with the LLM
 * call), `false` when the cap has already been hit (caller returns 429).
 *
 * `Infinity` cap (PRO tier) bypasses the WHERE and always succeeds — but we
 * still increment so the counter is observable in the editUsage map.
 */
export async function reserveEditSlot(params: {
  userId: string;
  assetId: string;
  limit: number;
}): Promise<boolean> {
  const { userId, assetId, limit } = params;
  if (!isValidAssetIdForUsageKey(assetId)) {
    // Refuse rather than open up a SQL/JSON-path injection surface.
    throw new Error('reserveEditSlot: invalid assetId');
  }
  // SQLite json paths use `$.<key>`. assetId is whitelisted above so direct
  // interpolation is safe; `limit` is bound as a parameter.
  const path = `$."${assetId}"`;
  const effectiveLimit = Number.isFinite(limit) ? limit : Number.MAX_SAFE_INTEGER;
  const affected = await prisma.$executeRaw`
    UPDATE User
    SET editUsage = json_set(
      editUsage,
      ${path},
      COALESCE(json_extract(editUsage, ${path}), 0) + 1
    )
    WHERE id = ${userId}
      AND COALESCE(json_extract(editUsage, ${path}), 0) < ${effectiveLimit}
  `;
  return affected === 1;
}

/**
 * Refund an edit slot reserved by `reserveEditSlot`. Used on the LLM-failure
 * path so a 5xx never burns an edit. Atomic single-statement UPDATE; floors
 * at 0 to avoid drift if a refund races a manual reset.
 */
export async function refundEditSlot(params: {
  userId: string;
  assetId: string;
}): Promise<void> {
  const { userId, assetId } = params;
  if (!isValidAssetIdForUsageKey(assetId)) return;
  const path = `$."${assetId}"`;
  await prisma.$executeRaw`
    UPDATE User
    SET editUsage = json_set(
      editUsage,
      ${path},
      MAX(COALESCE(json_extract(editUsage, ${path}), 0) - 1, 0)
    )
    WHERE id = ${userId}
  `;
}

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

export function checkUploadLimit(params: {
  tier: Tier;
  kind: 'image' | 'font';
  currentCount: number;
}): UsageCheckResult {
  const limit = params.kind === 'image'
    ? TIER_LIMITS[params.tier].uploadImages
    : TIER_LIMITS[params.tier].uploadFonts;
  if (params.currentCount >= limit) {
    const noun = params.kind === 'image' ? 'images' : 'fonts';
    return {
      allowed: false,
      reason: params.tier === 'FREE'
        ? `Upload limit reached (${limit} ${noun} on Free plan). Upgrade to Pro for unlimited uploads.`
        : `Upload limit reached (${limit} ${noun}).`,
    };
  }
  return { allowed: true };
}
