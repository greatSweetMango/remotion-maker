/**
 * TM-84 — asset-gen spike (ADR-0022 option B).
 *
 * Thin wrapper around OpenAI's Images API (`gpt-image-1`) so the multi-step
 * generate pipeline can produce character / scene PNGs and surface them via
 * the PARAMS `imageUrl` convention (ADR-0002).
 *
 * SCOPE (TM-84 spike only):
 * - Single function `generateAssetImage(prompt)` → PNG bytes + data URL +
 *   cost/latency telemetry.
 * - No R2, no persistent cache. Caller decides how to persist (local disk
 *   in the spike, R2 in a follow-up task — see ADR-0022 "결정 → Caching").
 * - Cost cap enforced at the call site (`scripts/qa/tm-84-spike.mjs`),
 *   not here, so unit tests stay deterministic.
 */
import OpenAI from 'openai';
import { recordMark, isLatencyProfileEnabled } from './latency-profile';

/**
 * gpt-image-1 standard 1024x1024 price (USD/image), per OpenAI pricing as
 * of 2026-05. Kept as a module constant so spike telemetry can report a
 * single source of truth. Update with a tech-note if pricing changes.
 */
export const GPT_IMAGE_1_PRICE_USD_1024 = 0.04;

export interface GenerateAssetImageOptions {
  prompt: string;
  /** Image size — gpt-image-1 supports 1024x1024 / 1024x1536 / 1536x1024. */
  size?: '1024x1024' | '1024x1536' | '1536x1024';
  /** Quality knob exposed by gpt-image-1. */
  quality?: 'low' | 'medium' | 'high';
  /** Optional OpenAI client override — primarily for tests. */
  client?: OpenAI;
  /** TM-156 — request id passthrough for structured latency marks. */
  __latencyReqId?: string;
}

export interface GenerateAssetImageResult {
  /** Raw PNG bytes (decoded from b64_json). */
  pngBytes: Buffer;
  /** `data:image/png;base64,...` form for direct PARAMS.imageUrl use. */
  dataUrl: string;
  /** Estimated cost for this single call (USD). */
  costUsd: number;
  /** Wall-clock latency in ms (request → response decoded). */
  latencyMs: number;
  /** Echoed back for downstream caching keys. */
  prompt: string;
  size: string;
  quality: string;
}

/**
 * Generate a single PNG asset via OpenAI gpt-image-1.
 *
 * Throws if `OPENAI_API_KEY` is missing or the API call fails. Callers are
 * expected to handle the error and decide whether to fall back (see
 * ADR-0022 hybrid plan — option A catalog).
 */
export async function generateAssetImage(
  opts: GenerateAssetImageOptions,
): Promise<GenerateAssetImageResult> {
  const { prompt } = opts;
  const size = opts.size ?? '1024x1024';
  const quality = opts.quality ?? 'low'; // spike → cheapest tier

  if (!prompt || prompt.trim().length === 0) {
    throw new Error('asset-gen: prompt must be a non-empty string');
  }

  // TM-156 — split gpt-image-1 phases. The single previously-recorded
  // `latencyMs` lumped together OpenAI client construction, the HTTP
  // round-trip (which is the actual "wire" cost), and base64 decode of a
  // ~1MB PNG. Splitting them lets the RCA tell whether the prod tail is
  // network-bound or decode-bound.
  const reqId = opts.__latencyReqId ?? 'no-req';
  const profileOn = isLatencyProfileEnabled();

  const clientStart = Date.now();
  const client = opts.client ?? new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  if (profileOn) recordMark({ req: reqId, phase: 'asset-gen.client-init', ms: Date.now() - clientStart });

  const wireStart = Date.now();
  const start = wireStart;
  const resp = await client.images.generate({
    model: 'gpt-image-1',
    prompt,
    size,
    n: 1,
    // gpt-image-1 returns base64 by default; explicit for clarity.
  });
  const wireMs = Date.now() - wireStart;
  if (profileOn) recordMark({
    req: reqId,
    phase: 'asset-gen.openai-wire',
    ms: wireMs,
    meta: { size, quality, promptChars: prompt.length },
  });
  const latencyMs = Date.now() - start;

  const data = resp.data?.[0];
  if (!data?.b64_json) {
    throw new Error('asset-gen: OpenAI response missing b64_json payload');
  }

  const decodeStart = Date.now();
  const pngBytes = Buffer.from(data.b64_json, 'base64');
  const dataUrl = `data:image/png;base64,${data.b64_json}`;
  if (profileOn) recordMark({
    req: reqId,
    phase: 'asset-gen.decode',
    ms: Date.now() - decodeStart,
    meta: { pngBytes: pngBytes.length, b64Chars: data.b64_json.length },
  });

  return {
    pngBytes,
    dataUrl,
    costUsd: GPT_IMAGE_1_PRICE_USD_1024,
    latencyMs,
    prompt,
    size,
    quality,
  };
}
