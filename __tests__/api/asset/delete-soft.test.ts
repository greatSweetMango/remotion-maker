/**
 * Tests for DELETE /api/asset/[id] — soft-delete behavior, owner-only,
 * idempotency. (TM-18)
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
import { DELETE } from '@/app/api/asset/[id]/route';

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
const req = () => new NextRequest('http://localhost/api/asset/x');

beforeEach(() => {
  jest.clearAllMocks();
  mockedAsset.update.mockResolvedValue({});
});

describe('DELETE /api/asset/[id] — soft delete', () => {
  it('returns 401 when no session', async () => {
    mockedAuth.mockResolvedValue(null as unknown as AuthRet);
    const res = await DELETE(req(), ctx('asset-1'));
    expect(res.status).toBe(401);
    expect(mockedAsset.update).not.toHaveBeenCalled();
  });

  it('returns 404 when asset does not exist', async () => {
    mockedAuth.mockResolvedValue(session('user-1'));
    mockedAsset.findUnique.mockResolvedValue(null);
    const res = await DELETE(req(), ctx('asset-1'));
    expect(res.status).toBe(404);
    expect(mockedAsset.update).not.toHaveBeenCalled();
  });

  it('returns 403 when caller does not own the asset', async () => {
    mockedAuth.mockResolvedValue(session('user-1'));
    mockedAsset.findUnique.mockResolvedValue({
      id: 'asset-1',
      userId: 'someone-else',
      deletedAt: null,
    });
    const res = await DELETE(req(), ctx('asset-1'));
    expect(res.status).toBe(403);
    expect(mockedAsset.update).not.toHaveBeenCalled();
  });

  it('soft-deletes by setting deletedAt = now() for owner', async () => {
    mockedAuth.mockResolvedValue(session('user-1'));
    mockedAsset.findUnique.mockResolvedValue({
      id: 'asset-1',
      userId: 'user-1',
      deletedAt: null,
    });
    const res = await DELETE(req(), ctx('asset-1'));
    expect(res.status).toBe(200);
    expect(mockedAsset.update).toHaveBeenCalledWith({
      where: { id: 'asset-1' },
      data: { deletedAt: expect.any(Date) },
    });
  });

  it('is idempotent — returns ok without re-updating an already-deleted asset', async () => {
    mockedAuth.mockResolvedValue(session('user-1'));
    mockedAsset.findUnique.mockResolvedValue({
      id: 'asset-1',
      userId: 'user-1',
      deletedAt: new Date(),
    });
    const res = await DELETE(req(), ctx('asset-1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.alreadyDeleted).toBe(true);
    expect(mockedAsset.update).not.toHaveBeenCalled();
  });
});
