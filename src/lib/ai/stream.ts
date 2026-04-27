import Anthropic from '@anthropic-ai/sdk';
import type { AIMessage } from './client';

/**
 * Streaming wrapper for Anthropic messages (TM-33).
 *
 * Surfaces token deltas + a `firstTokenMs` measurement so the caller
 * (route or bench harness) can report time-to-first-byte.
 *
 * The stream emits raw text deltas; the caller is responsible for
 * progressive JSON parsing (we expose `parseProgressive` for callers
 * that want to render structure-first).
 */

export interface StreamOptions {
  model: string;
  system: string;
  messages: AIMessage[];
  maxTokens?: number;
  client?: Anthropic;
  onDelta?: (chunk: string, sofar: string) => void;
}

export interface StreamResult {
  text: string;
  firstTokenMs: number;
  totalMs: number;
}

export async function streamComplete(opts: StreamOptions): Promise<StreamResult> {
  const start = Date.now();
  let firstTokenMs = -1;
  const client = opts.client ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const anthropicMessages = opts.messages.map((m) => {
    if (typeof m.content === 'string') return { role: m.role, content: m.content };
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
    model: opts.model,
    max_tokens: opts.maxTokens ?? 4096,
    system: opts.system,
    messages: anthropicMessages,
  });

  let text = '';
  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      const chunk = event.delta.text;
      if (firstTokenMs < 0) firstTokenMs = Date.now() - start;
      text += chunk;
      opts.onDelta?.(chunk, text);
    }
  }

  return {
    text,
    firstTokenMs: firstTokenMs < 0 ? Date.now() - start : firstTokenMs,
    totalMs: Date.now() - start,
  };
}

/**
 * Progressive JSON parser — best-effort extraction of partial fields
 * from a still-streaming Anthropic JSON response.
 *
 * Use case: we want to render the title + dimensions before the `code`
 * field finishes arriving. We scan for top-level `"key": value` pairs
 * where the value is a complete (closed) string or number literal.
 *
 * Safe to call on every delta — returns whatever it can see. Fields not
 * yet complete are simply absent.
 */
export function parseProgressive(text: string): Record<string, string | number | boolean> {
  const stripped = text.replace(/```(?:json)?\s*/g, '').replace(/```/g, '');
  const start = stripped.indexOf('{');
  if (start < 0) return {};
  const slice = stripped.slice(start);
  const out: Record<string, string | number | boolean> = {};

  // Match completed "key": "value" pairs at any depth-1 position.
  // We don't need a full parser — just enough for header fields.
  const pairRe = /"([a-zA-Z_][\w]*)"\s*:\s*("(?:[^"\\]|\\.)*"|true|false|-?\d+(?:\.\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = pairRe.exec(slice)) !== null) {
    const key = m[1];
    const raw = m[2];
    if (raw.startsWith('"')) {
      try {
        out[key] = JSON.parse(raw);
      } catch {
        // skip — likely an incomplete escape sequence on the boundary
      }
    } else if (raw === 'true' || raw === 'false') {
      out[key] = raw === 'true';
    } else {
      const n = Number(raw);
      if (Number.isFinite(n)) out[key] = n;
    }
  }
  return out;
}
