/**
 * TM-89 — asset-cache backend selection.
 *
 * Mirrors `src/lib/storage/index.ts` (TM-31): pick R2 when its env vars are
 * provisioned, otherwise fall back to the local-FS cache. Selection is
 * resolved lazily per call so test envs can flip env vars freely.
 *
 * ADR-0022: the only behaviour change is "cache hit ⇒ skip image-gen". The
 * cache key is `hashAssetGenInputs(prompt, answers, style)` (re-exported from
 * the stage so there is a single source of truth).
 */
import { fsAssetCache } from './fs-cache';
import { r2AssetCache, r2Configured } from './r2-cache';
import type { AssetCache } from './types';

export type { AssetCache, CachedAsset, PutAssetInput } from './types';
export { fsAssetCache, ASSET_GEN_DIR_REL, ASSET_GEN_PUBLIC_PREFIX } from './fs-cache';
export { r2AssetCache, r2Configured, createR2AssetCache, r2ConfigFromEnv } from './r2-cache';
export type { R2Config, FetchLike } from './r2-cache';

/**
 * Resolve the active cache backend. R2 when configured (production /
 * serverless — survives redeploy), else local FS (dev / no creds).
 */
export function getAssetCache(env: NodeJS.ProcessEnv = process.env): AssetCache {
  if (r2Configured(env)) {
    try {
      return r2AssetCache(env);
    } catch {
      // Misconfigured R2 → safe FS fallback rather than crashing generation.
      return fsAssetCache;
    }
  }
  return fsAssetCache;
}
