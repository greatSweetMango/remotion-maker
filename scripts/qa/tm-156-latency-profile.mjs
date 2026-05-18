#!/usr/bin/env node
/**
 * TM-156 — Production latency profile driver.
 *
 * Goal: reproduce the prod-vs-bench latency gap surfaced by TM-153
 * (~44s prod p50 vs 13s bench baseline) and attribute the 29s residual
 * to specific pipeline stages — outline / scene-spec / asset-gen / scene-
 * code / compose / DB write / etc.
 *
 * How:
 *   1. POSTs `/api/generate` with a single living-entity character prompt
 *      (clarify → answer) five times.
 *   2. Captures both client-side wall clock AND server-side LATENCY_PROFILE
 *      structured marks (parsed from the dev-server log file). The req id
 *      is echoed in the response header `x-tm156-req` so we can correlate.
 *   3. Aggregates: total ms (client), per-stage server breakdown,
 *      asset-gen openai-wire vs decode, scene-specs+asset-gen parallel ms,
 *      scene-code ms, db-write ms. Reports p50 + mean per stage.
 *
 * Cost: 5 character prompts × 2 LLM calls (clarify + generate) + 5
 * gpt-image-1 + (multi-step auto-routes ON for character) — under the
 * task's $0.20 ceiling. Asset-gen cache amortises after first run, so
 * we reset the cache between iterations via prompt suffix.
 *
 * Env:
 *   BASE_URL    — defaults to http://127.0.0.1:3156
 *   ITERATIONS  — defaults to 5
 *   DEV_LOG     — path to dev-server log file (required to parse marks)
 *   PROMPT      — override default character prompt
 *
 * Output:
 *   wiki/05-reports/screenshots/TM-156/results.json
 *   wiki/05-reports/screenshots/TM-156/summary.json
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const OUT_DIR = path.join(ROOT, 'wiki', '05-reports', 'screenshots', 'TM-156');
fs.mkdirSync(OUT_DIR, { recursive: true });

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3156';
const ITERATIONS = Number(process.env.ITERATIONS ?? 5);
const DEV_LOG = process.env.DEV_LOG ?? null;
const BASE_PROMPT = process.env.PROMPT ?? '곰돌이가 초원을 걸어가는 약 10초분량의 횡스크롤 애니메이션 만들어줘';

function nowIso() { return new Date().toISOString(); }

async function getAuthCookie() {
  const res = await fetch(`${BASE}/api/dev/auto-login?callbackUrl=/studio`, { redirect: 'manual' });
  const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  if (setCookies.length) return setCookies.map((c) => c.split(';')[0].trim()).join('; ');
  const raw = res.headers.get('set-cookie');
  if (!raw) throw new Error(`No Set-Cookie from auto-login (status ${res.status})`);
  return raw.split(/,(?=\s*[\w%-]+=)/).map((c) => c.split(';')[0].trim()).join('; ');
}

async function callGenerate(body, cookie) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify(body),
  });
  const wallMs = Date.now() - t0;
  const reqHeader = res.headers.get('x-tm156-req');
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, ok: res.ok, wallMs, reqHeader, json, text };
}

function parseLogMarks(logPath, reqIds) {
  if (!logPath || !fs.existsSync(logPath)) return {};
  const buf = fs.readFileSync(logPath, 'utf8');
  const idsSet = new Set(reqIds.filter(Boolean));
  const out = {};
  const lineRe = /\[TM-156\]\s+(\{.*\})/g;
  let m;
  while ((m = lineRe.exec(buf)) !== null) {
    try {
      const obj = JSON.parse(m[1]);
      if (!idsSet.has(obj.req)) continue;
      if (!out[obj.req]) out[obj.req] = [];
      out[obj.req].push(obj);
    } catch { /* skip */ }
  }
  return out;
}

function pct(arr, p) {
  if (arr.length === 0) return null;
  const s = [...arr].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.floor((p / 100) * s.length));
  return s[idx];
}
function mean(arr) {
  if (arr.length === 0) return null;
  return Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
}

const startedAt = nowIso();
console.log(`TM-156 latency profile :: BASE=${BASE} :: ITER=${ITERATIONS}`);
console.log(`prompt = ${BASE_PROMPT}`);
if (DEV_LOG) console.log(`devLog = ${DEV_LOG}`);

const cookie = await getAuthCookie();
console.log(`auth cookie acquired (${cookie.length} chars)`);

const runs = [];
const reqIds = [];

for (let i = 0; i < ITERATIONS; i++) {
  // Vary the prompt suffix so asset-gen hash differs each run → real
  // wire time recorded (cache disabled per iteration).
  const prompt = `${BASE_PROMPT} #run${i + 1}-${Date.now()}`;
  console.log(`\n[run ${i + 1}/${ITERATIONS}] ${prompt.slice(0, 70)}`);

  const t0 = Date.now();
  // Step 1: initial generate (expect clarify for character)
  const g1 = await callGenerate({ prompt }, cookie);
  console.log(`  step1 status=${g1.status} type=${g1.json?.type} wall=${g1.wallMs}ms req=${g1.reqHeader ?? '-'}`);

  let g2 = null;
  if (g1.ok && g1.json?.type === 'clarify') {
    const qs = g1.json.questions ?? [];
    const answers = {};
    for (const q of qs) {
      if (q?.id && Array.isArray(q.choices) && q.choices.length > 0) {
        answers[q.id] = q.choices[0].id;
      }
    }
    g2 = await callGenerate({ prompt, answers }, cookie);
    console.log(`  step2 status=${g2.status} type=${g2.json?.type} wall=${g2.wallMs}ms req=${g2.reqHeader ?? '-'} assetGen=${!!g2.json?.assetGenStages?.asset_gen_used}`);
  }

  const totalWall = Date.now() - t0;
  const run = {
    iter: i + 1,
    prompt,
    step1: { wallMs: g1.wallMs, status: g1.status, type: g1.json?.type, reqId: g1.reqHeader },
    step2: g2 ? {
      wallMs: g2.wallMs, status: g2.status, type: g2.json?.type,
      reqId: g2.reqHeader,
      assetGenStages: g2.json?.assetGenStages ?? null,
      codeLen: g2.json?.asset?.code?.length ?? 0,
      paramsCount: Array.isArray(g2.json?.asset?.parameters) ? g2.json.asset.parameters.length : 0,
    } : null,
    totalWallMs: totalWall,
  };
  if (g1.reqHeader) reqIds.push(g1.reqHeader);
  if (g2?.reqHeader) reqIds.push(g2.reqHeader);
  runs.push(run);
  fs.writeFileSync(path.join(OUT_DIR, 'results.json'), JSON.stringify({ startedAt, base: BASE, runs }, null, 2));
}

// Parse server log marks (only for step2 — the generate-with-answers call).
const logMarks = parseLogMarks(DEV_LOG, reqIds);

// Aggregate per-stage across step2 (the prod-equivalent generate path).
const stageNames = [
  'route.auth', 'route.body-parse', 'route.user-lookup', 'route.quota-reserve',
  'pipeline.outline', 'pipeline.scene-specs+asset-gen', 'pipeline.scene-code', 'pipeline.compose+validate',
  'pipeline.total',
  'asset-gen-stage.prompt-build', 'asset-gen-stage.generate-total', 'asset-gen-stage.disk-write',
  'asset-gen.client-init', 'asset-gen.openai-wire', 'asset-gen.decode',
  'route.generateAsset', 'route.db-write', 'route.total',
  'generateAsset.total',
];
const stageBuckets = Object.fromEntries(stageNames.map((s) => [s, []]));
for (const r of runs) {
  if (!r.step2?.reqId) continue;
  const marks = logMarks[r.step2.reqId] ?? [];
  for (const m of marks) {
    if (stageBuckets[m.phase]) stageBuckets[m.phase].push(m.ms);
  }
}

const stageAgg = {};
for (const s of stageNames) {
  const arr = stageBuckets[s];
  stageAgg[s] = {
    n: arr.length,
    p50: pct(arr, 50),
    mean: mean(arr),
    max: arr.length ? Math.max(...arr) : null,
  };
}

const step2Walls = runs.filter((r) => r.step2).map((r) => r.step2.wallMs);
const totalWalls = runs.map((r) => r.totalWallMs);

const summary = {
  startedAt,
  finishedAt: nowIso(),
  base: BASE,
  iterations: ITERATIONS,
  prompt: BASE_PROMPT,
  devLog: DEV_LOG,
  client: {
    step2_wall_p50: pct(step2Walls, 50),
    step2_wall_mean: mean(step2Walls),
    step2_wall_max: step2Walls.length ? Math.max(...step2Walls) : null,
    total_wall_p50: pct(totalWalls, 50),
    total_wall_mean: mean(totalWalls),
  },
  server: stageAgg,
  rawReqIds: reqIds,
  logMarkCounts: Object.fromEntries(Object.entries(logMarks).map(([k, v]) => [k, v.length])),
};
fs.writeFileSync(path.join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(`\nSummary written: ${path.join(OUT_DIR, 'summary.json')}`);
console.log(`Step2 wall p50: ${summary.client.step2_wall_p50}ms / mean: ${summary.client.step2_wall_mean}ms`);
console.log(`\nServer stage breakdown (p50 ms):`);
for (const s of stageNames) {
  const v = stageAgg[s];
  if (v.n > 0) console.log(`  ${s.padEnd(38)} n=${v.n}  p50=${v.p50}  mean=${v.mean}  max=${v.max}`);
}
