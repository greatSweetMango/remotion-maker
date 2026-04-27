/**
 * Tests for POST /api/asset/fork — verifies auth, validation, source lookup,
 * field copy, and lineage tracking via sourceAssetId.
 */
import { NextRequest } from 'next/server';

jest.mock('@/lib/auth', () => ({
  auth: jest.fn(),
}));

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    asset: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
    },
  },
}));

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';
import { POST } from '@/app/api/asset/fork/route';

const mockedAuth = auth as jest.MockedFunction<typeof auth>;
type SessionShape = ReturnType<typeof auth> extends Promise<infer R> ? R : never;
const mockedPrismaAsset = (prisma as unknown as {
  asset: {
    findUnique: jest.Mock;
    findFirst: jest.Mock;
    create: jest.Mock;
  };
}).asset;

function buildReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/asset/fork', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

const sourceFixture = {
  id: 'src-asset-1',
  title: 'Cool Animation',
  code: 'const tsx = "x";',
  jsCode: 'const js = "x";',
  parameters: '[]',
  durationInFrames: 180,
  fps: 60,
  width: 1080,
  height: 1920,
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('POST /api/asset/fork — auth', () => {
  it('returns 401 with requiresAuth=true when no session', async () => {
    mockedAuth.mockResolvedValue(null as unknown as SessionShape);
    const res = await POST(buildReq({ slug: 'abc' }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.requiresAuth).toBe(true);
  });

  it('returns 401 when session has no user.id', async () => {
    mockedAuth.mockResolvedValue({ user: {} } as unknown as SessionShape);
    const res = await POST(buildReq({ slug: 'abc' }));
    expect(res.status).toBe(401);
  });
});

describe('POST /api/asset/fork — validation', () => {
  beforeEach(() => {
    mockedAuth.mockResolvedValue({ user: { id: 'forker-1' } } as unknown as SessionShape);
  });

  it('returns 400 when slug is missing', async () => {
    const res = await POST(buildReq({}));
    expect(res.status).toBe(400);
  });

  it('returns 400 when slug is empty string', async () => {
    const res = await POST(buildReq({ slug: '' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when slug is not a string', async () => {
    const res = await POST(buildReq({ slug: 123 }));
    expect(res.status).toBe(400);
  });
});

describe('POST /api/asset/fork — fork mechanics', () => {
  beforeEach(() => {
    mockedAuth.mockResolvedValue({ user: { id: 'forker-1' } } as unknown as SessionShape);
  });

  it('returns 404 when source slug not found', async () => {
    mockedPrismaAsset.findFirst.mockResolvedValue(null);
    const res = await POST(buildReq({ slug: 'missing' }));
    expect(res.status).toBe(404);
    expect(mockedPrismaAsset.create).not.toHaveBeenCalled();
  });

  it('copies all content fields and sets new ownership + lineage', async () => {
    mockedPrismaAsset.findFirst.mockResolvedValue(sourceFixture);
    mockedPrismaAsset.create.mockResolvedValue({
      id: 'new-1',
      title: 'Cool Animation (forked)',
      sourceAssetId: 'src-asset-1',
    });

    const res = await POST(buildReq({ slug: 'abc' }));
    expect(res.status).toBe(201);

    const data = mockedPrismaAsset.create.mock.calls[0][0].data;
    expect(data.userId).toBe('forker-1');
    expect(data.code).toBe(sourceFixture.code);
    expect(data.jsCode).toBe(sourceFixture.jsCode);
    expect(data.parameters).toBe(sourceFixture.parameters);
    expect(data.durationInFrames).toBe(180);
    expect(data.fps).toBe(60);
    expect(data.width).toBe(1080);
    expect(data.height).toBe(1920);
    expect(data.sourceAssetId).toBe('src-asset-1');
    expect(data.title).toBe('Cool Animation (forked)');
    // Privacy: fork must NOT inherit publicSlug or sharedAt
    expect(data.publicSlug).toBeUndefined();
    expect(data.sharedAt).toBeUndefined();
  });

  it('does not double-suffix " (forked)" when source title already ends with it', async () => {
    mockedPrismaAsset.findFirst.mockResolvedValue({
      ...sourceFixture,
      title: 'Cool Animation (forked)',
    });
    mockedPrismaAsset.create.mockResolvedValue({
      id: 'new-2',
      title: 'Cool Animation (forked)',
      sourceAssetId: 'src-asset-1',
    });

    await POST(buildReq({ slug: 'abc' }));
    const data = mockedPrismaAsset.create.mock.calls[0][0].data;
    expect(data.title).toBe('Cool Animation (forked)');
  });

  it('looks up source by publicSlug only and excludes soft-deleted assets', async () => {
    mockedPrismaAsset.findFirst.mockResolvedValue(sourceFixture);
    mockedPrismaAsset.create.mockResolvedValue({
      id: 'new-3',
      title: 'x',
      sourceAssetId: 'src-asset-1',
    });
    await POST(buildReq({ slug: 'public-slug-xyz' }));
    const findArgs = mockedPrismaAsset.findFirst.mock.calls[0][0];
    expect(findArgs.where).toEqual({ publicSlug: 'public-slug-xyz', deletedAt: null });
  });
});
