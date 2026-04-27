/**
 * Tests for POST /api/trash/[id]/restore — auth, owner-only, idempotency. (TM-18)
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
import { POST } from '@/app/api/trash/[id]/restore/route';

const mockedAuth = auth as jest.MockedFunction<typeof auth>;
const mockedAsset = (
  prisma as unknown as { asset: { findUnique: jest.Mock; update: jest.Mock } }
).asset;
type AuthRet = ReturnType<typeof auth> extends Promise<infer R> ? R : never;
const session = (id: string) => ({ user: { id } } as unknown as AuthRet);
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = () => new NextRequest('http://localhost/api/trash/x/restore', { method: 'POST' });

beforeEach(() => {
  jest.clearAllMocks();
  mockedAsset.update.mockResolvedValue({});
});

describe('POST /api/trash/[id]/restore', () => {
  it('401 without session', async () => {
    mockedAuth.mockResolvedValue(null as unknown as AuthRet);
    const res = await POST(req(), ctx('a'));
    expect(res.status).toBe(401);
  });

  it('404 when asset missing', async () => {
    mockedAuth.mockResolvedValue(session('u1'));
    mockedAsset.findUnique.mockResolvedValue(null);
    const res = await POST(req(), ctx('a'));
    expect(res.status).toBe(404);
  });

  it('403 when not owner', async () => {
    mockedAuth.mockResolvedValue(session('u1'));
    mockedAsset.findUnique.mockResolvedValue({ id: 'a', userId: 'u2', deletedAt: new Date() });
    const res = await POST(req(), ctx('a'));
    expect(res.status).toBe(403);
    expect(mockedAsset.update).not.toHaveBeenCalled();
  });

  it('clears deletedAt when restoring a soft-deleted asset', async () => {
    mockedAuth.mockResolvedValue(session('u1'));
    mockedAsset.findUnique.mockResolvedValue({ id: 'a', userId: 'u1', deletedAt: new Date() });
    const res = await POST(req(), ctx('a'));
    expect(res.status).toBe(200);
    expect(mockedAsset.update).toHaveBeenCalledWith({
      where: { id: 'a' },
      data: { deletedAt: null },
    });
  });

  it('is idempotent for already-restored asset', async () => {
    mockedAuth.mockResolvedValue(session('u1'));
    mockedAsset.findUnique.mockResolvedValue({ id: 'a', userId: 'u1', deletedAt: null });
    const res = await POST(req(), ctx('a'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.alreadyRestored).toBe(true);
    expect(mockedAsset.update).not.toHaveBeenCalled();
  });
});
