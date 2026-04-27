/**
 * TM-41 — AI generate E2E QA harness (Jest driver).
 *
 * Drives `generateAsset()` directly (auth-bypass, in-process) over the
 * 50 BENCHMARK_PROMPTS from TM-3 and measures:
 *   - response shape correctness
 *   - PARAMS extraction (ADR-0002)
 *   - evaluator-friendliness (validateCode + transpileTSX inside generateAsset)
 *   - first-frame-time (wall ms from generateAsset start to asset return)
 *
 * Skipped unless TM41=1 set. Live API calls — costs real $.
 *
 * Run:
 *   AI_PROVIDER=openai TM41=1 npx jest __tests__/qa/tm-41-e2e.test.ts \
 *     --testTimeout=600000 --runInBand
 */

import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Load .env.local manually (next/jest doesn't propagate it to process.env in node test env).
const envPath = resolve(__dirname, '../../.env.local');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    const [, k, vRaw] = m;
    let v = vRaw.trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

import { BENCHMARK_PROMPTS, type BenchmarkPrompt } from '../benchmarks/params-extraction.benchmark';
import { generateAsset } from '../../src/lib/ai/generate';
import { getModels } from '../../src/lib/ai/client';
import { extractParameters } from '../../src/lib/ai/extract-params';
import { validateCode } from '../../src/lib/remotion/sandbox';

interface PromptResult {
  id: string;
  category: string;
  prompt: string;
  tier: 'FREE' | 'PRO';
  model: string;
  ok: boolean;
  type?: 'generate' | 'clarify';
  ms: number;
  error?: string;
  has_params_const?: boolean;
  params_count?: number;
  validate_ok?: boolean;
  validate_errors?: string[];
  has_jsCode?: boolean;
  duration_in_frames?: number;
  fps?: number;
  width?: number;
  height?: number;
  title?: string;
  code_length?: number;
}

async function runOne(
  p: BenchmarkPrompt,
  tier: 'FREE' | 'PRO',
  model: string,
): Promise<PromptResult> {
  const start = Date.now();
  try {
    const result = await generateAsset(p.prompt, model);
    const ms = Date.now() - start;

    if (result.type === 'clarify') {
      return {
        id: p.id, category: p.category, prompt: p.prompt, tier, model,
        ok: false, type: 'clarify', ms,
        error: 'AI returned clarify mode (no asset)',
      };
    }

    const asset = result.asset;
    const code = asset.code ?? '';
    const has_params_const = /const\s+PARAMS\s*=/.test(code);
    const validation = validateCode(code);
    const params_count = extractParameters(code).length;

    const ok =
      has_params_const &&
      validation.valid &&
      typeof asset.jsCode === 'string' &&
      asset.jsCode.length > 0 &&
      params_count >= 1;

    return {
      id: p.id, category: p.category, prompt: p.prompt, tier, model,
      ok, type: 'generate', ms,
      has_params_const, params_count,
      validate_ok: validation.valid, validate_errors: validation.errors,
      has_jsCode: !!asset.jsCode,
      duration_in_frames: asset.durationInFrames,
      fps: asset.fps, width: asset.width, height: asset.height,
      title: asset.title, code_length: code.length,
    };
  } catch (e: unknown) {
    const ms = Date.now() - start;
    const error = e instanceof Error ? e.message : String(e);
    return {
      id: p.id, category: p.category, prompt: p.prompt, tier, model,
      ok: false, ms, error,
    };
  }
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function summarize(results: PromptResult[]) {
  const ms = results.map((r) => r.ms);
  const pass = results.filter((r) => r.ok).length;
  const clarify = results.filter((r) => r.type === 'clarify').length;
  const byTier: Record<string, { runs: number; pass: number; pass_rate: number; p50_ms: number }> = {};
  for (const t of ['FREE', 'PRO']) {
    const sub = results.filter((r) => r.tier === t);
    if (sub.length === 0) continue;
    byTier[t] = {
      runs: sub.length,
      pass: sub.filter((r) => r.ok).length,
      pass_rate: sub.length ? sub.filter((r) => r.ok).length / sub.length : 0,
      p50_ms: percentile(sub.map((r) => r.ms), 50),
    };
  }
  const byCat: Record<string, { runs: number; pass: number; pass_rate: number }> = {};
  for (const r of results) {
    byCat[r.category] ??= { runs: 0, pass: 0, pass_rate: 0 };
    byCat[r.category].runs++;
    if (r.ok) byCat[r.category].pass++;
  }
  for (const k of Object.keys(byCat)) {
    byCat[k].pass_rate = byCat[k].runs ? byCat[k].pass / byCat[k].runs : 0;
  }
  return {
    generated_at: new Date().toISOString(),
    ai_provider: process.env.AI_PROVIDER ?? 'anthropic',
    totals: {
      runs: results.length,
      pass,
      fail: results.length - pass,
      pass_rate: results.length ? pass / results.length : 0,
      clarify_count: clarify,
    },
    timings_ms: {
      p50: percentile(ms, 50),
      p90: percentile(ms, 90),
      p95: percentile(ms, 95),
      min: ms.length ? Math.min(...ms) : 0,
      max: ms.length ? Math.max(...ms) : 0,
      avg: ms.length ? ms.reduce((s, v) => s + v, 0) / ms.length : 0,
    },
    by_tier: byTier,
    by_category: byCat,
    failures: results.filter((r) => !r.ok),
  };
}

const ENABLED = process.env.TM41 === '1';
const describeFn = ENABLED ? describe : describe.skip;

describeFn('TM-41 AI generate E2E', () => {
  it('runs benchmark against generateAsset()', async () => {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('Missing OPENAI_API_KEY');
    }
    const tierArg = (process.env.TM41_TIER ?? 'BOTH').toUpperCase();
    const limit = parseInt(process.env.TM41_LIMIT ?? '0', 10);
    const concurrency = parseInt(process.env.TM41_CONCURRENCY ?? '4', 10);
    const proSampleSize = parseInt(process.env.TM41_PRO_SAMPLE ?? '10', 10);

    const models = getModels();
    const prompts: BenchmarkPrompt[] = limit > 0 ? BENCHMARK_PROMPTS.slice(0, limit) : BENCHMARK_PROMPTS;

    const jobs: Array<{ p: BenchmarkPrompt; tier: 'FREE' | 'PRO'; model: string }> = [];
    if (tierArg === 'FREE' || tierArg === 'BOTH') {
      for (const p of prompts) jobs.push({ p, tier: 'FREE', model: models.free });
    }
    if (tierArg === 'PRO' || tierArg === 'BOTH') {
      const byCat = new Map<string, BenchmarkPrompt[]>();
      for (const p of prompts) {
        const arr = byCat.get(p.category) ?? [];
        arr.push(p);
        byCat.set(p.category, arr);
      }
      const perCat = Math.max(1, Math.floor(proSampleSize / Math.max(1, byCat.size)));
      for (const [, arr] of byCat) {
        for (const p of arr.slice(0, perCat)) jobs.push({ p, tier: 'PRO', model: models.pro });
      }
    }

    // eslint-disable-next-line no-console
    console.log(
      `[TM-41] running ${jobs.length} jobs (FREE=${models.free} PRO=${models.pro}) concurrency=${concurrency}`,
    );

    const results: PromptResult[] = [];
    let next = 0;
    async function worker(id: number) {
      while (true) {
        const i = next++;
        if (i >= jobs.length) return;
        const job = jobs[i];
        const r = await runOne(job.p, job.tier, job.model);
        results.push(r);
        const tag = r.ok ? 'PASS' : r.type === 'clarify' ? 'CLAR' : 'FAIL';
        // eslint-disable-next-line no-console
        console.log(
          `[w${id}] ${String(i + 1).padStart(3)}/${jobs.length} ${r.tier} ${r.id} ${tag} ${r.ms}ms${r.error ? ' :: ' + r.error.slice(0, 100) : ''}`,
        );
      }
    }
    await Promise.all(Array.from({ length: concurrency }, (_, i) => worker(i + 1)));

    results.sort((a, b) => (a.tier + a.id).localeCompare(b.tier + b.id));
    const summary = summarize(results);

    const outDir = resolve(__dirname, 'results');
    mkdirSync(outDir, { recursive: true });
    const outPath = resolve(outDir, 'tm-41-results.json');
    writeFileSync(outPath, JSON.stringify({ summary, results }, null, 2));
    // eslint-disable-next-line no-console
    console.log(`\n[TM-41] wrote ${outPath}`);
    // eslint-disable-next-line no-console
    console.log(
      `[TM-41] pass_rate=${(summary.totals.pass_rate * 100).toFixed(1)}% p50=${summary.timings_ms.p50}ms fails=${summary.totals.fail}`,
    );

    // Don't fail the jest run on acceptance breach — QA workflow records bugs as separate tasks.
    expect(results.length).toBeGreaterThan(0);
  }, 30 * 60 * 1000);
});
