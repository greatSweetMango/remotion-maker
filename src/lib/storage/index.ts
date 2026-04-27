/**
 * Storage provider selection — picks the active backend at runtime based on
 * env. Falls back to `local` when no production credential is configured so
 * dev / test continues to work.
 *
 * Selection precedence:
 *   1. `STORAGE_PROVIDER=local` (explicit override, takes priority for tests)
 *   2. Vercel Blob if `BLOB_READ_WRITE_TOKEN` is set and not "placeholder"
 *   3. Local placeholder
 */
import { localStorageProvider } from './local';
import { vercelBlobProvider, vercelBlobConfigured } from './vercel-blob';
import type { StorageProvider } from './types';

let cachedProvider: StorageProvider | null = null;

export function getStorageProvider(): StorageProvider {
  if (cachedProvider) return cachedProvider;

  const explicit = process.env.STORAGE_PROVIDER;
  if (explicit === 'local') {
    cachedProvider = localStorageProvider;
    return cachedProvider;
  }

  if (vercelBlobConfigured()) {
    cachedProvider = vercelBlobProvider;
    return cachedProvider;
  }

  cachedProvider = localStorageProvider;
  return cachedProvider;
}

/** Test helper — reset the cached provider so env changes are picked up. */
export function _resetStorageProviderForTest(): void {
  cachedProvider = null;
}

// Allowed MIME types per kind. Kept here so both API + UI can import.
export const ALLOWED_IMAGE_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/svg+xml',
  'image/gif',
]);

export const ALLOWED_FONT_MIME = new Set([
  'font/otf',
  'font/ttf',
  'font/woff',
  'font/woff2',
  'application/font-woff',
  'application/font-woff2',
  'application/x-font-ttf',
  'application/x-font-otf',
  // Some browsers send octet-stream for .otf/.ttf; we accept it but the
  // server still validates the file extension as a secondary check.
  'application/octet-stream',
]);

export const FONT_EXT = new Set(['otf', 'ttf', 'woff', 'woff2']);
export const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'svg', 'gif']);

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB
export const MAX_FONT_BYTES = 2 * 1024 * 1024; // 2 MB

export type { StorageProvider, StorageKind, StorageObject, PutOptions } from './types';
