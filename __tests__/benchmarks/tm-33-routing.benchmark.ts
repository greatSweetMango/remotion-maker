/**
 * TM-33 — Routing & streaming benchmark.
 *
 * Hand-labeled complexity for the 50 BENCHMARK_PROMPTS from TM-3, plus a
 * driver that measures first-frame-time on a live Anthropic endpoint.
 *
 * Run live: ANTHROPIC_API_KEY=... npx tsx __tests__/benchmarks/tm-33-routing.benchmark.ts
 *
 * The label set was assigned by hand against this rubric:
 *   simple  — single visual element OR one short scene; no orchestration.
 *   complex — multiple slices/scenes/steps/items, charts with multiple
 *             series, races, comparisons, timelines, multi-line reveals.
 */

import { BENCHMARK_PROMPTS, type BenchmarkPrompt } from './params-extraction.benchmark';
import { classifyHeuristic, classifyPrompt } from '../../src/lib/ai/classify';
import { routePrompt } from '../../src/lib/ai/router';
import { streamComplete, parseProgressive } from '../../src/lib/ai/stream';
import { GENERATION_WITH_CLARIFY_SYSTEM_PROMPT } from '../../src/lib/ai/prompts';

export type ComplexityLabel = 'simple' | 'complex';

/** Hand-labeled ground truth for the 50 prompts. */
export const COMPLEXITY_LABELS: Record<string, ComplexityLabel> = {
  // data-viz — most are multi-series / multi-element → complex
  'dv-01': 'simple',
  'dv-02': 'complex',
  'dv-03': 'complex',
  'dv-04': 'simple',
  'dv-05': 'complex',
  'dv-06': 'simple',
  'dv-07': 'simple',
  'dv-08': 'complex',
  'dv-09': 'simple',
  'dv-10': 'simple',

  // text-anim — mostly single-element typography
  'ta-01': 'simple',
  'ta-02': 'simple',
  'ta-03': 'simple',
  'ta-04': 'complex', // word-by-word multi-stage reveal
  'ta-05': 'simple',
  'ta-06': 'simple',
  'ta-07': 'complex', // line-by-line reveal
  'ta-08': 'simple',
  'ta-09': 'complex', // 3-2-1-GO countdown sequence
  'ta-10': 'simple',

  // transition — single transition each → simple
  'tr-01': 'simple',
  'tr-02': 'simple',
  'tr-03': 'simple',
  'tr-04': 'simple',
  'tr-05': 'simple',
  'tr-06': 'simple',
  'tr-07': 'simple',
  'tr-08': 'simple',
  'tr-09': 'simple',
  'tr-10': 'simple',

  // loader — single element each → simple
  'ld-01': 'simple',
  'ld-02': 'simple',
  'ld-03': 'simple',
  'ld-04': 'simple',
  'ld-05': 'simple',
  'ld-06': 'simple',
  'ld-07': 'simple',
  'ld-08': 'simple',
  'ld-09': 'complex', // 4 sequential squares
  'ld-10': 'simple',

  // infographic — multi-step / multi-element → complex
  'ig-01': 'complex',
  'ig-02': 'complex',
  'ig-03': 'complex',
  'ig-04': 'complex',
  'ig-05': 'complex',
  'ig-06': 'simple',
  'ig-07': 'complex',
  'ig-08': 'complex',
  'ig-09': 'complex',
  'ig-10': 'simple',
};

if (Object.keys(COMPLEXITY_LABELS).length !== 50) {
  throw new Error(`Expected 50 labels, got ${Object.keys(COMPLEXITY_LABELS).length}`);
}

export interface RoutingMeasurement {
  id: string;
  prompt: string;
  label: ComplexityLabel;
  predicted: ComplexityLabel;
  classifierMs: number;
  classifierSource: 'heuristic' | 'haiku' | 'fallback';
  routedModel: string;
  streamed: boolean;
  firstFrameMs: number; // classifier + (first-token of generate)
  totalMs: number;
  ok: boolean;
  error?: string;
}

/**
 * Live measurement — performs real Anthropic calls. Skip if no API key.
 */
export async function measureRouting(
  prompts: BenchmarkPrompt[] = BENCHMARK_PROMPTS,
): Promise<RoutingMeasurement[]> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY required for live measurement');
  }
  const out: RoutingMeasurement[] = [];
  for (const p of prompts) {
    const start = Date.now();
    try {
      const decision = await routePrompt(p.prompt);
      let firstFrameMs = -1;
      let totalMs = 0;
      if (decision.streaming) {
        const r = await streamComplete({
          model: decision.model,
          system: GENERATION_WITH_CLARIFY_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: p.prompt }],
          maxTokens: 4096,
          onDelta: (_chunk, sofar) => {
            if (firstFrameMs < 0) {
              const headers = parseProgressive(sofar);
              if (headers.title || headers.mode) {
                firstFrameMs = decision.classifier.latencyMs + (Date.now() - start);
              }
            }
          },
        });
        if (firstFrameMs < 0) firstFrameMs = decision.classifier.latencyMs + r.firstTokenMs;
        totalMs = decision.classifier.latencyMs + r.totalMs;
      } else {
        // Non-streaming simple path: first-frame == total
        const { chatComplete } = await import('../../src/lib/ai/client');
        const t0 = Date.now();
        await chatComplete({
          model: decision.model,
          system: GENERATION_WITH_CLARIFY_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: p.prompt }],
          maxTokens: 4096,
        });
        totalMs = decision.classifier.latencyMs + (Date.now() - t0);
        firstFrameMs = totalMs;
      }
      out.push({
        id: p.id,
        prompt: p.prompt,
        label: COMPLEXITY_LABELS[p.id]!,
        predicted: decision.classifier.complexity,
        classifierMs: decision.classifier.latencyMs,
        classifierSource: decision.classifier.source,
        routedModel: decision.model,
        streamed: decision.streaming,
        firstFrameMs,
        totalMs,
        ok: true,
      });
    } catch (e) {
      out.push({
        id: p.id,
        prompt: p.prompt,
        label: COMPLEXITY_LABELS[p.id]!,
        predicted: 'complex',
        classifierMs: 0,
        classifierSource: 'fallback',
        routedModel: '',
        streamed: false,
        firstFrameMs: -1,
        totalMs: Date.now() - start,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return out;
}

export interface RoutingSummary {
  n: number;
  classifierAccuracy: number;
  meanFirstFrameMs: number;
  p50FirstFrameMs: number;
  p95FirstFrameMs: number;
  meanTotalMs: number;
  okRate: number;
  hypothesisMet: { firstFrameUnder2s: boolean; classifierAtLeast85: boolean };
}

export function summarize(rows: RoutingMeasurement[]): RoutingSummary {
  const ok = rows.filter((r) => r.ok && r.firstFrameMs >= 0);
  const correct = rows.filter((r) => r.predicted === r.label).length;
  const sorted = [...ok].sort((a, b) => a.firstFrameMs - b.firstFrameMs);
  const pick = (q: number) =>
    sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!.firstFrameMs;
  const meanFirst = ok.length === 0 ? 0 : ok.reduce((s, r) => s + r.firstFrameMs, 0) / ok.length;
  const meanTotal = ok.length === 0 ? 0 : ok.reduce((s, r) => s + r.totalMs, 0) / ok.length;
  const acc = rows.length === 0 ? 0 : correct / rows.length;
  return {
    n: rows.length,
    classifierAccuracy: acc,
    meanFirstFrameMs: meanFirst,
    p50FirstFrameMs: pick(0.5),
    p95FirstFrameMs: pick(0.95),
    meanTotalMs: meanTotal,
    okRate: rows.length === 0 ? 0 : ok.length / rows.length,
    hypothesisMet: {
      firstFrameUnder2s: meanFirst > 0 && meanFirst < 2000,
      classifierAtLeast85: acc >= 0.85,
    },
  };
}

/**
 * Heuristic-only dry run — no network. Useful in CI to gate classifier
 * accuracy regressions without spending API budget.
 */
export async function dryRunHeuristic(): Promise<{
  rows: { id: string; predicted: ComplexityLabel | 'unknown'; label: ComplexityLabel; source: string }[];
  resolvedAccuracy: number;
  coverage: number;
}> {
  const rows = BENCHMARK_PROMPTS.map((p) => {
    const h = classifyHeuristic(p.prompt);
    return {
      id: p.id,
      predicted: (h ? h.complexity : 'unknown') as ComplexityLabel | 'unknown',
      label: COMPLEXITY_LABELS[p.id]!,
      source: h ? h.source : 'ambiguous',
    };
  });
  const resolved = rows.filter((r) => r.predicted !== 'unknown');
  const correct = resolved.filter((r) => r.predicted === r.label).length;
  return {
    rows,
    resolvedAccuracy: resolved.length === 0 ? 0 : correct / resolved.length,
    coverage: resolved.length / rows.length,
  };
}

/**
 * Full classifier dry run (heuristic + Haiku for ambiguous middle).
 * Requires ANTHROPIC_API_KEY.
 */
export async function fullClassifierRun(): Promise<{
  rows: { id: string; predicted: ComplexityLabel; label: ComplexityLabel; source: string; ms: number }[];
  accuracy: number;
}> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY required');
  }
  const rows: { id: string; predicted: ComplexityLabel; label: ComplexityLabel; source: string; ms: number }[] = [];
  for (const p of BENCHMARK_PROMPTS) {
    const r = await classifyPrompt(p.prompt);
    rows.push({
      id: p.id,
      predicted: r.complexity,
      label: COMPLEXITY_LABELS[p.id]!,
      source: r.source,
      ms: r.latencyMs,
    });
  }
  const correct = rows.filter((r) => r.predicted === r.label).length;
  return { rows, accuracy: correct / rows.length };
}

// Allow `tsx` direct execution
if (require.main === module) {
  (async () => {
    if (process.env.ANTHROPIC_API_KEY) {
      console.log('[TM-33] Live measurement starting…');
      const rows = await measureRouting();
      const summary = summarize(rows);
      console.log(JSON.stringify({ summary, rows }, null, 2));
    } else {
      console.log('[TM-33] No API key — heuristic dry run only.');
      const r = await dryRunHeuristic();
      console.log(JSON.stringify(r, null, 2));
    }
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
