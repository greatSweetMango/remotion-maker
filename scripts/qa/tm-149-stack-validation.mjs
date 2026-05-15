#!/usr/bin/env node
/**
 * TM-149 — Post-TM-135 stack validation
 *
 * 10 prompts × generate (clarify→answer→generate where applicable)
 *
 * Goal: measure post-TM-135 stack (TM-136..147) integrated effect.
 *   - asset-gen un-gated (TM-136)
 *   - CHARACTER prompt guidelines (TM-137)
 *   - vision self-critique loop (TM-138)
 *   - multi-step default ON for character (TM-139)
 *   - Lottie ADR-0027 + 8-catalogue (TM-140/144)
 *   - community templates RAG (TM-141)
 *   - Lottie prompt enum (TM-145)
 *   - Lottie picker UI (TM-146)
 *
 * Per prompt:
 *   1) POST /api/generate
 *   2) if clarify → first-choice answers → POST /api/generate
 *   3) record:
 *      - mode_first / mode_match
 *      - asset_gen_used (PARAMS.imageUrl in code, or imageUrl: 'https://')
 *      - lottie_used (CatalogueLottie / lottiefiles / @lottiefiles/react-lottie-player)
 *      - skeleton_markers_hit
 *      - code_len, params_count
 *      - judge_score (if metadata.selfCritique exposed)
 *      - latency
 *
 * Acceptance:
 *   - character mode_match ≥ 4/5
 *   - character asset-gen used ≥ 4/5 (image or lottie counts)
 *   - motion-graphics + data-viz mode_match 5/5
 *   - skeleton hits == 0
 *
 * Output:
 *   wiki/05-reports/screenshots/TM-149/{results.json, summary.json}
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const OUT_DIR = path.join(ROOT, 'wiki', '05-reports', 'screenshots', 'TM-149');
fs.mkdirSync(OUT_DIR, { recursive: true });

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3149';

const PROMPTS = [
  // ---- Character / Scene (5) ----
  { id: 'C01', cat: 'character', expect: 'clarify',
    prompt: '곰돌이가 초원을 걸어가는 약 10초분량의 횡스크롤 애니메이션 만들어줘' },
  { id: 'C02', cat: 'character', expect: 'clarify',
    prompt: '강아지가 공원에서 뛰어가는 8초 애니메이션' },
  { id: 'C03', cat: 'character', expect: 'clarify',
    prompt: '고양이가 창가에서 자는 5초' },
  { id: 'C04', cat: 'character', expect: 'clarify',
    prompt: 'robot dancing in cyber city, 6 seconds' },
  { id: 'C05', cat: 'character', expect: 'clarify',
    prompt: 'person walking through forest, 10 seconds' },
  // ---- Motion-Graphics (3) ----
  { id: 'M01', cat: 'motion-graphics', expect: 'generate',
    prompt: 'Animated counter from 0 to 100 with spring effect, blue' },
  { id: 'M02', cat: 'motion-graphics', expect: 'generate',
    prompt: '빨간 카운터 0~100, 3초' },
  { id: 'M03', cat: 'motion-graphics', expect: 'generate',
    prompt: '원형 스피너 8개 점, 파란색' },
  // ---- Data-Viz (2) ----
  { id: 'D01', cat: 'data-viz', expect: 'generate',
    prompt: 'Bar chart top 5 products by revenue' },
  { id: 'D02', cat: 'data-viz', expect: 'generate',
    prompt: 'Line chart stock price daily' },
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

function detectAssetGen(code) {
  if (!code) return false;
  // image asset: Img src with our /api/asset/, or PARAMS.imageUrl* declared with https URL
  if (/imageUrl\s*:\s*['"`]https?:\/\//.test(code)) return true;
  if (/\/api\/asset\//.test(code)) return true;
  if (/replicate\.delivery|cdn\.openai|oaidalleapiprodscus|character-asset/.test(code)) return true;
  return false;
}

function detectLottie(code) {
  if (!code) return false;
  if (/CatalogueLottie/.test(code)) return true;
  if (/@lottiefiles\/react-lottie-player/.test(code)) return true;
  if (/lottiefiles\.com|lottieJSON|animationData/.test(code)) return true;
  return false;
}

function detectMultiStep(meta) {
  if (!meta) return null;
  if (Array.isArray(meta.scenes)) return meta.scenes.length;
  if (typeof meta.sceneCount === 'number') return meta.sceneCount;
  if (meta.multiStep === true) return true;
  return null;
}

async function getAuthCookie() {
  const res = await fetch(`${BASE}/api/dev/auto-login?callbackUrl=/studio`, { redirect: 'manual' });
  const setCookies = (typeof res.headers.getSetCookie === 'function') ? res.headers.getSetCookie() : [];
  if (setCookies.length) return setCookies.map(c => c.split(';')[0].trim()).join('; ');
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
console.log(`TM-149 driver :: BASE=${BASE} :: ${PROMPTS.length} prompts`);

const cookie = await getAuthCookie();
console.log(`auth cookie acquired (${cookie.length} chars)`);

const results = [];

for (const p of PROMPTS) {
  console.log(`\n[${p.id}] (${p.cat}, expect=${p.expect}) ${p.prompt.slice(0, 60)}`);
  const row = {
    ...p,
    mode_first: null,
    mode_final: null,
    mode_match: false,
    clarify_questions_count: 0,
    answers_used: null,
    code_len: 0,
    params_count: 0,
    asset_gen_used: false,
    lottie_used: false,
    skeleton_markers_hit: [],
    multi_step_scenes: null,
    judge_score: null,
    latency_generate_ms: 0,
    latency_clarify_round_ms: 0,
    asset_id: null,
    error: null,
  };

  // Step 1: initial generate
  let gen = await call('/api/generate', { prompt: p.prompt }, cookie);
  row.latency_generate_ms = gen.latency;
  const mode1 = gen.json?.type ?? null;
  row.mode_first = mode1;
  row.mode_match = mode1 === p.expect;
  console.log(`  step1 status=${gen.status} mode=${mode1} latency=${gen.latency}ms`);

  let asset = null;
  let finalJson = null;
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
    row.mode_final = gen2.json?.type ?? null;
    console.log(`  step2 status=${gen2.status} mode=${gen2.json?.type} latency=${gen2.latency}ms`);
    if (gen2.ok && gen2.json?.type === 'generate') {
      asset = gen2.json.asset;
      finalJson = gen2.json;
    } else {
      row.error = `clarify-followup failed: status=${gen2.status} err=${gen2.json?.error ?? gen2.text?.slice(0,200)}`;
    }
  } else if (mode1 === 'generate') {
    asset = gen.json.asset;
    finalJson = gen.json;
    row.mode_final = 'generate';
  } else {
    row.error = `unexpected mode/status: status=${gen.status} body=${gen.text?.slice(0,200)}`;
  }

  if (asset) {
    row.asset_id = asset.id ?? null;
    row.code_len = asset.code?.length ?? 0;
    const params = parseParams(asset.code);
    row.params_count = params ? Object.keys(params).length : 0;
    row.skeleton_markers_hit = countSkeletonHits(asset.code);
    row.asset_gen_used = detectAssetGen(asset.code);
    row.lottie_used = detectLottie(asset.code);
    row.multi_step_scenes = detectMultiStep(finalJson?.metadata) ?? detectMultiStep(asset.metadata);
    row.judge_score = finalJson?.metadata?.selfCritique?.score ?? finalJson?.metadata?.judge?.score
                       ?? asset?.metadata?.selfCritique?.score ?? null;
    console.log(`  asset id=${asset.id} codeLen=${row.code_len} params=${row.params_count} skel=${row.skeleton_markers_hit.length} assetGen=${row.asset_gen_used} lottie=${row.lottie_used} multiStep=${row.multi_step_scenes} judge=${row.judge_score}`);
  } else {
    console.log(`  NO ASSET (${row.error})`);
  }

  results.push(row);
  fs.writeFileSync(path.join(OUT_DIR, 'results.json'), JSON.stringify({ startedAt, base: BASE, results }, null, 2));
}

// === Aggregate ===
const byCat = {};
for (const r of results) (byCat[r.cat] ??= []).push(r);

const byCatAgg = {};
for (const [cat, arr] of Object.entries(byCat)) {
  const matched = arr.filter(r => r.mode_match).length;
  const assetGen = arr.filter(r => r.asset_gen_used || r.lottie_used).length;
  const lottie = arr.filter(r => r.lottie_used).length;
  const image = arr.filter(r => r.asset_gen_used).length;
  byCatAgg[cat] = {
    n: arr.length,
    mode_match: matched,
    mode_match_pct: Math.round((matched / arr.length) * 100),
    asset_or_lottie_used: assetGen,
    image_asset: image,
    lottie_asset: lottie,
  };
}

const skeletonHits = results.reduce((s, r) => s + r.skeleton_markers_hit.length, 0);
const characterArr = byCat['character'] ?? [];
const characterMatch = characterArr.filter(r => r.mode_match).length;
const characterAssetGen = characterArr.filter(r => r.asset_gen_used || r.lottie_used).length;
const motionArr = byCat['motion-graphics'] ?? [];
const motionMatch = motionArr.filter(r => r.mode_match).length;
const dataArr = byCat['data-viz'] ?? [];
const dataMatch = dataArr.filter(r => r.mode_match).length;

const summary = {
  startedAt,
  finishedAt: new Date().toISOString(),
  base: BASE,
  totalPrompts: results.length,
  byCategory: byCatAgg,
  skeletonHitsTotal: skeletonHits,
  acceptance: {
    character_mode_match_gte_4: characterMatch >= 4,
    character_asset_gen_gte_4: characterAssetGen >= 4,
    motion_graphics_full_match: motionMatch === motionArr.length,
    data_viz_full_match: dataMatch === dataArr.length,
    skeleton_hits_zero: skeletonHits === 0,
  },
  characterMatch,
  characterAssetGen,
  motionMatch,
  motionTotal: motionArr.length,
  dataMatch,
  dataTotal: dataArr.length,
  errors: results.filter(r => r.error).map(r => ({ id: r.id, cat: r.cat, error: r.error })),
};
summary.verdict = Object.values(summary.acceptance).every(Boolean) ? 'APPROVE' : 'REQUEST_CHANGES';

fs.writeFileSync(path.join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2));
fs.writeFileSync(path.join(OUT_DIR, 'results.json'), JSON.stringify({ startedAt, base: BASE, results, summary }, null, 2));

console.log('\n=== SUMMARY ===');
console.log(JSON.stringify(summary, null, 2));
