/**
 * Unit tests for judge_visual / judge_code (TM-103).
 * Uses Node's built-in node:test + tsx. The OpenAI client is mocked via a
 * minimal `ChatLikeClient` so no API key is required and tests are hermetic.
 *
 * Coverage targets:
 *  - happy-path parsing of well-formed JSON
 *  - axis clamping (out-of-range / NaN / missing keys)
 *  - overall (0-100) + needs_review derivation
 *  - determinism flags (temperature=0, seed=42, ADR-0018)
 *  - input validation (empty image_url / empty code)
 *  - JSON extraction from noisy model output
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  judgeVisual,
  judgeCode,
  type ChatLikeClient,
  type ChatRequest,
  type ChatResponse,
} from '../src/judge.ts';

function mockClient(reply: string, capture?: { last?: ChatRequest }): ChatLikeClient {
  return {
    chat: {
      completions: {
        create: async (req: ChatRequest): Promise<ChatResponse> => {
          if (capture) capture.last = req;
          return { choices: [{ message: { content: reply } }] };
        },
      },
    },
  };
}

test('judge_visual: parses well-formed JSON and computes overall', async () => {
  const c = mockClient(
    JSON.stringify({
      scores: { clarity: 8, fidelity: 7, aesthetic: 9, intent_match: 8 },
      reasoning: 'Clean composition, on-prompt.',
    }),
  );
  const r = await judgeVisual(c, { image_url: 'data:image/png;base64,AAA' });
  assert.deepEqual(r.scores, {
    clarity: 8,
    fidelity: 7,
    aesthetic: 9,
    intent_match: 8,
  });
  // avg = 8.0 → overall 80
  assert.equal(r.overall, 80);
  assert.equal(r.needs_review, false);
  assert.match(r.reasoning, /Clean composition/);
});

test('judge_visual: flags needs_review when any axis < 6', async () => {
  const c = mockClient(
    JSON.stringify({
      scores: { clarity: 9, fidelity: 5, aesthetic: 9, intent_match: 9 },
      reasoning: 'Slight rendering artifacts.',
    }),
  );
  const r = await judgeVisual(c, { image_url: 'https://example.com/a.png' });
  assert.equal(r.scores.fidelity, 5);
  assert.equal(r.needs_review, true);
});

test('judge_visual: pins temperature=0 + seed=42 (ADR-0018)', async () => {
  const cap: { last?: ChatRequest } = {};
  const c = mockClient(
    JSON.stringify({
      scores: { clarity: 7, fidelity: 7, aesthetic: 7, intent_match: 7 },
      reasoning: 'ok',
    }),
    cap,
  );
  await judgeVisual(c, { image_url: 'data:image/png;base64,AAA' });
  assert.ok(cap.last, 'request was captured');
  assert.equal(cap.last!.temperature, 0);
  assert.equal(cap.last!.seed, 42);
  assert.equal(cap.last!.model, 'gpt-4o');
  assert.deepEqual(cap.last!.response_format, { type: 'json_object' });
});

test('judge_visual: passes through model override', async () => {
  const cap: { last?: ChatRequest } = {};
  const c = mockClient(
    JSON.stringify({
      scores: { clarity: 7, fidelity: 7, aesthetic: 7, intent_match: 7 },
      reasoning: 'ok',
    }),
    cap,
  );
  await judgeVisual(c, { image_url: 'data:image/png;base64,AAA', model: 'gpt-4o-2024-08-06' });
  assert.equal(cap.last!.model, 'gpt-4o-2024-08-06');
});

test('judge_visual: clamps out-of-range and missing axes', async () => {
  const c = mockClient(
    JSON.stringify({
      scores: { clarity: 99, fidelity: -3, aesthetic: 'bad', intent_match: undefined },
      reasoning: 'mixed',
    }),
  );
  const r = await judgeVisual(c, { image_url: 'data:image/png;base64,AAA' });
  // 99 → clamped to 10
  assert.equal(r.scores.clarity, 10);
  // -3 → clamped to 1
  assert.equal(r.scores.fidelity, 1);
  // 'bad' → NaN → clamp([1,10]) → 1
  assert.equal(r.scores.aesthetic, 1);
  // undefined → NaN → clamp([1,10]) → 1
  assert.equal(r.scores.intent_match, 1);
});

test('judge_visual: tolerates JSON with surrounding noise', async () => {
  const noisy = `Here is my grading:\n${JSON.stringify({
    scores: { clarity: 6, fidelity: 6, aesthetic: 6, intent_match: 6 },
    reasoning: 'borderline',
  })}\nThanks!`;
  const c = mockClient(noisy);
  const r = await judgeVisual(c, { image_url: 'data:image/png;base64,AAA' });
  assert.equal(r.overall, 60);
  assert.equal(r.needs_review, false); // all axes == 6, not < 6
});

test('judge_visual: throws on missing image_url', async () => {
  const c = mockClient('{}');
  await assert.rejects(
    // @ts-expect-error testing runtime guard
    judgeVisual(c, {}),
    /image_url is required/,
  );
});

test('judge_visual: throws on malformed model output (no JSON)', async () => {
  const c = mockClient('Sorry, I cannot grade this image.');
  await assert.rejects(
    judgeVisual(c, { image_url: 'data:image/png;base64,AAA' }),
    /no JSON object/,
  );
});

test('judge_visual: appends criteria to system prompt', async () => {
  const cap: { last?: ChatRequest } = {};
  const c = mockClient(
    JSON.stringify({
      scores: { clarity: 7, fidelity: 7, aesthetic: 7, intent_match: 7 },
      reasoning: 'ok',
    }),
    cap,
  );
  await judgeVisual(c, {
    image_url: 'data:image/png;base64,AAA',
    criteria: 'User wanted a teal gradient background.',
  });
  const sys = cap.last!.messages[0].content as string;
  assert.match(sys, /Extra criteria from caller/);
  assert.match(sys, /teal gradient/);
});

test('judge_code: parses and computes overall', async () => {
  const c = mockClient(
    JSON.stringify({
      scores: { correctness: 9, style: 8, safety: 10, intent_match: 9 },
      reasoning: 'Idiomatic and safe.',
    }),
  );
  const r = await judgeCode(c, { code: 'const x = 1;' });
  assert.equal(r.scores.correctness, 9);
  assert.equal(r.scores.safety, 10);
  assert.equal(r.overall, 90);
  assert.equal(r.needs_review, false);
});

test('judge_code: defaults to gpt-4o-mini', async () => {
  const cap: { last?: ChatRequest } = {};
  const c = mockClient(
    JSON.stringify({
      scores: { correctness: 7, style: 7, safety: 7, intent_match: 7 },
      reasoning: 'ok',
    }),
    cap,
  );
  await judgeCode(c, { code: 'const x = 1;' });
  assert.equal(cap.last!.model, 'gpt-4o-mini');
  assert.equal(cap.last!.temperature, 0);
  assert.equal(cap.last!.seed, 42);
});

test('judge_code: needs_review when safety < 6', async () => {
  const c = mockClient(
    JSON.stringify({
      scores: { correctness: 8, style: 8, safety: 2, intent_match: 8 },
      reasoning: 'Uses eval.',
    }),
  );
  const r = await judgeCode(c, { code: 'eval("1+1")' });
  assert.equal(r.needs_review, true);
});

test('judge_code: throws on empty code', async () => {
  const c = mockClient('{}');
  await assert.rejects(judgeCode(c, { code: '' }), /code is required/);
});

test('judge_code: passes code in fenced block', async () => {
  const cap: { last?: ChatRequest } = {};
  const c = mockClient(
    JSON.stringify({
      scores: { correctness: 7, style: 7, safety: 7, intent_match: 7 },
      reasoning: 'ok',
    }),
    cap,
  );
  await judgeCode(c, { code: 'function f(){ return 1; }' });
  const user = cap.last!.messages[1].content as string;
  assert.match(user, /```/);
  assert.match(user, /function f/);
});
