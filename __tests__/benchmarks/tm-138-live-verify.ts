/**
 * TM-138 — live verification of the vision-guided self-critique loop.
 *
 * Runs the user's TM-135 reference prompt through asset-gen + judge with
 * real OpenAI calls, then runs a forced-fail variant (threshold=99) to
 * exercise the regen path. Cost cap: $0.30.
 *
 * Usage:
 *   OPENAI_API_KEY=... npx tsx __tests__/benchmarks/tm-138-live-verify.ts
 */
import * as path from 'path';
import * as dotenv from 'dotenv';
import { promises as fs } from 'node:fs';

dotenv.config({ path: path.join(__dirname, '..', '..', '.env.local') });

import { runAssetGenStage } from '../../src/lib/ai/asset-gen-stage';
import { judgeAndMaybeRegenerate } from '../../src/lib/ai/self-critique';

const PROMPT = '곰돌이가 초원을 걸어가는 약 10초분량의 횡스크롤 애니메이션 만들어줘';
const ANSWERS = { bear_style: 'cartoon', color_palette: 'warm' };

async function main() {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY required');

  const t0 = Date.now();
  const stage = await runAssetGenStage({ prompt: PROMPT, answers: ANSWERS });
  if (!stage) throw new Error('asset-gen returned null (no living-entity hit?)');
  const stageMs = Date.now() - t0;
  console.log(`[asset-gen] cached=${stage.cached} cost=$${stage.costUsd.toFixed(3)} latency=${stageMs}ms hash=${stage.hash.slice(0, 12)}`);
  const diskPath = path.join(process.cwd(), 'public', 'uploads', 'asset-gen', `${stage.hash}.png`);
  const stat = await fs.stat(diskPath);
  console.log(`[asset-gen] PNG persisted ${stat.size} bytes at ${diskPath}`);

  // ----- Test 1: default threshold (70). Expected happy path = no retry. -----
  console.log('\n[test 1] default threshold=70 (expect no retry on a normal cartoon bear)');
  const t1 = Date.now();
  const r1 = await judgeAndMaybeRegenerate({
    prompt: PROMPT,
    answers: ANSWERS,
    initial: stage,
    initialDiskPath: diskPath,
    threshold: 70,
    maxRetry: 1,
  });
  const t1Ms = Date.now() - t1;
  console.log(`  scores=${JSON.stringify(r1.scores)} retried=${r1.retried} extraCost=$${r1.extraCostUsd.toFixed(3)} latency=${t1Ms}ms`);
  console.log(`  reasoning[0]: "${r1.reasoning[0]?.slice(0, 200) ?? ''}"`);
  console.log(`  chosen.hash=${r1.chosen.hash.slice(0, 16)}`);

  // ----- Test 2: forced threshold=99 → MUST regen, exercise full loop -----
  console.log('\n[test 2] threshold=99 (forces regen path)');
  const t2 = Date.now();
  const r2 = await judgeAndMaybeRegenerate({
    prompt: PROMPT,
    answers: ANSWERS,
    initial: stage,
    initialDiskPath: diskPath,
    threshold: 99,
    maxRetry: 1,
  });
  const t2Ms = Date.now() - t2;
  console.log(`  scores=${JSON.stringify(r2.scores)} retried=${r2.retried} extraCost=$${r2.extraCostUsd.toFixed(3)} latency=${t2Ms}ms`);
  console.log(`  reasoning: ${r2.reasoning.map(s => `"${s.slice(0, 120)}"`).join(' | ')}`);
  console.log(`  chosen.hash=${r2.chosen.hash.slice(0, 24)}`);

  const totalSpend = stage.costUsd + r1.extraCostUsd + r2.extraCostUsd;
  console.log(`\n[summary] total live spend = $${totalSpend.toFixed(3)} (cap $0.30)`);
  if (totalSpend > 0.30) {
    console.error('  ⚠️ exceeded cost cap');
    process.exit(2);
  }

  // Emit results JSON for the retro report.
  const outDir = path.join(__dirname, 'results', 'tm-138');
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, 'live-verify.json');
  await fs.writeFile(outPath, JSON.stringify({
    ran_at: new Date().toISOString(),
    prompt: PROMPT,
    answers: ANSWERS,
    asset_gen: { cached: stage.cached, cost_usd: stage.costUsd, latency_ms: stageMs, hash: stage.hash },
    test1_default_threshold: { scores: r1.scores, retried: r1.retried, extra_cost: r1.extraCostUsd, latency_ms: t1Ms, reasoning: r1.reasoning },
    test2_forced_regen: { scores: r2.scores, retried: r2.retried, extra_cost: r2.extraCostUsd, latency_ms: t2Ms, reasoning: r2.reasoning },
    total_spend_usd: totalSpend,
  }, null, 2));
  console.log(`[done] wrote ${outPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
