#!/usr/bin/env node
/**
 * TM-84 — asset-gen spike (ADR-0022 option B, live OpenAI calls).
 *
 * Validates the end-to-end story:
 *   1. POST a prompt → OpenAI gpt-image-1 returns a PNG (b64_json).
 *   2. Save PNG to .spike-assets/<hash>.png.
 *   3. Surface as a data: URL (mirrors what PARAMS.imageUrl would carry).
 *   4. Generate a tiny Remotion-compatible composition stub that references
 *      the data URL (paper test — we don't render the lambda in a spike).
 *
 * Budget: 1-3 calls, ≤ $0.20 total. The script halts after each call and
 * re-checks the running cost; if env BUDGET_USD is set, it's honored.
 *
 * Usage:
 *   OPENAI_API_KEY=... node scripts/qa/tm-84-spike.mjs
 *   PROMPT_LIMIT=1 node scripts/qa/tm-84-spike.mjs   # smoke (1 call only)
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import OpenAI from 'openai';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

// Load .env.local — keep parity with `next dev` which auto-loads it.
const envPath = path.join(ROOT, '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

if (!process.env.OPENAI_API_KEY) {
  console.error('[TM-84] OPENAI_API_KEY missing — abort.');
  process.exit(1);
}

const ASSET_DIR = path.join(ROOT, '.spike-assets');
fs.mkdirSync(ASSET_DIR, { recursive: true });

const REPORT_DIR = path.join(ROOT, 'wiki', '05-reports', 'screenshots', 'TM-84');
fs.mkdirSync(REPORT_DIR, { recursive: true });

const BUDGET_USD = Number(process.env.BUDGET_USD ?? '0.20');
const GPT_IMAGE_1_PRICE_USD_1024 = 0.04; // mirrors src/lib/ai/asset-gen.ts
const PROMPT_LIMIT = Number(process.env.PROMPT_LIMIT ?? '3');

// 3 prompts spanning the ADR-0022 motivating cases:
//   - "곰돌이" (bear) → the exact prompt that triggered ADR-0022.
//   - "강아지" (corgi) → second character to test consistency.
//   - "사람" (person) → person + scene to probe policy edge.
const PROMPTS = [
  {
    id: 'P1',
    label: 'bear-meadow',
    text: 'A cute cartoon brown bear walking through a sunny green meadow, friendly children-book illustration style, soft pastel colors, simple flat shapes, centered composition, white background border',
  },
  {
    id: 'P2',
    label: 'corgi-beach',
    text: 'A happy cartoon corgi running on a beach at sunset, watercolor illustration style, warm orange and pink sky, simple soft shapes, centered composition',
  },
  {
    id: 'P3',
    label: 'person-forest',
    text: 'A simple flat-illustration of a young person walking in a calm forest, geometric paper-cut art style, muted green palette, side view, centered composition',
  },
].slice(0, PROMPT_LIMIT);

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const results = [];
let runningCostUsd = 0;

for (const p of PROMPTS) {
  if (runningCostUsd + GPT_IMAGE_1_PRICE_USD_1024 > BUDGET_USD) {
    console.warn(`[TM-84] budget guard: $${runningCostUsd.toFixed(3)} + $${GPT_IMAGE_1_PRICE_USD_1024} > $${BUDGET_USD} — STOP.`);
    break;
  }

  console.log(`[TM-84] ${p.id} (${p.label}) — calling gpt-image-1…`);
  const t0 = Date.now();
  let pngBytes, dataUrl, latencyMs, errMsg;
  try {
    const resp = await client.images.generate({
      model: 'gpt-image-1',
      prompt: p.text,
      size: '1024x1024',
      n: 1,
    });
    latencyMs = Date.now() - t0;
    const b64 = resp.data?.[0]?.b64_json;
    if (!b64) throw new Error('no b64_json in response');
    pngBytes = Buffer.from(b64, 'base64');
    dataUrl = `data:image/png;base64,${b64}`;
  } catch (err) {
    latencyMs = Date.now() - t0;
    errMsg = (err && err.message) || String(err);
    console.error(`[TM-84] ${p.id} FAILED in ${latencyMs}ms: ${errMsg}`);
    results.push({ id: p.id, label: p.label, ok: false, latencyMs, error: errMsg });
    continue;
  }

  runningCostUsd += GPT_IMAGE_1_PRICE_USD_1024;
  const hash = crypto.createHash('sha256').update(p.text).digest('hex').slice(0, 16);
  const pngPath = path.join(ASSET_DIR, `${p.id}-${hash}.png`);
  fs.writeFileSync(pngPath, pngBytes);

  // sanity: real PNGs from gpt-image-1 are typically > 50KB at 1024².
  // 5KB cutoff per spec; expect comfortably above.
  const sizeKb = Math.round(pngBytes.length / 1024);
  const sanityOk = pngBytes.length > 5 * 1024;
  console.log(`[TM-84] ${p.id} OK — ${sizeKb}KB, ${latencyMs}ms, $${GPT_IMAGE_1_PRICE_USD_1024} (sanity=${sanityOk})`);

  // Mirror to wiki screenshot dir for the report.
  fs.copyFileSync(pngPath, path.join(REPORT_DIR, `${p.id}-${p.label}.png`));

  results.push({
    id: p.id,
    label: p.label,
    ok: true,
    latencyMs,
    sizeBytes: pngBytes.length,
    sizeKb,
    sanityOk,
    pngPath: path.relative(ROOT, pngPath),
    costUsd: GPT_IMAGE_1_PRICE_USD_1024,
    dataUrlPreview: dataUrl.slice(0, 64) + '…',
  });
}

// Paper-test the Remotion <Img> integration: emit a TSX stub that the
// editor pipeline would output. We don't render it (lambda) but tsc-style
// shape-check would catch obvious problems.
const remotionStub = results.find((r) => r.ok)
  ? `// TM-84 spike — generated Remotion stub.
// Demonstrates the ADR-0022 option B integration shape: PARAMS.imageUrl
// carries the asset, the composition <Img>s it over a Remotion timeline.
import { AbsoluteFill, Img, useCurrentFrame, interpolate } from 'remotion';

export const PARAMS = {
  imageUrl: '<INLINE_DATA_URL_OR_R2_URL_GOES_HERE>', // type: image
  durationFrames: 300, // type: number, min: 30, max: 900
} as const;

export const TM84Spike: React.FC = () => {
  const frame = useCurrentFrame();
  const x = interpolate(frame, [0, PARAMS.durationFrames], [-100, 100]);
  return (
    <AbsoluteFill style={{ backgroundColor: '#cdeac0' }}>
      <Img src={PARAMS.imageUrl} style={{ transform: \`translateX(\${x}px)\` }} />
    </AbsoluteFill>
  );
};
`
  : '// No successful asset — skipping remotion stub emission.';

fs.writeFileSync(path.join(ASSET_DIR, 'TM84Spike.stub.tsx'), remotionStub);

const summary = {
  task: 'TM-84',
  ts: new Date().toISOString(),
  budgetUsd: BUDGET_USD,
  runningCostUsd,
  callsAttempted: PROMPTS.length,
  callsSucceeded: results.filter((r) => r.ok).length,
  latencyMsValues: results.filter((r) => r.ok).map((r) => r.latencyMs),
  latencyMsP50:
    (() => {
      const xs = results.filter((r) => r.ok).map((r) => r.latencyMs).sort((a, b) => a - b);
      return xs.length ? xs[Math.floor(xs.length / 2)] : null;
    })(),
  results,
  remotionStubPath: path.relative(ROOT, path.join(ASSET_DIR, 'TM84Spike.stub.tsx')),
};

const summaryPath = path.join(REPORT_DIR, 'spike-summary.json');
fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
console.log(`[TM-84] DONE. cost=$${runningCostUsd.toFixed(3)} success=${summary.callsSucceeded}/${summary.callsAttempted}`);
console.log(`[TM-84] summary → ${path.relative(ROOT, summaryPath)}`);
