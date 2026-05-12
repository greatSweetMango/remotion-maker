#!/usr/bin/env node
/**
 * TM-85 — Pipeline quality acceptance benchmark
 *
 * 30 prompts × full cycle (generate [+ clarify→answer round] + 3 edits)
 *
 * Test corpus:
 *   - Character/Scene (10) — expect clarify-first round, then generate after answers
 *   - Motion-Graphics (10) — expect generate immediately
 *   - Data-Viz (5) — expect generate immediately
 *   - Typography/Effects (5) — expect generate immediately
 *
 * Per prompt:
 *   1) POST /api/generate
 *   2) if clarify → answer with first choice of each question → POST /api/generate (with answers)
 *   3) POST /api/edit × 3 (color/scene/speed)
 *   4) PARAMS deep-equal diff (lost / unintended)
 *   5) skeleton-echo marker scan on final code
 *
 * Acceptance:
 *   - mode_match ≥ 90%
 *   - skeleton hits == 0
 *   - params_lost_total == 0
 *   - unintended / total_edits ≤ 10%
 *
 * Output:
 *   wiki/05-reports/screenshots/TM-85/{results.json, summary.json}
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const OUT_DIR = path.join(ROOT, 'wiki', '05-reports', 'screenshots', 'TM-85');
fs.mkdirSync(OUT_DIR, { recursive: true });

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3085';

const PROMPTS = [
  // ---- Character / Scene (10) — clarify expected ----
  { id: 'C01', cat: 'character', expect: 'clarify', prompt: '곰돌이 캐릭터가 초원을 걸어가는 10초 애니메이션' },
  { id: 'C02', cat: 'character', expect: 'clarify', prompt: '강아지가 공을 쫓는 5초 애니메이션' },
  { id: 'C03', cat: 'character', expect: 'clarify', prompt: '용이 하늘을 나는 장면' },
  { id: 'C04', cat: 'character', expect: 'clarify', prompt: '사람이 춤추는 영상' },
  { id: 'C05', cat: 'character', expect: 'clarify', prompt: '공룡이 숲을 걸어가는 10초' },
  { id: 'C06', cat: 'character', expect: 'clarify', prompt: 'a cat playing with yarn' },
  { id: 'C07', cat: 'character', expect: 'clarify', prompt: 'person walking in a forest 8 seconds' },
  { id: 'C08', cat: 'character', expect: 'clarify', prompt: 'rabbit hopping in a garden' },
  { id: 'C09', cat: 'character', expect: 'clarify', prompt: 'robot dancing in cyber city' },
  { id: 'C10', cat: 'character', expect: 'clarify', prompt: 'astronaut floating in space' },
  // ---- Motion-Graphics (10) — generate expected ----
  { id: 'M01', cat: 'motion-graphics', expect: 'generate', prompt: 'Animated counter from 0 to 100 with spring effect, blue' },
  { id: 'M02', cat: 'motion-graphics', expect: 'generate', prompt: '빨간 카운터 0~100, 3초' },
  { id: 'M03', cat: 'motion-graphics', expect: 'generate', prompt: '원형 스피너 8개 점, 파란색' },
  { id: 'M04', cat: 'motion-graphics', expect: 'generate', prompt: 'Comic book POW! text exploding outward' },
  { id: 'M05', cat: 'motion-graphics', expect: 'generate', prompt: '타이핑 효과 "Hello World", 모노스페이스' },
  { id: 'M06', cat: 'motion-graphics', expect: 'generate', prompt: 'loading bar 0 to 100 percent green' },
  { id: 'M07', cat: 'motion-graphics', expect: 'generate', prompt: '타이머 1분 카운트다운' },
  { id: 'M08', cat: 'motion-graphics', expect: 'generate', prompt: 'circular progress 8 segments orange' },
  { id: 'M09', cat: 'motion-graphics', expect: 'generate', prompt: 'fade in fade out logo 2 seconds' },
  { id: 'M10', cat: 'motion-graphics', expect: 'generate', prompt: 'slide transition left to right two panels' },
  // ---- Data-Viz (5) — generate expected ----
  { id: 'D01', cat: 'data-viz', expect: 'generate', prompt: 'Bar chart top 5 products by revenue' },
  { id: 'D02', cat: 'data-viz', expect: 'generate', prompt: '막대 그래프 매출 상위 10' },
  { id: 'D03', cat: 'data-viz', expect: 'generate', prompt: 'Pie chart device breakdown 4 segments' },
  { id: 'D04', cat: 'data-viz', expect: 'generate', prompt: 'Line chart stock price daily' },
  { id: 'D05', cat: 'data-viz', expect: 'generate', prompt: 'Donut chart user signups' },
  // ---- Typography/Effects (5) — generate expected ----
  { id: 'T01', cat: 'typography', expect: 'generate', prompt: 'Glitch text effect "BREAKING"' },
  { id: 'T02', cat: 'typography', expect: 'generate', prompt: 'Wave animation text "Hello"' },
  { id: 'T03', cat: 'typography', expect: 'generate', prompt: '네온 글로우 텍스트 "OPEN"' },
  { id: 'T04', cat: 'typography', expect: 'generate', prompt: 'Particle explosion countdown 5 4 3 2 1' },
  { id: 'T05', cat: 'typography', expect: 'generate', prompt: '타이포그래피 "WELCOME" 그라데이션' },
];

const EDIT_TURNS = [
  { id: 'color', prompt: 'Change primaryColor to #FF0066 (hot pink)', intentKey: 'primaryColor' },
  { id: 'scene', prompt: 'Add a new scene at the end with a fade-out title saying "The End"', intentKey: '__code_growth__' },
  { id: 'speed', prompt: 'Increase animation speed by 50% (set speed to 1.5 if it exists)', intentKey: 'speed' },
];

const SKELETON_MARKERS = [
  /\/\/\s*Complete\s+TSX\s+code\s+here/i,
  /\{\s*\/\*\s*component\s+content\s*\*\/\s*\}/i,
  /\/\/\s*\.\.\.\s*all\s+params/i,
  /\/\/\s*animation\s+logic\s*$/im,
];

function countSkeletonHits(code) {
  if (!code) return [];
  const hits = [];
  for (const re of SKELETON_MARKERS) {
    if (re.test(code)) hits.push(re.source);
  }
  return hits;
}

function parseParams(code) {
  if (!code) return null;
  const m = code.match(/const\s+PARAMS\s*=\s*\{([\s\S]*?)\}\s*(?:as\s+const)?\s*;/);
  if (!m) return null;
  const out = {};
  for (const rawLine of m[1].split('\n')) {
    const line = rawLine.replace(/\/\/.*$/, '').trim();
    if (!line) continue;
    const km = line.match(/^(\w+)\s*:\s*(.+?),?$/);
    if (!km) continue;
    out[km[1]] = km[2].trim();
  }
  return out;
}

function paramDiff(before, after, intentKey) {
  if (!before || !after) return { error: 'parse_failed', lostCount: 0, unintendedCount: 0 };
  const beforeKeys = new Set(Object.keys(before));
  const afterKeys = new Set(Object.keys(after));
  const lost = [...beforeKeys].filter(k => !afterKeys.has(k));
  const changed = [];
  for (const k of beforeKeys) {
    if (!afterKeys.has(k)) continue;
    if (before[k] !== after[k]) changed.push({ key: k, before: before[k], after: after[k] });
  }
  const unintended = intentKey && intentKey !== '__code_growth__'
    ? changed.filter(c => c.key !== intentKey)
    : [];
  return {
    lostCount: lost.length,
    lostKeys: lost,
    changedCount: changed.length,
    changed,
    unintendedCount: unintended.length,
    unintendedChanges: unintended,
  };
}

async function getAuthCookie() {
  const res = await fetch(`${BASE}/api/dev/auto-login?callbackUrl=/studio`, { redirect: 'manual' });
  const setCookies = (typeof res.headers.getSetCookie === 'function') ? res.headers.getSetCookie() : [];
  if (setCookies.length) {
    return setCookies.map(c => c.split(';')[0].trim()).join('; ');
  }
  const raw = res.headers.get('set-cookie');
  if (!raw) throw new Error(`No Set-Cookie from auto-login (status ${res.status})`);
  return raw.split(/,(?=\s*[\w%-]+=)/).map(c => c.split(';')[0].trim()).join('; ');
}

async function call(endpoint, body, cookie) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify(body),
  });
  const latency = Date.now() - t0;
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { ok: res.ok, status: res.status, latency, json, text };
}

// === Main ===
const startedAt = new Date().toISOString();
console.log(`TM-85 driver :: BASE=${BASE} :: ${PROMPTS.length} prompts`);

const cookie = await getAuthCookie();
console.log(`auth cookie acquired (${cookie.length} chars)`);

const results = [];

for (const p of PROMPTS) {
  console.log(`\n[${p.id}] (${p.cat}, expect=${p.expect}) ${p.prompt.slice(0, 60)}`);
  const row = {
    ...p,
    mode_first: null,
    mode_match: false,
    clarify_questions_count: 0,
    answers_used: null,
    code_len_final: 0,
    params_count: 0,
    skeleton_markers_hit: [],
    latency_generate_ms: 0,
    latency_clarify_round_ms: 0,
    edits: [],
    edits_ok: 0,
    params_lost_total: 0,
    unintended_total: 0,
    error: null,
  };

  // Step 1: initial generate
  let gen = await call('/api/generate', { prompt: p.prompt }, cookie);
  row.latency_generate_ms = gen.latency;
  const mode1 = gen.json?.type ?? null;
  row.mode_first = mode1;
  row.mode_match = mode1 === p.expect;
  console.log(`  step1 status=${gen.status} mode=${mode1} latency=${gen.latency}ms`);

  // Step 2: if clarify, answer and retry
  let asset = null;
  if (mode1 === 'clarify') {
    const qs = gen.json.questions ?? [];
    row.clarify_questions_count = qs.length;
    const answers = {};
    for (const q of qs) {
      if (q?.id && Array.isArray(q.choices) && q.choices.length > 0) {
        answers[q.id] = q.choices[0].id;
      }
    }
    row.answers_used = answers;
    console.log(`  clarify: ${qs.length} questions → answering with first choices`);
    const gen2 = await call('/api/generate', { prompt: p.prompt, answers }, cookie);
    row.latency_clarify_round_ms = gen2.latency;
    console.log(`  step2 status=${gen2.status} mode=${gen2.json?.type} latency=${gen2.latency}ms`);
    if (gen2.ok && gen2.json?.type === 'generate') {
      asset = gen2.json.asset;
    } else {
      row.error = `clarify-followup failed: status=${gen2.status} err=${gen2.json?.error ?? gen2.text?.slice(0,150)}`;
    }
  } else if (mode1 === 'generate') {
    asset = gen.json.asset;
  } else {
    row.error = `unexpected mode/status: status=${gen.status} body=${gen.text?.slice(0,200)}`;
  }

  if (!asset) {
    console.log(`  NO ASSET (${row.error})`);
    results.push(row);
    fs.writeFileSync(path.join(OUT_DIR, 'results.json'), JSON.stringify({ startedAt, base: BASE, results }, null, 2));
    continue;
  }

  row.code_len_final = asset.code?.length ?? 0;
  let prevParams = parseParams(asset.code);
  row.params_count = prevParams ? Object.keys(prevParams).length : 0;
  row.skeleton_markers_hit = countSkeletonHits(asset.code);
  console.log(`  asset id=${asset.id} codeLen=${row.code_len_final} params=${row.params_count} skel=${row.skeleton_markers_hit.length}`);

  // Step 3: 3 edits
  let curAsset = asset;
  for (const turn of EDIT_TURNS) {
    const ed = await call('/api/edit', {
      assetId: curAsset.id,
      prompt: turn.prompt,
      currentCode: curAsset.code,
    }, cookie);
    const turnRow = {
      turnId: turn.id,
      prompt: turn.prompt,
      intentKey: turn.intentKey,
      ok: ed.ok,
      status: ed.status,
      latencyMs: ed.latency,
      error: ed.json?.error ?? null,
    };
    if (!ed.ok || !ed.json?.code) {
      console.log(`  edit[${turn.id}] FAIL status=${ed.status} ${ed.json?.error ?? ed.text?.slice(0,100)}`);
      row.edits.push(turnRow);
      break;
    }
    const newParams = parseParams(ed.json.code);
    const diff = paramDiff(prevParams, newParams, turn.intentKey);
    turnRow.diff = diff;
    turnRow.codeLen = ed.json.code.length;
    turnRow.skeletonHits = countSkeletonHits(ed.json.code);
    row.edits.push(turnRow);
    row.edits_ok += 1;
    row.params_lost_total += diff.lostCount ?? 0;
    row.unintended_total += diff.unintendedCount ?? 0;
    // any skeleton in edit-output also counted
    if (turnRow.skeletonHits.length) row.skeleton_markers_hit.push(...turnRow.skeletonHits);
    console.log(`  edit[${turn.id}] ok latency=${ed.latency}ms lost=${diff.lostCount} unintended=${diff.unintendedCount}`);
    curAsset = { id: ed.json.id ?? curAsset.id, code: ed.json.code };
    prevParams = newParams;
  }
  row.code_len_final = curAsset.code?.length ?? row.code_len_final;
  results.push(row);
  fs.writeFileSync(path.join(OUT_DIR, 'results.json'), JSON.stringify({ startedAt, base: BASE, results }, null, 2));
}

// === Aggregate ===
const byCat = {};
for (const r of results) {
  (byCat[r.cat] ??= []).push(r);
}
const modeMatch = results.filter(r => r.mode_match).length;
const totalEdits = results.reduce((s, r) => s + r.edits.length, 0);
const editsOk = results.reduce((s, r) => s + r.edits_ok, 0);
const paramsLostTotal = results.reduce((s, r) => s + r.params_lost_total, 0);
const unintendedTotal = results.reduce((s, r) => s + r.unintended_total, 0);
const skeletonHits = results.reduce((s, r) => s + r.skeleton_markers_hit.length, 0);

function pct(arr) {
  if (!arr.length) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const avg = Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
  const p50 = sorted[Math.floor(arr.length * 0.5)];
  const p95 = sorted[Math.floor(arr.length * 0.95)];
  return { n: arr.length, avgMs: avg, p50Ms: p50, p95Ms: p95 };
}

const genLat = results.map(r => r.latency_generate_ms).filter(x => x > 0);
const editLat = results.flatMap(r => r.edits.filter(e => e.ok).map(e => e.latencyMs));
const unintendedPct = editsOk > 0 ? (unintendedTotal / editsOk) * 100 : 0;
const modeMatchPct = (modeMatch / results.length) * 100;

const byCatAgg = {};
for (const [cat, arr] of Object.entries(byCat)) {
  const matched = arr.filter(r => r.mode_match).length;
  byCatAgg[cat] = {
    n: arr.length,
    mode_match: matched,
    mode_match_pct: Math.round((matched / arr.length) * 100),
  };
}

const summary = {
  startedAt,
  finishedAt: new Date().toISOString(),
  base: BASE,
  totalPrompts: results.length,
  modeMatch: { matched: modeMatch, total: results.length, pct: Math.round(modeMatchPct * 10) / 10 },
  byCategory: byCatAgg,
  skeletonHitsTotal: skeletonHits,
  edits: { attempted: totalEdits, ok: editsOk },
  paramsPreservation: {
    paramsLostTotal,
    unintendedTotal,
    unintendedPct: Math.round(unintendedPct * 10) / 10,
  },
  latency: {
    generate: pct(genLat),
    edit_overall: pct(editLat),
  },
  acceptance: {
    mode_match_gte_90: modeMatchPct >= 90,
    skeleton_hits_zero: skeletonHits === 0,
    params_lost_zero: paramsLostTotal === 0,
    unintended_pct_lte_10: unintendedPct <= 10,
  },
  mismatches: results.filter(r => !r.mode_match).map(r => ({
    id: r.id, cat: r.cat, expect: r.expect, got: r.mode_first, prompt: r.prompt,
  })),
};
summary.verdict = Object.values(summary.acceptance).every(Boolean) ? 'APPROVE' : 'REQUEST_CHANGES';

fs.writeFileSync(path.join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2));
fs.writeFileSync(path.join(OUT_DIR, 'results.json'), JSON.stringify({ startedAt, base: BASE, results, summary }, null, 2));

console.log('\n=== SUMMARY ===');
console.log(JSON.stringify(summary, null, 2));
