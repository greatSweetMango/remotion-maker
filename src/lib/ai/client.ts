import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

export type AIProvider = 'anthropic' | 'openai';

export interface AIContentPart {
  type: 'text';
  text: string;
  cache?: boolean;
}

export interface AIMessage {
  role: 'user' | 'assistant';
  content: string | AIContentPart[];
}

export interface ChatCompleteOptions {
  model: string;
  system: string;
  messages: AIMessage[];
  maxTokens?: number;
  /**
   * TM-54 — when set, callers receive a notice the moment the first token
   * lands. Used by the generate route + bench harness to track TTFB
   * separately from total wall ms.
   */
  onFirstToken?: (msSinceStart: number) => void;
  /** TM-54 — when set, fired on every text delta for streaming UIs. */
  onDelta?: (chunk: string, sofar: string) => void;
}

export interface ChatCompleteResult {
  text: string;
  /** Wall ms from request start to the first text token surfacing. */
  firstTokenMs: number;
  /** Wall ms from request start to stream completion. */
  totalMs: number;
}

/**
 * TM-54 — central default for chat completion `max_tokens`.
 * Chosen to comfortably exceed observed p95 generation length (~700 JSON
 * tokens including envelope) while cutting the latency budget allocated
 * by upstream model schedulers (ref: `wiki/05-reports/2026-04-27-TM-41-qa.md`).
 */
export const DEFAULT_MAX_TOKENS = 2500;

function getProvider(): AIProvider {
  return (process.env.AI_PROVIDER as AIProvider) ?? 'anthropic';
}

export function getModels(): { free: string; pro: string } {
  const provider = getProvider();
  if (provider === 'openai') {
    return {
      free: process.env.AI_MODEL_FREE ?? 'gpt-4o-mini',
      pro: process.env.AI_MODEL_PRO ?? 'gpt-4o',
    };
  }
  return {
    free: process.env.AI_MODEL_FREE ?? 'claude-haiku-4-5-20251001',
    pro: process.env.AI_MODEL_PRO ?? 'claude-sonnet-4-6',
  };
}

/**
 * TM-54 — provider-aware streaming chat completion.
 *
 * Streams tokens from the active provider (OpenAI or Anthropic) so callers
 * can observe time-to-first-byte. Returns the full assembled text alongside
 * `firstTokenMs` and `totalMs` so latency reporting is uniform across
 * providers.
 *
 * Backwards-compatible: `chatComplete` (string return) is preserved for
 * existing callers and now delegates to this streaming impl.
 */
export async function chatCompleteStream({
  model,
  system,
  messages,
  maxTokens = DEFAULT_MAX_TOKENS,
  onFirstToken,
  onDelta,
}: ChatCompleteOptions): Promise<ChatCompleteResult> {
  const provider = getProvider();
  const start = Date.now();
  let firstTokenMs = -1;
  let text = '';

  const markFirst = () => {
    if (firstTokenMs < 0) {
      firstTokenMs = Date.now() - start;
      onFirstToken?.(firstTokenMs);
    }
  };

  if (provider === 'openai') {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    // TM-69 — gpt-4o / gpt-4o-mini sometimes return prose or markdown-fenced
    // bodies even when the system prompt says "respond with JSON". Forcing
    // `response_format: json_object` makes the model treat the output as a
    // JSON-only stream. OpenAI requires the literal word "json" to appear in
    // the conversation when this mode is on; we ensure that by appending a
    // short reinforcement to the system message (callers' system prompts
    // already contain "JSON" but this is belt-and-suspenders).
    // Ref: https://platform.openai.com/docs/guides/json-mode
    const systemForJson = /\bjson\b/i.test(system)
      ? system
      : `${system}\n\nRespond strictly in JSON.`;
    const stream = await client.chat.completions.create({
      model,
      max_tokens: maxTokens,
      stream: true,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemForJson },
        ...messages.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content:
            typeof m.content === 'string'
              ? m.content
              : m.content.map((p) => p.text).join('\n'),
        })),
      ],
    });

    for await (const event of stream) {
      const chunk = event.choices?.[0]?.delta?.content ?? '';
      if (!chunk) continue;
      markFirst();
      text += chunk;
      onDelta?.(chunk, text);
    }

    return {
      text,
      firstTokenMs: firstTokenMs < 0 ? Date.now() - start : firstTokenMs,
      totalMs: Date.now() - start,
    };
  }

  // Anthropic
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const anthropicMessages = messages.map((m) => {
    if (typeof m.content === 'string') {
      return { role: m.role, content: m.content };
    }
    return {
      role: m.role,
      content: m.content.map((p) => ({
        type: 'text' as const,
        text: p.text,
        ...(p.cache ? { cache_control: { type: 'ephemeral' as const } } : {}),
      })),
    };
  });

  const stream = client.messages.stream({
    model,
    max_tokens: maxTokens,
    system,
    messages: anthropicMessages,
  });

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      const chunk = event.delta.text;
      markFirst();
      text += chunk;
      onDelta?.(chunk, text);
    }
  }

  return {
    text,
    firstTokenMs: firstTokenMs < 0 ? Date.now() - start : firstTokenMs,
    totalMs: Date.now() - start,
  };
}

/**
 * Legacy non-streaming entry point (returns just text). Now delegates to
 * `chatCompleteStream` so all callers benefit from streaming TTFB without
 * code changes. Kept as a thin wrapper for backward compatibility with
 * existing tests that mock `chatComplete`.
 */
export async function chatComplete(opts: ChatCompleteOptions): Promise<string> {
  const result = await chatCompleteStream(opts);
  return result.text;
}
