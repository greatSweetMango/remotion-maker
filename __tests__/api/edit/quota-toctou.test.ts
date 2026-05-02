/**
 * TM-93 — editUsage TOCTOU regression test.
 *
 * Mirrors TM-92's /api/generate test for the per-asset edit cap. Reproduces
 * the race: 10 concurrent edits on the same FREE asset (editsPerAsset=3)
 * starting at editCount=0. Only 3 should pass; 7 should be rejected with 429.
 *
 * The fix is in `src/lib/usage.ts#reserveEditSlot` — a single atomic SQLite
 * `UPDATE ... SET editUsage = json_set(...) WHERE json_extract(...) < limit`
 * via `prisma.$executeRaw`. SQLite executes that statement atomically, so
 * exactly `limit - count` of any burst see `affected = 1`; the rest see 0
 * and fall through to 429. The mock here serializes the conditional update
 * with a mutex to model SQLite's "single statement is atomic" semantics.
 */
import { NextRequest } from 'next/server';

jest.mock('@/lib/auth', () => ({ auth: jest.fn() }));

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn(), update: jest.fn() },
    asset: { findFirst: jest.fn(), update: jest.fn(), create: jest.fn() },
    assetVersion: { create: jest.fn() },
    $transaction: jest.fn(),
    $executeRaw: jest.fn(),
  },
}));

jest.mock('@/lib/ai/edit', () => ({ editAsset: jest.fn() }));
jest.mock('@/lib/ai/client', () => ({
  getModels: () => ({ free: 'm-free', pro: 'm-pro' }),
}));

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';
import { editAsset } from '@/lib/ai/edit';
import { POST } from '@/app/api/edit/route';

const mockedAuth = auth as jest.MockedFunction<typeof auth>;
type SessionShape = ReturnType<typeof auth> extends Promise<infer R> ? R : never;
const mockedEdit = editAsset as jest.MockedFunction<typeof editAsset>;
const m = prisma as unknown as {
  user: { findUnique: jest.Mock; update: jest.Mock };
  asset: { findFirst: jest.Mock; update: jest.Mock; create: jest.Mock };
  assetVersion: { create: jest.Mock };
  $transaction: jest.Mock;
  $executeRaw: jest.Mock;
};

const ASSET_ID = 'cju1abcdefghij0000000000';

function buildReq(): NextRequest {
  return new NextRequest('http://localhost/api/edit', {
    method: 'POST',
    body: JSON.stringify({
      assetId: ASSET_ID,
      prompt: 'make the circle red',
      currentCode: 'export const PARAMS = {} as const; export default () => null;',
    }),
    headers: { 'content-type': 'application/json' },
  });
}

describe('POST /api/edit — TM-93 editUsage TOCTOU', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedAuth.mockResolvedValue({ user: { id: 'u-1' } } as unknown as SessionShape);
  });

  it('rejects all but `editsPerAsset` of N concurrent FREE edits at editCount=0', async () => {
    const FREE_LIMIT = 3;
    let editCount = 0; // models json_extract(editUsage, '$.<assetId>')
    let mutex: Promise<void> = Promise.resolve();

    m.user.findUnique.mockImplementation(async () => ({
      id: 'u-1',
      tier: 'FREE',
      editUsage: JSON.stringify({ [ASSET_ID]: editCount }),
      monthlyUsage: 0,
      usageResetAt: new Date(),
    }));
    m.asset.findFirst.mockImplementation(async () => ({ id: ASSET_ID, userId: 'u-1' }));

    // Model SQLite single-statement atomic UPDATE for reserveEditSlot. The
    // route's reserveEditSlot calls $executeRaw with a tagged template; the
    // first call argument is the TemplateStringsArray, then path, userId,
    // path, limit. We don't need to parse the SQL — we just need to model
    // the conditional compare-and-increment behaviour atomically per call.
    // Reservation calls have 4 interpolations; refund calls have 2.
    m.$executeRaw.mockImplementation(async (..._args: unknown[]) => {
      // Tagged-template call: args[0] = strings array, rest = interpolated
      // values. Reserve has 5 values: [path, path, userId, path, limit].
      // Refund has 3 values: [path, path, userId]. Distinguish by argc.
      const values = _args.slice(1);
      const release = mutex;
      let resolveNext!: () => void;
      mutex = new Promise<void>((r) => (resolveNext = r));
      await release;
      try {
        if (values.length === 5) {
          const limit = values[4] as number;
          if (editCount < limit) {
            editCount += 1;
            return 1;
          }
          return 0;
        }
        if (values.length === 3) {
          editCount = Math.max(editCount - 1, 0);
          return 1;
        }
        return 0;
      } finally {
        resolveNext();
      }
    });

    m.$transaction.mockResolvedValue([{}, {}]);

    mockedEdit.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 20));
      return {
        title: 't',
        code: 'c',
        jsCode: 'jc',
        parameters: [],
        durationInFrames: 60,
        fps: 30,
        width: 1920,
        height: 1080,
      } as never;
    });

    const N = 10;
    const responses = await Promise.all(
      Array.from({ length: N }, () => POST(buildReq())),
    );
    const statuses = responses.map((r) => r.status);
    const ok = statuses.filter((s) => s === 200).length;
    const tooMany = statuses.filter((s) => s === 429).length;

    expect(ok).toBe(FREE_LIMIT);
    expect(tooMany).toBe(N - FREE_LIMIT);
    expect(editCount).toBe(FREE_LIMIT);
    // editAsset must NOT run for rejected requests — quota check happens first.
    expect(mockedEdit).toHaveBeenCalledTimes(FREE_LIMIT);
  });

  it('refunds the reserved slot when editAsset throws', async () => {
    let editCount = 2; // already 2 of 3 used → exactly one slot left
    m.user.findUnique.mockResolvedValue({
      id: 'u-1',
      tier: 'FREE',
      editUsage: JSON.stringify({ [ASSET_ID]: editCount }),
      monthlyUsage: 0,
      usageResetAt: new Date(),
    });
    m.asset.findFirst.mockResolvedValue({ id: ASSET_ID, userId: 'u-1' });

    m.$executeRaw.mockImplementation(async (..._args: unknown[]) => {
      const values = _args.slice(1);
      if (values.length === 5) {
        const limit = values[4] as number;
        if (editCount < limit) {
          editCount += 1;
          return 1;
        }
        return 0;
      }
      if (values.length === 3) {
        editCount = Math.max(editCount - 1, 0);
        return 1;
      }
      return 0;
    });

    mockedEdit.mockRejectedValue(new Error('LLM upstream blew up'));

    const res = await POST(buildReq());
    expect(res.status).toBe(500);
    // After the failed edit, the slot should have been refunded back to 2.
    expect(editCount).toBe(2);
  });

  it('rejects assetIds with characters outside the safe whitelist', async () => {
    m.user.findUnique.mockResolvedValue({
      id: 'u-1',
      tier: 'FREE',
      editUsage: '{}',
      monthlyUsage: 0,
      usageResetAt: new Date(),
    });
    const req = new NextRequest('http://localhost/api/edit', {
      method: 'POST',
      body: JSON.stringify({
        assetId: "abc'\"]injection",
        prompt: 'go',
        currentCode: 'x',
      }),
      headers: { 'content-type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(m.$executeRaw).not.toHaveBeenCalled();
    expect(mockedEdit).not.toHaveBeenCalled();
  });
});
