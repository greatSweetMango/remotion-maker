/**
 * Tests for PUT /api/asset/[id]/tags — replace tag set, validation, owner-only.
 * (TM-107)
 */
import { NextRequest } from 'next/server';

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
import { PUT } from '@/app/api/asset/[id]/tags/route';

const mockedAuth = auth as jest.MockedFunction<typeof auth>;
const mockedAsset = (
  prisma as unknown as {
    asset: { findUnique: jest.Mock; update: jest.Mock };
  }
).asset;

type AuthRet = ReturnType<typeof auth> extends Promise<infer R> ? R : never;
const session = (id: string) => ({ user: { id } } as unknown as AuthRet);

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}
function req(body: unknown) {
  return new NextRequest('http://localhost/api/asset/x/tags', {
    method: 'PUT',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('PUT /api/asset/[id]/tags', () => {
  it('returns 401 without session', async () => {
    mockedAuth.mockResolvedValue(null as unknown as AuthRet);
    const res = await PUT(req({ tags: [] }), ctx('a1'));
    expect(res.status).toBe(401);
  });

  it('returns 400 for invalid JSON body', async () => {
    mockedAuth.mockResolvedValue(session('u1'));
    const res = await PUT(req('not-json'), ctx('a1'));
    expect(res.status).toBe(400);
  });

  it('returns 400 when tags is not an array', async () => {
    mockedAuth.mockResolvedValue(session('u1'));
    const res = await PUT(req({ tags: 'foo' }), ctx('a1'));
    expect(res.status).toBe(400);
  });

  it('returns 400 when a tag is too long', async () => {
    mockedAuth.mockResolvedValue(session('u1'));
    const res = await PUT(req({ tags: ['x'.repeat(33)] }), ctx('a1'));
    expect(res.status).toBe(400);
  });

  it('returns 404 for missing or soft-deleted asset', async () => {
    mockedAuth.mockResolvedValue(session('u1'));
    mockedAsset.findUnique.mockResolvedValueOnce(null);
    let res = await PUT(req({ tags: ['a'] }), ctx('a1'));
    expect(res.status).toBe(404);

    mockedAsset.findUnique.mockResolvedValueOnce({
      id: 'a1',
      userId: 'u1',
      deletedAt: new Date(),
    });
    res = await PUT(req({ tags: ['a'] }), ctx('a1'));
    expect(res.status).toBe(404);
  });

  it('returns 403 when caller does not own the asset', async () => {
    mockedAuth.mockResolvedValue(session('u1'));
    mockedAsset.findUnique.mockResolvedValue({
      id: 'a1',
      userId: 'other',
      deletedAt: null,
    });
    const res = await PUT(req({ tags: ['a'] }), ctx('a1'));
    expect(res.status).toBe(403);
  });

  it('replaces tags with normalized JSON-encoded payload', async () => {
    mockedAuth.mockResolvedValue(session('u1'));
    mockedAsset.findUnique.mockResolvedValue({
      id: 'a1',
      userId: 'u1',
      deletedAt: null,
    });
    mockedAsset.update.mockResolvedValue({ id: 'a1' });
    const res = await PUT(req({ tags: [' a ', 'b', 'a'] }), ctx('a1'));
    expect(res.status).toBe(200);
    expect(mockedAsset.update).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: { tags: JSON.stringify(['a', 'b']) },
      select: { id: true },
    });
    const body = (await res.json()) as { tags: string[] };
    expect(body.tags).toEqual(['a', 'b']);
  });
});
