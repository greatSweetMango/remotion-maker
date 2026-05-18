/**
 * TM-157 — POST /api/generate/prefetch.
 *
 * Covers: auth gate, prompt validation, living-entity cost guard, OPENAI
 * key gate, happy path (mocked runAssetGenStage), cache-hit response, and
 * soft-error envelope on stage failure.
 *
 * The pipeline-side assumption being tested here:
 * `runAssetGenStage({prompt, answers})` is called with the EXACT same
 * `(prompt, defaultAnswers)` that the client will send to /api/generate
 * later, so the sha256 hash matches and the second call short-circuits.
 */

jest.mock('@/lib/auth', () => ({ auth: jest.fn() }));
jest.mock('@/lib/ai/asset-gen-stage', () => {
  const actual = jest.requireActual('@/lib/ai/asset-gen-stage');
  return {
    ...actual,
    runAssetGenStage: jest.fn(),
  };
});

import { auth } from '@/lib/auth';
import { runAssetGenStage } from '@/lib/ai/asset-gen-stage';
import { POST } from '@/app/api/generate/prefetch/route';

const mockedAuth = auth as jest.MockedFunction<typeof auth>;
type SessionShape = ReturnType<typeof auth> extends Promise<infer R> ? R : never;
const mockedStage = runAssetGenStage as jest.MockedFunction<typeof runAssetGenStage>;

function buildReq(body: unknown): Request {
  return new Request('http://localhost/api/generate/prefetch', {
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

describe('POST /api/generate/prefetch — auth gate', () => {
  it('returns 401 when no session', async () => {
    mockedAuth.mockResolvedValue(null as unknown as SessionShape);
    const res = await POST(buildReq({ prompt: 'a bear' }));
    expect(res.status).toBe(401);
    expect(mockedStage).not.toHaveBeenCalled();
  });
});

describe('POST /api/generate/prefetch — input validation', () => {
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
    const res = await POST(buildReq({ prompt: 7 }));
    expect(res.status).toBe(400);
  });

  it('returns 400 via validatePrompt when prompt exceeds the cap', async () => {
    const res = await POST(buildReq({ prompt: 'x'.repeat(2001) }));
    expect(res.status).toBe(400);
  });
});

describe('POST /api/generate/prefetch — living-entity cost guard', () => {
  beforeEach(() => {
    mockedAuth.mockResolvedValue({ user: { id: 'u1' } } as unknown as SessionShape);
  });

  it('skips (no asset-gen call) when prompt has no living entity', async () => {
    const res = await POST(buildReq({
      prompt: 'Bar chart top 5 products by revenue',
      defaultAnswers: { palette: 'corporate' },
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('skipped');
    expect(body.reason).toBe('no-living-entity');
    expect(mockedStage).not.toHaveBeenCalled();
  });

  it('skips when prompt is abstract motion-graphics (no human/animal/character noun)', async () => {
    const res = await POST(buildReq({
      prompt: 'fade in fade out logo 2 seconds',
      defaultAnswers: {},
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('skipped');
    expect(mockedStage).not.toHaveBeenCalled();
  });
});

describe('POST /api/generate/prefetch — happy path', () => {
  beforeEach(() => {
    mockedAuth.mockResolvedValue({ user: { id: 'u1' } } as unknown as SessionShape);
  });

  it('returns 503 when OPENAI_API_KEY is missing', async () => {
    delete process.env.OPENAI_API_KEY;
    const res = await POST(buildReq({
      prompt: '곰돌이 캐릭터 10초 애니메이션',
      defaultAnswers: { style: 'cute' },
    }));
    expect(res.status).toBe(503);
    expect(mockedStage).not.toHaveBeenCalled();
  });

  it('forwards (prompt, defaultAnswers) verbatim to runAssetGenStage', async () => {
    mockedStage.mockResolvedValue({
      imageUrl: '/uploads/asset-gen/abc.png',
      costUsd: 0.04,
      latencyMs: 33000,
      cached: false,
      hash: 'abc',
      matchedToken: '곰돌이',
    });
    const res = await POST(buildReq({
      prompt: '곰돌이 캐릭터 10초',
      defaultAnswers: { style: 'cute', pacing: 'medium' },
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.cached).toBe(false);
    expect(body.hash).toBe('abc');
    expect(mockedStage).toHaveBeenCalledTimes(1);
    const callArg = mockedStage.mock.calls[0][0];
    expect(callArg.prompt).toBe('곰돌이 캐릭터 10초');
    expect(callArg.answers).toEqual({ style: 'cute', pacing: 'medium' });
  });

  it('surfaces cached:true when the disk short-circuit fires (cheap hit)', async () => {
    mockedStage.mockResolvedValue({
      imageUrl: '/uploads/asset-gen/xyz.png',
      costUsd: 0,
      latencyMs: 0,
      cached: true,
      hash: 'xyz',
      matchedToken: 'character',
    });
    const res = await POST(buildReq({
      prompt: 'astronaut floating',
      defaultAnswers: {},
    }));
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.cached).toBe(true);
    expect(body.costUsd).toBe(0);
  });

  it('drops non-string answer values defensively before hashing', async () => {
    mockedStage.mockResolvedValue({
      imageUrl: '/u/h.png',
      costUsd: 0.04,
      latencyMs: 1,
      cached: false,
      hash: 'h',
      matchedToken: 'dragon',
    });
    await POST(buildReq({
      prompt: 'dragon flying through clouds',
      defaultAnswers: { palette: 'warm', wrong: 12, also: null, ok: 'yes' },
    }));
    const callArg = mockedStage.mock.calls[0][0];
    // Only string-typed values survive.
    expect(callArg.answers).toEqual({ palette: 'warm', ok: 'yes' });
  });

  it('returns soft 200 status:error on stage failure (never user-visible 5xx)', async () => {
    mockedStage.mockRejectedValue(new Error('openai 429'));
    const res = await POST(buildReq({
      prompt: 'person walking in a forest',
      defaultAnswers: {},
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('error');
    expect(body.error).toMatch(/openai 429/);
  });

  it('returns status:skipped when stage returns null (race / edge)', async () => {
    mockedStage.mockResolvedValue(null);
    const res = await POST(buildReq({
      prompt: 'cat playing piano',
      defaultAnswers: {},
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('skipped');
    expect(body.reason).toBe('stage-null');
  });
});
