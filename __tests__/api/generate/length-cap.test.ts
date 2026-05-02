/**
 * Tests for POST /api/generate prompt length cap (TM-58).
 *
 * Verifies the route returns 400 + structured error for prompts longer
 * than MAX_PROMPT_LENGTH, BEFORE any DB / quota / LLM work happens.
 */
import { NextRequest } from 'next/server';

jest.mock('@/lib/auth', () => ({ auth: jest.fn() }));

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    asset: { create: jest.fn() },
  },
}));

jest.mock('@/lib/ai/generate', () => ({
  generateAsset: jest.fn(),
}));

jest.mock('@/lib/ai/client', () => ({
  getModels: () => ({ free: 'm-free', pro: 'm-pro' }),
}));

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';
import { generateAsset } from '@/lib/ai/generate';
import { POST } from '@/app/api/generate/route';
import { MAX_PROMPT_LENGTH } from '@/lib/validation/prompt';

const mockedAuth = auth as jest.MockedFunction<typeof auth>;
type SessionShape = ReturnType<typeof auth> extends Promise<infer R> ? R : never;
const mockedGenerate = generateAsset as jest.MockedFunction<typeof generateAsset>;
const m = prisma as unknown as {
  user: { findUnique: jest.Mock; update: jest.Mock; updateMany: jest.Mock };
  asset: { create: jest.Mock };
};

function buildReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/generate', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedAuth.mockResolvedValue({ user: { id: 'u-1' } } as unknown as SessionShape);
  m.user.findUnique.mockResolvedValue({
    id: 'u-1',
    tier: 'FREE',
    monthlyUsage: 0,
    usageResetAt: new Date(),
    editUsage: '{}',
  });
  m.user.updateMany.mockResolvedValue({ count: 1 });
});

describe('POST /api/generate — TM-58 prompt length cap', () => {
  it('returns 400 with PROMPT_TOO_LONG for a 10500-char prompt (TM-45 fuzz B3 case)', async () => {
    const res = await POST(buildReq({ prompt: 'a'.repeat(10500) }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('PROMPT_TOO_LONG');
    expect(body.error).toContain('2000');
    expect(body.length).toBe(10500);
    expect(body.max).toBe(MAX_PROMPT_LENGTH);
  });

  it('does not call generateAsset when prompt is too long', async () => {
    await POST(buildReq({ prompt: 'a'.repeat(MAX_PROMPT_LENGTH + 1) }));
    expect(mockedGenerate).not.toHaveBeenCalled();
  });

  it('does not touch the DB when prompt is too long (no quota burn)', async () => {
    await POST(buildReq({ prompt: 'a'.repeat(MAX_PROMPT_LENGTH + 500) }));
    expect(m.user.findUnique).not.toHaveBeenCalled();
    expect(m.user.update).not.toHaveBeenCalled();
    expect(m.asset.create).not.toHaveBeenCalled();
  });

  it('returns 400 PROMPT_REQUIRED for empty prompt', async () => {
    const res = await POST(buildReq({ prompt: '' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('PROMPT_REQUIRED');
  });

  it('accepts a prompt at the cap', async () => {
    mockedGenerate.mockResolvedValue({
      type: 'generate',
      asset: {
        title: 't', code: 'c', jsCode: 'jc', parameters: [],
        durationInFrames: 60, fps: 30, width: 1920, height: 1080,
      },
    } as never);
    m.asset.create.mockResolvedValue({ id: 'a-1' });
    m.user.update.mockResolvedValue({});
    const res = await POST(buildReq({ prompt: 'a'.repeat(MAX_PROMPT_LENGTH) }));
    expect(res.status).toBe(200);
  });
});
