import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { localStorageProvider } from '@/lib/storage/local';

describe('localStorageProvider', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'tm31-storage-'));
    process.env.LOCAL_UPLOAD_DIR = tmp;
  });

  afterEach(async () => {
    delete process.env.LOCAL_UPLOAD_DIR;
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('writes a PNG and returns a URL + storageKey', async () => {
    const obj = await localStorageProvider.put({
      userId: 'u1',
      kind: 'image',
      filename: 'logo.png',
      mimeType: 'image/png',
      body: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    });
    expect(obj.provider).toBe('local');
    expect(obj.storageKey).toMatch(/^u1\/image\/[a-f0-9]+\.png$/);
    expect(obj.url).toContain('/api/upload/file/');

    const onDisk = await fs.readFile(path.join(tmp, obj.storageKey));
    expect(onDisk.length).toBe(4);
  });

  it('uses correct extension for woff2 fonts', async () => {
    const obj = await localStorageProvider.put({
      userId: 'u1',
      kind: 'font',
      filename: 'Inter.woff2',
      mimeType: 'font/woff2',
      body: Buffer.from([0]),
    });
    expect(obj.storageKey).toMatch(/\.woff2$/);
  });

  it('delete removes the file and returns true', async () => {
    const obj = await localStorageProvider.put({
      userId: 'u1', kind: 'image', filename: 'a.png', mimeType: 'image/png', body: Buffer.from([1]),
    });
    expect(await localStorageProvider.delete(obj.storageKey)).toBe(true);
    await expect(fs.access(path.join(tmp, obj.storageKey))).rejects.toBeTruthy();
  });

  it('delete is idempotent (already-gone returns true)', async () => {
    expect(await localStorageProvider.delete('u1/image/nonexistent.png')).toBe(true);
  });

  it('delete rejects path traversal', async () => {
    expect(await localStorageProvider.delete('../etc/passwd')).toBe(false);
    expect(await localStorageProvider.delete('/etc/passwd')).toBe(false);
  });
});
