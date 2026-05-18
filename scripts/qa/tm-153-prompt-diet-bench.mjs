#!/usr/bin/env node
/**
 * TM-153 — asset-gen prompt diet A/B benchmark.
 *
 * Background: TM-151 (latency budget) found character p50 = 57s, with the
 * asset-gen stage as the long tail (~44s). TM-92 bench measured low-tier
 * gpt-image-1 at 13s p50 with short bench prompts. The remaining ~30s gap
 * is hypothesised to come from prompt-length effects in production, where
 * `buildImagePrompt` concatenates the full user prompt + every clarify
 * answer (KV pairs) + a verbose style suffix.
 *
 * This bench runs the SAME 3 character corpora through the production
 * code path TWICE — once with the current ("long") prompt assembly and
 * once with a "diet" variant that:
 *   - extracts a 1-2 word subject from the prompt + answers (캐릭터/style)
 *   - drops the boilerplate "Style: …" suffix
 *   - aims for <200 char total prompt
 *
 * Telemetry per call: latency_ms, png_size_bytes, prompt_chars,
 * cost_usd (from API usage tokens).
 *
 * Budget guard: hard cap $0.20 (≈ 18 low-tier calls). 6 planned calls.
 *
 * Output:
 *   - 6 PNGs at .spike-assets/TM-153/<variant>/<prompt-id>.png
 *   - JSON summary at wiki/05-reports/screenshots/TM-153/bench-summary.json
 *
 * Usage:
 *   OPENAI_API_KEY=… node scripts/qa/tm-153-prompt-diet-bench.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import OpenAI from 'openai';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

const envPath = path.join(ROOT, '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
if (!process.env.OPENAI_API_KEY) {
  console.error('[TM-153] OPENAI_API_KEY missing — abort.');
  process.exit(1);
}

const ASSET_DIR = path.join(ROOT, '.spike-assets', 'TM-153');
fs.mkdirSync(ASSET_DIR, { recursive: true });
const REPORT_DIR = path.join(ROOT, 'wiki', '05-reports', 'screenshots', 'TM-153');
fs.mkdirSync(REPORT_DIR, { recursive: true });

const BUDGET_USD = Number(process.env.BUDGET_USD ?? '0.20');

const PRICE_TEXT_IN_PER_1M = 5;
const PRICE_IMAGE_IN_PER_1M = 10;
const PRICE_IMAGE_OUT_PER_1M = 40;
const STATIC_PRICE_LOW = 0.011;

// ----- Production prompt builder (current; mirror of asset-gen-stage.ts) -----
const LONG_STYLE = 'friendly cartoon illustration, transparent background, soft colors, centered composition';
function buildPromptLong(prompt, answers) {
  const answerText = answers && Object.keys(answers).length > 0
    ? ' ' + Object.entries(answers).map(([k, v]) => `${k}: ${v}`).join(', ')
    : '';
  return `${prompt}${answerText}. Style: ${LONG_STYLE}.`;
}

// ----- Diet variant -----
// Heuristic: take the first-detected living-entity token from prompt+answers,
// drop the style suffix entirely, and keep at most ONE answer (the one whose
// key matches /style|palette|mood|색|스타일|분위기/i). Result aims for
// "<subject>, <one-style-hint>" — typically <100 chars.
const LIVING_ENTITY_PATTERNS = [
  /\b(character|person|people|girl|boy|man|woman|child|kid|guy|hero|astronaut|wizard|knight|robot|monster|creature|dragon|cat|dog|puppy|kitten|bear|fox|rabbit|bunny|tiger|lion|panda|owl|bird|fish|whale|dolphin|unicorn|alien|zombie|ninja|samurai|princess|prince)\b/i,
  /(곰돌이|강아지|고양이|사람|아이|소년|소녀|남자|여자|용|로봇|괴물|영웅|우주인|마법사|기사|토끼|호랑이|사자|판다|올빼미|새|물고기|돌고래|유니콘|외계인|좀비|닌자|사무라이|공주|왕자|캐릭터)/,
];
const STYLE_KEY_RE = /style|palette|mood|색|스타일|분위기|color/i;

function extractSubject(prompt, answers) {
  const blobParts = [prompt ?? ''];
  if (answers) for (const [k, v] of Object.entries(answers)) { blobParts.push(String(k)); blobParts.push(String(v)); }
  const blob = blobParts.join(' ');
  for (const re of LIVING_ENTITY_PATTERNS) { const m = blob.match(re); if (m) return m[0]; }
  return prompt.split(/\s+/).slice(0, 3).join(' ');
}
function buildPromptDiet(prompt, answers) {
  const subject = extractSubject(prompt, answers);
  let styleHint = '';
  if (answers) {
    for (const [k, v] of Object.entries(answers)) {
      if (STYLE_KEY_RE.test(k)) { styleHint = String(v); break; }
    }
  }
  return styleHint ? `${subject}, ${styleHint}` : `${subject}`;
}

// ----- Fixture: 3 character prompts + clarify answers (TM-149 style) -----
const FIXTURES = [
  { id: 'bear', prompt: '곰돌이가 초원을 걸어가는 약 10초분량의 횡스크롤 애니메이션 만들어줘',
    answers: { style: '동화풍 파스텔 일러스트', palette: '따뜻한 파스텔', mood: '행복하고 평화로움', text_overlay: '없음' } },
  { id: 'puppy', prompt: '강아지가 공원에서 뛰어가는 8초 애니메이션',
    answers: { style: '귀여운 카툰', palette: '밝은 초록', mood: '활기찬', camera: '횡스크롤' } },
  { id: 'robot', prompt: 'robot dancing in cyber city, 6 seconds',
    answers: { style: 'neon synthwave', palette: 'magenta and cyan', mood: 'energetic', text_overlay: 'none' } },
];

// ----- Judge (TM-138 lite reuse) — gpt-4o multimodal -----
const JUDGE_MODEL = 'gpt-4o';
async function judgeImage(client, pngBytes, originalPrompt) {
  const b64 = pngBytes.toString('base64');
  const resp = await client.chat.completions.create({
    model: JUDGE_MODEL,
    messages: [
      { role: 'system', content: 'You are a strict visual judge. Score 0-100 for: (1) subject_match — does the image clearly depict the requested subject; (2) style_quality — overall aesthetic polish. Return strict JSON: {"subject_match":N,"style_quality":N,"overall":N,"notes":"<<50 chars>"}.' },
      { role: 'user', content: [
        { type: 'text', text: `User prompt: ${originalPrompt}\nScore the image.` },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}`, detail: 'low' } },
      ]},
    ],
    response_format: { type: 'json_object' },
    max_tokens: 200,
  });
  const text = resp.choices?.[0]?.message?.content ?? '{}';
  try { return JSON.parse(text); } catch { return { error: 'json_parse', raw: text }; }
}

function priceFromUsage(usage) {
  if (!usage) return null;
  const textIn = usage.input_tokens_details?.text_tokens ?? 0;
  const imgIn = usage.input_tokens_details?.image_tokens ?? 0;
  const imgOut = usage.output_tokens ?? 0;
  const cost = (textIn * PRICE_TEXT_IN_PER_1M + imgIn * PRICE_IMAGE_IN_PER_1M + imgOut * PRICE_IMAGE_OUT_PER_1M) / 1_000_000;
  return { cost, textIn, imgIn, imgOut };
}

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const VARIANTS = [
  { name: 'long', build: buildPromptLong },
  { name: 'diet', build: buildPromptDiet },
];

const results = [];
let runningCost = 0;

for (const v of VARIANTS) {
  fs.mkdirSync(path.join(ASSET_DIR, v.name), { recursive: true });
  for (const f of FIXTURES) {
    if (runningCost + STATIC_PRICE_LOW > BUDGET_USD) {
      console.warn(`[TM-153] BUDGET GUARD: $${runningCost.toFixed(3)} + est $${STATIC_PRICE_LOW} > cap $${BUDGET_USD}. STOP.`);
      results.push({ variant: v.name, fixture: f.id, ok: false, skipped: true, reason: 'budget' });
      continue;
    }
    const imagePrompt = v.build(f.prompt, f.answers);
    console.log(`[TM-153] variant=${v.name} fixture=${f.id} chars=${imagePrompt.length} — calling gpt-image-1 low…`);
    console.log(`         prompt: ${imagePrompt.slice(0, 120)}${imagePrompt.length > 120 ? '…' : ''}`);
    const t0 = Date.now();
    let resp, latencyMs, errMsg;
    try {
      resp = await client.images.generate({ model: 'gpt-image-1', prompt: imagePrompt, size: '1024x1024', quality: 'low', n: 1 });
      latencyMs = Date.now() - t0;
    } catch (err) {
      latencyMs = Date.now() - t0;
      errMsg = (err && err.message) || String(err);
      console.error(`[TM-153] FAIL ${latencyMs}ms: ${errMsg}`);
      results.push({ variant: v.name, fixture: f.id, ok: false, latencyMs, error: errMsg, imagePrompt, promptChars: imagePrompt.length });
      continue;
    }
    const b64 = resp.data?.[0]?.b64_json;
    if (!b64) { results.push({ variant: v.name, fixture: f.id, ok: false, latencyMs, error: 'no b64_json' }); continue; }
    const pngBytes = Buffer.from(b64, 'base64');
    const sizeBytes = pngBytes.length;
    const pngPath = path.join(ASSET_DIR, v.name, `${f.id}.png`);
    fs.writeFileSync(pngPath, pngBytes);
    fs.copyFileSync(pngPath, path.join(REPORT_DIR, `${v.name}-${f.id}.png`));
    const usageCost = priceFromUsage(resp.usage);
    const costUsd = usageCost?.cost ?? STATIC_PRICE_LOW;
    runningCost += costUsd;

    // Judge (TM-138 style)
    let judge = null;
    try {
      judge = await judgeImage(client, pngBytes, f.prompt);
    } catch (err) {
      judge = { error: (err && err.message) || String(err) };
    }
    // judge cost is tiny (~$0.002 with detail:low gpt-4o low-res image)
    // approximate add — not budget-critical
    const approxJudgeCost = 0.003;
    runningCost += approxJudgeCost;

    console.log(`[TM-153] OK ${v.name}/${f.id} ${Math.round(sizeBytes/1024)}KB ${latencyMs}ms $${costUsd.toFixed(4)} judge=${JSON.stringify(judge)} running=$${runningCost.toFixed(3)}`);
    results.push({
      variant: v.name, fixture: f.id, ok: true, imagePrompt, promptChars: imagePrompt.length,
      latencyMs, sizeBytes, sizeKb: Math.round(sizeBytes/1024), costUsd, costSource: usageCost ? 'usage' : 'static',
      usage: resp.usage ?? null, usageBreakdown: usageCost ?? null,
      judge, approxJudgeCost,
      pngPath: path.relative(ROOT, pngPath),
    });
  }
}

// Aggregates
function agg(field, variant) {
  const xs = results.filter(r => r.ok && r.variant === variant).map(r => r[field]).filter(x => typeof x === 'number');
  if (!xs.length) return null;
  xs.sort((a,b)=>a-b);
  return { n: xs.length, min: xs[0], max: xs[xs.length-1], mean: Math.round(xs.reduce((a,b)=>a+b,0)/xs.length), p50: xs[Math.floor(xs.length/2)] };
}
function judgeAgg(variant) {
  const ovs = results.filter(r => r.ok && r.variant === variant && r.judge && typeof r.judge.overall === 'number').map(r => r.judge.overall);
  if (!ovs.length) return null;
  return { n: ovs.length, mean: Math.round(ovs.reduce((a,b)=>a+b,0)/ovs.length), min: Math.min(...ovs), max: Math.max(...ovs) };
}

const summary = {
  task: 'TM-153', ts: new Date().toISOString(), budgetUsd: BUDGET_USD, runningCostUsd: Number(runningCost.toFixed(4)),
  fixtures: FIXTURES.map(f => ({ id: f.id, prompt: f.prompt, answers: f.answers })),
  variants: VARIANTS.map(v => v.name),
  callsAttempted: VARIANTS.length * FIXTURES.length,
  callsSucceeded: results.filter(r => r.ok).length,
  perVariant: Object.fromEntries(VARIANTS.map(v => [v.name, {
    latencyMs: agg('latencyMs', v.name),
    promptChars: agg('promptChars', v.name),
    sizeKb: agg('sizeKb', v.name),
    judgeOverall: judgeAgg(v.name),
  }])),
  results,
};
const summaryPath = path.join(REPORT_DIR, 'bench-summary.json');
fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
console.log(`[TM-153] DONE cost=$${runningCost.toFixed(3)} success=${summary.callsSucceeded}/${summary.callsAttempted}`);
console.log(`[TM-153] summary → ${path.relative(ROOT, summaryPath)}`);
