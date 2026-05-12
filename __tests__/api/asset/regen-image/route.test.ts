/**
 * TM-88 — POST /api/asset/regen-image (Customize-tab AI image regeneration).
 *
 * Covers: auth gate, prompt validation, Pro-tier gate, OPENAI key gate,
 * happy path (mocked generateAssetImage), and content-policy mapping (422).
 */

jest.mock('@/lib/auth', () => ({ auth: jest.fn() }));
jest.mock('@/lib/db/prisma', () => ({
  prisma: { user: { findUnique: jest.fn() } },
}));
jest.mock('@/lib/ai/asset-gen', () => ({
  generateAssetImage: jest.fn(),
  GPT_IMAGE_1_PRICE_USD_1024: 0.04,
}));

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';
import { generateAssetImage } from '@/lib/ai/asset-gen';
import { POST } from '@/app/api/asset/regen-image/route';

const mockedAuth = auth as jest.MockedFunction<typeof auth>;
type SessionShape = ReturnType<typeof auth> extends Promise<infer R> ? R : never;
const mockedUser = (prisma as unknown as {
  user: { findUnique: jest.Mock };
}).user;
const mockedGen = generateAssetImage as jest.MockedFunction<typeof generateAssetImage>;

function buildReq(body: unknown): Request {
  return new Request('http://localhost/api/asset/regen-image', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

const ORIG_KEY = process.env.OPENAI_API_KEY;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.OPENAI_API_KEY = 'sk-test';
});

afterAll(() => {
  if (ORIG_KEY === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = ORIG_KEY;
});

describe('POST /api/asset/regen-image — auth gate', () => {
  it('returns 401 when no session', async () => {
    mockedAuth.mockResolvedValue(null as unknown as SessionShape);
    const res = await POST(buildReq({ prompt: 'bear' }));
    expect(res.status).toBe(401);
  });
});

describe('POST /api/asset/regen-image — input validation', () => {
  beforeEach(() => {
    mockedAuth.mockResolvedValue({ user: { id: 'u1' } } as unknown as SessionShape);
  });

  it('returns 400 on non-JSON body', async () => {
    const res = await POST(buildReq('not-json'));
    expect(res.status).toBe(400);
  });

  it('returns 400 when prompt is missing', async () => {
    const res = await POST(buildReq({}));
    expect(res.status).toBe(400);
  });

  it('returns 400 when prompt is not a string', async () => {
    const res = await POST(buildReq({ prompt: 123 }));
    expect(res.status).toBe(400);
  });

  it('returns 400 via validatePrompt when prompt exceeds 2000 chars', async () => {
    const res = await POST(buildReq({ prompt: 'x'.repeat(2001) }));
    expect(res.status).toBe(400);
  });
});

describe('POST /api/asset/regen-image — tier gate', () => {
  beforeEach(() => {
    mockedAuth.mockResolvedValue({ user: { id: 'u1' } } as unknown as SessionShape);
  });

  it('returns 404 when user not found', async () => {
    mockedUser.findUnique.mockResolvedValue(null);
    const res = await POST(buildReq({ prompt: 'bear' }));
    expect(res.status).toBe(404);
  });

  it('returns 403 with upgradeRequired for FREE tier', async () => {
    mockedUser.findUnique.mockResolvedValue({ tier: 'FREE' });
    const res = await POST(buildReq({ prompt: 'bear' }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.upgradeRequired).toBe(true);
  });
});

describe('POST /api/asset/regen-image — happy path + errors', () => {
  beforeEach(() => {
    mockedAuth.mockResolvedValue({ user: { id: 'u1' } } as unknown as SessionShape);
    mockedUser.findUnique.mockResolvedValue({ tier: 'PRO' });
  });

  it('returns 503 when OPENAI_API_KEY is missing (config error)', async () => {
    delete process.env.OPENAI_API_KEY;
    const res = await POST(buildReq({ prompt: 'bear' }));
    expect(res.status).toBe(503);
  });

  it('returns 200 + dataUrl on success', async () => {
    mockedGen.mockResolvedValue({
      pngBytes: Buffer.from([0]),
      dataUrl: 'data:image/png;base64,AAAA',
      costUsd: 0.04,
      latencyMs: 1234,
      prompt: 'bear',
      size: '1024x1024',
      quality: 'low',
    });
    const res = await POST(buildReq({ prompt: 'bear', paramKey: 'hero' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.imageUrl).toBe('data:image/png;base64,AAAA');
    expect(body.paramKey).toBe('hero');
    expect(body.costUsd).toBe(0.04);
    expect(mockedGen).toHaveBeenCalledWith({ prompt: 'bear' });
  });

  it('maps OpenAI content_policy errors to 422 + CONTENT_POLICY code', async () => {
    mockedGen.mockRejectedValue(new Error('Your request was rejected by the content_policy safety system.'));
    const res = await POST(buildReq({ prompt: 'real person' }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe('CONTENT_POLICY');
  });

  it('maps generic errors to 502 + IMAGE_GEN_FAILED', async () => {
    mockedGen.mockRejectedValue(new Error('upstream timeout'));
    const res = await POST(buildReq({ prompt: 'bear' }));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.code).toBe('IMAGE_GEN_FAILED');
  });
});
