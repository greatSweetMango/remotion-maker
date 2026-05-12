/**
 * Tests for POST /api/asset/[id]/duplicate — owner-only self clone, " (copy)"
 * suffix idempotency, no lineage. (TM-87)
 */
import { NextRequest } from 'next/server';

jest.mock('@/lib/auth', () => ({ auth: jest.fn() }));
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    asset: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  },
}));

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';
import { POST } from '@/app/api/asset/[id]/duplicate/route';

const mockedAuth = auth as jest.MockedFunction<typeof auth>;
const mockedAsset = (
  prisma as unknown as {
    asset: { findUnique: jest.Mock; create: jest.Mock };
  }
).asset;

type AuthRet = ReturnType<typeof auth> extends Promise<infer R> ? R : never;
const session = (id: string) => ({ user: { id } } as unknown as AuthRet);

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}
const req = () =>
  new NextRequest('http://localhost/api/asset/x/duplicate', { method: 'POST' });

const FULL_SOURCE = {
  id: 'a1',
  userId: 'u1',
  deletedAt: null,
  title: 'Cool Anim',
  code: '<code>',
  jsCode: '<js>',
  parameters: '{}',
  durationInFrames: 150,
  fps: 30,
  width: 1920,
  height: 1080,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockedAsset.create.mockResolvedValue({ id: 'a2', title: 'Cool Anim (copy)' });
});

describe('POST /api/asset/[id]/duplicate', () => {
  it('returns 401 when no session', async () => {
    mockedAuth.mockResolvedValue(null as unknown as AuthRet);
    const res = await POST(req(), ctx('a1'));
    expect(res.status).toBe(401);
    expect(mockedAsset.create).not.toHaveBeenCalled();
  });

  it('returns 404 when source asset missing', async () => {
    mockedAuth.mockResolvedValue(session('u1'));
    mockedAsset.findUnique.mockResolvedValue(null);
    const res = await POST(req(), ctx('a1'));
    expect(res.status).toBe(404);
  });

  it('returns 404 when source is soft-deleted', async () => {
    mockedAuth.mockResolvedValue(session('u1'));
    mockedAsset.findUnique.mockResolvedValue({
      ...FULL_SOURCE,
      deletedAt: new Date(),
    });
    const res = await POST(req(), ctx('a1'));
    expect(res.status).toBe(404);
    expect(mockedAsset.create).not.toHaveBeenCalled();
  });

  it('returns 403 when caller is not the owner', async () => {
    mockedAuth.mockResolvedValue(session('u2'));
    mockedAsset.findUnique.mockResolvedValue(FULL_SOURCE);
    const res = await POST(req(), ctx('a1'));
    expect(res.status).toBe(403);
  });

  it('creates an independent copy with " (copy)" suffix', async () => {
    mockedAuth.mockResolvedValue(session('u1'));
    mockedAsset.findUnique.mockResolvedValue(FULL_SOURCE);
    const res = await POST(req(), ctx('a1'));
    expect(res.status).toBe(201);
    expect(mockedAsset.create).toHaveBeenCalledTimes(1);
    const args = mockedAsset.create.mock.calls[0][0];
    expect(args.data.userId).toBe('u1');
    expect(args.data.title).toBe('Cool Anim (copy)');
    expect(args.data.code).toBe('<code>');
    expect(args.data.jsCode).toBe('<js>');
    expect(args.data.parameters).toBe('{}');
    expect(args.data.durationInFrames).toBe(150);
    // Lineage / sharing carried over? Must NOT — duplicate is independent.
    expect(args.data.sourceAssetId).toBeUndefined();
    expect(args.data.publicSlug).toBeUndefined();
    expect(args.data.sharedAt).toBeUndefined();
  });

  it('does not stack " (copy) (copy)" — keeps single suffix', async () => {
    mockedAuth.mockResolvedValue(session('u1'));
    mockedAsset.findUnique.mockResolvedValue({
      ...FULL_SOURCE,
      title: 'Cool Anim (copy)',
    });
    await POST(req(), ctx('a1'));
    const args = mockedAsset.create.mock.calls[0][0];
    expect(args.data.title).toBe('Cool Anim (copy)');
  });

  it('truncates very long titles to 200 chars after suffix', async () => {
    mockedAuth.mockResolvedValue(session('u1'));
    mockedAsset.findUnique.mockResolvedValue({
      ...FULL_SOURCE,
      title: 'x'.repeat(199),
    });
    await POST(req(), ctx('a1'));
    const args = mockedAsset.create.mock.calls[0][0];
    expect(args.data.title.length).toBeLessThanOrEqual(200);
  });
});
