/**
 * TM-120 — Placeholder fallback RCA harness v2.
 *
 * v1 (clarify-eligible vague prompts) showed 0% fallback because the model
 * correctly elected clarify. To reproduce the user's error (post-clarify
 * generate path producing 3x placeholder → fallback) we now test:
 *
 *   A. Post-clarify path: supply `answers` to force mode=generate.
 *   B. Concrete-but-tricky prompts that bypass clarify but may stub.
 *   C. Living-entity prompts WITH style (must generate, may stub on hard subjects).
 *   D. Very long/complex prompts (might overwhelm small model).
 *
 * Output: .agent-state/tm-120-rca-v2-<timestamp>.json
 */
import { config as loadDotenv } from 'dotenv';
loadDotenv({ path: '.env.local' });
loadDotenv();
import fs from 'node:fs';
import path from 'node:path';
import { generateAsset } from '@/lib/ai/generate';
import type { ClarifyAnswers } from '@/types';

interface Item {
  id: string;
  prompt: string;
  answers?: ClarifyAnswers;
  note: string;
}

// Mix: clarify-bypass concrete prompts + post-clarify simulations.
// Goal: find prompts that route to generate and yet placeholder.
const CORPUS: Item[] = [
  // post-clarify simulations (force generate)
  {
    id: 'post-clarify-bear',
    prompt: '곰돌이',
    answers: { style: 'cartoon', mood: 'happy', palette: 'pastel' },
    note: 'living entity post-clarify; model must now generate concrete bear',
  },
  {
    id: 'post-clarify-vague',
    prompt: '예쁜 거',
    answers: { kind: 'logo-intro', duration: '2s' },
    note: 'vague KO post-clarify with thin context',
  },
  {
    id: 'post-clarify-empty',
    prompt: '안녕',
    answers: { kind: 'text' },
    note: 'super-short prompt + answers; model has almost nothing to work with',
  },
  // living entity with style (clarify-bypass)
  {
    id: 'pixel-bear',
    prompt: '픽셀아트 곰돌이가 걷는 애니메이션',
    note: 'living + style → must generate immediately',
  },
  {
    id: 'lowpoly-dragon',
    prompt: 'low-poly 3D dragon flying through clouds',
    note: 'living + style → generate',
  },
  // motion-graphics & data-viz (clarify-bypass)
  {
    id: 'kpi-counter',
    prompt: '실시간 KPI 카운터 124,500 매출, 보라색 그라데이션, 3초',
    note: 'concrete data-viz; expected generate',
  },
  {
    id: 'multi-element',
    prompt:
      '8개의 막대 차트, 매출/이익/사용자/광고비를 분기별로 비교, 다크모드, 매끄러운 spring 애니메이션',
    note: 'complex multi-entity data-viz',
  },
  {
    id: 'narrative-en',
    prompt: 'astronaut floating in space, minimalist line art, slow zoom',
    note: 'living with style hint',
  },
];

interface AttemptTrace {
  prompt_id: string;
  prompt: string;
  answers?: ClarifyAnswers;
  note: string;
  wall_ms: number;
  console_warns: string[];
  outcome:
    | { kind: 'clarify'; questionCount: number }
    | { kind: 'generate'; codeLength: number; title?: string }
    | { kind: 'fallback'; warning: string; codeLength: number }
    | { kind: 'error'; message: string };
  retry_count: number;
  fallback_fired: boolean;
}

function captureConsoleWarn() {
  const lines: string[] = [];
  const orig = console.warn;
  console.warn = (...args: unknown[]) => {
    const s = args
      .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
      .join(' ');
    lines.push(s);
    process.stderr.write('[warn] ' + s + '\n');
  };
  return {
    restore: () => {
      console.warn = orig;
    },
    getLines: () => lines.slice(),
  };
}

function deriveRetryStats(warns: string[]) {
  let retry_count = 0;
  let fallback_fired = false;
  for (const line of warns) {
    if (/placeholder detected, retry #1\/2/.test(line)) retry_count = Math.max(retry_count, 1);
    if (/placeholder detected, retry #2\/2/.test(line)) retry_count = Math.max(retry_count, 2);
    if (/placeholder x3, returning fallback asset/.test(line)) {
      retry_count = 3;
      fallback_fired = true;
    }
    if (/strict retry transpile failure, falling back/.test(line)) fallback_fired = true;
  }
  return { retry_count, fallback_fired };
}

async function runOne(item: Item): Promise<AttemptTrace> {
  const cap = captureConsoleWarn();
  const start = Date.now();
  let outcome: AttemptTrace['outcome'];
  try {
    const r = await generateAsset(item.prompt, undefined, { answers: item.answers });
    if (r.type === 'clarify') outcome = { kind: 'clarify', questionCount: r.questions.length };
    else if (r.warning)
      outcome = { kind: 'fallback', warning: r.warning, codeLength: r.asset.code.length };
    else outcome = { kind: 'generate', codeLength: r.asset.code.length, title: r.asset.title };
  } catch (err) {
    outcome = { kind: 'error', message: err instanceof Error ? err.message : String(err) };
  }
  const end = Date.now();
  cap.restore();
  const warns = cap.getLines();
  const stats = deriveRetryStats(warns);
  return {
    prompt_id: item.id,
    prompt: item.prompt,
    answers: item.answers,
    note: item.note,
    wall_ms: end - start,
    console_warns: warns,
    outcome,
    retry_count: stats.retry_count,
    fallback_fired: stats.fallback_fired,
  };
}

async function main() {
  const startedAt = new Date().toISOString();
  const traces: AttemptTrace[] = [];
  for (const item of CORPUS) {
    process.stdout.write(`\n=== [${item.id}] "${item.prompt}" ===\n`);
    if (item.answers) process.stdout.write(`    answers: ${JSON.stringify(item.answers)}\n`);
    const t = await runOne(item);
    traces.push(t);
    process.stdout.write(
      `  → ${JSON.stringify(t.outcome)} retries=${t.retry_count} fallback=${t.fallback_fired} ${t.wall_ms}ms\n`,
    );
  }
  const fallbackCount = traces.filter((t) => t.fallback_fired).length;
  const fallbackRate = (fallbackCount / traces.length) * 100;
  const errorCount = traces.filter((t) => t.outcome.kind === 'error').length;
  const summary = {
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    corpus_size: CORPUS.length,
    fallback_count: fallbackCount,
    fallback_rate_pct: fallbackRate,
    error_count: errorCount,
    traces,
  };
  const outDir = path.join(process.cwd(), '.agent-state');
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = path.join(outDir, `tm-120-rca-v2-${stamp}.json`);
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));
  process.stdout.write(
    `\nSUMMARY: fallback=${fallbackCount}/${CORPUS.length} (${fallbackRate.toFixed(1)}%), errors=${errorCount}\nReport: ${outPath}\n`,
  );
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
