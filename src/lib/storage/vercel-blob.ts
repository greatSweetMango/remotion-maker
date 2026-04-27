/**
 * Vercel Blob storage provider — gated by `BLOB_READ_WRITE_TOKEN`.
 *
 * This file lazily imports `@vercel/blob` so the project still builds and
 * tests still pass when the dependency is not installed (it isn't yet —
 * adding it requires user approval per TM-31 automation policy). When the
 * token + package are present, `getStorageProvider()` will pick this one.
 */
import type { PutOptions, StorageObject, StorageProvider } from './types';

export function vercelBlobConfigured(): boolean {
  return !!process.env.BLOB_READ_WRITE_TOKEN && process.env.BLOB_READ_WRITE_TOKEN !== 'placeholder';
}

export const vercelBlobProvider: StorageProvider = {
  name: 'vercel-blob',

  async put(opts: PutOptions): Promise<StorageObject> {
    // Lazy require so the module can be referenced even when @vercel/blob
    // isn't installed (e.g. in CI without prod creds).
    let blobMod: { put: (key: string, body: Buffer, options: Record<string, unknown>) => Promise<{ url: string }> };
    try {
      blobMod = (await import(/* webpackIgnore: true */ '@vercel/blob' as string)) as never;
    } catch {
      throw new Error('Vercel Blob provider selected but `@vercel/blob` is not installed.');
    }
    const key = `${opts.userId}/${opts.kind}/${Date.now()}-${opts.filename}`;
    const result = await blobMod.put(key, opts.body, {
      access: 'public',
      contentType: opts.mimeType,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    return { url: result.url, storageKey: result.url, provider: 'vercel-blob' };
  },

  async delete(storageKey: string): Promise<boolean> {
    let blobMod: { del: (key: string, options: Record<string, unknown>) => Promise<void> };
    try {
      blobMod = (await import(/* webpackIgnore: true */ '@vercel/blob' as string)) as never;
    } catch {
      return false;
    }
    try {
      await blobMod.del(storageKey, { token: process.env.BLOB_READ_WRITE_TOKEN });
      return true;
    } catch {
      return false;
    }
  },
};
