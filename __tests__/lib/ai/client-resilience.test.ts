/**
 * TM-82 — network resilience for chatCompleteStream.
 *
 * Failure-injection tests for the OpenAI / Anthropic streaming paths in
 * `src/lib/ai/client.ts`. We assert observable contract behavior so the
 * upstream API route + UI can react predictably:
 *
 *   1. 5xx (server errors raised before any token streams) propagate as
 *      thrown Errors with the provider's message intact, so the route can
 *      refund quota (TM-92) and the UI can render the message.
 *   2. Timeouts surface as the AbortError-style rejection without ever
 *      resolving with partial text — callers must not see "empty success".
 *   3. Mid-stream errors after some tokens have streamed propagate as
 *      thrown Errors AFTER the partial text was delivered to `onDelta`.
 *      This documents that callers MUST treat onDelta accumulation as
 *      provisional and only commit on resolved promise.
 *
 * Why these matter for users: without (1), a 5xx + accidental swallow
 * would burn quota silently; without (2), a hung upstream + truthy text
 * would persist garbage as a "successful" asset; without (3), a partial
 * stream could be persisted as a real edit, corrupting history.
 */

const openaiCreate = jest.fn();
const anthropicStream = jest.fn();

jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    chat: { completions: { create: openaiCreate } },
  })),
}));

jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    messages: { stream: anthropicStream },
  })),
}));

import { chatCompleteStream } from '@/lib/ai/client';

class APIError extends Error {
  status: number;
  constructor(status: number, msg: string) {
    super(msg);
    this.status = status;
    this.name = 'APIError';
  }
}

async function* throwAfter<T>(items: T[], err: Error): AsyncIterable<T> {
  for (const it of items) yield it;
  throw err;
}

describe('TM-82 chatCompleteStream resilience', () => {
  beforeEach(() => {
    openaiCreate.mockReset();
    anthropicStream.mockReset();
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
  });

  describe('OpenAI provider', () => {
    beforeEach(() => {
      process.env.AI_PROVIDER = 'openai';
    });

    it('propagates 5xx error from create() with status + message intact', async () => {
      openaiCreate.mockRejectedValue(new APIError(503, 'Service Unavailable'));

      await expect(
        chatCompleteStream({
          model: 'gpt-4o-mini',
          system: 'sys mentioning JSON',
          messages: [{ role: 'user', content: 'hi' }],
        }),
      ).rejects.toMatchObject({ status: 503, message: 'Service Unavailable' });
    });

    it('propagates 500 with body so the route can surface it to the client', async () => {
      openaiCreate.mockRejectedValue(new APIError(500, 'internal_error'));

      await expect(
        chatCompleteStream({
          model: 'gpt-4o-mini',
          system: 'sys mentioning JSON',
          messages: [{ role: 'user', content: 'hi' }],
        }),
      ).rejects.toThrow(/internal_error/);
    });

    it('propagates timeout / abort as a thrown Error (no silent empty success)', async () => {
      const abortErr = new Error('Request timed out');
      abortErr.name = 'AbortError';
      openaiCreate.mockRejectedValue(abortErr);

      await expect(
        chatCompleteStream({
          model: 'gpt-4o-mini',
          system: 'sys mentioning JSON',
          messages: [{ role: 'user', content: 'hi' }],
        }),
      ).rejects.toThrow(/timed out/i);
    });

    it('mid-stream disconnect: partial deltas reach onDelta then promise rejects', async () => {
      // Models a streaming connection that drops after delivering a few
      // tokens. Caller must observe the partial text via onDelta but the
      // returned promise rejects so the route does NOT persist the partial.
      openaiCreate.mockResolvedValue(
        throwAfter(
          [
            { choices: [{ delta: { content: '{"title":"par' } }] },
            { choices: [{ delta: { content: 'tial' } }] },
          ],
          new Error('stream disconnected'),
        ),
      );

      const seen: string[] = [];
      await expect(
        chatCompleteStream({
          model: 'gpt-4o-mini',
          system: 'sys mentioning JSON',
          messages: [{ role: 'user', content: 'hi' }],
          onDelta: (chunk) => seen.push(chunk),
        }),
      ).rejects.toThrow(/disconnected/);

      // partial content was delivered to the streaming UI, but the call
      // failed — caller must NOT commit it.
      expect(seen.join('')).toBe('{"title":"partial');
    });
  });

  describe('Anthropic provider', () => {
    beforeEach(() => {
      process.env.AI_PROVIDER = 'anthropic';
    });

    it('propagates upstream 5xx (overloaded) raised by stream() init', async () => {
      anthropicStream.mockImplementation(() => {
        throw new APIError(529, 'Overloaded');
      });

      await expect(
        chatCompleteStream({
          model: 'claude-haiku-4-5-20251001',
          system: 'sys',
          messages: [{ role: 'user', content: 'hi' }],
        }),
      ).rejects.toMatchObject({ status: 529 });
    });

    it('mid-stream error after partial deltas: onDelta receives partial, promise rejects', async () => {
      anthropicStream.mockReturnValue(
        throwAfter(
          [
            { type: 'content_block_delta', delta: { type: 'text_delta', text: 'p' } },
            { type: 'content_block_delta', delta: { type: 'text_delta', text: 'ar' } },
          ],
          new Error('connection reset'),
        ),
      );

      const seen: string[] = [];
      await expect(
        chatCompleteStream({
          model: 'claude-haiku-4-5-20251001',
          system: 'sys',
          messages: [{ role: 'user', content: 'hi' }],
          onDelta: (chunk) => seen.push(chunk),
        }),
      ).rejects.toThrow(/reset/);

      expect(seen.join('')).toBe('par');
    });
  });
});
