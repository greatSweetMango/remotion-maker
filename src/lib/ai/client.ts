import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { recordUsage } from './spend';

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

/**
 * TM-72 — capture-side determinism defaults.
 *
 * TM-46 r5 RCA found that even after TM-70 fixed judge-side variance,
 * the underlying capture / code-generation step still produced different
 * Remotion code on every call (different particle counts, easing curves,
 * colors), driving a per-sample Δmax of ~10 score points across the
 * acceptance gate. Mirroring the TM-70 judge fix, we now pin
 * `temperature=0` + `seed=42` on the generation path as well so that the
 * same prompt yields the same code unless the caller (or operator)
 * explicitly opts back into stochastic sampling via env overrides.
 *
 * Override knobs — both providers respect them, both default to
 * deterministic:
 *   - `AI_TEMPERATURE`   — float, default `0`
 *   - `AI_SEED`          — int, default `42` (set to literal string `none`
 *                          to omit the seed entirely, e.g. for A/B tests)
 *
 * The OpenAI Chat Completions API exposes `seed` as a best-effort knob;
 * Anthropic does not currently expose `seed` so only `temperature` is
 * forwarded for that provider. Both default to `0` which is sufficient to
 * remove the dominant non-determinism source identified in TM-46 r5.
 *
 * Refs: wiki/05-reports/2026-04-27-TM-46-visual-judge-r5.md,
 *       wiki/05-reports/2026-04-27-TM-70-rca.md
 */
export const DEFAULT_AI_TEMPERATURE = 0;
export const DEFAULT_AI_SEED = 42;

/** Resolve the active sampling temperature, allowing env override. */
export function resolveTemperature(): number {
  const raw = process.env.AI_TEMPERATURE;
  if (raw === undefined || raw === '') return DEFAULT_AI_TEMPERATURE;
  const n = Number(raw);
  return Number.isFinite(n) ? n : DEFAULT_AI_TEMPERATURE;
}

/**
 * Resolve the active OpenAI `seed`, allowing env override. Returning
 * `undefined` deliberately omits the field from the request (caller use
 * case: A/B variance experiments).
 */
export function resolveSeed(): number | undefined {
  const raw = process.env.AI_SEED;
  if (raw === undefined || raw === '') return DEFAULT_AI_SEED;
  if (raw.toLowerCase() === 'none') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : DEFAULT_AI_SEED;
}

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
    const seed = resolveSeed();
    const stream = await client.chat.completions.create({
      model,
      max_tokens: maxTokens,
      stream: true,
      // TM-77 — opt into usage on the terminal stream chunk so we can
      // attribute cost in `.agent-state/spend.json`. Without this OpenAI
      // returns `usage: null` for streamed completions.
      stream_options: { include_usage: true },
      response_format: { type: 'json_object' },
      // TM-72 — pin temperature/seed for capture-side determinism so the
      // same prompt yields the same code (mirrors TM-70 judge config).
      temperature: resolveTemperature(),
      ...(seed !== undefined ? { seed } : {}),
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

    let openaiUsage:
      | { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
      | null = null;
    for await (const event of stream) {
      // The terminal usage chunk has empty `choices` and a populated `usage`.
      if (event.usage) openaiUsage = event.usage;
      const chunk = event.choices?.[0]?.delta?.content ?? '';
      if (!chunk) continue;
      markFirst();
      text += chunk;
      onDelta?.(chunk, text);
    }

    if (openaiUsage) {
      recordUsage({ provider: 'openai', model, usage: openaiUsage });
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
    // TM-72 — Anthropic does not currently expose a `seed` knob; pinning
    // temperature is sufficient to remove the dominant non-determinism
    // source on this path (mirrors capture-side determinism policy).
    temperature: resolveTemperature(),
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

  // TM-77 — pull final usage off the assembled message so spend.json gets
  // an authoritative input/output/cache token count for this call.
  try {
    const final = await stream.finalMessage();
    if (final?.usage) {
      recordUsage({
        provider: 'anthropic',
        model,
        usage: {
          input_tokens: final.usage.input_tokens,
          output_tokens: final.usage.output_tokens,
          cache_creation_input_tokens: final.usage.cache_creation_input_tokens ?? 0,
          cache_read_input_tokens: final.usage.cache_read_input_tokens ?? 0,
        },
      });
    }
  } catch {
    // ignore — cost ledger never blocks the request path
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
