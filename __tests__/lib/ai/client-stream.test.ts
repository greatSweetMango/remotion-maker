/**
 * TM-54 — unit tests for `chatCompleteStream` provider routing + TTFB.
 *
 * We mock the OpenAI/Anthropic SDKs at module scope so the streaming
 * paths can be exercised without network access.
 */

const openaiCreate = jest.fn();
const anthropicStream = jest.fn();

jest.mock('openai', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      chat: { completions: { create: openaiCreate } },
    })),
  };
});

jest.mock('@anthropic-ai/sdk', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      messages: { stream: anthropicStream },
    })),
  };
});

async function* asAsync<T>(items: T[]): AsyncIterable<T> {
  for (const it of items) yield it;
}

import { chatCompleteStream, DEFAULT_MAX_TOKENS } from '@/lib/ai/client';

describe('chatCompleteStream', () => {
  beforeEach(() => {
    openaiCreate.mockReset();
    anthropicStream.mockReset();
  });

  it('streams OpenAI chunks and reports firstTokenMs', async () => {
    process.env.AI_PROVIDER = 'openai';
    process.env.OPENAI_API_KEY = 'sk-test';

    openaiCreate.mockResolvedValue(
      asAsync([
        { choices: [{ delta: { content: 'Hel' } }] },
        { choices: [{ delta: { content: 'lo ' } }] },
        { choices: [{ delta: { content: 'world' } }] },
      ]),
    );

    const deltas: string[] = [];
    let firstTokenSeen = -1;
    const result = await chatCompleteStream({
      model: 'gpt-4o-mini',
      system: 'sys',
      messages: [{ role: 'user', content: 'hi' }],
      onDelta: (chunk) => deltas.push(chunk),
      onFirstToken: (ms) => {
        firstTokenSeen = ms;
      },
    });

    expect(result.text).toBe('Hello world');
    expect(deltas).toEqual(['Hel', 'lo ', 'world']);
    expect(firstTokenSeen).toBeGreaterThanOrEqual(0);
    expect(result.firstTokenMs).toBeGreaterThanOrEqual(0);
    expect(result.totalMs).toBeGreaterThanOrEqual(result.firstTokenMs);

    // Sanity: provider got streaming flag + new default max_tokens.
    expect(openaiCreate).toHaveBeenCalledWith(
      expect.objectContaining({ stream: true, max_tokens: DEFAULT_MAX_TOKENS }),
    );
  });

  it('streams Anthropic deltas and reports firstTokenMs', async () => {
    process.env.AI_PROVIDER = 'anthropic';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';

    anthropicStream.mockReturnValue(
      asAsync([
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'foo ' } },
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'bar' } },
        // non-text events should be ignored
        { type: 'message_start' },
      ]),
    );

    let firstTokenSeen = -1;
    const result = await chatCompleteStream({
      model: 'claude-haiku-4-5-20251001',
      system: 'sys',
      messages: [{ role: 'user', content: 'hi' }],
      onFirstToken: (ms) => {
        firstTokenSeen = ms;
      },
    });

    expect(result.text).toBe('foo bar');
    expect(firstTokenSeen).toBeGreaterThanOrEqual(0);
    expect(result.firstTokenMs).toBeGreaterThanOrEqual(0);
  });

  it('returns sane firstTokenMs even when no tokens were emitted', async () => {
    process.env.AI_PROVIDER = 'openai';
    openaiCreate.mockResolvedValue(asAsync([]));

    const result = await chatCompleteStream({
      model: 'gpt-4o-mini',
      system: 'sys',
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(result.text).toBe('');
    expect(result.firstTokenMs).toBeGreaterThanOrEqual(0);
    expect(result.totalMs).toBeGreaterThanOrEqual(0);
  });
});
