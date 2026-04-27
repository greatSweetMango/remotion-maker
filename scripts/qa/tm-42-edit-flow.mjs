#!/usr/bin/env node
/**
 * TM-42 — AI 편집 플로우 E2E QA
 *
 * 20세트 × 3-turn (색 변경 → 장면 추가 → 속도 조정) 자동 실행.
 *
 * 측정 지표:
 *   - PARAMS 보존: 의도 키 외 deep-equal 보존
 *   - 의도 외 코드 변경 detection (heuristic: edit 후 PARAMS 외 키 소실)
 *   - cache 히트율: AI_PROVIDER=openai 인 경우 N/A → 응답시간(ms) cold/warm 비교
 *   - 단계별 latency
 *
 * 출력:
 *   - wiki/05-reports/screenshots/TM-42/results.json
 *   - wiki/05-reports/screenshots/TM-42/summary.txt
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const OUT_DIR = path.join(ROOT, 'wiki', '05-reports', 'screenshots', 'TM-42');
fs.mkdirSync(OUT_DIR, { recursive: true });

const BASE = process.env.BASE_URL ?? 'http://localhost:3042';
const COOKIE_FILE = process.env.COOKIE_FILE ?? '/tmp/tm42-cookies.txt';
const SET_COUNT = parseInt(process.env.SET_COUNT ?? '20', 10);
const PROVIDER = process.env.AI_PROVIDER_LABEL ?? 'openai';

// Read netscape cookie jar
function loadCookieHeader() {
  if (!fs.existsSync(COOKIE_FILE)) throw new Error(`Cookie file not found: ${COOKIE_FILE}`);
  const lines = fs.readFileSync(COOKIE_FILE, 'utf8').split('\n');
  const pairs = [];
  for (const rawLine of lines) {
    if (!rawLine) continue;
    // HttpOnly cookies are prefixed with `#HttpOnly_` — strip that comment-like prefix
    const line = rawLine.replace(/^#HttpOnly_/, '');
    if (line.startsWith('#')) continue;
    const parts = line.split('\t');
    if (parts.length < 7) continue;
    const [, , , , , name, value] = parts;
    if (!name) continue;
    pairs.push(`${name}=${value}`);
  }
  return pairs.join('; ');
}

const COOKIE = loadCookieHeader();

async function call(endpoint, body) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: COOKIE },
    body: JSON.stringify(body),
  });
  const latency = Date.now() - t0;
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { ok: res.ok, status: res.status, latency, json, text };
}

// Parse PARAMS object literal from generated code into JS object (key → raw rhs string).
function parseParams(code) {
  const m = code.match(/const\s+PARAMS\s*=\s*\{([\s\S]*?)\}\s*(?:as\s+const)?\s*;/);
  if (!m) return null;
  const body = m[1];
  const out = {};
  for (const rawLine of body.split('\n')) {
    const line = rawLine.replace(/\/\/.*$/, '').trim();
    if (!line) continue;
    const km = line.match(/^(\w+)\s*:\s*(.+?),?$/);
    if (!km) continue;
    out[km[1]] = km[2].trim();
  }
  return out;
}

// Generation prompts (varied subjects)
const SEED_PROMPTS = [
  'Animated counter from 0 to 100 with spring effect, blue color',
  '빨간 카운터 0~100, 3초',
  'Comic book POW! text exploding outward',
  'Slide transition from left to right, two colored panels',
  '원형 스피너 8개 점, 파란색',
  'Typing effect Hello World, monospace',
  '페이드 인 페이드 아웃, 검정에서 흰색으로 1.5초',
  'Bouncing ball with shadow, orange',
  'Wave text animation, purple gradient',
  'Pulse circle expanding, teal',
  'Star burst rotating, yellow',
  'Horizontal progress bar 0 to 100%',
  'Number ticker 1000 → 5000 with comma format',
  'Rotating cube wireframe, neon green',
  'Confetti burst from center',
  'Sliding subtitle fade in/out',
  'Heart icon pulse, red',
  'Growing tree branches, green',
  'Loading dots three bouncing, white',
  'Digital clock display HH:MM:SS, mono',
];

const EDIT_TURNS = [
  { id: 'color', prompt: 'Change primaryColor to #FF0066 (hot pink)', intentKey: 'primaryColor' },
  { id: 'scene', prompt: 'Add a new scene at the end with a fade-out title saying "The End"', intentKey: '__code_growth__' },
  { id: 'speed', prompt: 'Increase animation speed by 50% (set speed to 1.5 if it exists)', intentKey: 'speed' },
];

function paramDiff(before, after, intentKey) {
  if (!before || !after) return { error: 'parse_failed' };
  const beforeKeys = new Set(Object.keys(before));
  const afterKeys = new Set(Object.keys(after));
  const lost = [...beforeKeys].filter(k => !afterKeys.has(k));
  const added = [...afterKeys].filter(k => !beforeKeys.has(k));
  const changed = [];
  const preserved = [];
  for (const k of beforeKeys) {
    if (!afterKeys.has(k)) continue;
    if (before[k] !== after[k]) changed.push({ key: k, before: before[k], after: after[k] });
    else preserved.push(k);
  }
  // unintendedChanges = changed keys other than the intent key
  const unintended = intentKey && intentKey !== '__code_growth__'
    ? changed.filter(c => c.key !== intentKey)
    : []; // for scene additions, any change is acceptable
  return {
    lostCount: lost.length,
    lostKeys: lost,
    addedKeys: added,
    changedCount: changed.length,
    changed,
    preservedCount: preserved.length,
    unintendedCount: unintended.length,
    unintendedChanges: unintended,
  };
}

const results = [];
const startedAt = new Date().toISOString();

for (let i = 0; i < SET_COUNT; i++) {
  const seed = SEED_PROMPTS[i % SEED_PROMPTS.length];
  const setId = `set-${String(i + 1).padStart(2, '0')}`;
  console.log(`\n=== ${setId} :: ${seed.slice(0, 60)} ===`);
  const setResult = { setId, seed, generate: null, edits: [] };

  // 1. Generate
  const gen = await call('/api/generate', { prompt: seed });
  setResult.generate = {
    ok: gen.ok,
    status: gen.status,
    latencyMs: gen.latency,
    error: gen.json?.error ?? null,
  };
  if (!gen.ok || gen.json?.type !== 'generate') {
    console.log(`  GENERATE FAIL: ${gen.status} ${gen.json?.error ?? gen.text.slice(0, 100)}`);
    results.push(setResult);
    continue;
  }
  let asset = gen.json.asset;
  let prevParams = parseParams(asset.code);
  console.log(`  generated assetId=${asset.id} latency=${gen.latency}ms params=${prevParams ? Object.keys(prevParams).length : '?'}`);

  // 2-4. Edit turns
  for (const turn of EDIT_TURNS) {
    const ed = await call('/api/edit', {
      assetId: asset.id,
      prompt: turn.prompt,
      currentCode: asset.code,
    });
    const turnResult = {
      turnId: turn.id,
      prompt: turn.prompt,
      intentKey: turn.intentKey,
      ok: ed.ok,
      status: ed.status,
      latencyMs: ed.latency,
      error: ed.json?.error ?? null,
    };
    if (!ed.ok) {
      console.log(`  EDIT[${turn.id}] FAIL: ${ed.status} ${ed.json?.error}`);
      setResult.edits.push(turnResult);
      break;
    }
    const newParams = parseParams(ed.json.code);
    const diff = paramDiff(prevParams, newParams, turn.intentKey);
    turnResult.diff = diff;
    turnResult.codeBytesBefore = asset.code.length;
    turnResult.codeBytesAfter = ed.json.code?.length ?? 0;
    console.log(`  edit[${turn.id}] latency=${ed.latency}ms lost=${diff.lostCount} unintended=${diff.unintendedCount}`);
    setResult.edits.push(turnResult);
    asset = { id: ed.json.id, code: ed.json.code };
    prevParams = newParams;
  }

  results.push(setResult);
  fs.writeFileSync(path.join(OUT_DIR, 'results.json'), JSON.stringify({ startedAt, provider: PROVIDER, results }, null, 2));
}

// ============ Aggregate ============

const totalSets = results.length;
const completedSets = results.filter(r => r.edits.length === 3 && r.edits.every(e => e.ok)).length;
const failedGenerate = results.filter(r => !r.generate?.ok).length;

const editStats = { total: 0, ok: 0, lost0: 0, unintended0: 0, lostTotal: 0, unintendedTotal: 0 };
const latencyByTurn = { generate: [], color: [], scene: [], speed: [] };

for (const r of results) {
  if (r.generate?.ok) latencyByTurn.generate.push(r.generate.latencyMs);
  for (const e of r.edits) {
    editStats.total++;
    if (e.ok) {
      editStats.ok++;
      latencyByTurn[e.turnId]?.push(e.latencyMs);
      if (e.diff?.lostCount === 0) editStats.lost0++;
      else editStats.lostTotal += e.diff?.lostCount ?? 0;
      if (e.diff?.unintendedCount === 0) editStats.unintended0++;
      else editStats.unintendedTotal += e.diff?.unintendedCount ?? 0;
    }
  }
}

function pct(arr) {
  if (!arr.length) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const avg = Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
  const p50 = sorted[Math.floor(arr.length * 0.5)];
  const p95 = sorted[Math.floor(arr.length * 0.95)];
  return { n: arr.length, avgMs: avg, p50Ms: p50, p95Ms: p95, minMs: sorted[0], maxMs: sorted[sorted.length - 1] };
}

// Cache proxy: cold (1st gen) vs warm (later edits in same set, same EXISTING CODE prefix)
const editLatencies = results.flatMap(r => r.edits.filter(e => e.ok).map(e => e.latencyMs));
const generateLatencies = latencyByTurn.generate;

const summary = {
  startedAt,
  finishedAt: new Date().toISOString(),
  provider: PROVIDER,
  cacheStrategy: PROVIDER === 'openai'
    ? 'N/A (OpenAI Chat Completions does not expose explicit cache_control; ADR-0003 currently inactive in this provider mode)'
    : 'Anthropic ephemeral cache_control on EXISTING CODE block',
  totals: {
    sets: totalSets,
    completedSets,
    failedGenerate,
    editAttempts: editStats.total,
    editOk: editStats.ok,
  },
  paramsPreservation: {
    paramsLossZeroRate: editStats.ok > 0 ? editStats.lost0 / editStats.ok : 0,
    unintendedChangeZeroRate: editStats.ok > 0 ? editStats.unintended0 / editStats.ok : 0,
    totalLostKeys: editStats.lostTotal,
    totalUnintendedChanges: editStats.unintendedTotal,
  },
  latency: {
    generate: pct(generateLatencies),
    edit_color: pct(latencyByTurn.color),
    edit_scene: pct(latencyByTurn.scene),
    edit_speed: pct(latencyByTurn.speed),
    edit_overall: pct(editLatencies),
  },
  acceptance: {
    cacheHitRateGte80: 'N/A (OpenAI provider)',
    paramsLossZero: editStats.lostTotal === 0,
    unintendedChangeZero: editStats.unintendedTotal === 0,
  },
};

fs.writeFileSync(path.join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2));
fs.writeFileSync(path.join(OUT_DIR, 'results.json'), JSON.stringify({ startedAt, provider: PROVIDER, results }, null, 2));

console.log('\n=== SUMMARY ===');
console.log(JSON.stringify(summary, null, 2));
