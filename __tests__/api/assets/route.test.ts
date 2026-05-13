/**
 * Tests for GET /api/assets — verifies pagination, search, sort, date filter,
 * and user-scoped authorization isolation.
 */
import { NextRequest } from 'next/server';

jest.mock('@/lib/auth', () => ({
  auth: jest.fn(),
}));

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    asset: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
  },
}));

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';
import { GET } from '@/app/api/assets/route';

const mockedAuth = auth as jest.MockedFunction<typeof auth>;
// Use unknown cast then narrow rather than `any` to keep eslint happy.
const mockedPrismaAsset = (prisma as unknown as {
  asset: {
    count: jest.Mock;
    findMany: jest.Mock;
  };
}).asset;

function buildReq(query: Record<string, string> = {}): NextRequest {
  const qs = new URLSearchParams(query).toString();
  const url = `http://localhost/api/assets${qs ? `?${qs}` : ''}`;
  return new NextRequest(url);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedPrismaAsset.count.mockResolvedValue(0);
  mockedPrismaAsset.findMany.mockResolvedValue([]);
});

describe('GET /api/assets — auth', () => {
  it('returns 401 when no session', async () => {
    mockedAuth.mockResolvedValue(null as unknown as ReturnType<typeof auth> extends Promise<infer R> ? R : never);
    const res = await GET(buildReq());
    expect(res.status).toBe(401);
  });

  it('always scopes findMany.where.userId to the session user (isolation)', async () => {
    mockedAuth.mockResolvedValue({ user: { id: 'user-aaa' } } as unknown as ReturnType<typeof auth> extends Promise<infer R> ? R : never);
    await GET(buildReq());
    const findArgs = mockedPrismaAsset.findMany.mock.calls[0][0];
    const countArgs = mockedPrismaAsset.count.mock.calls[0][0];
    expect(findArgs.where.userId).toBe('user-aaa');
    expect(countArgs.where.userId).toBe('user-aaa');
  });
});

describe('GET /api/assets — query params', () => {
  beforeEach(() => {
    mockedAuth.mockResolvedValue({ user: { id: 'user-1' } } as unknown as ReturnType<typeof auth> extends Promise<infer R> ? R : never);
  });

  it('applies title contains filter on search', async () => {
    await GET(buildReq({ search: 'hello' }));
    const args = mockedPrismaAsset.findMany.mock.calls[0][0];
    expect(args.where.title).toEqual({ contains: 'hello' });
  });

  it('applies date range filter on updatedAt', async () => {
    await GET(buildReq({ dateFrom: '2026-01-01', dateTo: '2026-01-31' }));
    const args = mockedPrismaAsset.findMany.mock.calls[0][0];
    expect(args.where.updatedAt.gte).toBeInstanceOf(Date);
    expect(args.where.updatedAt.lte).toBeInstanceOf(Date);
    expect(args.where.updatedAt.lte.getHours()).toBe(23); // end-of-day inclusive
  });

  it.each([
    ['name_asc', { title: 'asc' }],
    ['name_desc', { title: 'desc' }],
    ['created_desc', { createdAt: 'desc' }],
    ['created_asc', { createdAt: 'asc' }],
    ['updated_desc', { updatedAt: 'desc' }],
  ])('maps sort=%s to orderBy %j', async (sort, expected) => {
    await GET(buildReq({ sort }));
    const args = mockedPrismaAsset.findMany.mock.calls[0][0];
    expect(args.orderBy).toEqual(expected);
  });

  it('falls back to updated_desc when sort is unknown', async () => {
    await GET(buildReq({ sort: 'bogus' }));
    const args = mockedPrismaAsset.findMany.mock.calls[0][0];
    expect(args.orderBy).toEqual({ updatedAt: 'desc' });
  });

  it('paginates skip/take from page+pageSize', async () => {
    await GET(buildReq({ page: '3', pageSize: '10' }));
    const args = mockedPrismaAsset.findMany.mock.calls[0][0];
    expect(args.skip).toBe(20);
    expect(args.take).toBe(10);
  });

  it('clamps page to >= 1', async () => {
    await GET(buildReq({ page: '0' }));
    const args = mockedPrismaAsset.findMany.mock.calls[0][0];
    expect(args.skip).toBe(0);
  });

  it('clamps pageSize to <= 100', async () => {
    await GET(buildReq({ pageSize: '500' }));
    const args = mockedPrismaAsset.findMany.mock.calls[0][0];
    expect(args.take).toBe(100);
  });

  // TM-108 — full-text search across title + code + PARAMS body.
  describe('full-text search via q', () => {
    const sampleAssets = [
      {
        id: 'a1',
        userId: 'user-1',
        title: 'Counter Animation',
        code: 'export const PARAMS = { from: 0, to: 100 };\nexport default function Comp(){}',
        parameters: '{"from":0,"to":100}',
        folder: null,
        tags: '[]',
        durationInFrames: 150,
        fps: 30,
        width: 1920,
        height: 1080,
        publicSlug: null,
        sharedAt: null,
        sourceAssetId: null,
        templateSourceId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        _count: { versions: 0 },
      },
      {
        id: 'a2',
        userId: 'user-1',
        title: 'Bear Walk',
        code: 'export const PARAMS = { speed: 2 };\n// happy bear walking',
        parameters: '{"speed":2}',
        folder: null,
        tags: '[]',
        durationInFrames: 150,
        fps: 30,
        width: 1920,
        height: 1080,
        publicSlug: null,
        sharedAt: null,
        sourceAssetId: null,
        templateSourceId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        _count: { versions: 0 },
      },
      {
        id: 'a3',
        userId: 'user-1',
        title: 'Logo Flash',
        code: 'export const PARAMS = { color: "red" };',
        parameters: '{"color":"red"}',
        folder: null,
        tags: '[]',
        durationInFrames: 150,
        fps: 30,
        width: 1920,
        height: 1080,
        publicSlug: null,
        sharedAt: null,
        sourceAssetId: null,
        templateSourceId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        _count: { versions: 0 },
      },
    ];

    beforeEach(() => {
      mockedPrismaAsset.findMany.mockResolvedValue(sampleAssets);
    });

    it('matches title substring (case-insensitive)', async () => {
      const res = await GET(buildReq({ q: 'counter' }));
      const body = await res.json();
      expect(body.assets.map((a: { id: string }) => a.id)).toEqual(['a1']);
      expect(body.pagination.total).toBe(1);
    });

    it('matches code/PARAMS body content', async () => {
      const res = await GET(buildReq({ q: 'speed' }));
      const body = await res.json();
      expect(body.assets.map((a: { id: string }) => a.id)).toEqual(['a2']);
    });

    it('matches partial substring (e.g. "bear")', async () => {
      const res = await GET(buildReq({ q: 'bear' }));
      const body = await res.json();
      expect(body.assets.map((a: { id: string }) => a.id)).toEqual(['a2']);
    });

    it('returns all when q is empty', async () => {
      // No q present → DB-side count path; mock count to 3.
      mockedPrismaAsset.count.mockResolvedValue(3);
      const res = await GET(buildReq());
      const body = await res.json();
      expect(body.pagination.total).toBe(3);
    });

    it('does not push q into Prisma where (in-memory filter only)', async () => {
      await GET(buildReq({ q: 'counter' }));
      const args = mockedPrismaAsset.findMany.mock.calls[0][0];
      expect(args.where.title).toBeUndefined();
      expect(JSON.stringify(args.where)).not.toContain('counter');
    });
  });

  it('returns pagination metadata with totalPages computed from total', async () => {
    mockedPrismaAsset.count.mockResolvedValue(57);
    const res = await GET(buildReq({ pageSize: '20' }));
    const body = await res.json();
    expect(body.pagination).toEqual({
      page: 1,
      pageSize: 20,
      total: 57,
      totalPages: 3,
    });
  });
});
