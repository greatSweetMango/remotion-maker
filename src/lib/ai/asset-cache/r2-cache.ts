/**
 * TM-89 — Cloudflare R2 (S3-compatible) asset cache adapter.
 *
 * Env-gated, mirroring `src/lib/storage/vercel-blob.ts` (TM-31 / ADR-0013):
 * the adapter is inert unless all four R2 env vars are present, so the app
 * builds + tests without any external credential. Real bucket connection /
 * deploy is escalated (TeamLead blocking_questions) — this code is validated
 * here against a deterministic MOCK fetch (see r2-cache.test.ts).
 *
 * No new npm dependency: requests are signed with `./sigv4` (Node built-in
 * crypto) and sent via the global `fetch` (Node 22). The fetch fn is
 * injectable for tests.
 *
 * Object layout: `<keyPrefix>/<cacheKey>.png` in the bucket. Public URL is
 * derived from `R2_PUBLIC_BASE_URL` when set (a bucket public domain / CDN),
 * else falls back to the S3 endpoint URL (private — caller must front it).
 *
 * Env:
 *   R2_BUCKET_NAME, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
 *   R2_PUBLIC_BASE_URL (optional), R2_KEY_PREFIX (optional, default asset-gen)
 */
import { signS3Request } from './sigv4';
import type { AssetCache, CachedAsset, PutAssetInput } from './types';

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: Buffer },
) => Promise<{
  ok: boolean;
  status: number;
  arrayBuffer: () => Promise<ArrayBuffer>;
}>;

export interface R2Config {
  bucket: string;
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBaseUrl?: string;
  keyPrefix: string;
  region: string;
  /** Injectable for tests; defaults to global fetch. */
  fetchFn?: FetchLike;
}

/** True when every required R2 env var is present + non-placeholder. */
export function r2Configured(env: NodeJS.ProcessEnv = process.env): boolean {
  const required = ['R2_BUCKET_NAME', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'];
  return required.every((k) => {
    const v = env[k];
    return !!v && v !== 'placeholder';
  });
}

/** Build an R2Config from env (throws if not configured). */
export function r2ConfigFromEnv(env: NodeJS.ProcessEnv = process.env): R2Config {
  if (!r2Configured(env)) {
    throw new Error('r2-cache: R2 env vars are not configured');
  }
  return {
    bucket: env.R2_BUCKET_NAME!,
    accountId: env.R2_ACCOUNT_ID!,
    accessKeyId: env.R2_ACCESS_KEY_ID!,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
    publicBaseUrl: env.R2_PUBLIC_BASE_URL,
    keyPrefix: env.R2_KEY_PREFIX || 'asset-gen',
    region: 'auto',
  };
}

function objectKey(cfg: R2Config, cacheKey: string): string {
  return `${cfg.keyPrefix}/${cacheKey}.png`;
}

/** S3 endpoint URL for an object (used for signed GET/PUT). */
function endpointUrl(cfg: R2Config, cacheKey: string): string {
  return `https://${cfg.accountId}.r2.cloudflarestorage.com/${cfg.bucket}/${objectKey(cfg, cacheKey)}`;
}

/** Browser-fetchable URL: public base when configured, else the endpoint. */
function publicUrl(cfg: R2Config, cacheKey: string): string {
  if (cfg.publicBaseUrl) {
    const base = cfg.publicBaseUrl.replace(/\/+$/, '');
    return `${base}/${objectKey(cfg, cacheKey)}`;
  }
  return endpointUrl(cfg, cacheKey);
}

/** Construct an R2 AssetCache from an explicit config (DI-friendly). */
export function createR2AssetCache(cfg: R2Config): AssetCache {
  const doFetch: FetchLike = cfg.fetchFn ?? (globalThis.fetch as unknown as FetchLike);

  return {
    name: 'r2',

    async get(cacheKey: string): Promise<CachedAsset | null> {
      try {
        const url = endpointUrl(cfg, cacheKey);
        const signed = signS3Request({
          method: 'GET',
          url,
          region: cfg.region,
          service: 's3',
          accessKeyId: cfg.accessKeyId,
          secretAccessKey: cfg.secretAccessKey,
          body: Buffer.alloc(0),
        });
        const resp = await doFetch(signed.url, { method: 'GET', headers: signed.headers });
        if (!resp.ok) {
          // 404 (miss) or any error → miss. Never throw on get.
          return null;
        }
        const buf = Buffer.from(await resp.arrayBuffer());
        return { url: publicUrl(cfg, cacheKey), bytes: buf, provider: 'r2' };
      } catch {
        // Network failure → degrade to a miss so generation proceeds.
        return null;
      }
    },

    async put(input: PutAssetInput): Promise<string> {
      const url = endpointUrl(cfg, input.cacheKey);
      const contentType = input.contentType ?? 'image/png';
      const signed = signS3Request({
        method: 'PUT',
        url,
        region: cfg.region,
        service: 's3',
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
        body: input.bytes,
        headers: { 'content-type': contentType },
      });
      const resp = await doFetch(signed.url, {
        method: 'PUT',
        headers: signed.headers,
        body: input.bytes,
      });
      if (!resp.ok) {
        throw new Error(`r2-cache: PUT failed with status ${resp.status}`);
      }
      return publicUrl(cfg, input.cacheKey);
    },
  };
}

/** Env-backed R2 cache (throws if not configured). */
export function r2AssetCache(env: NodeJS.ProcessEnv = process.env): AssetCache {
  return createR2AssetCache(r2ConfigFromEnv(env));
}
