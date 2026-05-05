/**
 * TM-109 — template-backed edits must charge `monthlyUsage` exactly once
 * per template per user (on first materialization), not once per edit.
 *
 * Pre-fix behaviour (TM-106 follow-up #1): every POST /api/edit with
 * `assetId: "template-…"` ran `prisma.user.update({ monthlyUsage: +1 })`.
 * If the client (buggy or malicious) kept re-sending the template id, each
 * call burned one generation slot of the user's monthly cap.
 *
 * Post-fix: the route looks up `Asset.templateSourceId === assetId` for the
 * user; on hit it transparently edits the existing row and skips the
 * monthlyUsage increment + the asset.create. On miss it creates the row
 * with `templateSourceId` stamped and bumps monthlyUsage once.
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

const TEMPLATE_ID = 'template-fluidblobs';
const NEW_ASSET_ID = 'cju1abcdefghij0000000000';

function buildReq(): NextRequest {
  return new NextRequest('http://localhost/api/edit', {
    method: 'POST',
    body: JSON.stringify({
      assetId: TEMPLATE_ID,
      prompt: 'tweak the colors',
      currentCode: 'export const PARAMS = {} as const; export default () => null;',
    }),
    headers: { 'content-type': 'application/json' },
  });
}

describe('POST /api/edit — TM-109 template monthlyUsage guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedAuth.mockResolvedValue({ user: { id: 'u-1' } } as unknown as SessionShape);
  });

  it('charges monthlyUsage exactly once across 5 sequential template edits', async () => {
    // Mutable fake DB state for the materialized row.
    let materialized: {
      id: string;
      userId: string;
      templateSourceId: string;
      deletedAt: null;
    } | null = null;
    let monthlyUsage = 0;
    // Track editUsage so reserveEditSlot doesn't 429 us before we ever reach
    // the monthlyUsage logic (FREE editsPerAsset = 3, so we need a fresh
    // counter pivoted to the materialized id from edit #2 onward).
    const editCounts: Record<string, number> = {};

    m.user.findUnique.mockImplementation(async () => ({
      id: 'u-1',
      tier: 'PRO', // PRO bypasses editsPerAsset cap → isolates the monthlyUsage check
      editUsage: JSON.stringify(editCounts),
      monthlyUsage,
      usageResetAt: new Date(),
    }));

    // The route's TM-109 guard query: findFirst({ userId, templateSourceId, deletedAt:null })
    m.asset.findFirst.mockImplementation(async (args: { where: Record<string, unknown> }) => {
      // Plain-asset path: never hit on a template- request.
      if (args.where.id === TEMPLATE_ID) return null;
      // TM-109 guard query.
      if (args.where.templateSourceId === TEMPLATE_ID) return materialized;
      return null;
    });

    m.asset.create.mockImplementation(async (args: { data: { templateSourceId?: string | null } }) => {
      materialized = {
        id: NEW_ASSET_ID,
        userId: 'u-1',
        templateSourceId: args.data.templateSourceId ?? TEMPLATE_ID,
        deletedAt: null,
      };
      return { id: NEW_ASSET_ID };
    });

    m.user.update.mockImplementation(async (args: { data: { monthlyUsage?: { increment: number } } }) => {
      if (args.data.monthlyUsage?.increment) monthlyUsage += args.data.monthlyUsage.increment;
      return { id: 'u-1' };
    });

    m.$executeRaw.mockImplementation(async (..._args: unknown[]) => {
      // Reserve has 5 interpolations; refund has 3. We don't enforce any
      // cap here (PRO tier in this test), just bump the counter.
      const values = _args.slice(1);
      if (values.length === 5) {
        // path is values[0] like `$."<id>"` — extract id robustly.
        const path = String(values[0]);
        const id = path.slice(3, path.length - 1);
        editCounts[id] = (editCounts[id] ?? 0) + 1;
        return 1;
      }
      return 0;
    });

    m.$transaction.mockResolvedValue([{}, {}]);

    mockedEdit.mockResolvedValue({
      title: 'Fluid Blobs (edited)',
      code: 'c',
      jsCode: 'jc',
      parameters: [],
      durationInFrames: 60,
      fps: 30,
      width: 1920,
      height: 1080,
    } as never);

    // Fire 5 sequential edits with the SAME `template-…` assetId. The
    // happy-path TM-106 client would pivot on response and stop sending
    // `template-…`, but we are explicitly testing the misbehaving-client
    // case where the prefix keeps coming back.
    const responses: number[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await POST(buildReq());
      responses.push(res.status);
    }

    expect(responses).toEqual([200, 200, 200, 200, 200]);
    // Critical assertion: monthlyUsage charged exactly once.
    expect(monthlyUsage).toBe(1);
    expect(m.asset.create).toHaveBeenCalledTimes(1);
    expect(m.user.update).toHaveBeenCalledTimes(1);
    // Subsequent edits go through the assetVersion.create + asset.update
    // transaction path, on the materialized row's id.
    expect(m.$transaction).toHaveBeenCalledTimes(4);
  });

  it('first template edit: creates Asset with templateSourceId stamped + bumps monthlyUsage', async () => {
    let monthlyUsage = 0;
    let createdData: Record<string, unknown> | null = null;

    m.user.findUnique.mockResolvedValue({
      id: 'u-1',
      tier: 'PRO',
      editUsage: '{}',
      monthlyUsage,
      usageResetAt: new Date(),
    });

    m.asset.findFirst.mockResolvedValue(null); // no prior materialization
    m.asset.create.mockImplementation(async (args: { data: Record<string, unknown> }) => {
      createdData = args.data;
      return { id: NEW_ASSET_ID };
    });
    m.user.update.mockImplementation(async (args: { data: { monthlyUsage?: { increment: number } } }) => {
      if (args.data.monthlyUsage?.increment) monthlyUsage += args.data.monthlyUsage.increment;
      return { id: 'u-1' };
    });
    m.$executeRaw.mockResolvedValue(1);

    mockedEdit.mockResolvedValue({
      title: 't', code: 'c', jsCode: 'jc', parameters: [],
      durationInFrames: 60, fps: 30, width: 1920, height: 1080,
    } as never);

    const res = await POST(buildReq());
    expect(res.status).toBe(200);
    expect(monthlyUsage).toBe(1);
    expect(createdData).not.toBeNull();
    expect(createdData!.templateSourceId).toBe(TEMPLATE_ID);
    const body = await res.json();
    expect(body.id).toBe(NEW_ASSET_ID);
  });
});
