#!/usr/bin/env node
/**
 * TM-102 — Live smoke comparing single-shot generateAsset vs the new
 * multi-step pipeline on 5 baseline prompts.
 *
 * Requires: ANTHROPIC_API_KEY or OPENAI_API_KEY in env. Costs ~$2 on
 * Claude Sonnet (5 prompts × 2 paths × 5 scene-calls average).
 *
 * Usage:
 *   AI_PROVIDER=anthropic node scripts/qa/tm-102-live-baseline.mjs
 *   AI_PROVIDER=openai    node scripts/qa/tm-102-live-baseline.mjs
 *
 * The script ONLY measures objective signals — code length, transpile
 * success, scene count, total wall-ms — not the visual judge (TM-46).
 * The bench gate decision lives in TM-46 r7.
 */

import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

// Allow tsx-import via tsx loader if available; otherwise fall back to a
// helpful error so the user knows what to install.
try {
  register('tsx/esm', pathToFileURL('./'));
} catch {
  console.error('[tm-102-live] tsx loader not available. Run via: npx tsx scripts/qa/tm-102-live-baseline.mjs');
}

const PROMPTS = [
  '매출 차트 [120, 150, 180, 200, 240, 280] 보라색 톤',
  'Animated counter 0 to 100, neon cyan, 3 seconds',
  'Slide transition left to right, two colored panels purple → pink',
  '타이핑 효과 Hello World, 모노스페이스 폰트',
  '심플한 로딩 스피너 8개 점',
];

async function main() {
  // Lazy import so tsx loader is registered first.
  const { generateAsset } = await import('../../src/lib/ai/generate.ts');
  const { getModels } = await import('../../src/lib/ai/client.ts');
  const model = getModels().pro;
  const results = [];
  for (const prompt of PROMPTS) {
    for (const flag of ['0', '1']) {
      process.env.AI_MULTI_STEP = flag;
      const t0 = Date.now();
      let ok = false;
      let codeLen = 0;
      let warning = null;
      let err = null;
      try {
        const r = await generateAsset(prompt, model);
        ok = true;
        if (r.type === 'generate') {
          codeLen = r.asset.code.length;
          warning = r.warning ?? null;
        }
      } catch (e) {
        err = e instanceof Error ? e.message : String(e);
      }
      const ms = Date.now() - t0;
      const row = {
        prompt: prompt.slice(0, 40),
        mode: flag === '1' ? 'multi-step' : 'single-shot',
        ok,
        codeLen,
        ms,
        warning,
        err,
      };
      results.push(row);
      console.log(JSON.stringify(row));
    }
  }
  console.log('\n----- SUMMARY -----');
  const byMode = (m) => results.filter((r) => r.mode === m && r.ok);
  for (const m of ['single-shot', 'multi-step']) {
    const rows = byMode(m);
    const okCount = rows.length;
    const meanLen = rows.reduce((a, b) => a + b.codeLen, 0) / Math.max(1, okCount);
    const meanMs = rows.reduce((a, b) => a + b.ms, 0) / Math.max(1, okCount);
    console.log(
      `${m.padEnd(12)} ok=${okCount}/${PROMPTS.length}  meanCodeLen=${Math.round(meanLen)}  meanMs=${Math.round(meanMs)}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
