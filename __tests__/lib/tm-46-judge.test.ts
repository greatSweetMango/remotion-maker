/**
 * TM-66 — unit test: tm-46-judge.ts uses OpenAI gpt-4o multimodal and
 * parses 4-axis JSON correctly. OpenAI client is mocked.
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
import { judgePrompt } from '../benchmarks/tm-46-judge';

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

    const client = new OpenAI({ apiKey: 'test' });
    const result = await judgePrompt(
      client,
      { id: 't1', category: 'cat', prompt: 'p', expected: {} as never } as never,
      tmpDir,
    );

    expect(result).not.toBeNull();
    expect(result!.overall_score).toBe(80); // (8+7+9+8)/4 = 8.0 → 80
    expect(result!.needs_followup).toBe(false);
    expect(result!.judge.frames).toHaveLength(3);

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

    const client = new OpenAI({ apiKey: 'test' });
    const result = await judgePrompt(
      client,
      { id: 't1', category: 'cat', prompt: 'p', expected: {} as never } as never,
      tmpDir,
    );

    expect(result!.overall_score).toBe(60);
    expect(result!.needs_followup).toBe(true);
  });

  it('returns null on malformed JSON response', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'not json at all' } }],
    });

    const client = new OpenAI({ apiKey: 'test' });
    const result = await judgePrompt(
      client,
      { id: 't1', category: 'cat', prompt: 'p', expected: {} as never } as never,
      tmpDir,
    );
    expect(result).toBeNull();
  });
});
