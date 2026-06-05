/**
 * TM-89 — FS asset cache backend: hit / miss / round-trip.
 *
 * Redirects `public/uploads/asset-gen` to a per-test temp dir via the same
 * `process.cwd` override the TM-90 stage tests use.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fsAssetCache, ASSET_GEN_DIR_REL } from '@/lib/ai/asset-cache';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgAAIAAAUAAeImBZsAAAAASUVORK5CYII=', 'base64');

describe('TM-89 fsAssetCache', () => {
  let tmp: string;
  let originalCwd: () => string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'tm89-fs-'));
    originalCwd = process.cwd;
    Object.defineProperty(process, 'cwd', { value: () => tmp, configurable: true });
  });
  afterEach(async () => {
    Object.defineProperty(process, 'cwd', { value: originalCwd, configurable: true });
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('returns null on a miss', async () => {
    expect(await fsAssetCache.get('deadbeef')).toBeNull();
  });

  it('put then get round-trips bytes + url + provider', async () => {
    const url = await fsAssetCache.put({ cacheKey: 'abc123', bytes: PNG });
    expect(url).toBe('/uploads/asset-gen/abc123.png');

    const hit = await fsAssetCache.get('abc123');
    expect(hit).not.toBeNull();
    expect(hit!.url).toBe('/uploads/asset-gen/abc123.png');
    expect(hit!.provider).toBe('fs');
    expect(Buffer.compare(hit!.bytes, PNG)).toBe(0);

    // bytes really landed on disk under the canonical layout.
    const onDisk = path.join(tmp, ASSET_GEN_DIR_REL, 'abc123.png');
    expect((await fs.stat(onDisk)).size).toBe(PNG.length);
  });

  it('get never throws on a read error (degrades to miss)', async () => {
    // A key that resolves to a directory path read would error; simulate by
    // creating a directory where the file would be.
    await fs.mkdir(path.join(tmp, ASSET_GEN_DIR_REL, 'isdir.png'), { recursive: true });
    expect(await fsAssetCache.get('isdir')).toBeNull();
  });
});
