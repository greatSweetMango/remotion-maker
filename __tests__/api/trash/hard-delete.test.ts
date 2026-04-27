/**
 * Tests for DELETE /api/trash/[id] — hard delete from trash, owner-only,
 * refuses non-trashed assets. (TM-18)
 */
import { NextRequest } from 'next/server';

jest.mock('@/lib/auth', () => ({ auth: jest.fn() }));
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    asset: { findUnique: jest.fn(), delete: jest.fn() },
  },
}));

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';
import { DELETE } from '@/app/api/trash/[id]/route';

const mockedAuth = auth as jest.MockedFunction<typeof auth>;
const mockedAsset = (
  prisma as unknown as { asset: { findUnique: jest.Mock; delete: jest.Mock } }
).asset;
type AuthRet = ReturnType<typeof auth> extends Promise<infer R> ? R : never;
const session = (id: string) => ({ user: { id } } as unknown as AuthRet);
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = () => new NextRequest('http://localhost/api/trash/x', { method: 'DELETE' });

beforeEach(() => {
  jest.clearAllMocks();
  mockedAsset.delete.mockResolvedValue({});
});

describe('DELETE /api/trash/[id]', () => {
  it('401 without session', async () => {
    mockedAuth.mockResolvedValue(null as unknown as AuthRet);
    const res = await DELETE(req(), ctx('a'));
    expect(res.status).toBe(401);
  });

  it('404 when asset missing', async () => {
    mockedAuth.mockResolvedValue(session('u1'));
    mockedAsset.findUnique.mockResolvedValue(null);
    const res = await DELETE(req(), ctx('a'));
    expect(res.status).toBe(404);
  });

  it('403 when not owner', async () => {
    mockedAuth.mockResolvedValue(session('u1'));
    mockedAsset.findUnique.mockResolvedValue({ id: 'a', userId: 'u2', deletedAt: new Date() });
    const res = await DELETE(req(), ctx('a'));
    expect(res.status).toBe(403);
    expect(mockedAsset.delete).not.toHaveBeenCalled();
  });

  it('409 when asset is not in trash (deletedAt: null)', async () => {
    mockedAuth.mockResolvedValue(session('u1'));
    mockedAsset.findUnique.mockResolvedValue({ id: 'a', userId: 'u1', deletedAt: null });
    const res = await DELETE(req(), ctx('a'));
    expect(res.status).toBe(409);
    expect(mockedAsset.delete).not.toHaveBeenCalled();
  });

  it('hard-deletes a trashed asset for owner', async () => {
    mockedAuth.mockResolvedValue(session('u1'));
    mockedAsset.findUnique.mockResolvedValue({ id: 'a', userId: 'u1', deletedAt: new Date() });
    const res = await DELETE(req(), ctx('a'));
    expect(res.status).toBe(200);
    expect(mockedAsset.delete).toHaveBeenCalledWith({ where: { id: 'a' } });
  });
});
