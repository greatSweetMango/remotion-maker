/**
 * Tests for PATCH /api/asset/[id]/folder — set/clear folder, validation,
 * owner-only. (TM-107)
 */
import { NextRequest } from 'next/server';

jest.mock('@/lib/auth', () => ({ auth: jest.fn() }));
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    asset: { findUnique: jest.fn(), update: jest.fn() },
  },
}));

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';
import { PATCH } from '@/app/api/asset/[id]/folder/route';

const mockedAuth = auth as jest.MockedFunction<typeof auth>;
const mockedAsset = (
  prisma as unknown as {
    asset: { findUnique: jest.Mock; update: jest.Mock };
  }
).asset;

type AuthRet = ReturnType<typeof auth> extends Promise<infer R> ? R : never;
const session = (id: string) => ({ user: { id } } as unknown as AuthRet);
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (body: unknown) =>
  new NextRequest('http://localhost/api/asset/x/folder', {
    method: 'PATCH',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });

beforeEach(() => jest.clearAllMocks());

describe('PATCH /api/asset/[id]/folder', () => {
  it('401 without session', async () => {
    mockedAuth.mockResolvedValue(null as unknown as AuthRet);
    const res = await PATCH(req({ folder: 'x' }), ctx('a1'));
    expect(res.status).toBe(401);
  });

  it('400 when folder field missing', async () => {
    mockedAuth.mockResolvedValue(session('u1'));
    const res = await PATCH(req({}), ctx('a1'));
    expect(res.status).toBe(400);
  });

  it('400 when folder contains "/"', async () => {
    mockedAuth.mockResolvedValue(session('u1'));
    const res = await PATCH(req({ folder: 'a/b' }), ctx('a1'));
    expect(res.status).toBe(400);
  });

  it('null folder clears the folder (root)', async () => {
    mockedAuth.mockResolvedValue(session('u1'));
    mockedAsset.findUnique.mockResolvedValue({
      id: 'a1',
      userId: 'u1',
      deletedAt: null,
    });
    mockedAsset.update.mockResolvedValue({ id: 'a1' });
    const res = await PATCH(req({ folder: null }), ctx('a1'));
    expect(res.status).toBe(200);
    expect(mockedAsset.update).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: { folder: null },
      select: { id: true },
    });
  });

  it('sets a trimmed folder name', async () => {
    mockedAuth.mockResolvedValue(session('u1'));
    mockedAsset.findUnique.mockResolvedValue({
      id: 'a1',
      userId: 'u1',
      deletedAt: null,
    });
    mockedAsset.update.mockResolvedValue({ id: 'a1' });
    const res = await PATCH(req({ folder: '  Brand  ' }), ctx('a1'));
    expect(res.status).toBe(200);
    expect(mockedAsset.update).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: { folder: 'Brand' },
      select: { id: true },
    });
  });

  it('403 when caller is not owner', async () => {
    mockedAuth.mockResolvedValue(session('u1'));
    mockedAsset.findUnique.mockResolvedValue({
      id: 'a1',
      userId: 'other',
      deletedAt: null,
    });
    const res = await PATCH(req({ folder: 'x' }), ctx('a1'));
    expect(res.status).toBe(403);
  });
});
