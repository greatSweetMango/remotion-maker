/**
 * TM-54 — first-frame latency benchmark.
 *
 * Drives `generateAsset()` over a fixed sample of 10 prompts and records
 * `firstTokenMs` (TTFB) + `totalMs` per call. Acceptance: p50 first-token
 * <= 5,000 ms, p50 total <= 6,000 ms (acceptance budget for AI-BUG fix).
 *
 * Skipped unless `TM54=1`. Live API calls — costs real $.
 *
 * Run:
 *   AI_PROVIDER=openai TM54=1 npx jest __tests__/qa/tm-54-latency.test.ts \
 *     --testTimeout=600000 --runInBand
 */

import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Mirror tm-41 — load .env.local manually (next/jest doesn't propagate it).
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

import { generateAsset } from '../../src/lib/ai/generate';
import { getModels } from '../../src/lib/ai/client';

interface Sample {
  id: string;
  prompt: string;
}

// 10 prompts spanning the same categories as TM-41 (data-viz, text-anim,
// transition, loader, infographic) — kept short to focus on TTFB rather
// than category-specific behaviour.
const SAMPLES: Sample[] = [
  { id: 'tm54-01', prompt: 'Animated counter from 0 to 100 with spring effect' },
  { id: 'tm54-02', prompt: 'Bar chart of monthly sales jan~jun, blue bars, axis labels' },
  { id: 'tm54-03', prompt: '"Hello World" 타이핑 효과, 모노스페이스 폰트' },
  { id: 'tm54-04', prompt: 'Slide transition from left to right between two solid colored panels' },
  { id: 'tm54-05', prompt: 'Circular spinner with 8 dots, blue, 1.5s loop' },
  { id: 'tm54-06', prompt: '도넛 차트 — 6:3:1 비율, 보라색 톤, 가운데 퍼센트 라벨' },
  { id: 'tm54-07', prompt: 'Comic book style "POW!" text bursting in with rotation' },
  { id: 'tm54-08', prompt: 'Fade to black and back, 1s each direction' },
  { id: 'tm54-09', prompt: 'Vertical progress loader 0~100% with gradient fill' },
  { id: 'tm54-10', prompt: '인포그래픽 — 3개 단계, 아이콘 + 짧은 설명, 페이드인' },
];

interface Run {
  id: string;
  prompt: string;
  tier: 'FREE' | 'PRO';
  model: string;
  ok: boolean;
  type?: 'generate' | 'clarify';
  firstTokenMs: number;
  totalMs: number;
  error?: string;
}

async function runOne(s: Sample, tier: 'FREE' | 'PRO', model: string): Promise<Run> {
  const start = Date.now();
  let firstTokenMs = -1;
  try {
    const result = await generateAsset(s.prompt, model, {
      onFirstToken: (ms) => {
        firstTokenMs = ms;
      },
    });
    const totalMs = Date.now() - start;
    return {
      id: s.id, prompt: s.prompt, tier, model,
      ok: result.type === 'generate',
      type: result.type,
      firstTokenMs,
      totalMs,
    };
  } catch (e: unknown) {
    return {
      id: s.id, prompt: s.prompt, tier, model,
      ok: false,
      firstTokenMs,
      totalMs: Date.now() - start,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

function p(values: number[], pct: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((pct / 100) * sorted.length))];
}

const ENABLED = process.env.TM54 === '1';
const describeFn = ENABLED ? describe : describe.skip;

describeFn('TM-54 first-frame latency', () => {
  it('measures firstTokenMs + totalMs across 10 prompts', async () => {
    if (!process.env.OPENAI_API_KEY && process.env.AI_PROVIDER !== 'anthropic') {
      throw new Error('Missing OPENAI_API_KEY');
    }
    const models = getModels();
    const tier = (process.env.TM54_TIER ?? 'FREE').toUpperCase() as 'FREE' | 'PRO';
    const model = tier === 'PRO' ? models.pro : models.free;
    const concurrency = parseInt(process.env.TM54_CONCURRENCY ?? '4', 10);

     
    console.log(`[TM-54] tier=${tier} model=${model} N=${SAMPLES.length} concurrency=${concurrency}`);

    const runs: Run[] = [];
    let next = 0;
    async function worker(id: number) {
      while (true) {
        const i = next++;
        if (i >= SAMPLES.length) return;
        const r = await runOne(SAMPLES[i], tier, model);
        runs.push(r);
         
        console.log(
          `[w${id}] ${i + 1}/${SAMPLES.length} ${r.id} ${r.ok ? 'OK ' : 'FAIL'} ttfb=${r.firstTokenMs}ms total=${r.totalMs}ms${r.error ? ' :: ' + r.error.slice(0, 100) : ''}`,
        );
      }
    }
    await Promise.all(Array.from({ length: concurrency }, (_, i) => worker(i + 1)));

    runs.sort((a, b) => a.id.localeCompare(b.id));

    const firsts = runs.filter((r) => r.firstTokenMs >= 0).map((r) => r.firstTokenMs);
    const totals = runs.map((r) => r.totalMs);
    const summary = {
      generated_at: new Date().toISOString(),
      ai_provider: process.env.AI_PROVIDER ?? 'anthropic',
      tier,
      model,
      n: runs.length,
      pass: runs.filter((r) => r.ok).length,
      first_token_ms: { p50: p(firsts, 50), p90: p(firsts, 90), p95: p(firsts, 95) },
      total_ms: { p50: p(totals, 50), p90: p(totals, 90), p95: p(totals, 95) },
    };

    const outDir = resolve(__dirname, 'results');
    mkdirSync(outDir, { recursive: true });
    const outPath = resolve(outDir, `tm-54-results-${tier.toLowerCase()}.json`);
    writeFileSync(outPath, JSON.stringify({ summary, runs }, null, 2));
     
    console.log(
      `\n[TM-54] wrote ${outPath}\n  ttfb p50=${summary.first_token_ms.p50}ms p95=${summary.first_token_ms.p95}ms\n  total p50=${summary.total_ms.p50}ms p95=${summary.total_ms.p95}ms`,
    );

    expect(runs.length).toBe(SAMPLES.length);
  }, 30 * 60 * 1000);
});
