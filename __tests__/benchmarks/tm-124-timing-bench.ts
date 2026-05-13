/**
 * TM-124 — Multi-step vs single-shot timing bench.
 *
 * Runs the 5-prompt smoke corpus twice: once with AI_MULTI_STEP=1
 * (multi-step pipeline) and once with AI_MULTI_STEP=0 (single-shot),
 * recording per-prompt total wall-clock + (for multi-step) per-stage
 * timing. Writes a JSON report to __tests__/benchmarks/results/
 * tm-124-timing.json — the matching wiki report links to that file.
 *
 * Run:  npx tsx __tests__/benchmarks/tm-124-timing-bench.ts
 *
 * Cost: 5 prompts × 2 modes ≈ 10 live OpenAI calls
 *       (~$0.20 at gpt-4o, well within the TM-124 budget).
 */

import * as dotenv from 'dotenv';
import * as fs from 'fs/promises';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '..', '..', '.env.local') });

import { generateAssetMultiStep } from '../../src/lib/ai/pipeline';
import { generateAsset } from '../../src/lib/ai/generate';
import { TM46_SMOKE_PROMPTS } from './tm-46-prompts';
import type { PipelineTiming } from '../../src/types';

interface CaseRun {
  id: string;
  prompt: string;
  mode: 'multi-step' | 'single-shot';
  ok: boolean;
  totalMs: number;
  scenes: number;
  asset_gen_used: boolean;
  stages?: PipelineTiming['stages'];
  error?: string;
}

async function runMultiStep(prompt: string): Promise<Omit<CaseRun, 'id' | 'prompt' | 'mode'>> {
  const t0 = Date.now();
  try {
    const result = await generateAssetMultiStep(prompt, 'gpt-4o');
    return {
      ok: true,
      totalMs: Date.now() - t0,
      scenes: result.outline.scenes.length,
      asset_gen_used: result.assetGen != null,
      stages: result.timing.stages,
    };
  } catch (err) {
    return {
      ok: false,
      totalMs: Date.now() - t0,
      scenes: 0,
      asset_gen_used: false,
      error: err instanceof Error ? err.message.slice(0, 240) : String(err).slice(0, 240),
    };
  }
}

async function runSingleShot(prompt: string): Promise<Omit<CaseRun, 'id' | 'prompt' | 'mode'>> {
  const prev = process.env.AI_MULTI_STEP;
  process.env.AI_MULTI_STEP = '0';
  const t0 = Date.now();
  try {
    const result = await generateAsset(prompt, 'gpt-4o');
    return {
      ok: result.type === 'generate',
      totalMs: Date.now() - t0,
      scenes: 0,
      asset_gen_used: false,
    };
  } catch (err) {
    return {
      ok: false,
      totalMs: Date.now() - t0,
      scenes: 0,
      asset_gen_used: false,
      error: err instanceof Error ? err.message.slice(0, 240) : String(err).slice(0, 240),
    };
  } finally {
    if (prev === undefined) delete process.env.AI_MULTI_STEP;
    else process.env.AI_MULTI_STEP = prev;
  }
}

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error('[TM-124] OPENAI_API_KEY missing — abort.');
    process.exit(1);
  }
  console.warn(`[TM-124] timing bench — ${TM46_SMOKE_PROMPTS.length} prompts × 2 modes`);
  const runs: CaseRun[] = [];

  for (const c of TM46_SMOKE_PROMPTS) {
    console.warn(`\n=== ${c.id} (${c.category}) ===`);

    // Multi-step
    process.env.AI_MULTI_STEP = '1';
    const m = await runMultiStep(c.prompt);
    runs.push({ id: c.id, prompt: c.prompt, mode: 'multi-step', ...m });
    console.warn(
      `  multi-step  total=${m.totalMs}ms scenes=${m.scenes} assetGen=${m.asset_gen_used} ok=${m.ok}`,
    );
    if (m.stages) {
      for (const s of m.stages) console.warn(`    ${s.name}=${s.ms}ms`);
    }
    if (!m.ok) console.warn(`    ERR ${m.error}`);

    // Single-shot
    const s = await runSingleShot(c.prompt);
    runs.push({ id: c.id, prompt: c.prompt, mode: 'single-shot', ...s });
    console.warn(`  single-shot total=${s.totalMs}ms ok=${s.ok}`);
    if (!s.ok) console.warn(`    ERR ${s.error}`);
  }

  // Aggregate
  const multi = runs.filter((r) => r.mode === 'multi-step');
  const single = runs.filter((r) => r.mode === 'single-shot');
  const mean = (xs: number[]) => (xs.length === 0 ? 0 : Math.round(xs.reduce((a, b) => a + b, 0) / xs.length));
  const summary = {
    promptsRun: TM46_SMOKE_PROMPTS.length,
    multiStep: {
      okCount: multi.filter((r) => r.ok).length,
      meanMs: mean(multi.filter((r) => r.ok).map((r) => r.totalMs)),
      meanScenes: mean(multi.filter((r) => r.ok).map((r) => r.scenes)),
      assetGenHits: multi.filter((r) => r.asset_gen_used).length,
    },
    singleShot: {
      okCount: single.filter((r) => r.ok).length,
      meanMs: mean(single.filter((r) => r.ok).map((r) => r.totalMs)),
    },
  };
  console.warn('\n[TM-124] summary', JSON.stringify(summary, null, 2));

  const outDir = path.join(__dirname, 'results');
  await fs.mkdir(outDir, { recursive: true });
  const outFile = path.join(outDir, 'tm-124-timing.json');
  await fs.writeFile(
    outFile,
    JSON.stringify({ generatedAt: new Date().toISOString(), summary, runs }, null, 2),
  );
  console.warn(`[TM-124] wrote ${outFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
