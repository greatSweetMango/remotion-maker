#!/usr/bin/env node
/**
 * TM-159 — minScenes A/B bench for short character prompts.
 *
 * Compares latency + quality of A (minScenes=2, current default) vs
 * B (minScenes=1, opt-in via AI_MIN_SCENES_SHORT_CHAR=1) on 3 short
 * character prompts (no duration hint or ≤10s).
 *
 * For each prompt we:
 *   1. POST /api/generate twice (variant A then B) by toggling the env on
 *      the dev server beforehand — OR, simpler, by calling the generate
 *      pipeline twice with different process.env flags inside this script.
 *   2. Capture wall-ms + outline scene count + visual judge score
 *      (gpt-4o multimodal — same prompt as TM-46 visual judge).
 *
 * Budget: 3 prompts × 2 variants × (clarify + generate + image + judge)
 *   ≈ $0.30. Caller MUST set OPENAI_API_KEY.
 *
 * Usage (in worktree root):
 *   # variant A run (default — flag OFF)
 *   BASE_URL=http://127.0.0.1:3159 node scripts/qa/tm-159-minscenes-ab.mjs --variant=A
 *   # variant B run (restart dev server with AI_MIN_SCENES_SHORT_CHAR=1)
 *   BASE_URL=http://127.0.0.1:3159 AI_MIN_SCENES_SHORT_CHAR=1 \
 *     node scripts/qa/tm-159-minscenes-ab.mjs --variant=B
 *   # then aggregate
 *   node scripts/qa/tm-159-minscenes-ab.mjs --aggregate
 *
 * Output: wiki/05-reports/screenshots/TM-159/{results-A.json,results-B.json,summary.json}
 *
 * Ship criteria (per TM-159 spec):
 *   - B p50 wall < A p50 wall by ≥ 2s
 *   - B judge mean ≥ A judge mean - 5 (quality drop budget)
 * Met → flip default of AI_MIN_SCENES_SHORT_CHAR=1 (Phase C2 follow-up).
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
if (!process.env.OPENAI_API_KEY) { console.error('missing OPENAI_API_KEY'); process.exit(1); }

const OUT_DIR = path.join(ROOT, 'wiki', '05-reports', 'screenshots', 'TM-159');
fs.mkdirSync(OUT_DIR, { recursive: true });

const args = new Set(process.argv.slice(2));
const variantArg = [...args].find((a) => a.startsWith('--variant='));
const variant = variantArg ? variantArg.split('=')[1] : null;
const aggregate = args.has('--aggregate');

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3159';
const BUDGET_USD = 0.30;

// 3 short character prompts (no duration hint OR ≤10s) — covers the
// segment where minScenes=1 would apply under B variant.
const PROMPTS = [
  {
    id: 'p1-bear-walk',
    prompt: '곰돌이가 초원을 걸어가는 횡스크롤 애니메이션 만들어줘',
    answers: { bear_style: 'cartoon', color_palette: 'warm' },
  },
  {
    id: 'p2-cat-jump',
    prompt: '귀여운 고양이가 점프하는 약 8초 애니메이션',
    answers: { cat_style: 'cartoon', color_palette: 'pastel' },
  },
  {
    id: 'p3-dog-chase',
    prompt: '강아지가 공을 쫓아가는 애니메이션',
    answers: { dog_style: 'cartoon', color_palette: 'vivid' },
  },
];

function nowIso() { return new Date().toISOString(); }
function pct(arr, p) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}
function mean(arr) { return arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null; }

async function getAuthCookie() {
  const res = await fetch(`${BASE}/api/dev/auto-login?callbackUrl=/studio`, { redirect: 'manual' });
  const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  if (setCookies.length) return setCookies.map((c) => c.split(';')[0].trim()).join('; ');
  const raw = res.headers.get('set-cookie');
  if (!raw) throw new Error(`auth failed (${res.status})`);
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
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, ok: res.ok, wallMs, json, text };
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function visualJudge(prompt, imageUrl) {
  // TM-46-style judge: ask gpt-4o (multimodal) to score 0-100.
  const r = await openai.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 200,
    messages: [
      {
        role: 'system',
        content:
          'You are a visual quality judge for AI-generated animation assets. ' +
          'Score 0-100 on how well the image matches the user prompt. ' +
          'Return ONLY valid JSON: {"score": <int>, "reason": "<short>"}.',
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: `Prompt: ${prompt}` },
          { type: 'image_url', image_url: { url: imageUrl } },
        ],
      },
    ],
  });
  const content = r.choices[0]?.message?.content ?? '{}';
  try {
    const m = content.match(/\{[^}]+\}/);
    return m ? JSON.parse(m[0]) : { score: null, reason: content };
  } catch { return { score: null, reason: content }; }
}

async function runVariant(label) {
  const cookie = await getAuthCookie();
  const runs = [];
  for (const p of PROMPTS) {
    console.log(`\n[${label}] ${p.id}: ${p.prompt}`);
    const t0 = Date.now();
    // Step 1: initial → clarify
    const g1 = await callGenerate({ prompt: p.prompt }, cookie);
    let g2 = null;
    if (g1.ok && g1.json?.type === 'clarify') {
      g2 = await callGenerate({ prompt: p.prompt, answers: p.answers }, cookie);
    }
    const totalWall = Date.now() - t0;
    const outlineScenes = g2?.json?.outline?.scenes?.length ?? g2?.json?.asset?.outline?.scenes?.length ?? null;
    const minScenesMeta = g2?.json?.stages?.find?.((s) => s.name === 'outline')?.meta?.min_scenes ?? null;
    let judge = null;
    const imageUrl = g2?.json?.asset?.imageUrl ?? g2?.json?.assetGenStages?.imageUrl ?? null;
    if (imageUrl) {
      try { judge = await visualJudge(p.prompt, imageUrl); } catch (e) { judge = { score: null, error: String(e) }; }
    }
    const run = {
      id: p.id,
      step1WallMs: g1.wallMs,
      step2WallMs: g2?.wallMs ?? null,
      totalWallMs: totalWall,
      outlineScenes,
      minScenesMeta,
      judgeScore: judge?.score ?? null,
      judgeReason: judge?.reason ?? null,
    };
    console.log(`  step2=${run.step2WallMs}ms outlineScenes=${outlineScenes} judge=${run.judgeScore}`);
    runs.push(run);
  }
  const summary = {
    variant: label,
    ranAt: nowIso(),
    runs,
    step2WallP50: pct(runs.map((r) => r.step2WallMs).filter(Boolean), 50),
    step2WallMean: mean(runs.map((r) => r.step2WallMs).filter(Boolean)),
    judgeMean: mean(runs.map((r) => r.judgeScore).filter((s) => typeof s === 'number')),
  };
  const file = path.join(OUT_DIR, `results-${label}.json`);
  fs.writeFileSync(file, JSON.stringify(summary, null, 2));
  console.log(`\nwrote ${file}: p50=${summary.step2WallP50}ms judgeMean=${summary.judgeMean}`);
  return summary;
}

function doAggregate() {
  const A = JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'results-A.json'), 'utf8'));
  const B = JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'results-B.json'), 'utf8'));
  const latencyDelta = (A.step2WallP50 ?? 0) - (B.step2WallP50 ?? 0); // positive = B faster
  const judgeDelta = (B.judgeMean ?? 0) - (A.judgeMean ?? 0); // negative = B worse
  const shipMet = latencyDelta >= 2000 && judgeDelta >= -5;
  const verdict = {
    A: { p50: A.step2WallP50, mean: A.step2WallMean, judge: A.judgeMean },
    B: { p50: B.step2WallP50, mean: B.step2WallMean, judge: B.judgeMean },
    latencyDeltaMs: latencyDelta,
    judgeDelta,
    shipCriteria: { latencyFasterBy2s: latencyDelta >= 2000, judgeDropUnder5: judgeDelta >= -5 },
    shipMet,
    recommendation: shipMet
      ? 'SHIP: flip AI_MIN_SCENES_SHORT_CHAR default to 1 for short character prompts'
      : 'HOLD: keep current default (minScenes=2). Review judge reasons.',
    ranAt: nowIso(),
  };
  const out = path.join(OUT_DIR, 'summary.json');
  fs.writeFileSync(out, JSON.stringify(verdict, null, 2));
  console.log(JSON.stringify(verdict, null, 2));
}

if (aggregate) {
  doAggregate();
} else if (variant === 'A' || variant === 'B') {
  await runVariant(variant);
} else {
  console.error('Usage: --variant=A | --variant=B | --aggregate');
  process.exit(2);
}
