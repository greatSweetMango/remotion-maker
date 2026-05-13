/**
 * TM-120 — Placeholder fallback RCA harness.
 *
 * Runs a 5-prompt corpus through `generateAsset` against the live LLM (OpenAI).
 * For each prompt we capture:
 *   - Final result type (clarify | generate | fallback warning | thrown error)
 *   - If placeholder retries fired: console.warn log lines
 *   - Wall time, approximate cost
 *
 * Output: writes a JSON report to `.agent-state/tm-120-rca-<timestamp>.json`
 * AND prints a per-prompt summary table.
 *
 * Run:  npx tsx scripts/tm-120-rca.ts
 * Cost: ~$0.5-1.0 depending on retry depth (5 prompts × up to 3 retries × ~2k tokens).
 */
import { config as loadDotenv } from 'dotenv';
loadDotenv({ path: '.env.local' });
loadDotenv();
import fs from 'node:fs';
import path from 'node:path';
import { generateAsset } from '@/lib/ai/generate';

const CORPUS = [
  { id: 'short', prompt: '안녕' },
  { id: 'living-no-style', prompt: '곰돌이' },
  { id: 'vague-ko', prompt: '예쁜 거' },
  { id: 'vague-en', prompt: 'make something cool' },
  { id: 'motion-gfx', prompt: '타이틀 영상 16:9, 30fps' },
];

interface AttemptTrace {
  prompt_id: string;
  prompt: string;
  start_ms: number;
  end_ms: number;
  wall_ms: number;
  console_warns: string[];
  outcome:
    | { kind: 'clarify'; questionCount: number }
    | { kind: 'generate'; codeLength: number; title?: string }
    | { kind: 'fallback'; warning: string; codeLength: number }
    | { kind: 'error'; message: string };
  // RCA-derived
  retry_count: number;      // how many retries fired (0-3)
  fallback_fired: boolean;
}

function captureConsoleWarn(): { restore: () => void; getLines: () => string[] } {
  const lines: string[] = [];
  const orig = console.warn;
  console.warn = (...args: unknown[]) => {
    const s = args
      .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
      .join(' ');
    lines.push(s);
    // also tee to real stderr so we can watch live
    process.stderr.write('[warn] ' + s + '\n');
  };
  return {
    restore: () => {
      console.warn = orig;
    },
    getLines: () => lines.slice(),
  };
}

function deriveRetryStats(warns: string[]): { retry_count: number; fallback_fired: boolean } {
  let retry_count = 0;
  let fallback_fired = false;
  for (const line of warns) {
    if (/placeholder detected, retry #1\/2/.test(line)) retry_count = Math.max(retry_count, 1);
    if (/placeholder detected, retry #2\/2/.test(line)) retry_count = Math.max(retry_count, 2);
    if (/placeholder x3, returning fallback asset/.test(line)) {
      retry_count = 3;
      fallback_fired = true;
    }
    if (/strict retry transpile failure, falling back/.test(line)) {
      fallback_fired = true;
    }
  }
  return { retry_count, fallback_fired };
}

async function runOne(item: { id: string; prompt: string }): Promise<AttemptTrace> {
  const cap = captureConsoleWarn();
  const start = Date.now();
  let outcome: AttemptTrace['outcome'];
  try {
    const r = await generateAsset(item.prompt);
    if (r.type === 'clarify') {
      outcome = { kind: 'clarify', questionCount: r.questions.length };
    } else if (r.warning) {
      outcome = {
        kind: 'fallback',
        warning: r.warning,
        codeLength: r.asset.code.length,
      };
    } else {
      outcome = {
        kind: 'generate',
        codeLength: r.asset.code.length,
        title: r.asset.title,
      };
    }
  } catch (err) {
    outcome = {
      kind: 'error',
      message: err instanceof Error ? err.message : String(err),
    };
  }
  const end = Date.now();
  cap.restore();
  const warns = cap.getLines();
  const stats = deriveRetryStats(warns);
  return {
    prompt_id: item.id,
    prompt: item.prompt,
    start_ms: start,
    end_ms: end,
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
    const t = await runOne(item);
    traces.push(t);
    process.stdout.write(
      `  → outcome: ${JSON.stringify(t.outcome)}  retries=${t.retry_count}  fallback=${t.fallback_fired}  ${t.wall_ms}ms\n`,
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
  const outPath = path.join(outDir, `tm-120-rca-${stamp}.json`);
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));
  process.stdout.write(`\n\nSUMMARY: fallback=${fallbackCount}/${CORPUS.length} (${fallbackRate.toFixed(1)}%), errors=${errorCount}\n`);
  process.stdout.write(`Report: ${outPath}\n`);
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
