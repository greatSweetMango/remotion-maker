/**
 * TM-120 — RCA v3.
 *
 * Findings so far:
 *   - 0% pure-fallback rate across 13 prompts in v1+v2.
 *   - But retry #1 fires on ~38% (3/8) of "tricky subject" prompts; root cause
 *     is the model leaving SKELETON COMMENTS verbatim from the system prompt:
 *       "// Complete TSX code here"
 *       "// ... all params"
 *       "// animation logic"
 *       "{/* component content *\/}"
 *   - This skeleton-leak is a system-prompt construction bug — those literal
 *     strings appear in GENERATION_SYSTEM_PROMPT as templates and the model
 *     copies them back. detectPlaceholderCode catches them, but they should
 *     not be there in the first place.
 *
 * v3 hunts for true 3-strike fallback by running each "tricky subject" prompt
 * 5 times (stochastic — gpt-4o-mini variance) to see if any path 3-strikes.
 */
import { config as loadDotenv } from 'dotenv';
loadDotenv({ path: '.env.local' });
loadDotenv();
import fs from 'node:fs';
import path from 'node:path';
import { generateAsset } from '@/lib/ai/generate';

const TRICKY_PROMPTS = [
  '픽셀아트 곰돌이가 걷는 애니메이션',
  'low-poly 3D dragon flying through clouds',
  'astronaut floating in space, minimalist line art, slow zoom',
  'silhouette dancer moving to music, neon background',
  '실루엣 사람이 춤추는, 네온 배경, 5초',
];

const RUNS_PER_PROMPT = 3;

interface Trace {
  prompt: string;
  run: number;
  outcome: string;
  retry_count: number;
  fallback_fired: boolean;
  wall_ms: number;
  warns_short: string[];
}

function capture() {
  const lines: string[] = [];
  const orig = console.warn;
  console.warn = (...args: unknown[]) => {
    const s = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    lines.push(s);
  };
  return { restore: () => { console.warn = orig; }, get: () => lines.slice() };
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
  }
  return { retry_count, fallback_fired };
}

async function runOne(prompt: string, run: number): Promise<Trace> {
  const cap = capture();
  const start = Date.now();
  let outcome = 'unknown';
  try {
    const r = await generateAsset(prompt);
    if (r.type === 'clarify') outcome = `clarify(${r.questions.length}q)`;
    else if (r.warning) outcome = `fallback(${r.asset.code.length})`;
    else outcome = `generate(${r.asset.code.length})`;
  } catch (e) {
    outcome = `error:${e instanceof Error ? e.message : String(e)}`;
  }
  cap.restore();
  const warns = cap.get();
  const stats = deriveRetryStats(warns);
  return {
    prompt,
    run,
    outcome,
    retry_count: stats.retry_count,
    fallback_fired: stats.fallback_fired,
    wall_ms: Date.now() - start,
    warns_short: warns
      .filter((l) => /placeholder|fallback|RAG hit|over-trigger/.test(l))
      .map((l) => l.slice(0, 240)),
  };
}

async function main() {
  const startedAt = new Date().toISOString();
  const traces: Trace[] = [];
  for (const prompt of TRICKY_PROMPTS) {
    for (let run = 1; run <= RUNS_PER_PROMPT; run++) {
      process.stdout.write(`\n[${prompt}] run ${run}/${RUNS_PER_PROMPT}\n`);
      const t = await runOne(prompt, run);
      traces.push(t);
      process.stdout.write(
        `  → ${t.outcome} retries=${t.retry_count} fb=${t.fallback_fired} ${t.wall_ms}ms\n`,
      );
      for (const w of t.warns_short) process.stdout.write(`    ${w}\n`);
    }
  }

  const fbCount = traces.filter((t) => t.fallback_fired).length;
  const retryCount = traces.filter((t) => t.retry_count > 0).length;
  const total = traces.length;
  const summary = {
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    total,
    fallback_count: fbCount,
    fallback_rate_pct: (fbCount / total) * 100,
    retry_fired_count: retryCount,
    retry_fired_rate_pct: (retryCount / total) * 100,
    traces,
  };
  const outDir = path.join(process.cwd(), '.agent-state');
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = path.join(outDir, `tm-120-rca-v3-${stamp}.json`);
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));
  process.stdout.write(
    `\nSUMMARY: ${total} runs; fallback=${fbCount} (${((fbCount / total) * 100).toFixed(1)}%); retry-fired=${retryCount} (${((retryCount / total) * 100).toFixed(1)}%)\nReport: ${outPath}\n`,
  );
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
