#!/usr/bin/env node
/**
 * TM-182 — Empty-video RCA driver.
 *
 * Reproduces the prod regression where the prompt
 *   "곰돌이가 초원을 걸어가는 10초가량의 횡스크롤 애니메이션 만들어줘"
 * yields a blank (black/white) video generated abnormally fast.
 *
 * Hypotheses (from task spec):
 *   (1) multi-step → single-shot fallback drops the asset-gen PNG
 *   (2) TM-176 letterbox lint hard-reject loops
 *   (3) TM-175 lucide scrub side-effect
 *   (4) TM-181 scene-prefixed imageUrl self-heal regression
 *   (5) AbsoluteFill opaque reject
 *
 * For each of N runs we go through the FULL user flow (round1 clarify →
 * round2 generate) and record:
 *   - mode_first / mode_final
 *   - multiStep.fallback      ← 'single-shot' confirms hypothesis (1)
 *   - assetGenStages.mode + asset_gen_used
 *   - code has <Img / PARAMS.imageUrl
 *   - "visible content" heuristic (non-trivial scene body)
 *   - latency
 *
 * Output: /tmp/tm-182-repro.json
 */
import fs from 'node:fs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3082';
const RUNS = Number(process.env.TM182_RUNS ?? 5);
const PROMPT = '곰돌이가 초원을 걸어가는 10초가량의 횡스크롤 애니메이션 만들어줘';
const OUT = process.env.TM182_OUT ?? '/tmp/tm-182-repro.json';

async function getAuthCookie() {
  const res = await fetch(`${BASE}/api/dev/auto-login?callbackUrl=/studio`, { redirect: 'manual' });
  const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  if (setCookies.length) return setCookies.map((c) => c.split(';')[0].trim()).join('; ');
  const raw = res.headers.get('set-cookie');
  if (!raw) throw new Error(`No Set-Cookie from auto-login (status ${res.status})`);
  return raw.split(/,(?=\s*[\w%-]+=)/).map((c) => c.split(';')[0].trim()).join('; ');
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

/** Heuristic: does the SCENE_CODE actually paint something? */
function visibleContentScore(code) {
  if (!code) return { score: 0, reasons: ['no code'] };
  const reasons = [];
  let score = 0;
  if (/<Img\b/.test(code)) { score += 2; reasons.push('has <Img'); }
  if (/PARAMS\.imageUrl/.test(code)) { score += 1; reasons.push('refs PARAMS.imageUrl'); }
  if (/imageUrl\s*:\s*['"`]https?:\/\//.test(code)) { score += 2; reasons.push('imageUrl literal http'); }
  // any non-trivial visual primitive
  const paints = (code.match(/<(AbsoluteFill|div|svg|rect|circle|path|Sequence|h1|h2|p|span|Img|text)\b/g) || []).length;
  if (paints >= 4) { score += 2; reasons.push(`${paints} paint tags`); }
  // empty/transparent-only scene = the regression fingerprint
  const transparentOnly =
    /backgroundColor:\s*['"]transparent['"]/.test(code) &&
    !/<Img/.test(code) &&
    paints < 4;
  if (transparentOnly) { score = 0; reasons.push('TRANSPARENT-ONLY (empty fingerprint)'); }
  return { score, reasons, paintTags: paints };
}

const cookie = await getAuthCookie();
console.log(`TM-182 RCA :: BASE=${BASE} runs=${RUNS}`);
console.log(`auth cookie acquired (${cookie.length} chars)`);

const results = [];
for (let i = 0; i < RUNS; i++) {
  console.log(`\n=== RUN ${i + 1}/${RUNS} ===`);
  const row = { run: i + 1 };

  const g1 = await call('/api/generate', { prompt: PROMPT }, cookie);
  row.round1_status = g1.status;
  row.round1_latency_ms = g1.latency;
  row.mode_first = g1.json?.type ?? null;
  console.log(`  round1 status=${g1.status} mode=${row.mode_first} latency=${g1.latency}ms`);

  let finalJson = null;
  if (row.mode_first === 'clarify') {
    const qs = g1.json.questions ?? [];
    const answers = {};
    for (const q of qs) {
      if (q?.id && Array.isArray(q.choices) && q.choices.length > 0) answers[q.id] = q.choices[0].id;
    }
    row.clarify_q = qs.length;
    const g2 = await call('/api/generate', { prompt: PROMPT, answers }, cookie);
    row.round2_status = g2.status;
    row.round2_latency_ms = g2.latency;
    row.mode_final = g2.json?.type ?? null;
    finalJson = g2.json;
    console.log(`  round2 status=${g2.status} mode=${row.mode_final} latency=${g2.latency}ms`);
  } else if (row.mode_first === 'generate') {
    row.mode_final = 'generate';
    finalJson = g1.json;
  } else {
    row.error = `unexpected round1: status=${g1.status} body=${g1.text?.slice(0, 300)}`;
  }

  if (finalJson?.type === 'generate') {
    row.multiStep_fallback = finalJson.multiStep?.fallback ?? null;
    row.multiStep_costRatio = finalJson.multiStep?.costRatio ?? null;
    row.multiStep_assetGen = finalJson.multiStep?.assetGen ?? null;
    row.assetGenStages_mode = finalJson.assetGenStages?.mode ?? null;
    row.assetGenStages_used = finalJson.assetGenStages?.asset_gen_used ?? null;
    row.assetGenStages_scenes = finalJson.assetGenStages?.scenes ?? null;
    row.warning = finalJson.warning ?? null;
    const code = finalJson.asset?.code ?? '';
    row.code_len = code.length;
    row.has_img = /<Img\b/.test(code);
    row.has_params_imageurl = /PARAMS\.imageUrl/.test(code);
    const vis = visibleContentScore(code);
    row.visible_score = vis.score;
    row.visible_reasons = vis.reasons;
    row.visible = vis.score >= 3;
    console.log(`  fallback=${row.multiStep_fallback} assetGenMode=${row.assetGenStages_mode} assetGenUsed=${row.assetGenStages_used} hasImg=${row.has_img} visible=${row.visible} (score=${vis.score}) [${vis.reasons.join(', ')}]`);
    if (row.warning) console.log(`  WARNING: ${String(row.warning).slice(0, 200)}`);
  } else {
    console.log(`  NO ASSET (mode_final=${row.mode_final}) ${row.error ?? ''}`);
  }

  results.push(row);
  fs.writeFileSync(OUT, JSON.stringify({ prompt: PROMPT, runs: RUNS, results }, null, 2));
}

// Summary
const gen = results.filter((r) => r.mode_final === 'generate');
const fallbacks = gen.filter((r) => r.multiStep_fallback === 'single-shot').length;
const assetUsed = gen.filter((r) => r.assetGenStages_used === true).length;
const visible = gen.filter((r) => r.visible === true).length;
const avgLatency = gen.length
  ? Math.round(gen.reduce((s, r) => s + (r.round2_latency_ms ?? r.round1_latency_ms ?? 0), 0) / gen.length)
  : null;
const summary = {
  total: results.length,
  generate: gen.length,
  fallback_single_shot: fallbacks,
  asset_gen_used: assetUsed,
  visible_content: visible,
  empty_content: gen.length - visible,
  avg_generate_latency_ms: avgLatency,
};
fs.writeFileSync(OUT, JSON.stringify({ prompt: PROMPT, runs: RUNS, summary, results }, null, 2));
console.log('\n=== SUMMARY ===');
console.log(JSON.stringify(summary, null, 2));
