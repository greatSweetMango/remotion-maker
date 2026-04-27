/**
 * Tests for POST /api/edit prompt length cap (TM-58).
 */
import { NextRequest } from 'next/server';

jest.mock('@/lib/auth', () => ({ auth: jest.fn() }));

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    asset: { findFirst: jest.fn() },
  },
}));

jest.mock('@/lib/ai/edit', () => ({
  editAsset: jest.fn(),
}));

jest.mock('@/lib/ai/client', () => ({
  getModels: () => ({ free: 'm-free', pro: 'm-pro' }),
}));

import { auth } from '@/lib/auth';
import { editAsset } from '@/lib/ai/edit';
import { POST } from '@/app/api/edit/route';
import { MAX_PROMPT_LENGTH } from '@/lib/validation/prompt';

const mockedAuth = auth as jest.MockedFunction<typeof auth>;
type SessionShape = ReturnType<typeof auth> extends Promise<infer R> ? R : never;
const mockedEdit = editAsset as jest.MockedFunction<typeof editAsset>;

function buildReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/edit', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedAuth.mockResolvedValue({ user: { id: 'u-1' } } as unknown as SessionShape);
});

describe('POST /api/edit — TM-58 prompt length cap', () => {
  it('returns 400 PROMPT_TOO_LONG for an oversized edit prompt', async () => {
    const res = await POST(buildReq({
      assetId: 'asset-1',
      prompt: 'a'.repeat(MAX_PROMPT_LENGTH + 1),
      currentCode: 'const a = 1;',
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('PROMPT_TOO_LONG');
    expect(body.max).toBe(MAX_PROMPT_LENGTH);
  });

  it('does not call editAsset when prompt is too long', async () => {
    await POST(buildReq({
      assetId: 'asset-1',
      prompt: 'a'.repeat(10500),
      currentCode: 'const a = 1;',
    }));
    expect(mockedEdit).not.toHaveBeenCalled();
  });
});
