/**
 * Tests for /api/asset/[id]/thumbnail — upload + delete custom thumbnail
 * (TM-109). Validates auth, ownership, MIME/size validation, and that the
 * Asset.thumbnailUrl column is updated. The on-disk file write is exercised
 * against a temp directory by chdir'ing process.cwd() in `beforeAll`.
 */
import { NextRequest } from 'next/server';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import os from 'node:os';

jest.mock('@/lib/auth', () => ({ auth: jest.fn() }));
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    asset: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}));

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';
import {
  POST,
  DELETE,
  MAX_THUMBNAIL_BYTES,
  ALLOWED_THUMBNAIL_MIME,
} from '@/app/api/asset/[id]/thumbnail/route';

const mockedAuth = auth as jest.MockedFunction<typeof auth>;
const mockedAsset = (
  prisma as unknown as {
    asset: { findUnique: jest.Mock; update: jest.Mock };
  }
).asset;

type AuthRet = ReturnType<typeof auth> extends Promise<infer R> ? R : never;
const session = (id: string) =>
  ({ user: { id } } as unknown as AuthRet);

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

function postReq(body: BodyInit, contentType?: string) {
  const headers: Record<string, string> = {};
  if (contentType) headers['content-type'] = contentType;
  return new NextRequest('http://localhost/api/asset/x/thumbnail', {
    method: 'POST',
    body,
    headers,
  });
}

function deleteReq() {
  return new NextRequest('http://localhost/api/asset/x/thumbnail', {
    method: 'DELETE',
  });
}

function multipart(file: File): { body: BodyInit; type: string } {
  const fd = new FormData();
  fd.append('file', file);
  // NextRequest accepts FormData directly and synthesizes the boundary header
  // — we rely on that rather than hand-rolling the body.
  return { body: fd as unknown as BodyInit, type: '' };
}

let prevCwd: string;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tm109-thumb-'));
  prevCwd = process.cwd();
  process.chdir(tmpDir);
});

afterAll(async () => {
  process.chdir(prevCwd);
  await fs.rm(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('POST /api/asset/[id]/thumbnail', () => {
  it('returns 401 without session', async () => {
    mockedAuth.mockResolvedValue(null as unknown as AuthRet);
    const { body } = multipart(
      new File([new Uint8Array([0x89, 0x50])], 'a.png', { type: 'image/png' }),
    );
    const res = await POST(postReq(body), ctx('a1'));
    expect(res.status).toBe(401);
  });

  it('returns 400 when body is not multipart', async () => {
    mockedAuth.mockResolvedValue(session('u1'));
    const res = await POST(
      postReq(JSON.stringify({ x: 1 }), 'application/json'),
      ctx('a1'),
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when `file` field is missing', async () => {
    mockedAuth.mockResolvedValue(session('u1'));
    const fd = new FormData();
    fd.append('other', 'value');
    const res = await POST(postReq(fd as unknown as BodyInit), ctx('a1'));
    expect(res.status).toBe(400);
  });

  it('returns 415 for unsupported MIME (e.g. gif)', async () => {
    mockedAuth.mockResolvedValue(session('u1'));
    const { body } = multipart(
      new File([new Uint8Array([0x47, 0x49, 0x46])], 'a.gif', {
        type: 'image/gif',
      }),
    );
    const res = await POST(postReq(body), ctx('a1'));
    expect(res.status).toBe(415);
  });

  it('returns 413 when file exceeds size limit', async () => {
    mockedAuth.mockResolvedValue(session('u1'));
    const big = new Uint8Array(MAX_THUMBNAIL_BYTES + 1);
    const { body } = multipart(
      new File([big], 'big.png', { type: 'image/png' }),
    );
    const res = await POST(postReq(body), ctx('a1'));
    expect(res.status).toBe(413);
  });

  it('returns 400 for empty file', async () => {
    mockedAuth.mockResolvedValue(session('u1'));
    const { body } = multipart(
      new File([new Uint8Array(0)], 'empty.png', { type: 'image/png' }),
    );
    const res = await POST(postReq(body), ctx('a1'));
    expect(res.status).toBe(400);
  });

  it('returns 404 for missing or soft-deleted asset', async () => {
    mockedAuth.mockResolvedValue(session('u1'));
    mockedAsset.findUnique.mockResolvedValueOnce(null);
    let { body } = multipart(
      new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' }),
    );
    let res = await POST(postReq(body), ctx('a1'));
    expect(res.status).toBe(404);

    mockedAsset.findUnique.mockResolvedValueOnce({
      id: 'a1',
      userId: 'u1',
      deletedAt: new Date(),
    });
    ({ body } = multipart(
      new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' }),
    ));
    res = await POST(postReq(body), ctx('a1'));
    expect(res.status).toBe(404);
  });

  it('returns 403 when caller does not own the asset', async () => {
    mockedAuth.mockResolvedValue(session('u1'));
    mockedAsset.findUnique.mockResolvedValue({
      id: 'a1',
      userId: 'other',
      deletedAt: null,
    });
    const { body } = multipart(
      new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' }),
    );
    const res = await POST(postReq(body), ctx('a1'));
    expect(res.status).toBe(403);
  });

  it('writes file and updates Asset.thumbnailUrl on success', async () => {
    mockedAuth.mockResolvedValue(session('u1'));
    mockedAsset.findUnique.mockResolvedValue({
      id: 'a1',
      userId: 'u1',
      deletedAt: null,
    });
    mockedAsset.update.mockResolvedValue({ id: 'a1' });

    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const { body } = multipart(
      new File([bytes], 'thumb.png', { type: 'image/png' }),
    );
    const res = await POST(postReq(body), ctx('a1'));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { thumbnailUrl: string };
    expect(json.thumbnailUrl).toMatch(
      /^\/uploads\/thumbnails\/a1\.png\?v=\d+$/,
    );

    // File must exist on disk (under our tmp cwd).
    const filePath = path.join(
      process.cwd(),
      'public',
      'uploads',
      'thumbnails',
      'a1.png',
    );
    const stat = await fs.stat(filePath);
    expect(stat.size).toBe(bytes.length);

    // DB updated with the cache-busted URL.
    expect(mockedAsset.update).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: { thumbnailUrl: json.thumbnailUrl },
      select: { id: true },
    });
  });

  it('exposes the documented MIME allowlist', () => {
    expect([...ALLOWED_THUMBNAIL_MIME].sort()).toEqual(
      ['image/jpeg', 'image/png', 'image/webp'].sort(),
    );
  });
});

describe('DELETE /api/asset/[id]/thumbnail', () => {
  it('returns 401 without session', async () => {
    mockedAuth.mockResolvedValue(null as unknown as AuthRet);
    const res = await DELETE(deleteReq(), ctx('a1'));
    expect(res.status).toBe(401);
  });

  it('returns 404 when asset is missing', async () => {
    mockedAuth.mockResolvedValue(session('u1'));
    mockedAsset.findUnique.mockResolvedValueOnce(null);
    const res = await DELETE(deleteReq(), ctx('a1'));
    expect(res.status).toBe(404);
  });

  it('clears Asset.thumbnailUrl and removes any on-disk file', async () => {
    mockedAuth.mockResolvedValue(session('u1'));
    mockedAsset.findUnique.mockResolvedValue({
      id: 'a2',
      userId: 'u1',
      deletedAt: null,
    });
    mockedAsset.update.mockResolvedValue({ id: 'a2' });

    // Pre-seed a file as if a previous upload succeeded.
    const dir = path.join(process.cwd(), 'public', 'uploads', 'thumbnails');
    await fs.mkdir(dir, { recursive: true });
    const seeded = path.join(dir, 'a2.webp');
    await fs.writeFile(seeded, Buffer.from([1, 2, 3]));

    const res = await DELETE(deleteReq(), ctx('a2'));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { thumbnailUrl: string | null };
    expect(json.thumbnailUrl).toBeNull();

    await expect(fs.stat(seeded)).rejects.toThrow();
    expect(mockedAsset.update).toHaveBeenCalledWith({
      where: { id: 'a2' },
      data: { thumbnailUrl: null },
      select: { id: true },
    });
  });
});
