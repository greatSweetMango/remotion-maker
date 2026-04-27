/**
 * Local-disk placeholder storage provider for TM-31.
 *
 * Used when no external storage credential is configured. Writes to
 * `./.uploads/<userId>/<kind>/<key>` and serves via `/api/upload/file/[key]`.
 * NOT for production — single-instance only, no CDN, no auth on the file
 * route. Intended so the upload UI / API / schema can be developed and
 * tested before the production storage backend is provisioned.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { PutOptions, StorageObject, StorageProvider } from './types';

// Resolved lazily so test envs can override via env var.
function uploadRoot(): string {
  return process.env.LOCAL_UPLOAD_DIR || path.join(process.cwd(), '.uploads');
}

function safeExtFromMime(mimeType: string, fallback: string): string {
  const map: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'image/gif': 'gif',
    'font/otf': 'otf',
    'font/ttf': 'ttf',
    'font/woff': 'woff',
    'font/woff2': 'woff2',
    'application/font-woff': 'woff',
    'application/font-woff2': 'woff2',
    'application/x-font-ttf': 'ttf',
    'application/x-font-otf': 'otf',
  };
  return map[mimeType] || fallback;
}

export const localStorageProvider: StorageProvider = {
  name: 'local',

  async put(opts: PutOptions): Promise<StorageObject> {
    const root = uploadRoot();
    const dir = path.join(root, opts.userId, opts.kind);
    await fs.mkdir(dir, { recursive: true });

    const id = crypto.randomBytes(12).toString('hex');
    const ext = safeExtFromMime(opts.mimeType, path.extname(opts.filename).replace('.', '') || 'bin');
    const key = `${opts.userId}/${opts.kind}/${id}.${ext}`;
    const filePath = path.join(root, key);
    await fs.writeFile(filePath, opts.body);

    return {
      url: `/api/upload/file/${encodeURIComponent(key)}`,
      storageKey: key,
      provider: 'local',
    };
  },

  async delete(storageKey: string): Promise<boolean> {
    const root = uploadRoot();
    // Reject path traversal; storageKey is `userId/kind/<id>.<ext>`.
    if (storageKey.includes('..') || path.isAbsolute(storageKey)) return false;
    const filePath = path.join(root, storageKey);
    try {
      await fs.unlink(filePath);
      return true;
    } catch (err: unknown) {
      if (typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === 'ENOENT') {
        return true; // already gone
      }
      return false;
    }
  },
};
