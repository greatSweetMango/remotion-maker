/**
 * TM-89 — local-filesystem asset cache (default backend, no credentials).
 *
 * Preserves the exact on-disk layout + public URL convention established by
 * TM-90's `asset-gen-stage.ts` so existing cached files keep resolving:
 *   - bytes → `public/uploads/asset-gen/<cacheKey>.png`
 *   - url   → `/uploads/asset-gen/<cacheKey>.png`
 *
 * `cwd` is resolved lazily on every call so tests can redirect writes by
 * overriding `process.cwd` (the TM-90 test harness does exactly this).
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AssetCache, CachedAsset, PutAssetInput } from './types';

export const ASSET_GEN_DIR_REL = path.join('public', 'uploads', 'asset-gen');
export const ASSET_GEN_PUBLIC_PREFIX = '/uploads/asset-gen';

function publicUrlFor(cacheKey: string): string {
  return `${ASSET_GEN_PUBLIC_PREFIX}/${cacheKey}.png`;
}

function diskPathFor(cacheKey: string): string {
  return path.join(process.cwd(), ASSET_GEN_DIR_REL, `${cacheKey}.png`);
}

export const fsAssetCache: AssetCache = {
  name: 'fs',

  async get(cacheKey: string): Promise<CachedAsset | null> {
    const diskPath = diskPathFor(cacheKey);
    try {
      const bytes = await fs.readFile(diskPath);
      return { url: publicUrlFor(cacheKey), bytes, provider: 'fs' };
    } catch {
      // ENOENT or any read error → treat as a miss.
      return null;
    }
  },

  async put(input: PutAssetInput): Promise<string> {
    const diskPath = diskPathFor(input.cacheKey);
    await fs.mkdir(path.dirname(diskPath), { recursive: true });
    await fs.writeFile(diskPath, input.bytes);
    return publicUrlFor(input.cacheKey);
  },
};
