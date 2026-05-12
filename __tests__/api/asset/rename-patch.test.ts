/**
 * Tests for PATCH /api/asset/[id] — title rename, validation, owner-only.
 * (TM-87)
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
import { PATCH } from '@/app/api/asset/[id]/route';

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
  return new NextRequest('http://localhost/api/asset/x', {
    method: 'PATCH',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('PATCH /api/asset/[id] — rename', () => {
  it('returns 401 when no session', async () => {
    mockedAuth.mockResolvedValue(null as unknown as AuthRet);
    const res = await PATCH(req({ title: 'New' }), ctx('a1'));
    expect(res.status).toBe(401);
    expect(mockedAsset.update).not.toHaveBeenCalled();
  });

  it('returns 400 when body is not JSON', async () => {
    mockedAuth.mockResolvedValue(session('u1'));
    const res = await PATCH(req('not-json'), ctx('a1'));
    expect(res.status).toBe(400);
  });

  it('returns 400 when title is missing', async () => {
    mockedAuth.mockResolvedValue(session('u1'));
    const res = await PATCH(req({}), ctx('a1'));
    expect(res.status).toBe(400);
  });

  it('returns 400 when title is non-string', async () => {
    mockedAuth.mockResolvedValue(session('u1'));
    const res = await PATCH(req({ title: 123 }), ctx('a1'));
    expect(res.status).toBe(400);
  });

  it('returns 400 when title is empty after trim', async () => {
    mockedAuth.mockResolvedValue(session('u1'));
    const res = await PATCH(req({ title: '   ' }), ctx('a1'));
    expect(res.status).toBe(400);
    expect(mockedAsset.update).not.toHaveBeenCalled();
  });

  it('returns 400 when title exceeds 200 chars', async () => {
    mockedAuth.mockResolvedValue(session('u1'));
    const res = await PATCH(req({ title: 'a'.repeat(201) }), ctx('a1'));
    expect(res.status).toBe(400);
  });

  it('returns 404 when asset does not exist', async () => {
    mockedAuth.mockResolvedValue(session('u1'));
    mockedAsset.findUnique.mockResolvedValue(null);
    const res = await PATCH(req({ title: 'New' }), ctx('a1'));
    expect(res.status).toBe(404);
  });

  it('returns 404 when asset is soft-deleted (no silent resurrect)', async () => {
    mockedAuth.mockResolvedValue(session('u1'));
    mockedAsset.findUnique.mockResolvedValue({
      id: 'a1',
      userId: 'u1',
      deletedAt: new Date(),
    });
    const res = await PATCH(req({ title: 'New' }), ctx('a1'));
    expect(res.status).toBe(404);
    expect(mockedAsset.update).not.toHaveBeenCalled();
  });

  it('returns 403 when caller does not own the asset', async () => {
    mockedAuth.mockResolvedValue(session('u1'));
    mockedAsset.findUnique.mockResolvedValue({
      id: 'a1',
      userId: 'someone-else',
      deletedAt: null,
    });
    const res = await PATCH(req({ title: 'New' }), ctx('a1'));
    expect(res.status).toBe(403);
  });

  it('renames with trimmed title for owner', async () => {
    mockedAuth.mockResolvedValue(session('u1'));
    mockedAsset.findUnique.mockResolvedValue({
      id: 'a1',
      userId: 'u1',
      deletedAt: null,
    });
    mockedAsset.update.mockResolvedValue({
      id: 'a1',
      title: 'My Animation',
      updatedAt: new Date('2026-05-13T00:00:00Z'),
    });
    const res = await PATCH(req({ title: '  My Animation  ' }), ctx('a1'));
    expect(res.status).toBe(200);
    expect(mockedAsset.update).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: { title: 'My Animation' },
      select: { id: true, title: true, updatedAt: true },
    });
    const body = (await res.json()) as { title: string };
    expect(body.title).toBe('My Animation');
  });
});
