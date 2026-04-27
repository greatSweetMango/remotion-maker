/**
 * Tests for /api/upload — auth, MIME / size validation, quota, success path.
 * Storage backend is mocked so no FS writes happen during tests.
 */
import { NextRequest } from 'next/server';

jest.mock('@/lib/auth', () => ({
  auth: jest.fn(),
}));

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    uploadedAsset: {
      count: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
    },
  },
}));

jest.mock('@/lib/storage', () => {
  const actual = jest.requireActual('@/lib/storage');
  return {
    ...actual,
    getStorageProvider: () => ({
      name: 'mock',
      put: jest.fn().mockResolvedValue({
        url: 'mock://stored',
        storageKey: 'mock-key',
        provider: 'mock',
      }),
      delete: jest.fn().mockResolvedValue(true),
    }),
  };
});

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';
import { POST, GET } from '@/app/api/upload/route';

const mockedAuth = auth as jest.MockedFunction<typeof auth>;
type SessionShape = ReturnType<typeof auth> extends Promise<infer R> ? R : never;
const m = prisma as unknown as {
  user: { findUnique: jest.Mock };
  uploadedAsset: { count: jest.Mock; create: jest.Mock; findMany: jest.Mock };
};

function buildPostReq(form: FormData): NextRequest {
  return new NextRequest('http://localhost/api/upload', {
    method: 'POST',
    body: form,
  });
}

function fileFrom(name: string, type: string, bytes: number): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

beforeEach(() => {
  jest.clearAllMocks();
  m.user.findUnique.mockResolvedValue({ tier: 'FREE' });
  m.uploadedAsset.count.mockResolvedValue(0);
  m.uploadedAsset.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'up-1', createdAt: new Date(), ...data }));
});

describe('POST /api/upload — auth', () => {
  it('returns 401 without session', async () => {
    mockedAuth.mockResolvedValue(null as unknown as SessionShape);
    const fd = new FormData();
    fd.append('file', fileFrom('a.png', 'image/png', 10));
    fd.append('kind', 'image');
    const res = await POST(buildPostReq(fd));
    expect(res.status).toBe(401);
  });
});

describe('POST /api/upload — validation', () => {
  beforeEach(() => {
    mockedAuth.mockResolvedValue({ user: { id: 'u-1' } } as unknown as SessionShape);
  });

  it('rejects missing file field', async () => {
    const fd = new FormData();
    fd.append('kind', 'image');
    const res = await POST(buildPostReq(fd));
    expect(res.status).toBe(400);
  });

  it('rejects invalid kind', async () => {
    const fd = new FormData();
    fd.append('file', fileFrom('a.png', 'image/png', 10));
    fd.append('kind', 'video');
    const res = await POST(buildPostReq(fd));
    expect(res.status).toBe(400);
  });

  it('rejects unsupported image MIME', async () => {
    const fd = new FormData();
    fd.append('file', fileFrom('a.tiff', 'image/tiff', 10));
    fd.append('kind', 'image');
    const res = await POST(buildPostReq(fd));
    expect(res.status).toBe(415);
  });

  it('rejects oversized image (>5MB)', async () => {
    const fd = new FormData();
    fd.append('file', fileFrom('big.png', 'image/png', 6 * 1024 * 1024));
    fd.append('kind', 'image');
    const res = await POST(buildPostReq(fd));
    expect(res.status).toBe(413);
  });

  it('rejects oversized font (>2MB)', async () => {
    const fd = new FormData();
    fd.append('file', fileFrom('Big.woff2', 'font/woff2', 3 * 1024 * 1024));
    fd.append('kind', 'font');
    const res = await POST(buildPostReq(fd));
    expect(res.status).toBe(413);
  });

  it('rejects font with invalid extension', async () => {
    const fd = new FormData();
    fd.append('file', fileFrom('weird.exe', 'application/octet-stream', 100));
    fd.append('kind', 'font');
    const res = await POST(buildPostReq(fd));
    expect(res.status).toBe(415);
  });
});

describe('POST /api/upload — quota', () => {
  beforeEach(() => {
    mockedAuth.mockResolvedValue({ user: { id: 'u-1' } } as unknown as SessionShape);
  });

  it('blocks FREE user at 5 images with upgradeRequired flag', async () => {
    m.uploadedAsset.count.mockResolvedValue(5);
    const fd = new FormData();
    fd.append('file', fileFrom('a.png', 'image/png', 10));
    fd.append('kind', 'image');
    const res = await POST(buildPostReq(fd));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.upgradeRequired).toBe(true);
  });

  it('allows PRO user past Free limit', async () => {
    m.user.findUnique.mockResolvedValue({ tier: 'PRO' });
    m.uploadedAsset.count.mockResolvedValue(50);
    const fd = new FormData();
    fd.append('file', fileFrom('a.png', 'image/png', 10));
    fd.append('kind', 'image');
    const res = await POST(buildPostReq(fd));
    expect(res.status).toBe(201);
  });
});

describe('POST /api/upload — success', () => {
  beforeEach(() => {
    mockedAuth.mockResolvedValue({ user: { id: 'u-1' } } as unknown as SessionShape);
  });

  it('persists image and returns 201 with record', async () => {
    const fd = new FormData();
    fd.append('file', fileFrom('Logo.png', 'image/png', 1024));
    fd.append('kind', 'image');
    const res = await POST(buildPostReq(fd));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.upload.kind).toBe('image');
    expect(body.upload.filename).toBe('Logo.png');
    expect(body.upload.url).toBe('mock://stored');
    expect(body.upload.fontFamily).toBeNull();
  });

  it('derives fontFamily for font uploads', async () => {
    const fd = new FormData();
    fd.append('file', fileFrom('Inter-Bold.woff2', 'font/woff2', 1024));
    fd.append('kind', 'font');
    const res = await POST(buildPostReq(fd));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.upload.fontFamily).toBe('InterBold');
  });

  it('sanitizes pathy filenames', async () => {
    const fd = new FormData();
    fd.append('file', fileFrom('../../evil.png', 'image/png', 10));
    fd.append('kind', 'image');
    const res = await POST(buildPostReq(fd));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.upload.filename).not.toContain('..');
  });
});

describe('GET /api/upload — list', () => {
  it('returns 401 without session', async () => {
    mockedAuth.mockResolvedValue(null as unknown as SessionShape);
    const res = await GET(new NextRequest('http://localhost/api/upload'));
    expect(res.status).toBe(401);
  });

  it('lists current user uploads', async () => {
    mockedAuth.mockResolvedValue({ user: { id: 'u-1' } } as unknown as SessionShape);
    m.uploadedAsset.findMany.mockResolvedValue([{ id: 'up-1', kind: 'image' }]);
    const res = await GET(new NextRequest('http://localhost/api/upload'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.uploads).toHaveLength(1);
  });

  it('filters by kind=font', async () => {
    mockedAuth.mockResolvedValue({ user: { id: 'u-1' } } as unknown as SessionShape);
    m.uploadedAsset.findMany.mockResolvedValue([]);
    await GET(new NextRequest('http://localhost/api/upload?kind=font'));
    const where = m.uploadedAsset.findMany.mock.calls[0][0].where;
    expect(where.kind).toBe('font');
  });
});
