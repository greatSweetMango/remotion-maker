/**
 * Tests for POST /api/assets/bulk — multi-asset tag/folder/soft-delete
 * actions, owner-scoping, validation, no-op skip. (TM-107)
 */
import { NextRequest } from 'next/server';

jest.mock('@/lib/auth', () => ({ auth: jest.fn() }));
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    asset: {
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  },
}));

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';
import { POST } from '@/app/api/assets/bulk/route';

const mockedAuth = auth as jest.MockedFunction<typeof auth>;
const mockedAsset = (
  prisma as unknown as {
    asset: { findMany: jest.Mock; update: jest.Mock; updateMany: jest.Mock };
  }
).asset;

type AuthRet = ReturnType<typeof auth> extends Promise<infer R> ? R : never;
const session = (id: string) => ({ user: { id } } as unknown as AuthRet);
const req = (body: unknown) =>
  new NextRequest('http://localhost/api/assets/bulk', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });

beforeEach(() => jest.clearAllMocks());

describe('POST /api/assets/bulk', () => {
  it('401 without session', async () => {
    mockedAuth.mockResolvedValue(null as unknown as AuthRet);
    const res = await POST(req({ ids: ['a'], action: { type: 'soft-delete' } }));
    expect(res.status).toBe(401);
  });

  it('400 when ids is empty', async () => {
    mockedAuth.mockResolvedValue(session('u1'));
    const res = await POST(req({ ids: [], action: { type: 'soft-delete' } }));
    expect(res.status).toBe(400);
  });

  it('400 when action.type is unknown', async () => {
    mockedAuth.mockResolvedValue(session('u1'));
    const res = await POST(req({ ids: ['a'], action: { type: 'nope' } }));
    expect(res.status).toBe(400);
  });

  it('400 when tag-add tags fail validation', async () => {
    mockedAuth.mockResolvedValue(session('u1'));
    const res = await POST(
      req({ ids: ['a'], action: { type: 'tag-add', tags: ['x'.repeat(40)] } }),
    );
    expect(res.status).toBe(400);
  });

  it('soft-delete only affects owned, non-deleted rows; reports skipped ids', async () => {
    mockedAuth.mockResolvedValue(session('u1'));
    mockedAsset.findMany.mockResolvedValue([
      { id: 'a1', tags: '[]', folder: null, deletedAt: null },
      { id: 'a2', tags: '[]', folder: null, deletedAt: new Date() },
    ]);
    mockedAsset.updateMany.mockResolvedValue({ count: 1 });
    const res = await POST(
      req({ ids: ['a1', 'a2', 'a3'], action: { type: 'soft-delete' } }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { affected: number; skipped: string[] };
    expect(body.affected).toBe(1);
    expect(body.skipped).toEqual(['a3']);
    expect(mockedAsset.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['a1'] }, userId: 'u1' },
      data: { deletedAt: expect.any(Date) },
    });
  });

  it('folder-move skips rows already in the target folder', async () => {
    mockedAuth.mockResolvedValue(session('u1'));
    mockedAsset.findMany.mockResolvedValue([
      { id: 'a1', tags: '[]', folder: 'Brand', deletedAt: null },
      { id: 'a2', tags: '[]', folder: 'Other', deletedAt: null },
    ]);
    mockedAsset.updateMany.mockResolvedValue({ count: 1 });
    const res = await POST(
      req({
        ids: ['a1', 'a2'],
        action: { type: 'folder-move', folder: 'Brand' },
      }),
    );
    expect(res.status).toBe(200);
    expect(mockedAsset.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['a2'] }, userId: 'u1' },
      data: { folder: 'Brand' },
    });
  });

  it('tag-add unions per-row and skips rows whose tag set would not change', async () => {
    mockedAuth.mockResolvedValue(session('u1'));
    mockedAsset.findMany.mockResolvedValue([
      { id: 'a1', tags: '["a"]', folder: null, deletedAt: null },
      { id: 'a2', tags: '["a","b"]', folder: null, deletedAt: null },
    ]);
    mockedAsset.update.mockResolvedValue({ id: 'x' });
    const res = await POST(
      req({ ids: ['a1', 'a2'], action: { type: 'tag-add', tags: ['b'] } }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { affected: number };
    expect(body.affected).toBe(1);
    expect(mockedAsset.update).toHaveBeenCalledTimes(1);
    expect(mockedAsset.update).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: { tags: JSON.stringify(['a', 'b']) },
      select: { id: true },
    });
  });

  it('tag-remove removes specified tags only', async () => {
    mockedAuth.mockResolvedValue(session('u1'));
    mockedAsset.findMany.mockResolvedValue([
      { id: 'a1', tags: '["a","b","c"]', folder: null, deletedAt: null },
    ]);
    mockedAsset.update.mockResolvedValue({ id: 'a1' });
    const res = await POST(
      req({ ids: ['a1'], action: { type: 'tag-remove', tags: ['b'] } }),
    );
    expect(res.status).toBe(200);
    expect(mockedAsset.update).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: { tags: JSON.stringify(['a', 'c']) },
      select: { id: true },
    });
  });
});
