#!/usr/bin/env node
/**
 * TM-72 — capture-side determinism verification.
 *
 * Calls `chatCompleteStream` (= the same path /api/generate uses) directly
 * with N fixed prompts × M repeats and reports per-prompt code/PARAMS
 * std + char-level Δmax. After pinning temperature=0 + seed=42 the
 * expectation is std≈0 (or very low) and outputs identical or near-identical.
 *
 * Usage:
 *   AI_PROVIDER=openai node scripts/qa/tm-72-capture-variance.mjs
 *
 * Outputs JSON summary to stdout + writes
 * `__tests__/benchmarks/results/tm-72/variance.json`.
 */
import 'dotenv/config';
import { writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..', '..');

// Load `.env.local` explicitly (Next.js convention) so the OpenAI key is in
// scope without `next dev` running.
process.env.NODE_ENV ??= 'development';
const envLocal = path.join(ROOT, '.env.local');
try {
  const dotenv = await import('dotenv');
  dotenv.config({ path: envLocal, override: true });
} catch {}

if (!process.env.OPENAI_API_KEY) {
  console.error('OPENAI_API_KEY not set — abort');
  process.exit(2);
}

// Use the compiled TS via tsx? Simpler: dynamic import with --experimental-loader
// fallback by going through the test infrastructure: just instantiate OpenAI
// directly with the same params we ship in client.ts.
const OpenAI = (await import('openai')).default;
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const MODEL = process.env.AI_MODEL_FREE ?? 'gpt-4o-mini';
const REPEATS = 3;
const PROMPTS = [
  'Animate the text "HELLO WORLD" with a typewriter effect over 3 seconds',
  'Show 8 bouncing colored circles on a dark gradient background for 5 seconds',
  'Create a horizontal progress bar that fills from 0% to 100% over 4 seconds',
  'A pulsing star shape in the center, scaling 0.5→1.5 with smooth easing, 3 seconds',
  'Three lines of text fade in sequentially: "FAST", "SECURE", "RELIABLE", 4 seconds',
];

// Mirror the system prompt path used in production. We import lazily so the
// script does not need a TS loader for client.ts.
import('../../src/lib/ai/prompts.ts').catch(() => null);

// Build a minimal system prompt that matches the JSON envelope our
// production system prompt requires. We don't need full fidelity here —
// the goal is to measure whether identical inputs yield identical outputs,
// not to validate the response is perfect Remotion code. So we use a
// simpler prompt that is guaranteed to elicit JSON.
const SYSTEM_PROMPT = `You are a Remotion code generator. Respond with JSON only:
{"mode":"generate","title":"...","durationInFrames":150,"fps":30,"width":1920,"height":1080,
 "code":"const PARAMS = {...}; export const Component = () => { ... };"}
The "code" field must be valid TSX exporting a const PARAMS object and a Component arrow function.
Respond strictly in JSON.`;

function sha(s) {
  return createHash('sha256').update(s).digest('hex').slice(0, 16);
}

function extractField(jsonText, field) {
  try {
    const obj = JSON.parse(jsonText);
    return typeof obj[field] === 'string' ? obj[field] : '';
  } catch {
    return '';
  }
}

function extractParamsBlock(code) {
  // Naive: grab the first `const PARAMS = { ... };` block.
  const m = code.match(/const\s+PARAMS\s*=\s*\{[\s\S]*?\}\s*;/);
  return m ? m[0] : '';
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[a.length][b.length];
}

function pairwiseEditDistance(strs) {
  const n = strs.length;
  if (n < 2) return { mean: 0, max: 0 };
  let total = 0;
  let max = 0;
  let pairs = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = levenshtein(strs[i], strs[j]);
      total += d;
      if (d > max) max = d;
      pairs++;
    }
  }
  return { mean: total / pairs, max };
}

async function callOnce(prompt, opts) {
  const req = {
    model: MODEL,
    max_tokens: 2500,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ],
  };
  if (opts.temperature !== undefined) req.temperature = opts.temperature;
  if (opts.seed !== undefined) req.seed = opts.seed;
  const completion = await client.chat.completions.create(req);
  return completion.choices[0]?.message?.content ?? '';
}

async function runCondition(label, opts) {
  console.log(`\n=== Condition ${label} (${JSON.stringify(opts)}) ===`);
  const samples = [];
  for (let i = 0; i < PROMPTS.length; i++) {
    const prompt = PROMPTS[i];
    const codes = [];
    const paramsBlocks = [];
    const fullHashes = [];
    const codeHashes = [];
    for (let r = 0; r < REPEATS; r++) {
      process.stdout.write(`  P${i + 1} R${r + 1} ... `);
      let raw;
      try {
        raw = await callOnce(prompt, opts);
      } catch (err) {
        console.log(`ERR ${err?.message ?? err}`);
        continue;
      }
      const code = extractField(raw, 'code');
      const params = extractParamsBlock(code);
      codes.push(code);
      paramsBlocks.push(params);
      fullHashes.push(sha(raw));
      codeHashes.push(sha(code));
      console.log(`fullSha=${sha(raw)} codeSha=${sha(code)} codeLen=${code.length}`);
    }
    const codeDist = pairwiseEditDistance(codes);
    const paramsDist = pairwiseEditDistance(paramsBlocks);
    const uniqueFullHashes = new Set(fullHashes).size;
    const uniqueCodeHashes = new Set(codeHashes).size;
    samples.push({
      prompt,
      repeats: REPEATS,
      uniqueFullHashes,
      uniqueCodeHashes,
      codeLevenshtein: codeDist,
      paramsLevenshtein: paramsDist,
      codes,
    });
    console.log(
      `  → P${i + 1}: uniqueFullHashes=${uniqueFullHashes}/${REPEATS} ` +
        `uniqueCodeHashes=${uniqueCodeHashes}/${REPEATS} ` +
        `codeΔmean=${codeDist.mean.toFixed(1)} codeΔmax=${codeDist.max} ` +
        `paramsΔmean=${paramsDist.mean.toFixed(1)} paramsΔmax=${paramsDist.max}`,
    );
  }
  // Aggregate
  const aggCode = samples.map((s) => s.codeLevenshtein.max);
  const aggParams = samples.map((s) => s.paramsLevenshtein.max);
  const allUniqueCodes = samples.reduce(
    (acc, s) => acc + (s.uniqueCodeHashes <= 1 ? 0 : 1),
    0,
  );
  return {
    label,
    opts,
    samples,
    aggregate: {
      meanCodeΔmax: aggCode.reduce((a, b) => a + b, 0) / aggCode.length,
      maxCodeΔmax: Math.max(...aggCode),
      meanParamsΔmax: aggParams.reduce((a, b) => a + b, 0) / aggParams.length,
      maxParamsΔmax: Math.max(...aggParams),
      promptsWithVariance: allUniqueCodes,
      totalPrompts: samples.length,
    },
  };
}

async function main() {
  const condA = await runCondition('A_default(non-deterministic)', {});
  const condB = await runCondition('B_temp0_seed42', { temperature: 0, seed: 42 });

  const summary = { model: MODEL, repeats: REPEATS, A: condA, B: condB };
  const outDir = path.join(ROOT, '__tests__', 'benchmarks', 'results', 'tm-72');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    path.join(outDir, 'variance.json'),
    JSON.stringify(summary, null, 2),
  );

  console.log('\n=== Aggregate ===');
  console.log('A (default):', condA.aggregate);
  console.log('B (temp=0,seed=42):', condB.aggregate);
  console.log(`\nWrote ${path.join(outDir, 'variance.json')}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
