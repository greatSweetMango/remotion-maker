/**
 * TM-66 / TM-111 — unit test: tm-46-judge.ts uses OpenAI gpt-4o multimodal,
 * parses 4-axis JSON, and emits ADR-0018 variance probe fields
 * (runs[]/delta_max/std/n_shots).
 *
 * Two mock styles coexist:
 *  - jest.mock('openai') keeps the legacy fixture flow used by `main()`.
 *  - A direct ChatLikeClient mock exercises the TM-111 contract surface
 *    so future callers (TM-100 agent / TM-103 MCP wiring) don't need the
 *    SDK installed to validate scoring logic.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const mockCreate = jest.fn();

jest.mock('openai', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      chat: { completions: { create: mockCreate } },
    })),
  };
});

import OpenAI from 'openai';
import { judgePrompt, type ChatLikeClient } from '../benchmarks/tm-46-judge';

describe('tm-46-judge (OpenAI gpt-4o)', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm66-'));
    // 1x1 PNG (valid magic bytes)
    const pngB64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
    const buf = Buffer.from(pngB64, 'base64');
    for (const frame of [60, 90, 180]) {
      fs.writeFileSync(path.join(tmpDir, `t1-${frame}.png`), buf);
    }
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => mockCreate.mockReset());

  it('parses 4-axis JSON and computes overall_score (0-100)', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              frames: [
                { frame: 60, layout: 8, typography: 7, motion: 9, fidelity: 8, comment: 'a' },
                { frame: 90, layout: 8, typography: 7, motion: 9, fidelity: 8, comment: 'b' },
                { frame: 180, layout: 8, typography: 7, motion: 9, fidelity: 8, comment: 'c' },
              ],
              overall_comment: 'ok',
              improvement_suggestion: 'tweak',
            }),
          },
        },
      ],
    });

    const client = new OpenAI({ apiKey: 'test' }) as unknown as ChatLikeClient;
    const result = await judgePrompt(
      client,
      { id: 't1', category: 'cat', prompt: 'p', expected: {} as never } as never,
      tmpDir,
      { nShots: 1 },
    );

    expect(result).not.toBeNull();
    expect(result!.overall_score).toBe(80); // (8+7+9+8)/4 = 8.0 → 80
    expect(result!.needs_followup).toBe(false);
    expect(result!.judge.frames).toHaveLength(3);
    // TM-111: variance fields populated even at n_shots=1
    expect(result!.runs).toEqual([80]);
    expect(result!.delta_max).toBe(0);
    expect(result!.std).toBe(0);
    expect(result!.n_shots).toBe(1);

    // Verify gpt-4o multimodal call shape
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const call = mockCreate.mock.calls[0][0];
    expect(call.model).toBe('gpt-4o');
    expect(call.max_tokens).toBe(400);
    expect(call.response_format).toEqual({ type: 'json_object' });
    expect(call.messages[0].role).toBe('system');
    expect(call.messages[1].role).toBe('user');
    const userParts = call.messages[1].content;
    const imageParts = userParts.filter((p: { type: string }) => p.type === 'image_url');
    expect(imageParts).toHaveLength(3);
    expect(imageParts[0].image_url.url).toMatch(/^data:image\/png;base64,/);
  });

  it('flags needs_followup when avg < 7.0 (overall < 70)', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              frames: [
                { frame: 60, layout: 5, typography: 5, motion: 5, fidelity: 5, comment: 'a' },
                { frame: 90, layout: 6, typography: 6, motion: 6, fidelity: 6, comment: 'b' },
                { frame: 180, layout: 7, typography: 7, motion: 7, fidelity: 7, comment: 'c' },
              ],
              overall_comment: 'meh',
              improvement_suggestion: 'redo',
            }),
          },
        },
      ],
    });

    const client = new OpenAI({ apiKey: 'test' }) as unknown as ChatLikeClient;
    const result = await judgePrompt(
      client,
      { id: 't1', category: 'cat', prompt: 'p', expected: {} as never } as never,
      tmpDir,
      { nShots: 1 },
    );

    expect(result!.overall_score).toBe(60);
    expect(result!.needs_followup).toBe(true);
  });

  it('returns null on malformed JSON response', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'not json at all' } }],
    });

    const client = new OpenAI({ apiKey: 'test' }) as unknown as ChatLikeClient;
    const result = await judgePrompt(
      client,
      { id: 't1', category: 'cat', prompt: 'p', expected: {} as never } as never,
      tmpDir,
      { nShots: 1 },
    );
    expect(result).toBeNull();
  });

  // ───────── TM-111: variance probe (ADR-0018) ─────────

  function frameJson(score: number): string {
    return JSON.stringify({
      frames: [
        { frame: 60, layout: score, typography: score, motion: score, fidelity: score, comment: 'x' },
        { frame: 90, layout: score, typography: score, motion: score, fidelity: score, comment: 'x' },
        { frame: 180, layout: score, typography: score, motion: score, fidelity: score, comment: 'x' },
      ],
      overall_comment: 'ok',
      improvement_suggestion: 'n/a',
    });
  }

  it('TM-111: N=2 variance probe emits runs[]/delta_max/std', async () => {
    // Two shots return overall 80 and 70 respectively → mean=75, Δ=10.
    mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: frameJson(8) } }] });
    mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: frameJson(7) } }] });

    const client = new OpenAI({ apiKey: 'test' }) as unknown as ChatLikeClient;
    const result = await judgePrompt(
      client,
      { id: 't1', category: 'cat', prompt: 'p', expected: {} as never } as never,
      tmpDir,
      { nShots: 2 },
    );

    expect(result).not.toBeNull();
    expect(result!.n_shots).toBe(2);
    expect(result!.runs).toEqual([80, 70]);
    expect(result!.delta_max).toBe(10);
    // population std of [80,70] = 5
    expect(result!.std).toBe(5);
    expect(result!.overall_score).toBe(75); // mean
    expect(result!.needs_followup).toBe(false); // 75 ≥ 70
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it('TM-111: deterministic shots (temp=0/seed=42) yield Δmax=0, std=0', async () => {
    mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: frameJson(8) } }] });
    mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: frameJson(8) } }] });

    const client = new OpenAI({ apiKey: 'test' }) as unknown as ChatLikeClient;
    const result = await judgePrompt(
      client,
      { id: 't1', category: 'cat', prompt: 'p', expected: {} as never } as never,
      tmpDir,
      { nShots: 2 },
    );

    expect(result!.delta_max).toBe(0);
    expect(result!.std).toBe(0);
    expect(result!.runs).toEqual([80, 80]);
    // ADR-0018 floor — Δmax ≤ 3 → judge-acceptance gate OK
    expect(result!.delta_max).toBeLessThanOrEqual(3);
  });

  it('TM-111: pins temperature=0, seed=42, response_format json_object (ADR-0018)', async () => {
    mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: frameJson(8) } }] });
    const client = new OpenAI({ apiKey: 'test' }) as unknown as ChatLikeClient;
    await judgePrompt(
      client,
      { id: 't1', category: 'cat', prompt: 'p', expected: {} as never } as never,
      tmpDir,
      { nShots: 1 },
    );
    const call = mockCreate.mock.calls[0][0];
    expect(call.temperature).toBe(0);
    expect(call.seed).toBe(42);
    expect(call.response_format).toEqual({ type: 'json_object' });
    expect(call.model).toBe('gpt-4o');
  });

  it('TM-111: partial-failure (1/2 shots parse) still returns aggregate', async () => {
    mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: frameJson(7) } }] });
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'garbage non-json' } }],
    });
    const client = new OpenAI({ apiKey: 'test' }) as unknown as ChatLikeClient;
    const result = await judgePrompt(
      client,
      { id: 't1', category: 'cat', prompt: 'p', expected: {} as never } as never,
      tmpDir,
      { nShots: 2 },
    );
    expect(result).not.toBeNull();
    expect(result!.n_shots).toBe(1);
    expect(result!.runs).toEqual([70]);
    expect(result!.delta_max).toBe(0);
  });

  it('TM-111: accepts a hermetic ChatLikeClient mock (no OpenAI SDK)', async () => {
    // Demonstrates the TM-103 MCP-aligned contract: callers (TM-100 agent /
    // sub-tasks) can drive judgePrompt without instantiating OpenAI.
    let captured: unknown;
    const hermetic: ChatLikeClient = {
      chat: {
        completions: {
          create: async (req: unknown) => {
            captured = req;
            return { choices: [{ message: { content: frameJson(9) } }] };
          },
        },
      },
    };
    const result = await judgePrompt(
      hermetic,
      { id: 't1', category: 'cat', prompt: 'p', expected: {} as never } as never,
      tmpDir,
      { nShots: 1 },
    );
    expect(result!.overall_score).toBe(90);
    // (9+9+9+9)/4 * 10 = 90
    expect(captured).toBeDefined();
  });
});
