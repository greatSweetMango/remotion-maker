/**
 * TM-3 — A1 PARAMS extraction reliability benchmark runner.
 *
 * Usage:
 *   npx tsx scripts/validate-params-extraction.ts          # full 50-prompt run
 *   LIMIT=5 npx tsx scripts/validate-params-extraction.ts  # smoke test
 *   CONCURRENCY=4 npx tsx scripts/validate-params-extraction.ts
 *   OUT=./benchmark-results.json npx tsx scripts/validate-params-extraction.ts
 *
 * Reads ANTHROPIC_API_KEY (or OPENAI_API_KEY) from .env.local.
 * Calls generateAsset() directly — no Next dev server, no DB, no auth.
 *
 * For each prompt, runs 4 acceptance checks:
 *   C1. `export const PARAMS = { ... }` exists
 *   C2. PARAMS members carry `// type: <kind>` comments
 *   C3. PARAMS keys are referenced in the GeneratedAsset body
 *   C4. `export const GeneratedAsset` exists
 * PASS iff all four.
 *
 * Also logs whether `extractParameters(code)` returns ≥ 1 entry.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

// Load .env.local from worktree first, then fall back to main repo.
loadDotenv({ path: path.join(ROOT, '.env.local') });
loadDotenv({ path: path.resolve(ROOT, '..', '..', '.env.local') });

import { BENCHMARK_PROMPTS, type BenchmarkPrompt } from '../__tests__/benchmarks/params-extraction.benchmark';
import { chatComplete, getModels } from '../src/lib/ai/client';
import { GENERATION_WITH_CLARIFY_SYSTEM_PROMPT } from '../src/lib/ai/prompts';
import { extractParameters } from '../src/lib/ai/extract-params';

// ─── Tunables ───────────────────────────────────────────────────────
const LIMIT = process.env.LIMIT ? parseInt(process.env.LIMIT, 10) : BENCHMARK_PROMPTS.length;
const CONCURRENCY = process.env.CONCURRENCY ? parseInt(process.env.CONCURRENCY, 10) : 4;
const OUT = process.env.OUT ?? path.join(ROOT, 'benchmark-results.json');
const TIMEOUT_MS = 90_000;

// ─── Types ──────────────────────────────────────────────────────────
type FailureMode =
  | 'clarify-mode'
  | 'json-parse-error'
  | 'no-code-field'
  | 'api-error'
  | 'timeout'
  | 'no-params-export'
  | 'missing-type-comments'
  | 'params-not-referenced'
  | 'no-component-export'
  | 'extractor-empty';

interface CaseResult {
  id: string;
  category: BenchmarkPrompt['category'];
  prompt: string;
  pass: boolean;
  checks: { c1: boolean; c2: boolean; c3: boolean; c4: boolean };
  extractorCount: number;
  failureModes: FailureMode[];
  errorMessage?: string;
  durationMs: number;
  /** Stored only for failures, capped at 4000 chars, for failure analysis. */
  rawResponseExcerpt?: string;
  /** Stored only when extraction succeeded enough to have code. */
  codeExcerpt?: string;
}

// ─── JSON extraction (mirrors src/lib/ai/generate.ts) ───────────────
function repairBacktickStrings(input: string): string {
  let out = '';
  let i = 0;
  let inJsonString = false;
  let escape = false;
  while (i < input.length) {
    const ch = input[i];
    if (inJsonString) {
      out += ch;
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inJsonString = false;
      i++;
      continue;
    }
    if (ch === '"') { inJsonString = true; out += ch; i++; continue; }
    if (ch === '`') {
      let j = i + 1;
      let body = '';
      while (j < input.length && input[j] !== '`') { body += input[j]; j++; }
      if (j >= input.length) { out += ch; i++; continue; }
      const escaped = body
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\r/g, '')
        .replace(/\n/g, '\\n')
        .replace(/\t/g, '\\t');
      out += '"' + escaped + '"';
      i = j + 1;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

function extractJson(text: string): unknown | null {
  const fenceStripped = text.replace(/```(?:json)?\s*/g, '').replace(/```/g, '');
  const start = fenceStripped.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let inBacktick = false;
  let escape = false;
  let endIdx = -1;
  for (let i = start; i < fenceStripped.length; i++) {
    const ch = fenceStripped[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (!inBacktick && ch === '"') { inString = !inString; continue; }
    if (!inString && ch === '`') { inBacktick = !inBacktick; continue; }
    if (inString || inBacktick) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) { endIdx = i; break; }
    }
  }
  if (endIdx < 0) return null;
  const slice = fenceStripped.slice(start, endIdx + 1);
  try { return JSON.parse(slice); } catch {}
  try { return JSON.parse(repairBacktickStrings(slice)); } catch {}
  return null;
}

// ─── Acceptance checks ──────────────────────────────────────────────
function checkParamsExport(code: string): boolean {
  // The production extractor (src/lib/ai/extract-params.ts) matches `const PARAMS = { ... }`
  // with or without `export`. The system prompt's PARAMS_FORMAT example also omits
  // `export`. We accept either form to mirror what the runtime UI actually consumes.
  return /(?:export\s+)?const\s+PARAMS\s*=\s*\{[\s\S]*?\}/.test(code);
}

function checkTypeComments(code: string): boolean {
  // The PARAMS body must contain at least 2 members carrying `// type: <kind>`.
  const m = code.match(/const\s+PARAMS\s*=\s*\{([\s\S]*?)\}\s*(?:as const)?/);
  if (!m) return false;
  const body = m[1];
  const typeCommentLines = body
    .split('\n')
    .filter((l) => /\/\/\s*type:\s*(color|range|text|boolean|select)/.test(l));
  return typeCommentLines.length >= 2;
}

function checkParamsReferenced(code: string): boolean {
  // Extract keys from PARAMS, then look for any reference within
  // GeneratedAsset (or the rest of the file outside the PARAMS literal).
  const m = code.match(/const\s+PARAMS\s*=\s*\{([\s\S]*?)\}\s*(?:as const)?/);
  if (!m) return false;
  const body = m[1];
  const keys = new Set<string>();
  for (const line of body.split('\n')) {
    const km = line.match(/^\s*(\w+)\s*:/);
    if (km && km[1] !== 'type' && km[1] !== 'min' && km[1] !== 'max' && km[1] !== 'unit' && km[1] !== 'options') {
      keys.add(km[1]);
    }
  }
  if (keys.size === 0) return false;
  const outsideParams = code.replace(m[0], '');
  for (const k of keys) {
    // Reference: `PARAMS.k`, destructured `{ k`, or bare `k` token usage.
    const re = new RegExp(`\\bPARAMS\\.${k}\\b|\\b${k}\\s*=\\s*PARAMS\\.${k}\\b|\\b${k}\\b`);
    if (re.test(outsideParams)) return true;
  }
  return false;
}

function checkComponentExport(code: string): boolean {
  return /export\s+const\s+GeneratedAsset\s*=/.test(code);
}

// ─── Per-prompt runner ──────────────────────────────────────────────
async function runOne(p: BenchmarkPrompt, model: string): Promise<CaseResult> {
  const t0 = Date.now();
  const failureModes: FailureMode[] = [];
  let checks = { c1: false, c2: false, c3: false, c4: false };
  let extractorCount = 0;
  let errorMessage: string | undefined;
  let rawText = '';
  let codeOut: string | undefined;

  try {
    const text = await Promise.race<string>([
      chatComplete({
        model,
        system: GENERATION_WITH_CLARIFY_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: p.prompt }],
      }),
      new Promise<string>((_, rej) => setTimeout(() => rej(new Error('timeout')), TIMEOUT_MS)),
    ]);
    rawText = text;

    const parsed = extractJson(text);
    if (!parsed || typeof parsed !== 'object') {
      failureModes.push('json-parse-error');
      return { id: p.id, category: p.category, prompt: p.prompt, pass: false, checks, extractorCount, failureModes, durationMs: Date.now() - t0, rawResponseExcerpt: rawText.slice(0, 4000) };
    }
    const obj = parsed as Record<string, unknown>;
    if (obj.mode === 'clarify') {
      failureModes.push('clarify-mode');
      return { id: p.id, category: p.category, prompt: p.prompt, pass: false, checks, extractorCount, failureModes, durationMs: Date.now() - t0, rawResponseExcerpt: rawText.slice(0, 4000) };
    }
    const code = obj.code as string | undefined;
    if (!code || typeof code !== 'string') {
      failureModes.push('no-code-field');
      return { id: p.id, category: p.category, prompt: p.prompt, pass: false, checks, extractorCount, failureModes, durationMs: Date.now() - t0, rawResponseExcerpt: rawText.slice(0, 4000) };
    }
    codeOut = code;

    checks = {
      c1: checkParamsExport(code),
      c2: checkTypeComments(code),
      c3: checkParamsReferenced(code),
      c4: checkComponentExport(code),
    };
    if (!checks.c1) failureModes.push('no-params-export');
    if (!checks.c2) failureModes.push('missing-type-comments');
    if (!checks.c3) failureModes.push('params-not-referenced');
    if (!checks.c4) failureModes.push('no-component-export');

    try {
      extractorCount = extractParameters(code).length;
    } catch {
      extractorCount = 0;
    }
    if (extractorCount === 0) failureModes.push('extractor-empty');

    const pass = checks.c1 && checks.c2 && checks.c3 && checks.c4;
    return {
      id: p.id, category: p.category, prompt: p.prompt, pass, checks, extractorCount, failureModes,
      durationMs: Date.now() - t0,
      codeExcerpt: pass ? undefined : (codeOut ? codeOut.slice(0, 4000) : undefined),
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    errorMessage = msg;
    failureModes.push(msg === 'timeout' ? 'timeout' : 'api-error');
    return { id: p.id, category: p.category, prompt: p.prompt, pass: false, checks, extractorCount, failureModes, errorMessage, durationMs: Date.now() - t0, rawResponseExcerpt: rawText.slice(0, 4000) };
  }
}

// ─── Concurrency pool ───────────────────────────────────────────────
async function runPool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
      const r = out[i] as unknown as { id: string; pass: boolean; failureModes: FailureMode[] };
      const tag = r.pass ? 'PASS' : 'FAIL';
      const fm = r.failureModes.length ? ` [${r.failureModes.join(',')}]` : '';
      console.log(`  ${tag} ${r.id}${fm}`);
    }
  });
  await Promise.all(workers);
  return out;
}

// ─── Aggregate ──────────────────────────────────────────────────────
function aggregate(results: CaseResult[]) {
  const total = results.length;
  const passed = results.filter((r) => r.pass).length;
  const passRate = total ? passed / total : 0;
  const byCategory: Record<string, { total: number; passed: number; rate: number }> = {};
  for (const r of results) {
    byCategory[r.category] ??= { total: 0, passed: 0, rate: 0 };
    byCategory[r.category].total++;
    if (r.pass) byCategory[r.category].passed++;
  }
  for (const k of Object.keys(byCategory)) {
    byCategory[k].rate = byCategory[k].passed / byCategory[k].total;
  }
  const failureCounts: Record<string, number> = {};
  for (const r of results) {
    for (const fm of r.failureModes) failureCounts[fm] = (failureCounts[fm] ?? 0) + 1;
  }
  return { total, passed, passRate, byCategory, failureCounts };
}

// ─── Main ───────────────────────────────────────────────────────────
async function main() {
  const provider = process.env.AI_PROVIDER ?? 'anthropic';
  const haveKey = provider === 'openai' ? !!process.env.OPENAI_API_KEY : !!process.env.ANTHROPIC_API_KEY;
  if (!haveKey) {
    console.error(`Missing API key for provider=${provider}. Set ANTHROPIC_API_KEY or OPENAI_API_KEY in .env.local.`);
    process.exit(2);
  }
  const model = getModels().free;
  const prompts = BENCHMARK_PROMPTS.slice(0, LIMIT);

  console.log(`Running ${prompts.length} prompts | provider=${provider} | model=${model} | concurrency=${CONCURRENCY}`);
  const t0 = Date.now();
  const results = await runPool(prompts, CONCURRENCY, (p) => runOne(p, model));
  const elapsedMs = Date.now() - t0;

  const summary = aggregate(results);
  const report = { meta: { provider, model, total: prompts.length, concurrency: CONCURRENCY, elapsedMs, finishedAt: new Date().toISOString() }, summary, results };

  await fs.writeFile(OUT, JSON.stringify(report, null, 2), 'utf8');

  console.log('\n──────── SUMMARY ────────');
  console.log(`PASS: ${summary.passed}/${summary.total} (${(summary.passRate * 100).toFixed(1)}%)`);
  console.log(`Threshold: 80%  →  ${summary.passRate >= 0.8 ? 'ACCEPT' : 'REJECT'}`);
  console.log('By category:');
  for (const [cat, s] of Object.entries(summary.byCategory)) {
    console.log(`  ${cat.padEnd(13)} ${s.passed}/${s.total} (${(s.rate * 100).toFixed(0)}%)`);
  }
  console.log('Failure modes:');
  for (const [fm, n] of Object.entries(summary.failureCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${fm.padEnd(28)} ${n}`);
  }
  console.log(`Elapsed: ${(elapsedMs / 1000).toFixed(1)}s`);
  console.log(`Report:  ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
