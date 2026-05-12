#!/usr/bin/env node
/**
 * TM-92 — gpt-image-1 quality tier benchmark (low/medium/high).
 *
 * Goal: quantify the cost vs. quality trade-off across the three quality
 * tiers that `src/lib/ai/asset-gen.ts` already exposes. ADR-0022 baselined
 * cost at $0.04/asset (effectively `medium`); this run lets us update the
 * model with real numbers (low ≈ cheap-but-rough, high ≈ premium).
 *
 * Plan: 3 prompts × 3 tiers = 9 calls, all 1024x1024 square.
 *   - character  : 곰돌이 (motivating prompt from ADR-0022)
 *   - object     : 스마트폰
 *   - abstract   : 네온 카운트다운
 *
 * Budget: per-task cap $1.00. Estimated worst-case run cost ≈ $0.66 if all
 * pricing assumptions hold (3× ($0.011 + $0.042 + $0.167) ≈ $0.66). The
 * runtime guard halts before any call that would breach BUDGET_USD.
 *
 * Telemetry captured per call:
 *   - latency (ms)
 *   - PNG file size (bytes)
 *   - estimated cost from API usage tokens (preferred) or static table
 *     (fallback) if `usage` field is absent.
 *   - dimensions (always 1024x1024 here)
 *
 * Output:
 *   - 9 PNGs at .spike-assets/TM-92/<tier>/<prompt>.png
 *   - JSON summary at wiki/05-reports/screenshots/TM-92/bench-summary.json
 *   - Markdown report (separate writer in Phase C)
 *
 * Usage:
 *   OPENAI_API_KEY=... node scripts/qa/tm-92-image-tier-bench.mjs
 *   PROMPT_LIMIT=1 TIER_LIMIT=2 node scripts/qa/tm-92-image-tier-bench.mjs  # smoke
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import OpenAI from 'openai';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

// Load .env.local — mirrors TM-84.
const envPath = path.join(ROOT, '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

if (!process.env.OPENAI_API_KEY) {
  console.error('[TM-92] OPENAI_API_KEY missing — abort.');
  process.exit(1);
}

const ASSET_DIR = path.join(ROOT, '.spike-assets', 'TM-92');
fs.mkdirSync(ASSET_DIR, { recursive: true });

const REPORT_DIR = path.join(ROOT, 'wiki', '05-reports', 'screenshots', 'TM-92');
fs.mkdirSync(REPORT_DIR, { recursive: true });

const BUDGET_USD = Number(process.env.BUDGET_USD ?? '1.00');

// gpt-image-1 token pricing (USD per 1M tokens) — OpenAI pricing page 2025-Q4 / 2026-Q1.
// text input $5, image input $10, image output $40 (NOT cached).
const PRICE_TEXT_IN_PER_1M = 5;
const PRICE_IMAGE_IN_PER_1M = 10;
const PRICE_IMAGE_OUT_PER_1M = 40;

// Static fallback per-image pricing if `usage` is absent in response.
// These mirror OpenAI's published per-image table for 1024x1024 square.
const STATIC_PRICE = {
  low: 0.011,
  medium: 0.042,
  high: 0.167,
};

const TIERS = ['low', 'medium', 'high'].slice(0, Number(process.env.TIER_LIMIT ?? '3'));

const PROMPTS = [
  {
    id: 'character',
    label: 'bear-meadow',
    text: '귀여운 갈색 곰돌이 캐릭터, 밝은 동화책 일러스트, 부드러운 파스텔, 평면 도형, 중앙 정렬, 흰 배경 여백',
  },
  {
    id: 'object',
    label: 'smartphone-clean',
    text: '단순한 평면 스타일의 검정 스마트폰, 정면 뷰, 화면은 비어 있음(off), 그림자 약간, 흰 배경, 제품 아이콘 느낌',
  },
  {
    id: 'abstract',
    label: 'neon-countdown',
    text: '추상적 네온 카운트다운 비주얼, 큰 숫자 3, 보라+시안 글로우, 어두운 배경, 깊은 보케, 사이버펑크 분위기',
  },
].slice(0, Number(process.env.PROMPT_LIMIT ?? '3'));

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function priceFromUsage(usage, quality) {
  if (!usage) return null;
  const textIn = usage.input_tokens_details?.text_tokens ?? 0;
  const imgIn = usage.input_tokens_details?.image_tokens ?? 0;
  // gpt-image-1 reports `output_tokens` (image output tokens).
  const imgOut = usage.output_tokens ?? 0;
  const cost =
    (textIn * PRICE_TEXT_IN_PER_1M +
      imgIn * PRICE_IMAGE_IN_PER_1M +
      imgOut * PRICE_IMAGE_OUT_PER_1M) /
    1_000_000;
  return { cost, textIn, imgIn, imgOut };
}

const results = [];
let runningCostUsd = 0;

for (const tier of TIERS) {
  fs.mkdirSync(path.join(ASSET_DIR, tier), { recursive: true });
  for (const p of PROMPTS) {
    // pessimistic pre-call guard — use static price as upper bound.
    const guardEstimate = STATIC_PRICE[tier];
    if (runningCostUsd + guardEstimate > BUDGET_USD) {
      console.warn(
        `[TM-92] BUDGET GUARD tripped: $${runningCostUsd.toFixed(3)} + est $${guardEstimate} > cap $${BUDGET_USD}. STOP.`,
      );
      results.push({ tier, prompt: p.id, ok: false, skipped: true, reason: 'budget-cap' });
      continue;
    }

    console.log(`[TM-92] tier=${tier} prompt=${p.id} — calling gpt-image-1…`);
    const t0 = Date.now();
    let resp, latencyMs, errMsg;
    try {
      resp = await client.images.generate({
        model: 'gpt-image-1',
        prompt: p.text,
        size: '1024x1024',
        quality: tier,
        n: 1,
      });
      latencyMs = Date.now() - t0;
    } catch (err) {
      latencyMs = Date.now() - t0;
      errMsg = (err && err.message) || String(err);
      console.error(`[TM-92] FAIL tier=${tier} prompt=${p.id} ${latencyMs}ms: ${errMsg}`);
      results.push({ tier, prompt: p.id, ok: false, latencyMs, error: errMsg });
      continue;
    }

    const b64 = resp.data?.[0]?.b64_json;
    if (!b64) {
      results.push({ tier, prompt: p.id, ok: false, latencyMs, error: 'no b64_json' });
      continue;
    }
    const pngBytes = Buffer.from(b64, 'base64');
    const sizeBytes = pngBytes.length;
    const pngPath = path.join(ASSET_DIR, tier, `${p.id}-${p.label}.png`);
    fs.writeFileSync(pngPath, pngBytes);
    // mirror to report dir for the markdown.
    fs.copyFileSync(pngPath, path.join(REPORT_DIR, `${tier}-${p.id}-${p.label}.png`));

    const usageCost = priceFromUsage(resp.usage, tier);
    const costUsd = usageCost?.cost ?? STATIC_PRICE[tier];
    const costSource = usageCost ? 'usage-tokens' : 'static-table';
    runningCostUsd += costUsd;

    const sizeKb = Math.round(sizeBytes / 1024);
    console.log(
      `[TM-92] OK tier=${tier} prompt=${p.id} — ${sizeKb}KB, ${latencyMs}ms, $${costUsd.toFixed(4)} (${costSource}). running=$${runningCostUsd.toFixed(3)}`,
    );

    results.push({
      tier,
      prompt: p.id,
      promptLabel: p.label,
      promptText: p.text,
      ok: true,
      latencyMs,
      sizeBytes,
      sizeKb,
      dimensions: '1024x1024',
      costUsd,
      costSource,
      usage: resp.usage ?? null,
      usageBreakdown: usageCost ?? null,
      pngPath: path.relative(ROOT, pngPath),
    });
  }
}

// Aggregate matrices
function matrix(field) {
  const m = {};
  for (const t of TIERS) {
    m[t] = {};
    for (const p of PROMPTS) {
      const r = results.find((x) => x.tier === t && x.prompt === p.id && x.ok);
      m[t][p.id] = r ? r[field] : null;
    }
  }
  return m;
}

const summary = {
  task: 'TM-92',
  ts: new Date().toISOString(),
  budgetUsd: BUDGET_USD,
  runningCostUsd: Number(runningCostUsd.toFixed(4)),
  tiers: TIERS,
  prompts: PROMPTS.map((p) => ({ id: p.id, label: p.label, text: p.text })),
  callsAttempted: TIERS.length * PROMPTS.length,
  callsSucceeded: results.filter((r) => r.ok).length,
  costMatrixUsd: matrix('costUsd'),
  latencyMatrixMs: matrix('latencyMs'),
  sizeMatrixKb: matrix('sizeKb'),
  pricing: {
    note: 'cost preferred from API usage tokens; static-table fallback if usage missing',
    perTokenPer1M: {
      text_in: PRICE_TEXT_IN_PER_1M,
      image_in: PRICE_IMAGE_IN_PER_1M,
      image_out: PRICE_IMAGE_OUT_PER_1M,
    },
    staticTable: STATIC_PRICE,
  },
  results,
};

const summaryPath = path.join(REPORT_DIR, 'bench-summary.json');
fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
console.log(
  `[TM-92] DONE. cost=$${runningCostUsd.toFixed(3)} success=${summary.callsSucceeded}/${summary.callsAttempted}`,
);
console.log(`[TM-92] summary → ${path.relative(ROOT, summaryPath)}`);
